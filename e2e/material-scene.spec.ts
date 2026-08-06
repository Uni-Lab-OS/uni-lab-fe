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
  '/home/changjunhan/.micromamba/envs/unilab/bin/python'
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
  const modelResponses: Array<{ status: number; url: string }> = []
  const firstPartyRequestFailures: string[] = []
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !message.text().startsWith('Failed to load resource:')
    ) {
      browserErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('requestfailed', (request) => {
    if (
      request.url().startsWith(FE_ORIGIN) ||
      request.url().startsWith(API_URL)
    ) {
      firstPartyRequestFailures.push(
        `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`
      )
    }
  })
  page.on('request', (request) => {
    if (request.url().startsWith(`${API_URL}/api/v1/`)) {
      materialRequests.push(`${request.method()} ${request.url()}`)
    }
  })
  page.on('response', (response) => {
    if (
      response.url().startsWith(`${API_URL}/api/v1/material-models/`) &&
      /\.(?:xacro|stl)(?:$|\?)/i.test(response.url())
    ) {
      modelResponses.push({ status: response.status(), url: response.url() })
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
  const [, shapeResponse] = await Promise.all([graphLoaded, shapesLoaded])
  const shapePayload = (await shapeResponse.json()) as {
    data?: { items?: unknown[] }
  }
  expect(shapePayload.data?.items).toHaveLength(12)

  await expect(
    page.getByRole('button', { name: '物料', exact: true })
  ).toBeVisible()
  await expect(page.getByText('(21)', { exact: true })).toBeVisible()
  await expect(page.getByText('Edge 已连接', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '2.5D', exact: true }).click()
  const oblique = page.locator('[data-material-oblique-view]')
  await expect(oblique).toBeVisible()
  await expect(oblique.locator('[data-material-id]')).toHaveCount(21)
  await expect(
    oblique.locator('[data-oblique-render-style="spec"]')
  ).toHaveCount(13)
  await expect(
    oblique.locator('[data-oblique-shape="sample_vial_stack"]')
  ).toHaveCount(2)
  await expect(
    oblique.locator('[data-oblique-shape="beaker_stack"]')
  ).toHaveCount(2)
  await captureViewport(page, 'szlab-materials-2_5d.png')

  await page.getByRole('button', { name: '3D', exact: true }).click()
  const viewer = page.locator('[data-pascal-viewer-3d]')
  await expect(viewer).toBeVisible({ timeout: 30_000 })
  await expect(viewer.locator('canvas')).toBeVisible()
  await expect(page.getByText('21 个物料 · 只读')).toBeVisible()
  const viewerBox = await viewer.boundingBox()
  expect(viewerBox?.width ?? 0).toBeGreaterThan(900)
  expect(viewerBox?.height ?? 0).toBeGreaterThan(500)
  await expect
    .poll(
      () =>
        modelResponses.filter((response) =>
          /\.stl(?:$|\?)/i.test(response.url)
        ).length,
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0)
  await captureViewport(page, 'szlab-materials-3d.png')

  expect(materialRequests).toContain(
    `GET ${API_URL}/api/v1/materials/graph`
  )
  expect(materialRequests).toContain(
    `GET ${API_URL}/api/v1/material-shapes`
  )
  expect(
    modelResponses.some((response) =>
      /\.xacro(?:$|\?)/i.test(response.url)
    )
  ).toBe(true)
  expect(
    modelResponses.some((response) =>
      /\.stl(?:$|\?)/i.test(response.url)
    )
  ).toBe(true)
  expect(modelResponses.every((response) => response.status === 200)).toBe(
    true
  )
  expect(
    materialRequests.some((request) => request.includes('/api/v1/inventory/'))
  ).toBe(false)
  expect(
    materialRequests.some((request) =>
      request.includes('/api/v1/resource-templates')
    )
  ).toBe(false)
  expect(firstPartyRequestFailures).toEqual([])
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
      'deployment/graphs/szlab-ideawit-sim.json',
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
        if (body.data?.nodes?.length === 21) return
      }
    } catch {
      // The process is still compiling PackageCatalog or binding the port.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('Timed out waiting for SZLab MaterialGraph')
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
