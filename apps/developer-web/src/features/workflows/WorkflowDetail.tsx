import { clsx } from 'clsx'
import workflowDebugStyles from './WorkflowDebug.module.scss'
import workflowDetailStyles from './WorkflowDetail.module.scss'
import workflowSharedStyles from './WorkflowShared.module.scss'
import workflowTopologyStyles from './WorkflowTopology.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Button, Empty, Tag, Tooltip, message } from 'antd'
import { useState } from 'react'
import type { PublishedWorkflowRevision } from '@unilab-fe/core'
import { AppIcon } from '../../components/ui/Icon'
import { AsyncState } from '../../components/ui/AsyncState'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import {
  nodeUuid,
  workflowCounts,
  workflowContracts,
  workflowStatusLabel,
  type WorkflowResourceDirectory,
} from './workflowPresentation'
import { WorkflowFlowCanvas } from './WorkflowFlowCanvas'
import { NodeInspector } from './WorkflowNodeInspector'

export function WorkflowDetail({
  workflowUuid,
  onBack,
  onDebug,
}: {
  workflowUuid: string
  onBack: () => void
  onDebug: (uuid: string) => void
}) {
  const query = useBackendQuery(`workflow-detail:${workflowUuid}`, (current) =>
    current.core.workflowDefinitions.getPublishedRevision(workflowUuid),
  )
  const resourceDirectoryQuery = useBackendQuery<WorkflowResourceDirectory>(
    'workflow-resource-directory',
    async (current) => {
      const [graph, devices] = await Promise.all([
        current.core.materialSite.getGraph(),
        current.core.deviceActions.listDevices(),
      ])
      const resourceTemplates = new Map<string, string>()
      const materials = graph.nodes.map((node) => {
        if (node.resourceTemplate) {
          resourceTemplates.set(node.resourceTemplate.uuid, node.resourceTemplate.displayName)
        }
        return {
          uuid: node.material.materialUuid,
          name: node.material.name,
        }
      })
      const sites = graph.nodes.flatMap((node) =>
        node.sites.map((site) => ({ uuid: site.siteUuid, name: site.name })),
      )
      return {
        resourceTemplates: [...resourceTemplates].map(([uuid, displayName]) => ({
          uuid,
          displayName,
        })),
        materials,
        sites,
        devices: devices.map((device) => ({
          deviceUuid: device.deviceUuid,
          deviceKey: device.deviceKey,
          label: device.label,
        })),
      }
    },
  )
  const [nodeId, setNodeId] = useState<string | null>(null)
  const resourceDirectory =
    resourceDirectoryQuery.data ??
    ({
      resourceTemplates: [],
      materials: [],
      sites: [],
      devices: [],
    } satisfies WorkflowResourceDirectory)
  return (
    <div
      className={clsx(
        appShellStyles['page-stack'],
        sharedStyles['page-stack'],
        workflowDetailStyles['workflow-detail-page'],
        appShellStyles['workflow-detail-page'],
      )}
    >
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.reload}
        empty={!query.loading && !query.data}
      >
        {query.data && (
          <>
            <div className={clsx(workflowDetailStyles['workflow-detail-heading'])}>
              <div className={clsx(workflowDetailStyles['workflow-detail-title'])}>
                <Tooltip title="返回工作流">
                  <Button
                    type="text"
                    className={clsx(
                      sharedStyles['page-header-back'],
                      workflowDetailStyles['workflow-back-icon'],
                    )}
                    aria-label="返回工作流"
                    onClick={onBack}
                    icon={<AppIcon name="arrows/arrow-left" size={18} />}
                  />
                </Tooltip>
                <div className={clsx(workflowDetailStyles['workflow-detail-title-copy'])}>
                  <Tooltip title={query.data.name} mouseEnterDelay={0.2}>
                    <h1>{query.data.name}</h1>
                  </Tooltip>
                </div>
              </div>
              <div className={clsx(workflowDetailStyles['workflow-detail-heading-actions'])}>
                <Tag color={query.data.status === 'published' ? 'green' : 'blue'}>
                  {workflowStatusLabel(query.data.status)}
                </Tag>
                <Button type="default" onClick={() => message.info('发布功能暂未接入')}>
                  发布
                </Button>
                <Button
                  type="primary"
                  onClick={() => onDebug(workflowUuid)}
                  icon={<AppIcon name="media/play-circle" size={16} color="white" />}
                >
                  调试工作流
                </Button>
              </div>
            </div>
            <WorkflowTopology
              revision={query.data}
              selectedNode={nodeId}
              onSelect={setNodeId}
              resourceDirectory={resourceDirectory}
            />
          </>
        )}
      </AsyncState>
    </div>
  )
}

function WorkflowTopology({
  revision,
  selectedNode,
  onSelect,
  resourceDirectory,
}: {
  revision: PublishedWorkflowRevision
  selectedNode: string | null
  onSelect: (id: string | null) => void
  resourceDirectory: WorkflowResourceDirectory
}) {
  const counts = workflowCounts(revision)
  const activeNodeId = selectedNode
  const activeNode = revision.graph.nodes.find(
    (item, index) => nodeUuid(item, index) === activeNodeId,
  )
  return (
    <div className={clsx(workflowTopologyStyles['workflow-topology-layout'])}>
      <section
        className={clsx(
          workflowSharedStyles['detail-card'],
          appShellStyles['detail-card'],
          workflowTopologyStyles['topology-card'],
          workflowDebugStyles['topology-card'],
        )}
      >
        <div className={clsx(workflowTopologyStyles['workflow-panel-heading'])}>
          <h2>拓扑结构</h2>
          <Tag>{counts.nodes} 个节点</Tag>
        </div>
        <div className={clsx(workflowTopologyStyles['topology-canvas'])}>
          {revision.graph.nodes.length === 0 ? (
            <Empty description="后端没有返回节点" />
          ) : (
            <WorkflowFlowCanvas
              graph={revision.graph}
              selectedNode={activeNodeId}
              onSelect={onSelect}
            />
          )}
        </div>
      </section>
      <section
        className={clsx(
          workflowSharedStyles['detail-card'],
          appShellStyles['detail-card'],
          workflowTopologyStyles['node-inspector'],
          workflowDebugStyles['node-inspector'],
        )}
      >
        <div
          className={clsx(
            workflowTopologyStyles['workflow-panel-heading'],
            'node-inspector-heading',
          )}
        >
          <h2>{activeNode ? '节点信息' : '工作流信息'}</h2>
        </div>
        {activeNode ? (
          <NodeInspector
            revision={revision}
            node={activeNode}
            resourceDirectory={resourceDirectory}
          />
        ) : (
          <WorkflowInfoPanel revision={revision} counts={counts} />
        )}
      </section>
    </div>
  )
}

function WorkflowInfoPanel({
  revision,
  counts,
}: {
  revision: PublishedWorkflowRevision
  counts: ReturnType<typeof workflowCounts>
}) {
  return (
    <div className={clsx(workflowDetailStyles['workflow-info-panel'])}>
      <div className={clsx(workflowDetailStyles['workflow-info-form'])}>
        <div>
          <span>uuid</span>
          <code>{revision.workflowUuid}</code>
        </div>
        <div>
          <span>当前版本</span>
          <strong>Revision {revision.revision}</strong>
        </div>
        <div>
          <span>节点数量</span>
          <strong>{counts.nodes} 个节点</strong>
        </div>
        <div>
          <span>连线数量</span>
          <strong>{counts.edges} 条连线</strong>
        </div>
      </div>
      <WorkflowContractSummary revision={revision} />
    </div>
  )
}

function WorkflowContractSummary({ revision }: { revision: PublishedWorkflowRevision }) {
  const contracts = workflowContracts(revision)
  return (
    <div className={clsx(workflowDetailStyles['workflow-contract-summary'])}>
      <ContractGroup title="工作流输入" fields={contracts.inputs} empty="未声明输入参数" />
      <ContractGroup title="工作流输出" fields={contracts.outputs} empty="未声明输出参数" />
    </div>
  )
}

function ContractGroup({
  title,
  fields,
  empty,
}: {
  title: string
  fields: ReturnType<typeof workflowContracts>['inputs']
  empty: string
}) {
  return (
    <div className={clsx(workflowDetailStyles['workflow-contract-group'])}>
      <strong>{title}</strong>
      {fields.length ? (
        <div className={clsx(workflowDetailStyles['workflow-contract-list'])}>
          {fields.map((field) => (
            <span key={field.name} className={clsx(workflowDetailStyles['workflow-contract-chip'])}>
              {field.name}
              {field.required ? <em>必填</em> : null}
            </span>
          ))}
        </div>
      ) : (
        <span className={clsx(workflowDetailStyles['workflow-contract-empty'])}>{empty}</span>
      )}
    </div>
  )
}
