import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

interface AuthoringDraft {
  python_source: string
  draft_hash: string
  diagnostics: Array<{ code: string; message: string }>
}

interface AuthoringAggregate {
  workflow_revision: number
  state: string
  applied_graph: {
    nodes: unknown[]
    edges: unknown[]
  }
  draft: AuthoringDraft | null
  candidate: unknown | null
}

const enabled = process.env.UNILAB_E2E_WORKBENCH_BACKEND_ONLY === '1'
const workbenchUrl = process.env.UNILAB_WORKBENCH_URL

test.skip(
  !enabled || !workbenchUrl,
  '需要显式启动只有 Workspace Backend、没有 Edge Runtime 的 Workbench'
)

test('keeps the last-valid Workflow and renders Material before Edge starts', async ({
  page
}, testInfo) => {
  test.setTimeout(120_000)
  const browserErrors: string[] = []
  page.on('console', message => {
    if (
      message.type() === 'error'
      && !message.text().startsWith('Failed to load resource:')
    ) browserErrors.push(message.text())
  })
  page.on('pageerror', error => browserErrors.push(error.message))

  await page.goto(workbenchUrl!, { waitUntil: 'domcontentloaded' })
  const workbench = page.locator('.unilab-workbench')
  await expect(workbench).toHaveAttribute('data-workspace-backend-phase', 'ready')
  await expect(workbench).toHaveAttribute(
    'data-edge-runtime-phase',
    /^(?:idle|failed)$/
  )
  await expect(workbench).toHaveAttribute('data-plc-simulator-phase', 'idle')
  await expect(workbench).toHaveAttribute('data-connection-mode', 'local')
  await expect(workbench).toHaveAttribute(
    'data-workspace-graph-fingerprint',
    /^[0-9a-f]{64}$/
  )

  const workflow = page.getByRole('region', { name: '工作流窗口' })
  await expect(workflow.getByText('完整控制流 DAG')).toBeVisible()
  await expect(workflow.locator('.react-flow__node').first()).toBeVisible()
  await expect.poll(
    () => workflow.locator('.react-flow__edge').count()
  ).toBeGreaterThan(0)
  await capture(page, testInfo, '01-workflow-backend-only')

  const apiUrl = await workbench.getAttribute('data-backend-api-url')
  const workflowUuid = new URL(workbenchUrl!).searchParams.get('workflowUuid')
  expect(apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  expect(workflowUuid).toMatch(/^[0-9a-f-]{36}$/)
  const authoringUrl = `${apiUrl}/api/v1/workflows/${workflowUuid}/authoring`
  const before = await readEnvelope<AuthoringAggregate>(authoringUrl)
  if (!before.draft) throw new Error('工作流没有可恢复的 Python 草稿')
  const originalSource = before.draft.python_source
  const nodeCount = await workflow.locator('.react-flow__node').count()
  const edgeCount = await workflow.locator('.react-flow__edge').count()

  let invalid: AuthoringAggregate | null = null
  try {
    invalid = await readEnvelope<AuthoringAggregate>(`${authoringUrl}/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        python_source: `${originalSource}\ndef invalid_authoring_worker(:\n`,
        expected_draft_hash: before.draft.draft_hash,
        expected_workflow_revision: before.workflow_revision
      })
    })
    expect(invalid.state).toBe('draft_invalid')
    expect(invalid.candidate).toBeNull()
    expect(invalid.draft?.diagnostics.map(({ code }) => code))
      .toContain('syntax_error')
    // AIW-01 verifies that the persistent Backend owns the authoring state.
    // The Workspace Host event stream that invalidates an already-open view is
    // introduced in AIW-02, so reload through the same Workbench URL here.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(workflow.getByText(
      '草稿存在错误，当前仍使用已保存的工作流',
      { exact: true }
    )).toBeVisible({ timeout: 15_000 })
    await expect(workflow.getByRole('region', {
      name: 'Python 草稿诊断'
    })).toBeVisible()
    await expect(workflow.locator('.react-flow__node')).toHaveCount(nodeCount)
    await expect(workflow.locator('.react-flow__edge')).toHaveCount(edgeCount)
    await capture(page, testInfo, '02-invalid-draft-last-valid-workflow')
  } finally {
    if (invalid?.draft) {
      await readEnvelope<AuthoringAggregate>(`${authoringUrl}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          python_source: originalSource,
          expected_draft_hash: invalid.draft.draft_hash,
          expected_workflow_revision: invalid.workflow_revision
        })
      })
    }
  }
  const restored = await readEnvelope<AuthoringAggregate>(authoringUrl)
  expect(restored.state).toBe(before.state)
  expect(restored.draft?.python_source).toBe(originalSource)
  expect(restored.draft?.diagnostics.map(({ code }) => code))
    .toEqual(before.draft.diagnostics.map(({ code }) => code))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(workflow.getByText('syntax_error', { exact: true }))
    .toHaveCount(0, { timeout: 15_000 })

  await page.locator(
    '[id="shell-tab-unilab:device-management-navigation"]'
  ).click()
  await expect(page.locator('main[data-workbench-view]')).toHaveAttribute(
    'data-workbench-view',
    'device'
  )
  const instruments = page.getByRole('region', { name: '仪器设备窗口' })
  await expect(instruments.getByText(/\d+ 台设备/).first()).toBeVisible()
  await expect(instruments.getByText('动作目录', { exact: true })).toBeVisible()
  await expect(instruments.getByText('设备目录不可用', { exact: true }))
    .toHaveCount(0)
  await capture(page, testInfo, '03-instruments-backend-only')

  await page.locator(
    '[id="shell-tab-unilab:device-management-navigation"]'
  ).click()
  await page.locator('[id="shell-tab-unilab:material-navigation"]').click()
  await expect(page.locator('main[data-workbench-view]')).toHaveAttribute(
    'data-workbench-view',
    'split'
  )
  const material = page.getByRole('region', { name: '物料窗口' })
  await expect(material).toBeVisible()
  await expect(material.getByText(/\([1-9]\d*\)/).first()).toBeVisible()
  await expect(material.getByRole('group', { name: '实验室视图' })).toBeVisible()
  const threeDimensionalView = material.getByRole('button', {
    name: '3D',
    exact: true
  })
  await threeDimensionalView.click()
  await expect(threeDimensionalView).toHaveAttribute('aria-pressed', 'true')
  await expect(material.locator('canvas:visible').first()).toBeVisible({
    timeout: 45_000
  })
  await expect(page.getByRole('region', { name: '工作流窗口' })).toBeVisible()
  await capture(page, testInfo, '04-workflow-material-backend-only')

  expect(browserErrors).toEqual([])
})

async function readEnvelope<Value>(
  url: string,
  init?: RequestInit
): Promise<Value> {
  const response = await fetch(url, init)
  expect(response.ok).toBe(true)
  const envelope = await response.json() as {
    code?: number
    data: Value
    error?: unknown
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
    animations: 'disabled',
    fullPage: true
  })
  await testInfo.attach(name, { body: image, contentType: 'image/png' })
  const outputDirectory = process.env.UNILAB_UI_PHASE_SCREENSHOT_DIR
  if (!outputDirectory) return
  mkdirSync(resolve(outputDirectory), { recursive: true })
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: join(resolve(outputDirectory), `${name}.png`)
  })
}
