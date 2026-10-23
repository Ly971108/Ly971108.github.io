// tools/test-degrade.mjs — M9 降级路径脚本验证（6 条）
import { chromium } from "playwright";
import { createServer } from "http";
import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".xml": "application/xml", ".ogg": "audio/ogg", ".md": "text/plain" };
const srv = createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
    const data = await readFile(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("404"); }
});
await new Promise((r) => srv.listen(0, r));
const base = "http://127.0.0.1:" + srv.address().port + "/";
const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu"] });
let fail = 0;

async function caseRun(name, opts, checks) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 720 } }, opts.ctx || {}));
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + (opts.url || ""), { waitUntil: "load" });
  await page.waitForTimeout(opts.wait || 2500);
  const r = await page.evaluate(() => ({
    fallback: (() => { const el = document.querySelector(".rm-fallback"); return el && getComputedStyle(el).display !== "none"; })(),
    scene: !!window.__RM_SCENE,
    view: (() => { try { return localStorage.getItem("rm.view"); } catch { return null; } })()
  }));
  const ok = checks(r, errors);
  console.log(ok ? "PASS" : "FAIL", name, JSON.stringify(r), errors.length ? "ERR:" + errors[0] : "");
  if (!ok) fail++;
  await ctx.close();
}

/* 1. WebGL2 缺失 → 静态版 */
await caseRun("degrade_no_webgl2", {
  init: () => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, o) {
      if (String(t).indexOf("webgl") >= 0) return null;
      return orig.call(this, t, o);
    };
  }
}, (r) => r.fallback && !r.scene);

/* 2. failIfMajorPerformanceCaveat 触发软渲染黑名单 → 静态版
 *    (boot 黑名单在 navigator.webdriver 下跳过,但第二子句 failIfMajorPerformanceCaveat
 *     独立生效: patched getContext 对带该选项的请求返回 null) */
await caseRun("degrade_soft_blacklist", {
  init: () => {
    try { Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false, configurable: true }); } catch (e) {}
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, o) {
      if (String(t).indexOf("webgl") >= 0 && o && o.failIfMajorPerformanceCaveat) return null;
      return orig.call(this, t, o);
    };
  }
}, (r) => r.fallback && !r.scene);

/* 3. 关 JS（noscript 语义）→ 静态版 DOM 可读 */
await caseRun("degrade_no_js", { ctx: { javaScriptEnabled: false }, wait: 1500 },
  (r) => r.fallback && !r.scene);

/* 4. ?reading=1 → localStorage 记忆 */
await caseRun("degrade_reading_mem", { url: "?reading=1", wait: 2000 },
  (r) => r.view === "reading");

/* 5. 移动端默认不进 3D（无 ?room=1） */
await caseRun("degrade_mobile_default", {
  ctx: {
    viewport: { width: 375, height: 667 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    hasTouch: true, isMobile: true
  }
}, (r) => !r.scene);

/* 6. WebGL 上下文丢失 → 不崩溃（pageerror 为零即优雅） */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "?room=1", { waitUntil: "load" });
  const ready = await page.evaluate(() => new Promise((res) => {
    if (window.__RM_SCENE) return res(true);
    const t = setTimeout(() => res(false), 15000);
    addEventListener("__RM_READY", () => { clearTimeout(t); res(true); }, { once: true });
  }));
  await page.evaluate(() => {
    const cv = document.getElementById("gl");
    cv.dispatchEvent(new Event("webglcontextlost"));
  });
  await page.waitForTimeout(1200);
  const osd = await page.evaluate(() => (document.body.textContent || "").indexOf("刷新") >= 0);
  const ok = ready && errors.length === 0;
  console.log(ok ? "PASS" : "FAIL", "degrade_context_lost", JSON.stringify({ ready, osd }), errors.length ? "ERR:" + errors[0] : "");
  if (!ok) fail++;
  await ctx.close();
}

await browser.close(); srv.close();
console.log(fail ? "DEGRADE: " + fail + " FAIL" : "DEGRADE: ALL PASS");
process.exit(fail ? 1 : 0);
