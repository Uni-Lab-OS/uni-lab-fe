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

const PREPARE_NODE_UUID = '20000000-0000-4000-8000-000000000021'
const ANALYZE_NODE_UUID = '20000000-0000-4000-8000-000000000022'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  os = await startPersistentAuthoringOs()
})

test.afterAll(async () => {
  await os?.stop()
})

/** 验证原工作流（Workflow）界面经真实 OS HTTP/SSE 驱动任务、作业和命令。 */
test('existing Workflow UI drives Task/Jobs/commands through real OS HTTP and SSE', async ({
  page
}) => {
  test.setTimeout(90_000)
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ||
      resolve(process.cwd(), '../e2e-artifacts/ui1b-debug-ui-parity')
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  const runtimeRequests: Array<{ method: string; path: string }> = []
  attachBrowserDiagnostics(page, browserErrors)
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (
      url.pathname.startsWith('/api/v1/workflow') ||
      url.pathname === '/api/v1/events'
    ) {
      runtimeRequests.push({ method: request.method(), path: url.pathname })
    }
  })
  await installWorkflowPanel(page, os.runtimeWorkflowUuid)

  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  const panel = page.locator('[data-panel-instance-id="runtime-workflow"]')

  await expect(panel.getByText('完整控制流 DAG')).toBeVisible()
  await expect(panel.getByRole('button', {
    name: '应用此版本',
    exact: true
  })).toBeVisible()
  await prepareAppliedWorkflow(panel, page)
  await expect(panel.getByRole('button', {
    name: '画布模式',
    exact: true
  })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByRole('button', {
    name: '开始运行',
    exact: true
  })).toBeEnabled()
  await expect(panel.getByRole('button', {
    name: `设为起始点 ${ANALYZE_NODE_UUID}`,
    exact: true
  })).toBeVisible()
  await expect(panel.getByRole('button', {
    name: `设置断点 ${PREPARE_NODE_UUID}`,
    exact: true
  })).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '01-original-debug-controls-ready.png'),
    fullPage: true
  })

  await panel.getByRole('button', {
    name: `设为起始点 ${ANALYZE_NODE_UUID}`,
    exact: true
  }).click()
  await expect(panel.getByText(
    '已设置调试器起始点；普通任务不携带此配置',
    { exact: true }
  )).toBeVisible()
  await expect(panel.locator('.wf-flow-node--start')).toHaveCount(1)
  await expect(panel.locator('.wf-flow-node--before-start')).toHaveCount(1)
  await expect(panel.locator('.cm-workflow-marker--start')).toHaveCount(1)
  await expect(panel.locator('.cm-workflow-marker--before-start')).toHaveCount(1)
  await page.screenshot({
    path: join(artifactDirectory, '02-start-node-dag-and-code.png'),
    fullPage: true
  })
  await panel.getByRole('button', {
    name: '画布模式',
    exact: true
  }).click()

  await panel.getByRole('button', {
    name: `设置断点 ${ANALYZE_NODE_UUID}`,
    exact: true
  }).click()
  await expect(panel.getByText(
    '已设置调试器断点；普通任务不携带此配置',
    { exact: true }
  )).toBeVisible()
  await expect(panel.locator('.wf-flow-node--breakpoint')).toHaveCount(1)
  await expect(panel.locator('.cm-workflow-marker--breakpoint')).toHaveCount(1)
  await page.screenshot({
    path: join(artifactDirectory, '03-breakpoint-dag-and-code.png'),
    fullPage: true
  })
  await panel.getByRole('button', {
    name: '画布模式',
    exact: true
  }).click()

  await panel.getByRole('button', {
    name: `取消断点 ${ANALYZE_NODE_UUID}`,
    exact: true
  }).click()
  await panel.getByRole('button', {
    name: `取消起始点 ${ANALYZE_NODE_UUID}`,
    exact: true
  }).click()
  await expect(panel.locator('.wf-flow-node--start')).toHaveCount(0)
  await expect(panel.locator('.wf-flow-node--before-start')).toHaveCount(0)
  await expect(panel.locator('.wf-flow-node--breakpoint')).toHaveCount(0)
  await panel.getByRole('button', {
    name: '代码模式',
    exact: true
  }).click()
  await expect(panel.locator('.cm-workflow-marker--start')).toHaveCount(0)
  await expect(panel.locator('.cm-workflow-marker--breakpoint')).toHaveCount(0)
  await page.screenshot({
    path: join(artifactDirectory, '04-debug-configuration-cleared.png'),
    fullPage: true
  })
  await panel.getByRole('button', {
    name: '画布模式',
    exact: true
  }).click()

  await panel.getByRole('button', {
    name: `设为起始点 ${ANALYZE_NODE_UUID}`,
    exact: true
  }).click()
  await panel.getByRole('button', {
    name: `设置断点 ${ANALYZE_NODE_UUID}`,
    exact: true
  }).click()

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
  const created = await createResponse
  expect(created.status()).toBe(201)
  const createdEnvelope = await created.json() as {
    data: { uuid: string }
  }
  const taskUuid = createdEnvelope.data.uuid
  const createTaskBody = created.request().postDataJSON() as Record<
    string,
    unknown
  >
  expect(createTaskBody).not.toHaveProperty('start_node_id')
  expect(createTaskBody).not.toHaveProperty('breakpoints')
  await expect(panel.locator('[data-run-status="pending"]')).toBeVisible()
  await expect(panel.locator('[data-node-state="pending"]')).toHaveCount(2)
  const analyzeOutputNode = panel.locator(
    '.workflow-runtime__node-list button[data-node-state="pending"]'
  ).nth(1)
  await analyzeOutputNode.click()
  await expect(panel.locator(
    `.react-flow__node[data-id="${ANALYZE_NODE_UUID}"]`
  )).toHaveClass(/wf-flow-node--runtime-selected/)
  const taskIdentity = panel.locator('.workflow-runtime__debug-summary')
    .locator('.is-meta')
    .filter({ hasText: /^任务/ })
  await expect(taskIdentity).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '05-task-created-with-jobs.png'),
    fullPage: true
  })

  await submitCommand(panel, page, 'pause')
  await expect(panel.locator('.is-meta').filter({
    hasText: '暂停 · OS 已接受'
  }))
    .toBeVisible()
  await expect(panel.getByText('已暂停', { exact: true })).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '06-pause-accepted-and-applied.png'),
    fullPage: true
  })

  await submitCommand(panel, page, 'resume')
  await expect(panel.locator('.is-meta').filter({
    hasText: '继续 · OS 已接受'
  }))
    .toBeVisible()
  await expect(panel.getByText('控制可用', { exact: true })).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '07-resume-accepted-and-applied.png'),
    fullPage: true
  })

  await submitCommand(panel, page, 'cancel')
  await expect(panel.locator('.is-meta').filter({
    hasText: '取消 · OS 已接受'
  }))
    .toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '08-cancel-durable-accepted.png'),
    fullPage: true
  })
  await expect(panel.locator('[data-run-status="canceled"]')).toBeVisible()
  await expect(panel.locator('[data-node-state="canceled"]')).toHaveCount(2)
  await expect(panel.getByText('执行已结束', { exact: true })).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '09-task-and-jobs-canceled.png'),
    fullPage: true
  })

  await page.reload()
  const restoredPanel = page.locator(
    '[data-panel-instance-id="runtime-workflow"]'
  )
  await expect(restoredPanel.locator('[data-run-status="canceled"]'))
    .toBeVisible()
  await expect(restoredPanel.locator('[data-node-state="canceled"]'))
    .toHaveCount(2)
  await expect(
    restoredPanel.getByTitle(taskUuid, { exact: true })
  ).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '10-reload-restores-task.png'),
    fullPage: true
  })

  expect(runtimeRequests).toEqual(expect.arrayContaining([
    { method: 'GET', path: '/api/v1/events' },
    { method: 'POST', path: '/api/v1/workflow-tasks' }
  ]))
  expect(runtimeRequests.some(({ path }) =>
    path.startsWith('/api/v1/runtime/runs')
  )).toBe(false)
  expect(browserErrors).toEqual([])
  writeFileSync(
    join(artifactDirectory, 'network-ledger.json'),
    `${JSON.stringify({ runtimeRequests, browserErrors }, null, 2)}\n`,
    'utf8'
  )
})

async function submitCommand(
  panel: import('@playwright/test').Locator,
  page: import('@playwright/test').Page,
  command: 'pause' | 'resume' | 'cancel'
): Promise<void> {
  const response = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url())
    return candidate.request().method() === 'POST' &&
      url.pathname.endsWith('/commands')
  })
  await panel.locator(`[data-runtime-command="${command}"]`).click()
  expect((await response).status()).toBe(201)
}
