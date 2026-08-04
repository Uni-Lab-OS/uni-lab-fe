import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

const environmentPath = process.env.UNILAB_E2E_CONDA_ENV ?? ''
const osProjectPath = process.env.UNILAB_E2E_OS_ROOT ?? ''
const domainProjectPath = process.env.UNILAB_E2E_DOMAIN_ROOT ?? ''
const graphPath = process.env.UNILAB_E2E_GRAPH_PATH ?? ''
const artifactDirectory = process.env.UNILAB_E2E_ARTIFACT_DIR
  ?? resolve('e2e-artifacts', 'local-debugger-real-edge')

test('starts a real Edge from the desktop local debugger', async () => {
  test.skip(
    !environmentPath || !osProjectPath || !domainProjectPath || !graphPath,
    '需要 UNILAB_E2E_CONDA_ENV、UNILAB_E2E_OS_ROOT、UNILAB_E2E_DOMAIN_ROOT 和 UNILAB_E2E_GRAPH_PATH'
  )
  test.setTimeout(300_000)
  mkdirSync(artifactDirectory, { recursive: true })

  const electronApp = await electron.launch({
    args: [resolve('apps/desktop/out/main/index.js')],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      UNILABOS_TRACE_ENABLED: '0',
      XDG_CONFIG_HOME: resolve(artifactDirectory, 'electron-config')
    }
  })

  try {
    const page = await electronApp.firstWindow()
    const browserErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const location = message.location()
      browserErrors.push(
        [message.text(), location.url].filter(Boolean).join(' @ ')
      )
    })
    page.on('pageerror', (error) => browserErrors.push(error.message))
    page.on('response', (response) => {
      if (response.status() >= 400) {
        browserErrors.push(`HTTP ${response.status()} ${response.url()}`)
      }
    })
    await expect(page.getByRole('group', { name: 'Edge 连接配置' }))
      .toBeVisible()
    await capture(page, '01-frontend-started.png')

    await page.evaluate((config) => {
      globalThis.localStorage.setItem(
        'unilab.local-runtime-launch-config.v2',
        JSON.stringify(config)
      )
    }, {
      graphPath,
      osProjectPath,
      szlabProjectPath: domainProjectPath,
      environmentPath,
      simulatorProjectPath: ''
    })
    await page.reload()

    const connectionBar = page.getByRole('group', {
      name: 'Edge 连接配置'
    })
    await connectionBar.getByRole('button', {
      name: '启动本地环境'
    }).click()
    const runtimeDialog = page.getByRole('dialog', {
      name: '启动领域侧本地调试环境（以 sz_lab 为例）'
    })
    await expect(runtimeDialog).toBeVisible()
    await expect(runtimeDialog.getByRole('textbox', {
      name: '领域项目根目录（可选，以 Uni-Lab-SZLab 为例）'
    })).toHaveValue(domainProjectPath)
    await capture(page, '02-domain-debugger-configured.png')

    await runtimeDialog.getByRole('button', { name: '启动 Edge' }).click()
    await expect(runtimeDialog.getByRole('status')).toContainText(
      /正在检查|正在通过 unilab CLI|正在初始化|正在等待/,
      { timeout: 30_000 }
    )
    await capture(page, '03-edge-starting.png')

    await expect(runtimeDialog.getByRole('status')).toContainText(
      '领域侧 Edge 已就绪',
      { timeout: 120_000 }
    )
    await expect(runtimeDialog.getByText('运行中', { exact: true }))
      .toHaveCount(1)
    await capture(page, '04-edge-ready.png')

    await page.reload()
    await expect(connectionBar).toContainText('Edge 已连接', {
      timeout: 30_000
    })
    await capture(page, '04a-edge-ready-after-reload.png')
    await connectionBar.getByRole('button', {
      name: /启动本地环境|本地调试已启动/
    }).click()
    await expect(runtimeDialog).toBeVisible()

    const deviceCatalog = await fetchDeviceCatalog()
    expect(deviceCatalog.data.items.length).toBeGreaterThan(0)
    expect(deviceCatalog.data.items.some(hasDomainDeviceAction)).toBe(true)
    writeFileSync(
      resolve(artifactDirectory, 'edge-devices.json'),
      `${JSON.stringify(deviceCatalog, null, 2)}\n`
    )
    await expect(page.getByText(/\d+ 台设备 · Edge 实时上报/))
      .toContainText(`${deviceCatalog.data.items.length} 台设备`)
    await capture(page, '05-device-catalog-ready.png')

    const healthResponse = await fetch(
      'http://127.0.0.1:18003/api/v1/health'
    )
    expect(healthResponse.ok).toBe(true)
    const healthPayload: unknown = await healthResponse.json()
    expect(healthPayload).toMatchObject({ status: 'ok' })
    writeFileSync(
      resolve(artifactDirectory, 'edge-health.json'),
      `${JSON.stringify(healthPayload, null, 2)}\n`
    )
    await capture(page, '06-edge-health-confirmed.png')

    await runtimeDialog.getByRole('button', { name: '查看日志' }).click()
    const logDrawer = page.getByRole('dialog', { name: '本地运行日志' })
    await expect(logDrawer).toBeVisible()
    await logDrawer.getByRole('tab', { name: /Edge 运行时/ }).click()
    await expect(logDrawer.getByRole('tabpanel')).not.toContainText(
      '尚未生成日志'
    )
    await expect(logDrawer.getByRole('tabpanel')).not.toContainText(
      /ResourceTreeSet class 未进入 PackageCatalog|无法找到类型 warehouse|backend_thread/
    )
    await capture(page, '07-edge-runtime-log.png')

    const logOutput = logDrawer.getByRole('list', {
      name: '格式化运行日志'
    })
    await appendHealthLogs(12)
    await expect.poll(
      () => logOutput.evaluate((element) => (
        element.scrollHeight > element.clientHeight
      )),
      { timeout: 10_000 }
    ).toBe(true)

    await logOutput.evaluate((element) => {
      element.scrollTop = 0
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    const rowsBeforeUserPausedFollow = await logOutput.locator('li').count()
    await appendHealthLogs(4)
    await expect.poll(
      () => logOutput.locator('li').count(),
      { timeout: 10_000 }
    ).toBeGreaterThan(rowsBeforeUserPausedFollow)
    expect(await logOutput.evaluate((element) => element.scrollTop)).toBe(0)
    await capture(page, '07a-edge-log-user-scroll-preserved.png')

    await logOutput.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    const rowsBeforeFollowResumed = await logOutput.locator('li').count()
    await appendHealthLogs(4)
    await expect.poll(
      () => logOutput.locator('li').count(),
      { timeout: 10_000 }
    ).toBeGreaterThan(rowsBeforeFollowResumed)
    await expect.poll(
      () => logOutput.evaluate((element) => (
        element.scrollHeight - element.clientHeight - element.scrollTop
      )),
      { timeout: 10_000 }
    ).toBeLessThanOrEqual(2)
    await capture(page, '07b-edge-log-follow-resumed.png')

    await page.keyboard.press('Escape')
    expect(browserErrors).toEqual([])

    await runtimeDialog.getByRole('button', { name: '停止 Edge' }).click()
    await expect(runtimeDialog.getByRole('status')).toContainText(
      'PLC-Sim 与领域侧 Edge 均未启动',
      { timeout: 30_000 }
    )
    await capture(page, '08-edge-stopped.png')
    expect(browserErrors).toEqual([])

    await runtimeDialog.getByRole('button', { name: '启动 Edge' }).click()
    await expect(runtimeDialog.getByRole('status')).toContainText(
      '领域侧 Edge 已就绪',
      { timeout: 120_000 }
    )
    expect((await fetchDeviceCatalog()).data.items.length).toBeGreaterThan(0)
    await capture(page, '09-edge-restarted.png')
    expect(browserErrors).toEqual([])

    await runtimeDialog.getByRole('button', { name: '停止 Edge' }).click()
    await expect(runtimeDialog.getByRole('status')).toContainText(
      'PLC-Sim 与领域侧 Edge 均未启动',
      { timeout: 30_000 }
    )
    await capture(page, '10-edge-restopped.png')
    expect(browserErrors).toEqual([])
  } finally {
    await electronApp.close()
  }
})

test('starts a real Edge without a domain device package', async () => {
  test.skip(
    !environmentPath || !osProjectPath,
    '需要 UNILAB_E2E_CONDA_ENV 和 UNILAB_E2E_OS_ROOT'
  )
  test.setTimeout(180_000)
  mkdirSync(artifactDirectory, { recursive: true })
  const osOnlyGraphPath = resolve(artifactDirectory, 'os-only-empty-graph.json')
  writeFileSync(osOnlyGraphPath, '{"nodes":[],"links":[]}\n')

  const electronApp = await electron.launch({
    args: [resolve('apps/desktop/out/main/index.js')],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      UNILABOS_TRACE_ENABLED: '0',
      XDG_CONFIG_HOME: resolve(artifactDirectory, 'electron-config-os-only')
    }
  })

  try {
    const page = await electronApp.firstWindow()
    const browserErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const location = message.location()
      browserErrors.push(
        [message.text(), location.url].filter(Boolean).join(' @ ')
      )
    })
    page.on('pageerror', (error) => browserErrors.push(error.message))
    await page.evaluate((config) => {
      globalThis.localStorage.setItem(
        'unilab.local-runtime-launch-config.v2',
        JSON.stringify(config)
      )
    }, {
      graphPath: osOnlyGraphPath,
      osProjectPath,
      szlabProjectPath: '',
      environmentPath,
      simulatorProjectPath: ''
    })
    await page.reload()

    const connectionBar = page.getByRole('group', { name: 'Edge 连接配置' })
    await connectionBar.getByRole('button', { name: '启动本地环境' }).click()
    const runtimeDialog = page.getByRole('dialog', {
      name: '启动领域侧本地调试环境（以 sz_lab 为例）'
    })
    await expect(runtimeDialog.getByRole('textbox', {
      name: '领域项目根目录（可选，以 Uni-Lab-SZLab 为例）'
    })).toHaveValue('')
    await expect(runtimeDialog).toContainText(
      '留空时仅加载 Uni-Lab-OS 内置设备能力'
    )
    await capture(page, '11-os-only-configured.png')

    await runtimeDialog.getByRole('button', { name: '启动 Edge' }).click()
    await expect(runtimeDialog.getByRole('status')).toContainText(
      /正在检查|正在通过 unilab CLI|正在初始化|正在等待/,
      { timeout: 30_000 }
    )
    await capture(page, '12-os-only-starting.png')
    await expect(runtimeDialog.getByRole('status')).toContainText(
      '领域侧 Edge 已就绪',
      { timeout: 120_000 }
    )
    await fetchDeviceCatalog()
    await capture(page, '13-os-only-ready.png')

    await runtimeDialog.getByRole('button', { name: '查看日志' }).click()
    const logDrawer = page.getByRole('dialog', { name: '本地运行日志' })
    await expect(logDrawer.getByRole('list', {
      name: '格式化运行日志'
    })).toBeVisible()
    await page.waitForTimeout(500)
    await capture(page, '14-os-only-formatted-log.png')
    await page.keyboard.press('Escape')

    await runtimeDialog.getByRole('button', { name: '停止 Edge' }).click()
    await expect(runtimeDialog.getByRole('status')).toContainText(
      'PLC-Sim 与领域侧 Edge 均未启动',
      { timeout: 30_000 }
    )
    await capture(page, '15-os-only-stopped.png')
    expect(browserErrors).toEqual([])
  } finally {
    await electronApp.close()
  }
})

async function capture(
  page: import('@playwright/test').Page,
  name: string
): Promise<void> {
  await page.screenshot({
    path: resolve(artifactDirectory, name),
    fullPage: true
  })
}

async function fetchDeviceCatalog(): Promise<{
  code: number
  data: {
    schemaVersion: string
    items: unknown[]
  }
}> {
  const response = await fetch('http://127.0.0.1:18003/api/v1/devices')
  expect(response.ok).toBe(true)
  const payload: unknown = await response.json()
  expect(payload).toMatchObject({
    code: 0,
    data: {
      schemaVersion: 'device-catalog/v1',
      items: expect.any(Array)
    }
  })
  return payload as {
    code: number
    data: {
      schemaVersion: string
      items: unknown[]
    }
  }
}

async function appendHealthLogs(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const response = await fetch('http://127.0.0.1:18003/api/v1/health')
    expect(response.ok).toBe(true)
  }
}

function hasDomainDeviceAction(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const item = value as { id?: unknown; actions?: unknown }
  return item.id !== 'host_node'
    && Array.isArray(item.actions)
    && item.actions.length > 0
}
