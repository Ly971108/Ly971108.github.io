# M8 声音契约（audio.js + 环境音资产）

## 资产（tools/gen-audio.mjs 生成）
- `assets/scene/v0001/audio/ambient.ogg`：75-90s 无缝循环夏夜环境音（蟋蟀主导 + 远蛙 + 微风 + 极远犬吠，偶发）。峰值 -6dB，首尾样本连续（循环点无爆音）。
- 纯 Node 合成（不依赖 numpy）：PCM 直接写 WAV，再用系统 ffmpeg 转 ogg（ffmpeg 在 PATH）。蟋蟀 = 4-5kHz 脉冲串，蛙 = 200-400Hz 下滑音，风 = 低通风噪声 + 慢 LFO 包络，犬吠 = 0.8s 衰减锯齿哼声（全曲 1-2 次即可）。
- 目标体积 ≤1.5MB（ogg q≈4）。

## audio.js
`initAudio()` → `{ tick(dtMs) }`，main.js 每帧调。
- AudioContext 首次用户手势（pointerdown/keydown 一次性监听）后才创建并启动。
- 读 `window.__RM_STATE`：sound=true → 环境音淡入（1.5s ramp 到 0.5 增益）；false → 淡出。状态变化持久化 localStorage("rm_sound")，初始化时回写 __RM_STATE.sound。
- 风扇 SFX：fan 档变化 → 循环风声增益 0/fan×0.12（0.3s 渐变）。
- 一次性 SFX（Web Audio 程序合成，不用素材）：
  - 旋钮咔哒（短方波 2ms + 高通噪声）
  - 拉线（快速上滑正弦 30ms）
  - 翻页（带通噪声 120ms 衰减）
- 暴露 `window.__RM_SFX = { click(), pull(), page() }` 供 interact/screen 调（interact 在 M6 未接，本模块自行监听 __RM_STATE 变化判断旋钮/拉线/翻页时机即可：监听 window 的自定义事件 `__RM_ACTION`，detail.type ∈ knob|pull|page|channel；interact.js 后续补派发，缺事件时静默跳过）。
- 音量总控：document 上 `.rm-mute-btn`（index.html 已有「声音关」按钮，class 以实际为准，找不到就跳过）点击 → sound 取反。

## 禁区
不改 main.js / interact.js / index.html 及其他现有文件；无头环境（不能创建 AudioContext）下全部静默降级不报错。

## 自检
tools/test-audio.mjs：headless 页面注入 stub AudioContext（记录调用），验证 initAudio 创建、事件触发 SFX、sound 状态持久化写 localStorage。控制台零 error。
