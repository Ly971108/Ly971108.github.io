/* 夏夜老屋 M8 — audio.js
 * 环境音（ambient.ogg 无缝循环）+ 风扇风声 + 一次性 SFX（程序合成，无素材）。
 * 契约见 docs/m8-contracts.md：
 *   initAudio() → { tick(dtMs) }
 *   - AudioContext 延迟到首次用户手势（pointerdown/keydown）后创建；
 *   - 每 tick 对比 window.__RM_STATE 前值（其属性无 setter，无法订阅）：
 *     sound 变化 → 环境音 1.5s 淡入/淡出（0.5 增益），并持久化 localStorage("rm_sound")；
 *     fan 变化 → 循环风声 0.3s 渐变到 fan×0.12；
 *     lamp/channel 变化 → 自行推断拉线/旋钮 SFX（__RM_ACTION 事件优先，双保险）；
 *   - window.__RM_SFX = { click(), pull(), page() } 供 interact/screen 调；
 *   - document 上的静音按钮（#sound / .rm-mute-btn）点击翻转 sound；
 *   - 无头/无声卡环境全部静默降级，不抛错。
 * 注意：main.js 当前未接 audioApi.tick（主会话后续接线），本模块自带
 * rAF 自驱动 tick；外部再调 tick 也幂等（纯前值对比），不会双倍触发。
 */
export function initAudio() {
  const w = typeof window !== "undefined" ? window : null;
  const doc = typeof document !== "undefined" ? document : null;

  /* 运行期状态。silent=true 表示永久静默降级（无 AudioContext 或创建失败）。 */
  const A = {
    ctx: null, master: null,
    ambientGain: null, fanGain: null, noiseBuf: null,
    silent: false, started: false,
    ambientTarget: 0,          // 环境音当前目标增益（素材未就绪时先记着）
    lastSfxAt: { knob: 0, pull: 0, page: 0 },  // 事件与状态推断互斥防抖
  };

  /* ---------- localStorage 安全封装（隐私模式可能抛错） ---------- */
  function lsGet(k) { try { return w ? w.localStorage.getItem(k) : null; } catch { return null; } }
  function lsSet(k, v) { try { if (w) w.localStorage.setItem(k, v); } catch { /* 忽略 */ } }

  /* ---------- 状态存取 ---------- */
  function state() {
    if (!w) return null;
    if (!w.__RM_STATE) {
      /* interact.js 尚未建状态时兜底创建，避免后续空引用 */
      w.__RM_STATE = { lamp: 0, fan: 0, sound: false, channel: 0, volume: 2 };
    }
    return w.__RM_STATE;
  }

  /* 初始化：localStorage("rm_sound") → 回写 __RM_STATE.sound（契约要求） */
  const persisted = lsGet("rm_sound");
  const st0 = state();
  if (persisted !== null && st0) st0.sound = persisted === "1";
  const prev = {
    sound: st0 ? !!st0.sound : false,
    fan: st0 ? st0.fan | 0 : 0,
    lamp: st0 ? st0.lamp | 0 : 0,
    channel: st0 ? st0.channel | 0 : 0,
  };
  A.ambientTarget = prev.sound ? 0.5 : 0;
  A.fanTarget = prev.fan * 0.12;

  /* ---------- 静音按钮（index.html 里是 #sound；class "sound" 被多个元素共用，不能按 class 找） ---------- */
  const muteBtn = doc ? (doc.getElementById("sound") || doc.querySelector(".rm-mute-btn")) : null;
  function syncMuteBtn(on) {
    if (!muteBtn) return;
    try {
      muteBtn.textContent = "声音 " + (on ? "开" : "关");
      muteBtn.setAttribute("aria-pressed", on ? "true" : "false");
    } catch { /* 忽略 */ }
  }
  if (muteBtn) {
    syncMuteBtn(prev.sound);
    muteBtn.addEventListener("click", () => {
      const s = state();
      if (!s) return;
      s.sound = !s.sound;          /* tick 检测到变化后会持久化 + 淡入淡出 */
    });
  }

  /* ---------- 一次性 SFX（程序合成） ---------- */
  function now() { return A.ctx ? A.ctx.currentTime : 0; }

  /* 旋钮咔哒：短方波 2ms + 高通噪声 */
  function sfxClick() {
    if (!A.ctx) return;
    try {
      const ctx = A.ctx, t = now();
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 1800;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.22, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
      osc.connect(og); og.connect(A.master);
      osc.start(t); osc.stop(t + 0.03);
      if (A.noiseBuf) {
        const n = ctx.createBufferSource();
        n.buffer = A.noiseBuf;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass"; hp.frequency.value = 5000;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.1, t);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
        n.connect(hp); hp.connect(ng); ng.connect(A.master);
        n.start(t); n.stop(t + 0.02);
      }
    } catch { /* 静默 */ }
  }

  /* 拉线：快速上滑正弦 30ms */
  function sfxPull() {
    if (!A.ctx) return;
    try {
      const ctx = A.ctx, t = now();
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.linearRampToValueAtTime(880, t + 0.03);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      osc.connect(g); g.connect(A.master);
      osc.start(t); osc.stop(t + 0.05);
    } catch { /* 静默 */ }
  }

  /* 翻页：带通噪声 120ms 衰减 */
  function sfxPage() {
    if (!A.ctx || !A.noiseBuf) return;
    try {
      const ctx = A.ctx, t = now();
      const n = ctx.createBufferSource();
      n.buffer = A.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 1600; bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      n.connect(bp); bp.connect(g); g.connect(A.master);
      n.start(t); n.stop(t + 0.15);
    } catch { /* 静默 */ }
  }

  /* 供外部直接调用（interact/screen 后续接线用）；
   * 事件与状态推断在同一 ms 内互斥，避免将来 interact 既派发事件又改状态时双响。 */
  function guardSfx(kind, fn) {
    const t = Date.now();
    if (t - A.lastSfxAt[kind] < 200) return;
    A.lastSfxAt[kind] = t;
    fn();
  }
  const SFX = {
    click() { guardSfx("knob", sfxClick); },
    pull() { guardSfx("pull", sfxPull); },
    page() { guardSfx("page", sfxPage); },
  };
  if (w) w.__RM_SFX = SFX;

  /* __RM_ACTION 自定义事件：interact.js 后续补派发，缺事件时靠状态推断，二者不冲突 */
  if (w) {
    w.addEventListener("__RM_ACTION", (ev) => {
      const type = ev && ev.detail && ev.detail.type;
      if (type === "knob") SFX.click();
      else if (type === "pull") SFX.pull();
      else if (type === "page" || type === "channel") SFX.page();
    });
  }

  /* ---------- AudioContext 创建（首次用户手势后才调用） ---------- */
  function rampGain(param, target, sec) {
    const t = now();
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value || 0, t);
    param.linearRampToValueAtTime(target, t + sec);
  }

  function loadAmbient() {
    const ctx = A.ctx;
    /* 先试相对路径（index.html 在站点根），失败再试站点绝对路径（测试 harness 等） */
    const tryFetch = (p) => fetch(p).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); });
    tryFetch("assets/scene/v0001/audio/ambient.ogg")
      .catch(() => tryFetch("/assets/scene/v0001/audio/ambient.ogg"))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;                 /* 素材首尾无缝，直接循环 */
        src.connect(A.ambientGain);
        src.start();
        rampGain(A.ambientGain.gain, A.ambientTarget, 1.5);
      })
      .catch(() => { /* 素材缺失：仅无环境音，SFX/风声不受影响 */ });
  }

  function startFanLoop() {
    const ctx = A.ctx;
    const src = ctx.createBufferSource();
    src.buffer = A.noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 400;   /* 闷哼的风 */
    src.connect(lp); lp.connect(A.fanGain);
    src.start();
    rampGain(A.fanGain.gain, A.fanTarget, 0.3);
  }

  function ensureCtx() {
    if (!w || A.ctx || A.silent) return;
    const AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) { A.silent = true; return; }            /* 无头环境：永久静默降级 */
    try {
      const ctx = new AC();
      A.ctx = ctx;
      A.master = ctx.createGain();
      A.master.gain.value = 0.9;
      A.master.connect(ctx.destination);
      A.ambientGain = ctx.createGain();
      A.ambientGain.gain.value = 0;
      A.ambientGain.connect(A.master);
      A.fanGain = ctx.createGain();
      A.fanGain.gain.value = A.fanTarget || 0;
      A.fanGain.connect(A.master);
      /* 0.6s 白噪声缓存：给翻页/咔哒/风声共用 */
      const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
      const ch = nb.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      A.noiseBuf = nb;
      loadAmbient();
      startFanLoop();
      if (ctx.state === "suspended" && ctx.resume) ctx.resume().catch(() => { /* 忽略 */ });
    } catch {
      A.ctx = null;
      A.silent = true;
    }
  }

  /* 首次用户手势才创建 AudioContext（浏览器自动播放策略） */
  function onGesture() { ensureCtx(); }
  if (w) {
    w.addEventListener("pointerdown", onGesture, { once: true });
    w.addEventListener("keydown", onGesture, { once: true });
  }

  /* ---------- 每帧 tick：前值对比驱动所有变化 ---------- */
  function tick(dtMs) {
    if (!w) return;
    const s = state();
    if (!s) return;

    /* 声音总开关 */
    const snd = !!s.sound;
    if (snd !== prev.sound) {
      prev.sound = snd;
      lsSet("rm_sound", snd ? "1" : "0");
      A.ambientTarget = snd ? 0.5 : 0;
      if (A.ctx && A.ambientGain) rampGain(A.ambientGain.gain, A.ambientTarget, 1.5);
      syncMuteBtn(snd);
    }

    /* 风扇档位 */
    const fan = s.fan | 0;
    if (fan !== prev.fan) {
      prev.fan = fan;
      A.fanTarget = fan * 0.12;
      if (A.ctx && A.fanGain) rampGain(A.fanGain.gain, A.fanTarget, 0.3);
      SFX.click();                     /* 机械档位按钮，给一声咔哒 */
    }

    /* 拉线灯 / 换台：interact 尚未派发 __RM_ACTION，自行推断 */
    const lamp = s.lamp | 0;
    if (lamp !== prev.lamp) { prev.lamp = lamp; SFX.pull(); }
    const ch = s.channel | 0;
    if (ch !== prev.channel) { prev.channel = ch; SFX.page(); }
  }

  /* main.js 未接线期间自驱动；rAF 不可用时退回 setInterval */
  if (w) {
    let last = (w.performance && w.performance.now()) || Date.now();
    const loop = (nowMs) => {
      tick(nowMs - last);
      last = nowMs;
      if (w.requestAnimationFrame) w.requestAnimationFrame(loop);
    };
    if (w.requestAnimationFrame) w.requestAnimationFrame(loop);
    else setInterval(() => { const n = Date.now(); tick(n - last); last = n; }, 16);
  }

  return { tick };
}
