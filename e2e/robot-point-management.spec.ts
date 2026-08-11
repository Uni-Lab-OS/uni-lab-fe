import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

const API_URL = 'http://127.0.0.1:18004'
const artifactDirectory = resolve(
  process.env.UNILAB_E2E_ARTIFACT_DIR
    ?? resolve(process.cwd(), '../e2e-artifacts/full-interface-catalog/02-robot-points')
)

interface RobotPointDesignState {
  filename: string
  query: string
  heading: string
}

const DESIGN_STATES: readonly RobotPointDesignState[] = [
  { filename: '01-overview.png', query: 'drawer=0', heading: '机械臂点位管理' },
  { filename: '02-basic-information.png', query: 'step=basic', heading: '基本信息' },
  { filename: '03-coordinate-and-joints.png', query: 'step=coordinate', heading: '坐标与关节' },
  { filename: '04-motion-limits.png', query: 'step=motion', heading: '运动限制' },
  { filename: '05-site-binding.png', query: 'step=binding', heading: '库位绑定' },
  { filename: '06-validation-publish.png', query: 'step=validation', heading: '验证与发布' },
  { filename: '07-v13-draft.png', query: 'step=validation&version=ptlc-main%40v13-draft', heading: '验证与发布' },
  { filename: '08-binding-reference-error.png', query: 'step=binding&point=s04.p02.place.interact&dirty=1', heading: '库位绑定' }
]

test.beforeEach(async ({ page }) => {
  mkdirSync(artifactDirectory, { recursive: true })
  await installReadOnlyOsFixture(page)
})

/** 验证 8 个机械臂点位设计状态均来自正式 renderer 且可重复截图。 */
test('正式工作台覆盖机械臂点位管理的八个设计状态', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  for (const state of DESIGN_STATES) {
    await page.goto(
      `/?section=device&deviceView=robot-points&localOsUrl=${encodeURIComponent(API_URL)}&${state.query}`
    )
    await expect(page.getByRole('heading', { name: '机械臂点位管理' }))
      .toBeVisible()
    await expect(page.getByText('点位服务未接入 · 演示数据'))
      .toBeVisible()
    if (state.filename !== '01-overview.png') {
      await expect(page.getByRole('heading', { name: state.heading }).last())
        .toBeVisible()
    }
    if (state.filename === '08-binding-reference-error.png') {
      await expect(page.getByRole('alert')).toContainText('不在当前点位集中')
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(1600)
    await page.screenshot({
      path: join(artifactDirectory, state.filename),
      fullPage: true,
      animations: 'disabled'
    })
  }

  expect(browserErrors.filter((message) => (
    !isExpectedFixtureSocketError(message)
  ))).toEqual([])
})

/** 验证窄视口把点位编辑器提升为可关闭的全宽任务抽屉。 */
test('窄视口保持点位编辑步骤和返回路径可达', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 960 })
  await page.goto(
    `/?section=device&deviceView=robot-points&localOsUrl=${encodeURIComponent(API_URL)}&step=coordinate`
  )
  await expect(page.getByRole('complementary', { name: '编辑点位' }))
    .toBeVisible()
  await expect(page.getByRole('button', { name: '关闭编辑侧栏' }))
    .toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(720)
  await page.screenshot({
    path: join(artifactDirectory, 'mobile-01-coordinate-editor.png'),
    fullPage: true,
    animations: 'disabled'
  })
})

/**
 * 安装只读 Edge API 替身，避免点位界面向未启动服务发请求。
 *
 * @param page 当前 Playwright 页面。
 * @returns 所有只读路由注册完成后返回。
 * @safety 不接受任何写请求，也不创建工作流任务（WorkflowTask）。
 */
async function installReadOnlyOsFixture(page: Page): Promise<void> {
  await page.route(`${API_URL}/api/v1/health`, async (route) => {
    await route.fulfill({ json: { status: 'ok' } })
  })
  await page.route(`${API_URL}/api/v1/devices`, async (route) => {
    await route.fulfill({
      json: {
        code: 0,
        data: {
          schemaVersion: 'device-catalog/v1',
          source: 'edge',
          items: []
        }
      }
    })
  })
  await page.route(`${API_URL}/api/v1/workflow-node-templates**`, async (route) => {
    await route.fulfill({
      json: {
        code: 0,
        data: {
          authority: { authority_id: 'e2e-edge', kind: 'local' },
          catalog_fingerprint: `sha256:${'a'.repeat(64)}`,
          items: [],
          total: 0,
          page: 1,
          page_size: 100
        }
      }
    })
  })
  await page.route(`${API_URL}/api/v1/materials/graph`, async (route) => {
    await route.fulfill({
      json: { code: 0, data: { revision: 0, materials: [], placements: [] } }
    })
  })
  await page.route(`${API_URL}/api/v1/monitor/events**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'retry: 60000\n\n'
    })
  })
}

/**
 * 识别只因夹具未实现设备状态 WebSocket 而产生的预期连接错误。
 *
 * @param message 浏览器控制台错误文本。
 * @returns 是否严格匹配固定测试端口的 WebSocket 连接拒绝。
 */
function isExpectedFixtureSocketError(message: string): boolean {
  return message.includes(
    "WebSocket connection to 'ws://127.0.0.1:18004/api/v1/ws/device_status'"
  ) && message.includes('ERR_CONNECTION_REFUSED')
}
