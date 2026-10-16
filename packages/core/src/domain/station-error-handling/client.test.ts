import { describe, expect, it } from 'vitest'
import {
  TransportError,
  type RequestTransport,
  type TransportRequest,
  type TransportResponse,
} from '../../transport/request'
import { decodeStationSnapshot } from './codec'
import {
  StationErrorHandlingClient,
  handlingErrorMessage,
  isAmbiguousHandlingError,
} from './client'

/** 与 10-16 本机仿真中 OS 实际返回的工站快照同形（刮取复核前预览失败）。 */
const SNAPSHOT = {
  station_id: 'local',
  mode: 'PAUSED',
  error_epoch: 1,
  active_session_id: null,
  station_version: 2,
  snapshot_id: 'local:2:1',
  active_session: null,
  manual_actions: [],
  control_commands: [],
  errors: [
    {
      uuid: 'd10cdc01',
      decision_id: 'd10cdc01',
      decision_version: 1,
      revision: 1,
      workflow_task_uuid: 'task-1',
      workflow_node_job_uuid: 'job-1',
      source_task_uuid: 'task-1',
      source_job_uuid: 'job-1',
      stage: 'DECISION_REQUIRED',
      status: 'open',
      opened_at: '2026-10-16T15:33:54Z',
      options: [
        { id: 'cancel_task', label: '取消当前任务' },
        { id: 'retry_current_node', label: '重试当前节点' },
        { id: 'enter_manual_handling', label: '进入手动处理' },
      ],
      meta_data: {
        message:
          "[{'code': 'ptlc_action_rejected', 'message': \"photoscrape.candidate_status: 'after.jpg' is not in the subpath\", 'device': 'imaging'}]",
        source_node_id: 'node-1',
      },
    },
  ],
}

describe('station error handling', () => {
  it('decodes the OS snapshot and extracts a readable device message', () => {
    const snapshot = decodeStationSnapshot(SNAPSHOT)
    expect(snapshot).toMatchObject({ mode: 'PAUSED', stationVersion: 2, errorEpoch: 1 })
    expect(snapshot.errors[0]).toMatchObject({
      decisionId: 'd10cdc01',
      stage: 'DECISION_REQUIRED',
      sourceNodeId: 'node-1',
      message: "photoscrape.candidate_status: 'after.jpg' is not in the subpath",
    })
    expect(snapshot.errors[0]!.options.map((option) => option.id)).toEqual([
      'cancel_task',
      'retry_current_node',
      'enter_manual_handling',
    ])
  })

  it('builds versioned decisions and only resumes with explicit operator confirmation', () => {
    const client = new StationErrorHandlingClient(
      {} as RequestTransport,
      'local',
      '/api/v1',
      () => 'key-1',
    )
    const snapshot = decodeStationSnapshot(SNAPSHOT)
    const error = snapshot.errors[0]!
    expect(
      client.decisionIntent(snapshot, error, 'retry_current_node', {
        resume: false,
        reason: ' 核对 ',
      }),
    ).toEqual({
      path: '/errors/d10cdc01/decision',
      label: '重试当前节点',
      idempotencyKey: 'key-1',
      body: {
        expected_station_version: 2,
        action: 'retry_current_node',
        expected_decision_version: 1,
        observed_error_epoch: 1,
        resume_requested: false,
        operator_confirmed: false,
        reason: '核对',
      },
    })
    const resume = client.decisionIntent(snapshot, error, 'cancel_task', {
      resume: true,
      reason: '',
    })
    expect(resume.body).toMatchObject({
      resume_requested: true,
      operator_confirmed: true,
      confirm_snapshot_id: 'local:2:1',
    })
    // 进入手动处理时不会一并恢复调度。
    expect(
      client.decisionIntent(snapshot, error, 'enter_manual_handling', { resume: true, reason: '' })
        .body,
    ).toMatchObject({
      resume_requested: false,
      operator_confirmed: false,
    })
  })

  it('submits with the idempotency key and separates ambiguous from definitive failures', async () => {
    const requests: TransportRequest[] = []
    const transport: RequestTransport = {
      async request<Value>(input: TransportRequest): Promise<TransportResponse<Value>> {
        requests.push(input)
        return { status: 202, headers: {}, data: { code: 0, data: { status: 'APPLIED' } } as Value }
      },
    }
    const client = new StationErrorHandlingClient(transport, 'local', '/api/v1', () => 'key-2')
    const snapshot = decodeStationSnapshot(SNAPSHOT)
    await client.submit(client.resumeIntent(snapshot))
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/stations/local/resume',
      headers: { 'Idempotency-Key': 'key-2' },
      body: {
        expected_station_version: 2,
        observed_error_epoch: 1,
        operator_confirmed: true,
        confirm_snapshot_id: 'local:2:1',
      },
    })
    expect(isAmbiguousHandlingError(new TransportError({ code: 'network', message: 'x' }))).toBe(
      true,
    )
    expect(
      isAmbiguousHandlingError(new TransportError({ code: 'http', message: 'x', status: 503 })),
    ).toBe(true)
    expect(
      isAmbiguousHandlingError(new TransportError({ code: 'http', message: 'x', status: 409 })),
    ).toBe(false)
    expect(handlingErrorMessage(new Error('station_version_conflict'))).toContain('工站状态已变化')
  })
})

describe('resource release', () => {
  it('releases selected occupancies inside the manual session with their versions', () => {
    const client = new StationErrorHandlingClient(
      {} as RequestTransport,
      'local',
      '/api/v1',
      () => 'key-3',
    )
    const snapshot = decodeStationSnapshot({
      ...SNAPSHOT,
      active_session: {
        session_id: 's1',
        decision_id: 'd10cdc01',
        stage: 'MANUAL_HANDLING',
        version: 4,
        summary: '',
      },
    })
    const lock = {
      uuid: 'lock-1',
      lockKey: '/devices/robot',
      state: 'running',
      occupancyKind: 'execution_lock',
      scope: 'device',
      version: 'v7',
      taskUuid: 'task-1',
      materialUuid: null,
      deviceId: null,
    }
    const error = { ...snapshot.errors[0]!, decisionId: 'd10cdc01' }
    const intent = client.releaseOccupanciesIntent(snapshot, error, [lock], ' 板已人工取下 ')
    expect(intent).toMatchObject({
      path: '/resource-dispositions',
      body: {
        expected_station_version: 2,
        expected_session_version: 4,
        decision_id: 'd10cdc01',
        session_id: 's1',
        occupancy_ids: ['lock-1'],
        expected_versions: { 'lock-1': 'v7' },
        operation: 'release',
        reason: '板已人工取下',
      },
    })
  })
})

describe('resource release before manual handling', () => {
  it('attaches to the pending decision without session fields', () => {
    const client = new StationErrorHandlingClient(
      {} as RequestTransport,
      'local',
      '/api/v1',
      () => 'key-4',
    )
    const snapshot = decodeStationSnapshot(SNAPSHOT)
    const lock = {
      uuid: 'lock-1',
      lockKey: '/devices/robot',
      state: 'running',
      occupancyKind: 'execution_lock',
      scope: 'device',
      version: 'v7',
      taskUuid: 'task-1',
      materialUuid: null,
      deviceId: null,
    }
    const intent = client.releaseOccupanciesIntent(
      snapshot,
      snapshot.errors[0]!,
      [lock],
      '取消前释放',
    )
    expect(intent.body).not.toHaveProperty('session_id')
    expect(intent.body).toMatchObject({
      decision_id: snapshot.errors[0]!.decisionId,
      operation: 'release',
    })
  })
})
