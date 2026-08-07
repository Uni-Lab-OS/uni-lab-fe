import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

const artifactDirectory = process.env.UNILAB_E2E_ARTIFACT_DIR

/**
 * 为本地调试器弹窗安装最小桌面运行时替身。
 *
 * @param page 待注入 Electron 预加载接口的浏览器页面。
 * @returns 完成只读运行快照和空操作命令注册后结束。
 * @throws 页面上下文无法注册初始化脚本时透传 Playwright 异常。
 * @safety 替身不会启动、停止或修改真实 PLC-Sim 与领域侧 Edge 进程。
 */
async function installIdleRuntimeApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const idleSnapshot = {
      phase: 'idle' as const,
      message: 'PLC-Sim 与领域侧 Edge 均未启动',
      simulatorRunning: false,
      bridgeRunning: false,
      edgeRunning: false
    }
    const runtimeApi = {
      selectPath: async () => null,
      getDefaultEnvironmentPath: async () => '/tmp/envs/unilab',
      getSnapshot: async () => idleSnapshot,
      startSimulator: async () => idleSnapshot,
      stopSimulator: async () => idleSnapshot,
      startEdge: async () => idleSnapshot,
      stopEdge: async () => idleSnapshot,
      readLog: async (query: { kind: 'simulator' | 'bridge' | 'edge' }) => ({
        kind: query.kind,
        content: '',
        available: false,
        truncated: false,
        readAt: Date.now(),
        cursor: { fileId: `local-192-${query.kind}`, offset: 0 },
        reset: true
      }),
      openLogFile: async () => ({ opened: true }),
      onSnapshot: () => () => undefined
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { runtime: runtimeApi }
    })
  })
}

test.beforeEach(async ({ page }) => {
  await installIdleRuntimeApi(page)
  await page.route('**/health', async (route) => {
    await route.fulfill({ json: { status: 'ok' } })
  })
  await page.route('**/api/v1/devices', async (route) => {
    await route.fulfill({
      json: {
        code: 0,
        data: {
          schemaVersion: 'device-catalog/v1',
          source: 'edge',
          generatedAt: Date.now(),
          items: []
        }
      }
    })
  })
  await page.route('**/api/v1/workflow-node-templates?*', async (route) => {
    await route.fulfill({
      json: {
        code: 0,
        data: {
          authority: { authority_id: 'local-192', kind: 'local' },
          catalog_fingerprint: `sha256:${'a'.repeat(64)}`,
          items: [],
          total: 0,
          page: 1,
          page_size: 100
        }
      }
    })
  })
  await page.route('**/api/v1/materials/graph', async (route) => {
    await route.fulfill({ json: { code: 0, data: { nodes: [] } } })
  })
  await page.route('**/api/v1/material-shapes', async (route) => {
    await route.fulfill({ json: { code: 0, data: { items: [] } } })
  })
})

/**
 * 验证长配置只滚动弹窗正文，标题和主操作始终留在视口内。
 *
 * @param page 已安装空闲本地运行时替身的浏览器页面。
 * @returns 完成滚动容器、头部位置和正文可滚动性验收。
 * @throws 对话框整体仍是滚动容器或头部随正文移动时由断言报告。
 * @safety 只操作浏览器替身和滚动位置，不启动真实本地运行进程。
 */
test('本地调试器长配置滚动时固定头部', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 720 })
  await page.goto('/')
  await page.getByRole('group', { name: 'Edge 连接配置' })
    .getByRole('button', { name: '启动本地环境' })
    .click()

  const runtimeDialog = page.getByRole('dialog', {
    name: '领域侧 Edge（以 sz_lab 为例）'
  })
  const runtimeHeader = runtimeDialog.locator('header').first()
  const plcDetails = runtimeDialog.locator('details').filter({
    hasText: 'PLC-Sim（可选）'
  }).first()
  await capture(page, '01-local-runtime-desktop-collapsed.png')
  await plcDetails.locator('summary').click()
  await expect(plcDetails).toHaveAttribute('open', '')
  await capture(page, '02-local-runtime-desktop-expanded.png')

  const scrollResult = await runtimeDialog.evaluate((dialog) => {
    const header = dialog.querySelector('header')
    const simulatorPath = dialog.querySelector('#runtime-simulator-path')
    if (!(header instanceof HTMLElement)
      || !(simulatorPath instanceof HTMLElement)) {
      throw new Error('本地调试器弹窗缺少头部或 PLC-Sim 路径字段')
    }

    let scrollContainer: HTMLElement | null = simulatorPath.parentElement
    while (scrollContainer && scrollContainer !== document.body) {
      const style = window.getComputedStyle(scrollContainer)
      if (
        scrollContainer.scrollHeight > scrollContainer.clientHeight
        && /(auto|scroll)/.test(style.overflowY)
      ) {
        break
      }
      scrollContainer = scrollContainer.parentElement
    }
    if (!scrollContainer || scrollContainer === document.body) {
      throw new Error('本地调试器长配置缺少可滚动正文')
    }

    const headerTopBefore = header.getBoundingClientRect().top
    scrollContainer.scrollTop = scrollContainer.scrollHeight
    const headerTopAfter = header.getBoundingClientRect().top
    return {
      headerTopBefore,
      headerTopAfter,
      scrollTop: scrollContainer.scrollTop,
      containerIsDialog: scrollContainer === dialog
    }
  })

  expect(scrollResult.containerIsDialog).toBe(false)
  expect(scrollResult.scrollTop).toBeGreaterThan(0)
  expect(Math.abs(
    scrollResult.headerTopAfter - scrollResult.headerTopBefore
  )).toBeLessThan(1)
  await expect(runtimeHeader).toBeInViewport()
  await expect(
    runtimeHeader.getByRole('button', { name: '启动 Edge' })
  ).toBeInViewport()
  await capture(page, '03-local-runtime-desktop-scrolled.png')

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(runtimeHeader).toBeInViewport()
  await expect(
    runtimeHeader.getByRole('button', { name: '启动 Edge' })
  ).toBeInViewport()
  await capture(page, '04-local-runtime-narrow-scrolled.png')

  await runtimeDialog.evaluate((dialog) => {
    const simulatorPath = dialog.querySelector('#runtime-simulator-path')
    if (!(simulatorPath instanceof HTMLElement)) {
      throw new Error('本地调试器弹窗缺少 PLC-Sim 路径字段')
    }
    let scrollContainer: HTMLElement | null = simulatorPath.parentElement
    while (scrollContainer && scrollContainer !== document.body) {
      const style = window.getComputedStyle(scrollContainer)
      if (
        scrollContainer.scrollHeight > scrollContainer.clientHeight
        && /(auto|scroll)/.test(style.overflowY)
      ) {
        scrollContainer.scrollTop = 0
        return
      }
      scrollContainer = scrollContainer.parentElement
    }
    throw new Error('本地调试器长配置缺少可滚动正文')
  })
  await capture(page, '05-local-runtime-narrow-top.png')
})

/**
 * 在配置了证据目录时保存当前本地调试器界面。
 *
 * @param page 当前 Playwright 页面。
 * @param name 证据目录内的稳定截图文件名。
 * @returns 截图写入完成或未配置目录时直接结束。
 * @throws 目录创建或浏览器截图失败时透传底层异常。
 * @safety 只在指定测试证据目录内创建 PNG 文件。
 */
async function capture(page: Page, name: string): Promise<void> {
  if (!artifactDirectory) return
  mkdirSync(artifactDirectory, { recursive: true })
  await page.screenshot({
    path: resolve(artifactDirectory, name),
    fullPage: true
  })
}
