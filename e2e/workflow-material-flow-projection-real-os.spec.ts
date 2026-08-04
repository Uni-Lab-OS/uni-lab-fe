import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  startPersistentAuthoringOs,
  type PersistentAuthoringOs
} from './helpers/persistent-authoring-os'
import { installWorkflowPanel } from './helpers/workflow-runtime-ui'

const PREPARE_NODE_UUID = '20000000-0000-4000-8000-000000000001'
const ANALYZE_NODE_UUID = '20000000-0000-4000-8000-000000000002'
const VERIFY_NODE_UUID = '20000000-0000-4000-8000-000000000009'

interface AuthoringAggregate {
  workflow_revision: number
  draft: {
    draft_hash: string
    python_source: string
  } | null
  candidate: {
    candidate_hash: string
  } | null
}

let os: PersistentAuthoringOs

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  os = await startPersistentAuthoringOs()
  await installThreeActionMaterialFlow(os)
})

test.afterAll(async () => {
  await os?.stop()
})

test('real OS graph projects every ResourceSlot edge and Handle', async ({
  page
}) => {
  test.setTimeout(180_000)
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ||
      resolve(process.cwd(), '../e2e-artifacts/material-flow-projection')
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  const pageErrors: string[] = []
  const workflowRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/v1/')) {
      workflowRequests.push(`${request.method()} ${url.pathname}`)
    }
  })

  await installWorkflowPanel(page, os.workflowUuid)
  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  const panel = page.locator(
    '[data-panel-type="workflow-dag"][data-panel-instance-id="runtime-workflow"]'
  )
  await expect(panel.getByText('完整控制流 DAG')).toBeVisible()
  await panel.getByRole('button', { name: '画布模式', exact: true }).click()

  const materialEdges = panel.locator('.wf-flow-edge--material-trace')
  const materialHandles = panel.locator(
    '[data-workflow-handle-kind="material"]'
  )
  const materialPorts = panel.locator(
    '[data-workflow-material-port-variable]'
  )
  const structuralHandles = panel.locator(
    '[data-workflow-handle-kind="structural"]'
  )
  await expect(materialEdges).toHaveCount(2)
  await expect(materialHandles).toHaveCount(4)
  await expect(materialPorts).toHaveCount(4)
  expect(await structuralHandles.count()).toBeGreaterThan(0)
  await expect(panel.locator('.wf-node__port-summary')).toHaveCount(0)
  await expect(panel.locator('.wf-node__state--pending')).toHaveCount(0)
  await expect(panel.locator('.wf-node__material-chips')).toHaveCount(0)
  const verifyNode = panel.locator(
    `.wf-node[data-workflow-node-uuid="${VERIFY_NODE_UUID}"]`
  )
  const verifySamplePort = verifyNode.locator(
    '[data-workflow-material-port-variable="sample"]'
  )
  const verifyPreparedPort = verifyNode.locator(
    '[data-workflow-material-port-variable="prepared"]'
  )
  await expect(verifySamplePort).toHaveAttribute(
    'data-workflow-material-port-label',
    'Sample'
  )
  await expect(verifySamplePort).toHaveAttribute(
    'data-workflow-material-port-description',
    'sample contract'
  )
  await expect(verifyPreparedPort).toHaveAttribute(
    'data-workflow-material-port-label',
    'Prepared'
  )
  await expect(panel.locator(
    `.wf-node[data-workflow-node-uuid="${ANALYZE_NODE_UUID}"] ` +
    '[data-workflow-material-port-variable="prepared"]'
  )).toContainText('Prepared')
  const edgeLabels = await materialEdges.evaluateAll((edges) =>
    edges.map((edge) => edge.getAttribute('aria-label'))
  )
  expect(edgeLabels.sort()).toEqual([
    '物料流：prepared 到 verified',
    '物料流：verified 到 analyzed'
  ].sort())
  const materialHandleEvidence = await materialHandles.evaluateAll((handles) =>
    handles.map((handle) => ({
      ariaLabel: handle.getAttribute('aria-label'),
      borderColor: getComputedStyle(handle).borderColor,
      kind: handle.getAttribute('data-workflow-handle-kind')
    }))
  )
  expect(materialHandleEvidence.every((handle) =>
    handle.ariaLabel?.includes('物料') && handle.kind === 'material'
  )).toBe(true)
  expect(new Set(materialHandleEvidence.map((handle) => handle.borderColor)).size)
    .toBeGreaterThanOrEqual(2)
  const materialPortAlignmentEvidence = await materialHandles.evaluateAll(
    (handles) => handles.map((handle) => {
      const port = handle.closest<HTMLElement>(
        '[data-workflow-material-port-variable]'
      )
      const node = handle.closest<HTMLElement>('[data-workflow-node-uuid]')
      if (!port || !node) throw new Error('Material Handle lost its port card')
      const handleRect = handle.getBoundingClientRect()
      const portRect = port.getBoundingClientRect()
      const nodeRect = node.getBoundingClientRect()
      const ioType = handle.getAttribute('data-workflow-handle-io')
      const handleCenterX = handleRect.left + handleRect.width / 2
      const handleCenterY = handleRect.top + handleRect.height / 2
      return {
        variableName: port.dataset.workflowMaterialPortVariable,
        ioType,
        horizontalDelta: Math.abs(
          handleCenterX - (portRect.left + portRect.width / 2)
        ),
        nodeEdgeDelta: Math.abs(
          handleCenterY - (ioType === 'target' ? nodeRect.top : nodeRect.bottom)
        ),
        cardInsideNode:
          portRect.left >= nodeRect.left && portRect.right <= nodeRect.right
      }
    })
  )
  expect(materialPortAlignmentEvidence.every((port) =>
    port.horizontalDelta <= 1.5 &&
    port.nodeEdgeDelta <= 1.5 &&
    port.cardInsideNode
  )).toBe(true)
  const structuralHandleEvidence = await structuralHandles.evaluateAll(
    (handles) => handles.map((handle) => ({
      kind: handle.getAttribute('data-workflow-handle-kind'),
      visibility: getComputedStyle(handle).visibility
    }))
  )
  expect(structuralHandleEvidence.every((handle) =>
    handle.kind === 'structural' && handle.visibility === 'hidden'
  )).toBe(true)
  const edgeMotionEvidence = await materialEdges.evaluateAll((edges) =>
    edges.map((edge) => {
      const path = edge.querySelector<SVGPathElement>('.react-flow__edge-path')
      const style = path ? getComputedStyle(path) : null
      return {
        animated: edge.classList.contains('animated'),
        animationName: style?.animationName ?? 'none',
        markerEnd: style?.markerEnd ?? 'none',
        strokeDasharray: style?.strokeDasharray ?? 'none'
      }
    })
  )
  expect(edgeMotionEvidence.every((edge) =>
    edge.animated &&
    edge.animationName !== 'none' &&
    edge.markerEnd !== 'none' &&
    edge.strokeDasharray !== 'none'
  )).toBe(true)
  await capture(page, artifactDirectory, '01-complete-material-flow.png')

  await panel.locator(
    `.wf-node[data-workflow-node-uuid="${PREPARE_NODE_UUID}"]`
  ).click()
  await expect(panel.getByRole('complementary', {
    name: '画布节点编辑器'
  })).toBeVisible()
  await capture(page, artifactDirectory, '02-producer-node-selected.png')

  await panel.locator(
    `.wf-node[data-workflow-node-uuid="${VERIFY_NODE_UUID}"]`
  ).click()
  await verifySamplePort.hover()
  await expect.poll(() => verifySamplePort.evaluate((port) =>
    getComputedStyle(port, '::after').opacity
  )).toBe('1')
  await capture(page, artifactDirectory, '03-middle-node-material-ports.png')

  await page.setViewportSize({ width: 1180, height: 900 })
  await expect(materialEdges).toHaveCount(2)
  await capture(page, artifactDirectory, '04-medium-workbench.png')

  await page.setViewportSize({ width: 1680, height: 1050 })
  await expect(materialEdges).toHaveCount(2)
  await capture(page, artifactDirectory, '05-material-flow-direction.png')

  expect(workflowRequests).toContain(
    `GET /api/v1/workflows/${os.workflowUuid}/authoring`
  )
  expect(browserErrors).toEqual([])
  expect(pageErrors).toEqual([])
  writeFileSync(
    join(artifactDirectory, 'projection-evidence.json'),
    `${JSON.stringify({
      edgeLabels,
      materialHandleEvidence,
      materialPortAlignmentEvidence,
      structuralHandleEvidence,
      edgeMotionEvidence,
      workflowRequests,
      browserErrors,
      pageErrors,
      screenshots: [
        '01-complete-material-flow.png',
        '02-producer-node-selected.png',
        '03-middle-node-material-ports.png',
        '04-medium-workbench.png',
        '05-material-flow-direction.png'
      ]
    }, null, 2)}\n`
  )
})

async function installThreeActionMaterialFlow(
  currentOs: PersistentAuthoringOs
): Promise<void> {
  const authoringUrl =
    `${currentOs.url}/api/v1/workflows/${currentOs.workflowUuid}/authoring`
  const before = await readEnvelope<AuthoringAggregate>(authoringUrl)
  if (!before.draft) throw new Error('Authoring fixture draft is missing')
  const analyzeMarker =
    `    # unilab:node_uuid=${ANALYZE_NODE_UUID}\n` +
    '    analyzed = reactor.analyze('
  const verifyAction =
    `    # unilab:node_uuid=${VERIFY_NODE_UUID}\n` +
    '    verified = reactor.prepare(\n' +
    '        sample=prepared.prepared,\n' +
    '        cycles=cycles,\n' +
    '        note=note,\n' +
    '    )\n'
  const pythonSource = before.draft.python_source
    .replace(analyzeMarker, `${verifyAction}${analyzeMarker}`)
    .replace(
      '        prepared=prepared.prepared,\n',
      '        prepared=verified.prepared,\n'
    )
    .replace(
      '        sample=prepared.prepared,\n        report=analyzed.report,',
      '        sample=verified.prepared,\n        report=analyzed.report,'
    )
  if (!pythonSource.includes(`node_uuid=${VERIFY_NODE_UUID}`)) {
    throw new Error('Unable to install the three-Action material fixture')
  }
  const saved = await readEnvelope<AuthoringAggregate>(`${authoringUrl}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      python_source: pythonSource,
      expected_draft_hash: before.draft.draft_hash,
      expected_workflow_revision: before.workflow_revision
    })
  })
  if (!saved.candidate) {
    throw new Error('Three-Action material fixture did not compile')
  }
}

async function readEnvelope<Value>(
  url: string,
  init?: RequestInit
): Promise<Value> {
  const response = await fetch(url, init)
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
