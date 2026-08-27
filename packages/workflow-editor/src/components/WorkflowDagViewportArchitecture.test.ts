import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const dagPath = fileURLToPath(new URL('./WorkflowDag.tsx', import.meta.url))

describe('WorkflowDag viewport authority', () => {
  /** 证明画布只保留一个显式适应视图入口，并尊重用户手动缩放。 */
  it('fits once on initialization and preserves manual zoom across layout changes', () => {
    const source = readFileSync(dagPath, 'utf8')

    expect(source).toContain('fitViewOptions={WORKFLOW_FIT_VIEW_OPTIONS}')
    expect(source).toContain('showFitView={false}')
    expect(source).toContain('onClick={fitWorkflowView}')
    expect(source).toContain('适应视图')
    expect(source).not.toContain('ResizeObserver')
    expect(source).not.toContain('graphSignature')
  })

  it('keeps layout controls and dropdowns inside narrow windows', () => {
    const styles = readFileSync(
      new URL('./_workflow-beautify.scss', import.meta.url),
      'utf8'
    )
    expect(styles).toContain('width: min(280px, calc(100vw - 32px))')
    expect(styles).toContain('flex-wrap: wrap')
  })
})
