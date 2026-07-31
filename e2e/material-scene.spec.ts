import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import {
  createWriteStream,
  mkdirSync,
  writeFileSync
} from 'node:fs'
import { resolve } from 'node:path'

const CORE_ROOT = resolve(process.cwd(), '..')
const OS_ROOT = resolve(CORE_ROOT, 'Uni-Lab-OS')
const ARTIFACT_ROOT = resolve(
  CORE_ROOT,
  'e2e-artifacts',
  'materials'
)
const OS_PYTHON =
  process.env.UNILAB_OS_PYTHON ||
  '/home/changjunhan/.micromamba/envs/unilab/bin/python'
const API_URL =
  process.env.UNILAB_E2E_MATERIAL_API_URL ??
  'http://127.0.0.1:8014'
const API_PORT = Number(new URL(API_URL).port)
const SCHEDULE_PORT = Number(
  process.env.UNILAB_E2E_MATERIAL_SCHEDULE_PORT ?? '18890'
)
// Uni-Lab disables Pascal 0.9.2's incompatible WebGPU post-FX fallback by
// default in both development and packaged renderers. Hardware-backed CI can
// explicitly opt back in to exercise the native pipeline.
const MATERIAL_SCENE_PARAMS = new URLSearchParams({
  localOsUrl: API_URL,
  enable: 'materialNav'
})
if (process.env.UNILAB_E2E_NATIVE_POSTFX === '1') {
  MATERIAL_SCENE_PARAMS.set('enable', 'materialNav,postFx')
}
const MATERIAL_SCENE_URL = `/?${MATERIAL_SCENE_PARAMS.toString()}`

interface Scenario {
  id: string
  title: string
  graph: string
  expectedCodes: readonly string[]
  expectedStackCodes?: readonly string[]
  expectedDefaultEquipmentCards?: readonly string[]
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'liquid-handler-original',
    title: '原始 liquid_handler',
    graph: 'plr_test.json',
    expectedCodes: [
      'PLR_STATION',
      'deck',
      'trash',
      'trash_core96',
      'teaching_carrier',
      'teaching_tip_rack',
      'tip_rack',
      'plate'
    ]
  },
  {
    id: 'plr-test-converted',
    title: 'plr_test_converted.json',
    graph: 'plr_test_converted.json',
    expectedCodes: [
      'liquid_handler',
      'deck',
      'tip_rack',
      'plate_well',
      'arm_slider',
      'hotel'
    ],
    expectedStackCodes: ['hotel'],
    expectedDefaultEquipmentCards: ['arm_slider', 'hotel']
  }
]

test.describe.configure({ mode: 'serial' })

test('物料列表收起后可通过画布左上角按钮重新展开', async ({
  page
}) => {
  test.setTimeout(60_000)
  mkdirSync(ARTIFACT_ROOT, { recursive: true })
  const drawerScenario: Scenario = {
    ...SCENARIOS[0],
    id: 'material-drawer-reopen'
  }
  const os = await startOs(drawerScenario)
  try {
    await installReviewLayout(page)
    const materialGraphLoaded = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${API_URL}/api/v1/materials?`) &&
        response.status() === 200
    )
    await page.goto(MATERIAL_SCENE_URL)
    await page.getByRole('button', { name: /物料/ }).click()
    const offlineToggle = page.getByRole('button', {
      name: '离线',
      exact: true
    })
    if (await offlineToggle.isVisible()) {
      await offlineToggle.click()
    }
    await materialGraphLoaded
    await expect(
      page.locator('[data-pascal-floorplan-overlay]')
    ).toBeVisible()
    await expect(
      page.locator('button[aria-label="Align view to north"]')
    ).toBeHidden()

    const reopenMaterialTree = page.getByRole('button', {
      name: '展开物料列表'
    })
    const viewModes = ['2D', '2.5D', '3D', '分屏'] as const
    for (const viewport of [
      { width: 1680, height: 1050 },
      { width: 900, height: 700 }
    ]) {
      await page.setViewportSize(viewport)
      for (const viewMode of viewModes) {
        await page.getByRole('button', { name: viewMode }).click()
        await page
          .getByRole('button', { name: '收起物料列表' })
          .click()
        await expect(page.locator('.material-tree-sidebar')).toHaveCount(0)
        await expect(reopenMaterialTree).toBeVisible()
        const workbenchBounds = await page
          .locator('.material-workbench')
          .boundingBox()
        const viewportBounds = await page
          .locator('.material-workbench__viewport')
          .boundingBox()
        const reopenBounds = await reopenMaterialTree.boundingBox()
        expect(workbenchBounds).not.toBeNull()
        expect(viewportBounds).not.toBeNull()
        expect(reopenBounds).not.toBeNull()
        expect(viewportBounds?.x).toBe(workbenchBounds?.x)
        expect(reopenBounds?.x).toBeCloseTo(
          (viewportBounds?.x ?? 0) + 8,
          0
        )
        expect(reopenBounds?.x).toBeLessThan(
          (viewportBounds?.x ?? 0) + 48
        )
        expect(reopenBounds?.y).toBeGreaterThanOrEqual(
          (viewportBounds?.y ?? 0) + 48
        )
        await expect
          .poll(() =>
            reopenMaterialTree.evaluate((element) => {
              const bounds = element.getBoundingClientRect()
              return document
                .elementFromPoint(
                  bounds.left + bounds.width / 2,
                  bounds.top + bounds.height / 2
                )
                ?.closest('button')
                ?.getAttribute('aria-label')
            })
          )
          .toBe('展开物料列表')
        await reopenMaterialTree.click()
        await expect(
          page.locator('.material-tree-sidebar')
        ).toBeVisible()
      }
    }
  } finally {
    await Promise.all([
      stopProcess(os.process),
      stopProcess(os.registryProcess)
    ])
  }
})

test('3D 编辑器加载失败后仍保留 2D / 2.5D / 3D 切换按钮', async ({
  page
}) => {
  test.setTimeout(60_000)
  mkdirSync(ARTIFACT_ROOT, { recursive: true })
  const failureScenario: Scenario = {
    ...SCENARIOS[0],
    id: 'scene-load-failure'
  }
  const os = await startOs(failureScenario)
  let sceneChunkBlocked = false
  try {
    await page.route('**/assets/SceneWorkbench-*.js', async (route) => {
      sceneChunkBlocked = true
      await route.abort('failed')
    })
    await installReviewLayout(page)
    await page.goto(MATERIAL_SCENE_URL)
    await page.getByRole('button', { name: /物料/ }).click()

    await expect.poll(() => sceneChunkBlocked).toBe(true)
    await expect(
      page.getByRole('alert').filter({ hasText: /加载失败/ })
    ).toBeVisible()
    await expect(
      page.getByRole('group', { name: '实验室视图' })
    ).toBeVisible()
    for (const viewMode of ['2D', '2.5D', '3D'] as const) {
      await expect(
        page.getByRole('button', { name: viewMode, exact: true })
      ).toBeVisible()
    }

    const oblique = page.getByRole('button', {
      name: '2.5D',
      exact: true
    })
    await oblique.click()
    await expect(oblique).toHaveAttribute('aria-pressed', 'true')

    const twoDimensional = page.getByRole('button', {
      name: '2D',
      exact: true
    })
    await twoDimensional.click()
    await expect(twoDimensional).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await Promise.all([
      stopProcess(os.process),
      stopProcess(os.registryProcess)
    ])
  }
})

test('Registry 上报的设备和耗材模板可用于创建物料', async ({ page }) => {
  test.setTimeout(60_000)
  mkdirSync(ARTIFACT_ROOT, { recursive: true })
  const registryScenario: Scenario = {
    ...SCENARIOS[0],
    id: 'registry-template-create'
  }
  const os = await startOs(registryScenario)

  try {
    await installReviewLayout(page)
    const materialGraphLoaded = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${API_URL}/api/v1/materials?`) &&
        response.status() === 200
    )
    const templateCatalogLoaded = page.waitForResponse(
      (response) =>
        response.url() === `${API_URL}/api/v1/resource-templates` &&
        response.status() === 200
    )
    await page.goto(MATERIAL_SCENE_URL)
    await page.getByRole('button', { name: /物料/ }).click()
    const offlineToggle = page.getByRole('button', {
      name: '离线',
      exact: true
    })
    if (await offlineToggle.isVisible()) {
      await offlineToggle.click()
    }
    await Promise.all([materialGraphLoaded, templateCatalogLoaded])

    const launcher = page.locator('.material-template-launcher')
    for (const template of [
      {
        category: /仪器设备/,
        heading: '仪器设备',
        name: /PRCXI 液体工作站/,
        instanceName: 'E2E Registry Device'
      },
      {
        category: /物料耗材/,
        heading: '物料耗材',
        name: /PRCXI_BioER_96_wellplate/,
        instanceName: 'E2E Registry Plate'
      }
    ]) {
      await launcher.getByRole('button', {
        name: template.category
      }).click()
      const library = page
        .locator('.material-template-library')
        .filter({
          has: page.getByRole('heading', {
            name: template.heading
          })
        })
      await expect(library).toBeVisible()
      await library.getByRole('button', {
        name: template.name
      }).click()
      const create = library.getByRole('button', {
        name: '从该模板创建'
      })
      await expect(create).toBeVisible()
      await expect(create).toBeEnabled()
      await create.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await dialog
        .getByRole('textbox', { name: '实例名称' })
        .fill(template.instanceName)
      const createResponse = page.waitForResponse(
        (response) =>
          response.url() === `${API_URL}/api/v1/materials` &&
          response.request().method() === 'POST'
      )
      await dialog
        .getByRole('button', { name: '创建物料' })
        .click()
      expect((await createResponse).status()).toBe(200)
      await expect(
        page.locator('.material-tree-sidebar__label', {
          hasText: template.instanceName
        })
      ).toBeVisible()
      await library.getByRole('button', {
        name: '关闭模板目录'
      }).click()
    }

    await expect(page.getByText('(10)', { exact: true })).toBeVisible()
  } finally {
    await Promise.all([
      stopProcess(os.process),
      stopProcess(os.registryProcess)
    ])
  }
})

for (const scenario of SCENARIOS) {
  test(`${scenario.title} 在同一场景切换 2D / 2.5D / 3D / Split`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    mkdirSync(ARTIFACT_ROOT, { recursive: true })
    const os = await startOs(scenario)
    try {
      const apiCalls: Array<{
        method: string
        status: number
        url: string
      }> = []
      const browserErrors: string[] = []
      page.on('response', (response) => {
        if (!response.url().startsWith(API_URL)) return
        apiCalls.push({
          method: response.request().method(),
          status: response.status(),
          url: response.url()
        })
      })
      page.on('pageerror', (error) => {
        browserErrors.push(error.message)
      })
      page.on('console', (message) => {
        if (message.type() === 'error') {
          browserErrors.push(message.text())
        }
      })

      await installReviewLayout(page)
      const materialGraphLoaded = page.waitForResponse(
        (response) =>
          response.url().startsWith(`${API_URL}/api/v1/materials?`) &&
          response.status() === 200
      )
      const templateCatalogLoaded = page.waitForResponse(
        (response) =>
          response.url() === `${API_URL}/api/v1/resource-templates` &&
          response.status() === 200
      )
      await page.goto(MATERIAL_SCENE_URL)
      await expect(
        page
          .getByRole('navigation', { name: '主导航' })
          .getByRole('button', { name: /3D 场景/ })
      ).toHaveCount(0)
      await page.getByRole('button', { name: /物料/ }).click()
      const offlineToggle = page.getByRole('button', {
        name: '离线',
        exact: true
      })
      if (await offlineToggle.isVisible()) {
        await offlineToggle.click()
      }
      await Promise.all([materialGraphLoaded, templateCatalogLoaded])

      if (scenario.id === 'liquid-handler-original') {
        await page.getByRole('button', { name: /工作流/ }).click()
        await expect(
          page.locator('[data-panel-type="workflow-dag"]')
        ).toBeVisible()
        await expect(
          page.locator('[data-panel-type="layout-unified"]')
        ).toHaveCount(0)

        await page.getByRole('button', { name: /物料/ }).click()
        await expect(
          page.locator('[data-panel-type="layout-unified"]')
        ).toBeVisible()
        await expect(
          page.locator('[data-panel-type="workflow-dag"]')
        ).toHaveCount(0)
      }

      await expect(
        page.locator('.lab-unified-viewport')
      ).toHaveAttribute('data-lab-view-mode', '2d')
      await expect(page.locator('.material-workbench')).toBeVisible()
      await expect(page.locator('.material-tree-sidebar')).toBeVisible()
      await expect(
        page.getByText(`(${scenario.expectedCodes.length})`, {
          exact: true
        })
      ).toBeVisible()
      expect(
        await page.locator('.material-tree-sidebar__row').count()
      ).toBeGreaterThan(0)
      const templateLauncher = page.locator(
        '.material-template-launcher'
      )
      const deviceTemplates = templateLauncher.getByRole('button', {
        name: /仪器设备/
      })
      const resourceTemplates = templateLauncher.getByRole('button', {
        name: /物料耗材/
      })
      await expect(deviceTemplates).toBeVisible()
      await expect(resourceTemplates).toBeVisible()
      await expect(deviceTemplates).toBeEnabled()
      await expect(resourceTemplates).toBeEnabled()
      await expect(deviceTemplates).toContainText('1')
      await expect(resourceTemplates).not.toContainText('—')
      const [moveControlBox, deviceTemplateBox] = await Promise.all([
        page
          .locator('.material-canvas__edit-control:visible')
          .first()
          .boundingBox(),
        deviceTemplates.boundingBox()
      ])
      expect(moveControlBox).not.toBeNull()
      expect(deviceTemplateBox).not.toBeNull()
      if (moveControlBox && deviceTemplateBox) {
        expect(
          moveControlBox.x + moveControlBox.width
        ).toBeLessThanOrEqual(deviceTemplateBox.x)
      }
      await deviceTemplates.click()
      const deviceLibrary = page
        .locator('.material-template-library')
        .filter({ has: page.getByRole('heading', { name: '仪器设备' }) })
      await expect(deviceLibrary).toBeVisible()
      await expect(
        deviceLibrary.getByRole('button', {
          name: /PRCXI 液体工作站/
        })
      ).toBeVisible()
      await deviceLibrary.screenshot({
        path: resolve(
          ARTIFACT_ROOT,
          `${scenario.id}-template-devices.png`
        ),
        animations: 'disabled'
      })
      await deviceLibrary.getByRole('button', {
        name: '关闭模板目录'
      }).click()

      await resourceTemplates.click()
      const resourceLibrary = page
        .locator('.material-template-library')
        .filter({ has: page.getByRole('heading', { name: '物料耗材' }) })
      await expect(resourceLibrary).toBeVisible()
      await resourceLibrary
        .getByRole('button', { name: /PRCXI_BioER_96_wellplate/ })
        .click()
      await expect(
        resourceLibrary.getByRole('button', {
          name: '从该模板创建'
        })
      ).toBeDisabled()
      await resourceLibrary.screenshot({
        path: resolve(
          ARTIFACT_ROOT,
          `${scenario.id}-template-resources.png`
        ),
        animations: 'disabled'
      })
      await resourceLibrary.getByRole('button', {
        name: '关闭模板目录'
      }).click()
      await expect(page.locator('.pascal-editor-host')).toHaveCount(1)
      await expect(page.locator('.pascal-editor-host')).toBeVisible()
      await expect(
        page.locator(
          '.floorplan-registry-base .floorplan-registry-entry[data-node-id^="lab-"]'
        )
      ).toHaveCount(scenario.expectedCodes.length)
      await expect(
        page.locator('[data-pascal-floorplan-overlay]')
      ).toBeVisible()
      await expect(
        page.locator('.pascal-lab-toolbar__actions')
      ).toHaveCount(0)
      await expect(page.locator('.material-flow-node')).toHaveCount(
        scenario.expectedCodes.length
      )
      await expect(page.locator('.material-flow-node').first()).toBeVisible()
      await expect(
        page.locator('.material-flow-node__physical-label', {
          hasText: /mm/
        })
      ).toHaveCount(0)
      if (scenario.id === 'liquid-handler-original') {
        await expect(page.locator('[data-deck-rail]')).toHaveCount(32)
        await expect(
          page.locator(
            '.material-flow-site[data-site-key^="R"]'
          )
        ).toHaveCount(0)
      }
      for (const code of scenario.expectedCodes) {
        const materialNode = page.locator(
          `.material-flow-node[data-material-code="${code}"]`
        )
        await expect(materialNode).toHaveCount(1)
        await expect(
          materialNode.getByText(code, { exact: true }).first()
        ).toBeVisible()
      }
      for (const code of scenario.expectedDefaultEquipmentCards ?? []) {
        const equipment = page.locator(
          `.material-flow-node[data-material-code="${code}"]`
        )
        await expect(equipment).toHaveClass(
          /material-flow-node--equipment-card/
        )
        await expect(
          equipment.locator('[data-default-equipment-card]')
        ).toBeVisible()
        await expect(
          equipment.getByText('仪器设备', { exact: true })
        ).toBeVisible()
      }
      if (scenario.id === 'plr-test-converted') {
        const hotel = page.locator(
          '.material-flow-node[data-material-code="hotel"]'
        )
        await hotel.click()
        const inspector = page.getByRole('dialog', {
          name: '物料属性'
        })
        await expect(inspector).toBeVisible()
        await expect(inspector).toContainText('hotel')
        await expect(
          inspector.getByRole('button', {
            name: '关闭物料属性'
          })
        ).toBeVisible()
        await page.locator('.material-workbench').screenshot({
          path: resolve(
            ARTIFACT_ROOT,
            `${scenario.id}-material-drawer.png`
          ),
          animations: 'disabled'
        })
        await inspector
          .getByRole('button', { name: '关闭物料属性' })
          .click({ timeout: 10_000 })
        await expect(inspector).toHaveCount(0)
        await expect(hotel).not.toHaveClass(/is-selected/)
      }
      await captureWorkbench(page, scenario.id, 'workbench-2d')
      await captureViewport(page, scenario.id, '2d')

      await page.getByRole('button', { name: '2.5D', exact: true }).click()
      await expect(
        page.locator('.lab-unified-viewport')
      ).toHaveAttribute('data-lab-view-mode', '2.5d')
      await expect(page.locator('[data-material-oblique-view]')).toBeVisible()
      await expect(page.locator('.material-oblique-object')).toHaveCount(
        scenario.expectedCodes.length
      )
      for (const code of scenario.expectedCodes) {
        await expect(
          page.locator(
            `.material-oblique-object[data-material-code="${code}"]`
          )
        ).toHaveCount(1)
      }
      await expect(
        page.locator('.material-oblique-labware__rim').first()
      ).toBeVisible()
      expect(
        await page.locator('.material-oblique-site').count()
      ).toBeGreaterThanOrEqual(96)
      if (scenario.id === 'liquid-handler-original') {
        await expect(
          page.locator(
            '.material-oblique-site[data-site-key^="R"]'
          )
        ).toHaveCount(0)
        await expect(page.locator('[data-site-label]')).toHaveCount(0)
      } else {
        expect(
          await page.locator('[data-site-label]').count()
        ).toBeGreaterThan(0)
        await expect(
          page.locator('[data-site-label]').first()
        ).not.toHaveAttribute('data-site-label', '')
      }
      for (const code of scenario.expectedStackCodes ?? []) {
        const stack = page.locator(
          `.material-oblique-object[data-material-code="${code}"][data-oblique-render-style="stack"]`
        )
        await expect(stack).toHaveCount(1)
        expect(
          await stack.locator('.material-oblique-stack__shelf').count()
        ).toBeGreaterThanOrEqual(4)
      }
      await captureViewport(page, scenario.id, '2.5d')

      await page
        .getByRole('button', { name: /^(Split|分屏)$/ })
        .click()
      await expect(
        page.locator('.lab-unified-viewport')
      ).toHaveAttribute('data-lab-view-mode', 'split')
      await expect(page.locator('.pascal-editor-host')).toBeVisible()
      await expect(page.locator('.floorplan-registry-layer')).toBeVisible()
      await expect(
        page.locator('[data-pascal-floorplan-overlay]')
      ).toBeVisible()
      await expect(
        page.locator('.pascal-lab-toolbar__status')
      ).toHaveText(`${scenario.expectedCodes.length} 个物料 · 只读`)
      await expect(
        page.locator('.pascal-editor-host canvas').first()
      ).toBeVisible()
      await resizeNativeSplitPane(page)
      const dismissCameraHint = page.getByRole('button', {
        name: 'Dismiss camera controls hint'
      })
      if (await dismissCameraHint.isVisible()) {
        await dismissCameraHint.dispatchEvent('click')
      }
      await page
        .getByRole('button', { name: '适配场景' })
        .click()
      await page.waitForTimeout(2_000)
      await captureViewport(page, scenario.id, 'split')

      await page.getByRole('button', { name: '3D', exact: true }).click()
      await expect(
        page.locator('.lab-unified-viewport')
      ).toHaveAttribute('data-lab-view-mode', '3d')
      await expect(page.locator('.pascal-editor-host')).toBeVisible()
      await expect(page.locator('.floorplan-registry-layer')).toBeHidden()
      await expect(
        page.locator('[data-pascal-floorplan-overlay]')
      ).toBeHidden()
      await expect(
        page
          .locator(
            '.pascal-editor-host [data-pascal-viewer-3d] .transition-colors'
          )
          .first()
      ).toHaveClass(/bg-\[#1f2433\]/)
      await expectPrimaryDragToOrbit(page)
      await captureViewport(page, scenario.id, '3d')

      await page
        .getByRole('button', { name: /^(Split|分屏)$/ })
        .click()

      const materialResponse = await page.request.get(
        `${API_URL}/api/v1/materials?page=1&page_size=100`
      )
      expect(materialResponse.status()).toBe(200)
      const materialPage = await materialResponse.json()
      expect(
        materialPage.data.items
          .map((item: { code: string }) => item.code)
          .sort()
      ).toEqual([...scenario.expectedCodes].sort())

      if (scenario.id === 'liquid-handler-original') {
        await stopProcess(os.registryProcess)
        const staleResponse = await page.request.get(
          `${API_URL}/api/v1/resource-templates?refresh=true`
        )
        expect(staleResponse.status()).toBe(200)
        expect((await staleResponse.json()).data.stale).toBe(true)
        await page.reload()
        await page.getByRole('button', { name: /物料/ }).click()
        const staleResourceLauncher = page
          .locator('.material-template-launcher')
          .getByRole('button', { name: /物料耗材/ })
        await staleResourceLauncher.click()
        const staleLibrary = page.locator(
          '.material-template-library__stale'
        )
        await expect(staleLibrary).toBeVisible()
        await page.locator('.material-template-library').screenshot({
          path: resolve(
            ARTIFACT_ROOT,
            `${scenario.id}-template-stale.png`
          ),
          animations: 'disabled'
        })
      }

      const screenshot = resolve(
        ARTIFACT_ROOT,
        `${scenario.id}-2d-3d.png`
      )
      await page.locator('.lab-unified-viewport').screenshot({
        path: screenshot,
        animations: 'disabled'
      })
      const result = {
        outcome: 'passed',
        scenario,
        screenshot,
        os: {
          pid: os.process.pid,
          registryPid: os.registryProcess.pid,
          command: os.command,
          log: os.log
        },
        apiCalls,
        browserErrors
      }
      writeFileSync(
        resolve(ARTIFACT_ROOT, `${scenario.id}-result.json`),
        JSON.stringify(result, null, 2)
      )

      expect(
        apiCalls.some(
          (call) =>
            call.method === 'GET' &&
            call.status === 200 &&
            call.url.includes('/api/v1/materials')
        )
      ).toBe(true)
      expect(
        apiCalls.some(
          (call) =>
            call.method === 'GET' &&
            call.status === 200 &&
            call.url.includes('/api/v1/resource-templates')
        )
      ).toBe(true)
      expect(browserErrors).toEqual([])
    } finally {
      await Promise.all([
        stopProcess(os.process),
        stopProcess(os.registryProcess)
      ])
    }
  })
}

async function resizeNativeSplitPane(page: Page): Promise<void> {
  const editor = page.locator('.pascal-lab-editor')
  const overlay = page.locator('[data-pascal-floorplan-overlay]')
  const divider = editor.locator('.cursor-col-resize:visible').first()
  await expect(divider).toBeVisible()

  const [editorBox, overlayBefore, dividerBox] = await Promise.all([
    editor.boundingBox(),
    overlay.boundingBox(),
    divider.boundingBox()
  ])
  expect(editorBox).not.toBeNull()
  expect(overlayBefore).not.toBeNull()
  expect(dividerBox).not.toBeNull()
  if (!editorBox || !overlayBefore || !dividerBox) return

  const targetRatio = 0.42
  await page.mouse.move(
    dividerBox.x + dividerBox.width - 1,
    dividerBox.y + dividerBox.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    editorBox.x + editorBox.width * targetRatio,
    dividerBox.y + dividerBox.height / 2,
    { steps: 8 }
  )
  await page.mouse.up()

  await expect
    .poll(async () => {
      const box = await overlay.boundingBox()
      return box ? box.width / editorBox.width : 0
    })
    .toBeCloseTo(targetRatio, 1)
}

async function captureViewport(
  page: Page,
  scenarioId: string,
  mode: '2d' | '2.5d' | '3d' | 'split'
): Promise<void> {
  await page.locator('.lab-unified-viewport').screenshot({
    path: resolve(ARTIFACT_ROOT, `${scenarioId}-${mode}.png`),
    animations: 'disabled'
  })
}

async function expectPrimaryDragToOrbit(page: Page): Promise<void> {
  const viewer = page.locator(
    '.pascal-editor-host [data-pascal-viewer-3d]'
  )
  const box = await viewer.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return

  const digest = async (): Promise<string> =>
    createHash('sha256')
      .update(
        await viewer.screenshot({
          animations: 'disabled'
        })
      )
      .digest('hex')

  await page.waitForTimeout(500)
  const before = await digest()
  await page.mouse.move(
    box.x + box.width * 0.62,
    box.y + box.height * 0.48
  )
  await page.mouse.down()
  await page.mouse.move(
    box.x + box.width * 0.34,
    box.y + box.height * 0.58,
    { steps: 12 }
  )
  await page.mouse.up()
  await page.waitForTimeout(500)

  expect(await digest()).not.toBe(before)
}

async function captureWorkbench(
  page: Page,
  scenarioId: string,
  name: 'workbench-2d'
): Promise<void> {
  await page.locator('.material-workbench').screenshot({
    path: resolve(ARTIFACT_ROOT, `${scenarioId}-${name}.png`),
    animations: 'disabled'
  })
}

async function installReviewLayout(page: Page): Promise<void> {
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
              panelType: 'layout-unified'
            }
          ],
          activePanelId: 'material-e2e-unified'
        }
      })
    )
    localStorage.setItem('unilab.lab.view-mode', '2d')
  })
}

async function startOs(scenario: Scenario): Promise<{
  process: ChildProcess
  registryProcess: ChildProcess
  command: readonly string[]
  log: string
}> {
  const graphPath = resolve(
    OS_ROOT,
    'unilabos',
    'test',
    'experiments',
    scenario.graph
  )
  const journalPath = resolve(
    ARTIFACT_ROOT,
    `${scenario.id}-runtime.sqlite`
  )
  const logPath = resolve(
    ARTIFACT_ROOT,
    `${scenario.id}-os.log`
  )
  const registryLogPath = resolve(
    ARTIFACT_ROOT,
    `${scenario.id}-registry.log`
  )
  const registryLog = createWriteStream(registryLogPath, { flags: 'w' })
  const registryCode = [
    'from unilabos.registry.registry import build_registry',
    'from unilabos.app.web.server import start_server',
    'build_registry(upload_registry=False, check_mode=False)',
    "start_server(host='127.0.0.1', port=8002, open_browser=False)"
  ].join(';')
  const registryProcess = spawn(OS_PYTHON, ['-c', registryCode], {
    cwd: OS_ROOT,
    env: {
      ...process.env,
      PYTHONPATH: OS_ROOT
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  registryProcess.stdout?.pipe(registryLog)
  registryProcess.stderr?.pipe(registryLog)
  try {
    await waitForUrl(
      registryProcess,
      'http://127.0.0.1:8002/internal/v1/resource-templates',
      'Registry catalog'
    )
  } catch (error) {
    await stopProcess(registryProcess)
    registryLog.end()
    throw error
  }

  const args = [
    '-m',
    'unilabos.app.local_bridge.server',
    '--offline',
    '--host',
    '127.0.0.1',
    '--api-port',
    String(API_PORT),
    '--schedule-port',
    String(SCHEDULE_PORT),
    '--journal-path',
    journalPath,
    '--graph',
    graphPath
  ] as const
  const log = createWriteStream(logPath, { flags: 'w' })
  const child = spawn(OS_PYTHON, args, {
    cwd: OS_ROOT,
    env: {
      ...process.env,
      PYTHONPATH: OS_ROOT
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout?.pipe(log)
  child.stderr?.pipe(log)

  try {
    await waitForUrl(child, `${API_URL}/health`, 'local_bridge health')
  } catch (error) {
    await Promise.all([
      stopProcess(child),
      stopProcess(registryProcess)
    ])
    log.end()
    registryLog.end()
    throw error
  }
  return {
    process: child,
    registryProcess,
    command: [OS_PYTHON, ...args],
    log: logPath
  }
}

async function waitForUrl(
  child: ChildProcess,
  url: string,
  label: string
): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(
        `Uni-Lab-OS exited before health check: ${child.exitCode}`
      )
    }
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The OS process is still binding its three local transports.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return
  child.kill('SIGINT')
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000))
  ])
  if (child.exitCode == null && child.signalCode == null) {
    child.kill('SIGKILL')
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolveWait) => setTimeout(resolveWait, 5_000))
    ])
  }
}
