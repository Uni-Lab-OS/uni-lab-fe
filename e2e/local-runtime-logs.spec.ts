import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

const artifactDirectory = process.env.UNILAB_E2E_ARTIFACT_DIR

test.beforeEach(async ({ page }) => {
  await installRuntimeApi(page)
  await page.route('**/health', async (route) => {
    await route.fulfill({ json: { status: 'ok' } })
  })
  await page.route('**/api/v1/devices', async (route) => {
    await route.fulfill({
      json: {
        code: 0,
        data: {
          schemaVersion: 'device-catalog/v1',
          source: 'edge',
          generatedAt: Date.now(),
          items: []
        }
      }
    })
  })
  await page.route('**/api/v1/workflow-node-templates?*', async (route) => {
    await route.fulfill({
      json: {
        code: 0,
        data: {
          authority: { authority_id: 'e2e-edge', kind: 'local' },
          catalog_fingerprint: `sha256:${'a'.repeat(64)}`,
          items: [],
          total: 0,
          page: 1,
          page_size: 100
        }
      }
    })
  })
  await page.route('**/api/v1/materials/graph', async (route) => {
    await route.fulfill({ json: { code: 0, data: { nodes: [] } } })
  })
  await page.route('**/api/v1/material-shapes', async (route) => {
    await route.fulfill({ json: { code: 0, data: { items: [] } } })
  })
})

test('keeps the log entry immediately left of the Edge connection status', async ({
  page
}) => {
  await page.goto('/')

  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  const logButton = connectionBar.getByRole('button', { name: '查看日志' })
  const edgeStatus = connectionBar.getByRole('status')
  await expect(logButton).toBeVisible()
  await expect(edgeStatus).toContainText('Edge 未连接')

  const logBox = await logButton.boundingBox()
  const statusBox = await edgeStatus.boundingBox()
  expect(logBox).not.toBeNull()
  expect(statusBox).not.toBeNull()
  expect(logBox?.x).toBeLessThan(statusBox?.x ?? 0)

  await logButton.click()
  await expect(page.getByRole('dialog', { name: '本地运行日志' }))
    .toBeVisible()
})

test('keeps the original log entry in the local runtime dialog', async ({
  page
}) => {
  await page.goto('/')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await connectionBar.getByRole('button', { name: '启动本地环境' }).click()
  const runtimeDialog = page.getByRole('dialog', {
    name: '启动领域侧本地调试环境（以 sz_lab 为例）'
  })
  const dialogLogButton = runtimeDialog.getByRole('button', {
    name: '查看日志'
  })
  await expect(dialogLogButton).toBeVisible()
  await dialogLogButton.click()
  const logDrawer = page.getByRole('dialog', { name: '本地运行日志' })
  await expect(logDrawer).toBeVisible()
  await expect(logDrawer.getByRole('tab', { name: /Edge 运行时/ }))
    .toHaveAttribute('aria-selected', 'true')
  await expect(logDrawer.getByText('latest edge output')).toBeVisible()
  await expect(logDrawer).not.toContainText('Bridge')

  await page.keyboard.press('Escape')
  await expect(logDrawer).toBeHidden()
  await expect(runtimeDialog).toBeVisible()
})

test('用户拖动滚动条与自动刷新重叠时保持阅读位置', async ({
  page
}) => {
  await page.goto('/')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await connectionBar.getByRole('button', { name: '查看日志' }).click()

  const logOutput = page.getByRole('list', { name: '格式化运行日志' })
  await expect.poll(
    () => logOutput.evaluate((element) => (
      element.scrollHeight > element.clientHeight
    ))
  ).toBe(true)
  await expect.poll(
    () => logOutput.evaluate((element) => (
      element.scrollHeight - element.clientHeight - element.scrollTop
    ))
  ).toBeLessThanOrEqual(4)
  await capture(page, '01-log-tail-following.png')

  const rowsBeforeRefresh = await logOutput.locator('li').count()
  await logOutput.dispatchEvent('pointerdown', {
    pointerType: 'mouse',
    button: 0,
    isPrimary: true
  })
  const scrollTopBeforeRefresh = await logOutput.evaluate((element) => (
    element.scrollTop
  ))
  await capture(page, '02-user-scroll-started.png')

  await expect.poll(
    () => logOutput.locator('li').count(),
    { timeout: 5_000 }
  ).toBeGreaterThan(rowsBeforeRefresh)
  expect(await logOutput.evaluate((element) => element.scrollTop))
    .toBe(scrollTopBeforeRefresh)
  await capture(page, '03-refresh-preserved-pointer-position.png')

  const scrollTopWhileReading = await logOutput.evaluate((element) => {
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    element.scrollTop = Math.max(0, element.scrollTop - 240)
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
    return element.scrollTop
  })
  const rowsBeforeReadingRefresh = await logOutput.locator('li').count()
  await expect.poll(
    () => logOutput.locator('li').count(),
    { timeout: 5_000 }
  ).toBeGreaterThan(rowsBeforeReadingRefresh)
  expect(await logOutput.evaluate((element) => element.scrollTop))
    .toBe(scrollTopWhileReading)
  await capture(page, '04-refresh-preserved-reading-position.png')

  await logOutput.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  const rowsBeforeFollowResumed = await logOutput.locator('li').count()
  await expect.poll(
    () => logOutput.locator('li').count(),
    { timeout: 5_000 }
  ).toBeGreaterThan(rowsBeforeFollowResumed)
  await expect.poll(
    () => logOutput.evaluate((element) => (
      element.scrollHeight - element.clientHeight - element.scrollTop
    ))
  ).toBeLessThanOrEqual(4)
  await capture(page, '05-log-tail-follow-resumed.png')
})

test('keeps the log drawer usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await connectionBar.getByRole('button', { name: '启动本地环境' }).click()
  const runtimeDialog = page.getByRole('dialog', {
    name: '启动领域侧本地调试环境（以 sz_lab 为例）'
  })
  const dialogLogButton = runtimeDialog.getByRole('button', {
    name: '查看日志'
  })
  await expect(dialogLogButton).toBeVisible()
  await expect(dialogLogButton).toBeInViewport()
  await dialogLogButton.click()

  const logDrawer = page.getByRole('dialog', { name: '本地运行日志' })
  await expect(logDrawer).toBeVisible()
  await expect(logDrawer.getByRole('tab', { name: /PLC-Sim/ })).toBeVisible()
  await expect(logDrawer.getByRole('tab', { name: /Edge 运行时/ })).toBeVisible()
  await expect(logDrawer).toHaveCSS('width', '390px')
})

test('Edge 缺少 Phoenix 依赖时在启动界面给出非阻塞修复提示', async ({
  page
}) => {
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto('/?phoenixMissing=1')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  const runtimeButton = connectionBar.getByRole('button', {
    name: '本地调试已启动'
  })
  await expect(runtimeButton).toContainText('Trace 降级')
  await capture(page, '01-phoenix-degraded-toolbar.png')
  await runtimeButton.click()

  const runtimeDialog = page.getByRole('dialog', {
    name: '启动领域侧本地调试环境（以 sz_lab 为例）'
  })
  const recoveryNotice = runtimeDialog.getByRole('status', {
    name: '链路追踪（Trace）功能已降级'
  })
  await expect(recoveryNotice).toBeVisible({ timeout: 3_000 })
  await expect(recoveryNotice).toContainText('设备与业务运行不受影响')
  await expect(recoveryNotice).toContainText("pip install -e '.[observability]'")
  await expect(recoveryNotice).toContainText('停止并重新启动 Edge')
  await capture(page, '02-phoenix-recovery-notice.png')
  await captureLocator(recoveryNotice, '03-phoenix-recovery-command.png')

  await runtimeDialog.getByRole('button', { name: '查看日志' }).click()
  const logDrawer = page.getByRole('dialog', { name: '本地运行日志' })
  await expect(logDrawer).toContainText('未安装 Arize Phoenix')
  await expect(logDrawer).toContainText('/api/v1/observability/otlp/v1/traces')
  await logDrawer.getByRole('list', { name: '格式化运行日志' })
    .evaluate((element) => {
      element.scrollTop = 0
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
  await capture(page, '04-phoenix-source-logs.png')

  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(recoveryNotice).toBeVisible()
  await recoveryNotice.scrollIntoViewIfNeeded()
  await capture(page, '05-phoenix-recovery-narrow.png')
  expect(browserErrors).toEqual([])
})

async function installRuntimeApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let logReadCount = 0
    const hasPhoenixMissing = (): boolean => (
      new URLSearchParams(window.location.search).has('phoenixMissing')
    )
    const idleSnapshot = {
      phase: 'idle' as const,
      message: 'PLC-Sim 与领域侧 Edge 均未启动',
      simulatorRunning: false,
      bridgeRunning: false,
      edgeRunning: false
    }
    const readySnapshot = {
      ...idleSnapshot,
      phase: 'ready' as const,
      message: '领域侧 Edge 已就绪',
      edgeRunning: true
    }
    const runtimeApi = {
      selectPath: async () => null,
      getDefaultEnvironmentPath: async () => '/tmp/envs/unilab',
      getSnapshot: async () => hasPhoenixMissing()
        ? readySnapshot
        : idleSnapshot,
      startSimulator: async () => idleSnapshot,
      stopSimulator: async () => idleSnapshot,
      startEdge: async () => idleSnapshot,
      stopEdge: async () => idleSnapshot,
      readLogs: async () => {
        logReadCount += 1
        const edgeLines = Array.from(
          { length: 80 + logReadCount * 4 },
          (_, index) => `26-08-04 [12:00:${String(index).padStart(2, '0')}] [INFO] edge line ${index}`
        )
        if (hasPhoenixMissing()) {
          edgeLines.unshift(
            '[launcher] 2026-08-04T03:12:00.000Z starting',
            '26-08-04 [11:12:02,100] [ERROR] Phoenix trace 日志服务启动失败：未安装 Arize Phoenix',
            'POST /api/v1/observability/otlp/v1/traces HTTP/1.1 503 Service Unavailable',
            'POST /api/v1/observability/otlp/v1/traces HTTP/1.1 503 Service Unavailable'
          )
        }
        edgeLines.push('latest edge output')
        return {
          readAt: Date.now(),
          entries: [
            {
              kind: 'simulator' as const,
              content: 'OPC UA ready',
              available: true,
              truncated: false
            },
            {
              kind: 'bridge' as const,
              content: 'Edge service ready',
              available: true,
              truncated: false
            },
            {
              kind: 'edge' as const,
              content: edgeLines.join('\n'),
              available: true,
              truncated: false
            }
          ]
        }
      },
      onSnapshot: () => () => undefined
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { runtime: runtimeApi }
    })
  })
}

async function capture(page: Page, name: string): Promise<void> {
  if (!artifactDirectory) return
  mkdirSync(artifactDirectory, { recursive: true })
  await page.screenshot({
    path: resolve(artifactDirectory, name),
    fullPage: true
  })
}

async function captureLocator(locator: Locator, name: string): Promise<void> {
  if (!artifactDirectory) return
  mkdirSync(artifactDirectory, { recursive: true })
  await locator.screenshot({
    path: resolve(artifactDirectory, name)
  })
}
