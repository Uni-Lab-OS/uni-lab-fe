import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('./workbenchRemoteIpc.ts', import.meta.url),
  'utf8'
)

describe('Workbench Workspace IPC contract', () => {
  it('registers the openPath channel exposed by preload', () => {
    expect(source).toContain(
      "ipcMain.handle('workbench-workspace:openPath'"
    )
    expect(source).toMatch(
      /workbench-workspace:openPath[\s\S]*\.openPath\(path, normalizeEntryMode\(entryMode\)\)/u
    )
  })

  it('passes the selected entry mode through directory selection', () => {
    expect(source).toMatch(
      /workbench-workspace:openDirectory[\s\S]*\.chooseAndOpen\('open', normalizeEntryMode\(entryMode\)\)/u
    )
    expect(source).toMatch(
      /selectDirectory: true,[\s\S]*entryMode: normalizeEntryMode\(entryMode\)/u
    )
  })
})
