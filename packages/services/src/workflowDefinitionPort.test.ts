import { describe, expect, it, vi } from 'vitest'

import type { BackendWorkflowGraph } from './backendWorkflowGraph'
import { createWorkflowDefinitionPort } from './workflowDefinitionPort'
import type { WorkflowRuntimePort } from './workflowPort'

const WORKFLOW_UUID = '10000000-0000-4000-8000-000000000001'

describe('WorkflowDefinitionPort', () => {
  it('keeps Workspace source authoring behind the shared definition seam', async () => {
    const authoring = {
      workflow_uuid: WORKFLOW_UUID,
      workflow_revision: 4,
      state: 'applied',
      applied_graph: emptyGraph(4),
      draft: null,
      candidate: null,
      applied_source: null
    } as const
    const getWorkflowAuthoring = vi.fn(async () => authoring)
    const runtime = {
      getWorkflowAuthoring,
      subscribeWorkflowAuthoring: vi.fn(() => ({ dispose: vi.fn() }))
    } as unknown as WorkflowRuntimePort
    const port = createWorkflowDefinitionPort(
      runtime,
      'workspace',
      WORKFLOW_UUID
    )

    await expect(port.read()).resolves.toBe(authoring)
    expect(port.capabilities).toMatchObject({
      authority: 'workspace',
      codeViewing: true,
      sourceEditing: true,
      directGraphSaving: false,
      debugLaunch: true
    })
    await expect(port.saveGraph(authoring.applied_graph)).rejects
      .toThrow('Python 完整差异')
  })

  it('preserves Workspace draft and candidate identity in invalidations', () => {
    let listener: Parameters<
      WorkflowRuntimePort['subscribeWorkflowAuthoring']
    >[1]
    const runtime = {
      subscribeWorkflowAuthoring: vi.fn((_workflowUuid, next) => {
        listener = next
        return { dispose: vi.fn() }
      })
    } as unknown as WorkflowRuntimePort
    const port = createWorkflowDefinitionPort(
      runtime,
      'workspace',
      WORKFLOW_UUID
    )
    const invalidate = vi.fn()

    port.subscribe(invalidate)
    listener!({
      id: 'authoring-1',
      event: 'workflow.authoring.changed',
      data: {
        workflow_uuid: WORKFLOW_UUID,
        cause: 'draft_saved',
        workflow_revision: 4,
        draft_hash: 'draft-2',
        candidate_hash: 'candidate-2'
      }
    })

    expect(invalidate).toHaveBeenCalledWith({
      workflowUuid: WORKFLOW_UUID,
      revision: 4,
      draftHash: 'draft-2',
      candidateHash: 'candidate-2'
    })
  })

  it('normalizes Backend graph reads and preserves direct graph CAS writes', async () => {
    const graph = backendGraphFixture(8)
    const saved = backendGraphFixture(9)
    const getBackendWorkflowGraph = vi.fn(async () => graph)
    const saveBackendWorkflowGraph = vi.fn(async () => saved)
    const runtime = {
      getBackendWorkflowGraph,
      saveBackendWorkflowGraph,
      subscribeWorkflowRuntime: vi.fn(() => ({ dispose: vi.fn() })),
      getWorkflowRunPreflight: vi.fn()
    } as unknown as WorkflowRuntimePort
    const port = createWorkflowDefinitionPort(
      runtime,
      'backend',
      WORKFLOW_UUID
    )

    const loaded = await port.read()
    expect(loaded).toMatchObject({
      workflow_uuid: WORKFLOW_UUID,
      workflow_revision: 8,
      state: 'applied',
      draft: null,
      candidate: null
    })
    expect(loaded.applied_graph).toBe(graph)

    const result = await port.saveGraph(loaded.applied_graph)
    expect(saveBackendWorkflowGraph).toHaveBeenCalledWith(
      WORKFLOW_UUID,
      expect.objectContaining({
        workflow: expect.objectContaining({ revision: 8 }),
        inventory_requirements: graph.inventory_requirements
      })
    )
    expect(result.workflow_revision).toBe(9)
    expect(port.capabilities).toMatchObject({
      authority: 'backend',
      codeViewing: false,
      sourceEditing: false,
      directGraphSaving: true,
      debugLaunch: false,
      sourceEditingDisabledReason: '正式 Backend 仅支持画布模式'
    })
  })

  it('filters Backend definition invalidations at the adapter', () => {
    let listener: Parameters<WorkflowRuntimePort['subscribeWorkflowRuntime']>[0]
    const runtime = {
      subscribeWorkflowRuntime: vi.fn((next) => {
        listener = next
        return { dispose: vi.fn() }
      })
    } as unknown as WorkflowRuntimePort
    const port = createWorkflowDefinitionPort(
      runtime,
      'backend',
      WORKFLOW_UUID
    )
    const invalidate = vi.fn()

    port.subscribe(invalidate)
    listener!({
      id: '1',
      event: 'workflow.definition.changed',
      data: { workflow_uuid: WORKFLOW_UUID, workflow_revision: 12 }
    })
    listener!({
      id: '2',
      event: 'workflow.definition.changed',
      data: {
        workflow_uuid: '20000000-0000-4000-8000-000000000002',
        workflow_revision: 13
      }
    })

    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({
      workflowUuid: WORKFLOW_UUID,
      revision: 12
    })
  })
})

function emptyGraph(revision: number) {
  return {
    workflow: { uuid: WORKFLOW_UUID, revision, meta_data: {} },
    nodes: [],
    edges: [],
    node_templates: [],
    handle_templates: []
  }
}

function backendGraphFixture(revision: number): BackendWorkflowGraph {
  return {
    ...emptyGraph(revision),
    workflow: { uuid: WORKFLOW_UUID, revision, name: 'Fixture' },
    inventory_requirements: [{ uuid: 'inventory-1' }]
  }
}
