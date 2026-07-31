import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

import { startOfflineLocalBridge } from './helpers/offline-local-bridge'

test('已保存的导入工作流在切换模块后仍然保留', async ({ page }) => {
  const profilePath = resolve(
    process.cwd(),
    'e2e/fixtures/host-node-test-latency/profile.yaml'
  )
  const bridge = await startOfflineLocalBridge(0, [profilePath])

  try {
    await page.goto(
      `/?localOsUrl=${encodeURIComponent(bridge.url)}&enable=materialNav`
    )
    await page.getByText('工作流', { exact: true }).first().click()
    await page.locator('input[type="file"]').setInputFiles({
      name: 'persisted-workflow.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(IMPORTED_WORKFLOW))
    })

    await expect(page.locator('.cm-content:visible')).toContainText(
      '"workflow_id": "persistence-e2e"'
    )
    await page.getByRole('button', { name: '保存修订版本' }).click()
    await page.getByRole('dialog', {
      name: '是否同时保存更新后的文件？'
    }).getByRole('button', {
      name: '仅保存修订'
    }).click()
    await expect(page.getByText(/已保存修订版本/)).toBeVisible()

    await page.getByText('物料', { exact: true }).first().click()
    await expect(
      page.locator('[data-panel-type="layout-unified"]')
    ).toBeVisible()

    await page.getByText('工作流', { exact: true }).first().click()
    await expect(
      page.locator('[data-panel-type="workflow-dag"]')
    ).toBeVisible()
    await expect(page.locator('.cm-content:visible')).toContainText(
      '"workflow_id": "persistence-e2e"'
    )
  } finally {
    await bridge.stop()
  }
})

test('当前工作流在切换左侧模块后仍然保留', async ({ page }) => {
  const profilePath = resolve(
    process.cwd(),
    'e2e/fixtures/host-node-test-latency/profile.yaml'
  )
  const bridge = await startOfflineLocalBridge(0, [profilePath])

  try {
    await page.goto(
      `/?localOsUrl=${encodeURIComponent(bridge.url)}&enable=materialNav`
    )
    await page.getByText('工作流', { exact: true }).first().click()
    await page.locator('input[type="file"]').setInputFiles({
      name: 'current-workflow.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(IMPORTED_WORKFLOW))
    })

    const editor = page.locator('.cm-content:visible')
    await expect(editor).toContainText(
      '"workflow_id": "persistence-e2e"'
    )
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n ')
    await expect(
      page.locator('span:visible', { hasText: /^● 未保存$/ })
    ).toBeVisible()

    let navigationMessage = ''
    page.once('dialog', (dialog) => {
      navigationMessage = dialog.message()
      void dialog.accept()
    })
    await page.getByText('仪器设备', { exact: true }).first().click()
    expect(navigationMessage).toContain('切换到“仪器设备”后修改仍会保留')
    await expect(
      page.getByRole('navigation', { name: '主导航' })
        .getByRole('button', { name: '仪器设备' })
    ).toHaveAttribute('aria-current', 'page')

    await page.getByText('工作流', { exact: true }).first().click()
    await expect(
      page.locator('[data-panel-type="workflow-dag"]')
    ).toBeVisible()
    await expect(page.locator('.cm-content:visible')).toContainText(
      '"workflow_id": "persistence-e2e"'
    )
    await expect(
      page.locator('span:visible', { hasText: /^● 未保存$/ })
    ).toBeVisible()

    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByText('物料', { exact: true }).first().click()
    await expect(
      page.getByRole('navigation', { name: '主导航' })
        .getByRole('button', { name: '物料' })
    ).toHaveAttribute('aria-current', 'page')

    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByText('工作流', { exact: true }).first().click()
    await expect(page.locator('.cm-content:visible')).toContainText(
      '"workflow_id": "persistence-e2e"'
    )
    await expect(
      page.locator('span:visible', { hasText: /^● 未保存$/ })
    ).toBeVisible()
  } finally {
    await bridge.stop()
  }
})

test('Python 可直接粘贴或导入并自动投影到画布', async ({ page }) => {
  const profilePath = resolve(
    process.cwd(),
    'e2e/fixtures/host-node-test-latency/profile.yaml'
  )
  const bridge = await startOfflineLocalBridge(0, [profilePath])

  try {
    await page.goto(`/?localOsUrl=${encodeURIComponent(bridge.url)}`)
    await page.getByText('工作流', { exact: true }).first().click()

    const pythonMode = page.getByRole('button', {
      name: 'Python',
      exact: true
    })
    await pythonMode.click()
    await expect(pythonMode).toHaveAttribute('aria-pressed', 'true')

    const editor = page.locator('.cm-content:visible')
    await editor.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.insertText(PYTHON_WORKFLOW)
    await expect(page.getByText(
      /Python 已自动应用到画布 · 2 节点 · 1 边/
    )).toBeVisible()
    await expect(page.locator('.react-flow__node-wfNode')).toHaveCount(2)
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)
    await expect(
      page.locator('.workflow-runtime__projection-state')
    ).toHaveCount(0)

    await page.getByLabel('选择工作流文件').setInputFiles({
      name: 'python-import-e2e.py',
      mimeType: 'text/x-python',
      buffer: Buffer.from(PYTHON_IMPORTED_WORKFLOW)
    })
    await expect(page.getByText(
      /python-import-e2e\.py 已应用到画布 · 1 个节点 · 0 条控制边/
    )).toBeVisible()
    await expect(page.locator('.react-flow__node-wfNode')).toHaveCount(1)
    await expect(page.locator('.react-flow__edge')).toHaveCount(0)
    await expect(page.getByText(
      'python-import-e2e.py',
      { exact: true }
    )).toBeVisible()
  } finally {
    await bridge.stop()
  }
})

const PYTHON_WORKFLOW = `\
from unilabos.workflow.authoring import device, workflow_definition

host_node = device("host_node")

@workflow_definition(workflow_id="python-direct-e2e", revision="python-v1")
def python_direct_e2e() -> None:
    host_node.test_latency()
    host_node.test_latency()
`

const PYTHON_IMPORTED_WORKFLOW = `\
from unilabos.workflow.authoring import device, workflow_definition

host_node = device("host_node")

@workflow_definition(workflow_id="python-import-e2e", revision="python-v1")
def python_import_e2e() -> None:
    host_node.test_latency()
`

const IMPORTED_WORKFLOW = {
  name: 'Persistence E2E',
  target_lab_uuid: 'fixture-lab',
  data: {
    workflow_uuid: 'persistence-e2e',
    workflow_name: 'Persistence E2E',
    nodes: [
      {
        uuid: 'persisted-node',
        name: 'test_latency',
        type: 'ILab',
        pose: { position: { x: 120, y: 80, z: 0 } },
        param: {},
        lab_node_type: 'Device',
        template_name: 'test_latency',
        device_name: 'host_node'
      }
    ],
    edges: []
  }
}
