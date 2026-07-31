import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { buildDeviceCard } from '@unilab/device-card-builder'
import type { DeviceCardAuthoringContext } from '@unilab/device-card-sdk'
import { describe, expect, it } from 'vitest'

import { starterFiles } from './templates'

describe('device card starters', () => {
  it.each(['vue', 'react', 'lite'] as const)(
    'creates a complete %s starter',
    (profile) => {
      const files = starterFiles(profile)
      expect(files['card.manifest.json']).toBeTruthy()
      expect(files['authoring-context.json']).toBeTruthy()
      expect(Object.keys(files).some((name) => name.startsWith('src/card.')))
        .toBe(true)
    }
  )

  it.each(['vue', 'react', 'lite'] as const)(
    'builds the generated %s starter with the fixed Builder',
    async (profile) => {
      const root = await mkdtemp(join(tmpdir(), 'unilab-card-starter-'))
      try {
        const files = starterFiles(profile)
        for (const [name, content] of Object.entries(files)) {
          const path = join(root, name)
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, content, 'utf8')
        }
        const context = JSON.parse(
          files['authoring-context.json']
        ) as DeviceCardAuthoringContext
        const result = await buildDeviceCard({
          projectDir: root,
          outDir: join(root, '.unilab-card/test'),
          authoringContext: context,
          development: true
        })

        expect(result.diagnostics).toEqual([])
        expect(result.ok).toBe(true)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )
})
