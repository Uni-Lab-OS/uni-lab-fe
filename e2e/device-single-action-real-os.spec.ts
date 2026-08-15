import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  expect,
  test,
  type Locator,
  type Page,
  type Request
} from '@playwright/test'

const DEVICE_ID = 'D1ADevice1'
const ACTION_NAME = 'test_hold'

interface RunningOs {
  root: string
  url: string
  workingDirectory: string
  logs: () => string
  stop: () => Promise<void>
}

interface LedgerEntry {
  method: string
  path: string
  body?: unknown
  status?: number
}

interface DeviceCatalogEnvelope {
  data: {
    items: Array<{
      id: string
      actions: Array<{
        actionRef: string
        busy: boolean
        currentJobId: string | null
      }>
    }>
  }
}

let os: RunningOs

test.beforeAll(async () => {
  os = await startD1AOs()
})

test.afterAll(async () => {
  await os?.stop()
})

test('设备动作（DeviceAction）形成正式任务（Task）与作业（Job）并回流原事件界面', async ({
  page,
  request
}) => {
  test.setTimeout(90_000)
  const coreRoot = resolve(
    process.env.UNILAB_CORE_ROOT || resolve(process.cwd(), '../..')
  )
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ||
      join(coreRoot, 'e2e-artifacts/d1a-single-action-s1')
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const screenshots: string[] = []
  const browserErrors: string[] = []
  const browserRequests: LedgerEntry[] = []
  const requestEntries = new Map<Request, LedgerEntry>()
  const websocketUrls: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('websocket', (socket) => websocketUrls.push(socket.url()))
  page.on('request', (incoming) => {
    if (!incoming.url().startsWith(os.url)) return
    let body: unknown
    if (incoming.method() === 'POST') {
      try {
        body = incoming.postDataJSON()
      } catch {
        body = incoming.postData()
      }
    }
    const entry = {
      method: incoming.method(),
      path: new URL(incoming.url()).pathname,
      body
    }
    browserRequests.push(entry)
    requestEntries.set(incoming, entry)
  })
  page.on('response', (response) => {
    if (!response.url().startsWith(os.url)) return
    const entry = requestEntries.get(response.request())
    if (entry) entry.status = response.status()
  })

  const catalogResponse = await request.get(
    `${os.url}/api/v1/workflow-node-templates`
  )
  expect(catalogResponse.ok(), await catalogResponse.text()).toBe(true)
  const catalogEnvelope = await catalogResponse.json() as {
    code: number
    data: {
      authority: { authority_id: string }
      catalog_fingerprint: string
      items: Array<{ uuid: string; name: string }>
    }
  }
  expect(catalogEnvelope.code).toBe(0)
  const template = catalogEnvelope.data.items.find(
    (item) => item.name === ACTION_NAME
  )
  expect(template).toBeDefined()
  if (!template) throw new Error(`${ACTION_NAME} template is missing`)

  const firstTaskResponse = await request.post(
    `${os.url}/api/v1/device-action-tasks`,
    {
      data: {
        authority_id: catalogEnvelope.data.authority.authority_id,
        template_catalog_fingerprint:
          catalogEnvelope.data.catalog_fingerprint,
        workflow_node_template_uuid: template.uuid,
        device_id: DEVICE_ID,
        input: { duration_seconds: 12 },
        idempotency_key: randomUUID(),
        description: 'E2E busy holder'
      }
    }
  )
  expect(firstTaskResponse.status(), await firstTaskResponse.text()).toBe(201)
  const firstTask = (await firstTaskResponse.json() as {
    data: { task_uuid: string }
  }).data
  await expect.poll(async () => {
    const response = await request.get(
      `${os.url}/api/v1/device-action-tasks/${firstTask.task_uuid}`
    )
    return (await response.json() as { data: { status: string } }).data.status
  }).toBe('running')

  await page.goto(
    `/?section=device&localOsUrl=${encodeURIComponent(os.url)}`
  )
  const panel = page.locator('[data-device-management="panel"]')
  const deviceList = page.getByRole('complementary', { name: 'Edge 设备列表' })
  const workspace = page.locator('[data-device-management="workspace"]')
  await expect(panel.getByText('Edge 已连接', { exact: true })).toBeVisible()
  const deviceButton = deviceList.getByRole('button', {
    name: new RegExp(DEVICE_ID)
  })
  await expect(deviceButton).toBeVisible()
  await deviceButton.click()

  const actionButton = workspace.getByRole('button', {
    name: '单节点运行 动作节点'
  })
  await expect(actionButton).toContainText('占用中')
  await actionButton.click()
  const debugSection = workspace.locator('[data-device-management="debug-section"]')
  const runButton = debugSection.getByRole('button', { name: '运行此动作' })
  await expect(runButton).toBeEnabled()
  await expect(debugSection).toContainText('当前动作被占用')
  const durationInput = debugSection.locator('[data-device-management="field"] input').first()
  await durationInput.fill('3')
  await capture(page, artifactDirectory, screenshots, '01-parameter-and-busy-holder.png')
  await capture(
    debugSection,
    artifactDirectory,
    screenshots,
    '02-original-action-form-ready.png'
  )

  const acceptedResponsePromise = page.waitForResponse((response) =>
    response.url() === `${os.url}/api/v1/device-action-tasks` &&
    response.request().method() === 'POST'
  )
  await runButton.click()
  const acceptedResponse = await acceptedResponsePromise
  expect(acceptedResponse.status()).toBe(201)
  const acceptedEnvelope = await acceptedResponse.json() as {
    code: number
    data: Record<string, unknown> & { task_uuid: string; job_uuid: string }
  }
  expect(acceptedEnvelope.code).toBe(0)
  expect(acceptedEnvelope.data.status).toBe('pending')
  assertNoSystemSource(acceptedEnvelope.data)
  await expect(debugSection).toContainText('任务已接受')
  await expect(debugSection.getByText('等待执行', { exact: true })).toBeVisible()
  await capture(page, artifactDirectory, screenshots, '03-durable-pending-accepted.png')

  await expect(debugSection.getByText('执行中', { exact: true })).toBeVisible({
    timeout: 25_000
  })
  const executionLog = debugSection.getByLabel('Action 运行日志')
  await expect(executionLog).toContainText('"events"')
  await expect(executionLog).toContainText('"progress": 0.25')
  await capture(
    debugSection,
    artifactDirectory,
    screenshots,
    '04-running-feedback-event-stream.png'
  )
  await capture(page, artifactDirectory, screenshots, '05-device-busy-during-run.png')

  await expect(debugSection.getByText('执行成功', { exact: true })).toBeVisible({
    timeout: 15_000
  })
  await expect(executionLog).toContainText('"completed": true')
  await expect(executionLog).toContainText('"cycles": 3')
  await capture(
    debugSection,
    artifactDirectory,
    screenshots,
    '06-terminal-result-in-original-panel.png'
  )
  await expect(actionButton).toContainText('空闲')
  const rerunButton = debugSection.getByRole('button', { name: '再次运行' })
  await expect(rerunButton).toBeEnabled()
  await capture(page, artifactDirectory, screenshots, '07-free-and-rerun-enabled.png')

  await durationInput.fill('1')
  const rerunResponsePromise = page.waitForResponse((response) =>
    response.url() === `${os.url}/api/v1/device-action-tasks` &&
    response.request().method() === 'POST'
  )
  await rerunButton.click()
  expect((await rerunResponsePromise).status()).toBe(201)
  await expect(debugSection.getByText('执行成功', { exact: true })).toBeVisible({
    timeout: 10_000
  })
  await expect(debugSection.getByLabel('Action 运行日志')).toContainText(
    '"cycles": 1'
  )
  await capture(page, artifactDirectory, screenshots, '08-second-formal-run-succeeded.png')

  const timelineResponse = await request.get(`${os.url}/api/v1/timeline`)
  expect(timelineResponse.ok(), await timelineResponse.text()).toBe(true)
  const timeline = await timelineResponse.json() as {
    completed: Array<Record<string, unknown> & {
      job_id: string
      node_id: string
    }>
  }
  assertNoSystemSource(timeline)
  const acceptedTimelineEntry = timeline.completed.find(
    (entry) => entry.job_id === acceptedEnvelope.data.job_uuid
  )
  expect(acceptedTimelineEntry).toBeDefined()
  expect(acceptedTimelineEntry?.node_id).toBe(acceptedEnvelope.data.job_uuid)

  const monitorResponse = await request.get(
    `${os.url}/api/v1/monitor/snapshot`
  )
  expect(monitorResponse.ok(), await monitorResponse.text()).toBe(true)
  const monitorSnapshot = await monitorResponse.json() as Record<string, unknown>
  assertNoSystemSource(monitorSnapshot)
  expect(JSON.stringify(monitorSnapshot)).toContain(
    acceptedEnvelope.data.job_uuid
  )
  const schedulerWireChecks = {
    timeline: {
      path: '/api/v1/timeline',
      status: timelineResponse.status(),
      publicJobUuid: acceptedEnvelope.data.job_uuid,
      opaqueNodeIdentity: acceptedTimelineEntry?.node_id,
      internalSourceFields: 0
    },
    monitorSnapshot: {
      path: '/api/v1/monitor/snapshot',
      status: monitorResponse.status(),
      containsPublicJobUuid: true,
      internalSourceFields: 0
    }
  }

  const browserPosts = browserRequests.filter(
    (entry) => entry.method === 'POST' &&
      entry.path === '/api/v1/device-action-tasks'
  )
  expect(browserPosts).toHaveLength(2)
  for (const entry of browserPosts) assertNoSystemSource(entry.body)
  const feedbackRequests = browserRequests.filter(
    (entry) => entry.path.includes('/workflow-node-jobs/') &&
      entry.path.endsWith('/feedback')
  )
  expect(feedbackRequests.length).toBeGreaterThan(0)
  expect(feedbackRequests.length).toBeLessThanOrEqual(4)
  expect(browserRequests.some(
    (entry) => entry.path.startsWith('/api/v1/runtime/runs') ||
      entry.path.startsWith('/api/v1/runtime/events')
  )).toBe(false)
  expect(browserRequests.some(
    (entry) => entry.path.includes('/runtime/runs') ||
      entry.path.includes('/workflow-node-templates/') &&
        entry.method === 'POST'
  )).toBe(false)
  expect(websocketUrls).toEqual([
    `${os.url.replace(/^http/, 'ws')}/api/v1/ws/device_status`
  ])
  expect(browserErrors).toEqual([])
  expect(screenshots.length).toBeGreaterThanOrEqual(5)

  const exactShas = {
    core: gitSha(coreRoot),
    os: gitSha(os.root),
    fe: gitSha(process.cwd())
  }
  writeFileSync(
    join(artifactDirectory, 'network-ledger.json'),
    `${JSON.stringify({
      apiUrl: os.url,
      exactShas,
      task: {
        taskUuid: acceptedEnvelope.data.task_uuid,
        jobUuid: acceptedEnvelope.data.job_uuid
      },
      schedulerWireChecks,
      browserRequests,
      websocketUrls,
      browserErrors,
      forbiddenRoutes: {
        legacyRuntimeRuns: 0,
        legacyRuntimeEvents: 0,
        frontendDirectEdgeWebSocket: 0,
        systemWorkflowRead: 0
      },
      screenshots
    }, null, 2)}\n`
  )
  writeFileSync(join(artifactDirectory, 'os.log'), os.logs())
})

/**
 * 验证单动作任务终止后完成物理结算、释放设备动作锁，并保持手动解锁幂等。
 *
 * @param page 连接正式单动作任务接口与全局事件流的浏览器页面。
 * @param request 用于核对工作流任务、设备目录与手动解锁结果的 HTTP 客户端。
 * @returns 完成终止、释放、幂等解锁和再次运行的端到端验收。
 * @throws 终止超时、任务未安全结算、设备仍被占用或后续运行失败时由断言报告失败。
 * @safety 只有 OS 报告工作流任务已取消且清理完成后才断言设备动作可以复用。
 */
test('终止单动作任务后安全释放设备锁并允许再次运行', async ({
  page,
  request
}) => {
  test.setTimeout(90_000)
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto(
    `/?section=device&localOsUrl=${encodeURIComponent(os.url)}`
  )
  const deviceList = page.getByRole('complementary', {
    name: 'Edge 设备列表'
  })
  const workspace = page.locator('[data-device-management="workspace"]')
  const deviceButton = deviceList.getByRole('button', {
    name: new RegExp(DEVICE_ID)
  })
  await deviceButton.click()
  const actionButton = workspace.getByRole('button', {
    name: '单节点运行 动作节点'
  })
  await actionButton.click()
  const debugSection = workspace.locator('[data-device-management="debug-section"]')
  const durationInput = debugSection.locator('[data-device-management="field"] input').first()
  await durationInput.fill('30')

  const acceptedResponsePromise = page.waitForResponse((response) =>
    response.url() === `${os.url}/api/v1/device-action-tasks` &&
    response.request().method() === 'POST'
  )
  await debugSection.getByRole('button', { name: '运行此动作' }).click()
  const acceptedResponse = await acceptedResponsePromise
  expect(acceptedResponse.status()).toBe(201)
  const accepted = (await acceptedResponse.json() as {
    data: { task_uuid: string; job_uuid: string }
  }).data
  await expect(debugSection.getByText('执行中', { exact: true })).toBeVisible({
    timeout: 25_000
  })
  await expect(actionButton).toContainText('占用中')

  const cancelPath =
    `/api/v1/workflow-tasks/${accepted.task_uuid}/commands`
  const cancelResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === cancelPath &&
    response.request().method() === 'POST'
  )
  const cancelStartedAt = Date.now()
  await debugSection.getByRole('button', { name: '取消任务' }).click()
  const cancelResponse = await cancelResponsePromise
  expect(cancelResponse.status()).toBe(201)
  expect(Date.now() - cancelStartedAt).toBeLessThan(5_000)
  await expect(debugSection).toContainText('取消命令已接受')

  await expect(
    debugSection.getByText('已停止', { exact: true })
  ).toBeVisible({ timeout: 15_000 })
  await expect(debugSection).toContainText('动作任务已取消')
  await expect(actionButton).toContainText('空闲')

  const taskResponse = await request.get(
    `${os.url}/api/v1/device-action-tasks/${accepted.task_uuid}`
  )
  expect(taskResponse.ok(), await taskResponse.text()).toBe(true)
  const task = (await taskResponse.json() as {
    data: { status: string; cleanup_status: string }
  }).data
  expect(task).toMatchObject({ status: 'canceled', cleanup_status: 'settled' })

  const devicesResponse = await request.get(`${os.url}/api/v1/devices`)
  expect(devicesResponse.ok(), await devicesResponse.text()).toBe(true)
  const devices = (await devicesResponse.json() as DeviceCatalogEnvelope).data.items
  expect(devices.find((device) => device.id === DEVICE_ID)?.actions.find(
    (action) => action.actionRef === `${DEVICE_ID}.${ACTION_NAME}`
  )).toMatchObject({ busy: false, currentJobId: null })

  const unlockResponse = await request.post(
    `${os.url}/api/v1/devices/${DEVICE_ID}/actions/${ACTION_NAME}/commands`,
    {
      data: {
        command: 'force_unlock',
        expectedJobId: accepted.job_uuid,
        reason: 'operator_confirmed_device_safe'
      }
    }
  )
  expect(unlockResponse.ok(), await unlockResponse.text()).toBe(true)
  expect((await unlockResponse.json() as {
    data: { status: string; currentJobId: string | null }
  }).data).toEqual(expect.objectContaining({
    status: 'already_unlocked',
    currentJobId: null
  }))

  await durationInput.fill('1')
  await debugSection.getByRole('button', { name: '再次运行' }).click()
  await expect(
    debugSection.getByText('执行成功', { exact: true })
  ).toBeVisible({ timeout: 15_000 })
  await expect(actionButton).toContainText('空闲')
  expect(browserErrors).toEqual([])
})

async function capture(
  target: Page | Locator,
  directory: string,
  screenshots: string[],
  name: string
): Promise<void> {
  if ('goto' in target) {
    await target.screenshot({
      path: join(directory, name),
      animations: 'disabled',
      fullPage: true
    })
  } else {
    await target.screenshot({
      path: join(directory, name),
      animations: 'disabled'
    })
  }
  screenshots.push(name)
}

function assertNoSystemSource(value: unknown): void {
  const text = JSON.stringify(value)
  for (const forbidden of [
    'workflow_uuid',
    'workflow_node_uuid',
    'source_revision',
    'source_content',
    'source_uri',
    'execution_plan'
  ]) {
    expect(text).not.toContain(forbidden)
  }
}

function gitSha(directory: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: directory,
    encoding: 'utf8'
  }).trim()
}

async function startD1AOs(): Promise<RunningOs> {
  const root = resolve(requiredEnvironment('UNILAB_D1A_OS_ROOT'))
  const python = process.env.UNILAB_OS_PYTHON || 'python'
  const workingDirectory = mkdtempSync(join(tmpdir(), 'unilab-d1a-e2e-'))
  const port = await availablePort()
  const url = `http://127.0.0.1:${port}`
  const fixture = resolve(process.cwd(), 'e2e/fixtures/d1a-single-action-os.py')
  let output = ''
  const child = spawn(python, [fixture, workingDirectory], {
    cwd: root,
    env: {
      ...process.env,
      PYTHONPATH: root,
      PYTHONUNBUFFERED: '1',
      UNILAB_D1A_E2E_PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout?.on('data', (chunk) => { output += chunk.toString() })
  child.stderr?.on('data', (chunk) => { output += chunk.toString() })
  try {
    await waitUntilReady(url, child, () => output)
  } catch (error) {
    await stopChild(child)
    rmSync(workingDirectory, { recursive: true, force: true })
    throw error
  }
  return {
    root,
    url,
    workingDirectory,
    logs: () => output,
    stop: async () => {
      await stopChild(child)
      rmSync(workingDirectory, { recursive: true, force: true })
    }
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must point at the exact OS candidate`)
  return value
}

async function availablePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        rejectPort(new Error('Unable to allocate local port'))
        return
      }
      server.close((error) => {
        if (error) rejectPort(error)
        else resolvePort(address.port)
      })
    })
  })
}

async function waitUntilReady(
  url: string,
  child: ChildProcess,
  logs: () => string
): Promise<void> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`D1A OS exited with ${child.exitCode}\n${logs()}`)
    }
    try {
      const [devices, catalog] = await Promise.all([
        fetch(`${url}/api/v1/devices`),
        fetch(`${url}/api/v1/workflow-node-templates`)
      ])
      if (devices.ok && catalog.ok) return
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`D1A OS did not become ready\n${logs()}`)
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveWait) => setTimeout(resolveWait, 5000))
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}
