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

  test('takes a user from the workflow catalog to the preflight gate', async ({ page }) => {
    const browserErrors = attachBrowserDiagnostics(page)
    await page.goto('/workflows')
    await expect(page.getByRole('heading', { name: '工作流', exact: true })).toBeVisible()
    await page.waitForTimeout(500)
    const firstRow = page.locator('table tbody tr').first()
    test.skip(await firstRow.count() === 0, '后端没有工作流目录数据')
    const workflowName = await firstRow.getByRole('button').first().innerText()

    await firstRow.getByRole('button').first().click()
    await expect(page).toHaveURL(/\/workflows\?workflow=/)
    await expect(page.getByRole('heading', { name: workflowName, exact: true })).toBeVisible()
    await page.getByRole('button', { name: '调试工作流', exact: true }).click()
    await expect(page.getByText('填写运行参数', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '下一步：依赖检查', exact: true }).click()
    await expect(page.getByText('运行前检查', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '返回修改', exact: true })).toBeVisible()

    const submit = page.getByRole('button', { name: '提交任务', exact: true })
    if (await submit.isDisabled()) {
      await expect(page.getByText('当前不能提交', { exact: true })).toBeVisible()
    } else {
      await expect(submit).toBeEnabled()
    }
    expect(browserErrors).toEqual([])
  })

  test('opens a real task detail and returns to the task list', async ({ page }) => {
    const browserErrors = attachBrowserDiagnostics(page)
    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: '任务', exact: true })).toBeVisible()
    await page.waitForTimeout(500)
    const firstRow = page.locator('table tbody tr').first()
    test.skip(await firstRow.count() === 0, '后端没有任务记录')
    const taskName = await firstRow.getByRole('button').first().innerText()

    await firstRow.getByRole('button').first().click()
    await expect(page).toHaveURL(/\/tasks\?task=/)
    await expect(page.getByRole('heading', { name: taskName, exact: true })).toBeVisible()
    await expect(page.getByText('执行时间线', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '返回任务列表' })).toBeVisible()
    await page.getByRole('button', { name: '返回任务列表' }).click()
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('heading', { name: '任务', exact: true })).toBeVisible()
    expect(browserErrors).toEqual([])
  })

  test('keeps an unknown device action fail-closed in the debug journey', async ({ page }) => {
    const browserErrors = attachBrowserDiagnostics(page)
    await page.goto('/devices')
    await expect(page.getByRole('heading', { name: '设备', exact: true })).toBeVisible()
    await page.waitForTimeout(500)
    const firstRow = page.locator('table tbody tr').first()
    test.skip(await firstRow.count() === 0, '后端没有设备目录数据')

    await firstRow.getByRole('button').first().click()
    await expect(page.getByRole('button', { name: '调试动作', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '调试动作', exact: true }).click()
    await expect(page.getByText('调试模式：参数可编辑', { exact: true })).toBeVisible()
    await expect(page.getByText('设备可调度状态未知，不能执行动作。', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '发送调试命令', exact: true })).toBeDisabled()
    expect(browserErrors).toEqual([])
  })

  test('moves from the material graph into management and back', async ({ page }) => {
    const browserErrors = attachBrowserDiagnostics(page)
    await page.goto('/materials')
    await expect(page.getByRole('heading', { name: '物料', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '物料管理', exact: true }).click()
    await expect(page.getByRole('heading', { name: '物料管理', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '返回物料关系图', exact: true }).click()
    await expect(page.getByRole('heading', { name: '物料', exact: true })).toBeVisible()
    expect(browserErrors).toEqual([])
  })

  test('switches reagent inventory and catalog views with their search contracts', async ({ page }) => {
    const browserErrors = attachBrowserDiagnostics(page)
    await page.goto('/reagents')
    await expect(page.getByRole('heading', { name: '试剂', exact: true })).toBeVisible()

    const inventorySearch = page.getByPlaceholder('搜索库存、容器或 CAS')
    await expect(inventorySearch).toBeVisible()
    await inventorySearch.fill('乙醇')
    await inventorySearch.fill('')

    await page.getByRole('tab', { name: /目录/ }).click()
    const catalogSearch = page.getByPlaceholder('搜索名称或 CAS 号')
    await expect(catalogSearch).toBeVisible()
    await catalogSearch.fill('ethanol')
    await catalogSearch.fill('')
    await expect(page.getByRole('tab', { name: /库存/ })).toBeVisible()
    expect(browserErrors).toEqual([])
  })

  test('opens task node details and traverses every inspector tab', async ({ page }) => {
    const browserErrors = attachBrowserDiagnostics(page)
    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: '任务', exact: true })).toBeVisible()
    await page.waitForTimeout(500)
    const firstRow = page.locator('table tbody tr').first()
    test.skip(await firstRow.count() === 0, '后端没有任务记录')

    await firstRow.getByRole('button').first().click()
    await expect(page.getByText('执行时间线', { exact: true })).toBeVisible()
    const timelineRow = page.locator('button[data-status]').first()
    test.skip(await timelineRow.count() === 0, '任务没有可展示的 NodeJob')
    await timelineRow.click()

    const inspector = page.getByRole('complementary', { name: '节点详情' })
    await expect(inspector).toBeVisible()
    await expect(inspector.getByRole('heading', { name: '运行输入', exact: true })).toBeVisible()
    await inspector.getByRole('button', { name: '资源', exact: true }).click()
    await expect(inspector.getByText(/项待分配资源/)).toBeVisible()
    await inspector.getByRole('button', { name: '异常处置', exact: true }).click()
    await expect(inspector.getByText(/没有待处理异常|等待资源|需要人工确认|结果待核对/)).toBeVisible()
    await inspector.getByRole('button', { name: '执行锁', exact: true }).click()
    await expect(inspector.getByText(/当前不可直接释放执行锁|可释放执行锁|暂无执行锁快照/)).toBeVisible()
    await inspector.getByRole('button', { name: 'Trace / 日志', exact: true }).click()
    await expect(inspector.getByRole('heading', { name: '反馈事件', exact: true })).toBeVisible()
    expect(browserErrors).toEqual([])
  })
})
