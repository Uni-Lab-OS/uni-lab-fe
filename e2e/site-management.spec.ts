import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ARTIFACT_ROOT = resolve(
  process.cwd(),
  '..',
  'e2e-artifacts',
  'interfaces',
  'site-management'
)

/** 验证库位台账与异常处置原型保持同一稳定 Site 身份和失败关闭边界。 */
test('库位管理原型覆盖台账与异常处置方案', async ({ page }) => {
  mkdirSync(ARTIFACT_ROOT, { recursive: true })
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })

  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto('/?variant=A')

  await expect(page.getByRole('heading', { name: '库位管理' })).toBeVisible()
  await expect(page.getByRole('region', { name: '库位列表' })).toBeVisible()
  await expect(page.getByRole('note')).toContainText('只改变浏览器内存')
  await expect(page.getByText('3D', { exact: true })).toHaveCount(0)
  await expect(page.getByText('2.5D', { exact: true })).toHaveCount(0)

  const quarantine = page.getByRole('button', { name: '批量隔离' })
  await expect(quarantine).toBeDisabled()
  await page.getByLabel('选择库位 T21').check()
  await expect(quarantine).toBeEnabled()
  await quarantine.click()
  await expect(page.getByLabel('T21 库位检查器'))
    .toContainText('已隔离')

  await page.getByRole('tab', { name: '历史记录' }).click()
  await expect(page.getByRole('tab', { name: '历史记录' }))
    .toHaveAttribute('aria-selected', 'true')
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, 'site-management-list.png'),
    animations: 'disabled'
  })

  await page.goto('/?variant=B')
  await expect(page.getByRole('heading', { name: '库位异常处置' }))
    .toBeVisible()
  await expect(page.getByRole('region', { name: '处置摘要' })).toBeVisible()
  await expect(page.getByRole('region', { name: '异常库位列表' }))
    .toBeVisible()
  await expect(page.getByRole('button', { name: '全部需要关注' }))
    .toBeVisible()
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, 'site-management-triage.png'),
    animations: 'disabled'
  })

  await page.goto('/?view=space')
  await expect(page.getByRole('heading', { name: '库位管理' })).toBeVisible()
  await expect(page.getByText('3D', { exact: true })).toHaveCount(0)
  await expect(page.getByText('2.5D', { exact: true })).toHaveCount(0)

  expect(browserErrors).toEqual([])
})
