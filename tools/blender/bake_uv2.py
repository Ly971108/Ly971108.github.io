# tools/blender/bake_uv2.py — M5 UV2 生成 + 按图集组打包 + 写 uv2 映射 json
# v1: 每图集组一张贴图; 组内逐对象 Smart UV Project, 再按世界面积加权手工 shelf 打包
# 契约: blender -b -P main.py -- bake_uv2  (build(env) = assemble + uv2 全组)
import bpy
import os
import sys
import json
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assemble

UV2 = "UV2"
PAD = 0.01          # 图集内对象间留白
ATLAS_DIRNAME = "atlas"


def _unwrap_obj(ob):
    """单对象 Smart UV Project 到 UV2 层 (angle-based, island margin 0.02)。"""
    me = ob.data
    if UV2 not in me.uv_layers:
        me.uv_layers.new(name=UV2)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66.0),
                             island_margin=0.02, correct_aspect=True,
                             scale_to_bounds=False, area_weight=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def _uv_bbox(ob):
    uv = ob.data.uv_layers[UV2].data
    us = [v.uv[0] for v in uv]
    vs = [v.uv[1] for v in uv]
    return (min(us), min(vs)), (max(us), max(vs))


def _world_area(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    a = sum(p.area for p in me.polygons)
    ev.to_mesh_clear()
    return max(a, 1e-9)


def _pack_group(objs):
    """组内打包: 每对象 UV 簇按世界面积占比分配图集面积 (bbox 填充率预算 ~0.72),
    shelf 排布 + 90° 旋转优选朝向, 整体居中进 [PAD,1-PAD]。返回 bbox 列表。"""
    items = []
    total_area = 0.0
    for ob in objs:
        mn, mx = _uv_bbox(ob)
        area = _world_area(ob)
        bw, bh = mx[0] - mn[0], mx[1] - mn[1]
        items.append({"ob": ob, "mn": mn, "mx": mx, "bw": max(bw, 1e-6),
                      "bh": max(bh, 1e-6), "area": area})
        total_area += area
    budget = (1.0 - 2 * PAD) ** 2 * 0.72        # 十字/box 岛 bbox 填充率预算
    for it in items:
        share = it["area"] / max(total_area, 1e-9)
        it["s"] = math.sqrt(budget * share / (it["bw"] * it["bh"]))
    items.sort(key=lambda it: -max(it["bw"], it["bh"]) * it["s"])

    # shelf 排布 (尺寸 = UV bbox 宽高 * sqrt(area), 纵横比保持; 允许 90° 旋转选更优朝向)
    x = PAD
    y = PAD
    shelf_h = 0.0
    for it in items:
        w0, h0 = it["bw"] * it["s"], it["bh"] * it["s"]
        cands = [(w0, h0, False), (h0, w0, True)]
        best = None
        for cw, ch, rot in cands:
            if x + cw > 1.0 - PAD + 1e-9:
                continue
            cost = (max(shelf_h, ch), cw)      # 先压 shelf 高度, 再压宽度
            if best is None or cost < best[0]:
                best = (cost, cw, ch, rot)
        if best is None:                       # 当前 shelf 放不下, 开新 shelf
            x = PAD
            y += shelf_h + PAD
            shelf_h = 0.0
            cw, ch, rot = cands[0] if cands[0][0] <= cands[1][0] else cands[1]
            best = (None, cw, ch, rot)
        _, cw, ch, rot = best
        it["off"] = (x, y)
        it["wh"] = (cw, ch)
        it["rot"] = rot
        x += cw + PAD
        shelf_h = max(shelf_h, ch)
    ext_x = max(it["off"][0] + it["wh"][0] for it in items)
    ext_y = max(it["off"][1] + it["wh"][1] for it in items)

    # 整体归一化: 最大边贴 1-2*PAD, 居中
    lim = 1.0 - 2 * PAD
    g = 1.0 if max(ext_x, ext_y) <= lim else lim / max(ext_x, ext_y)
    tx = (1.0 - ext_x * g) / 2.0
    ty = (1.0 - ext_y * g) / 2.0

    boxes = []
    for it in items:
        k = it["s"] * g
        ox = it["off"][0] * g + tx
        oy = it["off"][1] * g + ty
        uv = it["ob"].data.uv_layers[UV2].data
        mnx, mny = it["mn"]
        if it["rot"]:          # 90° 旋转: (u,v) -> (vmax - v, u - umin), 落入正象限
            mxy = it["mx"][1]
            for v in uv:
                v.uv = (mxy - v.uv[1], v.uv[0] - mnx)
        for v in uv:
            v.uv = (v.uv[0] * k + ox, v.uv[1] * k + oy)
        boxes.append((ox, oy, it["wh"][0] * g, it["wh"][1] * g))
    return boxes


def _check_overlap(group, boxes):
    bad = 0
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            ax, ay, aw, ah = boxes[i]
            bx, by, bw, bh = boxes[j]
            ox = min(ax + aw, bx + bw) - max(ax, bx)
            oy = min(ay + ah, by + bh) - max(ay, by)
            if ox > 0.005 and oy > 0.005:
                bad += 1
                print(f"[uv2] WARN overlap in {group}: {boxes[i]} vs {boxes[j]}")
    if not bad:
        print(f"[uv2] group {group}: no bbox overlap ({len(boxes)} objects)")


def build_uv2(ctx, tex_size=512):
    """对 ctx['static'] 全量生成 UV2 并按组打包; 写 uv2_map.json。"""
    groups = ctx["groups"]
    for ob in ctx["static"]:
        _unwrap_obj(ob)
    print(f"[uv2] smart project done: {len(ctx['static'])} meshes")

    atlas_dir = os.path.join(assemble.V1, ATLAS_DIRNAME)
    os.makedirs(atlas_dir, exist_ok=True)
    mapping = {"version": "v0001", "uv_layer": UV2, "tex_size": tex_size, "atlases": {}}
    for g, objs in sorted(groups.items()):
        boxes = _pack_group(objs)
        _check_overlap(g, boxes)
        cov = sum(w * h for _, _, w, h in boxes)
        print(f"[uv2] packed {g}: {len(objs)} meshes bbox_coverage={cov * 100:.0f}%")
        mapping["atlases"][g] = {
            "size": tex_size,
            "meshes": sorted(o.name for o in objs),
        }
        print(f"[uv2] packed {g}: {len(objs)} meshes")
    jp = os.path.join(atlas_dir, "uv2_map.json")
    with open(jp, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)
    print(f"[uv2] mapping -> {jp}")
    return mapping


def build(env):
    ctx = assemble.build(env)
    build_uv2(ctx)
    return ctx
