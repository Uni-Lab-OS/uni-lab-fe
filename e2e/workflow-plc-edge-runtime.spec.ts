import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expect, test } from '@playwright/test'

const enabled = process.env.UNILAB_E2E_PLC_EDGE === '1'
const PLC_WORKFLOW_UUID = '9c8c9cd8-c028-4cf9-9c2c-5a433214020b'
const PLC_MATERIAL_UUID = '5e698c9b-2421-4eec-938b-b38cbce27a47'

test.skip(!enabled, '需要显式启动 PostgreSQL、Backend、Scheduler、Edge 与 PLC 仿真')

/** 验证已有工作流从前端经 Scheduler 和真实 Edge 访问 OPC UA PLC 仿真。 */
test('runs an existing PLC simulation Workflow through the real Edge', async ({
  page
}) => {
  test.setTimeout(90_000)
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ??
      resolve(process.cwd(), 'e2e-artifacts/plc-edge-runtime/browser')
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
      !path.endsWith('/api/v1/material-shapes')
    ) failedResponses.push({ path, status: response.status() })
  })
  await installCatalogPanel(page)

  await page.goto('/?section=workflow&backend=local-go')
  const panel = page.locator('[data-panel-instance-id="runtime-workflow"]')
  await expect(panel.getByText('工作流目录', { exact: true })).toBeVisible()
  await expect(panel.getByText('PLC 仿真连接检查工作流', { exact: true }))
    .toBeVisible()
  await panel.getByRole('button', {
    name: '运行工作流 PLC 仿真连接检查工作流',
    exact: true
  }).click()
  const workflowCanvas = panel.getByRole('region', { name: '工作流画布' })
  await expect(workflowCanvas.getByText('Backend 定义 · 只读', { exact: true }))
    .toBeVisible()
  await expect(workflowCanvas.locator('[data-workflow-node-uuid]')).toHaveCount(1)
  await expect(panel.getByText(PLC_WORKFLOW_UUID, { exact: true })).toBeVisible()
  await expect(panel.getByText('已通过 · 1 个执行节点', { exact: true }))
    .toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '03-plc-workflow-ready.png'),
    fullPage: true,
    animations: 'disabled'
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
  expect(createResponse.request().postDataJSON()).toEqual({
    workflow_uuid: PLC_WORKFLOW_UUID,
    run_mode: 'normal',
    inventory_bindings: []
  })
  const created = await createResponse.json() as { data: { uuid: string } }

  await expect.poll(
    () => workflowTaskStatus(page, created.data.uuid),
    { timeout: 30_000, intervals: [200, 500, 1_000] }
  ).toBe('succeeded')
  await panel.getByRole('button', { name: '刷新状态', exact: true }).click()
  await expect(panel.locator('.persistent-authoring__task-status'))
    .toContainText('执行成功')
  await expect(workflowCanvas.locator('.react-flow__node.wf-flow-node--success'))
    .toHaveCount(1)
  await expect(panel.locator('.workflow-runtime__output-title'))
    .toContainText('1/1')

  const jobsResponse = await page.request.get(
    `/__unilab_backend/api/v1/workflow-tasks/${created.data.uuid}/jobs`
  )
  expect(jobsResponse.status()).toBe(200)
  const jobsPayload = await jobsResponse.json() as {
    data: Array<{
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
    }>
  }
  expect(jobsPayload.data).toHaveLength(1)
  expect(jobsPayload.data[0]).toMatchObject({
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
    path: join(artifactDirectory, '04-plc-workflow-succeeded.png'),
    fullPage: true,
    animations: 'disabled'
  })

  expect(browserErrors).toEqual([])
  expect(failedResponses).toEqual([])
  writeFileSync(
    join(artifactDirectory, 'workflow-network-ledger.json'),
    `${JSON.stringify({
      workflowUuid: PLC_WORKFLOW_UUID,
      taskUuid: created.data.uuid,
      job: jobsPayload.data[0]
    }, null, 2)}\n`
  )
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

/** 安装不预选工作流的面板，使测试从 Backend 工作流目录进入。 */
async function installCatalogPanel(
  page: import('@playwright/test').Page
): Promise<void> {
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
