import { expect, test } from '@playwright/test'
import { attachBrowserDiagnostics } from './helpers/browser-diagnostics'
import {
  clearStationErrors,
  readStation,
  submitErrorWorkflowTask,
  waitForStationMode,
  waitForTaskError,
  waitForTaskStatus,
} from './helpers/station-error-handling-os'

/**
 * 工站异常处置的真实 OS 端到端验收。
 *
 * 运行前提：developer-web dev/preview 通过同源代理 `/__unilab_backend` 指向真实
 * local OS（OS 以真实动作模式连接 PLC-Sim）。这里既不 mock 路由，也不伪造状态：
 * 失败来自真实设备动作异常，终态只认 OS 的 Task/工站快照投影。
 *
 * 运行方式：
 *   UNILAB_FE_E2E_URL=http://127.0.0.1:4176 \
 *     npx playwright test e2e/developer-web-station-error-handling.spec.ts
 */
test.describe('工站异常处置（真实 OS）', () => {
  test.beforeEach(async ({ request }) => {
    // 同一工站一次只允许一条处置会话：每个用例必须自己把工站恢复到干净基线。
    await clearStationErrors(request)
  })

  test('失败节点给出处置入口，重试当前节点后任务完成、工站恢复调度', async ({
    page,
    request,
  }) => {
    const browserErrors = attachBrowserDiagnostics(page)

    const taskUuid = await submitErrorWorkflowTask(request, { failureCount: 1, delaySeconds: 1 })
    await waitForTaskError(request, taskUuid)

    await page.goto(`/tasks?task=${taskUuid}`)

    // 应用壳不再有常驻横幅；发现入口是首页指标卡，工站状态在异常处置标签里如实呈现。
    await page.getByRole('button', { name: /注入节点错误/ }).first().click()
    await page.getByRole('button', { name: '异常处置', exact: true }).click()

    // 时间线工具栏也有一个「取消任务」图标按钮，断言都限定在节点详情抽屉内。
    const drawer = page.getByRole('complementary', { name: '节点详情' })

    // 有待处置异常时标签必须自己带提示，用户不必先点开才知道。
    await expect(page.locator('button[data-alert="true"]')).toHaveCount(1)
    await expect(drawer.getByText('异常信息')).toBeVisible()
    await expect(drawer.getByRole('button', { name: '重试节点' })).toBeVisible()
    await expect(drawer.getByRole('button', { name: '取消任务' })).toBeVisible()

    // 摘要只放一行异常，多行堆栈必须折叠保留，不得铺进摘要区。
    const summaryBox = drawer.getByText('节点状态', { exact: true }).locator('..')
    await expect(summaryBox).toContainText('SZLAB_TEST_NODE_FAILURE')
    await expect(summaryBox).not.toContainText('Traceback (most recent call last)')
    await drawer.getByText(/OS 返回的完整错误信息/).click()
    await expect(drawer.locator('pre')).toContainText('Traceback (most recent call last)')

    // 节点决定只决定节点：不携带恢复意图，工站必须仍然暂停。
    await drawer
      .getByPlaceholder('记录现场检查情况，会进入操作记录')
      .fill('E2E：已核对现场，可重试')
    await drawer.getByRole('button', { name: '重试节点' }).click()

    // 工站仍暂停：重试的新尝试会停在 pending，必须先恢复调度才会派发。
    await waitForStationMode(request, 'PAUSED')
    await expect(drawer.getByText(/工站才会继续派发节点/)).toBeVisible()

    // 工站级事实留在标签页里：没有待处置错误后就地出现恢复入口，且要现场确认。
    await drawer.getByLabel('我已核对现场，确认可以恢复工站工作流调度').check()
    await drawer.getByRole('button', { name: '恢复工站调度' }).click()
    await waitForStationMode(request, 'RUNNING')

    // 恢复之后重试才真正执行，任务跑到终态。
    await waitForTaskStatus(request, taskUuid, ['succeeded'], 180_000)

    // 界面必须跟上权威状态：后继节点完成，进度到 100%。
    await expect(page.getByRole('button', { name: /完成错误处置测试/ }).first()).toContainText(
      '已完成',
      { timeout: 60_000 },
    )
    await expect(page.getByText('100%')).toBeVisible({ timeout: 60_000 })

    expect(browserErrors).toEqual([])
  })

  test('取消当前任务必须二次确认，取消后工站恢复调度', async ({ page, request }) => {
    const browserErrors = attachBrowserDiagnostics(page)

    const taskUuid = await submitErrorWorkflowTask(request, { failureCount: 1, delaySeconds: 1 })
    await waitForTaskError(request, taskUuid)

    await page.goto(`/tasks?task=${taskUuid}`)
    await page.getByRole('button', { name: /注入节点错误/ }).first().click()
    await page.getByRole('button', { name: '异常处置', exact: true }).click()
    const drawer = page.getByRole('complementary', { name: '节点详情' })
    await expect(drawer.getByRole('button', { name: '重试节点' })).toBeVisible()

    // 取消是不可撤销动作，必须先进入二次确认。
    await drawer.getByRole('button', { name: '取消任务' }).click()
    await expect(page.getByText(/确认取消？/)).toBeVisible()
    await drawer.getByRole('button', { name: '确认取消任务' }).click()

    await waitForTaskStatus(request, taskUuid, ['canceled'], 120_000)
    await waitForStationMode(request, 'PAUSED')

    await drawer.getByLabel('我已核对现场，确认可以恢复工站工作流调度').check()
    await drawer.getByRole('button', { name: '恢复工站调度' }).click()
    await waitForStationMode(request, 'RUNNING')

    expect(browserErrors).toEqual([])
  })

  test('任务已取消后，这条异常只提供关闭动作，不再提供重试或手动处理', async ({
    page,
    request,
  }) => {
    const browserErrors = attachBrowserDiagnostics(page)

    const taskUuid = await submitErrorWorkflowTask(request, { failureCount: 1, delaySeconds: 1 })
    await waitForTaskError(request, taskUuid)

    // 先用运行时命令把任务取消（日常“取消任务”入口），错误事实会留在工站里。
    const cancelled = await request.post(
      `${process.env.UNILAB_FE_E2E_URL ?? ''}/__unilab_backend/api/v1/workflow-tasks/${taskUuid}/commands`,
      { data: { type: 'cancel', idempotency_key: `e2e-cancel-${Date.now()}` } },
    )
    expect(cancelled.ok()).toBeTruthy()
    await waitForTaskStatus(request, taskUuid, ['canceled'], 120_000)

    await page.goto(`/tasks?task=${taskUuid}`)
    await page.getByRole('button', { name: /注入节点错误/ }).first().click()
    await page.getByRole('button', { name: '异常处置', exact: true }).click()
    const drawer = page.getByRole('complementary', { name: '节点详情' })

    // 终态任务不再提供重试/手动处理：那些动作不会再派发任何东西。
    await expect(drawer.getByText(/任务已结束/)).toBeVisible()
    await expect(drawer.getByRole('button', { name: '关闭异常事实' })).toBeVisible()
    await expect(drawer.getByRole('button', { name: '重试节点' })).toHaveCount(0)
    await expect(drawer.getByRole('button', { name: '手动处理' })).toHaveCount(0)

    await drawer.getByRole('button', { name: '关闭异常事实' }).click()
    await expect
      .poll(async () => (await readStation(request)).errors.filter((item) => item.status === 'open').length, {
        timeout: 60_000,
      })
      .toBe(0)

    // 关掉之后工站才能恢复调度，恢复入口就地出现。
    await expect(drawer.getByRole('button', { name: '恢复工站调度' })).toBeVisible()
    await drawer.getByLabel('我已核对现场，确认可以恢复工站工作流调度').check()
    await drawer.getByRole('button', { name: '恢复工站调度' }).click()
    await waitForStationMode(request, 'RUNNING')

    expect(browserErrors).toEqual([])
  })

  test('工站状态变化由实时失效通知驱动，不依赖轮询兜底', async ({ page, request }) => {
    const browserErrors = attachBrowserDiagnostics(page)

    // 页面先停在工站干净状态，随后才由别的入口制造失败。
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '总览', exact: true })).toBeVisible()

    const taskUuid = await submitErrorWorkflowTask(request, { failureCount: 1, delaySeconds: 1 })
    await waitForTaskError(request, taskUuid)

    // 兜底轮询间隔是 15s：8s 内出现只可能来自 station.error_handling.changed。
    // 总览不再有顶部横幅，工站状态由「异常」指标卡的提示行承担。
    await expect(page.getByText('工站调度已暂停').first()).toBeVisible({ timeout: 8_000 })
    await expect(page.getByRole('button', { name: '去处置' })).toBeVisible()
    expect(browserErrors).toEqual([])
  })

  test('节点决定不会顺带恢复调度，工站保持暂停并可从总览恢复', async ({ page, request }) => {
    const browserErrors = attachBrowserDiagnostics(page)

    const taskUuid = await submitErrorWorkflowTask(request, { failureCount: 1, delaySeconds: 1 })
    await waitForTaskError(request, taskUuid)

    await page.goto(`/tasks?task=${taskUuid}`)
    await page.getByRole('button', { name: /注入节点错误/ }).first().click()
    await page.getByRole('button', { name: '异常处置', exact: true }).click()
    // 取消只取消任务：工站继续暂停，恢复调度是独立的工站级人工决定。
    const drawer = page.getByRole('complementary', { name: '节点详情' })
    await drawer.getByRole('button', { name: '取消任务' }).click()
    await drawer.getByRole('button', { name: '确认取消任务' }).click()

    await waitForTaskStatus(request, taskUuid, ['canceled'], 120_000)
    const paused = await waitForStationMode(request, 'PAUSED')
    expect(paused.errors.filter((item) => item.status === 'open')).toHaveLength(0)

    // 工站级恢复调度只归属总览，入口收在「异常」指标卡里。
    await page.goto('/')
    await expect(page.getByText('工站调度已暂停').first()).toBeVisible()
    await page.getByRole('button', { name: '恢复调度' }).click()
    await expect(page.getByRole('dialog').getByText('工站调度已暂停')).toBeVisible()
    await page.getByText('我已核对现场，确认可以恢复工站工作流调度').click()
    await page.getByRole('button', { name: '恢复工站调度' }).click()

    await waitForStationMode(request, 'RUNNING')
    expect(browserErrors).toEqual([])
  })
})