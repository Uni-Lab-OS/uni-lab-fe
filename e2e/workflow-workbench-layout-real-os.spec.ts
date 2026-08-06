import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  startPersistentAuthoringOs,
  type PersistentAuthoringOs
} from './helpers/persistent-authoring-os'

let os: PersistentAuthoringOs

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  os = await startPersistentAuthoringOs()
})

test.afterAll(async () => {
  await os?.stop()
})

test('编写模式只保留当前任务所需面板', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1000 })

  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

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

  const panel = page.locator('.persistent-authoring').first()
  const canvasBody = panel.locator('.persistent-authoring__canvas-body')
  const graphStage = panel.locator('.persistent-authoring__graph-stage')
  const palette = panel.getByRole('complementary', {
    name: '工作流节点面板'
  })
  const inspector = panel.getByRole('complementary', {
    name: '画布节点编辑器'
  })

  await expect(panel.getByText('完整控制流 DAG')).toBeVisible()
  await expect(panel.getByRole('button', {
    name: '代码模式',
    exact: true
  })).toHaveAttribute('aria-pressed', 'true')
  await expect(canvasBody).toHaveClass(/is-code-mode/)
  await expect(palette).toHaveCount(0)
  await expect(inspector).toHaveCount(0)
  expect((await graphStage.boundingBox())?.width ?? 0).toBeGreaterThan(700)
  await capture(page, testInfo, '01-code-mode-focused')

  await panel.getByRole('button', {
    name: '画布模式',
    exact: true
  }).click()
  const hidePalette = panel.getByRole('button', {
    name: '隐藏节点库',
    exact: true
  })
  await expect(hidePalette).toHaveAttribute('aria-pressed', 'true')
  await expect(palette).toBeVisible()
  await expect(inspector).toHaveCount(0)
  await capture(page, testInfo, '02-canvas-mode-palette')

  const graphWidthWithPalette = (await graphStage.boundingBox())?.width ?? 0
  await hidePalette.click()
  const showPalette = panel.getByRole('button', {
    name: '显示节点库',
    exact: true
  })
  await expect(showPalette).toHaveAttribute('aria-pressed', 'false')
  await expect(palette).toHaveCount(0)
  const graphWidthWithoutPalette = (await graphStage.boundingBox())?.width ?? 0
  expect(graphWidthWithoutPalette).toBeGreaterThan(graphWidthWithPalette)
  await capture(page, testInfo, '03-canvas-mode-focused')

  await panel.locator('.react-flow__node-wfNode').first().click({
    position: { x: 24, y: 24 }
  })
  await expect(inspector).toBeVisible()
  await expect(canvasBody).toHaveClass(/has-inspector/)
  await capture(page, testInfo, '04-selected-node-inspector')

  await showPalette.click()
  await expect(palette).toBeVisible()
  await expect(inspector).toBeVisible()
  await capture(page, testInfo, '05-palette-and-inspector')

  await page.setViewportSize({ width: 820, height: 900 })
  await expect(inspector).toBeVisible()
  const inspectorBox = await inspector.boundingBox()
  expect(inspectorBox).not.toBeNull()
  expect(inspectorBox?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect((inspectorBox?.x ?? 0) + (inspectorBox?.width ?? 0))
    .toBeLessThanOrEqual(820)
  await capture(page, testInfo, '06-narrow-workbench-inspector')

  await page.setViewportSize({ width: 680, height: 900 })
  await expect(inspector).toBeVisible()
  await expect(canvasBody).toHaveClass(/has-inspector/)
  const compactInspectorBox = await inspector.boundingBox()
  expect(compactInspectorBox).not.toBeNull()
  expect(compactInspectorBox?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect((compactInspectorBox?.x ?? 0) + (compactInspectorBox?.width ?? 0))
    .toBeLessThanOrEqual(680)
  await capture(page, testInfo, '07-compact-workbench-inspector')

  expect(browserErrors).toEqual([])
})

test('再次点击工作流菜单返回工作流列表', async ({ page }) => {
  test.setTimeout(90_000)
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
  const navigation = page.getByRole('navigation', { name: '主导航' })
  const workflowButton = navigation.getByRole('button', {
    name: '工作流',
    exact: true
  })

  await expect(page.getByText('完整控制流 DAG')).toBeVisible()
  await workflowButton.click()

  await expect(page.getByRole('heading', { name: '可用工作流' }))
    .toBeVisible()
  await expect(page.getByText('完整控制流 DAG')).toHaveCount(0)
  await expect.poll(() => page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey)
    return raw ? JSON.parse(raw).workflowId : null
  }, activeWorkflowStorageKey)).toBe('')
})

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string
): Promise<void> {
  const image = await page.screenshot({ animations: 'disabled' })
  await testInfo.attach(name, {
    body: image,
    contentType: 'image/png'
  })
  const outputDirectory = process.env.UNILAB_UI_PHASE_SCREENSHOT_DIR
  if (!outputDirectory) return
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(join(outputDirectory, `${name}.png`), image)
}
