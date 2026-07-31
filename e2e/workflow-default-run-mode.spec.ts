import { expect, test, type Page } from '@playwright/test'

import { startOfflineLocalBridge } from './helpers/offline-local-bridge'

test('物料与工作流页面默认使用整图运行', async ({ page }) => {
  const bridge = await startOfflineLocalBridge(0)

  try {
    await page.goto(
      `/?localOsUrl=${encodeURIComponent(bridge.url)}&enable=materialNav`
    )

    await page.getByText('物料', { exact: true }).first().click()
    await expectDefaultFullRun(page)

    await page.getByText('工作流', { exact: true }).first().click()
    await expectDefaultFullRun(page)
  } finally {
    await bridge.stop()
  }
})

async function expectDefaultFullRun(page: Page): Promise<void> {
  await expect(
    page.getByRole('button', { name: '整图运行', exact: true })
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('button', { name: '整图执行：开始运行' })
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: '调试运行', exact: true })
  ).toHaveAttribute('aria-pressed', 'false')
}
