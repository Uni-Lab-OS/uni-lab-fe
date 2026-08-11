import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

import {
  startPersistentAuthoringOs,
  type MaterialAuthorityRaceState,
  type PersistentAuthoringOs
} from './helpers/persistent-authoring-os'
import {
  allNodeInputBindings,
  chooseExplicitValue,
  clickNodeOutsideMiniMap,
  compareUuid,
  countRequests,
  dragNode,
  ensureAppliedWorkflow as ensureAppliedWorkflowWithOs,
  graphAuthoringSemantics,
  lastRequest,
  nodeInputBindings,
  pickFields,
  readAuthoringEvent,
  readWorkflowEnvelope,
  requireHandleUuid,
  workflowIo,
  workflowTaskCount as workflowTaskCountWithOs,
  type AuthoringAggregate,
  type AuthoringTransform
} from './helpers/workflow-authoring-assertions'
import {
  applyWorkflowCandidateWithoutTask,
  saveWorkflowDraftOnly
} from './helpers/workflow-runtime-ui'

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

/**
 * 统计当前真实操作系统（OS）中指定工作流（Workflow）的任务数量。
 *
 * @param workflowUuid 工作流稳定 UUID。
 * @returns 工作流任务（WorkflowTask）总数。
 */
async function workflowTaskCount(workflowUuid: string): Promise<number> {
  return workflowTaskCountWithOs(os, workflowUuid)
}

/**
 * 确保指定工作流（Workflow）拥有已应用工作流图（Applied Workflow Graph）。
 *
 * @param workflowUuid 工作流稳定 UUID。
 * @returns 已应用后的创作权威聚合。
 */
async function ensureAppliedWorkflow(
  workflowUuid: string
): Promise<AuthoringAggregate> {
  return ensureAppliedWorkflowWithOs(os, workflowUuid)
}

test('Candidate Workflow I/O survives real OS apply and result-record round-trip', async ({
  page
}) => {
  test.setTimeout(120_000)
  const browserErrors: string[] = []
  const applicationErrors: string[] = []
  const webSockets: string[] = []
  const requests: Array<{ method: string; url: string; path: string }> = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
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

test('two configured Workflow panels keep mode, dirty state and saves isolated', async ({
  page
}) => {
  test.setTimeout(90_000)
  await page.addInitScript(({ firstWorkflowUuid, secondWorkflowUuid }) => {
    localStorage.setItem(
      'unilab.panel-layout.workflow.v1',
      JSON.stringify({
        version: 1,
        layout: {
          id: 'two-workflow-root',
          type: 'split',
          direction: 'horizontal',
          sizes: [50, 50],
          children: [
            {
              id: 'workflow-a-group',
              type: 'group',
              panels: [{
                id: 'workflow-a',
                panelType: 'workflow-dag',
                title: 'Workflow A',
                config: { workflow_uuid: firstWorkflowUuid }
              }],
              activePanelId: 'workflow-a'
            },
            {
              id: 'workflow-b-group',
              type: 'group',
              panels: [{
                id: 'workflow-b',
                panelType: 'workflow-dag',
                title: 'Workflow B',
                config: { workflow_uuid: secondWorkflowUuid }
              }],
              activePanelId: 'workflow-b'
            }
          ]
        }
      })
    )
  }, {
    firstWorkflowUuid: os.workflowUuid,
    secondWorkflowUuid: os.secondWorkflowUuid
  })

  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  const panelA = page.locator('[data-panel-instance-id="workflow-a"]')
  const panelB = page.locator('[data-panel-instance-id="workflow-b"]')
  await expect(panelA.getByText('完整控制流 DAG')).toBeVisible()
  await expect(panelB.getByText('完整控制流 DAG')).toBeVisible()

  await panelA.getByRole('button', {
    name: '画布模式',
    exact: true
  }).click()
  await expect(panelA.getByRole('button', {
    name: '画布模式',
    exact: true
  })).toHaveAttribute('aria-pressed', 'true')
  await expect(panelB.locator('.cm-content:visible'))
    .toHaveAttribute('contenteditable', 'true')
  await expect(panelB.getByRole('button', {
    name: '代码模式',
    exact: true
  })).toHaveAttribute('aria-pressed', 'true')

  const panelANode = panelA.locator('.react-flow__node-wfNode').first()
  await panelANode.click()
  const panelAName = panelA.getByRole('textbox', { name: '节点名称' })
  await panelAName.fill('prepared_panel_a')

  const firstSourceBefore = readFileSync(os.sourcePath, 'utf8')
  const secondSourceBefore = readFileSync(os.secondSourcePath, 'utf8')
  const secondSourceAfter = secondSourceBefore.replace('= 3,', '= 4,')
  expect(secondSourceAfter).not.toBe(secondSourceBefore)
  const panelBEditor = panelB.locator('.cm-content:visible')
  await panelBEditor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(secondSourceAfter)
  await saveWorkflowDraftOnly(panelB)
  const panelBSourceDiff = page.getByRole('dialog', {
    name: '完整 Python 差异'
  })
  await expect(panelBSourceDiff).toBeVisible()
  await panelBSourceDiff.getByRole('button', {
    name: '接受完整差异并保存',
    exact: true
  }).evaluate((button) => (button as HTMLButtonElement).click())

  await expect(panelB.getByText(
    '草稿已保存，有尚未应用的工作流修改',
    { exact: true }
  )).toBeVisible()
  expect(readFileSync(os.secondSourcePath, 'utf8')).toContain('= 4,')
  expect(readFileSync(os.sourcePath, 'utf8')).toBe(firstSourceBefore)
  await expect(panelAName).toHaveValue('prepared_panel_a')
  await expect(panelA.getByRole('button', {
    name: '开始运行',
    exact: true
  })).toBeEnabled()
  await expect(page.getByRole('dialog', { name: '远端修改冲突' }))
    .toHaveCount(0)
})

test('kernel-web uses D-117 single edit authority through the real OS', async ({
  page
}) => {
  test.setTimeout(90_000)
  const browserErrors: string[] = []
  const authoringRequests: Array<{
    method: string
    url: string
    body: unknown
  }> = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('request', (request) => {
    if (!request.url().startsWith(`${os.url}/api/v1/`)) return
    let body: unknown = null
    try {
      body = request.postDataJSON()
    } catch {
      body = request.postData()
    }
    authoringRequests.push({
      method: request.method(),
      url: request.url(),
      body
    })
  })

  const activeWorkflowStorageKey = `unilab.workflow.active.${
    encodeURIComponent(`local-python:${os.url}`)
  }.v1`
  await page.addInitScript(
    ({ storageKey, workflowUuid }) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ version: 1, workflowId: workflowUuid })
      )
    },
    {
      storageKey: activeWorkflowStorageKey,
      workflowUuid: os.workflowUuid
    }
  )

  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  await expect(page.getByText('完整控制流 DAG')).toBeVisible()

  const codeMode = page.getByRole('button', {
    name: '代码模式',
    exact: true
  })
  const canvasMode = page.getByRole('button', {
    name: '画布模式',
    exact: true
  })
  await expect(codeMode).toBeVisible()
  await expect(canvasMode).toBeVisible()
  await expect(codeMode).toHaveAttribute('aria-pressed', 'true')
  await expect(canvasMode).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText(/画布.*只读.*投影/)).toBeVisible()

  await expect.poll(() => countRequests(
    authoringRequests,
    'GET',
    `/workflows/${os.workflowUuid}/authoring`
  )).toBeGreaterThanOrEqual(1)
  await expect.poll(() => countRequests(
    authoringRequests,
    'GET',
    '/events'
  )).toBeGreaterThanOrEqual(1)

  const editor = page.locator('.cm-content:visible')
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  const projectedNode = page.locator('.react-flow__node-wfNode').first()
  await expect(projectedNode).toBeVisible()
  const projectedPosition = await projectedNode.getAttribute('style')
  await dragNode(page, projectedNode, 80, 40)
  expect(await projectedNode.getAttribute('style')).toBe(projectedPosition)

  const initialEditorSource = readFileSync(os.sourcePath, 'utf8')
  const locallyEditedSource = initialEditorSource.replace('= 3,', '= 4,')
  expect(locallyEditedSource).not.toBe(initialEditorSource)
  await editor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(locallyEditedSource)
  const startFlowButton = page.getByRole('button', {
    name: '开始运行',
    exact: true
  })
  await expect(startFlowButton).toBeEnabled()

  await canvasMode.click()
  const dirtyGuard = page.getByRole('dialog', { name: /未保存.*切换/ })
  await expect(dirtyGuard).toBeVisible()
  await dirtyGuard.getByRole('button', { name: /取消/ }).click()
  await expect(codeMode).toHaveAttribute('aria-pressed', 'true')
  await expect(editor).toContainText('= 4,')

  const draftPutBeforeCodeSave = countRequests(
    authoringRequests,
    'PUT',
    `/workflows/${os.workflowUuid}/authoring/draft`
  )
  await saveWorkflowDraftOnly(page.locator('body'))
  const codeSourceDiff = page.getByRole('dialog', {
    name: '完整 Python 差异'
  })
  const codeSavedMessage = page.getByText(
    '草稿已保存，有尚未应用的工作流修改',
    { exact: true }
  )
  await expect.poll(async () =>
    await codeSourceDiff.isVisible() || await codeSavedMessage.isVisible()
  ).toBe(true)
  let expectedCodeDraftWrites = 1
  if (await codeSourceDiff.isVisible()) {
    await codeSourceDiff.getByRole('button', {
      name: '接受完整差异并保存',
      exact: true
    }).click()
    expectedCodeDraftWrites = 2
  }
  await expect.poll(() => countRequests(
    authoringRequests,
    'PUT',
    `/workflows/${os.workflowUuid}/authoring/draft`
  )).toBe(draftPutBeforeCodeSave + expectedCodeDraftWrites)
  await expect(codeSavedMessage).toBeVisible()
  expect(readFileSync(os.sourcePath, 'utf8')).toContain('= 4,')
  await expect(page.getByText('● 未保存', { exact: true })).toHaveCount(0)
  await expect(page.getByText('工作流编辑操作失败', { exact: true }))
    .toHaveCount(0)
  const codeDraftRequest = lastRequest(
    authoringRequests,
    'PUT',
    `/workflows/${os.workflowUuid}/authoring/draft`
  )
  expect(Object.keys(codeDraftRequest.body as Record<string, unknown>).sort())
    .toEqual([
      'expected_draft_hash',
      'expected_workflow_revision',
      'python_source'
    ])

  const aggregateGetsBeforeExternalEdit = countRequests(
    authoringRequests,
    'GET',
    `/workflows/${os.workflowUuid}/authoring`
  )
  const sourceBeforeExternalEdit = readFileSync(os.sourcePath, 'utf8')
  const externallyEditedSource = sourceBeforeExternalEdit.includes('= 4,')
    ? sourceBeforeExternalEdit.replace('= 4,', '= 5,')
    : sourceBeforeExternalEdit.replace('= 3,', '= 4,')
  expect(externallyEditedSource).not.toBe(sourceBeforeExternalEdit)
  const localConflictSource = sourceBeforeExternalEdit.includes('= 4,')
    ? sourceBeforeExternalEdit.replace('= 4,', '= 6,')
    : sourceBeforeExternalEdit.replace('= 3,', '= 6,')
  await editor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(localConflictSource)
  await expect(startFlowButton).toHaveText('开始运行')
  await expect(startFlowButton).toBeEnabled()
  writeFileSync(os.sourcePath, externallyEditedSource, 'utf8')
  await expect.poll(() => countRequests(
    authoringRequests,
    'GET',
    `/workflows/${os.workflowUuid}/authoring`
  ), { timeout: 15_000 }).toBeGreaterThan(aggregateGetsBeforeExternalEdit)
  const conflictDialog = page.getByRole('dialog', { name: '远端修改冲突' })
  await expect(conflictDialog).toHaveCount(0)
  await expect(editor).toContainText('= 6,')
  const draftPutBeforeLocalWinsSave = countRequests(
    authoringRequests,
    'PUT',
    `/workflows/${os.workflowUuid}/authoring/draft`
  )
  await saveWorkflowDraftOnly(page.locator('body'))
  await expect.poll(() => countRequests(
    authoringRequests,
    'PUT',
    `/workflows/${os.workflowUuid}/authoring/draft`
  )).toBe(draftPutBeforeLocalWinsSave + 1)
  await expect(page.getByText(
    '草稿已保存，有尚未应用的工作流修改',
    { exact: true }
  )).toBeVisible()
  expect(readFileSync(os.sourcePath, 'utf8')).toContain('= 6,')
  await expect(page.getByText('工作流编辑操作失败', { exact: true }))
    .toHaveCount(0)

  await canvasMode.click()
  await expect(canvasMode).toHaveAttribute('aria-pressed', 'true')
  const canvasPosition = await projectedNode.getAttribute('style')
  await dragNode(page, projectedNode, 100, 50)
  expect(await projectedNode.getAttribute('style')).toBe(canvasPosition)
  await clickNodeOutsideMiniMap(page, projectedNode)
  const nodeName = page.getByRole('textbox', { name: '节点名称' })
  await expect(nodeName).toBeEnabled()
  await nodeName.fill('prepared_canvas')
  await expect(startFlowButton).toBeEnabled()

  const draftPutBeforeDiffAcceptance = countRequests(
    authoringRequests,
    'PUT',
    `/workflows/${os.workflowUuid}/authoring/draft`
  )
  await saveWorkflowDraftOnly(page.locator('body'))
  const fullDiff = page.getByRole('dialog', { name: /完整 Python 差异/ })
  await expect(fullDiff).toBeVisible()
  await expect(fullDiff.getByText('当前 Python', { exact: true })).toBeVisible()
  await expect(
    fullDiff.getByText('生成的完整 Python', { exact: true })
  ).toBeVisible()
  expect(countRequests(
    authoringRequests,
    'PUT',
    `/workflows/${os.workflowUuid}/authoring/draft`
  )).toBe(draftPutBeforeDiffAcceptance)
  await fullDiff.getByRole('button', {
    name: /接受完整差异并保存/
  }).click()
  await expect.poll(() => countRequests(
    authoringRequests,
    'PUT',
    `/workflows/${os.workflowUuid}/authoring/draft`
  )).toBe(draftPutBeforeDiffAcceptance + 1)
  const canvasSaved = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(canvasSaved.candidate?.graph.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'prepared_canvas' })
    ])
  )

  await expect(startFlowButton).toBeEnabled()
  await applyWorkflowCandidateWithoutTask(page.locator('body'), page)
  await expect.poll(() => countRequests(
    authoringRequests,
    'POST',
    `/workflows/${os.workflowUuid}/authoring/apply`
  )).toBeGreaterThanOrEqual(1)
  const applyRequest = lastRequest(
    authoringRequests,
    'POST',
    `/workflows/${os.workflowUuid}/authoring/apply`
  )
  expect(Object.keys(applyRequest.body as Record<string, unknown>)).toEqual([
    'candidate_hash'
  ])
  const canvasApplied = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(canvasApplied.applied_graph.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'prepared_canvas' })
    ])
  )

  await codeMode.click()
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  await editor.click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('def broken(:\n')
  await saveWorkflowDraftOnly(page.locator('body'))
  await expect(page.getByText(
    '草稿已保存，但存在错误，修复后才能应用',
    { exact: true }
  )).toBeVisible()
  await expect(page.getByRole('region', { name: 'Python 草稿诊断' }))
    .toContainText('syntax_error')
  await expect(page.getByText(
    '当前显示已应用版本；暂无待应用修改',
    { exact: true }
  )).toBeVisible()
  await expect(startFlowButton).toBeDisabled()
  expect(browserErrors).toEqual([])
})
