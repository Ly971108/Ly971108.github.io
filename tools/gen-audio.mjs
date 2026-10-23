// tools/gen-audio.mjs — M8 环境音资产生成
// 纯 Node 合成 80s 无缝循环夏夜环境音（蟋蟀主导 + 远蛙 + 微风 + 极远犬吠偶发），
// PCM 直接写临时 WAV，再调用系统 ffmpeg 转 ogg。契约见 docs/m8-contracts.md。
// 用法: node tools/gen-audio.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, statSync, unlinkSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SR = 44100;                 // 采样率（单声道足够，环境音不做立体声）
const DUR = 80;                   // 循环长度（秒），落在契约 75-90s 区间
const N = SR * DUR;
const OUT_DIR = join(ROOT, "assets", "scene", "v0001", "audio");
const OUT_OGG = join(OUT_DIR, "ambient.ogg");
const TMP_WAV = join(OUT_DIR, ".ambient.tmp.wav");
const MAX_BYTES = 1.5 * 1024 * 1024;

/* 确定性 PRNG（mulberry32）：同种子输出完全一致，资产生成可复现 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261022);
const rand = (a, b) => a + rnd() * (b - a);

function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / x.length);
}
function scaleToRms(x, target) {
  const g = target / (rms(x) || 1);
  for (let i = 0; i < x.length; i++) x[i] *= g;
}

/* 环形单极点低通：让滤波器状态在循环点严格衔接（首尾无跳变、无爆音）。
 * 先按零初始状态正向滤波得 y0；真实循环解 y[i] = y0[i] + a^(i+1)·S，
 * 由循环条件 y[N-1] = S 解出 S = y0[N-1] / (1 - a^N)，叠加修正项即可。 */
function lowpassCircular(x, cutoff) {
  const a = Math.exp(-2 * Math.PI * cutoff / SR);
  const n = x.length;
  const y = new Float32Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) { s = a * s + (1 - a) * x[i]; y[i] = s; }
  const S = y[n - 1] / (1 - Math.pow(a, n));
  let c = a * S;
  for (let i = 0; i < n; i++) { y[i] += c; c *= a; }
  return y;
}

/* 微风：白噪声过环形低通（420Hz 主风 + 140Hz 底闷层），
 * 包络用循环基频整数倍（k/DUR Hz）的慢 LFO，保证首尾连续。 */
function buildWind() {
  const noise = new Float32Array(N);
  for (let i = 0; i < N; i++) noise[i] = rnd() * 2 - 1;
  const low = lowpassCircular(noise, 420);
  const rumble = lowpassCircular(noise, 140);
  const K1 = 3, K2 = 7;           // 整数个循环 → 包络天然无缝
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const env = Math.max(0.12, 0.62 + 0.5 * Math.sin(2 * Math.PI * K1 * t)
      + 0.3 * Math.sin(2 * Math.PI * K2 * t + 1.7));
    out[i] = (low[i] * 0.9 + rumble[i] * 1.2) * env;
  }
  scaleToRms(out, 0.045);         // 垫底音量，别抢蟋蟀
  return out;
}

/* 蟋蟀（主导声部）：三只"个体"，各自音高/脉冲率/鸣唱周期错开。
 * 每声 = 一串 ~16ms 的正弦短脉冲（4-5kHz），鸣唱内脉冲包钟形，声间随机抖动。 */
function addCrickets(mix) {
  const voices = [
    { fc: 4300, pulse: 38, chirp: 0.70, period: 2.1, amp: 0.16 },
    { fc: 4650, pulse: 33, chirp: 0.50, period: 2.9, amp: 0.13 },
    { fc: 4150, pulse: 42, chirp: 0.90, period: 3.7, amp: 0.12 },
  ];
  const PW = Math.floor(SR * 0.016);
  for (const v of voices) {
    let t = rand(0.5, 1.5);
    while (t < DUR - 1.5) {
      const fc = v.fc + rand(-120, 120);
      const chirpLen = v.chirp * rand(0.85, 1.15);
      const pulses = Math.max(2, Math.floor(chirpLen * v.pulse));
      const ip0 = Math.floor(t * SR);
      for (let p = 0; p < pulses; p++) {
        const ip = ip0 + Math.floor(p * SR / v.pulse);
        const cenv = Math.sin(Math.PI * p / (pulses - 1));   // 鸣唱整体钟形
        for (let j = 0; j < PW; j++) {
          const idx = ip + j;
          if (idx >= N) break;
          const env = Math.sin(Math.PI * j / PW);            // 单脉冲内包络
          mix[idx] += v.amp * cenv * env * Math.sin(2 * Math.PI * fc * (j / SR));
        }
      }
      t += v.period * rand(0.8, 1.25);
    }
  }
}

/* 远蛙：200-400Hz 下滑音咕噜，含少量二次谐波与 27Hz 振幅抖动，4-8s 随机间隔。 */
function addFrogs(mix) {
  let t = rand(2, 5);
  while (t < DUR - 2) {
    const croaks = rnd() < 0.4 ? 2 + Math.floor(rnd() * 2) : 1;
    for (let c = 0; c < croaks; c++) {
      const ip = Math.floor((t + c * 0.28) * SR);
      const len = Math.floor(0.16 * SR);
      const f0 = rand(300, 360), f1 = rand(220, 260);
      for (let j = 0; j < len; j++) {
        const idx = ip + j;
        if (idx >= N) break;
        const tt = j / SR, u = j / len;
        const ph = 2 * Math.PI * (f0 * tt + 0.5 * (f1 - f0) * tt * tt);
        const am = 0.65 + 0.35 * Math.sin(2 * Math.PI * 27 * tt);
        const env = Math.sin(Math.PI * u);
        mix[idx] += 0.05 * env * am * (Math.sin(ph) + 0.35 * Math.sin(2 * ph));
      }
    }
    t += rand(4, 8.5);
  }
}

/* 极远犬吠：0.8s 衰减锯齿哼声，低频摆动 + 800Hz 低通模拟距离感。全曲 1-2 次。 */
function addDog(mix, t0) {
  const ip = Math.floor(t0 * SR);
  const len = Math.floor(0.8 * SR);
  const a = Math.exp(-2 * Math.PI * 800 / SR);
  let s = 0, ph = 0;
  for (let j = 0; j < len; j++) {
    const idx = ip + j;
    if (idx >= N) break;
    const tt = j / SR;
    const f = 300 - 70 * (tt / 0.8) + 25 * Math.sin(2 * Math.PI * 11 * tt);
    ph += 2 * Math.PI * f / SR;
    const saw = 2 * ((ph / (2 * Math.PI)) % 1) - 1;
    s = a * s + (1 - a) * saw;
    const env = Math.min(1, tt / 0.008) * Math.exp(-tt / 0.28);
    mix[idx] += 0.09 * env * s;
  }
}

/* 16-bit 单声道 WAV */
function writeWav(path, f32) {
  const data = Buffer.alloc(f32.length * 2);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.max(-1, Math.min(1, f32[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const hdr = Buffer.alloc(44);
  hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write("WAVE", 8);
  hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write("data", 36); hdr.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([hdr, data]));
}

/* ---------- 合成主流程 ---------- */
console.log(`[gen-audio] 合成 ${DUR}s @ ${SR}Hz 单声道，${N} 采样…`);
const mix = new Float32Array(N);

const wind = buildWind();
for (let i = 0; i < N; i++) mix[i] += wind[i];
addCrickets(mix);
addFrogs(mix);
addDog(mix, 41.3);
addDog(mix, 67.8);

/* 循环点连续性自检：首尾样本跳变应与自然相邻样本同量级 */
let peak = 0, maxAdj = 0;
for (let i = 0; i < N; i++) { const v = Math.abs(mix[i]); if (v > peak) peak = v; }
for (let i = 1; i < N; i++) { const d = Math.abs(mix[i] - mix[i - 1]); if (d > maxAdj) maxAdj = d; }
const seam = Math.abs(mix[N - 1] - mix[0]);
console.log(`[gen-audio] 峰值=${peak.toFixed(4)} 相邻最大跳变=${maxAdj.toFixed(5)} 循环点跳变=${seam.toFixed(5)}`);

/* 峰值归一到 -6dBFS（×0.501187） */
const g = 0.5011872336 / peak;
for (let i = 0; i < N; i++) mix[i] *= g;
let afterPeak = 0;
for (let i = 0; i < N; i++) { const v = Math.abs(mix[i]); if (v > afterPeak) afterPeak = v; }
console.log(`[gen-audio] 归一后峰值=${afterPeak.toFixed(4)}（目标 0.5012）`);

mkdirSync(OUT_DIR, { recursive: true });
writeWav(TMP_WAV, mix);
console.log(`[gen-audio] 临时 WAV 已写：${TMP_WAV}`);

/* ffmpeg → ogg（libvorbis q≈4） */
const ff = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
  "-i", TMP_WAV, "-c:a", "libvorbis", "-q:a", "4", OUT_OGG], { stdio: "inherit" });
if (ff.status !== 0 || !existsSync(OUT_OGG)) {
  console.error("[gen-audio] ffmpeg 转码失败");
  process.exit(1);
}
unlinkSync(TMP_WAV);

const size = statSync(OUT_OGG).size;
const pr = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration",
  "-of", "csv=p=0", OUT_OGG], { encoding: "utf8" });
const durOgg = (pr.stdout || "").trim();
console.log(`[gen-audio] ${OUT_OGG}`);
console.log(`[gen-audio] 体积=${(size / 1024 / 1024).toFixed(3)} MB（上限 1.5 MB） 时长=${durOgg}s`);
if (size > MAX_BYTES) { console.error("[gen-audio] 超出体积上限"); process.exit(1); }
console.log("[gen-audio] 完成");
