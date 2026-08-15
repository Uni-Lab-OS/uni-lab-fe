import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expect, test } from '@playwright/test'

const enabled = process.env.UNILAB_E2E_BACKEND_D1A === '1'
const HEATER_MATERIAL_UUID = '20000000-0000-4000-8000-000000000001'
const HEAT_ACTION_TEMPLATE_UUID = '30000000-0000-4000-8000-000000000001'

test.skip(!enabled, '需要显式启动 PostgreSQL、Backend、Scheduler 与 mock Edge')

/** 验证设备页通过真实 Backend 和 Scheduler 完成设备单动作调试（D1A）。 */
test('runs one existing Backend device Action through the real Scheduler and mock Edge', async ({
  page
}) => {
  test.setTimeout(60_000)
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ??
      resolve(process.cwd(), '../e2e-artifacts/backend-device-action')
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  const apiRequests: Array<{ method: string; path: string; status?: number }> = []

  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !message.text().startsWith('Failed to load resource:')
    ) browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (!url.pathname.startsWith('/__unilab_backend/api/v1/')) return
    apiRequests.push({
      method: response.request().method(),
      path: url.pathname.replace('/__unilab_backend', ''),
      status: response.status()
    })
  })
  await page.addInitScript(() => localStorage.clear())

  await page.goto('/?section=device&backend=local-go')
  const deviceList = page.getByRole('complementary', {
    name: 'Edge 设备列表'
  })
  const workspace = page.locator('[data-device-management="workspace"]')
  const debugSection = workspace.locator('[data-device-management="debug-section"]')
  await expect(page.getByText('Edge 已连接', { exact: true })).toBeVisible()
  await expect(deviceList.getByRole('button', { name: /模拟加热台 A/ }))
    .toBeVisible()
  await expect(workspace.getByText('模拟加热台 A', { exact: true }))
    .toBeVisible()
  await expect(debugSection.getByLabel(/目标温度/)).toBeVisible()
  await expect(debugSection.getByLabel(/保持时间/)).toBeVisible()
  await expect(debugSection.getByRole('button', { name: '运行此动作' }))
    .toBeEnabled()

  await page.screenshot({
    path: join(artifactDirectory, '01-device-action-ready.png'),
    fullPage: true,
    animations: 'disabled'
  })

  await debugSection.getByLabel(/目标温度/).fill('61')
  await debugSection.getByLabel(/保持时间/).fill('1')
  await debugSection.getByLabel(/操作说明/).fill('Frontend D1A Playwright')
  const createResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/api/v1/device-action-runs')
  ))
  await debugSection.getByRole('button', { name: '运行此动作' }).click()
  const createResponse = await createResponsePromise
  expect(createResponse.status()).toBe(201)
  const requestBody = createResponse.request().postDataJSON() as Record<
    string,
    unknown
  >
  expect(requestBody).toMatchObject({
    material_uuid: HEATER_MATERIAL_UUID,
    workflow_node_template_uuid: HEAT_ACTION_TEMPLATE_UUID,
    param: {
      temp: 61,
      time: 1,
      stir: false,
      stir_speed: 0,
      purpose: 'Frontend D1A Playwright'
    },
    execution_policy: {},
    description: '设备页单动作运行',
    meta_data: {
      source: 'device-panel',
      action_name: 'auto-heat_chill'
    }
  })
  expect(requestBody.idempotency_key).toEqual(expect.any(String))
  const created = await createResponse.json() as {
    data: { task: { uuid: string }; job: { uuid: string } }
  }

  await expect.poll(async () => {
    return debugSection.innerText().catch(() => '<device-missing>')
  }, { timeout: 20_000, intervals: [200, 500, 1_000] })
    .toContain('动作执行完成')
  await expect(debugSection.getByText('执行成功', { exact: true }))
    .toBeVisible()
  await expect(debugSection.getByText(
    new RegExp(created.data.task.uuid.slice(0, 8))
  )).toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '02-device-action-succeeded.png'),
    fullPage: true,
    animations: 'disabled'
  })

  expect(apiRequests).toEqual(expect.arrayContaining([
    { method: 'GET', path: '/api/v1/devices', status: 200 },
    { method: 'GET', path: '/api/v1/workflow-node-templates', status: 200 },
    { method: 'POST', path: '/api/v1/device-action-runs', status: 201 },
    {
      method: 'GET',
      path: `/api/v1/workflow-tasks/${created.data.task.uuid}`,
      status: 200
    },
    {
      method: 'GET',
      path: `/api/v1/workflow-tasks/${created.data.task.uuid}/jobs`,
      status: 200
    }
  ]))
  expect(apiRequests.filter((request) => (
    request.status !== undefined &&
    request.status >= 400 &&
    request.path !== '/api/v1/material-shapes'
  ))).toEqual([])
  expect(browserErrors).toEqual([])

  writeFileSync(
    join(artifactDirectory, 'network-ledger.json'),
    `${JSON.stringify({
      taskUuid: created.data.task.uuid,
      jobUuid: created.data.job.uuid,
      createRequest: requestBody,
      requests: apiRequests
    }, null, 2)}\n`
  )
})
