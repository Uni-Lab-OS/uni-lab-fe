import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { WorkbenchModeEntry } from './workbench-mode-entry'

describe('WorkbenchModeEntry', () => {
  it('matches the no-login industrial startup hierarchy', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchModeEntry
        workspaceLabel="Uni-Lab-SZLab"
        workspacePath="/workspace/Uni-Lab-SZLab"
        onConfigure={vi.fn()}
      />
    )

    expect(markup).toContain('Uni-Lab Studio')
    expect(markup).toContain('aria-labelledby="workbench-mode-title"')
    expect(markup).not.toContain('aria-modal="true"')
    expect(markup).toContain('实验自动化')
    expect(markup).toContain('选择工作模式')
    expect(markup).toContain('调试模式')
    expect(markup).toContain('生产模式')
    expect(markup).toContain('当前设备包')
    expect(markup).toContain('/workspace/Uni-Lab-SZLab')
    expect(markup).toContain('进入调试模式')
    expect(markup).not.toContain('账号')
    expect(markup).not.toContain('密码')
    expect(markup).not.toContain('运行环境')
  })

  it('preserves production as the selected mode when exiting production', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchModeEntry
        workspaceLabel="SZLab"
        initialMode="production"
        status={{ label: 'SERVICE ONLINE', tone: 'online' }}
        onConfigure={vi.fn()}
        onReturn={vi.fn()}
      />
    )

    expect(markup).toContain('data-mode="production"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('进入生产模式')
    expect(markup).toContain('SERVICE ONLINE')
    expect(markup).toContain('返回当前工作台')
  })
})
