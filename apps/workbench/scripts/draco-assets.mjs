import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const WORKBENCH_DRACO_FILES = Object.freeze([
  'draco_decoder.js',
  'draco_decoder.wasm',
  'draco_wasm_wrapper.js'
])

/** Copy the Three.js Draco decoder closure into the Workbench static root. */
export async function copyWorkbenchDracoAssets(options = {}) {
  const sourceDirectory = path.resolve(
    options.sourceDirectory ?? fileURLToPath(new URL(
      '../../../packages/pascal-lab-plugin/node_modules/three/examples/jsm/libs/draco/',
      import.meta.url
    ))
  )
  const outputDirectory = path.resolve(
    options.outputDirectory ?? fileURLToPath(new URL(
      '../lib/frontend/libs/draco/',
      import.meta.url
    ))
  )

  await mkdir(outputDirectory, { recursive: true })
  await Promise.all(WORKBENCH_DRACO_FILES.map(fileName => copyFile(
    path.join(sourceDirectory, fileName),
    path.join(outputDirectory, fileName)
  )))
  return { sourceDirectory, outputDirectory, files: [...WORKBENCH_DRACO_FILES] }
}
