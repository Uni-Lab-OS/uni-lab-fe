import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expect, test } from '@playwright/test'

const enabled = process.env.UNILAB_E2E_PLC_EDGE === '1'
const PLC_MATERIAL_UUID = '5e698c9b-2421-4eec-938b-b38cbce27a47'
const CHECK_CONNECTION_TEMPLATE_UUID = 'da217ab1-0827-4399-aa57-b26b8daa784b'

test.skip(!enabled, '需要显式启动 PostgreSQL、Backend、Scheduler、Edge 与 PLC 仿真')

/** 验证设备页通过真实 Edge 访问 OPC UA PLC 仿真并回传动作结果。 */
test('runs the PLC connection check through Backend, Scheduler and the real Edge', async ({
  page,
  request
}) => {
  test.setTimeout(60_000)
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ??
      resolve(process.cwd(), 'e2e-artifacts/plc-edge-runtime/browser')
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
  await expect(deviceList.getByRole('button', { name: /SZLab PLC 仿真 Edge/ }))
    .toBeVisible()
  await deviceList.getByRole('button', { name: /SZLab PLC 仿真 Edge/ }).click()
  await expect(workspace.getByText('SZLab PLC 仿真 Edge', { exact: true }))
    .toBeVisible()
  await workspace.getByRole('button', {
    name: 'check_opcua_connection 动作节点'
  }).click()
  await expect(debugSection.getByRole('heading', {
    name: '检查 OPC UA 仿真连接'
  })).toBeVisible()
  await expect(debugSection.getByText(
    '此动作不需要输入参数，可直接运行。',
    { exact: true }
  )).toBeVisible()
  await expect(debugSection.getByRole('button', { name: '运行此动作' }))
    .toBeEnabled()

  await page.screenshot({
    path: join(artifactDirectory, '01-plc-edge-action-ready.png'),
    fullPage: true,
    animations: 'disabled'
  })

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
    material_uuid: PLC_MATERIAL_UUID,
    workflow_node_template_uuid: CHECK_CONNECTION_TEMPLATE_UUID,
    param: {},
    execution_policy: {},
    description: '设备页单动作运行',
    meta_data: {
      source: 'device-panel',
      action_name: 'check_opcua_connection'
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

  const jobResponse = await request.get(
    `http://127.0.0.1:8080/api/v1/workflow-node-jobs/${created.data.job.uuid}`
  )
  expect(jobResponse.status()).toBe(200)
  const jobPayload = await jobResponse.json() as {
    data: {
      edge_uuid: string
      status: string
      return_info: {
        return_value?: {
          connected?: boolean
          last_error?: string | null
        }
      }
    }
  }
  expect(jobPayload.data).toMatchObject({
    status: 'succeeded',
    edge_uuid: expect.any(String),
    return_info: {
      return_value: {
        connected: true,
        last_error: null
      }
    }
  })

  await page.screenshot({
    path: join(artifactDirectory, '02-plc-edge-action-succeeded.png'),
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
  expect(apiRequests.filter((item) => (
    item.status !== undefined &&
    item.status >= 400 &&
    item.path !== '/api/v1/material-shapes'
  ))).toEqual([])
  expect(browserErrors).toEqual([])

  writeFileSync(
    join(artifactDirectory, 'network-ledger.json'),
    `${JSON.stringify({
      taskUuid: created.data.task.uuid,
      jobUuid: created.data.job.uuid,
      edgeUuid: jobPayload.data.edge_uuid,
      createRequest: requestBody,
      returnInfo: jobPayload.data.return_info,
      requests: apiRequests
    }, null, 2)}\n`
  )
})
