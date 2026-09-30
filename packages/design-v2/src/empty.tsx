import type { CSSProperties, ReactNode } from 'react'

import './empty.css'

export type EmptyStateScene =
  | 'no-data'
  | 'no-results'
  | 'no-results-2'
  | 'offline'
  | 'no-permission'
  | 'maintenance'
  | 'server-crash'
  | 'content-expired-404'
  | 'operation-failed'
  | 'no-task'
  | 'no-course'
  | 'no-competition'
  | 'no-journal-subscription'
  | 'no-scholar-subscription'
  | 'no-keyword-subscription'
  | 'unfollowed-scholar'

export type EmptyStateTone = 'light' | 'dark'
export type EmptyStateSize = 'default' | 'compact'

const EMPTY_STATE_ILLUSTRATIONS: Partial<
  Record<EmptyStateScene, Partial<Record<EmptyStateTone, string>>>
> = {
  'no-data': {
    light: new URL('./assets/empty/no-data-light.svg', import.meta.url).href,
    dark: new URL('./assets/empty/no-data-dark.svg', import.meta.url).href,
  },
  'no-results': {
    light: new URL('./assets/empty/no-results-light.svg', import.meta.url).href,
  },
  'no-task': {
    light: new URL('./assets/empty/no-task-light.svg', import.meta.url).href,
  },
}

export const EMPTY_STATE_LABELS: Record<EmptyStateScene, string> = {
  'no-data': '暂无数据',
  'no-results': '搜索无结果',
  'no-results-2': '搜索无结果',
  offline: '网络断开',
  'no-permission': '暂无权限',
  maintenance: '系统维护中',
  'server-crash': '服务器崩溃',
  'content-expired-404': '内容失效 404',
  'operation-failed': '操作失败',
  'no-task': '暂无任务',
  'no-course': '暂无课程',
  'no-competition': '暂无比赛',
  'no-journal-subscription': '暂无期刊订阅',
  'no-scholar-subscription': '暂无学者订阅',
  'no-keyword-subscription': '暂无关键词订阅',
  'unfollowed-scholar': '未关注学者',
}

export interface EmptyStateProps {
  /** Figma Empty Illustration 的业务场景。 */
  scene?: EmptyStateScene
  /** 替换场景默认文案；也可传入自定义节点。 */
  title?: ReactNode
  /** 可选的补充说明，位于头部文案下方。 */
  description?: ReactNode
  /** Empty Header 插槽。传入产品插画或媒体时会替换默认图形。 */
  illustration?: ReactNode
  /** Empty Content 插槽，通常放置一个或多个标准按钮。 */
  actions?: ReactNode
  tone?: EmptyStateTone
  size?: EmptyStateSize
  className?: string
  style?: CSSProperties
}

function DefaultIllustration({ scene, tone }: { scene: EmptyStateScene; tone: EmptyStateTone }) {
  const source = EMPTY_STATE_ILLUSTRATIONS[scene]?.[tone]

  if (!source) return null

  return (
    <img aria-hidden="true" className="bh-empty-state__illustration-asset" src={source} alt="" />
  )
}

export function EmptyState({
  scene = 'no-data',
  title,
  description,
  illustration,
  actions,
  tone = 'light',
  size = 'default',
  className,
  style,
}: EmptyStateProps) {
  const classes = ['bh-empty-state', className].filter(Boolean).join(' ')
  const label = title ?? EMPTY_STATE_LABELS[scene]

  return (
    <section
      aria-label={typeof label === 'string' ? label : undefined}
      aria-live="polite"
      className={classes}
      data-scene={scene}
      data-size={size}
      data-tone={tone}
      role="status"
      style={style}
    >
      <div className="bh-empty-state__header">
        <div className="bh-empty-state__illustration">
          {illustration ?? <DefaultIllustration scene={scene} tone={tone} />}
        </div>
        <div className="bh-empty-state__copy">
          <div className="bh-empty-state__title">{label}</div>
          {description ? <div className="bh-empty-state__description">{description}</div> : null}
        </div>
      </div>
      {actions ? <div className="bh-empty-state__content">{actions}</div> : null}
    </section>
  )
}
