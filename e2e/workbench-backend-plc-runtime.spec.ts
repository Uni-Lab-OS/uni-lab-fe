import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

const enabled = process.env.UNILAB_E2E_WORKBENCH_BACKEND_PLC === '1'
const workbenchUrl = process.env.UNILAB_WORKBENCH_URL ??
  'http://127.0.0.1:3100/#/home/wangtao/Uni-Lab-SZLab'
const PLC_WORKFLOW_UUID = '9c8c9cd8-c028-4cf9-9c2c-5a433214020b'
const PLC_MATERIAL_UUID = '5e698c9b-2421-4eec-938b-b38cbce27a47'
const CHECK_CONNECTION_TEMPLATE_UUID = 'da217ab1-0827-4399-aa57-b26b8daa784b'

test.skip(
  !enabled,
  '需要显式启动 Workbench、PostgreSQL、Backend、Scheduler、Edge 与 PLC 仿真'
)

/**
 * 验证用户从 Workbench 手动选择 Backend 调度权威后，已有工作流和单动作都经
 * Backend、Scheduler 与真实 Edge 访问 OPC UA PLC 仿真。
 */
test('selects Backend and runs the PLC Workflow and action through the real Edge', async ({
  page
}) => {
  test.setTimeout(120_000)
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ??
      resolve(process.cwd(), 'e2e-artifacts/workbench-backend-plc-runtime/browser')
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  const apiRequests: Array<{ method: string; path: string; status: number }> = []

  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !message.text().startsWith('Failed to load resource:')
    ) browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (!path.startsWith('/__unilab_backend/api/v1/')) return
    apiRequests.push({
      method: response.request().method(),
      path: path.replace('/__unilab_backend', ''),
      status: response.status()
    })
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
  await expect(page.getByText('本地调度', { exact: true })).toBeVisible()
  await backendOption.click()

  await expect(page.locator('details.unilab-workbench-connection'))
    .not.toHaveAttribute('open', '')

  const workbench = page.locator(
    '.unilab-workbench[data-connection-mode="backend"]'
  )
  await expect(workbench).toHaveAttribute(
    'data-authority-profile',
    'backend_controlled'
  )
  await expect(workbench).toHaveAttribute('data-backend-id', 'local-go')
  await expect(page.getByText('Backend 已连接', { exact: true })).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '01-workbench-backend-connected.png'),
    fullPage: true,
    animations: 'disabled'
  })

  const panel = page.getByRole('region', { name: '工作流窗口' })
  await expect(panel.getByText('工作流目录', { exact: true })).toBeVisible()
  await panel.getByRole('button', {
    name: '运行工作流 PLC 仿真连接检查工作流',
    exact: true
  }).click()
  const workflowCanvas = panel.getByRole('region', { name: '工作流画布' })
  await expect(workflowCanvas.getByText('Backend 定义 · 只读', { exact: true }))
    .toBeVisible()
  await expect(workflowCanvas.locator('[data-workflow-node-uuid]')).toHaveCount(1)
  await expect(panel.getByText(PLC_WORKFLOW_UUID, { exact: true })).toBeVisible()

  const workflowCreateResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/api/v1/workflow-tasks')
  ))
  await panel.getByRole('button', {
    name: '运行已有工作流',
    exact: true
  }).click()
  const workflowCreateResponse = await workflowCreateResponsePromise
  expect(workflowCreateResponse.status()).toBe(201)
  expect(workflowCreateResponse.request().postDataJSON()).toEqual({
    workflow_uuid: PLC_WORKFLOW_UUID,
    run_mode: 'normal',
    inventory_bindings: []
  })
  const workflowTask = await workflowCreateResponse.json() as {
    data: { uuid: string }
  }

  await expect.poll(
    () => workflowTaskStatus(page, workflowTask.data.uuid),
    { timeout: 30_000, intervals: [200, 500, 1_000] }
  ).toBe('succeeded')
  await panel.getByRole('button', { name: '刷新状态', exact: true }).click()
  await expect(panel.locator('.persistent-authoring__task-status'))
    .toContainText('执行成功')
  await expect(workflowCanvas.locator('.react-flow__node.wf-flow-node--success'))
    .toHaveCount(1)
  const workflowJob = await readOnlyWorkflowJob(page, workflowTask.data.uuid)
  expect(workflowJob).toMatchObject({
    material_uuid: PLC_MATERIAL_UUID,
    edge_uuid: expect.any(String),
    status: 'succeeded',
    return_info: {
      return_value: {
        connected: true,
        last_error: null
      }
    }
  })
  await page.screenshot({
    path: join(artifactDirectory, '02-workbench-plc-workflow-succeeded.png'),
    fullPage: true,
    animations: 'disabled'
  })

  await page.locator(
    '.lm-TabBar-tab[data-unilabdomain="device"]:visible'
  ).click()
  const deviceList = page.getByRole('complementary', {
    name: 'Edge 设备列表'
  })
  const workspace = page.locator('[data-device-management="workspace"]')
  const debugSection = workspace.locator(
    '[data-device-management="debug-section"]'
  )
  await expect(deviceList.getByRole('button', { name: /SZLab PLC 仿真 Edge/ }))
    .toBeVisible()
  await deviceList.getByRole('button', { name: /SZLab PLC 仿真 Edge/ }).click()
  await workspace.getByRole('button', {
    name: 'check_opcua_connection 动作节点'
  }).click()
  await expect(debugSection.getByRole('heading', {
    name: '检查 OPC UA 仿真连接'
  })).toBeVisible()

  const actionCreateResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/api/v1/device-action-runs')
  ))
  await debugSection.getByRole('button', { name: '运行此动作' }).click()
  const actionCreateResponse = await actionCreateResponsePromise
  expect(actionCreateResponse.status()).toBe(201)
  const actionRequest = actionCreateResponse.request().postDataJSON() as Record<
    string,
    unknown
  >
  expect(actionRequest).toMatchObject({
    material_uuid: PLC_MATERIAL_UUID,
    workflow_node_template_uuid: CHECK_CONNECTION_TEMPLATE_UUID,
    param: {},
    execution_policy: {},
    description: '设备页单动作运行',
    meta_data: {
      source: 'device-panel',
      action_name: 'check_opcua_connection'
    }
  })
  const actionRun = await actionCreateResponse.json() as {
    data: { task: { uuid: string }; job: { uuid: string } }
  }
  await expect.poll(
    () => debugSection.innerText().catch(() => '<device-missing>'),
    { timeout: 30_000, intervals: [200, 500, 1_000] }
  ).toContain('动作执行完成')
  await expect(debugSection.getByText('执行成功', { exact: true })).toBeVisible()

  const actionJobResponse = await page.request.get(
    `/__unilab_backend/api/v1/workflow-node-jobs/${actionRun.data.job.uuid}`
  )
  expect(actionJobResponse.status()).toBe(200)
  const actionJobEnvelope = await actionJobResponse.json() as {
    data: WorkflowJob
  }
  expect(actionJobEnvelope.data).toMatchObject({
    edge_uuid: expect.any(String),
    status: 'succeeded',
    return_info: {
      return_value: {
        connected: true,
        last_error: null
      }
    }
  })
  await page.screenshot({
    path: join(artifactDirectory, '03-workbench-plc-action-succeeded.png'),
    fullPage: true,
    animations: 'disabled'
  })

  expect(apiRequests).toEqual(expect.arrayContaining([
    { method: 'POST', path: '/api/v1/workflow-tasks', status: 201 },
    { method: 'POST', path: '/api/v1/device-action-runs', status: 201 }
  ]))
  expect(apiRequests.filter((item) => (
    item.status >= 400 && item.path !== '/api/v1/material-shapes'
  ))).toEqual([])
  expect(browserErrors).toEqual([])
  writeFileSync(
    join(artifactDirectory, 'network-ledger.json'),
    `${JSON.stringify({
      authorityProfile: 'backend_controlled',
      workflowUuid: PLC_WORKFLOW_UUID,
      workflowTaskUuid: workflowTask.data.uuid,
      workflowJob,
      actionTaskUuid: actionRun.data.task.uuid,
      actionJob: actionJobEnvelope.data,
      actionRequest,
      requests: apiRequests
    }, null, 2)}\n`
  )
})

interface WorkflowJob {
  uuid: string
  material_uuid: string
  edge_uuid: string
  status: string
  return_info: {
    return_value?: {
      connected?: boolean
      last_error?: string | null
    }
  }
}

/** 从 Backend 权威投影读取一个工作流任务（WorkflowTask）的当前状态。 */
async function workflowTaskStatus(page: Page, taskUuid: string): Promise<string> {
  const response = await page.request.get(
    `/__unilab_backend/api/v1/workflow-tasks/${taskUuid}`
  )
  const envelope = await response.json() as { data: { status: string } }
  return envelope.data.status
}

/** 从 Backend 权威投影读取工作流唯一的节点作业。 */
async function readOnlyWorkflowJob(
  page: Page,
  taskUuid: string
): Promise<WorkflowJob> {
  const response = await page.request.get(
    `/__unilab_backend/api/v1/workflow-tasks/${taskUuid}/jobs`
  )
  expect(response.status()).toBe(200)
  const envelope = await response.json() as { data: WorkflowJob[] }
  expect(envelope.data).toHaveLength(1)
  return envelope.data[0]!
}

/** 安装工作流目录面板，同时保留默认的直连 Edge / OS 初始选择。 */
async function installCatalogPanel(page: Page): Promise<void> {
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
