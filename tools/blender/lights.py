# tools/blender/lights.py — M5 三态灯光 + TV 独立态
# 状态: dusk 黄昏暖阳斜射 / night 灯泡+月光 / latenight 灯灭仅月光+TV
# 独立态: tv_only (仅 TV 白片发光, 供 irrB) / dusk_only (同 dusk)
# 契约: blender -b -P main.py -- lights  (build(env) = assemble + setup('night'))
import bpy
import math
import os
import sys
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

BULB_POS = (0.0, 0.0, 2.04)          # 拉线灯泡点光位 (玻璃球下方, 避免自包围挡光)
TV_GLOW_POS = (0.0, 1.20, 0.87)      # TV 屏幕前方 1.5cm (实际屏心在 y≈1.27 前凸≈1.22)
TV_GLOW_SIZE = (0.40, 0.30)          # 0.4 x 0.3, 法线 -Y
TV_GLOW_STRENGTH = 8.0

_world_obj = None
_tv_glow = None


def _world():
    global _world_obj
    if _world_obj is None:
        w = bpy.data.worlds.get("m5_world") or bpy.data.worlds.new("m5_world")
        w.use_nodes = True
        _world_obj = w
    bpy.context.scene.world = _world_obj
    return _world_obj


def _set_world(color, strength):
    w = _world()
    bg = w.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (*color, 1.0)
    bg.inputs[1].default_value = strength


def _purge_lights():
    for ob in list(bpy.data.objects):
        if ob.type == 'LIGHT':
            bpy.data.objects.remove(ob, do_unlink=True)


def _sun(name, direction, energy, color):
    """平行光: direction=光线指向(入射方向)。"""
    ld = bpy.data.lights.new(name, 'SUN')
    ld.energy = energy
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    bpy.context.collection.objects.link(ob)
    d = Vector(direction).normalized()
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def _point(name, loc, energy, color, size):
    ld = bpy.data.lights.new(name, 'POINT')
    ld.energy = energy
    ld.color = color
    ld.shadow_soft_size = size
    ob = bpy.data.objects.new(name, ld)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    return ob


def _tv_glow_plane():
    """TV 发光占位白面片 (latenight / tv_only 态点亮)。"""
    global _tv_glow
    if _tv_glow is None:
        me = bpy.data.meshes.new("tv_glow_me")
        w, h = TV_GLOW_SIZE[0] / 2, TV_GLOW_SIZE[1] / 2
        me.from_pydata([(-w, -h, 0), (w, -h, 0), (w, h, 0), (-w, h, 0)], [],
                       [(0, 1, 2, 3)])
        me.update()
        m = bpy.data.materials.new("m5_tv_glow")
        m.use_nodes = True
        b = m.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = (1, 1, 1, 1)
        b.inputs["Roughness"].default_value = 1.0
        em = b.inputs.get("Emission Color")
        if em is None:
            em = b.inputs.get("Emission")
        em.default_value = (1.0, 1.0, 1.0, 1.0)
        b.inputs["Emission Strength"].default_value = 0.0
        me.materials.append(m)
        ob = bpy.data.objects.new("tv_glow_plane", me)
        bpy.context.collection.objects.link(ob)
        ob.location = TV_GLOW_POS
        ob.rotation_euler = (math.radians(90.0), 0, 0)     # 法线 -Y 朝室内
        _tv_glow = ob
    return _tv_glow


def _set_tv_glow(on, strength=0.0):
    ob = _tv_glow_plane()
    bsdf = ob.data.materials[0].node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Emission Strength"].default_value = strength if on else 0.0
    ob.hide_render = not on
    ob.hide_set(not on)


def _emitters(state):
    """打印当前态发光体清单。"""
    rows = []
    for ob in bpy.data.objects:
        if ob.type == 'LIGHT':
            rows.append(f"{ob.name}({ob.data.type} E={ob.data.energy}W)")
        elif ob.type == 'MESH' and ob.name == "tv_glow_plane" and not ob.hide_render:
            b = ob.data.materials[0].node_tree.nodes.get("Principled BSDF")
            rows.append(f"tv_glow_plane(emit S={b.inputs['Emission Strength'].default_value})")
    print(f"[lights] state={state} emitters: {rows or 'NONE'}")
    bg = _world().node_tree.nodes.get("Background")
    print(f"[lights] world bg={tuple(round(v,3) for v in bg.inputs[0].default_value[:3])}"
          f" strength={bg.inputs[1].default_value:.3f}")


def setup(state):
    """三态灯光: dusk / night / latenight (+ tv_only / dusk_only)。"""
    _purge_lights()
    if state in ("dusk", "dusk_only"):
        # 黄昏: 暖橙夕阳(1200W/m^2 等效)斜射入右墙窗, 淡紫环境
        _sun("sun_dusk", direction=(-1.0, -0.28, -0.38), energy=1.2,
             color=(1.0, 0.52, 0.22))
        _set_world((0.42, 0.30, 0.50), 0.35)
        _set_tv_glow(False)
    elif state == "night":
        # 夜晚: 15W 拉线灯泡 2700K + 窗外冷蓝月光(微弱) + 极弱环境
        _point("bulb_light", BULB_POS, energy=15.0, color=(1.0, 0.72, 0.42), size=0.06)
        _sun("moon_light", direction=(-0.9, -0.18, -0.42), energy=0.25,
             color=(0.55, 0.68, 1.0))
        _set_world((0.03, 0.04, 0.08), 0.06)
        _set_tv_glow(False)
    elif state == "latenight":
        # 深夜: 灯泡灭, 月光 + TV 白片发光
        _sun("moon_light", direction=(-0.9, -0.18, -0.42), energy=0.25,
             color=(0.55, 0.68, 1.0))
        _set_world((0.03, 0.04, 0.08), 0.06)
        _set_tv_glow(True, TV_GLOW_STRENGTH)
    elif state == "tv_only":
        # 仅 TV 白片发光 (irrB 烘焙基准), 其余全黑
        _set_world((0.001, 0.001, 0.001), 0.005)
        _set_tv_glow(True, TV_GLOW_STRENGTH)
    else:
        raise ValueError(f"unknown light state: {state}")
    _emitters(state)


def setup_tv_only():
    setup("tv_only")


def setup_dusk_only():
    setup("dusk_only")


def build(env):
    import assemble
    ctx = assemble.build(env)
    setup("night")
    return ctx
