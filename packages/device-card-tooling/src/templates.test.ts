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
})
