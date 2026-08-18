import { readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UnifiedMaterialViewport } from './UnifiedMaterialViewport'

describe('UnifiedMaterialViewport', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn()
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the shared 2D, 2.5D, 3D and split switch', () => {
    const markup = renderToStaticMarkup(
      <UnifiedMaterialViewport renderView={() => <div>scene</div>} />
    )

    expect(markup).toContain('aria-label="实验室视图"')
    expect(markup).toContain('<span>2D</span>')
    expect(markup).toContain('<span>2.5D</span>')
    expect(markup).toContain('<span>3D</span>')
    expect(markup).toContain('<span>分屏</span>')
  })

  it('owns the shared site-layer switch chrome', () => {
    const styles = readFileSync(
      new URL('./UnifiedMaterialViewport.css', import.meta.url),
      'utf8'
    )

    expect(styles).toContain('.lab-site-layer-toggle i::after')
    expect(styles).toContain(
      '.lab-site-layer-toggle button.is-active.is-transfer'
    )
  })

  /** 证明 3D 模式只展示准确的左键选择与右键旋转说明。 */
  it('shows an operation guide only when a 3D scene is visible', () => {
    const threeDimensionalMarkup = renderToStaticMarkup(
      <UnifiedMaterialViewport
        viewState={{
          mode: '3d',
          showSites: true,
          showMaterialTransfers: true
        }}
        renderView={() => <div>scene</div>}
      />
    )
    const twoDimensionalMarkup = renderToStaticMarkup(
      <UnifiedMaterialViewport
        viewState={{
          mode: '2d',
          showSites: true,
          showMaterialTransfers: true
        }}
        renderView={() => <div>scene</div>}
      />
    )
    const splitMarkup = renderToStaticMarkup(
      <UnifiedMaterialViewport
        viewState={{
          mode: 'split',
          showSites: true,
          showMaterialTransfers: true
        }}
        renderView={() => <div>scene</div>}
      />
    )

    for (const markup of [threeDimensionalMarkup, splitMarkup]) {
      expect(markup).toContain('aria-label="3D 操作说明"')
      expect(markup).toContain('左键选择物料')
      expect(markup).toContain('右键旋转视角')
      expect(markup).not.toContain('拖拽旋转视角')
      expect(markup).not.toContain('滚轮缩放')
      expect(markup).not.toContain('右键拖拽平移')
    }
    expect(twoDimensionalMarkup).not.toContain('aria-label="3D 操作说明"')
  })

  /**
   * 证明 3D 操作说明位于画布左上角，并在窄画布中换行而不横向溢出。
   *
   * @returns 无返回值；断言桌面端左对齐，窄画布由左右边界约束且保留换行。
   * @throws 操作说明回到右侧或窄画布不再换行时由 Vitest 抛出。
   * @safety 仅检查样式合同，不触发 3D 场景或物料（Material）选择。
   */
  it('anchors the 3D guide at the canvas top-left and wraps on narrow canvases', () => {
    const styles = readFileSync(
      new URL('./UnifiedMaterialViewport.css', import.meta.url),
      'utf8'
    )

    expect(styles).toMatch(
      /\.lab-unified-viewport\s*\{[^}]*container-name:\s*material-viewport;[^}]*container-type:\s*inline-size;/s
    )
    expect(styles).toMatch(
      /\.lab-3d-operation-guide\s*\{[^}]*top:\s*calc\(40px \+ 14px\);[^}]*left:\s*14px;[^}]*flex-wrap:\s*wrap;/s
    )
    expect(styles).not.toMatch(
      /\.lab-3d-operation-guide\s*\{[^}]*right:\s*14px;/s
    )
    expect(styles).toMatch(
      /@container material-viewport \(max-width: 720px\)[\s\S]*\.lab-3d-operation-guide\s*\{[^}]*top:\s*calc\(40px \+ 10px\);[^}]*right:\s*10px;[^}]*left:\s*10px;[^}]*max-width:\s*none;/s
    )
    expect(styles).toMatch(
      /@container material-viewport \(max-width: 720px\)[\s\S]*\.lab-3d-operation-guide span\s*\{[^}]*white-space:\s*normal;/s
    )
  })

  it('renders independently selectable material roles from the shared package', () => {
    const markup = renderToStaticMarkup(
      <UnifiedMaterialViewport
        visibleMaterialRoles={['reagent']}
        materialRoleOptions={[
          {
            value: 'reagent',
            label: '试剂',
            accent: '#7c3aed',
            lineageCount: 5
          },
          {
            value: 'consumable',
            label: '耗材',
            accent: '#0f766e',
            lineageCount: 2
          }
        ]}
        onVisibleMaterialRolesChange={vi.fn()}
        renderView={() => <div>scene</div>}
      />
    )

    expect(markup).toContain('aria-label="物料节点可见性：显示 1/2"')
    expect(markup).toContain('type="checkbox"')
    expect(markup).toContain('checked=""')
    expect(markup).toContain('试剂')
    expect(markup).toContain('耗材')
  })
})
