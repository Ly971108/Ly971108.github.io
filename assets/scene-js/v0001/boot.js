/* 夏夜老屋 M2 — boot.js（非模块，mount 后立即执行）
 * OSD 接管：进度条 ← __RM_PROGRESS；READY → 淡出 OSD、亮 #enter；
 * enter（点击/任意键）→ __RM_ENTER 启动主循环；
 * 任何错误 → __RM.plain(true) 降级；webglcontextlost → #err 提示刷新。
 *
 * 事件协议（与 main.js/loader.js 契约）：
 *   __RM_PROGRESS  detail {loaded,total}
 *   __RM_READY     main.js 场景就绪
 *   __RM_ENTER     boot 派发，用户已进入
 *   __RM_FAIL(msg) 手动降级钩子（main.js catch 调它）
 */
(function () {
  var d = document, w = window, RM = w.__RM;
  var osd = d.getElementById("osd"),
      enter = d.getElementById("enter"),
      bar = d.querySelector("#osd .tv-meter .bar i"),
      pc = d.querySelector("#osd .tv-meter .pc"),
      lb = d.querySelector("#osd .tv-lb"),
      ch = d.querySelector("#osd .tv-ch"),
      err = d.getElementById("err"),
      canvas = d.getElementById("gl");
  var done = false, entered = false;

  function fail(msg) {
    if (done || entered) return;
    done = true;
    try {
      if (err) {
        err.hidden = false;
        err.textContent = "3D 房间加载失败（" + (msg || "未知错误") + "），已进入静态版。";
      }
    } catch (e) {}
    try { if (RM && RM.plain) RM.plain(true); } catch (e) {}
  }
  w.__RM_FAIL = fail;

  w.addEventListener("error", function (e) { if (!entered) fail(e.message || "脚本错误"); });
  w.addEventListener("unhandledrejection", function (e) {
    if (!entered) fail((e.reason && e.reason.message) || "Promise 拒绝");
  });

  if (lb) lb.textContent = "▶▶ 加载中";
  if (ch) ch.textContent = "频道 00";

  w.addEventListener("__RM_PROGRESS", function (e) {
    var dt = e.detail || {};
    var loaded = +dt.loaded || 0, total = +dt.total || 0;
    var p = total > 0 ? Math.min(1, loaded / total) : (loaded > 0 ? 1 : 0);
    if (bar) bar.style.width = (p * 100).toFixed(1) + "%";
    if (pc) pc.textContent = Math.round(p * 100) + "%";
  });

  w.addEventListener("__RM_READY", function () {
    if (done) return;
    if (osd) osd.classList.add("off");
    if (enter) enter.hidden = false;
  });

  function enterRoom() {
    if (entered || done) return;
    entered = true; done = true;
    w.__RM_ENTERED = true;
    if (osd) osd.classList.add("gone");
    if (enter) enter.hidden = true;
    w.dispatchEvent(new CustomEvent("__RM_ENTER"));
  }
  if (enter) enter.addEventListener("click", enterRoom);
  w.addEventListener("keydown", function () { if (!entered) enterRoom(); });

  if (canvas) canvas.addEventListener("webglcontextlost", function (ev) {
    ev.preventDefault();
    if (err) {
      err.hidden = false;
      err.textContent = "显卡上下文丢失，请刷新页面（F5）。";
    }
  });
})();
