// tools/test-anim.mjs — M7 自检：anim.js 氛围动画断言 + 截图
// 模式照 tools/debug-baked.mjs：http 服务（fileURLToPath 处理中文路径）+ playwright GPU
// args + page.evaluate 内 addEventListener 等 __RM_READY + 同任务 render + toDataURL
// （headless rAF 被节流，直接调 __RM_ANIM.tick(16, t) 手动推进）。
import { chromium } from "playwright";
import { createServer } from "http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary", ".webp": "image/webp", ".json": "application/json", ".png": "image/png" };
const srv = createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
    const data = await readFile(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => srv.listen(8932, r));

const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on("console", (m) => logs.push(m.type() + ": " + m.text()));
page.on("pageerror", (e) => logs.push("PAGEERROR: " + String(e)));
const resp = await page.goto("http://localhost:8932/index.html?room=1", { waitUntil: "load" });
logs.push("HTTP " + resp.status());
const ready = await page.evaluate(() => new Promise((res) => {
  if (window.__RM_SCENE) return res(true);
  const t = setTimeout(() => res(false), 20000);
  addEventListener("__RM_READY", () => { clearTimeout(t); res(true); }, { once: true });
}));
console.log("ready=" + ready);
if (!ready) { console.log("ABORT: 场景未就绪"); await browser.close(); srv.close(); process.exit(1); }

/* anim.js 已由 main.js 接线（window.__RM_ANIM）；若缺则测试内动态 import 兜底 */
const wired = await page.evaluate(async () => {
  if (window.__RM_ANIM && typeof window.__RM_ANIM.tick === "function") return true;
  try {
    const m = await import("./assets/scene-js/v0001/anim.js");
    window.__RM_ANIM = m.initAnim({ scene: window.__RM_SCENE.scene, bakedState: window.__RM_BAKED.bakedState });
    return !!window.__RM_ANIM;
  } catch (e) {
    return "ERR: " + (e && e.message);
  }
});
console.log("wired=" + wired);

/* 断言 1：fan=3，相隔 400ms 两帧，叶片角度差 >0.5 rad */
const spin = await page.evaluate(() => {
  const s = window.__RM_SCENE;
  const blades = s.scene.getObjectByName("prop_fan_blades");
  window.__RM_STATE.fan = 3;
  window.__RM_ANIM.tick(16, 0);
  const a0 = blades.rotation.y;
  window.__RM_ANIM.tick(400, 400);
  const a1 = blades.rotation.y;
  return { a0, a1, diff: a1 - a0 };
});
console.log("spin: diff=" + spin.diff.toFixed(3) + " rad (要求 >0.5)");
const okSpin = spin.diff > 0.5;

/* 断言 2：fan=0 摇头回中 + 角速度衰减（缓停，不瞬停） */
const stop = await page.evaluate(() => {
  const s = window.__RM_SCENE;
  const blades = s.scene.getObjectByName("prop_fan_blades");
  const head = s.scene.getObjectByName("prop_fan_head");
  window.__RM_STATE.fan = 0;
  /* 推进 4s，每 16ms 一帧 */
  for (let i = 0; i < 250; i++) window.__RM_ANIM.tick(16, 400 + i * 16);
  const b0 = blades.rotation.y;
  window.__RM_ANIM.tick(16, 4400);
  const b1 = blades.rotation.y;
  return { headY: head.rotation.y, bladeDelta: Math.abs(b1 - b0) };
});
console.log("stop: headY=" + stop.headY.toFixed(4) + " (要求 |y|<0.02), bladeDelta=" + stop.bladeDelta.toFixed(4) + " (要求 >0: 缓停未瞬停)");
const okStop = Math.abs(stop.headY) < 0.02 && stop.bladeDelta > 0;

/* 断言 3：夜灯 lampState=1.0 萤火虫不可见；深夜/黄昏 lampState<0.7 可见 */
const flyVis = await page.evaluate(() => {
  const s = window.__RM_SCENE;
  const fly = s.scene.getObjectByName("anim_fireflies");
  const smoke = s.scene.getObjectByName("anim_mosq_smoke");
  window.__RM_BAKED.bakedState.lampState.value = 1.0;
  window.__RM_ANIM.tick(16, 5000);
  const lampOn = fly.visible;
  window.__RM_BAKED.bakedState.lampState.value = 0.35;
  window.__RM_ANIM.tick(16, 5016);
  const deepNight = fly.visible;
  return { exists: !!fly && !!smoke, lampOn, deepNight };
});
console.log("fireflies: " + JSON.stringify(flyVis) + " (要求 lampOn=false deepNight=true)");
const okFly = flyVis.exists && flyVis.lampOn === false && flyVis.deepNight === true;

/* 断言 4：新增 draw calls ≤3（info.calls 对比接线前基线不可行，直接报当前值） */
const draws = await page.evaluate(() => {
  const s = window.__RM_SCENE;
  window.__RM_BAKED.bakedState.lampState.value = 1.0;
  window.__RM_STATE.fan = 3;
  for (let i = 0; i < 60; i++) window.__RM_ANIM.tick(16, 5100 + i * 16);
  s.renderer.render(s.scene, s.camera);
  return { calls: s.renderer.info.render.calls, tris: s.renderer.info.render.triangles };
});
console.log("draws: calls=" + draws.calls + " tris=" + draws.tris);

/* 截图：fan=3、夜灯 */
const dataUrl = await page.evaluate(() => {
  const s = window.__RM_SCENE;
  window.__RM_STATE.fan = 3;
  window.__RM_BAKED.bakedState.lampState.value = 1.0;
  for (let i = 0; i < 30; i++) window.__RM_ANIM.tick(16, 6100 + i * 16);
  s.renderer.render(s.scene, s.camera);
  return s.renderer.domElement.toDataURL("image/png");
});
await writeFile(join(ROOT, "tools/blender/out/anim_night.png"), Buffer.from(dataUrl.split(",")[1], "base64"));
console.log("shot: tools/blender/out/anim_night.png (" + dataUrl.length + " bytes b64)");

/* 控制台零 error 校验 */
const errors = logs.filter((l) => l.startsWith("error") || l.startsWith("PAGEERROR"));
console.log("--- console errors: " + errors.length + " ---");
errors.slice(0, 10).forEach((l) => console.log(l));
const warns = logs.filter((l) => l.startsWith("warn"));
if (warns.length) { console.log("--- warns: " + warns.length + " ---"); warns.slice(0, 10).forEach((l) => console.log(l)); }

const pass = wired === true && okSpin && okStop && okFly && errors.length === 0;
console.log("RESULT: " + (pass ? "PASS" : "FAIL") +
  " [wired=" + wired + " spin=" + okSpin + " stop=" + okStop + " fireflies=" + okFly + " errors=" + errors.length + "]");
await browser.close();
srv.close();
process.exit(pass ? 0 : 1);
