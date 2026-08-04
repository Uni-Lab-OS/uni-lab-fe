import { expect, test } from '@playwright/test'

import {
  startSzlabActionCatalogOs,
  type SzlabActionCatalogOs
} from './helpers/szlab-action-catalog-os'

let os: SzlabActionCatalogOs

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  os = await startSzlabActionCatalogOs()
})

test.afterAll(async () => {
  await os?.stop()
})

test('SZLab persisted Catalog reaches the original typed workflow editor', async ({
  page
}) => {
  test.setTimeout(120_000)
  const browserErrors: string[] = []
  const requests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().startsWith(`${os.url}/api/v1/`)) {
      requests.push(new URL(request.url()).pathname)
    }
  })

  const list = await readEnvelope<CatalogList>(
    `${os.url}/api/v1/workflow-node-templates`
  )
  expect(list.authority).toEqual({
    authority_id: 'szlab-local',
    kind: 'local'
  })
  expect(list.catalog_fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
  expect(list.items.length).toBeGreaterThan(0)
  expect(list.items.every((item) => !item.name.startsWith('auto-'))).toBe(true)
  const stirringSummary = list.items.find(
    (item) => item.name === 'run_stirring'
  )
  expect(stirringSummary).toBeDefined()
  if (!stirringSummary) throw new Error('SZLab run_stirring template missing')
  expect(stirringSummary.resource_template.uuid).toMatch(UUID_PATTERN)

  const detail = await readEnvelope<CatalogDetail>(
    `${os.url}/api/v1/workflow-node-templates/${stirringSummary.uuid}`
  )
  expect(detail.catalog_fingerprint).toBe(list.catalog_fingerprint)
  expect(detail.template.uuid).toBe(stirringSummary.uuid)
  expect(detail.handles.length).toBeGreaterThan(0)
  expect(detail.handles.every((handle) =>
    handle.workflow_node_template_uuid === stirringSummary.uuid
  )).toBe(true)
  const handleUuids = detail.handles.map((handle) => handle.uuid)
  expect(new Set(handleUuids).size).toBe(handleUuids.length)

  const aggregateBefore = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(
    aggregateBefore.candidate,
    `${JSON.stringify(aggregateBefore, null, 2)}\n${os.logs()}`
  ).not.toBeNull()
  const candidateBefore = aggregateBefore.candidate
  if (!candidateBefore) throw new Error('SZLab candidate missing')
  expect(candidateBefore.template_catalog_fingerprint).toBe(
    list.catalog_fingerprint
  )
  expect(candidateBefore.graph.handle_templates.map((item) => item.uuid))
    .toEqual(expect.arrayContaining(handleUuids))
  const generated = await readEnvelope<{
    diagnostics: unknown[]
    graph: AuthoringGraph | null
    normalized_python_source: string
  }>(`${os.url}/api/v1/authoring/generate-python`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_uuid: os.workflowUuid,
      revision: aggregateBefore.workflow_revision,
      source_uri: aggregateBefore.draft?.source_uri,
      graph: candidateBefore.graph
    })
  })
  expect(generated.graph, JSON.stringify(generated, null, 2)).not.toBeNull()
  if (!generated.graph) throw new Error('generated graph missing')
  expect(graphIdentity(generated.graph)).toEqual(
    graphIdentity(candidateBefore.graph)
  )

  const storageKey = `unilab.workflow.active.${
    encodeURIComponent(`local-python:${os.url}`)
  }.v1`
  await page.addInitScript(({ key, workflowUuid }) => {
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, workflowId: workflowUuid })
    )
  }, { key: storageKey, workflowUuid: os.workflowUuid })
  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  await expect(page.getByText('完整控制流 DAG')).toBeVisible()
  await expect.poll(() => requests.filter(
    (path) => path === '/api/v1/workflow-node-templates'
  ).length).toBeGreaterThan(0)

  await page.getByRole('button', {
    name: '画布模式',
    exact: true
  }).click()
  await expect(page.getByText(
    '画布模式：Python 是 OS 生成的只读投影',
    { exact: true }
  )).toBeVisible()
  await page.locator('.react-flow__node-wfNode').first().click({
    position: { x: 24, y: 24 }
  })
  const editor = page.getByRole('complementary', {
    name: '画布节点编辑器'
  })
  await expect(editor.getByRole('region', {
    name: '操作参数摘要'
  })).toBeVisible()
  await editor.getByRole('button', { name: '配置节点参数' }).click()
  const stirringParameters = page.getByRole('dialog', {
    name: '节点参数 stirring'
  })
  await expect(stirringParameters).toBeVisible()
  await expect(stirringParameters.getByText('输入参数', {
    exact: true
  })).toBeVisible()
  await expect(stirringParameters.getByRole('textbox', {
    name: '磁搅位置 参数值'
  })).toBeVisible()
  await expect(stirringParameters.getByText('必填', {
    exact: true
  }).first()).toBeVisible()
  await expect(stirringParameters.getByText('无默认值', {
    exact: true
  }).first()).toBeVisible()
  await expect(stirringParameters.getByText(/允许为空|不可为空/).first())
    .toBeVisible()
  await stirringParameters.getByRole('button', { name: '完成' }).click()
  await expect(stirringParameters).toBeHidden()

  const existingNode = page.locator('.wf-node__id').filter({
    hasText: /^stirring$/
  }).locator('xpath=ancestor::*[@data-workflow-node-uuid]')
  const editedNodeUuid = await existingNode.getAttribute(
    'data-workflow-node-uuid'
  )
  expect(editedNodeUuid).toMatch(UUID_PATTERN)

  const renderedHandleUuids = await page.locator(
    '[data-workflow-handle-template-uuid]'
  ).evaluateAll((elements) => elements.map((element) =>
    element.getAttribute('data-workflow-handle-template-uuid')
  ))
  expect(renderedHandleUuids).toEqual(expect.arrayContaining(handleUuids))

  const actionPalette = page.getByRole('complementary', {
    name: '工作流节点面板'
  }).getByRole('button', {
    name: 'run_stirring run_stirring',
    exact: true
  })
  await expect(actionPalette).toBeVisible()
  const readySource = existingNode.locator(
    '[data-workflow-handle-key="ready"][data-workflow-handle-io="source"]'
  )
  const readyTarget = existingNode.locator(
    '[data-workflow-handle-key="ready"][data-workflow-handle-io="target"]'
  )
  await expect(readySource).toHaveCSS('visibility', 'hidden')
  await expect(readyTarget).toHaveCSS('visibility', 'hidden')

  await editor.getByRole('button', { name: '配置节点参数' }).click()
  await expect(stirringParameters).toBeVisible()
  await stirringParameters.getByRole('combobox', {
    name: '磁搅位置 参数来源'
  }).selectOption('literal')
  const positionInput = stirringParameters.getByRole('textbox', {
    name: '磁搅位置 参数值'
  })
  await positionInput.fill('4')
  await positionInput.press('Tab')
  await expect(positionInput).toHaveValue('4')
  const positionHandle = detail.handles.find(
    (handle) => handle.handle_key === 'position' && handle.io_type === 'target'
  )
  expect(positionHandle).toBeDefined()
  if (!positionHandle) throw new Error('run_stirring position Handle missing')
  await expect(stirringParameters.locator(
    `[data-workflow-handle-template-uuid="${positionHandle.uuid}"] [role="alert"]`
  )).toHaveCount(0)
  await stirringParameters.getByRole('button', { name: '完成' }).click()
  await expect(stirringParameters).toBeHidden()

  await page.getByRole('button', { name: '保存草稿' }).click()
  const diffDialog = page.getByRole('dialog', { name: '完整 Python 差异' })
  await expect(diffDialog, os.logs().slice(-5_000)).toBeVisible()
  const firstDraftWrite = page.waitForResponse((response) =>
    response.url().endsWith(
      `/api/v1/workflows/${os.workflowUuid}/authoring/draft`
    ) && response.request().method() === 'PUT' && response.status() === 200
  )
  await diffDialog.getByRole('button', {
    name: '接受完整差异并保存'
  }).click()
  await firstDraftWrite
  await expect(diffDialog).toBeHidden()

  const savedBeforeConflict = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(savedBeforeConflict.candidate).not.toBeNull()
  const savedGraph = savedBeforeConflict.candidate?.graph
  if (!savedGraph) throw new Error('saved Candidate graph missing')
  expect(savedGraph.nodes).toHaveLength(candidateBefore.graph.nodes.length)
  expect(savedGraph.edges).toHaveLength(candidateBefore.graph.edges.length)
  expect(savedGraph.nodes.find((node) => node.uuid === editedNodeUuid)?.param)
    .toEqual(expect.objectContaining({ position: 4 }))

  const bumped = await readEnvelope<{ catalog_fingerprint: string }>(
    `${os.url}/__e2e/catalog-bump`,
    { method: 'POST' }
  )
  expect(bumped.catalog_fingerprint).not.toBe(list.catalog_fingerprint)
  const catalogReadsBeforeConflict = requests.filter(
    (path) => path === '/api/v1/workflow-node-templates'
  ).length
  const conflictResponse = page.waitForResponse((response) =>
    response.url().endsWith(
      `/api/v1/workflows/${os.workflowUuid}/authoring/apply`
    ) && response.status() === 409
  )
  await page.getByRole('button', { name: '应用工作流' }).click()
  expect((await conflictResponse).status()).toBe(409)
  await expect.poll(() => requests.filter(
    (path) => path === '/api/v1/workflow-node-templates'
  ).length).toBeGreaterThan(catalogReadsBeforeConflict)
  await expect(page.getByText(
    '操作目录与工作流编辑数据已刷新；本地画布已按稳定 UUID 恢复'
  )).toBeVisible()
  await page.getByRole('button', { name: '关闭' }).first().click()

  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(diffDialog).toBeVisible()
  const refreshedDraftWrite = page.waitForResponse((response) =>
    response.url().endsWith(
      `/api/v1/workflows/${os.workflowUuid}/authoring/draft`
    ) && response.request().method() === 'PUT' && response.status() === 200
  )
  await diffDialog.getByRole('button', {
    name: '接受完整差异并保存'
  }).click()
  await refreshedDraftWrite
  await expect(diffDialog).toBeHidden()

  const refreshedCandidate = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(refreshedCandidate.candidate?.template_catalog_fingerprint)
    .toBe(bumped.catalog_fingerprint)
  const applySuccess = page.waitForResponse((response) =>
    response.url().endsWith(
      `/api/v1/workflows/${os.workflowUuid}/authoring/apply`
    ) && response.status() === 200
  )
  await page.getByRole('button', { name: '应用工作流' }).click()
  await applySuccess
  await expect(page.getByText(/工作流已应用|源码已应用/)).toBeVisible()

  const aggregateApplied = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(graphIdentity(aggregateApplied.applied_graph)).toEqual(
    graphIdentity(refreshedCandidate.candidate?.graph as AuthoringGraph)
  )
  await page.reload()
  await expect(page.getByText('完整控制流 DAG')).toBeVisible()
  const aggregateAfter = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(graphIdentity(aggregateAfter.applied_graph)).toEqual(
    graphIdentity(aggregateApplied.applied_graph)
  )
  const finalDetail = await readEnvelope<CatalogDetail>(
    `${os.url}/api/v1/workflow-node-templates/${stirringSummary.uuid}`
  )
  const appliedTemplate = aggregateAfter.applied_graph.node_templates.find(
    (template) => template.uuid === stirringSummary.uuid
  )
  expect(appliedTemplate?.uuid).toBe(finalDetail.template.uuid)
  expect(appliedTemplate?.schema).toEqual(finalDetail.template.schema)
  const finalGenerated = await readEnvelope<{
    diagnostics: unknown[]
    graph: AuthoringGraph | null
    normalized_python_source: string
  }>(`${os.url}/api/v1/authoring/generate-python`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_uuid: os.workflowUuid,
      revision: aggregateAfter.workflow_revision,
      source_uri: aggregateAfter.draft?.source_uri,
      graph: aggregateAfter.applied_graph
    })
  })
  expect(
    finalGenerated.normalized_python_source,
    JSON.stringify(finalGenerated.diagnostics, null, 2)
  ).not.toBeNull()
  expect(finalGenerated.normalized_python_source).toContain(
    `# unilab:node_uuid=${editedNodeUuid}`
  )
  expect(finalGenerated.normalized_python_source).toContain('position=4')
  expect(graphIdentity(finalGenerated.graph as AuthoringGraph)).toEqual(
    graphIdentity(aggregateAfter.applied_graph)
  )
  const expectedConflictErrors = browserErrors.filter((message) =>
    message.includes('409 (Conflict)')
  )
  expect(expectedConflictErrors).toHaveLength(1)
  expect(browserErrors.filter((message) =>
    !message.includes('409 (Conflict)')
  )).toEqual([])
})

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface CatalogList {
  authority: { authority_id: string; kind: string }
  catalog_fingerprint: string
  items: Array<{
    uuid: string
    name: string
    resource_template: { uuid: string; name: string; display_name: string }
  }>
}

interface CatalogDetail {
  catalog_fingerprint: string
  template: Record<string, unknown> & { uuid: string }
  handles: Array<{
    uuid: string
    workflow_node_template_uuid: string
    handle_key: string
    io_type: 'source' | 'target'
  }>
}

interface AuthoringGraph {
  nodes: Array<{
    uuid: string
    workflow_node_template_uuid?: string | null
    param?: Record<string, unknown>
  }>
  edges: Array<{
    uuid: string
    source_node_uuid: string
    source_handle_uuid: string
    target_node_uuid: string
    target_handle_uuid: string
  }>
  node_templates: Array<Record<string, unknown> & { uuid: string }>
  handle_templates: Array<{
    uuid: string
    workflow_node_template_uuid: string
  }>
}

interface AuthoringAggregate {
  workflow_revision: number
  draft: { source_uri: string } | null
  candidate: {
    candidate_hash: string
    template_catalog_fingerprint: string
    graph: AuthoringGraph
  } | null
  applied_graph: AuthoringGraph
}

function graphIdentity(graph: AuthoringGraph): Record<string, unknown> {
  return {
    nodes: graph.nodes.map((item) => ({
      uuid: item.uuid,
      workflow_node_template_uuid: item.workflow_node_template_uuid,
      param: item.param
    })).sort((left, right) => left.uuid.localeCompare(right.uuid)),
    edges: graph.edges.map((item) => ({
      uuid: item.uuid,
      source_handle_uuid: item.source_handle_uuid,
      target_handle_uuid: item.target_handle_uuid
    })).sort((left, right) => left.uuid.localeCompare(right.uuid)),
    nodeTemplates: graph.node_templates.map((item) => item.uuid).sort(),
    handleTemplates: graph.handle_templates.map((item) => ({
      uuid: item.uuid,
      workflow_node_template_uuid: item.workflow_node_template_uuid
    })).sort((left, right) => left.uuid.localeCompare(right.uuid))
  }
}

async function readEnvelope<Value>(
  url: string,
  init?: RequestInit
): Promise<Value> {
  const response = await fetch(url, init)
  const text = await response.text()
  let body: {
    code: number
    data?: Value
    error?: unknown
  }
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    throw new Error(
      `${init?.method ?? 'GET'} ${url} returned ${response.status}: ${text}`
    )
  }
  expect(response.ok, JSON.stringify(body)).toBe(true)
  expect(body.code).toBe(0)
  if (body.data === undefined) throw new Error('response data missing')
  return body.data
}
