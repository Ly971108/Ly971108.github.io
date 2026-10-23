/* 夏夜老屋 M6 — interact.js
 * 射线拾取 + 状态机：电视旋钮/拉线灯/风扇/蚊香/作业本/奖状墙 + 键盘快捷键 + tooltip。
 * 契约见 docs/m6-contracts.md。状态存 window.__RM_STATE，供 M7 动画/M8 声音消费。
 */
import * as THREE from "three";

const LAMP_STEPS = [1.0, 0.35, 0.0];            /* 夜 → 深夜 → 黄昏（拉线循环） */
const LAMP_NAMES = ["夜灯", "深夜", "黄昏"];
const CHANNEL_HASH = ["#about", "#posts", "#archive", "#online"];

const state = (window.__RM_STATE = { lamp: 0, fan: 0, sound: false, channel: 0, volume: 2 });

/* SFX 事件总线：audio.js(M8) 监听 __RM_ACTION 播放合成音效 */
function sfx(type) {
  window.dispatchEvent(new CustomEvent("__RM_ACTION", { detail: { type: type } }));
}

let scene, camera, renderer, baked, screenApi, panelApi;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const targets = [];                              /* {obj, tip, action} */
const hover = { obj: null };
let tooltipEl = null, osdEl = null;
let lampCurrent = 1.0, lampTarget = 1.0;
let tvFlash = 0;                                 /* 换台白闪剩余 ms */

/* ---------- 目标发现：按命名契约在场景里找可交互节点 ---------- */
function findByName(re) {
  const out = [];
  scene.traverse((o) => { if (re.test(o.name || "")) out.push(o); });
  return out;
}

function collectTargets() {
  const add = (objs, tip, action) => objs.forEach((obj) => targets.push({ obj, tip, action }));

  add([scene.getObjectByName("prop_tv_knob_channel")].filter(Boolean),
    "电视频道 (T)", () => {
      if (screenApi && screenApi.nextChannel) {
        const ch = screenApi.nextChannel();
        state.channel = ch;
        setHash(CHANNEL_HASH[ch] || "#about");
        tvFlash = 120;
        sfx("knob");
      }
    });

  add([scene.getObjectByName("prop_tv_knob_volume")].filter(Boolean),
    "音量 (V)", () => {
      state.volume = (state.volume + 1) % 4;
      /* M9: 音量旋钮真实作用于 CRT 音量增益 */
      if (screenApi && screenApi.setGain) screenApi.setGain(state.volume / 3);
      osd("音量 " + (state.volume === 0 ? "静音" : state.volume + "/3"));
      sfx("knob");
    });

  /* 拉线：cord → bulb_wire → bulb_glass 依次兜底 */
  const cord = scene.getObjectByName("prop_lamp_cord") || scene.getObjectByName("bulb_wire")
    || scene.getObjectByName("bulb_glass") || scene.getObjectByName("bulb");
  add([cord].filter(Boolean), "拉线灯 (L)", () => {
    state.lamp = (state.lamp + 1) % LAMP_STEPS.length;
    lampTarget = LAMP_STEPS[state.lamp];
    osd("灯光 · " + LAMP_NAMES[state.lamp]);
    sfx("pull");
  });

  /* 风扇档位按钮（命名 prop_fan_button，无 knob/switch 后缀） */
  add([scene.getObjectByName("prop_fan_button")].filter(Boolean),
    "风扇档位 (F)", () => {
      state.fan = (state.fan + 1) % 4;
      osd("风扇 · " + (state.fan === 0 ? "关" : state.fan + " 档"));
      sfx("knob");
    });

  add([scene.getObjectByName("prop_mosq_ember")].filter(Boolean),
    "蚊香 · 声音开关", () => {
      state.sound = !state.sound;
      osd("声音 · " + (state.sound ? "开" : "关"));
    });

  add(findByName(/^prop_notebook_cover/),      /* GLB 实际为 _L/_R 两半 */
    "作业本 · 阅读", () => {
      const p = (window.__RM && window.__RM.posts && window.__RM.posts[0]) || null;
      if (panelApi && panelApi.openPost) panelApi.openPost(p ? p.u : "posts/index.html");
      sfx("page");
    });

  /* 奖状墙：任何 prop_award_ 前缀 mesh → ABOUT 频道 */
  add(findByName(/^prop_award_\d+_paper$/),
    "奖状墙 · 关于", () => {
      if (screenApi && screenApi.setChannel) screenApi.setChannel(0);
      state.channel = 0;
      setHash("#about");
    });

  /* 挂历 → 归档频道 */
  add([scene.getObjectByName("prop_calendar_page") || scene.getObjectByName("prop_calendar_rod")].filter(Boolean),
    "挂历 · 归档", () => {
      if (screenApi && screenApi.setChannel) screenApi.setChannel(2);
      state.channel = 2;
      setHash("#archive");
    });

  /* 收录机 → ONLINE 频道 */
  add(findByName(/^prop_radio_(body|top|front)/).slice(0, 1),
    "收录机 · 友情链接", () => {
      if (screenApi && screenApi.setChannel) screenApi.setChannel(3);
      state.channel = 3;
      setHash("#online");
    });
}

/* ---------- hash 同步（router.js 只改 HUD，这里接业务） ---------- */
function setHash(h) {
  if (("#" + (location.hash || "").replace(/^#\/?/, "")) === h) return;
  /* M9-P1-4: 直接赋值 location.hash，绕开 index.html 的 pushState 包装器
   * （包装器会把 #about 改写成 /about/ path 形态，导致 hashchange 丢失） */
  location.hash = h;
}
function onRoute() {
  const h = "#" + (location.hash || "").replace(/^#\/?/, "");
  /* M9-P2: #reading 直开阅读面板（夜读深链） */
  if (h === "#reading" && panelApi && panelApi.openPost) {
    const p = (window.__RM && window.__RM.posts && window.__RM.posts[0]) || null;
    panelApi.openPost(p ? p.u : "posts/index.html");
    return;
  }
  const i = CHANNEL_HASH.indexOf(h);
  if (i >= 0 && screenApi && screenApi.setChannel && state.channel !== i) {
    state.channel = i;
    screenApi.setChannel(i);
    tvFlash = 120;
  }
}

/* ---------- HUD：tooltip + OSD ---------- */
function ensureHud() {
  tooltipEl = document.createElement("div");
  tooltipEl.className = "rm-tooltip";
  tooltipEl.style.cssText = "position:fixed;z-index:60;pointer-events:none;display:none;" +
    "padding:3px 10px;border-radius:4px;font:12px/1.6 system-ui,sans-serif;" +
    "background:rgba(12,10,8,.82);color:#e8d9a8;border:1px solid rgba(232,217,168,.35);";
  document.body.appendChild(tooltipEl);
  osdEl = document.createElement("div");
  osdEl.className = "rm-osd";
  osdEl.style.cssText = "position:fixed;left:18px;bottom:52px;z-index:60;pointer-events:none;" +
    "font:13px/1.8 system-ui,sans-serif;color:#e8d9a8;text-shadow:0 1px 2px #000;opacity:0;" +
    "transition:opacity .25s;";
  document.body.appendChild(osdEl);
}
let osdTimer = 0;
function osd(text, ms = 1600) {
  if (!osdEl) return;
  osdEl.textContent = text;
  osdEl.style.opacity = "1";
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => { osdEl.style.opacity = "0"; }, ms);
}

/* ---------- 拾取 ---------- */
function pick(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const objs = targets.map((t) => t.obj);
  const hits = raycaster.intersectObjects(objs, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o) {
    const t = targets.find((x) => x.obj === o);
    if (t) return t;
    o = o.parent;
  }
  return null;
}

function setHover(t, ev) {
  if (hover.obj && hover.obj !== (t && t.obj)) {
    const prev = targets.find((x) => x.obj === hover.obj);
    if (prev) restoreEmissive(prev.obj);
  }
  hover.obj = t ? t.obj : null;
  if (!t) { tooltipEl.style.display = "none"; renderer.domElement.style.cursor = ""; return; }
  liftEmissive(t.obj);
  tooltipEl.textContent = t.tip;
  tooltipEl.style.display = "block";
  tooltipEl.style.left = (ev.clientX + 14) + "px";
  tooltipEl.style.top = (ev.clientY + 10) + "px";
  renderer.domElement.style.cursor = "pointer";
}

/* 高亮：无灯光依赖的 emissive 提亮（MeshStandard/Physical 才支持） */
function eachMesh(obj, fn) {
  obj.traverse ? obj.traverse((o) => { if (o.isMesh && o.material && o.material.emissive) fn(o); }) : null;
}
function liftEmissive(obj) { eachMesh(obj, (m) => { m.material.emissive.setHex(0x33270f); }); }
function restoreEmissive(obj) { eachMesh(obj, (m) => { m.material.emissive.setHex(0x000000); }); }

/* ---------- 键盘 ---------- */
function onKey(ev) {
  if (panelApi && panelApi.isOpen && panelApi.isOpen()) {
    if (ev.key === "Escape") panelApi.close();
    return;
  }
  const k = ev.key.toLowerCase();
  if (k === "t") { const t = targets.find((x) => /频道/.test(x.tip)); if (t) t.action(); }
  else if (k === "l") { const t = targets.find((x) => /拉线/.test(x.tip)); if (t) t.action(); }
  else if (k === "f") { const t = targets.find((x) => /风扇/.test(x.tip)); if (t) t.action(); }
  else if (k === "v") { const t = targets.find((x) => /音量/.test(x.tip)); if (t) t.action(); }
  /* M9-P1-2: O 键补收录机（默认机位在视口外，键盘可达 = 可访问性） */
  else if (k === "o") { const t = targets.find((x) => /收录机/.test(x.tip)); if (t) t.action(); }
  /* M9-P2: 方向键在 CRT 列表内移动（等同 N 键下翻） */
  else if (k === "n" || k === "arrowdown") { if (screenApi && screenApi.nextItem) screenApi.nextItem(); }
  else if (k === "arrowup") { if (screenApi && screenApi.selectPrev) screenApi.selectPrev(); }
  else if (k === "escape") { setHash("#"); }
}

/* ---------- 灯态/电视每帧缓动 ---------- */
function tick(dt) {
  if (!baked) return;
  lampCurrent += (lampTarget - lampCurrent) * Math.min(1, dt * 0.008);
  if (Math.abs(lampCurrent - lampTarget) < 0.002) lampCurrent = lampTarget;
  baked.bakedState.lampState.value = lampCurrent;

  /* 换台白闪：tvColor 瞬时冲高再回落 */
  if (tvFlash > 0) {
    tvFlash -= dt;
    const k = Math.max(0, tvFlash / 120);
    baked.bakedState.tvColor.value.setScalar(0.9 * k * k);
  } else {
    /* 常态微光：屏幕待机功耗感（频道 0 ABOUT 最亮） */
    const base = state.channel === 0 ? 0.10 : 0.06;
    baked.bakedState.tvColor.value.set(base, base * 0.95, base * 0.85);
  }
}

/* ---------- 入口 ---------- */
export function initInteract(ctx) {
  scene = ctx.scene; camera = ctx.camera; renderer = ctx.renderer;
  baked = ctx.baked; screenApi = ctx.screen || null; panelApi = ctx.panel || null;
  ensureHud();
  collectTargets();
  if (!targets.length) console.warn("[RM] interact: 未找到任何可交互节点");

  const cv = renderer.domElement;
  cv.addEventListener("pointermove", (ev) => setHover(pick(ev), ev));
  cv.addEventListener("pointerdown", (ev) => { const t = pick(ev); if (t) t.action(); });
  cv.addEventListener("pointerleave", () => setHover(null, {}));
  addEventListener("keydown", onKey);
  addEventListener("hashchange", onRoute);
  onRoute();                                       /* M9-P1-3: 初始 hash 恢复频道 */

  /* 供 main.js 每帧调用 */
  return { tick };
}
