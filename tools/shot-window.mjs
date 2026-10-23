// tools/shot-window.mjs — M11d 窗外景 + 近景清晰度评审截图
import { chromium } from "playwright";
import { createServer } from "node:http";
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
await page.goto(base + "?room=1", { waitUntil: "load" });
const ready = await page.evaluate(() => new Promise((res) => {
  if (window.__RM_SCENE) return res(true);
  const t = setTimeout(() => res(false), 20000);
  addEventListener("__RM_READY", () => { clearTimeout(t); res(true); }, { once: true });
}));
if (!ready) { console.log("NOT READY", errors); process.exit(1); }

/* 机位: 房内望向窗外(窗在 x=2 墙, z 0.9–2.3) + 拉最近 1.2m 看桌面细节 */
async function grab(name, fn) {
  const url = await page.evaluate(fn);
  writeFileSync(join(ROOT, "tools/blender/out", name), Buffer.from(url.split(",")[1], "base64"));
  console.log("grab:", name);
}
await grab("m11d_window.png", () => {
  const s = window.__RM_SCENE;
  s.camera.position.set(-0.6, 1.5, 1.55);
  s.camera.lookAt(8, 1.35, 1.2);
  for (let i = 0; i < 10; i++) s.renderer.render(s.scene, s.camera);
  return s.renderer.domElement.toDataURL("image/png");
});
await grab("m11d_closeup.png", () => {
  const s = window.__RM_SCENE;
  s.camera.position.set(0.7, 1.35, 0.75);
  s.camera.lookAt(-0.15, 0.85, -0.2);
  for (let i = 0; i < 10; i++) s.renderer.render(s.scene, s.camera);
  return s.renderer.domElement.toDataURL("image/png");
});
console.log("errors:", errors.length ? errors.slice(0, 3) : "none");
await browser.close(); srv.close();
