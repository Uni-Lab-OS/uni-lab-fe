import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { expect, test } from '@playwright/test'

const enabled = process.env.UNILAB_E2E_WORKBENCH_BACKEND_MATERIAL === '1'
const workbenchUrl = process.env.UNILAB_WORKBENCH_URL ??
  'http://127.0.0.1:3110/#/home/wangtao/Uni-Lab-SZLab'

test.skip(
  !enabled,
  '需要显式启动 Workbench 与 Backend；测试只读取物料图，不创建任务或运行动作'
)

/**
 * 验证 Workbench 切换 Backend 后关闭连接浮层，并对缺失空间合同的物料图诚实降级。
 */
test('shows the Backend material graph as list-only without inventing a scene', async ({
  page
}) => {
  const artifactDirectory = resolve(
    process.env.UNILAB_E2E_ARTIFACT_DIR ??
      resolve(process.cwd(), 'e2e-artifacts/workbench-backend-material-readonly')
  )
  mkdirSync(artifactDirectory, { recursive: true })
  const browserErrors: string[] = []
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !message.text().startsWith('Failed to load resource:')
    ) browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto(workbenchUrl)
  const connectionSelector = page.locator(
    'details.unilab-workbench-connection'
  )
  const backendOption = connectionSelector.locator('button').filter({
    hasText: 'Backend + Scheduler'
  })
  await expect(connectionSelector).toBeVisible()
  const selectorOpen = await connectionSelector.evaluate(
    (element) => (element as HTMLDetailsElement).open
  )
  if (!selectorOpen) {
    await connectionSelector.locator('summary').click()
  }
  await expect(backendOption).toBeVisible()
  await backendOption.click()

  await expect(connectionSelector).not.toHaveAttribute('open', '')
  await expect(page.locator('.unilab-workbench')).toHaveAttribute(
    'data-connection-mode',
    'backend'
  )
  await expect(page.getByText('Backend 已连接', { exact: true })).toBeVisible()

  const graphResponse = await page.request.get(
    new URL(
      '/__unilab_backend/api/v1/materials/graph',
      workbenchUrl
    ).toString()
  )
  expect(graphResponse.status()).toBe(200)
  const graph = await graphResponse.json() as {
    data: {
      nodes: Array<{
        relative_position: unknown
        current_site_uuid: unknown
        sites: unknown[]
      }>
    }
  }
  expect(graph.data.nodes.length).toBeGreaterThan(0)
  expect(graph.data.nodes.every((node) => (
    node.relative_position == null &&
    node.current_site_uuid == null &&
    node.sites.length === 0
  ))).toBe(true)

  await page.locator('[id="shell-tab-unilab:material-navigation"]').click()
  await expect(page.getByRole('region', { name: '物料窗口' })).toBeVisible()
  const sceneState = page.locator('[data-material-scene-state="list-only"]')
  await expect(sceneState).toContainText('空间视图暂不可用')
  await expect(sceneState).toContainText(`已读取 ${graph.data.nodes.length} 项物料`)
  await expect(sceneState).toContainText('已定位0')
  await expect(sceneState).toContainText('库位0')
  await expect(page.getByRole('group', { name: '实验室视图' })).toHaveCount(0)
  await page.screenshot({
    path: join(artifactDirectory, 'backend-material-list-only.png'),
    fullPage: true,
    animations: 'disabled'
  })

  expect(browserErrors).toEqual([])
})
