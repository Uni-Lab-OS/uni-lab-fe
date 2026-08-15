import { expect, test } from '@playwright/test'

const API_URL = 'http://127.0.0.1:18003'

/**
 * 验证空设备模式给出安装引导，并在安装后刷新发现真实仪器设备。
 *
 * @param page Playwright 提供的隔离浏览器页面。
 * @returns 无返回值；通过空状态与刷新后的设备列表断言完整恢复路径。
 * @throws 空状态不明确、宿主节点泄漏或刷新无法发现设备时由断言报告失败。
 * @safety 所有 HTTP 响应均由页面路由夹具提供，不连接或操作真实设备。
 */
test('empty device mode guides setup and discovers devices after refresh', async ({
  page
}) => {
  let devicePackageInstalled = false
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
    const items = [{
      id: 'host_node',
      deviceKey: '/devices/host_node/host_node',
      namespace: '/devices/host_node',
      name: '本地',
      machineName: 'Local',
      online: true,
      actions: []
    }]
    if (devicePackageInstalled) {
      items.push({
        id: 'installed_pump',
        deviceKey: '/devices/installed_pump',
        namespace: '/devices',
        name: 'Installed pump',
        machineName: 'Local',
        online: true,
        actions: []
      })
    }
    await route.fulfill({
      json: {
        code: 0,
        data: {
          schemaVersion: 'device-catalog/v1',
          source: 'edge',
          items
        }
      }
    })
  })

  await page.goto(`/?section=device&localOsUrl=${encodeURIComponent(API_URL)}`)
  const deviceList = page.getByRole('complementary', {
    name: 'Edge 设备列表'
  })
  await expect(deviceList).toContainText('0 台设备 · Edge 实时上报')
  await expect(deviceList).toContainText('当前未配置仪器设备')
  await expect(deviceList).toContainText('安装或配置设备包和设备图后')

  devicePackageInstalled = true
  await deviceList.getByRole('button', { name: '刷新' }).click()
  await expect(deviceList).toContainText('1 台设备 · Edge 实时上报')
  await expect(deviceList.getByRole('button', { name: /installed_pump/ }))
    .toBeVisible()
  expect(browserErrors.filter((message) => (
    !isExpectedMissingFixtureSocketError(message)
  ))).toEqual([])
})

/**
 * 识别测试未提供设备状态 WebSocket 时唯一允许的浏览器错误。
 *
 * @param message 浏览器控制台采集到的错误文本。
 * @returns 是否为固定本地夹具 WebSocket 的连接拒绝错误。
 * @throws 不抛出异常。
 * @safety 只忽略精确地址与错误码组合，其他浏览器错误仍会使测试失败。
 */
function isExpectedMissingFixtureSocketError(message: string): boolean {
  return message.includes(
    "WebSocket connection to 'ws://127.0.0.1:18003/api/v1/ws/device_status"
  ) && message.includes('ERR_CONNECTION_REFUSED')
}
