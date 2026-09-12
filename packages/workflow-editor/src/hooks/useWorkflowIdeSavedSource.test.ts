import { describe, expect, it, vi } from 'vitest'
import type { WorkflowAuthoringAggregate } from '@unilab/services'

import {
  saveAndSynchronizeActiveWorkflowSource,
  installSynchronizedWorkflowSource,
  workflowIdeSavedSourceInstallDecision
} from './useWorkflowIdeSavedSource'

describe('workflow IDE saved source', () => {
  it.each(['dirty', 'switched'] as const)('preserves changes made while synchronization waits: %s', async change => {
    const source = { workflowUuid: 'workflow-1', sourceUri: 'package://workflow.py', sourceVersion: 'v1', pythonSource: '# original\n' }
    const aggregate = { workflow_uuid: source.workflowUuid, draft: { source_uri: source.sourceUri } } as WorkflowAuthoringAggregate
    const localState = { current: { canvasDirty: false, aggregate } }
    const installAggregate = vi.fn()
    const installAggregateAgainstDirtyCanvas = vi.fn()
    const onSynchronized = vi.fn()
    let finish!: (value: WorkflowAuthoringAggregate) => void
    const synchronization = new Promise<WorkflowAuthoringAggregate>(resolve => { finish = resolve })
    const pending = synchronization.then(saved => installSynchronizedWorkflowSource(source, saved, {
      localState, installAggregate, installAggregateAgainstDirtyCanvas, onSynchronized
    }))
    localState.current = change === 'dirty'
      ? { canvasDirty: true, aggregate }
      : { canvasDirty: false, aggregate: { ...aggregate, workflow_uuid: 'workflow-2' } }
    finish(aggregate)
    if (change === 'switched') await expect(pending).rejects.toThrow('已切换工作流')
    else {
      await pending
      expect(installAggregateAgainstDirtyCanvas).toHaveBeenCalledWith(aggregate)
    }
    expect(installAggregate).not.toHaveBeenCalled()
    expect(onSynchronized).not.toHaveBeenCalled()
  })
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
