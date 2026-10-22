# tools/blender/assemble.py — M5 装配: 导入 room.glb + props, 剔除动态/外景, 中文文字, 静态集收集
# 契约: blender -b -P main.py -- assemble   (build(env))
import bpy
import os
import sys
import json
import math
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
V1 = os.path.join(ROOT, "assets", "scene", "v0001")
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\simhei.ttf",    # 黑体(任务书首选)
    r"C:\Windows\Fonts\simkai.ttf",    # 楷体备选
    r"C:\Windows\Fonts\msyh.ttc",      # 微软雅黑兜底
]

# ---------- 静态烘焙排除表 (精确名 -> 理由; 前缀/父链规则见 is_excluded) ----------
STATIC_EXCLUDE = {
    "bulb":                    "灯泡玻璃自发光, 随灯态运行时切换, 不烘焙",
    "prop_tv_screen":          "运行时 CRT 发光面(Canvas 绘制)",
    "prop_tv_knob_channel":    "换台旋钮运行时旋转",
    "prop_tv_knob_volume":     "音量旋钮运行时旋转",
    "prop_notebook_page_L":    "作业本页运行时翻页",
    "prop_notebook_page_R":    "作业本页运行时翻页",
    "prop_calendar_page":      "挂历页运行时绕卷轴翻页",
    "prop_radio_reel_l":       "磁带卷带轮运行时转动",
    "prop_radio_reel_l_b":     "磁带卷带轮运行时转动",
    "prop_radio_reel_r_a":     "磁带卷带轮运行时转动",
    "prop_radio_reel_r_b":     "磁带卷带轮运行时转动",
    "prop_radio_vu":           "VU 表指针运行时摆动",
    "prop_radio_vu_window":    "VU 表窗(随动效)",
    "prop_radio_vu_ticks":     "VU 表刻度(随动效)",
    "prop_radio_button_play":  "播放键运行时按下",
    "prop_radio_buttons_aux":  "辅助键运行时按下",
    "prop_radio_knob_tune":    "调谐旋钮运行时旋转",
    "prop_radio_knob_volume":  "音量旋钮运行时旋转",
    "prop_mosq_ember":         "蚊香燃点自发光运行时呼吸",
    "prop_bed_net":            "蚊帐透明织物运行时微动, alpha 不烘焙",
    "sky_plane":               "窗外夜空占位, 窗外走独立方案",
    "desk_stub":               "M2 占位盒, 已被 props/*.glb 精模替代",
    "fan_stub":                "M2 占位盒, 已被 props/*.glb 精模替代",
    "tv_stub":                 "M2 占位盒, 已被 props/*.glb 精模替代",
    "tv_stand_stub":           "M2 占位盒, 已被 props/*.glb 精模替代",
    "bench_stub":              "M2 占位盒, 已被 props/*.glb 精模替代",
}
STATIC_EXCLUDE_PREFIX = ("outside_",)   # 外景全部: 独立方案, 不参与室内烘焙
FAN_HEAD = "prop_fan_head"              # 摇头关节(EMPTY), 其子树(blades/motor/grill)运行时动

# ---------- 图集组划分 (首匹配优先) ----------
def atlas_group(name):
    """静态 mesh -> 图集组: shell 墙地顶 / walldeco 墙面小物 / bedding 被褥织物 / furniture 大家具"""
    if name in ("floor", "ceiling", "window_frame") or name.startswith(("wall_", "beam_")):
        return "shell"
    if name.startswith(("prop_award_", "prop_calendar_")):
        return "walldeco"
    if name.startswith("prop_bed_") and any(
            k in name for k in ("mattress", "pillow", "blanket", "coolmat")):
        return "bedding"
    return "furniture"


def is_excluded(ob):
    """按 精确名 / outside_ 前缀 / prop_fan_head 父链 判定。"""
    if ob.name in STATIC_EXCLUDE:
        return True
    if ob.name.startswith(STATIC_EXCLUDE_PREFIX):
        return True
    p = ob.parent
    while p:
        if p.name == FAN_HEAD:
            return True
        p = p.parent
    return False


def _import_glb(path):
    before = set(o.name for o in bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o.name not in before]


def _load_font():
    for f in FONT_CANDIDATES:
        if os.path.exists(f):
            try:
                fo = bpy.data.fonts.load(f)
                print(f"[font] loaded {f} -> {fo.name}")
                return fo
            except Exception as e:
                print(f"[font] load fail {f}: {e}")
    print("[font] WARN: no CJK font found, text will be left empty")
    return None


def _text_obj(name, body, font, size, mat):
    cu = bpy.data.curves.new(name + "_cu", 'FONT')
    cu.body = body
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.size = size
    cu.extrude = 0.0005
    if font:
        cu.font = font
    else:
        cu.body = ""
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    cu.materials.append(mat)
    return ob


def _rot_y(ry):
    return Matrix.Rotation(ry, 4, 'Y')


def _face_neg_y():
    return Matrix.Rotation(math.radians(90.0), 4, 'X')   # 文本 +Z(正面) -> 世界 -Y(朝室内)


def add_chinese_text():
    """程序化中文文字(不改 prop_wall.py): 奖状标题/装饰线 + 挂历 2026/日期小表。
    全部转 mesh, 命名 prop_award_*/prop_calendar_* 前缀 -> 自动进 walldeco 图集。"""
    font = _load_font()
    M_red = common.principled("m5_text_red", (0.40, 0.02, 0.015), 0.6)
    M_blk = common.principled("m5_text_black", (0.045, 0.04, 0.04), 0.7)
    texts = []

    # 奖状 8 张参数 (与 prop_wall.py AWARDS 表一致: x, z, tilt°, curl°)
    AWARDS = [
        (-0.56, 1.66, -2.4, 0), (0.03, 1.58, 1.8, 15), (0.50, 1.68, -1.2, 0),
        (-0.34, 1.98, 2.6, 0), (0.18, 2.03, -2.9, 15), (-0.92, 2.14, 1.4, 0),
        (0.52, 2.24, -0.8, 15), (-0.07, 2.33, 2.2, 0),
    ]
    WALL_Y = 1.75
    Y_TEXT = 1.7420          # 文字基面: 纸面(1.7444)之前, 金线(1.7426)之前
    for i, (x, z, tilt, _curl) in enumerate(AWARDS, 1):
        ry = math.radians(tilt)
        base = Matrix.Translation((x, Y_TEXT, z)) @ _rot_y(ry)
        # 标题 "奖 状": 金框内顶部 (h=0.28, 顶部金线在 +0.126)
        t = _text_obj(f"prop_award_{i:02d}_text", "奖 状", font, 0.042, M_red)
        t.matrix_world = base @ Matrix.Translation((0.0, 0.0, 0.096)) @ _face_neg_y()
        texts.append(t)
        # 两条装饰线 (标题下方, 红)
        for sfx, dx in (("l", -0.037), ("r", 0.037)):
            ln = common.box(f"prop_award_{i:02d}_line_{sfx}", (0, 0, 0),
                            (0.052, 0.0012, 0.0045), M_red)
            ln.matrix_world = base @ Matrix.Translation((dx, 0.0, 0.058))
            texts.append(ln)

    # 挂历: 红区 "2026" 黑字 + 日期小表 7 列 x 5 行 (1..31)
    CX, CZ = 0.85, 1.75
    PH = 0.62
    TOP_Z = CZ + PH / 2 + 0.012            # 2.082, 与 prop_wall.py 一致
    Y_BLK = WALL_Y - 0.0152                # 1.7348 色块层; 前面 1.7338
    y_txt = 1.7336
    t = _text_obj("prop_calendar_year_text", "2026", font, 0.050, M_blk)
    t.matrix_world = Matrix.Translation((CX, y_txt, TOP_Z - 0.052)) @ _face_neg_y()
    texts.append(t)
    row_z0, row_step = 1.660, 0.016
    col_x0, col_step = 0.672, 0.0455
    for d in range(1, 32):
        r, c = divmod(d - 1, 7)
        t = _text_obj(f"prop_calendar_day_{d:02d}", str(d), font, 0.009, M_blk)
        t.matrix_world = Matrix.Translation(
            (col_x0 + c * col_step, y_txt, row_z0 - r * row_step)) @ _face_neg_y()
        texts.append(t)

    # FONT 对象转 MESH (才能进 UV2/烘焙)
    if texts:
        bpy.ops.object.select_all(action='DESELECT')
        for ob in texts:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = texts[0]
        bpy.ops.object.convert(target='MESH')
    print(f"[text] chinese text objects: {len(texts)} (font={'OK' if font else 'MISSING'})")
    return font is not None


# ---------- GLB 材质重建表（名称 → 程序化节点工厂） ----------
def _mat_wood(name, dark=False, old=True):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexNoise"); tex.inputs["Scale"].default_value = 5.0
    tex.inputs["Detail"].default_value = 3.0; tex.inputs["Roughness"].default_value = 0.7
    wave = nt.nodes.new("ShaderNodeTexWave"); wave.wave_type = 'BANDS'; wave.bands_direction = 'X'
    wave.inputs["Scale"].default_value = 3.5; wave.inputs["Distortion"].default_value = 6.0
    wave.inputs["Detail"].default_value = 4.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    if dark:
        ramp.color_ramp.elements[0].color = (0.05, 0.02, 0.01, 1)
        ramp.color_ramp.elements[1].color = (0.22, 0.10, 0.05, 1)
    elif old:
        ramp.color_ramp.elements[0].color = (0.10, 0.05, 0.02, 1)
        ramp.color_ramp.elements[1].color = (0.42, 0.24, 0.11, 1)
    else:
        ramp.color_ramp.elements[0].color = (0.2, 0.1, 0.05, 1)
        ramp.color_ramp.elements[1].color = (0.5, 0.32, 0.18, 1)
    nt.links.new(wave.outputs["Color"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.75
    return m


def _mat_flat(name, color, rough=0.8):
    return common.principled(name, color, rough)


def _mat_weave(name, c1, c2, scale=180.0):
    """双向 Wave 交叉织物纹（低对比）"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    wx = nt.nodes.new("ShaderNodeTexWave"); wx.wave_type = 'BANDS'; wx.bands_direction = 'X'; wx.inputs["Scale"].default_value = scale
    wy = nt.nodes.new("ShaderNodeTexWave"); wy.wave_type = 'BANDS'; wy.bands_direction = 'Y'; wy.inputs["Scale"].default_value = scale
    mix = nt.nodes.new("ShaderNodeMixRGB"); mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*c1, 1)
    ramp.color_ramp.elements[1].color = (*c2, 1)
    nt.links.new(wx.outputs["Color"], mix.inputs[1])
    nt.links.new(wy.outputs["Color"], mix.inputs[2])
    nt.links.new(mix.outputs[0], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.92
    return m


def _mat_blanket(name):
    """土红花布底 + 程序化碎花点"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    vor = nt.nodes.new("ShaderNodeTexVoronoi"); vor.distance = 'EUCLIDEAN'
    vor.inputs["Scale"].default_value = 28.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.32
    ramp.color_ramp.elements[0].color = (0.45, 0.10, 0.08, 1)   # 花点米底
    ramp.color_ramp.elements[1].color = (0.55, 0.14, 0.10, 1)   # 红布底
    nt.links.new(vor.outputs["Distance"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    return m


# 材质名（GLB 导入后可能带 .001 后缀，匹配去后缀名）→ 工厂
MAT_REBUILD = {
    "prop_wood_old":      lambda: _mat_wood("prop_wood_old", old=True),
    "prop_bed_wood_old":  lambda: _mat_wood("prop_bed_wood_old", old=True),
    "tv_wood_old":        lambda: _mat_wood("tv_wood_old", old=False),
    "tv_wood_dark":       lambda: _mat_wood("tv_wood_dark", dark=True),
    "wall_wood":          lambda: _mat_wood("wall_wood", old=True),
    "wall_red":           lambda: _mat_flat("wall_red", (0.52, 0.06, 0.04), 0.6),
    "wall_paper":         lambda: _mat_flat("wall_paper", (0.86, 0.81, 0.66), 0.92),
    "mat_weave":          lambda: _mat_weave("mat_weave", (0.42, 0.44, 0.48), (0.56, 0.58, 0.60)),
    "mattress_plaid":     lambda: _mat_weave("mattress_plaid", (0.40, 0.44, 0.52), (0.55, 0.58, 0.62), 90.0),
    "bamboo":             lambda: _mat_flat("bamboo", (0.58, 0.52, 0.26), 0.65),
    "pillow_cloth":       lambda: _mat_flat("pillow_cloth", (0.86, 0.84, 0.76), 0.95),
    "blanket_flower":     lambda: _mat_blanket("blanket_flower"),
}


def _rebuild_materials():
    rebuilt = 0
    for m in list(bpy.data.materials):
        base = m.name.split(".")[0]
        fac = MAT_REBUILD.get(base)
        if not fac:
            continue
        # 仅补救"变白/变灰"的材质：Base Color 接近中性灰白(默认 0.8)才重建，有色材质不动
        try:
            bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            col = bsdf.inputs["Base Color"].default_value
            spread = max(col[0], col[1], col[2]) - min(col[0], col[1], col[2])
            is_neutral = col[0] > 0.7 and col[1] > 0.7 and col[2] > 0.7 and spread < 0.08
        except Exception:
            is_neutral = True
        if not is_neutral:
            continue
        users = [o for o in bpy.data.objects if o.type == 'MESH' and base in [s.material.name.split(".")[0] for s in o.material_slots if s.material]]
        newm = fac()
        newm.name = base  # 夺走原名, 旧材质变成 .001 闲置
        for ob in users:
            for slot in ob.material_slots:
                if slot.material and slot.material.name.split(".")[0] == base:
                    slot.material = newm
        rebuilt += 1
        print(f"[assemble] material rebuilt: {base} (users={len(users)})")
    print(f"[assemble] materials rebuilt: {rebuilt}/{len(MAT_REBUILD)}")


def build(env):
    env['clean']()
    sc = bpy.context.scene

    # ---------- 导入 room.glb + manifest.props (outside 也导入, 随后整体删除) ----------
    with open(os.path.join(V1, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    _import_glb(os.path.join(V1, manifest.get("glb", "room.glb")))
    for p in manifest.get("props", []):
        glb = os.path.join(V1, "props", p + ".glb")
        if os.path.exists(glb):
            _import_glb(glb)
        else:
            print(f"[assemble] WARN missing prop glb: {glb}")

    # ---------- 删除外景 + M2 占位盒; 隐藏 sky_plane ----------
    n_del = 0
    for ob in list(bpy.data.objects):
        if ob.name.startswith(STATIC_EXCLUDE_PREFIX) or ob.name.endswith("_stub"):
            bpy.data.objects.remove(ob, do_unlink=True)
            n_del += 1
    sky = bpy.data.objects.get("sky_plane")
    if sky:
        sky.hide_render = True
        sky.hide_set(True)
    print(f"[assemble] deleted outside/stub objects: {n_del}; sky_plane hidden")

    # ---------- 修补: wall_right join 时漏挂材质 -> 补石灰白墙材质 ----------
    wr = bpy.data.objects.get("wall_right")
    if wr and len(wr.data.materials) == 0:
        m = common.principled("m5_lime_repair", (0.93, 0.91, 0.86), 0.95)
        wr.data.materials.append(m)
        print("[assemble] repair: wall_right material -> m5_lime_repair")

    # ---------- 修补: GLB 往返丢程序化材质(Base Color 变白) -> 按材质名重建 ----------
    _rebuild_materials()

    # ---------- 中文文字 (奖状/挂历) ----------
    font_ok = add_chinese_text()

    # ---------- 收集静态网格 ----------
    static, excluded = [], []
    for ob in bpy.data.objects:
        if ob.type != 'MESH':
            continue
        (excluded if is_excluded(ob) else static).append(ob)
    static.sort(key=lambda o: o.name)

    groups = {}
    for ob in static:
        groups.setdefault(atlas_group(ob.name), []).append(ob)

    print(f"[assemble] static meshes: {len(static)}  excluded: {len(excluded)}")
    for g, objs in sorted(groups.items()):
        print(f"[assemble]   group {g:10s}: {len(objs)} meshes")
    common.tris_report(static, label="static set")
    print(f"[assemble] font_ok={font_ok}")

    return {"static": static, "excluded": excluded, "groups": groups,
            "font_ok": font_ok, "ROOT": ROOT, "OUT": env['OUT']}
