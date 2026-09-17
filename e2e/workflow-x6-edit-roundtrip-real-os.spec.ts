import { expect, test, type Locator } from '@playwright/test'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  startPersistentAuthoringOs,
  type PersistentAuthoringOs
} from './helpers/persistent-authoring-os'
import { installWorkflowPanel } from './helpers/workflow-runtime-ui'

const PREPARED_NODE_UUID = '20000000-0000-4000-8000-000000000021'
const ANALYZED_NODE_UUID = '20000000-0000-4000-8000-000000000022'

let os: PersistentAuthoringOs

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  os = await startPersistentAuthoringOs()
})

test.afterAll(async () => {
  await os?.stop()
})

/**
 * 验证 X6 编辑手势直到真实 OS 应用和任务冻结版本的完整闭环。
 */
test('drags, edits, connects, deletes, validates, saves and runs through real OS', async ({
  page
}) => {
  test.setTimeout(180_000)
  const initialPythonSource = await readFile(os.runtimeSourcePath, 'utf8')
  const browserErrors: string[] = []
  const authoringRequests: Array<{ method: string; path: string }> = []
  const failedResponses: Array<{
    method: string
    path: string
    status: number
  }> = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin !== new URL(os.url).origin) return
    authoringRequests.push({
      method: request.method(),
      path: `${url.pathname}${url.search}`
    })
  })
  page.on('response', (response) => {
    if (response.ok()) return
    const url = new URL(response.url())
    if (url.origin !== new URL(os.url).origin) return
    failedResponses.push({
      method: response.request().method(),
      path: `${url.pathname}${url.search}`,
      status: response.status()
    })
  })

  await installWorkflowPanel(page, os.runtimeWorkflowUuid)
  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  const panel = page.locator('[data-panel-instance-id="runtime-workflow"]')
  await expect(panel.getByText('完整控制流 DAG')).toBeVisible()
  await panel.getByRole('button', { name: '画布模式', exact: true }).click()

  const canvas = panel.locator('[data-canvas-engine="x6"]')
  const viewport = canvas.locator('.workflow-x6__viewport')
  const stage = panel.locator('.persistent-authoring__graph-stage')
  await expect(canvas).toHaveAttribute('data-x6-node-count', '2')
  await expect(canvas).toHaveAttribute('data-x6-edge-count', '1')

  const palette = panel.getByRole('complementary', {
    name: '工作流（Workflow）节点库'
  })
  const finalizeTemplate = palette.getByRole('button', {
    name: /Finalize/i
  }).first()
  await expect(
    finalizeTemplate,
    JSON.stringify({
      browserErrors,
      failedResponses,
      authoringRequests
    }, null, 2)
  ).toBeVisible({ timeout: 30_000 })
  const existingNodeUuids = new Set(await x6NodeUuids(viewport))
  const stageBox = await stage.boundingBox()
  if (!stageBox) throw new Error('X6 工作流画布没有可拖放区域')
  await finalizeTemplate.dragTo(stage, {
    targetPosition: {
      x: Math.round(stageBox.width * 0.68),
      y: Math.round(stageBox.height * 0.54)
    }
  })
  await expect(canvas).toHaveAttribute('data-x6-node-count', '3')
  const insertedNodeUuid = (await x6NodeUuids(viewport)).find(
    (nodeUuid) => !existingNodeUuids.has(nodeUuid)
  )
  expect(insertedNodeUuid).toBeTruthy()
  if (!insertedNodeUuid) throw new Error('拖入动作后未找到新增节点 UUID')

  const analyzedNode = x6Node(viewport, ANALYZED_NODE_UUID)
  await analyzedNode.click({ position: { x: 36, y: 24 } })
  const inspector = panel.getByRole('complementary', {
    name: '画布节点编辑器'
  })
  const reportProvider = inspector.getByRole('combobox', {
    name: 'Report 参数来源'
  })
  await expect(reportProvider).toHaveValue('upstream_output')
  await reportProvider.selectOption('literal')
  const reportValue = inspector.getByRole('textbox', {
    name: 'Report 参数值'
  })
  await reportValue.fill('analyzed-e2e')
  await reportValue.press('Tab')
  await expect(panel.getByText(
    '操作参数已更新；保存前将生成完整 Python',
    { exact: true }
  )).toBeVisible()
  await expect(canvas).toHaveAttribute('data-x6-edge-count', '0')

  const readySource = x6Node(viewport, insertedNodeUuid).locator(
    '.workflow-x6-port--ready.workflow-x6-port--source'
  )
  const readyTarget = analyzedNode.locator(
    '.workflow-x6-port--ready.workflow-x6-port--target'
  )
  await dragConnection(readySource, readyTarget)
  await expect(canvas).toHaveAttribute('data-x6-edge-count', '1')
  await expect(panel.getByText(
    '已使用真实端口创建连线；保存前将生成完整 Python',
    { exact: true }
  )).toBeVisible()

  await x6Node(viewport, PREPARED_NODE_UUID).click({
    position: { x: 36, y: 24 }
  })
  const deleteSelection = panel.getByRole('button', {
    name: /^删除选中/
  })
  await expect(deleteSelection).toHaveAccessibleName('删除选中的 1 项')
  page.once('dialog', async (dialog) => dialog.accept())
  await deleteSelection.click()
  await expect(canvas).toHaveAttribute('data-x6-node-count', '2')
  await expect(x6Node(viewport, PREPARED_NODE_UUID)).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-x6-edge-count', '1')

  await panel.getByRole('button', {
    name: '校验本地工作流草稿',
    exact: true
  }).click()
  await expect(panel.getByText(
    '本地草稿校验通过；未保存、未应用',
    { exact: true }
  )).toBeVisible()

  await panel.getByRole('button', {
    name: '保存工作流',
    exact: true
  }).click()
  const sourceDiff = page.getByRole('dialog', { name: '完整 Python 差异' })
  await expect(sourceDiff).toBeVisible()
  await sourceDiff.getByRole('button', {
    name: '接受完整差异并保存',
    exact: true
  }).click()
  await expect(sourceDiff).toBeHidden()

  const savedPythonSource = await readFile(os.runtimeSourcePath, 'utf8')
  expect(savedPythonSource).not.toBe(initialPythonSource)
  expect(savedPythonSource).toContain('analyzed-e2e')
  expect(savedPythonSource).toContain(insertedNodeUuid)
  expect(savedPythonSource).not.toContain(PREPARED_NODE_UUID)
  expect((await stat(os.databasePath)).isFile()).toBe(true)

  const savedAggregate = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.runtimeWorkflowUuid}/authoring`
  )
  expect(savedAggregate.state).toBe('unapplied_graph')
  expect(savedAggregate.draft.python_source).toBe(savedPythonSource)
  expect(savedAggregate.candidate).not.toBeNull()
  const savedDatabase = await os.readAuthoringDatabaseEvidence(
    os.runtimeWorkflowUuid
  )
  expect(resolve(
    savedDatabase.package_root,
    savedDatabase.relative_path
  )).toBe(os.runtimeSourcePath)
  expect(savedDatabase.observed_draft_hash).toBe(
    savedAggregate.draft.draft_hash
  )
  expect(savedDatabase.candidate_hash).toBe(
    savedAggregate.candidate?.candidate_hash
  )
  const storedCandidate = savedDatabase.candidate as
    | StoredAuthoringCandidate
    | null
  expect(storedCandidate?.draft_hash).toBe(savedAggregate.draft.draft_hash)
  expect(storedCandidate?.normalized_python_source).toBe(savedPythonSource)
  expect(storedCandidate?.graph.nodes.find(
    (node) => node.uuid === ANALYZED_NODE_UUID
  )?.param).toMatchObject({ report: 'analyzed-e2e' })
  expect(storedCandidate?.graph.nodes.map((node) => node.uuid))
    .not.toContain(PREPARED_NODE_UUID)

  await panel.getByRole('button', {
    name: '应用并运行',
    exact: true
  }).click()
  const taskInput = page.getByRole('region', {
    name: '工作流运行输入表单'
  })
  await expect(taskInput).toBeVisible()
  const taskCreated = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/v1/workflow-tasks'
  )
  await taskInput.getByRole('button', {
    name: '使用以上参数运行',
    exact: true
  }).click()
  const taskResponse = await taskCreated
  expect(taskResponse.status()).toBe(201)

  const aggregate = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.runtimeWorkflowUuid}/authoring`
  )
  expect(aggregate.state).toBe('applied')
  expect(aggregate.applied_graph.nodes.map((node) => node.uuid)).toEqual(
    expect.arrayContaining([ANALYZED_NODE_UUID, insertedNodeUuid])
  )
  expect(aggregate.applied_graph.nodes.map((node) => node.uuid))
    .not.toContain(PREPARED_NODE_UUID)
  expect(aggregate.applied_graph.nodes.find(
    (node) => node.uuid === ANALYZED_NODE_UUID
  )?.param).toMatchObject({ report: 'analyzed-e2e' })
  expect(aggregate.applied_graph.edges).toHaveLength(1)
  expect(aggregate.applied_graph.edges[0]).toMatchObject({
    source_node_uuid: insertedNodeUuid,
    target_node_uuid: ANALYZED_NODE_UUID
  })
  const appliedDatabase = await os.readAuthoringDatabaseEvidence(
    os.runtimeWorkflowUuid
  )
  expect(appliedDatabase.workflow_revision).toBe(aggregate.workflow_revision)
  expect(appliedDatabase.observed_draft_hash).toBe(
    aggregate.draft.draft_hash
  )
  expect(appliedDatabase.candidate_hash).toBeNull()
  expect(appliedDatabase.candidate).toBeNull()
  expect(appliedDatabase.applied_source).toMatchObject({
    python_source: savedPythonSource,
    source_hash: aggregate.draft.draft_hash
  })
  expect(authoringRequests).toEqual(expect.arrayContaining([
    { method: 'POST', path: '/api/v1/authoring/generate-python' },
    { method: 'POST', path: '/api/v1/authoring/validate' },
    {
      method: 'PUT',
      path: `/api/v1/workflows/${os.runtimeWorkflowUuid}/authoring/draft`
    },
    {
      method: 'POST',
      path: `/api/v1/workflows/${os.runtimeWorkflowUuid}/authoring/apply`
    },
    { method: 'POST', path: '/api/v1/workflow-tasks' }
  ]))
  expect(browserErrors).toEqual([])

  await page.close()
  await os.stopProcess()
  await os.restart()
  const restartedAggregate = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.runtimeWorkflowUuid}/authoring`
  )
  const restartedDatabase = await os.readAuthoringDatabaseEvidence(
    os.runtimeWorkflowUuid
  )
  expect(await readFile(os.runtimeSourcePath, 'utf8')).toBe(savedPythonSource)
  expect(restartedAggregate).toMatchObject({
    state: 'applied',
    workflow_revision: aggregate.workflow_revision,
    draft: { draft_hash: aggregate.draft.draft_hash }
  })
  expect(restartedDatabase).toMatchObject({
    workflow_revision: appliedDatabase.workflow_revision,
    observed_draft_hash: appliedDatabase.observed_draft_hash,
    candidate_hash: null,
    applied_source: appliedDatabase.applied_source
  })
})

function x6Node(viewport: Locator, nodeUuid: string): Locator {
  return viewport.locator(`.x6-node[data-cell-id="${nodeUuid}"]`)
}

async function x6NodeUuids(viewport: Locator): Promise<string[]> {
  return await viewport.locator('.x6-node[data-cell-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-cell-id') || '')
  )
}

async function dragConnection(
  source: Locator,
  target: Locator
): Promise<void> {
  await expect(source).toBeVisible()
  await expect(target).toBeVisible()
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('真实端口没有可连接坐标')
  const sourcePoint = {
    clientX: sourceBox.x + sourceBox.width / 2,
    clientY: sourceBox.y + sourceBox.height / 2
  }
  const targetPoint = {
    clientX: targetBox.x + targetBox.width / 2,
    clientY: targetBox.y + targetBox.height / 2
  }
  await source.dispatchEvent('mousedown', {
    button: 0,
    buttons: 1,
    ...sourcePoint
  })
  await target.dispatchEvent('mousemove', {
    button: 0,
    buttons: 1,
    ...targetPoint
  })
  await target.dispatchEvent('mouseup', {
    button: 0,
    buttons: 0,
    ...targetPoint
  })
}

interface AuthoringAggregate {
  state: string
  workflow_revision: number
  draft: {
    draft_hash: string
    python_source: string
  }
  candidate: {
    candidate_hash: string
  } | null
  applied_graph: {
    nodes: Array<{ uuid: string; param: Record<string, unknown> }>
    edges: Array<{
      source_node_uuid: string
      target_node_uuid: string
    }>
  }
}

interface StoredAuthoringCandidate {
  draft_hash: string
  normalized_python_source: string
  graph: {
    nodes: Array<{ uuid: string; param: Record<string, unknown> }>
  }
}

async function readEnvelope<Value>(url: string): Promise<Value> {
  const response = await fetch(url)
  const body = await response.text()
  expect(response.status, body).toBe(200)
  return (JSON.parse(body) as { data: Value }).data
}
