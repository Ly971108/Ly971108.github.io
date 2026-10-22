# tools/blender/room_shell.py — M2 白模房间（内空 4.0 × 3.5 × 2.8，原点=地面中心）
import bpy
import os
import json
import math
from mathutils import Matrix
import common


def build(env):
    env['clean']()
    sc = bpy.context.scene
    ROOT = env['ROOT']
    M = common.white_model_kit()

    W, D, H = 4.0, 3.5, 2.8      # 内空 宽X 深Y 高Z
    T = 0.12                     # 墙厚
    EXT_W, EXT_D = W + 2 * T, D + 2 * T

    # ---------- 地板 / 顶棚 ----------
    common.box("floor", (0, 0, -0.05), (EXT_W, EXT_D, 0.10), M['cement'])
    common.box("ceiling", (0, 0, H + 0.05), (EXT_W, EXT_D, 0.10), M['wood'])

    # ---------- 后墙 / 左墙 ----------
    common.box("wall_back", (0, D / 2 + T / 2, H / 2), (EXT_W, T, H), M['lime'])
    common.box("wall_left", (-W / 2 - T / 2, 0, H / 2), (T, EXT_D, H), M['lime'])

    # ---------- 右墙：窗洞 1.2 宽(y) × 1.4 高(z)，窗台 0.9，4 段 box 拼接 ----------
    win_w, win_h, sill = 1.2, 1.4, 0.9
    y_side_len = EXT_D / 2 - win_w / 2          # 窗洞一侧墙段长
    y_side_c = -(win_w / 2 + y_side_len / 2)    # 侧段中心
    segs = [
        common.box("_wr_bot",  (W / 2 + T / 2, 0, sill / 2), (T, EXT_D, sill)),
        common.box("_wr_top",  (W / 2 + T / 2, 0, sill + win_h + (H - sill - win_h) / 2),
                   (T, EXT_D, H - sill - win_h)),
        common.box("_wr_neg",  (W / 2 + T / 2, y_side_c, sill + win_h / 2), (T, y_side_len, win_h)),
        common.box("_wr_pos",  (W / 2 + T / 2, -y_side_c, sill + win_h / 2), (T, y_side_len, win_h)),
    ]
    common.join(segs, "wall_right")

    # ---------- 窗框（合并为 window_frame） ----------
    fw = 0.06
    frame = [
        common.box("_wf_t", (W / 2, 0, sill + win_h), (0.16, win_w + 2 * fw, fw), M['wood']),
        common.box("_wf_b", (W / 2, 0, sill), (0.16, win_w + 2 * fw, fw), M['wood']),
        common.box("_wf_l", (W / 2, -win_w / 2, sill + win_h / 2), (0.16, fw, win_h), M['wood']),
        common.box("_wf_r", (W / 2, win_w / 2, sill + win_h / 2), (0.16, fw, win_h), M['wood']),
    ]
    common.join(frame, "window_frame")

    # ---------- 顶棚木梁 3 根（沿 X 横跨） ----------
    for i, y in enumerate((-D / 4, 0.0, D / 4), start=1):
        common.box(f"beam_{i}", (0, y, H - 0.09), (EXT_W, 0.12, 0.18), M['wood'])

    # ---------- 拉线灯泡（梁下 y=0） ----------
    bulb_parts = [
        common.uv_sphere("bulb_glass", (0, 0, 2.15), 0.055, M['bulb']),
        common.cylinder("bulb_base", (0, 0, 2.22), 0.020, 0.05, M['metal'], vertices=12),
    ]
    common.join(bulb_parts, "bulb")
    # 灯线：原点移到线顶（枢轴），顶部留空 0.17 方便单摆动画不穿梁
    wire = common.cylinder("bulb_wire", (0, 0, 0), 0.006, 0.25, M['metal'], vertices=8)
    wire.data.transform(Matrix.Translation((0, 0, -0.125)))
    wire.location = (0, 0, 2.45)

    # ---------- 窗外夜空占位（法线朝 -X，面向室内） ----------
    common.plane("sky_plane", (3.4, 0, 1.6), 8.0, M['sky'], rotation=(0, math.radians(-90), 0))

    # ---------- 道具占位（box，M3 精模替换） ----------
    common.box("desk_stub",  (-0.75, -0.35, 0.375), (1.00, 0.60, 0.75), M['wood'])   # 课桌 中央偏左
    common.box("fan_stub",   (1.45, 0.85, 0.65),  (0.42, 0.42, 1.30), M['grey'])    # 风扇 右侧前部（避开窗 y∈[-0.6,0.6] 与门角→TV 视线）
    common.box("tv_stand_stub", (0.0, 1.50, 0.325), (0.60, 0.45, 0.65), M['wood'])  # TV 桌 后墙
    common.box("tv_stub",    (0.0, 1.48, 0.95),    (0.72, 0.50, 0.60), M['wood'])    # 电视 后墙
    common.box("bench_stub", (-1.25, 1.50, 0.275), (1.20, 0.42, 0.55), M['wood'])    # 收录机条几 后墙左侧

    # ---------- 灯光：暖光点光（置于灯泡玻璃下方，避免被自包围网格挡光） + 冷色环境 ----------
    env['add_light']('POINT', (0, 0, 2.04), energy=120,
                     color=(1.0, 0.72, 0.45), shadow_soft_size=0.08)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.15, 0.16, 0.19, 1.0)
    bg.inputs[1].default_value = 0.55
    sc.world = world

    # ---------- 相机：门角 -> 后墙电视方向，35mm ----------
    cam = env['add_camera']((-1.7, -1.6, 1.7), (0.55, 0.75, 1.05), lens=28)

    # ---------- 评审静帧 Eevee 960×540 ----------
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 960
    sc.render.resolution_y = 540
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(env['OUT'], "room_white.png")
    bpy.ops.render.render(write_still=True)
    print("[render]", sc.render.filepath)

    # ---------- QA 全景帧（检查窗洞/梁/灯泡/夜空，相机不入 GLB） ----------
    qa_cam = env['add_camera']((-1.5, -1.55, 2.2), (0.8, 0.5, 1.5), lens=24)
    sc.render.filepath = os.path.join(env['OUT'], "room_qa.png")
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(qa_cam, do_unlink=True)
    sc.camera = cam
    print("[render]", sc.render.filepath)

    # ---------- 导出 GLB（仅网格，不含相机/灯光） ----------
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    glb_path = os.path.join(ROOT, "assets", "scene", "v0001", "room.glb")
    common.export_glb(glb_path, objects=meshes)
    common.tris_report(meshes, label="room.glb")

    # ---------- manifest ----------
    vdir = os.path.join(ROOT, "assets", "scene", "v0001")
    os.makedirs(vdir, exist_ok=True)
    manifest = {"version": "v0001", "glb": "room.glb", "atlases": [], "props": []}
    with open(os.path.join(vdir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("[manifest]", os.path.join(vdir, "manifest.json"))
