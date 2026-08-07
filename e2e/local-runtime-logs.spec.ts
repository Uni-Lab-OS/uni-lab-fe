import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

const artifactDirectory = process.env.UNILAB_E2E_ARTIFACT_DIR
// 浏览器实测可换行日志行高时允许的亚像素滚动修正。
const LOG_SCROLL_POSITION_TOLERANCE_PX = 4

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
  // 关闭页面背景物料（Material）事件流（SSE），避免界面测试访问未启动的真实 Edge。
  await page.route('**/api/v1/monitor/events?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ''
    })
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
    name: '领域侧 Edge（以 sz_lab 为例）'
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
  const openLogFileButton = logDrawer.getByRole('button', {
    name: '打开日志目录'
  })
  await expect(openLogFileButton).toBeEnabled()
  await openLogFileButton.click()
  await expect(logDrawer).not.toContainText('Bridge')

  await page.keyboard.press('Escape')
  await expect(logDrawer).toBeHidden()
  await expect(runtimeDialog).toBeVisible()
})

/**
 * 验证首次打开日志抽屉时，无需切换页签即可识别 PLC-Sim 已有输出。
 *
 * @param page 已安装多来源本地运行日志替身的浏览器页面。
 * @returns 完成日志抽屉首次快照与页签摘要验收。
 * @throws PLC-Sim 页签仍显示“暂无”或读取失败时由 Playwright 断言报告。
 * @safety 只读取固定日志来源，不启动、停止或修改本地运行进程。
 */
test('首次打开即展示未激活 PLC-Sim 页签的已有日志状态', async ({
  page
}) => {
  await page.goto('/')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await connectionBar.getByRole('button', { name: '查看日志' }).click()

  const logDrawer = page.getByRole('dialog', { name: '本地运行日志' })
  const plcTab = logDrawer.getByRole('tab', { name: /PLC-Sim/ })
  const edgeTab = logDrawer.getByRole('tab', { name: /Edge 运行时/ })
  await expect(edgeTab).toHaveAttribute('aria-selected', 'true')
  await expect(plcTab).toContainText('有输出')
  await expect(plcTab).toHaveAttribute('data-available', 'true')
})

/**
 * 验证未激活的 PLC-Sim 页签持续接收后台日志，并在切换后展示缓存内容。
 *
 * @param page 已安装延迟 PLC-Sim 输出场景的浏览器页面。
 * @returns 完成后台更新、页签摘要和切换内容一致性验收。
 * @throws 未激活来源停止刷新或切换后内容不一致时由 Playwright 断言报告。
 * @safety 日志替身只改变只读快照，不改变本地运行进程状态。
 */
test('未激活 PLC-Sim 页签持续刷新并缓存新增日志', async ({ page }) => {
  await page.goto('/?backgroundPlcLogs=1')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await connectionBar.getByRole('button', { name: '查看日志' }).click()

  const logDrawer = page.getByRole('dialog', { name: '本地运行日志' })
  const plcTab = logDrawer.getByRole('tab', { name: /PLC-Sim/ })
  const edgeTab = logDrawer.getByRole('tab', { name: /Edge 运行时/ })
  await expect(edgeTab).toHaveAttribute('aria-selected', 'true')
  await expect(plcTab).toContainText('暂无')
  await expect(plcTab).toContainText('有输出', { timeout: 5_000 })
  await expect(edgeTab).toHaveAttribute('aria-selected', 'true')

  await plcTab.click()
  await expect(logDrawer).toContainText('PLC-Sim 后台新增输出')
  await expect(plcTab).toHaveAttribute('aria-selected', 'true')
})

/**
 * 证明 PLC-Sim 折叠边界与常驻路径顺序在真实浏览器渲染中保持一致。
 *
 * @param page 已安装本地运行配置夹具的浏览器页面。
 * @returns 完成依赖顺序、折叠边界与窄屏布局验收。
 * @throws 任一配置项顺序、可见性或横向溢出不符合预期时由 Playwright 断言报告失败。
 */
test('本地运行配置按依赖顺序展示且仅折叠 PLC-Sim', async ({ page }) => {
  await page.goto('/?longRuntimePaths=1')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await connectionBar.getByRole('button', { name: '启动本地环境' }).click()

  const runtimeDialog = page.getByRole('dialog', {
    name: '领域侧 Edge（以 sz_lab 为例）'
  })
  const plcDetails = runtimeDialog.locator('details').filter({
    hasText: 'PLC-Sim（可选）'
  }).first()
  const environmentPath = runtimeDialog.locator('#runtime-environment-path')
  const osPath = runtimeDialog.locator('#runtime-os-path')
  const domainPath = runtimeDialog.locator('#runtime-szlab-path')
  const graphPath = runtimeDialog.locator('#runtime-graph-path')
  const simulatorPath = runtimeDialog.locator('#runtime-simulator-path')
  await expect(plcDetails).not.toHaveAttribute('open', '')
  for (const pathControl of [
    environmentPath,
    osPath,
    domainPath,
    graphPath
  ]) {
    await pathControl.scrollIntoViewIfNeeded()
    await expect(pathControl).toBeVisible()
  }
  await expect(simulatorPath).toBeHidden()

  expect(await runtimeDialog.locator([
    '#runtime-simulator-path',
    '#runtime-environment-path',
    '#runtime-os-path',
    '#runtime-szlab-path',
    '#runtime-graph-path'
  ].join(', ')).evaluateAll((elements) => (
    elements.map((element) => element.id)
  ))).toEqual([
    'runtime-simulator-path',
    'runtime-environment-path',
    'runtime-os-path',
    'runtime-szlab-path',
    'runtime-graph-path'
  ])
  expect(await plcDetails.locator([
    '#runtime-environment-path',
    '#runtime-os-path',
    '#runtime-szlab-path',
    '#runtime-graph-path'
  ].join(', ')).count()).toBe(0)
  await capture(page, '10-local-runtime-plc-collapsed.png')

  await plcDetails.locator('summary').click()
  await expect(plcDetails).toHaveAttribute('open', '')
  await expect(simulatorPath).toBeVisible()
  await capture(page, '11-local-runtime-plc-expanded.png')

  await page.setViewportSize({ width: 390, height: 844 })
  await environmentPath.scrollIntoViewIfNeeded()
  await expect(environmentPath).toBeVisible()
  await expect.poll(() => runtimeDialog.evaluate((element) => (
    element.scrollWidth <= element.clientWidth
  ))).toBe(true)
  await capture(page, '12-local-runtime-narrow-long-path.png')
})

/**
 * 验证高频增量刷新持续进入虚拟日志列表，同时保留用户查看长日志时的滚动位置。
 *
 * @param page 已安装增量日志夹具的浏览器页面。
 * @returns 完成自动跟随、暂停、新内容提示和一键恢复的界面验收。
 * @throws 任一滚动或刷新不变量失效时由 Playwright 断言报告失败。
 */
test('用户查看历史时持续刷新并保持阅读位置', async ({
  page
}) => {
  await page.goto('/?longLogs=1')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await connectionBar.getByRole('button', { name: '查看日志' }).click()

  const logDrawer = page.getByRole('dialog', { name: '本地运行日志' })
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
  await page.waitForTimeout(250)
  await capture(page, '01-log-tail-following.png')

  const rowsBeforePause = await logRowSetSize(logOutput)
  await logOutput.dispatchEvent('pointerdown', {
    pointerType: 'mouse',
    button: 0,
    isPrimary: true
  })
  const scrollTopBeforeRefresh = await logOutput.evaluate((element) => (
    element.scrollTop
  ))
  await capture(page, '02-user-scroll-started.png')

  await expect(page.getByText('已暂停自动跟随；日志仍每 2 秒刷新。'))
    .toBeVisible()
  await expect.poll(
    () => logRowSetSize(logOutput),
    { timeout: 5_000 }
  ).toBeGreaterThan(rowsBeforePause)
  const scrollTopAfterRefresh = await logOutput.evaluate(
    (element) => element.scrollTop
  )
  expect(Math.abs(scrollTopAfterRefresh - scrollTopBeforeRefresh))
    .toBeLessThanOrEqual(LOG_SCROLL_POSITION_TOLERANCE_PX)
  const newLogButton = logDrawer.getByRole('button', {
    name: '有新日志，回到底部'
  })
  await expect(newLogButton).toBeVisible()
  await capture(page, '03-new-logs-preserved-reading-position.png')

  const scrollTopWhileReading = await logOutput.evaluate((element) => {
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    element.scrollTop = Math.max(0, element.scrollTop - 240)
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
    return element.scrollTop
  })
  for (let refreshIndex = 0; refreshIndex < 3; refreshIndex += 1) {
    const rowsBeforeManualRefresh = await logRowSetSize(logOutput)
    await logDrawer.getByRole('button', { name: '刷新' }).click()
    await expect.poll(
      () => logRowSetSize(logOutput),
      { timeout: 5_000 }
    ).toBeGreaterThan(rowsBeforeManualRefresh)
  }
  const scrollTopAfterManualRefresh = await logOutput.evaluate(
    (element) => element.scrollTop
  )
  expect(Math.abs(scrollTopAfterManualRefresh - scrollTopWhileReading))
    .toBeLessThanOrEqual(LOG_SCROLL_POSITION_TOLERANCE_PX)
  await capture(page, '04-manual-refresh-preserved-reading-position.png')

  await newLogButton.click()
  await expect(newLogButton).toBeHidden()
  await expect.poll(
    () => logOutput.evaluate((element) => (
      element.scrollHeight - element.clientHeight - element.scrollTop
    ))
  ).toBeLessThanOrEqual(4)
  const rowsBeforeFollowResumed = await logRowSetSize(logOutput)
  await expect.poll(
    () => logRowSetSize(logOutput),
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
    name: '领域侧 Edge（以 sz_lab 为例）'
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
  await page.waitForTimeout(250)
  await capture(page, '06-log-drawer-narrow.png')
})

/**
 * 验证 PLC-Sim 与领域侧 Edge 的四种运行组合各自拥有独立、不串色的状态区域。
 *
 * @param page 已安装本地运行状态夹具的浏览器页面。
 * @returns 完成状态文字、背景色和前景色的组合验收。
 * @throws 任一进程状态或视觉颜色依赖相邻区域时由 Playwright 断言报告失败。
 */
test('PLC-Sim 与领域侧 Edge 按各自运行状态独立着色', async ({ page }) => {
  const scenarios = [
    { key: 'idle', plc: 'idle', edge: 'idle' },
    { key: 'plc', plc: 'running', edge: 'idle' },
    { key: 'edge', plc: 'idle', edge: 'running' },
    { key: 'both', plc: 'running', edge: 'running' }
  ] as const
  const visuals = new Map<string, {
    plc: { background: string; color: string }
    edge: { background: string; color: string }
  }>()

  for (const scenario of scenarios) {
    await page.goto(`/?runtimeStatus=${scenario.key}`)
    const connectionBar = page.getByRole('group', {
      name: 'Edge 连接配置'
    })
    await connectionBar.locator('button[data-runtime-phase]').click()
    const runtimeDialog = page.getByRole('dialog', {
      name: '领域侧 Edge（以 sz_lab 为例）'
    })
    const plcState = runtimeDialog.locator('[data-status]').filter({
      hasText: 'PLC-Sim'
    })
    const edgeState = runtimeDialog.locator('[data-status]').filter({
      hasText: '领域侧 Edge'
    })
    await expect(plcState).toHaveAttribute('data-status', scenario.plc)
    await expect(edgeState).toHaveAttribute('data-status', scenario.edge)
    visuals.set(scenario.key, {
      plc: await processVisualStyle(plcState),
      edge: await processVisualStyle(edgeState)
    })
  }

  const idle = visuals.get('idle')
  const plcOnly = visuals.get('plc')
  const edgeOnly = visuals.get('edge')
  const both = visuals.get('both')
  expect(idle).toBeDefined()
  expect(plcOnly).toBeDefined()
  expect(edgeOnly).toBeDefined()
  expect(both).toBeDefined()
  expect(plcOnly?.plc.background).not.toBe(plcOnly?.edge.background)
  expect(plcOnly?.plc.color).not.toBe(plcOnly?.edge.color)
  expect(edgeOnly?.edge.background).not.toBe(edgeOnly?.plc.background)
  expect(edgeOnly?.edge.color).not.toBe(edgeOnly?.plc.color)
  expect(plcOnly?.plc).toEqual(both?.plc)
  expect(edgeOnly?.edge).toEqual(both?.edge)
  expect(idle?.plc).toEqual(plcOnly?.edge)
  expect(idle?.edge).toEqual(edgeOnly?.plc)
  expect(idle?.plc.background).not.toBe('rgba(0, 0, 0, 0)')
})

test('大日志只挂载可视行并把内存窗口限制在两千行', async ({ page }) => {
  await page.goto('/?largeLogs=1')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await connectionBar.getByRole('button', { name: '查看日志' }).click()

  const logOutput = page.getByRole('list', { name: '格式化运行日志' })
  await expect.poll(() => logRowSetSize(logOutput)).toBe(2_000)
  expect(await logOutput.getByRole('listitem').count()).toBeLessThan(80)
  await page.waitForTimeout(250)
  await capture(page, '07-large-log-windowed.png')
})

test('长日志自动换行并完整展示末尾内容', async ({ page }) => {
  await page.goto('/?longLogs=1')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await connectionBar.getByRole('button', { name: '查看日志' }).click()

  const logOutput = page.getByRole('list', { name: '格式化运行日志' })
  const longMessage = logOutput.getByText(/完整日志末尾-UNILAB/)
  const longSource = logOutput.getByText(
    'unilabos.drivers.powder_feeder.material_flow'
  )
  await expect(longMessage).toBeVisible()
  await expect.poll(async () => longMessage.evaluate((element) => ({
    clippedHorizontally: element.scrollWidth > element.clientWidth + 1,
    clippedVertically: element.scrollHeight > element.clientHeight + 1,
    whiteSpace: getComputedStyle(element).whiteSpace
  }))).toEqual({
    clippedHorizontally: false,
    clippedVertically: false,
    whiteSpace: 'pre-wrap'
  })
  await expect.poll(async () => longSource.evaluate((element) => ({
    clippedHorizontally: element.scrollWidth > element.clientWidth + 1,
    clippedVertically: element.scrollHeight > element.clientHeight + 1
  }))).toEqual({
    clippedHorizontally: false,
    clippedVertically: false
  })

  const row = longMessage.locator('..')
  await expect.poll(async () => row.evaluate((element) => (
    element.getBoundingClientRect().height
  ))).toBeGreaterThan(28)
  const followingRow = logOutput.getByText('latest edge output').locator('..')
  await expect.poll(async () => {
    const [longBox, followingBox] = await Promise.all([
      row.boundingBox(),
      followingRow.boundingBox()
    ])
    return Boolean(
      longBox && followingBox
      && followingBox.y >= longBox.y + longBox.height - 1
    )
  }).toBe(true)
  await capture(page, '08-full-long-log-line.png')
})

/** 验证级别筛选作用于格式化记录，并持续接收符合条件的增量错误。 */
test('按状态筛选诊断日志并保留 traceback 完整上下文', async ({ page }) => {
  await page.goto('/?logFilters=1')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await connectionBar.getByRole('button', { name: '查看日志' }).click()

  const logDrawer = page.getByRole('dialog', { name: '本地运行日志' })
  const levelFilter = logDrawer.getByRole('combobox', {
    name: '日志级别筛选'
  })
  const logOutput = logDrawer.getByRole('list', { name: '格式化运行日志' })
  await levelFilter.selectOption('error')

  await expect(logOutput).not.toContainText('worker ready')
  await expect(logOutput).toContainText('Action failed')
  await expect(logOutput).toContainText('Traceback (most recent call last):')
  await expect(logOutput).toContainText('ValueError: invalid volume')
  await expect(logOutput).not.toContainText('latest edge output')
  await expect.poll(() => logRowSetSize(logOutput)).toBeGreaterThan(1)
  await capture(page, '10-log-level-filter-error.png')

  await levelFilter.selectOption('warning')
  await expect(logDrawer.getByText('没有符合 WARNING 条件的日志')).toBeVisible()
  await logDrawer.getByRole('button', { name: '清除筛选' }).click()
  await expect(levelFilter).toHaveValue('all')
  await expect(logOutput).toContainText('worker ready')
  await capture(page, '11-log-level-filter-cleared.png')
})

/** 证明大量可换行日志滚到末尾后，虚拟列表不会留下大块空白。 */
test('大量可换行日志末尾紧贴可视区域', async ({ page }) => {
  await page.goto('/?wrappedLargeLogs=1')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await connectionBar.getByRole('button', { name: '查看日志' }).click()

  const logOutput = page.getByRole('list', { name: '格式化运行日志' })
  await expect.poll(() => logRowSetSize(logOutput)).toBe(2_000)
  await logOutput.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })

  await expect.poll(async () => logOutput.evaluate((element) => {
    const rows = element.querySelectorAll<HTMLElement>('[role="listitem"]')
    const firstRow = rows.item(0)
    const lastRow = rows.item(rows.length - 1)
    const topGap = firstRow
      ? firstRow.getBoundingClientRect().top
        - element.getBoundingClientRect().top
      : Number.POSITIVE_INFINITY
    const visualGap = lastRow
      ? element.getBoundingClientRect().bottom
        - lastRow.getBoundingClientRect().bottom
      : Number.POSITIVE_INFINITY
    return {
      lastPosition: Number(lastRow?.getAttribute('aria-posinset') ?? 0),
      scrollGap: Math.round(
        element.scrollHeight - element.clientHeight - element.scrollTop
      ),
      topGapWithinLimit: topGap <= 40,
      visualGapWithinLimit: visualGap <= 40
    }
  })).toEqual({
    lastPosition: 2_000,
    scrollGap: 0,
    topGapWithinLimit: true,
    visualGapWithinLimit: true
  })
  await capture(page, '09-wrapped-large-log-tail.png')
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
    name: '领域侧 Edge（以 sz_lab 为例）'
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
  await logDrawer.getByRole('list', { name: '格式化运行日志' })
    .evaluate((element) => {
      element.scrollTop = 0
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
  await expect(logDrawer).toContainText('未安装 Arize Phoenix')
  await expect(logDrawer).toContainText('/api/v1/observability/otlp/v1/traces')
  await capture(page, '04-phoenix-source-logs.png')

  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(recoveryNotice).toBeVisible()
  await recoveryNotice.scrollIntoViewIfNeeded()
  await capture(page, '05-phoenix-recovery-narrow.png')
  expect(browserErrors.filter((message) => (
    !isExpectedMissingDeviceSocketError(message)
  ))).toEqual([])
})

/**
 * 识别本地运行日志夹具未提供设备状态 WebSocket 时的预期连接错误。
 *
 * @param message 浏览器控制台采集到的错误文本。
 * @returns 是否为固定设备状态地址的连接拒绝错误。
 * @throws 不抛出异常。
 * @safety 只忽略精确地址与 ERR_CONNECTION_REFUSED 组合，其他错误继续导致回归失败。
 */
function isExpectedMissingDeviceSocketError(message: string): boolean {
  return message.includes(
    "WebSocket connection to 'ws://127.0.0.1:18003/api/v1/ws/device_status'"
  ) && message.includes('ERR_CONNECTION_REFUSED')
}

/**
 * 在页面加载前安装确定性的本地运行 API 测试替身。
 *
 * @param page Playwright 页面，用于注入不同日志规模和故障场景。
 * @returns 完成初始化脚本注册后结束，不返回业务数据。
 */
async function installRuntimeApi(page: Page): Promise<void> {
  /** 在浏览器上下文中按 URL 场景生成稳定的增量日志。 */
  await page.addInitScript(() => {
    let logReadCount = 0
    const hasPhoenixMissing = (): boolean => (
      new URLSearchParams(window.location.search).has('phoenixMissing')
    )
    const hasLargeLogs = (): boolean => (
      new URLSearchParams(window.location.search).has('largeLogs')
    )
    const hasLongLogs = (): boolean => (
      new URLSearchParams(window.location.search).has('longLogs')
    )
    const hasWrappedLargeLogs = (): boolean => (
      new URLSearchParams(window.location.search).has('wrappedLargeLogs')
    )
    const hasLogFilters = (): boolean => (
      new URLSearchParams(window.location.search).has('logFilters')
    )
    /** 返回当前场景是否要求 PLC-Sim 在第二次后台读取时才产生输出。 */
    const hasBackgroundPlcLogs = (): boolean => (
      new URLSearchParams(window.location.search).has('backgroundPlcLogs')
    )
    const hasLongRuntimePaths = (): boolean => (
      new URLSearchParams(window.location.search).has('longRuntimePaths')
    )
    const runtimeStatusScenario = (): string | null => (
      new URLSearchParams(window.location.search).get('runtimeStatus')
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
    /**
     * 按浏览器场景生成 PLC-Sim 与领域侧 Edge 的独立进程状态快照。
     *
     * @returns 命中四种状态场景时返回快照，否则返回 null 继续使用普通夹具。
     * @throws 不抛出异常；未知查询值按未配置场景处理。
     */
    const scenarioSnapshot = () => {
      const scenario = runtimeStatusScenario()
      if (scenario === 'plc') {
        return {
          ...idleSnapshot,
          phase: 'simulator_ready' as const,
          message: 'PLC-Sim 运行中；领域侧 Edge 未启动',
          simulatorRunning: true
        }
      }
      if (scenario === 'edge') {
        return readySnapshot
      }
      if (scenario === 'both') {
        return {
          ...readySnapshot,
          message: 'PLC-Sim 与领域侧 Edge 已就绪',
          simulatorRunning: true,
          bridgeRunning: true
        }
      }
      return scenario === 'idle' ? idleSnapshot : null
    }
    // 该计数只描述 PLC-Sim 日志来源的读取次数，用于构造确定性的后台更新。
    let simulatorLogReadCount = 0
    const runtimeApi = {
      selectPath: async () => null,
      getDefaultEnvironmentPath: async () => hasLongRuntimePaths()
        ? '/tmp/a-very-long-workspace-name/conda/environments/unilab-runtime-with-a-long-name'
        : '/tmp/envs/unilab',
      getSnapshot: async () => scenarioSnapshot()
        ?? (hasPhoenixMissing() ? readySnapshot : idleSnapshot),
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
      /** 按固定来源返回当前日志增量，并为后台 PLC-Sim 场景推进只读快照。 */
      readLog: async (query: {
        kind: 'simulator' | 'bridge' | 'edge'
        cursor: { fileId: string; offset: number } | null
      }) => {
        logReadCount += 1
        if (query.kind === 'simulator') simulatorLogReadCount += 1
        const initial = query.cursor === null
        const lineCount = initial
          ? (hasLargeLogs() || hasWrappedLargeLogs() ? 2_600 : 84)
          : 4
        const start = initial ? 0 : query.cursor?.offset ?? 0
        const lines = Array.from(
          { length: lineCount },
          (_, index) => hasWrappedLargeLogs()
            ? (
                `26-08-04 [12:00:${String(start + index).padStart(2, '0')}] `
                + '[INFO] uvicorn.protocols.http.httptools_impl '
                + `[Uvicorn.HTTP] 127.0.0.1:64278 - "GET /api/v1/`
                + 'workflow-node-templates/'
                + `${String(start + index).padStart(4, '0')}-`
                + '425ac1b3-2457-4724-b04f-369a362992f3 '
                + 'HTTP/1.1" 200'
              )
            : (
                `26-08-04 [12:00:${String(start + index).padStart(2, '0')}] `
                + `[INFO] ${query.kind} line ${start + index}`
              )
        )
        if (query.kind === 'edge' && hasLogFilters()) {
          if (initial) {
            lines.splice(
              0,
              lines.length,
              '2026-08-04 12:01:30.000 | INFO | worker - worker ready',
              '2026-08-04 12:01:31.000 | ERROR | worker - Action failed',
              'Traceback (most recent call last):',
              '  File "worker.py", line 18, in run',
              'ValueError: invalid volume'
            )
          } else {
            lines.splice(
              0,
              lines.length,
              `2026-08-04 12:01:${String(logReadCount).padStart(2, '0')}.000 | ERROR | worker - incremental failure ${logReadCount}`
            )
          }
        }
        if (initial && query.kind === 'edge' && hasPhoenixMissing()) {
          lines.unshift(
            '[launcher] 2026-08-04T03:12:00.000Z starting',
            '26-08-04 [11:12:02,100] [ERROR] Phoenix trace 日志服务启动失败：未安装 Arize Phoenix',
            'POST /api/v1/observability/otlp/v1/traces HTTP/1.1 503 Service Unavailable'
          )
        }
        if (initial && query.kind === 'edge' && hasLongLogs()) {
          lines.push(
            '2026-08-04 12:01:30.000 | ERROR | '
            + 'unilabos.drivers.powder_feeder.material_flow - '
            + '粉末投料执行失败：设备返回的诊断详情包含多个寄存器状态、'
            + '请求参数与恢复建议，需要在日志抽屉中完整展示，不能使用省略号隐藏。'
            + '寄存器状态=' + 'A1B2C3D4'.repeat(20)
            + ' 完整日志末尾-UNILAB'
          )
        }
        if (query.kind === 'simulator' && hasBackgroundPlcLogs()) {
          if (simulatorLogReadCount === 1) {
            return {
              kind: query.kind,
              content: '',
              available: false,
              truncated: false,
              readAt: Date.now(),
              cursor: { fileId: 'e2e-simulator', offset: 0 },
              reset: true
            }
          }
          lines.splice(0, lines.length, 'PLC-Sim 后台新增输出')
        }
        if (query.kind === 'edge') lines.push('latest edge output')
        const offset = start + lineCount
        return {
          kind: query.kind,
          content: `${lines.join('\n')}\n`,
          available: true,
          truncated: false,
          readAt: Date.now(),
          cursor: { fileId: `e2e-${query.kind}`, offset },
          reset: initial
        }
      },
      openLogFile: async () => ({ opened: true }),
      onSnapshot: () => () => undefined
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { runtime: runtimeApi }
    })
  })
}

/** 返回窗口化列表声明的逻辑总行数，而不是当前挂载的 DOM 行数。 */
async function logRowSetSize(logOutput: Locator): Promise<number> {
  const value = await logOutput.getByRole('listitem').first()
    .getAttribute('aria-setsize')
  return Number(value ?? 0)
}

/**
 * 读取单个本地进程状态区域的最终背景色和文字色。
 *
 * @param processState PLC-Sim 或领域侧 Edge 的状态区域定位器。
 * @returns 浏览器计算后的不透明背景色与前景色。
 * @throws 元素不存在或浏览器求值失败时透传 Playwright 异常。
 */
async function processVisualStyle(processState: Locator): Promise<{
  background: string
  color: string
}> {
  return processState.evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      background: style.backgroundColor,
      color: style.color
    }
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
