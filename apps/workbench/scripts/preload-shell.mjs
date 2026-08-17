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
  gap: 18px;
  box-sizing: border-box;
  background: #f4f7fc;
  color: #1f2937;
  font: 600 18px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0.01em;
  opacity: 1;
  transition: opacity 180ms ease;
}
.theia-preload::before {
  content: "UniLab 调试工作台";
}
.theia-preload::after {
  content: "";
  width: 28px;
  height: 28px;
  box-sizing: border-box;
  border: 3px solid rgba(37, 99, 235, 0.18);
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: unilab-workbench-preload-spin 800ms linear infinite;
}
.theia-preload.theia-hidden {
  opacity: 0;
  pointer-events: none;
}
@keyframes unilab-workbench-preload-spin {
  to { transform: rotate(360deg); }
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

export function enableWorkbenchModuleEntry(html) {
  const classicEntry = '<script type="text/javascript" src="./bundle.js" charset="utf-8"></script>'
  const moduleEntry = '<script type="module" src="./bundle.js" charset="utf-8"></script>'
  if (html.includes(moduleEntry)) return html
  if (!html.includes(classicEntry)) {
    throw new Error('Theia frontend index.html 缺少 bundle.js 入口')
  }
  return html.replace(classicEntry, moduleEntry)
}

export function prepareWorkbenchFrontendHtml(html) {
  return enableWorkbenchModuleEntry(injectWorkbenchPreloadShell(html))
}
