import {
  expect,
  test,
  type APIRequestContext,
  type Page
} from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  startOfflineLocalBridge,
  type OfflineLocalBridge
} from './helpers/offline-local-bridge'

interface CommandCall {
  command: string
  status: number
}

interface RuntimeSnapshot {
  run: {
    id: string
    status: string
    debug?: {
      status?: string
      pausedBeforeNodeId?: string | null
      stopReason?: string | null
    }
  }
  nodes: Array<{ nodeId: string; state: string }>
  events: Array<{
    seq: number
    type: string
    nodeId?: string | null
    payload: Record<string, unknown>
  }>
}

test.describe.serial('visible workflow debugger actions', () => {
  let bridge: OfflineLocalBridge

  test.beforeAll(async () => {
    bridge = await startOfflineLocalBridge(1.5)
  })

  test.afterAll(async () => {
    await bridge.stop()
  })

  test('pause drains the running node and continue resumes from the next admission', async ({
    page,
    request
  }) => {
    const observation = observeCommands(page)
    await openWorkflow(page, bridge.url)
    await clearDefaultBreakpoint(page)
    const runId = await startDebug(page)
    await expectPausedBefore(page, 'measure')

    await page.getByRole('button', { name: '继续', exact: true }).click()
    await expect(nodeRow(page, 'measure'))
      .toHaveAttribute('data-node-state', 'running')
    await expect(
      page.getByRole('button', { name: '暂停', exact: true })
    ).toBeEnabled()
    await page.getByRole('button', { name: '暂停', exact: true }).click()

    await expect(page.locator('.workflow-runtime__debug-status strong'))
      .toHaveText(/等待暂停|已暂停/)
    await expectPausedBefore(page, 'branch')
    const paused = await snapshot(request, bridge.url, runId)
    expect(states(paused)).toMatchObject({
      measure: 'success',
      branch: 'pending'
    })
    expect(
      paused.events.some((event) => event.type === 'debug.pause_pending')
    ).toBe(true)
    await saveEvidence(page, 'pause-checkpoint', {
      runId,
      paused,
      commands: observation.commands
    })

    await page.getByRole('button', { name: '继续', exact: true }).click()
    await expect(page.locator('.workflow-runtime__run-state'))
      .toHaveText('整体：已完成', { timeout: 15_000 })
    expect(observation.commands).toEqual([
      { command: 'continue', status: 200 },
      { command: 'pause', status: 200 },
      { command: 'continue', status: 200 }
    ])
    expect(observation.browserErrors).toEqual([])
    await saveEvidence(page, 'pause-continue', {
      runId,
      paused,
      commands: observation.commands
    })
  })

  test('single step admits exactly one logical node while unfinished variants stay hidden', async ({
    page,
    request
  }) => {
    const observation = observeCommands(page)
    await openWorkflow(page, bridge.url)
    const runId = await startDebug(page)
    await expectPausedBefore(page, 'measure')

    await clickAndExpectPause(page, '单步', 'branch')
    expect(await currentStates(request, bridge.url, runId)).toMatchObject({
      measure: 'success',
      branch: 'pending'
    })

    await expectHiddenDebuggerActions(page)
    await clickAndExpectPause(page, '单步', 'dose')
    expect(await currentStates(request, bridge.url, runId)).toMatchObject({
      branch: 'success',
      dose: 'pending',
      inspect: 'skipped'
    })

    await clickAndExpectPause(page, '单步', 'join')
    const afterStepInto = await snapshot(request, bridge.url, runId)
    expect(states(afterStepInto)).toMatchObject({
      dose: 'success',
      join: 'pending'
    })
    expect(
      afterStepInto.events.filter((event) => event.type === 'debug.stepping')
    ).toHaveLength(3)
    await saveEvidence(page, 'step-variants-paused', {
      runId,
      afterStepInto,
      commands: observation.commands
    })

    await page.getByRole('button', { name: '继续', exact: true }).click()
    await expect(page.locator('.workflow-runtime__run-state'))
      .toHaveText('整体：已完成', { timeout: 10_000 })
    expect(observation.commands.map((call) => call.command)).toEqual([
      'step',
      'step',
      'step',
      'continue'
    ])
    expect(observation.browserErrors).toEqual([])
    await saveEvidence(page, 'step-variants', {
      runId,
      afterStepInto,
      commands: observation.commands
    })
  })

  test('successful node logs use the code editor surface', async ({ page }) => {
    await openWorkflow(page, bridge.url)
    await startDebug(page)
    await expectPausedBefore(page, 'measure')

    await clickAndExpectPause(page, '单步', 'branch')
    const successfulNode = nodeRow(page, 'measure')
    await expect(successfulNode).toHaveAttribute('data-node-state', 'success')
    await successfulNode.click()

    const logOutput = page.locator('.workflow-runtime__node-log pre')
    const codeEditor = page.locator('.cm-editor').first()
    await expect(logOutput).toBeVisible()
    await expect(logOutput).toContainText('节点执行成功')

    const logColors = await logOutput.evaluate((element) => {
      const style = globalThis.getComputedStyle(element)
      return [style.backgroundColor, style.color]
    })
    const editorColors = await codeEditor.evaluate((element) => {
      const style = globalThis.getComputedStyle(element)
      return [style.backgroundColor, style.color]
    })
    expect(logColors).toEqual(editorColors)

    await page.getByRole('button', { name: '终止', exact: true }).click()
    await expect(page.locator('.workflow-runtime__run-state'))
      .toHaveText('整体：已取消')
  })

  test('terminate cancels a paused run and records its explicit reason', async ({
    page,
    request
  }) => {
    const observation = observeCommands(page)
    await openWorkflow(page, bridge.url)
    const runId = await startDebug(page)
    await expectPausedBefore(page, 'measure')

    await page.getByRole('button', { name: '终止', exact: true }).click()
    await expect(page.locator('.workflow-runtime__run-state'))
      .toHaveText('整体：已取消')
    const stopped = await snapshot(request, bridge.url, runId)
    expect(stopped.run.debug?.stopReason).toBe('terminate')
    expect(states(stopped)).toEqual({
      measure: 'cancelled',
      branch: 'cancelled',
      dose: 'cancelled',
      inspect: 'cancelled',
      join: 'cancelled',
      heat: 'cancelled'
    })
    expect(
      stopped.events.some(
        (event) => event.type === 'debug.terminate_requested'
      )
    ).toBe(true)
    await expectAllActionsDisabled(page)
    expect(observation.commands).toEqual([
      { command: 'terminate', status: 200 }
    ])
    expect(observation.browserErrors).toEqual([])
    await saveEvidence(page, 'terminate', {
      runId,
      stopped,
      commands: observation.commands
    })
  })

  test('full workflow run enables the existing debugger terminate action', async ({
    page,
    request
  }) => {
    const observation = observeCommands(page)
    await openWorkflow(page, bridge.url)
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/v1/runtime/runs')
    )

    await page.getByRole('button', { name: /整图执行/ }).click()
    const response = await responsePromise
    expect(response.status()).toBe(200)
    const { id: runId } = await response.json() as { id: string }
    const terminate = page.getByRole('button', {
      name: '终止',
      exact: true
    })
    await expect(terminate).toBeEnabled()

    const cancelResponsePromise = page.waitForResponse(
      (cancelResponse) =>
        cancelResponse.request().method() === 'POST' &&
        cancelResponse.url().endsWith(`/runtime/runs/${runId}/cancel`)
    )
    await terminate.click()
    expect((await cancelResponsePromise).status()).toBe(200)
    await expect(page.locator('.workflow-runtime__run-state'))
      .toHaveText('整体：已取消')
    expect((await snapshot(request, bridge.url, runId)).run.status)
      .toBe('cancelled')
    expect(observation.commands).toEqual([])
    expect(observation.browserErrors).toEqual([])
  })

  test('step over, step into and emergency stop stay out of the toolbar', async ({
    page
  }) => {
    const observation = observeCommands(page)
    await openWorkflow(page, bridge.url)
    await expectHiddenDebuggerActions(page)
    await startDebug(page)
    await expectPausedBefore(page, 'measure')
    await expectHiddenDebuggerActions(page)
    await page.getByRole('button', { name: '终止', exact: true }).click()
    await expect(page.locator('.workflow-runtime__run-state'))
      .toHaveText('整体：已取消')
    await expectAllActionsDisabled(page)
    expect(observation.commands.map((call) => call.command)).toEqual([
      'terminate'
    ])
    expect(observation.browserErrors).toEqual([])
  })

  test('workflow canvas ignores drag and delete edits', async ({ page }) => {
    await openWorkflow(page, bridge.url)
    const node = page.locator('.react-flow__node-wfNode').first()
    const referenceNode = page.locator('.react-flow__node-wfNode').nth(1)
    const before = await node.boundingBox()
    const referenceBefore = await referenceNode.boundingBox()
    expect(before).not.toBeNull()
    expect(referenceBefore).not.toBeNull()
    if (before === null || referenceBefore === null) return
    await page.mouse.move(
      before.x + before.width / 2,
      before.y + before.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      before.x + before.width / 2 + 120,
      before.y + before.height / 2 + 80,
      { steps: 6 }
    )
    await page.mouse.up()
    const after = await node.boundingBox()
    const referenceAfter = await referenceNode.boundingBox()
    expect(after).not.toBeNull()
    expect(referenceAfter).not.toBeNull()
    if (after === null || referenceAfter === null) return
    expect(after.x - referenceAfter.x).toBeCloseTo(
      before.x - referenceBefore.x,
      0
    )
    expect(after.y - referenceAfter.y).toBeCloseTo(
      before.y - referenceBefore.y,
      0
    )

    await node.click()
    await page.keyboard.press('Delete')
    await expect(page.locator('.react-flow__node-wfNode')).toHaveCount(6)
  })
})

async function openWorkflow(page: Page, osUrl: string): Promise<void> {
  await page.goto(`/?localOsUrl=${encodeURIComponent(osUrl)}`)
  await page.getByText('工作流', { exact: true }).first().click()
  await expect(page.getByText('完整控制流 DAG')).toBeVisible()
  await expect(page.locator('.react-flow__node-wfNode')).toHaveCount(6)
}

async function clearDefaultBreakpoint(page: Page): Promise<void> {
  await page.locator('button[aria-label="取消断点 branch"]').click()
  await expect(page.locator('.wf-flow-node--breakpoint')).toHaveCount(0)
}

async function startDebug(page: Page): Promise<string> {
  const debugMode = page.getByRole('button', {
    name: '调试运行',
    exact: true
  })
  await debugMode.click()
  await expect(debugMode).toHaveAttribute('aria-pressed', 'true')
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/v1/runtime/runs')
  )
  await page.getByRole('button', { name: /调试启动/ }).click()
  const response = await responsePromise
  expect(response.status()).toBe(200)
  const payload = await response.json() as { id: string }
  return payload.id
}

async function expectPausedBefore(page: Page, nodeId: string): Promise<void> {
  await expect(page.locator('.workflow-runtime__debug-status strong'))
    .toHaveText('已暂停', { timeout: 10_000 })
  await expect(page.getByText(`暂停于 ${nodeId} 执行之前`)).toBeVisible()
}

async function clickAndExpectPause(
  page: Page,
  label: string,
  nodeId: string
): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click()
  await expectPausedBefore(page, nodeId)
}

function nodeRow(page: Page, nodeId: string) {
  return page.locator('.workflow-runtime__node-list button', {
    hasText: nodeId
  })
}

async function snapshot(
  request: APIRequestContext,
  osUrl: string,
  runId: string
): Promise<RuntimeSnapshot> {
  const [runResponse, nodesResponse, eventsResponse] = await Promise.all([
    request.get(`${osUrl}/api/v1/runtime/runs/${runId}`),
    request.get(`${osUrl}/api/v1/runtime/runs/${runId}/nodes`),
    request.get(`${osUrl}/api/v1/runtime/runs/${runId}/events?after_seq=0`)
  ])
  expect(runResponse.ok()).toBe(true)
  expect(nodesResponse.ok()).toBe(true)
  expect(eventsResponse.ok()).toBe(true)
  const nodes = await nodesResponse.json() as {
    items: RuntimeSnapshot['nodes']
  }
  const events = await eventsResponse.json() as {
    events: RuntimeSnapshot['events']
  }
  return {
    run: await runResponse.json() as RuntimeSnapshot['run'],
    nodes: nodes.items,
    events: events.events
  }
}

function states(value: RuntimeSnapshot): Record<string, string> {
  return Object.fromEntries(
    value.nodes.map((node) => [node.nodeId, node.state])
  )
}

async function currentStates(
  request: APIRequestContext,
  osUrl: string,
  runId: string
): Promise<Record<string, string>> {
  return states(await snapshot(request, osUrl, runId))
}

function observeCommands(page: Page): {
  commands: CommandCall[]
  browserErrors: string[]
} {
  const commands: CommandCall[] = []
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('response', (response) => {
    if (
      response.request().method() !== 'POST' ||
      !response.url().endsWith('/commands')
    ) return
    const body = response.request().postDataJSON() as {
      command?: unknown
    }
    commands.push({
      command: String(body.command || ''),
      status: response.status()
    })
  })
  return { commands, browserErrors }
}

async function expectAllActionsDisabled(page: Page): Promise<void> {
  for (const label of [
    '暂停',
    '单步',
    '继续',
    '终止'
  ]) {
    await expect(page.getByRole('button', { name: label, exact: true }))
      .toBeDisabled()
  }
}

async function expectHiddenDebuggerActions(page: Page): Promise<void> {
  for (const label of ['步过', '步入', '急停']) {
    await expect(
      page.getByRole('button', { name: label, exact: true })
    ).toHaveCount(0)
  }
}

async function saveEvidence(
  page: Page,
  name: string,
  value: unknown
): Promise<void> {
  const directory = resolve(process.cwd(), '../e2e-artifacts')
  mkdirSync(directory, { recursive: true })
  const screenshot = resolve(directory, `workflow-debug-${name}.png`)
  await page.locator('.workflow-runtime__stage').screenshot({
    path: screenshot
  })
  writeFileSync(
    resolve(directory, `workflow-debug-${name}.json`),
    JSON.stringify({ screenshot, ...value as object }, null, 2)
  )
}
