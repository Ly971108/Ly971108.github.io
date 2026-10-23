# M9 对抗式 QA — issue 清单

- 被测对象：`index.html` + `assets/scene-js/v0001/` + `assets/scene/v0001/`（three.js 0.170 + 烘焙图集）
- 环境：本地静态服务 + Playwright（chromium `--use-angle=d3d11 --enable-gpu`），参照 `tools/test-web.mjs`
- 测试脚本：`tools/qa-m9.mjs` / `qa-m9b.mjs` / `qa-m9c.mjs`（只测不改）
- 证据：`tools/blender/out/qa_summary.json`、`qa_b.json`、`qa_c.json`、`qa_1_night.png` ~ `qa_8_standby.png`
- 结论：**13 个 issue（P0×1 · P1×4 · P2×8）**

---

## P0

### [P0] 隐形 panel 遮罩永久覆盖全屏，吞掉一切鼠标交互

- **复现**：`?room=1` 加载进入房间 → 鼠标点击任何 3D 物体或 HUD 按钮（顶部菜单、声音、静态版）。
- **期望**：点击命中 3D 拾取目标 / HUD 控件。
- **实际**：全部点击被不可见的 `.rm-panel-overlay` 拦截，3D 场景只能用键盘操作。
- **根因**：`panel.js` 注入的 CSS `.rm-panel-overlay { display:flex }` 优先级高于 `hidden` 属性的 UA 样式（`display:none`）。`close()` 只设 `hidden=true`，元素仍 `display:flex`、`position:fixed; inset:0; z-index:90`，透明度 0 但全程吃 pointer 事件。
- **证据**：
  - `qa_b.json → overlayComputed`：`{hiddenAttr:true, display:"flex", opacity:"0", rect:{x:0,y:0,w:1280,h:720}}`（面板从未打开过的全新页面）
  - `qa_summary.json → clicks`：8 个目标逐个点击，`tip=null`、状态全部不变
  - `qa_summary.json → sections[3]`：Playwright 点 HUD 菜单报 `<div hidden role="dialog" class="rm-panel-overlay">…</div> intercepts pointer events`
  - 对照（测试态临时 `display:none` 后）：`qa_b.json → clicksNoOverlay` 同坐标点击全部命中、tooltip 正常、状态正确变化。

---

## P1

### [P1] 作业本交互目标名不匹配，作业本永远点不开文章

- **复现**：进入房间，点击桌面上的作业本（画面中可见）。
- **期望**：打开 panel 加载第一篇文章（契约 `docs/m6-contracts.md`：`prop_notebook 点击 → panel.openPost(...)`）。
- **实际**：`interact.js` 查找 `prop_notebook_cover`，场景里实际网格名是 `prop_notebook_cover_L` / `prop_notebook_cover_R`（+ deco/page/spine 若干），`getObjectByName` 返回 null → 目标从未注册，点击无任何反应（即使 P0 修复后同样无效）。
- **证据**：`qa_summary.json → inventory.notebook_cover:false`；`clicks[]` 中 `missing:"prop_notebook_cover"`；GLB 节点清单 `prop_notebook_cover_L` 等（tools/qa-m9b.mjs 探针）。

### [P1] 拉线灯、收录机在默认机位下投影在视口外，鼠标永远点不到

- **复现**：进入房间，鼠标找拉线（bulb_wire，天花板吊灯拉线）或收录机（书桌左侧）点击。
- **期望**：可交互物在视野内可点击。
- **实际**：
  - `bulb_wire`（世界坐标 y=2.45 天花板）bbox 全部采样点投影在屏外上方（y=-113 ~ -235px），tooltip 不出现；只能按 L 键切灯。
  - `prop_radio_body`（世界坐标 x=-1.25,z=-1.5）bbox 中心投影 x=-83px（屏外左侧）；raycast 能命中（d=3.19）但像素不可点。收录机没有任何键盘替代 → ONLINE 频道 3 除 HUD 菜单外无法通过场景到达。
- **证据**：`qa_b.json → clicksNoOverlay`：`bulb_wire tip=null Δ={}`、`prop_radio_body tip=null Δ={}`；投影采样与 raycast 探针输出（见 `tools/blender/out/qa_b.json` 同批记录）；默认机位来自 `manifest.json camera.position [-1.55,1.52,1.72]`。
- **附带**：蚊香/风扇/双旋钮/奖状/挂历经测试态验证点击链本身正常（tooltip + 状态变化 + hash 同步）。

### [P1] hash 路由刷新后电视频道不恢复（HUD 高亮恢复、屏幕不恢复）

- **复现**：进入 `#posts`（或 `#archive`/`#online`）→ F5 刷新。
- **期望**：刷新后 TV 屏幕与 `__RM_STATE.channel` 恢复到 hash 对应频道（路由契约：`#about|#posts|#archive|#online → screen.setChannel(0..3)`）。
- **实际**：`interact.onRoute` 只监听 `hashchange`，初始加载不触发 → 频道永远停留 0；而 `router.js sync()` 在 init 时读了 hash，HUD 菜单高亮和 title 都恢复 → 同一页面 HUD 显示「写作」高亮、电视却播 ABOUT，状态不一致。
- **证据**：`qa_c.json → hashRestore[].afterReload`：四个 hash 全部 `{ch:0, screen:0, ariaCurrent:"<正确页>"}`。
- **注**：同文档内改 hash（点击菜单/物体）同步正常；仅「刷新 / 带 hash 直达」不恢复。

### [P1] 「关于」路由 URL 被改写成 path 形态，刷新后 3D 房间消失

- **复现**：点击奖状纸（或任何触发 `setHash("#about")` 的物体）。
- **期望**：与 HUD 菜单一致，URL 保持 `/?room=1#about` 形态；刷新后仍在 3D 房间。
- **实际**：`interact.setHash` 走 `history.pushState`，index.html 的包装器把 `#about` 重写成 `R.about+search` → URL 变 `/about/?room=1`，hash 消失。此时：① HUD `aria-current` 不再同步（hash 空）；② ESC 无效（`setHash("#")` 判等直接 return，`afterEsc.url` 不变）；③ 用户刷新 → 服务器直接返回 about 单页，3D 房间丢失。而点 HUD 菜单「关于」却是 `#about` hash 形态 —— 同一目的地两套 URL。
- **证据**：`qa_b.json → awardUrl:{url:"/about/?room=1", ch:0, ariaCurrent:null}`、`afterEsc:{url:"/about/?room=1"}`。

---

## P2

### [P2] 音量旋钮无任何实际效果

- 契约（`docs/m6-contracts.md`）：音量键「M6 先调 screen 亮度增益 + OSD」。
- 实际：`interact.js` 只 `osd("音量 x/3")`，从不调用 `screenApi.setGain`；`screen.js` 的 `gain` 变量无人写入；`audio.js` 也不消费 `state.volume`。按 V×3 后 `uBright` 1.0→1.0 不变。
- 证据：`qa_b.json → gainTest:{before:1, after:1, volume:2}`。

### [P2] 屏幕提示「N/↓ 下选」但 ↓ 键无绑定

- 写作频道屏底写 `N/↓ 下选 · Enter 打开`；`interact.js onKey` 只处理 `n`，`ArrowDown`/`ArrowUp` 无 case。契约同样写了 `N/↓`。

### [P2] `#reading` 路由契约未实现

- `docs/m6-contracts.md`：`#reading → panel 打开最近文章`。scene-js 中无任何 `#reading` handler（仅 panel.js 注释提及），实测 `location.hash="#reading"` + hashchange 后 panel 不开。
- 证据：`qa_b.json → readingRoute:{panelOpen:false, hash:"#reading"}`。

### [P2] 「控制台零 error」严格意义不达标：404 必然产生 resource error 日志

- 面板 404 降级本身优雅（`qa_5_404.png` 显示「文章加载失败」，不白屏），但浏览器对 404 资源固定打 `console.error: Failed to load resource ... 404`（`/nope/` 与空数据 fallback `posts/index.html` 均复现）。
- 另：audio.js `loadAmbient` 首试相对路径，若此刻 URL 已被改写到 `/about/`（见 P1-路由项），相对路径 404 再回退绝对路径成功 —— 多一条无谓 error 噪音。
- 建议：契约层面接受「网络 404 噪音」或改判定口径；ambient 加载应基于 `<base>`/绝对站点路径一次命中。

### [P2] `#about` 直达时 document.title 不同步

- 直达/刷新 `/?room=1#about`：title 停留「夏夜老屋」，应为「关于 · 夏夜老屋」（`#posts`/`#archive`/`#online` 正常）。`syncTitle` 的 own 分支只信 `pathname`，hash 形态的 about 被忽略。
- 证据：`qa_c.json → hashRestore[0].onLoad.title:"夏夜老屋"`。

### [P2] 黄昏档位室内近全黑

- L 两下到「黄昏」（lampState=0，仅 irrC 窗光）：`qa_2_dusk.png` 室内大面积死黑，仅剩挂历/TV/窗外微光。若设计意图是「关掉灯泡的黄昏」，irrC 亮度可能偏弱，建议人工确认。

### [P2] 触屏手机静态版无任何返回 3D 的入口

- 手机 UA（coarse+小屏）进静态版：`ph-room` 链接与 `#rm-try` 均 `hidden`（`qa_b.json/qa_summary.json → mobileTouchUA`），用户只能手输 `?room=1`。`rm-warn` 文案也没有给出尝试入口。

### [P2] HUD 模板 `#panel` 为死代码

- `index.html` 模板里的 `<section class="hud panel" id="panel" hidden>` 无任何模块使用（panel.js 自建 overlay），且 `hidden` 同样会被其 CSS `display` 覆盖的同类隐患模式 —— 建议删除或接入，避免后续误用。

---

## 必测清单逐项结论

1. **控制台零 error + 全交互遍历**：ISSUE（即 P0：交互物/HUD 点击全被吞；键盘路径零 error PASS）。隔离遮罩后 8 类目标点击链验证通过（蚊香/风扇/双旋钮/奖状/挂历 tooltip+状态正确；作业本/拉线/收录机见 P1）。
2. **L×10 / T×20 / 快速连点**：PASS。L×10 → `lamp=1`、`lampState=0.35` 收敛到合法值；T×20 → channel 0=screen 0；旋钮连点 30 次状态机无混乱、无 error。
3. **hash 路由刷新恢复**：ISSUE（P1 ×2：频道不恢复 + about URL 改写）。
4. **面板**：PASS（打开渲染 `本站技术架构备忘` h1、ESC 关、连开 5 次稳定、`/nope/` 优雅报错不白屏）；唯 404 console 噪音记 P2。
5. **375×667**：PASS。桌面 UA：HUD 可用、静态版入口存在、无横向溢出；触屏 UA：不自动加载 3D、静态版布局正常（3D 入口缺失记 P2）。
6. **空数据**：PASS。`posts=[]/about=[]` → TV 待机细亮横线（`qa_8_standby.png`），作业本 fallback 404 后优雅报错，无白屏。
7. **a11y**：PASS。panel 打开后焦点在对话框内（close 按钮），`role=dialog aria-modal`、关闭按钮可访问名、HUD 按钮均有文本/aria、`canvas` 有 aria-label 替代文本。
8. **性能**：PASS。静置 10s 后 `draw calls=29`、`tris=95540`、纹理 20、几何 28、实测 61 fps（1280×720，预算 60 calls / 250k tris 内）。
9. **视觉抽查**：PASS（`qa_1_night` / `qa_2_dusk` / `qa_3_deepnight_tv` / `qa_4_panel` 四张无破图/黑块/白块/错位；黄昏过暗记 P2）。

## 统计

**Issue 总数：13 = P0×1 + P1×4 + P2×8**

| 级别 | 数量 | 编号 |
|---|---|---|
| P0 | 1 | 隐形遮罩吞点击 |
| P1 | 4 | 作业本名不匹配 · 拉线/收录机视口外 · 刷新频道不恢复 · about URL 改写 |
| P2 | 8 | 音量无效 · ↓ 未绑定 · #reading 未实现 · 404 console 噪音 · about title · 黄昏全黑 · 手机静态版无 3D 入口 · #panel 死代码 |
