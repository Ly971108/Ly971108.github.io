// tools/test-audio.mjs — M8 声音系统 headless 自检
// 验证（契约 docs/m8-contracts.md「自检」节）：
//   1) 注入 stub AudioContext（记录全部调用）；
//   2) initAudio() 创建、返回 tick；
//   3) 首次手势后才创建 AudioContext；__RM_SFX 暴露 click/pull/page；
//   4) __RM_ACTION 事件 → 对应 SFX 合成（方波/上滑正弦/带通噪声）；
//   5) __RM_STATE 变化：sound 持久化写 localStorage("rm_sound")、
//      环境音 1.5s 淡入淡出到 0.5、风扇 0.3s 渐变 fan×0.12；
//   6) 刷新后 sound 状态从 localStorage 回写 __RM_STATE；
//   7) 全过程中控制台零 error。
// 通过退出码 0/1 报告结果。
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".ogg": "audio/ogg", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".glb": "model/gltf-binary" };

/* 极简 harness 页：只加载 audio.js，隔离主场景其余模块，console 零 error 才有意义 */
const HARNESS = `<!doctype html><meta charset="utf-8"><title>audio-harness</title>
<script>window.__RM_STATE = { lamp: 0, fan: 0, sound: false, channel: 0, volume: 2 };</script>
<script type="module">
  import { initAudio } from "/assets/scene-js/v0001/audio.js";
  window.__RM_AUDIO = initAudio();
  window.__HARNESS_READY = true;
</script>`;

const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/__audio_harness__") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(HARNESS);
      return;
    }
    const file = path.join(ROOT, p);
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("404"); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

/* ---------- stub AudioContext：所有调用进 window.__ACLOG ---------- */
const STUB = `
(function () {
  const LOG = (window.__ACLOG = []);
  class FakeParam {
    constructor(name) { this.name = name; this.value = 0; }
    setValueAtTime(v, t) { LOG.push({ e: "param", name: this.name, m: "set", v }); this.value = v; return this; }
    linearRampToValueAtTime(v, t) { LOG.push({ e: "param", name: this.name, m: "linRamp", v }); this.value = v; return this; }
    exponentialRampToValueAtTime(v, t) { LOG.push({ e: "param", name: this.name, m: "expRamp", v }); this.value = v; return this; }
    cancelScheduledValues(t) { return this; }
  }
  class FakeNode {
    constructor(kind) { this.kind = kind; this.connections = 0; LOG.push({ e: "node", kind }); }
    connect() { this.connections++; return this; }
    disconnect() { return this; }
  }
  class FakeAudioContext {
    constructor() {
      this.sampleRate = 48000;
      this.state = "running";
      this.destination = new FakeNode("destination");
      LOG.push({ e: "ctx" });
    }
    get currentTime() { return performance.now() / 1000; }
    resume() { LOG.push({ e: "resume" }); return Promise.resolve(); }
    decodeAudioData(ab) { LOG.push({ e: "decode", bytes: ab && ab.byteLength }); return Promise.resolve({ fakeBuffer: true, duration: 80 }); }
    createGain() { const n = new FakeNode("gain"); n.gain = new FakeParam("gain"); return n; }
    createOscillator() {
      const n = new FakeNode("osc");
      n.type = "sine";
      n.frequency = new FakeParam("freq");
      n.start = (t) => LOG.push({ e: "oscStart", type: n.type, freq: n.frequency.value });
      n.stop = () => {};
      return n;
    }
    createBufferSource() {
      const n = new FakeNode("bufferSource");
      n.buffer = null; n.loop = false;
      n.start = (t) => LOG.push({ e: "srcStart", loop: n.loop, fake: !!(n.buffer && n.buffer.fakeBuffer) });
      n.stop = () => {};
      return n;
    }
    createBiquadFilter() {
      const n = new FakeNode("filter");
      n.type = "lowpass";
      n.frequency = new FakeParam("freq"); n.Q = new FakeParam("Q");
      return n;
    }
    createBuffer(ch, len, sr) {
      LOG.push({ e: "buffer", ch, len, sr });
      return { fakeBuffer: true, duration: len / sr, getChannelData: () => new Float32Array(len) };
    }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;
})();`;

const browser = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu"] });
let fail = 0;
const checks = [];
function report(name, ok, detail) {
  checks.push({ name, ok: !!ok });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  " + detail : ""));
  if (!ok) fail++;
}

/* ================= 第 1 阶段：隔离 harness 页 ================= */
{
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.addInitScript(STUB);
  await page.goto(base + "__audio_harness__", { waitUntil: "load" });
  await page.waitForFunction(() => window.__HARNESS_READY === true, null, { timeout: 5000 });

  /* 1. initAudio 返回 tick；__RM_SFX 暴露三个函数 */
  const init = await page.evaluate(() => ({
    hasTick: !!(window.__RM_AUDIO && typeof window.__RM_AUDIO.tick === "function"),
    sfx: window.__RM_SFX ? Object.keys(window.__RM_SFX).sort().join(",") : "",
    ctxBeforeGesture: window.__ACLOG.some((l) => l.e === "ctx"),
  }));
  report("initAudio 返回 tick + __RM_SFX 暴露", init.hasTick && init.sfx === "click,page,pull", JSON.stringify(init));
  report("手势前不创建 AudioContext", !init.ctxBeforeGesture);

  /* 2. 模拟首次用户手势 → AudioContext 创建、ambient.ogg fetch+decode+loop 播放 */
  await page.evaluate(() => { window.dispatchEvent(new Event("pointerdown")); });
  await page.waitForFunction(() => {
    const L = window.__ACLOG;
    return L.some((l) => l.e === "ctx") && L.some((l) => l.e === "decode")
      && L.some((l) => l.e === "srcStart" && l.loop === true);
  }, null, { timeout: 5000 }).catch(() => {});
  const gesture = await page.evaluate(() => ({
    ctx: window.__ACLOG.some((l) => l.e === "ctx"),
    decode: window.__ACLOG.some((l) => l.e === "decode" && l.bytes > 0),
    ambientLoop: window.__ACLOG.some((l) => l.e === "srcStart" && l.loop === true),
  }));
  report("手势后创建 AudioContext 并循环播放环境音", gesture.ctx && gesture.decode && gesture.ambientLoop, JSON.stringify(gesture));

  /* 3. sound=true → 1.5s 淡入到 0.5 + localStorage 持久化 */
  await page.evaluate(() => { window.__RM_STATE.sound = true; });
  await page.waitForFunction(() => window.__ACLOG.some((l) => l.e === "param" && l.m === "linRamp" && Math.abs(l.v - 0.5) < 1e-6), null, { timeout: 3000 }).catch(() => {});
  const sndOn = await page.evaluate(() => ({
    ramp: window.__ACLOG.some((l) => l.e === "param" && l.m === "linRamp" && Math.abs(l.v - 0.5) < 1e-6),
    ls: localStorage.getItem("rm_sound"),
  }));
  report("sound=true → 环境音淡入 0.5 并写 rm_sound=1", sndOn.ramp && sndOn.ls === "1", JSON.stringify(sndOn));

  /* 4. __RM_ACTION 事件 → SFX 合成（knob=方波 / pull=上滑正弦 / page=带通噪声） */
  const sfxProbe = async (type) => page.evaluate(async (type) => {
    window.__ACLOG.length = 0;
    window.dispatchEvent(new CustomEvent("__RM_ACTION", { detail: { type } }));
    await new Promise((r) => setTimeout(r, 60));
    return window.__ACLOG;
  }, type);
  const knob = await sfxProbe("knob");
  report("__RM_ACTION knob → 方波咔哒 SFX", knob.some((l) => l.e === "oscStart" && l.type === "square"), knob.filter((l) => l.e === "oscStart").map((l) => l.type).join(","));
  const pull = await sfxProbe("pull");
  report("__RM_ACTION pull → 上滑正弦 SFX", pull.some((l) => l.e === "oscStart" && l.type === "sine" && l.freq === 880), pull.filter((l) => l.e === "oscStart").map((l) => l.type + ":" + l.freq).join(","));
  const pg = await sfxProbe("page");
  report("__RM_ACTION page → 带通噪声 SFX", pg.some((l) => l.e === "node" && l.kind === "filter") && pg.some((l) => l.e === "srcStart"), pg.filter((l) => l.e === "node").map((l) => l.kind).join(","));

  /* 5. fan 变化 → 风声增益 0.3s 渐变到 fan×0.12（fan=2 → 0.24） */
  await page.evaluate(() => { window.__RM_STATE.fan = 2; });
  await page.waitForFunction(() => window.__ACLOG.some((l) => l.e === "param" && l.m === "linRamp" && Math.abs(l.v - 0.24) < 1e-6), null, { timeout: 3000 }).catch(() => {});
  const fan = await page.evaluate(() => ({
    ramp: window.__ACLOG.some((l) => l.e === "param" && l.m === "linRamp" && Math.abs(l.v - 0.24) < 1e-6),
  }));
  report("fan=2 → 风声渐变到 0.24", fan.ramp, JSON.stringify(fan));

  /* 6. sound=false → 淡出到 0 + 持久化；随后 sound=true 供刷新回写用 */
  await page.evaluate(() => { window.__RM_STATE.sound = false; });
  await page.waitForFunction(() => window.__ACLOG.some((l) => l.e === "param" && l.m === "linRamp" && l.v === 0), null, { timeout: 3000 }).catch(() => {});
  const sndOff = await page.evaluate(() => ({ ls: localStorage.getItem("rm_sound") }));
  report("sound=false → 淡出并写 rm_sound=0", sndOff.ls === "0", JSON.stringify(sndOff));

  /* 7. 刷新 → sound 从 localStorage 回写 __RM_STATE */
  await page.evaluate(() => { window.__RM_STATE.sound = true; });   /* 先置 true，刷新后应被恢复 */
  await page.waitForFunction(() => localStorage.getItem("rm_sound") === "1", null, { timeout: 3000 }).catch(() => {});
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__HARNESS_READY === true, null, { timeout: 5000 });
  const restored = await page.evaluate(() => ({
    sound: window.__RM_STATE.sound, ls: localStorage.getItem("rm_sound"),
  }));
  report("刷新后 sound 从 localStorage 回写 __RM_STATE", restored.sound === true && restored.ls === "1", JSON.stringify(restored));

  report("harness 阶段控制台零 error", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
}

/* ================= 第 2 阶段：真实页面集成冒烟（?room=1） ================= */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.addInitScript(STUB);
  await page.goto(base + "index.html?room=1", { waitUntil: "load" });
  const ready = await page.evaluate(() => new Promise((res) => {
    if (window.__RM_SCENE) return res(true);
    const t = setTimeout(() => res(false), 20000);
    addEventListener("__RM_READY", () => { clearTimeout(t); res(true); }, { once: true });
  }));
  report("真实页面 __RM_READY", ready);
  if (ready) {
    await page.evaluate(() => { window.dispatchEvent(new Event("pointerdown")); window.dispatchEvent(new CustomEvent("__RM_ENTER")); });
    await page.waitForFunction(() => window.__ACLOG.some((l) => l.e === "decode"), null, { timeout: 5000 }).catch(() => {});
    /* HUD 声音按钮点击翻转 sound（蚊香 interact 尚未接，按钮自身绑定了 click） */
    const btn = await page.evaluate(async () => {
      const before = window.__RM_STATE.sound;
      const el = document.getElementById("sound");
      const labelBefore = el ? el.textContent : "";
      if (el) el.click();
      await new Promise((r) => setTimeout(r, 150));
      const el2 = document.getElementById("sound");
      return {
        before, after: window.__RM_STATE.sound,
        labelBefore, labelAfter: el2 ? el2.textContent : "",
        ls: localStorage.getItem("rm_sound"),
        audioApi: !!(window.__RM_AUDIO && typeof window.__RM_AUDIO.tick === "function"),
        sfx: !!(window.__RM_SFX && typeof window.__RM_SFX.click === "function"),
        ambientDecoded: window.__ACLOG.some((l) => l.e === "decode"),
      };
    });
    report("HUD「声音」按钮点击翻转 sound + 更新文案", btn.before === false && btn.after === true
      && /开/.test(btn.labelAfter) && btn.ls === "1", JSON.stringify(btn));
    report("真实页面 ambient 解码 + __RM_AUDIO/__RM_SFX 就位", btn.audioApi && btn.sfx && btn.ambientDecoded);
    /* 蚊香状态机联动：interact 已接，直接翻 state 验证 tick 通路 */
    const coil = await page.evaluate(async () => {
      window.__RM_STATE.sound = false;
      await new Promise((r) => setTimeout(r, 120));
      return { ls: localStorage.getItem("rm_sound") };
    });
    report("__RM_STATE.sound 写通路持久化（rm_sound=0）", coil.ls === "0", JSON.stringify(coil));
  }
  report("真实页面控制台零 error", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
}

await browser.close();
server.close();
console.log("---");
console.log(fail ? `共 ${checks.length} 项，失败 ${fail} 项` : `全部 ${checks.length} 项通过`);
process.exit(fail ? 1 : 0);
