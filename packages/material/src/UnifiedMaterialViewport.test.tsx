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
    expect(styles).toContain(
      '.lab-site-layer-toggle button.is-active.is-labels'
    )
  })

  it('bounds shared controls to its own narrow viewport container', () => {
    const styles = readFileSync(
      new URL('./UnifiedMaterialViewport.css', import.meta.url),
      'utf8'
    )

    expect(styles).toContain(`.lab-unified-viewport {
  container-name: lab-unified-viewport;
  container-type: inline-size;
}`)
    const containerQueryStart = styles.indexOf(
      '@container lab-unified-viewport (max-width: 720px) {'
    )
    const viewportFallbackStart = styles.indexOf('@media (max-width: 720px) {')
    expect(containerQueryStart).toBeGreaterThan(-1)
    expect(viewportFallbackStart).toBeGreaterThan(containerQueryStart)
    const narrowContainerStyles = styles.slice(
      containerQueryStart,
      viewportFallbackStart
    )
    expect(narrowContainerStyles).toContain(`.lab-viewport-controls {
    bottom: 10px;
    display: grid;
    width: min(360px, calc(100% - 20px));`)
    expect(narrowContainerStyles).toContain(`.lab-view-mode-toggle,
  .lab-site-layer-toggle,
  .lab-material-role-filter {
    width: 100%;`)
    expect(narrowContainerStyles).toContain(`.lab-view-mode-toggle button,
  .lab-site-layer-toggle button,
  .lab-material-role-filter > summary {
    min-width: 0;
    min-height: 44px;
    flex: 1 1 0;`)
  })

  it('publishes the persisted material-label layer intent to every view', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) =>
        key === 'unilab.lab.material-label-layer-visible'
          ? 'false'
          : null
      ),
      setItem: vi.fn()
    })

    const markup = renderToStaticMarkup(
      <UnifiedMaterialViewport
        renderView={(_, options) => (
          <output data-material-labels={options.showMaterialLabels} />
        )}
      />
    )

    expect(markup).toContain('aria-label="名称标签"')
    expect(markup).toContain('aria-pressed="false"')
    expect(markup).toContain('data-material-labels="false"')
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
