import {
  expect,
  test,
  type Locator,
  type Page,
  type Request
} from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  startSzlabMaterialWorkflowOs,
  type SzlabMaterialWorkflowOs
} from './helpers/szlab-action-catalog-os'
import { installWorkflowPanel } from './helpers/workflow-runtime-ui'

const S07_WORKFLOW_UUID = '5e7ce142-bf5a-5d30-8666-fdf5374941f1'
const SOURCE_BEAKER_UUID = 'af599d17-1d6c-5f34-a2f1-dc5239d1275d'
const SOURCE_POWDER_UUID = 'f7969031-098d-52eb-9193-92e41de3f3da'
const BEAKER_GROUP_UUID = '115b2549-9202-518c-9aac-0a71de8ba72f'
const POWDER_GROUP_UUID = 'b6337f56-31f2-55c1-ab9d-f44e1b956e50'
const DOSING_JOIN_UUID = '58198f7a-eec4-5276-9bc5-5dd5b54c4b06'

interface AuthoringGraph {
  nodes: Array<{ uuid: string; name: string; type: string }>
  edges: Array<{
    source_node_uuid: string
    target_node_uuid: string
    source_handle_uuid: string
    target_handle_uuid: string
  }>
}

interface AuthoringAggregate {
  applied_graph: AuthoringGraph
  candidate: { graph: AuthoringGraph } | null
}

let os: SzlabMaterialWorkflowOs

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  os = await startSzlabMaterialWorkflowOs()
})

test.afterAll(async () => {
  await os?.stop()
})

test('SZLab S07 powder dosing projects the complete material flow', async ({
  page
}) => {
  test.setTimeout(180_000)
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ||
      resolve(process.cwd(), '../e2e-artifacts/szlab-s07-material-flow')
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  const pageErrors: string[] = []
  const workflowRequests: string[] = []
  const failedRequests: string[] = []
  const requestStartedAt = new Map<Request, number>()
  const responseTimings: Array<{
    request: string
    status: number
    durationMs: number
  }> = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/v1/')) {
      workflowRequests.push(`${request.method()} ${url.pathname}`)
      requestStartedAt.set(request, Date.now())
    }
  })
  page.on('requestfailed', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/v1/')) return
    failedRequests.push(
      `${request.method()} ${url.pathname}: ` +
      (request.failure()?.errorText ?? '未知错误')
    )
  })
  page.on('response', (response) => {
    const request = response.request()
    const startedAt = requestStartedAt.get(request)
    const url = new URL(request.url())
    if (startedAt === undefined || !url.pathname.startsWith('/api/v1/')) return
    responseTimings.push({
      request: `${request.method()} ${url.pathname}`,
      status: response.status(),
      durationMs: Date.now() - startedAt
    })
  })

  expect(os.workflowUuid).toBe(S07_WORKFLOW_UUID)
  const aggregate = await readEnvelope<AuthoringAggregate>(
    `${os.url}/api/v1/workflows/${S07_WORKFLOW_UUID}/authoring`
  )
  const graph = aggregate.candidate?.graph ?? aggregate.applied_graph
  const osEvidence = `${JSON.stringify(aggregate, null, 2)}\n${os.logs()}`
  expect(graph.nodes, osEvidence).toHaveLength(12)
  expect(graph.edges).toHaveLength(9)
  expect(graph.nodes.map((node) => node.uuid)).toEqual(expect.arrayContaining([
    SOURCE_BEAKER_UUID,
    SOURCE_POWDER_UUID,
    BEAKER_GROUP_UUID,
    POWDER_GROUP_UUID,
    DOSING_JOIN_UUID
  ]))

  await installWorkflowPanel(page, S07_WORKFLOW_UUID)
  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  const panel = page.locator(
    '[data-panel-type="workflow-dag"][data-panel-instance-id="runtime-workflow"]'
  )
  await expect(panel.getByText('完整控制流 DAG')).toBeVisible()
  const canvasModeButton = panel.getByRole('button', {
    name: '画布模式',
    exact: true
  })
  await expect(canvasModeButton).toBeEnabled()
  await canvasModeButton.click()
  await expect(canvasModeButton).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByText(
    '画布模式：Python 是 OS 生成的只读投影',
    { exact: true }
  )).toBeVisible()
  expect(failedRequests).toEqual([])
  await expect(panel.getByRole('alert').filter({
    hasText: '工作流编辑操作失败'
  })).toHaveCount(0)

  const runToolbar = panel.locator('.persistent-authoring__toolbar-run')
  await expect(runToolbar).toBeVisible()
  const toolbarLayoutEvidence = await runToolbar.evaluate((toolbar) => {
    const modeSwitch = toolbar.querySelector<HTMLElement>(
      '.workflow__run-mode'
    )
    const primaryAction = toolbar.querySelector<HTMLElement>(
      '.workflow-runtime__primary'
    )
    if (!modeSwitch || !primaryAction) {
      throw new Error('工作流运行区缺少模式切换或开始运行按钮')
    }
    const toolbarRect = toolbar.getBoundingClientRect()
    const modeRect = modeSwitch.getBoundingClientRect()
    const actionRect = primaryAction.getBoundingClientRect()
    return {
      leftInset: Math.abs(modeRect.left - toolbarRect.left),
      rightInset: Math.abs(toolbarRect.right - actionRect.right),
      modeTopInset: Math.abs(modeRect.top - toolbarRect.top),
      modeBottomInset: Math.abs(toolbarRect.bottom - modeRect.bottom),
      actionTopInset: Math.abs(actionRect.top - toolbarRect.top),
      actionBottomInset: Math.abs(toolbarRect.bottom - actionRect.bottom),
      separationGap: actionRect.left - modeRect.right
    }
  })
  const { separationGap, ...toolbarEdgeInsets } = toolbarLayoutEvidence
  expect(Object.values(toolbarEdgeInsets).every((inset) => inset <= 0.5))
    .toBe(true)
  expect(separationGap).toBeGreaterThanOrEqual(7.5)

  const outputTabs = panel.getByRole('tablist', {
    name: '运行输出类型'
  })
  await expect(outputTabs).toBeVisible()
  const outputTabGeometryEvidence = await outputTabs.evaluate((tabList) => {
    const parentRect = tabList.getBoundingClientRect()
    return Array.from(tabList.querySelectorAll<HTMLElement>('[role="tab"]'))
      .map((tab) => {
        const tabRect = tab.getBoundingClientRect()
        return {
          label: tab.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          parentHeight: parentRect.height,
          tabHeight: tabRect.height,
          overflow: {
            top: Math.max(0, parentRect.top - tabRect.top),
            right: Math.max(0, tabRect.right - parentRect.right),
            bottom: Math.max(0, tabRect.bottom - parentRect.bottom),
            left: Math.max(0, parentRect.left - tabRect.left)
          }
        }
      })
  })
  expect(outputTabGeometryEvidence).toHaveLength(3)
  expect(outputTabGeometryEvidence.every((tab) =>
    Math.max(...Object.values(tab.overflow)) <= 0.5
  ), JSON.stringify(outputTabGeometryEvidence, null, 2)).toBe(true)

  const nodes = panel.locator('.wf-node[data-workflow-node-uuid]')
  const materialSources = panel.locator(
    '.wf-node[data-workflow-node-kind="material_source"]'
  )
  const materialEdges = panel.locator('.wf-flow-edge--material-trace')
  const materialHandles = panel.locator(
    '[data-workflow-handle-kind="material"]'
  )
  const structuralHandles = panel.locator(
    '[data-workflow-handle-kind="structural"]'
  )
  await expect(nodes).toHaveCount(12)
  await expect(materialSources).toHaveCount(2)
  await expect(materialEdges).toHaveCount(9)
  await expect(materialHandles).toHaveCount(18)
  await expect(panel.locator('.wf-node__port-summary')).toHaveCount(0)
  await expect(panel.locator('.wf-node__state--pending')).toHaveCount(0)

  const joinNode = workflowNode(panel, DOSING_JOIN_UUID)
  const joinInputs = joinNode.locator(
    '[data-workflow-material-port-variable] ' +
    '[data-workflow-handle-kind="material"]' +
    '[data-workflow-handle-io="target"]'
  )
  await expect(joinInputs).toHaveCount(2)
  await expect(joinNode.locator(
    '[data-workflow-material-port-variable="beaker"]'
  )).toBeVisible()
  await expect(joinNode.locator(
    '[data-workflow-material-port-variable="powder_cartridge"]'
  )).toBeVisible()

  const alignmentEvidence = await materialHandles.evaluateAll((handles) =>
    handles.map((handle) => {
      const port = handle.closest<HTMLElement>(
        '[data-workflow-material-port-variable]'
      )
      const node = handle.closest<HTMLElement>('[data-workflow-node-uuid]')
      if (!port || !node) throw new Error('物料句柄没有对应的端口卡片')
      const handleRect = handle.getBoundingClientRect()
      const portRect = port.getBoundingClientRect()
      const nodeRect = node.getBoundingClientRect()
      const ioType = handle.getAttribute('data-workflow-handle-io')
      return {
        variableName: port.dataset.workflowMaterialPortVariable,
        ioType,
        horizontalDelta: Math.abs(
          handleRect.left + handleRect.width / 2 -
          (portRect.left + portRect.width / 2)
        ),
        nodeEdgeDelta: Math.abs(
          handleRect.top + handleRect.height / 2 -
          (ioType === 'target' ? nodeRect.top : nodeRect.bottom)
        )
      }
    })
  )
  expect(alignmentEvidence.every((port) =>
    port.horizontalDelta <= 1.5 && port.nodeEdgeDelta <= 1.5
  )).toBe(true)
  const structuralEvidence = await structuralHandles.evaluateAll((handles) =>
    handles.map((handle) => getComputedStyle(handle).visibility)
  )
  expect(structuralEvidence.every((visibility) => visibility === 'hidden'))
    .toBe(true)
  const motionEvidence = await materialEdges.evaluateAll((edges) =>
    edges.map((edge) => {
      const path = edge.querySelector<SVGPathElement>('.react-flow__edge-path')
      const style = path ? getComputedStyle(path) : null
      return {
        animated: edge.classList.contains('animated'),
        animationName: style?.animationName ?? 'none',
        markerEnd: style?.markerEnd ?? 'none'
      }
    })
  )
  expect(motionEvidence.every((edge) =>
    edge.animated && edge.animationName !== 'none' && edge.markerEnd !== 'none'
  )).toBe(true)

  await capture(page, artifactDirectory, '01-s07-complete-material-flow.png')
  await selectAndCapture(
    page,
    panel,
    SOURCE_BEAKER_UUID,
    artifactDirectory,
    '02-beaker-material-source.png'
  )
  await selectAndCapture(
    page,
    panel,
    BEAKER_GROUP_UUID,
    artifactDirectory,
    '03-beaker-transfer-branch.png'
  )
  await selectAndCapture(
    page,
    panel,
    POWDER_GROUP_UUID,
    artifactDirectory,
    '04-powder-transfer-branch.png'
  )
  await selectAndCapture(
    page,
    panel,
    DOSING_JOIN_UUID,
    artifactDirectory,
    '05-dual-material-dosing-join.png'
  )
  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(materialEdges).toHaveCount(9)
  await capture(page, artifactDirectory, '06-medium-workbench.png')
  await runToolbar.screenshot({
    path: join(artifactDirectory, '07-run-toolbar-cluster.png'),
    animations: 'disabled'
  })
  await panel.locator('.workflow-runtime__output-header').screenshot({
    path: join(artifactDirectory, '08-run-output-tabs.png'),
    animations: 'disabled'
  })

  expect(workflowRequests).toContain(
    `GET /api/v1/workflows/${S07_WORKFLOW_UUID}/authoring`
  )
  expect(browserErrors).toEqual([])
  expect(pageErrors).toEqual([])
  writeFileSync(
    join(artifactDirectory, 'evidence.json'),
    `${JSON.stringify({
      osUrl: os.url,
      workflowUuid: S07_WORKFLOW_UUID,
      sourceRevision: os.szlabRevision,
      graph: { nodes: graph.nodes.length, edges: graph.edges.length },
      alignmentEvidence,
      structuralEvidence,
      motionEvidence,
      toolbarLayoutEvidence,
      outputTabGeometryEvidence,
      workflowRequests,
      failedRequests,
      responseTimings,
      browserErrors,
      pageErrors,
      screenshots: [
        '01-s07-complete-material-flow.png',
        '02-beaker-material-source.png',
        '03-beaker-transfer-branch.png',
        '04-powder-transfer-branch.png',
        '05-dual-material-dosing-join.png',
        '06-medium-workbench.png',
        '07-run-toolbar-cluster.png',
        '08-run-output-tabs.png'
      ]
    }, null, 2)}\n`
  )
})

function workflowNode(panel: Locator, uuid: string): Locator {
  return panel.locator(`.wf-node[data-workflow-node-uuid="${uuid}"]`)
}

async function selectAndCapture(
  page: Page,
  panel: Locator,
  uuid: string,
  artifactDirectory: string,
  name: string
): Promise<void> {
  const node = workflowNode(panel, uuid)
  await node.click()
  await expect(node).toBeVisible()
  await expect(panel.getByRole('complementary', {
    name: '画布节点编辑器'
  })).toBeVisible()
  await capture(page, artifactDirectory, name)
}

async function readEnvelope<Value>(url: string): Promise<Value> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  const envelope = await response.json() as { code: number; data: Value }
  if (envelope.code !== 0) {
    throw new Error(`${url} returned envelope code ${envelope.code}`)
  }
  return envelope.data
}

async function capture(
  page: Page,
  artifactDirectory: string,
  name: string
): Promise<void> {
  await page.screenshot({
    path: join(artifactDirectory, name),
    fullPage: true,
    animations: 'disabled'
  })
}
