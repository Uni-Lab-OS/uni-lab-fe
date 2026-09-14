import { expect, test, type Locator, type Page, type Response } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  startSzlabParallelMaterialWorkflowOs,
  type SzlabMaterialWorkflowOs
} from './helpers/szlab-action-catalog-os'
import { readGitRevision } from './helpers/f05-os-revision'
import { clickVisibleCanvasWorkflowNode } from './helpers/f05-workflow-canvas-node'
import {
  applyWorkflowCandidateWithoutTask,
  installWorkflowPanel,
  saveWorkflowDraftOnly
} from './helpers/workflow-runtime-ui'

const WORKFLOW_UUID = '6d9fb3e2-4dcb-5f23-93b4-74d1b6083393'
const WORKFLOW_NAME = 'SZLab 单样品全流程（物料感知）'
const SOURCE_REAGENT_BOTTLE_UUID = 'cf96d8b4-e160-4755-9c33-73f364c43ceb'
const SOURCE_SOLVENT_PUMP_1_UUID = '70fa686c-4f15-43b9-851f-7080949de0ec'
const SOURCE_SOLVENT_PUMP_2_UUID = '9c7e0a7c-8b6a-448a-a910-84c4fd628e74'
const PUMP_1_MATERIAL_UUID = '2edc6fff-3c79-52e8-92e1-259013408544'
const PUMP_2_MATERIAL_UUID = '4a30f5b3-3b83-5978-a836-405def6f54ea'
const EXCLUSIVE_SOURCE_UUIDS = [
  'c6551edc-856a-55f8-91a3-d9c7243fb636',
  '71e3add0-cc3b-5657-8763-2ce15d823077',
  '0164a018-80c0-52ac-9350-47e8b5cdec01',
  '5f3ee9e8-6790-527b-80a8-40f4c5f51cbf',
  SOURCE_REAGENT_BOTTLE_UUID,
  'bf46be1e-2743-4fac-864c-bfbc41df3fd9'
] as const

interface PublicEnvelope<Value> {
  code: number
  data: Value
  error?: { msg?: string }
}

interface WorkflowTaskWire {
  uuid: string
  workflow_uuid: string
  status: string
  create_time: string
}

interface WorkflowJobWire {
  uuid: string
  workflow_node_uuid: string
  executor_kind: string
  status: string
  action_name?: string
  return_info?: {
    material?: {
      uuid?: string
      custody_policy?: string
    }
  }
}

interface AuthoringWire {
  applied_graph: {
    nodes: Array<{
      uuid: string
      param?: {
        material_uuid?: string | null
        custody_policy?: string
      }
    }>
  }
}

let os: SzlabMaterialWorkflowOs

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  os = await startSzlabParallelMaterialWorkflowOs()
})

test.afterAll(async () => {
  await os?.stop()
})

/**
 * 证明当前 SZLab 物料感知工作流可在 Workbench 中配置共享/独占来源并创建两个并行任务。
 *
 * @param page 真实浏览器页面，连接 OS 公共 HTTP 合同。
 * @returns 验收通过后生成截图和 JSON 证据；无业务返回值。
 * @throws 任一工作流修订、物料绑定、任务状态或界面断言不成立时失败。
 * @safety 普通作业只进入保持运行的虚拟执行器，不连接或操作真实实验设备。
 */
test('当前 SZLab 物料感知工作流展示共享/独占并行任务', async ({
  page
}) => {
  test.setTimeout(300_000)
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ||
      resolve(process.cwd(), '../e2e-artifacts/szlab-material-parallel-current')
  )
  mkdirSync(artifactDirectory, { recursive: true })

  // 两类浏览器错误分别证明 React 页面和运行时没有未捕获异常。
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await installWorkflowPanel(page, WORKFLOW_UUID)
  await page.goto(`/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`)
  const panel = page.locator(
    '[data-panel-type="workflow-dag"]' +
      '[data-panel-instance-id="runtime-workflow"]'
  )
  await expect(panel.getByText('完整控制流 DAG')).toBeVisible()
  await panel.getByRole('button', { name: '画布模式', exact: true }).click()
  const fullMaterialBranches = panel.getByRole('button', {
    name: '完整支线',
    exact: true
  })
  await fullMaterialBranches.click()
  await expect(fullMaterialBranches).toHaveAttribute('aria-pressed', 'true')

  await configureSharedSource(
    panel,
    SOURCE_SOLVENT_PUMP_1_UUID,
    PUMP_1_MATERIAL_UUID
  )
  const sharedInspector = panel.getByRole('region', { name: '物料来源属性' })
  await expect(sharedInspector.getByText(
    '可让多个工作流任务同时绑定该来源；每个设备动作仍按物料 UUID 互斥执行。',
    { exact: true }
  )).toBeVisible()
  await sharedInspector.screenshot({
    path: join(artifactDirectory, '01-stationary-reagent-shared-source.png'),
    animations: 'disabled'
  })

  await configureSharedSource(
    panel,
    SOURCE_SOLVENT_PUMP_2_UUID,
    PUMP_2_MATERIAL_UUID
  )
  await clickVisibleCanvasWorkflowNode(panel, SOURCE_REAGENT_BOTTLE_UUID)
  const exclusiveInspector = panel.getByRole('region', {
    name: '物料来源属性'
  })
  await expect(exclusiveInspector.getByLabel('物料保管')).toHaveValue(
    'task_exclusive'
  )
  await expect(exclusiveInspector.locator(
    'option[value="shared_source"]'
  )).toHaveAttribute('disabled', '')
  await expect(exclusiveInspector.getByRole('alert')).toContainText(
    '共享来源不能流入'
  )
  await exclusiveInspector.screenshot({
    path: join(artifactDirectory, '02-moving-reagent-exclusive-guard.png'),
    animations: 'disabled'
  })

  await saveAndApply(panel, page)
  const applied = await readPublic<AuthoringWire>(
    `${os.url}/api/v1/workflows/${WORKFLOW_UUID}/authoring`
  )
  assertAppliedMaterialPolicies(applied)

  // ``firstTask`` 是先获得普通作业派发意图并保持运行的工作流任务（WorkflowTask）。
  const firstTask = await startTaskFromWorkbench(panel, page, '开始运行')
  const firstRuntime = await waitForTaskState(os.url, firstTask.uuid, 'running')
  expect(firstRuntime.jobs.some((job) => (
    job.executor_kind !== 'material_source' && job.status === 'dispatched'
  ))).toBe(true)
  const rerunButton = panel.getByRole('button', {
    name: '再次运行',
    exact: true
  })
  await expect(rerunButton).toBeEnabled()
  await rerunButton.hover()
  await page.waitForTimeout(300)
  await page.screenshot({
    path: join(artifactDirectory, '03-running-workflow-rerun-enabled.png'),
    fullPage: true,
    animations: 'disabled'
  })

  // ``secondTask`` 是同一已应用工作流图创建的独立并行任务身份。
  const secondTask = await startTaskFromWorkbench(panel, page, '再次运行')
  const secondRuntime = await waitForTaskState(os.url, secondTask.uuid, 'pending')
  expect(secondTask.uuid).not.toBe(firstTask.uuid)
  expect(secondRuntime.jobs.some((job) => (
    job.executor_kind !== 'material_source' && job.status === 'dispatched'
  ))).toBe(false)

  const firstBindings = materialBindings(firstRuntime.jobs)
  const secondBindings = materialBindings(secondRuntime.jobs)
  assertParallelBindings(firstBindings, secondBindings)

  await page.locator('[data-navigation-id="workflow-tasks"]').click()
  await expect(page.getByRole('heading', {
    name: '工作流任务',
    exact: true
  })).toBeVisible()
  const taskQueue = page.getByRole('region', { name: '任务队列' })
  await expect(taskQueue.locator('li')).toHaveCount(2)
  await expect(taskQueue.getByText('运行中', { exact: true })).toHaveCount(1)
  await expect(taskQueue.getByText('等待执行', { exact: true })).toHaveCount(1)
  const secondTaskButton = taskQueue.locator('button').filter({
    hasText: secondTask.uuid.slice(-8)
  })
  await secondTaskButton.click()
  const taskWorkflowPane = page.getByRole('region', {
    name: '任务对应工作流'
  })
  await expect(taskWorkflowPane.getByRole('heading', {
    name: WORKFLOW_NAME,
    exact: true
  })).toBeVisible()
  await expect(taskWorkflowPane.getByText(
    `Task ${secondTask.uuid.slice(-8)}`,
    { exact: true }
  )).toBeVisible()
  await page.screenshot({
    path: join(
      artifactDirectory,
      '04-parallel-task-status-and-frozen-workflow.png'
    ),
    fullPage: true,
    animations: 'disabled'
  })

  expect(pageErrors).toEqual([])
  expect(os.logs()).not.toContain('Traceback (most recent call last)')
  const evidence = {
    outcome: 'passed',
    generatedAt: new Date().toISOString(),
    workflow: { uuid: WORKFLOW_UUID, name: WORKFLOW_NAME },
    revisions: {
      frontend: readGitRevision(process.cwd()),
      os: readGitRevision(resolve(process.env.UNILAB_A1_OS_ROOT!)),
      szlab: { sha: os.szlabRevision }
    },
    executionBoundary: 'hold-only virtual executor; no physical device connection',
    tasks: [
      { task: firstRuntime.task, jobs: firstRuntime.jobs },
      { task: secondRuntime.task, jobs: secondRuntime.jobs }
    ],
    materialBindings: {
      first: Object.fromEntries(firstBindings),
      second: Object.fromEntries(secondBindings)
    },
    browser: { consoleErrors, pageErrors },
    screenshots: [
      '01-stationary-reagent-shared-source.png',
      '02-moving-reagent-exclusive-guard.png',
      '03-running-workflow-rerun-enabled.png',
      '04-parallel-task-status-and-frozen-workflow.png'
    ]
  }
  writeFileSync(
    join(artifactDirectory, 'evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8'
  )
})

/**
 * 在画布中把一个固定试剂来源改为跨任务共享。
 *
 * @param panel 当前工作流面板。
 * @param sourceNodeUuid 物料来源（MaterialSource）节点 UUID。
 * @param materialUuid 固定到该泵位的具体物料 UUID。
 * @returns 选择器补丁进入当前候选图后完成；无业务返回值。
 */
async function configureSharedSource(
  panel: Locator,
  sourceNodeUuid: string,
  materialUuid: string
): Promise<void> {
  await clickVisibleCanvasWorkflowNode(panel, sourceNodeUuid)
  const inspector = panel.getByRole('region', { name: '物料来源属性' })
  await inspector.getByLabel('固定物料').selectOption(materialUuid)
  await inspector.getByLabel('物料保管').selectOption('shared_source')
  await expect(inspector.getByLabel('物料保管')).toHaveValue('shared_source')
}

/** 保存、接受 OS 规范化源码并应用候选工作流图，不创建任务。 */
async function saveAndApply(panel: Locator, page: Page): Promise<void> {
  await saveWorkflowDraftOnly(panel)
  const diff = page.getByRole('dialog', { name: '完整 Python 差异' })
  await expect(diff).toBeVisible()
  await diff.getByRole('button', {
    name: '接受完整差异并保存',
    exact: true
  }).click()
  await applyWorkflowCandidateWithoutTask(panel, page)
}

/**
 * 从 Workbench 运行入口创建一个新的工作流任务（WorkflowTask）。
 *
 * @param panel 工作流面板。
 * @param page 浏览器页面，用于等待 OS 公共创建响应。
 * @param buttonName 当前运行入口的可访问名称。
 * @returns HTTP 201 返回的稳定工作流任务身份与初始状态。
 */
async function startTaskFromWorkbench(
  panel: Locator,
  page: Page,
  buttonName: '开始运行' | '再次运行'
): Promise<WorkflowTaskWire> {
  const responsePromise = page.waitForResponse(isWorkflowTaskCreateResponse)
  await panel.getByRole('button', { name: buttonName, exact: true }).click()
  const taskInput = page.getByLabel('工作流运行输入表单')
  await expect(taskInput).toBeVisible()
  await taskInput.getByRole('button', {
    name: '使用以上参数运行',
    exact: true
  }).click()
  const response = await responsePromise
  expect(response.status()).toBe(201)
  const envelope = await response.json() as PublicEnvelope<WorkflowTaskWire>
  expect(envelope.code, envelope.error?.msg).toBe(0)
  expect(envelope.data.workflow_uuid).toBe(WORKFLOW_UUID)
  return envelope.data
}

/** 判断浏览器响应是否为工作流任务创建的公共 HTTP 201。 */
function isWorkflowTaskCreateResponse(response: Response): boolean {
  const url = new URL(response.url())
  return response.request().method() === 'POST' &&
    url.pathname === '/api/v1/workflow-tasks'
}

/**
 * 等待一个工作流任务达到指定权威状态，并同时返回它的全部作业投影。
 *
 * @param url OS 公共 HTTP 根地址。
 * @param taskUuid 工作流任务稳定 UUID。
 * @param status 期望的 wire 状态。
 * @returns 同一任务和全部工作流节点作业（WorkflowNodeJob）投影。
 * @throws 45 秒内未达到目标时抛出最后一次可观察状态。
 */
async function waitForTaskState(
  url: string,
  taskUuid: string,
  status: string
): Promise<{ task: WorkflowTaskWire; jobs: WorkflowJobWire[] }> {
  const deadline = Date.now() + 45_000
  let last: { task: WorkflowTaskWire; jobs: WorkflowJobWire[] } | null = null
  while (Date.now() < deadline) {
    last = {
      task: await readPublic<WorkflowTaskWire>(
        `${url}/api/v1/workflow-tasks/${taskUuid}`
      ),
      jobs: await readPublic<WorkflowJobWire[]>(
        `${url}/api/v1/workflow-tasks/${taskUuid}/jobs`
      )
    }
    if (last.task.status === status) return last
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(
    `任务 ${taskUuid} 未达到 ${status}：${JSON.stringify(last)}`
  )
}

/** 从 OS 公共 HTTP 响应信封读取业务数据并关闭式检查业务错误。 */
async function readPublic<Value>(url: string): Promise<Value> {
  const response = await fetch(url)
  const envelope = await response.json() as PublicEnvelope<Value>
  if (!response.ok || envelope.code !== 0) {
    throw new Error(`公共接口失败 ${response.status}：${JSON.stringify(envelope)}`)
  }
  return envelope.data
}

/**
 * 把来源解析作业投影为“来源节点 UUID → 具体物料和保管策略”的任务物料绑定。
 */
function materialBindings(
  jobs: readonly WorkflowJobWire[]
): Map<string, { uuid: string; custodyPolicy: string }> {
  const bindings = new Map<string, { uuid: string; custodyPolicy: string }>()
  for (const job of jobs) {
    if (job.executor_kind !== 'material_source') continue
    const material = job.return_info?.material
    if (!material?.uuid || !material.custody_policy) {
      throw new Error(`来源解析作业缺少任务物料绑定：${JSON.stringify(job)}`)
    }
    bindings.set(job.workflow_node_uuid, {
      uuid: material.uuid,
      custodyPolicy: material.custody_policy
    })
  }
  expect(bindings.size).toBe(8)
  return bindings
}

/** 验证已应用工作流图只把两个固定泵试剂设为共享来源。 */
function assertAppliedMaterialPolicies(authoring: AuthoringWire): void {
  const selectors = new Map(authoring.applied_graph.nodes.map((node) => [
    node.uuid,
    node.param
  ]))
  expect(selectors.get(SOURCE_SOLVENT_PUMP_1_UUID)).toEqual(
    expect.objectContaining({
      custody_policy: 'shared_source',
      material_uuid: PUMP_1_MATERIAL_UUID
    })
  )
  expect(selectors.get(SOURCE_SOLVENT_PUMP_2_UUID)).toEqual(
    expect.objectContaining({
      custody_policy: 'shared_source',
      material_uuid: PUMP_2_MATERIAL_UUID
    })
  )
  for (const sourceUuid of EXCLUSIVE_SOURCE_UUIDS) {
    expect(selectors.get(sourceUuid)?.custody_policy).toBe('task_exclusive')
  }
}

/**
 * 验证两个任务复用固定共享试剂，同时为全部移动/消耗物料取得不同独占实例。
 */
function assertParallelBindings(
  first: ReadonlyMap<string, { uuid: string; custodyPolicy: string }>,
  second: ReadonlyMap<string, { uuid: string; custodyPolicy: string }>
): void {
  expect(new Set([...first.values()].map((binding) => binding.uuid)).size).toBe(
    first.size
  )
  expect(new Set([...second.values()].map((binding) => binding.uuid)).size).toBe(
    second.size
  )
  for (const [sourceUuid, expectedMaterialUuid] of [
    [SOURCE_SOLVENT_PUMP_1_UUID, PUMP_1_MATERIAL_UUID],
    [SOURCE_SOLVENT_PUMP_2_UUID, PUMP_2_MATERIAL_UUID]
  ] as const) {
    expect(first.get(sourceUuid)).toEqual({
      uuid: expectedMaterialUuid,
      custodyPolicy: 'shared_source'
    })
    expect(second.get(sourceUuid)).toEqual(first.get(sourceUuid))
  }
  for (const sourceUuid of EXCLUSIVE_SOURCE_UUIDS) {
    const firstBinding = first.get(sourceUuid)
    const secondBinding = second.get(sourceUuid)
    expect(firstBinding?.custodyPolicy).toBe('task_exclusive')
    expect(secondBinding?.custodyPolicy).toBe('task_exclusive')
    expect(secondBinding?.uuid).not.toBe(firstBinding?.uuid)
  }
}
