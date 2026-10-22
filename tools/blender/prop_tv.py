# tools/blender/prop_tv.py — M3 道具: 90年代农村 CRT 电视机 (落地木座 + 主机)
# 位置: 世界 (0, 1.50) 后墙前, 正面朝 -Y (房间中心), 右侧面板朝 +X
# 命名: 全部 prop_tv_*; 独立动画节点: prop_tv_screen / prop_tv_knob_channel / prop_tv_knob_volume
import bpy
import os
import math
from mathutils import Vector
import common


# ---------------- 局部材质 helpers (Principled + 噪声, 禁贴图) ----------------

def _noise_wood(name, c_dark, c_light, rough=0.68, scale=3.0, bump=0.12):
    """木纹: 低频噪声调色 + 高频细凹凸。"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = rough
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = scale
    tex.inputs["Detail"].default_value = 3.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*c_dark, 1.0)
    ramp.color_ramp.elements[1].color = (*c_light, 1.0)
    nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    fine = nt.nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 45.0
    fine.inputs["Detail"].default_value = 2.0
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = bump
    bp.inputs["Distance"].default_value = 0.003
    nt.links.new(fine.outputs["Fac"], bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def _noise_plastic(name, color, rough=0.55, bump=0.06):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    fine = nt.nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 60.0
    fine.inputs["Detail"].default_value = 2.0
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = bump
    bp.inputs["Distance"].default_value = 0.0015
    nt.links.new(fine.outputs["Fac"], bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def _plain(name, color, rough=0.5, metallic=0.0, alpha=1.0):
    m = common.principled(name, color, roughness=rough, metallic=metallic)
    if alpha < 1.0:
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = 'DITHERED'   # Blender 4.2+/5.x Eevee
        except Exception:
            m.blend_method = 'BLEND'              # 旧版兼容
    return m


def _apply(ob, rot=False):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=False, rotation=rot, scale=True)


def _smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True


def _cyl_x(name, loc, radius, depth, mat, vertices=24):
    """轴沿 X 的圆柱（右侧面板用）。"""
    ob = common.cylinder(name, loc, radius, depth, mat, vertices=vertices)
    ob.rotation_euler = (0, math.pi / 2, 0)
    _apply(ob, rot=True)
    return ob


# ---------------- build ----------------

def build(env):
    env['clean']()
    sc = bpy.context.scene
    ROOT = env['ROOT']
    CX, CY = 0.0, 1.50          # 落地座中心

    # 材质
    M = {
        "wood_old":  _noise_wood("tv_wood_old", (0.28, 0.17, 0.09), (0.46, 0.30, 0.16), scale=2.5),
        "wood_dark": _noise_wood("tv_wood_dark", (0.16, 0.10, 0.06), (0.26, 0.16, 0.09), scale=3.5),
        "shell":     _noise_plastic("tv_shell", (0.10, 0.095, 0.09), rough=0.6),   # 深灰塑料壳
        "bezel":     _noise_plastic("tv_bezel", (0.06, 0.06, 0.055), rough=0.5),
        "screen":    _plain("tv_screen", (0.015, 0.017, 0.02), rough=0.30),       # 纯深灰近黑, M6 换 CanvasTexture
        "knob":      _noise_plastic("tv_knob", (0.22, 0.20, 0.18), rough=0.45, bump=0.15),
        "dark":      _plain("tv_dark", (0.03, 0.03, 0.03), rough=0.9),            # 喇叭孔
        "gold":      _plain("tv_gold", (0.62, 0.48, 0.20), rough=0.32, metallic=0.9),  # 空白金框铭牌
        "cloth":     _plain("tv_cloth", (0.95, 0.94, 0.90), rough=0.9, alpha=0.85),    # 蕾丝罩(微透)
        "metal":     _plain("tv_metal", (0.55, 0.56, 0.58), rough=0.35, metallic=0.8),  # 天线
        "ground":    common.principled("tv_ground_tmp", (0.32, 0.33, 0.34), 0.95),
    }

    # ---------- 落地木座 0.6×0.45×0.62 (旧木桌, 四脚接地) ----------
    leg_xy = [(CX - 0.275, CY - 0.20), (CX + 0.275, CY - 0.20),
              (CX - 0.275, CY + 0.20), (CX + 0.275, CY + 0.20)]
    for i, (lx, ly) in enumerate(leg_xy, 1):
        common.box(f"prop_tv_leg_{i}", (lx, ly, 0.29), (0.05, 0.05, 0.58), M['wood_old'])
    # 侧/后围裙板
    common.box("prop_tv_apron_l", (CX - 0.2625, CY, 0.545), (0.025, 0.35, 0.07), M['wood_old'])
    common.box("prop_tv_apron_r", (CX + 0.2625, CY, 0.545), (0.025, 0.35, 0.07), M['wood_old'])
    common.box("prop_tv_apron_b", (CX, CY + 0.19375, 0.545), (0.50, 0.0125, 0.07), M['wood_old'])
    # 抽屉(前板 + 屉身) + 圆把手
    common.box("prop_tv_drawer", (CX, CY - 0.16, 0.525), (0.36, 0.28, 0.13), M['wood_old'])
    common.box("prop_tv_drawer_front", (CX, CY - 0.2285, 0.525), (0.40, 0.015, 0.15), M['wood_dark'])
    knob = _cyl_x("prop_tv_drawer_knob", (CX, CY - 0.245, 0.525), 0.011, 0.018, M['wood_old'], vertices=16)
    knob.rotation_euler = (math.pi / 2, 0, 0)   # 轴沿 Y 朝前
    _apply(knob, rot=True)
    # 桌面
    common.box("prop_tv_stand_top", (CX, CY, 0.60), (0.60, 0.45, 0.04), M['wood_old'])

    STAND_TOP = 0.62

    # ---------- CRT 主机 0.56×0.42×0.44, 壳底贴桌面 ----------
    BW, BD, BH = 0.56, 0.42, 0.44
    BZ0 = STAND_TOP                      # 0.62
    BZC = BZ0 + BH / 2                   # 0.84
    common.box("prop_tv_body", (CX, CY, BZC), (BW, BD, BH), M['shell'])
    FRONT_Y = CY - BD / 2                # 1.29
    RIGHT_X = CX + BW / 2                # 0.28

    # 前脸 bezel 框板
    common.box("prop_tv_bezel", (CX, FRONT_Y + 0.005, BZC + 0.02), (0.50, 0.02, 0.36), M['bezel'])

    # 屏幕: 4:3 微凸球冠, 独立 mesh (M6 CanvasTexture)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=(CX, FRONT_Y - 0.02, BZC + 0.03))
    screen = bpy.context.object
    screen.name = "prop_tv_screen"
    screen.scale = (0.185, 0.032, 0.139)   # 4:3, 前凸 ~0.017
    _apply(screen)
    _smooth(screen)
    screen.data.materials.append(M['screen'])

    # 空白金框铭牌 (无文字)
    common.box("prop_tv_plate", (CX + 0.16, FRONT_Y - 0.002, BZ0 + 0.075), (0.13, 0.006, 0.05), M['gold'])

    # ---------- 右侧面板: 频道/音量旋钮 (origin 在轴心, M6 旋转) ----------
    for name, z in (("prop_tv_knob_channel", BZC + 0.10), ("prop_tv_knob_volume", BZC - 0.02)):
        k = _cyl_x(name, (RIGHT_X + 0.006, CY - 0.06, z), 0.024, 0.02, M['knob'], vertices=24)
        _smooth(k)
        cap = _cyl_x(name + "_cap", (RIGHT_X + 0.018, CY - 0.06, z), 0.016, 0.006, M['knob'], vertices=20)
        common.join([k, cap], name)   # join 后 origin = 主体圆柱轴心 (对齐世界 X 轴)

    # 2×2 喇叭孔 (凹 cylinder, 合并为一个 mesh)
    holes = []
    for dy in (0.06, 0.14):
        for dz in (0.045, 0.095):
            holes.append(_cyl_x("_sp", (RIGHT_X + 0.001, CY + dy, BZ0 + dz), 0.009, 0.006, M['dark'], vertices=12))
    common.join(holes, "prop_tv_speakers")

    # ---------- 背面显像管尾巴 (锥形, 壳内为主只露一点) ----------
    bpy.ops.mesh.primitive_cone_add(radius1=0.10, radius2=0.035, depth=0.14,
                                    vertices=20, location=(CX, CY + BD / 2 - 0.03, BZC))
    tail = bpy.context.object
    tail.name = "prop_tv_tail"
    _apply(tail)
    _smooth(tail)
    tail.data.materials.append(M['shell'])

    # ---------- 顶部蕾丝布罩: 薄顶板 + 4 垂边 (下垂 0.06, 微透) ----------
    CT = BZ0 + BH                          # 机顶 1.06
    TH = 0.008                             # 布厚
    cw, cd = 0.585, 0.445
    cloth_parts = [
        common.box("_ct", (CX, CY, CT + TH / 2), (cw, cd, TH), M['cloth']),
        common.box("_cf", (CX, CY - cd / 2 + TH / 2, CT - 0.06 / 2 + TH / 2), (cw, TH, 0.06 + TH), M['cloth']),
        common.box("_cb", (CX, CY + cd / 2 - TH / 2, CT - 0.06 / 2 + TH / 2), (cw, TH, 0.06 + TH), M['cloth']),
        common.box("_cl", (CX - cw / 2 + TH / 2, CY, CT - 0.06 / 2 + TH / 2), (TH, cd - 2 * TH, 0.06 + TH), M['cloth']),
        common.box("_cr", (CX + cw / 2 - TH / 2, CY, CT - 0.06 / 2 + TH / 2), (TH, cd - 2 * TH, 0.06 + TH), M['cloth']),
    ]
    common.join(cloth_parts, "prop_tv_cloth")

    # ---------- 室内兔耳天线 (V 形双杆 + 球头, 合并) ----------
    base_z = CT + TH + 0.006              # 布罩顶
    parts = [common.cylinder("tv_ant_base", (CX, CY, base_z), 0.018, 0.014, M['metal'], vertices=16)]
    for i, sgn in enumerate((-1, 1), 1):
        ang = math.radians(22) * sgn
        L = 0.30
        d = Vector((math.sin(ang) * L / 2, 0, math.cos(ang) * L / 2))
        rod = common.cylinder(f"tv_ant_rod_{i}", Vector((CX, CY, base_z + 0.008)) + d, 0.0035, L, M['metal'], vertices=10)
        rod.rotation_euler = (0, -ang, 0)
        _apply(rod, rot=True)
        tip = common.uv_sphere(f"tv_ant_tip_{i}", Vector((CX, CY, base_z + 0.008)) + d * 2, 0.008, M['metal'], segments=12, rings=6)
        parts += [rod, tip]
    common.join(parts, "prop_tv_antenna")

    # ---------- 临时地面 (评审用, 不进 GLB) ----------
    common.plane("_tv_ground", (0, 0, 0), 8.0, M['ground'])

    # ---------- 灯光: 临时暖光 + 冷环境 ----------
    env['add_light']('POINT', (1.0, 0.5, 2.0), energy=160,
                     color=(1.0, 0.74, 0.48), shadow_soft_size=0.10)
    env['add_light']('POINT', (-1.2, 0.2, 1.4), energy=40,
                     color=(0.55, 0.65, 0.85), shadow_soft_size=0.15)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.13, 0.14, 0.17, 1.0)
    bg.inputs[1].default_value = 0.5
    sc.world = world

    # ---------- 相机: 45° 侧前上方, 看屏幕 + 右侧面板 ----------
    cam = env['add_camera']((2.20, -0.10, 1.75), (CX, CY - 0.05, 0.72), lens=32)

    # ---------- 评审静帧 960×540 ----------
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 960
    sc.render.resolution_y = 540
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(env['OUT'], "prop_tv.png")
    bpy.ops.render.render(write_still=True)
    print("[render]", sc.render.filepath)

    # ---------- 导出 GLB: 仅 prop_tv_* 网格, 世界坐标 ----------
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith("prop_tv_")]
    glb_path = os.path.join(ROOT, "assets", "scene", "v0001", "props", "tv.glb")
    common.export_glb(glb_path, objects=meshes)
    common.tris_report(meshes, label="prop_tv.glb")
