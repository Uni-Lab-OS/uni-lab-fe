import { expect, test, type Page } from '@playwright/test'

const workbenchUrl = process.env.UNILAB_WORKBENCH_URL

test.use({
  viewport: { width: 2048, height: 1024 },
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

/**
 * 打开物料（Material）工作台的 3D 视图。
 *
 * @param page 当前浏览器页面。
 * @returns 页面完成 3D 视图切换后结束，不返回额外值。
 */
async function openMaterial3dView(page: Page): Promise<void> {
  await page.goto(workbenchUrl!, {
    waitUntil: 'domcontentloaded',
    timeout: 120_000
  })
  await page.locator('.theia-preload').waitFor({
    state: 'detached',
    timeout: 120_000
  })

  const materialTab = page.locator(
    '#shell-tab-unilab\\:material-navigation'
  )
  if (await materialTab.isVisible()) {
    await materialTab.click()
  } else {
    const materialNavigationButton = page.getByRole('button', {
      name: '物料',
      exact: true
    }).first()
    if (await materialNavigationButton.isVisible()) {
      await materialNavigationButton.click()
    } else {
      await page.mouse.click(24, 179)
    }
  }
  await page.getByTitle('3D 视图').click({ timeout: 30_000 })
}

/**
 * 在标签实际可见且未被其他投影标签覆盖的区域中寻找点击点。
 *
 * @param label 当前要选择的 Pascal 物料（Material）标签。
 * @returns 页面坐标；标签完全被遮挡或吞掉指针事件时返回 null。
 */
async function findHittableLabelPoint(
  label: ReturnType<Page['locator']>
): Promise<{ x: number, y: number } | null> {
  return label.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    for (let y = bounds.top + 2; y < bounds.bottom - 1; y += 2) {
      for (let x = bounds.left + 2; x < bounds.right - 1; x += 2) {
        const hit = document.elementFromPoint(x, y)
        if (hit === element || element.contains(hit)) return { x, y }
      }
    }
    return null
  })
}

test.describe('Pascal 3D 物料标签选择', () => {
  test.skip(!workbenchUrl, 'UNILAB_WORKBENCH_URL is required')

  /** 点击可见标签必须选中其稳定场景身份对应的物料（Material）。 */
  test('点击 S08 标签后展示 S08 物料详情', async ({ page }) => {
    test.setTimeout(150_000)
    await openMaterial3dView(page)

    const targetMaterialName = 'S08开关盖工位仓'
    const targetLabel = page.locator('.pascal-model-label').filter({
      hasText: targetMaterialName
    }).first()
    await expect(targetLabel).toBeVisible({ timeout: 120_000 })
    const targetLabelPoint = await findHittableLabelPoint(targetLabel)
    expect(targetLabelPoint).not.toBeNull()
    await page.mouse.click(targetLabelPoint!.x, targetLabelPoint!.y)

    const inspector = page.getByRole('dialog', { name: '物料属性' })
    await expect(inspector).toBeVisible()
    await expect(
      inspector.locator('.material-inspector__identity strong')
    ).toHaveText(targetMaterialName)
  })
})
