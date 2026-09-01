import { describe, expect, it } from 'vitest'

import {
  saveAndSynchronizeActiveWorkflowSource,
  workflowIdeSavedSourceInstallDecision
} from './useWorkflowIdeSavedSource'

describe('workflow IDE saved source', () => {
  it('installs a saved Python aggregate without opening normalization review', () => {
    expect(workflowIdeSavedSourceInstallDecision(false)).toEqual({
      kind: 'install'
    })
  })

  it('keeps a dirty canvas while installing diagnostics for the saved source', () => {
    expect(workflowIdeSavedSourceInstallDecision(true)).toEqual({
      kind: 'preserve_dirty_canvas'
    })
  })

  it('waits for the commanded Theia save to finish OS synchronization', async () => {
    const steps: string[] = []
    let finishSynchronization: (() => void) | undefined
    const aggregate = { workflow_revision: 8 }
    const pending = saveAndSynchronizeActiveWorkflowSource(
      {
        saveActiveWorkflowSource: async () => {
          steps.push('ide_saved')
          return {
            workflowUuid: 'workflow-1',
            sourceUri: 'package://example/workflow.py',
            sourceVersion: 'v1',
            pythonSource: 'value = 2\n'
          }
        }
      },
      async (savedSource) => {
        steps.push(`os_started:${savedSource.pythonSource.trim()}`)
        await new Promise<void>((resolve) => {
          finishSynchronization = resolve
        })
        steps.push('os_finished')
        return aggregate
      }
    )

    await Promise.resolve()
    expect(steps).toEqual(['ide_saved', 'os_started:value = 2'])
    let resolved = false
    void pending.then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)

    finishSynchronization?.()
    await expect(pending).resolves.toBe(aggregate)
    expect(steps).toEqual([
      'ide_saved',
      'os_started:value = 2',
      'os_finished'
    ])
  })
})
