export interface WorkflowEnvironmentResetSelection {
  rebuild: boolean
  materials: boolean
  locks: boolean
}
export interface WorkflowEnvironmentResetResult {
  operation: string
  status: 'completed' | 'failed' | 'skipped'
  message: string
}
export interface WorkflowEnvironmentResetPlan {
  selection: WorkflowEnvironmentResetSelection
  summary: string[]
  execute: (reason: string, signal?: AbortSignal) => Promise<WorkflowEnvironmentResetResult[]>
}
export interface WorkflowEnvironmentResetPort {
  available: WorkflowEnvironmentResetSelection
  preview: (selection: WorkflowEnvironmentResetSelection) => Promise<WorkflowEnvironmentResetPlan>
}

export function selectEnvironmentReset(
  current: WorkflowEnvironmentResetSelection,
  option: keyof WorkflowEnvironmentResetSelection,
  checked: boolean
): WorkflowEnvironmentResetSelection {
  if (option === 'rebuild' && checked) return { rebuild: true, materials: true, locks: true }
  return { ...current, [option]: checked }
}
