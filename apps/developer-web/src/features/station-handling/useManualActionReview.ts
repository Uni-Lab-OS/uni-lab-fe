import { useCallback, useRef, useState } from 'react'
import { StationHandlingError } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import { useStationHandling } from './StationHandlingProvider'

/**
 * 事后核对：手动动作已经结束、甚至会话已经关闭时，核对它的现场结果。
 *
 * 为什么需要单独一条路：会话关闭后没有活跃会话可依赖，只能靠 job 自己的
 * `review_version`。版本不符时 OS 会拒绝，必须重新读取上下文再核对，
 * 而不是拿旧版本硬提交、把别人的核对顶掉。
 */
export function useManualActionReview(jobUuid: string | null) {
  const { backend } = useBackend()
  const { refresh } = useStationHandling()
  const query = useBackendQuery(`manual-review-${jobUuid}`, (current) =>
    jobUuid
      ? current.core.stationErrorHandling.getManualActionReview(jobUuid)
      : Promise.resolve(null),
  )
  const [pending, setPending] = useState(false)
  const [submitError, setSubmitError] = useState<string | undefined>(undefined)
  const inFlight = useRef(false)

  const review = useCallback(
    async (reason: string): Promise<boolean> => {
      const context = query.data
      if (!jobUuid || !context || inFlight.current) return false
      inFlight.current = true
      setPending(true)
      setSubmitError(undefined)
      try {
        const receipt = await backend.core.stationErrorHandling.submitManualActionReview(
          jobUuid,
          {
            expectedReviewVersion: context.reviewVersion,
            reason,
            operatorConfirmed: true,
          },
          { idempotencyKey: crypto.randomUUID() },
        )
        if (receipt.status !== 'APPLIED') {
          setSubmitError('核对请求已受理但尚未生效，请重新读取核对状态确认。')
        }
        query.reload()
        await refresh()
        return receipt.status === 'APPLIED'
      } catch (cause) {
        // 幂等重放可能返回旧的已应用记录：结果未知时不能宣布「已核对」。
        const definite =
          cause instanceof StationHandlingError &&
          cause.status !== undefined &&
          cause.status >= 400 &&
          cause.status < 500 &&
          cause.status !== 408
        setSubmitError(
          definite
            ? (cause as Error).message
            : '提交结果尚未确认，请重新读取核对状态后再决定是否重试。',
        )
        query.reload()
        await refresh()
        return false
      } finally {
        inFlight.current = false
        setPending(false)
      }
    },
    [backend, jobUuid, query, refresh],
  )

  return {
    context: query.data,
    loading: query.loading,
    readError: query.error,
    pending,
    submitError,
    review,
    reload: query.reload,
  }
}
