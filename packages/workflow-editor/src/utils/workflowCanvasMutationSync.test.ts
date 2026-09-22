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
import {
  enqueueCanvasMutationSync,
  isMissingRequiredActionParameterError
} from './workflowCanvasMutationSync'

const WORKFLOW_UUID = '11111111-1111-4111-8111-111111111111'

describe('canvas mutation validation classification', () => {
  it('keeps an empty newly-added RepeatUntil as an editable draft', () => {
    expect(isMissingRequiredActionParameterError(
      new Error('candidate_invalid: RepeatUntil 冻结合同无效')
    )).toBe(true)
  })
})

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
    definitionPortRef: { current: options.definitionPort },
    ...options
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

  it('persists incomplete nodes as drafts when generate succeeds', async () => {
    const current = aggregate()
    const saved = aggregate({
      state: 'draft_invalid',
      draft: {
        ...current.draft!,
        python_source: 'result = inspect_beaker()\n',
        draft_hash: 'draft-incomplete',
        diagnostics: [{
          severity: 'error',
          code: 'candidate_invalid',
          message: '缺少必填输入 beaker'
        }]
      }
    })
    const generateCanvasPython = vi.fn().mockResolvedValue({
      diagnostics: [],
      graph: graph(),
      normalized_python_source: 'result = inspect_beaker()\n',
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
    const setError = vi.fn()
    const setMessage = vi.fn()
    const setLocalValidationDiagnostics = vi.fn()
    deps.setError = setError
    deps.setMessage = setMessage
    deps.setLocalValidationDiagnostics = setLocalValidationDiagnostics

    enqueueCanvasMutationSync(graph(), 'create', deps)
    await vi.waitFor(() => expect(saveWorkflowAuthoringDraft).toHaveBeenCalled())

    expect(setError).toHaveBeenCalledWith(null)
    expect(setLocalValidationDiagnostics).toHaveBeenCalledWith(
      saved.draft?.diagnostics
    )
    expect(setMessage).toHaveBeenCalledWith(
      '节点已保存为草稿。请继续配置必填物料或参数后再运行。'
    )
  })

  it('keeps incomplete required-parameter failures as local draft diagnostics', async () => {
    const generateCanvasPython = vi.fn().mockRejectedValue(
      new Error('candidate_invalid: 动作缺少必填参数 beaker')
    )
    const deps = dependencies({
      aggregate: aggregate(),
      definitionPort: definitionPort(false, vi.fn()),
      runtime: { saveWorkflowAuthoringDraft: vi.fn() } as unknown as WorkflowRuntimePort,
      generateCanvasPython
    })
    const setError = vi.fn()
    const setMessage = vi.fn()
    const setLocalValidationDiagnostics = vi.fn()
    const setCanvasDirty = vi.fn()
    deps.setError = setError
    deps.setMessage = setMessage
    deps.setLocalValidationDiagnostics = setLocalValidationDiagnostics
    deps.setCanvasDirty = setCanvasDirty

    enqueueCanvasMutationSync(graph(), 'create', deps)
    await vi.waitFor(() => expect(generateCanvasPython).toHaveBeenCalled())

    expect(setError).toHaveBeenCalledWith(null)
    expect(setCanvasDirty).toHaveBeenCalledWith(true)
    expect(setLocalValidationDiagnostics).toHaveBeenCalledWith([
      expect.objectContaining({
        severity: 'error',
        code: 'candidate_invalid',
        message: '动作缺少必填参数 beaker'
      })
    ])
    expect(setMessage).toHaveBeenCalledWith(
      '节点已加到画布。草稿暂未写入，请配好必填项后重试保存。'
    )
  })

  it('keeps an empty condition branch editable when moving a node', async () => {
    const saveWorkflowAuthoringDraft = vi.fn()
    const deps = dependencies({
      aggregate: aggregate(),
      definitionPort: definitionPort(false, vi.fn()),
      runtime: { saveWorkflowAuthoringDraft } as unknown as WorkflowRuntimePort,
      generateCanvasPython: vi.fn().mockRejectedValue(
        new Error('candidate_invalid: 条件分支不能为空')
      )
    })
    const movedGraph = graph()
    enqueueCanvasMutationSync(movedGraph, 'node_move', deps)
    await deps.tailRef.current

    expect(saveWorkflowAuthoringDraft).not.toHaveBeenCalled()
    expect(deps.localState.current.graph).toBe(movedGraph)
    expect(deps.setCanvasDirty).toHaveBeenCalledWith(true)
    expect(deps.setError).toHaveBeenCalledWith(null)
    expect(deps.setLocalValidationDiagnostics).toHaveBeenCalledWith([
      expect.objectContaining({
        severity: 'warning',
        code: 'condition_branch_incomplete',
        message: expect.stringContaining('IF / ELSE')
      })
    ])
    expect(deps.setMessage).toHaveBeenCalledWith(expect.stringContaining('尚未保存到 OS'))
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
