import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

const environmentPath = process.env.UNILAB_E2E_CONDA_ENV ?? ''
const osProjectPath = process.env.UNILAB_E2E_OS_ROOT ?? ''
const templateUuid = process.env.UNILAB_E2E_UAT_TEMPLATE_UUID
  ?? '11e27cf5-3ec8-4cfb-bb17-db941426e94e'
const definitionFqid = 'community.unilab_szlab_mock.mock_s08_cap_station'
const instanceId = 'local_community_unilab_szlab_mock_mock_s08_cap_station'
const artifactDirectory = process.env.UNILAB_E2E_ARTIFACT_DIR
  ?? resolve('e2e-artifacts', 'device-square-uat-real-edge')

/**
 * 从真实 UAT 设备广场下载已发布 mock 包，并验证写图、Edge 激活与 Action 对账。
 */
test('provisions the UAT mock package and starts a real Edge', async () => {
  test.skip(
    !environmentPath || !osProjectPath,
    '需要 UNILAB_E2E_CONDA_ENV 和 UNILAB_E2E_OS_ROOT'
  )
  test.setTimeout(360_000)
  mkdirSync(artifactDirectory, { recursive: true })
  const configDirectory = resolve(artifactDirectory, 'electron-config')
  const graphPath = resolve(artifactDirectory, 'uat-mock-graph.json')
  rmSync(configDirectory, { recursive: true, force: true })
  writeFileSync(graphPath, '{"nodes":[],"links":[]}\n')

  const electronApp = await electron.launch({
    args: ['--no-sandbox', resolve('apps/desktop/out/main/index.js')],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      UNILABOS_TRACE_ENABLED: '0',
      XDG_CONFIG_HOME: configDirectory
    }
  })

  try {
    const page = await electronApp.firstWindow()
    const browserErrors: string[] = []
    page.on('pageerror', (error) => browserErrors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })

    await page.evaluate((config) => {
      globalThis.localStorage.setItem(
        'unilab.local-runtime-launch-config.v3',
        JSON.stringify(config)
      )
    }, {
      graphPath,
      osProjectPath,
      szlabProjectPath: '',
      environmentPath,
      simulatorProjectPath: '',
      edgeCommandMode: 'generated',
      customEdgeCommand: {
        executable: '',
        workingDirectory: '',
        args: [],
        environment: []
      }
    })
    await page.reload()

    const connectionBar = page.getByRole('group', { name: 'Edge 连接配置' })
    await connectionBar.getByRole('button', { name: '启动本地环境' }).click()
    const runtimeDialog = page.getByRole('dialog', {
      name: '领域侧 Edge（以 sz_lab 为例）'
    })
    await runtimeDialog.getByRole('button', { name: '启动 Edge' }).click()
    await expect(runtimeDialog.getByRole('status')).toContainText(
      '领域侧 Edge 已就绪',
      { timeout: 150_000 }
    )
    await capture(page, '01-empty-edge-ready.png')
    await runtimeDialog.getByRole('button', { name: '关闭', exact: true }).click()

    await page.getByRole('button', { name: '设备广场' }).click()
    const environment = page.getByRole('combobox', { name: '云端环境' })
    await environment.selectOption('uat')
    await expect(environment).toHaveValue('uat')
    await page.getByLabel('搜索云端设备').fill('mock_s08_cap_station')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByRole('heading', { name: definitionFqid }))
      .toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('共 1 个设备定义')).toBeVisible()
    await capture(page, '02-uat-mock-discovered.png')

    await page.getByRole('button', {
      name: '添加心愿单并接入本地'
    }).click()
    await expect(page.getByRole('heading', { name: '配置本地设备实例' }))
      .toBeVisible({ timeout: 120_000 })
    await expect(page.getByText('UAT 环境 · unilab-szlab-mock 0.1.0'))
      .toBeVisible()
    await expect(page.getByLabel(/channel_map/)).toHaveValue('null')
    await capture(page, '03-package-downloaded-configuration-ready.png')

    await page.getByRole('button', {
      name: '校验配置并写入设备图'
    }).click()
    const provisioningDetail = page.getByRole('article')
    await expect(provisioningDetail.getByText('待激活', { exact: true }))
      .toBeVisible({ timeout: 60_000 })
    await capture(page, '04-device-graph-staged.png')

    await page.getByRole('button', {
      name: '重启并确认设备可运行'
    }).click()
    await page.getByRole('button', { name: '确认重启并对账' }).click()
    await expect(provisioningDetail.getByText('可运行', { exact: true }))
      .toBeVisible({ timeout: 180_000 })
    await expect(provisioningDetail.getByText('4 个可用', { exact: true }))
      .toBeVisible()
    await expect(connectionBar).toContainText('Edge 已连接')

    const health = await fetchJson('http://127.0.0.1:18003/api/v1/health')
    expect(health).toMatchObject({ status: 'ok' })
    const catalog = await fetchJson('http://127.0.0.1:18003/api/v1/devices')
    const mockDevice = findMockDevice(catalog)
    expect(mockDevice).toBeDefined()
    expect(mockDevice).toMatchObject({ online: true })
    expect(actionNames(mockDevice)).toEqual(
      expect.arrayContaining(['ping', 'process_cap', 'read_status', 'reset'])
    )
    writeFileSync(
      resolve(artifactDirectory, 'edge-health.json'),
      `${JSON.stringify(health, null, 2)}\n`
    )
    writeFileSync(
      resolve(artifactDirectory, 'edge-devices.json'),
      `${JSON.stringify(catalog, null, 2)}\n`
    )
    writeFileSync(
      resolve(artifactDirectory, 'uat-mock-graph-final.json'),
      `${JSON.stringify(JSON.parse(readGraph(graphPath)), null, 2)}\n`
    )
    await capture(page, '05-uat-mock-edge-ready.png')
    expect(browserErrors.filter((message) => (
      !message.includes("WebSocket connection to 'ws://127.0.0.1:18003")
      && !message.includes('net::ERR_CONNECTION_REFUSED')
    ))).toEqual([])

    await page.evaluate(async () => window.api?.runtime.stopEdge())
  } finally {
    await electronApp.close()
  }
})

/** 读取本地 Edge JSON 接口并在非 2xx 时失败。 */
async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  expect(response.ok).toBe(true)
  return response.json()
}

/** 从兼容 code/data 与直接 catalog 两种响应形状中定位本次 mock 实例。 */
function findMockDevice(payload: unknown): Record<string, unknown> | undefined {
  const root = record(payload)
  const data = record(root.data)
  const items = Array.isArray(data.items)
    ? data.items
    : Array.isArray(root.items)
      ? root.items
      : []
  return items
    .map(record)
    .find((item) => String(item.id ?? '') === instanceId)
}

/** 提取 Edge 设备目录中的公开 Action 名称。 */
function actionNames(device: Record<string, unknown> | undefined): string[] {
  if (!device || !Array.isArray(device.actions)) return []
  return device.actions.map((action) => {
    if (typeof action === 'string') return action
    const value = record(action)
    return String(value.id ?? value.name ?? value.actionName ?? value.action_name ?? '')
  })
}

/** 把 unknown 安全收窄为普通对象。 */
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** 保存当前 Electron 全页截图。 */
async function capture(
  page: import('@playwright/test').Page,
  name: string
): Promise<void> {
  await page.screenshot({
    path: resolve(artifactDirectory, name),
    fullPage: true,
    animations: 'disabled'
  })
}

/** 在不引入额外写入依赖的前提下读取刚写入的隔离设备图。 */
function readGraph(path: string): string {
  return readFileSync(path, 'utf8')
}
