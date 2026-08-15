import type {
  CapabilityStatus,
  WorkflowDefinitionPort,
  WorkflowAuthoringAggregate,
  WorkflowAuthoringGraph,
  WorkflowRuntimePort
} from '@unilab/services'

import type { WorkflowTracePort } from '../traceRuntime'
import type { WorkflowPanelRuntimeProjection } from '../workflowPanelProjection'
import type { WorkflowEditMode } from '../utils/workflowCanvasPolicy'
import type { WorkflowResourceSlotOptionsPort } from '../utils/workflowResourceSlotOptions'
import type { WorkflowIdeBridge } from '../utils/workflowSourceNavigation'

export interface PersistentWorkflowAuthoringOptions {
  runtime: WorkflowRuntimePort
  definitionPort: WorkflowDefinitionPort
  definitionEditingStatus?: CapabilityStatus
  workflowUuid: string
  traceRuntime?: WorkflowTracePort
  resourceSlotOptionsPort?: WorkflowResourceSlotOptionsPort
  executionStatus?: CapabilityStatus
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void
  onWorkflowRuntimeProjectionChange?: (
    projection: WorkflowPanelRuntimeProjection | null
  ) => void
  onSelectedWorkflowStepChange?: (workflowNodeUuid: string | null) => void
  onChooseWorkflow?: () => void
  ideBridge?: WorkflowIdeBridge
  hideEmbeddedCodeEditor?: boolean
  recoveryRevision?: number
}

export interface FullSourceDiff {
  before: string
  after: string
  expectedDraftHash: string | null
  expectedWorkflowRevision: number
  reason: 'canvas_save' | 'conflict_retry' | 'source_normalization'
  resumeMode: WorkflowEditMode
  applyAfterSave: boolean
}

export interface RemoteConflict {
  remote: WorkflowAuthoringAggregate
  localMode: WorkflowEditMode
  localPython: string
  localGraph: WorkflowAuthoringGraph | null
  selectedNodeUuid: string | null
  selectedNodeName: string
  selectedNodeNameDirty: boolean
}

export type WorkflowCodeProjection = 'python' | 'json'
