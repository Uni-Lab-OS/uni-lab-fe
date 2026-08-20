import type { WorkbenchSessionSnapshot } from '@unilab/workbench-session'
import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import {
  ReagentLedgerView,
  ReagentLibraryView
} from '../packages/robot-workstation/src/reagents/ReagentViews'
import {
  EnvironmentManager,
  type EnvironmentManagerProps
} from '../packages/workbench-theia/src/browser/environment-manager'
import {
  WorkbenchAuthorityScopeBoundary,
  workbenchAuthorityScopeKey
} from '../packages/workbench-theia/src/browser/workbench-authority-scope'
import './new-unresolved-page-fixture.css'

const fixtureCase = new URLSearchParams(location.search).get('case')

function NewUnresolvedPageFixture(): React.JSX.Element {
  if (fixtureCase === 'plc') return <PlcConfigurationFixture />
  if (fixtureCase === 'workspace') return <WorkspaceScopeFixture />
  return <ReagentPaginationFixture />
}

function ReagentPaginationFixture(): React.JSX.Element {
  const inventory = Array.from({ length: 21 }, (_, index) => ({
    id: `reagent-${index + 1}`,
    name: `库存试剂 ${index + 1}`,
    status: 'available' as const,
    totalQuantity: index + 1,
    unit: 'mL'
  }))
  const infos = Array.from({ length: 21 }, (_, index) => ({
    id: `info-${index + 1}`,
    name: `目录试剂 ${index + 1}`,
    aliases: [],
    physicalState: 'liquid' as const
  }))
  return (
    <main className="new-unresolved-fixture">
      <section data-testid="inventory-page">
        <h1>试剂库存分页</h1>
        <ReagentLedgerView items={inventory} query="" />
      </section>
      <section data-testid="library-page">
        <h1>试剂目录分页</h1>
        <ReagentLibraryView infos={infos} query="" />
      </section>
    </main>
  )
}

function PlcConfigurationFixture(): React.JSX.Element {
  const [savedPath, setSavedPath] = useState('')
  const props = environmentManagerProps(async configuration => {
    setSavedPath(configuration.variableTablePath)
  })
  return (
    <main className="new-unresolved-fixture">
      <output data-testid="plc-saved">{savedPath}</output>
      <EnvironmentManager {...props} />
    </main>
  )
}

function WorkspaceScopeFixture(): React.JSX.Element {
  const [workspacePath, setWorkspacePath] = useState(
    'C:\\Users\\tester\\workspace-a'
  )
  const scopeKey = workbenchAuthorityScopeKey(
    'local:http://127.0.0.1:18103',
    workspacePath
  )
  return (
    <main className="new-unresolved-fixture">
      <section className="workspace-scope-fixture">
        <h1>工作区状态隔离</h1>
        <output aria-label="当前工作区">{workspacePath}</output>
        <button
          type="button"
          onClick={() => setWorkspacePath(current => current.endsWith('a')
            ? 'C:\\Users\\tester\\workspace-b'
            : 'C:\\Users\\tester\\workspace-a')}
        >切换工作区</button>
        <WorkbenchAuthorityScopeBoundary scopeKey={scopeKey}>
          <WorkflowLoadingProbe />
        </WorkbenchAuthorityScopeBoundary>
      </section>
    </main>
  )
}

function WorkflowLoadingProbe(): React.JSX.Element {
  const [selected, setSelected] = useState(false)
  return selected ? (
    <div role="status">正在读取工作流 fixture-workflow</div>
  ) : (
    <button type="button" onClick={() => setSelected(true)}>选择工作流</button>
  )
}

function environmentManagerProps(
  onConfigurePlcSimulator: EnvironmentManagerProps['onConfigurePlcSimulator']
): EnvironmentManagerProps {
  const complete = async (): Promise<void> => undefined
  return {
    session: readyPlcSession(),
    onClose: () => undefined,
    onRestartSession: complete,
    onRebuildLocalData: complete,
    onInspectReleaseTarget: async backendUrl => ({
      targetAddress: backendUrl,
      empty: true,
      counts: { templates: 0, materials: 0, workflows: 0 }
    }),
    onPublishRelease: async backendUrl => ({
      releaseId: 'sha256:fixture',
      targetAddress: backendUrl,
      verified: true,
      activated: true,
      counts: { templates: 0, materials: 0, workflows: 0 }
    }),
    onReadEnvironmentLog: async () => '',
    onConfigureGraph: complete,
    onSetExternalDevicesOnly: complete,
    onConfigurePlcSimulator,
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

function readyPlcSession(): WorkbenchSessionSnapshot {
  return {
    phase: 'failed',
    message: '仅验证 PLC-Sim 配置页面',
    configuredGraphPath: 'deployment/graphs/fixture.json',
    configuredExternalDevicesOnly: true,
    configuredRuntimeMode: 'normal',
    configuredDomainMode: 'local',
    configuredBackendUrl: 'http://127.0.0.1:8080',
    configuredSchedulerUrl: null,
    identity: null,
    agent: null,
    diagnostic: null,
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
      phase: 'ready',
      message: 'PLC-Sim 已就绪',
      projectPath: 'C:\\PLC-Sim',
      variableTablePath: 'C:\\PLC-Sim\\variables.csv',
      variableTableCandidates: [],
      handshakeProfile: 'szlab',
      pid: 19201,
      guiUrl: 'http://127.0.0.1:8088',
      opcUaUrl: 'opc.tcp://127.0.0.1:4840',
      logPath: 'C:\\PLC-Sim\\plc.log',
      diagnostic: null
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <NewUnresolvedPageFixture />
)
