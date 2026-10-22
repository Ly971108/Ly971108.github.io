# tools/blender/prop_fan.py — M3 道具：90 年代台式摇头电风扇
# 层级: prop_fan_head (EMPTY, origin=立柱顶端关节, M6 摇头=yaw@Z)
#        ├─ prop_fan_motor  电机壳(水平圆柱+端盖)
#        ├─ prop_fan_blades 三叶单 mesh, origin=电机轴心, M6 自转=local Y
#        └─ prop_fan_grill  金属网罩(同心 torus + 中心帽, 跟 head 摇头)
# 静态: prop_fan_base / prop_fan_button / prop_fan_column(含摇头关节)
# 其他: prop_fan_cord 电源线(bezier, bevel 0.006, 黑)
import bpy
import math
import os
from mathutils import Vector
import common

FAN = (1.45, 0.85)          # 底座中心（房间坐标，替换 fan_stub）
HEAD_Z = 0.95               # 摇头关节高 = head pivot
SHAFT_Z = 1.09              # 电机轴心高
FRONT = -1.0                # 风扇朝 -Y（房间中心 / 课桌方向）


def mat_green():
    """墨绿烤漆：微噪粗糙 + 细噪点凹凸（全程序化）。"""
    m = bpy.data.materials.new("prop_fan_mat_green")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.115, 0.185, 0.140, 1.0)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 42.0
    noise.inputs["Detail"].default_value = 2.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.28, 0.28, 0.28, 1.0)
    ramp.color_ramp.elements[1].color = (0.48, 0.48, 0.48, 1.0)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Roughness"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.10
    bump.inputs["Distance"].default_value = 0.025
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def torus(name, loc, major, minor, mat, rot=(math.radians(90), 0, 0),
          major_segments=48, minor_segments=6):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor,
        major_segments=major_segments, minor_segments=minor_segments,
        location=loc, rotation=rot)
    ob = bpy.context.object
    ob.name = name
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(mat)
    return ob


def parent_local(ob, head, head_pos):
    """parent 到 head（head 无旋转），local loc = 世界 loc - pivot。"""
    ob.parent = head
    ob.location = Vector(ob.location) - Vector(head_pos)


def build_blades(mat, shaft_center):
    """三叶单 mesh：局部坐标绕原点，origin 即电机轴心；自转轴=local Y。"""
    pts = [(0.030, -18), (0.110, -12), (0.165, -4), (0.185, 6), (0.185, 18),
           (0.185, 30), (0.130, 26), (0.070, 14), (0.030, 6)]
    n = len(pts)
    t, pitch = 0.005, 0.10
    verts, faces = [], []
    for k in range(3):
        base_a = math.radians(120 * k)
        ring = []
        for (r, deg) in pts:
            a = base_a + math.radians(deg)
            x, z = r * math.cos(a), r * math.sin(a)
            ring.append((x, t / 2 + pitch * r, z, x, -t / 2 + pitch * r, z))
        i0 = len(verts)
        for q in ring:
            verts.extend([(q[0], q[1], q[2]), (q[3], q[4], q[5])])
        # 前表面(法线+Y)：从 +Y 看轮廓需为 CCW（屏幕右=-X，故用递减序）
        faces.append(tuple(i0 + 2 * i for i in reversed(range(n))))
        # 后表面(法线-Y)：递增序
        faces.append(tuple(i0 + 2 * i + 1 for i in range(n)))
        # 侧壁
        for i in range(n):
            j = (i + 1) % n
            f0, f1 = i0 + 2 * i, i0 + 2 * j
            faces.append((f0, f1, f1 + 1, f0 + 1))
    me = bpy.data.meshes.new("prop_fan_blades_geo")
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new("prop_fan_blades", me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    ob.location = shaft_center
    # 轮毂并入同 mesh（join 后 origin=轮毂中心=轴心）
    hub = common.cylinder("_blade_hub", shaft_center, 0.033, 0.024, mat, vertices=16)
    hub.rotation_euler.x = math.radians(90)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    hub.select_set(True)
    bpy.context.view_layer.objects.active = hub
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = "prop_fan_blades"
    ob.data.name = "prop_fan_blades"
    return ob


def build(env):
    env['clean']()
    sc = bpy.context.scene
    ROOT = env['ROOT']
    X, Y = FAN
    head_pos = (X, Y, HEAD_Z)
    shaft_center = (X, Y - 0.16, SHAFT_Z)   # 轴心在电机前端面外

    # ---------- 材质 ----------
    green = mat_green()
    alu = common.principled("prop_fan_mat_alu", (0.72, 0.73, 0.75), 0.35, metallic=0.9)
    red = common.principled("prop_fan_mat_red", (0.52, 0.07, 0.05), 0.45)
    rubber = common.principled("prop_fan_mat_rubber", (0.025, 0.025, 0.028), 0.85)

    # ---------- 底座（扁圆墩 Ø0.30 × 0.10） ----------
    base = common.cylinder("prop_fan_base", (X, Y, 0.05), 0.15, 0.10, green, vertices=32)
    plate = common.cylinder("_base_plate", (X, Y, 0.105), 0.142, 0.015, green, vertices=32)
    base = common.join([plate, base], "prop_fan_base")
    base.data.name = "prop_fan_base"

    # ---------- 档位按钮（底座正面 -Y，独立 mesh） ----------
    bezel = common.cylinder("_btn_bezel", (X, Y - 0.146, 0.055), 0.024, 0.010, red, vertices=20)
    bezel.rotation_euler.x = math.radians(90)
    btn = common.cylinder("_btn", (X, Y - 0.152, 0.055), 0.018, 0.018, red, vertices=20)
    btn.rotation_euler.x = math.radians(90)
    button = common.join([bezel, btn], "prop_fan_button")
    button.data.name = "prop_fan_button"

    # ---------- 立柱（细颈 + 摇头关节圆柱节点） ----------
    neck = common.cylinder("_neck", (X, Y, 0.505), 0.022, 0.81, green, vertices=16)
    joint = common.cylinder("_joint", (X, Y, 0.95), 0.045, 0.11, green, vertices=20)
    column = common.join([neck, joint], "prop_fan_column")
    column.data.name = "prop_fan_column"

    # ---------- 机头父节点 ----------
    head = bpy.data.objects.new("prop_fan_head", None)
    bpy.context.collection.objects.link(head)
    head.location = head_pos
    head.empty_display_type = 'CIRCLE'
    head.empty_display_size = 0.06

    # ---------- 电机壳（水平圆柱 + 前后端盖 + 后轴套） ----------
    housing = common.cylinder("_motor", (X, Y, SHAFT_Z), 0.085, 0.16, green, vertices=24)
    housing.rotation_euler.x = math.radians(90)
    cap_f = common.cylinder("_cap_f", (X, Y - 0.0825, SHAFT_Z), 0.062, 0.025, green, vertices=24)
    cap_f.rotation_euler.x = math.radians(90)
    cap_r = common.cylinder("_cap_r", (X, Y + 0.0825, SHAFT_Z), 0.055, 0.022, green, vertices=24)
    cap_r.rotation_euler.x = math.radians(90)
    boss = common.cylinder("_boss", (X, Y + 0.098, SHAFT_Z), 0.020, 0.030, green, vertices=16)
    boss.rotation_euler.x = math.radians(90)
    motor = common.join([housing, cap_f, cap_r, boss], "prop_fan_motor")
    motor.data.name = "prop_fan_motor"
    parent_local(motor, head, head_pos)

    # ---------- 扇叶（三叶单 mesh，origin=轴心） ----------
    blades = build_blades(green, shaft_center)
    parent_local(blades, head, head_pos)

    # ---------- 金属网罩（4 同心环 + 中心帽，铝） ----------
    gy = Y - 0.245                      # 网罩平面（叶片前方）
    rim = torus("_g_rim", (X, gy, SHAFT_Z), 0.188, 0.0045, alu)
    r1 = torus("_g1", (X, gy, SHAFT_Z), 0.130, 0.0022, alu)
    r2 = torus("_g2", (X, gy, SHAFT_Z), 0.084, 0.0022, alu)
    r3 = torus("_g3", (X, gy, SHAFT_Z), 0.042, 0.0022, alu)
    cap = common.uv_sphere("_g_cap", (X, gy - 0.012, SHAFT_Z), 0.016, alu, segments=16, rings=8)
    cap.scale.y = 0.55
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    grill = common.join([rim, r1, r2, r3, cap], "prop_fan_grill")
    grill.data.name = "prop_fan_grill"
    parent_local(grill, head, head_pos)

    # ---------- 电源线（底座后缘引出，沿地面走） ----------
    cu = bpy.data.curves.new("prop_fan_cord", 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 0.006
    cu.bevel_resolution = 2
    cu.resolution_u = 12
    sp = cu.splines.new('BEZIER')
    pts = [(X, Y + 0.14, 0.035), (X + 0.07, Y + 0.40, 0.015),
           (X - 0.10, Y + 0.67, 0.012), (X - 0.40, Y + 0.81, 0.012)]
    sp.bezier_points.add(len(pts) - 1)
    for bp, co in zip(sp.bezier_points, pts):
        bp.co = co
        bp.handle_left_type = 'AUTO'
        bp.handle_right_type = 'AUTO'
    cord = bpy.data.objects.new("prop_fan_cord", cu)
    bpy.context.collection.objects.link(cord)
    cord.data.materials.append(rubber)

    fan_objs = [head, base, button, column, motor, blades, grill, cord]

    # ---------- 评审布景（地板/灯光/相机，不入 GLB） ----------
    common.plane("_qa_floor", (0, 0, -0.002), 12.0,
                 common.principled("_qa_floor_m", (0.20, 0.19, 0.18), 0.92))
    env['add_light']('POINT', (X + 1.0, Y - 1.45, 2.35), energy=300,
                     color=(1.0, 0.76, 0.52), shadow_soft_size=0.30)
    env['add_light']('POINT', (X - 1.35, Y - 0.55, 1.70), energy=80,
                     color=(0.55, 0.66, 0.95), shadow_soft_size=0.40)
    env['add_light']('POINT', (X + 0.65, Y + 1.00, 1.60), energy=140,
                     color=(1.0, 0.85, 0.65), shadow_soft_size=0.25)
    env['add_light']('POINT', (X - 0.60, Y - 2.20, 1.10), energy=100,
                     color=(1.0, 0.88, 0.70), shadow_soft_size=0.50)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.04, 0.04, 0.05, 1.0)
    bg.inputs[1].default_value = 0.60
    sc.world = world

    cam = env['add_camera']((X - 0.55, Y - 2.30, 1.50), (X, Y, 0.80), lens=33)

    # ---------- 渲染 ----------
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
    sc.render.filepath = os.path.join(env['OUT'], "prop_fan.png")
    bpy.ops.render.render(write_still=True)
    print("[render]", sc.render.filepath)

    # ---------- 统计 + 导出 GLB（保留 head 层级） ----------
    meshes = [o for o in fan_objs if o.type == 'MESH']
    common.tris_report(meshes, label="prop_fan")
    glb_path = os.path.join(ROOT, "assets", "scene", "v0001", "props", "fan.glb")
    common.export_glb(glb_path, objects=fan_objs)
