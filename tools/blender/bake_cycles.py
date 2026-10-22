# tools/blender/bake_cycles.py — M5 Cycles 烘焙执行器
# 每图集组 4 图: color(无灯光固有色) / irrA(night) / irrB(tv_only) / irrC(dusk)
# 断点: 已存在的输出贴图自动跳过, --force 重烘; --only <组名> 只烘指定组
# 契约: blender -b -P main.py -- bake_cycles [--only shell] [--force]
import bpy
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assemble
import bake_uv2
import lights

UV2 = bake_uv2.UV2
NODE_NAME = "m5_bake_node"
TV_GLOW = "tv_glow_plane"


# ---------------- Cycles / GPU 初始化 ----------------
# 设备链: OPTIX -> CUDA -> CPU。
# 本机实测 (GTX 1650, 驱动 560.94, Blender 5.2.3): OptiX 内核 PTX JIT 失败
# (OPTIX_ERROR_INTERNAL_COMPILER_ERROR / unimplemented PTX intrinsics), render 会 raise,
# bake 则静默出全黑图 —— 所以必须"探测渲染"验证, 不能只看设备枚举。

_device = None          # 选定设备: 'OPTIX' / 'CUDA' / 'CPU'


def _probe_render():
    """在当前(空)场景搭 cube+sun+camera 做 128px/2spp 探测渲染, 验证设备真能出图。
    返回 True=图像非全黑。探测对象随后删除, 不影响后续装配。"""
    import math
    from mathutils import Vector
    sc = bpy.context.scene
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0))
    cube = bpy.context.object
    m = bpy.data.materials.new("m5_probe_mat")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.8, 0.3, 0.1, 1)
    cube.data.materials.append(m)
    ld = bpy.data.lights.new("m5_probe_sun", 'SUN')
    ld.energy = 3
    lo = bpy.data.objects.new("m5_probe_sun", ld)
    bpy.context.collection.objects.link(lo)
    cam = bpy.data.objects.new("m5_probe_cam", bpy.data.cameras.new("m5_probe_cam"))
    bpy.context.collection.objects.link(cam)
    cam.location = (3, -3, 2)
    d = (Vector((0, 0, 0)) - cam.location).normalized()
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    w = bpy.data.worlds.new("m5_probe_world")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.6, 0.8, 1)
    prev_world = sc.world
    sc.world = w
    prev_res = (sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage)
    sc.render.resolution_x = sc.render.resolution_y = 128
    sc.render.resolution_percentage = 100
    out = os.path.join(os.environ.get("TEMP", r"C:\tmp"), "m5_dev_probe.png")
    sc.render.filepath = out
    ok = False
    try:
        bpy.ops.render.render(write_still=True)
        if os.path.exists(out):
            img = bpy.data.images.load(out)
            px = list(img.pixels)
            bpy.data.images.remove(img)
            mean = sum(px) / len(px) if px else 0.0
            ok = mean > 0.001
    except Exception as e:
        print(f"[cycles] probe render failed: {str(e)[:100]}")
    # 清理探测对象
    for ob in (cube, lo, cam):
        bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.materials.remove(m)
    bpy.data.worlds.remove(w)
    if prev_world:
        sc.world = prev_world
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = prev_res
    if os.path.exists(out):
        os.remove(out)
    return ok


def pick_device():
    """按 OPTIX -> CUDA -> CPU 探测选设备。必须在装配前调用(会临时占用空场景)。"""
    global _device
    if _device:
        return _device
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for dt in ('OPTIX', 'CUDA'):
        try:
            prefs.compute_device_type = dt
            prefs.get_devices()
            if not any(d.type == dt and d.use for d in prefs.devices):
                print(f"[cycles] {dt}: no usable device, try next")
                continue
            sc.cycles.device = 'GPU'
            if _probe_render():
                _device = dt
                print(f"[cycles] probe OK -> GPU ({dt})")
                return _device
            print(f"[cycles] {dt}: probe render failed/black, try next")
        except Exception as e:
            print(f"[cycles] {dt} init failed: {e}")
    prefs.compute_device_type = 'NONE'
    prefs.get_devices()
    sc.cycles.device = 'CPU'
    _device = 'CPU'
    print("[cycles] probe fallback -> CPU")
    return _device


def setup_cycles(samples=8, margin=8):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    dev = pick_device()
    if dev == 'OPTIX':
        try:
            sc.cycles.denoiser = 'OPTIX'
            print("[cycles] denoiser: OPTIX")
        except Exception:
            print("[cycles] denoiser: OPENIMAGEDENOISE (OptiX denoiser unavailable)")
    else:
        try:
            sc.cycles.denoiser = 'OPENIMAGEDENOISE'
            print("[cycles] denoiser: OPENIMAGEDENOISE")
        except Exception:
            pass
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.max_bounces = 4
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 1
    sc.cycles.transmission_bounces = 2
    sc.render.bake.margin = margin
    sc.render.bake.margin_type = 'EXTEND'
    print(f"[cycles] device={dev} samples={samples} margin={margin}px bounces=4/3/1/2")
    return dev


# ---------------- 材质操控 ----------------

def _bake_node(mat, img):
    nt = mat.node_tree
    n = nt.nodes.get(NODE_NAME)
    if n is None:
        n = nt.nodes.new("ShaderNodeTexImage")
        n.name = NODE_NAME
        n.label = "M5 bake target"
    n.image = img
    nt.nodes.active = n
    return n


def _plug_image(objs, img):
    done = set()
    for ob in objs:
        for m in ob.data.materials:
            if m and m.name not in done:
                _bake_node(m, img)
                done.add(m.name)


def swap_white(ctx, white):
    """所有静态网格换纯白漫反射(粗糙1): irradiance 烘焙基准。tv_glow_plane 除外。"""
    store = {}
    for ob in ctx["static"]:
        mats = list(ob.data.materials)
        store[ob.name] = mats
        for i in range(len(mats)):
            ob.data.materials[i] = white
        if len(mats) == 0:
            ob.data.materials.append(white)
    print(f"[bake] material swap -> white diffuse: {len(store)} meshes")
    return store


def restore_materials(ctx, store):
    for ob in ctx["static"]:
        mats = store.get(ob.name)
        if mats is None:
            continue
        for i in range(len(mats)):
            ob.data.materials[i] = mats[i]
        while len(ob.data.materials) > len(mats):
            ob.data.materials.pop(index=len(mats))
    print("[bake] materials restored")


def set_excluded_hidden(ctx, hidden):
    for ob in ctx["excluded"]:
        ob.hide_render = hidden
    if hidden:
        print(f"[bake] excluded hidden for irradiance: {len(ctx['excluded'])} meshes")


# ---------------- 烘焙核心 ----------------

def _save_png(img, path):
    sc = bpy.context.scene
    prev = (sc.view_settings.view_transform, sc.view_settings.look,
            sc.view_settings.exposure)
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.color_depth = '8'
    img.save_render(path, scene=sc)
    sc.view_settings.view_transform, sc.view_settings.look, sc.view_settings.exposure = prev


def bake_map(ctx, group, objs, map_kind, size, outdir, force=False):
    """map_kind: color / irrA / irrB / irrC。返回 (path, seconds) 或 (path, None)=跳过。"""
    name = f"{group}_{map_kind}"
    path = os.path.join(outdir, name + ".png")
    if os.path.exists(path) and not force:
        print(f"[bake] SKIP {name} (exists, use --force to rebake)")
        return path, None
    img = bpy.data.images.get(name)
    if img is None or img.size[0] != size:
        if img:
            bpy.data.images.remove(img)
        img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'sRGB'

    if map_kind == "color":
        bpy.context.scene.render.bake.use_pass_direct = False
        bpy.context.scene.render.bake.use_pass_indirect = False
        bpy.context.scene.render.bake.use_pass_color = True
        btype = 'DIFFUSE'
    else:
        bpy.context.scene.render.bake.use_pass_direct = True
        bpy.context.scene.render.bake.use_pass_indirect = True
        bpy.context.scene.render.bake.use_pass_color = False
        btype = 'DIFFUSE'
        if map_kind == "irrA":
            lights.setup("night")
        elif map_kind == "irrB":
            lights.setup("tv_only")
        elif map_kind == "irrC":
            lights.setup("dusk_only")

    _plug_image(objs, img)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

    t0 = time.perf_counter()
    bpy.ops.object.bake(type=btype, use_clear=True, margin=8, uv_layer=UV2)
    dt = time.perf_counter() - t0
    px = list(img.pixels)
    mean = sum(px) / len(px) if px else 0.0
    if mean < 0.0005:
        print(f"[bake] WARN {name}: image nearly BLACK (mean={mean:.5f}), "
              f"device may have failed silently")
    _save_png(img, path)
    kb = os.path.getsize(path) / 1024
    print(f"[bake] {name}: {dt:.1f}s mean={mean:.3f} -> {path} ({kb:.0f} KB)")
    return path, dt


def bake_groups(ctx, groups=None, size=512, samples=8, margin=8, force=False):
    sc = bpy.context.scene
    setup_cycles(samples=samples, margin=margin)
    outdir = os.path.join(assemble.V1, bake_uv2.ATLAS_DIRNAME)
    os.makedirs(outdir, exist_ok=True)

    want = groups or list(ctx["groups"].keys())
    todo = {g: ctx["groups"][g] for g in want if g in ctx["groups"]}
    print(f"[bake] groups to bake: {sorted(todo.keys())} size={size}px")

    results = {}
    # 1) color: 真实材质, 与灯光无关 (pass_direct/indirect 关)
    for g, objs in sorted(todo.items()):
        results[f"{g}_color"] = bake_map(ctx, g, objs, "color", size, outdir, force)

    # 2) irradiance 三态: 隐藏动态件, 静态全换白漫反射
    white = bpy.data.materials.get("m5_bake_white")
    if white is None:
        white = bpy.data.materials.new("m5_bake_white")
        white.use_nodes = True
        b = white.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        b.inputs["Roughness"].default_value = 1.0
    set_excluded_hidden(ctx, True)
    store = swap_white(ctx, white)
    for kind in ("irrA", "irrB", "irrC"):
        for g, objs in sorted(todo.items()):
            results[f"{g}_{kind}"] = bake_map(ctx, g, objs, kind, size, outdir, force)
    restore_materials(ctx, store)
    set_excluded_hidden(ctx, False)

    done = {k: v[1] for k, v in results.items() if v[1] is not None}
    skip = [k for k, v in results.items() if v[1] is None]
    if done:
        total = sum(done.values())
        print(f"[bake] baked {len(done)} maps, total {total:.1f}s "
              f"(avg {total / len(done):.1f}s/map)")
    if skip:
        print(f"[bake] skipped (resume): {skip}")
    return results


def build(env):
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = None
    force = "--force" in argv
    if "--only" in argv:
        i = argv.index("--only")
        if i + 1 < len(argv):
            only = [g for g in argv[i + 1].split(",") if g]
    pick_device()          # 须在装配前探测(利用空场景做探针渲染)
    ctx = assemble.build(env)
    bake_uv2.build_uv2(ctx)
    bake_groups(ctx, groups=only, force=force)
    return ctx
