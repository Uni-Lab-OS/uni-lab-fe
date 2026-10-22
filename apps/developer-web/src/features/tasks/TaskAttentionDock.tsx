import { useEffect, useRef, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Badge, Button } from 'antd'
import styles from './TaskAttentionDock.module.scss'

/**
 * 任务运行时需要操作员处理的事项（待确认、结果未知、无法排程、人工交互、资源交接）统一放在页面右下角的
 * 浮动面板里。面板浮在内容之上、不占文档流：事项出现或消失时不改变执行时间线的高度，节点列表不跳动。
 *
 * - `attentionKey` 是当前待处理节点的身份集合；集合出现新成员时自动展开，操作员收起后同一批不再反复弹出。
 * - 收起时只保留标题条，子组件保持挂载（处理中的对话框与读取状态不丢）。
 * - 面板内没有任何事项（子组件都不渲染）时整体不显示。
 */
export function TaskAttentionDock({
  count,
  attentionKey,
  children,
}: {
  /** 标题上的计数（待处理节点与无法排程节点）；人工交互与资源交接在面板内各自计数。 */
  count: number
  attentionKey: string
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const seen = useRef(attentionKey)
  useEffect(() => {
    const previous = new Set(seen.current.split('|').filter(Boolean))
    const current = attentionKey.split('|').filter(Boolean)
    if (current.some((id) => !previous.has(id))) setCollapsed(false)
    seen.current = attentionKey
  }, [attentionKey])
  return (
    <aside
      className={clsx(styles['dock'], collapsed && styles['is-collapsed'])}
      aria-label="需要处理"
    >
      <header className={clsx(styles['dock-header'])}>
        <strong>需要处理</strong>
        {count > 0 && <Badge count={count} />}
        <Button
          size="small"
          type="text"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? '展开' : '收起'}
        </Button>
      </header>
      <div className={clsx(styles['dock-body'])} hidden={collapsed}>
        {children}
      </div>
    </aside>
  )
}
