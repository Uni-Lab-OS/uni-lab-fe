import { describe, expect, it, vi } from 'vitest'
import type { WorkflowIntervention, WorkflowRuntimePort } from '@unilab/services'
import { groupWorkflowLoading } from './workflowLoadingGroups'
import { createWorkflowInterventionController } from './workflowInterventionController'

function item(uuid: string, site: string, instrument = 'warehouse', task = 'task'): WorkflowIntervention {
  return {
    uuid, workflow_task_uuid: task, workflow_node_job_uuid: `job-${uuid}`,
    revision: 2, status: 'open', delivery_status: 'none', options: [{ id: 'confirm_loading' }],
    meta_data: { loading: { schema_version: 1, request_uuid: `request-${uuid}`, revision: 7,
      rows: [{ key: 'same-row-key', instrument: { id: instrument, label: instrument },
        site: { id: site, label: site }, material: { identity: 'planned', label: `容器${uuid}` },
        quantity: 1, unit: '块', availability: { allowed: true } }] } }
  }
}

function controllerFixture() {
  const rows = new Map(['one', 'two', 'three'].map((uuid, index) => [uuid, item(uuid, `A${index + 1}`)]))
  const decide = vi.fn(async (uuid: string): Promise<{ intervention: WorkflowIntervention; command_uuid: string; created: boolean }> => {
    const completed = { ...rows.get(uuid)!, status: 'superseded' as const }
    rows.set(uuid, completed)
    return { intervention: completed, command_uuid: `command-${uuid}`, created: true }
  })
  const runtime = { interventions: {
    list: async (status: string) => [...rows.values()].filter(value => value.status === status),
    get: async (uuid: string) => rows.get(uuid)!, decide
  }, subscribeWorkflowRuntime: () => ({ dispose: () => {} }) } as unknown as WorkflowRuntimePort
  return { rows, decide, controller: createWorkflowInterventionController(runtime) }
}

describe('warehouse loading groups', () => {
  it('combines ready requests per task and warehouse, naturally sorts positions and preserves request identity', () => {
    const groups = groupWorkflowLoading([
      item('one', 'A10'), item('two', 'A2'), item('three', 'A1', 'other'), item('four', 'A1', 'warehouse', 'other-task')
    ])
    expect(groups).toHaveLength(3)
    expect(groups[0]!.rows.map(row => row.site.label)).toEqual(['A2', 'A10'])
    expect(new Set(groups[0]!.rows.map(row => row.key)).size).toBe(2)
    expect(groups[0]!.decisions[0]).toEqual({ uuid: 'one', revision: 2, requestUuid: 'request-one', requestRevision: 7 })
  })
  it('does not hide an unknown confirmation among other open rows', () => {
    const groups = groupWorkflowLoading([item('one', 'A1'), { ...item('two', 'A2'), status: 'selected', delivery_status: 'unknown' }])
    expect(groups[0]!.decisions.map(value => value.uuid)).toEqual(['one'])
    expect(groups[0]!.rows[1]!.confirmationStatus).toBe('确认结果待核对')
  })
  it('submits frozen individual payloads sequentially without duplicate material confirmation', async () => {
    const f = controllerFixture()
    await f.controller.refresh()
    const identities = groupWorkflowLoading(f.controller.getSnapshot().items)[0]!.decisions
    await f.controller.confirmLoadingGroup(identities)
    expect(f.decide).toHaveBeenCalledTimes(3)
    expect(f.decide.mock.calls.map(call => call[0])).toEqual(['one', 'two', 'three'])
    expect(f.decide).toHaveBeenNthCalledWith(1, 'one', {
      revision: 2, option_id: 'confirm_loading', result: { request_uuid: 'request-one', revision: 7 }
    }, expect.any(String))
    expect(f.controller.getSnapshot().items).toEqual([])
    expect(f.controller.getSnapshot().loadingProgress).toMatchObject({ accepted: 3, total: 3 })
    await f.controller.confirmLoadingGroup(identities)
    expect(f.decide).toHaveBeenCalledTimes(3)
  })
  it('stops on partial failure, retains accepted facts and reuses the failed request key on retry', async () => {
    const f = controllerFixture()
    f.decide.mockImplementationOnce(async uuid => {
      const completed = { ...f.rows.get(uuid)!, status: 'superseded' as const }
      f.rows.set(uuid, completed)
      return { intervention: completed, command_uuid: 'command', created: true }
    }).mockRejectedValueOnce(new Error('第二库位冲突'))
    await f.controller.refresh()
    await f.controller.confirmLoadingGroup(groupWorkflowLoading(f.controller.getSnapshot().items)[0]!.decisions)
    expect(f.decide).toHaveBeenCalledTimes(2)
    expect(f.controller.getSnapshot().loadingProgress).toMatchObject({ accepted: 1, total: 3 })
    expect(f.controller.getSnapshot().error).toContain('第二库位冲突')
    const failedCall = f.decide.mock.calls[1]
    await f.controller.confirmLoadingGroup(groupWorkflowLoading(f.controller.getSnapshot().items)[0]!.decisions)
    expect(f.decide.mock.calls[2]).toEqual(failedCall)
  })
  it('refuses a group whose displayed revision is stale before sending anything', async () => {
    const f = controllerFixture()
    await f.controller.refresh()
    const identities = groupWorkflowLoading(f.controller.getSnapshot().items)[0]!.decisions
    f.rows.set('two', { ...f.rows.get('two')!, revision: 3 })
    await f.controller.refresh()
    await f.controller.confirmLoadingGroup(identities)
    expect(f.decide).not.toHaveBeenCalled()
    expect(f.controller.getSnapshot().error).toContain('已变化')
  })
  it('stops the remaining group when its controller is disposed during confirmation', async () => {
    const f = controllerFixture()
    const stop = f.controller.start()
    await f.controller.refresh()
    const identities = groupWorkflowLoading(f.controller.getSnapshot().items)[0]!.decisions
    f.decide.mockImplementationOnce(async uuid => {
      stop()
      return { intervention: { ...f.rows.get(uuid)!, status: 'superseded' }, command_uuid: 'command', created: true }
    })
    await f.controller.confirmLoadingGroup(identities)
    expect(f.decide).toHaveBeenCalledTimes(1)
  })
  it('stops after unknown delivery and leaves its frozen replay available', async () => {
    const f = controllerFixture()
    await f.controller.refresh()
    f.decide.mockImplementationOnce(async uuid => {
      const uncertain = { ...f.rows.get(uuid)!, status: 'selected' as const,
        selected_option_id: 'confirm_loading', delivery_status: 'unknown' as const }
      f.rows.set(uuid, uncertain)
      return { intervention: uncertain, command_uuid: 'command', created: true }
    })
    await f.controller.confirmLoadingGroup(groupWorkflowLoading(f.controller.getSnapshot().items)[0]!.decisions)
    expect(f.decide).toHaveBeenCalledTimes(1)
    expect(f.controller.getSnapshot().replayable).toContain('one')
    expect(f.controller.getSnapshot().items).toHaveLength(3)
  })
})
