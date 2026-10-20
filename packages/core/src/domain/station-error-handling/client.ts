import { TransportError, type RequestTransport } from '../../transport/request'
import { decodeDeviceActions, decodeOccupancies, decodeStationSnapshot } from './codec'
import type {
  StationError,
  StationErrorAction,
  StationHandlingIntent,
  StationHandlingSession,
  StationHandlingSnapshot,
  StationDeviceAction,
  StationManualAction,
  StationOccupancy,
} from './model'
import type { StationErrorHandlingPort } from './port'

const ERROR_MESSAGES: Record<string, string> = {
  station_version_conflict: '工站状态已变化，请核对刷新后的错误与现场状态，再次选择。',
  decision_conflict: '这条错误已被处理或状态已变化，请按最新状态操作。',
  session_version_conflict: '人工处置会话已变化，请核对最新会话。',
  active_session_conflict: '请先完成当前人工处置会话，再处理其他错误。',
  operator_confirmation_required: '请重新核对现场，并勾选本次操作的确认项。',
  manual_actions_running: '本次人工处置仍有手动动作未结束，请等待动作结束后继续。',
  manual_actions_unresolved: '本次人工处置仍有动作结果待核对，请完成现场核对后继续。',
  occupancy_version_conflict: '逻辑占用已变化，请刷新后重新选择。',
  action_definition_changed: '设备动作定义已更新，请重新选择动作后再下发。',
  manual_review_version_conflict: '动作的核对证据已更新，请刷新后重新核对。',
  manual_action_not_finished: '该手动动作尚未结束；结果未知时请先按“已取消”收尾，再登记核对结论。',
}

/** 结果不明确（未到达服务端或服务端异常）时为 true：必须用同一幂等键重发。 */
export function isAmbiguousHandlingError(error: unknown): boolean {
  if (!(error instanceof TransportError)) return true
  const status = error.status ?? 0
  return status === 0 || status === 408 || status >= 500
}

export function handlingErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '错误处置请求失败'
  return ERROR_MESSAGES[message] ?? message
}

export class StationErrorHandlingClient implements StationErrorHandlingPort {
  constructor(
    private readonly transport: RequestTransport,
    private readonly stationId = 'local',
    private readonly apiPrefix = '/api/v1',
    private readonly newKey: () => string = () =>
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
  ) {}

  private get root() {
    return `${this.apiPrefix}/stations/${encodeURIComponent(this.stationId)}`
  }

  async getSnapshot(): Promise<StationHandlingSnapshot> {
    const response = await this.transport.request<unknown>({
      method: 'GET',
      url: `${this.root}/error-handling`,
    })
    return decodeStationSnapshot(unwrap(response.data))
  }

  decisionIntent(
    snapshot: StationHandlingSnapshot,
    error: StationError,
    action: StationErrorAction,
    { resume, reason }: { readonly resume: boolean; readonly reason: string },
  ): StationHandlingIntent {
    const session = snapshot.activeSession
    const resumeNow = action !== 'enter_manual_handling' && resume
    return {
      path: `/errors/${encodeURIComponent(error.decisionId)}/decision`,
      label:
        action === 'cancel_task'
          ? '取消当前任务'
          : action === 'retry_current_node'
            ? '重新执行该动作'
            : '进入手动处理',
      idempotencyKey: this.newKey(),
      body: {
        expected_station_version: snapshot.stationVersion,
        action,
        expected_decision_version: error.decisionVersion,
        observed_error_epoch: snapshot.errorEpoch,
        resume_requested: resumeNow,
        operator_confirmed: resumeNow,
        ...(resumeNow ? { confirm_snapshot_id: snapshot.snapshotId } : {}),
        ...(session?.decisionId === error.decisionId
          ? { session_id: session.sessionId, expected_session_version: session.version }
          : {}),
        reason: reason.trim(),
      },
    }
  }

  completeSessionIntent(
    snapshot: StationHandlingSnapshot,
    session: StationHandlingSession,
    summary: string,
  ): StationHandlingIntent {
    return {
      path: `/sessions/${encodeURIComponent(session.sessionId)}/complete`,
      label: '完成手动处理',
      idempotencyKey: this.newKey(),
      body: {
        expected_station_version: snapshot.stationVersion,
        expected_session_version: session.version,
        summary: summary.trim(),
      },
    }
  }

  returnToSessionIntent(
    snapshot: StationHandlingSnapshot,
    session: StationHandlingSession,
  ): StationHandlingIntent {
    return {
      path: `/sessions/${encodeURIComponent(session.sessionId)}/return`,
      label: '返回手动处理',
      idempotencyKey: this.newKey(),
      body: {
        expected_station_version: snapshot.stationVersion,
        expected_session_version: session.version,
      },
    }
  }

  resumeIntent(snapshot: StationHandlingSnapshot): StationHandlingIntent {
    return {
      path: '/resume',
      label: '恢复工站调度',
      idempotencyKey: this.newKey(),
      body: {
        expected_station_version: snapshot.stationVersion,
        observed_error_epoch: snapshot.errorEpoch,
        operator_confirmed: true,
        confirm_snapshot_id: snapshot.snapshotId,
      },
    }
  }

  applyCommandIntent(commandUuid: string): StationHandlingIntent {
    return {
      path: `/control-commands/${encodeURIComponent(commandUuid)}/apply`,
      label: '继续应用原操作',
      idempotencyKey: this.newKey(),
      body: {},
    }
  }

  async listOccupancies(): Promise<readonly StationOccupancy[]> {
    const response = await this.transport.request<unknown>({
      method: 'GET',
      url: `${this.root}/resource-dispositions`,
    })
    return decodeOccupancies(unwrap(response.data))
  }

  releaseOccupanciesIntent(
    snapshot: StationHandlingSnapshot,
    error: StationError,
    occupancies: readonly StationOccupancy[],
    reason: string,
  ): StationHandlingIntent {
    const session =
      snapshot.activeSession?.decisionId === error.decisionId &&
      snapshot.activeSession.stage === 'MANUAL_HANDLING'
        ? snapshot.activeSession
        : null
    return {
      path: '/resource-dispositions',
      label: '释放逻辑占用',
      idempotencyKey: this.newKey(),
      body: {
        expected_station_version: snapshot.stationVersion,
        decision_id: error.decisionId,
        ...(session
          ? { session_id: session.sessionId, expected_session_version: session.version }
          : {}),
        occupancy_ids: occupancies.map((item) => item.uuid),
        expected_versions: Object.fromEntries(occupancies.map((item) => [item.uuid, item.version])),
        operation: 'release',
        reason: reason.trim(),
      },
    }
  }

  async listDeviceActions(
    sessionId: string,
    deviceUuid: string,
  ): Promise<readonly StationDeviceAction[]> {
    const response = await this.transport.request<unknown>({
      method: 'GET',
      url: `${this.root}/sessions/${encodeURIComponent(sessionId)}/devices/${encodeURIComponent(deviceUuid)}/actions`,
    })
    return decodeDeviceActions(unwrap(response.data))
  }

  manualActionIntent(
    snapshot: StationHandlingSnapshot,
    session: StationHandlingSession,
    deviceUuid: string,
    action: StationDeviceAction,
    parameters: Readonly<Record<string, unknown>>,
  ): StationHandlingIntent {
    return {
      path: `/sessions/${encodeURIComponent(session.sessionId)}/manual-actions`,
      label: `手动动作 ${action.displayName}`,
      idempotencyKey: this.newKey(),
      body: {
        expected_station_version: snapshot.stationVersion,
        expected_session_version: session.version,
        device_id: deviceUuid,
        action_id: action.actionId,
        action_version: action.actionVersion,
        parameters,
      },
    }
  }

  reviewManualActionIntent(
    snapshot: StationHandlingSnapshot,
    session: StationHandlingSession,
    action: StationManualAction,
    reason: string,
  ): StationHandlingIntent {
    if (!action.commandId || !action.reviewVersion)
      throw new Error('该手动动作缺少核对所需的命令号或证据版本')
    return {
      path: `/manual-actions/${encodeURIComponent(action.commandId)}/review`,
      label: '核对手动动作结果',
      idempotencyKey: this.newKey(),
      body: {
        expected_station_version: snapshot.stationVersion,
        expected_session_version: session.version,
        session_id: session.sessionId,
        expected_review_version: action.reviewVersion,
        reason: reason.trim(),
        operator_confirmed: true,
      },
    }
  }

  async submit(intent: StationHandlingIntent): Promise<Readonly<Record<string, unknown>>> {
    const response = await this.transport.request<unknown>({
      method: 'POST',
      url: `${this.root}${intent.path}`,
      headers: { 'Idempotency-Key': intent.idempotencyKey },
      body: intent.body,
    })
    const data = unwrap(response.data)
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  }
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) {
    return (value as { data: unknown }).data
  }
  return value
}
