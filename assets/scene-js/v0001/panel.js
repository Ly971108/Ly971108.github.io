/* 夏夜老屋 M6 — panel.js（占位实现）
 * DOM 阅读层。契约见 docs/m6-contracts.md。
 * 当前为最小占位：返回空操作 API，保证 main.js 可无面板降级运行。
 */
export function initPanel() {
  console.warn("[RM] panel.js 占位实现：阅读面板未启用");
  return { openPost() {}, close() {}, isOpen() { return false; } };
}
