// tools/test-web.mjs — M2 浏览器验收
// 用法: node tools/test-web.mjs [baseURL]
// 验证: ?room=1 强制 3D → GLB 加载 → __RM_READY → 截图; 静态版 ?plain=1 → 内容完整
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.xml': 'application/xml', '.md': 'text/plain' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('404'); }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu'] });
let fail = 0;

async function shot(name, url, checks) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + url, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.__RM_READY === undefined || true, { timeout: 1000 });
  } catch {}
  let result = {};
  try {
    result = await page.evaluate(async () => {
      const ready = await new Promise(res => {
        if (window.__RM_SCENE) return res(true);
        const t = setTimeout(() => res(false), 8000);
        addEventListener('__RM_READY', () => { clearTimeout(t); res(true); }, { once: true });
      });
      if (!ready) return { ready };
      // 模拟点击进入主循环
      window.dispatchEvent(new CustomEvent('__RM_ENTER'));
      await new Promise(r => setTimeout(r, 800));
      const info = window.__RM_SCENE.renderer.info.render;
      return { ready, calls: info.calls, tris: info.triangles, rm: !!window.__RM, posts: window.__RM.posts.length };
    });
  } catch (e) { result = { evalError: String(e) }; }
  await page.screenshot({ path: path.join(ROOT, 'tools', 'blender', 'out', name) });
  const ok = checks(result, errors);
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(result), errors.length ? 'errors:' + errors.slice(0, 3).join(' | ') : '');
  if (!ok) fail++;
  await page.close();
}

await shot('web_room.png', '?room=1', (r, e) => r.ready && r.calls > 0 && r.calls < 200 && r.tris < 200000 && e.length === 0);
// 注：draw calls 预算 ≤60 是 M7 目标；M4 道具未合并前 190（每 mesh 一 call），M5 烘焙按图集分组合并时收紧
await shot('web_plain.png', '?plain=1', (r, e) => {
  return true; // 静态版结构检查走 DOM（下一条）
});

// 静态版 DOM 检查
{
  const page = await browser.newPage();
  await page.goto(base + '?plain=1', { waitUntil: 'networkidle' });
  const dom = await page.evaluate(() => ({
    fallbackVisible: getComputedStyle(document.querySelector('.rm-fallback')).display !== 'none',
    posts: document.querySelectorAll('#rm-posts-static li a').length,
    h1: !!document.querySelector('.pb-h1'),
    title: document.title,
  }));
  const ok = dom.fallbackVisible && dom.posts >= 2 && dom.h1;
  console.log(ok ? 'PASS' : 'FAIL', 'web_plain_dom', JSON.stringify(dom));
  if (!ok) fail++;
  await page.close();
}

await browser.close();
server.close();
process.exit(fail ? 1 : 0);
