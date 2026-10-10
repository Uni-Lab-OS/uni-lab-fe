import { expect, test } from '@playwright/test'
import { attachBrowserDiagnostics } from './helpers/browser-diagnostics'

test.describe('Developer Web user journeys', () => {
  test('uses the sidebar to move across the resource workbench', async ({ page }) => {
    const browserErrors = attachBrowserDiagnostics(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '总览', exact: true })).toBeVisible()

    await page.getByRole('button', { name: '物料', exact: true }).click()
    await expect(page.getByRole('heading', { name: '物料', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '试剂', exact: true }).click()
    await expect(page.getByRole('heading', { name: '试剂', exact: true })).toBeVisible()

    await page.getByRole('button', { name: '收起侧边栏' }).click()
    await expect(page.getByRole('button', { name: '展开侧边栏' })).toBeVisible()
    await page.getByRole('button', { name: '工作流', exact: true }).click()
    await expect(page.getByRole('heading', { name: '工作流', exact: true })).toBeVisible()
    expect(browserErrors).toEqual([])
  })

  test('keeps debug entry disabled until a workflow is selected', async ({ page }) => {
    const browserErrors = attachBrowserDiagnostics(page)
    await page.goto('/')
    const create = page.getByRole('button', { name: /新建调试/ })
    await expect(create).toBeVisible()
    await create.click()
    await page.getByText('调试工作流', { exact: true }).click()
    await expect(page.getByText('选择要调试的工作流', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '进入调试' })).toBeDisabled()
    expect(browserErrors).toEqual([])
  })

  test('supports deep link route resolution and browser back', async ({ page }) => {
    const browserErrors = attachBrowserDiagnostics(page)
    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: '任务', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '设备' }).click()
    await expect(page.getByRole('heading', { name: '设备', exact: true })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('heading', { name: '任务', exact: true })).toBeVisible()
    expect(browserErrors).toEqual([])
  })
})
