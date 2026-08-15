import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { createMaterialStore } from './store'
import { materialGraphPort } from './testFixtures'
import { MaterialInspector } from './MaterialInspector'
import { MaterialStoreProvider } from './MaterialStoreProvider'

describe('MaterialInspector', () => {
  it('renders an accessible closeable drawer shell', () => {
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort(),
      requireCapability: () => undefined
    })

    const markup = renderToStaticMarkup(
      <MaterialStoreProvider store={store}>
        <MaterialInspector
          materialId="hotel"
          updateStatus={{
            available: false,
            reason: '当前服务不支持修改'
          }}
          onClose={() => undefined}
        />
      </MaterialStoreProvider>
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-label="物料属性"')
    expect(markup).toContain('aria-label="关闭物料属性"')
    expect(markup).toContain('data-slide-over-mode="modeless"')
    expect(markup).not.toContain('aria-modal="true"')
    expect(markup).not.toContain('data-slide-over-backdrop')
    expect(markup).toContain('选择 2D 或 3D 中的物料查看详情')
  })
})
