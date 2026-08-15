import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

import { expect, test, type APIRequestContext } from '@playwright/test'

let API_URL = ''
let osProcess: ChildProcess | undefined
const DEVICE_ID = 'TestAction1'
const ACTION_NAME = 'test_hold'
const ACTION_LABEL = '保持动作'
const ACTION_REF = `${DEVICE_ID}.${ACTION_NAME}`
const HOLDER_JOB_ID = 'e2e-holder-00000000-0000-0000-0000-000000000001'
const REUSE_JOB_ID = 'e2e-reuse-00000000-0000-0000-0000-000000000002'

interface CatalogAction {
  actionRef: string
  busy: boolean
  currentJobId: string | null
}

interface CatalogDevice {
  id: string
  actions: CatalogAction[]
}

interface DeviceCatalogEnvelope {
  code: number
  data: {
    items: CatalogDevice[]
  }
}

interface LedgerEntry {
  method: string
  path: string
  body?: unknown
  status?: number
}

test.beforeAll(async () => {
  const port = await availablePort()
  API_URL = `http://127.0.0.1:${port}`
  const osRoot = resolve(
    process.env.UNILAB_E2E_OS_ROOT ?? resolve(process.cwd(), '../Uni-Lab-OS')
  )
  const python = process.env.UNILAB_OS_PYTHON ?? 'python3'
  const fixture = resolve(
    process.cwd(),
    'e2e/fixtures/device-manual-unlock-os.py'
  )
  osProcess = spawn(python, [fixture], {
    cwd: osRoot,
    env: {
      ...process.env,
      PYTHONPATH: osRoot,
      PYTHONUNBUFFERED: '1',
      UNILAB_E2E_DEVICE_API_PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  osProcess.stdout?.on('data', (chunk) => { output += String(chunk) })
  osProcess.stderr?.on('data', (chunk) => { output += String(chunk) })
  await waitForFixture(osProcess, () => output)
})

test.afterAll(async () => {
  await stopFixture(osProcess)
})

async function setupRequest(
  request: APIRequestContext,
  ledger: LedgerEntry[],
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
) {
  const url = `${API_URL}${path}`
  const response = method === 'GET'
    ? await request.get(url)
    : method === 'POST'
      ? await request.post(url, { data: body })
      : await request.delete(url)
  ledger.push({ method, path, body, status: response.status() })
  return response
}

async function readTargetAction(
  request: APIRequestContext,
  setupLedger: LedgerEntry[]
): Promise<CatalogAction | null> {
  const response = await setupRequest(
    request,
    setupLedger,
    'GET',
    '/api/v1/devices'
  )
  if (!response.ok()) return null
  const envelope = (await response.json()) as DeviceCatalogEnvelope
  expect(envelope.code).toBe(0)
  return envelope.data.items
    .find((device) => device.id === DEVICE_ID)
    ?.actions.find((action) => action.actionRef === ACTION_REF) ?? null
}

/**
 * 验证操作员识别并安全解除当前 OS 动作锁，且不会创建新的执行任务。
 *
 * @param page 展示设备动作锁、确认弹窗与解锁结果的浏览器页面。
 * @param request 构造测试持锁任务并复核正式设备目录状态的 HTTP 客户端。
 * @returns 完成持锁、人工解锁、再次占用和最终释放的端到端验收。
 * @throws 页面、网络契约或设备锁状态不符合预期时由 Playwright 断言报告失败。
 * @safety 人工解锁必须携带当前 Job 身份和显式安全确认，且不得创建新的单动作任务。
 */
test('操作员识别并手动解除当前 OS 动作锁', async ({
  page,
  request
}) => {
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR
      || resolve(process.cwd(), '../e2e-artifacts/device-manual-unlock-current')
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  const browserRequests: LedgerEntry[] = []
  const setupRequests: LedgerEntry[] = []
  const commandBodies: unknown[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('request', (incoming) => {
    if (!incoming.url().startsWith(API_URL)) return
    const path = new URL(incoming.url()).pathname
    let body: unknown
    if (incoming.method() === 'POST') {
      try {
        body = incoming.postDataJSON()
      } catch {
        body = incoming.postData()
      }
    }
    browserRequests.push({
      method: incoming.method(),
      path,
      body
    })
    if (incoming.method() === 'POST' && path.endsWith('/commands')) {
      commandBodies.push(body)
    }
  })
  page.on('response', (response) => {
    if (!response.url().startsWith(API_URL)) return
    const path = new URL(response.url()).pathname
    const entry = [...browserRequests].reverse().find(
      (candidate) => candidate.path === path && candidate.status == null
    )
    if (entry) entry.status = response.status()
  })

  const initialAction = await readTargetAction(request, setupRequests)
  expect(initialAction, `${ACTION_REF} must exist in current OS catalog`).not.toBeNull()
  expect(initialAction).toMatchObject({ busy: false, currentJobId: null })

  const fixturePath =
    `/__e2e/device-actions/${DEVICE_ID}/${ACTION_NAME}/holders`
  const holderResponse = await setupRequest(
    request,
    setupRequests,
    'POST',
    fixturePath,
    { jobId: HOLDER_JOB_ID, taskId: 'e2e-task-holder' }
  )
  expect(holderResponse.ok(), await holderResponse.text()).toBe(true)
  await expect.poll(async () => {
    const action = await readTargetAction(request, setupRequests)
    return action?.busy && action.currentJobId
      ? action.currentJobId
      : null
  }).toBe(HOLDER_JOB_ID)

  await page.goto(
    `/?section=device&localOsUrl=${encodeURIComponent(API_URL)}`
  )

  const deviceList = page.getByRole('complementary', {
    name: 'Edge 设备列表'
  })
  const workspace = page.locator('[data-device-management="workspace"]')
  const deviceButton = deviceList.getByRole('button', {
    name: new RegExp(DEVICE_ID)
  })
  await expect(deviceButton).toBeVisible()

  await page.screenshot({
    path: join(artifactDirectory, '01-locked-device-detected.png'),
    fullPage: true,
    animations: 'disabled'
  })
  await deviceButton.screenshot({
    path: join(artifactDirectory, '02-device-list-lock-badge.png'),
    animations: 'disabled'
  })

  await deviceButton.click()
  await expect(
    workspace.getByText('已锁定 · 1 个动作', { exact: true })
  ).toBeVisible()
  await workspace.locator('[data-device-management="identity"]').screenshot({
    path: join(artifactDirectory, '03-device-header-lock-state.png'),
    animations: 'disabled'
  })

  const actionButton = workspace.getByRole('button', {
    name: `${ACTION_LABEL} 动作节点`
  })
  await expect(actionButton).toContainText('占用中')
  await actionButton.click()
  await workspace.locator('[data-device-management="action-section"]').screenshot({
    path: join(artifactDirectory, '04-action-catalog-busy-state.png'),
    animations: 'disabled'
  })

  const lockPanel = workspace.getByLabel('设备动作锁状态')
  await expect(lockPanel.getByText('此动作被设备锁占用')).toBeVisible()
  await expect(lockPanel.getByText('Job e2e-hold')).toBeVisible()
  await expect(
    lockPanel.getByRole('button', { name: '手动解锁' })
  ).toBeVisible()
  await lockPanel.screenshot({
    path: join(artifactDirectory, '05-lock-holder-and-manual-action.png'),
    animations: 'disabled'
  })

  await lockPanel.getByRole('button', { name: '手动解锁' }).click()
  const dialog = page.getByRole('dialog', { name: '确认手动解锁' })
  const confirmButton = dialog.getByRole('button', { name: '确认并解锁' })
  await expect(dialog.getByText(ACTION_REF, { exact: true })).toBeVisible()
  await expect(dialog.getByText(HOLDER_JOB_ID, { exact: true })).toBeVisible()
  await expect(confirmButton).toBeDisabled()
  await dialog.screenshot({
    path: join(artifactDirectory, '06-safety-confirmation-required.png'),
    animations: 'disabled'
  })

  await dialog.getByRole('checkbox').check()
  await expect(confirmButton).toBeEnabled()
  await dialog.screenshot({
    path: join(artifactDirectory, '07-safety-confirmation-accepted.png'),
    animations: 'disabled'
  })

  await confirmButton.click()
  await expect(dialog).not.toBeVisible()
  await expect(
    workspace.getByText('动作锁已释放', { exact: true })
  ).toBeVisible()
  await expect(actionButton).toContainText('空闲')
  await page.screenshot({
    path: join(artifactDirectory, '08-os-confirmed-unlocked.png'),
    fullPage: true,
    animations: 'disabled'
  })
  await workspace.locator('[data-device-management="debug-section"]').screenshot({
    path: join(artifactDirectory, '09-action-ready-after-refetch.png'),
    animations: 'disabled'
  })

  await expect.poll(async () => {
    const action = await readTargetAction(request, setupRequests)
    return action
      ? { busy: action.busy, currentJobId: action.currentJobId }
      : null
  }).toEqual({ busy: false, currentJobId: null })

  const reuseResponse = await setupRequest(
    request,
    setupRequests,
    'POST',
    fixturePath,
    { jobId: REUSE_JOB_ID, taskId: 'e2e-task-reuse' }
  )
  expect(reuseResponse.ok(), await reuseResponse.text()).toBe(true)
  await expect.poll(async () => {
    const action = await readTargetAction(request, setupRequests)
    return action?.busy ? action.currentJobId : null
  }).toBe(REUSE_JOB_ID)
  await deviceList.getByRole('button', { name: '刷新' }).click()
  await expect(actionButton).toContainText('占用中')
  await page.screenshot({
    path: join(artifactDirectory, '10-new-holder-after-unlock.png'),
    fullPage: true,
    animations: 'disabled'
  })

  const finishResponse = await setupRequest(
    request,
    setupRequests,
    'DELETE',
    `${fixturePath}/${REUSE_JOB_ID}`
  )
  expect(finishResponse.ok(), await finishResponse.text()).toBe(true)
  await expect.poll(async () => {
    const action = await readTargetAction(request, setupRequests)
    return action
      ? { busy: action.busy, currentJobId: action.currentJobId }
      : null
  }).toEqual({ busy: false, currentJobId: null })

  const commandPath =
    `/api/v1/devices/${DEVICE_ID}/actions/${ACTION_NAME}/commands`
  expect(browserRequests).toEqual(expect.arrayContaining([
    expect.objectContaining({ method: 'GET', path: '/api/v1/devices' }),
    expect.objectContaining({ method: 'POST', path: commandPath })
  ]))
  expect(commandBodies).toEqual([{
    command: 'force_unlock',
    expectedJobId: HOLDER_JOB_ID,
    reason: 'operator_confirmed_device_safe'
  }])
  expect(browserErrors).toEqual([])

  const allRequests = [...setupRequests, ...browserRequests]
  expect(allRequests.some(
    (entry) => entry.path.startsWith('/api/v1/runtime/runs')
  )).toBe(false)
  expect(browserRequests).toEqual(expect.arrayContaining([
    expect.objectContaining({
      method: 'GET',
      path: '/api/v1/workflow-node-templates'
    })
  ]))
  expect(allRequests.some(
    (entry) => entry.method === 'POST' &&
      entry.path === '/api/v1/device-action-tasks'
  )).toBe(false)

  writeFileSync(
    join(artifactDirectory, 'network-ledger.json'),
    `${JSON.stringify({
      apiUrl: API_URL,
      actionRef: ACTION_REF,
      fixtureSurface: '/__e2e/device-actions/*/holders',
      setupRequests,
      browserRequests,
      commandBodies,
      forbiddenRoutes: {
        runtimeRuns: 0,
        deviceActionTaskCreates: 0,
        frontendDirectEdgeWebSocket: 0
      },
      browserErrors
    }, null, 2)}\n`
  )
})

async function availablePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        rejectPort(new Error('无法分配人工解锁测试端口'))
        return
      }
      server.close((error) => {
        if (error) rejectPort(error)
        else resolvePort(address.port)
      })
    })
  })
}

async function waitForFixture(
  child: ChildProcess,
  logs: () => string
): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`人工解锁测试 OS 已退出（${child.exitCode}）\n${logs()}`)
    }
    try {
      const response = await fetch(`${API_URL}/api/v1/devices`)
      if (response.ok) return
    } catch {
      // 测试 OS 仍在启动。
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`人工解锁测试 OS 启动超时\n${logs()}`)
}

async function stopFixture(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode != null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveWait) => setTimeout(resolveWait, 3_000))
  ])
  if (child.exitCode == null) child.kill('SIGKILL')
}
