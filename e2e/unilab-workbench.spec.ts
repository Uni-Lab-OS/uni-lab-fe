import { expect, test } from '@playwright/test'

const workbenchUrl = process.env.UNILAB_WORKBENCH_URL

test.describe('UniLab Workbench real-system contract', () => {
  test.skip(!workbenchUrl, 'UNILAB_WORKBENCH_URL is required')

  test('keeps the renderer responsive after UniLab Agent branding mounts', async ({
    page
  }) => {
    test.setTimeout(15_000)
    await page.goto(workbenchUrl!, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('iframe.unilab-aionui__frame')).toBeAttached()

    await page.waitForTimeout(2_000)
    const agentFrame = page.frameLocator('iframe.unilab-aionui__frame')
    await expect(agentFrame.getByText(/今天有什么安排/)).toBeVisible()
    await expect(agentFrame.locator(
      'input[placeholder="请输入用户名"]'
    )).toHaveCount(0)
    await expect(agentFrame.getByTestId('opening-guide')).toHaveCount(0)
    const agentStatus = await agentFrame.locator('body').evaluate(async () => {
      const response = await fetch('/__unilab/status')
      return response.json() as Promise<{
        workspacePath: string
        workDir: string
      }>
    })
    const expectedWorkspace = decodeURIComponent(
      new URL(workbenchUrl!).hash.replace(/^#\/?/, '/')
    )
    expect(agentStatus).toMatchObject({
      workspacePath: expectedWorkspace,
      workDir: expectedWorkspace
    })
    const managedConversation = await agentFrame.locator('body').evaluate(
      async (_, workspacePath) => {
        const response = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'UniLab managed Workspace E2E',
            assistant: {
              id: 'bare:8e1acf31',
              locale: 'zh-CN',
              conversation_overrides: {
                model: 'gpt-5.6-sol',
                permission: 'auto',
                thought_level: 'low',
                skill_ids: [],
                disabled_builtin_skill_ids: [],
                mcp_ids: []
              }
            },
            extra: {
              workspace: '',
              custom_workspace: false,
              default_files: []
            }
          })
        })
        if (!response.ok) throw new Error(`create failed: ${response.status}`)
        const envelope = await response.json() as {
          data: {
            id: string
            assistant?: { backend?: string }
            extra?: Record<string, unknown>
          }
        }
        return envelope.data
      },
      expectedWorkspace
    )
    expect(managedConversation).toMatchObject({
      assistant: { backend: 'codex' },
      extra: {
        workspace: expectedWorkspace
      }
    })
    await agentFrame.locator('body').evaluate(async (_, conversationId) => {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE'
      })
      if (!response.ok) throw new Error(`cleanup failed: ${response.status}`)
    }, managedConversation.id)
    await expect.poll(async () => page.evaluate(() => ({
      readyState: document.readyState,
      title: document.title
    })), { timeout: 2_000 }).toEqual({
      readyState: 'complete',
      title: 'UniLab 调试工作台 - Uni-Lab-SZLab'
    })

    await page.getByRole('button', { name: '查看 OS 日志' }).click()
    await expect(page.getByTestId('session-log-tail')).toBeVisible()
  })

  test('binds the exact package source and keeps bidirectional authoring usable', async ({
    page
  }) => {
    await page.goto(workbenchUrl!)
    const workbench = page.locator('[data-package-mount-count="1"]')
    await expect(workbench).toBeVisible()

    const unilabActivityTabs = page.locator(
      '.theia-app-left .lm-TabBar-tab[data-unilabgroup="true"]:not([id$="-hidden"])'
    )
    await expect(unilabActivityTabs).toHaveCount(8)
    await expect.poll(async () => unilabActivityTabs.evaluateAll(tabs =>
      tabs.map(tab => tab.id)
    )).toEqual([
      'shell-tab-unilab:device-management-navigation',
      'shell-tab-unilab:robot-debug-navigation',
      'shell-tab-unilab:robot-points-navigation',
      'shell-tab-unilab:robot-bench-navigation',
      'shell-tab-unilab:robot-reagents-navigation',
      'shell-tab-unilab:material-navigation',
      'shell-tab-unilab:workbench-navigator',
      'shell-tab-unilab:agent-navigation'
    ])
    await expect.poll(() => page.evaluate(() => [
      getComputedStyle(document.querySelector<HTMLElement>(
        '.theia-app-left .lm-TabBar-tab[data-unilabgroup="true"]'
      )!, '::before').content,
      getComputedStyle(document.querySelector<HTMLElement>(
        '[id="shell-tab-explorer-view-container"]'
      )!, '::before').content
    ])).toEqual(['"UNILAB"', '"IDE"'])
    await expect(page.locator(
      '.theia-app-right [id="shell-tab-unilab:agent"]'
    )).toBeHidden()
    await expect(workbench).toHaveAttribute('data-session-mode', 'normal')
    await expect(workbench).toHaveAttribute(
      'data-workspace-graph-fingerprint',
      /^[0-9a-f]{64}$/
    )
    await expect(workbench).toHaveAttribute(
      'data-package-catalog-revision',
      /^sha256:[0-9a-f]{64}$/
    )
    await page.getByRole('button', { name: '查看 OS 日志' }).click()
    await expect(page.getByTestId('session-log-tail')).toContainText(/\S/)
    await page.getByText('OS 日志尾部', { exact: true }).click()
    await expect(page.getByText('完整控制流 DAG')).toBeVisible()
    await page.locator('.react-flow__node').first().click()
    await expect(page.locator('.monaco-editor .view-line').first()).toBeVisible()

    await expect.poll(async () => page.evaluate(() => {
      const tokens = Array.from(document.querySelectorAll(
        '.monaco-editor .view-line span'
      )).filter((element) => (
        element.children.length === 0 &&
        Boolean(element.textContent?.trim())
      ))
      return new Set(tokens.map((element) => (
        getComputedStyle(element).color
      ))).size
    })).toBeGreaterThan(1)

    const mappedCall = page.locator('.monaco-editor .view-line').filter({
      hasText: 'run_solvent_addition'
    })
    await expect(mappedCall).toBeVisible()
    await mappedCall.click()
    await expect.poll(async () => page.evaluate(() => {
      const highlighted = Array.from(document.querySelectorAll<HTMLElement>(
        '.wf-node--source-selected'
      ))
      const workflow = document.querySelector<HTMLElement>('.workflow-runtime')
      const focusColor = workflow
        ? getComputedStyle(workflow).getPropertyValue(
          '--unilab-color-focus'
        ).trim()
        : ''
      const colorProbe = document.createElement('span')
      colorProbe.style.color = focusColor
      document.body.append(colorProbe)
      const resolvedFocusColor = getComputedStyle(colorProbe).color
      colorProbe.remove()
      return {
        mappedNode: document.querySelector('[data-testid="sync-node"]')
          ?.textContent?.trim() ?? '',
        selectedNodes: highlighted.map((element) => (
          element.getAttribute('data-workflow-node-uuid')
        )),
        hasFocusBorder: highlighted.length === 1 &&
          getComputedStyle(highlighted[0]!).borderColor ===
            resolvedFocusColor
      }
    })).toEqual({
      mappedNode: 'a31553c3-8a3d-5c1c-aa16-b759faf6894e',
      selectedNodes: ['a31553c3-8a3d-5c1c-aa16-b759faf6894e'],
      hasFocusBorder: true
    })

    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '画布模式', exact: true }).click()
    const nodeEditor = page.getByRole('complementary', {
      name: '画布节点编辑器'
    })
    await expect(nodeEditor).toBeVisible()
    await page.locator('.react-flow__node').filter({
      hasText: 'run_solvent_addition'
    }).click()
    await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0)
    await expect(nodeEditor).toBeVisible()

    const layout = await page.evaluate(() => {
      const workflow = document.querySelector<HTMLElement>('.workflow-runtime')
      const workbench = document.querySelector<HTMLElement>(
        '.persistent-authoring__workbench'
      )
      const canvas = document.querySelector<HTMLElement>(
        '.persistent-authoring__graph-stage'
      )
      const inspector = document.querySelector<HTMLElement>(
        '.persistent-authoring__node-editor'
      )
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(
        '.react-flow__node'
      )).map((element) => element.getBoundingClientRect())
      const overlaps = nodes.flatMap((left, index) => (
        nodes.slice(index + 1).filter((right) => (
          left.left < right.right &&
          left.right > right.left &&
          left.top < right.bottom &&
          left.bottom > right.top
        ))
      )).length
      const workflowRect = workflow?.getBoundingClientRect()
      const inspectorRect = inspector?.getBoundingClientRect()
      const viewport = document.querySelector<HTMLElement>(
        '.react-flow__viewport'
      )
      const transform = viewport?.style.transform.match(/scale\(([^)]+)\)/)

      return {
        workbenchHeight: workbench?.getBoundingClientRect().height ?? 0,
        canvasHeight: canvas?.getBoundingClientRect().height ?? 0,
        inspectorWithinWorkflow: !inspectorRect || Boolean(
          workflowRect && inspectorRect.right <= workflowRect.right + 1
        ),
        overlaps,
        zoom: transform ? Number(transform[1]) : 0
      }
    })

    expect(layout.workbenchHeight).toBeGreaterThan(260)
    expect(layout.canvasHeight).toBeGreaterThan(300)
    expect(layout.inspectorWithinWorkflow).toBe(true)
    expect(layout.overlaps).toBe(0)
    expect(layout.zoom).toBeGreaterThanOrEqual(0.8)
  })

  test('toggles Workbench panels without opening the native IDE sidebar', async ({
    page
  }) => {
    await page.goto(workbenchUrl!)
    const workbench = page.locator('[data-package-mount-count="1"]')
    await expect(workbench).toBeVisible()

    await page.locator('[id="shell-tab-unilab:material-navigation"]').click()
    await expect(page.locator('main[data-workbench-view]')).toHaveAttribute(
      'data-workbench-view',
      'split'
    )
    await expect(page.getByRole('region', { name: '物料窗口' })).toBeVisible()
    await expect(page.getByRole('region', { name: '工作流窗口' })).toBeVisible()
    await expect(page.locator(
      '[id="shell-tab-unilab:workbench-navigator"]'
    )).toHaveAttribute('data-unilabactive', 'true')
    await expect(page.locator(
      '[id="shell-tab-unilab:material-navigation"]'
    )).toHaveAttribute('data-unilabactive', 'true')
    await expect(page.locator(
      '[id="shell-tab-unilab:device-management-navigation"]'
    )).toHaveAttribute('data-unilabactive', 'false')
    await expect(page.locator('#theia-left-content-panel')).toHaveClass(
      /theia-mod-collapsed/
    )
    const agentActivityTab = page.locator(
      '[id="shell-tab-unilab:agent-navigation"]'
    )
    const agentWasActive = await agentActivityTab.getAttribute(
      'data-unilabactive'
    )
    await agentActivityTab.click()
    await expect(agentActivityTab).toHaveAttribute(
      'data-unilabactive',
      agentWasActive === 'true' ? 'false' : 'true'
    )
    await expect(page.locator('#theia-left-content-panel')).toHaveClass(
      /theia-mod-collapsed/
    )
    await agentActivityTab.click()
    await expect(agentActivityTab).toHaveAttribute(
      'data-unilabactive',
      agentWasActive ?? 'false'
    )

    await page.locator('[id="shell-tab-unilab:workbench-navigator"]').click()
    await expect(page.locator('main[data-workbench-view]')).toHaveAttribute(
      'data-workbench-view',
      'material'
    )
    await expect(page.getByRole('region', { name: '工作流窗口' })).toBeHidden()

    await page.locator(
      '[id="shell-tab-unilab:device-management-navigation"]'
    ).click()
    await expect(page.locator('main[data-workbench-view]')).toHaveAttribute(
      'data-workbench-view',
      'device'
    )
    await expect(page.getByRole('region', {
      name: '仪器设备窗口'
    })).toBeVisible()
    await expect(page.getByRole('heading', {
      name: '仪器设备',
      exact: true
    })).toBeVisible()

    await page.locator(
      '[id="shell-tab-unilab:device-management-navigation"]'
    ).click()
    await expect(page.locator('main[data-workbench-view]')).toHaveAttribute(
      'data-workbench-view',
      'material'
    )
    await expect(page.getByRole('region', { name: '物料窗口' })).toBeVisible()

    await page.locator('[id="shell-tab-unilab:workbench-navigator"]').click()
    await expect(page.locator('main[data-workbench-view]')).toHaveAttribute(
      'data-workbench-view',
      'split'
    )
    await expect(page.locator('[id="shell-tab-unilab:split-navigation"]'))
      .toHaveCount(0)

    const separator = page.getByRole('separator', {
      name: '调整工作流与物料窗口宽度'
    })
    await separator.focus()
    await page.keyboard.press('ArrowRight')
    await expect(separator).toHaveAttribute('aria-valuenow', '60')
  })

  test('keeps material overlays behind the Agent panel', async ({ page }) => {
    await page.setViewportSize({ width: 1630, height: 1090 })
    await page.goto(workbenchUrl!)
    await expect(page.locator('[id="unilab:authoring-workbench"]')).toBeVisible()

    const materialNavigation = page.locator(
      '[id="shell-tab-unilab:material-navigation"]'
    )
    const agentNavigation = page.locator(
      '[id="shell-tab-unilab:agent-navigation"]'
    )
    const agentPanel = page.locator('[id="unilab:agent"]')
    const materialLauncher = page.locator(
      'button[title="浏览仪器设备模板"]'
    )

    if (!await materialLauncher.isVisible()) await materialNavigation.click()
    if (!await agentPanel.isVisible()) await agentNavigation.click()
    await expect(materialLauncher).toBeVisible()
    await expect(agentPanel).toBeVisible()

    const layering = await page.evaluate(() => {
      const launcher = document.querySelector<HTMLElement>(
        'button[title="浏览仪器设备模板"]'
      )
      const agent = document.getElementById('unilab:agent')
      if (!launcher || !agent) throw new Error('layout probe is not ready')

      const launcherRect = launcher.getBoundingClientRect()
      const agentRect = agent.getBoundingClientRect()
      const overlap = launcherRect.right > agentRect.left
      const probeX = overlap
        ? Math.max(launcherRect.left, agentRect.left) + 1
        : agentRect.left + 1
      const probeY = launcherRect.top + launcherRect.height / 2
      const topElement = document.elementsFromPoint(probeX, probeY)[0]

      return {
        overlap,
        topElementOwnedByAgent: Boolean(topElement?.closest('#unilab\\:agent'))
      }
    })

    expect(layering.topElementOwnedByAgent).toBe(true)
  })

  test('hides workflow output while the terminal panel is open', async ({
    page
  }) => {
    test.setTimeout(120_000)
    await page.goto(workbenchUrl!)
    await page.getByRole('button', {
      name: '打开工作流 SZLab 单样品原子流程（无 S07 扫码）'
    }).click()

    const output = page.locator('.workflow-runtime__results')
    const outputHeader = output.locator('.workflow-runtime__output-header')
    const outputBody = output.locator('.workflow-runtime__output-body')
    const graph = page.locator('.persistent-authoring__graph-stage')
    const outputResizer = output.locator('.workflow-runtime__output-resizer')
    await expect(output).toBeVisible()
    await expect(outputHeader).toBeVisible()
    await expect(outputBody).toBeVisible()
    await expect(outputResizer).toBeVisible()
    await expect(graph).toBeVisible({ timeout: 90_000 })
    const resizerBox = await outputResizer.boundingBox()
    expect(resizerBox).not.toBeNull()
    await page.mouse.move(
      resizerBox!.x + resizerBox!.width / 2,
      resizerBox!.y + resizerBox!.height / 2
    )
    await page.mouse.down()
    await page.mouse.move(
      resizerBox!.x + resizerBox!.width / 2,
      resizerBox!.y - 500,
      { steps: 10 }
    )
    await page.mouse.up()
    const preferredHeight = Number(
      await outputResizer.getAttribute('aria-valuenow')
    )
    const preferredRenderedHeight = (await output.boundingBox())!.height
    expect(preferredHeight).toBeGreaterThan(120)

    await page.getByText('终端', { exact: true }).click()
    await page.getByText('新建终端', { exact: true }).click()
    const bottomPanel = page.locator('#theia-bottom-content-panel')
    await expect(bottomPanel).toBeVisible()
    await expect(output).toBeHidden()
    await expect(outputHeader).toBeHidden()
    await expect(outputBody).toBeHidden()
    await expect(outputResizer).toBeHidden()

    await page.locator('#status-bar-bottom-panel-toggle').click()
    await expect(bottomPanel).toBeHidden()
    await expect(output).toBeVisible()
    await expect(outputHeader).toBeVisible()
    await expect(outputBody).toBeVisible()
    await expect(outputResizer).toBeVisible()
    await expect.poll(async () => Number(
      await outputResizer.getAttribute('aria-valuenow')
    )).toBe(preferredHeight)
    await expect.poll(async () => Math.round(
      (await output.boundingBox())?.height ?? -1
    )).toBe(Math.round(preferredRenderedHeight))
  })

  test('reopens an empty bottom panel with a terminal', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto(workbenchUrl!)

    const bottomPanel = page.locator('#theia-bottom-content-panel')
    const bottomPanelToggle = page.locator('#status-bar-bottom-panel-toggle')
    const bottomTabs = bottomPanel.locator('.lm-TabBar-tab')

    await page.getByText('终端', { exact: true }).click()
    await page.getByText('新建终端', { exact: true }).click()
    await expect(bottomPanel).toBeVisible()
    await expect(
      bottomPanel.locator('.terminal-container:visible')
    ).toBeVisible()

    for (let remaining = await bottomTabs.count(); remaining > 0;) {
      const closeButtons = bottomPanel.locator(
        '.lm-TabBar-tabCloseIcon:visible'
      )
      expect(await closeButtons.count()).toBeGreaterThan(0)
      await closeButtons.last().click()
      await expect(bottomTabs).toHaveCount(remaining - 1)
      remaining -= 1
    }

    await expect(bottomPanel).toBeHidden()
    await bottomPanelToggle.click()

    await expect(bottomPanel).toBeVisible()
    await expect(bottomTabs).toHaveCount(1)
    await expect(
      bottomPanel.locator('.terminal-container:visible')
    ).toBeVisible()

    await bottomPanelToggle.click()
    await expect(bottomPanel).toBeHidden()
    await bottomPanelToggle.click()
    await expect(bottomPanel).toBeVisible()
    await expect(bottomTabs).toHaveCount(1)
    await expect(
      bottomPanel.locator('.terminal-container:visible')
    ).toBeVisible()
  })

  test('preserves the 3D camera and device picking across outer layout resize', async ({
    page
  }) => {
    test.setTimeout(120_000)
    await page.goto(workbenchUrl!)
    await expect(page.locator('[data-package-mount-count="1"]')).toBeVisible()

    const materialNavigation = page.locator(
      '[id="shell-tab-unilab:material-navigation"]'
    )
    const workflowNavigation = page.locator(
      '[id="shell-tab-unilab:workbench-navigator"]'
    )
    await workflowNavigation.click()
    await materialNavigation.click()
    await page.getByRole('button', { name: '3D', exact: true }).click()
    const visibleCanvas = page.locator('canvas:visible').first()
    await expect(visibleCanvas).toBeVisible()
    await expect(page.locator('.pascal-model-label').filter({
      hasText: 'SZLab 机械臂'
    }).first()).toBeVisible()

    const readProjection = async () => page.evaluate(() => {
      const canvas = Array.from(document.querySelectorAll('canvas')).find(
        (element) => {
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        }
      )
      const label = Array.from(document.querySelectorAll(
        '.pascal-model-label'
      )).find((element) => element.textContent?.trim() === 'SZLab 机械臂')
      if (!canvas || !label) throw new Error('3D projection is not ready')
      const canvasRect = canvas.getBoundingClientRect()
      const labelRect = label.getBoundingClientRect()
      return {
        labelCenterX: labelRect.left + labelRect.width / 2,
        labelCenterY: labelRect.top + labelRect.height / 2,
        normalizedY: (
          labelRect.top + labelRect.height / 2 - canvasRect.top
        ) / canvasRect.height
      }
    })

    const beforeResize = await readProjection()
    const workflowNavigationBox = await workflowNavigation.boundingBox()
    expect(workflowNavigationBox).not.toBeNull()
    await page.mouse.click(
      workflowNavigationBox!.x + workflowNavigationBox!.width / 2,
      workflowNavigationBox!.y + workflowNavigationBox!.height / 2
    )
    await expect(page.locator('main[data-workbench-view]')).toHaveAttribute(
      'data-workbench-view',
      'split'
    )
    await expect(visibleCanvas).toBeVisible()
    const afterResize = await readProjection()

    expect(Math.abs(
      afterResize.normalizedY - beforeResize.normalizedY
    )).toBeLessThan(0.005)

    await page.mouse.move(
      afterResize.labelCenterX,
      afterResize.labelCenterY + 100
    )
    await page.mouse.down()
    await page.mouse.move(
      afterResize.labelCenterX + 1,
      afterResize.labelCenterY + 101
    )
    await page.mouse.up()
    await expect(page.locator(
      '[role="treeitem"][aria-selected="true"]'
    )).toHaveCount(1)
  })
})
