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
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (
      url.pathname.startsWith('/api/v1/workflow') ||
      url.pathname.startsWith('/api/v1/debug/workflow') ||
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
  await prepareAppliedWorkflow(panel, page)
  await panel.getByRole('button', {
    name: '画布模式',
    exact: true
  }).click()
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
    '已设置调试器起始点；运行模式已切换为调试启动',
    { exact: true }
  )).toBeVisible()
  await expect(panel.getByRole('button', {
    name: '调试启动',
    exact: true
  })).toBeEnabled()
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
    '已设置调试器断点；运行模式已切换为调试启动',
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

  const preflightResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'POST' &&
      url.pathname === '/api/v1/debug/workflow-tasks:preflight'
  })
  const createResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'POST' &&
      url.pathname === '/api/v1/debug/workflow-tasks'
  })
  await panel.getByRole('button', {
    name: '调试启动',
    exact: true
  }).click()
  await page.getByRole('button', {
    name: '使用以上参数运行',
    exact: true
  }).click()
  expect((await preflightResponse).status()).toBe(200)
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
  expect(createTaskBody).toMatchObject({
    workflow_uuid: os.runtimeWorkflowUuid,
    start_node_uuids: [ANALYZE_NODE_UUID],
    breakpoint_node_uuids: [ANALYZE_NODE_UUID],
    launch_overrides: [],
    meta_data: { source: 'unilab-workbench-debugger' }
  })
  expect(createTaskBody).toHaveProperty('preflight_hash')

  const projectionResponse = await fetch(
    `${os.upstreamUrl}/api/v1/debug/workflow-tasks/${taskUuid}`
  )
  expect(projectionResponse.status).toBe(200)
  const projectionEnvelope = await projectionResponse.json() as {
    data: {
      active_node_uuids: string[]
      out_of_scope_node_uuids: string[]
      jobs: Array<{ workflow_node_uuid: string; status: string }>
      holds: Array<{
        workflow_node_uuid: string
        reason: string
        status: string
      }>
    }
  }
  expect(projectionEnvelope.data.active_node_uuids).toEqual([
    ANALYZE_NODE_UUID
  ])
  expect(projectionEnvelope.data.out_of_scope_node_uuids).toContain(
    PREPARE_NODE_UUID
  )
  expect(projectionEnvelope.data.jobs).toEqual([
    expect.objectContaining({
      workflow_node_uuid: ANALYZE_NODE_UUID,
      status: 'pending'
    })
  ])
  expect(projectionEnvelope.data.holds).toEqual([
    expect.objectContaining({
      workflow_node_uuid: ANALYZE_NODE_UUID,
      reason: 'start',
      status: 'open'
    })
  ])
  await expect(panel.getByRole('button', { name: /暂停位置/ })).toBeVisible()
  await expect(panel.getByRole('region', {
    name: '调试控制台'
  })).toContainText('已在节点前暂停')
  await page.screenshot({
    path: join(artifactDirectory, '05-debug-task-paused-before-start.png'),
    fullPage: true
  })

  await page.reload()
  const restoredPanel = page.locator(
    '[data-panel-instance-id="runtime-workflow"]'
  )
  await expect(restoredPanel.getByRole('button', { name: /暂停位置/ }))
    .toBeVisible()
  await expect(restoredPanel.getByRole('region', {
    name: '调试控制台'
  })).toContainText('已在节点前暂停')
  await page.screenshot({
    path: join(artifactDirectory, '06-reload-restores-debug-hold.png'),
    fullPage: true
  })

  expect(runtimeRequests).toEqual(expect.arrayContaining([
    { method: 'GET', path: '/api/v1/events' },
    { method: 'POST', path: '/api/v1/debug/workflow-tasks:preflight' },
    { method: 'POST', path: '/api/v1/debug/workflow-tasks' }
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
