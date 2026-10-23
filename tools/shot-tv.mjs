// tools/shot-tv.mjs — 真场景 CRT 频道截图（同任务 render + toDataURL）
import { chromium } from "playwright";
import { createServer } from "http";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".xml": "application/xml", ".ogg": "audio/ogg" };
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) errors.push("HTTP " + r.status() + " " + r.url()); });
await page.goto(base + "?room=1", { waitUntil: "load" });
const ready = await page.evaluate(() => new Promise((res) => {
  if (window.__RM_SCENE) return res(true);
  const t = setTimeout(() => res(false), 15000);
  addEventListener("__RM_READY", () => { clearTimeout(t); res(true); }, { once: true });
}));
if (!ready) { console.log("NOT READY", errors); process.exit(1); }

async function grab(name, fn) {
  const url = await page.evaluate(fn);
  writeFileSync(join(ROOT, "tools/blender/out", name), Buffer.from(url.split(",")[1], "base64"));
  console.log("grab:", name);
}
await grab("tv_ch1.png", () => {
  window.__RM_SCREEN.setChannel(1);
  const s = window.__RM_SCENE; s.renderer.render(s.scene, s.camera);
  return s.renderer.domElement.toDataURL("image/png");
});
await grab("tv_panel.png", () => {
  window.__RM_OPEN_POST("posts/hello-world/");
  const s = window.__RM_SCENE; s.renderer.render(s.scene, s.camera);
  return s.renderer.domElement.toDataURL("image/png");
});
console.log("errors:", errors.length ? errors.slice(0, 3) : "none");
await browser.close(); srv.close();
