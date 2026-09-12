/** OS 权威干预事实；selected/accepted 均不表示动作完成。 */
export interface WorkflowIntervention {
  uuid: string
  workflow_task_uuid: string
  workflow_node_job_uuid: string
  revision: number
  status: 'open' | 'selected' | 'superseded'
  description?: string
  meta_data: Record<string, unknown>
  options: Array<{ id: string; label?: string; action?: string; description?: string; [key: string]: unknown }>
  selected_option_id?: string
  delivery_status: 'none' | 'pending' | 'accepted' | 'unknown'
}

export interface WorkflowInterventionPort {
  list: (status: 'open' | 'selected', limit?: number) => Promise<WorkflowIntervention[]>
  get: (uuid: string) => Promise<WorkflowIntervention>
  decide: (uuid: string, body: { revision: number; option_id: string; result?: unknown }, idempotencyKey: string) => Promise<{
    intervention: WorkflowIntervention
    command_uuid: string
    created: boolean
  }>
}
