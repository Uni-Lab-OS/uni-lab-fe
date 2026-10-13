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
    // 工作流详情页的运行入口标签是「运行」；「调试工作流」是总览「新建调试」菜单项。
    await page.getByRole('button', { name: '运行', exact: true }).click()
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

  test('keeps a non-dispatchable device action fail-closed in the debug journey', async ({ page }) => {
    const browserErrors = attachBrowserDiagnostics(page)
    // fail-closed 取决于设备的真实可调度状态：从设备列表里挑一个非 available 的设备，
    // 环境里全都是可调度设备时明确跳过，而不是假设列表首行恰好不可调度。
    const response = await page.request.get('/__unilab_backend/api/v1/devices')
    test.skip(!response.ok(), '需要连接真实 OS 设备列表')
    const payload = (await response.json()) as {
      data?: readonly {
        online?: boolean | null
        dispatchable?: boolean | null
        material?: { uuid?: string; name?: string }
      }[]
    }
    const candidates = (payload.data ?? []).filter((item) => item.material?.uuid)
    test.skip(candidates.length === 0, '后端没有设备目录数据')
    const blocked = candidates.find(
      (item) =>
        item.online === false ||
        item.dispatchable === false ||
        item.online == null ||
        item.dispatchable == null,
    )
    test.skip(!blocked, '当前环境所有设备都可调度，fail-closed 分支无法在此环境验证')

    const expected =
      blocked?.online === false
        ? '设备当前不在线，不能执行动作。'
        : blocked?.dispatchable === false
          ? '设备当前不可调度，不能执行动作。'
          : '设备可调度状态未知，不能执行动作。'

    await page.goto(`/devices?debugDevice=${encodeURIComponent(String(blocked?.material?.uuid))}`)
    await page.getByRole('button', { name: '调试动作', exact: true }).click()
    await expect(page.getByText('调试模式：参数可编辑', { exact: true })).toBeVisible()
    await expect(page.getByText(expected, { exact: true })).toBeVisible()
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
    // 时间线是异步投影：等它真正渲染出行，而不是用固定 sleep 决定是否跳过。
    const hasTimeline = await timelineRow
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    test.skip(!hasTimeline, '任务没有可展示的 NodeJob')
    await timelineRow.click()

    const inspector = page.getByRole('complementary', { name: '节点详情' })
    await expect(inspector).toBeVisible()
    await expect(inspector.getByRole('heading', { name: '运行输入', exact: true })).toBeVisible()
    await inspector.getByRole('button', { name: '资源', exact: true }).click()
    await expect(inspector.getByText(/项待分配资源/)).toBeVisible()
    await inspector.getByRole('button', { name: '异常处置', exact: true }).click()
    // 异常处置标签页必须如实说明这个节点的状态，不能留空；状态文案是唯一权威。
    await expect(inspector.getByText('节点状态', { exact: true }).first()).toBeVisible()
    await expect(
      inspector
        .getByText(
          /这个节点没有异常|这个节点存在待处置的异常事实|节点正在执行|等待资源|需要人工确认|结果待核对|节点执行失败|可做的处置/,
        )
        .first(),
    ).toBeVisible()
    // 执行锁标签带数量角标，可访问名是「执行锁 N」，不能用 exact 匹配。
    await inspector.getByRole('button', { name: /执行锁/ }).click()
    await expect(
      inspector.getByText(/当前不可直接释放执行锁|可释放执行锁|暂无执行锁快照/).first(),
    ).toBeVisible()
    await inspector.getByRole('button', { name: 'Trace / 日志', exact: true }).click()
    await expect(inspector.getByRole('heading', { name: '反馈事件', exact: true })).toBeVisible()
    expect(browserErrors).toEqual([])
  })
})
