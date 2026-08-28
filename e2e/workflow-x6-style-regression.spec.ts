import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { installWorkflowPanel } from './helpers/workflow-runtime-ui'

const API_URL = 'http://127.0.0.1:18029'
const WORKFLOW_UUID = '10000000-0000-4000-8000-000000000029'
const HASH = `sha256:${'a'.repeat(64)}`
const ARTIFACT_DIRECTORY = resolve(
  process.env.UNILAB_E2E_ARTIFACT_DIR ??
    '/home/wangtao/artifacts/unilab-workbench-screenshots/2026-08-27'
)

test.use({ viewport: { width: 2560, height: 1440 } })

/**
 * 用只读权威投影回归 X6 的 React Flow 视觉合同，不创建或运行工作流任务。
 *
 * @param page 当前前端候选的隔离浏览器页面。
 * @returns 生成桌面页面与画布特写截图，并断言节点、端口、边与窄屏降级。
 * @safety 所有 OS HTTP 路由均由页面内存夹具接管，不写工作区或外部服务。
 */
test('X6 canvas preserves the HTML workflow visual contract', async ({ page }) => {
  mkdirSync(ARTIFACT_DIRECTORY, { recursive: true })
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await installReadOnlyWorkflowApi(page)
  await installWorkflowPanel(page, WORKFLOW_UUID)

  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(API_URL)}`
  )
  const panel = page.locator(
    '[data-panel-type="workflow-dag"][data-panel-instance-id="runtime-workflow"]'
  )
  await expect(panel).toBeVisible()
  await panel.getByRole('button', {
    name: '画布模式',
    exact: true
  }).click()

  const canvas = panel.locator('[data-canvas-engine="x6"]')
  const viewport = canvas.locator('.workflow-x6__viewport')
  const library = panel.getByRole('region', {
    name: '实验工作流与节点库'
  })
  const inspector = panel.getByRole('complementary', {
    name: '画布节点编辑器'
  })
  const materialSource = viewport.locator(
    '.x6-node[data-workflow-node-visual-kind="material-source"]'
  )
  const robotTransfer = viewport.locator(
    '.x6-node[data-workflow-node-visual-kind="robot-transfer"]'
  )
  await expect(canvas).toBeVisible()
  await expect(library).toBeVisible()
  await expect(inspector).toBeVisible()
  await panel.getByRole('combobox', { name: '布局策略' })
    .selectOption('crossing-minimized')
  await expect.poll(() => desktopColumnsMatchPrototype(library, inspector))
    .toBe(true)
  await expect(canvas).toHaveAttribute('data-x6-node-count', '4')
  await expect(materialSource).toHaveCount(1)
  await expect(robotTransfer).toHaveCount(1)
  await expect(viewport.locator(
    '.x6-node[data-workflow-node-visual-kind="action"]'
  )).toHaveCount(2)
  const firstAction = viewport.locator(
    '.x6-node[data-workflow-node-visual-kind="action"]'
  ).first()
  await expect(firstAction.locator('.workflow-x6-node__label'))
    .toHaveText('混合主样品')
  await expect(firstAction.locator('.workflow-x6-node__label'))
    .toHaveAttribute('x', '10')
  await expect(firstAction.locator('.workflow-x6-node__label'))
    .toHaveAttribute('y', '35.5')
  await expect(firstAction.locator('.workflow-x6-node__body'))
    .toHaveAttribute('width', '132')
  await expect(firstAction.locator('.workflow-x6-node__body'))
    .toHaveAttribute('height', '66')
  await expect(firstAction.locator('.workflow-x6-node__kind'))
    .toHaveText('实验操作')
  await expect.poll(() => actionLabelIsInPrototypeNameRow(firstAction))
    .toBe(true)
  await expect(viewport.locator('.workflow-x6-node__material-shape'))
    .toBeVisible()
  await expect(viewport.locator('.workflow-x6-node__transfer-shape'))
    .toBeVisible()
  await expect(firstAction).toHaveAttribute('data-workflow-status', 'pending')
  await expect(viewport.locator('.workflow-x6-port--material').first())
    .toBeVisible()

  await panel.getByRole('button', {
    name: '适应完整工作流视图'
  }).click()
  await page.waitForTimeout(500)
  await expect.poll(() => allNodesAreInsideViewport(page, viewport)).toBe(true)
  await expect.poll(() => allNodesAreSeparated(viewport)).toBe(true)
  await firstAction.click()
  await expect(inspector.getByRole('textbox')).toHaveValue('混合主样品')
  await dismissRuntimeProblem(panel)
  await page.screenshot({
    path: resolve(
      ARTIFACT_DIRECTORY,
      '12-x6-react-flow-style-regression-desktop.png'
    ),
    animations: 'disabled'
  })
  await canvas.screenshot({
    path: resolve(
      ARTIFACT_DIRECTORY,
      '14-x6-react-flow-style-regression-canvas.png'
    ),
    animations: 'disabled'
  })
  await screenshotSpecialNodes(page, materialSource, robotTransfer)

  await page.setViewportSize({ width: 760, height: 900 })
  await page.waitForTimeout(300)
  await canvas.getByRole('button', { name: '适应画布' }).click()
  await expect(canvas.locator('.workflow-x6__minimap')).toBeHidden()
  await expect(library).toBeHidden()
  await expect(inspector).toBeHidden()
  await expect.poll(() => allNodesAreInsideViewport(page, viewport)).toBe(true)
  await dismissRuntimeProblem(panel)
  await page.screenshot({
    path: resolve(
      ARTIFACT_DIRECTORY,
      '16-x6-workflow-workbench-narrow.png'
    ),
    animations: 'disabled'
  })

  expect(browserErrors).toEqual([])
})

/** 视觉基线不保留内存 SSE 夹具主动断开产生的降级提示。 */
async function dismissRuntimeProblem(panel: Locator): Promise<void> {
  const problem = panel.locator('.workflow-runtime__problem').filter({
    hasText: '实时通知不可用'
  })
  if (await problem.count() === 0) return
  await problem.getByRole('button', { name: '关闭' }).click()
}

/** 宽屏三栏遵守原型的 260px / 自适应 / 286px 合同。 */
async function desktopColumnsMatchPrototype(
  library: Locator,
  inspector: Locator
): Promise<boolean> {
  const libraryBox = await library.boundingBox()
  const inspectorBox = await inspector.boundingBox()
  if (!libraryBox || !inspectorBox) return false
  return Math.abs(libraryBox.width - 260) <= 2 &&
    Math.abs(inspectorBox.width - 286) <= 2
}

/** 确认适应视图后的主画布节点没有被边界裁切。 */
async function allNodesAreInsideViewport(
  page: Page,
  viewport: Locator
): Promise<boolean> {
  const viewportBox = await viewport.boundingBox()
  const browserViewport = page.viewportSize()
  const nodeBoxes = await viewport.locator('.x6-node').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom
      }
    })
  )
  if (!viewportBox || !browserViewport || nodeBoxes.length === 0) return false
  const tolerance = 2
  return nodeBoxes.every((box) =>
    box.left >= viewportBox.x - tolerance &&
    box.right <= viewportBox.x + viewportBox.width + tolerance &&
    box.top >= viewportBox.y - tolerance &&
    box.bottom <= viewportBox.y + viewportBox.height + tolerance &&
    box.left >= -tolerance &&
    box.right <= browserViewport.width + tolerance &&
    box.top >= -tolerance &&
    box.bottom <= browserViewport.height + tolerance
  )
}

/** 确认动态 X6 投影没有将两个节点放在同一个可视区域。 */
async function allNodesAreSeparated(viewport: Locator): Promise<boolean> {
  const nodeBoxes = await viewport.locator('.x6-node').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    })
  )
  return nodeBoxes.every((box, index) => nodeBoxes.every((other, otherIndex) => {
    if (index >= otherIndex) return true
    const overlapWidth = Math.min(box.x + box.width, other.x + other.width) -
      Math.max(box.x, other.x)
    const overlapHeight = Math.min(box.y + box.height, other.y + other.height) -
      Math.max(box.y, other.y)
    return overlapWidth <= 1 || overlapHeight <= 1
  }))
}

/** 确认 X6 没有将动作标题按内置 Rect label 规则居中。 */
async function actionLabelIsInPrototypeNameRow(
  action: Locator
): Promise<boolean> {
  const body = await action.locator('.workflow-x6-node__body').boundingBox()
  const label = await action.locator('.workflow-x6-node__label').boundingBox()
  if (!body || !label) return false
  const labelCenterY = label.y + label.height / 2
  return label.x >= body.x &&
    label.x + label.width <= body.x + body.width &&
    labelCenterY > body.y + body.height * 0.35 &&
    labelCenterY < body.y + body.height * 0.68
}

/** 生成物料来源与机械臂节点的高清局部验收图。 */
async function screenshotSpecialNodes(
  page: Page,
  materialSource: Locator,
  robotTransfer: Locator
): Promise<void> {
  const sourceBox = await materialSource.boundingBox()
  const transferBox = await robotTransfer.boundingBox()
  const viewportSize = page.viewportSize()
  if (!sourceBox || !transferBox || !viewportSize) return
  const paddingX = 90
  const paddingY = 48
  const left = Math.max(0, Math.min(sourceBox.x, transferBox.x) - paddingX)
  const top = Math.max(0, Math.min(sourceBox.y, transferBox.y) - paddingY)
  const right = Math.min(
    viewportSize.width,
    Math.max(sourceBox.x + sourceBox.width, transferBox.x + transferBox.width) +
      paddingX
  )
  const bottom = Math.min(
    viewportSize.height,
    Math.max(sourceBox.y + sourceBox.height, transferBox.y + transferBox.height) +
      paddingY
  )
  await page.screenshot({
    path: resolve(
      ARTIFACT_DIRECTORY,
      '15-x6-material-aware-special-nodes.png'
    ),
    clip: {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    },
    animations: 'disabled'
  })
}

/** 安装只读的工作流创作聚合与空运行目录。 */
async function installReadOnlyWorkflowApi(page: Page): Promise<void> {
  const authoring = workflowAuthoringFixture()
  const appliedGraph = authoring.applied_graph
  await page.route(`${API_URL}/api/v1/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/v1/health') {
      await route.fulfill({ json: { code: 0, data: { status: 'ok' } } })
      return
    }
    if (url.pathname === `/api/v1/workflows/${WORKFLOW_UUID}/authoring`) {
      await route.fulfill({ json: { code: 0, data: authoring } })
      return
    }
    if (
      url.pathname === '/api/v1/authoring/generate-python' ||
      url.pathname === '/api/v1/authoring/validate'
    ) {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            diagnostics: [],
            graph: appliedGraph,
            normalized_python_source: '# X6 style regression fixture\n',
            source_map: [],
            changeset: {},
            compiler_version: 'x6-style-regression',
            template_catalog_fingerprint: HASH
          }
        }
      })
      return
    }
    if (route.request().headers().accept?.includes('text/event-stream')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': x6-style-regression\n\n'
      })
      return
    }
    if (url.pathname === '/api/v1/resource-templates') {
      await route.fulfill({
        json: { code: 0, data: { revision: 'fixture-1', items: [] } }
      })
      return
    }
    if (url.pathname === '/api/v1/workflow-node-templates') {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            authority: { authority_id: 'fixture', kind: 'local' },
            catalog_fingerprint: HASH,
            total: 0,
            page: 1,
            page_size: 100,
            items: []
          }
        }
      })
      return
    }
    if (url.pathname === '/api/v1/workflows') {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            items: [],
            has_more: false,
            page: 1,
            page_size: 100
          }
        }
      })
      return
    }
    if (
      url.pathname === '/api/v1/workflow-tasks' ||
      url.pathname.includes('/jobs') ||
      url.pathname.includes('/feedbacks')
    ) {
      await route.fulfill({
        json: {
          code: 0,
          data: { items: [], total: 0, page: 1, page_size: 100 }
        }
      })
      return
    }
    await route.fulfill({ json: { code: 0, data: [] } })
  })
}

/** 构造覆盖主样品、转运、动作条和物料端口的已应用图。 */
function workflowAuthoringFixture(): Record<string, unknown> {
  const graph = {
    workflow: {
      uuid: WORKFLOW_UUID,
      revision: 7,
      name: 'X6 视觉回归'
    },
    nodes: [
      {
        uuid: '20000000-0000-4000-8000-000000000001',
        workflow_node_template_uuid: '30000000-0000-4000-8000-000000000001',
        name: '主样品',
        type: 'material_source',
        param: {
          mode: 'existing',
          flow_role: 'primary_sample',
          mount: { uuid: 'mount-primary' },
          resource_template_uuid: 'beaker-500ml'
        }
      },
      {
        uuid: '20000000-0000-4000-8000-000000000002',
        workflow_node_template_uuid: '30000000-0000-4000-8000-000000000002',
        name: '机械臂转运',
        type: 'workflow',
        param: {}
      },
      {
        uuid: '20000000-0000-4000-8000-000000000003',
        workflow_node_template_uuid: '30000000-0000-4000-8000-000000000003',
        name: '混合主样品',
        action_name: 'mix_sample',
        type: 'device_action',
        description: '将主样品与试剂均匀混合',
        param: {}
      },
      {
        uuid: '20000000-0000-4000-8000-000000000004',
        workflow_node_template_uuid: '30000000-0000-4000-8000-000000000003',
        name: '分析产物',
        action_name: 'analyze_sample',
        type: 'device_action',
        param: {}
      }
    ],
    edges: [
      {
        uuid: '40000000-0000-4000-8000-000000000001',
        source_node_uuid: '20000000-0000-4000-8000-000000000001',
        target_node_uuid: '20000000-0000-4000-8000-000000000002',
        source_handle_uuid: '50000000-0000-4000-8000-000000000001',
        target_handle_uuid: '50000000-0000-4000-8000-000000000002'
      },
      {
        uuid: '40000000-0000-4000-8000-000000000002',
        source_node_uuid: '20000000-0000-4000-8000-000000000002',
        target_node_uuid: '20000000-0000-4000-8000-000000000003',
        source_handle_uuid: '50000000-0000-4000-8000-000000000003',
        target_handle_uuid: '50000000-0000-4000-8000-000000000004'
      },
      {
        uuid: '40000000-0000-4000-8000-000000000003',
        source_node_uuid: '20000000-0000-4000-8000-000000000003',
        target_node_uuid: '20000000-0000-4000-8000-000000000004',
        source_handle_uuid: '50000000-0000-4000-8000-000000000005',
        target_handle_uuid: '50000000-0000-4000-8000-000000000004'
      }
    ],
    node_templates: [
      {
        uuid: '30000000-0000-4000-8000-000000000001',
        name: 'material_source',
        display_name: '物料来源',
        type: 'material_source',
        node_type: 'material_source'
      },
      {
        uuid: '30000000-0000-4000-8000-000000000002',
        name: 'material_transfer',
        display_name: '机械臂转运',
        type: 'workflow',
        node_type: 'workflow',
        schema: {
          'x-unilabos-workflow-contract': {
            version: 1,
            workflow_uuid: '60000000-0000-4000-8000-000000000001',
            contract_digest: HASH
          }
        },
        meta_data: {
          unilab: {
            workflow_source: { symbol: 'material_transfer' }
          }
        }
      },
      {
        uuid: '30000000-0000-4000-8000-000000000003',
        name: 'sample_action',
        display_name: '样品操作',
        type: 'device_action',
        node_type: 'device_action'
      }
    ],
    handle_templates: [
      handle('50000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001', 'material', 'source',
        'ResourceSlot'),
      handle('50000000-0000-4000-8000-000000000002',
        '30000000-0000-4000-8000-000000000002', 'sample', 'target',
        'ResourceSlot'),
      handle('50000000-0000-4000-8000-000000000003',
        '30000000-0000-4000-8000-000000000002', 'sample', 'source',
        'ResourceSlot'),
      handle('50000000-0000-4000-8000-000000000004',
        '30000000-0000-4000-8000-000000000003', 'sample', 'target',
        'ResourceSlot'),
      handle('50000000-0000-4000-8000-000000000005',
        '30000000-0000-4000-8000-000000000003', 'sample', 'source',
        'ResourceSlot'),
      handle('50000000-0000-4000-8000-000000000006',
        '30000000-0000-4000-8000-000000000003', 'ready', 'target',
        'Boolean'),
      handle('50000000-0000-4000-8000-000000000007',
        '30000000-0000-4000-8000-000000000003', 'ready', 'source',
        'Boolean')
    ]
  }
  return {
    workflow_uuid: WORKFLOW_UUID,
    workflow_revision: 7,
    state: 'applied',
    applied_graph: graph,
    draft: {
      source_uri: 'package://fixture/x6_style_regression.py',
      python_source: '# X6 style regression fixture\n',
      draft_hash: HASH,
      update_time: '2026-08-27T00:00:00Z',
      diagnostics: []
    },
    candidate: null,
    applied_source: {
      python_source: '# X6 style regression fixture\n',
      source_hash: HASH,
      source_map: [],
      workflow_revision: 7,
      compiler_version: 'x6-style-regression',
      template_catalog_fingerprint: HASH,
      update_time: '2026-08-27T00:00:00Z'
    }
  }
}

/** 构造一个稳定 HandleTemplate wire 对象。 */
function handle(
  uuid: string,
  templateUuid: string,
  key: string,
  ioType: 'source' | 'target',
  type: string
): Record<string, unknown> {
  return {
    uuid,
    workflow_node_template_uuid: templateUuid,
    handle_key: key,
    display_name: key === 'ready' ? '执行顺序' : '主样品',
    title: key === 'ready' ? '执行顺序' : '主样品',
    io_type: ioType,
    type,
    data_key: key,
    required: false
  }
}
