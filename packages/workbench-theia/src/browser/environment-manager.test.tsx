import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  RuntimeModeControl,
  SkipWorkflowSourceActivationControl
} from './environment-manager'

describe('RuntimeModeControl', () => {
  it.each([
    ['normal', '正常运行', 'Dry-run'],
    ['dry-run', 'Dry-run', '正常运行']
  ] as const)('exposes %s as the unambiguous selected mode', (
    mode,
    selectedLabel,
    otherLabel
  ) => {
    const markup = renderToStaticMarkup(
      <RuntimeModeControl
        mode={mode}
        disabled={false}
        onSetRuntimeMode={vi.fn()}
      />
    )

    expect(markup).toContain(
      `aria-label="${selectedLabel}（当前）"`
    )
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('codicon-check')
    expect(markup).toContain(`aria-label="${otherLabel}"`)
    expect(markup).toContain('aria-pressed="false"')
  })
})

describe('SkipWorkflowSourceActivationControl', () => {
  it('exposes the skip-reconstruction opt-in', () => {
    const markup = renderToStaticMarkup(
      <SkipWorkflowSourceActivationControl
        checked={false}
        disabled={false}
        onChange={vi.fn()}
      />
    )

    expect(markup).toContain('禁止重构工作流')
    expect(markup).toContain('跳过工作流源码固定点激活')
  })
})
