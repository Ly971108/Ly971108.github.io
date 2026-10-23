/* 夏夜老屋 M6 — panel.js（DOM 阅读层）
 * 契约：docs/m6-contracts.md §panel.js
 *
 * 职责：
 *   - initPanel() → { openPost(url), close(), isOpen() }
 *   - 全屏半透明墨黑 overlay + 纸色文章卡片；fetch(url) 提取 <main> 注入。
 *   - 打开 / 关闭各自派发 __RM_PANEL（detail.open=true/false），供 main.js 暂停轨道相机。
 *   - ESC / 点击遮罩关闭；fetch 失败显示「文章加载失败」（无头测试友好）。
 *   - 样式在本文件内动态注入 <style>（不动 desktop.css，避免与他人冲突）。
 */

/* 样式作用域：全部挂在 .rm-panel 前缀下，不污染全局 */
const CSS = /* css */ `
.rm-panel-overlay {
  position: fixed; inset: 0; z-index: 90;
  background: rgba(6, 7, 11, 0.86);
  backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.18s ease;
  font-family: "PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;
}
.rm-panel-overlay.rm-panel-open { opacity: 1; }
/* hidden 属性必须压过 display:flex, 否则初始全屏透明遮罩吞掉全部指针事件 */
.rm-panel-overlay[hidden] { display: none !important; }

.rm-panel-card {
  position: relative;
  width: min(760px, 92vw); max-height: 84vh;
  overflow-y: auto; overflow-x: hidden;
  background: #f4ecd7;               /* 纸色卡片，贴合暖黄夜灯氛围 */
  color: #2b2118;
  border-radius: 6px;
  padding: 40px 48px 48px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(43, 33, 24, 0.12);
  line-height: 1.75; font-size: 16px;
  transform: translateY(6px); transition: transform 0.18s ease;
}
.rm-panel-overlay.rm-panel-open .rm-panel-card { transform: translateY(0); }

.rm-panel-card h1, .rm-panel-card h2, .rm-panel-card h3 { line-height: 1.35; margin: 1.2em 0 0.5em; }
.rm-panel-card h1 { font-size: 26px; }
.rm-panel-card h2 { font-size: 21px; }
.rm-panel-card h3 { font-size: 18px; }
.rm-panel-card p { margin: 0.7em 0; }
.rm-panel-card a { color: #8a4b16; text-decoration: underline; text-underline-offset: 3px; }
.rm-panel-card a:hover { color: #b06a1f; }
.rm-panel-card pre {
  background: #2b2118; color: #e9dfc8; padding: 14px 16px; border-radius: 4px;
  overflow-x: auto; font-size: 13px; line-height: 1.6;
}
.rm-panel-card code { font-family: "SF Mono","Cascadia Code",Consolas,"Courier New",monospace; }
.rm-panel-card p code, .rm-panel-card li code {
  background: rgba(43, 33, 24, 0.08); padding: 1px 5px; border-radius: 3px; font-size: 0.9em;
}
.rm-panel-card blockquote {
  margin: 0.9em 0; padding: 2px 16px; border-left: 3px solid #b0925e; color: #5d4c38;
}
.rm-panel-card img { max-width: 100%; height: auto; border-radius: 4px; }
.rm-panel-card hr { border: none; border-top: 1px solid rgba(43, 33, 24, 0.18); margin: 1.6em 0; }
.rm-panel-card ul, .rm-panel-card ol { padding-left: 1.6em; }
.rm-panel-card table { border-collapse: collapse; width: 100%; }
.rm-panel-card th, .rm-panel-card td { border: 1px solid rgba(43, 33, 24, 0.2); padding: 6px 10px; }

.rm-panel-close {
  position: sticky; top: 0; float: right;
  width: 34px; height: 34px; margin: -12px -14px 0 0;
  border: none; border-radius: 50%;
  background: rgba(43, 33, 24, 0.12); color: #2b2118;
  font-size: 18px; line-height: 1; cursor: pointer;
}
.rm-panel-close:hover { background: rgba(43, 33, 24, 0.22); }

.rm-panel-status { padding: 32px 4px; text-align: center; color: #5d4c38; }
.rm-panel-status.rm-panel-error { color: #8a2f1d; }
`;

let injected = false;
function injectStyle() {
  if (injected) return;
  injected = true;
  const style = document.createElement("style");
  style.id = "rm-panel-style";
  style.textContent = CSS;
  document.head.appendChild(style);
}

function dispatch(open) {
  window.dispatchEvent(new CustomEvent("__RM_PANEL", { detail: { open: !!open } }));
}

export function initPanel() {
  injectStyle();

  const overlay = document.createElement("div");
  overlay.className = "rm-panel-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.hidden = true;

  const card = document.createElement("div");
  card.className = "rm-panel-card";

  const closeBtn = document.createElement("button");
  closeBtn.className = "rm-panel-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "关闭");
  closeBtn.textContent = "×";

  const body = document.createElement("div");
  body.className = "rm-panel-body";

  card.appendChild(closeBtn);
  card.appendChild(body);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  let open = false;
  let lastUrl = null;

  function show() {
    if (open) return;
    open = true;
    overlay.hidden = false;
    try { closeBtn.focus({ preventScroll: true }); } catch (e) {}
    /* 下一帧再加 class，让过渡生效 */
    requestAnimationFrame(() => overlay.classList.add("rm-panel-open"));
    dispatch(true);
  }

  function close() {
    if (!open) return;
    open = false;
    overlay.classList.remove("rm-panel-open");
    dispatch(false);
    setTimeout(() => { if (!open) overlay.hidden = true; }, 200);
  }

  function onKey(e) {
    if (e.key === "Escape" && open) { e.stopPropagation(); close(); }
  }

  closeBtn.addEventListener("click", close);
  /* 点击遮罩（卡片外的区域）关闭 */
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  addEventListener("keydown", onKey);

  async function openPost(url) {
    lastUrl = url;
    show();
    body.innerHTML = '<div class="rm-panel-status">加载中…</div>';

    let html = null;
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      html = await res.text();
    } catch (e) {
      console.warn("[RM][panel] 文章加载失败:", url, e && e.message ? e.message : e);
      body.innerHTML = '<div class="rm-panel-status rm-panel-error">文章加载失败</div>';
      return;
    }

    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const main = doc.querySelector("main");
      body.innerHTML = main ? main.innerHTML : html;
    } catch (e) {
      console.warn("[RM][panel] 文章解析失败:", url, e);
      body.innerHTML = '<div class="rm-panel-status rm-panel-error">文章加载失败</div>';
      return;
    }

    card.scrollTop = 0;
    /* 文章内链接：同站路径直接换面板内容，外链新标签打开 */
    body.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || href.charAt(0) === "#") return;
      if (/^https?:\/\//i.test(href)) { a.target = "_blank"; a.rel = "noopener"; }
      else {
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          openPost(new URL(href, url).pathname);
        });
      }
    });
  }

  return {
    openPost,
    close,
    isOpen() { return open; },
    /* 契约外附加：供调试/路由恢复（#reading 用） */
    getLastUrl() { return lastUrl; },
  };
}
