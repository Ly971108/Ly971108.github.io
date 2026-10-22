# export_uv2_glb.py — 重放装配+UV2（确定性），导出含 TEXCOORD_1 的静态合并 GLB
# 用法: blender -b -P tools/blender/main.py -- export_uv2_glb
import bpy, os, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools", "blender"))
import assemble, bake_uv2

V1 = os.path.join(ROOT, "assets", "scene", "v0001")


def build(env):
    env['clean']()
    # 与烘焙同一路径：装配 → UV2 打包（无随机，结果与过夜烘焙一致）
    ctx = assemble.build(env)
    bake_uv2.build_uv2(ctx, tex_size=2048)
    print("[export_uv2] uv2 replay ok")

    # 补齐基础 UVMap: from_pydata 程序化网格(奖状纸/花毯/挂历山/搪瓷缸)无 UV1,
    # UV2 会被导出成 TEXCOORD_0。补 dummy UVMap 垫底, 保证 UV2 -> TEXCOORD_1。
    fixed = 0
    for ob in ctx["static"]:
        me = ob.data
        if len(me.uv_layers) >= 2:
            continue
        uv2 = [tuple(v.uv) for v in me.uv_layers[bake_uv2.UV2].data]
        me.uv_layers.remove(me.uv_layers[bake_uv2.UV2])
        me.uv_layers.new(name="UVMap")            # index 0, dummy(全0, 运行时不用)
        l2 = me.uv_layers.new(name=bake_uv2.UV2)  # index 1 -> TEXCOORD_1
        for v, co in zip(l2.data, uv2):
            v.uv = co
        fixed += 1
    if fixed:
        print(f"[export_uv2] added dummy UVMap on {fixed} meshes (no base UV)")

    # 收集静态网格（与 assemble 的静态收集同规则：不在 STATIC_EXCLUDE 且不在 outside/stub）
    static = [ob for ob in bpy.data.objects if ob.type == 'MESH' and not assemble.is_excluded(ob)]
    print(f"[export_uv2] static meshes: {len(static)}")

    # 只导出静态网格：暂时把其他的移出场景
    others = [ob for ob in bpy.data.objects if ob not in static]
    for ob in others:
        ob.select_set(False)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in static:
        ob.select_set(True)
    out = os.path.join(V1, "scene_static.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True,
        export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True,
        export_materials='EXPORT', export_image_format='NONE',
    )
    size = os.path.getsize(out)
    print(f"[export_uv2] scene_static.glb {size/1024:.0f} KB ({len(static)} meshes)")

    # 校验 TEXCOORD_1
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=out)
    missing = [ob.name for ob in bpy.data.objects if ob.type == 'MESH' and len(ob.data.uv_layers) < 2]
    n_all = sum(1 for ob in bpy.data.objects if ob.type == 'MESH')
    print(f"[export_uv2] verify: {n_all - len(missing)}/{n_all} meshes have TEXCOORD_1")
    if missing:
        print("[export_uv2] MISSING:", ", ".join(sorted(missing)))
    print("[export_uv2] DONE")
