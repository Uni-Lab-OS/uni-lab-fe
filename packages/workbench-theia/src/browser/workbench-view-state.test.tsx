import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { DomainEntryPanel } from './domain-entry-panel'
import { WorkbenchDomainLayout } from './workbench-domain-layout'
import { WorkbenchViewState } from './workbench-view-state'

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

  it('toggles instruments without discarding the authoring panel selection', () => {
    const state = new WorkbenchViewState()

    state.toggle('material')
    state.toggle('device')
    expect(state.currentMode).toBe('device')
    state.toggle('device')

    expect(state.currentMode).toBe('split')
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
        material={<section data-testid="material-surface" />}
        device={<section data-testid="device-surface" />}
      />
    )

    expect(markup).toContain('data-workbench-view="split"')
    expect(markup).toContain('data-testid="workflow-surface"')
    expect(markup).toContain('data-testid="material-surface"')
    expect(markup).toContain('role="separator"')
    expect(markup).toContain('aria-valuenow="55"')
  })

  it('keeps inactive domains mounted but hidden in a single-view layout', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchDomainLayout
        mode="material"
        workflow={<section data-testid="workflow-surface" />}
        material={<section data-testid="material-surface" />}
        device={<section data-testid="device-surface" />}
      />
    )

    expect(markup).toContain('data-testid="workflow-surface"')
    expect(markup).toContain('data-testid="material-surface"')
    expect(markup).toContain('data-testid="device-surface"')
    expect(markup).toContain('role="separator"')
    expect(markup).toContain('hidden=""')
  })

  it('mounts the shared instrument panel as a first-class domain', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchDomainLayout
        mode="device"
        workflow={<section data-testid="workflow-surface" />}
        material={<section data-testid="material-surface" />}
        device={<section data-testid="device-surface" />}
      />
    )

    expect(markup).toContain('data-workbench-view="device"')
    expect(markup).toContain('data-testid="device-surface"')
    expect(markup).toContain('data-testid="workflow-surface"')
    expect(markup).toContain('data-testid="material-surface"')
  })
})
