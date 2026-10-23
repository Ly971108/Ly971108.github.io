/* 夏夜老屋 M6 — screen.js（CRT 电视屏幕 Canvas UI）
 * 契约：docs/m6-contracts.md §screen.js
 *
 * 职责：
 *   - 找 scene.getObjectByName("prop_tv_screen")，替换为 CanvasTexture(640×480)
 *     + 自定义 CRT ShaderMaterial（桶形畸变 / 隔行扫描线 / 暖白磷光 / time 噪点）。
 *   - 4 个频道全部 Canvas 2D 绘制：0 ABOUT / 1 写作 / 2 归档 / 3 ONLINE。
 *   - 重绘仅发生在：频道切换 / 选择移动 / OSD / 500ms 时钟 tick。
 *   - rAF 在收到 __RM_ENTER 后才启动，每帧只更新 uTime（噪点流动）与灯态亮度。
 *   - 防御：prop_tv_screen 缺失 / __RM 数据缺失 → console.warn + 空操作（待机画面）。
 *
 * 与 interact.js 的分工（契约 §interact.js）：
 *   - 键盘 N/↓ 由 interact.js 绑定，调用契约附加 API nextItem() 下移选择（到尾循环回首）；
 *   - Enter 在频道 1 打开当前选中文章（回调 window.__RM_OPEN_POST(url)），
 *     契约键盘表未给 interact 分配 Enter，故由本模块自行监听，无冲突。
 */

import * as THREE from "three";

/* ---------- 常量 ---------- */
const CW = 640, CH = 480;              // canvas 分辨率
const CHANNEL_COUNT = 4;
const CHANNEL_TITLES = ["ABOUT", "写作", "归档", "ONLINE"];
const FALLBACK_LINK = "github.com/Ly971108";
const FONT_STACK = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
const MONO_STACK = '"SF Mono","Cascadia Code",Consolas,"Courier New",monospace';

/* 磷光配色：黑底 + 绿磷光主色 + 暖白高亮 + 琥珀链接。
 * 刻意避免纯白爆亮，贴合烘焙帧的暖黄夜灯氛围（tools/blender/out/dbg_night.png）。 */
const COL_BG      = "#060705";
const COL_GREEN   = "#8ceaa6";
const COL_DIM     = "rgba(140,234,166,0.55)";
const COL_FAINT   = "rgba(140,234,166,0.22)";
const COL_WHITE   = "#f2e6c8";
const COL_AMBER   = "#e8b96a";
const COL_DARK    = "#0a0c08";
const COL_LINE    = "rgba(140,234,166,0.30)";

/* ---------- CRT 着色器 ---------- */
const CRT_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CRT_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uBright;
  varying vec2 vUv;

  /* 桶形畸变：四角内凹，老电视显像管弧度 */
  vec2 barrel(vec2 uv) {
    vec2 c = uv - 0.5;
    float r2 = dot(c, c);
    c *= 1.0 + 0.16 * r2;
    return c + 0.5;
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 uv = barrel(vUv);

    vec3 col = vec3(0.0);
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
      /* 轻微色散：边缘一点红蓝色偏 */
      vec2 off = (uv - 0.5) * 0.006;
      col.r = texture2D(uMap, uv + off).r;
      col.g = texture2D(uMap, uv).g;
      col.b = texture2D(uMap, uv - off).b;
    }

    /* 隔行扫描线：暗行亮度 ×0.85 */
    float scan = mix(0.85, 1.0, step(0.5, fract(gl_FragCoord.y * 0.5)));
    col *= scan;

    /* 暗角 + 玻璃反光 */
    vec2 d = vUv - 0.5;
    float vig = 1.0 - dot(d, d) * 1.15;
    col *= clamp(vig, 0.0, 1.0);
    col += vec3(0.010, 0.012, 0.009) * (1.0 - dot(d, d) * 3.0);

    /* 暖白磷光色调微调（绿略抬、蓝略压） */
    col = col * vec3(0.98, 1.04, 0.94);

    /* 轻微噪点（随 time 流动） */
    float n = hash(vUv * vec2(913.0, 711.0) + floor(uTime * 24.0));
    col += (n - 0.5) * 0.035;

    /* 灯态亮度（深夜略降）与外部增益（interact 音量键临时复用） */
    col *= uBright;

    /* 显像管边缘压黑，遮掉畸变漏边 */
    float edge = smoothstep(0.0, 0.02, uv.x) * smoothstep(1.0, 0.98, uv.x)
               * smoothstep(0.0, 0.02, uv.y) * smoothstep(1.0, 0.98, uv.y);
    col *= mix(0.0, 1.0, edge);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/* ---------- 防御性数据读取 ---------- */
function readRM() {
  const RM = window.__RM;
  if (!RM || typeof RM !== "object") return { posts: [], about: [] };
  return {
    posts: Array.isArray(RM.posts) ? RM.posts.filter(p => p && typeof p === "object") : [],
    about: Array.isArray(RM.about) ? RM.about.filter(b => Array.isArray(b) && b.length >= 2) : [],
  };
}

function hasAnyContent(data) {
  return data.posts.length > 0 || data.about.length > 0;
}

/* 从 about 链接区间收集 href（去重，保序）；空则回退默认链接 */
function collectOnlineLinks(about) {
  const seen = new Set(), out = [];
  for (const block of about) {
    const links = block[2];
    if (!Array.isArray(links)) continue;
    for (const l of links) {
      const href = l && l[2];
      if (typeof href === "string" && href && !seen.has(href)) {
        seen.add(href);
        out.push(href);
      }
    }
  }
  if (!out.length) out.push(FALLBACK_LINK);
  return out;
}

/* 从 date 串提取年份（如 "2026-08-24" / "2026/08/24" / "Aug 2026"） */
function yearOf(dateStr) {
  const m = /(\d{4})/.exec(String(dateStr || ""));
  return m ? m[1] : "更早";
}

/* ---------- Canvas 排版工具 ---------- */
function setFont(ctx, size, mono, weight) {
  ctx.font = (weight ? weight + " " : "") + size + 'px ' + (mono ? MONO_STACK : FONT_STACK);
}

/* 纯文本按宽度折行 */
function wrapText(ctx, text, maxW) {
  const lines = [];
  let line = "";
  for (const ch of String(text)) {
    if (ch === "\n") { lines.push(line); line = ""; continue; }
    if (line && ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; }
    else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

/* 富文本折行：把段落按链接区间切成 run，折行时保留 href 归属 */
function wrapRich(ctx, text, links, maxW) {
  const segs = [];
  let pos = 0;
  const ranges = (links || []).slice().sort((a, b) => a[0] - b[0]);
  for (const l of ranges) {
    const s = Math.max(pos, +l[0] || 0), e = Math.min(String(text).length, +l[1] || 0);
    if (s > pos) segs.push({ t: String(text).slice(pos, s) });
    if (e > s) segs.push({ t: String(text).slice(s, e), href: l[2] });
    pos = Math.max(pos, e);
  }
  if (pos < String(text).length) segs.push({ t: String(text).slice(pos) });

  const lines = [];
  let cur = [], curW = 0;
  for (const seg of segs) {
    for (const ch of seg.t) {
      const w = ctx.measureText(ch).width;
      if (cur.length && curW + w > maxW) { lines.push(cur); cur = []; curW = 0; }
      const last = cur[cur.length - 1];
      if (last && last.href === seg.href) { last.t += ch; last.w += w; }
      else cur.push({ t: ch, href: seg.href, w });
      curW += w;
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function drawRuns(ctx, runs, x, y) {
  let cx = x;
  for (const r of runs) {
    if (r.href) { ctx.fillStyle = COL_AMBER; }
    ctx.fillText(r.t, cx, y);
    if (r.href) {
      ctx.strokeStyle = COL_AMBER;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, y + 2);
      ctx.lineTo(cx + r.w, y + 2);
      ctx.stroke();
      ctx.fillStyle = COL_GREEN;
    }
    cx += r.w;
  }
}

/* ---------- 主模块 ---------- */
export function initScreen(scene) {
  /* 契约：缺网格 → warn + 空 API */
  let mesh = null;
  if (scene && typeof scene.getObjectByName === "function") {
    const found = scene.getObjectByName("prop_tv_screen");
    if (found) mesh = found.isMesh ? found : (found.getObjectByProperty ? found.getObjectByProperty("isMesh", true) : null) || found;
  }
  if (!mesh) {
    console.warn("[RM][screen] prop_tv_screen 缺失，屏幕模块以空 API 降级");
    return {
      setChannel() {}, nextChannel() { return 0; }, getChannel() { return 0; },
      osd() {}, onChannel() {}, selectNext() {}, selectPrev() {}, openSelected() {}, setGain() {},
    };
  }

  /* --- Canvas + 纹理 --- */
  const canvas = document.createElement("canvas");
  canvas.width = CW; canvas.height = CH;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);

  const material = new THREE.ShaderMaterial({
    vertexShader: CRT_VERT,
    fragmentShader: CRT_FRAG,
    uniforms: {
      uMap: { value: texture },
      uTime: { value: 0 },
      uBright: { value: 1.0 },
    },
  });
  mesh.material = material;

  /* --- 状态 --- */
  let channel = 0;
  let selIdx = 0;                       // 频道 1 选中行
  let standby = false;                  // 数据缺失时待机（黑屏 + 细亮横线）
  let switchAt = performance.now();     // 大 OSD 频道号显示时刻
  let osdMsg = null, osdUntil = 0;
  let gain = 1.0;                       // interact 音量键临时复用的亮度增益（附加）
  const channelCbs = [];
  let rafStarted = false, rafPrev = 0;

  /* ---------- 绘制：公共骨架 ---------- */
  function paintBase(title) {
    ctx.fillStyle = COL_BG;
    ctx.fillRect(0, 0, CW, CH);

    /* 极淡的背景扫描栅格，增加显像管质感 */
    ctx.fillStyle = COL_FAINT;
    for (let y = 0; y < CH; y += 4) ctx.fillRect(0, y, CW, 1);

    /* 顶部状态条 */
    ctx.fillStyle = COL_DIM;
    setFont(ctx, 15);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = COL_GREEN;
    ctx.fillText("CH " + channel + " · " + title, 24, 32);
    ctx.strokeStyle = COL_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(24, 42); ctx.lineTo(CW - 24, 42); ctx.stroke();
  }

  function paintClock() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    setFont(ctx, 16);
    ctx.textAlign = "right";
    ctx.fillStyle = COL_DIM;
    ctx.fillText(hh + ":" + mm, CW - 24, 32);
    ctx.textAlign = "left";
  }

  function paintOverlays(now) {
    /* 频道号大 OSD：切换后 ~0.9s 左上角大数字 */
    if (now - switchAt < 900) {
      const a = 1 - (now - switchAt) / 900;
      setFont(ctx, 64);
      ctx.fillStyle = "rgba(242,230,200," + (0.55 + 0.45 * a).toFixed(3) + ")";
      ctx.fillText("0" + (channel + 1), 30, 116);
    }
    /* 自定义 OSD：右上角短消息 */
    if (osdMsg && now < osdUntil) {
      setFont(ctx, 17);
      ctx.textAlign = "right";
      ctx.fillStyle = COL_WHITE;
      ctx.fillText(osdMsg, CW - 24, 66);
      ctx.textAlign = "left";
    }
  }

  function paintStandby() {
    ctx.fillStyle = "#020302";
    ctx.fillRect(0, 0, CW, CH);
    /* 待机细亮横线（老电视关机余辉） */
    const g = ctx.createLinearGradient(0, CH / 2 - 3, 0, CH / 2 + 3);
    g.addColorStop(0, "rgba(140,234,166,0)");
    g.addColorStop(0.5, "rgba(200,255,215,0.85)");
    g.addColorStop(1, "rgba(140,234,166,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, CH / 2 - 3, CW, 6);
  }

  /* ---------- 频道 0：ABOUT ---------- */
  function drawAbout(data) {
    paintBase(CHANNEL_TITLES[0]);
    setFont(ctx, 24);
    ctx.fillStyle = COL_WHITE;
    ctx.fillText("关于", 24, 78);

    let y = 116;
    const maxW = CW - 48;
    const bottomLimit = CH - 64;

    for (const block of data.about) {
      if (y > bottomLimit) { setFont(ctx, 18); ctx.fillStyle = COL_DIM; ctx.fillText("…", 24, y); y += 28; break; }
      const tag = block[0], text = String(block[1] == null ? "" : block[1]);
      if (!text && tag !== "r") continue;

      switch (tag) {
        case "h": case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
          setFont(ctx, 19);
          ctx.fillStyle = COL_AMBER;
          for (const ln of wrapText(ctx, text, maxW)) {
            ctx.fillText(ln, 24, y); y += 26;
            if (y > bottomLimit) break;
          }
          y += 4;
          break;
        }
        case "p": {
          setFont(ctx, 17);
          ctx.fillStyle = COL_GREEN;
          const lines = wrapRich(ctx, text, block[2], maxW);
          for (const runs of lines) {
            if (y > bottomLimit) { ctx.fillStyle = COL_DIM; ctx.fillText("…", 24, y); y += 28; break; }
            drawRuns(ctx, runs, 24, y);
            y += 24;
          }
          y += 8;
          break;
        }
        case "l": {
          setFont(ctx, 16);
          ctx.fillStyle = COL_GREEN;
          const prefix = block[2] || "·";
          const lines = wrapText(ctx, prefix + " " + text, maxW - 14);
          for (const ln of lines) { ctx.fillText(ln, 38, y); y += 22; }
          y += 4;
          break;
        }
        case "q": {
          setFont(ctx, 16);
          ctx.fillStyle = COL_DIM;
          const lines = wrapText(ctx, text, maxW - 28);
          for (const ln of lines) { ctx.fillText(ln, 44, y); y += 22; }
          y += 6;
          break;
        }
        case "c": {
          setFont(ctx, 15, true);
          ctx.fillStyle = COL_DIM;
          for (const ln of String(text).split("\n")) {
            const wl = wrapText(ctx, ln || " ", maxW - 28);
            for (const w2 of wl) { ctx.fillText(w2, 40, y); y += 20; }
          }
          y += 6;
          break;
        }
        case "i": {
          setFont(ctx, 15);
          ctx.fillStyle = COL_DIM;
          ctx.fillText("[图] " + text, 24, y); y += 22;
          break;
        }
        case "r": {
          ctx.strokeStyle = COL_LINE;
          ctx.beginPath(); ctx.moveTo(24, y); ctx.lineTo(CW - 24, y); ctx.stroke();
          y += 16;
          break;
        }
        default: {
          setFont(ctx, 16);
          ctx.fillStyle = COL_GREEN;
          for (const ln of wrapText(ctx, text, maxW)) { ctx.fillText(ln, 24, y); y += 22; }
          y += 6;
        }
      }
      if (y > bottomLimit) { setFont(ctx, 18); ctx.fillStyle = COL_DIM; ctx.fillText("…", 24, y); break; }
    }

    /* 底部固定链接（契约） */
    ctx.strokeStyle = COL_LINE;
    ctx.beginPath(); ctx.moveTo(24, CH - 44); ctx.lineTo(CW - 24, CH - 44); ctx.stroke();
    setFont(ctx, 15);
    ctx.textAlign = "center";
    ctx.fillStyle = COL_AMBER;
    ctx.fillText(FALLBACK_LINK, CW / 2, CH - 18);
    ctx.textAlign = "left";
  }

  /* ---------- 频道 1：写作 ---------- */
  function drawPosts(data) {
    paintBase(CHANNEL_TITLES[1]);
    const posts = data.posts;
    const total = posts.length;

    setFont(ctx, 24);
    ctx.fillStyle = COL_WHITE;
    ctx.fillText("写作 · " + total + " 篇", 24, 78);

    if (!total) {
      setFont(ctx, 17);
      ctx.fillStyle = COL_DIM;
      ctx.fillText("暂无文章", 24, 120);
    } else {
      selIdx = Math.max(0, Math.min(selIdx, total - 1));
      let y = 110;
      const rowH = 40, maxW = CW - 48 - 40;
      const visible = Math.max(1, Math.floor((CH - 110 - 56) / rowH));
      let start = 0;
      if (selIdx >= visible) start = selIdx - visible + 1;

      posts.slice(start, start + visible).forEach((p, i) => {
        const idx = start + i;
        const selected = idx === selIdx;
        const ry = y + i * rowH;
        if (selected) {
          ctx.fillStyle = COL_WHITE;
          ctx.fillRect(20, ry - 22, CW - 40, rowH - 4);
          ctx.fillStyle = COL_DARK;
        } else {
          ctx.fillStyle = COL_GREEN;
        }
        setFont(ctx, 17);
        const num = String(idx + 1).padStart(2, "0");
        ctx.fillStyle = selected ? COL_DARK : COL_DIM;
        ctx.fillText(num, 30, ry);
        ctx.fillStyle = selected ? COL_DARK : COL_GREEN;
        const title = String(p.t || "(无题)");
        const lines = wrapText(ctx, title, maxW);
        ctx.fillText(lines[0] + (lines.length > 1 ? " …" : ""), 70, ry);
        /* 日期右对齐 */
        ctx.textAlign = "right";
        setFont(ctx, 13);
        ctx.fillStyle = selected ? "rgba(10,12,8,0.6)" : COL_DIM;
        ctx.fillText(String(p.d || ""), CW - 34, ry);
        ctx.textAlign = "left";
      });
    }

    setFont(ctx, 14);
    ctx.fillStyle = COL_DIM;
    ctx.fillText("N/↓ 下选 · Enter 打开", 24, CH - 18);
  }

  /* ---------- 频道 2：归档 ---------- */
  function drawArchive(data) {
    paintBase(CHANNEL_TITLES[2]);
    const byYear = new Map();
    for (const p of data.posts) {
      const y = yearOf(p.d);
      byYear.set(y, (byYear.get(y) || 0) + 1);
    }
    const years = Array.from(byYear.keys()).sort((a, b) => String(b).localeCompare(String(a)));

    setFont(ctx, 24);
    ctx.fillStyle = COL_WHITE;
    ctx.fillText("按年份归档", 24, 78);

    if (!years.length) {
      setFont(ctx, 17);
      ctx.fillStyle = COL_DIM;
      ctx.fillText("暂无文章", 24, 120);
    } else {
      let y = 122;
      const maxCount = Math.max.apply(null, years.map(k => byYear.get(k)));
      for (const yr of years) {
        const c = byYear.get(yr);
        setFont(ctx, 20);
        ctx.fillStyle = COL_GREEN;
        ctx.fillText(String(yr), 40, y);
        /* 计数条 */
        const bw = Math.round((CW - 320) * (c / maxCount));
        ctx.fillStyle = COL_FAINT;
        ctx.fillRect(180, y - 12, CW - 320, 10);
        ctx.fillStyle = COL_DIM;
        ctx.fillRect(180, y - 12, bw, 10);
        setFont(ctx, 16);
        ctx.fillStyle = COL_AMBER;
        ctx.textAlign = "right";
        ctx.fillText(c + " 篇", CW - 44, y);
        ctx.textAlign = "left";
        y += 40;
        if (y > CH - 60) { setFont(ctx, 17); ctx.fillStyle = COL_DIM; ctx.fillText("…", 40, y); break; }
      }
    }
  }

  /* ---------- 频道 3：ONLINE ---------- */
  function drawOnline(data) {
    paintBase(CHANNEL_TITLES[3]);
    const links = collectOnlineLinks(data.about);

    setFont(ctx, 24);
    ctx.fillStyle = COL_WHITE;
    ctx.fillText("网上联络", 24, 78);

    let y = 124;
    links.forEach((href, i) => {
      setFont(ctx, 17);
      ctx.fillStyle = COL_DIM;
      const num = String(i + 1).padStart(2, "0");
      ctx.fillText(num, 40, y);
      ctx.fillStyle = COL_GREEN;
      /* 过长截断省略 */
      let text = href.replace(/^https?:\/\//, "");
      const maxW = CW - 48 - 70;
      if (ctx.measureText(text).width > maxW) {
        while (text.length && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
        text += "…";
      }
      ctx.fillText(text, 82, y);
      y += 36;
      if (y > CH - 60) { setFont(ctx, 16); ctx.fillStyle = COL_DIM; ctx.fillText("…", 82, y); return; }
    });
  }

  /* ---------- 重绘调度 ---------- */
  function draw() {
    const data = readRM();
    standby = !hasAnyContent(data);
    if (standby) {
      paintStandby();
    } else {
      switch (channel) {
        case 0: drawAbout(data); break;
        case 1: drawPosts(data); break;
        case 2: drawArchive(data); break;
        case 3: drawOnline(data); break;
      }
      paintClock();
      paintOverlays(performance.now());
    }
    texture.needsUpdate = true;
  }

  function lampTarget() {
    const baked = window.__RM_BAKED;
    const lamp = baked && baked.bakedState && baked.bakedState.lampState ? +baked.bakedState.lampState.value : 1;
    return (lamp < 0.5 ? 0.7 : 1.0) * gain;   /* 深夜屏幕略降亮度 */
  }

  function rafLoop(t) {
    requestAnimationFrame(rafLoop);
    const dt = rafPrev ? Math.min(0.1, (t - rafPrev) / 1000) : 0;
    rafPrev = t;
    material.uniforms.uTime.value += dt;
    /* 亮度朝灯态目标缓动 */
    const cur = material.uniforms.uBright.value;
    material.uniforms.uBright.value = cur + (lampTarget() - cur) * 0.08;
  }

  function startRaf() {
    if (rafStarted) return;
    rafStarted = true;
    requestAnimationFrame(rafLoop);
    /* 500ms 时钟 tick：重绘右上角时间（顺带刷新 OSD 过期） */
    setInterval(() => { if (!standby) draw(); }, 500);
  }
  addEventListener("__RM_ENTER", startRaf);
  if (window.__RM_ENTERED) startRaf();   /* 极端时序：enter 早于初始化 */

  /* Enter 打开选中文章（契约键盘表未分配 Enter 给 interact，自行监听无冲突） */
  addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || channel !== 1 || e.defaultPrevented || standby) return;
    const posts = readRM().posts;
    if (!posts.length) return;
    selIdx = Math.max(0, Math.min(selIdx, posts.length - 1));
    const url = posts[selIdx] && posts[selIdx].u;
    if (typeof url === "string" && url) {
      if (typeof window.__RM_OPEN_POST === "function") window.__RM_OPEN_POST(url);
      else console.warn("[RM][screen] __RM_OPEN_POST 未定义，无法打开文章:", url);
    }
  });

  /* --- 首帧 --- */
  draw();

  /* ---------- 契约 API ---------- */
  const api = {
    setChannel(i) {
      i = Math.round(+i);
      if (!isFinite(i)) return channel;
      i = Math.max(0, Math.min(CHANNEL_COUNT - 1, i));
      if (i !== channel) {
        channel = i;
        selIdx = 0;
        switchAt = performance.now();
        draw();
        for (const fn of channelCbs) { try { fn(channel); } catch (e) { console.error(e); } }
      }
      return channel;
    },
    nextChannel() {
      return api.setChannel((channel + 1) % CHANNEL_COUNT);
    },
    getChannel() { return channel; },
    osd(text, ms = 1400) {
      osdMsg = String(text == null ? "" : text);
      osdUntil = performance.now() + (+ms || 1400);
      draw();
      /* 到期后主动清一次，避免依赖下一个 tick */
      setTimeout(() => { if (performance.now() >= osdUntil) draw(); }, (+ms || 1400) + 30);
    },
    onChannel(fn) {
      if (typeof fn === "function") channelCbs.push(fn);
    },

    /* --- 契约外附加（供 interact.js 驱动选择移动；不改变契约签名） --- */
    selectNext() {
      const posts = readRM().posts;
      if (!posts.length || channel !== 1) return selIdx;
      selIdx = (selIdx + 1) % posts.length;
      draw();
      return selIdx;
    },
    selectPrev() {
      const posts = readRM().posts;
      if (!posts.length || channel !== 1) return selIdx;
      selIdx = (selIdx - 1 + posts.length) % posts.length;
      draw();
      return selIdx;
    },
    openSelected() {
      const posts = readRM().posts;
      const url = posts[selIdx] && posts[selIdx].u;
      if (url && typeof window.__RM_OPEN_POST === "function") window.__RM_OPEN_POST(url);
    },
    setGain(v) { gain = Math.max(0, Math.min(2, +v || 1)); },
  };
  return api;
}
