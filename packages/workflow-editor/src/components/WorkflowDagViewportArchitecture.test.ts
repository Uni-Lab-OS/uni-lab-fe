import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const dagPath = fileURLToPath(new URL('./WorkflowDag.tsx', import.meta.url))
const x6CanvasPath = fileURLToPath(
  new URL('./WorkflowX6Canvas.tsx', import.meta.url)
)

describe('WorkflowDag viewport authority', () => {
  /** 证明 X6 只在首次装图自动适配，后续布局更新保留用户缩放。 */
  it('fits once on initialization and preserves manual zoom across layout changes', () => {
    const source = readFileSync(dagPath, 'utf8')
    const canvasSource = readFileSync(x6CanvasPath, 'utf8')

    expect(source).toContain('x6CanvasRef.current?.fit()')
    expect(source).toContain('onClick={fitWorkflowView}')
    expect(source).toContain('适应视图')
    expect(canvasSource).toContain('const initialFitPendingRef = useRef(true)')
    expect(canvasSource).toContain('if (!initialFitPending.current')
    expect(canvasSource).toContain('virtual: { enabled: true, margin: 480 }')
    expect(canvasSource).toContain('graph.resetCells(cells)')
    expect(canvasSource).not.toContain('resetCells(cells, { silent: true })')
    expect(canvasSource).toContain('new ResizeObserver')
    expect(canvasSource).not.toContain('graphSignature')
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
