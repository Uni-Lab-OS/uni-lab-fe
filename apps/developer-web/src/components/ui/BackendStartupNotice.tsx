import { clsx } from 'clsx'
import styles from './AsyncState.module.scss'
import { Alert, Progress, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { useOptionalBackend } from '../../app/BackendProvider'

/**
 * 后端尚未就绪时的提示：显示 OS 当前启动阶段、进度与已等待时间，就绪后页面自动刷新。
 * 区别于业务错误，不使用红色报错样式。
 */
export function BackendStartupNotice({ onRetry }: { onRetry: () => void }) {
  const context = useOptionalBackend()
  const startup = context?.startup ?? null
  const waitingSince = context?.waitingSince ?? null
  const now = useNow(1_000)
  const elapsedS =
    startup?.elapsedS ?? (waitingSince !== null ? Math.max(0, (now - waitingSince) / 1000) : undefined)

  if (startup?.status === 'failed') {
    return (
      <Alert
        className={clsx(styles['async-error'])}
        type="error"
        showIcon
        message="OS 启动失败"
        description={startup.error ?? startup.label ?? '请查看 OS 启动日志'}
        action={
          <button type="button" className={clsx(styles['text-action'])} onClick={onRetry}>
            重试
          </button>
        }
      />
    )
  }

  const progress = startup?.progress
  const percent = progress ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : undefined
  return (
    <Alert
      className={clsx(styles['async-starting'])}
      type="info"
      showIcon
      icon={<Spin size="small" />}
      message="OS 正在启动，就绪后自动加载"
      description={
        <div role="status" aria-live="polite">
          <div>
            {startup?.label ?? '等待 OS 服务响应'}
            {elapsedS !== undefined ? `（已等待 ${formatDuration(elapsedS)}）` : ''}
          </div>
          {percent !== undefined && <Progress percent={percent} size="small" status="active" />}
          <div className={clsx(styles['async-starting__hint'])}>
            冷启动需要编译并发布全部工作流，通常需要十余分钟。若长时间无变化，请确认 OS 进程已启动、地址与端口正确。
          </div>
        </div>
      }
    />
  )
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

export function formatDuration(seconds: number): string {
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`
}
