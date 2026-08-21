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
    expect(markup).toContain('本地调试可用')
    expect(markup).toContain('Backend + Scheduler')
    expect(markup).toContain('当前工作区')
    expect(markup).toContain('服务器')
    expect(markup).toContain('切换前，需要先结束当前方式中的活动任务')
    expect(markup).toContain('选择调试方式')
    expect(markup).toContain('自动保存、替换定义并验证')
    expect(markup).not.toContain('Workspace Backend')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('data-authority-profile="local_scheduler"')
  })

  /** 证明真正的安全门禁会禁用另一调度权威。 */
  it('fails closed while an authority safety condition is active', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchConnectionSelector
        targets={targets}
        selectedMode="local"
        connection="connected"
        switchBlockedReason="当前环境存在活动任务，结束后才能切换"
        onSelect={vi.fn()}
      />
    )

    expect(markup).toContain('当前环境存在活动任务，结束后才能切换')
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

    expect(markup).toContain('Backend 不可用')
    expect(markup).toContain('重试连接')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('data-authority-profile="backend_controlled"')
  })

  it('keeps an unavailable Backend selectable so the normal attempt can fail visibly', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchConnectionSelector
        targets={targets}
        selectedMode="local"
        connection="connected"
        targetConnections={{ local: 'connected', backend: 'error' }}
        onSelect={vi.fn()}
      />
    )

    expect(markup).toContain('当前不可用')
    expect(markup).toMatch(/<button[^>]*aria-pressed="false"/)
    expect(markup).not.toMatch(/<button[^>]*aria-pressed="false"[^>]*disabled=""/)
  })

  it('offers force only after a normal transition failure allows it', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchConnectionSelector
        targets={targets}
        selectedMode="local"
        connection="connected"
        transitionFailure={{
          target: 'backend',
          message: 'Backend 当前不可用',
          canForce: true
        }}
        onForceSelect={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    expect(markup).toContain('未切换到 Backend + Scheduler')
    expect(markup).toContain('仍然强制切换')
  })

  it('offers cancel tasks and switch for an active-task conflict', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchConnectionSelector
        targets={targets}
        selectedMode="local"
        connection="connected"
        transitionFailure={{
          target: 'backend',
          message: '当前环境存在活动任务。你可以先取消任务，再继续切换。',
          canForce: false,
          canCancelTasks: true
        }}
        onCancelTasksAndSelect={vi.fn()}
        onSelect={vi.fn()}
      />
    )

    expect(markup).toContain('取消任务并切换')
    expect(markup).not.toContain('仍然强制切换')
    expect(markup).not.toContain('权威')
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
