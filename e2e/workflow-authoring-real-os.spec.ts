import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

import {
  startPersistentAuthoringOs,
  type MaterialAuthorityRaceState,
  type PersistentAuthoringOs
} from './helpers/persistent-authoring-os'

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

test('real production OS completes persistent Authoring HTTP and SSE', async () => {
  const authoringUrl =
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  const initial = await readEnvelope<AuthoringAggregate>(authoringUrl)
  expect(initial.workflow_uuid).toBe(os.workflowUuid)
  expect(initial.draft).not.toBeNull()
  expect(initial.candidate).not.toBeNull()
  if (!initial.draft || !initial.candidate) {
    throw new Error('production fixture did not materialize Authoring')
  }

  const streamResponse = await fetch(`${os.url}/api/v1/events`, {
    headers: {
      Accept: 'text/event-stream',
      'Last-Event-ID': '0'
    }
  })
  expect(streamResponse.ok).toBe(true)
  const draftSavedEvent = readAuthoringEvent(
    streamResponse,
    os.workflowUuid,
    'draft_saved'
  )
  const draftBody = {
    python_source: initial.candidate.normalized_python_source,
    expected_draft_hash: initial.draft.draft_hash,
    expected_workflow_revision: initial.workflow_revision
  }
  const saved = await readEnvelope<AuthoringAggregate>(
    `${authoringUrl}/draft`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draftBody)
    }
  )
  expect(saved.candidate).not.toBeNull()
  expect(await draftSavedEvent).toMatchObject({
    event: 'workflow.authoring.changed',
    data: {
      workflow_uuid: os.workflowUuid,
      cause: 'draft_saved',
      draft_hash: saved.draft?.draft_hash,
      candidate_hash: saved.candidate?.candidate_hash
    }
  })

  const refreshed = await readEnvelope<AuthoringAggregate>(authoringUrl)
  expect(refreshed.draft?.draft_hash).toBe(saved.draft?.draft_hash)
  const applyBody = {
    candidate_hash: refreshed.candidate?.candidate_hash
  }
  expect(Object.keys(applyBody)).toEqual(['candidate_hash'])
  const applied = await readEnvelope<{
    apply_result: { kind: string; workflow_revision: number }
    authoring: AuthoringAggregate
  }>(`${authoringUrl}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(applyBody)
  })
  expect(applied.apply_result.kind).toBe('graph')

  const finalState = await readEnvelope<AuthoringAggregate>(authoringUrl)
  expect(finalState).toEqual(applied.authoring)
  expect(finalState.state).toBe('applied')
})

test('real production OS emits SSE for an external Draft edit', async () => {
  const before = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(before.draft).not.toBeNull()
  const streamResponse = await fetch(`${os.url}/api/v1/events`, {
    headers: {
      Accept: 'text/event-stream',
      'Last-Event-ID': '0'
    }
  })
  expect(streamResponse.ok).toBe(true)
  const externallyChangedEvent = readAuthoringEvent(
    streamResponse,
    os.workflowUuid,
    'external_draft_changed',
    (event) => event.data.draft_hash !== before.draft?.draft_hash
  )
  const source = readFileSync(os.sourcePath, 'utf8')
  writeFileSync(os.sourcePath, `${source}\n# external SSE regression\n`, 'utf8')

  const event = await externallyChangedEvent
  expect(event).toMatchObject({
    event: 'workflow.authoring.changed',
    data: {
      workflow_uuid: os.workflowUuid,
      cause: 'external_draft_changed'
    }
  })
  const synchronized = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(synchronized.draft?.draft_hash).toBe(event.data.draft_hash)
  expect(synchronized.draft?.python_source).toContain(
    '# external SSE regression'
  )
})

test('real production OS regenerates its persisted Candidate graph', async () => {
  const aggregate = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(aggregate.draft).not.toBeNull()
  expect(aggregate.candidate).not.toBeNull()
  if (!aggregate.draft || !aggregate.candidate) {
    throw new Error('production fixture did not materialize Authoring')
  }

  const generated = await readEnvelope<{
    graph: Record<string, unknown>
    normalized_python_source: string
  }>(`${os.url}/api/v1/authoring/generate-python`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflow_uuid: os.workflowUuid,
      revision: aggregate.workflow_revision,
      source_uri: aggregate.draft.source_uri,
      graph: aggregate.candidate.graph
    })
  })

  expect(generated.graph).toEqual(aggregate.candidate.graph)
  expect(generated.normalized_python_source.length).toBeGreaterThan(0)
})

test('Applied scalar Task form preserves explicit falsy/null and leaves OS default omitted', async ({
  page
}) => {
  test.setTimeout(120_000)
  const browserErrors: string[] = []
  const applicationErrors: string[] = []
  const webSockets: string[] = []
  const requests: Array<{ method: string; path: string }> = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('websocket', (webSocket) => webSockets.push(webSocket.url()))
  page.on('request', (request) => {
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
        `${response.request().method()} ${new URL(response.url()).pathname} ` +
        `${response.status()}`
      )
    }
  })

  const applied = await ensureAppliedWorkflow(os.scalarInputWorkflowUuid)
  const storageKey = `unilab.workflow.active.${
    encodeURIComponent(`local-python:${os.url}`)
  }.v1`
  await page.addInitScript(({ key, workflowUuid }) => {
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, workflowId: workflowUuid })
    )
  }, { key: storageKey, workflowUuid: os.scalarInputWorkflowUuid })

  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  await expect(page.getByText('完整控制流 DAG')).toBeVisible()
  const start = page.getByRole('button', { name: '开始运行', exact: true })
  await expect(start).toBeEnabled()
  await start.click()

  const form = page.getByRole('region', {
    name: '工作流运行输入表单'
  })
  await expect(form).toBeVisible()
  await expect(form).toContainText(
    `使用已应用版本 ${applied.workflow_revision}`
  )
  await expect(form.locator(
    '[data-workflow-task-input-name="attempts"]'
  )).toContainText(/默认值[^0-9]*3/i)

  await chooseExplicitValue(form, 'label')
  await form.getByRole('textbox', { name: 'label 明确值' }).fill('')

  await chooseExplicitValue(form, 'count')
  await form.getByRole('spinbutton', { name: 'count 明确值' }).fill('0')

  await chooseExplicitValue(form, 'enabled')
  await form.getByRole('combobox', { name: 'enabled 明确值' })
    .selectOption('false')

  await chooseExplicitValue(form, 'tags')
  const tags = form.getByRole('textbox', { name: 'tags 明确值 JSON' })
  await tags.fill('[]')
  await tags.press('Tab')

  await chooseExplicitValue(form, 'config')
  const config = form.getByRole('textbox', { name: 'config 明确值 JSON' })
  await config.fill('{}')
  await config.press('Tab')

  await form.getByRole('combobox', { name: 'note 输入状态' })
    .selectOption('explicit_null')
  await expect(form.getByRole('combobox', { name: 'attempts 输入状态' }))
    .toHaveValue('untouched')

  const createdResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/v1/workflow-tasks'
  )
  await form.getByRole('button', {
    name: '使用以上参数运行',
    exact: true
  }).click()
  const created = await createdResponse
  expect(created.status()).toBe(201)

  const requestBody = created.request().postDataJSON() as Record<
    string,
    unknown
  >
  expect(requestBody).toEqual({
    workflow_uuid: os.scalarInputWorkflowUuid,
    run_mode: 'normal',
    input: {
      label: '',
      count: 0,
      enabled: false,
      tags: [],
      config: {},
      note: null
    }
  })
  expect(requestBody.input).not.toHaveProperty('attempts')
  for (const forbiddenKey of [
    'target_node_uuid',
    'start_node_id',
    'breakpoints',
    'workflow_revision',
    'expected_workflow_revision'
  ]) expect(requestBody).not.toHaveProperty(forbiddenKey)

  const responseEnvelope = await created.json() as {
    code: number
    data: {
      input: Record<string, unknown>
      workflow_snapshot: {
        workflow: { revision: number }
      }
    }
  }
  expect(responseEnvelope.code).toBe(0)
  expect(responseEnvelope.data.input).toEqual({
    label: '',
    count: 0,
    enabled: false,
    tags: [],
    config: {},
    note: null,
    attempts: 3
  })
  expect(responseEnvelope.data.workflow_snapshot.workflow.revision)
    .toBe(applied.workflow_revision)

  const forbiddenRequests = requests.filter(({ path }) =>
    path === '/api/run' ||
    path.startsWith('/api/runtime/local/') ||
    path.startsWith('/api/v1/runtime/runs') ||
    path.startsWith('/ws/workflow/')
  )
  expect(forbiddenRequests).toEqual([])
  expect(webSockets).toEqual([])
  expect(applicationErrors).toEqual([])
  expect(browserErrors).toEqual([])
})

test('Applied ResourceSlot Task form selects a real Material and OS freezes its canonical identity', async ({
  page
}) => {
  test.setTimeout(120_000)
  const browserErrors: string[] = []
  const applicationErrors: string[] = []
  const webSockets: string[] = []
  const requests: Array<{ method: string; path: string }> = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('websocket', (webSocket) => webSockets.push(webSocket.url()))
  page.on('request', (request) => {
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
        `${response.request().method()} ${new URL(response.url()).pathname} ` +
        `${response.status()}`
      )
    }
  })

  const applied = await ensureAppliedWorkflow(
    os.resourceSlotInputWorkflowUuid
  )
  const materialGraph = await readEnvelope<{
    nodes: Array<{
      material: {
        uuid: string
        resource_template_uuid: string
        name: string
      }
    }>
  }>(`${os.url}/api/v1/materials/graph`)
  const fixtureMaterial = materialGraph.nodes.find(({ material }) =>
    material.uuid === os.resourceSlotMaterialUuid
  )?.material
  expect(fixtureMaterial).toEqual({
    uuid: os.resourceSlotMaterialUuid,
    resource_template_uuid: '31000000-0000-4000-8000-000000000001',
    name: 'I1 ResourceSlot sample',
    barcode: 'I1-RESOURCE-SLOT-005',
    class: 'lab.resources:plate_96',
    config: {},
    create_time: expect.any(String),
    data: {},
    meta_data: {},
    update_time: expect.any(String)
  })

  const storageKey = `unilab.workflow.active.${
    encodeURIComponent(`local-python:${os.url}`)
  }.v1`
  await page.addInitScript(({ key, workflowUuid }) => {
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, workflowId: workflowUuid })
    )
  }, { key: storageKey, workflowUuid: os.resourceSlotInputWorkflowUuid })

  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  await expect(page.getByText('完整控制流 DAG')).toBeVisible()
  await page.getByRole('button', { name: '开始运行', exact: true }).click()

  const form = page.getByRole('region', {
    name: '工作流运行输入表单'
  })
  await expect(form).toBeVisible()
  await expect(form).toContainText(
    `使用已应用版本 ${applied.workflow_revision}`
  )
  const inputState = form.getByRole('combobox', {
    name: 'sample 输入状态'
  })
  await expect(inputState).toBeEnabled({ timeout: 10_000 })
  await inputState.selectOption('value')
  const materialSelector = form.getByRole('combobox', {
    name: 'sample 资源位'
  })
  await expect(materialSelector).toContainText('I1 ResourceSlot sample')
  await materialSelector.selectOption(os.resourceSlotMaterialUuid)

  const createdResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/v1/workflow-tasks'
  )
  await form.getByRole('button', {
    name: '使用以上参数运行',
    exact: true
  }).click()
  const created = await createdResponse
  expect(created.status()).toBe(201)
  expect(created.request().postDataJSON()).toEqual({
    workflow_uuid: os.resourceSlotInputWorkflowUuid,
    run_mode: 'normal',
    input: {
      sample: { uuid: os.resourceSlotMaterialUuid }
    }
  })

  const responseEnvelope = await created.json() as {
    code: number
    data: {
      input: Record<string, unknown>
      workflow_snapshot: {
        workflow: {
          revision: number
          meta_data: {
            unilab: { input_contract: Record<string, unknown> }
          }
        }
      }
    }
  }
  expect(responseEnvelope.code).toBe(0)
  expect(responseEnvelope.data.input).toEqual({
    sample: {
      uuid: os.resourceSlotMaterialUuid,
      resource_template_uuid: fixtureMaterial?.resource_template_uuid
    }
  })
  expect(responseEnvelope.data.workflow_snapshot.workflow.revision)
    .toBe(applied.workflow_revision)
  expect(responseEnvelope.data.workflow_snapshot.workflow.meta_data.unilab)
    .toMatchObject({
      input_contract: {
        version: 1,
        parameters: [{
          name: 'sample',
          schema: { $slot: 'ResourceSlot' },
          required: true
        }]
      }
    })

  expect(requests).toContainEqual({
    method: 'GET',
    path: '/api/v1/materials/graph'
  })
  expect(webSockets).toEqual([])
  expect(applicationErrors).toEqual([])
  expect(browserErrors).toEqual([])
})

for (const scenario of [
  {
    state: 'invalid_input',
    status: 400,
    code: 'invalid_input',
    message: '提交内容格式不正确',
    actionable: /输入不被 OS 接受.*检查.*重试/
  },
  {
    state: 'not_found',
    status: 404,
    code: 'not_found',
    message: '请求的资源不存在',
    actionable: /Workflow.*Material.*数据.*刷新.*重试/
  },
  {
    state: 'conflict',
    status: 409,
    code: 'conflict',
    message: '资源已发生冲突，请刷新后重试',
    actionable: /权威状态.*冲突.*刷新.*重试/
  }
] as const satisfies ReadonlyArray<{
  state: Exclude<MaterialAuthorityRaceState, 'restore'>
  status: number
  code: string
  message: string
  actionable: RegExp
}>) {
  test(`ResourceSlot authority ${scenario.status} keeps the selected form actionable and writes no Task`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    const browserErrors: string[] = []
    const expectedAuthorityConsoleErrors: string[] = []
    const applicationErrors: string[] = []
    const webSockets: string[] = []
    const requests: Array<{ method: string; path: string }> = []
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const text = message.text()
      if (new RegExp(
        `^Failed to load resource: the server responded with a status of ${scenario.status} \\([^)]*\\)$`
      ).test(text)) {
        expectedAuthorityConsoleErrors.push(text)
        return
      }
      browserErrors.push(text)
    })
    page.on('pageerror', (error) => browserErrors.push(error.message))
    page.on('websocket', (webSocket) => webSockets.push(webSocket.url()))
    page.on('request', (request) => {
      requests.push({
        method: request.method(),
        path: new URL(request.url()).pathname
      })
    })
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname
      const expectedAuthorityRejection =
        response.request().method() === 'POST' &&
        path === '/api/v1/workflow-tasks' &&
        response.status() === scenario.status
      if (
        response.url().startsWith(`${os.url}/api/v1/`) &&
        response.status() >= 400 &&
        !expectedAuthorityRejection
      ) {
        applicationErrors.push(
          `${response.request().method()} ${path} ${response.status()}`
        )
      }
    })

    await os.mutateResourceSlotMaterialAuthority('restore')
    await ensureAppliedWorkflow(os.resourceSlotInputWorkflowUuid)
    const taskCountBefore = await workflowTaskCount(
      os.resourceSlotInputWorkflowUuid
    )
    const storageKey = `unilab.workflow.active.${
      encodeURIComponent(`local-python:${os.url}`)
    }.v1`
    await page.addInitScript(({ key, workflowUuid }) => {
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, workflowId: workflowUuid })
      )
    }, { key: storageKey, workflowUuid: os.resourceSlotInputWorkflowUuid })

    await page.goto(
      `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
    )
    await expect(page.getByText('完整控制流 DAG')).toBeVisible()
    await page.getByRole('button', {
      name: '开始运行',
      exact: true
    }).click()
    const form = page.getByRole('region', {
      name: '工作流运行输入表单'
    })
    await expect(form).toBeVisible()
    const inputState = form.getByRole('combobox', {
      name: 'sample 输入状态'
    })
    await expect(inputState).toBeEnabled({ timeout: 10_000 })
    await inputState.selectOption('value')
    const materialSelector = form.getByRole('combobox', {
      name: 'sample 资源位'
    })
    await expect(materialSelector).toContainText('I1 ResourceSlot sample')
    await materialSelector.selectOption(os.resourceSlotMaterialUuid)
    await expect(materialSelector).toHaveValue(os.resourceSlotMaterialUuid)

    await os.mutateResourceSlotMaterialAuthority(scenario.state)
    try {
      const rejectedResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/workflow-tasks'
      )
      await form.getByRole('button', {
        name: '使用以上参数运行',
        exact: true
      }).click()
      const rejected = await rejectedResponse
      expect(rejected.status()).toBe(scenario.status)
      expect(rejected.request().postDataJSON()).toEqual({
        workflow_uuid: os.resourceSlotInputWorkflowUuid,
        run_mode: 'normal',
        input: { sample: { uuid: os.resourceSlotMaterialUuid } }
      })
      expect(await rejected.json()).toEqual({
        code: scenario.status,
        error: {
          code: scenario.code,
          message: scenario.message
        }
      })

      await expect(form).toBeVisible()
      await expect(materialSelector).toHaveValue(os.resourceSlotMaterialUuid)
      const alert = form.getByRole('alert')
      await expect(alert).toContainText(scenario.actionable)
      await expect(alert).toContainText(
        `OS ${scenario.status} ${scenario.code}：${scenario.message}`
      )
      await expect(alert).not.toContainText(/已删除|已不存在|已占用|类型不兼容/)
      await expect(form.getByRole('button', {
        name: '使用以上参数运行',
        exact: true
      })).toBeEnabled()
      expect(await workflowTaskCount(os.resourceSlotInputWorkflowUuid))
        .toBe(taskCountBefore)
    } finally {
      await os.mutateResourceSlotMaterialAuthority('restore')
    }

    const forbiddenRequests = requests.filter(({ path }) =>
      path === '/api/run' ||
      path.startsWith('/api/runtime/local/') ||
      path.startsWith('/api/v1/runtime/runs') ||
      path.startsWith('/ws/workflow/')
    )
    expect(forbiddenRequests).toEqual([])
    expect(webSockets).toEqual([])
    expect(applicationErrors).toEqual([])
    expect(expectedAuthorityConsoleErrors).toEqual([
      expect.stringMatching(new RegExp(
        `^Failed to load resource: the server responded with a status of ${scenario.status} \\([^)]*\\)$`
      ))
    ])
    expect(browserErrors).toEqual([])
  })
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
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
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
    name: '应用工作流',
    exact: true
  })).toBeEnabled()
  const appliedResponse = page.waitForResponse((response) =>
    response.url().endsWith(
      `/api/v1/workflows/${os.workflowUuid}/authoring/apply`
    ) && response.request().method() === 'POST' && response.status() === 200
  )
  await page.getByRole('button', {
    name: '应用工作流',
    exact: true
  }).click()
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
  expect(webSockets).toEqual([])
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
  await expect(panelA.locator('.cm-content:visible'))
    .toHaveAttribute('contenteditable', 'false')
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
  await panelB.getByRole('button', {
    name: '保存草稿',
    exact: true
  }).click()

  await expect(panelB.getByText(
    '草稿已保存，有尚未应用的工作流修改',
    { exact: true }
  )).toBeVisible()
  expect(readFileSync(os.secondSourcePath, 'utf8')).toContain('= 4,')
  expect(readFileSync(os.sourcePath, 'utf8')).toBe(firstSourceBefore)
  await expect(panelAName).toHaveValue('prepared_panel_a')
  await expect(panelA.getByRole('button', {
    name: '应用工作流',
    exact: true
  })).toBeDisabled()
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
  const applyButton = page.getByRole('button', {
    name: '应用工作流',
    exact: true
  })
  await expect(applyButton).toBeDisabled()

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
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect.poll(() => countRequests(
    authoringRequests,
    'PUT',
    `/workflows/${os.workflowUuid}/authoring/draft`
  )).toBe(draftPutBeforeCodeSave + 1)
  await expect(page.getByText(
    '草稿已保存，有尚未应用的工作流修改',
    { exact: true }
  )).toBeVisible()
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
  await expect(applyButton).toBeDisabled()
  writeFileSync(os.sourcePath, externallyEditedSource, 'utf8')
  await expect.poll(() => countRequests(
    authoringRequests,
    'GET',
    `/workflows/${os.workflowUuid}/authoring`
  ), { timeout: 15_000 }).toBeGreaterThan(aggregateGetsBeforeExternalEdit)
  const conflictDialog = page.getByRole('dialog', { name: '远端修改冲突' })
  await expect(conflictDialog).toBeVisible()
  await expect(editor).toContainText('= 6,')
  await conflictDialog.getByRole('button', {
    name: '查看差异并用本地重试'
  }).click()
  const conflictDiff = page.getByRole('dialog', { name: /完整 Python 差异/ })
  await expect(conflictDiff.getByText('冲突重试检查')).toBeVisible()
  await expect(conflictDiff.locator('pre').nth(0)).toContainText('= 5,')
  await expect(conflictDiff.locator('pre').nth(1)).toContainText('= 6,')
  await conflictDiff.getByRole('button', {
    name: /接受完整差异并保存/
  }).click()
  await expect(page.getByText(
    '草稿已保存，有尚未应用的工作流修改',
    { exact: true }
  )).toBeVisible()
  expect(readFileSync(os.sourcePath, 'utf8')).toContain('= 6,')
  await expect(page.getByText('工作流编辑操作失败', { exact: true }))
    .toHaveCount(0)

  await canvasMode.click()
  await expect(canvasMode).toHaveAttribute('aria-pressed', 'true')
  await expect(editor).toHaveAttribute('contenteditable', 'false')
  await expect(
    page.getByText('Python 是 OS 生成的只读投影', { exact: true }),
  ).toBeVisible()
  const canvasPosition = await projectedNode.getAttribute('style')
  await dragNode(page, projectedNode, 100, 50)
  expect(await projectedNode.getAttribute('style')).toBe(canvasPosition)
  await clickNodeOutsideMiniMap(page, projectedNode)
  const nodeName = page.getByRole('textbox', { name: '节点名称' })
  await expect(nodeName).toBeEnabled()
  await nodeName.fill('prepared_canvas')
  await expect(applyButton).toBeDisabled()

  const draftPutBeforeDiffAcceptance = countRequests(
    authoringRequests,
    'PUT',
    `/workflows/${os.workflowUuid}/authoring/draft`
  )
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
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

  await expect(applyButton).toBeEnabled()
  await applyButton.click()
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
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page.getByText(
    '草稿已保存，但存在错误，修复后才能应用',
    { exact: true }
  )).toBeVisible()
  await expect(page.getByRole('region', { name: 'Python 草稿诊断' }))
    .toContainText('syntax_error')
  await expect(page.getByText(
    '当前显示 Applied Graph；暂无可应用候选',
    { exact: true }
  )).toBeVisible()
  await expect(applyButton).toBeDisabled()
  expect(browserErrors).toEqual([])
})

interface AuthoringAggregate {
  workflow_uuid: string
  workflow_revision: number
  state: string
  draft: {
    python_source: string
    draft_hash: string
    source_uri: string
  } | null
  candidate: {
    candidate_hash: string
    normalized_python_source: string
    graph: {
      workflow: Record<string, unknown>
      nodes: Array<Record<string, unknown>>
      edges: Array<Record<string, unknown>>
      node_templates: Array<Record<string, unknown>>
      handle_templates: Array<Record<string, unknown>>
    }
  } | null
  applied_graph: {
    workflow: Record<string, unknown>
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
    node_templates: Array<Record<string, unknown>>
    handle_templates: Array<Record<string, unknown>>
  }
}

interface AuthoringTransform {
  diagnostics: unknown[]
  graph: AuthoringAggregate['applied_graph'] | null
  normalized_python_source: string
}

interface SseEvent {
  id: string
  event: string
  data: Record<string, unknown>
}

async function readEnvelope<Value>(
  url: string,
  init?: RequestInit
): Promise<Value> {
  const response = await fetch(url, init)
  const responseText = await response.text()
  const osLogTail = os?.logs().slice(-8_000) ?? 'OS logs unavailable'
  expect(
    response.status,
    `${responseText}\n\nOS log tail:\n${osLogTail}`
  ).toBe(200)
  const envelope = JSON.parse(responseText) as {
    code: number
    data: Value
  }
  expect(envelope.code).toBe(0)
  return envelope.data
}

async function workflowTaskCount(workflowUuid: string): Promise<number> {
  const page = await readEnvelope<{
    items: unknown[]
    total: number
  }>(
    `${os.url}/api/v1/workflow-tasks?` +
    `workflow_uuid=${encodeURIComponent(workflowUuid)}&page_size=100`
  )
  expect(page.items).toHaveLength(page.total)
  return page.total
}

async function ensureAppliedWorkflow(
  workflowUuid: string
): Promise<AuthoringAggregate> {
  const authoringUrl = `${os.url}/api/v1/workflows/${workflowUuid}/authoring`
  let aggregate = await readEnvelope<AuthoringAggregate>(authoringUrl)
  if (aggregate.state === 'applied') return aggregate
  if (!aggregate.draft || !aggregate.candidate) {
    throw new Error(`Workflow ${workflowUuid} has no compilable Candidate`)
  }
  aggregate = await readEnvelope<AuthoringAggregate>(`${authoringUrl}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      python_source: aggregate.candidate.normalized_python_source,
      expected_draft_hash: aggregate.draft.draft_hash,
      expected_workflow_revision: aggregate.workflow_revision
    })
  })
  if (!aggregate.candidate) {
    throw new Error(`Workflow ${workflowUuid} lost its Candidate before Apply`)
  }
  const applied = await readEnvelope<{
    authoring: AuthoringAggregate
  }>(`${authoringUrl}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate_hash: aggregate.candidate.candidate_hash })
  })
  expect(applied.authoring.state).toBe('applied')
  return applied.authoring
}

async function chooseExplicitValue(
  form: import('@playwright/test').Locator,
  name: string
): Promise<void> {
  await form.getByRole('combobox', { name: `${name} 输入状态` })
    .selectOption('value')
}

async function readAuthoringEvent(
  response: Response,
  workflowUuid: string,
  cause: string,
  matches: (event: SseEvent) => boolean = () => true
): Promise<SseEvent> {
  if (!response.body) throw new Error('SSE response body is missing')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const deadline = Date.now() + 10_000
  try {
    while (Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('SSE read timed out')), 10_000)
        })
      ])
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() || ''
      for (const frame of frames) {
        const event = parseSseFrame(frame)
        if (
          event.event === 'workflow.authoring.changed' &&
          event.data.workflow_uuid === workflowUuid &&
          event.data.cause === cause &&
          matches(event)
        ) {
          return event
        }
      }
    }
    throw new Error(`missing ${cause} Authoring SSE event`)
  } finally {
    await reader.cancel()
  }
}

function parseSseFrame(frame: string): SseEvent {
  const fields = new Map<string, string>()
  for (const line of frame.split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator < 0) continue
    fields.set(
      line.slice(0, separator),
      line.slice(separator + 1).trimStart()
    )
  }
  return {
    id: fields.get('id') || '',
    event: fields.get('event') || 'message',
    data: JSON.parse(fields.get('data') || '{}') as Record<string, unknown>
  }
}

function countRequests(
  requests: Array<{ method: string; url: string }>,
  method: string,
  pathSuffix: string
): number {
  return requests.filter(
    (request) =>
      request.method === method && new URL(request.url).pathname.endsWith(pathSuffix)
  ).length
}

function lastRequest(
  requests: Array<{ method: string; url: string; body: unknown }>,
  method: string,
  pathSuffix: string
): { method: string; url: string; body: unknown } {
  const found = [...requests].reverse().find(
    (request) =>
      request.method === method && new URL(request.url).pathname.endsWith(pathSuffix)
  )
  if (!found) throw new Error(`missing ${method} ${pathSuffix}`)
  return found
}

function workflowIo(
  graph: AuthoringAggregate['applied_graph']
): Record<string, unknown> {
  const metaData = graph.workflow.meta_data as Record<string, unknown>
  return (metaData.unilab ?? {}) as Record<string, unknown>
}

function nodeInputBindings(
  graph: AuthoringAggregate['applied_graph'],
  nodeUuid: string
): Record<string, unknown> {
  const node = graph.nodes.find(({ uuid }) => uuid === nodeUuid)
  if (!node) throw new Error(`Workflow Node ${nodeUuid} is missing`)
  const metaData = node.meta_data as Record<string, unknown>
  const unilab = metaData.unilab as Record<string, unknown>
  return unilab.input_bindings as Record<string, unknown>
}

function allNodeInputBindings(
  graph: AuthoringAggregate['applied_graph']
): Record<string, unknown> {
  return Object.fromEntries(
    graph.nodes
      .map((node) => {
        const metaData = node.meta_data as Record<string, unknown> | undefined
        const unilab = metaData?.unilab as Record<string, unknown> | undefined
        return [String(node.uuid), unilab?.input_bindings ?? {}]
      })
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
  )
}

const WORKFLOW_NODE_AUTHORING_FIELDS = [
  'uuid',
  'workflow_node_template_uuid',
  'parent_uuid',
  'material_uuid',
  'name',
  'status',
  'type',
  'icon',
  'pose',
  'param',
  'footer',
  'action_name',
  'action_type',
  'execution_policy',
  'disabled',
  'minimized',
  'script',
  'description',
  'meta_data'
] as const

const WORKFLOW_EDGE_AUTHORING_FIELDS = [
  'uuid',
  'source_node_uuid',
  'target_node_uuid',
  'source_handle_uuid',
  'target_handle_uuid',
  'description',
  'meta_data'
] as const

function graphAuthoringSemantics(
  graph: AuthoringAggregate['applied_graph']
): Record<string, unknown> {
  return {
    nodes: graph.nodes
      .map((node) => pickFields(node, WORKFLOW_NODE_AUTHORING_FIELDS))
      .sort(compareUuid),
    edges: graph.edges
      .map((edge) => pickFields(edge, WORKFLOW_EDGE_AUTHORING_FIELDS))
      .sort(compareUuid)
  }
}

function pickFields(
  value: Record<string, unknown>,
  fields: readonly string[]
): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field, value[field]]))
}

function compareUuid(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): number {
  return String(left.uuid).localeCompare(String(right.uuid))
}

function requireHandleUuid(
  graph: AuthoringAggregate['applied_graph'],
  nodeUuid: string,
  handleKey: string,
  ioType: 'source' | 'target'
): string {
  const node = graph.nodes.find(({ uuid }) => uuid === nodeUuid)
  if (!node) throw new Error(`Workflow Node ${nodeUuid} is missing`)
  const templateUuid = String(node.workflow_node_template_uuid || '')
  const matches = graph.handle_templates.filter((handle) =>
    handle.workflow_node_template_uuid === templateUuid &&
    handle.handle_key === handleKey &&
    handle.io_type === ioType
  )
  if (matches.length !== 1 || typeof matches[0]?.uuid !== 'string') {
    throw new Error(
      `Expected one ${ioType} Handle ${handleKey} owned by ${nodeUuid}`
    )
  }
  return matches[0].uuid
}

async function dragNode(
  page: import('@playwright/test').Page,
  node: import('@playwright/test').Locator,
  deltaX: number,
  deltaY: number
): Promise<void> {
  const box = await node.boundingBox()
  if (!box) throw new Error('workflow node has no bounding box')
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 5 })
  await page.mouse.up()
}

async function clickNodeOutsideMiniMap(
  page: import('@playwright/test').Page,
  node: import('@playwright/test').Locator
): Promise<void> {
  const nodeBox = await node.boundingBox()
  if (!nodeBox) throw new Error('workflow node has no bounding box')
  const visibleMiniMaps = page.locator('.react-flow__minimap:visible')
  const miniMapBox = await visibleMiniMaps.count() > 0
    ? await visibleMiniMaps.first().boundingBox()
    : null
  const inset = Math.min(12, nodeBox.width / 4, nodeBox.height / 4)
  const candidates = [
    { x: nodeBox.width / 2, y: nodeBox.height / 2 },
    { x: nodeBox.width / 4, y: nodeBox.height / 2 },
    { x: (nodeBox.width * 3) / 4, y: nodeBox.height / 2 },
    { x: nodeBox.width / 2, y: nodeBox.height / 4 },
    { x: nodeBox.width / 2, y: (nodeBox.height * 3) / 4 },
    { x: inset, y: inset },
    { x: nodeBox.width - inset, y: inset },
    { x: inset, y: nodeBox.height - inset },
    { x: nodeBox.width - inset, y: nodeBox.height - inset }
  ]
  const clickPoint = candidates.find(({ x, y }) => {
    if (!miniMapBox) return true
    const pageX = nodeBox.x + x
    const pageY = nodeBox.y + y
    return !(
      pageX >= miniMapBox.x &&
      pageX <= miniMapBox.x + miniMapBox.width &&
      pageY >= miniMapBox.y &&
      pageY <= miniMapBox.y + miniMapBox.height
    )
  })

  expect(
    clickPoint,
    'Workflow node must expose a pointer target outside the ReactFlow MiniMap'
  ).toBeDefined()
  if (!clickPoint) throw new Error('workflow node is fully covered by the MiniMap')
  await node.click({ position: clickPoint })
}
