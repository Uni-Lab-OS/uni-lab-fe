import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { createWorkbenchConnectionTargets } from './workbench-connection-profile'
import {
  closeConnectionSelector,
  closeConnectionSelectorOnOutsidePointer,
  WorkbenchConnectionSelector
} from './workbench-connection-selector'

const targets = createWorkbenchConnectionTargets({
  managedLocalUrl: 'http://127.0.0.1:37029',
  browserOrigin: 'http://127.0.0.1:3100'
})

describe('WorkbenchConnectionSelector', () => {
  /** 证明控件同时说明连接对象、调度权威和切换不会接管既有任务。 */
  it('presents both explicit authority choices', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchConnectionSelector
        targets={targets}
        selectedMode="local"
        connection="connected"
        onSelect={vi.fn()}
      />
    )

    expect(markup).toContain('本地调试')
    expect(markup).toContain('Workspace Backend 已连接')
    expect(markup).toContain('Backend + Scheduler')
    expect(markup).toContain('本地调度')
    expect(markup).toContain('后端控制')
    expect(markup).toContain('只影响后续新建任务')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('data-authority-profile="local_scheduler"')
  })

  /** 证明存在未保存创作内容时，另一调度权威不可被误触切换。 */
  it('fails closed while authoring changes are unsaved', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchConnectionSelector
        targets={targets}
        selectedMode="local"
        connection="connected"
        switchBlockedReason="请先保存当前工作流修改"
        onSelect={vi.fn()}
      />
    )

    expect(markup).toContain('请先保存当前工作流修改')
    expect(markup).toContain('disabled=""')
  })

  /** 证明 Backend 探测失败时提供可访问的明确重试操作。 */
  it('offers recovery for the selected failed target', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchConnectionSelector
        targets={targets}
        selectedMode="backend"
        connection="error"
        onRetry={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    expect(markup).toContain('Backend 连接失败')
    expect(markup).toContain('重试连接')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('data-authority-profile="backend_controlled"')
  })

  /** 证明完成连接选择后会关闭详情浮层，避免遮挡工作流运行按钮。 */
  it('closes the native selector after a target is chosen', () => {
    const selector = { open: true }

    closeConnectionSelector(selector)

    expect(selector.open).toBe(false)
  })

  /** 证明点击弹层外部会关闭选择器，且不会把弹层内部操作误判为外部点击。 */
  it('closes on outside pointer interaction only', () => {
    const insideTarget = {} as EventTarget
    const outsideTarget = {} as EventTarget
    const selector = {
      open: true,
      contains: (target: Node): boolean => target === insideTarget
    }

    closeConnectionSelectorOnOutsidePointer(selector, insideTarget)
    expect(selector.open).toBe(true)

    closeConnectionSelectorOnOutsidePointer(selector, outsideTarget)
    expect(selector.open).toBe(false)
  })
})
