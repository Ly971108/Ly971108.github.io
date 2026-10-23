// tools/qa-m9b.mjs — 第二轮：隔离 overlay bug 后验证交互链 + 路由恢复 + 契约细节
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', 'blender', 'out');
await mkdir(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.xml': 'application/xml', '.ogg': 'audio/ogg' };
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
const R = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function hook(page, bag) {
  bag.errors = [];
  page.on('pageerror', e => bag.errors.push('pageerror: ' + String(e)));
  page.on('console', m => { if (m.type() === 'error') bag.errors.push('console.error: ' + m.text()); });
}
async function ready(page, url) {
  await page.goto(base + url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__RM_SCENE, null, { timeout: 20000 });
}
async function enter(page) { await page.evaluate(() => window.dispatchEvent(new CustomEvent('__RM_ENTER'))); await page.waitForTimeout(400); }
async function targetPx(page, name) {
  return page.evaluate((name) => {
    const s = window.__RM_SCENE.scene, cam = window.__RM_SCENE.camera;
    let o = s.getObjectByName(name);
    if (!o) return { missing: name };
    let m = null; o.traverse(c => { if (!m && c.isMesh) m = c; });
    if (!m && o.isMesh) m = o;
    if (!m) return { missing: name + ' (no mesh)' };
    m.geometry.computeBoundingBox();
    const c = m.geometry.boundingBox.getCenter(new m.position.constructor());
    m.updateWorldMatrix(true, false); c.applyMatrix4(m.matrixWorld); c.project(cam);
    return { x: (c.x * 0.5 + 0.5) * innerWidth, y: (-c.y * 0.5 + 0.5) * innerHeight, behind: c.z > 1 };
  }, name);
}

/* A. overlay display 实锤 + 隐藏后点击链验证 */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const bag = {}; hook(page, bag);
  await ready(page, '?room=1'); await enter(page);

  // 实锤：hidden 属性的 overlay 实际 display
  R.overlayComputed = await page.evaluate(() => {
    const ov = document.querySelector('.rm-panel-overlay');
    const cs = getComputedStyle(ov);
    const rect = ov.getBoundingClientRect();
    return { hiddenAttr: ov.hidden, display: cs.display, opacity: cs.opacity, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
  });

  // 测试态：移除遮罩（不改代码，仅本测试会话内 style 覆盖）
  await page.evaluate(() => { document.querySelector('.rm-panel-overlay').style.display = 'none'; });

  const clickables = ['prop_tv_knob_channel', 'prop_tv_knob_volume', 'bulb_wire', 'prop_fan_button',
    'prop_mosq_ember', 'prop_award_01_paper', 'prop_calendar_page', 'prop_radio_body'];
  const log = [];
  for (const name of clickables) {
    const px = await targetPx(page, name);
    if (px.missing) { log.push({ name, missing: px.missing }); continue; }
    const before = await page.evaluate(() => JSON.parse(JSON.stringify(window.__RM_STATE)));
    await page.mouse.move(px.x, px.y); await sleep(80);
    const tip = await page.evaluate(() => { const t = document.querySelector('.rm-tooltip'); return t && t.style.display !== 'none' ? t.textContent : null; });
    await page.mouse.click(px.x, px.y); await sleep(350);
    const after = await page.evaluate(() => JSON.parse(JSON.stringify(window.__RM_STATE)));
    const url = await page.evaluate(() => location.pathname + location.search + location.hash);
    let panelOpen = await page.evaluate(() => !!(window.__RM_PANEL_API && window.__RM_PANEL_API.isOpen()));
    if (panelOpen) { await page.keyboard.press('Escape'); await sleep(250); }
    log.push({ name, tip, before, after, url, panelOpen });
  }
  R.clicksNoOverlay = log;

  // 音量键 V 是否接到屏幕增益（契约：M6 先调 screen 亮度增益）
  const gainTest = await page.evaluate(async () => {
    const mesh = window.__RM_SCENE.scene.getObjectByName('prop_tv_screen');
    const u = mesh.material.uniforms.uBright;
    const before = u.value;
    for (let i = 0; i < 3; i++) { dispatchEvent(new KeyboardEvent('keydown', { key: 'v' })); await new Promise(r => setTimeout(r, 60)); }
    await new Promise(r => setTimeout(r, 800));
    return { before, after: u.value, volume: window.__RM_STATE.volume };
  });
  R.gainTest = gainTest;

  // ArrowDown 绑定（屏幕提示写 N/↓ 下选）
  R.arrowDown = await page.evaluate(async () => {
    dispatchEvent(new KeyboardEvent('keydown', { key: 't' })); // 到频道1
    await new Promise(r => setTimeout(r, 100));
    dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    await new Promise(r => setTimeout(r, 200));
    return { channel: window.__RM_STATE.channel };
  });

  // #reading 路由（契约：panel 打开最近文章）
  R.readingRoute = await page.evaluate(async () => {
    location.hash = '#reading';
    dispatchEvent(new HashChangeEvent('hashchange'));
    await new Promise(r => setTimeout(r, 400));
    return { panelOpen: window.__RM_PANEL_API.isOpen(), hash: location.hash };
  });

  R.errorsA = bag.errors;
  await page.close();
}

/* B. hash 进入 + reload 恢复（不经菜单点击） */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const bag = {}; hook(page, bag);
  R.hashRestore = [];
  for (const h of ['about', 'posts', 'archive', 'online']) {
    await ready(page, '?room=1#' + h); await enter(page);
    const onLoad = await page.evaluate(() => ({ ch: window.__RM_STATE.channel, screen: window.__RM_SCREEN.getChannel(), url: location.pathname + location.search + location.hash }));
    // 模拟用户改 hash（赋值 location.hash，不经过 pushState 包装）
    await page.evaluate((h2) => { location.hash = h2; }, '#' + h);
    await page.waitForTimeout(300);
    const afterHashSet = await page.evaluate(() => ({ ch: window.__RM_STATE.channel, screen: window.__RM_SCREEN.getChannel() }));
    await page.reload({ waitUntil: 'load' });
    const hasScene = await page.evaluate(() => !!window.__RM_SCENE);
    let afterReload;
    if (hasScene) { await enter(page); afterReload = await page.evaluate(() => ({ ch: window.__RM_STATE.channel, screen: window.__RM_SCREEN.getChannel(), url: location.pathname + location.search + location.hash })); }
    else afterReload = await page.evaluate(() => ({ plain: true, url: location.pathname + location.search + location.hash }));
    R.hashRestore.push({ h, onLoad, afterHashSet, afterReload });
  }
  R.errorsB = bag.errors;
  await page.close();
}

/* C. 奖状点击 URL 形态（setHash → pushState 包装器） */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const bag = {}; hook(page, bag);
  await ready(page, '?room=1'); await enter(page);
  await page.evaluate(() => { document.querySelector('.rm-panel-overlay').style.display = 'none'; });
  const px = await targetPx(page, 'prop_award_01_paper');
  await page.mouse.click(px.x, px.y); await sleep(400);
  R.awardUrl = await page.evaluate(() => ({ url: location.pathname + location.search + location.hash, ch: window.__RM_STATE.channel, ariaCurrent: (document.querySelector('.hud.top .menu a[aria-current="page"]') || {}).textContent || null }));
  // ESC 行为
  await page.keyboard.press('Escape'); await sleep(300);
  R.afterEsc = await page.evaluate(() => ({ url: location.pathname + location.search + location.hash, ch: window.__RM_STATE.channel }));
  R.errorsC = bag.errors;
  await page.close();
}

/* D. 面板开时按 T/L 是否泄漏到场景（契约：面板打开时 ESC 优先） */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const bag = {}; hook(page, bag);
  await ready(page, '?room=1'); await enter(page);
  await page.evaluate(() => window.__RM_OPEN_POST(window.__RM.posts[0].u));
  await page.waitForTimeout(800);
  const st0 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__RM_STATE)));
  await page.keyboard.press('t'); await sleep(200);
  await page.keyboard.press('l'); await sleep(200);
  const st1 = await page.evaluate(() => JSON.parse(JSON.stringify(window.__RM_STATE)));
  R.panelKeyLeak = { st0, st1, unchanged: JSON.stringify(st0) === JSON.stringify(st1) };
  R.errorsD = bag.errors;
  await page.close();
}

await browser.close(); server.close();
await writeFile(path.join(OUT, 'qa_b.json'), JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 1));
