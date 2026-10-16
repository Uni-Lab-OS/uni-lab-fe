import type { WorkflowRecoveryFact } from '../workflow-execution-read/model'

/** OS 受理“结果未知”作业人工处置后的回执；收尾以执行端确认后的作业状态为准。 */
export interface UncertainJobResolutionReceipt {
  readonly kind: 'uncertain_job_resolution'
  readonly source: 'os'
  readonly jobUuid: string
  readonly resolutionCommandUuid: string | null
  /** true：已请求执行端证明，作业仍占用资源，等待设备侧确认后 OS 才结算为已取消。 */
  readonly pendingEdgeConfirmation: boolean
  readonly created: boolean
  readonly raw: Readonly<Record<string, unknown>>
}

/**
 * OS-only recovery seam。读取恢复事实；写操作只有 OS 已冻结的合同：
 * POST /workflow-node-jobs/{job}/resolve-uncertain（结论只允许 canceled）。
 * 是否可用由 workflow.resolveUncertain 能力声明决定，页面不得据锁字段自行推导。
 */
export interface WorkflowExecutionRecoveryPort {
  getTaskRecovery(taskUuid: string): Promise<WorkflowRecoveryFact>
  /** 操作员现场确认动作未执行或已安全停止后，请求把结果未知的作业按“已取消”收尾。 */
  resolveUncertainJob(jobUuid: string, reason: string): Promise<UncertainJobResolutionReceipt>
}
