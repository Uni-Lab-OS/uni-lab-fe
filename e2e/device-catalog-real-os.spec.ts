import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expect, test } from '@playwright/test'

const API_URL =
  process.env.UNILAB_E2E_DEVICE_API_URL ?? 'http://127.0.0.1:8014'

/** 验证仪器设备（Device）界面通过真实 OS HTTP 接口读取 Edge 设备目录。 */
test('existing device UI reads the Edge-owned catalog through the real OS API', async ({
  page,
  request
}) => {
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ||
      resolve(process.cwd(), '../e2e-artifacts/device-catalog-v1')
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  const apiRequests: Array<{ method: string; path: string }> = []

  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('request', (incoming) => {
    if (!incoming.url().startsWith(API_URL)) return
    apiRequests.push({
      method: incoming.method(),
      path: new URL(incoming.url()).pathname
    })
  })

  const health = await request.get(`${API_URL}/api/v1/health`)
  expect(health.ok()).toBe(true)
  expect(await health.json()).toMatchObject({ status: 'ok' })
  const catalog = await request.get(`${API_URL}/api/v1/devices`)
  expect(catalog.ok()).toBe(true)
  const catalogBody = (await catalog.json()) as {
    code?: number
    data?: {
      schemaVersion?: string
      source?: string
      items?: Array<{
        id?: string
        name?: string
        actions?: unknown[]
      }>
    }
  }
  expect(catalogBody.code).toBe(0)
  expect(catalogBody.data?.schemaVersion).toBe('device-catalog/v1')
  expect(catalogBody.data?.source).toBe('edge')
  const catalogItems = catalogBody.data?.items ?? []
  expect(catalogItems.length).toBeGreaterThan(0)
  const instrumentItems = catalogItems.filter((item) => item.id !== 'host_node')
  expect(instrumentItems.length).toBeGreaterThan(0)

  await page.goto(
    `/?section=device&localOsUrl=${encodeURIComponent(API_URL)}`
  )

  const devicePanel = page.locator('[data-device-management="panel"]')
  const deviceList = page.getByRole('complementary', {
    name: 'Edge 设备列表'
  })
  const workspace = page.locator('[data-device-management="workspace"]')
  await expect(
    devicePanel.getByText('Edge 已连接', { exact: true })
  ).toBeVisible()
  await expect(deviceList.getByText(
    `${instrumentItems.length} 台设备 · Edge 实时上报`,
    { exact: true }
  )).toBeVisible()
  await expect(deviceList.getByRole('button', { name: /host_node/ }))
    .toHaveCount(0)
  const instrumentId = instrumentItems[0]?.id
  if (!instrumentId) throw new Error('仪器设备（Device）目录缺少可展示设备')
  const instrumentMachineName = instrumentItems[0]?.name
  if (!instrumentMachineName) {
    throw new Error('仪器设备（Device）目录缺少 Edge 名称')
  }
  await expect(deviceList.getByRole('button', {
    name: new RegExp(instrumentId)
  })).toBeVisible()
  await expect(workspace.getByText(
    instrumentMachineName,
    { exact: true }
  )).toBeVisible()
  await expect(workspace.getByText('在线', { exact: true })).toBeVisible()
  await expect(
    workspace.locator('[data-device-management="action-node"]').first()
  ).toBeVisible()

  await page.screenshot({
    path: join(artifactDirectory, '01-device-catalog-loaded.png'),
    fullPage: true,
    animations: 'disabled'
  })
  await deviceList.screenshot({
    path: join(artifactDirectory, '02-edge-device-list.png'),
    animations: 'disabled'
  })
  await workspace.locator('[data-device-management="identity"]').screenshot({
    path: join(artifactDirectory, '03-device-identity-and-online-state.png'),
    animations: 'disabled'
  })
  await workspace.locator('[data-device-management="action-section"]').screenshot({
    path: join(artifactDirectory, '04-edge-action-catalog.png'),
    animations: 'disabled'
  })

  const actionNodes = workspace.locator('[data-device-management="action-node"]')
  expect(await actionNodes.count()).toBeGreaterThan(0)
  await actionNodes.first().click()
  const parameterSection = workspace.locator('[data-device-management="debug-section"]')
  await expect(
    parameterSection.getByText('动作参数预览', { exact: true })
  ).toBeVisible()
  await expect(
    parameterSection.getByRole('button', { name: '运行此动作' })
  ).toBeEnabled()
  await parameterSection.screenshot({
    path: join(artifactDirectory, '05-action-parameter-form.png'),
    animations: 'disabled'
  })

  await deviceList.getByRole('button', { name: '刷新' }).click()
  await expect(deviceList.getByRole('button', { name: '刷新' })).toBeEnabled()
  await page.screenshot({
    path: join(artifactDirectory, '06-catalog-refreshed.png'),
    fullPage: true,
    animations: 'disabled'
  })

  expect(apiRequests).toEqual(
    expect.arrayContaining([
      { method: 'GET', path: '/api/v1/health' },
      { method: 'GET', path: '/api/v1/devices' }
    ])
  )
  // 设备展示来自 `/devices`；单动作正式任务仍需要节点模板目录中的
  // authority、fingerprint 和模板 UUID，不能把这个身份读取误判为设备目录来源。
  expect(apiRequests).toEqual(expect.arrayContaining([
    { method: 'GET', path: '/api/v1/workflow-node-templates' }
  ]))
  expect(browserErrors).toEqual([])

  writeFileSync(
    join(artifactDirectory, 'network-ledger.json'),
    `${JSON.stringify({ apiUrl: API_URL, requests: apiRequests }, null, 2)}\n`
  )
})
