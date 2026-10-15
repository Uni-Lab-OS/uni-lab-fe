import { clsx } from 'clsx'
import styles from './DeviceActionPresentation.module.scss'
import { Alert, Tag, Typography } from 'antd'
import type { DeviceActionCategory, DeviceActionPresentation, DeviceActionPresentations } from '@unilab-fe/core'

const CATEGORY_COLORS: Record<DeviceActionCategory, string> = {
  read: 'blue',
  compute: 'cyan',
  actuate: 'orange',
  configure: 'gold',
  safety: 'red',
  debug: 'purple',
  flow: 'default',
  hook: 'default',
}

/** 动作说明：类别、工位与动作码、模式要求、操作提示与完整说明（同 PlatformUI 动作页右栏）。 */
export function DeviceActionSummary({
  presentation,
  presentations,
}: {
  presentation: DeviceActionPresentation
  presentations: DeviceActionPresentations
}) {
  const category = presentations.categories[presentation.category]
  const needsDebug = presentation.modes.length > 0 && !presentation.modes.includes(presentations.controlMode)
  return (
    <section className={clsx(styles['action-summary'])} aria-label="动作说明">
      <div className={clsx(styles['action-summary__tags'])}>
        <Tag color={CATEGORY_COLORS[presentation.category]}>{category.label}</Tag>
        {presentation.confirm && <Tag>下发前确认</Tag>}
        {presentation.station && (
          <Tag>
            工位 {presentation.station}
            {presentation.actionCode ? ` · 动作码 ${presentation.actionCode}` : ''}
          </Tag>
        )}
        {presentation.modes.length > 0 && <Tag>仅 {presentation.modes.join('/')} 模式</Tag>}
        <Tag>{presentation.ref}</Tag>
      </div>
      {presentation.hint && <p className={clsx(styles['action-summary__hint'])}>{presentation.hint}</p>}
      {presentation.desc && (
        <Typography.Paragraph
          className={clsx(styles['action-summary__desc'])}
          ellipsis={{ rows: 4, expandable: true, symbol: '展开说明' }}
        >
          {presentation.desc}
        </Typography.Paragraph>
      )}
      <div className={clsx(styles['action-summary__alerts'])}>
        {!presentation.executable && (
          <Alert type="error" showIcon message="该动作尚未在 OS 中注册为可执行能力，暂不能下发。" />
        )}
        {!presentation.manual && (
          <Alert
            type="warning"
            showIcon
            message="该动作通常由流程调用"
            description="手动下发可能打乱流程状态或物料记账，请确认确有需要。"
          />
        )}
        {needsDebug && (
          <Alert
            type="warning"
            showIcon
            message={`当前站级控制模式为 ${presentations.controlMode || '未知'}，该动作需要 ${presentation.modes.join('/')} 模式，下发会被拒绝。`}
          />
        )}
      </div>
    </section>
  )
}
