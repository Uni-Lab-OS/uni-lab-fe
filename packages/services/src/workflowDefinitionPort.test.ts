import { describe, expect, it, vi } from 'vitest'

import type { BackendWorkflowGraph } from './backendWorkflowGraph'
import { UnsupportedCapabilityError } from './errors'
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
    expect(invalidate).toHaveBeenCalledWith({ revision: 12 })
  })

  it('keeps Backend authoring usable when Runtime SSE is unavailable', () => {
    const runtime = {
      subscribeWorkflowRuntime: vi.fn(() => {
        throw new UnsupportedCapabilityError(
          'workflow.subscribeEvents',
          'Backend Runtime SSE 尚未完整对齐'
        )
      })
    } as unknown as WorkflowRuntimePort
    const port = createWorkflowDefinitionPort(
      runtime,
      'backend',
      WORKFLOW_UUID
    )

    const subscription = port.subscribe(vi.fn())

    expect(subscription).toEqual({ dispose: expect.any(Function) })
    expect(() => subscription.dispose()).not.toThrow()
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
