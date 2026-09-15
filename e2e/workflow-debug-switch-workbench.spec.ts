import { expect, test } from '@playwright/test'

// Connect to a running SZLab desktop workbench; never save or execute workflows.
test.skip(!process.env.UNILAB_E2E_WORKBENCH_SWITCH, 'Requires a running SZLab workbench')

test('切换工作流保留列表与画布实例，并隔离节点内容', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let listRequests = 0
  page.on('request', request => {
    if (/\/api\/v1\/workflows\?/.test(request.url())) listRequests++
  })
  await page.goto('/')
  await page.getByText('工作流调试', { exact: true }).first().click()
  const panel = page.locator('.persistent-authoring--workflow-debug:visible')
  const select = async (name: string) => {
    await panel.getByRole('listitem').filter({ hasText: name }).click()
    await expect(panel.locator('.workflow-debug-toolbar__identity')).toContainText(name)
  }
  await select('S07 机械臂联调')
  await expect(panel.locator('.workflow-x6__viewport .x6-node').filter({ hasText: 'S072 放料' })).toBeVisible()
  const root = await panel.elementHandle()
  const library = await panel.locator('.persistent-authoring__library').elementHandle()
  const canvas = await panel.locator('.workflow-x6__viewport .x6-graph-svg').elementHandle()
  const ids = () => panel.locator('.workflow-x6__viewport .x6-node').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('data-cell-id')).sort()
  )
  const originalIds = await ids()
  const before = listRequests
  await select('S04 磁搅单工位调试')
  await expect.poll(ids).not.toEqual(originalIds)
  expect((await ids()).every(id => !originalIds.includes(id))).toBe(true)
  await select('S07 机械臂联调')
  await expect.poll(ids).toEqual(originalIds)
  expect(await root!.evaluate(element => element.isConnected)).toBe(true)
  expect(await library!.evaluate(element => element.isConnected)).toBe(true)
  expect(await canvas!.evaluate(element => element.isConnected)).toBe(true)
  expect(listRequests).toBe(before)
  expect(errors).toEqual([])
})

test('生成保存差异等待两秒时画布保持可见', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByText('工作流调试', { exact: true }).first().click()
  const panel = page.locator('.persistent-authoring--workflow-debug:visible')
  await panel.getByRole('listitem').filter({ hasText: 'S07 固体投料调试' }).click()
  const nodes = panel.locator('.workflow-x6__viewport .x6-node')
  await nodes.first().click()
  await panel.getByRole('textbox', { name: '节点名称', exact: true }).fill('save_preview_test')
  await panel.getByRole('textbox', { name: '节点名称', exact: true }).blur()
  const canvas = await panel.locator('.workflow-x6__viewport .x6-graph-svg').elementHandle()
  const count = await nodes.count()
  let delayed = false
  // 真实服务生成响应后，仅延迟交付；不伪造图、诊断或源码。
  await page.route('**/api/v1/authoring/generate-python', async route => {
    const response = await route.fetch()
    delayed = true
    await new Promise(resolve => setTimeout(resolve, 2200))
    await route.fulfill({ response })
  })
  const save = panel.getByRole('button', { name: '保存', exact: true })
  await save.click()
  await expect(save).toHaveAttribute('aria-busy', 'true')
  await expect.poll(() => delayed).toBe(true)
  for (let i = 0; i < 10; i++) {
    await expect(panel).toBeVisible()
    await expect(nodes).toHaveCount(count)
    await expect(nodes.first()).toBeVisible()
    expect(await canvas!.evaluate(element => element.isConnected)).toBe(true)
    await page.waitForTimeout(100)
  }
  const dialog = page.getByRole('dialog', { name: '完整 Python 差异' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(nodes).toHaveCount(count)
  expect(errors).toEqual([])
})
