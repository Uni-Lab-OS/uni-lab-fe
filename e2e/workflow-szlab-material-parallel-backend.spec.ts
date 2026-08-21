import { expect, test, type Locator, type Page, type Response } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const enabled = process.env.UNILAB_E2E_SZLAB_BACKEND_PARALLEL === '1'
const workbenchUrl = process.env.UNILAB_WORKBENCH_URL ??
  'http://127.0.0.1:4205/#/home/wangtao/Uni-Lab-SZLab'
const schedulerUrl = process.env.UNILAB_E2E_SCHEDULER_URL ??
  'http://127.0.0.1:18082'
const artifactDirectory = resolve(
  process.env.UNILAB_E2E_ARTIFACT_DIR ??
    resolve(process.cwd(), '../e2e-artifacts/szlab-material-parallel-backend')
)
const WORKFLOW_UUID = process.env.UNILAB_E2E_WORKFLOW_UUID ??
  '7f057a12-aacb-4aed-94ab-bd30f3ff1c56'
const WORKFLOW_NAME = 'SZLab 单样品全流程（物料感知）'
const RESUME_FIRST_TASK_UUID = process.env.UNILAB_E2E_FIRST_TASK_UUID
const RESUME_SECOND_TASK_UUID = process.env.UNILAB_E2E_SECOND_TASK_UUID
const SHARED_SOURCE_UUIDS = new Set([
  '70fa686c-4f15-43b9-851f-7080949de0ec',
  '9c7e0a7c-8b6a-448a-a910-84c4fd628e74'
])

test.skip(!enabled, '需要显式启动 Workbench、Backend、调度器和可控模拟 Edge')

interface Envelope<Value> {
  code: number
  data: Value
  error?: { msg?: string }
}

interface WorkflowTaskWire {
  uuid: string
  workflow_uuid: string
  status: string
  wait_reason?: {
    code?: string
    blocking_task_uuid?: string
    material_uuids?: string[]
  }
}

interface WorkflowJobWire {
  uuid: string
  workflow_node_uuid: string
  executor_kind: string
  status: string
  param: {
    custody_policy?: string
    material_uuid?: string
  }
  return_info?: { material?: { uuid?: string } }
}

interface WorkflowGraphWire {
  workflow: { uuid: string; name: string }
  nodes: Array<{
    uuid: string
    type: string
    param?: { custody_policy?: string; material_uuid?: string }
    meta_data?: {
      unilab_release?: { source_node_uuid?: string }
    }
  }>
}

/**
 * 通过 Workbench 的 Backend 模式创建或复用两个同工作流任务，并验证共享来源、独占阻塞和任务工作流回看。
 *
 * @param page 真实 Chromium 页面；所有运行与状态请求都经 Workbench Backend 代理。
 * @returns 生成四张截图与一份 API 证据文件；无业务返回值。
 * @throws Backend 图、任务状态、物料策略或右侧冻结工作流界面不符合合同时失败。
 * @safety Edge 使用 Workbench 托管的 Dry-run，只注册设备动作目录，不初始化或操作真实设备。
 */
test('Backend 模式展示物料感知工作流的并行任务状态', async ({ page }) => {
  test.setTimeout(300_000)
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  const backendRequests: Array<{ method: string; path: string; status: number }> = []
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
    backendRequests.push({
      method: response.request().method(),
      path: path.replace('/__unilab_backend', ''),
      status: response.status()
    })
  })

  await installWorkflowPanel(page)
  await page.goto(workbenchUrl)
  const trustDialog = page.locator('.workspace-trust-dialog')
  if (await trustDialog.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await trustDialog.getByRole('button', {
      name: /是，我信任此作者/
    }).click()
  }
  await configureSchedulerTarget(page, schedulerUrl)
  const workbench = page.locator(
    '.unilab-workbench[data-connection-mode="backend"]'
  )
  if (!await workbench.isVisible().catch(() => false)) {
    const runtimeConnection = page.getByLabel(/^运行连接：/)
    const backendOption = page.getByRole('button', {
      name: /Backend \+ Scheduler/
    })
    await expect(runtimeConnection).toBeVisible()
    if (!await backendOption.isVisible()) {
      await runtimeConnection.evaluate(element => (
        (element as HTMLElement).click()
      ))
    }
    await expect(backendOption).toBeVisible()
    await expect(backendOption).toBeEnabled()
    await backendOption.evaluate(element => (
      (element as HTMLButtonElement).click()
    ))
  }
  await expect(workbench).toHaveAttribute(
    'data-authority-profile',
    'backend_controlled',
    { timeout: 30_000 }
  )
  await expect(page.getByText('Backend 已连接', { exact: true })).toBeVisible()

  const graph = await readBackend<WorkflowGraphWire>(
    page,
    `/api/v1/workflows/${WORKFLOW_UUID}/graph`
  )
  const sourceNodes = graph.nodes.filter((node) => node.type === 'material_source')
  expect(sourceNodes).toHaveLength(8)
  const sharedSources = sourceNodes.filter((node) => (
    node.param?.custody_policy === 'shared_source'
  ))
  expect(new Set(sharedSources.map((node) => (
    node.meta_data?.unilab_release?.source_node_uuid
  )))).toEqual(SHARED_SOURCE_UUIDS)

  const panel = page.getByRole('region', { name: '工作流窗口' })
  await expect(panel.getByText('工作流目录', { exact: true })).toBeVisible()
  await clickMounted(panel.getByRole('button', {
    name: `打开工作流 ${WORKFLOW_NAME}`,
    exact: true
  }))
  const canvas = panel.getByRole('region', { name: '工作流画布' })
  await expect(canvas.getByText('Backend 定义 · 已同步', { exact: true }))
    .toBeVisible()
  await expect(canvas.getByText(WORKFLOW_NAME, { exact: true })).toBeVisible()
  await startDryRunEdge(page)
  await page.screenshot({
    path: join(artifactDirectory, '01-backend-workflow-ready.png'),
    fullPage: true,
    animations: 'disabled'
  })

  expect(Boolean(RESUME_FIRST_TASK_UUID)).toBe(Boolean(RESUME_SECOND_TASK_UUID))
  const firstTask = RESUME_FIRST_TASK_UUID && RESUME_SECOND_TASK_UUID
    ? await readBackend<WorkflowTaskWire>(
        page,
        `/api/v1/workflow-tasks/${RESUME_FIRST_TASK_UUID}`
      )
    : await startTask(panel, page, '开始运行')
  await expect.poll(
    () => workflowTaskStatus(page, firstTask.uuid),
    { timeout: 45_000, intervals: [200, 500, 1_000] }
  ).toBe('running')
  const rerunButton = panel.getByRole('button', { name: '再次运行', exact: true })
  await expect(rerunButton).toBeEnabled()
  await page.screenshot({
    path: join(artifactDirectory, '02-running-rerun-enabled.png'),
    fullPage: true,
    animations: 'disabled'
  })

  const secondTask = RESUME_FIRST_TASK_UUID && RESUME_SECOND_TASK_UUID
    ? await readBackend<WorkflowTaskWire>(
        page,
        `/api/v1/workflow-tasks/${RESUME_SECOND_TASK_UUID}`
      )
    : await startTask(panel, page, '再次运行')
  expect(secondTask.uuid).not.toBe(firstTask.uuid)
  await expect.poll(
    () => workflowTaskStatus(page, secondTask.uuid),
    { timeout: 45_000, intervals: [200, 500, 1_000] }
  ).toBe('pending')
  const firstJobs = await readBackend<WorkflowJobWire[]>(
    page,
    `/api/v1/workflow-tasks/${firstTask.uuid}/jobs`
  )
  const secondJobs = await readBackend<WorkflowJobWire[]>(
    page,
    `/api/v1/workflow-tasks/${secondTask.uuid}/jobs`
  )
  const firstSourceJobs = firstJobs.filter((job) => (
    job.executor_kind === 'material_source'
  ))
  const secondSourceJobs = secondJobs.filter((job) => (
    job.executor_kind === 'material_source'
  ))
  expect(firstSourceJobs).toHaveLength(8)
  expect(firstSourceJobs.every((job) => job.status === 'succeeded')).toBe(true)
  expect(secondSourceJobs).toHaveLength(8)
  expect(secondSourceJobs.every((job) => job.status === 'pending')).toBe(true)
  expect(firstSourceJobs.filter((job) => (
    job.param.custody_policy === 'shared_source' &&
    Boolean(job.return_info?.material?.uuid)
  ))).toHaveLength(2)

  const taskNavigation = page.getByRole('listitem').filter({
    hasText: '任务列表'
  })
  await expect(taskNavigation).toBeVisible()
  await taskNavigation.click()
  await page.mouse.move(1_200, 120)
  await expect(page.getByRole('heading', { name: '工作流任务', exact: true }))
    .toBeVisible()
  const queue = page.getByRole('region', { name: '任务队列' })
  await expect(queue.locator('li')).toHaveCount(2)
  await expect(queue.getByText('运行中', { exact: true })).toHaveCount(1)
  await expect(queue.getByText('等待执行', { exact: true })).toHaveCount(1)
  await clickMounted(queue.locator('button').filter({
    hasText: firstTask.uuid.slice(-8)
  }))
  const taskWorkflow = page.getByRole('region', { name: '任务对应工作流' })
  await expect(taskWorkflow.getByText(
    `Task ${firstTask.uuid.slice(-8)}`,
    { exact: true }
  )).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '03-backend-parallel-task-list.png'),
    fullPage: true,
    animations: 'disabled'
  })

  await clickMounted(queue.locator('button').filter({
    hasText: secondTask.uuid.slice(-8)
  }))
  await expect(taskWorkflow.getByRole('heading', {
    name: WORKFLOW_NAME,
    exact: true
  })).toBeVisible()
  await expect(taskWorkflow.getByText(
    `Task ${secondTask.uuid.slice(-8)}`,
    { exact: true }
  )).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '04-task-status-and-corresponding-workflow.png'),
    fullPage: true,
    animations: 'disabled'
  })

  const secondTaskDetail = await readBackend<WorkflowTaskWire>(
    page,
    `/api/v1/workflow-tasks/${secondTask.uuid}`
  )
  expect(secondTaskDetail.wait_reason?.blocking_task_uuid).toBe(firstTask.uuid)
  expect(secondTaskDetail.wait_reason?.material_uuids?.length).toBeGreaterThan(0)
  expect(browserErrors).toEqual([])
  expect(backendRequests.filter((request) => (
    request.status >= 400 && request.path !== '/api/v1/material-shapes'
  ))).toEqual([])

  writeFileSync(
    join(artifactDirectory, 'evidence.json'),
    `${JSON.stringify({
      outcome: 'passed',
      generatedAt: new Date().toISOString(),
      authorityProfile: 'backend_controlled',
      workflow: graph.workflow,
      tasks: { first: firstTask, second: secondTaskDetail },
      jobs: { first: firstJobs, second: secondJobs },
      sharedSources,
      browserErrors,
      backendRequests,
      screenshots: [
        '01-backend-workflow-ready.png',
        '02-running-rerun-enabled.png',
        '03-backend-parallel-task-list.png',
        '04-task-status-and-corresponding-workflow.png'
      ]
    }, null, 2)}\n`,
    'utf8'
  )
})

/**
 * 通过 Workbench 环境管理启用安全 Dry-run，并保存本轮真实调度器（Scheduler）地址。
 *
 * @param page 真实 Theia Workbench 页面。
 * @param url 已启动并暴露 Edge 控制接口的调度器地址。
 * @returns Dry-run 与地址保存成功且环境管理关闭后返回，无业务返回值。
 * @throws 环境管理入口、地址表单或保存操作不可用时失败。
 */
async function configureSchedulerTarget(page: Page, url: string): Promise<void> {
  const workbench = page.locator(
    '.unilab-workbench[data-workspace-backend-phase="ready"]'
  )
  await expect(workbench).toBeVisible({ timeout: 60_000 })
  const trustButton = page.getByRole('button', {
    name: /是，我信任此作者/
  })
  if (await trustButton.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await trustButton.click()
  }
  const environmentButton = page.getByRole('button', {
    name: '环境管理',
    exact: true
  })
  await expect(environmentButton).toBeVisible()
  await environmentButton.evaluate(element => (
    (element as HTMLButtonElement).click()
  ))
  const dialog = page.getByRole('dialog', { name: '环境管理' })
  await expect(dialog).toBeVisible()
  const dryRun = dialog.getByRole('button', { name: /^Dry-run/ })
  if (!await dryRun.getAttribute('aria-label').then(label => (
    label === 'Dry-run（当前）'
  ))) {
    page.once('dialog', dialog => void dialog.accept())
    await dryRun.click()
    await expect(dialog.getByRole('button', {
      name: 'Dry-run（当前）',
      exact: true
    })).toBeVisible()
  }
  const input = dialog.getByLabel('Scheduler 目标地址', { exact: true })
  await input.fill(url)
  const save = dialog.getByRole('button', {
    name: '保存 Scheduler 地址',
    exact: true
  })
  await save.evaluate(element => (
    (element as HTMLButtonElement).click()
  ))
  await expect(save).toBeEnabled({ timeout: 10_000 })
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('button', {
    name: '关闭环境管理',
    exact: true
  }).evaluate(element => (
    (element as HTMLButtonElement).click()
  ))
  await expect(dialog).not.toBeVisible()
}

/**
 * 从 Workbench 环境管理启动连接 Backend Authority 的 Dry-run Edge。
 *
 * @param page 已完成 Backend 模式切换的真实 Theia Workbench 页面。
 * @returns Edge 明确进入 ready 后返回，无业务返回值。
 * @throws 环境管理、启动命令或 Edge 就绪状态失败时抛出。
 * @safety 当前会话必须先持久配置为 Dry-run，禁止向现场设备下发动作。
 */
async function startDryRunEdge(page: Page): Promise<void> {
  const workbench = page.locator(
    '.unilab-workbench[data-connection-mode="backend"]'
  )
  if (await workbench.getAttribute('data-edge-runtime-phase') === 'ready') return
  const environmentButton = page.locator('button').filter({
    hasText: '环境管理'
  }).first()
  await clickMounted(environmentButton)
  const dialog = page.getByRole('dialog', { name: '环境管理' })
  await expect(dialog).toBeVisible()
  const start = dialog.getByRole('button', { name: '启动 OS', exact: true })
  await expect(start).toBeEnabled()
  await start.evaluate(element => (
    (element as HTMLButtonElement).click()
  ))
  await expect(workbench).toHaveAttribute(
    'data-edge-runtime-phase',
    'ready',
    { timeout: 120_000 }
  )
  const close = dialog.getByRole('button', {
    name: '关闭环境管理',
    exact: true
  })
  if (await close.isVisible().catch(() => false)) {
    await close.evaluate(element => (
      (element as HTMLButtonElement).click()
    ))
  }
}

/**
 * 从 Workbench 的当前运行按钮创建一次工作流任务（WorkflowTask）。
 *
 * @param panel 工作流窗口。
 * @param page 浏览器页面，用于观察正式 Backend 创建响应。
 * @param buttonName 首次运行或再次运行按钮的可访问名称。
 * @returns Backend HTTP 201 返回的工作流任务事实。
 * @throws 输入表单或创建响应失败时抛出。
 */
async function startTask(
  panel: Locator,
  page: Page,
  buttonName: '开始运行' | '再次运行'
): Promise<WorkflowTaskWire> {
  const responsePromise = page.waitForResponse(isTaskCreateResponse)
  const runButton = panel.getByRole('button', {
    name: buttonName,
    exact: true
  })
  await expect(runButton).toBeEnabled()
  await clickMounted(runButton)
  const taskInput = page.getByRole('region', {
    name: '工作流运行输入表单'
  })
  await expect(taskInput).toBeVisible({ timeout: 30_000 })
  await clickMounted(taskInput.getByRole('button', {
    name: '使用以上参数运行',
    exact: true
  }))
  const response = await responsePromise
  expect(response.status()).toBe(201)
  const envelope = await response.json() as Envelope<WorkflowTaskWire>
  expect(envelope.code, envelope.error?.msg).toBe(0)
  expect(envelope.data.workflow_uuid).toBe(WORKFLOW_UUID)
  await expect(taskInput).toBeHidden({ timeout: 30_000 })
  return envelope.data
}

/**
 * 在 Theia 会话刷新可能重挂载 React 节点时，同步触发当前可见控件的真实 DOM 点击。
 *
 * @param locator 必须可见且当前挂载的 Workbench 控件。
 * @returns 控件点击事件已同步派发后返回，无业务返回值。
 * @throws 控件不可见、未挂载或 DOM 点击事件无法执行时失败。
 */
async function clickMounted(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  await locator.evaluate(element => (element as HTMLElement).click())
}

/**
 * 判断响应是否为 Workbench Backend 代理上的正式任务创建。
 *
 * @param response Playwright 观察到的浏览器响应。
 * @returns POST 目标为工作流任务集合时返回 true。
 */
function isTaskCreateResponse(response: Response): boolean {
  return response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/api/v1/workflow-tasks')
}

/**
 * 读取一个工作流任务的权威状态。
 *
 * @param page 浏览器页面及其同源请求上下文。
 * @param taskUuid 工作流任务 UUID。
 * @returns Backend 当前任务状态字符串。
 * @throws Backend 或信封解码失败时抛出。
 */
async function workflowTaskStatus(page: Page, taskUuid: string): Promise<string> {
  return (await readBackend<WorkflowTaskWire>(
    page,
    `/api/v1/workflow-tasks/${taskUuid}`
  )).status
}

/**
 * 经 Workbench 同源代理读取 Backend 公共 API。
 *
 * @param page 浏览器页面及其 APIRequestContext。
 * @param path 以 `/api/v1` 开头的公共路径。
 * @returns 成功信封中的业务数据。
 * @throws 非 2xx 或业务 code 非零时抛出。
 */
async function readBackend<Value>(page: Page, path: string): Promise<Value> {
  const response = await page.request.get(`/__unilab_backend${path}`)
  const envelope = await response.json() as Envelope<Value>
  if (!response.ok() || envelope.code !== 0) {
    throw new Error(`Backend ${path} 失败：${JSON.stringify(envelope)}`)
  }
  return envelope.data
}

/**
 * 安装单一工作流窗口，使回归从真实 Backend 工作流目录进入。
 *
 * @param page 尚未导航的浏览器页面。
 * @returns 布局写入 localStorage 后完成；无业务返回值。
 */
async function installWorkflowPanel(page: Page): Promise<void> {
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
