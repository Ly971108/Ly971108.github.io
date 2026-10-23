// tools/test-pixel.mjs — M9 像素回归基线（pixelmatch）
// 用法: node tools/test-pixel.mjs --save   写基线
//       node tools/test-pixel.mjs          对比基线, 差异 >0.1% 判 FAIL
import { chromium } from "playwright";
import { createServer } from "http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const SAVE = process.argv.includes("--save");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASE = join(ROOT, "tools", "baseline");
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(base + "?room=1", { waitUntil: "load" });
const ready = await page.evaluate(() => new Promise((res) => {
  if (window.__RM_SCENE) return res(true);
  const t = setTimeout(() => res(false), 20000);
  addEventListener("__RM_READY", () => { clearTimeout(t); res(true); }, { once: true });
}));
if (!ready) { console.log("NOT READY"); process.exit(1); }

/* 稳定渲染：固定状态 + 手动驱动帧（headless rAF 节流） */
async function grabState(name, setup) {
  const dataUrl = await page.evaluate("(function(){" + setup + "})()");
  return PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
}
const RENDER = `const s = window.__RM_SCENE;
  for (let i = 0; i < 30; i++) { window.__RM_ANIM && window.__RM_ANIM.tick(16, i * 16); s.renderer.render(s.scene, s.camera); }
  return s.renderer.domElement.toDataURL("image/png");`;

const states = {
  night: `window.__RM_BAKED.bakedState.lampState.value = 1; window.__RM_BAKED.bakedState.tvColor.value.set(0,0,0); ${RENDER}`,
  dusk: `window.__RM_BAKED.bakedState.lampState.value = 0; ${RENDER}`,
  tv: `window.__RM_BAKED.bakedState.lampState.value = 1; window.__RM_SCREEN.setChannel(1); window.__RM_BAKED.bakedState.tvColor.value.set(0.9,0.85,0.75); ${RENDER}`
};

let fail = 0;
await mkdir(BASE, { recursive: true });
for (const [name, setup] of Object.entries(states)) {
  const png = await grabState(name, setup);
  const file = join(BASE, name + ".png");
  if (SAVE) {
    await writeFile(file, PNG.sync.write(png));
    console.log("SAVE", name, png.width + "x" + png.height);
  } else {
    let ref;
    try { ref = PNG.sync.read(await readFile(file)); }
    catch { console.log("FAIL", name, "无基线（先跑 --save）"); fail++; continue; }
    const diff = new PNG({ width: png.width, height: png.height });
    const n = pixelmatch(png.data, ref.data, diff.data, png.width, png.height, { threshold: 0.15 });
    const pct = (n / (png.width * png.height)) * 100;
    const ok = pct < 0.1;
    console.log(ok ? "PASS" : "FAIL", "pixel_" + name, "diff=" + pct.toFixed(3) + "%");
    if (!ok) { await writeFile(join(BASE, name + ".diff.png"), PNG.sync.write(diff)); fail++; }
  }
}
await browser.close(); srv.close();
console.log(SAVE ? "BASELINE SAVED" : fail ? "PIXEL: " + fail + " FAIL" : "PIXEL: ALL PASS");
process.exit(fail ? 1 : 0);
