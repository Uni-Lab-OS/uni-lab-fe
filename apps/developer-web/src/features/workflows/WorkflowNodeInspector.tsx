import { Descriptions, Empty, Tabs } from 'antd'
import type { PublishedWorkflowRevision } from '@unilab-fe/core'
import { cx } from './workflowClassNames'
import {
  readString,
  resolveWorkflowResourceName,
  workflowNodeDetails,
  workflowValueText,
  type WorkflowResourceDirectory,
} from './workflowPresentation'

export function NodeInspector({
  revision,
  node,
  resourceDirectory,
}: {
  revision: PublishedWorkflowRevision
  node: Readonly<Record<string, unknown>>
  resourceDirectory: WorkflowResourceDirectory
}) {
  const details = workflowNodeDetails(revision, node)
  return (
    <Tabs
      items={[
        {
          key: 'base',
          label: '基础信息',
          children: (
            <Descriptions className={cx('workflow-node-descriptions')} column={1} size="small">
              <Descriptions.Item label="节点 UUID">
                {readString(node, ['uuid', 'node_uuid']) ?? '暂无'}
              </Descriptions.Item>
              <Descriptions.Item label="节点类型">
                {readString(node, ['type', 'node_type']) ?? '暂无'}
              </Descriptions.Item>
              <Descriptions.Item label="动作名称">
                {readString(node, ['action_name', 'name']) ?? '暂无'}
              </Descriptions.Item>
              <Descriptions.Item label="动作类型">
                {readString(node, ['action_type', 'executor_kind']) ?? '暂无'}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                {node.disabled === true ? '已禁用' : '可执行'}
              </Descriptions.Item>
              <Descriptions.Item label="描述">
                {readString(node, ['description']) ?? '暂无描述'}
              </Descriptions.Item>
            </Descriptions>
          ),
        },
        {
          key: 'io',
          label: `输入输出 (${details.inputs.length}/${details.outputs.length})`,
          children: (
            <div className={cx('workflow-node-io')}>
              <NodeHandleGroup
                title="输入参数"
                handles={details.inputs}
                empty="该节点没有输入句柄"
                resourceDirectory={resourceDirectory}
              />
              <NodeHandleGroup
                title="输出结果"
                handles={details.outputs}
                empty="该节点没有输出句柄"
                resourceDirectory={resourceDirectory}
              />
            </div>
          ),
        },
        {
          key: 'resources',
          label: `资源需求 (${details.resources.length})`,
          children: details.resources.length ? (
            <div className={cx('workflow-resource-list')}>
              {details.resources.map((resource, index) => (
                <div
                  className={cx('workflow-resource-row')}
                  key={`${resource.kind}-${resource.value}-${index}`}
                >
                  <strong>{resource.kindLabel}</strong>
                  <span>
                    {resolveWorkflowResourceName(resource.kind, resource.value, resourceDirectory)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该节点没有声明资源需求" />
          ),
        },
      ]}
    />
  )
}

function NodeHandleGroup({
  title,
  handles,
  empty,
  resourceDirectory,
}: {
  title: string
  handles: ReturnType<typeof workflowNodeDetails>['inputs']
  empty: string
  resourceDirectory: WorkflowResourceDirectory
}) {
  return (
    <section className={cx('workflow-handle-group')}>
      <div className={cx('workflow-handle-group__title')}>
        <strong>{title}</strong>
        <span>{handles.length}</span>
      </div>
      {handles.length ? (
        <div className={cx('workflow-handle-grid')}>
          {handles.map((handle) => (
            <div className={cx('workflow-handle-card')} key={handle.name}>
              <div>
                <strong>{handle.name}</strong>
                {handle.required ? <em>必填</em> : <small>可选</small>}
              </div>
              <span>{handle.schema?.type ? String(handle.schema.type) : '未声明类型'}</span>
              {handle.value !== undefined ? (
                <code>{workflowValueText(handle.value, resourceDirectory)}</code>
              ) : null}
              {handle.description ? <small>{handle.description}</small> : null}
            </div>
          ))}
        </div>
      ) : (
        <span className={cx('workflow-contract-empty')}>{empty}</span>
      )}
    </section>
  )
}
