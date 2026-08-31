import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const materialViewportConsumers = [
  './workbench-material-viewport.tsx'
] as const

describe('Workbench material viewport layer controls', () => {
  it.each(materialViewportConsumers)(
    'forwards the shared name-label layer in %s',
    async (relativePath) => {
      const source = await readFile(
        fileURLToPath(new URL(relativePath, import.meta.url)),
        'utf8'
      )

      expect(source).toMatch(
        /renderView=\{\(viewMode,\s*\{\s*showSites,\s*showMaterialTransfers,\s*showMaterialLabels\s*\}\)\s*=>/u
      )
      expect(source).toContain('showMaterialLabels={showMaterialLabels}')
    }
  )

  it('keeps Pascal read-only while forwarding 2D move capability', async () => {
    const source = await readFile(
      fileURLToPath(new URL(
        './workbench-material-viewport.tsx',
        import.meta.url
      )),
      'utf8'
    )

    expect(source).toContain('moveStatus={moveStatus}')
    expect(source).not.toContain('editable={moveStatus.available}')
    expect(source).not.toContain('onMaterialMoves=')
  })
})
