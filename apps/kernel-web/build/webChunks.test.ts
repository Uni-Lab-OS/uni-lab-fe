import { describe, expect, it } from 'vitest'
import { webChunkName } from './webChunks'

describe('webChunkName', () => {
  it.each([
    ['/repo/packages/workflow-editor/src/index.ts', 'feature-workflow'],
    ['/repo/packages/material/src/index.ts', 'feature-material'],
    ['/repo/node_modules/.pnpm/react@19.2.1/node_modules/react/index.js', 'vendor-react'],
    ['/repo/node_modules/.pnpm/elkjs@0.10.2/node_modules/elkjs/lib/elk.bundled.js', 'vendor-workflow-layout'],
    ['/repo/node_modules/.pnpm/three@0.185.0/node_modules/three/examples/jsm/loaders/GLTFLoader.js', 'vendor-three-addons'],
    ['/repo/node_modules/.pnpm/three@0.185.0/node_modules/three/build/three.webgpu.js', 'vendor-three-core'],
    ['/repo/node_modules/.pnpm/three@0.185.0/node_modules/three/build/three.module.js', 'vendor-three-core'],
    ['/repo/node_modules/.pnpm/@pascal-app+editor@0.9.2/node_modules/@pascal-app/editor/src/index.ts', 'vendor-pascal-editor'],
    ['/repo/node_modules/.pnpm/@pascal-app+viewer@0.9.2/node_modules/@pascal-app/viewer/dist/index.js', 'vendor-pascal-runtime'],
    ['/repo/node_modules/.pnpm/@react-three+fiber@9.4.0/node_modules/@react-three/fiber/dist/index.js', 'vendor-react-three'],
    ['/repo/node_modules/.pnpm/@codemirror+state@6.5.2/node_modules/@codemirror/state/dist/index.js', 'vendor-code-editor']
  ])('maps %s to %s', (id, expectedChunk) => {
    expect(webChunkName(id)).toBe(expectedChunk)
  })

  it('leaves application modules to Rollup', () => {
    expect(webChunkName('/repo/apps/kernel-web/src/App.tsx')).toBeUndefined()
    expect(webChunkName('/repo/node_modules/.pnpm/nanoid@5.1.6/node_modules/nanoid/index.js')).toBeUndefined()
  })
})
