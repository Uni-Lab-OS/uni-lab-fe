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
const OS_PYTHON =
  process.env.UNILAB_OS_PYTHON ??
  'python3'
const API_PORT = Number(process.env.UNILAB_E2E_MATERIAL_PORT ?? '18144')
const API_URL = `http://127.0.0.1:${API_PORT}`
const FE_ORIGIN = process.env.UNILAB_FE_E2E_URL ?? 'http://127.0.0.1:4173'
const ARTIFACT_ROOT = resolve(
  CORE_ROOT,
  'e2e-artifacts',
  'materials',
  'szlab-inventory'
)

interface InventoryProcess {
  child: ChildProcess
  workingDirectory: string
}

let inventory: InventoryProcess

test.describe.configure({ mode: 'serial' })
test.use({
  launchOptions: {
    args: [
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader-webgl'
    ]
  }
})

test.beforeAll(async () => {
  mkdirSync(ARTIFACT_ROOT, { recursive: true })
  inventory = await startSzlabInventory()
})

test.afterAll(async () => {
  await stopProcess(inventory?.child)
  if (inventory?.workingDirectory) {
    rmSync(inventory.workingDirectory, { recursive: true, force: true })
  }
})

test('SZLab MaterialGraph renders complete 2.5D and 3D views', async ({
  page
}) => {
  test.setTimeout(120_000)
  const browserErrors: string[] = []
  const materialRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('request', (request) => {
    if (request.url().startsWith(`${API_URL}/api/v1/`)) {
      materialRequests.push(`${request.method()} ${request.url()}`)
    }
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
  expect(graphPayload.data?.nodes).toHaveLength(126)
  expect(graphSites).toHaveLength(398)
  expect(
    graphSites.filter((site) => site.occupied_material_uuid != null)
  ).toHaveLength(110)
  expect(
    graphSites.filter((site) => site.occupied_material_uuid == null)
  ).toHaveLength(288)
  const shapePayload = (await shapeResponse.json()) as {
    data?: { items?: unknown[] }
  }
  expect(shapePayload.data?.items?.length ?? 0).toBeGreaterThanOrEqual(12)

  await expect(
    page.getByRole('button', { name: '物料', exact: true })
  ).toBeVisible()
  await expect(page.getByText('(126)', { exact: true })).toBeVisible()
  await expect(page.getByText('Edge 已连接', { exact: true })).toBeVisible()

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
  await expect(oblique.locator('[data-material-id]')).toHaveCount(126)
  await expect(oblique.locator('[data-oblique-site-bounds]')).toHaveCount(
    398
  )
  await expect(
    oblique.locator('[data-oblique-site-bounds][data-site-occupancy="occupied"]')
  ).toHaveCount(110)
  await expect(
    oblique.locator('[data-oblique-site-bounds][data-site-occupancy="empty"]')
  ).toHaveCount(288)
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
  await expect(viewer.locator('canvas')).toBeVisible()
  await expect(page.getByText('126 个物料 · 只读')).toBeVisible()
  const viewerBox = await viewer.boundingBox()
  expect(viewerBox?.width ?? 0).toBeGreaterThan(900)
  expect(viewerBox?.height ?? 0).toBeGreaterThan(500)
  await page.waitForTimeout(1_000)
  await captureViewport(page, 'szlab-materials-3d.png')

  expect(materialRequests).toContain(
    `GET ${API_URL}/api/v1/materials/graph`
  )
  expect(materialRequests).toContain(
    `GET ${API_URL}/api/v1/material-shapes`
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
      `GET ${API_URL}/api/v1/material-shapes`
    ].sort()
  )
  expect(
    uniqueMaterialRequests.some((request) =>
      request.startsWith(`GET ${API_URL}/api/v1/material-models/`)
    )
  ).toBe(true)
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

async function captureViewport(page: Page, fileName: string): Promise<void> {
  await page.locator('.lab-unified-viewport').screenshot({
    path: resolve(ARTIFACT_ROOT, fileName),
    animations: 'disabled'
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

async function startSzlabInventory(): Promise<InventoryProcess> {
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
      'deployment/graphs/szlab-local-debug.json',
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

async function waitForGraph(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000
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
        if (body.data?.nodes?.length === 126) return
      }
    } catch {
      // The process is still compiling PackageCatalog or binding the port.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('Timed out waiting for SZLab MaterialGraph')
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
