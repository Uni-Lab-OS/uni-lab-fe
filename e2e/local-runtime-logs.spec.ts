import { expect, test, type Locator, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await installRuntimeApi(page)
  await page.route('**/health', async (route) => {
    await route.fulfill({ json: { status: 'ok' } })
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
  await expect(edgeStatus).toContainText('Edge 已连接')

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
    name: '启动 SZLab 本地调试环境'
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
  const selectedTab = logDrawer.getByRole('tab', { name: /Edge 运行时/ })
  const inactiveTab = logDrawer.getByRole('tab', { name: /PLC-Sim/ })
  const tabList = logDrawer.getByRole('tablist', { name: '日志来源' })
  expect(
    await readContrastRatio(selectedTab.locator('small'), selectedTab)
  ).toBeGreaterThanOrEqual(4.5)
  expect(
    await readContrastRatio(inactiveTab.locator('small'), tabList)
  ).toBeGreaterThanOrEqual(4.5)
  const logOutput = logDrawer.getByText('latest edge output')
  await expect(logOutput).toBeVisible()
  await expect(logOutput).toHaveCSS('background-color', 'rgb(40, 44, 52)')
  await expect(logOutput).toHaveCSS('color', 'rgb(171, 178, 191)')
  await expect(logDrawer).not.toContainText('Bridge')

  await page.keyboard.press('Escape')
  await expect(logDrawer).toBeHidden()
  await expect(runtimeDialog).toBeVisible()
})

test('keeps the log drawer usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await connectionBar.getByRole('button', { name: '启动本地环境' }).click()
  const runtimeDialog = page.getByRole('dialog', {
    name: '启动 SZLab 本地调试环境'
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
  await expect(logDrawer.getByRole('tab', { name: /Edge 服务/ })).toBeVisible()
  await expect(logDrawer.getByRole('tab', { name: /Edge 运行时/ })).toBeVisible()
  await expect(logDrawer).toHaveCSS('width', '390px')
})

test('keeps Edge neutral when only PLC-Sim is running', async ({ page }) => {
  await page.goto('/?runtimeE2eState=simulator_ready')
  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await connectionBar.getByRole('button', { name: 'PLC-Sim 已启动' }).click()

  const runtimeDialog = page.getByRole('dialog', {
    name: '启动 SZLab 本地调试环境'
  })
  const plcStatus = runtimeDialog.locator('[data-status="running"]', {
    hasText: 'PLC-Sim'
  })
  const edgeStatus = runtimeDialog.locator('[data-status="idle"]', {
    hasText: 'SZLab Edge'
  })
  await expect(plcStatus).toBeVisible()
  await expect(edgeStatus).toBeVisible()

  const plcColor = await plcStatus.evaluate(
    (element) => globalThis.getComputedStyle(element).color
  )
  const edgeColor = await edgeStatus.evaluate(
    (element) => globalThis.getComputedStyle(element).color
  )
  expect(edgeColor).not.toBe(plcColor)
})

async function installRuntimeApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const simulatorReady = new URL(globalThis.location.href).searchParams
      .get('runtimeE2eState') === 'simulator_ready'
    const runtimeSnapshot = {
      phase: simulatorReady ? 'simulator_ready' as const : 'idle' as const,
      message: simulatorReady
        ? 'PLC-Sim 已就绪；请上传 PLC 变量表后再启动 SZLab Edge'
        : 'PLC-Sim 与 SZLab Edge 均未启动',
      simulatorRunning: simulatorReady,
      bridgeRunning: false,
      edgeRunning: false
    }
    const runtimeApi = {
      selectPath: async () => null,
      getDefaultEnvironmentPath: async () => '/tmp/envs/unilab',
      getSnapshot: async () => runtimeSnapshot,
      startSimulator: async () => runtimeSnapshot,
      stopSimulator: async () => runtimeSnapshot,
      startEdge: async () => runtimeSnapshot,
      stopEdge: async () => runtimeSnapshot,
      readLogs: async () => ({
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
            content: 'latest edge output',
            available: true,
            truncated: false
          }
        ]
      }),
      onSnapshot: () => () => undefined
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { runtime: runtimeApi }
    })
  })
}

/**
 * 读取文本与其实际背景的 WCAG 对比度。
 *
 * @param foreground 承载文字颜色的元素。
 * @param background 承载不透明背景色的元素。
 * @returns WCAG 相对亮度公式计算出的对比度。
 * @throws 当浏览器返回无法解析的颜色时抛出错误，避免无障碍回归被静默忽略。
 * @safety 仅读取计算样式，不修改页面或运行时状态。
 */
async function readContrastRatio(
  foreground: Locator,
  background: Locator
): Promise<number> {
  const foregroundColor = await foreground.evaluate(
    (element) => globalThis.getComputedStyle(element).color
  )
  const backgroundColor = await background.evaluate(
    (element) => globalThis.getComputedStyle(element).backgroundColor
  )
  const foregroundLuminance = relativeLuminance(parseRgb(foregroundColor))
  const backgroundLuminance = relativeLuminance(parseRgb(backgroundColor))
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * 将浏览器的 RGB 或 CSS Color 4 sRGB 颜色解析为三个 0–255 通道值。
 *
 * @param color 浏览器计算样式返回的 `rgb(...)`、`rgba(...)` 或 `color(srgb ...)` 字符串。
 * @returns 红、绿、蓝三个数值通道。
 * @throws 当颜色不是 RGB 格式时抛出错误。
 * @safety 仅解析本地字符串，不访问外部资源。
 */
function parseRgb(color: string): [number, number, number] {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3 || channels.some(Number.isNaN)) {
    throw new Error(`无法解析浏览器颜色：${color}`)
  }
  const scale = color.startsWith('color(srgb ') ? 255 : 1
  return [channels[0] * scale, channels[1] * scale, channels[2] * scale]
}

/**
 * 按 WCAG 2.1 将 sRGB 通道转换为相对亮度。
 *
 * @param rgb 红、绿、蓝三个 0–255 通道值。
 * @returns 0–1 范围内的相对亮度。
 * @throws 不主动抛出异常；调用方负责提供已校验的 RGB 通道。
 * @safety 只执行确定性的数值计算。
 */
function relativeLuminance(rgb: [number, number, number]): number {
  const [red, green, blue] = rgb.map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}
