import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  readCleanGitRevision,
  startF06CompositeRealOs,
  type F06CompositeRealOs,
  type GitRevisionEvidence
} from './helpers/f06-composite-real-os'

let os: F06CompositeRealOs
let frontendRevision: GitRevisionEvidence
/** 本轮固定点、浏览器和进程日志证据的唯一输出目录。 */
const ARTIFACT_DIRECTORY = resolve(
  process.env.UNILAB_C1_E2E_ARTIFACT_DIR ||
    '../e2e-artifacts/c1-composite-authoring'
)

test.describe.configure({ mode: 'serial' })

/**
 * 锁定当前前端（FE）候选并启动当前 OS 的真实 HTTP 夹具。
 *
 * @returns 两个源码身份均干净且 OS 公共接口就绪后返回无。
 * @throws 任一工作树脏或 OS 启动失败时关闭本轮验收。
 */
async function startCompositeFixture(): Promise<void> {
  mkdirSync(ARTIFACT_DIRECTORY, { recursive: true })
  frontendRevision = readCleanGitRevision(process.cwd(), '前端（FE）')
  os = await startF06CompositeRealOs()
}

/**
 * 保存 OS 控制台并关闭隔离进程。
 *
 * @returns 日志落盘且 OS 退出后返回无。
 * @throws 日志写入或进程停止失败时由 Playwright 报告。
 */
async function stopCompositeFixture(): Promise<void> {
  if (!os) return
  try {
    writeFileSync(
      resolve(ARTIFACT_DIRECTORY, 'os-console.log'),
      os.logs(),
      'utf8'
    )
  } finally {
    await os.stop()
  }
}

test.beforeAll(startCompositeFixture)
test.afterAll(stopCompositeFixture)

/**
 * 验证已发布子工作流在前端保持单一调用边界，并仅在会话内展开 OS 私有内部图。
 *
 * @param page Playwright 浏览器页面；测试通过当前候选真实 OS HTTP 接口读取图。
 * @returns Promise 完成时表示折叠、展开、重载和零写入断言全部通过。
 * @throws OS、目录、浏览器交互或证据写入失败时由 Playwright 报告。
 */
test('Published child stays a boundary while its OS-owned graph expands locally', async ({
  page
}) => {
  test.setTimeout(120_000)

  const authoringPath =
    `/api/v1/workflows/${os.compositeParentWorkflowUuid}/authoring`
  const authoringUrl = `${os.url}${authoringPath}`
  const before = await readEnvelope<AuthoringAggregate>(authoringUrl)
  expect(before.state).toBe('applied')
  writeFileSync(
    resolve(ARTIFACT_DIRECTORY, 'authoring-before.json'),
    `${JSON.stringify(before, null, 2)}\n`,
    'utf8'
  )
  const catalogList = await readRawJson(
    `${os.url}/api/v1/workflow-node-templates?page=1&page_size=100`
  )
  const workflowCatalogList = await readRawJson(
    `${os.url}/api/v1/workflow-node-templates?node_type=workflow&page_size=100`
  )
  const catalogItems = uniqueCatalogItems([
    ...((catalogList as CatalogEnvelope).data.items ?? []),
    ...((workflowCatalogList as CatalogEnvelope).data.items ?? [])
  ])
  const catalogDetails = await Promise.all(catalogItems.map((item) =>
    readRawJson(
      `${os.url}/api/v1/workflow-node-templates/${encodeURIComponent(item.uuid)}`
    )
  ))
  writeFileSync(
    resolve(ARTIFACT_DIRECTORY, 'catalog-wire.json'),
    `${JSON.stringify({
      default_list: catalogList,
      workflow_list: workflowCatalogList,
      details: catalogDetails
    }, null, 2)}\n`,
    'utf8'
  )
  const compiled = await readEnvelope<AuthoringTransformResult>(
    `${os.url}/api/v1/authoring/compile`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow_uuid: os.compositeParentWorkflowUuid,
        revision: before.workflow_revision,
        source_uri: before.draft?.source_uri,
        python_source: before.draft?.python_source,
        applied_graph: before.applied_graph
      })
    }
  )
  writeFileSync(
    resolve(ARTIFACT_DIRECTORY, 'compile-fixed-point.json'),
    `${JSON.stringify(compiled, null, 2)}\n`,
    'utf8'
  )
  const recompiled = await readEnvelope<AuthoringTransformResult>(
    `${os.url}/api/v1/authoring/compile`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow_uuid: os.compositeParentWorkflowUuid,
        revision: before.workflow_revision,
        source_uri: before.draft?.source_uri,
        python_source: compiled.normalized_python_source,
        applied_graph: before.applied_graph
      })
    }
  )
  writeFileSync(
    resolve(ARTIFACT_DIRECTORY, 'recompile-fixed-point.json'),
    `${JSON.stringify(recompiled, null, 2)}\n`,
    'utf8'
  )
  const generated = await readEnvelope<AuthoringTransformResult>(
    `${os.url}/api/v1/authoring/generate-python`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow_uuid: os.compositeParentWorkflowUuid,
        revision: before.workflow_revision,
        source_uri: before.draft?.source_uri,
        graph: before.applied_graph
      })
    }
  )
  writeFileSync(
    resolve(ARTIFACT_DIRECTORY, 'generate-fixed-point.json'),
    `${JSON.stringify(generated, null, 2)}\n`,
    'utf8'
  )
  const generatedRecompiled = await readEnvelope<AuthoringTransformResult>(
    `${os.url}/api/v1/authoring/compile`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflow_uuid: os.compositeParentWorkflowUuid,
        revision: before.workflow_revision,
        source_uri: before.draft?.source_uri,
        python_source: generated.normalized_python_source,
        applied_graph: generated.graph
      })
    }
  )
  writeFileSync(
    resolve(ARTIFACT_DIRECTORY, 'generate-recompile-fixed-point.json'),
    `${JSON.stringify(generatedRecompiled, null, 2)}\n`,
    'utf8'
  )
  for (const result of [compiled, recompiled, generated, generatedRecompiled]) {
    expect(result.diagnostics.filter((item) => item.severity === 'error'))
      .toEqual([])
    expect(result.graph).not.toBeNull()
    expect(result.normalized_python_source).not.toBeNull()
  }
  const compiledGraph = requiredTransformGraph(compiled, 'compile')
  const recompiledGraph = requiredTransformGraph(recompiled, 'recompile')
  const generatedGraph = requiredTransformGraph(generated, 'generate')
  const generatedRecompiledGraph = requiredTransformGraph(
    generatedRecompiled,
    'generate-recompile'
  )
  expect(recompiled.normalized_python_source)
    .toBe(compiled.normalized_python_source)
  expect(canonicalAuthoringGraph(recompiledGraph))
    .toEqual(canonicalAuthoringGraph(compiledGraph))
  expect(generatedRecompiled.normalized_python_source)
    .toBe(generated.normalized_python_source)
  expect(canonicalAuthoringGraph(generatedGraph))
    .toEqual(canonicalAuthoringGraph(before.applied_graph))
  expect(canonicalAuthoringGraph(generatedRecompiledGraph))
    .toEqual(canonicalAuthoringGraph(before.applied_graph))
  const invocation = before.applied_graph.nodes.find(
    (node) => node.uuid === os.compositeInvocationUuid
  )
  expect(invocation).toBeTruthy()
  const internals = before.applied_graph.nodes.filter(
    (node) => node.parent_uuid === os.compositeInvocationUuid
  )
  expect(internals.length).toBeGreaterThan(0)
  const boundaryEdges = before.applied_graph.edges.filter((edge) =>
    edge.source_node_uuid === os.compositeInvocationUuid ||
    edge.target_node_uuid === os.compositeInvocationUuid
  )
  expect(boundaryEdges).toHaveLength(2)
  expect(boundaryEdges.every((edge) =>
    Boolean(edge.source_handle_uuid && edge.target_handle_uuid)
  )).toBe(true)
  expect(before.draft?.python_source).toContain(
    'from production_lab.workflows.composite_child import published_child'
  )
  expect(before.draft?.python_source.match(/child = published_child\(/g))
    .toHaveLength(1)

  const browserErrors: string[] = []
  const applicationErrors: string[] = []
  const webSockets: string[] = []
  const requests: RequestLedgerEntry[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('websocket', (webSocket) => webSockets.push(webSocket.url()))
  page.on('request', (request) => {
    if (!request.url().startsWith(`${os.url}/api/v1/`)) return
    requests.push({
      method: request.method(),
      path: new URL(request.url()).pathname
    })
  })
  page.on('response', (response) => {
    if (
      response.url().startsWith(`${os.url}/api/v1/`) &&
      response.status() >= 400
    ) {
      applicationErrors.push(
        `${response.request().method()} ` +
        `${new URL(response.url()).pathname} ${response.status()}`
      )
    }
  })

  const storageKey = `unilab.workflow.active.${
    encodeURIComponent(`local-python:${os.url}`)
  }.v1`
  await page.addInitScript(({ key, workflowUuid }) => {
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, workflowId: workflowUuid })
    )
  }, { key: storageKey, workflowUuid: os.compositeParentWorkflowUuid })

  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  await expect(page.getByText('完整控制流 DAG')).toBeVisible()
  await page.getByRole('button', { name: '画布模式' }).click()
  const actionPalette = page.getByLabel('动作（Action）模板')
  const workflowPalette = page.getByLabel('子工作流（Workflow）模板')
  await expect(actionPalette).toBeVisible()
  await expect(actionPalette.getByText('输送', { exact: true })).toBeVisible()
  await expect(workflowPalette).toBeVisible()
  await expect(workflowPalette.getByText('F06 Published child', {
    exact: true
  })).toBeVisible()
  await expect(page.getByText('Workflow Action Catalog 返回了无效响应'))
    .toHaveCount(0)
  const invocationCard = page.locator(
    `.react-flow__node [data-workflow-node-uuid="${os.compositeInvocationUuid}"]`
  )
  const internalCard = page.locator(
    `.react-flow__node [data-workflow-node-uuid="${internals[0]?.uuid}"]`
  )
  await expect(invocationCard).toBeVisible()
  await expect(internalCard).toHaveCount(0)
  await page.screenshot({
    path: resolve(ARTIFACT_DIRECTORY, '01-collapsed.png'),
    fullPage: true
  })

  requests.length = 0
  await invocationCard.getByRole('button', {
    name: /展开子工作流/
  }).click()
  await expect(internalCard).toBeVisible()
  await page.screenshot({
    path: resolve(ARTIFACT_DIRECTORY, '02-expanded.png'),
    fullPage: true
  })
  await invocationCard.getByRole('button', {
    name: /折叠子工作流/
  }).click()
  await expect(internalCard).toHaveCount(0)
  await invocationCard.getByRole('button', {
    name: /展开子工作流/
  }).click()
  await expect(internalCard).toBeVisible()

  const toggleRequests = [...requests]
  expect(toggleRequests.filter(isAuthoringMutation)).toEqual([])
  expect(toggleRequests.filter(isRuntimeRequest)).toEqual([])
  expect(webSockets).toEqual([])
  expect(applicationErrors).toEqual([])
  expect(browserErrors).toEqual([])

  await page.reload()
  await expect(page.getByText('完整控制流 DAG')).toBeVisible()
  await expect(invocationCard).toBeVisible()
  await expect(internalCard).toHaveCount(0)
  await page.screenshot({
    path: resolve(ARTIFACT_DIRECTORY, '03-reload-collapsed.png'),
    fullPage: true
  })

  const after = await readEnvelope<AuthoringAggregate>(authoringUrl)
  expect(after.applied_graph).toEqual(before.applied_graph)
  expect(after.candidate?.graph).toEqual(before.candidate?.graph)
  expect(after.draft?.python_source).toBe(before.draft?.python_source)
  expect(after.workflow_revision).toBe(before.workflow_revision)

  writeFileSync(
    resolve(ARTIFACT_DIRECTORY, 'network-graph-ledger.json'),
    `${JSON.stringify({
      schema_version: 1,
      source_revisions: {
        frontend: frontendRevision,
        os: os.osRevision
      },
      workflow_uuid: os.compositeParentWorkflowUuid,
      workflow_revision: before.workflow_revision,
      invocation_uuid: os.compositeInvocationUuid,
      internal_node_uuids: internals.map((node) => node.uuid).sort(),
      boundary_edges: boundaryEdges.map((edge) => ({
        source_node_uuid: edge.source_node_uuid,
        source_handle_uuid: edge.source_handle_uuid,
        target_node_uuid: edge.target_node_uuid,
        target_handle_uuid: edge.target_handle_uuid
      })),
      toggle_requests: toggleRequests,
      toggle_authoring_mutations: 0,
      toggle_runtime_requests: 0,
      websocket_count: webSockets.length,
      application_error_count: applicationErrors.length,
      page_error_count: browserErrors.length,
      reload_reset_to_collapsed: true,
      compile_recompile_fixed_point: true,
      graph_python_graph_fixed_point: true,
      graph_unchanged: true,
      python_unchanged: true
    }, null, 2)}\n`,
    'utf8'
  )
})

interface AuthoringAggregate {
  state: string
  workflow_revision: number
  draft: { python_source: string; source_uri: string } | null
  candidate: { graph: AuthoringGraph } | null
  applied_graph: AuthoringGraph
}

interface AuthoringTransformResult {
  diagnostics: Array<{ severity: string; code: string; message: string }>
  graph: AuthoringGraph | null
  normalized_python_source: string | null
}

interface AuthoringGraph {
  nodes: Array<{ uuid: string; parent_uuid?: string | null }>
  edges: Array<{
    source_node_uuid: string
    source_handle_uuid: string
    target_node_uuid: string
    target_handle_uuid: string
  }>
  [key: string]: unknown
}

interface RequestLedgerEntry {
  method: string
  path: string
}

interface CatalogEnvelope {
  data: {
    items?: Array<{ uuid: string }>
  }
}

/**
 * 提取变换结果中的非空工作流图（Workflow Graph）。
 *
 * @param result 当前编译或生成结果。
 * @param stage 失败消息中的变换阶段名称。
 * @returns 已由公共接口返回的非空图。
 * @throws 结果没有图时抛出明确的固定点证据错误。
 */
function requiredTransformGraph(
  result: AuthoringTransformResult,
  stage: string
): AuthoringGraph {
  if (result.graph === null) {
    throw new Error(`${stage} 没有返回固定点工作流图`)
  }
  return result.graph
}

/**
 * 规范化创作图中无语义的目录数组顺序和空工作流描述。
 *
 * @param graph 待比较的公共创作图。
 * @returns 可直接深比较的独立规范图，不修改输入。
 * @throws `structuredClone` 无法复制异常输入时传播该异常。
 */
function canonicalAuthoringGraph(graph: AuthoringGraph): AuthoringGraph {
  const normalized = structuredClone(graph)
  const workflow = normalized.workflow
  if (isRecord(workflow) && workflow.description === undefined) {
    workflow.description = null
  }
  for (const key of [
    'nodes',
    'edges',
    'node_templates',
    'handle_templates'
  ]) {
    const values = normalized[key]
    if (Array.isArray(values)) {
      normalized[key] = [...values].sort(compareGraphEntity)
    }
  }
  return normalized
}

/**
 * 按稳定 UUID（缺失时按完整 JSON）比较两个图实体。
 *
 * @param left 左侧未信任图实体。
 * @param right 右侧未信任图实体。
 * @returns 负数、零或正数，供数组稳定排序。
 * @throws 实体含不可序列化循环时由 `JSON.stringify` 抛出异常。
 */
function compareGraphEntity(left: unknown, right: unknown): number {
  return graphEntityIdentity(left).localeCompare(graphEntityIdentity(right))
}

/**
 * 读取图实体的稳定比较身份。
 *
 * @param value 未信任图实体。
 * @returns 优先使用 UUID，否则使用完整 JSON 文本。
 * @throws 实体含不可序列化循环时由 `JSON.stringify` 抛出异常。
 */
function graphEntityIdentity(value: unknown): string {
  if (isRecord(value) && typeof value.uuid === 'string') return value.uuid
  return JSON.stringify(value)
}

/**
 * 判断未知值是否为非空普通记录。
 *
 * @param value 待判断值。
 * @returns 值可按字符串键读取时为真。
 * @throws 不抛异常。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 以模板 UUID 合并默认目录和 workflow 专用目录摘要。
 *
 * @param items 两个公共目录按读取顺序拼接的摘要。
 * @returns 首次出现顺序稳定、UUID 唯一的摘要数组。
 * @throws 不抛异常。
 */
function uniqueCatalogItems(
  items: Array<{ uuid: string }>
): Array<{ uuid: string }> {
  const seen = new Set<string>()
  const unique: Array<{ uuid: string }> = []
  for (const item of items) {
    if (seen.has(item.uuid)) continue
    seen.add(item.uuid)
    unique.push(item)
  }
  return unique
}

function isAuthoringMutation(entry: RequestLedgerEntry): boolean {
  return entry.method !== 'GET' && (
    entry.path.includes('/authoring') ||
    entry.path.endsWith('/graph') ||
    entry.path.includes('/workflow-nodes') ||
    entry.path.includes('/workflow-edges')
  )
}

function isRuntimeRequest(entry: RequestLedgerEntry): boolean {
  return (
    entry.path.includes('/workflow-tasks') ||
    entry.path.includes('/workflow-node-jobs') ||
    entry.path.includes('/commands') ||
    entry.path.includes('/feedback')
  )
}

async function readEnvelope<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`)
  }
  const envelope = await response.json() as { code: number; data: T }
  expect(envelope.code).toBe(0)
  return envelope.data
}

async function readRawJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`)
  }
  return response.json()
}
