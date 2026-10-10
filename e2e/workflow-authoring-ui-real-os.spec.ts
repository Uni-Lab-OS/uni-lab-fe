import { expect, test } from '@playwright/test'

import {
  startPersistentAuthoringOs,
  type PersistentAuthoringOs
} from './helpers/persistent-authoring-os'
import {
  allNodeInputBindings,
  countRequests,
  graphAuthoringSemantics,
  nodeInputBindings,
  readWorkflowEnvelope,
  requireHandleUuid,
  workflowIo,
  type AuthoringAggregate,
  type AuthoringTransform
} from './helpers/workflow-authoring-assertions'
import {
  applyWorkflowCandidateWithoutTask,
  saveWorkflowDraftOnly
} from './helpers/workflow-runtime-ui'
import { attachBrowserDiagnostics } from './helpers/browser-diagnostics'

let os: PersistentAuthoringOs

const PREPARE_NODE_UUID = '20000000-0000-4000-8000-000000000001'
const ANALYZE_NODE_UUID = '20000000-0000-4000-8000-000000000002'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  os = await startPersistentAuthoringOs()
})

test.afterAll(async () => {
  await os?.stop()
})

/**
 * 读取当前真实操作系统（OS）的统一响应封装。
 *
 * @param url HTTP 资源地址。
 * @param init 可选请求参数。
 * @returns 响应中的权威 data。
 */
async function readEnvelope<Value>(
  url: string,
  init?: RequestInit
): Promise<Value> {
  return readWorkflowEnvelope<Value>(os, url, init)
}

test('Candidate Workflow I/O survives real OS apply and result-record round-trip', async ({
  page
}) => {
  test.setTimeout(120_000)
  const browserErrors: string[] = []
  const applicationErrors: string[] = []
  const webSockets: string[] = []
  const requests: Array<{ method: string; url: string; path: string }> = []
  attachBrowserDiagnostics(page, browserErrors)
  page.on('websocket', (webSocket) => webSockets.push(webSocket.url()))
  page.on('request', (request) => {
    requests.push({
      method: request.method(),
      url: request.url(),
      path: new URL(request.url()).pathname
    })
  })
  page.on('response', (response) => {
    if (
      response.url().startsWith(`${os.url}/api/v1/`) &&
      response.status() >= 400
    ) {
      applicationErrors.push(
        `${response.request().method()} ${new URL(response.url()).pathname} ` +
        `${response.status()}`
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
  }, { key: storageKey, workflowUuid: os.workflowUuid })
  const published = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  const publishedGraph = published.candidate?.graph
  if (!publishedGraph) throw new Error('Published Candidate graph is missing')
  const prepareCyclesTarget = requireHandleUuid(
    publishedGraph,
    PREPARE_NODE_UUID,
    'cycles',
    'target'
  )
  const prepareSampleSource = requireHandleUuid(
    publishedGraph,
    PREPARE_NODE_UUID,
    'prepared',
    'source'
  )
  const analyzeReportSource = requireHandleUuid(
    publishedGraph,
    ANALYZE_NODE_UUID,
    'report',
    'source'
  )
  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  await expect(page.getByText('完整控制流 DAG')).toBeVisible()
  await page.getByRole('button', {
    name: '画布模式',
    exact: true
  }).click()
  await page.getByRole('button', { name: /输入与输出/ }).click()

  const ioEditor = page.getByRole('region', {
    name: '工作流输入与输出编辑器'
  })
  await expect(ioEditor).toBeVisible()
  const cyclesInput = ioEditor.locator(
    '[data-workflow-input-name="cycles"]'
  )
  await cyclesInput.locator('summary').click()
  const cyclesTarget = cyclesInput.getByRole('combobox', {
    name: '节点入参绑定'
  })
  const cyclesTargetOption = cyclesTarget.locator(
    `option[data-workflow-node-uuid="${PREPARE_NODE_UUID}"]` +
    `[data-workflow-handle-template-uuid="${prepareCyclesTarget}"]`
  )
  const cyclesTargetValue = await cyclesTargetOption.getAttribute('value')
  expect(cyclesTargetValue).not.toBeNull()
  await cyclesTarget.selectOption(cyclesTargetValue as string)
  await cyclesInput.getByRole('textbox', { name: '输入名称' })
    .fill('repeat_count')
  await page.keyboard.press('Tab')

  await ioEditor.getByRole('tab', { name: /输出参数/ }).click()

  const reportOutput = ioEditor.locator(
    '[data-workflow-output-name="report"]'
  )
  await reportOutput.locator('summary').click()
  const reportSource = reportOutput.getByRole('combobox', {
    name: '工作流出参绑定'
  })
  const reportSourceOption = reportSource.locator(
    `option[data-workflow-node-uuid="${ANALYZE_NODE_UUID}"]` +
    `[data-workflow-handle-template-uuid="${analyzeReportSource}"]`
  )
  const reportSourceValue = await reportSourceOption.getAttribute('value')
  expect(reportSourceValue).not.toBeNull()
  await reportSource.selectOption(reportSourceValue as string)
  await reportOutput.getByRole('textbox', { name: '输出名称' })
    .fill('analysis_report')
  await page.keyboard.press('Tab')
  await page.getByRole('dialog', {
    name: '工作流输入与输出配置'
  }).getByRole('button', { name: '完成', exact: true }).click()

  const generationBeforeSave = countRequests(
    requests,
    'POST',
    '/authoring/generate-python'
  )
  const validationBeforeSave = countRequests(
    requests,
    'POST',
    '/authoring/validate'
  )
  await saveWorkflowDraftOnly(page.locator('body'))
  const diffDialog = page.getByRole('dialog', { name: '完整 Python 差异' })
  await expect(diffDialog).toBeVisible()
  await expect.poll(() => countRequests(
    requests,
    'POST',
    '/authoring/generate-python'
  )).toBeGreaterThan(generationBeforeSave)
  await expect.poll(() => countRequests(
    requests,
    'POST',
    '/authoring/validate'
  )).toBeGreaterThan(validationBeforeSave)

  const draftSaved = page.waitForResponse((response) =>
    response.url().endsWith(
      `/api/v1/workflows/${os.workflowUuid}/authoring/draft`
    ) && response.request().method() === 'PUT' && response.status() === 200
  )
  await diffDialog.getByRole('button', {
    name: '接受完整差异并保存'
  }).click()
  await draftSaved
  await expect(page.getByRole('button', {
    name: '应用此版本',
    exact: true
  })).toBeEnabled()
  const appliedResponse = page.waitForResponse((response) =>
    response.url().endsWith(
      `/api/v1/workflows/${os.workflowUuid}/authoring/apply`
    ) && response.request().method() === 'POST' && response.status() === 200
  )
  await applyWorkflowCandidateWithoutTask(page.locator('body'), page)
  await appliedResponse

  const applied = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(workflowIo(applied.applied_graph)).toMatchObject({
    input_contract: {
      parameters: expect.arrayContaining([
        expect.objectContaining({ name: 'repeat_count' })
      ])
    },
    output_contract: {
      outputs: expect.arrayContaining([
        expect.objectContaining({
          name: 'sample',
          schema: { $slot: 'ResourceSlot' },
          implicit: false
        }),
        expect.objectContaining({
          name: 'analysis_report',
          implicit: false
        })
      ])
    },
    output_bindings: {
      sample: {
        kind: 'node_output',
        workflow_node_uuid: PREPARE_NODE_UUID,
        source_handle_uuid: prepareSampleSource
      },
      analysis_report: {
        kind: 'node_output',
        workflow_node_uuid: ANALYZE_NODE_UUID,
        source_handle_uuid: analyzeReportSource
      }
    }
  })
  expect(nodeInputBindings(applied.applied_graph, PREPARE_NODE_UUID)).toEqual(
    expect.objectContaining({
      [prepareCyclesTarget]: { parameter: 'repeat_count' }
    })
  )

  await page.reload()
  await expect(page.getByText('完整控制流 DAG')).toBeVisible()
  const reloaded = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(workflowIo(reloaded.applied_graph))
    .toEqual(workflowIo(applied.applied_graph))
  expect(nodeInputBindings(reloaded.applied_graph, PREPARE_NODE_UUID))
    .toEqual(nodeInputBindings(applied.applied_graph, PREPARE_NODE_UUID))

  const sourceUri = reloaded.draft?.source_uri
  if (!sourceUri) throw new Error('Applied Workflow has no source URI')
  const generated = await readEnvelope<AuthoringTransform>(
    `${os.url}/api/v1/authoring/generate-python`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow_uuid: os.workflowUuid,
        revision: reloaded.workflow_revision,
        source_uri: sourceUri,
        graph: reloaded.applied_graph
      })
    }
  )
  expect(generated.normalized_python_source)
    .toMatch(/class\s+\w+Result\(TypedDict\):/)
  expect(generated.normalized_python_source).toContain(
    "return {'sample': prepared.prepared, 'analysis_report': analyzed.report}"
  )
  expect(generated.normalized_python_source).not.toContain('workflow_output')
  expect(generated.graph).not.toBeNull()
  if (!generated.graph) throw new Error('Generated Applied graph is missing')
  expect(generated.graph).toEqual(reloaded.applied_graph)

  const compiled = await readEnvelope<AuthoringTransform>(
    `${os.url}/api/v1/authoring/compile`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow_uuid: os.workflowUuid,
        revision: reloaded.workflow_revision,
        source_uri: sourceUri,
        python_source: generated.normalized_python_source,
        applied_graph: reloaded.applied_graph
      })
    }
  )
  expect(compiled.graph).not.toBeNull()
  const regenerated = await readEnvelope<AuthoringTransform>(
    `${os.url}/api/v1/authoring/generate-python`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflow_uuid: os.workflowUuid,
        revision: reloaded.workflow_revision,
        source_uri: sourceUri,
        graph: compiled.graph
      })
    }
  )
  expect(regenerated.normalized_python_source)
    .toBe(generated.normalized_python_source)
  expect(regenerated.graph).not.toBeNull()
  if (!compiled.graph || !regenerated.graph) {
    throw new Error('Candidate round-trip graph is missing')
  }
  expect(regenerated.graph).toEqual(compiled.graph)

  const appliedWorkflowIo = workflowIo(reloaded.applied_graph)
  const appliedNodeBindings = allNodeInputBindings(reloaded.applied_graph)
  const appliedGraphSemantics = graphAuthoringSemantics(reloaded.applied_graph)
  expect(workflowIo(generated.graph)).toEqual(appliedWorkflowIo)
  expect(allNodeInputBindings(generated.graph)).toEqual(appliedNodeBindings)
  expect(graphAuthoringSemantics(generated.graph)).toEqual(
    appliedGraphSemantics
  )
  for (const candidateGraph of [compiled.graph, regenerated.graph]) {
    expect(workflowIo(candidateGraph)).toEqual(appliedWorkflowIo)
    expect(allNodeInputBindings(candidateGraph)).toEqual(appliedNodeBindings)
    expect(graphAuthoringSemantics(candidateGraph)).toEqual(
      appliedGraphSemantics
    )
  }

  const forbidden = requests.filter(({ path }) =>
    path === '/api/run' ||
    path.startsWith('/api/runtime/local/') ||
    path.startsWith('/api/v1/runtime/runs') ||
    path.startsWith('/ws/workflow/')
  )
  expect(forbidden).toEqual([])
  expect(webSockets.filter((url) =>
    new URL(url).pathname !== '/api/v1/ws/device_status'
  )).toEqual([])
  await expect(page.getByText('工作流编辑操作失败', { exact: true }))
    .toHaveCount(0)
  expect(applicationErrors).toEqual([])
  expect(browserErrors).toEqual([])
})
