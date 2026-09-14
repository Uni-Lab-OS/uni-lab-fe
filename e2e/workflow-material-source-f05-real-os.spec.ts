import {
  expect,
  test,
  type ConsoleMessage,
  type Locator,
  type Page,
  type Request,
  type Response,
  type TestInfo,
  type WebSocket
} from '@playwright/test'
import { setTimeout as delay } from 'node:timers/promises'

import {
  joinNativeLogs,
  postPublicEnvelope,
  readPublicEnvelope,
  readGitRevision,
  requestJsonInBrowser,
  startF05MaterialSourceRealOs,
  UUID_PATTERN,
  writeF05Evidence,
  type F05MaterialSourceRealOs
} from './helpers/f05-material-source-real-os'
import {
  applyWorkflowCandidateWithoutTask,
  installWorkflowPanel,
  saveWorkflowDraftOnly
} from './helpers/workflow-runtime-ui'
import { readFixedExecutorEvidence } from './helpers/f05-fixed-executor-contract'
import { clickVisibleCanvasWorkflowNode } from './helpers/f05-workflow-canvas-node'

interface PublicEnvelope<Value> {
  code: number
  data?: Value
  error?: { msg?: string }
}

interface MaterialAggregateWire {
  material: {
    uuid: string
    resource_template_uuid: string
  }
  current_site_uuid?: string | null
}

interface MaterialGraphWire {
  nodes: MaterialAggregateWire[]
}

interface AuthoringNodeWire {
  uuid: string
  param?: { resource_template_uuid?: string }
}
interface AuthoringWire {
  candidate?: {
    graph: { nodes: AuthoringNodeWire[] }
  } | null
  applied_graph: { nodes: AuthoringNodeWire[] }
}

interface WorkflowTaskWire {
  uuid: string
  status: string
}

interface WorkflowJobWire {
  uuid: string
  workflow_node_uuid: string
  executor_kind: string
  status: string
  return_info: {
    material?: {
      uuid?: string
      resource_template_uuid?: string
      custody_policy?: string
    }
  }
}

interface NetworkEntry {
  method: string
  path: string
  status?: number
}

// 该身份只属于进程外验收夹具，用于在首个终态任务自动释放后制造真实库存冲突。
const FIXTURE_HOLDER_TASK_UUID = 'f0500000-0000-4000-8000-000000000001'

/**
 * 记录浏览器对真实 OS 的公共网络访问和运行时异常证据。
 *
 * 参数：构造时传入 `page` 以安装具名监听器。
 * 返回：实例暴露请求、响应、WebSocket 与页面错误集合。
 * 异常：URL 无法解析时由 Playwright 监听调用原样抛出。
 */
class BrowserEvidenceCollector {
  readonly requests: NetworkEntry[] = []
  readonly responses: NetworkEntry[] = []
  readonly websocketUrls: string[] = []
  readonly consoleErrors: string[] = []
  readonly pageErrors: string[] = []

  /** 构造并绑定监听器；参数 `page` 是目标页面，返回新实例，异常由 Playwright 传播。 */
  constructor(page: Page) {
    this.onConsole = this.onConsole.bind(this)
    this.onPageError = this.onPageError.bind(this)
    this.onWebSocket = this.onWebSocket.bind(this)
    this.onRequest = this.onRequest.bind(this)
    this.onResponse = this.onResponse.bind(this)
    page.on('console', this.onConsole)
    page.on('pageerror', this.onPageError)
    page.on('websocket', this.onWebSocket)
    page.on('request', this.onRequest)
    page.on('response', this.onResponse)
  }

  /**
   * 记录浏览器控制台错误。
   *
   * 参数：`message` 是 Playwright 控制台消息。返回：无。异常：无。
   */
  private onConsole(message: ConsoleMessage): void {
    if (message.type() === 'error') this.consoleErrors.push(message.text())
  }

  /**
   * 记录未捕获页面异常。
   *
   * 参数：`error` 是页面抛出的异常。返回：无。异常：无。
   */
  private onPageError(error: Error): void {
    this.pageErrors.push(error.message)
  }

  /**
   * 记录浏览器建立的 WebSocket 地址。
   *
   * 参数：`socket` 是新建 WebSocket。返回：无。异常：无。
   */
  private onWebSocket(socket: WebSocket): void {
    this.websocketUrls.push(socket.url())
  }

  /**
   * 记录指向 OS v1 的浏览器请求。
   *
   * 参数：`request` 是浏览器请求。返回：无；非 v1 请求被忽略。异常：无。
   */
  private onRequest(request: Request): void {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/v1/')) return
    this.requests.push({
      method: request.method(),
      path: `${url.pathname}${url.search}`
    })
  }

  /**
   * 记录指向 OS v1 的浏览器响应。
   *
   * 参数：`response` 是浏览器响应。返回：无；非 v1 响应被忽略。异常：无。
   */
  private onResponse(response: Response): void {
    const url = new URL(response.url())
    if (!url.pathname.startsWith('/api/v1/')) return
    this.responses.push({
      method: response.request().method(),
      path: `${url.pathname}${url.search}`,
      status: response.status()
    })
  }

  /**
   * 判断浏览器是否发出过指定公共请求。
   *
   * 参数：`method` 与 `path` 是要求精确匹配的方法和路径。
   * 返回：存在匹配记录时为 `true`。异常：无。
   */
  hasRequest(method: string, path: string): boolean {
    for (const entry of this.requests) {
      if (entry.method === method && entry.path === path) return true
    }
    return false
  }

  /**
   * 判断浏览器是否访问过 OS 私有库存路径。
   *
   * 参数：无。返回：出现 `/api/v1/inventory/` 请求时为 `true`。异常：无。
   */
  hasPrivateInventoryRequest(): boolean {
    for (const entry of this.requests) {
      if (entry.path.startsWith('/api/v1/inventory/')) return true
    }
    return false
  }

  /**
   * 判断浏览器是否收到非预期的 OS 公共失败响应。
   *
   * 参数：无。返回：除可选物料形状能力 404 外，任一 v1 响应状态码不小于
   * 400 时为 `true`。异常：无。
   */
  hasUnexpectedFailedResponse(): boolean {
    for (const entry of this.responses) {
      if ((entry.status ?? 0) < 400) continue
      if (
        entry.method === 'GET' && entry.path === '/api/v1/material-shapes' &&
        entry.status === 404
      ) continue
      return true
    }
    return false
  }

  /**
   * 返回排除浏览器对已验证可选 404 的通用资源加载提示后的控制台错误。
   *
   * 参数：无。返回：仍需导致验收失败的控制台错误。异常：无；对应 HTTP 响应
   * 已由 `hasUnexpectedFailedResponse` 独立校验，其他失败不会被此过滤掩盖。
   */
  unexpectedConsoleErrors(): string[] {
    return this.consoleErrors.filter(
      (message) => message !==
        'Failed to load resource: the server responded with a status of 404 (Not Found)'
    )
  }
}

/**
 * 为一次公共响应等待构造具名谓词，避免把路径判断散落在测试步骤中。
 *
 * 参数：构造时冻结 HTTP 方法与公共路径。
 * 返回：`matches` 在响应符合两项身份时返回 `true`。
 * 异常：响应 URL 不能解析时原样抛出。
 */
class PublicResponseMatcher {
  /** 构造公共响应匹配器；参数是 HTTP 方法与路径，返回新实例，异常无。 */
  constructor(
    private readonly method: string,
    private readonly path: string
  ) {
    this.matches = this.matches.bind(this)
  }

  /**
   * 核验一个响应是否属于目标公共合同。
   *
   * 参数：`response` 是候选响应。返回：方法和路径均相等时为 `true`。异常：无。
   */
  matches(response: Response): boolean {
    return response.request().method() === this.method &&
      new URL(response.url()).pathname === this.path
  }
}

let os: F05MaterialSourceRealOs

test.describe.configure({ mode: 'serial' })
test.beforeAll(startRealOs)
test.afterAll(stopRealOs)
test(
  '公共物料图驱动既有物料来源并以相同身份完成准入重试',
  runF05MaterialSourceAcceptance
)

/**
 * 启动本文件唯一真实 OS 运行时。
 *
 * 参数：无。返回：无；结果保存到本文件串行夹具。
 * 异常：native CLI 或公共就绪合同失败时原样传播。
 */
async function startRealOs(): Promise<void> {
  test.setTimeout(150_000)
  os = await startF05MaterialSourceRealOs()
}

/**
 * 停止本文件唯一真实 OS 运行时。
 *
 * 参数：`testInfo` 提供本轮结果；失败时在停机前保留 native 日志。
 * 返回：无。异常：证据落盘或清理失败时原样传播。
 */
async function stopRealOs({}, testInfo: TestInfo): Promise<void> {
  if (testInfo.status !== 'passed' && os) {
    writeF05Evidence({
      outcome: 'failed',
      testStatus: testInfo.status,
      frontendRevision: readGitRevision(process.cwd()),
      osRevision: os.osRevision,
      nativeCommand: os.command,
      nativeStdout: os.logs(),
      nativeLogs: os.nativeLogs()
    })
  }
  await os?.stop()
}

/**
 * 证明浏览器只依赖公共合同完成既有物料选择、冲突重排与新建模式失败关闭。
 *
 * 参数：`page` 是真实 kernel-web 页面。
 * 返回：无；测试通过即证明公共 HTTP、UI 与真实本地调度器（Scheduler）纵向合同。
 * 异常：任何私有库存调用、身份变化、部分失败提交或浏览器异常都使测试失败。
 */
async function runF05MaterialSourceAcceptance(
  { page }: { page: Page }
): Promise<void> {
  test.setTimeout(240_000)
  const authoring = await readPublicEnvelope<AuthoringWire>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  // `resourceTemplateUuid` 是候选物料来源（MaterialSource）冻结的资源模板身份。
  const resourceTemplateUuid = sourceResourceTemplateUuid(authoring)
  const fixedExecutor = await readFixedExecutorEvidence(
    os.url, os.mountMaterialUuid
  )
  const createdMaterial = await postPublicEnvelope<{ uuid: string }>(
    `${os.url}/api/v1/materials`,
    {
      resource_template_uuid: resourceTemplateUuid,
      barcode: 'F05-PUBLIC-EXISTING-001',
      name: 'F05 公共既有孔板',
      site_placement: { action: 'place', site_uuid: os.siteUuid }
    }
  )
  // `existingMaterialUuid` 是创作选择器、公开物料图和短期遗留库存预留
  // `inventory_reservation` 共享的稳定物料身份；后者尚非任务物料预留
  // （TaskMaterialReservation）。
  const existingMaterialUuid = createdMaterial.uuid
  expect(existingMaterialUuid).toMatch(UUID_PATTERN)
  const materialGraphAfterCreate = await readPublicEnvelope<MaterialGraphWire>(
    `${os.url}/api/v1/materials/graph`
  )
  expect(findMaterial(materialGraphAfterCreate, existingMaterialUuid)).toEqual(
    expect.objectContaining({ current_site_uuid: os.siteUuid })
  )

  await installWorkflowPanel(page, os.workflowUuid)
  const evidence = new BrowserEvidenceCollector(page)
  await page.goto(`/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`)
  const panel = page.locator(
    '[data-panel-type="workflow-dag"][data-panel-instance-id="runtime-workflow"]'
  )
  await expect(panel.getByText('完整控制流 DAG')).toBeVisible()
  await panel.getByRole('button', { name: '画布模式', exact: true }).click()
  await clickVisibleCanvasWorkflowNode(panel, os.sourceNodeUuid)
  const inspector = panel.getByRole('region', { name: '物料来源属性' })
  await inspector.getByRole('button', {
    name: '已有物料',
    exact: true
  }).click()
  await inspector.getByLabel('固定物料').selectOption(existingMaterialUuid)
  await saveAndApply(panel, page)

  const firstCreated = startWorkflowFromPanel(panel, page)
  const firstEnvelope = await firstCreated
  if (firstEnvelope.code !== 0) {
    throw new Error(`首个工作流任务创建失败：${JSON.stringify(firstEnvelope)}`)
  }
  // `firstTaskUuid` 是成功取得短期遗留库存预留的首个工作流任务（WorkflowTask）身份。
  const firstTaskUuid = (firstEnvelope.data as { uuid: string }).uuid
  expect(firstTaskUuid).toMatch(UUID_PATTERN)
  const firstRuntime = await waitForTaskAndJob(
    os.url,
    firstTaskUuid,
    'succeeded',
    'succeeded'
  )
  assertMaterialSourceResolutionJob(firstRuntime.job, existingMaterialUuid)

  // 成功终态已经由协调器释放本任务的物料预留与冻结绑定；通过同一生产
  // InventoryService 再次释放必须保持幂等空结果。随后建立独立测试占用，使
  // 第二个任务的等待不依赖资源泄漏或错误的终态假设。
  const firstReleaseResult = os.releaseWorkflowReservation(firstTaskUuid)
  expect(firstReleaseResult).toEqual({
    workflow_id: firstTaskUuid,
    released_nodes: [],
    released_bindings: []
  })
  const fixtureReserveResult = os.reserveWorkflowMaterial(
    FIXTURE_HOLDER_TASK_UUID,
    existingMaterialUuid
  )
  expect(fixtureReserveResult).toEqual({
    workflow_id: FIXTURE_HOLDER_TASK_UUID,
    reserved_nodes: [os.sourceNodeUuid]
  })

  const secondEnvelope = await startWorkflowFromPanel(panel, page)
  expect(secondEnvelope.code).toBe(0)
  // `secondTaskUuid` 是争用相同既有物料的第二个工作流任务（WorkflowTask）身份。
  const secondTaskUuid = (secondEnvelope.data as { uuid: string }).uuid
  const blockedRuntime = await waitForTaskAndJob(
    os.url,
    secondTaskUuid,
    'pending',
    'pending'
  )
  // 冲突由 0590 当前短期遗留库存预留 `inventory_reservation` 产生；此处只从
  // 公开 wire 观察，不把它冒充正式任务物料预留（TaskMaterialReservation）。
  // `blockedJobUuid` 是准入重试（AdmissionRetry）前后必须保持不变的作业身份。
  const blockedJobUuid = blockedRuntime.job.uuid
  const rescheduleResult = await page.evaluate(requestJsonInBrowser, {
    url: `${os.url}/api/v1/reschedule`,
    method: 'POST'
  })
  expect(rescheduleResult.status).toBe(200)
  const blockedAfterRetry = await waitForTaskAndJob(
    os.url,
    secondTaskUuid,
    'pending',
    'pending'
  )
  expect(blockedAfterRetry.task.uuid).toBe(secondTaskUuid)
  expect(blockedAfterRetry.job.uuid).toBe(blockedJobUuid)

  const releaseResult = os.releaseWorkflowReservation(FIXTURE_HOLDER_TASK_UUID)
  expect(releaseResult).toEqual({
    workflow_id: FIXTURE_HOLDER_TASK_UUID,
    released_nodes: [os.sourceNodeUuid],
    released_bindings: []
  })
  const admittedReschedule = await page.evaluate(requestJsonInBrowser, {
    url: `${os.url}/api/v1/reschedule`,
    method: 'POST'
  })
  expect(admittedReschedule.status).toBe(200)
  const admittedRuntime = await waitForTaskAndJob(
    os.url,
    secondTaskUuid,
    'succeeded',
    'succeeded'
  )
  expect(admittedRuntime.task.uuid).toBe(secondTaskUuid)
  expect(admittedRuntime.job.uuid).toBe(blockedJobUuid)
  assertMaterialSourceResolutionJob(admittedRuntime.job, existingMaterialUuid)
  let ordinaryDispatchJobCount = 0
  for (const job of [firstRuntime.job, admittedRuntime.job]) {
    if (job.executor_kind !== 'material_source') ordinaryDispatchJobCount += 1
  }
  expect(ordinaryDispatchJobCount).toBe(0)

  await clickVisibleCanvasWorkflowNode(panel, os.sourceNodeUuid)
  await inspector.getByRole('button', {
    name: '新建物料',
    exact: true
  }).click()
  await saveAndApply(panel, page)
  // 以下两个快照冻结失败关闭前的工作流任务（WorkflowTask）列表和物料图事实。
  const tasksBeforeReject = await readPublicEnvelope<unknown>(
    `${os.url}/api/v1/workflow-tasks?page=1&page_size=100`
  )
  const graphBeforeReject = await readPublicEnvelope<MaterialGraphWire>(
    `${os.url}/api/v1/materials/graph`
  )
  const rejectedEnvelope = await startWorkflowFromPanel(panel, page)
  expect(rejectedEnvelope.code).toBe(1000)
  expect(rejectedEnvelope.error?.msg).toBeTruthy()
  const tasksAfterReject = await readPublicEnvelope<unknown>(
    `${os.url}/api/v1/workflow-tasks?page=1&page_size=100`
  )
  const graphAfterReject = await readPublicEnvelope<MaterialGraphWire>(
    `${os.url}/api/v1/materials/graph`
  )
  expect(tasksAfterReject).toEqual(tasksBeforeReject)
  expect(graphAfterReject).toEqual(graphBeforeReject)

  expect(evidence.hasRequest('GET', '/api/v1/materials/graph')).toBe(true)
  expect(evidence.hasRequest('POST', '/api/v1/workflow-tasks')).toBe(true)
  expect(evidence.hasRequest('POST', '/api/v1/reschedule')).toBe(true)
  expect(evidence.hasPrivateInventoryRequest()).toBe(false)
  expect(evidence.hasUnexpectedFailedResponse()).toBe(false)
  expect(evidence.websocketUrls).toEqual([])
  expect(evidence.unexpectedConsoleErrors()).toEqual([])
  expect(evidence.pageErrors).toEqual([])

  const nativeLogs = joinNativeLogs(os.nativeLogs())
  expect(os.logs()).not.toContain('Traceback (most recent call last)')
  expect(nativeLogs).not.toContain('Traceback (most recent call last)')
  writeF05Evidence({
    frontendRevision: readGitRevision(process.cwd()),
    osRevision: os.osRevision,
    nativeCommand: os.command,
    workflowUuid: os.workflowUuid,
    existingMaterialUuid,
    firstTaskUuid,
    fixtureReserveResult,
    secondTaskUuid,
    blockedJobUuid,
    releaseResult,
    admittedRuntime,
    ordinaryDispatchJobCount,
    fixedExecutor,
    requests: evidence.requests,
    responses: evidence.responses,
    websocketUrls: evidence.websocketUrls,
    consoleErrors: evidence.consoleErrors,
    pageErrors: evidence.pageErrors
  })
}

/**
 * 从公开创作候选中读取物料来源（MaterialSource）资源模板 UUID。
 *
 * 参数：`authoring` 是真实 OS 返回的创作聚合。
 * 返回：固定来源节点上的资源模板 UUID。
 * 异常：节点或模板身份缺失时抛出，禁止猜测模板。
 */
function sourceResourceTemplateUuid(authoring: AuthoringWire): string {
  const nodes = authoring.candidate?.graph.nodes ?? authoring.applied_graph.nodes
  for (const node of nodes) {
    if (node.uuid === os.sourceNodeUuid) {
      const identity = node.param?.resource_template_uuid
      if (identity) return identity
    }
  }
  throw new Error(`公共创作候选缺少物料来源资源模板 UUID：${JSON.stringify(authoring)}`)
}

/**
 * 在公共物料图中查找稳定物料身份。
 *
 * 参数：`graph` 是物料图，`materialUuid` 是待查物料 UUID。
 * 返回：匹配聚合。
 * 异常：物料缺失时抛出，禁止回退私有库存接口。
 */
function findMaterial(
  graph: MaterialGraphWire,
  materialUuid: string
): MaterialAggregateWire {
  for (const aggregate of graph.nodes) {
    if (aggregate.material.uuid === materialUuid) return aggregate
  }
  throw new Error(`公共物料图缺少物料 UUID：${materialUuid}`)
}

/**
 * 保存当前画布草稿、接受规范源码差异并应用工作流（Workflow）。
 *
 * 参数：`panel` 是工作流面板，`page` 提供差异对话框。
 * 返回：应用成功后返回无。异常：任何 UI/服务端合同断言失败时由 Playwright 抛出。
 */
async function saveAndApply(panel: Locator, page: Page): Promise<void> {
  await saveWorkflowDraftOnly(panel)
  const diff = page.getByRole('dialog', { name: '完整 Python 差异' })
  await expect(diff).toBeVisible()
  await diff.getByRole('button', {
    name: '接受完整差异并保存',
    exact: true
  }).click()
  const applyMatcher = new PublicResponseMatcher(
    'POST',
    `/api/v1/workflows/${os.workflowUuid}/authoring/apply`
  )
  const applyResponsePromise = page.waitForResponse(applyMatcher.matches)
  await applyWorkflowCandidateWithoutTask(panel, page)
  const applyResponse = await applyResponsePromise
  const applyEnvelope = await applyResponse.json() as PublicEnvelope<unknown>
  expect(applyResponse.status()).toBe(200)
  expect(applyEnvelope.code).toBe(0)
  await expect(panel.getByText(
    /已取消本次运行；已应用版本 \d+ 保持不变，未创建任务/
  )).toBeVisible()
}

/**
 * 通过工作流面板启动一次工作流任务（WorkflowTask）并返回原始后端（Backend）信封。
 *
 * 参数：`panel` 是运行入口，`page` 用于等待公开任务创建响应。
 * 返回：任务创建的业务 envelope，成功和失败均保留原样。
 * 异常：UI 未发起公共请求或响应不是 JSON 时抛出。
 */
async function startWorkflowFromPanel(
  panel: Locator,
  page: Page
): Promise<PublicEnvelope<unknown>> {
  const matcher = new PublicResponseMatcher('POST', '/api/v1/workflow-tasks')
  const responsePromise = page.waitForResponse(matcher.matches)
  await panel.getByRole('button', { name: '开始运行', exact: true }).click()
  await panel.getByRole('button', {
    name: '使用以上参数运行',
    exact: true
  }).click()
  return await (await responsePromise).json() as PublicEnvelope<unknown>
}

/**
 * 等待同一工作流任务（WorkflowTask）及其唯一物料来源解析作业达到目标 wire 状态。
 *
 * 参数：`url`、`taskUuid` 标识公开资源，两个状态是待观察 wire 值。
 * 返回：保持原身份的任务与作业投影。
 * 异常：30 秒内未达到目标时抛出，并且不读取私有数据库或接口。
 */
async function waitForTaskAndJob(
  url: string,
  taskUuid: string,
  taskStatus: string,
  jobStatus: string
): Promise<{ task: WorkflowTaskWire; job: WorkflowJobWire }> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const task = await readPublicEnvelope<WorkflowTaskWire>(
      `${url}/api/v1/workflow-tasks/${taskUuid}`
    )
    const jobs = await readPublicEnvelope<WorkflowJobWire[]>(
      `${url}/api/v1/workflow-tasks/${taskUuid}/jobs`
    )
    if (jobs.length !== 1) {
      throw new Error(
        `工作流任务 ${taskUuid} 必须恰有一个物料来源解析作业，实际 ${jobs.length}`
      )
    }
    const job = jobs[0]
    if (task.status === taskStatus && job.status === jobStatus) {
      return { task, job }
    }
    await delay(100)
  }
  throw new Error(
    `工作流任务 ${taskUuid} 未达到 ${taskStatus}/${jobStatus}`
  )
}

/**
 * 核验唯一作业只承担物料来源解析，不包含可派发设备动作。
 *
 * 参数：`job` 是公开作业投影，`materialUuid` 是预期任务物料绑定
 * （TaskMaterialBinding）身份。返回：无。异常：节点、执行种类或有类型
 * `return_info.material` 不一致时由 Playwright 断言失败。
 */
function assertMaterialSourceResolutionJob(
  job: WorkflowJobWire,
  materialUuid: string
): void {
  expect(job.workflow_node_uuid).toBe(os.sourceNodeUuid)
  expect(job.executor_kind).toBe('material_source')
  expect(job.return_info.material?.uuid).toBe(materialUuid)
  expect(job.return_info.material?.custody_policy).toBe('task_exclusive')
}
