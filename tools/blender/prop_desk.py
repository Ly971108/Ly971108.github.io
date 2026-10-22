# tools/blender/prop_desk.py — M3 道具：农村旧课桌套装
# 课桌0.95x0.55x0.76 + 方凳 + 摊开田字格作业本 + 搪瓷缸 + 铅笔
# 入口: blender -b -P tools/blender/main.py -- prop_desk
import bpy
import os
import math
from mathutils import Vector
import common

DESK_C = (-0.75, -0.35)          # 与 room_shell 的 desk_stub 一致
DESK_TOP = 0.76                  # 桌面高

# ---------------- 程序化材质（局部 helper，不改动 common.py） ----------------

def wood_mat():
    """旧木头：Wave 扭曲条纹 + Noise 扰动 + Bump，棕色调旧。"""
    m = bpy.data.materials.new("prop_wood_old")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 0.68
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'X'
    wave.inputs["Scale"].default_value = 9.0
    wave.inputs["Distortion"].default_value = 1.5
    wave.inputs["Detail"].default_value = 3.0
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = '3D'
    noise.inputs["Scale"].default_value = 2.4
    noise.inputs["Detail"].default_value = 5.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.20, 0.115, 0.055, 1)
    ramp.color_ramp.elements[1].color = (0.36, 0.225, 0.105, 1)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.20
    bump.inputs["Distance"].default_value = 0.02
    nt.links.new(tc.outputs["Generated"], wave.inputs["Vector"])
    nt.links.new(tc.outputs["Generated"], noise.inputs["Vector"])
    nt.links.new(wave.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    nt.links.new(bs.outputs[0], out.inputs[0])
    return m


def grid_paper_mat():
    """田字格纸：米白纸底 + Wave x2 旋转90°叠加出蓝绿细线网格。"""
    m = bpy.data.materials.new("prop_notebook_grid")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 0.92
    tc = nt.nodes.new("ShaderNodeTexCoord")
    paper = (0.94, 0.92, 0.83, 1)
    line = (0.16, 0.46, 0.46, 1)
    waves = []
    for direction in ('X', 'Y'):
        w = nt.nodes.new("ShaderNodeTexWave")
        w.wave_type = 'BANDS'
        w.bands_direction = direction
        w.inputs["Scale"].default_value = 9.0
        w.inputs["Distortion"].default_value = 0.0
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.interpolation = 'CONSTANT'
        ramp.color_ramp.elements[0].position = 0.06
        ramp.color_ramp.elements[0].color = line
        e1 = ramp.color_ramp.elements[1]
        e1.position = 0.13
        e1.color = paper
        e2 = ramp.color_ramp.elements.new(1.0)
        e2.color = line
        nt.links.new(tc.outputs["Generated"], w.inputs["Vector"])
        nt.links.new(w.outputs["Fac"], ramp.inputs["Fac"])
        waves.append(ramp)
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = 'MULTIPLY'
    mix.inputs["Fac"].default_value = 1.0
    nt.links.new(waves[0].outputs["Color"], mix.inputs[1])
    nt.links.new(waves[1].outputs["Color"], mix.inputs[2])
    nt.links.new(mix.outputs["Color"], bs.inputs["Base Color"])
    nt.links.new(bs.outputs[0], out.inputs[0])
    return m


def enamel_mat(name, color, rough=0.22):
    m = common.principled(name, color, roughness=rough)
    bs = m.node_tree.nodes.get("Principled BSDF")
    coat = bs.inputs.get("Coat Weight")
    if coat is not None:
        coat.default_value = 0.25
    return m


# ---------------- 网格 helper ----------------

def splayed_leg(name, top, L, ang_deg, thick, mat, pivot):
    """单条外八腿：bottom 精确落地 z=0，top 接桌面下沿。scale 已应用。"""
    dvec = Vector((top[0] - pivot[0], top[1] - pivot[1], 0.0))
    horiz = dvec.normalized() if dvec.length > 1e-6 else Vector((0, 0, 0))
    a = math.radians(ang_deg)
    d = Vector((horiz.x * math.tan(a), horiz.y * math.tan(a), 1.0)).normalized()
    top_v = Vector((top[0], top[1], top[2]))
    L = top_v.z / d.z                      # 使 bottom.z = 0
    bot_v = top_v - d * L
    mid = (top_v + bot_v) * 0.5
    ob = common.box(name, mid, (thick, thick, L), mat)
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return ob


def bent_page(name, L, W, arch, mat):
    """低分段平面沿 x 拱起（~5°），origin 在书脊(局部x=0)，供 M6 绕书脊翻页。"""
    nx, ny = 14, 6
    verts = []
    for j in range(ny + 1):
        y = -W / 2 + W * j / ny
        for i in range(nx + 1):
            x = L * i / nx
            z = arch * (i / nx) ** 2
            verts.append((x, y, z))
    faces = []
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    me = bpy.data.meshes.new(name + "_mesh")
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    sol = ob.modifiers.new("paper_thin", 'SOLIDIFY')
    sol.thickness = 0.0008
    bev = ob.modifiers.new("soft_edge", 'BEVEL')
    bev.width = 0.0004
    bev.segments = 1
    if mat:
        ob.data.materials.append(mat)
    return ob


def lathe(name, profile, mat, seg=24):
    """绕 Z 旋转成型（搪瓷缸收腰杯身）。profile=[(r,z),...] 自下而上。"""
    verts = []
    n = len(profile)
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ca, sa = math.cos(a), math.sin(a)
        for r, z in profile:
            verts.append((r * ca, r * sa, z))
    faces = []
    for i in range(seg):
        ni = (i + 1) % seg
        for k in range(n - 1):
            a = i * n + k
            b = ni * n + k
            faces.append((a, b, b + 1, a + 1))
    me = bpy.data.meshes.new(name + "_mesh")
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if mat:
        ob.data.materials.append(mat)
    # 统一法线朝外 + 平滑着色
    for p in me.polygons:
        p.use_smooth = True
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)
    return ob


def torus(name, loc, major, minor, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_segments=16, minor_segments=6,
        major_radius=major, minor_radius=minor,
        location=loc, rotation=rotation)
    ob = bpy.context.object
    ob.name = name
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


# ---------------- build ----------------

def build(env):
    env['clean']()
    sc = bpy.context.scene
    ROOT = env['ROOT']
    dx, dy = DESK_C

    # ===== 材质 =====
    Mwood = wood_mat()
    Mpaper = grid_paper_mat()
    Mcream = common.principled("prop_notebook_paper_plain", (0.93, 0.90, 0.80), 0.92)
    Mcover = common.principled("prop_notebook_cover", (0.52, 0.38, 0.24), 0.85)
    Mred = common.principled("prop_notebook_red", (0.72, 0.12, 0.10), 0.7)
    Mwhite = enamel_mat("prop_cup_enamel_white", (0.95, 0.94, 0.90), 0.20)
    Mcupred = enamel_mat("prop_cup_enamel_red", (0.66, 0.09, 0.06), 0.28)
    Miron = common.principled("prop_iron_dark", (0.16, 0.16, 0.17), 0.45, metallic=0.65)
    Mpencil = common.principled("prop_pencil_green", (0.22, 0.38, 0.24), 0.55)
    Mgraphite = common.principled("prop_pencil_graphite", (0.10, 0.10, 0.11), 0.5)
    Mpwood = common.principled("prop_pencil_wood", (0.78, 0.60, 0.34), 0.8)

    # ===== 1. 旧木课桌 0.95 x 0.55 x 0.76 =====
    top = common.box("prop_desk_top", (dx, dy, DESK_TOP - 0.02),
                     (0.95, 0.55, 0.04), Mwood)
    bev = top.modifiers.new("worn_edge", 'BEVEL')
    bev.width = 0.012
    bev.segments = 2

    leg_inset = 0.055
    lx = 0.475 - leg_inset
    ly = 0.275 - leg_inset
    leg_top_z = DESK_TOP - 0.04
    leg_t = 0.05
    for i, (sx, sy) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):
        splayed_leg(f"prop_desk_leg_{i+1}",
                    (dx + sx * lx, dy + sy * ly, leg_top_z),
                    leg_top_z, 3.0, leg_t, Mwood, (dx, dy))

    # 桌腿间横撑（前后各一，旧桌简单结构）
    common.box("prop_desk_stretcher_f", (dx, dy - ly, 0.16),
               (2 * lx + leg_t, 0.04, 0.055), Mwood)
    common.box("prop_desk_stretcher_b", (dx, dy + ly, 0.16),
               (2 * lx + leg_t, 0.04, 0.055), Mwood)

    # 右侧小抽屉（面板 + 屉身 + 铁环把手）
    drawer_c = (dx + 0.245, dy, 0.655)
    common.box("prop_desk_drawer_box", drawer_c, (0.30, 0.42, 0.12), Mwood)
    common.box("prop_desk_drawer_face",
               (dx + 0.245, dy - 0.21 - 0.007, 0.655),
               (0.32, 0.014, 0.13), Mwood)
    # 铁环把手：竖立圆环 + 两枚小支座
    torus("prop_desk_drawer_ring",
          (dx + 0.245, dy - 0.217 - 0.012, 0.655), 0.018, 0.0035, Miron,
          rotation=(math.radians(90), 0, 0))
    for sx in (-0.018, 0.018):
        common.cylinder("prop_desk_drawer_mount", (dx + 0.245 + sx, dy - 0.219, 0.655),
                        0.004, 0.012, Miron, vertices=8).rotation_euler.x = math.radians(90)

    # ===== 2. 方凳 0.34 x 0.34 x 0.45，塞桌下偏右 =====
    sx_c, sy_c = dx + 0.22, dy + 0.02
    common.box("prop_desk_stool_top", (sx_c, sy_c, 0.45 - 0.015),
               (0.34, 0.34, 0.03), Mwood)
    s_inset = 0.035
    for i, (ux, uy) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):
        splayed_leg(f"prop_desk_stool_leg_{i+1}",
                    (sx_c + ux * (0.17 - s_inset), sy_c + uy * (0.17 - s_inset), 0.42),
                    0.42, 5.0, 0.034, Mwood, (sx_c, sy_c))
    common.box("prop_desk_stool_bar_f", (sx_c, sy_c - 0.135, 0.13),
               (0.27, 0.03, 0.04), Mwood)
    common.box("prop_desk_stool_bar_b", (sx_c, sy_c + 0.135, 0.13),
               (0.27, 0.03, 0.04), Mwood)

    # ===== 3. 摊开的田字格作业本（桌面偏左） =====
    spine = (dx - 0.15, dy, DESK_TOP)          # 书脊位置（两页 pivot 原点）
    page_L, page_W, arch = 0.145, 0.190, 0.0125   # arch ≈ 远端抬 sin5°
    cover_L, cover_W, cover_t = page_L + 0.008, page_W + 0.010, 0.0015

    # 封面两页（左封面绕 Z 180°，局部 +x 朝世界 -x）
    covR = common.box("prop_notebook_cover_R",
                      (spine[0] + cover_L / 2, spine[1], spine[2] + cover_t / 2),
                      (cover_L, cover_W, cover_t), Mcover)
    covL = common.box("prop_notebook_cover_L",
                      (-cover_L / 2, 0, cover_t / 2),
                      (cover_L, cover_W, cover_t), Mcover)
    covL.location = (spine[0], spine[1], spine[2])
    covL.rotation_euler.z = math.pi
    # 封面红色几何装饰：矩形框 + 两条横线（无文字）
    # 框压在封面外圈露边，横线躲到上下页边外的封面边条，避免与内页穿插
    deco_z = cover_t + 0.0002
    t = 0.0035
    fw = cover_L - 0.004
    fh = cover_W - 0.004
    # 右封面（直接世界坐标摆放）
    def cover_deco(prefix, cx, rot_z=0.0):
        bar_y = fh / 2 - 0.006
        seg = [
            ((0, fh / 2 - t / 2, 0), (fw, t, 0.0008)),
            ((0, -fh / 2 + t / 2, 0), (fw, t, 0.0008)),
            ((fw / 2 - t / 2, 0, 0), (t, fh - 2 * t, 0.0008)),
            ((-fw / 2 + t / 2, 0, 0), (t, fh - 2 * t, 0.0008)),
            ((0, bar_y, 0), (fw - 0.004, 0.008, 0.0008)),
            ((0, -bar_y, 0), (fw - 0.004, 0.008, 0.0008)),
        ]
        for i, (off, size) in enumerate(seg):
            ob = common.box(f"{prefix}_deco_{i}",
                            (off[0], off[1], deco_z + off[2]), size, Mred)
            # 局部偏移 -> 挂到封面下
            if rot_z:
                c, s = math.cos(rot_z), math.sin(rot_z)
                ox = off[0] * c - off[1] * s
                oy = off[0] * s + off[1] * c
            else:
                ox, oy = off[0], off[1]
            ob.location = (cx[0] + ox, cx[1] + oy, cx[2] + deco_z + off[2])
            if rot_z:
                ob.rotation_euler.z = rot_z
    cover_deco("prop_notebook_coverR", (spine[0] + cover_L / 2, spine[1], spine[2]))
    cover_deco("prop_notebook_coverL", (spine[0] - cover_L / 2, spine[1], spine[2]), rot_z=math.pi)

    # 内页：独立 mesh，origin=书脊（M6 翻页动画绕局部 y 轴/书脊旋转）
    # 抬到封面贴纸上沿之上，避免与封面装饰穿插
    page_base_z = spine[2] + cover_t + 0.0008
    pgL = bent_page("prop_notebook_page_L", page_L, page_W, arch, Mpaper)
    pgL.location = (spine[0], spine[1], page_base_z)
    pgL.rotation_euler.z = math.pi           # 左页伸向世界 -x
    pgR = bent_page("prop_notebook_page_R", page_L, page_W, arch, Mpaper)
    pgR.location = (spine[0], spine[1], page_base_z)

    # 书脊中缝微隆起
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.005, depth=page_W, vertices=12,
        location=(spine[0], spine[1], page_base_z + 0.0020),
        rotation=(math.radians(90), 0, 0))
    ridge = bpy.context.object
    ridge.name = "prop_notebook_spine_ridge"
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ridge.data.materials.append(Mcream)
    for p in ridge.data.polygons:
        p.use_smooth = True

    # ===== 4. 搪瓷缸（桌面偏右，高0.11 直径0.085，微收腰带盖） =====
    cup_c = (dx + 0.28, dy - 0.02)
    cup_base = DESK_TOP
    body = lathe("prop_cup_body",
                 [(0.038, 0.0), (0.0372, 0.025), (0.0395, 0.055),
                  (0.0420, 0.095), (0.0425, 0.110)],
                 Mwhite, seg=24)
    body.location = (cup_c[0], cup_c[1], cup_base)
    # 红色口沿 + 红色中部环形印
    torus("prop_cup_rim_red", (cup_c[0], cup_c[1], cup_base + 0.110),
          0.0415, 0.0022, Mcupred)
    torus("prop_cup_band_red", (cup_c[0], cup_c[1], cup_base + 0.058),
          0.0388, 0.0028, Mcupred)
    # 盖 + 盖钮
    lid = common.cylinder("prop_cup_lid", (cup_c[0], cup_c[1], cup_base + 0.1125),
                          0.0435, 0.009, Mwhite, vertices=24)
    bev_l = lid.modifiers.new("lid_edge", 'BEVEL')
    bev_l.width = 0.003
    bev_l.segments = 2
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.008, segments=16, ring_count=8,
                                         location=(cup_c[0], cup_c[1], cup_base + 0.122))
    knob = bpy.context.object
    knob.name = "prop_cup_lid_knob"
    knob.scale.z = 0.6
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    knob.data.materials.append(Mcupred)

    # ===== 5. 铅笔（斜放本子上方：六棱柱+圆锥笔尖+红漆头） =====
    pz = page_base_z + arch + 0.006        # 骑在本子拱面上方
    pc = (spine[0] - 0.01, spine[1] + 0.01, pz)
    ang_z = math.radians(28)
    dirv = Vector((math.cos(ang_z), math.sin(ang_z), 0))
    body_len, tip_len, cap_len = 0.115, 0.020, 0.008
    c_body = pc
    pencil_body = common.cylinder("prop_pencil_body", c_body, 0.0045, body_len,
                                  Mpencil, vertices=6)
    pencil_body.rotation_euler = (math.radians(90), 0, ang_z + math.radians(90))
    # 圆锥木笔尖
    bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.0045, radius2=0.0,
                                    depth=tip_len,
                                    location=Vector(pc) + dirv * (body_len / 2 + tip_len / 2))
    tip = bpy.context.object
    tip.name = "prop_pencil_tip"
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    tip.data.materials.append(Mpwood)
    tip.rotation_euler = (math.radians(90), 0, ang_z + math.radians(90))
    # 石墨尖
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.0016, radius2=0.0,
                                    depth=0.005,
                                    location=Vector(pc) + dirv * (body_len / 2 + tip_len + 0.0015))
    lead = bpy.context.object
    lead.name = "prop_pencil_lead"
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    lead.data.materials.append(Mgraphite)
    lead.rotation_euler = (math.radians(90), 0, ang_z + math.radians(90))
    # 红漆头
    cap = common.cylinder("prop_pencil_end_red",
                          Vector(pc) - dirv * (body_len / 2 + cap_len / 2),
                          0.0045, cap_len, Mcupred, vertices=6)
    cap.rotation_euler = (math.radians(90), 0, ang_z + math.radians(90))

    # ===== 灯光：临时暖光（M4 统一打光时删除） =====
    env['add_light']('POINT', (dx, dy - 0.2, 1.85), energy=80,
                     color=(1.0, 0.74, 0.48), shadow_soft_size=0.12)
    env['add_light']('POINT', (dx + 0.9, dy - 0.9, 1.4), energy=18,
                     color=(0.55, 0.68, 1.0), shadow_soft_size=0.2)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.13, 0.14, 0.17, 1.0)
    bg.inputs[1].default_value = 0.55
    sc.world = world

    # ===== 相机：人视高 40° 俯角看桌面，突出本子 =====
    cam = env['add_camera']((dx + 0.06, dy - 1.12, 1.62),
                            (spine[0] + 0.04, dy, spine[2] + 0.01), lens=36)

    # ===== 渲染 960x540 =====
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 960
    sc.render.resolution_y = 540
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(env['OUT'], "prop_desk.png")
    bpy.ops.render.render(write_still=True)
    print("[render]", sc.render.filepath)

    # ===== GLB 导出（仅道具 mesh，世界变换保留在节点上，直接叠加） =====
    meshes = [o for o in bpy.data.objects
              if o.type == 'MESH' and o.name.startswith("prop_")]
    glb_path = os.path.join(ROOT, "assets", "scene", "v0001", "props", "desk.glb")
    common.export_glb(glb_path, objects=meshes)
    common.tris_report(meshes, label="desk.glb")
