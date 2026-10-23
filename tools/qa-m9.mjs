// tools/qa-m9.mjs — M9 对抗式 QA：只找问题，不修代码
// 覆盖必测清单 1-9；截图存 tools/blender/out/qa_*.png；摘要存 qa_summary.json
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tools', 'blender', 'out');
await mkdir(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.xml': 'application/xml', '.md': 'text/plain', '.ogg': 'audio/ogg' };
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
const R = { sections: [] };
function sec(name, ok, detail, evidence) {
  R.sections.push({ name, ok: !!ok, detail, evidence });
  console.log((ok ? 'PASS' : 'ISSUE'), '|', name, '|', JSON.stringify(detail));
}

function hook(page, bag) {
  bag.errors = [];
  page.on('pageerror', e => bag.errors.push('pageerror: ' + String(e)));
  page.on('console', m => { if (m.type() === 'error') bag.errors.push('console.error: ' + m.text()); });
}

async function ready(page, url) {
  await page.goto(base + url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__RM_SCENE, null, { timeout: 20000 });
}
async function enter(page) {
  await page.evaluate(() => { window.dispatchEvent(new CustomEvent('__RM_ENTER')); });
  await page.waitForTimeout(400);
}
/* 把目标名 → 屏幕像素（bbox 中心投影） */
async function targetPx(page, name) {
  return page.evaluate((name) => {
    const s = window.__RM_SCENE.scene, cam = window.__RM_SCENE.camera;
    let o = s.getObjectByName(name);
    if (!o) return { missing: name };
    let m = null; o.traverse ? o.traverse(c => { if (!m && c.isMesh) m = c; }) : null;
    if (!m && o.isMesh) m = o;
    if (!m) return { missing: name + ' (no mesh)' };
    m.geometry.computeBoundingBox();
    const c = m.geometry.boundingBox.getCenter(new m.position.constructor());
    m.updateWorldMatrix(true, false);
    c.applyMatrix4(m.matrixWorld);
    c.project(cam);
    return { x: (c.x * 0.5 + 0.5) * innerWidth, y: (-c.y * 0.5 + 0.5) * innerHeight, behind: c.z > 1 };
  }, name);
}

/* ============ 1. 控制台零 error + 全交互遍历 ============ */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const bag = {}; hook(page, bag);
  try {
    await ready(page, '?room=1');
    await enter(page);

    // 目标清单盘点
    const inv = await page.evaluate(() => {
      const names = [];
      window.__RM_SCENE.scene.traverse(o => { if (o.isMesh && /prop_|bulb/i.test(o.name || '')) names.push(o.name); });
      const has = n => !!window.__RM_SCENE.scene.getObjectByName(n);
      const awards = names.filter(n => /^prop_award_\d+_paper$/.test(n));
      return {
        total: names.length, awards: awards.length, awardNames: awards.slice(0, 12),
        knob_channel: has('prop_tv_knob_channel'), knob_volume: has('prop_tv_knob_volume'),
        cord: has('prop_lamp_cord'), bulb_wire: has('bulb_wire'), fan_button: has('prop_fan_button'),
        mosq: has('prop_mosq_ember'), notebook_cover: has('prop_notebook_cover'),
        calendar_page: has('prop_calendar_page'), calendar_rod: has('prop_calendar_rod'),
        radio: !!window.__RM_SCENE.scene.getObjectByName('prop_radio_body') || names.some(n => /^prop_radio_/.test(n)),
      };
    });
    R.inventory = inv;

    // 逐个点击可交互物
    const clickables = ['prop_tv_knob_channel', 'prop_tv_knob_volume', 'bulb_wire', 'prop_fan_button',
      'prop_mosq_ember', 'prop_notebook_cover', inv.awardNames[0], 'prop_calendar_page'];
    const clickLog = [];
    for (const name of clickables) {
      if (!name) continue;
      const px = await targetPx(page, name);
      if (px.missing) { clickLog.push({ name, missing: px.missing }); continue; }
      if (px.behind) { clickLog.push({ name, behind: true }); continue; }
      const before = await page.evaluate(() => JSON.parse(JSON.stringify(window.__RM_STATE)));
      await page.mouse.move(px.x, px.y); await page.waitForTimeout(60);
      const tip = await page.evaluate(() => { const t = document.querySelector('.rm-tooltip'); return t && t.style.display !== 'none' ? t.textContent : null; });
      await page.mouse.click(px.x, px.y); await page.waitForTimeout(350);
      const after = await page.evaluate(() => JSON.parse(JSON.stringify(window.__RM_STATE)));
      // 面板可能打开 → 关掉
      const panelOpen = await page.evaluate(() => !!(window.__RM_PANEL_API && window.__RM_PANEL_API.isOpen()));
      if (panelOpen) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
      clickLog.push({ name, x: Math.round(px.x), y: Math.round(px.y), tip, before, after, panelOpen });
    }
    R.clicks = clickLog;

    // 键盘全按一遍
    const keys = ['t', 'l', 'f', 'v', 'n', 'Escape'];
    const keyLog = [];
    for (const k of keys) {
      await page.keyboard.press(k === 'Escape' ? 'Escape' : k);
      await page.waitForTimeout(300);
      keyLog.push({ k, state: await page.evaluate(() => JSON.parse(JSON.stringify(window.__RM_STATE))) });
    }
    R.keys = keyLog;
    sec('1.console+interact', bag.errors.length === 0, { errors: bag.errors.slice(0, 8), nClicks: clickLog.length }, null);
  } catch (e) {
    sec('1.console+interact', false, { fatal: String(e), errors: bag.errors }, null);
  }
  await page.close();
}

/* ============ 2. 状态机压力：L×10 / T×20 / 快速连点 ============ */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const bag = {}; hook(page, bag);
  try {
    await ready(page, '?room=1'); await enter(page);
    const r = await page.evaluate(async () => {
      const LAMP = [1.0, 0.35, 0.0];
      const kd = k => dispatchEvent(new KeyboardEvent('keydown', { key: k }));
      for (let i = 0; i < 10; i++) { kd('l'); await new Promise(r2 => setTimeout(r2, 30)); }
      await new Promise(r2 => setTimeout(r2, 1500));  // 等缓动收敛
      const lampAfter10 = { lamp: window.__RM_STATE.lamp, value: window.__RM_BAKED.bakedState.lampState.value };
      for (let i = 0; i < 20; i++) { kd('t'); await new Promise(r2 => setTimeout(r2, 25)); }
      await new Promise(r2 => setTimeout(r2, 400));
      const chAfter20 = { state: window.__RM_STATE.channel, screen: window.__RM_SCREEN.getChannel() };
      return { lampAfter10, chAfter20, LAMP };
    });
    // 快速连点旋钮 30 次
    const px = await targetPx(page, 'prop_tv_knob_channel');
    for (let i = 0; i < 30; i++) { await page.mouse.click(px.x, px.y); await page.waitForTimeout(15); }
    await page.waitForTimeout(400);
    const final = await page.evaluate(() => ({
      lamp: window.__RM_STATE.lamp, lampValue: window.__RM_BAKED.bakedState.lampState.value,
      channel: window.__RM_STATE.channel, screenCh: window.__RM_SCREEN.getChannel(),
    }));
    const expectLamp = r.LAMP[r.lampAfter10.lamp];
    const lampOk = Math.abs(final.lampValue - expectLamp) < 0.01;
    const chOk = final.channel === final.screenCh && final.channel >= 0 && final.channel <= 3;
    sec('2.statemachine', bag.errors.length === 0 && lampOk && chOk,
      { afterL10: r.lampAfter10, expectLamp, afterT20: r.chAfter20, final, lampOk, chOk, errors: bag.errors.slice(0, 5) }, null);
  } catch (e) { sec('2.statemachine', false, { fatal: String(e), errors: bag.errors }, null); }
  await page.close();
}

/* ============ 3. hash 路由：进入 + 刷新恢复 ============ */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const bag = {}; hook(page, bag);
  const rows = [];
  try {
    for (const h of ['about', 'posts', 'archive', 'online']) {
      await ready(page, '?room=1#' + h); await enter(page);
      const afterLoad = await page.evaluate(() => ({
        url: location.pathname + location.search + location.hash,
        stateCh: window.__RM_STATE.channel, screenCh: window.__RM_SCREEN.getChannel(),
      }));
      // 点击 HUD 菜单
      await page.click('.hud.top .menu a[data-page="' + h + '"]');
      await page.waitForTimeout(300);
      const afterClick = await page.evaluate(() => ({
        url: location.pathname + location.search + location.hash,
        stateCh: window.__RM_STATE.channel, screenCh: window.__RM_SCREEN.getChannel(),
        ariaCurrent: (document.querySelector('.hud.top .menu a[aria-current="page"]') || {}).dataset ? document.querySelector('.hud.top .menu a[aria-current="page"]').dataset.page : null,
      }));
      await page.reload({ waitUntil: 'load' });
      const hasScene = await page.evaluate(() => !!window.__RM_SCENE);
      let afterReload = null;
      if (hasScene) {
        await enter(page);
        afterReload = await page.evaluate(() => ({
          url: location.pathname + location.search + location.hash,
          stateCh: window.__RM_STATE.channel, screenCh: window.__RM_SCREEN.getChannel(),
        }));
      } else {
        afterReload = await page.evaluate(() => ({ url: location.pathname + location.search + location.hash, plain: true }));
      }
      rows.push({ h, afterLoad, afterClick, afterReload });
    }
    R.hashRoutes = rows;
    const ok = bag.errors.length === 0 && rows.every(r2 =>
      r2.afterClick.stateCh === { about: 0, posts: 1, archive: 2, online: 3 }[r2.h] &&
      r2.afterClick.screenCh === r2.afterClick.stateCh);
    sec('3.hash-route', ok, { rows, errors: bag.errors.slice(0, 5) }, null);
  } catch (e) { sec('3.hash-route', false, { fatal: String(e), rows, errors: bag.errors }, null); }
  await page.close();
}

/* ============ 4. 面板：打开/ESC/连开5次/404 优雅降级 ============ */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const bag = {}; hook(page, bag);
  try {
    await ready(page, '?room=1'); await enter(page);
    const firstUrl = await page.evaluate(() => window.__RM.posts[0].u);
    // 作业本点击（已在 §1 测过点击路径，这里直接 API 打开内容物）
    await page.evaluate((u) => window.__RM_OPEN_POST(u), firstUrl);
    await page.waitForTimeout(900);
    const opened = await page.evaluate(() => ({
      open: window.__RM_PANEL_API.isOpen(),
      overlayVisible: getComputedStyle(document.querySelector('.rm-panel-overlay')).display !== 'none',
      h1: (document.querySelector('.rm-panel-body h1') || {}).textContent || null,
      bodyLen: (document.querySelector('.rm-panel-body') || {}).innerHTML.length,
      activeEl: document.activeElement && (document.activeElement.tagName + '.' + document.activeElement.className),
    }));
    await page.screenshot({ path: path.join(OUT, 'qa_4_panel.png') });
    // ESC 关
    await page.keyboard.press('Escape'); await page.waitForTimeout(350);
    const escClosed = await page.evaluate(() => !window.__RM_PANEL_API.isOpen());
    // 连开 5 次（开→关 循环）
    let cycles = 0;
    for (let i = 0; i < 5; i++) {
      await page.evaluate((u) => window.__RM_OPEN_POST(u), firstUrl);
      await page.waitForTimeout(250);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      cycles++;
    }
    const after5 = await page.evaluate(() => !window.__RM_PANEL_API.isOpen());
    // 404 文章
    await page.evaluate(() => { window.__RM.posts[0].u = '/nope/'; });
    await page.evaluate(() => window.__RM_OPEN_POST(window.__RM.posts[0].u));
    await page.waitForTimeout(900);
    const notFound = await page.evaluate(() => ({
      text: (document.querySelector('.rm-panel-body') || {}).textContent || '',
      errCls: !!(document.querySelector('.rm-panel-error')),
      canvasAlive: !!document.getElementById('gl'),
      overlayOpen: window.__RM_PANEL_API.isOpen(),
    }));
    await page.screenshot({ path: path.join(OUT, 'qa_5_404.png') });
    sec('4.panel', bag.errors.length === 0 && opened.open && opened.h1 && escClosed && after5 && /文章加载失败/.test(notFound.text) && notFound.canvasAlive,
      { opened, escClosed, cycles, after5, notFound, errors: bag.errors.slice(0, 5) }, 'tools/blender/out/qa_4_panel.png');
  } catch (e) { sec('4.panel', false, { fatal: String(e), errors: bag.errors }, null); }
  await page.close();
}

/* ============ 5. 小窗口 375×667 ============ */
{
  // a) 桌面 UA 小窗：3D 仍加载（无 coarse），HUD 可用性
  const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
  const bag = {}; hook(page, bag);
  try {
    await ready(page, '?room=1'); await enter(page);
    const hud = await page.evaluate(() => {
      const vis = sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { w: Math.round(r.width), h: Math.round(r.height), display: cs.display, inViewport: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth }; };
      return {
        name: vis('.hud.top .name'), menu: vis('.hud.top .menu'), ctl: vis('.hud.ctl'),
        sound: vis('#sound'), reading: vis('#reading'), hint: vis('#hint'),
        readingHref: (document.getElementById('reading') || {}).getAttribute ? document.getElementById('reading').getAttribute('href') : null,
        menuOverflowX: document.querySelector('.hud.top').scrollWidth > innerWidth,
      };
    });
    R.mobileDesktopUA = hud;
    await page.screenshot({ path: path.join(OUT, 'qa_6_mobile3d.png') });
    sec('5.mobile-desktopUA', bag.errors.length === 0 && hud.sound && hud.sound.inViewport && hud.reading && hud.reading.inViewport,
      { hud, errors: bag.errors.slice(0, 5) }, 'tools/blender/out/qa_6_mobile3d.png');
  } catch (e) { sec('5.mobile-desktopUA', false, { fatal: String(e), errors: bag.errors }, null); }
  await page.close();

  // b) 触屏 UA：应自动静态版
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const mpage = await ctx.newPage();
  const bag2 = {}; hook(mpage, bag2);
  try {
    await mpage.goto(base + '?room=1', { waitUntil: 'load' });
    await mpage.waitForTimeout(1500);
    const st = await mpage.evaluate(() => ({
      plainVisible: getComputedStyle(document.querySelector('.rm-fallback')).display !== 'none',
      canvas: !!document.getElementById('gl'), rmScene: !!window.__RM_SCENE,
      roomLink: (() => { const a = document.querySelector('a.ph-room[data-room]'); return a ? { hidden: a.hidden, href: a.getAttribute('href') } : null; })(),
      warn: (() => { const w = document.getElementById('rm-warn'); return w ? { hidden: w.hidden } : null; })(),
      tryLink: (() => { const t = document.getElementById('rm-try'); return t ? { hidden: t.hidden } : null; })(),
      scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
    }));
    R.mobileTouchUA = st;
    await mpage.screenshot({ path: path.join(OUT, 'qa_7_mobileplain.png') });
    sec('5.mobile-touchUA', bag2.errors.length === 0 && st.plainVisible && !st.rmScene,
      { st, errors: bag2.errors.slice(0, 5) }, 'tools/blender/out/qa_7_mobileplain.png');
  } catch (e) { sec('5.mobile-touchUA', false, { fatal: String(e), errors: bag2.errors }, null); }
  await ctx.close();
}

/* ============ 6. 空数据降级 ============ */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const bag = {}; hook(page, bag);
  try {
    await ready(page, '?room=1'); await enter(page);
    await page.evaluate(() => { window.__RM.posts = []; window.__RM.about = []; });
    await page.waitForTimeout(1200);
    const st = await page.evaluate(() => ({
      channel: window.__RM_STATE.channel,
      screenCh: window.__RM_SCREEN.getChannel(),
      osd: (document.querySelector('.rm-osd') || {}).textContent || '',
    }));
    await page.screenshot({ path: path.join(OUT, 'qa_8_standby.png') });
    // 作业本点击 → fallback posts/index.html（不存在 → 应优雅报错）
    await page.evaluate(() => window.__RM_OPEN_POST('posts/index.html'));
    await page.waitForTimeout(800);
    const empty = await page.evaluate(() => ({
      text: (document.querySelector('.rm-panel-body') || {}).textContent || '',
      err: !!document.querySelector('.rm-panel-error'), canvas: !!document.getElementById('gl'),
    }));
    sec('6.empty-data', bag.errors.length === 0 && empty.err && empty.canvas,
      { st, empty, errors: bag.errors.slice(0, 5) }, 'tools/blender/out/qa_8_standby.png');
  } catch (e) { sec('6.empty-data', false, { fatal: String(e), errors: bag.errors }, null); }
  await page.close();
}

/* ============ 7. a11y 抽查 ============ */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const bag = {}; hook(page, bag);
  try {
    await ready(page, '?room=1'); await enter(page);
    const firstUrl = await page.evaluate(() => window.__RM.posts[0].u);
    await page.evaluate((u) => window.__RM_OPEN_POST(u), firstUrl);
    await page.waitForTimeout(900);
    const a11y = await page.evaluate(() => {
      const names = sel => [].map.call(document.querySelectorAll(sel), e => ({
        txt: (e.textContent || '').trim().slice(0, 20), aria: e.getAttribute('aria-label'),
        role: e.getAttribute('role'), pressed: e.getAttribute('aria-pressed'),
      }));
      const cv = document.getElementById('gl');
      const ov = document.querySelector('.rm-panel-overlay');
      const card = document.querySelector('.rm-panel-card');
      return {
        focusInDialog: ov.contains(document.activeElement),
        focusEl: document.activeElement ? document.activeElement.tagName + ' .' + (document.activeElement.className || '') : null,
        dialogRole: ov.getAttribute('role'), ariaModal: ov.getAttribute('aria-modal'),
        closeBtn: (() => { const b = ov.querySelector('.rm-panel-close'); return b ? { aria: b.getAttribute('aria-label'), txt: b.textContent } : null; })(),
        // 焦点可到达性：Tab 从 body 出发的前 6 个焦点 stops
        tabStops: (() => {
          const seq = []; let guard = 0;
          const key = new KeyboardEvent('keydown', { key: 'Tab' });
          while (guard++ < 6) { dispatchEvent(key); const el = document.activeElement; if (!el || el === document.body) break; seq.push(el.tagName + ' .' + (el.className || '')); if (ov.contains(el)) break; }
          return seq;
        })(),
        canvas: { aria: cv.getAttribute('aria-label'), role: cv.getAttribute('role') },
        hudTop: names('.hud.top button, .hud.top a'),
        hudCtl: names('.hud.ctl button, .hud.ctl a'),
        enterBtn: (() => { const b = document.getElementById('enter'); return b ? { aria: b.getAttribute('aria-label'), hidden: b.hidden } : null; })(),
      };
    });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    sec('7.a11y', bag.errors.length === 0,
      { focusInDialog: a11y.focusInDialog, focusEl: a11y.focusEl, dialogRole: a11y.dialogRole, ariaModal: a11y.ariaModal, closeBtn: a11y.closeBtn, canvas: a11y.canvas, hudTop: a11y.hudTop, hudCtl: a11y.hudCtl, tabStops: a11y.tabStops, errors: bag.errors.slice(0, 5) }, null);
  } catch (e) { sec('7.a11y', false, { fatal: String(e), errors: bag.errors }, null); }
  await page.close();
}

/* ============ 8. 性能 ============ */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const bag = {}; hook(page, bag);
  try {
    await ready(page, '?room=1'); await enter(page);
    await page.waitForTimeout(10000); // 静置 10s
    const perf = await page.evaluate(async () => {
      const info = window.__RM_SCENE.renderer.info;
      const calls = info.render.calls, tris = info.render.triangles, tex = info.memory.textures, geo = info.memory.geometries;
      const f0 = await new Promise(res => { let n = 0; const t0 = performance.now(); const loop = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(loop); else res(n); }; requestAnimationFrame(loop); });
      return { calls, tris, textures: tex, geometries: geo, fps: Math.round(f0 / 2) };
    });
    R.perf = perf;
    sec('8.perf', bag.errors.length === 0, { perf, errors: bag.errors.slice(0, 5) }, null);
  } catch (e) { sec('8.perf', false, { fatal: String(e), errors: bag.errors }, null); }
  await page.close();
}

/* ============ 9. 视觉抽查 4 张 ============ */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const bag = {}; hook(page, bag);
  try {
    await ready(page, '?room=1'); await enter(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, 'qa_1_night.png') });           // 夜灯（默认）
    // 黄昏：L×2（夜→深夜→黄昏）
    await page.keyboard.press('l'); await page.waitForTimeout(200);
    await page.keyboard.press('l'); await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'qa_2_dusk.png') });
    // 深夜 + TV 光：L 一下（黄昏→夜）再 L 一下（夜→深夜）；切频道触发 TV 换台闪光后回落
    await page.keyboard.press('l'); await page.waitForTimeout(200);
    await page.keyboard.press('l'); await page.waitForTimeout(2500);
    await page.keyboard.press('t'); await page.waitForTimeout(500);
    const lampNow = await page.evaluate(() => window.__RM_BAKED.bakedState.lampState.value);
    await page.screenshot({ path: path.join(OUT, 'qa_3_deepnight_tv.png') });
    sec('9.visual', bag.errors.length === 0, { lampNow, shots: ['qa_1_night.png', 'qa_2_dusk.png', 'qa_3_deepnight_tv.png', 'qa_4_panel.png'], errors: bag.errors.slice(0, 5) },
      'tools/blender/out/qa_1_night.png..qa_3_deepnight_tv.png');
  } catch (e) { sec('9.visual', false, { fatal: String(e), errors: bag.errors }, null); }
  await page.close();
}

await browser.close();
server.close();
await writeFile(path.join(OUT, 'qa_summary.json'), JSON.stringify(R, null, 2));
console.log('DONE', path.join(OUT, 'qa_summary.json'));
