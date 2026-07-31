import { expect, test } from '@playwright/test'

test('物料加载上下文失败时仍保留视图切换入口', async ({ page }) => {
  await page.goto('/?enable=materialNav')
  await page.getByRole('button', { name: /物料/ }).click()
  await page
    .getByRole('combobox', { name: '切换服务配置' })
    .selectOption({ label: 'Uni-Lab Cloud' })

  await expect(page.getByText('请选择实验室')).toBeVisible()
  const viewSwitcher = page.getByRole('group', {
    name: '实验室视图'
  })
  await expect(
    viewSwitcher.getByRole('button', { name: '2D' })
  ).toBeVisible()
  await expect(
    viewSwitcher.getByRole('button', { name: '2.5D' })
  ).toBeVisible()
  await expect(
    viewSwitcher.getByRole('button', { name: '3D' })
  ).toBeVisible()

  await viewSwitcher.getByRole('button', { name: '2.5D' }).click()
  await expect(page.locator('.lab-unified-viewport')).toHaveAttribute(
    'data-lab-view-mode',
    '2.5d'
  )

  await page.setViewportSize({ width: 900, height: 700 })
  await expect(viewSwitcher).toBeVisible()
  await expect(
    viewSwitcher.getByRole('button', { name: '3D' })
  ).toBeVisible()
})
