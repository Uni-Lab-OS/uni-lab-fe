export type WorkflowExecutionRecord = Readonly<Record<string, unknown>>

export interface TaskJobsResponse extends WorkflowExecutionRecord {
  readonly items?: readonly WorkflowExecutionRecord[]
  readonly jobs?: readonly WorkflowExecutionRecord[]
  readonly data?: readonly WorkflowExecutionRecord[]
}

export interface TaskListResponse extends WorkflowExecutionRecord {
  readonly items?: readonly WorkflowExecutionRecord[]
  readonly total?: unknown
  readonly page?: unknown
  readonly page_size?: unknown
  readonly has_more?: unknown
}

export interface TaskPresentationResponse extends WorkflowExecutionRecord {
  readonly items?: readonly WorkflowExecutionRecord[]
  readonly total?: unknown
  readonly page?: unknown
  readonly page_size?: unknown
  /** 仅摘要视图返回：view="summary" 与 summary_version 标明摘要合同。 */
  readonly view?: unknown
  readonly summary_version?: unknown
}

export interface NodeJobFeedbackResponse extends WorkflowExecutionRecord {
  readonly items?: readonly WorkflowExecutionRecord[]
  readonly has_more?: unknown
  readonly page?: unknown
  readonly page_size?: unknown
  readonly next_cursor?: unknown
}
