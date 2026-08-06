const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { chromium } = require('@playwright/test')

const artifactDirectory = __dirname
const prototypeUrl = pathToFileURL(
  path.join(artifactDirectory, 'workflow-import-v2-list-drawer.html')
)
prototypeUrl.searchParams.set('variant', 'A')

/**
 * 在真实 Chromium 中验证工作流（Workflow）导入候选交互的公开行为。
 *
 * 参数：无；测试只通过可见文本、可访问角色、URL 与计算样式观察页面。
 * 返回：无；成功时写入桌面和窄屏截图，任一用户可见合同不满足时抛出断言错误。
 */
async function verifyWorkflowImportPrototype() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1
    })
    await page.goto(prototypeUrl.href)
    const activeVariant = page.locator('#variant-a')

    await page.getByRole('heading', { name: '工作流', exact: true }).waitFor()
    await page.getByRole('heading', { name: '导入工作流' }).waitFor()
    await activeVariant.getByText('s06_robot_workflow.py').waitFor()
    await activeVariant.getByText('检查通过，可创建新的工作流').waitFor()
    await activeVariant.getByText(
      '系统会为它重新分配标识，不会覆盖列表中的现有工作流。'
    ).waitFor()
    await page.getByRole('button', { name: '创建并打开' }).waitFor()

    assert.equal(
      await page.locator('.drawer-shade').evaluate((element) =>
        getComputedStyle(element).display
      ),
      'none',
      '右侧抽屉不应使用模态遮罩阻断工作流列表'
    )
    assert.equal(
      await activeVariant.getByText('S04 机械臂与磁搅联调').isVisible(),
      true,
      '导入预检期间应继续展示工作流列表'
    )
    assert.equal(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
        .test(await page.locator('body').innerText()),
      false,
      '普通导入界面不应向用户展示 UUID'
    )

    await page.screenshot({
      path: path.join(artifactDirectory, 'workflow-import-v2-e2e-desktop.png'),
      fullPage: true
    })

    await page.getByRole('button', { name: '下一方案' }).click()
    assert.equal(new URL(page.url()).searchParams.get('variant'), 'B')
    await page.getByText('选择或拖入工作流文件').waitFor()

    await page.getByRole('button', { name: '下一方案' }).click()
    assert.equal(new URL(page.url()).searchParams.get('variant'), 'C')
    await page.getByRole('heading', { name: '检查导入内容' }).waitFor()

    await page.setViewportSize({ width: 900, height: 760 })
    await page.goto(prototypeUrl.href)
    await page.getByRole('heading', { name: '导入工作流' }).waitFor()
    const prototypeBadgeBox = await page.locator('.prototype-badge').boundingBox()
    const drawerHeadingBox = await page
      .getByRole('heading', { name: '导入工作流' })
      .boundingBox()
    assert.ok(prototypeBadgeBox && drawerHeadingBox)
    assert.equal(
      prototypeBadgeBox.x + prototypeBadgeBox.width <= drawerHeadingBox.x ||
        drawerHeadingBox.x + drawerHeadingBox.width <= prototypeBadgeBox.x ||
        prototypeBadgeBox.y + prototypeBadgeBox.height <= drawerHeadingBox.y ||
        drawerHeadingBox.y + drawerHeadingBox.height <= prototypeBadgeBox.y,
      true,
      '窄屏下候选稿标识不应遮挡导入抽屉标题'
    )
    await page.screenshot({
      path: path.join(artifactDirectory, 'workflow-import-v2-e2e-narrow.png'),
      fullPage: true
    })

    process.stdout.write(
      'PASS 工作流导入候选交互：11 项公开行为断言通过，已生成 2 张截图。\n'
    )
  } finally {
    await browser.close()
  }
}

void verifyWorkflowImportPrototype().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
