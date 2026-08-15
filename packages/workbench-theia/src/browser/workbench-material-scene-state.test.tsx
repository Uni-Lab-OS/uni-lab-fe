import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  WorkbenchMaterialSceneState,
  WorkbenchMaterialShapeFallbackNotice
} from './workbench-material-scene-state'

describe('Workbench material scene states', () => {
  /** 证明非空但无空间关系的物料图会明确停用空间视图并保留列表事实。 */
  it('explains the list-only degradation with authoritative counts', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchMaterialSceneState
        kind="list-only"
        readiness={{
          state: 'list-only',
          materialCount: 52,
          positionedMaterialCount: 0,
          siteCount: 0
        }}
      />
    )

    expect(markup).toContain('空间视图暂不可用')
    expect(markup).toContain('已读取 52 项物料')
    expect(markup).toContain('2D、2.5D、3D 与分屏已停用')
    expect(markup).toContain('<dt>已定位</dt><dd>0</dd>')
    expect(markup).toContain('data-material-scene-state="list-only"')
  })

  /** 证明读取失败状态包含具体原因和明确恢复操作。 */
  it('offers an actionable recovery after graph loading fails', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchMaterialSceneState
        kind="error"
        error="Backend returned 503"
        onRetry={vi.fn()}
      />
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Backend returned 503')
    expect(markup).toContain('重新读取物料图')
  })

  /** 证明外形声明缺失被明确说明为 2.5D 包围盒降级。 */
  it('labels the shape-library fallback', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchMaterialShapeFallbackNotice />
    )

    expect(markup).toContain('未提供可用的 2.5D 外形声明')
    expect(markup).toContain('基础包围盒')
  })
})
