import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  hasNormalizedContainerModuleInterop,
  normalizeContainerModuleInteropBundle
} from './container-module-interop.mjs'

describe('Theia ContainerModule interop normalizer', () => {
  it('normalizes the readable development loader', () => {
    assert.equal(
      normalizeContainerModuleInteropBundle(
        'container.load(containerModule.default)'
      ),
      'container.load(containerModule.default?.registry ? containerModule.default : containerModule.default?.default)'
    )
  })

  it('normalizes the minified production loader', () => {
    assert.equal(
      normalizeContainerModuleInteropBundle(
        'function Fa(i,t){return Promise.resolve(t).then(r=>i.load(r.default))}'
      ),
      'function Fa(i,t){return Promise.resolve(t).then(r=>i.load(r.default?.registry?r.default:r.default?.default))}'
    )
  })

  it('is idempotent for an already normalized loader', () => {
    const normalized =
      'function Fa(i,t){return Promise.resolve(t).then(r=>i.load(r.default?.registry?r.default:r.default?.default))}'
    assert.equal(normalizeContainerModuleInteropBundle(normalized), normalized)
    assert.equal(hasNormalizedContainerModuleInterop(normalized), true)
  })
})
