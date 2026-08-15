import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DEMO_WORKFLOW_UUID = '50000000-0000-4000-8000-000000000001'
const DEMO_HEAT_NODE_UUID = '60000000-0000-4000-8000-000000000001'
const enabled = process.env.UNILAB_E2E_BACKEND_RUNTIME === '1'
const workbenchUrl = process.env.UNILAB_WORKBENCH_URL ??
  'http://127.0.0.1:3110/#/home/wangtao/Uni-Lab-SZLab'

test.skip(
  !enabled,
  '需要显式启动 Workbench、PostgreSQL、Backend、Scheduler 与 mock Edge'
)

/** 验证 Backend 已有工作流的只读画布、三种正式运行模式及真实 Scheduler 结果。 */
test('runs all existing Backend Workflow modes through the real Scheduler and mock Edge', async ({
  page
}) => {
  test.setTimeout(150_000)
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ??
      resolve(process.cwd(), '../e2e-artifacts/backend-existing-workflow')
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  const failedResponses: Array<{ path: string; status: number }> = []
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !message.text().startsWith('Failed to load resource:')
    ) browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (
      response.status() >= 400 &&
      // Backend 尚未提供可选 3D 形状目录；工作流运行不依赖该接口。
      !path.endsWith('/api/v1/material-shapes')
    ) {
      failedResponses.push({
        path,
        status: response.status()
      })
    }
  })
  await installCatalogPanel(page)

  await page.goto(workbenchUrl)
  const edgeConnection = page.getByLabel(/^运行连接：Edge \/ OS /)
  const backendOption = page.getByRole('button', {
    name: /Backend \+ Scheduler/
  })
  await expect(edgeConnection).toBeVisible()
  if (!await backendOption.isVisible()) await edgeConnection.click()
  await expect(backendOption).toBeVisible()
  await backendOption.click()

  const workbench = page.locator(
    '.unilab-workbench[data-connection-mode="backend"]'
  )
  await expect(workbench).toHaveAttribute(
    'data-authority-profile',
    'backend_controlled'
  )
  await expect(workbench).toHaveAttribute('data-backend-id', 'local-go')

  const panel = page.getByRole('region', { name: '工作流窗口' })
  await expect(panel.getByText('工作流目录', { exact: true })).toBeVisible()
  await expect(panel.getByText('样品加热与定量输送', { exact: true })).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '01-backend-workflow-catalog.png'),
    fullPage: true
  })

  await panel.getByRole('button', {
    name: '运行工作流 样品加热与定量输送',
    exact: true
  }).click()
  const canvas = panel.getByRole('region', { name: '工作流画布' })
  await expect(canvas.getByText('Backend 定义 · 只读', { exact: true }))
    .toBeVisible()
  await expect(canvas.locator('[data-workflow-node-uuid]')).toHaveCount(2)
  await expect(canvas.locator('.react-flow__edge')).toHaveCount(1)
  await expect(canvas.getByText('加热至 60°C', { exact: true })).toBeVisible()
  await expect(canvas.getByText('输送 5 mL', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: '保存工作流' })).toBeDisabled()
  await expect(panel.getByRole('button', { name: '画布模式' }))
    .toHaveAttribute('aria-pressed', 'true')
  const layoutStrategy = panel.getByLabel('布局策略')
  await layoutStrategy.selectOption('primary-sample-serpentine')
  await expect(canvas.locator('.react-flow'))
    .toHaveClass(/wf-layout--primary-sample-serpentine/)
  await expect(panel.getByRole('button', {
    name: '只看主物料',
    exact: true
  })).toBeVisible()
  const fullBranches = panel.getByRole('button', {
    name: '完整支线',
    exact: true
  })
  await expect(fullBranches).toBeVisible()
  await fullBranches.click()
  await expect(canvas.locator(
    '[data-workflow-supporting-material-presentation="full-branches"]'
  )).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '02-existing-workflow-ready.png'),
    fullPage: true
  })

  const createResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/api/v1/workflow-tasks')
  ))
  await panel.getByRole('button', {
    name: '运行已有工作流',
    exact: true
  }).click()
  const createResponse = await createResponsePromise
  expect(createResponse.status()).toBe(201)
  const createBody = createResponse.request().postDataJSON() as Record<string, unknown>
  expect(createBody).toEqual({
    workflow_uuid: DEMO_WORKFLOW_UUID,
    run_mode: 'normal',
    inventory_bindings: []
  })
  const created = await createResponse.json() as { data: { uuid: string } }

  await expect.poll(async () => {
    const response = await page.request.get(
      `/__unilab_backend/api/v1/workflow-tasks/${created.data.uuid}`
    )
    const envelope = await response.json() as { data: { status: string } }
    return envelope.data.status
  }, { timeout: 30_000 }).toBe('succeeded')

  await panel.getByRole('button', { name: '刷新状态', exact: true }).click()
  await expect(panel.locator('.persistent-authoring__task-status'))
    .toContainText('执行成功')
  await expect(panel.locator('.workflow-runtime__output-title'))
    .toContainText('2/2')
  await expect(canvas.locator('.react-flow__node.wf-flow-node--success'))
    .toHaveCount(2)
  await expect(panel.locator('.workflow-runtime__node-list button'))
    .toHaveCount(2)
  await page.screenshot({
    path: join(artifactDirectory, '03-existing-workflow-succeeded.png'),
    fullPage: true
  })

  await panel.getByRole('button', { name: '配置运行方式' }).click()
  await panel.getByText('单节点调试', { exact: true }).click()
  await panel.getByLabel('目标节点').selectOption(DEMO_HEAT_NODE_UUID)
  await expect(panel.getByText('已通过 · 1 个执行节点', { exact: true }))
    .toBeVisible()
  const singleNodeResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/api/v1/workflow-tasks')
  ))
  await panel.getByRole('button', {
    name: '创建单节点运行任务',
    exact: true
  }).click()
  const singleNodeResponse = await singleNodeResponsePromise
  expect(singleNodeResponse.status()).toBe(201)
  expect(singleNodeResponse.request().postDataJSON()).toEqual({
    workflow_uuid: DEMO_WORKFLOW_UUID,
    run_mode: 'single_node',
    target_node_uuid: DEMO_HEAT_NODE_UUID,
    inventory_bindings: []
  })
  const singleNodeCreated = await singleNodeResponse.json() as {
    data: { uuid: string }
  }
  await expect.poll(
    () => workflowTaskStatus(page, singleNodeCreated.data.uuid),
    { timeout: 30_000 }
  ).toBe('succeeded')
  await panel.getByRole('button', { name: '刷新状态', exact: true }).click()
  await expect(panel.locator('.workflow-runtime__output-title'))
    .toContainText('1/1')
  await expect(canvas.locator(
    `[data-workflow-node-uuid="${DEMO_HEAT_NODE_UUID}"]`
  ).locator('xpath=..')).toHaveClass(/wf-flow-node--success/)
  await page.screenshot({
    path: join(artifactDirectory, '04-existing-workflow-single-node-succeeded.png'),
    fullPage: true
  })

  await panel.getByRole('button', { name: '配置运行方式' }).click()
  await panel.getByText('单步运行', { exact: true }).click()
  await expect(panel.getByText('已通过 · 2 个执行节点', { exact: true }))
    .toBeVisible()
  const stepCreateResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/api/v1/workflow-tasks')
  ))
  await panel.getByRole('button', {
    name: '创建单步运行任务',
    exact: true
  }).click()
  const stepCreateResponse = await stepCreateResponsePromise
  expect(stepCreateResponse.status()).toBe(201)
  expect(stepCreateResponse.request().postDataJSON()).toEqual({
    workflow_uuid: DEMO_WORKFLOW_UUID,
    run_mode: 'step',
    inventory_bindings: []
  })
  const stepCreated = await stepCreateResponse.json() as {
    data: { uuid: string }
  }
  await expect.poll(
    () => workflowTaskControlStatus(page, stepCreated.data.uuid),
    { timeout: 30_000 }
  ).toBe('paused')
  await panel.getByRole('button', { name: '刷新状态', exact: true }).click()
  await expect(panel.getByRole('button', { name: '单步', exact: true }))
    .toBeEnabled()

  await submitStepCommand(panel, page)
  await expect.poll(
    () => completedWorkflowJobCount(page, stepCreated.data.uuid),
    { timeout: 30_000 }
  ).toBe(1)
  await panel.getByRole('button', { name: '刷新状态', exact: true }).click()
  await submitStepCommand(panel, page)
  await expect.poll(
    () => workflowTaskStatus(page, stepCreated.data.uuid),
    { timeout: 30_000 }
  ).toBe('succeeded')
  await panel.getByRole('button', { name: '刷新状态', exact: true }).click()
  await expect(panel.locator('.workflow-runtime__output-title'))
    .toContainText('2/2')
  await expect(canvas.locator('.react-flow__node.wf-flow-node--success'))
    .toHaveCount(2)
  await page.screenshot({
    path: join(artifactDirectory, '05-existing-workflow-step-succeeded.png'),
    fullPage: true
  })

  expect(browserErrors).toEqual([])
  expect(failedResponses).toEqual([])
})

/** 从 Backend REST 读取一个工作流任务（WorkflowTask）的当前状态。 */
async function workflowTaskStatus(
  page: import('@playwright/test').Page,
  taskUuid: string
): Promise<string> {
  const response = await page.request.get(
    `/__unilab_backend/api/v1/workflow-tasks/${taskUuid}`
  )
  const envelope = await response.json() as { data: { status: string } }
  return envelope.data.status
}

/** 从 Backend REST 读取一个工作流任务的当前控制状态。 */
async function workflowTaskControlStatus(
  page: import('@playwright/test').Page,
  taskUuid: string
): Promise<string> {
  const response = await page.request.get(
    `/__unilab_backend/api/v1/workflow-tasks/${taskUuid}`
  )
  const envelope = await response.json() as { data: { control_status: string } }
  return envelope.data.control_status
}

/** 统计 Backend 权威投影中已经成功结束的节点作业数量。 */
async function completedWorkflowJobCount(
  page: import('@playwright/test').Page,
  taskUuid: string
): Promise<number> {
  const response = await page.request.get(
    `/__unilab_backend/api/v1/workflow-tasks/${taskUuid}/jobs`
  )
  const envelope = await response.json() as {
    data: Array<{ status: string }>
  }
  return envelope.data.filter((job) => job.status === 'succeeded').length
}

/** 通过前端正式任务控制条提交一次持久单步命令。 */
async function submitStepCommand(
  panel: import('@playwright/test').Locator,
  page: import('@playwright/test').Page
): Promise<void> {
  const commandResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/commands')
  ))
  await panel.getByRole('button', { name: '单步', exact: true }).click()
  const commandResponse = await commandResponsePromise
  expect(commandResponse.status()).toBe(201)
  expect(commandResponse.request().postDataJSON()).toMatchObject({ type: 'step' })
}

/** 安装一个不预选工作流的工作流面板，使测试从真实 Backend 目录进入。 */
async function installCatalogPanel(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem(
      'unilab.panel-layout.workflow.v1',
      JSON.stringify({
        version: 1,
        layout: {
          id: 'runtime-root',
          type: 'group',
          panels: [{
            id: 'runtime-workflow',
            panelType: 'workflow-dag',
            title: 'Workflow Runtime',
            config: {}
          }],
          activePanelId: 'runtime-workflow'
        }
      })
    )
  })
}
