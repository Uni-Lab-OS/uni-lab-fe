import { clsx } from 'clsx'
import styles from './DeviceActionPresentation.module.scss'
import { Alert, Collapse, Tag } from 'antd'
import { splitActionDescription } from '@unilab-fe/core'
import type {
  DeviceActionCategory,
  DeviceActionPresentation,
  DeviceActionPresentations,
} from '@unilab-fe/core'

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

/**
 * 动作说明：一句话提示在前；“前置与安全”默认展开，执行步骤与完成判据按需展开；
 * PLC 核对、实现核对、动作 ID 等开发信息收进“技术信息”。
 */
export function DeviceActionSummary({
  presentation,
  presentations,
}: {
  presentation: DeviceActionPresentation
  presentations: DeviceActionPresentations
}) {
  const category = presentations.categories[presentation.category]
  const needsMode =
    presentation.modes.length > 0 && !presentation.modes.includes(presentations.controlMode)
  const description = splitActionDescription(presentation)
  const operatorSections = description.sections.filter((section) => section.key !== 'technical')
  const technical = description.sections.find((section) => section.key === 'technical')
  const technicalLines = [
    `动作 ID：${presentation.ref}`,
    presentation.station
      ? `工位：${presentation.station}${presentation.actionCode ? `，动作码 ${presentation.actionCode}` : ''}`
      : '',
    presentation.plcLink,
    technical?.body ?? '',
  ].filter(Boolean)
  return (
    <section className={clsx(styles['action-summary'])} aria-label="动作说明">
      <div className={clsx(styles['action-summary__tags'])}>
        <Tag color={CATEGORY_COLORS[presentation.category]}>{category.label}</Tag>
        {presentation.confirm && <Tag>下发前确认</Tag>}
        {presentation.modes.length > 0 && <Tag>仅 {presentation.modes.join('/')} 模式</Tag>}
      </div>
      {description.summary && (
        <p className={clsx(styles['action-summary__hint'])}>{description.summary}</p>
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
        {needsMode && (
          <Alert
            type="warning"
            showIcon
            message={`当前站级控制模式为 ${presentations.controlMode || '未知'}，该动作需要 ${presentation.modes.join('/')} 模式，下发会被拒绝。`}
          />
        )}
      </div>
      <Collapse
        className={clsx(styles['action-summary__sections'])}
        size="small"
        ghost
        defaultActiveKey={operatorSections.some((section) => section.key === 'safety') ? ['safety'] : []}
        items={[
          ...operatorSections.map((section) => ({
            key: section.key,
            label: section.title,
            children: <p className={clsx(styles['action-summary__desc'])}>{section.body}</p>,
          })),
          {
            key: 'technical',
            label: '技术信息',
            children: (
              <p className={clsx(styles['action-summary__desc'])}>{technicalLines.join('\n')}</p>
            ),
          },
        ]}
      />
    </section>
  )
}
