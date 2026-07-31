import { expect, test } from '@playwright/test'

test('连接成功后持续展示已连接状态', async ({ page }) => {
  await page.route('**/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, data: { status: 'ok' } })
    })
  })

  await page.goto('/?enable=materialNav')
  await page.getByRole('button', { name: /物料/ }).click()

  const connectionBar = page.getByRole('group', {
    name: 'Edge 连接配置'
  })
  await expect(connectionBar).toHaveAttribute(
    'data-connection-state',
    'connected'
  )
  await expect(
    connectionBar.getByRole('status').getByText('Edge 已连接')
  ).toBeVisible()
})
