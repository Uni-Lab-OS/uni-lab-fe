import type { WorkbenchSessionSnapshot } from '@unilab/workbench-session'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  describeEnvironmentOperationError,
  EnvironmentManager,
  type EnvironmentManagerProps,
  ExternalDevicesOnlyControl,
  RuntimeModeControl
} from './environment-manager'
import {
  deriveEnvironmentOverview,
  localEnvironmentTone
} from './environment-manager-model'

describe('EnvironmentManager', () => {
  it('turns a local failure into one recommended recovery action', () => {
    const markup = renderToStaticMarkup(
      <EnvironmentManager {...environmentManagerProps(failedSession())} />
    )

    expect(markup).toContain('开始调试前需要处理')
    expect(markup).toContain('本地数据损坏')
    expect(markup).toContain('data-recommended-action="true"')
    expect(markup).toContain('重建本地数据')
    expect(markup).toContain('查看相关日志')
    expect(markup).toMatch(
      /<details class="unilab-environment-section"[^>]*open=""[^>]*>[^]*?<strong>调试设置<\/strong>/u
    )
    expect(markup).toMatch(
      /<details class="unilab-environment-section"[^>]*open=""[^>]*>[^]*?<strong>日志<\/strong>/u
    )
  })

  it('keeps a ready environment concise until advanced settings are opened', () => {
    const markup = renderToStaticMarkup(
      <EnvironmentManager {...environmentManagerProps(readySession())} />
    )

    expect(markup).toContain('可以开始本地调试')
    expect(markup).toContain('会控制设备')
    expect(markup).not.toContain('data-recommended-action="true"')
    expect(markup).not.toContain('open=""')
    expect(markup).toContain('设置与排障')
  })

  it('hides process topology behind one local-debug concept', () => {
    const markup = renderToStaticMarkup(
      <EnvironmentManager {...environmentManagerProps(readySession())} />
    )

    expect(markup).toContain('本地调试')
    expect(markup).not.toContain('本地调试服务')
    expect(markup).toContain('PLC 模拟器')
    expect(markup).toContain('可选')
    expect(markup).not.toContain('Workspace 服务')
    expect(markup).not.toContain('本地执行服务')
    expect(markup).not.toContain('PLC 与设备')
    expect(markup).not.toContain('本地运行')
  })

  it('keeps publication and Scheduler addressing out of environment controls', () => {
    const markup = renderToStaticMarkup(
      <EnvironmentManager {...environmentManagerProps(failedSession())} />
    )

    expect(markup).not.toContain('Backend 发布目标地址')
    expect(markup).not.toContain('Scheduler 目标地址')
    expect(markup).not.toContain('发布、校验并切换')
    expect(markup).not.toContain('清空并发布')
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
    expect(markup).toContain('只使用工作区设备包')
    expect(markup).toContain('关闭后还会加载 OS 内置设备目录')
  })
})

describe('describeEnvironmentOperationError', () => {
  it('keeps unexpected errors available for diagnosis', () => {
    expect(describeEnvironmentOperationError('restart-os', '端口被占用')).toEqual({
      title: '本地调试未能启动',
      message: '请查看当前诊断和调试日志；若端口被占用，再使用维修操作。',
      technicalDetail: '端口被占用'
    })
  })
})

describe('environment overview', () => {
  it('derives one task-facing result from the component graph', () => {
    const failed = failedSession()
    expect(localEnvironmentTone(failed)).toBe('attention')
    expect(deriveEnvironmentOverview(failed, null)).toMatchObject({
      title: '开始调试前需要处理',
      recommendedAction: 'rebuild-local-data',
      recommendedActionLabel: '重建本地数据',
      logKind: 'os'
    })

    expect(deriveEnvironmentOverview(readySession(), null)).toMatchObject({
      tone: 'ready',
      title: '可以开始本地调试',
      recommendedAction: null
    })

    const withOptionalPlcFailure = readySession()
    withOptionalPlcFailure.plcSimulator = {
      ...withOptionalPlcFailure.plcSimulator,
      phase: 'failed',
      diagnostic: 'PLC 模拟器未启动'
    }
    expect(localEnvironmentTone(withOptionalPlcFailure)).toBe('ready')
    expect(deriveEnvironmentOverview(withOptionalPlcFailure, null)).toMatchObject({
      tone: 'ready',
      title: '可以开始本地调试'
    })
  })
})

describe('RuntimeModeControl', () => {
  it.each([
    ['normal', '控制真实设备', '仅模拟流程'],
    ['dry-run', '仅模拟流程', '控制真实设备']
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

function readySession(): WorkbenchSessionSnapshot {
  const session = failedSession()
  return {
    ...session,
    phase: 'ready',
    message: 'Workspace 服务已就绪',
    identity: {
      workspacePath: '/workspace',
      osProjectPath: '/os',
      osRuntimeSource: 'checkout',
      environmentPath: '/python',
      graphPath: '/workspace/deployment/graphs/fixture.json',
      graphFingerprint: 'fixture',
      mode: 'normal',
      pid: 41,
      generation: 'generation',
      backendUrl: 'http://127.0.0.1:18103',
      logPath: '/workspace/.unilabos/logs/workbench/os.log',
      packageMounts: {
        schemaVersion: 'workspace-package-mounts/v1',
        editablePackageId: 'fixture',
        dependencyRevision: 'dependencies',
        catalogRevision: 'catalog',
        mountRevision: 'mounts',
        items: []
      },
      agent: null
    },
    diagnostic: null,
    edgeRuntime: {
      ...session.edgeRuntime,
      phase: 'ready',
      message: '本地执行已就绪',
      pid: 42,
      generation: 'edge-generation'
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
    onStopSession: complete
  }
}
