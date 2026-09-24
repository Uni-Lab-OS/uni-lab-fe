export type RunPreparationRecord = Readonly<Record<string, unknown>>

export interface RunPreflightRequest {
  readonly run_mode: string
  readonly target_node_uuid?: string
  readonly input: Readonly<Record<string, unknown>>
  readonly inventory_bindings: readonly Readonly<Record<string, unknown>>[]
}

export interface SubmitRunRequest extends RunPreflightRequest {
  readonly workflow_uuid: string
  readonly priority: 'normal' | 'high'
  readonly description?: string
  readonly meta_data?: Readonly<Record<string, unknown>>
}
