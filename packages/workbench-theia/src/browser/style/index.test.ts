import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

let stylesheet = ''
let domainNavigationStylesheet = ''

/** 读取 Workbench 主样式与领域导航样式，供结构性回归断言复用。 */
beforeAll(async () => {
  const [
    shell,
    connection,
    runtimeLogs,
    environment,
    surfaces,
    aionui,
    navigation
  ] = await Promise.all([
    readFile(fileURLToPath(new URL('./workbench-shell.css', import.meta.url)), 'utf8'),
    readFile(
      fileURLToPath(new URL('./workbench-connection-selector.css', import.meta.url)),
      'utf8'
    ),
    readFile(
      fileURLToPath(new URL('./workbench-runtime-log-drawer.css', import.meta.url)),
      'utf8'
    ),
    readFile(fileURLToPath(new URL('./environment-manager.css', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('./workbench-surfaces.css', import.meta.url)), 'utf8'),
    readFile(fileURLToPath(new URL('./aionui.css', import.meta.url)), 'utf8'),
    readFile(
      fileURLToPath(new URL('./workbench-domain-navigation.css', import.meta.url)),
      'utf8'
    )
  ])
  stylesheet = [
    shell,
    connection,
    runtimeLogs,
    environment,
    surfaces,
    aionui
  ].join('\n')
  domainNavigationStylesheet = navigation
})

describe('environment manager layering and responsive layout', () => {
  it('owns the viewport above every material canvas overlay', () => {
    const overlay = cssRule('.unilab-environment-manager__overlay')
    const panel = cssRule('.unilab-environment-manager')
    const overlayZIndex = Number(overlay.match(/z-index:\s*(\d+)/u)?.[1])

    expect(overlay).toContain('position: fixed')
    expect(overlayZIndex).toBeGreaterThan(1000)
    expect(panel).toContain('position: absolute')
    expect(panel).toMatch(/box-sizing:\s*border-box/u)
    expect(panel).toMatch(/bottom:\s*12px/u)
    expect(panel).not.toMatch(/max-height:/u)
  })

  it('keeps the status rail independently scrollable in short windows', () => {
    const rule = cssRule('.unilab-environment-manager__rail')

    expect(rule).toMatch(/min-height:\s*0/u)
    expect(rule).toMatch(/overflow-y:\s*auto/u)
    expect(rule).toMatch(/overflow-x:\s*hidden/u)
    expect(rule).toMatch(/scrollbar-gutter:\s*stable/u)
  })

  it('uses a readable accented selection for the OS mode control', () => {
    const rule = cssRule('.unilab-environment-manager__mode button.is-active')

    expect(rule).toMatch(/color:\s*var\(--unilab-color-primary\)/u)
    expect(rule).toMatch(/background:\s*var\(--unilab-color-primary-soft\)/u)
    expect(rule).toMatch(/inset 3px 0 0 var\(--unilab-color-primary\)/u)
  })

  it('keeps OS actions in a left-to-right flow while preserving their visual hierarchy', () => {
    const primary = cssRule('.unilab-environment-card__actions button.is-primary')
    const port = cssRule('.unilab-environment-card__actions button.is-port-action')

    expect(primary).toMatch(/background:\s*var\(--unilab-color-primary\)/u)
    expect(port).not.toMatch(/margin-left:\s*auto/u)
    expect(port).toMatch(/border-style:\s*dashed/u)
  })

  it('shows complete paths instead of silently truncating runtime facts', () => {
    const rule = cssRule('.unilab-environment-card dd')

    expect(rule).toMatch(/overflow-wrap:\s*anywhere/u)
    expect(rule).toMatch(/white-space:\s*normal/u)
    expect(rule).not.toMatch(/text-overflow:\s*ellipsis/u)
  })

  /** 证明选择工作区入口以同一弹性轴对齐图标和文案。 */
  it('vertically aligns the workspace icon and label as one control', () => {
    const button = cssRule(
      '.unilab-workbench__bar nav .unilab-workspace-switch'
    )
    const icon = cssRule('.unilab-workspace-switch__icon')

    expect(button).toMatch(/display:\s*inline-flex/u)
    expect(button).toMatch(/align-items:\s*center/u)
    expect(icon).toMatch(/place-items:\s*center/u)
    expect(icon).toMatch(/flex:\s*0 0 14px/u)
  })

  /** 证明大纲不再占用 Workbench 右侧产品导航入口。 */
  it('removes the outline entry from the right product navigation', () => {
    expect(domainNavigationStylesheet).toMatch(
      /\.theia-app-right\s+\.lm-TabBar-tab\[id='shell-tab-outline-view'\]\s*\{[^}]*display:\s*none/u
    )
  })

  /** 证明产品不保留 48px 右活动栏，主工作区始终铺到窗口边缘。 */
  it('reclaims the right sidebar width for the main workbench', () => {
    expect(domainNavigationStylesheet).toMatch(
      /#theia-left-right-split-panel\s*\{[^}]*right:\s*0 !important;[^}]*width:\s*100% !important/u
    )
    expect(domainNavigationStylesheet).toMatch(
      /\.theia-app-right\s*\{[^}]*display:\s*none !important/u
    )
    expect(domainNavigationStylesheet).not.toMatch(
      /#theia-left-right-split-panel\s*> #theia-right-content-panel,\s*\.theia-app-right/u
    )
    expect(domainNavigationStylesheet).toMatch(
      /#theia-left-right-split-panel\s*> #theia-right-content-panel\s*\{[^}]*display:\s*none !important;[^}]*min-width:\s*0 !important;[^}]*max-width:\s*0 !important/u
    )
    expect(domainNavigationStylesheet).toMatch(
      /body\.unilab-agent-panel-visible[\s\S]*?#theia-right-content-panel\s*\{[^}]*display:\s*flex !important;[^}]*min-width:\s*420px !important/u
    )
    expect(domainNavigationStylesheet).toMatch(
      /body\.unilab-agent-panel-visible[\s\S]*?#theia-bottom-split-panel\s*\{[^}]*right:\s*420px !important/u
    )
    expect(domainNavigationStylesheet).toMatch(
      /#theia-left-right-split-panel\s*> #theia-bottom-split-panel\s*\{[^}]*right:\s*0 !important;[^}]*width:\s*auto !important/u
    )
    expect(domainNavigationStylesheet).not.toMatch(
      /#theia-left-right-split-panel\s*> #theia-bottom-split-panel\s*\{[^}]*left:\s*48px !important/u
    )
    expect(domainNavigationStylesheet).toMatch(
      /#theia-bottom-split-panel\s*> #theia-main-content-panel\s*\{[^}]*right:\s*0 !important;[^}]*width:\s*100% !important/u
    )
    expect(domainNavigationStylesheet).toMatch(
      /#theia-main-content-panel\s*> \.lm-DockPanel-widget\s*\{[^}]*top:\s*0 !important;[^}]*left:\s*0 !important;[^}]*right:\s*0 !important;[^}]*width:\s*100% !important;[^}]*height:\s*100% !important/u
    )
    expect(domainNavigationStylesheet).toMatch(
      /#theia-main-content-panel\s*> \.lm-TabBar\.theia-app-centers\.theia-app-main\s*\{[^}]*display:\s*none !important/u
    )
  })

  /** 证明 Theia 底部面板展开时，运行输出连同表头一起让出空间。 */
  it('hides embedded workflow output while the bottom panel is open', () => {
    expect(stylesheet).toMatch(
      /#theia-bottom-split-panel:has\(\s*> #theia-bottom-content-panel:not\(\.lm-mod-hidden\)\s*\)[\s\S]*?> #theia-main-content-panel[\s\S]*?\.unilab-workbench__surface--workflow[\s\S]*?\.workflow-runtime__results:not\(\.is-fullscreen\)\s*\{\s*display:\s*none !important;/u
    )
  })

  /** 机械臂调试、点位和实验台能力保留，但暂不展示其活动栏入口。 */
  it('hides the three internal robot navigation entries', () => {
    expect(domainNavigationStylesheet).toMatch(
      /data-unilabdomain='robot-debug'[\s\S]*data-unilabdomain='robot-points'[\s\S]*data-unilabdomain='robot-bench'[\s\S]*display:\s*none/u
    )
  })
  /** 证明运行连接选择采用扁平分段控件，并在窄屏重排而不是横向压缩。 */
  it('keeps the authority choices readable and responsive', () => {
    const options = cssRule('.unilab-workbench-connection__options')
    const popover = cssRule('.unilab-workbench-connection__popover')

    expect(options).toMatch(/grid-template-columns:\s*1fr 1fr/u)
    expect(popover).toMatch(/width:\s*min\(460px/u)
    expect(stylesheet).toContain('@media (max-width: 520px)')
    expect(stylesheet).toMatch(
      /@media \(max-width: 520px\)[\s\S]*\.unilab-workbench-connection__options\s*\{[\s\S]*grid-template-columns:\s*1fr/u
    )
  })

  /** 左右侧栏同时打开时按工作台自身宽度换行，避免操作区被 Agent 覆盖。 */
  it('wraps the workbench header by its own available width', () => {
    expect(stylesheet).toMatch(
      /\.unilab-workbench\s*\{[^}]*container-name:\s*unilab-workbench[^}]*container-type:\s*inline-size/u
    )
    expect(stylesheet).toMatch(
      /@container unilab-workbench \(max-width: 900px\)[\s\S]*?\.unilab-workbench__bar\s*\{[^}]*flex-wrap:\s*wrap/u
    )
    expect(stylesheet).toMatch(
      /@container unilab-workbench \(max-width: 560px\)[\s\S]*?\.unilab-workbench__controls nav\s*\{[^}]*overflow-x:\s*auto/u
    )
  })

  /** 证明运行日志抽屉占满可用高度，并在窄屏切换为整屏而非溢出。 */
  it('keeps the runtime log drawer usable across desktop and narrow screens', () => {
    const drawer = cssRule('.unilab-runtime-log-drawer')
    const output = cssRule('.unilab-runtime-log-drawer__output')

    expect(drawer).toMatch(/position:\s*relative/u)
    expect(drawer).toMatch(/grid-template-rows:[\s\S]*minmax\(0, 1fr\)/u)
    expect(output).toMatch(/min-height:\s*0/u)
    expect(output).toMatch(/overflow:\s*auto/u)
    expect(stylesheet).toMatch(
      /@media \(max-width: 720px\)[\s\S]*\.unilab-runtime-log-drawer\s*\{[\s\S]*width:\s*100%/u
    )
  })
})

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = stylesheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'u'))
  if (!match) throw new Error(`Missing CSS rule: ${selector}`)
  return match[1]!
}
