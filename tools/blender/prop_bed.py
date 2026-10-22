# tools/blender/prop_bed.py — M4 道具 wave2：木床铺 + 蚊帐 + 凉席 + 枕头 + 薄毯 + 床底木箱
# 床贴左墙(x=-2.0)放，床头朝后墙(y=+1.75)，床面 z=0.45
# 入口: blender -b -P tools/blender/main.py -- prop_bed
import bpy
import os
import math
from mathutils import Vector
import common

# 床体占位（与 room_shell 布局一致）
BX0, BX1 = -1.95, -0.60          # x 范围（宽 1.35）
BY0, BY1 = 0.20, 2.10            # y 范围（长 1.90，BY1 端为床头）
BED_TOP = 0.45                   # 床面高
BCX, BCY = (BX0 + BX1) / 2, (BY0 + BY1) / 2

# 蚊帐几何参数
NET_TOP = 2.02                   # 帐顶高（竹竿下）
NET_BOT = 0.42                   # 帐底高（垂到床面）
FLARE = math.radians(10.0)       # 底缘外撇 10°
NET_TX0, NET_TX1 = BX0 - 0.04, BX1 + 0.04   # 帐顶矩形
NET_TY0, NET_TY1 = BY0 + 0.02, BY1 + 0.02


# ---------------- 程序化材质（局部 helper，不改动 common.py） ----------------

def wood_old_mat():
    """旧木架床：灰旧棕，Wave 条纹 + Noise 扰动 + Bump。"""
    m = bpy.data.materials.new("prop_bed_wood_old")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 0.74
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'X'
    wave.inputs["Scale"].default_value = 7.0
    wave.inputs["Distortion"].default_value = 2.0
    wave.inputs["Detail"].default_value = 3.0
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = '3D'
    noise.inputs["Scale"].default_value = 3.2
    noise.inputs["Detail"].default_value = 4.0
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = 'MULTIPLY'
    mix.inputs["Fac"].default_value = 0.55
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.26, 0.185, 0.105, 1)
    ramp.color_ramp.elements[1].color = (0.44, 0.325, 0.19, 1)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.22
    bump.inputs["Distance"].default_value = 0.02
    nt.links.new(tc.outputs["Generated"], wave.inputs["Vector"])
    nt.links.new(tc.outputs["Generated"], noise.inputs["Vector"])
    nt.links.new(wave.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], mix.inputs[1])
    nt.links.new(noise.outputs["Fac"], mix.inputs[2])
    nt.links.new(mix.outputs["Color"], bs.inputs["Base Color"])
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    nt.links.new(bs.outputs[0], out.inputs[0])
    return m


def bamboo_mat():
    """竹竿：青黄竹色，细竖纹 + 竹节 Bump。"""
    m = bpy.data.materials.new("prop_bed_bamboo")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 0.55
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs["Scale"].default_value = 60.0
    wave.inputs["Distortion"].default_value = 1.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.44, 0.47, 0.20, 1)
    ramp.color_ramp.elements[1].color = (0.68, 0.66, 0.34, 1)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.18
    bump.inputs["Distance"].default_value = 0.008
    nt.links.new(tc.outputs["Generated"], wave.inputs["Vector"])
    nt.links.new(wave.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
    nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    nt.links.new(bs.outputs[0], out.inputs[0])
    return m


def plaid_mattress_mat():
    """褥子：土布蓝灰格纹 = Wave X × Wave Y 交叉，粗布感。"""
    m = bpy.data.materials.new("prop_bed_mattress_plaid")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 0.95
    tc = nt.nodes.new("ShaderNodeTexCoord")
    base = (0.47, 0.51, 0.53, 1)
    line = (0.30, 0.35, 0.39, 1)
    waves = []
    for direction in ('X', 'Y'):
        w = nt.nodes.new("ShaderNodeTexWave")
        w.wave_type = 'BANDS'
        w.bands_direction = direction
        w.inputs["Scale"].default_value = 5.5
        w.inputs["Distortion"].default_value = 0.6
        w.inputs["Detail"].default_value = 2.0
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.interpolation = 'CONSTANT'
        ramp.color_ramp.elements[0].position = 0.10
        ramp.color_ramp.elements[0].color = line
        e1 = ramp.color_ramp.elements[1]
        e1.position = 0.20
        e1.color = base
        nt.links.new(tc.outputs["Generated"], w.inputs["Vector"])
        nt.links.new(w.outputs["Fac"], ramp.inputs["Fac"])
        waves.append(ramp)
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = 'MULTIPLY'
    mix.inputs["Fac"].default_value = 1.0
    nt.links.new(waves[0].outputs["Color"], mix.inputs[1])
    nt.links.new(waves[1].outputs["Color"], mix.inputs[2])
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 45.0
    noise.inputs["Detail"].default_value = 2.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    bump.inputs["Distance"].default_value = 0.004
    nt.links.new(tc.outputs["Generated"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    nt.links.new(mix.outputs["Color"], bs.inputs["Base Color"])
    nt.links.new(bs.outputs[0], out.inputs[0])
    return m


def mat_weave_mat():
    """凉席：竹篾青黄，细密横纹 + 强 Bump。"""
    m = bpy.data.materials.new("prop_bed_mat_weave")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 0.62
    tc = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Y'
    wave.inputs["Scale"].default_value = 110.0
    wave.inputs["Distortion"].default_value = 0.4
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.52, 0.55, 0.26, 1)
    ramp.color_ramp.elements[1].color = (0.74, 0.72, 0.42, 1)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.45
    bump.inputs["Distance"].default_value = 0.003
    nt.links.new(tc.outputs["Generated"], wave.inputs["Vector"])
    nt.links.new(wave.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    nt.links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
    nt.links.new(bs.outputs[0], out.inputs[0])
    return m


def pillow_mat():
    """白布套微黄：白 + 微 Noise 黄渍。"""
    m = bpy.data.materials.new("prop_bed_pillow_cloth")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 0.92
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 4.0
    noise.inputs["Detail"].default_value = 3.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.78, 0.75, 0.63, 1)
    ramp.color_ramp.elements[1].color = (0.94, 0.92, 0.83, 1)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.15
    bump.inputs["Distance"].default_value = 0.006
    nt.links.new(tc.outputs["Generated"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    nt.links.new(bs.outputs[0], out.inputs[0])
    return m


def blanket_mat():
    """薄毯：土红花布 + 程序化小花点（Noise -> ColorRamp 锐边随机点）。"""
    m = bpy.data.materials.new("prop_bed_blanket_flower")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Roughness"].default_value = 0.9
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 14.0
    noise.inputs["Detail"].default_value = 1.5
    noise.inputs["Roughness"].default_value = 0.7
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = 'CONSTANT'
    e0 = ramp.color_ramp.elements[0]
    e0.position = 0.30
    e0.color = (0.48, 0.155, 0.115, 1)        # 土红花布底
    e1 = ramp.color_ramp.elements[1]
    e1.position = 0.46
    e1.color = (0.62, 0.235, 0.16, 1)
    e2 = ramp.color_ramp.elements.new(0.60)
    e2.color = (0.86, 0.72, 0.50, 1)          # 米色小花点
    e3 = ramp.color_ramp.elements.new(0.70)
    e3.color = (0.48, 0.155, 0.115, 1)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.2
    bump.inputs["Distance"].default_value = 0.005
    nt.links.new(tc.outputs["Generated"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    nt.links.new(bs.outputs[0], out.inputs[0])
    return m


def net_mat():
    """蚊帐白纱：alpha 0.35，细密 Wave 网格暗示纱眼，高频 Bump。"""
    m = bpy.data.materials.new("prop_bed_net_gauze")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Base Color"].default_value = (0.97, 0.97, 0.99, 1)
    bs.inputs["Roughness"].default_value = 0.85
    bs.inputs["Alpha"].default_value = 0.22
    tc = nt.nodes.new("ShaderNodeTexCoord")
    bumps = []
    for direction in ('X', 'Y'):
        w = nt.nodes.new("ShaderNodeTexWave")
        w.wave_type = 'BANDS'
        w.bands_direction = direction
        w.inputs["Scale"].default_value = 220.0
        w.inputs["Distortion"].default_value = 0.0
        bumps.append(w.outputs["Fac"])
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = 'MULTIPLY'
    mix.inputs["Fac"].default_value = 1.0
    nt.links.new(bumps[0], mix.inputs[1])
    nt.links.new(bumps[1], mix.inputs[2])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.3
    bump.inputs["Distance"].default_value = 0.0015
    nt.links.new(tc.outputs["Generated"], bumps[0].node.inputs["Vector"])
    nt.links.new(tc.outputs["Generated"], bumps[1].node.inputs["Vector"])
    nt.links.new(mix.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bs.inputs["Normal"])
    nt.links.new(bs.outputs[0], out.inputs[0])
    try:
        m.surface_render_method = 'DITHERED'      # Blender 4.2+/5.x
    except Exception:
        try:
            m.blend_method = 'BLEND'
        except Exception:
            pass
    if hasattr(m, "use_transparency_overlap"):
        m.use_transparency_overlap = False
    m.use_backface_culling = True                 # 单面围筒：背面剔除，看透帐内
    return m


# ---------------- 参数化网格 helper ----------------

def net_ring_point(u, level_t):
    """环周参数 u∈[0,4) -> 矩形点；level_t 0=底 1=顶。底缘外撇 10° + 自然褶皱。"""
    h = NET_TOP - NET_BOT
    off = h * math.tan(FLARE)                     # 底部外扩量
    # 矩形插值：顶矩形 -> 底矩形（外撇）
    tx0, tx1 = NET_TX0 - off, NET_TX1 + off
    ty0, ty1 = NET_TY0 - off, NET_TY1 + off
    bx, by = NET_TX0, NET_TX1
    by0, by1 = NET_TY0, NET_TY1
    x0 = tx0 + (bx - tx0) * level_t
    x1 = tx1 + (by - tx1) * level_t
    y0 = ty0 + (by0 - ty0) * level_t
    y1 = ty1 + (by1 - ty1) * level_t
    s = u % 4.0
    if s < 1.0:   p = (x0 + (x1 - x0) * s, y0)
    elif s < 2.0: p = (x1, y0 + (y1 - y0) * (s - 1.0))
    elif s < 3.0: p = (x1 - (x1 - x0) * (s - 2.0), y1)
    else:         p = (x0, y1 - (y1 - y0) * (s - 3.0))
    # 布褶：幅度随向下增大，顶缘收 0 以便与帐顶缝合
    cx, cy = (NET_TX0 + NET_TX1) / 2, (NET_TY0 + NET_TY1) / 2
    dx, dy = p[0] - cx, p[1] - cy
    L = math.hypot(dx, dy) or 1.0
    amp = 0.055 * (1.0 - level_t) ** 1.2
    fold = amp * math.sin(u * 2 * math.pi * 2.0 + level_t * 1.2)
    return (p[0] + dx / L * fold, p[1] + dy / L * fold)


def build_net(mat):
    """独立蚊帐 mesh：单面围筒 + 顶盖网格拼接；顶前沿掀开一角（固定造型）。

    M6 动画：顶点组 net_sway（底部权重 1、顶部 0），顶点动画轻摆本 mesh。
    """
    NU, NV = 48, 9                  # 环周分段 / 竖向分段
    verts, faces = [], []

    # --- 围筒 ---
    for j in range(NV + 1):
        t = j / NV                    # 0 底 -> 1 顶
        z = NET_BOT + (NET_TOP - NET_BOT) * t
        for i in range(NU):
            x, y = net_ring_point(i / NU * 4.0, t)
            verts.append((x, y, z))
    for j in range(NV):
        for i in range(NV * 0 + NU):
            a = j * NU + i
            b = j * NU + (i + 1) % NU
            c = (j + 1) * NU + (i + 1) % NU
            d = (j + 1) * NU + i
            faces.append((a, b, c, d))

    # --- 顶盖：NX×NY 网格，边缘点与围筒顶环一致 ---
    NX, NY = 12, 12
    top_start = len(verts)
    lift_c = (NET_TX1, NET_TY0)       # 掀开角：前沿靠右(x大, y小)
    lift_R = 0.72
    lift_H = 0.50
    ccx, ccy = (NET_TX0 + NET_TX1) / 2, (NET_TY0 + NET_TY1) / 2
    for j in range(NY + 1):
        fy = j / NY
        for i in range(NX + 1):
            fx = i / NX
            # 顶环对应的参数位置（含褶皱=0）
            x = NET_TX0 + (NET_TX1 - NET_TX0) * fx
            y = NET_TY0 + (NET_TY1 - NET_TY0) * fy
            z = NET_TOP
            # 掀角：靠近 lift_c 的顶点抬升 + 向床内回拉（折回造型）
            d = math.hypot(x - lift_c[0], y - lift_c[1])
            w = max(0.0, (lift_R - d) / lift_R)
            w = w * w * (3 - 2 * w)               # smoothstep
            z += lift_H * w ** 1.3
            x += (ccx - x) * 0.30 * w
            y += (ccy + 0.10 - y) * 0.30 * w
            verts.append((x, y, z))
    for j in range(NY):
        for i in range(NX):
            a = top_start + j * (NX + 1) + i
            faces.append((a, a + 1, a + NX + 2, a + NX + 1))

    me = bpy.data.meshes.new("prop_bed_net_mesh")
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new("prop_bed_net", me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)

    # 顶点组：底部自由摆、顶部固定（M6 顶点动画权重）
    vg = ob.vertex_groups.new(name="net_sway")
    for j in range(NV + 1):
        t = j / NV
        w = (1.0 - t) ** 2            # 顶 0 -> 底 1
        vg.add(range(j * NU, (j + 1) * NU), w, 'REPLACE')
    # 顶盖固定权重 0
    vg.add(range(top_start, len(verts)), 0.0, 'REPLACE')
    ob["m6_anim"] = "vertex_sway:net_sway(amplitude 0.02~0.03, 底部权重1顶部0)"
    return ob


def build_blanket(mat):
    """床尾薄毯：32×12 网格，平面带 3-4 个柔波，沿 x=-0.62 边自然垂下。"""
    NU, NV = 32, 12
    y0, y1 = BY0 + 0.12, BY0 + 0.12 + 0.85     # 毯长沿 y
    edge_x = -0.62                              # 垂下床沿的折线
    verts = []
    for j in range(NV + 1):
        v = j / NV                               # 0 内端 -> 1 下垂末端
        for i in range(NU + 1):
            u = i / NU
            y = y0 + (y1 - y0) * u
            wave = math.sin(u * 2 * math.pi * 3.5 + v * 1.5)
            if v < 0.62:                         # 平铺段
                x = -0.98 + v / 0.62 * 0.36
                z = BED_TOP + 0.066 + 0.012 * wave
            elif v < 0.75:                       # 过床沿圆角
                s = (v - 0.62) / 0.13
                a = s * math.pi / 2
                x = edge_x + 0.045 * math.sin(a) + 0.006 * wave
                z = BED_TOP + 0.066 - 0.045 * (1 - math.cos(a))
            else:                                # 下垂段
                t = (v - 0.75) / 0.25
                x = edge_x + 0.045 - 0.03 * math.sin(t * math.pi) + 0.008 * wave
                z = BED_TOP + 0.021 - (BED_TOP - 0.055) * t
            verts.append((x, y, z))
    faces = []
    for j in range(NV):
        for i in range(NU):
            a = j * (NU + 1) + i
            faces.append((a, a + NU + 1, a + NU + 2, a + 1))   # 上表面法线朝上
    me = bpy.data.meshes.new("prop_bed_blanket_mesh")
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new("prop_bed_blanket", me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    sol = ob.modifiers.new("cloth_thin", 'SOLIDIFY')
    sol.thickness = 0.004
    return ob


# ---------------- build ----------------

def build(env):
    env['clean']()
    sc = bpy.context.scene
    ROOT = env['ROOT']

    # ===== 材质 =====
    Mwood = wood_old_mat()
    Mbamboo = bamboo_mat()
    Mplaid = plaid_mattress_mat()
    Mweave = mat_weave_mat()
    Mpillow = pillow_mat()
    Mred = common.principled("prop_bed_pillow_piping_red", (0.66, 0.10, 0.08), 0.8)
    Mblanket = blanket_mat()
    Mnet = net_mat()

    # ===== 1. 木架床 =====
    leg_t = 0.09
    leg_h = 0.46
    leg_pos = [(BX0 + leg_t / 2, BY0 + leg_t / 2), (BX1 - leg_t / 2, BY0 + leg_t / 2),
               (BX0 + leg_t / 2, BY1 - leg_t / 2), (BX1 - leg_t / 2, BY1 - leg_t / 2)]
    for i, (lx, ly) in enumerate(leg_pos):
        common.box(f"prop_bed_leg_{i+1}", (lx, ly, leg_h / 2), (leg_t, leg_t, leg_h), Mwood)

    # 侧帮（沿 y）
    for i, lx in enumerate((BX0 + leg_t / 2, BX1 - leg_t / 2)):
        common.box(f"prop_bed_side_rail_{i+1}", (lx, BCY, 0.415),
                   (leg_t, (BY1 - BY0) - 2 * leg_t, 0.09), Mwood)

    # 床板 5 块横板（沿 x 横跨）
    n_board = 5
    inner_y0, inner_y1 = BY0 + leg_t, BY1 - leg_t
    bw = (inner_y1 - inner_y0) / n_board
    for i in range(n_board):
        by = inner_y0 + bw * (i + 0.5)
        common.box(f"prop_bed_board_{i+1}", (BCX, by, 0.445),
                   (BX1 - BX0 - 2 * leg_t - 0.02, bw - 0.015, 0.02), Mwood)

    # 床头板 0.9 高（朴素竖条板，床头 = 后墙侧 BY1）
    hb_y = BY1 - leg_t / 2
    common.box("prop_bed_head_toprail", (BCX, hb_y, 0.86),
               (BX1 - BX0 - 2 * leg_t, 0.035, 0.08), Mwood)
    common.box("prop_bed_head_midrail", (BCX, hb_y, 0.50),
               (BX1 - BX0 - 2 * leg_t, 0.03, 0.05), Mwood)
    n_slats = 7
    slat_w = (BX1 - BX0 - 2 * leg_t) / n_slats
    for i in range(n_slats):
        sx = BX0 + leg_t + slat_w * (i + 0.5)
        common.box(f"prop_bed_head_slat_{i+1}", (sx, hb_y, 0.68),
                   (slat_w - 0.02, 0.022, 0.32), Mwood)
    # 床头板两侧立柱（床腿向上延伸段）
    for i, lx in enumerate((BX0 + leg_t / 2, BX1 - leg_t / 2)):
        common.box(f"prop_bed_head_post_{i+1}", (lx, hb_y, 0.68),
                   (leg_t, leg_t, 0.44), Mwood)

    # 床尾板 0.5 高
    fb_y = BY0 + leg_t / 2
    common.box("prop_bed_foot_toprail", (BCX, fb_y, 0.47),
               (BX1 - BX0 - 2 * leg_t, 0.035, 0.07), Mwood)
    for i in range(3):
        sx = BX0 + leg_t + (BX1 - BX0 - 2 * leg_t) * (i + 0.5) / 3
        common.box(f"prop_bed_foot_slat_{i+1}", (sx, fb_y, 0.32),
                   ((BX1 - BX0 - 2 * leg_t) / 3 - 0.03, 0.022, 0.22), Mwood)

    # ===== 2. 褥子（薄 box 0.06 厚，蓝灰格纹） =====
    mx0, mx1 = BX0 + leg_t + 0.02, BX1 - leg_t - 0.02
    my0, my1 = inner_y0 + 0.02, inner_y1 - 0.02
    mattress = common.box("prop_bed_mattress", ((mx0 + mx1) / 2, (my0 + my1) / 2, BED_TOP + 0.03),
                          (mx1 - mx0, my1 - my0, 0.06), Mplaid)
    bev = mattress.modifiers.new("soft_edge", 'BEVEL')
    bev.width = 0.015
    bev.segments = 2

    # ===== 3. 凉席（床尾半幅，比褥子低 0.005） =====
    cool_y1 = my0 + (my1 - my0) * 0.52
    cool = common.box("prop_bed_coolmat", ((mx0 + mx1) / 2, (my0 + cool_y1) / 2, BED_TOP + 0.0565),
                      (mx1 - mx0 - 0.02, cool_y1 - my0 - 0.02, 0.008), Mweave)
    bev2 = cool.modifiers.new("edge_soft", 'BEVEL')
    bev2.width = 0.004
    bev2.segments = 1

    # ===== 4. 枕头 0.45×0.18×0.12（床头，白布微黄 + 红边线） =====
    pz = BED_TOP + 0.06 + 0.06
    pillow = common.box("prop_bed_pillow", (BCX, my1 - 0.16, pz),
                        (0.45, 0.18, 0.12), Mpillow)
    bev3 = pillow.modifiers.new("puffy", 'BEVEL')
    bev3.width = 0.035
    bev3.segments = 3
    # 红边线：中部稍大薄层（滚边效果）
    common.box("prop_bed_pillow_piping", (BCX, my1 - 0.16, pz),
               (0.452, 0.182, 0.020), Mred)

    # ===== 5. 薄毯（床尾搭毯，土红花布，垂下床沿） =====
    build_blanket(Mblanket)

    # ===== 6. 床底小木箱 0.5×0.35×0.3（偏房间一侧，相机可见） =====
    box_c = (BX1 - 0.22, 0.58, 0.15)
    chest = common.box("prop_bed_chest", box_c, (0.50, 0.35, 0.30), Mwood)
    bev4 = chest.modifiers.new("worn", 'BEVEL')
    bev4.width = 0.008
    bev4.segments = 1
    common.box("prop_bed_chest_lid", (box_c[0], box_c[1], 0.302),
               (0.52, 0.37, 0.024), Mwood)

    # ===== 7. 蚊帐（关键道具）：悬顶式 =====
    # 两根竹竿平行沿 Y，后端搭到后墙，前端探出帐前少许
    pole_z = NET_TOP + 0.018
    pole_len = (NET_TY1 - NET_TY0) + 0.20
    pole_cy = 1.79 - pole_len / 2
    for i, px in enumerate((NET_TX0 + 0.12, NET_TX1 - 0.12)):
        pole = common.cylinder(f"prop_bed_net_pole_{i+1}", (px, pole_cy, pole_z),
                               0.022, pole_len, Mbamboo, vertices=12)
        pole.rotation_euler.x = math.radians(90)
    net = build_net(Mnet)
    net.visible_shadow = False if hasattr(net, "visible_shadow") else True

    # ===== 灯光：临时暖光（M4 统一打光时删除） =====
    env['add_light']('POINT', (BCX + 1.3, BCY - 1.1, 2.2), energy=140,
                     color=(1.0, 0.73, 0.46), shadow_soft_size=0.12)
    env['add_light']('POINT', (BCX + 0.2, BCY + 0.4, 1.3), energy=22,
                     color=(1.0, 0.62, 0.38), shadow_soft_size=0.20)
    env['add_light']('POINT', (1.3, -0.9, 1.7), energy=35,
                     color=(0.58, 0.70, 1.0), shadow_soft_size=0.25)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.14, 0.15, 0.18, 1.0)
    bg.inputs[1].default_value = 0.65
    sc.world = world

    # ===== 相机：床尾 45° 视角看床 + 帐 + 凉席 =====
    cam = env['add_camera']((1.75, -1.85, 1.85),
                            (BCX + 0.05, BCY + 0.10, 0.85), lens=28)

    # ===== 渲染 960×540 =====
    try:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    except Exception:
        sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 960
    sc.render.resolution_y = 540
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(env['OUT'], "prop_bed.png")
    bpy.ops.render.render(write_still=True)
    print("[render]", sc.render.filepath)

    # ===== GLB 导出（仅 prop_bed_* mesh） =====
    meshes = [o for o in bpy.data.objects
              if o.type == 'MESH' and o.name.startswith("prop_bed")]
    glb_path = os.path.join(ROOT, "assets", "scene", "v0001", "props", "bed.glb")
    common.export_glb(glb_path, objects=meshes)
    common.tris_report(meshes, label="bed.glb")
