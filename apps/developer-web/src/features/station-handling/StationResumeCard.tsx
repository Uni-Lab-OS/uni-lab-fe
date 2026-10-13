import { useState } from 'react'
import { clsx } from 'clsx'
import { Button } from 'antd'
import stationStyles from './stationHandling.module.scss'
import { useStationHandling } from './StationHandlingProvider'
import { resumeAvailability } from './stationHandlingPresentation'

/**
 * 工站级「恢复调度」：全前端唯一的一份恢复实现。
 *
 * 为什么单独抽出来：节点抽屉（处置完最后一条错误的人就在这里）和总览对话框
 * 都需要它。恢复属于**工站**事实，不属于任何一条节点错误，所以它不能挂在
 * 「提交节点决定」的同一个控件上 —— 那样用户要同时判断两级事实，而且一旦被
 * 其它错误或快照 CAS 拦住，界面上没有任何地方能解释原因。
 *
 * 展示契约：能不能恢复永远显示**当前**门禁状态（`resumeAvailability`），
 * 不用「如果…则…」的反事实文案；不能恢复时给的是具体原因，不是灰按钮。
 */
export function StationResumeCard({ className }: { readonly className?: string }) {
  const { snapshot, readError, pending, resume } = useStationHandling()
  const [confirmed, setConfirmed] = useState(false)
  const state = resumeAvailability(snapshot, readError)

  // 只有工站处于暂停时才谈恢复；运行中不提「恢复」，避免制造不存在的待办。
  if (snapshot?.mode !== 'PAUSED') return null

  if (!state.available) {
    // 不能恢复时只陈述当前事实：给一行状态说明，而不是一个灰按钮或勾选框。
    return (
      <p className={clsx(stationStyles['note'], className)} role="status">
        工站调度已暂停：{state.reason}
      </p>
    )
  }

  return (
    <div className={clsx(stationStyles['station-resume'], className)}>
      <strong className={clsx(stationStyles['decision-title'])}>恢复工站调度</strong>
      <p className={clsx(stationStyles['decision-detail'])}>{state.reason}</p>
      <label className={clsx(stationStyles['decision-check'])}>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={pending}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
        />
        <span>我已核对现场，确认可以恢复工站工作流调度</span>
      </label>
      <p className={clsx(stationStyles['decision-hint'])}>
        恢复绑定你看到的快照；期间又出了新错误的话，这次确认会作废，需要重新核对。
      </p>
      <div className={clsx(stationStyles['decision-actions'])}>
        <Button
          type="primary"
          size="small"
          disabled={!confirmed}
          loading={pending}
          onClick={() => {
            void resume({ operatorConfirmed: true }).then((ok) => {
              if (ok) setConfirmed(false)
            })
          }}
        >
          恢复工站调度
        </Button>
      </div>
    </div>
  )
}
