import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo
} from '@playwright/test'
import type { WorkflowAuthoringAggregate } from '@unilab/services'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  startPersistentAuthoringOs,
  type PersistentAuthoringOs
} from './helpers/persistent-authoring-os'
import {
  installWorkflowPanel,
  prepareAppliedWorkflow
} from './helpers/workflow-runtime-ui'

let os: PersistentAuthoringOs

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  os = await startPersistentAuthoringOs()
})

test.afterAll(async () => {
  await os?.stop()
})

test('工作流输入输出与节点参数使用紧凑渐进式编辑', async ({
  page
}, testInfo) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const browserErrors = collectBrowserErrors(page)
  await installActiveWorkflow(page, os.workflowUuid)

  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  await expect(page.getByText('完整控制流 DAG')).toBeVisible()
  await page.getByRole('button', {
    name: '画布模式',
    exact: true
  }).click()
  await page.getByRole('button', { name: /输入与输出/ }).click()

  const dialog = page.locator(
    '[role="dialog"][aria-label="工作流输入与输出配置"]'
  )
  const editor = dialog.getByRole('region', {
    name: '工作流输入与输出编辑器'
  })
  await expect(dialog).toBeVisible()
  await expect(editor.getByRole('tab', { name: /输入参数/ }))
    .toHaveAttribute('aria-selected', 'true')
  await capture(page, testInfo, '01-workflow-input-list')

  const firstInput = editor.locator('[data-workflow-input-name]').first()
  await firstInput.locator('summary').click()
  await expect(firstInput.locator('details')).toHaveAttribute('open', '')
  await capture(page, testInfo, '02-workflow-input-expanded')

  await editor.getByRole('tab', { name: /输出参数/ }).click()
  await expect(editor.getByRole('tab', { name: /输出参数/ }))
    .toHaveAttribute('aria-selected', 'true')
  await expect(editor.locator('[data-workflow-output-name]').first())
    .toBeVisible()
  await capture(page, testInfo, '03-workflow-output-list')

  const firstOutput = editor.locator('[data-workflow-output-name]').first()
  await firstOutput.locator('summary').click()
  await expect(firstOutput.locator('details')).toHaveAttribute('open', '')
  await capture(page, testInfo, '04-workflow-output-expanded')

  await dialog.getByRole('button', { name: '关闭' }).click()
  await expectDrawerExited(dialog)
  const actionNodes = page.locator('.wf-node--action-strip')
  await expect(actionNodes.locator('.wf-node__id')).toHaveCount(2)
  await expect(actionNodes.locator('.wf-node__caption')).toHaveCount(0)
  await expect(actionNodes.locator('.wf-node__kind-glyph')).toHaveCount(0)
  await expect(actionNodes.getByText('操作节点', { exact: true })).toHaveCount(0)
  await capture(page, testInfo, '10-workflow-canvas-reference-light')

  await page.locator('.react-flow__node-wfNode').first().click()
  const nodeEditor = page.getByRole('complementary', {
    name: '画布节点编辑器'
  })
  await expect(nodeEditor).toBeVisible()
  await expect(nodeEditor.getByText('节点属性', { exact: true })).toBeVisible()
  await capture(page, testInfo, '11-workflow-node-properties')
  await nodeEditor.getByRole('button', { name: '关闭属性面板' }).click()
  await expect(nodeEditor).toBeHidden()

  expect(browserErrors).toEqual([])
})

test('本次运行输入使用单列表和用户态取值文案', async ({
  page
}, testInfo) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const browserErrors = collectBrowserErrors(page)
  const applied = await ensureAppliedWorkflow(os.scalarInputWorkflowUuid)
  await installActiveWorkflow(page, os.scalarInputWorkflowUuid)

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
  await expect(form).toContainText(
    `使用已应用版本 ${applied.workflow_revision}`
  )
  await expect(form.getByRole('combobox', {
    name: 'attempts 输入状态'
  })).toContainText('使用工作流默认值')
  await expect(form.getByRole('combobox', {
    name: 'label 输入状态'
  })).toContainText('本次不传入')
  await capture(page, testInfo, '05-runtime-input-defaults')

  await form.getByRole('combobox', { name: 'label 输入状态' })
    .selectOption('value')
  await form.getByRole('textbox', { name: 'label 明确值' })
    .fill('样品批次 A')
  await expect(form.getByRole('button', {
    name: '使用以上参数运行',
    exact: true
  })).toBeVisible()
  await capture(page, testInfo, '06-runtime-input-custom-value')

  expect(browserErrors).toEqual([])
})

test('反馈保持事件流顺序并按需展开原始数据', async ({
  page
}, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const browserErrors = collectBrowserErrors(page)
  await installWorkflowPanel(page, os.runtimeWorkflowUuid)
  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  const panel = page.locator('[data-panel-instance-id="runtime-workflow"]')
  await prepareAppliedWorkflow(panel, page)

  const createResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/v1/workflow-tasks'
  )
  await panel.getByRole('button', {
    name: '开始运行',
    exact: true
  }).click()
  await page.getByRole('button', {
    name: '使用以上参数运行',
    exact: true
  }).click()
  const created = await createResponse
  expect(created.status()).toBe(201)
  const taskInputDialog = page.locator(
    '[role="dialog"][aria-label="本次工作流运行参数"]'
  )
  await expectDrawerExited(taskInputDialog)
  const createdEnvelope = await created.json() as {
    data: { uuid: string }
  }
  const taskUuid = createdEnvelope.data.uuid
  const jobsResponse = await fetch(
    `${os.upstreamUrl}/api/v1/workflow-tasks/${taskUuid}/jobs`
  )
  expect(jobsResponse.status).toBe(200)
  const jobsEnvelope = await jobsResponse.json() as {
    data: Array<{ uuid: string }>
  }
  const firstJobUuid = jobsEnvelope.data[0]?.uuid
  expect(firstJobUuid).toBeTruthy()

  await os.startRuntimeJob(taskUuid, firstJobUuid || '')
  await os.commitJobFeedback(firstJobUuid || '', [{
    sequence: 1,
    feedback_type: 'progress',
    data: { progress: 50, temperature_c: 24.5 },
    observed_at: '2026-08-04T02:00:01Z',
    idempotency_key: 'workflow-ui-feedback-1'
  }])

  const eventTab = panel.getByRole('tab', { name: /事件流/ })
  await expect(eventTab).toHaveText(/事件流\s*[1-9]/)
  await eventTab.click()
  const eventPanel = panel.locator('#workflow-output-panel-events')
  await expect(eventPanel.getByText('最新事件在前', { exact: true }))
    .toBeVisible()
  const feedbackRaw = eventPanel.locator(
    '.workflow-runtime__event-raw pre'
  ).filter({ hasText: 'temperature_c' })
  await expect(feedbackRaw).toHaveCount(1)
  const rawDetails = feedbackRaw.locator('..')
  await expect(rawDetails).not.toHaveAttribute('open', '')
  await expect(rawDetails.locator('pre')).toBeHidden()
  await capture(page, testInfo, '07-feedback-event-collapsed')

  await rawDetails.locator('summary').click()
  await expect(rawDetails.locator('pre')).toBeVisible()
  await expect(rawDetails.locator('pre')).toContainText('temperature_c')
  await capture(page, testInfo, '08-feedback-event-expanded')

  expect(browserErrors).toEqual([])
})

async function installActiveWorkflow(
  page: Page,
  workflowUuid: string
): Promise<void> {
  const storageKey = `unilab.workflow.active.${
    encodeURIComponent(`local-python:${os.url}`)
  }.v1`
  await page.addInitScript(({ key, uuid }) => {
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, workflowId: uuid })
    )
  }, { key: storageKey, uuid: workflowUuid })
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function expectDrawerExited(dialog: Locator): Promise<void> {
  await expect(dialog).toBeHidden()
  await expect(dialog).toHaveCSS('visibility', 'hidden')
}

async function ensureAppliedWorkflow(
  workflowUuid: string
): Promise<WorkflowAuthoringAggregate> {
  const authoringUrl = `${os.url}/api/v1/workflows/${workflowUuid}/authoring`
  let aggregate = await readEnvelope<WorkflowAuthoringAggregate>(authoringUrl)
  if (aggregate.state === 'applied') return aggregate
  if (!aggregate.draft || !aggregate.candidate) {
    throw new Error(`Workflow ${workflowUuid} has no compilable Candidate`)
  }
  aggregate = await readEnvelope<WorkflowAuthoringAggregate>(
    `${authoringUrl}/draft`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        python_source: aggregate.candidate.normalized_python_source,
        expected_draft_hash: aggregate.draft.draft_hash,
        expected_workflow_revision: aggregate.workflow_revision
      })
    }
  )
  if (!aggregate.candidate) {
    throw new Error(`Workflow ${workflowUuid} lost its Candidate before Apply`)
  }
  const applied = await readEnvelope<{
    authoring: WorkflowAuthoringAggregate
  }>(`${authoringUrl}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidate_hash: aggregate.candidate.candidate_hash
    })
  })
  expect(applied.authoring.state).toBe('applied')
  return applied.authoring
}

async function readEnvelope<Value>(
  url: string,
  init?: RequestInit
): Promise<Value> {
  const response = await fetch(url, init)
  const responseText = await response.text()
  expect(
    response.status,
    `${responseText}\n\nOS log tail:\n${os.logs().slice(-8_000)}`
  ).toBe(200)
  const envelope = JSON.parse(responseText) as {
    code: number
    data: Value
  }
  expect(envelope.code).toBe(0)
  return envelope.data
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string
): Promise<void> {
  const image = await page.screenshot({
    fullPage: true,
    animations: 'disabled'
  })
  await testInfo.attach(name, {
    body: image,
    contentType: 'image/png'
  })
  const outputDirectory = process.env.UNILAB_UI_PHASE_SCREENSHOT_DIR || resolve(
    process.cwd(),
    '../e2e-artifacts/workflow-ui-combined-20260804'
  )
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(join(outputDirectory, `${name}.png`), image)
}
