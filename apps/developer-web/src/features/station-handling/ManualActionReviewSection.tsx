import { clsx } from 'clsx'
import { Alert } from 'antd'
import type { StationManualActionJob } from '@unilab-fe/core'
import stationStyles from './stationHandling.module.scss'
import { ManualReviewForm } from './ManualReviewForm'
import { useManualActionReview } from './useManualActionReview'

/**
 * 一条已结束手动动作的现场核对。
 *
 * 这是会话关闭之后唯一的出口：错误事实已消解、任务可能已终态、没有活跃会话，
 * 但 OS 仍然记着这条动作的核对未完成（`result_reviewed=false`）。没有这个面，
 * 那条关注点就静默留在系统里没人管。
 */
export function ManualActionReviewSection({ action }: { action: StationManualActionJob }) {
  const controller = useManualActionReview(action.jobUuid)
  const audit = controller.context?.audit ?? null
  const reviewed = action.resultReviewed || controller.context?.resultReviewed === true

  if (reviewed) {
    return (
      <div className={clsx(stationStyles['manual-review-done'])}>
        <strong>结果已人工核对</strong>
        <p className={clsx(stationStyles['manual-review-done-meta'])}>这是一次人工处置动作。</p>
        {audit && (
          <p className={clsx(stationStyles['manual-review-done-meta'])}>
            {audit.reason} · {audit.operatorId} · {audit.reviewedAt}
          </p>
        )}
      </div>
    )
  }

  if (controller.readError) {
    return (
      <Alert
        type="error"
        showIcon
        className={clsx(stationStyles['manual-form-wide'])}
        message={`核对状态读取失败：${controller.readError.message}`}
      />
    )
  }

  return (
    <div className={clsx(stationStyles['manual-review-section'])}>
      {/* 只有这一种节点需要说明它是什么：它不是工作流节点错误，所以这里没有决定入口，
          它的结果在这里核对。 */}
      <p className={clsx(stationStyles['manual-review-note'])}>
        这是一次人工处置动作，不是工作流节点错误。
      </p>
      {action.uncertaintyReason && (
        <p className={clsx(stationStyles['manual-review-note'])}>
          设备没有回传明确终态：{action.uncertaintyReason}。OS 要求现场核对之后才算处理完。
        </p>
      )}
      <ManualReviewForm
        pending={controller.pending || controller.loading}
        submitError={controller.submitError}
        onSubmit={controller.review}
      />
    </div>
  )
}
