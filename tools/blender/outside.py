# tools/blender/outside.py — M4 道具 wave2：夏夜窗外景（低模剪影风格）
# 窗在右墙 x=+2.0，窗洞 y∈[-0.6,0.6] z∈[0.9,2.3]；本模块建窗外 8-15m 深处的夜景层次。
# 独立 mesh：outside_moon（M6 点击彩蛋）/ outside_stars（M6 顶点闪烁，COLOR_0 随机亮度）
# 萤火虫不建模（M7 three.js instanced quads 实时做）。
# 评审布景（_qa_* 窗框/暗墙）仅用于静帧，不入 GLB。
import bpy
import math
import os
import random
from mathutils import Vector
import common

SEED = 20261023

# 布局常量（距窗距离沿 +X）
X_SKY = 17.5          # 天空最外层
X_MTN = (10.0, 12.5, 15.0)   # 远山三层（8 / 10.5 / 13 m）
X_TREE = 6.0          # 槐树（4 m）
X_POLE = 6.5          # 电线杆（4.5 m）
MOON_POS = (14.0, -0.2, 3.6)  # 距窗 12 m，偏上
HALO_POS = (14.06, -0.2, 3.6)


def ink(name, color, em=0.25, rough=1.0):
    """剪影微光材质：暗色 + 同色系弱自发光（夜景无灯也可读）。"""
    return common.principled(name, color, rough, emission=color, emission_strength=em)


def quad_mesh(name, verts, faces, mat):
    me = bpy.data.meshes.new(name + "_geo")
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def ridge(name, x, y0, y1, hmin, hmax, seed, mat, n=26):
    """山脊剪影 ribbon：顶边起伏（双正弦+抖动），底边落地。法线朝 -X。"""
    rnd = random.Random(seed)
    p1, p2 = rnd.uniform(0, 6.28), rnd.uniform(0, 6.28)
    k1, k2 = rnd.uniform(0.30, 0.55), rnd.uniform(0.85, 1.30)
    a1 = (hmax - hmin) * 0.5
    mid = (hmax + hmin) * 0.5
    a2 = rnd.uniform(0.10, 0.22)
    jitter = [rnd.uniform(-0.08, 0.08) for _ in range(n)]
    verts, faces, top = [], [], []
    for i in range(n):
        y = y0 + (y1 - y0) * i / (n - 1)
        z = mid + a1 * math.sin(k1 * y + p1) + a2 * math.sin(k2 * y + p2) + jitter[i]
        z = max(z, 0.35)
        top.append(z)
        verts.append((x, y, z))       # 2i   顶
        verts.append((x, y, -0.3))    # 2i+1 底
    for i in range(n - 1):
        faces.append((2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1))
    ob = quad_mesh(name, verts, faces, mat)
    return ob, top


def circle_fan(name, x, y, z, r, mat, seg=10):
    """YZ 平面圆扇（树冠团块），x 微差避免共面闪烁。"""
    verts = [(x, y, z)]
    for i in range(seg):
        a = 2 * math.pi * i / seg
        verts.append((x, y + r * math.cos(a), z + r * math.sin(a)))
    faces = []
    for i in range(seg):
        faces.append((0, 1 + (i + 1) % seg, 1 + i))
    return quad_mesh(name, verts, faces, mat)


def bake_halo_image(n=64):
    """烘焙 64×64 径向 alpha 光晕贴图：RGB 暖黄常数，A 中心 0.45 → 边缘 0。"""
    stops = [(0.0, 0.45), (0.18, 0.15), (0.40, 0.045), (0.62, 0.0)]

    def alpha_at(rn):
        for (p0, a0), (p1, a1) in zip(stops, stops[1:]):
            if rn <= p1:
                t = (rn - p0) / (p1 - p0) if p1 > p0 else 0.0
                return a0 * (1 - t) + a1 * t
        return 0.0

    img = bpy.data.images.new("outside_moon_halo_tex", width=n, height=n, alpha=True)
    px = []
    for j in range(n):
        for i in range(n):
            gx, gy = (i + 0.5) / n, (j + 0.5) / n
            rn = math.hypot(gx - 0.5, gy - 0.5) / 0.5   # 0 中心 → 1 边缘
            px.extend((1.0, 0.92, 0.70, alpha_at(rn)))
    img.pixels = px
    return img


def mat_halo():
    """月亮光晕：烘焙径向渐变贴图（GLB 内嵌，three.js 直接可用）。"""
    m = bpy.data.materials.new("outside_moon_halo_m")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Emission Strength"].default_value = 0.55
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bake_halo_image()
    tex.interpolation = 'Linear'
    nt.links.new(tc.outputs["Generated"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    ec = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
    nt.links.new(tex.outputs["Color"], ec)
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    try:
        m.surface_render_method = 'BLENDED'
    except AttributeError:
        m.blend_method = 'BLEND'
    return m


def mat_sky():
    """天空：Generated→SeparateXYZ(=高度)→ColorRamp 深蓝黑微渐变。"""
    m = bpy.data.materials.new("outside_sky_m")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Emission Strength"].default_value = 0.18
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0            # 地平线（plane 底部）
    cr.elements[0].color = (0.055, 0.075, 0.140, 1.0)
    cr.elements[1].position = 1.0            # 天顶
    cr.elements[1].color = (0.012, 0.020, 0.045, 1.0)
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["X"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    ec = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
    nt.links.new(ramp.outputs["Color"], ec)
    return m


def mat_stars():
    """星星：COLOR_0 顶点色 → 自发光（GLB 导 COLOR_0 供 M6 闪烁）。"""
    m = bpy.data.materials.new("outside_stars_m")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Emission Strength"].default_value = 2.2
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "Col"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    ec = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
    nt.links.new(attr.outputs["Color"], ec)
    return m


def build_stars(name, ridge_top, y0=-5.0, y1=5.0, count=200, seed=SEED):
    """~200 小四边面，均匀散布在近层山脊线以上的天空（3 个深度层做视差）。"""
    rnd = random.Random(seed + 7)
    layers = (11.0, 13.5, 16.2)
    placed = []          # (y, z) 最小间距 0.2，避免聚集
    verts, faces, colors = [], [], []
    n = len(ridge_top)
    tries = 0
    while len(faces) < count and tries < count * 30:
        tries += 1
        y = rnd.uniform(y0, y1)
        t = (y - (-8.0)) / 16.0
        idx = min(int(t * (n - 1)), n - 2)
        frac = t * (n - 1) - idx
        zmin = ridge_top[idx] * (1 - frac) + ridge_top[idx + 1] * frac + 0.45
        z = rnd.uniform(zmin, 6.2)
        if z > 6.2:
            continue
        # 避开月盘/光晕中心
        if (y - MOON_POS[1]) ** 2 + (z - MOON_POS[2]) ** 2 < 0.55 ** 2:
            continue
        if any((y - py) ** 2 + (z - pz) ** 2 < 0.20 ** 2 for py, pz in placed):
            continue
        placed.append((y, z))
        x = layers[len(faces) % 3] + rnd.uniform(-0.3, 0.3)
        s = rnd.uniform(0.012, 0.034)
        # 避开月盘/光晕中心
        if (y - MOON_POS[1]) ** 2 + (z - MOON_POS[2]) ** 2 < 0.55 ** 2:
            continue
        i = len(verts)
        verts.extend([(x, y - s, z - s), (x, y + s, z - s),
                      (x, y + s, z + s), (x, y - s, z + s)])
        faces.append((i, i + 1, i + 2, i + 3))
        b = rnd.uniform(0.45, 1.0)
        if rnd.random() < 0.3:   # 三成淡蓝
            colors.append((b * 0.62, b * 0.76, b * 1.0, 1.0))
        else:                    # 白
            colors.append((b, b, b * 0.96, 1.0))
    me = bpy.data.meshes.new(name + "_geo")
    me.from_pydata(verts, [], faces)
    me.update()
    ca = me.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
    for i, c in enumerate(colors):
        ca.data[i].color = c
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat_stars())
    return ob


def build(env):
    env['clean']()
    sc = bpy.context.scene
    ROOT = env['ROOT']

    # ---------------- 材质（墨色由远及近渐深） ----------------
    m_sky = mat_sky()
    m_mtn_f = ink("outside_mtn_far_m",  (0.050, 0.065, 0.115), em=0.28)
    m_mtn_m = ink("outside_mtn_mid_m",  (0.032, 0.042, 0.082), em=0.20)
    m_mtn_n = ink("outside_mtn_near_m", (0.016, 0.022, 0.048), em=0.18)
    m_tree = ink("outside_tree_m",  (0.012, 0.020, 0.015), em=0.15)
    m_pole = ink("outside_pole_m",  (0.028, 0.022, 0.018), em=0.12)
    m_insu = common.principled("outside_pole_insu_m", (0.52, 0.58, 0.66), 0.5,
                               emission=(0.52, 0.58, 0.66), emission_strength=0.9)
    m_gnd = ink("outside_ground_m", (0.020, 0.024, 0.028), em=0.10)
    m_path = ink("outside_path_m",  (0.062, 0.056, 0.048), em=0.16)
    m_moon = common.principled("outside_moon_m", (1.0, 0.95, 0.80), 0.6,
                               emission=(1.0, 0.94, 0.76), emission_strength=2.4)

    # ---------------- 天空（最外层，16×10 ≥ 8×6） ----------------
    sky = common.plane("outside_sky", (X_SKY, 0, 3.2), 16.0, m_sky,
                       rotation=(0, math.radians(-90), 0))
    sky.scale.z = 10.0 / 16.0
    bpy.context.view_layer.objects.active = sky
    sky.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    sky.data.name = "outside_sky"

    # ---------------- 远山三层（8-15m，高 2-4m） ----------------
    mtn_far, top_far = ridge("outside_mtn_far", X_MTN[0], -8, 8, 1.6, 2.9, SEED + 1, m_mtn_f)
    mtn_mid, _ = ridge("outside_mtn_mid", X_MTN[1], -8, 8, 1.3, 3.3, SEED + 2, m_mtn_m)
    mtn_near, _ = ridge("outside_mtn_near", X_MTN[2], -8, 8, 0.9, 2.6, SEED + 3, m_mtn_n)

    # ---------------- 月亮 + 光晕 ----------------
    bpy.ops.mesh.primitive_cylinder_add(radius=0.30, depth=0.03, vertices=32,
                                       location=MOON_POS, rotation=(0, math.radians(90), 0))
    moon = bpy.context.object
    moon.name = "outside_moon"
    moon.data.name = "outside_moon"
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    moon.data.materials.append(m_moon)
    halo = common.plane("outside_moon_halo", HALO_POS, 3.2, mat_halo(),
                        rotation=(0, math.radians(-90), 0))
    halo.data.name = "outside_moon_halo"

    # ---------------- 星星（近层山脊线以上） ----------------
    stars = build_stars("outside_stars", top_far)

    # ---------------- 槐树（4m，左前侧 y+） ----------------
    ty, tz = 1.5, 2.2
    blobs = [
        circle_fan("_tb0", X_TREE - 0.010, ty, tz + 0.75, 0.55, m_tree),
        circle_fan("_tb1", X_TREE + 0.012, ty - 0.42, tz + 0.35, 0.48, m_tree),
        circle_fan("_tb2", X_TREE - 0.006, ty + 0.45, tz + 0.30, 0.50, m_tree),
        circle_fan("_tb3", X_TREE + 0.018, ty - 0.15, tz + 1.05, 0.40, m_tree),
        circle_fan("_tb4", X_TREE + 0.000, ty + 0.28, tz - 0.15, 0.45, m_tree),
        circle_fan("_tb5", X_TREE - 0.014, ty - 0.55, tz - 0.10, 0.38, m_tree),
        circle_fan("_tb6", X_TREE + 0.008, ty + 0.60, tz - 0.05, 0.36, m_tree),
        common.box("_ttrunk", (X_TREE, ty, 1.0), (0.09, 0.10, 2.0), m_tree),
    ]
    tree = common.join(blobs, "outside_tree")
    tree.data.name = "outside_tree"

    # ---------------- 电线杆（4.5m，右前侧 y-）+ 瓷瓶绝缘子 ----------------
    py = -1.7
    bpy.ops.mesh.primitive_cone_add(radius1=0.085, radius2=0.055, depth=3.2, vertices=10,
                                   location=(X_POLE, py, 1.6))
    pole_body = bpy.context.object
    pole_body.name = "_pb"
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    arm = common.box("_parm", (X_POLE, py, 2.95), (0.07, 0.95, 0.09), m_pole)
    insulators = []
    for i, dy in enumerate((-0.36, 0.0, 0.36)):
        ins = common.cylinder(f"_pins{i}", (X_POLE, py + dy, 3.03), 0.032, 0.09,
                              m_insu, vertices=8)
        insulators.append(ins)
    pole = common.join([pole_body, arm] + insulators, "outside_pole")
    pole.data.name = "outside_pole"

    # ---------------- 院子地面 + 隐约小径 ----------------
    ground = quad_mesh("outside_ground",
                       [(2.05, -7, 0.0), (17.5, -7, 0.0), (17.5, 7, 0.0), (2.05, 7, 0.0)],
                       [(0, 1, 2, 3)], m_gnd)
    path_pts = [(2.15, -0.25), (3.4, -0.10), (4.7, 0.12), (6.1, 0.40),
                (7.6, 0.72), (9.4, 1.00)]
    pv, pf = [], []
    for i, (px, pyy) in enumerate(path_pts):
        w = 0.14 + 0.06 * i          # 外扩透视
        if i > 0:                    # 用相邻点估方向
            dx, dy = px - path_pts[i - 1][0], pyy - path_pts[i - 1][1]
        else:
            dx, dy = path_pts[1][0] - px, path_pts[1][1] - pyy
        L = math.hypot(dx, dy)
        nx, ny = -dy / L * w, dx / L * w
        pv.append((px + nx, pyy + ny, 0.012))
        pv.append((px - nx, pyy - ny, 0.012))
    for i in range(len(path_pts) - 1):
        pf.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
    path = quad_mesh("outside_path", pv, pf, m_path)

    outside_objs = [sky, mtn_far, mtn_mid, mtn_near, moon, halo, stars,
                    tree, pole, ground, path]

    # ---------------- 夜景布光：仅淡蓝月光 0.3，无室内灯 ----------------
    env['add_light']('SUN', (6, 0, 8), energy=0.3, color=(0.65, 0.75, 1.0),
                     angle=math.radians(15))
    sun = bpy.data.objects["sun"]
    sun.rotation_euler = (0, math.radians(18), 0)   # 自月方（右上）斜射入院
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.006, 0.009, 0.020, 1.0)
    bg.inputs[1].default_value = 0.30
    sc.world = world

    # ---------------- 评审布景：暗墙 + 窗框（_qa_*，不入 GLB） ----------------
    qa_wall_m = ink("_qa_wall_m", (0.018, 0.016, 0.014), em=0.06)
    qa_frame_m = ink("_qa_frame_m", (0.055, 0.038, 0.022), em=0.10)
    qa = [
        common.box("_qa_w_bot", (2.12, 0, 0.45), (0.12, 3.74, 0.90), qa_wall_m),
        common.box("_qa_w_top", (2.12, 0, 2.55), (0.12, 3.74, 0.50), qa_wall_m),
        common.box("_qa_w_neg", (2.12, -1.175, 1.6), (0.12, 0.95, 1.40), qa_wall_m),
        common.box("_qa_w_pos", (2.12, 1.175, 1.6), (0.12, 0.95, 1.40), qa_wall_m),
        common.box("_qa_f_t", (2.03, 0, 2.30), (0.16, 1.32, 0.06), qa_frame_m),
        common.box("_qa_f_b", (2.03, 0, 0.90), (0.16, 1.32, 0.06), qa_frame_m),
        common.box("_qa_f_l", (2.03, -0.60, 1.60), (0.16, 0.06, 1.46), qa_frame_m),
        common.box("_qa_f_r", (2.03, 0.60, 1.60), (0.16, 0.06, 1.46), qa_frame_m),
        common.plane("_qa_floor", (1.4, 0, -0.002), 3.0, qa_wall_m),
    ]

    # ---------------- 相机：室内窗边 (1.2,-0.2,1.5) 朝窗外 ----------------
    cam = env['add_camera']((1.2, -0.2, 1.5), (10.0, -0.05, 1.95), lens=28)

    # ---------------- 渲染 960×540 ----------------
    for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    sc.render.resolution_x = 960
    sc.render.resolution_y = 540
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(env['OUT'], "outside.png")
    bpy.ops.render.render(write_still=True)
    print("[render]", sc.render.filepath)

    # ---------------- 统计 + 导出 GLB（仅 outside_* mesh） ----------------
    meshes = [o for o in outside_objs if o.type == 'MESH']
    common.tris_report(meshes, label="outside.glb")
    glb_path = os.path.join(ROOT, "assets", "scene", "v0001", "props", "outside.glb")
    common.export_glb(glb_path, objects=outside_objs)
