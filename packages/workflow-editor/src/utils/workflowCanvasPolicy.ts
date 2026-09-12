/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: GPT-5
 * Generation Date: 2026-07-30
 * Prompt Summary: Temporarily make the workflow ReactFlow canvas read-only.
 * Context: Preserve selection and measurement changes without mutating workflow topology.
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import type { EdgeChange, NodeChange } from 'reactflow'

export type WorkflowEditMode = 'code' | 'canvas'

export interface WorkflowAuthoringSurfacePolicy {
  pythonEditorReadOnly: boolean
  canvasMutationEnabled: boolean
}

export const READ_ONLY_WORKFLOW_CANVAS = {
  nodesDraggable: false,
  nodesConnectable: false,
  edgesUpdatable: false,
  deleteKeyCode: null,
  connectOnClick: false
} as const

export const CANVAS_EDIT_WORKFLOW_CANVAS = {
  nodesDraggable: true,
  nodesConnectable: false,
  edgesUpdatable: false,
  deleteKeyCode: ['Delete', 'Backspace'] as string[],
  connectOnClick: false
} as const

export function workflowAuthoringSurfacePolicy(
  mode: WorkflowEditMode
): WorkflowAuthoringSurfacePolicy {
  return mode === 'code'
    ? {
        pythonEditorReadOnly: false,
        canvasMutationEnabled: false
      }
    : {
        pythonEditorReadOnly: true,
        canvasMutationEnabled: true
      }
}

export function workflowAuthoringModeSwitchDecision(input: {
  currentMode: WorkflowEditMode
  requestedMode: WorkflowEditMode
  activeSurfaceDirty: boolean
}): 'stay' | 'switch' | 'confirm_dirty' {
  if (input.currentMode === input.requestedMode) return 'stay'
  return input.activeSurfaceDirty ? 'confirm_dirty' : 'switch'
}

export function workflowCanvasDraftSaveDecision(input: {
  baselinePython: string
  generatedPython: string
  fullDiffAccepted: boolean
}):
  | { kind: 'review_full_diff'; before: string; after: string }
  | { kind: 'write_complete_draft'; python_source: string } {
  if (!input.fullDiffAccepted) {
    return {
      kind: 'review_full_diff',
      before: input.baselinePython,
      after: input.generatedPython
    }
  }
  return {
    kind: 'write_complete_draft',
    python_source: input.generatedPython
  }
}

export function workflowAuthoringInvalidationDecision(input: {
  dirty: boolean
  localPython: string
}):
  | { kind: 'rehydrate' }
  | { kind: 'defer_remote'; editor_value: string } {
  return input.dirty
    ? { kind: 'defer_remote', editor_value: input.localPython }
    : { kind: 'rehydrate' }
}

const ALLOWED_NODE_CHANGE_TYPES = new Set<NodeChange['type']>([
  'dimensions',
  'select'
])

/**
 * ReactFlow still needs measurement and selection updates in read-only mode.
 * Position, add, remove and reset changes are deliberately ignored.
 */
export function visibleReadOnlyNodeChanges(
  changes: readonly NodeChange[]
): NodeChange[] {
  return changes.filter((change) => ALLOWED_NODE_CHANGE_TYPES.has(change.type))
}

export function visibleReadOnlyEdgeChanges(
  changes: readonly EdgeChange[]
): EdgeChange[] {
  return changes.filter((change) => change.type === 'select')
}
