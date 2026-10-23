# M6 交互契约（screen.js / panel.js / interact.js 共享）

## 总线
- `window.__RM`（boot.js 已提供）：`posts: [{title, url, date}]`、`about: {paragraphs:[...], links:[{text,href}]}`（shape 以 index.html template #rm-posts/#rm-about 实际解析为准，screen.js 需防御缺失）。
- `window.__RM_SCENE`：{scene, camera, renderer, manifest}
- `window.__RM_BAKED`：{group, hideNames, bakedState, groups}
  - `bakedState.lampState.value` 0=黄昏 1=夜灯
  - `bakedState.tvColor.value` THREE.Vector3

## screen.js（CRT 屏幕，独立模块）
导出：`initScreen(scene)` → API：
```js
{
  setChannel(i),      // 0..3 强制切换
  nextChannel(),      // 循环+1，返回新频道号
  getChannel(),
  osd(text, ms=1400), // 屏幕右上角短消息
  onChannel: (fn) => {} // 频道变化回调（interact 用于同步 hash）
}
```
- 找 `scene.getObjectByName("prop_tv_screen")`（存在才初始化，缺则 console.warn 并返回 null API）。
- 材质：CanvasTexture（canvas 640×480）+ 自定义 CRT ShaderMaterial：
  - 采样 canvas 做桶形畸变（corner 内凹）、扫描线（隔行 0.85 亮度）、暖白磷光色调、轻微噪点（time uniform）。
  - 屏幕「关/待机」态：全屏接近黑 + 一条细亮横线（老电视待机）。
- 频道内容（全部 Canvas 2D 绘制，系统字体栈，中文）：
  - 0 ABOUT：__RM.about 段落滚动（太长截断省略），底部 "github.com/Ly971108"。
  - 1 写作：__RM.posts 列表，当前项反白，N/↓ 下选、Enter 打开文章（回调 window.__RM_OPEN_POST(url)）。
  - 2 归档：按年份分组计数（从 date 提取）。
  - 3 ONLINE：about.links 列表。
- 频道号大 OSD 数字短暂显示在屏幕左上角。
- 屏幕亮度随 lampState 微调：深夜（lampState<0.5）屏幕略降亮度（模拟关灯看电视）。
- 性能：仅频道切换/选择变化/每 500ms 时钟（右上角时间）重绘 canvas；rAF 里只更新 time uniform。

## panel.js（DOM 阅读层）
导出：`initPanel()` → `{openPost(url), close(), isOpen()}`
- 全屏半透明墨黑 overlay + 纸色文章卡片，fetch(url) 提取 `<main>` 内 HTML 注入（本站静态页同源）。
- 打开时派发 `window.dispatchEvent(new CustomEvent("__RM_PANEL", {detail:{open:true}}))`（main.js 暂停轨道相机/交互用）。
- ESC / 点击遮罩关闭；关闭派发 detail.open=false。
- 无头测试友好：fetch 失败显示 "文章加载失败"。

## interact.js（拾取 + 状态机，主会话写）
- Raycaster pointer 交互；hover 高亮（emissive 提亮）+ tooltip（跟随鼠标的 HUD div）。
- 可交互节点（scene 按名查找，名字含匹配）：
  - `prop_tv_knob_channel` 点击 → screen.nextChannel()
  - `prop_tv_knob_volume` 点击 → 音量档 0..3 循环（M8 接管声音；M6 先调 screen 亮度增益 + OSD "音量 1/2/3/静音"）
  - 拉线（名含 "cord" 或 "pull"，fallback "bulb"）点击 → 灯态循环：夜(1) → 深夜(0.35) → 黄昏(0) → 夜…；同时 OSD（HMI 左下角）
  - 风扇旋钮（名含 "fan" 且含 "knob/switch"）点击 → 风速 0..3，存 `window.__RM_STATE.fan`
  - `prop_mosq_ember` 点击 → 声音开关 flag `__RM_STATE.sound` + OSD（M8 接管）
  - `prop_notebook` 点击 → panel.openPost(当前选中或最近一篇文章 url)
  - `prop_award_` 前缀 → screen.setChannel(0) + location.hash="#about"
- 键盘：T=频道 L=灯 F=风扇 N=下选/翻页 ESC=关 panel/回房间；与 HUD 底部提示一致。
- 灯态动画：lampState 向目标值缓动（每帧 0.08），tvColor 按频道 0/待机给暗值、频道切换瞬间白闪 120ms 再回落。
- 所有状态存 `window.__RM_STATE = {lamp:1, fan:0, sound:false, channel:0}`。

## 路由（router.js 已有 hash↔path 翻译，扩展）
- `#about|#posts|#archive|#online` → screen.setChannel(0..3)；频道点击 → history 更新 hash。
- `#reading` → panel 打开最近文章。
EOF
