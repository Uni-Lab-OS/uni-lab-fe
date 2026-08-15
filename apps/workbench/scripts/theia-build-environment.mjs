import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
export const nativeCopyGuardPath = path.join(
  scriptDirectory,
  'theia-native-copy-guard.cjs'
)

/** Add the narrow node-pty copy guard to Theia and its esbuild child. */
export function theiaBuildEnvironment(environment = process.env) {
  const guardOption = /\s/u.test(nativeCopyGuardPath)
    ? `--require=${JSON.stringify(nativeCopyGuardPath)}`
    : `--require=${nativeCopyGuardPath}`
  return {
    ...environment,
    NODE_OPTIONS: [environment.NODE_OPTIONS, guardOption]
      .filter(Boolean)
      .join(' ')
  }
}
