import type { BackendWorkflowGraph } from './backendWorkflowGraph'
import type {
  WorkflowAuthoringAggregate,
  WorkflowAuthoringGraph,
  WorkflowAuthoringSubscriptionOptions
} from './workflowAuthoringContracts'
import type { WorkflowRuntimePort } from './workflowPort'
import type {
  WorkflowEventSubscription,
  WorkflowRunPreflightReport,
  WorkflowRuntimeSubscriptionOptions,
  WorkflowTaskRunMode
} from './workflowTaskContracts'

export type WorkflowDefinitionAuthority = 'workspace' | 'backend'

export interface WorkflowDefinitionCapabilities {
  authority: WorkflowDefinitionAuthority
  label: 'OS' | 'Backend'
  codeViewing: boolean
  sourceEditing: boolean
  directGraphSaving: boolean
  debugLaunch: boolean
  sourceEditingDisabledReason: string | null
}

export interface WorkflowDefinitionInvalidation {
  workflowUuid: string
  revision: number | null
  draftHash?: string | null
  candidateHash?: string | null
}

export interface WorkflowDefinitionSubscriptionOptions {
  onOpen?: WorkflowRuntimeSubscriptionOptions['onOpen']
  onError?: WorkflowRuntimeSubscriptionOptions['onError']
}

/**
 * Stable definition seam shared by Local and Backend workflow workspaces.
 *
 * The caller owns draft state. This port owns transport selection, wire-shape
 * normalization, direct Backend graph CAS and definition invalidation routing.
 */
export interface WorkflowDefinitionPort {
  capabilities: WorkflowDefinitionCapabilities
  read(): Promise<WorkflowAuthoringAggregate>
  saveGraph(graph: WorkflowAuthoringGraph): Promise<WorkflowAuthoringAggregate>
  preflightRun(
    runMode: WorkflowTaskRunMode,
    targetNodeUuid?: string
  ): Promise<WorkflowRunPreflightReport | null>
  subscribe(
    onInvalidate: (event: WorkflowDefinitionInvalidation) => void,
    options?: WorkflowDefinitionSubscriptionOptions
  ): WorkflowEventSubscription
}

/** Create the only workflow-definition adapter selected by the composition root. */
export function createWorkflowDefinitionPort(
  runtime: WorkflowRuntimePort,
  authority: WorkflowDefinitionAuthority,
  workflowUuid: string
): WorkflowDefinitionPort {
  return authority === 'backend'
    ? backendDefinitionPort(runtime, workflowUuid)
    : workspaceDefinitionPort(runtime, workflowUuid)
}

function workspaceDefinitionPort(
  runtime: WorkflowRuntimePort,
  workflowUuid: string
): WorkflowDefinitionPort {
  return {
    capabilities: {
      authority: 'workspace',
      label: 'OS',
      codeViewing: true,
      sourceEditing: true,
      directGraphSaving: false,
      debugLaunch: true,
      sourceEditingDisabledReason: null
    },
    read: () => runtime.getWorkflowAuthoring(workflowUuid),
    saveGraph: async () => {
      throw new Error('工作区画布必须通过 Python 完整差异保存')
    },
    preflightRun: async () => null,
    subscribe: (onInvalidate, options = {}) =>
      runtime.subscribeWorkflowAuthoring(
        workflowUuid,
        (event) => onInvalidate({
          workflowUuid: event.data.workflow_uuid,
          revision: event.data.workflow_revision,
          draftHash: event.data.draft_hash,
          candidateHash: event.data.candidate_hash
        }),
        options satisfies WorkflowAuthoringSubscriptionOptions
      )
  }
}

function backendDefinitionPort(
  runtime: WorkflowRuntimePort,
  workflowUuid: string
): WorkflowDefinitionPort {
  return {
    capabilities: {
      authority: 'backend',
      label: 'Backend',
      codeViewing: false,
      sourceEditing: false,
      directGraphSaving: true,
      debugLaunch: false,
      sourceEditingDisabledReason:
        '正式 Backend 仅支持画布模式'
    },
    read: async () => backendAggregate(
      await runtime.getBackendWorkflowGraph(workflowUuid)
    ),
    saveGraph: async (graph) => backendAggregate(
      await runtime.saveBackendWorkflowGraph(
        workflowUuid,
        backendGraph(graph, workflowUuid)
      )
    ),
    preflightRun: (runMode, targetNodeUuid) =>
      runtime.getWorkflowRunPreflight(
        workflowUuid,
        runMode,
        targetNodeUuid
      ),
    subscribe: (onInvalidate, options = {}) =>
      runtime.subscribeWorkflowRuntime((event) => {
        if (
          event.event === 'workflow.definition.changed' &&
          event.data.workflow_uuid === workflowUuid
        ) onInvalidate({
          workflowUuid: event.data.workflow_uuid,
          revision: event.data.workflow_revision
        })
      }, options)
  }
}

/** Preserve the complete Backend graph while exposing the shared authoring shape. */
function backendAggregate(graph: BackendWorkflowGraph): WorkflowAuthoringAggregate {
  return {
    workflow_uuid: graph.workflow.uuid,
    workflow_revision: graph.workflow.revision,
    state: 'applied',
    applied_graph: graph as WorkflowAuthoringGraph,
    draft: null,
    candidate: null,
    applied_source: null
  }
}

function backendGraph(
  graph: WorkflowAuthoringGraph,
  workflowUuid: string
): BackendWorkflowGraph {
  const candidate = graph as BackendWorkflowGraph
  return {
    ...candidate,
    workflow: {
      ...candidate.workflow,
      uuid: workflowUuid,
      revision: Number(candidate.workflow.revision)
    },
    nodes: candidate.nodes,
    edges: candidate.edges,
    node_templates: candidate.node_templates,
    handle_templates: candidate.handle_templates,
    inventory_requirements: candidate.inventory_requirements ?? []
  }
}
