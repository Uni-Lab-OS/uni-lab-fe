import { createServer, type Server } from 'node:http'
import { mkdirSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

const artifactDirectory = resolve('e2e-artifacts', 'device-square-electron')
const templateUuid = '50afbb58-0f53-4ad6-9f73-24cfeb90a834'
const artifactDigest = `sha256:${'a'.repeat(64)}`
const catalogDigest = `sha256:${'b'.repeat(64)}`

/** 验证 Electron 通过 Main 读取现有云端接口并渲染设备接入操作台。 */
test('browses the cloud device square through Electron Main', async () => {
  test.setTimeout(60_000)
  mkdirSync(artifactDirectory, { recursive: true })
  const server = await startDeviceSquareServer()
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试 Backend 端口不可用')
  const configDirectory = resolve(artifactDirectory, 'electron-config')
  await rm(configDirectory, { recursive: true, force: true })
  await seedLegacyProvisioningRecord(configDirectory)
  const electronApp = await electron.launch({
    args: ['--no-sandbox', resolve('apps/desktop/out/main/index.js')],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      PC_CLIENT_API_URL: `http://127.0.0.1:${address.port}/api/v1`,
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

    await page.getByRole('button', { name: '设备广场' }).click()
    await expect(page.getByRole('heading', { name: '设备广场与本地接入' }))
      .toBeVisible()
    await expect(page.getByRole('combobox', { name: '云端环境' }))
      .toHaveValue('test')
    await expect(page.getByRole('combobox', { name: '云端环境' }).locator('option'))
      .toHaveCount(3)
    await page.waitForTimeout(1_000)
    await page.screenshot({
      path: resolve(artifactDirectory, 'device-square-loading.png'),
      fullPage: true
    })
    await expect(page.getByRole('heading', { name: '测试蠕动泵' })).toBeVisible()
    await expect(page.getByRole('button', { name: '添加心愿单并接入本地' }))
      .toBeVisible()
    await expect(page.getByText('共 45 个设备定义')).toBeVisible()
    await page.getByRole('button', { name: '加载更多设备' }).click()
    await expect(page.getByText('已显示 45 / 45')).toBeVisible()
    await expect(page.getByRole('heading', { name: '测试蠕动泵' })).toBeVisible()
    await page.getByText('已显示 45 / 45').scrollIntoViewIfNeeded()
    await page.screenshot({
      path: resolve(artifactDirectory, 'device-square-desktop.png'),
      fullPage: true
    })

    await page.getByRole('button', { name: '本地心愿单' }).click()
    await expect(page.getByRole('heading', { name: '旧版分液器' })).toBeVisible()
    await expect(page.getByText(/当前发布缺少 source_fqid，属于旧版设备包/))
      .toBeVisible()
    await expect(page.getByRole('button', { name: '按失败阶段重试' }))
      .toHaveCount(0)
    await page.screenshot({
      path: resolve(artifactDirectory, 'device-square-legacy-package.png'),
      fullPage: true
    })

    await page.getByRole('button', { name: /凭据泵/ }).click()
    const adoptExisting = page.getByRole('checkbox', { name: /接管同名旧设备/ })
    await expect(adoptExisting).not.toBeChecked()
    await expect(page.getByText(/已有不同 UUID 的节点仍不会被覆盖/)).toBeVisible()
    const passwordInput = page.getByLabel(/password/)
    await expect(passwordInput).toHaveAttribute('type', 'password')
    await expect(passwordInput).toHaveValue('')
    await expect(page.getByText(/设备图和本地接入记录只保存安全引用/))
      .toBeVisible()
    await passwordInput.fill('device-password')
    await page.screenshot({
      path: resolve(artifactDirectory, 'device-secret-configuration.png'),
      fullPage: true
    })

    await page.getByRole('button', { name: '上传设备包' }).click()
    await expect(page.getByRole('heading', { name: '检查 Package Workspace' }))
      .toBeVisible()
    await expect(page.getByRole('heading', { name: '配置云端上传凭据' }))
      .toBeVisible()
    await expect(page.locator('strong').filter({
      hasText: '测试环境 · leap-lab.test.bohrium.com'
    }))
      .toBeVisible()
    await expect(page.getByRole('button', { name: '选择配置' })).toHaveCount(0)
    await expect(page.getByText(/不会写入 local_config\.py、命令参数或本地接入记录/))
      .toBeVisible()
    await page.screenshot({
      path: resolve(artifactDirectory, 'device-package-upload-desktop.png'),
      fullPage: true
    })

    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window?.setSize(720, 780)
    })
    await page.getByRole('button', { name: '云端设备广场' }).click()
    await expect(page.getByRole('heading', { name: '测试蠕动泵' })).toBeVisible()
    await page.screenshot({
      path: resolve(artifactDirectory, 'device-square-compact.png'),
      fullPage: true
    })
    expect(browserErrors).toEqual([])
  } finally {
    await electronApp.close()
    await closeServer(server)
  }
})

/** 启动只实现既有广场 list/detail 的本地兼容 Backend。 */
async function startDeviceSquareServer(): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    response.setHeader('content-type', 'application/json; charset=utf-8')
    if (url.pathname === '/api/v1/lab/square/list') {
      const page = Number(url.searchParams.get('page') ?? '1')
      const pageSize = Number(url.searchParams.get('page_size') ?? '40')
      const firstIndex = (page - 1) * pageSize
      response.end(JSON.stringify({
        code: 0,
        data: {
          total: 45,
          page,
          page_size: pageSize,
          data: Array.from(
            { length: Math.max(0, Math.min(pageSize, 45 - firstIndex)) },
            (_, index) => paginatedDeviceSummary(firstIndex + index)
          )
        }
      }))
      return
    }
    if (url.pathname === `/api/v1/lab/square/detail/${templateUuid}`) {
      response.end(JSON.stringify({
        code: 0,
        data: {
          ...deviceSummary(),
          model: { model: 'UL-PUMP-01' },
          device_params: { interface: 'serial' },
          package_info: {
            name: 'review-lab',
            version: '1.2.0',
            class_namespace: 'community.review_lab',
            artifact_digest: artifactDigest,
            catalog_digest: catalogDigest
          },
          source_registry: { source_fqid: 'community.review_lab.pump' },
          effective_template: {}
        }
      }))
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ message: 'not found' }))
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  return server
}

/**
 * 生成分页设备卡片，并让第一页首项保持详情接口使用的稳定身份。
 *
 * @param index 云端设备目录中的零基位置。
 * @returns 现有 Backend 列表接口的一条设备模板 JSON。
 */
function paginatedDeviceSummary(index: number): Record<string, unknown> {
  if (index === 0) return deviceSummary()
  return {
    ...deviceSummary(),
    uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    name: `test-device-${index + 1}`,
    display_name: `测试设备 ${index + 1}`
  }
}

/**
 * 在 Electron userData 中写入真实 Store 合同，投影一个已诊断的旧设备包记录。
 *
 * @param configDirectory 本次 E2E 隔离的 XDG 配置根目录。
 * @returns 文件持久化完成后结束，不返回业务数据。
 */
async function seedLegacyProvisioningRecord(configDirectory: string): Promise<void> {
  const userDataDirectory = resolve(configDirectory, 'Electron')
  await mkdir(userDataDirectory, { recursive: true })
  await writeFile(
    resolve(userDataDirectory, 'local-device-provisioning.json'),
    JSON.stringify({
      schemaVersion: 'local-device-provisioning-store/v1',
      items: [{
        schemaVersion: 'local-device-provisioning/v1',
        provisioningId: '7f0dbe72-22b0-4ef7-8a5a-3bcd6fa3132a',
        cloudEnvironment: 'test',
        templateUuid: 'b806da39-9498-4936-8fcf-b5a5cd4c4ada',
        cloudDeviceName: 'legacy-dispenser',
        cloudDisplayName: '旧版分液器',
        packageName: 'legacy-lab',
        packageVersion: '0.9.0',
        artifactDigest,
        catalogDigest: '',
        definitionFqid: '',
        cacheKey: '',
        configurationSchema: {},
        configuration: null,
        instanceId: '',
        instanceUuid: '',
        displayName: '旧版分液器',
        graphPath: '/runtime/device-graph.json',
        graphFingerprint: '',
        backupPath: '',
        actionCount: 0,
        status: 'failed',
        diagnostic: {
          stage: 'resolving',
          message: '当前发布缺少 source_fqid，属于旧版设备包，请使用当前 CLI 重新发布',
          retryable: false,
          recordedAt: '2026-08-06T00:00:00.000Z'
        },
        createdAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:00:00.000Z'
      }, {
        schemaVersion: 'local-device-provisioning/v1',
        provisioningId: 'bf3ccdea-e124-4bc8-b7c0-1eceb73e6608',
        cloudEnvironment: 'test',
        templateUuid,
        cloudDeviceName: 'credential-pump',
        cloudDisplayName: '凭据泵',
        packageName: 'review-lab',
        packageVersion: '1.2.0',
        artifactDigest,
        catalogDigest,
        definitionFqid: 'community.review_lab.pump',
        cacheKey: `community.review_lab@1.2.0#${artifactDigest}`,
        configurationSchema: {
          type: 'object',
          required: ['endpoint', 'password'],
          properties: {
            endpoint: { type: 'string' },
            password: {
              type: 'string',
              writeOnly: true,
              'x-unilab-secret': true
            }
          },
          additionalProperties: false
        },
        configuration: { endpoint: 'serial:///dev/ttyUSB0' },
        instanceId: '',
        instanceUuid: '',
        displayName: '凭据泵',
        graphPath: '/runtime/device-graph.json',
        graphFingerprint: '',
        backupPath: '',
        actionCount: 0,
        status: 'configuration_required',
        diagnostic: null,
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:00.000Z'
      }]
    }, null, 2) + '\n',
    'utf8'
  )
}

/** 生成 list/detail 共用的现有 Backend 设备模板字段。 */
function deviceSummary(): Record<string, unknown> {
  return {
    uuid: templateUuid,
    name: 'test-pump',
    display_name: '测试蠕动泵',
    cover: '',
    icon: '',
    description: '用于验证云端设备包下载、本地配置与 Action 接入闭环。',
    tags: ['液体处理', '串口'],
    resource_type: 'device',
    created_at: '2026-08-05T00:00:00.000Z',
    manufacturer: {
      uuid: 'maker-1',
      name: 'Uni-Lab 测试设备',
      code: 'UL',
      website: ''
    }
  }
}

/** 关闭本地兼容 Backend 并等待监听句柄释放。 */
async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
}
