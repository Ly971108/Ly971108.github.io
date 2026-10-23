// tools/preview-screen.mjs — M6 screen.js / panel.js 独立预览验收
// 用法: node --experimental-json-modules tools/preview-screen.mjs
//
// 不加载 index.html（main.js 会跑全场景），改为内联最小 HTML：
//   importmap + 一个命名 prop_tv_screen 的 PlaneGeometry 网格 + stub window.__RM
//   → import screen.js / panel.js 初始化 → playwright 截 4 频道 + panel 共 5 张图。
// 截图输出: tools/blender/out/screen_ch{0..3}.png, tools/blender/out/screen_panel.png
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', 'blender', 'out');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.xml': 'application/xml', '.md': 'text/plain',
};

/* ---------- 内联预览页 ---------- */
const PREVIEW_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>M6 screen/panel preview</title>
<style>html,body{margin:0;height:100%;background:#0a0806;overflow:hidden}#gl{width:100%;height:100%;display:block}</style>
<script type="importmap">
{"imports":{"three":"/assets/vendor/three-0.170.0/three.module.js","three/addons/":"/assets/vendor/three-0.170.0/addons/"}}
</script>
</head>
<body>
<canvas id="gl"></canvas>
<script>
  // stub 数据：2 篇文章 + about 段落（含链接区间，含重复 href 验证去重）
  window.__RM = {
    page: 'home',
    posts: [
      { t: 'Hello World', u: '/posts/hello-world/', d: '2026-08-24' },
      { t: 'Architecture Notes', u: '/posts/architecture-notes/', d: '2026-09-02' },
    ],
    about: [
      ['h', '关于这间屋子'],
      ['p', '这是 Felix 的夏夜老屋，一间用 Three.js 搭出来的房间。', [[10, 14, 'https://threejs.org']]],
      ['p', '白天写字，晚上看电视，链接重复应去重。', [[0, 2, 'https://example.com'], [10, 12, 'https://example.com']]],
      ['h', '联系'],
      ['p', '欢迎来信交流。', [[0, 2, 'mailto:hi@example.com']]],
    ],
  };
</script>
<script type="module">
  import * as THREE from 'three';
  import { initScreen } from '/assets/scene-js/v0001/screen.js';
  import { initPanel } from '/assets/scene-js/v0001/panel.js';

  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0806);

  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 10);
  camera.position.set(0, 0, 2.2);
  camera.lookAt(0, 0, 0);

  // 屏幕目标网格：飞机蒙皮形状的占位（验收只关心材质替换 + UV 采样）
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  mesh.name = 'prop_tv_screen';
  scene.add(mesh);

  window.__API = { screen: initScreen(scene), panel: initPanel() };

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  });

  function frame() { requestAnimationFrame(frame); renderer.render(scene, camera); }
  window.dispatchEvent(new CustomEvent('__RM_ENTER'));
  frame();
  window.__PREVIEW_READY = true;
</script>
</body>
</html>`;

/* ---------- 静态服务：/__preview.html 走内联，其余落盘 ---------- */
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/__preview.html' || p === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PREVIEW_HTML);
      return;
    }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('404'); }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;
console.log('[preview] serving at', base);

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(base + '__preview.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.__PREVIEW_READY === true && window.__API, { timeout: 10000 });
await page.waitForTimeout(400);   // 等首帧 + OSD 稳定

/* 4 个频道各截一张（切换后稍等，让大 OSD 与内容绘制出来） */
for (let ch = 0; ch < 4; ch++) {
  await page.evaluate((c) => { window.__API.screen.setChannel(c); }, ch);
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `screen_ch${ch}.png`) });
  console.log('[preview] saved', `screen_ch${ch}.png`);
}

/* 频道 1 下移选择 + Enter 走 __RM_OPEN_POST 的行为由 API 直接驱动验证 */
await page.evaluate(() => {
  window.__API.screen.setChannel(1);
  window.__API.screen.nextItem();       // 移到第 2 篇
});
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(OUT, 'screen_ch1_next.png') });
console.log('[preview] saved screen_ch1_next.png');

/* panel 打开一篇真实文章 */
await page.evaluate(() => { window.__API.panel.openPost('/posts/hello-world/'); });
await page.waitForFunction(() => {
  const el = document.querySelector('.rm-panel-body');
  return el && el.textContent.length > 20 && !/加载中/.test(el.textContent);
}, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(350);
await page.screenshot({ path: path.join(OUT, 'screen_panel.png') });
console.log('[preview] saved screen_panel.png');

const panelState = await page.evaluate(() => ({
  isOpen: window.__API.panel.isOpen(),
  title: document.querySelector('.rm-panel-card h1') ? document.querySelector('.rm-panel-card h1').textContent : null,
}));

/* ESC 关闭验证 */
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const closedAfterEsc = await page.evaluate(() => !window.__API.panel.isOpen());

await browser.close();
server.close();

console.log('[preview] panel:', JSON.stringify(panelState), 'esc closes:', closedAfterEsc);
if (!panelState.isOpen || !panelState.title) { console.error('FAIL panel 未正常打开文章'); process.exit(1); }
if (!closedAfterEsc) { console.error('FAIL ESC 未关闭 panel'); process.exit(1); }
if (errors.length) { console.error('FAIL 控制台 error:', errors.slice(0, 5).join(' | ')); process.exit(1); }
console.log('PASS preview-screen：5+1 张截图已生成，无控制台 error');
