import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  M2B_ALTERNATE_SITE_UUID,
  M2B_MOUNT_UUID,
  M2B_SITE_UUID,
  readGitRevision,
  startM2bNativeCliOs,
  type M2bNativeCliOs
} from './helpers/m2b-native-cli-os'
import { installWorkflowPanel } from './helpers/workflow-runtime-ui'

interface InventoryMaterial {
  uuid: string
  resource_template_uuid: string
}

interface InventorySite {
  uuid: string
  material_uuid: string
  occupied_material_uuid?: string
}

interface InventoryReservation {
  workflow_task_uuid: string
  status: string
  members: Array<{ material_uuid: string }>
}

interface InventorySnapshot {
  materials: InventoryMaterial[]
  sites: InventorySite[]
  material_reservations: InventoryReservation[]
  inventory_lots: unknown[]
  snapshot_sequence: number
}

interface InventoryLedger {
  entries: Array<{
    ledger_id: number
    op_type: string
    aggregate_id: string
    causation_id: string
  }>
}

let os: M2bNativeCliOs

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  os = await startM2bNativeCliOs()
})

test.afterAll(async () => {
  await os?.stop()
})

test('LINQ-inspired MaterialSource starts through native unilab and commits Inventory', async ({
  page
}) => {
  test.setTimeout(180_000)
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ||
      resolve(process.cwd(), '../e2e-artifacts/m2b-material-source-native-cli')
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  const pageErrors: string[] = []
  const websocketUrls: string[] = []
  const requests: Array<{ method: string; path: string }> = []
  const responses: Array<{ method: string; path: string; status: number }> = []

  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('websocket', (socket) => websocketUrls.push(socket.url()))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/v1/')) return
    requests.push({
      method: request.method(),
      path: `${url.pathname}${url.search}`
    })
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (!url.pathname.startsWith('/api/v1/')) return
    responses.push({
      method: response.request().method(),
      path: `${url.pathname}${url.search}`,
      status: response.status()
    })
  })

  const inventoryBefore = await readJson<InventorySnapshot>(
    `${os.url}/api/v1/inventory/snapshot`
  )
  const ledgerBefore = await readJson<InventoryLedger>(
    `${os.url}/api/v1/inventory/ledger`
  )
  const outboxBefore = await readJson<{ backlog: number }>(
    `${os.url}/api/v1/inventory/outbox/backlog`
  )
  expect(inventoryBefore.materials).toHaveLength(1)
  expect(inventoryBefore.materials[0]?.uuid).toBe(M2B_MOUNT_UUID)
  expect(inventoryBefore.sites).toEqual([
    expect.objectContaining({
      uuid: M2B_SITE_UUID,
      material_uuid: M2B_MOUNT_UUID
    }),
    expect.objectContaining({
      uuid: M2B_ALTERNATE_SITE_UUID,
      material_uuid: M2B_MOUNT_UUID
    })
  ])
  expect(inventoryBefore.sites.every(
    (site) => site.occupied_material_uuid === undefined
  )).toBe(true)
  expect(inventoryBefore.material_reservations).toEqual([])
  const authoringBefore = await readEnvelope<{
    candidate: {
      graph: {
        nodes: Array<{
          uuid: string
          param: { resource_template_uuid: string }
        }>
      }
    }
  }>(`${os.url}/api/v1/workflows/${os.workflowUuid}/authoring`)
  const resourceTemplateUuid = authoringBefore.candidate.graph.nodes.find(
    (node) => node.uuid === os.sourceNodeUuid
  )?.param.resource_template_uuid
  expect(resourceTemplateUuid).toMatch(UUID_PATTERN)
  if (!resourceTemplateUuid) {
    throw new Error('Candidate MaterialSource ResourceTemplate UUID missing')
  }

  await installWorkflowPanel(page, os.workflowUuid)
  await page.goto(
    `/?section=workflow&localOsUrl=${encodeURIComponent(os.url)}`
  )
  const panel = page.locator(
    '[data-panel-type="workflow-dag"][data-panel-instance-id="runtime-workflow"]'
  )
  await expect(panel.getByText('完整控制流 DAG')).toBeVisible()
  await panel.getByRole('button', { name: '画布模式', exact: true }).click()
  const materialSourcePaletteButton = panel.getByRole('button', {
    name: /物料来源 OS 准入声明/
  })
  await expect(materialSourcePaletteButton).toBeEnabled()
  await materialSourcePaletteButton.click()
  await expect(panel.locator('[data-workflow-node-uuid]')).toHaveCount(2)
  await expect(panel.getByRole('region', {
    name: '物料来源属性'
  })).toBeVisible()

  await page.reload()
  await expect(panel.getByText('完整控制流 DAG')).toBeVisible()
  await panel.getByRole('button', { name: '画布模式', exact: true }).click()
  await expect(materialSourcePaletteButton).toBeEnabled()

  const sourceNode = panel.locator(
    `[data-workflow-node-uuid="${os.sourceNodeUuid}"]`
  )
  await expect(sourceNode).toBeVisible()
  await sourceNode.click({ position: { x: 42, y: 42 } })
  const nodeEditor = panel.getByRole('complementary', {
    name: '画布节点编辑器'
  })
  const inspector = nodeEditor.getByRole('region', {
    name: '物料来源属性'
  })
  await expect(inspector).toBeVisible()
  await expect(inspector.getByLabel('物料角色')).toHaveValue('consumable')
  await expect(inspector.getByRole('button', {
    name: '新建物料',
    exact: true
  })).toHaveAttribute('aria-pressed', 'true')
  await expect(inspector.getByLabel('资源模板')).toHaveValue(
    resourceTemplateUuid
  )
  await expect(inspector.getByLabel('挂载点')).toHaveValue(M2B_MOUNT_UUID)
  await expect(inspector.getByLabel('库位范围')).toHaveValue('fixed')
  await expect(inspector.getByLabel('固定库位')).toHaveValue(M2B_SITE_UUID)
  await expect(inspector.getByLabel('固定物料')).toHaveCount(0)
  await expect(inspector.getByText(/Content|Closure State|Comments/)).toHaveCount(0)
  await inspector.getByRole('button', {
    name: '已有物料',
    exact: true
  }).click()
  await expect(inspector.getByLabel('固定物料')).toBeVisible()
  await inspector.getByRole('button', {
    name: '新建物料',
    exact: true
  }).click()
  await expect(inspector.getByLabel('固定物料')).toHaveCount(0)
  await inspector.getByLabel('库位范围').selectOption('all')
  await expect(inspector.getByLabel('固定库位')).toHaveCount(0)
  await inspector.getByLabel('库位范围').selectOption('candidates')
  const siteSearch = inspector.getByLabel('搜索候选库位')
  await expect(siteSearch).toBeVisible()
  await expect(inspector.getByText('已选择 1 / 2')).toBeVisible()
  await siteSearch.fill('Slot 2')
  const candidateSites = inspector.getByRole('group', { name: '候选库位' })
  await expect(candidateSites.getByRole('checkbox', { name: /Slot 1/ }))
    .toHaveCount(0)
  const filteredSite = candidateSites.getByRole('checkbox', { name: /Slot 2/ })
  await expect(filteredSite).toBeVisible()
  await filteredSite.check()
  await expect(inspector.getByText(/已选择 2 \/ 2/)).toBeVisible()
  await inspector.getByLabel('库位范围').selectOption('fixed')
  await inspector.getByLabel('固定库位').selectOption(M2B_SITE_UUID)
  await inspector.getByLabel('物料角色').selectOption('reagent')
  await expect(inspector.getByLabel('物料角色')).toHaveValue('reagent')
  await screenshot(page, artifactDirectory, '01-material-source-properties.png')

  await panel.getByRole('button', { name: '保存草稿', exact: true }).click()
  const diff = page.getByRole('dialog', { name: '完整 Python 差异' })
  await expect(diff).toBeVisible()
  await screenshot(page, artifactDirectory, '02-canonical-python-diff.png')
  const draftSaved = page.waitForResponse((response) =>
    response.url().endsWith(
      `/api/v1/workflows/${os.workflowUuid}/authoring/draft`
    ) && response.request().method() === 'PUT' && response.status() === 200
  )
  await diff.getByRole('button', {
    name: '接受完整差异并保存',
    exact: true
  }).click()
  await draftSaved
  await expect(diff).toBeHidden()

  const applied = page.waitForResponse((response) =>
    response.url().endsWith(
      `/api/v1/workflows/${os.workflowUuid}/authoring/apply`
    ) && response.request().method() === 'POST' && response.status() === 200
  )
  await panel.getByRole('button', {
    name: '应用工作流',
    exact: true
  }).click()
  await applied
  await expect(panel.getByText(/(?:工作流|源码)已应用/)).toBeVisible()
  await expect(panel.getByRole('button', {
    name: '开始运行',
    exact: true
  })).toBeEnabled()
  await screenshot(page, artifactDirectory, '03-applied-material-graph.png')

  const taskCreated = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/workflow-tasks' &&
      response.request().method() === 'POST' && response.status() === 201
  )
  await panel.getByRole('button', {
    name: '开始运行',
    exact: true
  }).click()
  await panel.getByRole('button', {
    name: '使用以上参数运行',
    exact: true
  }).click()
  const taskEnvelope = await (await taskCreated).json() as {
    data: { uuid: string }
  }
  const taskUuid = taskEnvelope.data.uuid
  expect(taskUuid).toMatch(UUID_PATTERN)

  let inventoryAfter = inventoryBefore
  await expect.poll(async () => {
    inventoryAfter = await readJson<InventorySnapshot>(
      `${os.url}/api/v1/inventory/snapshot`
    )
    return {
      materialCount: inventoryAfter.materials.length,
      occupied: inventoryAfter.sites.find(
        (site) => site.uuid === M2B_SITE_UUID
      )?.occupied_material_uuid,
      reservationTask: inventoryAfter.material_reservations[0]
        ?.workflow_task_uuid
    }
  }, {
    timeout: 30_000,
    message: `Inventory admission did not commit\n${os.logs().slice(-8_000)}`
  }).toEqual({
    materialCount: 2,
    occupied: expect.stringMatching(UUID_PATTERN),
    reservationTask: taskUuid
  })

  const sourceJob = await waitForSourceJob(os.url, taskUuid)
  expect(sourceJob).toMatchObject({
    workflow_node_uuid: os.sourceNodeUuid,
    executor_kind: 'material_source',
    status: 'succeeded',
    return_info: {
      material: {
        resource_template_uuid: resourceTemplateUuid
      }
    }
  })
  const createdMaterialUuid = sourceJob.return_info.material.uuid
  expect(createdMaterialUuid).toMatch(UUID_PATTERN)
  expect(inventoryAfter.materials.find(
    (material) => material.uuid === createdMaterialUuid
  )).toEqual(expect.objectContaining({
    resource_template_uuid: resourceTemplateUuid
  }))
  expect(inventoryAfter.sites.find(
    (site) => site.uuid === M2B_SITE_UUID
  )?.occupied_material_uuid).toBe(createdMaterialUuid)
  expect(inventoryAfter.material_reservations).toEqual([
    expect.objectContaining({
      workflow_task_uuid: taskUuid,
      status: 'active',
      members: [expect.objectContaining({ material_uuid: createdMaterialUuid })]
    })
  ])
  expect(inventoryAfter.inventory_lots).toEqual(inventoryBefore.inventory_lots)
  expect(inventoryAfter.snapshot_sequence).toBeGreaterThanOrEqual(
    inventoryBefore.snapshot_sequence + 3
  )

  await expect(sourceNode.getByText('物料已绑定', { exact: true })).toBeVisible()
  await sourceNode.click({ position: { x: 42, y: 42 } })
  await expect(inspector.getByText('物料已绑定', { exact: true })).toBeVisible()
  await screenshot(page, artifactDirectory, '04-inventory-admission-succeeded.png')

  const inventoryLedger = await readJson<InventoryLedger>(
    `${os.url}/api/v1/inventory/ledger`
  )
  const outboxAfter = await readJson<{ backlog: number }>(
    `${os.url}/api/v1/inventory/outbox/backlog`
  )
  const admittedEntries = inventoryLedger.entries.slice(
    ledgerBefore.entries.length
  )
  expect(admittedEntries.map((entry) => entry.op_type)).toEqual([
    'material.created',
    'site.occupancy_updated',
    'material_reservation.admitted'
  ])
  expect(admittedEntries.map((entry) => entry.aggregate_id)).toEqual([
    createdMaterialUuid,
    M2B_SITE_UUID,
    expect.stringMatching(UUID_PATTERN)
  ])
  expect(new Set(admittedEntries.map((entry) => entry.causation_id)).size)
    .toBe(1)
  expect(outboxAfter.backlog).toBeGreaterThanOrEqual(outboxBefore.backlog + 3)

  const startButton = panel.getByRole('button', {
    name: '开始运行',
    exact: true
  })
  await expect(startButton).toBeEnabled()
  const blockedCreated = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/workflow-tasks' &&
    response.request().method() === 'POST' && response.status() === 201
  )
  await startButton.click()
  await panel.getByRole('button', {
    name: '使用以上参数运行',
    exact: true
  }).click()
  const blockedTaskUuid = ((await (await blockedCreated).json()) as {
    data: { uuid: string }
  }).data.uuid
  const blockedTask = await waitForTaskStatus(
    os.url,
    blockedTaskUuid,
    'admission_blocked'
  )
  const blockedJob = await waitForSourceJobStatus(
    os.url,
    blockedTaskUuid,
    'pending'
  )
  expect(blockedJob.return_info).toEqual({})
  await expect(panel.getByText('等待物料准入', { exact: true })).toBeVisible()
  await expect(sourceNode.getByText('等待物料', { exact: true })).toBeVisible()
  for (const command of ['暂停', '继续', '单步']) {
    await expect(panel.getByRole('button', {
      name: command,
      exact: true
    })).toBeDisabled()
  }
  const cancelButton = panel.getByRole('button', {
    name: '取消',
    exact: true
  })
  await expect(cancelButton).toBeEnabled()
  await screenshot(page, artifactDirectory, '05-admission-blocked.png')
  await cancelButton.click()
  await waitForTaskStatus(os.url, blockedTaskUuid, 'canceled')
  const inventoryBeforeStaticReject = await readJson<InventorySnapshot>(
    `${os.url}/api/v1/inventory/snapshot`
  )

  await page.reload()
  await expect(panel.getByText('完整控制流 DAG')).toBeVisible()
  await panel.getByRole('button', { name: '画布模式', exact: true }).click()
  await sourceNode.click({ position: { x: 42, y: 42 } })
  await inspector.getByRole('button', {
    name: '已有物料',
    exact: true
  }).click()
  await inspector.getByLabel('固定物料').selectOption(createdMaterialUuid)
  await inspector.getByLabel('库位范围').selectOption('fixed')
  await inspector.getByLabel('固定库位').selectOption(M2B_ALTERNATE_SITE_UUID)

  await panel.getByRole('button', { name: '保存草稿', exact: true }).click()
  const staticReject = panel.getByRole('alert').filter({
    hasText: 'material_source_conflict'
  })
  await expect(staticReject).toContainText(
    'MaterialSource 与 mount/Site 静态事实冲突'
  )
  await expect(page.getByRole('dialog', {
    name: '完整 Python 差异'
  })).toHaveCount(0)
  await screenshot(page, artifactDirectory, '06-static-location-mismatch-rejected.png')
  const inventoryAfterReject = await readJson<InventorySnapshot>(
    `${os.url}/api/v1/inventory/snapshot`
  )
  expect(inventoryAfterReject.materials)
    .toEqual(inventoryBeforeStaticReject.materials)
  expect(inventoryAfterReject.sites).toEqual(inventoryBeforeStaticReject.sites)
  expect(inventoryAfterReject.material_reservations)
    .toEqual(inventoryBeforeStaticReject.material_reservations)
  expect(inventoryAfterReject.inventory_lots)
    .toEqual(inventoryBeforeStaticReject.inventory_lots)

  await page.reload()
  await expect(panel.getByText('完整控制流 DAG')).toBeVisible()
  await panel.getByRole('button', { name: '画布模式', exact: true }).click()
  await sourceNode.click({ position: { x: 42, y: 42 } })

  await page.setViewportSize({ width: 900, height: 1050 })
  await expect(inspector).toBeVisible()
  const mediumNodeBox = await sourceNode.boundingBox()
  const mediumInspectorBox = await nodeEditor.boundingBox()
  await screenshot(page, artifactDirectory, '07-responsive-properties-sheet.png')
  expect({
    overlap: boxesOverlap(mediumNodeBox, mediumInspectorBox),
    mediumNodeBox,
    mediumInspectorBox
  }).toMatchObject({ overlap: false })

  await page.setViewportSize({ width: 600, height: 1400 })
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>('*')) {
      if (element.scrollHeight > element.clientHeight) element.scrollTop = 0
    }
  })
  const narrowStartButton = panel.getByRole('button', {
    name: '开始运行',
    exact: true
  })
  await expect(narrowStartButton).toBeInViewport()
  const narrowStartBox = await narrowStartButton.boundingBox()
  const narrowPanelBox = await panel.boundingBox()
  expect(narrowStartBox).not.toBeNull()
  expect(narrowPanelBox).not.toBeNull()
  expect(narrowStartBox?.x).toBeGreaterThanOrEqual(narrowPanelBox?.x ?? 0)
  expect((narrowStartBox?.x ?? 0) + (narrowStartBox?.width ?? 0))
    .toBeLessThanOrEqual(
      (narrowPanelBox?.x ?? 0) + (narrowPanelBox?.width ?? 0)
    )
  expect(narrowStartBox?.y).toBeGreaterThanOrEqual(0)
  expect((narrowStartBox?.y ?? 0) + (narrowStartBox?.height ?? 0))
    .toBeLessThanOrEqual(1400)
  await expect(inspector).toBeVisible()
  const inspectorBox = await nodeEditor.boundingBox()
  expect(inspectorBox?.width).toBeGreaterThan(450)
  const sourceNodeWrapper = sourceNode.locator('xpath=..')
  await panel.getByRole('button', { name: '关闭 Properties' }).click()
  await expect(inspector).toBeHidden()
  await expect(sourceNodeWrapper).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(inspector).toBeVisible()
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>('*')) {
      if (element.scrollHeight > element.clientHeight) element.scrollTop = 0
    }
  })
  const narrowNodeBox = await sourceNode.boundingBox()
  const narrowInspectorBox = await nodeEditor.boundingBox()
  const narrowCanvasBox = await panel.locator(
    '.persistent-authoring__canvas-body'
  ).boundingBox()
  const narrowLayout = await nodeEditor.evaluate((element) => ({
    position: getComputedStyle(element).position,
    top: getComputedStyle(element).top,
    bottom: getComputedStyle(element).bottom,
    height: getComputedStyle(element).height,
    offsetParent: (element.offsetParent as HTMLElement | null)?.className
  }))
  expect(
    boxesOverlap(narrowNodeBox, narrowInspectorBox),
    JSON.stringify({ narrowNodeBox, narrowInspectorBox, narrowCanvasBox })
  ).toBe(false)
  expect(narrowInspectorBox?.height).toBeGreaterThan(150)
  expect(
    (narrowCanvasBox?.y ?? 0) + (narrowCanvasBox?.height ?? 0),
    JSON.stringify({ narrowNodeBox, narrowInspectorBox, narrowCanvasBox, narrowLayout })
  ).toBeGreaterThanOrEqual(
    (narrowInspectorBox?.y ?? 0) + (narrowInspectorBox?.height ?? 0)
  )
  await screenshot(page, artifactDirectory, '08-narrow-properties-sheet.png')

  await page.setViewportSize({ width: 900, height: 1050 })
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  const darkNodeColors = await sourceNode.evaluate((node) => {
    const text = node.querySelector('.wf-node__id')
    const kind = node.querySelector('.wf-node__kind')
    return {
      background: getComputedStyle(node).backgroundColor,
      foreground: getComputedStyle(text ?? node).color,
      kindForeground: getComputedStyle(kind ?? node).color
    }
  })
  expect(contrastRatio(
    darkNodeColors.foreground,
    darkNodeColors.background
  )).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(
    darkNodeColors.kindForeground,
    darkNodeColors.background
  )).toBeGreaterThanOrEqual(4.5)
  await screenshot(page, artifactDirectory, '09-dark-material-source.png')
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme
  })

  expect(requests).toEqual(expect.arrayContaining([
    expect.objectContaining({
      method: 'GET',
      path: expect.stringMatching(/^\/api\/v1\/inventory\/materials/)
    }),
    expect.objectContaining({
      method: 'GET',
      path: expect.stringMatching(/^\/api\/v1\/inventory\/sites/)
    }),
    {
      method: 'POST',
      path: `/api/v1/workflows/${os.workflowUuid}/authoring/apply`
    },
    { method: 'POST', path: '/api/v1/workflow-tasks' }
  ]))
  expect(responses.some((entry) =>
    entry.method === 'POST' &&
    entry.path === '/api/v1/workflow-tasks' &&
    entry.status === 201
  )).toBe(true)
  expect(websocketUrls).toEqual([])
  expect(browserErrors).toEqual([])
  expect(pageErrors).toEqual([])

  const nativeStdout = os.logs()
  const nativeLogs = os.nativeLogs()
  const nativeLogText = nativeLogs.map((entry) => entry.content).join('\n')
  expect(os.command[0]).toMatch(/\/unilab$/)
  expect(os.command).toEqual(expect.arrayContaining([
    '--backend',
    'ros',
    '--edge_scheduler',
    '--app_bridges',
    'fastapi'
  ]))
  expect(nativeLogText).toContain('edge scheduler ready (ordering=local-stable)')
  expect(nativeLogText).toContain('POST /api/v1/workflow-tasks HTTP/1.1')
  expect(nativeLogText).not.toContain('Exception in thread')
  expect(nativeStdout).not.toContain('Traceback (most recent call last)')

  writeJson(join(artifactDirectory, 'inventory-before.json'), inventoryBefore)
  writeJson(join(artifactDirectory, 'inventory-after.json'), inventoryAfter)
  writeJson(join(artifactDirectory, 'inventory-ledger.json'), inventoryLedger)
  writeJson(join(artifactDirectory, 'inventory-outbox.json'), {
    before: outboxBefore,
    after: outboxAfter
  })
  writeJson(join(artifactDirectory, 'material-source-job.json'), sourceJob)
  writeJson(join(artifactDirectory, 'admission-blocked-task.json'), blockedTask)
  writeJson(join(artifactDirectory, 'admission-blocked-job.json'), blockedJob)
  writeJson(join(artifactDirectory, 'static-location-mismatch-reject.json'), {
    code: 'material_source_conflict',
    message: 'MaterialSource 与 mount/Site 静态事实冲突',
    fixedMaterialUuid: createdMaterialUuid,
    actualSiteUuid: M2B_SITE_UUID,
    rejectedSiteUuid: M2B_ALTERNATE_SITE_UUID
  })
  writeJson(join(artifactDirectory, 'inventory-after-reject.json'), inventoryAfterReject)
  writeJson(join(artifactDirectory, 'network-ledger.json'), {
    frontendRevision: readGitRevision(process.cwd()),
    osRevision: os.osRevision,
    nativeCommand: os.command,
    requests,
    responses,
    websocketUrls,
    browserErrors,
    pageErrors,
    screenshots: [
      '01-material-source-properties.png',
      '02-canonical-python-diff.png',
      '03-applied-material-graph.png',
      '04-inventory-admission-succeeded.png',
      '05-admission-blocked.png',
      '06-static-location-mismatch-rejected.png',
      '07-responsive-properties-sheet.png',
      '08-narrow-properties-sheet.png',
      '09-dark-material-source.png'
    ]
  })
  writeFileSync(join(artifactDirectory, 'native-cli.stdout.log'), nativeStdout)
  writeFileSync(
    join(artifactDirectory, 'native-os.log'),
    joinNativeLogs(nativeLogs.filter((entry) => !entry.name.includes('ws_comm')))
  )
  writeFileSync(
    join(artifactDirectory, 'native-os-communication.log'),
    joinNativeLogs(nativeLogs.filter((entry) => entry.name.includes('ws_comm')))
  )
})

interface TaskProjection {
  uuid: string
  status: string
  error_info: Array<Record<string, unknown>>
}

interface SourceJobProjection {
  workflow_node_uuid: string
  executor_kind: string
  status: string
  return_info: Record<string, unknown>
  error_info: Array<Record<string, unknown>>
}

async function waitForTaskStatus(
  url: string,
  taskUuid: string,
  status: string
): Promise<TaskProjection> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const task = await readEnvelope<TaskProjection>(
      `${url}/api/v1/workflow-tasks/${taskUuid}`
    )
    if (task.status === status) return task
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`Task ${taskUuid} did not reach ${status}`)
}

async function waitForSourceJobStatus(
  url: string,
  taskUuid: string,
  status: string
): Promise<SourceJobProjection> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const jobs = await readEnvelope<SourceJobProjection[]>(
      `${url}/api/v1/workflow-tasks/${taskUuid}/jobs`
    )
    const sourceJob = jobs.find((job) => job.executor_kind === 'material_source')
    if (sourceJob?.status === status) return sourceJob
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`MaterialSource Job for ${taskUuid} did not reach ${status}`)
}

async function waitForSourceJob(
  url: string,
  taskUuid: string
): Promise<{
  workflow_node_uuid: string
  executor_kind: string
  status: string
  return_info: {
    material: { uuid: string; resource_template_uuid: string }
  }
}> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const jobs = await readEnvelope<Array<{
      workflow_node_uuid: string
      executor_kind: string
      status: string
      return_info: {
        material: { uuid: string; resource_template_uuid: string }
      }
    }>>(`${url}/api/v1/workflow-tasks/${taskUuid}/jobs`)
    if (jobs[0]?.status === 'succeeded') return jobs[0]
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`MaterialSource Job did not succeed for Task ${taskUuid}`)
}

async function readEnvelope<Value>(url: string): Promise<Value> {
  const envelope = await readJson<{ code: number; data: Value }>(url)
  expect(envelope.code).toBe(0)
  return envelope.data
}

async function readJson<Value>(url: string): Promise<Value> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return await response.json() as Value
}

async function screenshot(
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

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function joinNativeLogs(
  entries: ReadonlyArray<{ name: string; content: string }>
): string {
  return entries
    .map((entry) => `# ${entry.name}\n${entry.content}`)
    .join('\n')
}

function boxesOverlap(
  left: { x: number; y: number; width: number; height: number } | null,
  right: { x: number; y: number; width: number; height: number } | null
): boolean {
  if (!left || !right) return true
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  )
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  return (
    Math.max(foregroundLuminance, backgroundLuminance) + 0.05
  ) / (
    Math.min(foregroundLuminance, backgroundLuminance) + 0.05
  )
}

function relativeLuminance(color: string): number {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3) return 0
  const [red, green, blue] = channels.map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
