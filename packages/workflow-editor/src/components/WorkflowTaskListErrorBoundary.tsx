import {
  Component,
  type ErrorInfo,
  type ReactNode
} from 'react'

import { TaskListState } from './WorkflowTaskListState'
import styles from './workflow.module.scss'

interface WorkflowTaskListErrorBoundaryProps {
  children: ReactNode
  resetKey: number
}

interface WorkflowTaskListErrorBoundaryState {
  error: Error | null
}

/** 防止单条异常任务数据导致整个工作流任务列表卸载为白屏。 */
export class WorkflowTaskListErrorBoundary extends Component<
  WorkflowTaskListErrorBoundaryProps,
  WorkflowTaskListErrorBoundaryState
> {
  state: WorkflowTaskListErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): WorkflowTaskListErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error))
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      '[WorkflowTaskListErrorBoundary]',
      error,
      info.componentStack
    )
  }

  componentDidUpdate(
    previousProps: WorkflowTaskListErrorBoundaryProps
  ): void {
    if (
      this.state.error
      && previousProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null })
    }
  }

  private readonly retry = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return <WorkflowTaskListFailure onRetry={this.retry} />
  }
}

/** 渲染任务列表级别的可恢复错误状态，避免工作台留下空白区域。 */
export function WorkflowTaskListFailure({
  onRetry
}: {
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div
      className={[
        styles.workflow,
        'workflow-task-list',
        'bg-[var(--unilab-color-canvas)] text-[var(--unilab-color-text)]'
      ].join(' ')}
    >
      <TaskListState
        kind="error"
        title="工作流任务列表显示异常"
        detail="任务数据暂时无法显示；可重试加载，其他工作台功能不受影响。"
        actionLabel="重新加载任务列表"
        onAction={onRetry}
      />
    </div>
  )
}
