const PRELOAD_STYLE_ID = 'unilab-workbench-preload-style'

const PRELOAD_STYLE = `<style id="${PRELOAD_STYLE_ID}">
html, body {
  margin: 0;
  width: 100%;
  height: 100%;
  background: #f4f7fc;
}
.theia-preload {
  position: fixed;
  inset: 0;
  z-index: 50000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  box-sizing: border-box;
  background: #f6f8fc;
  color: #1f2937;
  font: 600 18px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0.01em;
  opacity: 1;
  transition: opacity 180ms ease;
}
.theia-preload::before {
  content: "UniLab 调试工作台";
  order: 2;
}
.theia-preload::after {
  content: "" !important;
  order: 1;
  display: block;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  box-sizing: border-box;
  border: 3px solid rgba(37, 99, 235, 0.16);
  border-top-color: #2563eb;
  border-radius: 50%;
  color: transparent !important;
  font: 0/0 sans-serif !important;
  animation: unilab-workbench-preload-spin 760ms linear infinite !important;
}
.theia-preload.theia-hidden {
  opacity: 0;
  pointer-events: none;
}
@keyframes unilab-workbench-preload-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .theia-preload::after {
    animation-duration: 1.5s !important;
  }
}
</style>`

export function injectWorkbenchPreloadShell(html) {
  if (html.includes(`id="${PRELOAD_STYLE_ID}"`)) return html
  const link = '<link rel="stylesheet" href="./bundle.css">'
  if (!html.includes(link)) {
    throw new Error('Theia frontend index.html 缺少 bundle.css 链接')
  }
  return html.replace(link, `${link}\n  ${PRELOAD_STYLE}`)
}
