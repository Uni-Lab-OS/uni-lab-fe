import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowEnvironmentResetDialog } from './WorkflowEnvironmentResetDialog'
import { selectEnvironmentReset } from '../utils/workflowEnvironmentReset'

describe('environment reset choices', () => {
  it('defaults to the supported live material operation without destructive confirmation', () => {
    const preview = vi.fn()
    const html = renderToStaticMarkup(<WorkflowEnvironmentResetDialog
      port={{ available: { rebuild: true, materials: true, locks: true }, preview }} onClose={vi.fn()} />)
    expect(html.match(/checked=""/g)).toHaveLength(1)
    expect(html).toContain('新建物料保留并移到未放置')
    expect(html).toContain('预览复位范围')
    expect(html).not.toContain('确认执行')
    expect(preview).not.toHaveBeenCalled()
  })

  it('selects every operation for rebuild and allows independent live choices afterward', () => {
    const all = selectEnvironmentReset({ rebuild: false, materials: false, locks: false }, 'rebuild', true)
    expect(all).toEqual({ rebuild: true, materials: true, locks: true })
    expect(selectEnvironmentReset(all, 'rebuild', false)).toEqual({ rebuild: false, materials: true, locks: true })
  })
})
