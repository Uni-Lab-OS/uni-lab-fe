import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from '@playwright/test'

const artifactDirectory = resolve(
  process.cwd(),
  'e2e-artifacts/new-unresolved-page'
)

test.beforeAll(() => mkdirSync(artifactDirectory, { recursive: true }))

test('试剂库存和目录可以在真实页面中翻页', async ({ page }) => {
  await page.goto('/new-unresolved-page-fixture.html?case=reagents')
  const inventory = page.getByTestId('inventory-page')
  const library = page.getByTestId('library-page')

  await expect(inventory.locator('tbody tr')).toHaveCount(20)
  await expect(inventory).not.toContainText('库存试剂 21')
  await inventory.getByRole('button', { name: '下一页' }).click()
  await expect(inventory.locator('tbody tr')).toHaveCount(1)
  await expect(inventory).toContainText('库存试剂 21')
  await expect(inventory).toContainText('第 2 / 2 页')

  await expect(library.locator('tbody tr')).toHaveCount(20)
  await expect(library).not.toContainText('目录试剂 21')
  await library.getByRole('button', { name: '下一页' }).click()
  await expect(library.locator('tbody tr')).toHaveCount(1)
  await expect(library).toContainText('目录试剂 21')
  await expect(library).toContainText('第 2 / 2 页')
  await page.screenshot({
    path: resolve(artifactDirectory, '01-reagent-pagination.png'),
    fullPage: true
  })
})

test('PLC-Sim 就绪后可以在页面提交 Windows 变量表路径', async ({ page }) => {
  await page.goto('/new-unresolved-page-fixture.html?case=plc')
  const dialog = page.getByRole('dialog', { name: '环境管理' })
  const input = dialog.getByLabel('PLC 变量表路径')
  const nextPath = 'D:\\Lab\\PLC-Sim\\updated-variables.csv'

  await expect(input).toBeEnabled()
  await input.fill(nextPath)
  await expect(dialog.getByRole('button', { name: '保存配置' })).toBeEnabled()
  await dialog.getByRole('button', { name: '保存配置' }).click()
  await expect(page.getByTestId('plc-saved')).toHaveText(nextPath)
  await page.screenshot({
    path: resolve(artifactDirectory, '02-plc-variable-table-ready.png'),
    fullPage: true
  })
})

test('同端口切换工作区会清除旧工作流加载状态', async ({ page }) => {
  await page.goto('/new-unresolved-page-fixture.html?case=workspace')
  await page.getByRole('button', { name: '选择工作流' }).click()
  const workflowLoading = page.getByText(
    '正在读取工作流 fixture-workflow',
    { exact: true }
  )
  await expect(workflowLoading).toBeVisible()

  await page.getByRole('button', { name: '切换工作区' }).click()
  await expect(page.getByLabel('当前工作区')).toHaveText(/workspace-b$/)
  await expect(workflowLoading).toHaveCount(0)
  await expect(page.getByRole('button', { name: '选择工作流' })).toBeVisible()
  await page.screenshot({
    path: resolve(artifactDirectory, '03-workspace-scope-reset.png'),
    fullPage: true
  })
})
