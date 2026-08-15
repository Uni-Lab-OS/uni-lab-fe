import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expect, test } from '@playwright/test'

const API_URL = 'http://127.0.0.1:18003'

/** 验证零动作设备保持可选择，并以禁用运行入口明确表达不可执行原因。 */
test('a device with zero actions remains selectable without crashing', async ({
  page
}) => {
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR
      ?? resolve(process.cwd(), '../e2e-artifacts/device-zero-actions')
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.route(`${API_URL}/api/v1/health`, async (route) => {
    await route.fulfill({ json: { status: 'ok' } })
  })
  await page.route(
    `${API_URL}/api/v1/workflow-node-templates**`,
    async (route) => {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            authority: { authority_id: 'os-local', kind: 'local' },
            catalog_fingerprint: `sha256:${'a'.repeat(64)}`,
            total: 0,
            page: 1,
            page_size: 100,
            items: []
          }
        }
      })
    }
  )
  await page.route(`${API_URL}/api/v1/materials/graph`, async (route) => {
    await route.fulfill({
      json: {
        code: 0,
        data: { revision: 0, materials: [], placements: [] }
      }
    })
  })
  await page.route(`${API_URL}/api/v1/monitor/events**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'retry: 60000\n\n'
    })
  })
  await page.route(`${API_URL}/api/v1/devices`, async (route) => {
    await route.fulfill({
      json: {
        code: 0,
        data: {
          schemaVersion: 'device-catalog/v1',
          source: 'edge',
          items: [
            {
              id: 'active_device',
              deviceKey: '/devices/active_device',
              namespace: 'devices',
              name: 'Action fixture',
              online: true,
              actions: [{
                id: 'run',
                actionRef: 'active_device.run',
                name: 'Run',
                typeName: 'fixture.action.Run',
                busy: false,
                currentJobId: null,
                inputSchema: { type: 'object', properties: {} },
                outputSchema: { type: 'object', properties: {} }
              }]
            },
            {
              id: 'empty_device',
              deviceKey: '/devices/empty_device',
              namespace: 'devices',
              name: 'No-action fixture',
              online: true,
              actions: []
            }
          ]
        }
      }
    })
  })

  await page.goto(`/?section=device&localOsUrl=${encodeURIComponent(API_URL)}`)
  const deviceList = page.getByRole('complementary', {
    name: 'Edge 设备列表'
  })
  await expect(deviceList).toContainText('2 台设备 · Edge 实时上报')
  await page.screenshot({
    path: join(artifactDirectory, '01-two-device-catalog.png'),
    fullPage: true,
    animations: 'disabled'
  })

  await deviceList.getByRole('button', { name: /empty_device/ }).click()
  const workspace = page.locator('[data-device-management="workspace"]')
  await expect(workspace.getByRole('heading', { name: 'empty_device' }))
    .toBeVisible()
  await expect(workspace).toContainText(
    'Edge 已上报该设备，但没有可调试的动作节点。'
  )
  await expect(workspace.locator('[data-device-management="action-node"]')).toHaveCount(0)
  await expect(workspace.getByRole('button', { name: '运行此动作' }))
    .toBeDisabled()
  await expect(workspace).toContainText('该设备没有可运行的动作')
  await page.screenshot({
    path: join(artifactDirectory, '02-zero-action-device-selected.png'),
    fullPage: true,
    animations: 'disabled'
  })

  await deviceList.getByRole('button', { name: '刷新' }).click()
  await expect(deviceList.getByRole('button', { name: '刷新' })).toBeEnabled()
  await expect(workspace.getByRole('heading', { name: 'empty_device' }))
    .toBeVisible()
  await page.screenshot({
    path: join(artifactDirectory, '03-zero-action-device-after-refresh.png'),
    fullPage: true,
    animations: 'disabled'
  })
  expect(browserErrors.filter((message) => (
    !isExpectedMissingFixtureSocketError(message)
  ))).toEqual([])
})

/**
 * 识别仅因测试夹具未启动设备状态 WebSocket 服务而产生的预期控制台错误。
 *
 * @param message 浏览器控制台采集到的错误文本。
 * @returns 是否为固定测试端口的连接拒绝错误。
 * @throws 不抛出异常。
 * @safety 只忽略精确 WebSocket 地址与 ERR_CONNECTION_REFUSED 组合，其他错误仍失败。
 */
function isExpectedMissingFixtureSocketError(message: string): boolean {
  return message.includes(
    "WebSocket connection to 'ws://127.0.0.1:18003/api/v1/ws/device_status"
  ) && message.includes('ERR_CONNECTION_REFUSED')
}
