import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MaterialStoreProvider } from './MaterialStoreProvider'
import { MaterialTreeSidebar } from './MaterialTreeSidebar'
import { createMaterialStore } from './store'
import { materialGraphPort } from './testFixtures'

describe('MaterialTreeSidebar presentation', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** 证明红绿库位状态点同时提供可见文字说明，颜色不是唯一证据。 */
  it('explains occupied and empty site indicators', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort(),
      requireCapability: () => undefined
    })

    const markup = renderToStaticMarkup(
      <MaterialStoreProvider store={store}>
        <MaterialTreeSidebar />
      </MaterialStoreProvider>
    )

    expect(markup).toContain('aria-label="库位状态说明"')
    expect(markup).toContain('已占用')
    expect(markup).toContain('未占用')
  })
})
