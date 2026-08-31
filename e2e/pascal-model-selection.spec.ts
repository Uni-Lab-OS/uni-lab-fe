import { expect, type Page, test, type TestInfo } from '@playwright/test'

const workbenchUrl = process.env.UNILAB_WORKBENCH_URL

test.use({
  viewport: { width: 1990, height: 1250 },
  launchOptions: {
    args: [
      '--enable-webgl',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader-webgl'
    ]
  }
})

interface ModelSelectionCase {
  expectedName: string
  offsetX: number
  offsetY: number
  screenshotName: string
}

/**
 * 点击模型身体并验证右侧详情属于命中的物料（Material）。
 *
 * @param page Playwright 页面。
 * @param testInfo 当前测试的隔离输出目录。
 * @param anchor 标签定位产生的场景锚点。
 * @param selection 待验证的物料名称、相对坐标与截图名称。
 */
async function expectModelBodySelection(
  page: Page,
  testInfo: TestInfo,
  anchor: { x: number; y: number },
  selection: ModelSelectionCase
): Promise<void> {
  const modelPoint = {
    x: anchor.x + selection.offsetX,
    y: anchor.y + selection.offsetY
  }
  await expect
    .poll(() =>
      page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
        modelPoint
      )
    )
    .toBe('CANVAS')
  await page.mouse.click(modelPoint.x, modelPoint.y)

  const inspector = page.getByRole('dialog', { name: '物料属性' })
  await expect(inspector).toBeVisible()
  await expect(
    inspector.locator('.material-inspector__identity strong')
  ).toHaveText(selection.expectedName)
  await page.screenshot({
    path: testInfo.outputPath(selection.screenshotName),
    fullPage: true
  })
  await page.getByRole('button', { name: '关闭物料属性' }).click()
}

test('点击多个 TIP 盒身体后分别选择对应物料', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  await page.goto(workbenchUrl!, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000
  })
  await page.locator('.theia-preload').waitFor({
    state: 'detached',
    timeout: 120_000
  })
  const trustWorkspace = page.getByRole('button', {
    name: /是，我信任此作者/
  })
  if (await trustWorkspace.isVisible()) await trustWorkspace.click()
  await page.locator('#shell-tab-unilab\\:material-navigation').click()
  await page.getByTitle('3D 视图').click({ timeout: 30_000 })
  await page.locator('.pascal-model-label').first().waitFor({
    state: 'visible',
    timeout: 120_000
  })

  await page
    .getByRole('searchbox', { name: '检索物料、设备或库位' })
    .fill('L2C3 TIP 盒')
  await page
    .getByRole('button', {
      name: 'S1 上料过渡仓 L2C3 TIP 盒',
      exact: true
    })
    .click()
  const targetLabel = page
    .locator('.pascal-model-label')
    .filter({ hasText: 'S1 上料过渡仓 L2C3 TIP 盒' })
    .first()
  await targetLabel.waitFor({ state: 'visible' })
  const selectedLabel = await targetLabel.boundingBox()
  expect(selectedLabel).not.toBeNull()
  await expect(
    page.getByRole('dialog', { name: '物料属性' })
  ).toHaveCount(0)
  await page
    .getByRole('searchbox', { name: '检索物料、设备或库位' })
    .clear()
  await page.locator('.pascal-model-label').evaluateAll((labels) => {
    for (const label of labels) {
      const element = label as HTMLElement
      element.style.pointerEvents = 'none'
    }
  })

  const anchor = {
    x: selectedLabel!.x + selectedLabel!.width / 2,
    y: selectedLabel!.y + selectedLabel!.height / 2
  }
  const selections: ModelSelectionCase[] = [
    {
      expectedName: 'S1 上料过渡仓 L2C1 TIP 盒',
      offsetX: 0,
      offsetY: -150,
      screenshotName: 'pascal-model-pick-l2c1.png'
    },
    {
      expectedName: 'S1 上料过渡仓 L2C3 TIP 盒',
      offsetX: 80,
      offsetY: -150,
      screenshotName: 'pascal-model-pick-l2c3.png'
    },
    {
      expectedName: 'Tip 头架子 T32 TIP 盒',
      offsetX: 0,
      offsetY: -180,
      screenshotName: 'pascal-model-pick-t32.png'
    }
  ]

  for (const selection of selections) {
    await expectModelBodySelection(page, testInfo, anchor, selection)
  }
})
