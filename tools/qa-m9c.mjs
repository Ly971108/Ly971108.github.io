// tools/qa-m9c.mjs — 第三轮：reload 后 hash 恢复（正确等待）+ 404 来源 + 初始 hash 时 HUD 状态
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', 'blender', 'out');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ogg': 'audio/ogg' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const data = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('404'); }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu'] });
const R = { bad: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('response', r => { if (r.status() >= 400) R.bad.push(r.status() + ' ' + r.url()); });

async function ready(url) {
  await page.goto(base + url, { waitUntil: 'load' });
  try { await page.waitForFunction(() => !!window.__RM_SCENE, null, { timeout: 20000 }); return true; }
  catch { return false; }
}
async function enter() { await page.evaluate(() => window.dispatchEvent(new CustomEvent('__RM_ENTER'))); await sleep(400); }

R.hashRestore = [];
for (const h of ['about', 'posts', 'archive', 'online']) {
  const scene = await ready('?room=1#' + h);
  await enter();
  const onLoad = await page.evaluate(() => ({
    ch: window.__RM_STATE.channel, screen: window.__RM_SCREEN.getChannel(),
    ariaCurrent: (document.querySelector('.hud.top .menu a[aria-current="page"]') || {}).dataset ? document.querySelector('.hud.top .menu a[aria-current="page"]').dataset.page : null,
    title: document.title,
  }));
  // 换到不同 hash 验证 onRoute 链路本身是好的
  const other = h === 'about' ? '#online' : '#about';
  await page.evaluate((o) => { location.hash = o; }, other);
  await sleep(300);
  const afterChange = await page.evaluate(() => ({ ch: window.__RM_STATE.channel, screen: window.__RM_SCREEN.getChannel() }));
  // 刷新（带当前 hash）→ 等场景就绪 → 读状态
  await page.reload({ waitUntil: 'load' });
  const scene2 = await (async () => { try { await page.waitForFunction(() => !!window.__RM_SCENE, null, { timeout: 20000 }); return true; } catch { return false; } })();
  let afterReload;
  if (scene2) { await enter(); afterReload = await page.evaluate(() => ({ ch: window.__RM_STATE.channel, screen: window.__RM_SCREEN.getChannel(), ariaCurrent: (document.querySelector('.hud.top .menu a[aria-current="page"]') || {}).dataset ? document.querySelector('.hud.top .menu a[aria-current="page"]').dataset.page : null })); }
  else afterReload = { plain: true, url: page.url() };
  R.hashRestore.push({ h, onLoad, afterChangeTo: { hash: other, ...afterChange }, afterReload });
}

// ESC 回房间：从 #posts 按 ESC
await ready('?room=1'); await enter();
await page.evaluate(() => { location.hash = '#posts'; });
await sleep(300);
await page.keyboard.press('Escape'); await sleep(300);
R.escHome = await page.evaluate(() => ({ url: location.pathname + location.search + location.hash, ch: window.__RM_STATE.channel }));

await browser.close(); server.close();
await writeFile(path.join(OUT, 'qa_c.json'), JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 1));
