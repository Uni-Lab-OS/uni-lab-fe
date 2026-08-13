import { describe, expect, it } from 'vitest'

import { applyUniLabTheme } from './unilab-theme'

describe('applyUniLabTheme', () => {
  it('projects Theia dark mode onto UniLab design-system surfaces', () => {
    const root = { dataset: {} as DOMStringMap }

    applyUniLabTheme('dark', root)

    expect(root.dataset.theme).toBe('dark')
  })

  it('uses the light palette for every non-dark Theia theme', () => {
    const root = { dataset: { theme: 'dark' } as DOMStringMap }

    applyUniLabTheme('light', root)

    expect(root.dataset.theme).toBe('light')
  })
})
