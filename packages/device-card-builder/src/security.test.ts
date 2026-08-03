import { describe, expect, it } from 'vitest'

import { isSafeArchivePath, scanSource } from './security'

describe('device card source policy', () => {
  it('rejects direct network access', () => {
    expect(scanSource('await fetch("/secret")', 'src/card.ts'))
      .toContainEqual(expect.objectContaining({
        code: 'source.network_fetch'
      }))
  })

  it('accepts bridge-only source', () => {
    expect(scanSource(
      'const result = await bridge.callAction("start")',
      'src/card.ts'
    )).toEqual([])
  })

  it('rejects unsafe archive paths', () => {
    expect(isSafeArchivePath('../escape.ts')).toBe(false)
    expect(isSafeArchivePath('/absolute.ts')).toBe(false)
    expect(isSafeArchivePath('src/card.ts')).toBe(true)
  })
})
