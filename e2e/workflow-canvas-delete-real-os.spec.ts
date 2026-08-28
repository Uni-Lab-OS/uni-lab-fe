import { expect, test, type Page } from '@playwright/test'

import {
  startPersistentAuthoringOs,
  type PersistentAuthoringOs
} from './helpers/persistent-authoring-os'
import { saveWorkflowDraftOnly } from './helpers/workflow-runtime-ui'

let os: PersistentAuthoringOs

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  os = await startPersistentAuthoringOs()
})

test.afterAll(async () => {
  await os?.stop()
})

/** 验证可见按钮删除会写回规范化候选并经过真实 OS 生成、校验与保存。 */
test('deletes a connected node with the visible action and real OS round-trip', async ({
  page
}) => {
  await verifyCanvasDeletion(page, os.workflowUuid, 'button')
})

/** 验证 Backspace 删除会写回独立工作流候选而非仅移除视觉节点。 */
test('deletes a connected node with Backspace and real OS round-trip', async ({
  page
}) => {
  await verifyCanvasDeletion(page, os.secondWorkflowUuid, 'Backspace')
})

/**
 * 驱动画布删除、影响确认、完整 Python 差异及真实 OS 保存链路。
 *
 * @param page Playwright 当前隔离页面。
 * @param workflowUuid 本轮独立工作流稳定 UUID。
 * @param trigger 使用可见按钮或键盘快捷键发出删除意图。
 * @returns 所有规范化候选、网络与浏览器断言通过后完成。
 */
async function verifyCanvasDeletion(
  page: Page,
  workflowUuid: string,
  trigger: 'button' | 'Backspace'
): Promise<void> {
  test.setTimeout(120_000)
  const browserErrors: string[] = []
  const authoringWrites: Array<{ method: string; path: string; status: number }> = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin !== os.url || !url.pathname.includes('/authoring')) return
    authoringWrites.push({
      method: response.request().method(),
      path: url.pathname,
      status: response.status()
    })
  })

  const storageKey = `unilab.workflow.active.${
    encodeURIComponent(`local-python:${os.url}`)
  }.v1`
  await page.addInitScript(({ key, activeWorkflowUuid }) => {
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      workflowId: activeWorkflowUuid
    }))
  }, { key: storageKey, activeWorkflowUuid: workflowUuid })
  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  await expect(page.getByText('完整控制流 DAG')).toBeVisible()

  await page.getByRole('button', {
    name: '画布模式',
    exact: true
  }).click()
  await expect(page.getByText(
    '画布模式：Python 是 OS 生成的只读投影',
    { exact: true }
  )).toBeVisible()
  const deleteSelection = page.getByRole('button', {
    name: /^删除选中/
  })
  await expect(deleteSelection).toBeDisabled()

  const nodes = page.locator(
    '[data-canvas-engine="x6"] .workflow-x6__viewport '
      + '.x6-node[data-cell-id]'
  )
  await expect(nodes).toHaveCount(2)
  const analyzeNode = nodes.filter({ hasText: /analyzed/ })
  const deletedNodeUuid = await analyzeNode.getAttribute('data-cell-id')
  expect(deletedNodeUuid).toBeTruthy()
  await analyzeNode.click({ position: { x: 24, y: 24 } })
  await expect(deleteSelection).toBeEnabled()

  let confirmation = ''
  page.once('dialog', async (dialog) => {
    confirmation = dialog.message()
    await dialog.accept()
  })
  if (trigger === 'button') {
    await deleteSelection.click()
  } else {
    await analyzeNode.focus()
    await analyzeNode.press(trigger)
  }
  await expect(nodes).toHaveCount(1)
  await expect(page.locator(
    `.workflow-x6__viewport .x6-node[data-cell-id="${deletedNodeUuid}"]`
  )).toHaveCount(0)
  expect(confirmation).toContain('删除将同时移除')
  await expect(page.getByText(
    /已删除 1 个节点、\d+ 条连线；保存前将生成完整 Python/
  )).toBeVisible()

  const requestsBeforeSave = authoringWrites.length
  await saveWorkflowDraftOnly(page.locator('main').first())
  const diffDialog = page.getByRole('dialog', { name: '完整 Python 差异' })
  await expect(diffDialog, os.logs().slice(-6_000)).toBeVisible()
  const saveResponses = authoringWrites.slice(requestsBeforeSave)
  expect(saveResponses).toEqual(expect.arrayContaining([
    expect.objectContaining({
      method: 'POST',
      path: '/api/v1/authoring/generate-python',
      status: 200
    }),
    expect.objectContaining({
      method: 'POST',
      path: '/api/v1/authoring/validate',
      status: 200
    })
  ]))
  const draftSaved = page.waitForResponse((response) =>
    response.url().endsWith(
      `/api/v1/workflows/${workflowUuid}/authoring/draft`
    ) && response.request().method() === 'PUT' && response.status() === 200
  )
  await diffDialog.getByRole('button', {
    name: '接受完整差异并保存'
  }).click()
  await draftSaved
  await expect(diffDialog).toBeHidden()

  const aggregate = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${workflowUuid}/authoring`
  )
  expect(aggregate.candidate).not.toBeNull()
  expect(aggregate.candidate?.graph.nodes.map((node) => node.uuid))
    .not.toContain(deletedNodeUuid)
  expect(aggregate.candidate?.graph.nodes).toHaveLength(1)
  expect(aggregate.candidate?.graph.edges).toHaveLength(0)
  expect(aggregate.candidate?.normalized_python_source)
    .not.toContain(`# unilab:node_uuid=${deletedNodeUuid}`)
  expect(authoringWrites.every((response) => response.status < 400)).toBe(true)
  expect(browserErrors).toEqual([])
}

interface AuthoringAggregate {
  candidate: {
    graph: {
      nodes: Array<{ uuid: string }>
      edges: Array<{ uuid: string }>
    }
    normalized_python_source: string
  } | null
}

/**
 * 读取 Uni-Lab-OS 标准信封并关闭式校验成功码。
 *
 * @param url 真实 OS HTTP 接口地址。
 * @returns 信封内已验证的数据主体。
 */
async function readEnvelope<Value>(url: string): Promise<Value> {
  const response = await fetch(url)
  const body = await response.json() as {
    code: number
    data?: Value
    error?: unknown
  }
  expect(response.ok, JSON.stringify(body)).toBe(true)
  expect(body.code).toBe(0)
  if (body.data === undefined) throw new Error('response data missing')
  return body.data
}
