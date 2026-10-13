import { clsx } from 'clsx'
import { Button } from 'antd'
import { StationResumeCard } from './StationResumeCard'
import type { IconName } from '@unilab/design-v2/icons'
import stationStyles from './stationHandling.module.scss'
import { AppIcon } from '../../components/ui/Icon'
import { useStationHandling } from './StationHandlingProvider'
import {
  errorFactPresentation,
  stationStatusPresentation,
  type StationTone,
} from './stationHandlingPresentation'

const toneIcon: Record<StationTone, IconName> = {
  idle: 'general/help-circle',
  ok: 'general/check-circle',
  attention: 'media/pause-circle',
  error: 'alerts-feedback/alert-circle',
}

/**
 * 总览的「异常任务」区：工站级决策的唯一归属。
 *
 * 错误事实是跨任务的，所以这里必须把它们全列出来 —— 停在某个任务页的人
 * 不应该看不到「还有别的在等」。「恢复工站调度」也只在这一层提供。
 */
export function StationHandlingSection({
  taskNames,
  onOpenTask,
}: {
  taskNames: ReadonlyMap<string, string>
  onOpenTask: (taskUuid: string) => void
}) {
  const {
    snapshot,
    loading,
    readError,
    pending,
    submitError,
    unconfirmed,
    refresh,
    applyCommand,
    retryUnconfirmed,
  } = useStationHandling()
  const status = stationStatusPresentation(snapshot, readError)
  const pendingCommands = snapshot?.controlCommands.filter((item) => item.needsApply) ?? []

  // 健康且没有待应用命令时整块隐藏 —— 异常处置不该被正常态淹没，
  // 也不该让总览常年挂着一块「工站运行中」的噪音。
  if (!status.needsAction) return null

  return (
    <section
      className={clsx(stationStyles['station-card'], stationStyles[`station-card--${status.tone}`])}
    >
      <div className={clsx(stationStyles['station-head'])}>
        <span className={clsx(stationStyles['status-icon'])} aria-hidden="true">
          <AppIcon name={toneIcon[status.tone]} size={18} />
        </span>
        <div>
          <strong className={clsx(stationStyles['station-title'])}>{status.label}</strong>
          <p className={clsx(stationStyles['station-detail'])}>{status.detail}</p>
        </div>
      </div>

      {loading && !snapshot && !readError && (
        <p className={clsx(stationStyles['note'])}>正在读取工站处置状态…</p>
      )}

      {readError && (
        <div className={clsx(stationStyles['station-actions'])}>
          <Button size="small" onClick={() => void refresh()}>
            重新读取状态
          </Button>
        </div>
      )}

      {snapshot && snapshot.errors.length > 0 && (
        <div className={clsx(stationStyles['error-list'])}>
          {snapshot.errors.map((error) => {
            const presentation = errorFactPresentation(error)
            const taskName = taskNames.get(error.sourceTaskUuid)
            return (
              <button
                key={error.decisionId}
                type="button"
                className={clsx(stationStyles['error-row'])}
                onClick={() => onOpenTask(error.sourceTaskUuid)}
                aria-label={`处置 ${error.message ?? '节点错误'}（${presentation.label}）`}
              >
                <span className={clsx(stationStyles['error-row-icon'])} aria-hidden="true">
                  <AppIcon
                    name={
                      presentation.tone === 'error'
                        ? 'alerts-feedback/alert-circle'
                        : 'media/pause-circle'
                    }
                    size={16}
                  />
                </span>
                <span className={clsx(stationStyles['error-row-main'])}>
                  <span className={clsx(stationStyles['error-row-title'])}>
                    {/* 名字取不到时给可定位的短 id，而不是含糊的「其他任务」。 */}
                    {taskName ?? `任务 ${error.sourceTaskUuid.slice(0, 8)}`} · {presentation.label}
                  </span>
                  <span className={clsx(stationStyles['error-row-text'])}>
                    {error.message ?? '节点执行失败，请打开任务查看细节。'}
                  </span>
                  <span className={clsx(stationStyles['error-row-meta'])}>
                    Task {error.sourceTaskUuid.slice(0, 12)}… · Job{' '}
                    {error.sourceJobUuid.slice(0, 12)}…
                  </span>
                </span>
                <span className={clsx(stationStyles['error-row-go'])}>去处置</span>
              </button>
            )
          })}
        </div>
      )}

      {pendingCommands.length > 0 && (
        <div className={clsx(stationStyles['error-list'])}>
          {pendingCommands.map((command) => (
            <div
              key={command.commandUuid}
              className={clsx(
                stationStyles['error-row'],
                stationStyles['error-row--pending-command'],
              )}
            >
              <span className={clsx(stationStyles['error-row-icon'])} aria-hidden="true">
                <AppIcon name="general/info-circle" size={16} />
              </span>
              <span className={clsx(stationStyles['error-row-main'])}>
                <span className={clsx(stationStyles['error-row-title'])}>
                  操作已受理，尚未生效 · {command.operation}
                </span>
                <span className={clsx(stationStyles['error-row-text'])}>
                  这条命令已经被 OS 受理但没有应用完成，所以工站还不能恢复调度。 点「继续应用」让 OS
                  收敛这条命令；是否生效以重新读取的工站状态为准。
                </span>
                <span className={clsx(stationStyles['error-row-meta'])}>
                  command {command.commandUuid}
                </span>
              </span>
              <span className={clsx(stationStyles['error-row-action'])}>
                <Button
                  size="small"
                  loading={pending}
                  onClick={() => void applyCommand(command.commandUuid)}
                >
                  继续应用
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}

      <StationResumeCard />

      {unconfirmed && (
        <div className={clsx(stationStyles['station-actions'])}>
          <Button size="small" loading={pending} onClick={() => void retryUnconfirmed()}>
            按原请求重试（{unconfirmed.label}）
          </Button>
        </div>
      )}

      {submitError && (
        <p className={clsx(stationStyles['problem'])} role="alert">
          {submitError}
        </p>
      )}
    </section>
  )
}
