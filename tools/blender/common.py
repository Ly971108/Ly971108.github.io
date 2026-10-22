# tools/blender/common.py — 程序化材质库 + GLB 导出 + 网格工具（M2 白模）
import bpy
import os
from mathutils import Matrix

# ---------------- 材质库 ----------------

def principled(name, color, roughness=0.8, metallic=0.0, emission=None, emission_strength=0.0):
    """创建 use_nodes 的 Principled BSDF 材质。color 为 RGB 三元组。"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        em = bsdf.inputs.get("Emission Color")
        if em is None:
            em = bsdf.inputs.get("Emission")
        em.default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return m


def white_model_kit():
    """白模材质预设：石灰白 / 木色 / 水泥灰 + 少量辅助色。"""
    return {
        "lime":   principled("wm_lime",   (0.93, 0.91, 0.86), 0.95),                 # 石灰白
        "wood":   principled("wm_wood",   (0.48, 0.33, 0.20), 0.70),                 # 木色
        "cement": principled("wm_cement", (0.46, 0.47, 0.48), 0.90),                 # 水泥灰
        "metal":  principled("wm_metal",  (0.35, 0.36, 0.38), 0.50, metallic=0.3),  # 铁/铝
        "grey":   principled("wm_grey",   (0.56, 0.57, 0.59), 0.60),                 # 灰塑料/白铁
        "paper":  principled("wm_paper",  (0.90, 0.88, 0.82), 0.90),                 # 纸/搪瓷
        "sky":    principled("wm_sky",    (0.03, 0.05, 0.12), 1.00),                 # 夜空占位
        "bulb":   principled("wm_bulb",   (1.00, 0.85, 0.60), 0.30,
                              emission=(1.0, 0.72, 0.42), emission_strength=3.0),     # 白炽灯泡
    }

# ---------------- 网格工具 ----------------

def box(name, loc, size, mat=None):
    """创建立方体并应用 scale。size=(x,y,z) 全尺寸。"""
    bpy.ops.mesh.primitive_cube_add(location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        ob.data.materials.append(mat)
    return ob


def uv_sphere(name, loc, radius, mat=None, segments=24, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=segments, ring_count=rings, location=loc)
    ob = bpy.context.object
    ob.name = name
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        ob.data.materials.append(mat)
    return ob


def cylinder(name, loc, radius, depth, mat=None, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=vertices, location=loc)
    ob = bpy.context.object
    ob.name = name
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        ob.data.materials.append(mat)
    return ob


def plane(name, loc, size, mat=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=rotation)
    ob = bpy.context.object
    ob.name = name
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        ob.data.materials.append(mat)
    return ob


def join(objects, name):
    """合并多个对象为单个 mesh 并命名。"""
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = name
    return ob

# ---------------- 统计 / 导出 ----------------

def tris_report(objects=None, label=""):
    """打印每个 mesh（evaluated）的三角形数统计。"""
    dg = bpy.context.evaluated_depsgraph_get()
    if objects is None:
        objects = [o for o in bpy.data.objects if o.type == 'MESH']
    total = 0
    rows = []
    for ob in objects:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        n = len(me.loop_triangles)
        rows.append((ob.name, n))
        total += n
        ev.to_mesh_clear()
    print(f"[tris] {label}")
    for name, n in sorted(rows):
        print(f"  {name:24s} {n:>8d}")
    print(f"  {'TOTAL':24s} {total:>8d}")
    return total


def export_glb(filepath, objects=None):
    """导出 GLB。objects 为 None 时导出全部；否则仅导出指定对象（须为 mesh）。"""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    use_sel = objects is not None
    if use_sel:
        bpy.ops.object.select_all(action='DESELECT')
        for ob in objects:
            ob.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        use_selection=use_sel,
    )
    size = os.path.getsize(filepath)
    print(f"[export] {filepath} ({size / 1024:.1f} KB)")
    return size
