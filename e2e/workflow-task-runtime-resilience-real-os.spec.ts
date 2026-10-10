import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  startPersistentAuthoringOs,
  type PersistentAuthoringOs
} from './helpers/persistent-authoring-os'
import {
  installWorkflowPanel,
  prepareAppliedWorkflow
} from './helpers/workflow-runtime-ui'
import { attachBrowserDiagnostics } from './helpers/browser-diagnostics'

let os: PersistentAuthoringOs

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  os = await startPersistentAuthoringOs({ faultProxy: true })
})

test.afterAll(async () => {
  await os?.stop()
})

/** 验证运行界面在真实 OS 故障中增量恢复反馈和一致状态。 */
test('original Runtime UI incrementally restores feedback and coherent state through real OS failures', async ({
  page
}) => {
  test.setTimeout(120_000)
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ||
      resolve(process.cwd(), '../e2e-artifacts/ui1c-runtime-resilience')
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  const runtimeRequests: string[] = []
  const runtimeEventCursors: string[] = []
  const runtimeResponses: Array<{ method: string; path: string; status: number }> = []
  const osRequests: Array<{
    method: string
    path: string
    lastEventId: string
  }> = []
  const osResponses: Array<{ method: string; path: string; status: number }> = []
  const websocketUrls: string[] = []
  attachBrowserDiagnostics(page, browserErrors)
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin === new URL(os.url).origin) {
      osRequests.push({
        method: request.method(),
        path: `${url.pathname}${url.search}`,
        lastEventId: request.headers()['last-event-id'] || ''
      })
    }
    if (url.pathname.startsWith('/api/v1/workflow-')) {
      runtimeRequests.push(`${request.method()} ${url.pathname}${url.search}`)
    }
    if (url.pathname === '/api/v1/events') {
      runtimeEventCursors.push(request.headers()['last-event-id'] || '')
    }
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin === new URL(os.url).origin) {
      osResponses.push({
        method: response.request().method(),
        path: `${url.pathname}${url.search}`,
        status: response.status()
      })
    }
    if (url.pathname.startsWith('/api/v1/workflow-')) {
      runtimeResponses.push({
        method: response.request().method(),
        path: url.pathname,
        status: response.status()
      })
    }
  })
  page.on('websocket', (socket) => websocketUrls.push(socket.url()))
  await installWorkflowPanel(page, os.runtimeWorkflowUuid)
  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  const panel = page.locator('[data-panel-instance-id="runtime-workflow"]')
  await prepareAppliedWorkflow(panel, page)

  const createResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'POST' &&
      url.pathname === '/api/v1/workflow-tasks'
  })
  await panel.getByRole('button', {
    name: '开始运行',
    exact: true
  }).click()
  await page.getByRole('button', {
    name: '使用以上参数运行',
    exact: true
  }).click()
  const createdResponse = await createResponse
  expect(createdResponse.status()).toBe(201)
  const createdEnvelope = await createdResponse.json() as {
    data: { uuid: string }
  }
  const taskUuid = createdEnvelope.data.uuid
  const jobsResponse = await fetch(
    `${os.upstreamUrl}/api/v1/workflow-tasks/${taskUuid}/jobs`
  )
  expect(jobsResponse.status).toBe(200)
  const jobsEnvelope = await jobsResponse.json() as {
    data: Array<{ uuid: string }>
  }
  const firstJobUuid = jobsEnvelope.data[0]?.uuid
  expect(firstJobUuid).toBeTruthy()

  await os.startRuntimeJob(taskUuid, firstJobUuid || '')
  await os.commitJobFeedback(firstJobUuid || '', [{
    sequence: 1,
    feedback_type: 'progress',
    data: { progress: 25, temperature_c: 23.5 },
    observed_at: '2026-08-01T05:00:01Z',
    idempotency_key: 'ui1c-feedback-1'
  }])

  await expect(panel.locator('[data-run-status="running"]')).toBeVisible()
  await expect(panel.locator('[data-node-state="running"]')).toHaveCount(1)
  const eventStreamTab = panel.getByRole('tab', {
    name: /事件流/,
    exact: false
  })
  await expect(panel.getByRole('tab', { name: /Feedback/ })).toHaveCount(0)
  await eventStreamTab.click()
  const feedbackPanel = panel.locator('#workflow-output-panel-events')
  await expect(feedbackPanel.getByText('动作反馈', { exact: true })).toBeVisible()
  const feedbackEvents = feedbackPanel.locator(
    '[data-event-kind="node.feedback"]'
  )
  await expect(feedbackEvents).toHaveCount(1)
  await openLatestFeedbackRaw(feedbackPanel)
  await expect(feedbackPanel.getByText(/temperature_c.*23\.5/)).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '01-first-feedback-visible.png'),
    fullPage: true
  })

  await os.commitJobFeedback(firstJobUuid || '', [{
    sequence: 2,
    feedback_type: 'progress',
    data: { progress: 60, temperature_c: 24.25 },
    observed_at: '2026-08-01T05:00:02Z',
    idempotency_key: 'ui1c-feedback-2'
  }])
  await expect(feedbackEvents).toHaveCount(2)
  await openLatestFeedbackRaw(feedbackPanel)
  await expect(feedbackPanel.getByText(/temperature_c.*24\.25/)).toBeVisible()
  await expect.poll(() => runtimeRequests.some((request) =>
    request.includes(`/workflow-node-jobs/${firstJobUuid}/feedback?`) &&
    request.includes('after_sequence=1')
  )).toBe(true)
  await page.screenshot({
    path: join(artifactDirectory, '02-feedback-cursor-incremental.png'),
    fullPage: true
  })

  os.failNextRequest({
    method: 'GET',
    path: `/api/v1/workflow-tasks/${taskUuid}/jobs`,
    status: 503
  })
  await os.commitJobFeedback(firstJobUuid || '', [{
    sequence: 3,
    feedback_type: 'progress',
    data: { progress: 75, temperature_c: 24.75 },
    observed_at: '2026-08-01T05:00:03Z',
    idempotency_key: 'ui1c-feedback-3'
  }])
  const runtimeProblem = panel.getByRole('alert').filter({
    hasText: '运行状态读取失败'
  })
  await expect(runtimeProblem).toBeVisible()
  await expect(runtimeProblem).toContainText('上一次一致状态已保留')
  await expect(runtimeProblem.getByRole('button', {
    name: '重试状态读取',
    exact: true
  })).toBeVisible()
  await expect(panel.locator('[data-node-state="running"]')).toHaveCount(1)
  await expect(feedbackEvents).toHaveCount(2)
  await page.screenshot({
    path: join(artifactDirectory, '03-partial-read-keeps-coherent-state.png'),
    fullPage: true
  })

  const retryProjectionButton = runtimeProblem.getByRole('button', {
    name: '重试状态读取',
    exact: true
  })
  await retryProjectionButton.focus()
  await expect(retryProjectionButton).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(runtimeProblem).toBeHidden()
  await expect(feedbackEvents).toHaveCount(3)
  await openLatestFeedbackRaw(feedbackPanel)
  await expect(feedbackPanel.getByText(/temperature_c.*24\.75/)).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '04-partial-read-recovered.png'),
    fullPage: true
  })

  const realtimeMetadata = panel.locator('.is-meta').filter({
    hasText: '实时同步'
  })
  await expect(realtimeMetadata).toContainText('已连接')

  await os.stopProcess()
  await expect(realtimeMetadata).toContainText('正在重连', {
    timeout: 15_000
  })
  await expect(panel.getByRole('alert').filter({
    hasText: '运行状态读取失败'
  })).toContainText('Runtime 实时同步中断')
  await page.screenshot({
    path: join(artifactDirectory, '05-sse-reconnecting.png'),
    fullPage: true
  })

  await os.restart()
  await expect(realtimeMetadata).toContainText('已连接', {
    timeout: 20_000
  })
  await expect(panel.getByRole('alert').filter({
    hasText: '工作流编辑操作失败'
  })).toBeHidden()
  await page.screenshot({
    path: join(artifactDirectory, '06-sse-reconnected.png'),
    fullPage: true
  })

  await expect(panel.getByText('等待状态核对', { exact: true })).toBeVisible()
  await panel.getByRole('tab', { name: /节点任务状态/ }).click()
  await expect(panel.locator('[data-node-state="execution_unknown"]')).toHaveCount(1)
  await expect(panel.getByText('执行状态未知', { exact: true })).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '07-os-restart-uncertainty-restored.png'),
    fullPage: true
  })

  await page.reload()
  await expect(panel.getByText('等待状态核对', { exact: true })).toBeVisible()
  await expect(panel.locator('[data-node-state="execution_unknown"]')).toHaveCount(1)
  await panel.getByRole('tab', { name: /事件流/ }).click()
  await expect(feedbackEvents).toHaveCount(3)
  await expect(feedbackPanel.getByText('动作反馈', { exact: true }))
    .toHaveCount(3)
  await page.screenshot({
    path: join(artifactDirectory, '08-reload-restores-feedback.png'),
    fullPage: true
  })

  expect(runtimeResponses).toContainEqual({
    method: 'GET',
    path: `/api/v1/workflow-tasks/${taskUuid}/jobs`,
    status: 503
  })
  expect(runtimeEventCursors.some(Boolean)).toBe(true)
  expect(osRequests.some((request) =>
    request.path.includes('/api/v1/runtime/runs') ||
    request.path.includes('/ws')
  )).toBe(false)
  // 设备状态订阅已按页面作用域收敛；工作流（Workflow）页面不得建立设备 WebSocket。
  expect(websocketUrls).toEqual([])

  const expectedNetworkDiagnostics = browserErrors.filter((message) =>
    message.startsWith('Failed to load resource:')
  )
  const applicationErrors = browserErrors.filter((message) =>
    !message.startsWith('Failed to load resource:')
  )
  writeFileSync(
    join(artifactDirectory, 'network-ledger.json'),
    `${JSON.stringify({
      osRequests,
      osResponses,
      runtimeRequests,
      runtimeResponses,
      runtimeEventCursors,
      websocketUrls,
      expectedNetworkDiagnostics,
      applicationErrors
    }, null, 2)}\n`,
    'utf8'
  )

  expect(expectedNetworkDiagnostics.length).toBeGreaterThanOrEqual(1)
  expect(applicationErrors).toEqual([])
})

async function openLatestFeedbackRaw(
  panel: import('@playwright/test').Locator
): Promise<void> {
  const event = panel.locator('[data-event-kind="node.feedback"]').first()
  const details = event.locator('.workflow-runtime__event-raw')
  if (await details.getAttribute('open') === null) {
    await details.locator('summary').click()
  }
  await expect(details.locator('pre')).toBeVisible()
}
