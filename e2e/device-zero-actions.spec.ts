import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expect, test } from '@playwright/test'

const API_URL = 'http://127.0.0.1:18003'

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
  const workspace = page.locator('.edge-device__workspace')
  await expect(workspace.getByRole('heading', { name: 'empty_device' }))
    .toBeVisible()
  await expect(workspace).toContainText(
    'Edge 已上报该设备，但没有可调试的动作节点。'
  )
  await expect(workspace.locator('.edge-device__action-node')).toHaveCount(0)
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
  expect(browserErrors).toEqual([])
})
