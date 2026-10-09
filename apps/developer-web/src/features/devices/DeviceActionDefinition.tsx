import { clsx } from 'clsx'
import deviceDetailPageStyles from './DeviceDetailPage.module.scss'
import { Alert, Button, Descriptions, Tooltip, Typography } from 'antd'
import { useState } from 'react'
import type { ActionDefinition } from '@unilab-fe/core'
import { AppIcon } from '../../components/ui/Icon'

export function ActionDefinitionMeta({ definition }: { definition?: ActionDefinition }) {
  if (!definition) {
    return (
      <Alert
        type="warning"
        showIcon
        message="当前动作没有同步动作定义"
        description="参数仍按设备包 schema 展示，但 OS 没有返回可执行的动作定义。"
        style={{ marginBottom: 18 }}
      />
    )
  }
  return (
    <Descriptions
      className={clsx(deviceDetailPageStyles['definition-meta'])}
      column={2}
      size="small"
      colon={false}
    >
      <Descriptions.Item label="动作类型">{definition.actionType}</Descriptions.Item>
      <Descriptions.Item label="节点类型">{definition.nodeType}</Descriptions.Item>
      <Descriptions.Item label="动作类" span={2}>
        {definition.actionClass ?? '未提供'}
      </Descriptions.Item>
    </Descriptions>
  )
}

export function ActionSchemaView({
  definition,
  fallbackSchema,
}: {
  definition?: ActionDefinition
  fallbackSchema?: Readonly<Record<string, unknown>>
}) {
  const schema = definition?.schema ?? fallbackSchema
  const [copied, setCopied] = useState(false)
  if (!schema) {
    return <Typography.Text type="secondary">当前动作没有返回 schema。</Typography.Text>
  }
  const schemaText = JSON.stringify(schema, null, 2)
  const copySchema = async () => {
    try {
      await navigator.clipboard.writeText(schemaText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className={clsx(deviceDetailPageStyles['schema-block'])}>
      <div className={clsx(deviceDetailPageStyles['schema-block__header'])}>
        <span>Schema</span>
        <Tooltip title={copied ? '已复制' : '复制 Schema'}>
          <Button
            type="text"
            size="small"
            className={clsx(deviceDetailPageStyles['schema-block__copy'])}
            aria-label="复制 Schema"
            icon={<AppIcon name="general/copy-01" size={14} />}
            onClick={copySchema}
          />
        </Tooltip>
      </div>
      <pre>{schemaText}</pre>
    </div>
  )
}
