/* 夏夜老屋 M2 — router.js
 * hash 路由 → HUD 导航 aria-current + console.log。
 * panel 内容渲染 M6 做。
 */
export function initRouter() {
  const links = [].slice.call(document.querySelectorAll(".hud.top .menu a[data-page]"));
  const sync = function () {
    const h = (location.hash || "").replace(/^#\/?/, "");
    console.log("[RM] route:", h || "home");
    links.forEach(function (a) {
      if (a.dataset.page === h) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  };
  addEventListener("hashchange", sync);
  sync();
}
