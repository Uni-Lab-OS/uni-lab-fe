import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

const workbenchUrl = process.env.UNILAB_WORKBENCH_URL
const expectRealRuntimeLogs = process.env.UNILAB_EXPECT_REAL_RUNTIME_LOGS === '1'
const artifactDirectory = join(
  process.cwd(),
  'artifacts',
  'workbench-runtime-log-drawer'
)

test.describe('Workbench local runtime log drawer', () => {
  test.skip(!workbenchUrl, 'UNILAB_WORKBENCH_URL is required')

  /** 为本轮真实浏览器验收创建独立截图目录。 */
  test.beforeAll(async () => {
    await mkdir(artifactDirectory, { recursive: true })
  })

  /**
   * 验证真实 Workbench 会话可以打开日志抽屉、切换白名单来源并安全关闭。
   * @param page Playwright 提供的真实浏览器页面。
   * @returns 原版结构化日志文件抽屉完成桌面、筛选、悬停与窄屏验收。
   */
  test('opens, switches and closes the local runtime log drawer', async ({
    page
  }) => {
    test.setTimeout(expectRealRuntimeLogs ? 240_000 : 90_000)
    const pageErrors: string[] = []
    /** 收集页面脚本异常，确保日志读取失败不会逃逸成未处理错误。 */
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto(workbenchUrl!, { waitUntil: 'domcontentloaded' })
    const workbench = page.locator('.unilab-workbench').first()
    await expect(workbench).toBeVisible()
    await workbench.getByRole('button', { name: '运行日志' }).click()

    const drawer = page.getByRole('dialog', { name: '本地运行日志' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('tab', { name: /^OS/ }))
      .toHaveAttribute('aria-selected', 'true')
    await expect(drawer.getByRole('tab', { name: /Workspace Backend/ }))
      .toBeVisible()
    await expect(drawer.getByRole('tab', { name: /PLC-Sim/ })).toBeVisible()
    await expect(drawer.getByRole('tab', { name: /Agent/ })).toBeVisible()
    await expect(drawer.getByRole('button', { name: '打开日志文件' }))
      .toBeVisible()
    const logOutput = drawer.getByRole('list', { name: '格式化运行日志' })
    const readError = drawer.getByText(/^日志操作失败：/u)
    const emptyState = drawer.getByText(/暂时没有日志输出|尚未生成日志/u)
    await expect.poll(async () => {
      if (await readError.isVisible().catch(() => false)) return 'error'
      if (await logOutput.isVisible().catch(() => false)) return 'content'
      if (await emptyState.isVisible().catch(() => false)) return 'empty'
      return 'loading'
    }, { timeout: 25_000 }).toMatch(/^(?:content|empty|error)$/u)
    if (await readError.isVisible().catch(() => false)) {
      await expect(readError).toContainText(/\S/u)
    }
    if (await logOutput.isVisible().catch(() => false)) {
      const levelFilter = drawer.getByRole('combobox', {
        name: '日志级别筛选'
      })
      await expect(levelFilter).toBeVisible()
      await expect(levelFilter.locator('option[value="warning"]'))
        .toHaveText('WARNING')
      await expect(levelFilter.locator('option[value="error"]'))
        .toHaveText('ERROR')
      const firstMessage = logOutput.locator(
        '.unilab-runtime-log-drawer__message'
      ).first()
      await expect(firstMessage).toHaveAttribute('title', /\S/u)
    }
    await page.screenshot({
      path: join(artifactDirectory, '01-runtime-log-drawer-desktop.png'),
      fullPage: true
    })

    await drawer.getByRole('tab', { name: /Workspace Backend/ }).click()
    const refreshButton = drawer.getByRole('button', {
      name: '刷新',
      exact: true
    })
    await expect(refreshButton).toBeEnabled({ timeout: 25_000 })
    await refreshButton.click()

    if (expectRealRuntimeLogs) {
      const backendOutput = drawer.getByRole('list', {
        name: '格式化运行日志'
      })
      await expect(backendOutput).toBeVisible({ timeout: 90_000 })
      await expect.poll(
        /** 返回当前已经窗口化挂载的真实 Workspace Backend 日志行数。 */
        async () => backendOutput.getByRole('listitem').count(),
        { timeout: 90_000 }
      ).toBeGreaterThan(0)
      await page.screenshot({
        path: join(
          artifactDirectory,
          '03-real-startup-workspace-backend-logs.png'
        ),
        fullPage: true
      })

      const levelFilter = drawer.getByRole('combobox', {
        name: '日志级别筛选'
      })
      await levelFilter.selectOption('warning')
      const warningRows = backendOutput.locator('[data-level="warning"]')
      await expect.poll(
        /** 返回 WARNING 筛选后保留的真实启动告警行数。 */
        async () => warningRows.count(),
        { timeout: 30_000 }
      ).toBeGreaterThan(0)
      await warningRows.first().locator(
        '.unilab-runtime-log-drawer__message'
      ).hover()
      await page.screenshot({
        path: join(artifactDirectory, '04-real-startup-warning-filter.png'),
        fullPage: true
      })
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(drawer).toHaveCSS('width', '390px')
    await page.screenshot({
      path: join(artifactDirectory, '02-runtime-log-drawer-mobile.png'),
      fullPage: true
    })
    await drawer.getByRole('button', {
      name: '关闭本地运行日志',
      exact: true
    }).click()
    await expect(drawer).toBeHidden()
    expect(pageErrors).toEqual([])
  })
})
