import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { showWorkspaceDirectoryDialog } from './workspace-dialog.mjs'

describe('Workspace directory dialog', () => {
  it('attaches the native chooser to the active Workbench window', async () => {
    const owner = { isDestroyed: () => false }
    const calls = []
    const result = { canceled: true, filePaths: [] }
    const dialog = {
      showOpenDialog: async (...arguments_) => {
        calls.push(arguments_)
        return result
      }
    }
    const BrowserWindow = {
      getAllWindows: () => [owner]
    }

    assert.equal(await showWorkspaceDirectoryDialog({
      dialog,
      BrowserWindow,
      kind: 'open'
    }), result)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], owner)
    assert.deepEqual(calls[0][1], {
      title: '打开 UniLab 工作区',
      buttonLabel: '打开',
      properties: ['openDirectory', 'createDirectory']
    })
  })

  it('falls back to an unparented chooser without a live window', async () => {
    const calls = []
    const dialog = {
      showOpenDialog: async (...arguments_) => {
        calls.push(arguments_)
        return { canceled: true, filePaths: [] }
      }
    }
    const BrowserWindow = {
      getAllWindows: () => [{ isDestroyed: () => true }]
    }

    await showWorkspaceDirectoryDialog({
      dialog,
      BrowserWindow,
      kind: 'create'
    })

    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], [{
      title: '新建 UniLab 工作区',
      buttonLabel: '创建并打开',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate']
    }])
  })
})
