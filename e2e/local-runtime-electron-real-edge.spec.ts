import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { _electron as electron, expect, test } from '@playwright/test'

const environmentPath = process.env.UNILAB_E2E_CONDA_ENV ?? ''
const osProjectPath = process.env.UNILAB_E2E_OS_ROOT ?? ''
const domainProjectPath = process.env.UNILAB_E2E_DOMAIN_ROOT ?? ''
const graphPath = process.env.UNILAB_E2E_GRAPH_PATH ?? ''
const artifactDirectory = process.env.UNILAB_E2E_ARTIFACT_DIR
  ?? resolve('e2e-artifacts', 'local-debugger-real-edge')

/**
 * 使用结构化自定义命令真实启动领域设备包与 Uni-Lab-OS，并验证健康、设备目录和重启链路。
 */
test('starts a real Edge from a custom desktop command', async () => {
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
    await electronApp.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false
      })
    })
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
        'unilab.local-runtime-launch-config.v3',
        JSON.stringify(config)
      )
    }, {
      graphPath,
      osProjectPath,
      szlabProjectPath: domainProjectPath,
      environmentPath,
      simulatorProjectPath: '',
      edgeCommandMode: 'custom',
      customEdgeCommand: {
        executable: '{{unilab}}',
        args: [
          '--workspace',
          '{{workspace}}',
          '--graph',
          '{{graph}}',
          '--config',
          '{{config}}',
          '--working_dir',
          '{{working_dir}}',
          '--backend',
          'ros',
          '--app_bridges',
          'fastapi',
          '--edge_scheduler',
          '--port',
          '{{edge_http_port}}',
          '--disable_browser',
          '--skip_env_check',
          '--test_mode'
        ]
      }
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
    await expect(runtimeDialog.getByRole('radio', {
      name: /自定义命令/
    })).toBeChecked()
    await expect(runtimeDialog.getByRole('textbox', {
      name: '启动程序'
    })).toHaveValue('{{unilab}}')
    await runtimeDialog.getByRole('textbox', { name: '启动程序' })
      .scrollIntoViewIfNeeded()
    await capture(page, '02-domain-debugger-configured.png')
    await resizeMainWindow(electronApp, 800, 700)
    await capture(page, '02a-domain-debugger-compact.png')
    await resizeMainWindow(electronApp, 1200, 800)

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
    const rowsBeforeUserPausedFollow = await formattedLogRowCount(logOutput)
    await appendHealthLogs(4)
    await logDrawer.getByRole('button', { name: '刷新', exact: true }).click()
    await expect.poll(
      () => formattedLogRowCount(logOutput),
      { timeout: 10_000 }
    ).toBeGreaterThan(rowsBeforeUserPausedFollow)
    expect(await logOutput.evaluate((element) => element.scrollTop)).toBe(0)
    await capture(page, '07a-edge-log-user-scroll-preserved.png')

    await logDrawer.getByRole('button', { name: '继续跟随' }).click()
    const rowsBeforeFollowResumed = await formattedLogRowCount(logOutput)
    await appendHealthLogs(4)
    await expect.poll(
      () => formattedLogRowCount(logOutput),
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

/** 验证旧版配置迁移后仍可仅加载 Uni-Lab-OS 内置设备能力。 */
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

/**
 * 保存当前 Electron 页面全页截图。
 *
 * @param page Playwright 控制的 Electron 渲染页面。
 * @param name 写入本次验收制品目录的文件名。
 * @returns 截图落盘后完成。
 */
async function capture(
  page: import('@playwright/test').Page,
  name: string
): Promise<void> {
  await page.screenshot({
    path: resolve(artifactDirectory, name),
    fullPage: true
  })
}

/**
 * 调整 Electron 主窗口尺寸，用于同时验收标准桌面与最小受支持宽度布局。
 *
 * @param electronApp Playwright 控制的 Electron 应用。
 * @param width 目标窗口宽度。
 * @param height 目标窗口高度。
 * @returns 主窗口调整完成后返回。
 */
async function resizeMainWindow(
  electronApp: import('@playwright/test').ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
  }, { width, height })
}

/**
 * 请求真实 Edge 设备目录并校验公开响应契约。
 *
 * @returns 已通过状态码、schema 与列表形状校验的设备目录。
 */
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

/**
 * 连续请求健康接口，以便验证运行日志的跟随滚动行为。
 *
 * @param count 需要追加的健康请求数量。
 * @returns 所有请求均成功后完成。
 */
async function appendHealthLogs(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const response = await fetch('http://127.0.0.1:18003/api/v1/health')
    expect(response.ok).toBe(true)
  }
}

/**
 * 从虚拟化日志行的 aria-setsize 读取完整日志行数，而不是只统计当前渲染窗口。
 *
 * @param logOutput 格式化日志列表容器。
 * @returns 当前完整日志行数；列表尚未渲染时返回 0。
 */
async function formattedLogRowCount(
  logOutput: import('@playwright/test').Locator
): Promise<number> {
  const firstRow = logOutput.getByRole('listitem').first()
  if (await firstRow.count() === 0) return 0
  return Number(await firstRow.getAttribute('aria-setsize')) || 0
}

/**
 * 判断设备目录条目是否来自领域设备包且至少暴露一个动作。
 *
 * @param value 未知形状的设备目录条目。
 * @returns 条目不是宿主节点且动作列表非空时返回 true。
 */
function hasDomainDeviceAction(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const item = value as { id?: unknown; actions?: unknown }
  return item.id !== 'host_node'
    && Array.isArray(item.actions)
    && item.actions.length > 0
}
