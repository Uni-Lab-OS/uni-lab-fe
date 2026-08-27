import type { WorkbenchSessionSnapshot } from '@unilab/workbench-session'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  WorkbenchConfigurationDialog,
  type WorkbenchConfigurationOperations
} from './workbench-configuration-dialog'
import { WorkbenchTopBar } from './workbench-top-bar'

describe('Workbench mode configuration', () => {
  it('keeps simulation controls explicit without exposing an environment layer', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchConfigurationDialog
        kind="simulation"
        session={sessionFixture()}
        operations={operationsFixture()}
        onClose={vi.fn()}
      />
    )

    expect(markup).toContain('仿真调试配置')
    expect(markup).toContain('启动 OS')
    expect(markup).toContain('启动 PLC-Sim')
    expect(markup).toContain('重置运行数据')
    expect(markup).not.toContain('运行环境')
    expect(markup.indexOf('PLC-Sim 配置')).toBeLessThan(
      markup.indexOf('启动 PLC-Sim')
    )
    expect(markup.indexOf('启动 PLC-Sim')).toBeLessThan(
      markup.indexOf('Uni-Lab OS 配置')
    )
    expect(markup.indexOf('Uni-Lab OS 配置')).toBeLessThan(
      markup.indexOf('启动 OS')
    )
    expect(markup).not.toContain('运行控制')
    expect(markup.match(/unilab-config-dialog__module-actions/g)).toHaveLength(2)
  })

  it('emphasizes only the valid PLC-Sim and OS lifecycle action', () => {
    const idleSession = sessionFixture()
    idleSession.phase = 'idle'
    idleSession.edgeRuntime.phase = 'idle'
    idleSession.edgeRuntime.message = 'OS 未启动'
    const idleMarkup = renderToStaticMarkup(
      <WorkbenchConfigurationDialog
        kind="simulation"
        session={idleSession}
        operations={operationsFixture()}
        onClose={vi.fn()}
      />
    )

    expect(buttonMarkup(idleMarkup, '启动 PLC-Sim')).toContain('class="is-primary"')
    expect(buttonMarkup(idleMarkup, '启动 PLC-Sim')).not.toContain('disabled')
    expect(buttonMarkup(idleMarkup, '停止 PLC-Sim')).toContain('disabled')
    expect(buttonMarkup(idleMarkup, '启动 OS')).toContain('class="is-primary"')
    expect(buttonMarkup(idleMarkup, '停止 OS')).toContain('disabled')

    const readySession = sessionFixture()
    readySession.plcSimulator.phase = 'ready'
    readySession.plcSimulator.message = 'PLC-Sim 已启动'
    const readyMarkup = renderToStaticMarkup(
      <WorkbenchConfigurationDialog
        kind="simulation"
        session={readySession}
        operations={operationsFixture()}
        onClose={vi.fn()}
      />
    )

    expect(buttonMarkup(readyMarkup, '启动 PLC-Sim')).toContain('disabled')
    expect(buttonMarkup(readyMarkup, '停止 PLC-Sim')).toContain('is-runtime-stop')
    expect(buttonMarkup(readyMarkup, '启动 OS')).toContain('disabled')
    expect(buttonMarkup(readyMarkup, '停止 OS')).toContain('is-runtime-stop')
    expect(buttonMarkup(readyMarkup, '重启 OS')).not.toContain('disabled')
  })

  it('configures Backend and Scheduler reachability in production mode', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchConfigurationDialog
        kind="production"
        session={sessionFixture()}
        operations={operationsFixture()}
        onClose={vi.fn()}
      />
    )

    expect(markup).toContain('Backend 地址')
    expect(markup).toContain('调度器（Scheduler）地址')
    expect(markup).toContain('一键测试连接')
    expect(markup).not.toContain('启动 OS')
  })

  it('shows mode-specific top navigation and workspace selection', () => {
    const debugMarkup = renderToStaticMarkup(
      <WorkbenchTopBar
        connectionMode="local"
        configurationKind={null}
        debugTarget="simulation"
        viewLabel="工作流调试"
        workspaceLabel="szlab"
        onConfigure={vi.fn()}
        onExitMode={vi.fn()}
        onOpenAssistant={vi.fn()}
      />
    )
    const productionMarkup = renderToStaticMarkup(
      <WorkbenchTopBar
        connectionMode="backend"
        configurationKind={null}
        debugTarget="hardware"
        viewLabel="工作流管理"
        workspaceLabel="szlab"
        onConfigure={vi.fn()}
        onExitMode={vi.fn()}
        onOpenAssistant={vi.fn()}
      />
    )

    expect(debugMarkup).toContain('助手')
    expect(debugMarkup).toContain('实验调试平台')
    expect(debugMarkup).toContain('工作流调试')
    expect(debugMarkup).not.toContain('UniLab Workbench')
    expect(debugMarkup).not.toContain('szlab · 调试模式')
    expect(debugMarkup).toContain('仿真调试')
    expect(debugMarkup).toContain('真实设备调试')
    expect(debugMarkup).toContain('unilab-workbench__debug-switch')
    expect(debugMarkup).toContain('role="radiogroup"')
    expect(debugMarkup).toContain('role="radio"')
    expect(debugMarkup).toContain('aria-checked="true"')
    expect(debugMarkup).toContain('退出调试模式')
    expect(debugMarkup).not.toContain('szlab · 调试模式')
    expect(productionMarkup).toContain('生产配置')
    expect(productionMarkup).toContain('实验生产平台')
    expect(productionMarkup).toContain('工作流管理')
    expect(productionMarkup).toContain('退出生产模式')
    expect(productionMarkup).not.toContain('真实设备调试')
    expect(productionMarkup).not.toContain('unilab-workbench__debug-switch')
  })

  it('does not switch the active debug target before configuration is saved', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchTopBar
        connectionMode="local"
        configurationKind="hardware"
        debugTarget="simulation"
        viewLabel="工作流调试"
        workspaceLabel="szlab"
        onConfigure={vi.fn()}
        onExitMode={vi.fn()}
        onOpenAssistant={vi.fn()}
      />
    )

    expect(markup).toMatch(
      /role="radio" class="is-active" aria-checked="true" aria-expanded="false">仿真调试/u
    )
    expect(markup).toMatch(
      /role="radio" class="" aria-checked="false" aria-expanded="true">真实设备调试/u
    )
  })
})

/** 构造不启动进程的最小 WorkbenchSession 视图事实。 */
function sessionFixture(): WorkbenchSessionSnapshot {
  return {
    phase: 'ready',
    message: '工作台已就绪',
    configuredGraphPath: 'deployment/graphs/device-graph.json',
    configuredExternalDevicesOnly: true,
    configuredRuntimeMode: 'normal',
    configuredDomainMode: 'local',
    configuredBackendUrl: 'https://backend.example.com',
    configuredSchedulerUrl: 'https://scheduler.example.com',
    identity: null,
    agent: null,
    diagnostic: null,
    edgeRuntime: {
      phase: 'ready',
      message: 'OS 已启动',
      pid: 42,
      generation: 'edge-generation',
      graphPath: 'deployment/graphs/device-graph.json',
      mode: 'normal',
      logPath: '/workspace/.unilabos/os.log',
      diagnostic: null
    },
    plcSimulator: {
      phase: 'idle',
      message: 'PLC-Sim 未启动',
      diagnostic: null,
      projectPath: '/workspace/PLC-Sim',
      variableTablePath: '/workspace/devices/plc/table.csv',
      variableTableCandidates: [],
      handshakeProfile: 'szlab',
      guiUrl: 'http://127.0.0.1:8080',
      opcUaUrl: 'opc.tcp://127.0.0.1:4840',
      pid: null,
      logPath: '/workspace/.unilabos/plc-sim.log'
    }
  }
}

/** 构造只记录调用的配置边界，不访问 OS 或网络。 */
function operationsFixture(): WorkbenchConfigurationOperations {
  return {
    configureGraph: vi.fn(),
    setExternalDevicesOnly: vi.fn(),
    configurePlcSimulator: vi.fn(),
    setRuntimeMode: vi.fn(),
    startOs: vi.fn(),
    stopOs: vi.fn(),
    restartOs: vi.fn(),
    startPlcSimulator: vi.fn(),
    stopPlcSimulator: vi.fn(),
    resetRuntimeData: vi.fn(),
    configureProductionConnection: vi.fn(),
    probeProductionConnection: vi.fn(),
    enterMode: vi.fn()
  }
}

/** 返回指定文案按钮的静态标记，供状态语义断言使用。 */
function buttonMarkup(markup: string, label: string): string {
  const match = markup.match(new RegExp(`<button[^>]*>${label}</button>`, 'u'))
  expect(match).not.toBeNull()
  return match?.[0] ?? ''
}
