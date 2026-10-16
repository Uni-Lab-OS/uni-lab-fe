import { clsx } from 'clsx'
import taskDetailTimelineStyles from './TaskDetailTimelinePanel.module.scss'
import type { ReactNode } from 'react'

import { Popconfirm, Tooltip } from 'antd'

import { AppIcon } from '../../components/ui/Icon'

const iconMap: Record<string, string> = {
  'check-circle': 'general/check-circle',
  'play-circle': 'media/play-circle',
  clock: 'time/clock',
  'user-check': 'users/user-check-01',
  'help-circle': 'general/help-circle',
  'minus-circle': 'general/minus-circle',
  'alert-circle': 'alerts-feedback/alert-circle',
  'alert-triangle': 'alerts-feedback/alert-triangle',
  'skip-forward': 'media/skip-forward',
  'chevron-right': 'arrows/chevron-right',
  'git-branch': 'development/git-branch-01',
  hash: 'general/hash-01',
  'more-horizontal': 'general/dots-horizontal',
  play: 'media/play',
  pause: 'media/pause-circle',
  'list-ordered': 'layout/list',
  square: 'media/stop-circle',
  info: 'general/info-circle',
  'arrow-up-right': 'arrows/arrow-up-right',
  list: 'layout/list',
  activity: 'general/activity',
  filter: 'general/filter-lines',
  'shield-check': 'security/shield-tick',
  x: 'general/x-close',
  'arrow-left': 'arrows/arrow-left',
  'file-text': 'files/file-structure',
  cube: 'shapes/cube-01',
  lock: 'security/lock-01',
  'layout-grid': 'layout/layout-grid-01',
  check: 'general/check',
  search: 'general/search-md',
  'refresh-cw': 'arrows/refresh-cw-01',
  'git-branch-01': 'development/git-branch-01',
  'shield-alert': 'security/shield-zap',
  unlock: 'security/lock-unlocked-01',
  'clipboard-check': 'files/clipboard-check',
  bot: 'shapes/cube-02',
  flask: 'education/beaker-01',
  'map-pin': 'maps/marker-pin-01',
  scale: 'editor/scale-01',
  help: 'general/help',
  minus: 'general/minus',
  'bar-chart': 'charts/bar-chart-09',
}

export function DebugIcon({
  name,
  size,
  className,
}: {
  readonly name: string
  readonly size?: number
  readonly className?: string
}) {
  return (
    <span className={className}>
      <AppIcon
        name={(iconMap[name] ?? 'general/info-circle') as never}
        size={(size === 13 ? 14 : size) as never}
        color="inherit"
      />
    </span>
  )
}

export function DebugActionButton({
  label,
  tooltip,
  className,
  disabled,
  confirm,
  onClick,
  children,
}: {
  readonly label: string
  readonly tooltip?: string
  readonly className?: string
  readonly disabled?: boolean
  /** 不可撤销的操作（如取消任务）先二次确认，确认后才执行 onClick。 */
  readonly confirm?: { readonly title: string; readonly okText: string }
  readonly onClick: () => void
  readonly children: ReactNode
}) {
  const button = (
    <button
      type="button"
      className={clsx(taskDetailTimelineStyles['debug-timeline-action'], className ?? '')}
      aria-label={label}
      disabled={disabled}
      onClick={confirm ? undefined : onClick}
    >
      {children}
    </button>
  )
  return (
    <Tooltip title={tooltip ?? label} placement="top">
      <span className={clsx(taskDetailTimelineStyles['debug-timeline-action-hitarea'])}>
        {confirm ? (
          <Popconfirm
            title={confirm.title}
            okText={confirm.okText}
            cancelText="再看看"
            okButtonProps={{ danger: true }}
            disabled={disabled}
            onConfirm={onClick}
          >
            {button}
          </Popconfirm>
        ) : (
          button
        )}
      </span>
    </Tooltip>
  )
}
