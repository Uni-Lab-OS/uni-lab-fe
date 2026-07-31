import { expect, test, type Page } from '@playwright/test'

test('工作流未保存时拦截模块切换与窗口关闭', async ({ page }) => {
  await page.goto('/?enable=materialNav')
  const navigation = page.getByRole('navigation', { name: '主导航' })
  const workflowButton = navigation.getByRole('button', { name: '工作流' })
  const materialButton = navigation.getByRole('button', { name: '物料' })
  const deviceButton = navigation.getByRole('button', { name: '仪器设备' })

  await workflowButton.click()
  await editWorkflow(page)

  let dismissedMessage = ''
  page.once('dialog', (dialog) => {
    dismissedMessage = dialog.message()
    void dialog.dismiss()
  })
  await materialButton.click()

  expect(dismissedMessage).toContain('工作流代码有未保存的修改')
  expect(dismissedMessage).toContain('切换到“物料”')
  await expect(workflowButton).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('完整控制流 DAG')).toBeVisible()

  const beforeUnloadPrevented = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    return {
      dispatchResult: globalThis.dispatchEvent(event),
      defaultPrevented: event.defaultPrevented
    }
  })
  expect(beforeUnloadPrevented).toEqual({
    dispatchResult: false,
    defaultPrevented: true
  })

  let acceptedDeviceMessage = ''
  page.once('dialog', (dialog) => {
    acceptedDeviceMessage = dialog.message()
    void dialog.accept()
  })
  await deviceButton.click()

  expect(acceptedDeviceMessage).toContain('切换到“仪器设备”')
  await expect(deviceButton).toHaveAttribute('aria-current', 'page')

  await workflowButton.click()
  await editWorkflow(page)

  let acceptedMaterialMessage = ''
  page.once('dialog', (dialog) => {
    acceptedMaterialMessage = dialog.message()
    void dialog.accept()
  })
  await materialButton.click()

  expect(acceptedMaterialMessage).toContain('切换到“物料”')
  await expect(materialButton).toHaveAttribute('aria-current', 'page')

  await editWorkflow(page)

  let acceptedWorkflowMessage = ''
  page.once('dialog', (dialog) => {
    acceptedWorkflowMessage = dialog.message()
    void dialog.accept()
  })
  await workflowButton.click()

  expect(acceptedWorkflowMessage).toContain('切换到“工作流”')
  await expect(workflowButton).toHaveAttribute('aria-current', 'page')
})

async function editWorkflow(page: Page) {
  const codeViewButton = page.getByRole('button', {
    name: '代码',
    exact: true
  })
  if (await codeViewButton.isVisible()) {
    await codeViewButton.click()
  }
  const editor = page.locator('.cm-content:visible')
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n ')
  await expect(
    page.locator('span:visible', { hasText: /^● 未保存$/ })
  ).toBeVisible()
}
