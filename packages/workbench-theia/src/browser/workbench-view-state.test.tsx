import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { DomainEntryPanel } from './domain-entry-panel'
import { WorkbenchDomainLayout } from './workbench-domain-layout'
import {
  WorkbenchViewState,
  isWorkflowDebugWorkbenchView,
  isWorkflowManagementWorkbenchView
} from './workbench-view-state'

describe('工作流管理与调试布局边界', () => {
  it('只为工作流调试模式启用 debugLayout', () => {
    expect(isWorkflowDebugWorkbenchView('workflow')).toBe(true)
    expect(isWorkflowDebugWorkbenchView('workflow-files')).toBe(true)
    expect(isWorkflowDebugWorkbenchView('split')).toBe(true)

    expect(isWorkflowDebugWorkbenchView('workflow-management')).toBe(false)
    expect(isWorkflowDebugWorkbenchView('workflow-management-files')).toBe(false)
    expect(isWorkflowDebugWorkbenchView('workflow-management-material')).toBe(false)

    expect(isWorkflowManagementWorkbenchView('workflow')).toBe(false)
    expect(isWorkflowManagementWorkbenchView('workflow-files')).toBe(false)
    expect(isWorkflowManagementWorkbenchView('split')).toBe(false)
    expect(isWorkflowManagementWorkbenchView('workflow-management')).toBe(true)
    expect(isWorkflowManagementWorkbenchView('workflow-management-files')).toBe(true)
    expect(isWorkflowManagementWorkbenchView('workflow-management-material')).toBe(true)
  })
})

describe('工作台导航标题', () => {
  it('不再通过活动栏 hover 重复展示完整 caption', () => {
    const source = readFileSync(
      new URL('./unilab-workbench-navigator-widget.tsx', import.meta.url),
      'utf8'
    )

    expect(source).toContain("this.title.caption = ''")
    expect(source).not.toContain('this.title.caption = this.entry.caption')
  })
})

describe('Workbench domain view presentation', () => {
  it('derives split layout from independent workflow and material toggles', () => {
    const state = new WorkbenchViewState()
    const listener = vi.fn()
    state.onDidChangeMode(listener)

    state.toggle('material')
    state.toggle('workflow')
    state.toggle('workflow')
    state.toggle('material')

    expect(listener.mock.calls).toEqual([
      ['split'],
      ['material'],
      ['split'],
      ['workflow']
    ])
    expect(state.currentMode).toBe('workflow')
    expect(state.isVisible('workflow')).toBe(true)
    expect(state.isVisible('material')).toBe(false)
  })

  it('allows instruments and materials to share the Workbench main area', () => {
    const state = new WorkbenchViewState()

    state.toggle('material')
    state.toggle('device')
    expect(state.currentMode).toBe('device-material')
    expect(state.isVisible('device')).toBe(true)
    expect(state.isVisible('workflow')).toBe(false)
    expect(state.isVisible('material')).toBe(true)
    state.toggle('device')

    expect(state.currentMode).toBe('material')
    expect(state.isVisible('device')).toBe(false)
    expect(state.isVisible('material')).toBe(true)
  })

  it('lets either side of the instrument and material split remain open', () => {
    const state = new WorkbenchViewState()
    const listener = vi.fn()
    state.onDidChangeMode(listener)

    state.toggle('material')
    expect(state.currentMode).toBe('split')

    state.toggle('device')
    expect(state.currentMode).toBe('device-material')

    state.toggle('material')
    expect(state.currentMode).toBe('device')
    expect(state.isVisible('material')).toBe(false)
    expect(state.isVisible('workflow')).toBe(false)
    expect(state.isVisible('device')).toBe(true)
    expect(listener.mock.calls).toEqual([
      ['split'],
      ['device-material'],
      ['device']
    ])
  })

  it('opens each robot function as an exclusive Workbench surface', () => {
    const state = new WorkbenchViewState()

    state.toggle('material')
    state.toggle('robot-debug')

    expect(state.currentMode).toBe('robot-debug')
    expect(state.isVisible('robot-debug')).toBe(true)
    expect(state.isVisible('device')).toBe(false)

    state.toggle('robot-points')
    expect(state.currentMode).toBe('robot-points')
    expect(state.isVisible('robot-debug')).toBe(false)
    expect(state.isVisible('robot-points')).toBe(true)

    state.toggle('robot-points')
    expect(state.currentMode).toBe('robot-points')
  })

  it('opens workflow management and task list as distinct sibling surfaces', () => {
    const state = new WorkbenchViewState()
    let listRequests = 0
    state.onDidRequestWorkflowManagementList(() => { listRequests += 1 })

    state.toggle('workflow-management')
    expect(state.currentMode).toBe('workflow-management')
    expect(state.isVisible('workflow-management')).toBe(true)
    expect(state.isVisible('workflow')).toBe(false)

    state.toggle('workflow-tasks')
    expect(state.currentMode).toBe('workflow-tasks')
    expect(state.isVisible('workflow-management')).toBe(false)
    expect(state.isVisible('workflow-tasks')).toBe(true)

    state.toggle('workflow-management')
    expect(listRequests).toBe(0)
    state.toggle('workflow-management')
    expect(listRequests).toBe(1)
  })

  it('allows workflow management and materials to remain visible together', () => {
    const state = new WorkbenchViewState()

    state.toggle('workflow-management')
    state.toggle('material')

    expect(state.currentMode).toBe('workflow-management-material')
    expect(state.isVisible('workflow-management')).toBe(true)
    expect(state.isVisible('workflow')).toBe(false)
    expect(state.isVisible('material')).toBe(true)

    state.toggle('material')
    expect(state.currentMode).toBe('workflow-management')
    expect(state.isVisible('workflow-management')).toBe(true)
    expect(state.isVisible('material')).toBe(false)
  })

  it('opens experiment operation debugging as an exclusive surface', () => {
    const state = new WorkbenchViewState()

    state.toggle('operation')

    expect(state.currentMode).toBe('operation')
    expect(state.isVisible('operation')).toBe(true)
    expect(state.isVisible('workflow')).toBe(false)

    state.toggle('operation')
    expect(state.currentMode).toBe('operation')
  })

  it('never deactivates the only active sidebar domain', () => {
    const state = new WorkbenchViewState()
    const listener = vi.fn()
    state.onDidChangeMode(listener)

    state.toggle('workflow')
    expect(state.currentMode).toBe('workflow')

    state.toggle('material')
    state.toggle('workflow')
    expect(state.currentMode).toBe('material')
    state.toggle('material')
    expect(state.currentMode).toBe('material')

    state.toggle('device')
    state.toggle('device')
    expect(state.currentMode).toBe('material')
    expect(listener.mock.calls).toEqual([
      ['split'],
      ['material'],
      ['device-material'],
      ['material']
    ])
  })

  /** 证明工作流任务列表是独立主区，离开后可回到工作流编排。 */
  it('opens workflow Tasks as an exclusive Backend projection', () => {
    const state = new WorkbenchViewState()
    const listener = vi.fn()
    state.onDidChangeMode(listener)

    state.toggle('workflow-tasks')

    expect(state.currentMode).toBe('workflow-tasks')
    expect(state.isVisible('workflow-tasks')).toBe(true)
    expect(state.isVisible('workflow')).toBe(false)

    state.toggle('workflow')

    expect(state.currentMode).toBe('workflow')
    expect(listener.mock.calls).toEqual([
      ['workflow-tasks'],
      ['workflow']
    ])
  })

  it('presents an instrument entry without nesting the other domains', () => {
    const markup = renderToStaticMarkup(
      <DomainEntryPanel
        entry={{
          mode: 'device',
          label: '仪器设备',
          caption: '仪器设备',
          description: '读取 OS 上报的设备动作。',
          iconClass: 'codicon-tools',
          eyebrow: 'DEVICE'
        }}
        active
        onOpen={vi.fn()}
      />
    )

    expect(markup).toContain('data-domain-entry="device"')
    expect(markup).toContain('仪器设备')
    expect(markup).toContain('已在主区打开')
    expect(markup).not.toContain('左右并排')
  })

  it('renders two shared-state surfaces and an accessible splitter', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchDomainLayout
        mode="split"
        workflow={<section data-testid="workflow-surface" />}
        workflowTasks={<section data-testid="workflow-tasks-surface" />}
        material={<section data-testid="material-surface" />}
        device={<section data-testid="device-surface" />}
        operation={<section data-testid="operation-surface" />}
        robotWorkstation={<section data-testid="robot-workstation-surface" />}
      />
    )

    expect(markup).toContain('data-workbench-view="split"')
    expect(markup).toContain('data-testid="workflow-surface"')
    expect(markup).toContain('data-testid="material-surface"')
    expect(markup).toContain('role="separator"')
    expect(markup).toContain('aria-valuenow="55"')
  })

  it('keeps inactive domains mounted, sized and non-interactive', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchDomainLayout
        mode="material"
        workflow={<section data-testid="workflow-surface" />}
        workflowTasks={<section data-testid="workflow-tasks-surface" />}
        material={<section data-testid="material-surface" />}
        device={<section data-testid="device-surface" />}
        operation={<section data-testid="operation-surface" />}
        robotWorkstation={<section data-testid="robot-workstation-surface" />}
      />
    )

    expect(markup).toContain('data-testid="workflow-surface"')
    expect(markup).toContain('data-testid="workflow-tasks-surface"')
    expect(markup).toContain('data-testid="material-surface"')
    expect(markup).toContain('data-testid="device-surface"')
    expect(markup).toContain('data-testid="robot-workstation-surface"')
    expect(markup).toContain('role="separator"')
    expect(markup).toContain(
      'class="unilab-workbench__domain-slot is-workflow is-inactive"'
    )
    expect(markup).toContain('aria-hidden="true" inert=""')
    expect(markup).toContain(
      'class="unilab-workbench__domain-slot is-material"'
    )
  })

  it('mounts the shared instrument panel as a first-class domain', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchDomainLayout
        mode="device"
        workflow={<section data-testid="workflow-surface" />}
        workflowTasks={<section data-testid="workflow-tasks-surface" />}
        material={<section data-testid="material-surface" />}
        device={<section data-testid="device-surface" />}
        operation={<section data-testid="operation-surface" />}
        robotWorkstation={<section data-testid="robot-workstation-surface" />}
      />
    )

    expect(markup).toContain('data-workbench-view="device"')
    expect(markup).toContain('data-testid="device-surface"')
    expect(markup).toContain('data-testid="workflow-surface"')
    expect(markup).toContain('data-testid="material-surface"')
  })

  it('reuses the workflow surface for management and isolates the task list', () => {
    const managementMarkup = renderToStaticMarkup(
      <WorkbenchDomainLayout
        mode="workflow-management"
        workflow={<section data-testid="workflow-surface" />}
        workflowTasks={<section data-testid="workflow-tasks-surface" />}
        material={<section data-testid="material-surface" />}
        device={<section data-testid="device-surface" />}
        operation={<section data-testid="operation-surface" />}
        robotWorkstation={<section data-testid="robot-workstation-surface" />}
      />
    )
    const tasksMarkup = renderToStaticMarkup(
      <WorkbenchDomainLayout
        mode="workflow-tasks"
        workflow={<section data-testid="workflow-surface" />}
        workflowTasks={<section data-testid="workflow-tasks-surface" />}
        material={<section data-testid="material-surface" />}
        device={<section data-testid="device-surface" />}
        operation={<section data-testid="operation-surface" />}
        robotWorkstation={<section data-testid="robot-workstation-surface" />}
      />
    )

    expect(managementMarkup).toContain(
      'class="unilab-workbench__domain-slot is-workflow"'
    )
    expect(tasksMarkup).toContain(
      'class="unilab-workbench__domain-slot is-workflow-tasks"'
    )
  })

  it('renders instruments and materials with an accessible splitter', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchDomainLayout
        mode="device-material"
        workflow={<section data-testid="workflow-surface" />}
        workflowTasks={<section data-testid="workflow-tasks-surface" />}
        material={<section data-testid="material-surface" />}
        device={<section data-testid="device-surface" />}
        operation={<section data-testid="operation-surface" />}
        robotWorkstation={<section data-testid="robot-workstation-surface" />}
      />
    )

    expect(markup).toContain('data-workbench-view="device-material"')
    expect(markup).toContain('data-testid="device-surface"')
    expect(markup).toContain('data-testid="material-surface"')
    expect(markup).toContain('aria-label="调整仪器设备与物料窗口宽度"')
    expect(markup).toContain('aria-valuenow="55"')
  })

  it('keeps graph hosts measurable and collapses the secondary pane when narrow', () => {
    const stylesheet = readFileSync(
      new URL('./style/workbench-domain-navigation.css', import.meta.url),
      'utf8'
    )

    expect(stylesheet).toMatch(
      /\.unilab-workbench__domain-layout\s*\{[^}]*min-width:\s*1px;[^}]*min-height:\s*1px;/s
    )
    expect(stylesheet).toMatch(
      /@container unilab-workbench \(max-width: 900px\)[\s\S]*\.unilab-workbench__domain-slot\.is-material[\s\S]*display:\s*none;/
    )
  })

  it('mounts the mechanical-arm modules inside the Workbench main area', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchDomainLayout
        mode="robot-bench"
        workflow={<section data-testid="workflow-surface" />}
        workflowTasks={<section data-testid="workflow-tasks-surface" />}
        material={<section data-testid="material-surface" />}
        device={<section data-testid="device-surface" />}
        operation={<section data-testid="operation-surface" />}
        robotWorkstation={<section data-testid="robot-workstation-surface" />}
      />
    )

    expect(markup).toContain('data-workbench-view="robot-bench"')
    expect(markup).toContain('data-testid="robot-workstation-surface"')
    expect(markup).not.toContain('aria-label="机械臂工作站侧栏"')
  })

  it('renders the experiment operation workbench in the shared main area', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchDomainLayout
        mode="operation"
        workflow={<section data-testid="workflow-surface" />}
        workflowTasks={<section data-testid="workflow-tasks-surface" />}
        material={<section data-testid="material-surface" />}
        device={<section data-testid="device-surface" />}
        operation={<section data-testid="operation-surface" />}
        robotWorkstation={<section data-testid="robot-workstation-surface" />}
      />
    )

    expect(markup).toContain('data-workbench-view="operation"')
    expect(markup).toContain('data-testid="operation-surface"')
    expect(markup).toContain(
      'class="unilab-workbench__domain-slot is-operation"'
    )
  })
})


describe('文件与领域视图切换', () => {
  it('从任务列表打开文件时替换任务列表，返回任务列表时关闭文件视图', () => {
    const state = new WorkbenchViewState()
    state.toggle('workflow-tasks')
    state.toggle('files')
    expect(state.currentMode).toBe('files')
    expect(state.isVisible('workflow-tasks')).toBe(false)
    state.toggle('files')
    expect(state.currentMode).toBe('files')
    state.toggle('workflow-tasks')
    expect(state.currentMode).toBe('workflow-tasks')
    expect(state.isVisible('files')).toBe(false)
  })

  it.each(['workflow', 'workflow-management'] as const)(
    '文件可与 %s 共存，并允许任意一侧独立保留', domain => {
      const state = new WorkbenchViewState()
      state.toggle('workflow-tasks')
      state.toggle('files')
      state.toggle(domain)
      expect(state.currentMode).toBe(`${domain}-files`)
      expect(state.isVisible('files')).toBe(true)
      expect(state.isVisible(domain)).toBe(true)
      state.toggle(domain)
      expect(state.currentMode).toBe('files')
      state.toggle(domain)
      state.toggle('files')
      expect(state.currentMode).toBe(domain)
    }
  )

  it('从物料分栏打开文件仅保留工作流，并在列表和调试之间保持文件可见', () => {
    const state = new WorkbenchViewState()
    state.toggle('material')
    state.toggle('files')
    expect(state.currentMode).toBe('workflow-files')
    expect(state.isVisible('material')).toBe(false)
    state.toggle('workflow-management')
    expect(state.currentMode).toBe('workflow-management-files')
    state.toggle('workflow')
    expect(state.currentMode).toBe('workflow-files')
  })
})
