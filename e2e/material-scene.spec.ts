import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CORE_ROOT = resolve(process.cwd(), '..')
const OS_ROOT = resolve(
  process.env.UNILAB_E2E_OS_ROOT ?? join(CORE_ROOT, 'Uni-Lab-OS')
)
const SZLAB_ROOT = resolve(
  process.env.UNILAB_E2E_SZLAB_ROOT ?? join(CORE_ROOT, 'Uni-Lab-SZLab')
)
const SZLAB_GRAPH = process.env.UNILAB_E2E_SZLAB_GRAPH ??
  'deployment/graphs/szlab-local-debug.json'
const OS_PYTHON =
  process.env.UNILAB_OS_PYTHON ??
  'python3'
const API_PORT = Number(process.env.UNILAB_E2E_MATERIAL_PORT ?? '18144')
const API_URL =
  process.env.UNILAB_E2E_OS_URL ?? `http://127.0.0.1:${API_PORT}`
const EXPECTED_MATERIAL_COUNT = Number(
  process.env.UNILAB_E2E_MATERIAL_COUNT ?? '131'
)
const EXPECTED_SITE_COUNT = Number(
  process.env.UNILAB_E2E_SITE_COUNT ?? '418'
)
const EXPECTED_OCCUPIED_SITE_COUNT = Number(
  process.env.UNILAB_E2E_OCCUPIED_SITE_COUNT ?? '110'
)
const EXPECTED_OBLIQUE_SITE_COUNT = Number(
  process.env.UNILAB_E2E_OBLIQUE_SITE_COUNT ?? '130'
)
const EXPECTED_TRANSFER_ROUTE_COUNT = Number(
  process.env.UNILAB_E2E_TRANSFER_ROUTE_COUNT ?? '5'
)
const FE_ORIGIN = process.env.UNILAB_FE_E2E_URL ?? 'http://127.0.0.1:4173'
const ARTIFACT_ROOT = resolve(
  CORE_ROOT,
  'e2e-artifacts',
  'materials',
  'szlab-inventory'
)
const MATERIAL_TRANSFER_WORKFLOW_UUID =
  '6d9fb3e2-4dcb-5f23-93b4-74d1b6083393'

interface InventoryProcess {
  child?: ChildProcess
  workingDirectory?: string
}

let inventory: InventoryProcess

test.describe.configure({ mode: 'serial' })
test.use({
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

test.beforeAll(async () => {
  test.setTimeout(120_000)
  mkdirSync(ARTIFACT_ROOT, { recursive: true })
  inventory = await startSzlabInventory()
})

test.afterAll(async () => {
  await stopProcess(inventory?.child)
  if (inventory?.workingDirectory) {
    rmSync(inventory.workingDirectory, { recursive: true, force: true })
  }
})

/**
 * 验证真实 SZLab 物料图在 2D、2.5D 与 3D 间切换，并覆盖 2.5D 缩放和旋转。
 * 输入来自真实 OS 物料图接口，输出检查对象、库位（Site）、视角状态与截图。
 */
test('SZLab MaterialGraph renders complete 2.5D and 3D views', async ({
  page
}) => {
  // 有界面 SwiftShader 是当前 Linux CI 中唯一能提供 WebGL 的后端；首次
  // 2.5D 截图和 3D 场景初始化会共享软件渲染预算，不能沿用纯 2D 超时。
  test.setTimeout(300_000)
  const browserErrors: string[] = []
  // ``browserRequests`` 证明物料（Material）模型加载未逃逸到 local_bridge。
  const browserRequests: string[] = []
  const materialRequests: string[] = []
  // ``materialModelStatuses`` 保留每个 OS 公开模型资产的 HTTP 结果。
  const materialModelStatuses: number[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('request', (request) => {
    browserRequests.push(request.url())
    if (request.url().startsWith(`${API_URL}/api/v1/`)) {
      materialRequests.push(`${request.method()} ${request.url()}`)
    }
  })
  page.on('response', (response) => {
    if (response.url().startsWith(`${API_URL}/api/v1/material-models/`)) {
      materialModelStatuses.push(response.status())
    }
  })
  await page.addInitScript(() => {
    const modelWindow = window as unknown as {
      __unilabModelReadyCount?: number
    }
    modelWindow.__unilabModelReadyCount = 0
    window.addEventListener('unilab:pascal-model-ready', () => {
      modelWindow.__unilabModelReadyCount =
        (modelWindow.__unilabModelReadyCount ?? 0) + 1
    })
  })

  await installMaterialOnlyLayout(page)
  const graphLoaded = page.waitForResponse(
    (response) =>
      response.url() === `${API_URL}/api/v1/materials/graph` &&
      response.status() === 200
  )
  const shapesLoaded = page.waitForResponse(
    (response) =>
      response.url() === `${API_URL}/api/v1/material-shapes` &&
      response.status() === 200
  )
  await page.goto(
    `/?section=material&localOsUrl=${encodeURIComponent(API_URL)}`
  )
  const [graphResponse, shapeResponse] = await Promise.all([
    graphLoaded,
    shapesLoaded
  ])
  const graphPayload = (await graphResponse.json()) as {
    data?: {
      nodes?: Array<{
        sites?: Array<{ occupied_material_uuid?: string | null }>
      }>
    }
  }
  const graphSites =
    graphPayload.data?.nodes?.flatMap((node) => node.sites ?? []) ?? []
  expect(graphPayload.data?.nodes).toHaveLength(EXPECTED_MATERIAL_COUNT)
  expect(graphSites).toHaveLength(EXPECTED_SITE_COUNT)
  expect(
    graphSites.filter((site) => site.occupied_material_uuid != null)
  ).toHaveLength(EXPECTED_OCCUPIED_SITE_COUNT)
  expect(
    graphSites.filter((site) => site.occupied_material_uuid == null)
  ).toHaveLength(EXPECTED_SITE_COUNT - EXPECTED_OCCUPIED_SITE_COUNT)
  const shapePayload = (await shapeResponse.json()) as {
    data?: { items?: unknown[] }
  }
  expect(shapePayload.data?.items?.length ?? 0).toBeGreaterThanOrEqual(12)

  await expect(
    page.getByRole('button', { name: '物料', exact: true })
  ).toBeVisible()
  await expect(
    page.getByText(`(${EXPECTED_MATERIAL_COUNT})`, { exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole('status').filter({ hasText: 'Edge 已连接' })
  ).toBeVisible()

  await expandMaterial(page, 'S1 连续流工作站')
  await expandMaterial(page, 'SZLab 聚合物工作站台面')
  await expandMaterial(page, '烧杯堆栈2')
  await expect(
    page.locator(
      '[data-material-tree-site-id] [data-site-occupancy="occupied"]'
    )
  ).toHaveCount(36)
  await expect(
    page.locator('[data-material-tree-site-id]').filter({
      hasText: '烧杯堆栈2 L1B1 烧杯 500 mL'
    })
  ).toHaveAttribute('data-material-tree-site-id', /.+/)
  await captureMaterialTree(page, 'szlab-material-tree-occupied.png')
  await page
    .getByRole('button', { name: '收起 烧杯堆栈2' })
    .click()

  await expandMaterial(page, 'Tip 头架子')
  await expandMaterial(page, 'Tip 头架子 T11 TIP 盒')
  await expect(
    page.locator(
      '[data-material-tree-site-id][data-site-occupancy="empty"]'
    )
  ).toHaveCount(24)
  await expect(
    page.getByRole('treeitem', { name: 'T11-tip-101，未占用' })
  ).toBeVisible()
  await page
    .getByRole('treeitem', { name: 'T11-tip-101，未占用' })
    .evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await captureMaterialTree(page, 'szlab-material-tree-empty.png')

  const siteLayerToggle = page.getByRole('button', {
    name: '库位和点位',
    exact: true
  })
  await expect(siteLayerToggle).toHaveAttribute('aria-pressed', 'true')
  const twoDimensionalCanvas = page.locator('.material-canvas').first()
  await expect(twoDimensionalCanvas).toHaveAttribute(
    'data-site-layer-visible',
    'true'
  )
  await siteLayerToggle.click()
  await expect(twoDimensionalCanvas).toHaveClass(/is-sites-hidden/)
  await expect(twoDimensionalCanvas).toHaveAttribute(
    'data-site-layer-visible',
    'false'
  )
  await siteLayerToggle.click()
  await expect(twoDimensionalCanvas).not.toHaveClass(/is-sites-hidden/)

  await page.getByRole('button', { name: '2.5D', exact: true }).click()
  const oblique = page.locator('[data-material-oblique-view]')
  await expect(oblique).toBeVisible()
  await expect(oblique.locator('[data-material-id]')).toHaveCount(
    EXPECTED_MATERIAL_COUNT
  )
  await expect(oblique.locator('[data-oblique-site-bounds]')).toHaveCount(
    EXPECTED_OBLIQUE_SITE_COUNT
  )
  await expect(
    oblique.locator('[data-oblique-site-bounds][data-site-occupancy="occupied"]')
  ).toHaveCount(EXPECTED_OCCUPIED_SITE_COUNT)
  await expect(
    oblique.locator('[data-oblique-site-bounds][data-site-occupancy="empty"]')
  ).toHaveCount(
    EXPECTED_OBLIQUE_SITE_COUNT - EXPECTED_OCCUPIED_SITE_COUNT
  )
  await expect(
    oblique.locator('[data-oblique-render-style="spec"]').first()
  ).toBeVisible()
  await captureViewport(page, 'szlab-materials-2_5d.png')

  const zoomIn = page.getByRole('button', {
    name: '放大 2.5D 视图'
  })
  const fitAll = page.getByRole('button', { name: '适应全部物料' })
  await expect(zoomIn).toBeEnabled()
  await expect(fitAll).toBeEnabled()
  await zoomIn.click()
  await expect(oblique).toHaveAttribute('data-camera-zoom', '1.25')
  await expect(
    page.getByRole('status', { name: '当前缩放比例' })
  ).toHaveText('125%')
  await captureViewport(page, 'szlab-materials-2_5d-zoomed.png')
  await fitAll.click()
  await expect(oblique).toHaveAttribute('data-camera-zoom', '1.00')

  const obliqueBounds = await oblique.boundingBox()
  expect(obliqueBounds).not.toBeNull()
  if (!obliqueBounds) throw new Error('2.5D 视图缺少可交互区域')
  await page.mouse.move(
    obliqueBounds.x + obliqueBounds.width / 2,
    obliqueBounds.y + obliqueBounds.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    obliqueBounds.x + obliqueBounds.width / 2 + 120,
    obliqueBounds.y + obliqueBounds.height / 2,
    { steps: 6 }
  )
  await page.mouse.up()
  await expect(oblique).toHaveAttribute(
    'data-camera-rotation',
    /-?(?:[1-9]\d*(?:\.\d+)?|0\.\d*[1-9]\d*)/
  )

  await siteLayerToggle.click()
  await expect(siteLayerToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(oblique).toHaveAttribute('data-site-layer-visible', 'false')
  await expect(oblique.locator('[data-oblique-site-bounds]')).toHaveCount(0)
  await captureViewport(page, 'szlab-materials-2_5d-sites-hidden.png')

  await page.getByRole('button', { name: '3D', exact: true }).click()
  await expect(page.locator('.lab-unified-viewport')).toHaveAttribute(
    'data-site-layer-visible',
    'false'
  )
  await siteLayerToggle.click()
  await expect(siteLayerToggle).toHaveAttribute('aria-pressed', 'true')
  const viewer = page.locator('[data-pascal-viewer-3d]')
  await expect(viewer).toBeVisible({ timeout: 30_000 })
  const viewerCanvas = viewer.locator('canvas')
  await expect(viewerCanvas).toBeVisible()
  await expect(viewerCanvas.locator('..').locator('..')).toHaveClass(
    /bg-\[#fafafa\]/
  )
  await expect(
    page.getByText(`${EXPECTED_MATERIAL_COUNT} 个物料 · 只读`)
  ).toBeVisible()
  const viewerBox = await viewer.boundingBox()
  expect(viewerBox?.width ?? 0).toBeGreaterThan(900)
  expect(viewerBox?.height ?? 0).toBeGreaterThan(500)
  await page.waitForFunction(
    () =>
      ((window as unknown as { __unilabModelReadyCount?: number })
        .__unilabModelReadyCount ?? 0) > 0,
    undefined,
    { timeout: 60_000 }
  )
  await captureViewport(page, 'szlab-materials-3d.png')

  expect(materialRequests).toContain(
    `GET ${API_URL}/api/v1/materials/graph`
  )
  expect(materialRequests).toContain(
    `GET ${API_URL}/api/v1/material-shapes`
  )
  expect(materialRequests).toContain(
    `GET ${API_URL}/api/v1/monitor/events?channels=material&backlog=0`
  )
  const uniqueMaterialRequests = [...new Set(materialRequests)].filter(
    (request) => request !== `GET ${API_URL}/api/v1/health`
  )
  expect(
    uniqueMaterialRequests
      .filter(
        (request) =>
          !request.startsWith(`GET ${API_URL}/api/v1/material-models/`)
      )
      .sort()
  ).toEqual(
    [
      `GET ${API_URL}/api/v1/materials/graph`,
      `GET ${API_URL}/api/v1/material-shapes`,
      `GET ${API_URL}/api/v1/monitor/events?channels=material&backlog=0`
    ].sort()
  )
  expect(
    uniqueMaterialRequests.some((request) =>
      request.startsWith(`GET ${API_URL}/api/v1/material-models/`)
    )
  ).toBe(true)
  expect(materialModelStatuses.length).toBeGreaterThan(0)
  expect(materialModelStatuses.every((status) => status === 200)).toBe(true)
  expect(
    browserRequests.some((request) =>
      request.toLowerCase().includes('local_bridge')
    )
  ).toBe(false)
  expect(
    materialRequests.some((request) => request.includes('/api/v1/inventory/'))
  ).toBe(false)
  expect(
    materialRequests.some((request) =>
      request.includes('/api/v1/resource-templates')
    )
  ).toBe(false)
  expect(browserErrors).toEqual([])
})

/**
 * 使用真实 SZLab 源码派生的转运节点与真实物料图（Material Graph），验证 3D
 * 库位（Site）锚点、执行器（Executor）标识、运行态路径和图层控制。
 */
test('SZLab workflow projects material transfers into the Pascal 3D scene', async ({
  page
}) => {
  // SwiftShader 在 CI 中截取 3D Canvas 约需 40–50 秒；五个验收态需预留完整时间。
  test.setTimeout(360_000)
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await installMaterialTransferLayout(page)
  await page.goto(
    `/?section=material&localOsUrl=${encodeURIComponent(API_URL)}`
  )
  const viewer = page.locator('[data-pascal-viewer-3d]')
  await expect(viewer).toBeVisible({ timeout: 30_000 })
  await expect(
    page.getByText(`${EXPECTED_TRANSFER_ROUTE_COUNT} 条物料转运路线`, {
      exact: true
    })
  ).toBeVisible({ timeout: 30_000 })
  const transferToggle = page.getByRole('button', {
    name: '物料转运',
    exact: true
  })
  await expect(transferToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.pascal-transfer-executor')).toHaveCount(
    EXPECTED_TRANSFER_ROUTE_COUNT
  )
  await expect(page.locator('.pascal-transfer-executor.is-expanded'))
    .toHaveCount(1)
  await expect(
    page.locator('.pascal-transfer-executor').filter({
      hasText: 'fine_at_s07'
    })
  ).toBeVisible()
  await page.waitForTimeout(1_000)
  await captureViewport(page, 'szlab-material-transfer-01-perspective.png')

  await page.getByRole('button', { name: '顶视图', exact: true }).click()
  await page.waitForTimeout(700)
  await captureViewport(page, 'szlab-material-transfer-02-top-view.png')

  const siteToggle = page.getByRole('button', {
    name: '库位和点位',
    exact: true
  })
  await siteToggle.click()
  await expect(siteToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.pascal-transfer-executor')).toHaveCount(
    EXPECTED_TRANSFER_ROUTE_COUNT
  )
  await captureViewport(page, 'szlab-material-transfer-03-routes-only.png')

  await transferToggle.click()
  await expect(transferToggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.pascal-transfer-executor')).toHaveCount(0)
  await captureViewport(page, 'szlab-material-transfer-04-layer-hidden.png')

  await transferToggle.click()
  await expect(transferToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.pascal-transfer-executor')).toHaveCount(
    EXPECTED_TRANSFER_ROUTE_COUNT
  )
  await page.getByRole('button', { name: '适配场景', exact: true }).click()
  await page.waitForTimeout(700)
  await captureViewport(page, 'szlab-material-transfer-05-layer-restored.png')

  expect(browserErrors).toEqual([])
})

test('上料拖拽不打开物料属性面板', async ({ page }) => {
  await installMaterialOnlyLayout(page)
  await page.goto(
    `/?section=material&localOsUrl=${encodeURIComponent(API_URL)}`
  )

  const source = page.locator(
    '.material-flow-node[data-material-code="UNILAB-GRAPH-debug_beaker_500ml"]'
  )
  await expect(source).toBeVisible({ timeout: 30_000 })

  await page.getByPlaceholder('检索物料、设备或库位').fill('500ml')
  await page.getByRole('button', {
    name: '烧杯堆栈2 L1B1 烧杯 500 mL',
    exact: true
  }).click()
  await expect(
    page.getByRole('dialog', { name: '物料属性' })
  ).toBeVisible()
  await page.getByRole('button', { name: '关闭物料属性' }).click()
  await expect(
    page.getByRole('dialog', { name: '物料属性' })
  ).toHaveCount(0)

  await page.getByRole('button', { name: '上料', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: '物料属性' })
  ).toHaveCount(0)

  const sourceBounds = await source.boundingBox()
  if (!sourceBounds) throw new Error('上料物料缺少可拖拽边界')
  await page.mouse.move(
    sourceBounds.x + sourceBounds.width / 2,
    sourceBounds.y + sourceBounds.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    sourceBounds.x + sourceBounds.width / 2 + 30,
    sourceBounds.y + sourceBounds.height / 2 + 30,
    { steps: 5 }
  )
  await expect(
    page.getByRole('dialog', { name: '物料属性' })
  ).toHaveCount(0)
  await page.mouse.up()
})

/**
 * 使用宽屏侧前方视角完整呈现已解析的物料（Material）转运路径、库位（Site）
 * 锚点与执行器（Executor），验证相机旋转后仍可按全场景边界完成取景。
 * 参数：`page` 是承载真实 SZLab 3D 场景的 Playwright 页面。
 * 返回：无；验收产物写入侧面全景截图，并断言浏览器无错误。
 */
test('SZLab 物料（Material）转运呈现完整侧面全景', async ({
  page
}) => {
  test.setTimeout(180_000)
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.setViewportSize({ width: 1920, height: 1080 })
  await installMaterialTransferLayout(page)
  await page.goto(
    `/?section=material&localOsUrl=${encodeURIComponent(API_URL)}`
  )
  const viewer = page.locator('[data-pascal-viewer-3d]')
  await expect(viewer).toBeVisible({ timeout: 30_000 })
  await expect(
    page.getByText(`${EXPECTED_TRANSFER_ROUTE_COUNT} 条物料转运路线`, {
      exact: true
    })
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.pascal-transfer-executor')).toHaveCount(
    EXPECTED_TRANSFER_ROUTE_COUNT
  )

  const topView = page.getByRole('button', {
    name: '顶视图',
    exact: true
  })
  await topView.click()
  await page.waitForTimeout(500)
  await topView.click()
  await page.waitForTimeout(500)
  const sceneCanvas = viewer.locator('canvas')
  const sceneBounds = await sceneCanvas.boundingBox()
  if (!sceneBounds) throw new Error('3D 场景缺少可交互画布')
  await page.mouse.move(
    sceneBounds.x + sceneBounds.width * 0.9,
    sceneBounds.y + sceneBounds.height * 0.35
  )
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(
    sceneBounds.x + sceneBounds.width * 0.62,
    sceneBounds.y + sceneBounds.height * 0.35,
    { steps: 12 }
  )
  await page.mouse.up({ button: 'right' })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '适配场景', exact: true }).click()
  await page.waitForTimeout(900)
  await captureViewport(
    page,
    'szlab-material-transfer-06-side-overview.png'
  )

  expect(browserErrors).toEqual([])
})

async function installMaterialOnlyLayout(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      'unilab.panel-layout.lab.v1',
      JSON.stringify({
        version: 1,
        layout: {
          id: 'material-e2e-group',
          type: 'group',
          panels: [
            {
              id: 'material-e2e-unified',
              panelType: 'layout-unified',
              title: 'SZLab 物料'
            }
          ],
          activePanelId: 'material-e2e-unified'
        }
      })
    )
    localStorage.setItem('unilab.lab.view-mode', '2d')
  })
}

async function installMaterialTransferLayout(page: Page): Promise<void> {
  await page.addInitScript((workflowUuid) => {
    localStorage.setItem(
      'unilab.panel-layout.lab.v1',
      JSON.stringify({
        version: 1,
        layout: {
          id: 'material-transfer-e2e-root',
          type: 'split',
          direction: 'horizontal',
          sizes: [72, 28],
          children: [
            {
              id: 'material-transfer-scene-group',
              type: 'group',
              panels: [{
                id: 'material-transfer-scene',
                panelType: 'layout-unified',
                title: 'SZLab 3D 物料转运'
              }],
              activePanelId: 'material-transfer-scene'
            },
            {
              id: 'material-transfer-workflow-group',
              type: 'group',
              panels: [{
                id: 'material-transfer-workflow',
                panelType: 'workflow-dag',
                title: 'SZLab 工作流',
                config: { workflow_uuid: workflowUuid }
              }],
              activePanelId: 'material-transfer-workflow'
            }
          ]
        }
      })
    )
    localStorage.setItem('unilab.lab.view-mode', '3d')
    localStorage.setItem('unilab.lab.site-layer-visible', 'true')
    localStorage.setItem(
      'unilab.lab.material-transfer-layer-visible',
      'true'
    )
  }, MATERIAL_TRANSFER_WORKFLOW_UUID)
}

async function captureViewport(page: Page, fileName: string): Promise<void> {
  const viewport = page.locator('.lab-unified-viewport')
  const clip = await viewport.boundingBox()
  if (!clip) throw new Error('实验室视图不可见')
  await page.screenshot({
    path: resolve(ARTIFACT_ROOT, fileName),
    animations: 'disabled',
    clip
  })
}

async function captureMaterialTree(
  page: Page,
  fileName: string
): Promise<void> {
  await page.locator('.material-tree-sidebar').screenshot({
    path: resolve(ARTIFACT_ROOT, fileName),
    animations: 'disabled'
  })
}

/**
 * 启动物料（Material）服务夹具，或复用显式指定的真实 OS 候选。
 * @returns 本地夹具的子进程/临时目录；复用外部 OS 时为空对象。
 * @throws 夹具启动失败或公开物料图超时时抛出诊断错误。
 */
async function startSzlabInventory(): Promise<InventoryProcess> {
  // 显式外部 URL 表示本轮直接验收真实 OS，不启动路由夹具。
  if (process.env.UNILAB_E2E_OS_URL) return {}
  const workingDirectory = mkdtempSync(
    join(tmpdir(), 'unilab-szlab-inventory-e2e-')
  )
  const helper = resolve(
    process.cwd(),
    'e2e',
    'helpers',
    'szlab-material-inventory-server.py'
  )
  const child = spawn(
    OS_PYTHON,
    [
      helper,
      '--working-dir',
      workingDirectory,
      '--szlab-root',
      SZLAB_ROOT,
      '--graph',
      SZLAB_GRAPH,
      '--port',
      String(API_PORT),
      '--allow-origin',
      FE_ORIGIN
    ],
    {
      cwd: SZLAB_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: [OS_ROOT, SZLAB_ROOT].join(':')
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  const output: string[] = []
  child.stdout?.on('data', (chunk) => output.push(String(chunk)))
  child.stderr?.on('data', (chunk) => output.push(String(chunk)))
  try {
    await waitForGraph(child)
    return { child, workingDirectory }
  } catch (error) {
    await stopProcess(child)
    rmSync(workingDirectory, { recursive: true, force: true })
    throw new Error(`${String(error)}\n${output.join('')}`)
  }
}

/**
 * 等待本地物料（Material）夹具发布完整物料图。
 * @param child 待监视的 Python 子进程。
 * @returns 图数量达到本次预期时完成的 Promise。
 * @throws 子进程退出或 90 秒内未达到预期时抛出错误。
 */
async function waitForGraph(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Inventory server exited with ${child.exitCode}`)
    }
    try {
      const response = await fetch(`${API_URL}/api/v1/materials/graph`)
      if (response.ok) {
        const body = (await response.json()) as {
          data?: { nodes?: unknown[] }
        }
        if (body.data?.nodes?.length === EXPECTED_MATERIAL_COUNT) return
      }
    } catch {
      // The process is still compiling PackageCatalog or binding the port.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(
    `Timed out waiting for the ${EXPECTED_MATERIAL_COUNT}-node SZLab MaterialGraph`
  )
}

async function expandMaterial(page: Page, name: string): Promise<void> {
  const expand = page.getByRole('button', { name: `展开 ${name}` })
  if (await expand.isVisible()) await expand.click()
}

async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode != null || child.signalCode != null) return
  child.kill('SIGINT')
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000))
  ])
  if (child.exitCode == null && child.signalCode == null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}
