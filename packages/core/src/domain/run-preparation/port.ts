import type {
  BindingDraft,
  NodeJobDetail,
  PreflightReport,
  RunConfiguration,
  SubmittedRun
} from './model'

export interface RunPreparationPort {
  requestPreflight(
    workflowUuid: string,
    configuration: RunConfiguration,
    binding: BindingDraft
  ): Promise<PreflightReport>

  submitRun(
    workflowUuid: string,
    configuration: RunConfiguration,
    binding: BindingDraft
  ): Promise<SubmittedRun>

  getNodeJobDetail(jobUuid: string): Promise<NodeJobDetail>
}
