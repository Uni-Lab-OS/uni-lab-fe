import { expect, type APIRequestContext } from '@playwright/test'

/**
 * 工站异常处置 E2E 的 OS 侧访问层。
 *
 * 所有请求都走 developer-web 自己的同源代理 `/__unilab_backend`，与浏览器端使用
 * 完全相同的链路；不直接连 OS 端口，也不 mock 任何响应。OS 是唯一权威：
 * 这里只读快照、提交决策，不做任何乐观推断。
 */

const PROXY = '/__unilab_backend/api/v1'

/** SZLab 纯软件探针工作流：默认第二节点首次失败、重试后成功，不操作 PLC。 */
export const STATION_ERROR_WORKFLOW_UUID = 'afbf7e17-a53c-575c-9a74-810ef3d887e2'
export const STATION_ERROR_NODE_UUID = '079f74f9-613c-5737-bba3-01c4dec8b362'
export const STATION_ID = 'local'

export interface StationErrorFact {
  readonly decisionId: string
  readonly decisionVersion: number
  readonly taskUuid: string
  readonly jobUuid: string
  readonly stage: string
  readonly status: string
  readonly message: string
}

export interface StationSnapshot {
  readonly stationVersion: number
  readonly errorEpoch: number
  readonly snapshotId: string
  readonly mode: string
  readonly errors: readonly StationErrorFact[]
}

interface Envelope<T> {
  readonly code: number
  readonly data: T
}

interface RawStationError {
  readonly decision_id?: unknown
  readonly revision?: unknown
  readonly workflow_task_uuid?: unknown
  readonly workflow_node_job_uuid?: unknown
  readonly stage?: unknown
  readonly status?: unknown
  readonly meta_data?: { readonly message?: unknown } | null
}

/** 只读工站处置快照；这是 UI 与 E2E 共同的事实来源。 */
export async function readStation(request: APIRequestContext): Promise<StationSnapshot> {
  const response = await request.get(`${PROXY}/stations/${STATION_ID}/error-handling`)
  expect(response.status(), '读取工站处置快照必须成功').toBe(200)
  const body = (await response.json()) as Envelope<{
    station_version: number
    error_epoch: number
    snapshot_id: string
    mode: string
    errors?: readonly RawStationError[]
  }>
  const data = body.data
  return {
    stationVersion: Number(data.station_version),
    errorEpoch: Number(data.error_epoch),
    snapshotId: String(data.snapshot_id),
    mode: String(data.mode),
    errors: (data.errors ?? []).map((item) => ({
      decisionId: String(item.decision_id ?? ''),
      decisionVersion: Number(item.revision ?? 0),
      taskUuid: String(item.workflow_task_uuid ?? ''),
      jobUuid: String(item.workflow_node_job_uuid ?? ''),
      stage: String(item.stage ?? ''),
      status: String(item.status ?? ''),
      message: String(item.meta_data?.message ?? ''),
    })),
  }
}

/** 提交一次真实任务，返回任务 UUID（由 OS 分配，前端不伪造）。 */
export async function submitErrorWorkflowTask(
  request: APIRequestContext,
  input: { failureCount?: number; delaySeconds?: number } = {},
): Promise<string> {
  const response = await request.post(`${PROXY}/workflow-tasks`, {
    data: {
      workflow_uuid: STATION_ERROR_WORKFLOW_UUID,
      input: {
        failure_count: input.failureCount ?? 1,
        delay_seconds: input.delaySeconds ?? 1,
      },
    },
  })
  expect([200, 201], '提交任务必须被 OS 受理').toContain(response.status())
  const body = (await response.json()) as Envelope<{ uuid: string }>
  return String(body.data.uuid)
}

export interface TaskProjection {
  readonly status: string
  readonly controlStatus: string
}

export async function readTask(
  request: APIRequestContext,
  taskUuid: string,
): Promise<TaskProjection> {
  const response = await request.get(`${PROXY}/workflow-tasks/${taskUuid}`)
  expect(response.status()).toBe(200)
  const body = (await response.json()) as Envelope<{
    status: string
    control_status?: string
  }>
  return { status: String(body.data.status), controlStatus: String(body.data.control_status ?? '') }
}

/** 轮询到该任务出现待处置错误事实为止；超时即测试失败，不做兜底伪造。 */
export async function waitForTaskError(
  request: APIRequestContext,
  taskUuid: string,
  timeoutMs = 90_000,
): Promise<{ snapshot: StationSnapshot; error: StationErrorFact }> {
  const deadline = Date.now() + timeoutMs
  let last: StationSnapshot | null = null
  while (Date.now() < deadline) {
    const snapshot = await readStation(request)
    last = snapshot
    const error = snapshot.errors.find(
      (item) => item.taskUuid === taskUuid && item.stage === 'DECISION_REQUIRED',
    )
    if (error) return { snapshot, error }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(
    `等待任务 ${taskUuid} 的工站错误事实超时；最后快照 mode=${last?.mode} errors=${last?.errors.length}`,
  )
}

export async function waitForTaskStatus(
  request: APIRequestContext,
  taskUuid: string,
  expected: readonly string[],
  timeoutMs = 120_000,
): Promise<TaskProjection> {
  const deadline = Date.now() + timeoutMs
  let last: TaskProjection | null = null
  while (Date.now() < deadline) {
    const task = await readTask(request, taskUuid)
    last = task
    if (expected.includes(task.status)) return task
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`等待任务 ${taskUuid} 进入 ${expected.join('/')} 超时；最后状态 ${last?.status}`)
}

export async function waitForStationMode(
  request: APIRequestContext,
  mode: string,
  timeoutMs = 90_000,
): Promise<StationSnapshot> {
  const deadline = Date.now() + timeoutMs
  let last: StationSnapshot | null = null
  while (Date.now() < deadline) {
    const snapshot = await readStation(request)
    last = snapshot
    if (snapshot.mode === mode) return snapshot
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`等待工站进入 ${mode} 超时；最后 mode=${last?.mode}`)
}

/**
 * 把工站恢复到「无待处置错误」的干净基线。
 *
 * 同一工站一次只允许一条处置会话，残留的错误会让新用例拿不到处置入口，
 * 所以每个用例开始前必须由测试自己清干净 —— 用的是 OS 公开的取消决策，
 * 不做任何直接改库或绕过契约的清理。
 */
export async function clearStationErrors(request: APIRequestContext): Promise<number> {
  let cleared = 0
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const snapshot = await readStation(request)
    const open = snapshot.errors.filter((item) => item.status === 'open')
    if (open.length === 0) {
      if (snapshot.mode !== 'PAUSED') return cleared
      // 没有错误但仍暂停：这是工站级「恢复调度」的范围，用 OS 公开的 resume
      // 契约恢复，保证后续用例能真正派发新节点。
      const response = await request.post(`${PROXY}/stations/${STATION_ID}/resume`, {
        headers: { 'Idempotency-Key': `e2e-resume-${snapshot.snapshotId}-${attempt}` },
        data: {
          expected_station_version: snapshot.stationVersion,
          observed_error_epoch: snapshot.errorEpoch,
          operator_confirmed: true,
          confirm_snapshot_id: snapshot.snapshotId,
        },
      })
      expect([200, 201, 202], '恢复工站调度必须被 OS 受理').toContain(response.status())
      await new Promise((resolve) => setTimeout(resolve, 1500))
      continue
    }
    const error = open[0]
    const response = await request.post(
      `${PROXY}/stations/${STATION_ID}/errors/${encodeURIComponent(error.decisionId)}/decision`,
      {
        headers: { 'Idempotency-Key': `e2e-clean-${error.decisionId}-${attempt}` },
        data: {
          action: 'cancel_task',
          expected_station_version: snapshot.stationVersion,
          expected_decision_version: error.decisionVersion,
          observed_error_epoch: snapshot.errorEpoch,
          resume_requested: true,
          operator_confirmed: true,
          confirm_snapshot_id: snapshot.snapshotId,
          reason: 'E2E 前置清理：取消上一个用例遗留的失败任务',
        },
      },
    )
    expect([200, 201, 202], '清理残留错误必须被 OS 受理').toContain(response.status())
    cleared += 1
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw new Error('工站残留错误在 10 轮内没有清理干净')
}