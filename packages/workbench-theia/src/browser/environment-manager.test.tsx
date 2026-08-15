import type { WorkbenchSessionSnapshot } from '@unilab/workbench-session'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  deriveSchedulerUrl,
  describeEnvironmentOperationError,
  EnvironmentManager,
  type EnvironmentManagerProps,
  ExternalDevicesOnlyControl,
  normalizeSchedulerUrl,
  RuntimeModeControl
} from './environment-manager'

describe('EnvironmentManager', () => {
  it('keeps local data recovery available when Workspace Backend has failed', () => {
    const markup = renderToStaticMarkup(
      <EnvironmentManager {...environmentManagerProps(failedSession())} />
    )

    expect(markup).toContain(
      '<button type="button">重建本地数据</button>'
    )
    expect(markup).toContain('本地数据损坏')
  })

  it('shows Backend and derived Scheduler targets together', () => {
    const markup = renderToStaticMarkup(
      <EnvironmentManager {...environmentManagerProps(failedSession())} />
    )

    expect(markup).toContain('aria-label="Backend 发布目标地址"')
    expect(markup).toContain('aria-label="Scheduler 目标地址"')
    expect(markup).toContain('value="http://127.0.0.1:8081"')
    expect(markup).toContain('Scheduler：自动推导')
    expect(markup).not.toContain('恢复自动推导')
  })
})

describe('Scheduler target addressing', () => {
  it('derives the adjacent Scheduler port and preserves ingress origins', () => {
    expect(deriveSchedulerUrl('http://127.0.0.1:30053'))
      .toBe('http://127.0.0.1:30054')
    expect(deriveSchedulerUrl('https://backend.example.test'))
      .toBe('https://backend.example.test')
  })

  it('normalizes explicit Scheduler origins and rejects routes', () => {
    expect(normalizeSchedulerUrl('http://127.0.0.1:30054/'))
      .toBe('http://127.0.0.1:30054')
    expect(() => normalizeSchedulerUrl(
      'http://127.0.0.1:30054/api/v1'
    )).toThrow('Scheduler 地址只需填写')
  })
})

describe('ExternalDevicesOnlyControl', () => {
  it('renders the external-only launch option as a checked checkbox by default', () => {
    const markup = renderToStaticMarkup(
      <ExternalDevicesOnlyControl
        checked
        disabled={false}
        onChange={vi.fn()}
      />
    )

    expect(markup).toContain('type="checkbox"')
    expect(markup).toContain('checked=""')
    expect(markup).toContain('仅加载外部设备包')
    expect(markup).toContain('同时加载 OS 内置 Registry')
  })
})

describe('describeEnvironmentOperationError', () => {
  it('explains why reset-and-publish is unavailable in Backend mode', () => {
    expect(describeEnvironmentOperationError(
      'reset-and-publish-release',
      'WorkspaceRelease 只能从 Local Authority 构建'
    )).toEqual({
      title: '当前模式无法清空并发布',
      message: '当前工作区由 Backend 管理，不能在这里构建发布包。' +
        '请切换到 Local 模式后，再执行“清空并发布”。' +
        '目标 Backend 的数据尚未被清除。'
    })
  })

  it('keeps unexpected errors available for diagnosis', () => {
    expect(describeEnvironmentOperationError('restart-os', '端口被占用')).toEqual({
      title: '环境操作失败',
      message: '端口被占用'
    })
  })
})

describe('RuntimeModeControl', () => {
  it.each([
    ['normal', '正常运行', 'Dry-run'],
    ['dry-run', 'Dry-run', '正常运行']
  ] as const)('exposes %s as the unambiguous selected mode', (
    mode,
    selectedLabel,
    otherLabel
  ) => {
    const markup = renderToStaticMarkup(
      <RuntimeModeControl
        mode={mode}
        disabled={false}
        onSetRuntimeMode={vi.fn()}
      />
    )

    expect(markup).toContain(
      `aria-label="${selectedLabel}（当前）"`
    )
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('codicon-check')
    expect(markup).toContain(`aria-label="${otherLabel}"`)
    expect(markup).toContain('aria-pressed="false"')
  })
})

function failedSession(): WorkbenchSessionSnapshot {
  return {
    phase: 'failed',
    message: 'Workspace Backend 运行失败',
    configuredGraphPath: 'deployment/graphs/fixture.json',
    configuredExternalDevicesOnly: true,
    configuredRuntimeMode: 'normal',
    configuredDomainMode: 'local',
    configuredBackendUrl: 'http://127.0.0.1:8080',
    configuredSchedulerUrl: null,
    identity: null,
    agent: null,
    diagnostic: {
      code: 'os_start_failed',
      message: '本地数据损坏',
      recovery: '重建本地数据'
    },
    edgeRuntime: {
      phase: 'idle',
      message: 'OS 尚未启动',
      pid: null,
      generation: null,
      graphPath: 'deployment/graphs/fixture.json',
      mode: 'normal',
      logPath: '',
      diagnostic: null
    },
    plcSimulator: {
      phase: 'idle',
      message: 'PLC-Sim 尚未启动',
      projectPath: '',
      variableTablePath: '',
      variableTableCandidates: [],
      handshakeProfile: 'szlab',
      pid: null,
      guiUrl: '',
      opcUaUrl: '',
      logPath: '',
      diagnostic: null
    }
  }
}

function environmentManagerProps(
  session: WorkbenchSessionSnapshot
): EnvironmentManagerProps {
  const complete = vi.fn(async () => undefined)
  return {
    session,
    onClose: vi.fn(),
    onRestartSession: complete,
    onRebuildLocalData: complete,
    onInspectReleaseTarget: vi.fn(async backendUrl => ({
      targetAddress: backendUrl,
      empty: true,
      counts: { templates: 0, materials: 0, workflows: 0 }
    })),
    onPublishRelease: vi.fn(async backendUrl => ({
      releaseId: 'sha256:fixture',
      targetAddress: backendUrl,
      verified: true as const,
      activated: true,
      counts: { templates: 0, materials: 0, workflows: 0 }
    })),
    onReadEnvironmentLog: vi.fn(async () => ''),
    onConfigureGraph: complete,
    onSetExternalDevicesOnly: complete,
    onConfigurePlcSimulator: complete,
    onRefreshPlcVariableTables: complete,
    onStartPlcSimulator: complete,
    onStopPlcSimulator: complete,
    onReleaseEnvironmentPorts: complete,
    onStartAgent: complete,
    onStopAgent: complete,
    onRestartAgent: complete,
    onSetRuntimeMode: complete,
    onSetSchedulerUrl: complete,
    onStopSession: complete
  }
}
