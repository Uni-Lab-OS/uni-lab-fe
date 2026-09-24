export type WorkflowExecutionRecord = Readonly<Record<string, unknown>>

export interface TaskJobsResponse extends WorkflowExecutionRecord {
  readonly items?: readonly WorkflowExecutionRecord[]
  readonly jobs?: readonly WorkflowExecutionRecord[]
  readonly data?: readonly WorkflowExecutionRecord[]
}

