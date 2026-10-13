import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBackend } from '../../app/BackendProvider'
import { useStationHandling } from './StationHandlingProvider'
import { StationHandlingError } from '@unilab-fe/core'
import type {
  StationCommandReceipt,
  StationHandlingSession,
  StationInventoryChange,
  StationInventoryCorrectionRequest,
  StationManualActionRequest,
  StationOccupancyReleaseRequest,
} from '@unilab-fe/core'
import {
  loadManualDraft,
  saveManualDraft,
  manualDraftKey,
  type ManualHandlingDraft,
} from './manualHandlingDraft'
import {
  manualHandlingBlockers,
  needsInventoryRiskAck,
  projectManualOperations,
  type ManualOperationEntry,
  type ManualOperationKind,
} from './manualHandlingModel'

/**
 * 人工处理的提交意图。
 *
 * 注意这里**没有**「先把几种操作攒起来再一起提交」这种东西：设备动作一旦执行就
 * 作用于真实设备，物料位置和占用释放也是立即生效的命令。界面能做的是「操作即时提交、
 * 每条都留下结果」，而弹窗底部的「提交」是**结束这次会话**（OS 的 complete），
 * 不是「把攒着的操作发出去」。
 */
export type ManualOperationIntent =
  | {
      readonly kind: 'device'
      readonly label: string
      readonly deviceId: string
      readonly actionId: string
      readonly actionVersion: string
      readonly parameters: Readonly<Record<string, unknown>>
    }
  | {
      readonly kind: 'material'
      readonly label: string
      readonly changes: readonly StationInventoryChange[]
      readonly expectedVersions: Readonly<Record<string, string | number>>
      readonly reason: string
      readonly relatedManualCommandId?: string
    }
  | {
      readonly kind: 'occupancy'
      readonly label: string
      readonly occupancyIds: readonly string[]
      readonly expectedVersions: Readonly<Record<string, string>>
      readonly reason: string
    }

interface PendingIntent {
  readonly intent: ManualOperationIntent
  readonly idempotencyKey: string
}

export interface ManualHandlingController {
  readonly entries: readonly ManualOperationEntry[]
  readonly views: ReturnType<typeof projectManualOperations>
  readonly note: string
  readonly setNote: (value: string) => void
  readonly draft: ManualHandlingDraft
  readonly updateDraft: (patch: Partial<ManualHandlingDraft>) => void
  readonly blockers: ReturnType<typeof manualHandlingBlockers>
  readonly riskAckRequired: boolean
  readonly riskAck: boolean
  readonly setRiskAck: (value: boolean) => void
  readonly canSubmit: boolean
  readonly pending: boolean
  readonly submitError: string | undefined
  /** 上次提交结果未知时的原始意图；界面必须允许用同一个幂等键重试。 */
  readonly unconfirmed: ManualOperationIntent | undefined
  readonly submitOperation: (intent: ManualOperationIntent) => Promise<boolean>
  readonly retryUnconfirmed: () => Promise<boolean>
  readonly completeSession: () => Promise<boolean>
  readonly resetRiskAck: () => void
}

/** 4xx（408 除外）是 OS 的确定拒绝；其余情况结果未知，必须保留同一个幂等键。 */
function isDefiniteRejection(cause: unknown): boolean {
  return cause instanceof StationHandlingError && cause.status !== undefined
    ? cause.status >= 400 && cause.status < 500 && cause.status !== 408
    : false
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

const KIND_LABEL: Readonly<Record<ManualOperationKind, string>> = {
  device: '设备动作',
  material: '物料位置',
  occupancy: '释放占用',
}

export const MANUAL_OPERATION_KIND_LABEL = KIND_LABEL

/**
 * 人工处理弹窗的控制器。
 *
 * 调用方必须按 `session.sessionId` 给组件加 `key`：草稿和会话是一一对应的，
 * 换了会话（另一条错误）不能把上一个会话的输入或操作记录带过来。
 */
export function useManualHandling(session: StationHandlingSession): ManualHandlingController {
  const { backend } = useBackend()
  const { snapshot, refresh } = useStationHandling()
  const draftKey = useMemo(
    () => manualDraftKey(backend.config.apiUrl, backend.config.stationId, session.sessionId),
    [backend.config.apiUrl, backend.config.stationId, session.sessionId],
  )
  const [draft, setDraft] = useState<ManualHandlingDraft>(() => loadManualDraft(draftKey))
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null)
  const [pending, setPending] = useState(false)
  const [submitError, setSubmitError] = useState<string | undefined>(undefined)
  const [riskAck, setRiskAck] = useState(false)
  const inFlight = useRef(false)

  useEffect(() => {
    saveManualDraft(draftKey, draft)
  }, [draftKey, draft])

  const updateDraft = useCallback((patch: Partial<ManualHandlingDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    // 任何输入变化都让「承担风险」失效：确认必须针对当前这份内容。
    setRiskAck(false)
  }, [])

  const views = useMemo(
    () => projectManualOperations(snapshot, draft.entries, session.sessionId),
    [snapshot, draft.entries, session.sessionId],
  )
  const blockers = useMemo(
    () => manualHandlingBlockers(snapshot, session.sessionId),
    [snapshot, session.sessionId],
  )
  const riskAckRequired = needsInventoryRiskAck(views)
  const canSubmit =
    !blockers.blocked && draft.note.trim().length > 0 && (!riskAckRequired || riskAck)

  const run = useCallback(
    async (intent: ManualOperationIntent, idempotencyKey: string): Promise<boolean> => {
      const station = snapshot
      const sessionVersion = snapshot?.activeSession?.version ?? session.version
      if (!station || station.activeSessionId !== session.sessionId) {
        setSubmitError('这个人工处置会话已经不在当前活动会话中，请重新读取工站状态。')
        return false
      }
      try {
        let receipt: StationCommandReceipt
        if (intent.kind === 'device') {
          const request: StationManualActionRequest = {
            deviceId: intent.deviceId,
            actionId: intent.actionId,
            actionVersion: intent.actionVersion,
            parameters: intent.parameters,
            expectedStationVersion: station.stationVersion,
            expectedSessionVersion: sessionVersion,
          }
          receipt = await backend.core.stationErrorHandling.executeManualAction(
            session.sessionId,
            request,
            { idempotencyKey },
          )
        } else if (intent.kind === 'material') {
          const request: StationInventoryCorrectionRequest = {
            changes: intent.changes,
            expectedInventoryVersions: intent.expectedVersions,
            reason: intent.reason,
            ...(intent.relatedManualCommandId
              ? { relatedManualCommandId: intent.relatedManualCommandId }
              : {}),
            expectedStationVersion: station.stationVersion,
            expectedSessionVersion: sessionVersion,
          }
          receipt = await backend.core.stationErrorHandling.correctInventory(
            session.sessionId,
            request,
            { idempotencyKey },
          )
        } else {
          const request: StationOccupancyReleaseRequest = {
            decisionId: session.decisionId,
            sessionId: session.sessionId,
            occupancyIds: intent.occupancyIds,
            expectedVersions: intent.expectedVersions,
            reason: intent.reason,
            expectedStationVersion: station.stationVersion,
            expectedSessionVersion: sessionVersion,
          }
          receipt = await backend.core.stationErrorHandling.releaseOccupancies(request, {
            idempotencyKey,
          })
        }

        if (receipt.status === 'FAILED' || receipt.applicationError || receipt.dispatchError) {
          const reason =
            receipt.applicationError ??
            receipt.dispatchError ??
            'OS 把这条操作标记为失败，请查看工站状态后重试。'
          setSubmitError(`「${intent.label}」没有生效：${reason}`)
          setPendingIntent(null)
          await refresh()
          return false
        }
        if (receipt.status !== 'APPLIED') {
          // 202 只代表受理：命令还没生效，保留同一个幂等键等待确认。
          setSubmitError(
            `「${intent.label}」已受理但尚未生效，可以继续确认；生效与否以工站最新状态为准。`,
          )
          setPendingIntent({ intent, idempotencyKey })
          await refresh()
          return false
        }

        setDraft((current) => ({
          ...current,
          entries: [
            ...current.entries,
            {
              id: `${intent.kind}-${receipt.commandUuid}`,
              kind: intent.kind,
              label: intent.label,
              commandUuid: receipt.commandUuid,
              // OS 把设备动作的 manual_command_id 就设成命令自己的 uuid
              // （`error_control.py:344`），所以回执的 commandUuid 就是关联依据。
              manualCommandId: intent.kind === 'device' ? receipt.commandUuid : null,
              createdAt: new Date().toISOString(),
            },
          ],
        }))
        setSubmitError(undefined)
        setPendingIntent(null)
        // 回执不等于生效：重新读快照，让列表显示 OS 的真实状态。
        await refresh()
        return true
      } catch (cause) {
        if (isDefiniteRejection(cause)) {
          setSubmitError(messageOf(cause, `「${intent.label}」被拒绝。`))
          setPendingIntent(null)
          await refresh()
          return false
        }
        setSubmitError(
          `「${intent.label}」的提交结果尚未确认。请用「按原请求重试」继续确认，避免重复执行。`,
        )
        setPendingIntent({ intent, idempotencyKey })
        await refresh()
        return false
      }
    },
    [backend, refresh, session, snapshot],
  )

  const submitOperation = useCallback(
    async (intent: ManualOperationIntent): Promise<boolean> => {
      if (inFlight.current) return false
      inFlight.current = true
      setPending(true)
      setSubmitError(undefined)
      try {
        return await run(intent, crypto.randomUUID())
      } finally {
        inFlight.current = false
        setPending(false)
      }
    },
    [run],
  )

  const retryUnconfirmed = useCallback(async (): Promise<boolean> => {
    if (!pendingIntent || inFlight.current) return false
    inFlight.current = true
    setPending(true)
    try {
      return await run(pendingIntent.intent, pendingIntent.idempotencyKey)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }, [pendingIntent, run])

  const completeSession = useCallback(async (): Promise<boolean> => {
    if (!canSubmit || inFlight.current) return false
    inFlight.current = true
    setPending(true)
    setSubmitError(undefined)
    try {
      const summary = riskAckRequired
        ? `${draft.note.trim()}\n（操作员确认：系统的物料位置可能与现场不一致）`
        : draft.note.trim()
      const receipt = await backend.core.stationErrorHandling.completeSession(
        session.sessionId,
        {
          expectedStationVersion: snapshot?.stationVersion ?? 0,
          expectedSessionVersion: snapshot?.activeSession?.version ?? session.version,
          summary,
        },
        { idempotencyKey: crypto.randomUUID() },
      )
      if (receipt.status !== 'APPLIED') {
        setSubmitError('提交已受理但尚未生效，请稍后重新读取工站状态确认。')
        await refresh()
        return false
      }
      setSubmitError(undefined)
      await refresh()
      return true
    } catch (cause) {
      setSubmitError(
        isDefiniteRejection(cause)
          ? messageOf(cause, '提交被拒绝。')
          : '提交结果尚未确认，请重新读取工站状态后再决定是否重试。',
      )
      await refresh()
      return false
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }, [backend, canSubmit, draft.note, refresh, riskAckRequired, session, snapshot])

  return {
    entries: draft.entries,
    views,
    note: draft.note,
    setNote: (value: string) => updateDraft({ note: value }),
    draft,
    updateDraft,
    blockers,
    riskAckRequired,
    riskAck,
    setRiskAck,
    canSubmit,
    pending,
    submitError,
    unconfirmed: pendingIntent?.intent,
    submitOperation,
    retryUnconfirmed,
    completeSession,
    resetRiskAck: () => setRiskAck(false),
  }
}
