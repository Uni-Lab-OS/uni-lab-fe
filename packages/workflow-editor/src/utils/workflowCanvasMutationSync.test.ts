import type {
  WorkflowAuthoringAggregate,
  WorkflowAuthoringGraph,
  WorkflowDefinitionPort,
  WorkflowRuntimePort
} from '@unilab/services'
import { describe, expect, it, vi } from 'vitest'

import {
  AuthoringOperationQueue
} from './persistentAuthoringSession'
import { enqueueCanvasMutationSync } from './workflowCanvasMutationSync'

const WORKFLOW_UUID = '11111111-1111-4111-8111-111111111111'

function graph(): WorkflowAuthoringGraph {
  return {
    workflow: { uuid: WORKFLOW_UUID, revision: 3 },
    nodes: [],
    edges: [],
    node_templates: [],
    handle_templates: []
  }
}

function aggregate(overrides: Partial<WorkflowAuthoringAggregate> = {}) {
  const appliedGraph = graph()
  return {
    workflow_uuid: WORKFLOW_UUID,
    workflow_revision: 3,
    state: 'applied' as const,
    applied_graph: appliedGraph,
    draft: {
      source_uri: 'package://lab/workflows/sample.py',
      python_source: 'result = old()\n',
      draft_hash: 'draft-old',
      update_time: '2026-09-07T00:00:00Z',
      diagnostics: []
    },
    candidate: null,
    applied_source: null,
    ...overrides
  } satisfies WorkflowAuthoringAggregate
}

function definitionPort(
  directGraphSaving: boolean,
  saveGraph: WorkflowDefinitionPort['saveGraph']
): WorkflowDefinitionPort {
  return {
    capabilities: {
      authority: directGraphSaving ? 'backend' : 'workspace',
      label: directGraphSaving ? 'Backend' : 'OS',
      codeViewing: !directGraphSaving,
      sourceEditing: !directGraphSaving,
      directGraphSaving,
      debugLaunch: !directGraphSaving,
      sourceEditingDisabledReason: directGraphSaving
        ? 'Backend 不支持源码编辑'
        : null
    },
    read: vi.fn(),
    saveGraph,
    preflightRun: vi.fn(),
    subscribe: vi.fn()
  }
}

function dependencies(options: {
  aggregate: WorkflowAuthoringAggregate
  definitionPort: WorkflowDefinitionPort
  runtime: WorkflowRuntimePort
  generateCanvasPython: ReturnType<typeof vi.fn>
}) {
  const localState = {
    current: {
      mode: 'canvas' as const,
      codeDirty: false,
      canvasDirty: true,
      editorValue: 'result = old()\n',
      aggregate: options.aggregate,
      graph: options.aggregate.applied_graph,
      selectedNodeUuid: null,
      selectedNodeName: '',
      selectedNodeNameDirty: false
    }
  }
  return {
    ...options,
    editorReplaceContent: vi.fn(),
    localState,
    queue: new AuthoringOperationQueue(),
    sequenceRef: { current: 0 },
    setAggregate: vi.fn(),
    setCanvasDirty: vi.fn(),
    setError: vi.fn(),
    setGraph: vi.fn(),
    setLocalValidationDiagnostics: vi.fn(),
    setMessage: vi.fn(),
    setRemoteConflict: vi.fn(),
    tailRef: { current: Promise.resolve() },
    workflowUuid: WORKFLOW_UUID,
    workflowUuidRef: { current: WORKFLOW_UUID },
    definitionPortRef: { current: options.definitionPort }
  }
}

describe('workflow canvas mutation synchronization', () => {
  it('writes an OS draft after a node move using the generated validated source', async () => {
    const current = aggregate()
    const saved = aggregate({
      draft: {
        ...current.draft!,
        python_source: 'result = moved()\n',
        draft_hash: 'draft-new'
      }
    })
    const generateCanvasPython = vi.fn().mockResolvedValue({
      diagnostics: [],
      graph: graph(),
      normalized_python_source: 'result = moved()\n',
      source_map: [],
      changeset: null,
      compiler_version: 'test',
      template_catalog_fingerprint: 'catalog-1'
    })
    const saveWorkflowAuthoringDraft = vi.fn().mockResolvedValue(saved)
    const deps = dependencies({
      aggregate: current,
      definitionPort: definitionPort(false, vi.fn()),
      runtime: { saveWorkflowAuthoringDraft } as unknown as WorkflowRuntimePort,
      generateCanvasPython
    })

    enqueueCanvasMutationSync(graph(), 'node_move', deps)
    await vi.waitFor(() => expect(saveWorkflowAuthoringDraft).toHaveBeenCalled())

    expect(generateCanvasPython).toHaveBeenCalledWith(
      expect.anything(),
      current
    )
    expect(saveWorkflowAuthoringDraft).toHaveBeenCalledWith(
      WORKFLOW_UUID,
      expect.objectContaining({
        python_source: 'result = moved()\n',
        expected_draft_hash: 'draft-old',
        expected_workflow_revision: 3
      })
    )
    expect(deps.setCanvasDirty).toHaveBeenCalledWith(false)
    expect(deps.setMessage).toHaveBeenCalledWith('节点位置已同步到 OS')
  })

  it('uses the direct graph port for Backend connections', async () => {
    const current = aggregate({ state: 'unapplied_graph' })
    const saved = aggregate({
      state: 'applied',
      workflow_revision: 4,
      applied_graph: graph()
    })
    const saveGraph = vi.fn().mockResolvedValue(saved)
    const generateCanvasPython = vi.fn()
    const deps = dependencies({
      aggregate: current,
      definitionPort: definitionPort(true, saveGraph),
      runtime: {} as WorkflowRuntimePort,
      generateCanvasPython
    })

    enqueueCanvasMutationSync(graph(), 'connect', deps)
    await vi.waitFor(() => expect(saveGraph).toHaveBeenCalled())

    expect(generateCanvasPython).not.toHaveBeenCalled()
    expect(deps.setMessage).toHaveBeenCalledWith(
      '连线已同步到 OS；可继续编辑或运行工作流'
    )
  })
})
