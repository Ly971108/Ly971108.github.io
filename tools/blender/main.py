# tools/blender/main.py — 建模管线入口
# 用法:
#   blender -b -P tools/blender/main.py -- smoke     # M0 冒烟： cube+plane 静帧
#   blender -b -P tools/blender/main.py -- build     # 全量: 建模+UV2+烘焙(待实现)
#   blender -b -P tools/blender/main.py -- <module>  # 单道具: room_shell / prop_tv / ...
import bpy, sys, os, math

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "tools", "blender", "out")
os.makedirs(OUT, exist_ok=True)

def clean():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def look_at(obj, target):
    from mathutils import Vector
    d = (Vector(target) - obj.location).normalized()
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def add_camera(loc, target, lens=35):
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.collection.objects.link(cam)
    cam.location = loc
    cam.data.lens = lens
    look_at(cam, target)
    bpy.context.scene.camera = cam
    return cam

def add_light(kind, loc, **kw):
    ld = bpy.data.lights.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(ld, k, v)
    ob = bpy.data.objects.new(kind.lower(), ld)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    return ob

def render(path, res=640, samples=32):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.filepath = path
    sc.render.image_settings.file_format = 'PNG'
    bpy.ops.render.render(write_still=True)
    print("RENDERED", path)

def smoke():
    clean()
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0.5))
    cube = bpy.context.object
    m = bpy.data.materials.new("cube")
    m.diffuse_color = (0.9, 0.6, 0.2, 1)
    cube.data.materials.append(m)
    bpy.ops.mesh.primitive_plane_add(size=10, location=(0, 0, 0))
    add_camera((4, -4, 3), (0, 0, 0.5))
    add_light('POINT', (2, -2, 4), energy=800)
    render(os.path.join(OUT, "smoke.png"))

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    cmd = argv[0] if argv else "smoke"
    if cmd == "smoke":
        smoke()
    else:
        # 动态加载 tools/blender/<cmd>.py 的 build(scene) 入口
        import importlib.util
        sys.path.insert(0, os.path.join(ROOT, "tools", "blender"))
        spec = importlib.util.spec_from_file_location(cmd, os.path.join(ROOT, "tools", "blender", cmd + ".py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.build(globals())
