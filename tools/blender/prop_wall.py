# tools/blender/prop_wall.py — M4 道具 wave2 墙面组: 奖状墙 + 挂历 (后墙 y=1.75 内侧)
# 命名: prop_award_* / prop_calendar_*; M6 动画节点: prop_calendar_page (origin=顶部卷轴轴线, 绕局部 X 翻页)
# 无文字: 奖状 = 红漆纸框 + 金细线内框 + 底部红横条; 挂历 = 顶部红区(M5 印字) + 红/金几何块山水年画暗示
import bpy
import os
import math
from mathutils import Vector
import common

WALL_Y = 1.75          # 后墙内侧面


# ---------------- 材质 (全程序化, 无贴图) ----------------

def _paper(name, c_dark, c_light, rough=0.9):
    """纸: 低频噪声微调色。"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = rough
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 6.0
    tex.inputs["Detail"].default_value = 2.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*c_dark, 1.0)
    ramp.color_ramp.elements[1].color = (*c_light, 1.0)
    nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def _plain(name, color, rough=0.6, metallic=0.0):
    return common.principled(name, color, roughness=rough, metallic=metallic)


def _wood(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.7
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 3.0
    tex.inputs["Detail"].default_value = 3.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.30, 0.19, 0.10, 1.0)
    ramp.color_ramp.elements[1].color = (0.47, 0.31, 0.17, 1.0)
    nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    return m


# ---------------- 网格 helpers ----------------

def _apply_rot(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def _box_rot(name, loc, size, mat, ry=0.0):
    ob = common.box(name, loc, size, mat)
    if ry:
        ob.rotation_euler = (0, ry, 0)
        _apply_rot(ob)
    return ob


def _sheet(name, w, h, nx, nz, bend_frac, bend_deg, bend_sign, mat, thickness):
    """墙面竖直薄页网格(中心原点): x∈[-w/2,w/2], z∈[-h/2,h/2]。
    bend_frac: 自底向上弯折区比例; bend_deg: 弯折角; bend_sign: +1 向墙(+Y), -1 向室内(-Y)。"""
    ang = math.radians(bend_deg)
    zb = -h / 2 + bend_frac * h
    verts = []
    for j in range(nz + 1):
        z0 = -h / 2 + h * j / nz
        if bend_deg and z0 < zb - 1e-9:
            d = zb - z0
            y = bend_sign * math.sin(ang) * d
            z = zb - math.cos(ang) * d
        else:
            y, z = 0.0, z0
        for i in range(nx + 1):
            verts.append((-w / 2 + w * i / nx, y, z))
    faces = []
    for j in range(nz):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + (nx + 1) + 1, a + (nx + 1)))
    me = bpy.data.meshes.new(name + "_me")
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    sol = ob.modifiers.new("solidify", "SOLIDIFY")
    sol.thickness = thickness
    sol.offset = 0.0
    return ob


def _page_mesh(name, w, h, nx, nz, curl_frac, curl_deg, mat, thickness):
    """挂历页(顶部原点, 顶部边在局部 z=0, 向下挂至 -h)。底部 curl_frac 比例向后(+Y, 向墙)弯 curl_deg。"""
    ang = math.radians(curl_deg)
    ub = h - curl_frac * h          # 自顶向下弯折线
    verts = []
    for j in range(nz + 1):
        u = h * j / nz              # 自顶向下距离
        z0 = -u
        if curl_deg and u > ub + 1e-9:
            d = u - ub
            y = math.sin(ang) * d
            z = -ub - math.cos(ang) * d
        else:
            y, z = 0.0, z0
        for i in range(nx + 1):
            verts.append((-w / 2 + w * i / nx, y, z))
    faces = []
    for j in range(nz):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + (nx + 1) + 1, a + (nx + 1)))
    me = bpy.data.meshes.new(name + "_me")
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    sol = ob.modifiers.new("solidify", "SOLIDIFY")
    sol.thickness = thickness
    sol.offset = 0.0
    return ob


def _cyl_y(name, loc, radius, depth, mat, vertices=20):
    """轴沿 Y 的圆柱 (圆盘/钉子, 面朝 ±Y)。"""
    ob = common.cylinder(name, loc, radius, depth, mat, vertices=vertices)
    ob.rotation_euler = (math.pi / 2, 0, 0)
    _apply_rot(ob)
    return ob


def _cyl_between(name, p1, p2, radius, mat, vertices=8):
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    ob = common.cylinder(name, (p1 + p2) * 0.5, radius, d.length, mat, vertices=vertices)
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    _apply_rot(ob)
    return ob


def _prism(name, cx, y, cz, w, h, depth, mat):
    """三角形棱柱 (山体): 截面 XZ 为三角, 沿 Y 挤出。"""
    x0, x1 = cx - w / 2, cx + w / 2
    y0, y1 = y - depth / 2, y + depth / 2
    z0, zt = cz - h / 2, cz + h / 2
    verts = [(x0, y0, z0), (x1, y0, z0), (cx, y0, zt),
             (x0, y1, z0), (x1, y1, z0), (cx, y1, zt)]
    faces = [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)]
    me = bpy.data.meshes.new(name + "_me")
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    return ob


# ---------------- 奖状 ----------------

def _award(idx, x, z, tilt_deg, curl_deg, mats):
    """单张奖状: 红框底板 + 米白纸面(薄壳) + 金细线内框 + 底部红横条。返回对象列表。"""
    w, h = 0.20, 0.28                       # 竖版
    bw = 0.016                              # 红框边宽
    ry = math.radians(tilt_deg)
    y_frame = WALL_Y - 0.002                # 红漆纸底板(嵌一点进墙)
    y_paper = WALL_Y - 0.0056               # 纸面中心
    y_gold = WALL_Y - 0.0068                # 金线 (纸前)
    y_band = WALL_Y - 0.0074                # 红横条 (最前)
    objs = []

    objs.append(_box_rot(f"prop_award_{idx:02d}_frame", (x, y_frame, z),
                         (w + 2 * bw, 0.004, h + 2 * bw), mats['red'], ry))

    if curl_deg:
        paper = _sheet(f"prop_award_{idx:02d}_paper", w, h, 3, 10,
                       0.12, curl_deg, -1, mats['paper'], 0.0008)
    else:
        paper = _sheet(f"prop_award_{idx:02d}_paper", w, h, 1, 1,
                       0.0, 0, -1, mats['paper'], 0.0008)
    paper.location = (x, y_paper, z)
    paper.rotation_euler = (0, ry, 0)
    objs.append(paper)

    # 金细线内框 (4 条, inset 0.014, 线宽 0.008)
    ins, lw = 0.014, 0.008
    gx, gz = w / 2 - ins, h / 2 - ins
    objs.append(_box_rot(f"prop_award_{idx:02d}_gt", (x, y_gold, z + gz),
                         (2 * gx + lw, 0.0012, lw), mats['gold'], ry))
    objs.append(_box_rot(f"prop_award_{idx:02d}_gb", (x, y_gold, z - gz),
                         (2 * gx + lw, 0.0012, lw), mats['gold'], ry))
    objs.append(_box_rot(f"prop_award_{idx:02d}_gl", (x - gx, y_gold, z),
                         (lw, 0.0012, 2 * gz - lw), mats['gold'], ry))
    objs.append(_box_rot(f"prop_award_{idx:02d}_gr", (x + gx, y_gold, z),
                         (lw, 0.0012, 2 * gz - lw), mats['gold'], ry))

    # 底部红横条 (底部 1/5 区带, 抬到金线内侧; 卷边者抬到弯折线之上)
    bz0 = -h / 2 + (0.13 * h if curl_deg else 0.115 * h)
    bz1 = -h / 2 + 0.20 * h
    objs.append(_box_rot(f"prop_award_{idx:02d}_band", (x, y_band, z + (bz0 + bz1) / 2),
                         (w - 0.036, 0.0012, bz1 - bz0), mats['red'], ry))
    return objs


# ---------------- build ----------------

def build(env):
    env['clean']()
    sc = bpy.context.scene
    ROOT = env['ROOT']

    M = {
        "paper":  _paper("wall_paper", (0.86, 0.82, 0.70), (0.95, 0.92, 0.82)),
        "red":    _paper("wall_red", (0.20, 0.012, 0.012), (0.44, 0.025, 0.02), rough=0.5),
        "gold":   _plain("wall_gold", (0.98, 0.62, 0.10), rough=0.35, metallic=0.3),
        "wood":   _wood("wall_wood"),
        "metal":  _plain("wall_metal", (0.42, 0.43, 0.45), rough=0.4, metallic=0.7),
        "string": _plain("wall_string", (0.55, 0.50, 0.42), rough=0.9),
        "wall":   _plain("wall_tmp_wall", (0.80, 0.78, 0.72), rough=0.95),   # 评审临时背景墙, 不进 GLB
    }

    # ---------- 奖状墙 8 张 (TV 顶 1.35 以上, 围绕 TV 上方与两侧; z 1.55-2.35 错落) ----------
    AWARDS = [
        # (x, z, tilt°, curl°) — 微倾斜±3°, 3 张卷边 15°, 位置不横平竖直(农村贴法)
        (-0.56, 1.66, -2.4, 0),
        ( 0.03, 1.58,  1.8, 15),
        ( 0.50, 1.68, -1.2, 0),
        (-0.34, 1.98,  2.6, 0),
        ( 0.18, 2.03, -2.9, 15),
        (-0.92, 2.14,  1.4, 0),
        ( 0.52, 2.24, -0.8, 15),
        (-0.07, 2.33,  2.2, 0),
    ]
    for i, (x, z, tilt, curl) in enumerate(AWARDS, 1):
        _award(i, x, z, tilt, curl, M)

    # ---------- 挂历 (TV 右侧 x≈0.85, z≈1.75, 大幅竖版 0.42×0.62) ----------
    CX, CZ = 0.85, 1.75
    PW, PH = 0.42, 0.62
    ROD_Z = CZ + PH / 2 + 0.012           # 卷轴杆轴心 z = 2.082
    ROD_Y = WALL_Y - 0.010
    PAGE_Y = WALL_Y - 0.014               # 页面中心 y
    Y_BLK = WALL_Y - 0.0152               # 页面色块层 y

    # 背板页 (硬衬, 直板)
    common.box("prop_calendar_backplate", (CX, WALL_Y - 0.004, CZ),
               (PW, 0.004, PH), M['paper'])

    # 顶部卷轴杆 (木棍, 两端略出 0.02)
    rod = common.cylinder("prop_calendar_rod", (CX, ROD_Y, ROD_Z), 0.012, PW + 0.04,
                          M['wood'], vertices=16)
    rod.rotation_euler = (0, math.pi / 2, 0)
    _apply_rot(rod)

    # 当前页 prop_calendar_page — 独立 mesh, origin 在顶部卷轴轴线 (M6 翻页绕局部 X)
    page = _page_mesh("prop_calendar_page", PW, PH, 6, 16, 0.10, 10.0, M['paper'], 0.001)
    page.location = (CX, ROD_Y - 0.002, ROD_Z)

    # 页面版式 (无文字): 上 1/4 红区 (M5 印年份) + 红/金几何块山水年画 + 底部 1/5 红横条
    top_z = ROD_Z
    common.box("prop_calendar_zone_top", (CX, Y_BLK, top_z - PH * 0.125),
               (PW, 0.002, PH * 0.25), M['red'])                          # 顶部红区 1/4
    sun = _cyl_y("prop_calendar_sun", (CX - 0.11, Y_BLK, top_z - PH * 0.44),
                 0.045, 0.002, M['gold'], vertices=20)                   # 金日
    _prism("prop_calendar_mountain", CX + 0.06, Y_BLK, top_z - PH * 0.50,
           0.20, 0.11, 0.002, M['red'])                                  # 红山
    common.box("prop_calendar_water", (CX, Y_BLK, top_z - PH * 0.66),
               (PW - 0.10, 0.002, 0.014), M['gold'])                       # 金水线
    band_z0, band_z1 = top_z - PH * 0.87, top_z - PH * 0.80               # 底部 1/5 内红条
    common.box("prop_calendar_band", (CX, Y_BLK, (band_z0 + band_z1) / 2),
               (PW - 0.02, 0.002, band_z0 - band_z1), M['red'])

    # ---------- 小细节: 铁钉 + 短线 (挂历左侧压纸) ----------
    _cyl_y("prop_calendar_nail", (0.585, WALL_Y - 0.008, 1.98), 0.0035, 0.018,
           M['metal'], vertices=12)
    _cyl_y("prop_calendar_nail_head", (0.585, WALL_Y - 0.017, 1.98), 0.007, 0.003,
           M['metal'], vertices=12)
    _cyl_between("prop_calendar_string", (0.585, WALL_Y - 0.018, 1.978),
                 (0.638, WALL_Y - 0.020, 1.942), 0.0012, M['string'], vertices=6)

    # ---------- 评审临时背景墙 (面向 -Y, 不进 GLB) ----------
    common.plane("_wall_backdrop", (0, WALL_Y + 0.005, 1.5), 6.0, M['wall'],
                 rotation=(math.pi / 2, 0, 0))

    # ---------- 灯光: 临时暖光 + 冷补光 + 冷环境 ----------
    env['add_light']('POINT', (0.3, -0.4, 2.2), energy=140,
                     color=(1.0, 0.74, 0.48), shadow_soft_size=0.12)
    env['add_light']('POINT', (-1.4, -0.6, 1.6), energy=45,
                     color=(0.55, 0.65, 0.85), shadow_soft_size=0.2)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.13, 0.14, 0.17, 1.0)
    bg.inputs[1].default_value = 0.45
    sc.world = world

    # ---------- 相机: 正对后墙略偏右, 同时看到奖状群 + 挂历 + TV 顶 ----------
    cam = env['add_camera']((0.55, -1.75, 1.55), (0.30, WALL_Y, 1.66), lens=35)

    # ---------- 评审静帧 960×540 ----------
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 960
    sc.render.resolution_y = 540
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(env['OUT'], "prop_wall.png")
    bpy.ops.render.render(write_still=True)
    print("[render]", sc.render.filepath)

    # ---------- QA 特写帧 (验证金线/卷边/挂历版式, 相机不入 GLB) ----------
    for qa_name, qa_loc, qa_tgt in (
        ("prop_wall_qa_award.png", (0.10, -0.55, 1.85), (0.05, WALL_Y, 1.88)),
        ("prop_wall_qa_calendar.png", (0.85, -0.70, 1.76), (0.85, WALL_Y, 1.78)),
    ):
        qa_cam = env['add_camera'](qa_loc, qa_tgt, lens=55)
        sc.render.filepath = os.path.join(env['OUT'], qa_name)
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(qa_cam, do_unlink=True)
        print("[render]", sc.render.filepath)
    sc.camera = cam

    # ---------- 导出 GLB: 仅 prop_award_* / prop_calendar_* 网格, 世界坐标 ----------
    meshes = [o for o in bpy.data.objects if o.type == 'MESH'
              and (o.name.startswith("prop_award_") or o.name.startswith("prop_calendar_"))]
    glb_path = os.path.join(ROOT, "assets", "scene", "v0001", "props", "wall.glb")
    common.export_glb(glb_path, objects=meshes)
    common.tris_report(meshes, label="prop_wall.glb")
