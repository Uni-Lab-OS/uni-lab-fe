export type WorkflowExecutionRecord = Readonly<Record<string, unknown>>

export interface TaskJobsResponse extends WorkflowExecutionRecord {
  readonly items?: readonly WorkflowExecutionRecord[]
  readonly jobs?: readonly WorkflowExecutionRecord[]
  readonly data?: readonly WorkflowExecutionRecord[]
}

export interface NodeJobFeedbackResponse extends WorkflowExecutionRecord {
  readonly items?: readonly WorkflowExecutionRecord[]
  readonly has_more?: unknown
  readonly page?: unknown
  readonly page_size?: unknown
  readonly next_cursor?: unknown
}
