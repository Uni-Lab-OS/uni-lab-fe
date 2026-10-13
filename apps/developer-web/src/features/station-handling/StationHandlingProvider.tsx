import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { StationHandlingError } from '@unilab-fe/core'
import type {
  StationCommandReceipt,
  StationDecisionAction,
  StationDecisionRequest,
  StationErrorFact,
  StationHandlingSnapshot,
  StationResumeRequest,
} from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'

/** 工站状态失效由 SSE 通知驱动；断线时用低频兜底轮询，不作为主通道。 */
const STATION_FALLBACK_POLL_MS = 15_000

export interface StationDecisionInput {
  readonly error: StationErrorFact
  readonly action: StationDecisionAction
  readonly reason?: string
  /** 是否顺带恢复工站调度；为真时必须同时 operatorConfirmed。 */
  readonly resumeRequested: boolean
  readonly operatorConfirmed: boolean
}

type PendingIntent =
  | {
      readonly kind: 'decision'
      readonly label: string
      readonly decisionId: string
      readonly request: StationDecisionRequest
      readonly idempotencyKey: string
    }
  | {
      readonly kind: 'resume'
      readonly label: string
      readonly request: StationResumeRequest
      readonly idempotencyKey: string
    }

interface StationHandlingContextValue {
  readonly snapshot: StationHandlingSnapshot | undefined
  readonly loading: boolean
  readonly readError: Error | undefined
  readonly pending: boolean
  readonly submitError: string | undefined
  /** 上一次提交结果未知时的原始意图；界面必须给出「按原请求重试」。 */
  readonly unconfirmed: { readonly label: string } | undefined
  refresh: () => Promise<void>
  decide: (input: StationDecisionInput) => Promise<boolean>
  resume: (input: { operatorConfirmed: boolean }) => Promise<boolean>
  /** 继续应用一条已受理未生效的控制命令；生效与否仍以重新读取的快照为准。 */
  applyCommand: (commandUuid: string) => Promise<boolean>
  /**
   * 进入人工处置（OS 动作 `enter_manual_handling`）：把节点交给现场处理，
   * 工站保持暂停；完成会话后这条错误重新回到「等待处置决定」。
   */
  enterManualHandling: (input: { error: StationErrorFact; reason?: string }) => Promise<boolean>
  completeSession: (sessionId: string, summary: string) => Promise<boolean>
  /** 返回同一会话继续手动处理；会话建立后再次动手只能走这条路。 */
  returnSession: (sessionId: string) => Promise<boolean>
  retryUnconfirmed: () => Promise<boolean>
}

const StationHandlingContext = createContext<StationHandlingContextValue | null>(null)

/** 幂等键必须与端点绑定：切换 Profile 或地址后不能复用上一个端点的未确认意图。 */
function intentStorageKey(apiUrl: string, stationId: string): string {
  return `unilab:station-intent:${apiUrl}:${stationId}`
}

/**
 * 幂等键必须与端点绑定：切换 Profile 或地址后不能复用上一个端点的未确认意图。
 * `prefix`/`scope` 只用于让键可读（例如完成某个会话版本），不影响幂等语义。
 */
function newIdempotencyKey(prefix?: string, scope?: string): string {
  const random = randomId()
  return prefix ? `${prefix}:${scope ?? ''}:${random}` : random
}

function randomId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `station-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * 4xx（408 除外）说明服务端明确拒绝了这次请求，可以安全地丢弃意图；
 * 网络中断、超时、5xx 则结果未知，必须保留同一个幂等键等待确认。
 */
function isDeterminate(cause: unknown): boolean {
  if (!(cause instanceof StationHandlingError)) return false
  const status = cause.status
  return status !== undefined && status >= 400 && status < 500 && status !== 408
}

export function StationHandlingProvider({ children }: { children: ReactNode }) {
  const { backend, runtimeRevision, connection } = useBackend()
  const port = backend.core.stationErrorHandling
  const storageKey = intentStorageKey(backend.config.apiUrl, backend.config.stationId)

  const [snapshot, setSnapshot] = useState<StationHandlingSnapshot>()
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState<Error>()
  const [pending, setPending] = useState(false)
  const [submitError, setSubmitError] = useState<string>()
  const [unconfirmed, setUnconfirmed] = useState<PendingIntent | undefined>(() =>
    readIntent(storageKey),
  )

  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    try {
      const next = await port.getSnapshot()
      setSnapshot(next)
      setReadError(undefined)
    } catch (cause) {
      // 读失败必须清掉快照：留着旧快照会让用户按过期版本号提交。
      setSnapshot(undefined)
      setReadError(cause instanceof Error ? cause : new Error('工站处置状态读取失败'))
    } finally {
      setLoading(false)
    }
  }, [port])

  useEffect(() => {
    void load()
  }, [load, runtimeRevision])

  useEffect(() => {
    if (snapshot?.mode !== 'PAUSED') return
    // 失效通知是主通道：OS 每次工站状态变化都会发 station.error_handling.changed，
    // 共享适配器把它并入 runtimeRevision，本 provider 随之重读快照。
    // 只有在实时连接不可用时才退化为低频兜底轮询，避免界面永久停在旧状态。
    if (connection === 'connected') return
    const timer = setInterval(() => void load(), STATION_FALLBACK_POLL_MS)
    return () => clearInterval(timer)
  }, [connection, snapshot?.mode, load])

  const run = useCallback(
    async (intent: PendingIntent): Promise<boolean> => {
      if (inFlight.current) return false
      inFlight.current = true
      setPending(true)
      setSubmitError(undefined)
      setUnconfirmed(intent)
      writeIntent(storageKey, intent)
      try {
        const receipt =
          intent.kind === 'decision'
            ? await port.decide(intent.decisionId, intent.request, {
                idempotencyKey: intent.idempotencyKey,
              })
            : await port.resume(intent.request, { idempotencyKey: intent.idempotencyKey })
        // 202 只代表已受理：真正的结论只来自重新读取的快照。
        await load()
        setUnconfirmed(undefined)
        clearIntent(storageKey)
        const problem = commandProblem(receipt)
        if (problem) {
          setSubmitError(problem)
          return false
        }
        return true
      } catch (cause) {
        await load()
        if (isDeterminate(cause)) {
          setUnconfirmed(undefined)
          clearIntent(storageKey)
          setSubmitError(cause instanceof Error ? cause.message : '处置请求被拒绝')
          return false
        }
        setSubmitError(
          '提交结果尚未确认。可以「按原请求重试」—— 会用同一个幂等键重发，不会产生第二条操作。',
        )
        return false
      } finally {
        inFlight.current = false
        setPending(false)
      }
    },
    [load, port, storageKey],
  )

  const decide = useCallback(
    async (input: StationDecisionInput): Promise<boolean> => {
      const current = snapshotRef.current
      if (!current) {
        setSubmitError('还没有读到工站处置状态，请先重新读取。')
        return false
      }
      if (input.resumeRequested && !input.operatorConfirmed) {
        setSubmitError('要同时恢复调度，需要先勾选「我已核对现场」。')
        return false
      }
      const session = current.activeSession
      // 会话身份以错误事实为准：OS 校验 `workflow_intervention.session_id`，
      // 而工站的 active_session 可能在会话收尾窗口里已被清空。
      const sessionId = input.error.sessionId ?? session?.sessionId ?? null
      const sameSession =
        session && sessionId !== null && session.sessionId === sessionId ? session : undefined
      const reason = input.reason?.trim()
      return run({
        kind: 'decision',
        decisionId: input.error.decisionId,
        label: '节点错误处置决定',
        idempotencyKey: newIdempotencyKey(),
        request: {
          action: input.action,
          expectedStationVersion: current.stationVersion,
          expectedDecisionVersion: input.error.decisionVersion,
          observedErrorEpoch: current.errorEpoch,
          resumeRequested: input.resumeRequested,
          operatorConfirmed: input.operatorConfirmed,
          ...(input.resumeRequested ? { confirmSnapshotId: current.snapshotId } : {}),
          ...(sameSession
            ? {
                sessionId: sameSession.sessionId,
                expectedSessionVersion: sameSession.version,
              }
            : {}),
          ...(reason ? { reason } : {}),
        },
      })
    },
    [run],
  )

  /**
   * 进入人工处置：不改 resume 请求（现场还没处理完），也不要求现场确认勾选，
   * 因为这一步只是把节点交给现场，工站保持暂停。
   */
  const enterManualHandling = useCallback(
    async (input: { error: StationErrorFact; reason?: string }): Promise<boolean> =>
      decide({
        error: input.error,
        action: 'enter_manual_handling',
        reason: input.reason,
        resumeRequested: false,
        operatorConfirmed: false,
      }),
    [decide],
  )

  const resume = useCallback(
    async (input: { operatorConfirmed: boolean }): Promise<boolean> => {
      const current = snapshotRef.current
      if (!current) {
        setSubmitError('还没有读到工站处置状态，请先重新读取。')
        return false
      }
      if (!input.operatorConfirmed) {
        setSubmitError('恢复调度前需要先勾选「我已核对现场」。')
        return false
      }
      return run({
        kind: 'resume',
        label: '恢复工站调度',
        idempotencyKey: newIdempotencyKey(),
        request: {
          expectedStationVersion: current.stationVersion,
          observedErrorEpoch: current.errorEpoch,
          operatorConfirmed: true,
          confirmSnapshotId: current.snapshotId,
        },
      })
    },
    [run],
  )

  const retryUnconfirmed = useCallback(async (): Promise<boolean> => {
    const intent = unconfirmed ?? readIntent(storageKey)
    if (!intent) return false
    return run(intent)
  }, [run, storageKey, unconfirmed])

  const applyCommand = useCallback(
    async (commandUuid: string): Promise<boolean> => {
      if (!snapshotRef.current) {
        setSubmitError('还没有读到工站处置状态，请先重新读取。')
        return false
      }
      if (inFlight.current) return false
      inFlight.current = true
      setPending(true)
      setSubmitError(undefined)
      try {
        const receipt = await port.applyControlCommand(commandUuid)
        // 202 只代表受理：必须重新读取快照确认这条命令是否真的生效。
        await load()
        const problem = commandProblem(receipt)
        if (problem) {
          setSubmitError(problem)
          return false
        }
        return true
      } catch (cause) {
        await load()
        setSubmitError(
          cause instanceof Error ? cause.message : '「继续应用」请求失败，请重新读取工站状态。',
        )
        return false
      } finally {
        inFlight.current = false
        setPending(false)
      }
    },
    [load, port],
  )

  /**
   * 完成人工处置会话，把错误事实交回「等待处置决定」。
   *
   * 会话版本取刚读到的快照：期间别人做了手动动作时，OS 会拒绝这次完成，
   * 界面必须如实报错并重新读取，而不是假装已经回到决定阶段。
   */
  const completeSession = useCallback(
    async (sessionId: string, summary: string): Promise<boolean> => {
      const current = snapshotRef.current
      const session = current?.activeSession
      if (!current || !session || session.sessionId !== sessionId) {
        setSubmitError('没有读到这条人工处置会话，请先重新读取工站处置状态。')
        await load()
        return false
      }
      if (inFlight.current) return false
      inFlight.current = true
      setPending(true)
      setSubmitError(undefined)
      try {
        const receipt = await port.completeSession(
          sessionId,
          {
            expectedStationVersion: current.stationVersion,
            expectedSessionVersion: session.version,
            summary,
          },
          {
            idempotencyKey: newIdempotencyKey(
              'complete-session',
              `${sessionId}:${session.version}`,
            ),
          },
        )
        await load()
        const problem = commandProblem(receipt)
        if (problem) {
          setSubmitError(problem)
          return false
        }
        return true
      } catch (cause) {
        await load()
        setSubmitError(
          cause instanceof Error ? cause.message : '「完成手动处理」请求失败，请重新读取工站状态。',
        )
        return false
      } finally {
        inFlight.current = false
        setPending(false)
      }
    },
    [load, port],
  )

  /**
   * 返回同一会话继续手动处理。会话建立后不会再被「完成」消掉，
   * 所以再次动手必须走 return，不能重新 enter（OS 会回 active_session_conflict）。
   */
  const returnSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const current = snapshotRef.current
      const session = current?.activeSession
      if (!current || !session || session.sessionId !== sessionId) {
        setSubmitError('没有读到这条人工处置会话，请先重新读取工站处置状态。')
        await load()
        return false
      }
      if (inFlight.current) return false
      inFlight.current = true
      setPending(true)
      setSubmitError(undefined)
      try {
        const receipt = await port.returnSession(
          sessionId,
          {
            expectedStationVersion: current.stationVersion,
            expectedSessionVersion: session.version,
          },
          {
            idempotencyKey: newIdempotencyKey('return-session', `${sessionId}:${session.version}`),
          },
        )
        await load()
        const problem = commandProblem(receipt)
        if (problem) {
          setSubmitError(problem)
          return false
        }
        return true
      } catch (cause) {
        await load()
        setSubmitError(
          cause instanceof Error ? cause.message : '「返回手动处理」请求失败，请重新读取工站状态。',
        )
        return false
      } finally {
        inFlight.current = false
        setPending(false)
      }
    },
    [load, port],
  )

  const value = useMemo<StationHandlingContextValue>(
    () => ({
      snapshot,
      loading,
      readError,
      pending,
      submitError,
      unconfirmed: unconfirmed ? { label: unconfirmed.label } : undefined,
      refresh: load,
      decide,
      resume,
      enterManualHandling,
      applyCommand,
      completeSession,
      returnSession,
      retryUnconfirmed,
    }),
    [
      snapshot,
      loading,
      readError,
      pending,
      submitError,
      unconfirmed,
      load,
      decide,
      resume,
      enterManualHandling,
      applyCommand,
      completeSession,
      returnSession,
      retryUnconfirmed,
    ],
  )

  return <StationHandlingContext.Provider value={value}>{children}</StationHandlingContext.Provider>
}

export function useStationHandling(): StationHandlingContextValue {
  const context = useContext(StationHandlingContext)
  if (!context) throw new Error('useStationHandling 必须在 StationHandlingProvider 内使用')
  return context
}

/**
 * 命令被受理不等于生效：application_error / dispatch_error / FAILED 都要如实说明，
 * 不能折叠成「成功」。
 */
function commandProblem(receipt: StationCommandReceipt): string | undefined {
  if (receipt.status === 'FAILED') {
    return '本次操作未被应用，工站状态没有改变。请核对最新状态后重新选择。'
  }
  const detail = receipt.applicationError ?? receipt.dispatchError
  if (receipt.status === 'PENDING' || detail) {
    return `操作已受理，但仍待应用。${detail ?? ''}`.trim()
  }
  return undefined
}

function readIntent(key: string): PendingIntent | undefined {
  try {
    const raw = JSON.parse(sessionStorage.getItem(key) ?? 'null') as PendingIntent | null
    if (!raw || typeof raw.idempotencyKey !== 'string' || typeof raw.request !== 'object') {
      return undefined
    }
    if (raw.kind === 'decision' && typeof raw.decisionId !== 'string') return undefined
    if (raw.kind !== 'decision' && raw.kind !== 'resume') return undefined
    return raw
  } catch {
    return undefined
  }
}

function writeIntent(key: string, intent: PendingIntent): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(intent))
  } catch {
    // 会话存储不可用时仍允许本次提交，只是失去跨刷新的同键重试能力。
  }
}

function clearIntent(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // 忽略：清理失败不影响本次结果。
  }
}
