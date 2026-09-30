import type {
  WorkflowRuntimeInvalidation,
  WorkflowRuntimeSubscription
} from '../workflow-execution-read/model'

/** 全局 SSE 只发失效通知；scenario 收到后必须重新读取 Task/Jobs。 */
export interface WorkflowRuntimeEventsPort {
  subscribe(
    listener: (event: WorkflowRuntimeInvalidation) => void,
    options?: {
      readonly lastEventId?: string
      readonly onOpen?: (state: {
        readonly lastEventId: string
        readonly reconnected: boolean
      }) => void
      readonly onError?: (error: Error) => void
    }
  ): WorkflowRuntimeSubscription
}
