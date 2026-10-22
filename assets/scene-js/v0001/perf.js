/* 夏夜老屋 M2 — perf.js
 * ?debug=1 显示 FPS / draw calls / 三角面 overlay，4Hz 更新。
 * main.js 每帧调 perf.tick()。
 */
export function initPerf(renderer) {
  const noop = function () {};
  let on = false;
  try { on = new URLSearchParams(location.search).get("debug") === "1"; } catch (e) {}
  if (!on) return { tick: noop };

  const el = document.createElement("div");
  el.id = "rm-perf";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);

  let frames = 0, last = performance.now();
  return {
    tick: function () {
      frames++;
      const now = performance.now();
      if (now - last < 250) return;
      const fps = frames * 1000 / (now - last);
      frames = 0; last = now;
      const r = renderer.info.render, m = renderer.info.memory;
      el.textContent = fps.toFixed(0) + " fps · " +
        r.calls + " calls · " +
        (r.triangles / 1000).toFixed(1) + "k tris · " +
        m.textures + " tex";
    }
  };
}
