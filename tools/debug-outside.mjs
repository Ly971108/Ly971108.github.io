// tools/debug-outside.mjs — 列出 outside 子节点名/材质/包围盒
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".glb": "model/gltf-binary", ".png": "image/png", ".webp": "image/webp", ".ogg": "audio/ogg", ".css": "text/css" };
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
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(base + "?room=1", { waitUntil: "load" });
await page.evaluate(() => new Promise((res) => {
  if (window.__RM_SCENE) return res(true);
  addEventListener("__RM_READY", () => res(true), { once: true });
  setTimeout(() => res(false), 20000);
}));
const info = await page.evaluate(() => {
  const s = window.__RM_SCENE;
  const root = s.scene.getObjectByName("outside");
  if (!root) {
    const names = [];
    s.scene.traverse((o) => { if (/outside/i.test(o.name || "")) names.push(o.name + ":" + o.type); });
    return { root: null, names: names.slice(0, 30) };
  }
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    out.push({
      name: o.name,
      visible: o.visible,
      pos: o.getWorldPosition(new (o.position.constructor)()).toArray().map((v) => +v.toFixed(1)),
      color: m.color ? m.color.getHexString() : null,
      emissive: m.emissive ? m.emissive.getHexString() : null,
      emissiveI: m.emissiveIntensity,
      hasMap: !!m.map, transparent: m.transparent,
    });
  });
  return { root: root.name, count: out.length, items: out };
});
console.log(JSON.stringify(info, null, 1));
await browser.close(); srv.close();
