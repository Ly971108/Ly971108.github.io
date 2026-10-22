# tools/blender/prop_audio.py — M4 道具 wave2: 双卡收录机 + 蚊香（同一 GLB）
# 收录机: 条几 (-1.25,1.50) 顶 0.55, 正面朝 -Y;  蚊香: 课桌 (-0.55,-0.28) 面 0.76
# 动画节点(M6): prop_radio_reel_l / prop_radio_knob_volume / prop_radio_knob_tune
#              / prop_radio_vu / prop_radio_button_play / prop_mosq_ember
# 入口: blender -b -P tools/blender/main.py -- prop_audio
import bpy
import os
import math
from mathutils import Vector
import common

CX, CY = -1.25, 1.50          # 条几中心
BZ0 = 0.55 + 0.012            # 机身底(小脚高 0.012)
DESK_TOP = 0.76
COIL_X, COIL_Y = -0.55, -0.28


# ---------------- 局部材质 helper（不改 common.py） ----------------

def _plain(name, color, rough=0.5, metallic=0.0, alpha=1.0, emission=None, emission_strength=0.0):
    m = common.principled(name, color, roughness=rough, metallic=metallic,
                          emission=emission, emission_strength=emission_strength)
    if alpha < 1.0:
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = 'DITHERED'
        except Exception:
            m.blend_method = 'BLEND'
    return m


def _plastic(name, color, rough=0.55, bump=0.06):
    """细噪声凹凸塑料。"""
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


# ---------------- 网格 helper ----------------

def _apply(ob, rot=False):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=False, rotation=rot, scale=True)


def _smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True


def _box_mesh(name, verts, faces, mat):
    me = bpy.data.meshes.new(name + "_mesh")
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if mat:
        ob.data.materials.append(mat)
    return ob


def _unit_box_faces():
    return [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
            (1, 5, 6, 2), (2, 6, 7, 3), (4, 0, 3, 7)]


def _needle(name, pivot, length, width, thick, mat):
    """指针 mesh, 局部 origin=针尾轴心, 沿 +Z 指。M6 绕局部 Y 摆动。"""
    w, t, L = width / 2, thick / 2, length
    verts = [(-w, -t, 0), (w, -t, 0), (w, t, 0), (-w, t, 0),
             (-w, -t, L), (w, -t, L), (w, t, L), (-w, t, L)]
    ob = _box_mesh(name, verts, _unit_box_faces(), mat)
    ob.location = pivot
    return ob


def _knob(name, x, y, z, radius, depth, mat):
    """轴沿 Y 的旋钮, join 后 origin=轴心。"""
    k = common.cylinder(name + "_body", (x, y, z), radius, depth, mat, vertices=20)
    k.rotation_euler.x = math.pi / 2
    _apply(k, rot=True)
    cap = common.cylinder(name + "_cap", (x, y - depth / 2 - 0.002, z),
                          radius * 0.55, 0.005, mat, vertices=16)
    cap.rotation_euler.x = math.pi / 2
    _apply(cap, rot=True)
    common.join([k, cap], name)


def _reel(name, x, y, z, mat):
    """卷带轮: 轮毂圆柱 + 3 根直径辐条, origin=轴心。轴沿 Y。"""
    parts = []
    hub = common.cylinder(name + "_hub", (x, y, z), 0.023, 0.005, mat, vertices=20)
    hub.rotation_euler.x = math.pi / 2
    _apply(hub, rot=True)
    parts.append(hub)
    ring = common.cylinder(name + "_rim", (x, y, z), 0.023, 0.0035, mat, vertices=20)
    ring.rotation_euler.x = math.pi / 2
    _apply(ring, rot=True)
    parts.append(ring)
    for i in range(3):
        sp = common.box(f"{name}_spoke_{i}", (x, y, z), (0.040, 0.004, 0.0032), mat)
        sp.rotation_euler.y = math.radians(60 * i)
        parts.append(sp)
    common.join(parts, name)


# ---------------- build ----------------

def build(env):
    env['clean']()
    sc = bpy.context.scene
    ROOT = env['ROOT']

    # ===== 材质 =====
    M = {
        "shell":    _plastic("radio_shell", (0.085, 0.082, 0.078), rough=0.62),      # 深灰黑塑料壳
        "panel":    _plastic("radio_panel", (0.042, 0.042, 0.040), rough=0.5),      # 前脸近黑
        "well":     _plain("radio_well", (0.025, 0.024, 0.022), rough=0.9),         # 卡仓暗腔
        "door":     _plain("radio_door_tea", (0.26, 0.15, 0.07), rough=0.35, alpha=0.45),  # 茶色透明仓门
        "reel":     _plain("radio_reel", (0.62, 0.60, 0.56), rough=0.5),            # 卷带轮浅灰
        "dial_bg":  _plain("radio_dial_bg", (0.93, 0.90, 0.80), rough=0.85),        # 刻度窗白底
        "tick":     _plain("radio_tick", (0.10, 0.10, 0.09), rough=0.8),            # 刻度线
        "red":      _plain("radio_red", (0.72, 0.07, 0.05), rough=0.5),             # 指针/录音键
        "knob":     _plastic("radio_knob", (0.20, 0.19, 0.18), rough=0.45, bump=0.12),
        "btn":      _plastic("radio_btn", (0.55, 0.54, 0.52), rough=0.5),           # 大按钮
        "vu_bg":    _plain("radio_vu_bg", (0.95, 0.93, 0.85), rough=0.85),          # Vu 白底
        "tin":      _plain("mosq_tin_blue", (0.10, 0.18, 0.36), rough=0.45, metallic=0.45),  # 蓝漆铁皮
        "coil":     _plain("mosq_coil", (0.37, 0.44, 0.31), rough=0.9),             # 灰绿香体
        "ember":    _plain("mosq_ember", (0.45, 0.06, 0.02), rough=0.6,
                            emission=(1.0, 0.22, 0.04), emission_strength=2.5),      # 暗红燃点
        "ground":   common.principled("audio_ground_tmp", (0.32, 0.33, 0.34), 0.95),
    }

    # ================= 1. 双卡收录机 0.62 x 0.28 x 0.34 =================
    # ---- 机身主壳 + 微弧顶 ----
    common.box("prop_radio_body", (CX, CY, BZ0 + 0.15), (0.62, 0.28, 0.30), M['shell'])
    bpy.ops.mesh.primitive_cylinder_add(radius=0.14, depth=0.60, vertices=32,
                                        location=(CX, CY, BZ0 + 0.30))
    arch = bpy.context.object
    arch.name = "prop_radio_body_top"
    arch.scale.z = 0.20
    _apply(arch)
    arch.rotation_euler.y = math.pi / 2
    _apply(arch, rot=True)
    _smooth(arch)
    arch.data.materials.append(M['shell'])
    TOP_Z = BZ0 + 0.30 + 0.14 * 0.20      # ≈0.890

    # ---- 前脸面板 ----
    FY = CY - 0.14                          # 1.36 机身正面
    PY = FY - 0.006                         # 面板中心 y
    common.box("prop_radio_panel", (CX, PY, BZ0 + 0.145), (0.585, 0.014, 0.29), M['panel'])
    PF = PY - 0.007                         # 面板正面 y ≈1.347

    # ---- 双卡仓: 暗腔 + 茶色透明门 + 边框 + 卷带轮 ----
    for side, dx in (("l", -0.205), ("r", 0.205)):
        dxw = CX + dx
        common.box(f"prop_radio_well_{side}", (dxw, PY + 0.002, BZ0 + 0.15),
                   (0.155, 0.012, 0.185), M['well'])
        # 卷带轮 x2 (左轮独立命名)
        _reel(f"prop_radio_reel_{side}_a" if side == "r" else "prop_radio_reel_l",
              dxw - 0.033, PF + 0.002, BZ0 + 0.15, M['reel'])
        if side == "r":
            _reel("prop_radio_reel_r_b", dxw + 0.033, PF + 0.002, BZ0 + 0.15, M['reel'])
        else:
            _reel("prop_radio_reel_l_b", dxw + 0.033, PF + 0.002, BZ0 + 0.15, M['reel'])
        # 门框: 4 细条
        fw, fh = 0.170, 0.200
        ft = 0.006
        fr = [
            common.box(f"_fr_{side}_t", (dxw, PF + 0.004, BZ0 + 0.15 + fh / 2), (fw, 0.006, ft), M['panel']),
            common.box(f"_fr_{side}_b", (dxw, PF + 0.004, BZ0 + 0.15 - fh / 2), (fw, 0.006, ft), M['panel']),
            common.box(f"_fr_{side}_l", (dxw - fw / 2, PF + 0.004, BZ0 + 0.15), (ft, 0.006, fh), M['panel']),
            common.box(f"_fr_{side}_r", (dxw + fw / 2, PF + 0.004, BZ0 + 0.15), (ft, 0.006, fh), M['panel']),
        ]
        common.join(fr, f"prop_radio_doorframe_{side}")
        # 透明茶色门板
        common.box(f"prop_radio_door_{side}", (dxw, PF - 0.002, BZ0 + 0.15),
                   (fw - 0.004, 0.005, fh - 0.004), M['door'])

    # ---- 中部: 调频刻度窗 (白底 + 红针 + 上下刻度线, 无数字) ----
    DZ = BZ0 + 0.26                         # 窗中心 z
    common.box("prop_radio_dial", (CX, PF + 0.002, DZ), (0.20, 0.006, 0.032), M['dial_bg'])
    # 上下两排刻度线 (12+12 小矩形)
    ticks = []
    for row, dz in (("t", DZ + 0.011), ("b", DZ - 0.011)):
        for i in range(12):
            tx = CX - 0.088 + i * (0.176 / 11)
            ticks.append(common.box(f"_tick_{row}_{i}", (tx, PF - 0.002, dz),
                                    (0.0035, 0.0025, 0.0055), M['tick']))
    common.join(ticks, "prop_radio_dial_ticks")
    # 红色指针线
    pointer = common.box("prop_radio_dial_pointer", (CX + 0.03, PF - 0.003, DZ),
                         (0.0025, 0.002, 0.024), M['red'])

    # ---- 旋钮 x2 (origin 轴心) ----
    _knob("prop_radio_knob_volume", CX - 0.045, PF - 0.004, BZ0 + 0.175, 0.017, 0.016, M['knob'])
    _knob("prop_radio_knob_tune",   CX + 0.045, PF - 0.004, BZ0 + 0.175, 0.017, 0.016, M['knob'])

    # ---- Vu 表窗 (右): 白底 + 红针(origin 针尾) + 3 刻度 ----
    VX = CX + 0.055
    VZ = BZ0 + 0.095
    common.box("prop_radio_vu_window", (VX, PF + 0.002, VZ), (0.075, 0.006, 0.052), M['vu_bg'])
    vu_ticks = []
    for i, a in enumerate((-28, 0, 28)):
        t = common.box(f"_vt_{i}", (VX, PF - 0.002, VZ + 0.014), (0.0022, 0.002, 0.011), M['tick'])
        t.rotation_euler.y = math.radians(-a)
        vu_ticks.append(t)
    common.join(vu_ticks, "prop_radio_vu_ticks")
    vu = _needle("prop_radio_vu", (VX, PF - 0.0035, VZ - 0.020), 0.034, 0.0035, 0.002, M['red'])
    vu.rotation_euler.y = math.radians(20)

    # ---- 正面大按钮一排 (播放键独立) ----
    BTNZ = BZ0 + 0.05
    play = common.box("prop_radio_button_play", (CX - 0.093, PF - 0.003, BTNZ),
                      (0.024, 0.012, 0.032), M['btn'])
    others = []
    for i, bx in enumerate((-0.065, -0.046, -0.027, -0.008)):
        m = M['red'] if i == 1 else M['btn']      # 第2枚=录音(红)
        others.append(common.box(f"_btn_{i}", (CX + bx, PF - 0.003, BTNZ),
                                 (0.016, 0.012, 0.032), m))
    common.join(others, "prop_radio_buttons_aux")

    # ---- 底部四小脚 ----
    feet = []
    for i, (fx, fy) in enumerate(((-0.26, -0.09), (0.26, -0.09), (-0.26, 0.09), (0.26, 0.09))):
        feet.append(common.cylinder(f"_foot_{i}", (CX + fx, CY + fy, 0.55 + 0.006),
                                    0.012, 0.012, M['panel'], vertices=10))
    common.join(feet, "prop_radio_feet")

    # ---- 顶部提手 (U 形细杆) ----
    hp = []
    for i, sx in enumerate((-0.19, 0.19)):
        hp.append(common.cylinder(f"_hp_{i}", (CX + sx, CY, TOP_Z + 0.028),
                                  0.006, 0.056, M['shell'], vertices=10))
    grip = common.cylinder("_hg", (CX, CY, TOP_Z + 0.058), 0.006, 0.41, M['shell'], vertices=10)
    grip.rotation_euler.y = math.pi / 2
    _apply(grip, rot=True)
    hp.append(grip)
    common.join(hp, "prop_radio_handle")

    # ================= 2. 蚊香 (课桌面) =================
    DISH_Z = DESK_TOP                       # 浅盘底
    # 浅盘: 斜壁圆碟 r0.07 h0.012
    bpy.ops.mesh.primitive_cone_add(radius1=0.062, radius2=0.070, depth=0.012,
                                    vertices=32, location=(COIL_X, COIL_Y, DISH_Z + 0.006))
    dish = bpy.context.object
    dish.name = "prop_mosq_dish"
    _apply(dish)
    _smooth(dish)
    dish.data.materials.append(M['tin'])
    # 盘口沿
    bpy.ops.mesh.primitive_torus_add(major_segments=24, minor_segments=6,
                                     major_radius=0.069, minor_radius=0.0022,
                                     location=(COIL_X, COIL_Y, DISH_Z + 0.011))
    rim = bpy.context.object
    rim.name = "prop_mosq_dish_rim"
    _apply(rim)
    _smooth(rim)
    rim.data.materials.append(M['tin'])
    # 中心尖刺 (穿香中心孔)
    bpy.ops.mesh.primitive_cone_add(radius1=0.0045, radius2=0.0, depth=0.016,
                                    vertices=10, location=(COIL_X, COIL_Y, DISH_Z + 0.012))
    spike = bpy.context.object
    spike.name = "prop_mosq_spike"
    _apply(spike)
    spike.data.materials.append(M['tin'])

    # ---- 盘香: 阿基米德螺线 curve bevel 0.004, 灰绿 ----
    COIL_Z = DISH_Z + 0.016                 # 香体中心高
    r_in, r_out = 0.007, 0.0535             # 外径含管径 ≈0.115
    turns = 3.25
    N = 160
    cu = bpy.data.curves.new("prop_mosq_coil_curve", 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 0.004
    cu.bevel_resolution = 1
    cu.resolution_u = 1
    sp = cu.splines.new('POLY')
    sp.points.add(N - 1)
    for i in range(N):
        th = 2 * math.pi * turns * i / (N - 1)
        r = r_in + (r_out - r_in) * i / (N - 1)
        sp.points[i].co = (r * math.cos(th), r * math.sin(th), 0.0, 1.0)
    cu.materials.append(M['coil'])
    coil = bpy.data.objects.new("prop_mosq_coil", cu)
    bpy.context.collection.objects.link(coil)
    coil.location = (COIL_X, COIL_Y, COIL_Z)
    bpy.ops.object.select_all(action='DESELECT')
    coil.select_set(True)
    bpy.context.view_layer.objects.active = coil
    bpy.ops.object.convert(target='MESH')
    coil = bpy.context.object
    coil.name = "prop_mosq_coil"

    # ---- 香头燃点: 外端头小球 (M6 脉动发光) ----
    th_end = 2 * math.pi * turns
    ex = COIL_X + r_out * math.cos(th_end)
    ey = COIL_Y + r_out * math.sin(th_end)
    ember = common.uv_sphere("prop_mosq_ember", (ex, ey, COIL_Z + 0.002), 0.003,
                             M['ember'], segments=12, rings=6)

    # ================= 3. 临时地面 / 灯光 / 相机 =================
    common.plane("_audio_ground", (0, 0, 0), 8.0, M['ground'])

    env['add_light']('POINT', (-0.5, -0.4, 1.9), energy=120,
                     color=(1.0, 0.74, 0.48), shadow_soft_size=0.10)
    env['add_light']('POINT', (-1.9, 0.6, 1.3), energy=40,
                     color=(0.55, 0.65, 0.9), shadow_soft_size=0.18)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.13, 0.14, 0.17, 1.0)
    bg.inputs[1].default_value = 0.55
    sc.world = world

    # 相机: 略俯视, 收录机为主, 蚊香前景右下
    cam = env['add_camera']((-0.52, -1.10, 1.22), (-1.08, 0.66, 0.64), lens=44)

    # ================= 4. 渲染 960x540 =================
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 960
    sc.render.resolution_y = 540
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(env['OUT'], "prop_audio.png")
    bpy.ops.render.render(write_still=True)
    print("[render]", sc.render.filepath)

    # ================= 5. 导出 GLB (prop_radio_* + prop_mosq_*) =================
    meshes = [o for o in bpy.data.objects if o.type == 'MESH'
              and (o.name.startswith("prop_radio_") or o.name.startswith("prop_mosq_"))]
    glb_path = os.path.join(ROOT, "assets", "scene", "v0001", "props", "audio.glb")
    common.export_glb(glb_path, objects=meshes)
    common.tris_report(meshes, label="audio.glb")
