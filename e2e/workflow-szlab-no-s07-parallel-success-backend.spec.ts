import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const enabled = process.env.UNILAB_E2E_SZLAB_NO_S07_PARALLEL === '1'
const workbenchUrl = process.env.UNILAB_WORKBENCH_URL ??
  'http://127.0.0.1:3112/#/tmp/unilab-szlab-latest-test.qIt5iI/workspace'
const schedulerUrl = process.env.UNILAB_E2E_SCHEDULER_URL ??
  'http://127.0.0.1:18086'
const artifactDirectory = resolve(
  process.env.UNILAB_E2E_ARTIFACT_DIR ??
    resolve(process.cwd(), '../e2e-artifacts/szlab-no-s07-parallel-success')
)
const workflowUuid = process.env.UNILAB_E2E_WORKFLOW_UUID ??
  '7513bc60-4630-400e-8935-d456e364af4c'
const workflowName = 'SZLab 单样品原子流程（无 S07 扫码）'
const terminalStatuses = new Set(['succeeded', 'failed', 'canceled'])

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
    message?: string
    blocking_task_uuid?: string
    material_uuids?: string[]
  }
}

interface WorkflowJobWire {
  uuid: string
  workflow_node_uuid: string
  executor_kind: string
  status: string
  error?: string
  param?: {
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
    meta_data?: { unilab_release?: { source_node_uuid?: string } }
  }>
}

/**
 * 在 Workbench Backend 模式同时提交两个无 S07 扫码任务，并等待两个任务真实成功。
 *
 * @param page 真实 Chromium 页面；运行和状态读取均经过 Workbench Backend 代理。
 * @returns 生成运行中、终态任务列表和对应工作流截图以及 API 证据文件。
 * @throws 任一任务未成功、存在失败作业或页面不能回看对应工作流时失败。
 * @safety 只启动 Workbench 托管的 Dry-run Edge，不连接或初始化真实设备。
 */
test('无 S07 扫码工作流的两个并行任务最终都成功', async ({ page }) => {
  test.setTimeout(600_000)
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !message.text().startsWith('Failed to load resource:')
    ) browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await installWorkflowPanel(page)
  await page.goto(workbenchUrl)
  await acceptWorkspaceTrust(page)
  await configureSchedulerTarget(page, schedulerUrl)
  await switchToBackend(page)

  const graph = await readBackend<WorkflowGraphWire>(
    page,
    `/api/v1/workflows/${workflowUuid}/graph`
  )
  expect(graph.workflow.name).toBe(workflowName)
  const panel = page.getByRole('region', { name: '工作流窗口' })
  await expect(panel.getByText('工作流目录', { exact: true })).toBeVisible()
  await clickMounted(panel.getByRole('button', {
    name: `打开工作流 ${workflowName}`,
    exact: true
  }))
  const canvas = panel.getByRole('region', { name: '工作流画布' })
  await expect(canvas.getByText('Backend 定义 · 已同步', { exact: true }))
    .toBeVisible()
  await expect(canvas.getByText(workflowName, { exact: true })).toBeVisible()
  await startDryRunEdge(page)
  await page.screenshot({
    path: join(artifactDirectory, '01-workflow-ready.png'),
    fullPage: true,
    animations: 'disabled'
  })

  const firstTask = await createTask(page, {
    sample_id: 'parallel-sample-001',
    beaker_source_site: 'L1B1',
    sample_vial_source_site: 'L1A1',
    reagent_source_site: 'R1C3',
    stir_site: 'S041',
    stir_position: 1,
    used_beaker_target_site: 'L1B1',
    product_vial_target_site: 'L1A1'
  })
  const secondTask = await createTask(page, {
    sample_id: 'parallel-sample-002',
    beaker_source_site: 'L1B2',
    sample_vial_source_site: 'L1A2',
    reagent_source_site: 'R1C4',
    stir_site: 'S042',
    stir_position: 2,
    used_beaker_target_site: 'L1B2',
    product_vial_target_site: 'L1A2'
  })
  expect(secondTask.uuid).not.toBe(firstTask.uuid)

  await expect.poll(async () => {
    const [first, second] = await Promise.all([
      workflowTaskStatus(page, firstTask.uuid),
      workflowTaskStatus(page, secondTask.uuid)
    ])
    return [first, second].filter(status => status === 'running').length
  }, { timeout: 60_000, intervals: [200, 500, 1_000] }).toBe(2)

  await openTaskList(page)
  await assertTaskStatus(page, firstTask.uuid, '运行中')
  await assertTaskStatus(page, secondTask.uuid, '运行中')
  await page.screenshot({
    path: join(artifactDirectory, '02-two-tasks-running.png'),
    fullPage: true,
    animations: 'disabled'
  })

  const terminal = await waitForTerminalTasks(
    page,
    firstTask.uuid,
    secondTask.uuid
  )
  const firstJobs = await readBackend<WorkflowJobWire[]>(
    page,
    `/api/v1/workflow-tasks/${firstTask.uuid}/jobs`
  )
  const secondJobs = await readBackend<WorkflowJobWire[]>(
    page,
    `/api/v1/workflow-tasks/${secondTask.uuid}/jobs`
  )

  await page.reload()
  await acceptWorkspaceTrust(page)
  await openTaskList(page)
  const firstButton = await assertTaskStatus(page, firstTask.uuid, '成功')
  const secondButton = await assertTaskStatus(page, secondTask.uuid, '成功')
  await page.screenshot({
    path: join(artifactDirectory, '03-two-tasks-succeeded.png'),
    fullPage: true,
    animations: 'disabled'
  })

  await clickMounted(firstButton)
  const taskWorkflow = page.getByRole('region', { name: '任务对应工作流' })
  await expect(taskWorkflow.getByText(
    `Task ${firstTask.uuid.slice(-8)}`,
    { exact: true }
  )).toBeVisible()
  await clickMounted(secondButton)
  await expect(taskWorkflow.getByRole('heading', {
    name: workflowName,
    exact: true
  })).toBeVisible()
  await expect(taskWorkflow.getByText(
    `Task ${secondTask.uuid.slice(-8)}`,
    { exact: true }
  )).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '04-succeeded-task-workflow.png'),
    fullPage: true,
    animations: 'disabled'
  })

  writeFileSync(
    join(artifactDirectory, 'evidence.json'),
    `${JSON.stringify({
      outcome: terminal.every(task => task.status === 'succeeded') &&
        [...firstJobs, ...secondJobs].every(job => job.status === 'succeeded')
        ? 'passed'
        : 'failed',
      generatedAt: new Date().toISOString(),
      authorityProfile: 'backend_controlled',
      workflow: graph.workflow,
      custodyPolicies: graph.nodes.filter(node => node.type === 'material_source')
        .map(node => ({
          sourceNodeUuid: node.meta_data?.unilab_release?.source_node_uuid,
          custodyPolicy: node.param?.custody_policy,
          materialUuid: node.param?.material_uuid
        })),
      tasks: { first: terminal[0], second: terminal[1] },
      jobs: { first: firstJobs, second: secondJobs },
      browserErrors,
      screenshots: [
        '01-workflow-ready.png',
        '02-two-tasks-running.png',
        '03-two-tasks-succeeded.png',
        '04-succeeded-task-workflow.png'
      ]
    }, null, 2)}\n`,
    'utf8'
  )

  expect(terminal.map(task => task.status)).toEqual(['succeeded', 'succeeded'])
  expect(firstJobs.length).toBeGreaterThan(0)
  expect(secondJobs.length).toBeGreaterThan(0)
  expect(firstJobs.every(job => job.status === 'succeeded')).toBe(true)
  expect(secondJobs.every(job => job.status === 'succeeded')).toBe(true)
  expect(browserErrors).toEqual([])
})

/**
 * 接受当前临时工作区的作者信任提示，已信任时保持现状。
 *
 * @param page 当前真实 Chromium 页面。
 * @returns 信任提示处理完成后结束。
 * @throws 信任按钮可见但点击失败时抛出异常。
 */
async function acceptWorkspaceTrust(page: Page): Promise<void> {
  const trustButton = page.getByRole('button', { name: /是，我信任此作者/ })
  if (await trustButton.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await trustButton.click()
  }
}

/**
 * 将工作台切换到后端控制（backend_controlled）并等待权威连接就绪。
 *
 * @param page 当前真实 Chromium 页面。
 * @returns 连接就绪后完成，不产生业务返回值。
 * @throws Backend 选项不可用或权威配置未在超时内生效时失败。
 */
async function switchToBackend(page: Page): Promise<void> {
  const workbench = page.locator('.unilab-workbench[data-connection-mode="backend"]')
  if (!await workbench.isVisible().catch(() => false)) {
    const runtimeConnection = page.getByLabel(/^运行连接：/)
    const backendOption = page.getByRole('button', { name: /Backend \+ Scheduler/ })
    await expect(runtimeConnection).toBeVisible()
    if (!await backendOption.isVisible()) {
      await runtimeConnection.evaluate(element => (element as HTMLElement).click())
    }
    await expect(backendOption).toBeEnabled()
    await backendOption.evaluate(element => (element as HTMLButtonElement).click())
  }
  await expect(workbench).toHaveAttribute(
    'data-authority-profile',
    'backend_controlled',
    { timeout: 30_000 }
  )
  await expect(page.getByText('Backend 已连接', { exact: true })).toBeVisible()
}

/**
 * 把环境管理中的调度器（Scheduler）目标设置为本轮隔离测试地址。
 *
 * @param page 当前真实 Chromium 页面。
 * @param url 本轮 Backend 配套调度器（Scheduler）的 HTTP 地址。
 * @returns 地址保存并关闭环境管理后完成。
 * @throws 工作区、环境管理或保存结果未在超时内就绪时失败。
 */
async function configureSchedulerTarget(page: Page, url: string): Promise<void> {
  const workbench = page.locator('.unilab-workbench[data-workspace-backend-phase="ready"]')
  await expect(workbench).toBeVisible({ timeout: 60_000 })
  const environmentButton = page.getByRole('button', { name: '环境管理', exact: true })
  await environmentButton.evaluate(element => (element as HTMLButtonElement).click())
  const dialog = page.getByRole('dialog', { name: '环境管理' })
  await expect(dialog).toBeVisible()
  const dryRun = dialog.getByRole('button', { name: /^Dry-run/ })
  if (await dryRun.getAttribute('aria-label') !== 'Dry-run（当前）') {
    page.once('dialog', browserDialog => void browserDialog.accept())
    await dryRun.click()
    await expect(dialog.getByRole('button', {
      name: 'Dry-run（当前）',
      exact: true
    })).toBeVisible()
  }
  const input = dialog.getByLabel('Scheduler 目标地址', { exact: true })
  await input.fill(url)
  const save = dialog.getByRole('button', { name: '保存 Scheduler 地址', exact: true })
  await save.evaluate(element => (element as HTMLButtonElement).click())
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('button', {
    name: '关闭环境管理',
    exact: true
  }).evaluate(element => (element as HTMLButtonElement).click())
}

/**
 * 启动 Workbench 托管的 Dry-run Edge，并等待边缘运行时进入 ready。
 *
 * @param page 当前真实 Chromium 页面。
 * @returns Edge 已就绪或原本已就绪时完成。
 * @throws 启动按钮不可用或 Edge 未在超时内就绪时失败。
 * @safety 仅允许 Dry-run 模式，不连接现场物理设备。
 */
async function startDryRunEdge(page: Page): Promise<void> {
  const workbench = page.locator('.unilab-workbench[data-connection-mode="backend"]')
  if (await workbench.getAttribute('data-edge-runtime-phase') === 'ready') return
  await clickMounted(page.getByRole('button', { name: '环境管理', exact: true }))
  const dialog = page.getByRole('dialog', { name: '环境管理' })
  const start = dialog.getByRole('button', { name: '启动 OS', exact: true })
  await expect(start).toBeEnabled()
  await start.evaluate(element => (element as HTMLButtonElement).click())
  await expect(workbench).toHaveAttribute('data-edge-runtime-phase', 'ready', {
    timeout: 120_000
  })
  const close = dialog.getByRole('button', { name: '关闭环境管理', exact: true })
  if (await close.isVisible().catch(() => false)) await clickMounted(close)
}

/**
 * 通过 Workbench Backend 代理创建一个工作流任务（WorkflowTask）。
 *
 * @param page 当前真实 Chromium 页面。
 * @param input 已按冻结工作流输入合同填写的任务参数。
 * @returns Backend 创建并持久化的工作流任务（WorkflowTask）。
 * @throws HTTP 状态、响应封装或工作流身份不符合合同约束时失败。
 */
async function createTask(
  page: Page,
  input: Record<string, string | number>
): Promise<WorkflowTaskWire> {
  const response = await page.request.post('/__unilab_backend/api/v1/workflow-tasks', {
    data: {
      workflow_uuid: workflowUuid,
      run_mode: 'normal',
      input,
      inventory_bindings: [],
      meta_data: {}
    }
  })
  expect(response.status()).toBe(201)
  const envelope = await response.json() as Envelope<WorkflowTaskWire>
  expect(envelope.code, envelope.error?.msg).toBe(0)
  expect(envelope.data.workflow_uuid).toBe(workflowUuid)
  return envelope.data
}

/**
 * 并行读取两条工作流任务（WorkflowTask），直到二者都进入业务终态。
 *
 * @param page 当前真实 Chromium 页面。
 * @param firstTaskUuid 第一条工作流任务（WorkflowTask）的稳定身份。
 * @param secondTaskUuid 第二条工作流任务（WorkflowTask）的稳定身份。
 * @returns 两条任务按输入顺序排列的最终权威投影。
 * @throws 任一任务未在超时内进入业务终态时失败。
 */
async function waitForTerminalTasks(
  page: Page,
  firstTaskUuid: string,
  secondTaskUuid: string
): Promise<[WorkflowTaskWire, WorkflowTaskWire]> {
  let result: [WorkflowTaskWire, WorkflowTaskWire] | undefined
  await expect.poll(async () => {
    result = await Promise.all([
      readBackend<WorkflowTaskWire>(page, `/api/v1/workflow-tasks/${firstTaskUuid}`),
      readBackend<WorkflowTaskWire>(page, `/api/v1/workflow-tasks/${secondTaskUuid}`)
    ])
    return result.every(task => terminalStatuses.has(task.status))
  }, {
    timeout: 420_000,
    intervals: [500, 1_000, 2_000, 5_000]
  }).toBe(true)
  return result as [WorkflowTaskWire, WorkflowTaskWire]
}

/**
 * 打开左侧工作流任务列表，并等待任务队列标题可见。
 *
 * @param page 当前真实 Chromium 页面。
 * @returns 任务列表可交互后完成。
 * @throws 导航入口或任务列表未出现时失败。
 */
async function openTaskList(page: Page): Promise<void> {
  const navigation = page.getByRole('listitem').filter({ hasText: '任务列表' })
  await expect(navigation).toBeVisible()
  await navigation.click()
  await expect(page.getByRole('heading', { name: '工作流任务', exact: true }))
    .toBeVisible()
}

/**
 * 在任务队列中定位指定任务并核对中文状态标签。
 *
 * @param page 当前真实 Chromium 页面。
 * @param taskUuid 工作流任务（WorkflowTask）的稳定身份。
 * @param statusText 期望显示的权威业务状态。
 * @returns 可继续点击、用于打开对应工作流界面的任务按钮。
 * @throws 任务不存在或状态未在超时内匹配时失败。
 */
async function assertTaskStatus(
  page: Page,
  taskUuid: string,
  statusText: '运行中' | '成功'
): Promise<Locator> {
  const button = page.getByRole('region', { name: '任务队列' }).locator('button')
    .filter({ hasText: taskUuid.slice(-8) })
  await expect(button).toContainText(statusText, { timeout: 30_000 })
  return button
}

/**
 * 等待元素挂载后通过 DOM click 触发真实用户入口。
 *
 * @param locator 待点击元素的 Playwright 定位器。
 * @returns 元素点击完成后结束。
 * @throws 元素不可见或浏览器执行点击失败时抛出异常。
 */
async function clickMounted(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  await locator.evaluate(element => (element as HTMLElement).click())
}

/**
 * 从 Backend 权威接口读取单条工作流任务（WorkflowTask）的当前状态。
 *
 * @param page 当前真实 Chromium 页面。
 * @param taskUuid 工作流任务（WorkflowTask）的稳定身份。
 * @returns Backend wire contract 中的原始状态值。
 * @throws Backend 读取失败或响应封装无效时失败。
 */
async function workflowTaskStatus(page: Page, taskUuid: string): Promise<string> {
  return (await readBackend<WorkflowTaskWire>(
    page,
    `/api/v1/workflow-tasks/${taskUuid}`
  )).status
}

/**
 * 经 Workbench 代理读取 Backend 持久事实并解开统一响应封装。
 *
 * @param page 当前真实 Chromium 页面。
 * @param path Backend v1 接口路径。
 * @returns 响应封装中的强类型 data。
 * @throws HTTP 非成功或 Backend 业务码非零时抛出包含诊断信息的异常。
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
 * 在页面加载前安装只含工作流面板的确定性布局。
 *
 * @param page 即将打开 Workbench 的真实 Chromium 页面。
 * @returns 初始化脚本注册完成后结束。
 * @throws 浏览器上下文拒绝注册初始化脚本时失败。
 */
async function installWorkflowPanel(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('unilab.panel-layout.workflow.v1', JSON.stringify({
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
    }))
  })
}
