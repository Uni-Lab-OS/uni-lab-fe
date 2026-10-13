import { describe, expect, it, vi } from 'vitest'
import { createFetchTransport } from '../../adapters/fetch'
import {
  TransportError,
  type RequestTransport,
  type TransportRequest,
  type TransportResponse,
} from '../../transport/request'
import { StationErrorHandlingClient } from './client'
import { StationHandlingError } from './port'

function fakeTransport(handle: (request: TransportRequest) => unknown) {
  const requests: TransportRequest[] = []
  const spy = vi.fn(async (input: TransportRequest): Promise<TransportResponse<unknown>> => {
    requests.push(input)
    const data = handle(input)
    if (data instanceof TransportError) throw data
    return { status: 200, headers: {}, data }
  })
  const transport: RequestTransport = {
    request: <Value>(input: TransportRequest) => spy(input) as Promise<TransportResponse<Value>>,
  }
  return { transport, requests, spy }
}

async function rejectionOf(promise: Promise<unknown>): Promise<StationHandlingError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof StationHandlingError) return error
    throw error
  }
  throw new Error('期望请求被拒绝，但请求成功了')
}

function transportError(status: number, cause: unknown): TransportError {
  return new TransportError({
    code: 'HTTP_REQUEST_FAILED',
    message: `HTTP ${status}`,
    status,
    retryable: status >= 500,
    cause,
  })
}

function withoutField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field))
}

const errorFactPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  decision_id: 'decision/1',
  revision: 2,
  stage: 'DECISION_REQUIRED',
  status: 'open',
  session_id: null,
  workflow_task_uuid: 'task/1',
  workflow_node_job_uuid: 'job/1',
  meta_data: { message: '设备异常', source_node_id: 'node-1' },
  error_phase: 'execution',
  opened_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

const snapshotPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  station_id: 'local',
  mode: 'PAUSED',
  station_version: 7,
  error_epoch: 3,
  snapshot_id: 'local:7:3',
  active_session_id: null,
  active_session: null,
  errors: [errorFactPayload()],
  control_commands: [
    {
      command_uuid: 'command-1',
      operation: 'decision:decision/1',
      status: 'PENDING',
      needs_apply: true,
    },
  ],
  ...overrides,
})

const receiptPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  command_uuid: 'command-1',
  status: 'PENDING',
  result: {},
  station: snapshotPayload(),
  ...overrides,
})

const decisionRequest = {
  action: 'cancel_task' as const,
  expectedStationVersion: 7,
  expectedDecisionVersion: 2,
  observedErrorEpoch: 3,
  resumeRequested: false,
  operatorConfirmed: false,
}

const deviceActionPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  action_id: 'template/1',
  action_version: 'fingerprint-1',
  name: 'pick',
  display_name: '抓取',
  parameter_schema: { type: 'object', properties: { speed: { type: 'number' } } },
  defaults: { speed: 10 },
  device_binding: { material_uuid: 'device/2', edge_local_id: 'local-2' },
  ...overrides,
})

const inventoryPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  instances: [
    { edge_uuid: 'mat/1', name: '试剂瓶', parent_uuid: null, version: 3 },
    { edge_uuid: 'mat/2', name: '孔板', parent_uuid: 'mat/1', version: '2026-01-02T00:00:00Z' },
  ],
  sites: [
    {
      uuid: 'site/1',
      material_uuid: 'mat/1',
      name: 'A1',
      occupied_material_uuid: 'mat/2',
      update_time: '2026-01-02T00:00:00Z',
    },
    {
      uuid: 'site/2',
      material_uuid: 'mat/1',
      name: 'A2',
      occupied_material_uuid: null,
      update_time: '2026-01-03T00:00:00Z',
    },
  ],
  ...overrides,
})

const occupancyPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  uuid: 'lock/1',
  lock_key: 'device:local-1',
  state: 'running',
  occupancy_kind: 'execution_lock',
  version: '2026-01-02T00:00:00Z:7',
  workflow_task_uuid: 'task/1',
  workflow_node_job_uuid: 'job/1',
  material_uuid: 'mat/1',
  device_id: 'device/1',
  ...overrides,
})

const manualActionJobPayload = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  uuid: 'job/1',
  status: 'succeeded',
  meta_data: { session_id: 'session/1' },
  control_data: { dispatch_payload: { device_id: 'control-device', action: 'control-action' } },
  device_id: 'top-device',
  action_name: 'top-action',
  edge_command_uuid: 'command/1',
  uncertainty_reason: '抓取结果未知',
  result_reviewed: false,
  review_version: 'review-1',
  started_at: '2026-01-02T00:00:00Z',
  finished_at: '2026-01-02T00:01:00Z',
  ...overrides,
})

const inventoryCorrectionRequest = {
  changes: [{ materialUuid: 'mat/1', parentUuid: '', siteUuid: '' }],
  expectedInventoryVersions: { 'mat/1': 3 },
  reason: '现场已人工上料',
  expectedStationVersion: 7,
  expectedSessionVersion: 4,
}

const occupancyReleaseRequest = {
  decisionId: 'decision/1',
  sessionId: 'session/1',
  occupancyIds: ['lock/1', 'lock/2'],
  expectedVersions: { 'lock/1': 'v1', 'lock/2': 'v2' },
  reason: '现场确认可以释放',
  expectedStationVersion: 7,
  expectedSessionVersion: 4,
}

describe('StationErrorHandlingClient', () => {
  it('读取快照并解码线上字段名', async () => {
    const { transport, requests, spy } = fakeTransport(() => ({
      code: 0,
      data: snapshotPayload(),
    }))
    const client = new StationErrorHandlingClient(transport, 'station/1')
    const controller = new AbortController()

    const snapshot = await client.getSnapshot(controller.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: '/api/v1/stations/station%2F1/error-handling',
    })
    expect(requests[0]?.signal).toBe(controller.signal)
    expect(requests[0]?.headers).toBeUndefined()
    expect(snapshot).toMatchObject({
      kind: 'station_handling_snapshot',
      source: 'os',
      stationId: 'local',
      mode: 'PAUSED',
      stationVersion: 7,
      errorEpoch: 3,
      snapshotId: 'local:7:3',
      activeSessionId: null,
      activeSession: null,
      errors: [
        {
          kind: 'station_error_fact',
          source: 'os',
          decisionId: 'decision/1',
          decisionVersion: 2,
          stage: 'DECISION_REQUIRED',
          status: 'open',
          sessionId: null,
          sourceTaskUuid: 'task/1',
          sourceJobUuid: 'job/1',
          message: '设备异常',
          sourceNodeId: 'node-1',
          errorPhase: 'execution',
          openedAt: '2026-01-01T00:00:00Z',
        },
      ],
      controlCommands: [
        {
          commandUuid: 'command-1',
          operation: 'decision:decision/1',
          status: 'PENDING',
          needsApply: true,
        },
      ],
    })
  })

  it('meta_data 是字符串时按对象解码，坏 JSON 只当作 null', async () => {
    const { transport } = fakeTransport(() => ({
      code: 0,
      data: snapshotPayload({
        errors: [
          errorFactPayload({
            meta_data: JSON.stringify({ message: '字符串元数据', source_node_id: 'node-9' }),
          }),
          errorFactPayload({ decision_id: 'decision/2', meta_data: '{ 坏 JSON' }),
        ],
      }),
    }))

    const snapshot = await new StationErrorHandlingClient(transport, 'local').getSnapshot()

    expect(snapshot.errors[0]).toMatchObject({ message: '字符串元数据', sourceNodeId: 'node-9' })
    expect(snapshot.errors[1]).toMatchObject({ decisionId: 'decision/2', message: null })
    expect(snapshot.errors[1]?.sourceNodeId).toBeNull()
  })

  it('mode、stage、数组形态异常时回退到安全默认', async () => {
    const { transport } = fakeTransport(() => ({
      code: 0,
      data: snapshotPayload({
        mode: 'STOPPED',
        active_session_id: 'session/1',
        active_session: {
          session_id: 'session/1',
          decision_id: 'decision/1',
          stage: 'UNKNOWN_STAGE',
          version: 4,
          summary: '已调整现场',
        },
        errors: 'not-an-array',
        control_commands: null,
      }),
    }))

    const snapshot = await new StationErrorHandlingClient(transport, 'local').getSnapshot()

    expect(snapshot).toMatchObject({
      mode: 'RUNNING',
      activeSessionId: 'session/1',
      activeSession: {
        kind: 'station_handling_session',
        sessionId: 'session/1',
        decisionId: 'decision/1',
        stage: 'DECISION_REQUIRED',
        version: 4,
        summary: '已调整现场',
      },
      errors: [],
      controlCommands: [],
    })
  })

  it.each(['station_id', 'station_version', 'snapshot_id'])(
    '快照缺 %s 时拒绝解码',
    async (field) => {
      const { transport } = fakeTransport(() => ({
        code: 0,
        data: withoutField(snapshotPayload(), field),
      }))

      const error = await rejectionOf(
        new StationErrorHandlingClient(transport, 'local').getSnapshot(),
      )

      expect(error).toBeInstanceOf(StationHandlingError)
      expect(error.code).toBe('INVALID_STATION_RESPONSE')
      expect(error.message).toContain('缺少必需字段')
    },
  )

  it('decide 使用错误决定路由、幂等头与省略可选字段的 snake_case body', async () => {
    const { transport, requests } = fakeTransport(() => ({ code: 0, data: receiptPayload() }))
    const client = new StationErrorHandlingClient(transport, 'local')

    await client.decide('decision/1', decisionRequest, { idempotencyKey: 'key-1' })

    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/stations/local/errors/decision%2F1/decision',
      headers: { 'Idempotency-Key': 'key-1' },
    })
    expect(requests[0]?.body).toEqual({
      action: 'cancel_task',
      expected_station_version: 7,
      expected_decision_version: 2,
      observed_error_epoch: 3,
      resume_requested: false,
      operator_confirmed: false,
    })
  })

  it('decide 明确给出可选字段时才写入 body', async () => {
    const { transport, requests } = fakeTransport(() => ({ code: 0, data: receiptPayload() }))

    await new StationErrorHandlingClient(transport, 'local').decide(
      'decision/1',
      {
        ...decisionRequest,
        action: 'enter_manual_handling',
        confirmSnapshotId: 'local:7:3',
        sessionId: 'session/1',
        expectedSessionVersion: 4,
        reason: '现场已核对',
      },
      { idempotencyKey: 'key-2' },
    )

    expect(requests[0]?.body).toEqual({
      action: 'enter_manual_handling',
      expected_station_version: 7,
      expected_decision_version: 2,
      observed_error_epoch: 3,
      resume_requested: false,
      operator_confirmed: false,
      confirm_snapshot_id: 'local:7:3',
      session_id: 'session/1',
      expected_session_version: 4,
      reason: '现场已核对',
    })
  })

  it('resume 使用恢复路由、幂等头与绑定快照的 body', async () => {
    const { transport, requests } = fakeTransport(() => ({ code: 0, data: receiptPayload() }))

    await new StationErrorHandlingClient(transport, 'local').resume(
      {
        expectedStationVersion: 8,
        observedErrorEpoch: 4,
        operatorConfirmed: true,
        confirmSnapshotId: 'local:8:4',
      },
      { idempotencyKey: 'key-3' },
    )

    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/stations/local/resume',
      headers: { 'Idempotency-Key': 'key-3' },
    })
    expect(requests[0]?.body).toEqual({
      expected_station_version: 8,
      observed_error_epoch: 4,
      operator_confirmed: true,
      confirm_snapshot_id: 'local:8:4',
    })
  })

  it('回执缺 station 时 snapshot 为 null，存在时被解码', async () => {
    const missing = fakeTransport(() => ({
      code: 0,
      data: withoutField(receiptPayload({ application_error: '应用失败' }), 'station'),
    }))
    const receiptWithoutStation = await new StationErrorHandlingClient(
      missing.transport,
      'local',
    ).resume(
      {
        expectedStationVersion: 8,
        observedErrorEpoch: 4,
        operatorConfirmed: true,
        confirmSnapshotId: 'local:8:4',
      },
      { idempotencyKey: 'key-3' },
    )

    expect(receiptWithoutStation).toMatchObject({
      kind: 'station_command_receipt',
      source: 'os',
      commandUuid: 'command-1',
      operation: 'resume',
      status: 'PENDING',
      snapshot: null,
      applicationError: '应用失败',
      dispatchError: null,
    })

    const present = fakeTransport(() => ({ code: 0, data: receiptPayload() }))
    const receiptWithStation = await new StationErrorHandlingClient(
      present.transport,
      'local',
    ).decide('decision/1', decisionRequest, { idempotencyKey: 'key-1' })

    expect(receiptWithStation.operation).toBe('decision:decision/1')
    expect(receiptWithStation.snapshot).toMatchObject({
      kind: 'station_handling_snapshot',
      stationId: 'local',
      stationVersion: 7,
      snapshotId: 'local:7:3',
    })
  })

  it('被确定拒绝的命令保留 result.error 作为未生效原因', async () => {
    const { transport } = fakeTransport(() => ({
      code: 0,
      data: receiptPayload({ status: 'FAILED', result: { error: '库存更正被拒绝' } }),
    }))

    const receipt = await new StationErrorHandlingClient(transport, 'local').resume(
      {
        expectedStationVersion: 8,
        observedErrorEpoch: 4,
        operatorConfirmed: true,
        confirmSnapshotId: 'local:8:4',
      },
      { idempotencyKey: 'key-4' },
    )

    expect(receipt).toMatchObject({ status: 'FAILED', applicationError: '库存更正被拒绝' })
  })
})

describe('StationErrorHandlingClient 人工处置新能力', () => {
  it('listManualDeviceActions 使用会话设备动作目录路由并按 snake_case 解码', async () => {
    const { transport, requests, spy } = fakeTransport(() => ({
      code: 0,
      data: [deviceActionPayload()],
    }))
    const client = new StationErrorHandlingClient(transport, 'station/1')
    const controller = new AbortController()

    const actions = await client.listManualDeviceActions('session/1', 'device/2', controller.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: '/api/v1/stations/station%2F1/sessions/session%2F1/devices/device%2F2/actions',
    })
    expect(requests[0]?.signal).toBe(controller.signal)
    expect(requests[0]?.headers).toBeUndefined()
    expect(actions).toEqual([
      {
        kind: 'station_manual_device_action',
        source: 'os',
        actionId: 'template/1',
        actionVersion: 'fingerprint-1',
        name: 'pick',
        displayName: '抓取',
        parameterSchema: { type: 'object', properties: { speed: { type: 'number' } } },
        defaults: { speed: 10 },
        raw: deviceActionPayload(),
      },
    ])
  })

  it('设备动作缺 display_name 时回落到 name，缺动作版本时保留空串', async () => {
    const { transport } = fakeTransport(() => ({
      code: 0,
      data: [deviceActionPayload({ display_name: undefined, action_version: undefined })],
    }))

    const actions = await new StationErrorHandlingClient(
      transport,
      'local',
    ).listManualDeviceActions('session/1', 'device/2')

    expect(actions[0]).toMatchObject({ displayName: 'pick', actionVersion: '' })
  })

  it('executeManualAction 用会话路由、幂等头，body 恰好只有 OS 允许的 6 个键', async () => {
    const { transport, requests } = fakeTransport(() => ({ code: 0, data: receiptPayload() }))

    await new StationErrorHandlingClient(transport, 'local').executeManualAction(
      'session/1',
      {
        deviceId: 'device/2',
        actionId: 'template/1',
        actionVersion: 'fingerprint-1',
        parameters: { speed: 10 },
        expectedStationVersion: 7,
        expectedSessionVersion: 4,
      },
      { idempotencyKey: 'key-manual', reason: '不应下发的说明' },
    )

    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/stations/local/sessions/session%2F1/manual-actions',
      headers: { 'Idempotency-Key': 'key-manual' },
    })
    expect(Object.keys(requests[0]?.body as object).sort()).toEqual([
      'action_id',
      'action_version',
      'device_id',
      'expected_session_version',
      'expected_station_version',
      'parameters',
    ])
    expect(requests[0]?.body).toEqual({
      expected_station_version: 7,
      expected_session_version: 4,
      device_id: 'device/2',
      action_id: 'template/1',
      action_version: 'fingerprint-1',
      parameters: { speed: 10 },
    })
    // options.reason 不在 OS 的 ManualActionRequest 里，带上会被 422 拒绝。
    expect(requests[0]?.body).not.toHaveProperty('reason')
  })

  it('stopManualAction 的 body 只有 reason，不带任何版本字段', async () => {
    const { transport, requests } = fakeTransport(() => ({ code: 0, data: receiptPayload() }))

    await new StationErrorHandlingClient(transport, 'local').stopManualAction(
      'command/1',
      '现场出现异常',
      { idempotencyKey: 'key-stop' },
    )

    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/stations/local/manual-actions/command%2F1/stop',
      headers: { 'Idempotency-Key': 'key-stop' },
    })
    expect(Object.keys(requests[0]?.body as object)).toEqual(['reason'])
    expect(requests[0]?.body).toEqual({ reason: '现场出现异常' })
  })

  it('getHandlingInventory 走会话库存路由，并把线上 uuid 解码成 siteUuid', async () => {
    const { transport, requests } = fakeTransport(() => ({
      code: 0,
      data: inventoryPayload(),
    }))
    const controller = new AbortController()

    const inventory = await new StationErrorHandlingClient(transport, 'local').getHandlingInventory(
      'session/1',
      controller.signal,
    )

    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: '/api/v1/stations/local/sessions/session%2F1/inventory',
    })
    expect(requests[0]?.signal).toBe(controller.signal)
    expect(inventory).toMatchObject({
      kind: 'station_handling_inventory',
      source: 'os',
      instances: [
        { edgeUuid: 'mat/1', name: '试剂瓶', parentUuid: '', version: 3 },
        { edgeUuid: 'mat/2', name: '孔板', parentUuid: 'mat/1', version: '2026-01-02T00:00:00Z' },
      ],
      sites: [
        {
          siteUuid: 'site/1',
          materialUuid: 'mat/1',
          name: 'A1',
          occupiedMaterialUuid: 'mat/2',
          updateTime: '2026-01-02T00:00:00Z',
        },
        {
          siteUuid: 'site/2',
          materialUuid: 'mat/1',
          name: 'A2',
          occupiedMaterialUuid: null,
          updateTime: '2026-01-03T00:00:00Z',
        },
      ],
    })
    // 线上字段名不得泄漏到投影里。
    expect(inventory.sites[0]).not.toHaveProperty('uuid')
  })

  it('correctInventory 省略 related_manual_command_id，空串的 parent/site 如实下发', async () => {
    const { transport, requests } = fakeTransport(() => ({ code: 0, data: receiptPayload() }))

    await new StationErrorHandlingClient(transport, 'local').correctInventory(
      'session/1',
      inventoryCorrectionRequest,
      { idempotencyKey: 'key-inventory' },
    )

    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/stations/local/sessions/session%2F1/inventory-corrections',
      headers: { 'Idempotency-Key': 'key-inventory' },
    })
    expect(requests[0]?.body).toEqual({
      expected_station_version: 7,
      expected_session_version: 4,
      changes: [{ material_uuid: 'mat/1', parent_uuid: '', site_uuid: '' }],
      expected_inventory_versions: { 'mat/1': 3 },
      reason: '现场已人工上料',
    })
    // OS 的 InventoryChange 是 `parent_uuid: str = ""`：下发 null 会被 pydantic 422 拒掉。
    expect(requests[0]?.body).not.toHaveProperty('related_manual_command_id')
  })

  it('correctInventory 明确给出 relatedManualCommandId 时才写入该键', async () => {
    const { transport, requests } = fakeTransport(() => ({ code: 0, data: receiptPayload() }))

    await new StationErrorHandlingClient(transport, 'local').correctInventory(
      'session/1',
      { ...inventoryCorrectionRequest, relatedManualCommandId: 'command/1' },
      { idempotencyKey: 'key-inventory' },
    )

    expect(requests[0]?.body).toEqual({
      expected_station_version: 7,
      expected_session_version: 4,
      changes: [{ material_uuid: 'mat/1', parent_uuid: '', site_uuid: '' }],
      expected_inventory_versions: { 'mat/1': 3 },
      reason: '现场已人工上料',
      related_manual_command_id: 'command/1',
    })
  })

  it('listResourceOccupancies 用非会话的 resource-dispositions 路由，并兼容两个 task 来源', async () => {
    const { transport, requests, spy } = fakeTransport(() => ({
      code: 0,
      data: [
        occupancyPayload(),
        occupancyPayload({
          uuid: 'lock/2',
          occupancy_kind: 'device_tenancy',
          workflow_task_uuid: undefined,
          task_uuid: 'task/2',
          device_id: undefined,
          lock_key: 'device:local-2',
          version: '2026-01-03T00:00:00Z',
        }),
      ],
    }))
    const client = new StationErrorHandlingClient(transport, 'station/1')
    const controller = new AbortController()

    const occupancies = await client.listResourceOccupancies(controller.signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: '/api/v1/stations/station%2F1/resource-dispositions',
    })
    expect(requests[0]?.signal).toBe(controller.signal)
    expect(requests[0]?.headers).toBeUndefined()
    expect(occupancies[0]).toMatchObject({
      kind: 'station_resource_occupancy',
      source: 'os',
      occupancyUuid: 'lock/1',
      lockKey: 'device:local-1',
      state: 'running',
      occupancyKind: 'execution_lock',
      version: '2026-01-02T00:00:00Z:7',
      taskUuid: 'task/1',
      jobUuid: 'job/1',
      materialUuid: 'mat/1',
      deviceId: 'device/1',
    })
    expect(occupancies[1]).toMatchObject({
      occupancyUuid: 'lock/2',
      taskUuid: 'task/2',
      deviceId: null,
    })
  })

  it('列表端点兼容不带信封的裸数组响应', async () => {
    const { transport } = fakeTransport(() => [occupancyPayload()])

    const occupancies = await new StationErrorHandlingClient(
      transport,
      'local',
    ).listResourceOccupancies()

    expect(occupancies).toHaveLength(1)
    expect(occupancies[0]?.occupancyUuid).toBe('lock/1')
  })

  it('releaseOccupancies 用 resource-dispositions 路由、幂等头与 release body', async () => {
    const { transport, requests } = fakeTransport(() => ({ code: 0, data: receiptPayload() }))

    await new StationErrorHandlingClient(transport, 'local').releaseOccupancies(
      occupancyReleaseRequest,
      { idempotencyKey: 'key-release' },
    )

    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/stations/local/resource-dispositions',
      headers: { 'Idempotency-Key': 'key-release' },
    })
    expect(requests[0]?.body).toEqual({
      expected_station_version: 7,
      expected_session_version: 4,
      decision_id: 'decision/1',
      session_id: 'session/1',
      occupancy_ids: ['lock/1', 'lock/2'],
      expected_versions: { 'lock/1': 'v1', 'lock/2': 'v2' },
      operation: 'release',
      reason: '现场确认可以释放',
    })
  })

  it('快照把 manual_actions 解码成 manualActions，含 meta_data 与 control_data 兜底', async () => {
    const { transport } = fakeTransport(() => ({
      code: 0,
      data: snapshotPayload({
        manual_actions: [
          manualActionJobPayload(),
          manualActionJobPayload({
            uuid: 'job/2',
            status: 'running',
            meta_data: JSON.stringify({ session_id: 'session/2' }),
            control_data: { dispatch_payload: { device_id: 'device/2', action: 'place' } },
            device_id: undefined,
            action_name: undefined,
            uncertainty_reason: undefined,
            result_reviewed: undefined,
            review_version: undefined,
            started_at: undefined,
            finished_at: undefined,
            edge_command_uuid: undefined,
          }),
        ],
      }),
    }))

    const snapshot = await new StationErrorHandlingClient(transport, 'local').getSnapshot()

    expect(snapshot.manualActions[0]).toMatchObject({
      kind: 'station_manual_action_job',
      source: 'os',
      jobUuid: 'job/1',
      sessionId: 'session/1',
      status: 'succeeded',
      deviceId: 'top-device',
      actionName: 'top-action',
      edgeCommandUuid: 'command/1',
      uncertaintyReason: '抓取结果未知',
      resultReviewed: false,
      reviewVersion: 'review-1',
      startedAt: '2026-01-02T00:00:00Z',
      finishedAt: '2026-01-02T00:01:00Z',
      raw: manualActionJobPayload(),
    })
    expect(snapshot.manualActions[1]).toMatchObject({
      jobUuid: 'job/2',
      sessionId: 'session/2',
      status: 'running',
      deviceId: 'device/2',
      actionName: 'place',
      edgeCommandUuid: null,
      uncertaintyReason: null,
      resultReviewed: false,
      reviewVersion: null,
      startedAt: null,
      finishedAt: null,
    })
  })

  it('快照没有 manual_actions 时 manualActions 为空数组', async () => {
    const { transport } = fakeTransport(() => ({ code: 0, data: snapshotPayload() }))

    const snapshot = await new StationErrorHandlingClient(transport, 'local').getSnapshot()

    expect(snapshot.manualActions).toEqual([])
  })

  it('真实 fetch 适配器下 409 occupancy_version_conflict 只能经 cause 取到 detail', async () => {
    const transport = createFetchTransport({
      baseUrl: 'https://os.example.test',
      fetcher: async () =>
        new Response(JSON.stringify({ detail: 'occupancy_version_conflict' }), { status: 409 }),
    })

    const error = await rejectionOf(
      new StationErrorHandlingClient(transport, 'local').releaseOccupancies(
        occupancyReleaseRequest,
        { idempotencyKey: 'key-release' },
      ),
    )

    expect(error).toBeInstanceOf(StationHandlingError)
    expect(error.code).toBe('OCCUPANCY_VERSION_CONFLICT')
    expect(error.status).toBe(409)
    expect(error.message).toMatch(/[\u4e00-\u9fa5]/)
    expect(error.message).not.toContain('occupancy_version_conflict')
  })
})

describe('StationErrorHandlingClient 错误映射', () => {
  it.each([
    ['station_version_conflict', 'STATION_VERSION_CONFLICT'],
    ['decision_conflict', 'DECISION_CONFLICT'],
    ['session_version_conflict', 'SESSION_VERSION_CONFLICT'],
    ['active_session_conflict', 'ACTIVE_SESSION_CONFLICT'],
    ['operator_confirmation_required', 'OPERATOR_CONFIRMATION_REQUIRED'],
    ['idempotency_conflict', 'IDEMPOTENCY_CONFLICT'],
    ['manual_actions_running', 'MANUAL_ACTIONS_RUNNING'],
    ['manual_actions_unresolved', 'MANUAL_ACTIONS_UNRESOLVED'],
    ['manual_action_not_finished', 'MANUAL_ACTION_NOT_FINISHED'],
    ['manual_review_version_conflict', 'MANUAL_REVIEW_VERSION_CONFLICT'],
    ['occupancy_version_conflict', 'OCCUPANCY_VERSION_CONFLICT'],
    ['action_definition_changed', 'ACTION_DEFINITION_CHANGED'],
    // 执行身份冲突没有更贴切的专用码，按约定落到 OS_REQUEST_REJECTED。
    ['execution_identity_conflict', 'OS_REQUEST_REJECTED'],
  ])('把 detail=%s 映射为 %s 并给出中文文案', async (detail, code) => {
    const { transport } = fakeTransport(() => transportError(409, { detail }))

    const error = await rejectionOf(
      new StationErrorHandlingClient(transport, 'local').getSnapshot(),
    )

    expect(error).toBeInstanceOf(StationHandlingError)
    expect(error.code).toBe(code)
    expect(error.status).toBe(409)
    expect(error.message).toMatch(/[\u4e00-\u9fa5]/)
    expect(error.message).not.toContain(detail)
  })

  it('503 兜底为 STATION_HANDLING_NOT_READY', async () => {
    const { transport } = fakeTransport(() =>
      transportError(503, { detail: '工站错误处置服务尚未就绪' }),
    )

    const error = await rejectionOf(
      new StationErrorHandlingClient(transport, 'local').getSnapshot(),
    )

    expect(error).toMatchObject({ code: 'STATION_HANDLING_NOT_READY', status: 503 })
    expect(error.message).toContain('尚未就绪')
  })

  it('404 兜底为 STATION_NOT_FOUND', async () => {
    const { transport } = fakeTransport(() => transportError(404, { detail: '工站不存在' }))

    const error = await rejectionOf(
      new StationErrorHandlingClient(transport, 'local').getSnapshot(),
    )

    expect(error).toMatchObject({ code: 'STATION_NOT_FOUND', status: 404 })
  })

  it.each([
    ['错误决定不存在', 'STATION_DECISION_NOT_FOUND'],
    ['处置会话不存在', 'STATION_SESSION_NOT_FOUND'],
    ['控制命令不存在', 'STATION_COMMAND_NOT_FOUND'],
    ['手动执行命令不存在', 'STATION_MANUAL_ACTION_NOT_FOUND'],
    ['本工站的手动动作不存在', 'STATION_MANUAL_ACTION_NOT_FOUND'],
    ['当前会话的手动动作不存在', 'STATION_MANUAL_ACTION_NOT_FOUND'],
    ['资源占用不存在', 'STATION_OCCUPANCY_NOT_FOUND'],
  ])('404 按 detail=%s 区分具体缺失事实为 %s', async (detail, code) => {
    const { transport } = fakeTransport(() => transportError(404, { detail }))

    const error = await rejectionOf(
      new StationErrorHandlingClient(transport, 'local').getSnapshot(),
    )

    expect(error).toMatchObject({ code, status: 404 })
    // 具体事实缺失不能误导用户去怀疑工站部署。
    expect(error.message).not.toContain('未找到该工站')
  })

  it('OS 给出的中文可行动说明原样透出，不被泛化文案吞掉', async () => {
    const { transport } = fakeTransport(() =>
      transportError(409, { detail: '人工处置要求工站暂停并填写原因' }),
    )

    const error = await rejectionOf(
      new StationErrorHandlingClient(transport, 'local').getSnapshot(),
    )

    expect(error.code).toBe('OS_REQUEST_REJECTED')
    expect(error.message).toBe('人工处置要求工站暂停并填写原因')
  })

  it('422 视为请求字段被拒绝，而不是笼统的工站拒绝', async () => {
    const { transport } = fakeTransport(() => transportError(422, { detail: [{}] }))

    const error = await rejectionOf(
      new StationErrorHandlingClient(transport, 'local').getSnapshot(),
    )

    expect(error.code).toBe('STATION_REQUEST_INVALID')
    expect(error.message).toContain('幂等键')
  })

  it('无法识别的 detail 不回落到那 6 个码，而是按状态兜底', async () => {
    const { transport } = fakeTransport(() => transportError(409, { detail: 'unmapped_conflict' }))

    const error = await rejectionOf(
      new StationErrorHandlingClient(transport, 'local').getSnapshot(),
    )

    expect(error).toMatchObject({ code: 'OS_REQUEST_REJECTED', status: 409 })
  })

  it('真实 fetch 适配器下 detail 只能经 cause 取到，且不把英文码丢给用户', async () => {
    const transport = createFetchTransport({
      baseUrl: 'https://os.example.test',
      fetcher: async () =>
        new Response(JSON.stringify({ detail: 'station_version_conflict' }), { status: 409 }),
    })

    const error = await rejectionOf(
      new StationErrorHandlingClient(transport, 'local').getSnapshot(),
    )

    expect(error).toBeInstanceOf(StationHandlingError)
    expect(error.code).toBe('STATION_VERSION_CONFLICT')
    expect(error.status).toBe(409)
    expect(error.message).toBe('工站状态已变化，请核对刷新后的错误与现场状态后重新选择。')
  })
})
