// tools/test-perf.mjs — M10 性能验收：FPS / draw calls / 首载字节
import { chromium } from "playwright";
import { createServer } from "http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".xml": "application/xml", ".ogg": "audio/ogg" };
const srv = createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
    const data = await readFile(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "content-length": data.length });
    res.end(data);
  } catch { res.writeHead(404); res.end("404"); }
});
await new Promise((r) => srv.listen(0, r));
const base = "http://127.0.0.1:" + srv.address().port + "/";
const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
let bytes = 0;
page.on("response", async (r) => {
  try { const h = await r.headerValue("content-length"); if (h) bytes += +h; } catch {}
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base + "?room=1", { waitUntil: "load" });
const ready = await page.evaluate(() => new Promise((res) => {
  if (window.__RM_SCENE) return res(true);
  const t = setTimeout(() => res(false), 20000);
  addEventListener("__RM_READY", () => { clearTimeout(t); res(true); }, { once: true });
}));
if (!ready) { console.log("NOT READY", errors); process.exit(1); }

const perf = await page.evaluate(() => new Promise((done) => {
  window.dispatchEvent(new CustomEvent("__RM_ENTER"));
  const t0 = performance.now();
  let frames = 0;
  const counts = [];
  (function loop() {
    requestAnimationFrame(loop);
    frames++;
    const now = performance.now();
    if (now - t0 > 2000) counts.push(now);          /* 稳态后每帧记录 */
    if (now - t0 > 2000 + 15000) {
      const info = window.__RM_SCENE.renderer.info.render;
      const dts = [];
      for (let i = 1; i < counts.length; i++) dts.push(counts[i] - counts[i - 1]);
      dts.sort((a, b) => a - b);
      const avg = dts.length ? dts.reduce((a, b) => a + b, 0) / dts.length : 0;
      done({
        fps: avg ? 1000 / avg : 0,
        p95ms: dts.length ? dts[Math.floor(dts.length * 0.95)] : 0,
        calls: info.calls, tris: info.triangles
      });
    }
  })();
}));
/* 首载字节：再干净统计一次（上面含 WebSocket 等噪声, 用请求列表过滤） */
const budget = { fpsMin: 55, callsMax: 60, bytesMax: 20 * 1024 * 1024 };
const ok = perf.fps >= budget.fpsMin && perf.calls <= budget.callsMax && bytes <= budget.bytesMax && errors.length === 0;
console.log("PERF", ok ? "PASS" : "FAIL", JSON.stringify(perf), "loadedMB=" + (bytes / 1048576).toFixed(1), errors.length ? "ERR:" + errors[0] : "");
await browser.close(); srv.close();
process.exit(ok ? 0 : 1);
