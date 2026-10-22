// tools/debug-baked.mjs — M5 诊断：检查 baked 组合并几何属性 + 纹理加载状态
import { chromium } from "playwright";
import { createServer } from "http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".glb": "model/gltf-binary", ".webp": "image/webp", ".json": "application/json", ".png": "image/png" };
const srv = createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
    const data = await readFile(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => srv.listen(8931, r));

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on("console", (m) => logs.push(m.type() + ": " + m.text()));
page.on("pageerror", (e) => logs.push("PAGEERROR: " + String(e)));
const resp = await page.goto("http://localhost:8931/index.html?room=1", { waitUntil: "load" });
logs.push("HTTP " + resp.status());
const ready = await page.evaluate(() => new Promise((res) => {
  if (window.__RM_SCENE) return res(true);
  const t = setTimeout(() => res(false), 20000);
  addEventListener("__RM_READY", () => { clearTimeout(t); res(true); }, { once: true });
}));
logs.push("ready=" + ready);
await page.evaluate(() => window.dispatchEvent(new CustomEvent("__RM_ENTER")));
const ident = await page.evaluate(() => {
  const b = window.__RM_BAKED;
  const u = b.group.children[0].material.uniforms.lampState;
  const s = b.bakedState.lampState;
  const same = u === s;
  s.value = 0.0;
  const after = u.value;
  return { same, after, uIsObj: typeof u, keys: Object.keys(b.group.children[0].material.uniforms) };
});
logs.push("identity=" + JSON.stringify(ident));
const frames2 = await page.evaluate(() => window.__RM_SCENE.renderer.info.render.frame);
logs.push("frame2=" + frames2);

/* 对照截图：黄昏 / 夜灯 / 夜灯+TV。
 * headless 下 rAF 被节流、合成器不刷新 -> 同一任务内 render + toDataURL 抓帧 */
import { writeFileSync } from "node:fs";
const S = "tools/blender/out/";
async function shot(name, fn) {
  const dataUrl = await page.evaluate(fn);
  writeFileSync(S + name, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("shot:", name, dataUrl.length);
}
const GRAB = `const s = window.__RM_SCENE; s.renderer.render(s.scene, s.camera);
  return s.renderer.domElement.toDataURL("image/png");`;
await shot("dbg_dusk.png", new Function(`
  window.__RM_BAKED.bakedState.lampState.value = 0;
  ${GRAB}`));
await shot("dbg_night.png", new Function(`
  window.__RM_BAKED.bakedState.lampState.value = 1;
  window.__RM_BAKED.bakedState.tvColor.value.set(0,0,0);
  ${GRAB}`));
await shot("dbg_tv.png", new Function(`
  window.__RM_BAKED.bakedState.lampState.value = 1;
  window.__RM_BAKED.bakedState.tvColor.value.set(1.2, 1.1, 0.9);
  ${GRAB}`));
/* UV 可视化：fragment 换成 vUv 直出（红=u 绿=v） */
const deep = await page.evaluate(async () => {
  const b = window.__RM_BAKED;
  const u = b.group.children[0].material.uniforms;
  const info = (t) => t ? { ctor: t.constructor.name, w: t.image && t.image.width, h: t.image && t.image.height, cs: t.colorSpace, uuid8: t.uuid.slice(0, 8) } : null;
  const groups = {};
  for (const [g, gi] of Object.entries(b.groups)) groups[g] = info(gi.material.uniforms.mapColor.value);
  const r = await fetch("assets/scene/v0001/atlas/shell_color.webp");
  return { shellMap: info(u.mapColor.value), shellIrrA: info(u.mapIrrA.value), groups, fetchStatus: r.status, ct: r.headers.get("content-type") };
});
logs.push("deep=" + JSON.stringify(deep, null, 1));
/* 只显示 base color 贴图（去光照） */
await shot("dbg_base.png", new Function(`
  const m = window.__RM_BAKED.group.children[0].material;
  m.fragmentShader = "precision highp float; varying vec2 vUv; uniform sampler2D mapColor; void main(){ gl_FragColor = vec4(texture2D(mapColor, vUv).rgb, 1.0); }";
  m.needsUpdate = true;
  ${GRAB}`));

const report = await page.evaluate(() => {
  const s = window.__RM_SCENE, b = window.__RM_BAKED;
  const find = (name) => {
    const hits = [];
    s.scene.traverse((o) => { if (o.name === name) hits.push(o); });
    return hits.map((o) => ({
      name: o.name, type: o.type, visible: o.visible,
      mat: o.isMesh ? (o.material && o.material.type) : "-",
      inBakedGroup: (() => { let p = o; while (p) { if (p.name === "baked_static") return true; p = p.parent; } return false; })(),
    }));
  };
  const names = ["wall_back", "floor", "prop_desk", "prop_fan_head", "ceiling", "baked_shell", "baked_furniture"];
  const out = { parent: b.group.parent === s.scene, meshes: [] };
  names.forEach((n) => { out[n] = find(n); });
  b.group.children.forEach((m) => out.meshes.push({
    name: m.name, visible: m.visible, mat: m.material.type,
    posCount: m.geometry.attributes.position.count,
    inScene: !!m.parent
  }));
  return out;
});
console.log(JSON.stringify(report, null, 1));
console.log("--- console ---");
logs.filter((l) => !l.startsWith("log: [RM] manifest")).slice(0, 20).forEach((l) => console.log(l));
await browser.close();
srv.close();
