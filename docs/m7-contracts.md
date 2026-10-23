# M7 氛围动画契约（anim.js）

## 入口
`initAnim({ scene, bakedState })` → `{ tick(dtMs, tMs) }`。main.js 每帧调 tick。
状态读 `window.__RM_STATE`（fan 0..3、lamp、sound）；`bakedState.lampState.value` 当前灯态。

## 必做项（全部由现有 mesh/材质驱动，禁止改几何）
1. **风扇**：`prop_fan_blades`（自转轴本地 Y）转速 = fan 档 × 5 rad/s（0 档缓停，用角速度趋近，不要瞬停）；`prop_fan_head` 摇头：fan>0 时绕关节慢扫 ±0.45 rad、周期 ~6s（fan 档越高摆速略快），0 档回中。
2. **蚊香烟**：`prop_mosq_ember` emissive 呼吸（sin t，0.6~1.4 强度，用 material.emissiveIntensity 或 color 乘法）。烟 = 一张 THREE.Points（12 顶点）+ 程序 CanvasTexture 软圆点，顶点从燃点位置（ember 世界坐标上方）缓升循环，尺寸随上升变大、透明度衰减；风致 x 向微漂由风扇档加成。1 个 draw call。
3. **窗外萤火虫**：THREE.Points 6 顶点，在窗外区域（读 outside.glb 的树/山位置，大概 x∈[1.2,2.6], y∈[0.8,2.2], z∈[-1.5,1.5] 范围自己探）正弦漂移 + 亮度闪烁（sin 相位各不同）。仅 lampState<0.7（夜/深夜）时可见。1 个 draw call。
4. **星星闪烁**：`outside_stars`（或名字含 stars 的 mesh/points）material.opacity 或点大小按多层正弦微闪，幅度 ≤0.15，不影响白天感。
5. **蚊帐微动**：`prop_bed_net` 找不到 morph 就绕顶边轻旋（rotation 振幅 ≤0.015 rad、周期 ~5s）；有 morph target 优先用 morphTargetInfluences[0] 0~0.3 摆动。

## 禁区
- 不改 loader.js / materials.js / interact.js / screen.js / panel.js / main.js（主会话接）。
- 不新增实时灯光、不开阴影、不做 per-frame 分配（复用 Vector3/数组）。
- 新增材质禁用 lighting（PointsMaterial/SpriteMaterial 或 ShaderMaterial 无光照）。
- 全部找不到目标 mesh 时逐项 console.warn 并跳过，绝不让 tick 抛错。

## 性能
1650 @1080p 总 FPS ≥55（M7 验收）：新增 draw calls ≤3，每帧 CPU <1ms。

## 自检
写 tools/test-anim.mjs（模式照 tools/debug-baked.mjs：http 服务 + playwright + GPU args + 同任务 render + toDataURL）：
- 设 __RM_STATE.fan=3 → 相隔 400ms 两帧，风扇叶片角度差 >0.5 rad。
- 设 fan=0 回中。
- headless 下 rAF 不依赖：直接调 `__RM_ANIM.tick(16, t)` 手动推进再 render。
- 控制台零 error。
截图 1 张 tools/blender/out/anim_night.png（fan=3、灯=夜）存档。
