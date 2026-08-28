import { expect, test } from '@playwright/test'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  startOperationAuthoringOs,
  type OperationAuthoringOs
} from './helpers/operation-authoring-os'
import { installWorkflowPanel } from './helpers/workflow-runtime-ui'

const ARTIFACT_DIRECTORY = resolve(
  process.cwd(),
  '../e2e-artifacts/experiment-operation-authoring'
)

let os: OperationAuthoringOs

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await mkdir(ARTIFACT_DIRECTORY, { recursive: true })
  os = await startOperationAuthoringOs()
})

test.afterAll(async () => {
  await os?.stop()
})

/**
 * 真实 OS 验收实验操作的 Canonical 编辑、输入输出、源码与数据库双持久化。
 */
test('edits operation I/O and node parameters, then saves, applies and restarts', async ({
  page
}) => {
  test.setTimeout(180_000)
  page.setDefaultTimeout(10_000)
  const initialSource = await readFile(os.sourcePath, 'utf8')
  const browserErrors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', error => browserErrors.push(error.message))

  await installWorkflowPanel(page, os.workflowUuid)
  await page.goto(`/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`)
  const workbench = page.getByRole('tabpanel', {
    name: 'Workflow Runtime'
  })
  await expect(workbench.getByText('完整控制流 DAG')).toBeVisible()
  await workbench.getByRole('button', {
    name: '画布模式',
    exact: true
  }).click()

  const canvas = workbench.locator('[data-canvas-engine="x6"]')
  const viewport = canvas.locator('.workflow-x6__viewport')
  await expect(canvas).toHaveAttribute('data-x6-node-count', '1')
  await expect(canvas).toHaveAttribute('data-x6-edge-count', '0')
  await expect(workbench.getByText('1 个可用模板', { exact: true }))
    .toBeVisible()

  await workbench.getByRole('button', {
    name: /输入与输出/
  }).click()
  const ioDrawer = page.getByRole('dialog', {
    name: /输入与输出配置/
  })
  await expect(ioDrawer).toBeVisible()
  const inputRow = ioDrawer.locator(
    '[data-workflow-input-name="report_prefix"]'
  )
  await inputRow.locator('summary').click()
  const inputName = inputRow.getByRole('textbox', { name: '输入名称' })
  await inputName.fill('operation_message')
  await inputName.press('Tab')
  await expect(ioDrawer.locator(
    '[data-workflow-input-name="operation_message"]'
  )).toBeVisible()

  await ioDrawer.getByRole('tab', { name: /输出参数/ }).click()
  const outputRow = ioDrawer.locator('[data-workflow-output-name="report"]')
  await outputRow.locator('summary').click()
  const outputName = outputRow.getByRole('textbox', { name: '输出名称' })
  await outputName.fill('operation_result')
  await outputName.press('Tab')
  await expect(ioDrawer.locator(
    '[data-workflow-output-name="operation_result"]'
  )).toBeVisible()
  await page.setViewportSize({ width: 960, height: 900 })
  await page.screenshot({
    path: resolve(ARTIFACT_DIRECTORY, '01-operation-io-narrow.png'),
    fullPage: true
  })
  await ioDrawer.getByRole('button', { name: '完成', exact: true }).click()
  await page.setViewportSize({ width: 1600, height: 1000 })

  const node = viewport.locator(
    `.x6-node[data-cell-id="${os.nodeUuid}"]`
  )
  await node.click({ position: { x: 38, y: 24 } })
  const inspector = workbench.getByRole('complementary', {
    name: '画布节点编辑器'
  })
  const nodeName = inspector.getByRole('textbox', { name: '节点名称' })
  await nodeName.fill('finalized_e2e')
  await nodeName.press('Tab')
  const provider = inspector.getByRole('combobox', {
    name: 'Report 参数来源'
  })
  await provider.selectOption('literal')
  const reportValue = inspector.getByRole('textbox', {
    name: 'Report 参数值'
  })
  await reportValue.fill('operation-e2e')
  await reportValue.press('Tab')
  await page.screenshot({
    path: resolve(ARTIFACT_DIRECTORY, '02-operation-authoring-desktop.png'),
    fullPage: true
  })

  await workbench.getByRole('button', {
    name: '校验本地工作流草稿',
    exact: true
  }).click()
  await expect(workbench.getByText(
    '本地草稿校验通过；未保存、未应用',
    { exact: true }
  )).toBeVisible()
  await workbench.getByRole('button', {
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

  const savedSource = await readFile(os.sourcePath, 'utf8')
  expect(savedSource).not.toBe(initialSource)
  expect(savedSource).toContain('definition_kind="operation"')
  expect(savedSource).toContain('operation_message')
  expect(savedSource).toContain('operation_result')
  expect(savedSource).toContain('operation-e2e')
  expect(savedSource).toContain('finalized_e2e')
  expect((await stat(os.databasePath)).isFile()).toBe(true)

  const saved = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(saved.state).toBe('unapplied_graph')
  expect(saved.candidate?.graph.workflow.meta_data.unilab.definition_kind)
    .toBe('operation')
  expect(saved.candidate?.graph.workflow.meta_data.unilab.input_contract
    .parameters.map(parameter => parameter.name)).toContain('operation_message')
  expect(saved.candidate?.graph.workflow.meta_data.unilab.output_contract
    .outputs.map(output => output.name)).toContain('operation_result')
  expect(saved.candidate?.graph.nodes.find(
    nodeValue => nodeValue.uuid === os.nodeUuid
  )).toMatchObject({ name: 'finalized_e2e', param: { report: 'operation-e2e' } })

  const database = await os.readDatabaseEvidence()
  expect(resolve(database.package_root, database.relative_path))
    .toBe(os.sourcePath)
  expect(database.observed_draft_hash).toBe(saved.draft.draft_hash)
  expect(database.candidate_hash).toBe(saved.candidate?.candidate_hash)

  await workbench.getByRole('button', {
    name: '应用并运行',
    exact: true
  }).click()
  const taskInput = page.getByRole('region', {
    name: '工作流运行输入表单'
  })
  await expect(taskInput).toBeVisible()
  const taskCreated = page.waitForResponse(response =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/v1/workflow-tasks'
  )
  await taskInput.getByRole('button', {
    name: '使用以上参数运行',
    exact: true
  }).click()
  expect((await taskCreated).status()).toBe(201)

  const applied = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(applied.state).toBe('applied')
  expect(applied.applied_graph.workflow.meta_data.unilab.definition_kind)
    .toBe('operation')
  expect(applied.applied_graph.workflow.meta_data.unilab.input_contract
    .parameters.map(parameter => parameter.name)).toContain('operation_message')
  expect(applied.applied_graph.workflow.meta_data.unilab.output_contract
    .outputs.map(output => output.name)).toContain('operation_result')

  await page.close()
  await os.stopProcess()
  await os.restart()
  const restarted = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(await readFile(os.sourcePath, 'utf8')).toBe(savedSource)
  expect(restarted).toMatchObject({
    state: 'applied',
    workflow_revision: applied.workflow_revision,
    draft: { draft_hash: applied.draft.draft_hash }
  })
  expect(restarted.applied_graph.workflow.meta_data.unilab.definition_kind)
    .toBe('operation')
  expect(browserErrors).toEqual([])
})

interface AuthoringAggregate {
  state: string
  workflow_revision: number
  draft: { draft_hash: string; python_source: string }
  candidate: {
    candidate_hash: string
    graph: AuthoringGraph
  } | null
  applied_graph: AuthoringGraph
}

interface AuthoringGraph {
  workflow: {
    meta_data: {
      unilab: {
        definition_kind: string
        input_contract: {
          parameters: Array<{ name: string }>
        }
        output_contract: {
          outputs: Array<{ name: string }>
        }
      }
    }
  }
  nodes: Array<{
    uuid: string
    name: string
    param: Record<string, unknown>
  }>
}

async function readEnvelope<T>(url: string): Promise<T> {
  const response = await fetch(url)
  expect(response.ok).toBe(true)
  const body = await response.json() as { code: number; data: T }
  expect(body.code).toBe(0)
  return body.data
}
