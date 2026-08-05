import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const ARTIFACT_ROOT = resolve(
  process.cwd(),
  '../e2e-artifacts',
  'device-action-run'
)

test.describe('Edge device Action single run', () => {
  test('does not synthesize robot or camera for an empty Edge catalog', async ({
    page
  }) => {
    await page.route('http://127.0.0.1:8014/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/health') {
        await route.fulfill({ json: { status: 'ok' } })
        return
      }
      if (path === '/api/v1/workflow-node-templates') {
        await route.fulfill({
          json: {
            schemaVersion: 'workflow-node-templates/v1',
            items: []
          }
        })
        return
      }
      await route.fulfill({
        status: 404,
        json: { message: `Unexpected request: ${path}` }
      })
    })

    await page.goto('/')

    const catalog = page.getByRole('complementary', {
      name: 'Edge 设备列表'
    })
    await expect(
      catalog.getByText('0 台设备 · Edge 实时上报')
    ).toBeVisible()
    await expect(
      catalog.getByText('等待 Edge 上报设备', { exact: true })
    ).toBeVisible()
    await expect(
      catalog.getByText(/机械臂|相机/)
    ).toHaveCount(0)
    await expect(
      page.getByRole('main').getByText('暂无可调试设备', { exact: true })
    ).toBeVisible()
  })

  test('keeps the existing catalog and form while persisting compact parameters and complete logs', async ({
    context,
    page
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    let createdRuns = 0
    let firstRunPolls = 0
    const createdRunBodies: Record<string, unknown>[] = []
    const terminatedRuns: string[] = []

    await page.route('http://127.0.0.1:8014/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname

      if (path === '/health') {
        await route.fulfill({ json: { status: 'ok' } })
        return
      }
      if (path === '/api/v1/workflow-node-templates') {
        await route.fulfill({
          json: {
            schemaVersion: 'workflow-node-templates/v1',
            items: [
              {
                id: 'pump_1.aspirate',
                kind: 'action',
                label: '吸液',
                inputSchema: {
                  volume: {
                    type: 'number',
                    title: '体积',
                    default: 10
                  },
                  settings: {
                    type: 'object',
                    title: '设置',
                    default: { speed: 'normal' }
                  }
                },
                outputSchema: {}
              },
              {
                id: 'pump_1.dispense',
                kind: 'action',
                label: '排液',
                inputSchema: {
                  volume: {
                    type: 'number',
                    title: '体积',
                    default: 2
                  }
                },
                outputSchema: {}
              }
            ]
          }
        })
        return
      }
      if (path === '/api/v1/runtime/runs' && request.method() === 'POST') {
        createdRuns += 1
        createdRunBodies.push(request.postDataJSON() as Record<string, unknown>)
        await route.fulfill({
          json: { id: `run-${createdRuns}`, status: 'pending' }
        })
        return
      }
      if (path === '/api/v1/runtime/runs/run-1') {
        firstRunPolls += 1
        await route.fulfill({
          json: {
            id: 'run-1',
            status: firstRunPolls === 1 ? 'running' : 'failed'
          }
        })
        return
      }
      if (path === '/api/v1/runtime/runs/run-1/nodes') {
        await route.fulfill({
          json: {
            items: firstRunPolls > 1
              ? [{
                  nodeId: 'action',
                  sourceNodeId: 'action',
                  nodeType: 'action',
                  deviceId: 'pump_1',
                  actionName: 'aspirate',
                  state: 'failed',
                  result: {
                    info: ['pump started', 'pressure stable'],
                    error:
                      'Traceback (most recent call last):\nRuntimeError: blocked'
                  },
                  attempt: 1
                }]
              : [{
                  nodeId: 'action',
                  sourceNodeId: 'action',
                  nodeType: 'action',
                  deviceId: 'pump_1',
                  actionName: 'aspirate',
                  state: 'running',
                  result: {},
                  attempt: 1
                }]
          }
        })
        return
      }
      if (path === '/api/v1/runtime/runs/run-1/events') {
        await route.fulfill({
          json: {
            events: [{
              seq: 1,
              runId: 'run-1',
              type: 'node_feedback',
              nodeId: 'action',
              payload: { progress: 0.5 }
            }],
            nextSeq: 1
          }
        })
        return
      }
      if (path === '/api/v1/runtime/runs/run-2') {
        await route.fulfill({
          json: {
            id: 'run-2',
            status: terminatedRuns.includes('run-2')
              ? 'cancelled'
              : 'running'
          }
        })
        return
      }
      if (path === '/api/v1/runtime/runs/run-2/nodes') {
        await route.fulfill({
          json: {
            items: [{
              nodeId: 'action',
              sourceNodeId: 'action',
              nodeType: 'action',
              deviceId: 'pump_1',
              actionName: 'aspirate',
              state: terminatedRuns.includes('run-2')
                ? 'cancelled'
                : 'running',
              result: terminatedRuns.includes('run-2')
                ? { info: 'terminate acknowledged' }
                : {},
              attempt: 1
            }]
          }
        })
        return
      }
      if (path === '/api/v1/runtime/runs/run-2/events') {
        await route.fulfill({
          json: { events: [], nextSeq: 0 }
        })
        return
      }
      if (
        path === '/api/v1/runtime/runs/run-2/commands'
        && request.method() === 'POST'
      ) {
        expect(request.postDataJSON()).toEqual({
          command: 'terminate',
          payload: {}
        })
        terminatedRuns.push('run-2')
        await route.fulfill({
          json: {
            status: 'accepted',
            debug: { status: 'terminated', stopReason: 'terminate' }
          }
        })
        return
      }

      await route.fulfill({
        status: 404,
        json: { message: `Unexpected request: ${request.method()} ${path}` }
      })
    })

    await page.goto('/')

    const connectionHeader = page.getByRole('group', {
      name: 'Edge 连接配置'
    })
    await expect(connectionHeader).toBeVisible()
    await expect(
      connectionHeader.getByText('Edge 已连接', { exact: true })
    ).toBeVisible()

    const catalog = page.getByRole('complementary', {
      name: 'Edge 设备列表'
    })
    await expect(catalog).toBeVisible()
    await expect(
      catalog.getByText('1 台设备 · Edge 实时上报')
    ).toBeVisible()
    await expect(catalog.getByRole('listitem')).toHaveCount(1)
    await catalog.getByRole('button', { name: /pump_1/ }).click()

    const detail = page.getByRole('main')
    await expect(
      detail.getByRole('heading', { name: 'pump_1', exact: true })
    ).toBeVisible()
    await detail.getByRole('button', { name: '吸液 动作节点' }).click()
    await expect(
      detail.getByRole('button', { name: '吸液 动作节点' })
    ).toHaveAttribute('title', '吸液')

    const volume = detail.getByRole('spinbutton', { name: '体积' })
    const settings = detail.getByRole('textbox', { name: '设置' })
    await expect(volume).toHaveValue('10')
    await expect(settings).toHaveValue('{\n  "speed": "normal"\n}')
    expect(
      await settings.evaluate((element) =>
        element.getBoundingClientRect().height
      )
    ).toBeLessThanOrEqual(70)

    await volume.fill('12')
    await settings.fill('{\n  "speed": "slow"\n}')
    await detail.getByRole('button', { name: '排液 动作节点' }).click()
    await expect(volume).toHaveValue('2')
    await detail.getByRole('button', { name: '吸液 动作节点' }).click()
    await expect(volume).toHaveValue('12')
    await expect(settings).toHaveValue('{\n  "speed": "slow"\n}')

    await detail.getByRole('button', { name: '运行此动作' }).click()
    await expect(detail.getByText('执行失败', { exact: true }))
      .toBeVisible({ timeout: 10_000 })

    const logs = detail.getByLabel('Action 运行日志')
    await expect(logs).toContainText('progress')
    await expect(logs).toContainText('pump started')
    await expect(logs).toContainText('pressure stable')
    await expect(logs).toContainText('Traceback (most recent call last)')
    await expect(logs).toContainText('RuntimeError: blocked')

    const copyButton = detail.getByRole('button', {
      name: '复制',
      exact: true
    })
    await copyButton.click()
    await expect(
      detail.getByRole('button', { name: '已复制', exact: true })
    ).toHaveAttribute('data-copied', 'true')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('Traceback (most recent call last)')

    mkdirSync(ARTIFACT_ROOT, { recursive: true })
    await page.screenshot({
      path: resolve(ARTIFACT_ROOT, 'action-single-run.png'),
      animations: 'disabled',
      fullPage: false
    })

    await detail.getByRole('button', { name: '运行此动作' }).click()
    const terminate = detail.getByRole('button', {
      name: '终止',
      exact: true
    })
    await expect(terminate).toBeEnabled()
    await terminate.click()
    await expect.poll(() => terminatedRuns).toContain('run-2')
    expect(createdRunBodies[1]).toMatchObject({
      debug: {
        pause_on_start: false,
        breakpoints: []
      }
    })
    await expect(detail.getByText('已停止', { exact: true })).toBeVisible()
    await expect(detail.getByLabel('Action 运行日志'))
      .toContainText('terminate acknowledged')
  })
})
