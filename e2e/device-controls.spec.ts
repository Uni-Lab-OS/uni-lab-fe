import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  startOfflineLocalBridge,
  type OfflineLocalBridge
} from './helpers/offline-local-bridge'

const ARTIFACT_ROOT = resolve(
  process.cwd(),
  '../e2e-artifacts',
  'device-controls'
)

test.describe('Edge device catalog and single-action debug', () => {
  let bridge: OfflineLocalBridge

  test.beforeAll(async () => {
    bridge = await startOfflineLocalBridge(0.35)
  })

  test.afterAll(async () => {
    await bridge.stop()
  })

  test('Edge-reported action node can be executed through the OS runtime', async ({
    page
  }) => {
    const browserErrors = observeBrowserErrors(page)
    const runtimeRequests: Array<{
      url: string
      method: string
      body: unknown
    }> = []
    page.on('request', (request) => {
      if (!request.url().includes('/api/v1/')) return
      runtimeRequests.push({
        url: request.url(),
        method: request.method(),
        body: request.postDataJSON() as unknown
      })
    })

    await page.goto(`/?localOsUrl=${encodeURIComponent(bridge.url)}`)

    const navigation = page.getByRole('navigation', { name: '主导航' })
    await expect(
      navigation.getByRole('button', { name: '仪器设备' })
    ).toBeVisible()
    await expect(
      navigation.getByRole('button', { name: '工作流' })
    ).toBeVisible()
    await expect(
      navigation.getByRole('button', { name: '物料' })
    ).toHaveCount(0)

    const connectionHeader = page.getByRole('group', {
      name: 'Edge 连接配置'
    })
    await expect(connectionHeader).toBeVisible()
    await expect(
      connectionHeader.getByText('Edge 已连接', { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText('4 台设备 · Edge 实时上报')
    ).toBeVisible()
    await expect(
      page
        .getByRole('complementary', { name: 'Edge 设备列表' })
        .getByText('默认', { exact: true })
    ).toHaveCount(0)
    await page.getByRole('button', { name: /pump-1/ }).click()

    const detail = page.getByRole('main')
    await expect(
      detail.getByRole('heading', { name: 'pump-1', exact: true })
    ).toBeVisible()
    await expect(
      detail.getByRole('button', { name: '加液 动作节点' })
    ).toBeVisible()
    await detail.getByRole('spinbutton', { name: 'volume' }).fill('12.5')

    await detail.getByRole('button', { name: '运行此动作' }).click()

    await expect(detail.getByText('执行中', { exact: true })).toBeVisible()
    await expect(detail.getByText('执行成功', { exact: true }))
      .toBeVisible({ timeout: 10_000 })
    await expect(detail.getByLabel('Action 运行日志')).toBeVisible()

    const runRequest = runtimeRequests.find(
      (request) =>
        request.method === 'POST'
        && request.url.endsWith('/api/v1/runtime/runs')
    )
    expect(runRequest?.body).toMatchObject({
      source: {
        format: 'workflow_revision_v2',
        revision: {
          schema_version: '2',
          invocations: [
            {
              node_id: 'action',
              action_ref: 'pump-1.dose',
              input_bindings: {
                volume: {
                  kind: 'literal',
                  value: 12.5
                }
              }
            }
          ],
          control_edges: []
        }
      }
    })
    expect(
      runtimeRequests.some((request) =>
        request.url.endsWith('/api/v1/workflow-node-templates')
      )
    ).toBe(true)
    expect(
      runtimeRequests.some((request) =>
        /\/api\/v1\/runtime\/runs\/[^/]+\/nodes$/.test(request.url)
      )
    ).toBe(true)

    mkdirSync(ARTIFACT_ROOT, { recursive: true })
    await page.screenshot({
      path: resolve(ARTIFACT_ROOT, 'edge-action-debug-success.png'),
      animations: 'disabled',
      fullPage: false
    })

    expect(browserErrors).toEqual([])
  })
})

function observeBrowserErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}
