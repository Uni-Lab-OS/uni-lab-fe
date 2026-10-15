import { clsx } from 'clsx'
import styles from './DeviceActionPresentation.module.scss'
import { Alert, Button, Descriptions, Spin } from 'antd'
import { useEffect, useState } from 'react'
import { describeActionResult } from '@unilab-fe/core'
import type { DeviceActionPresentation, DeviceActionRunView } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { navigateTo } from '../../app/navigation'
import { deviceActionErrors, deviceActionReturnInfo, deviceActionRunState } from './deviceActionRunModel'

const POLL_MS = 1000
const MAX_READ_FAILURES = 5

/**
 * 单动作结果：受理后自动读取 OS Task/Job，直到终态。读数类动作直接显示带中文名的返回值；
 * 失败显示设备给出的具体原因；结果未知、取消中如实提示，不折叠成失败或成功。
 */
export function DeviceActionRunResult({
  taskUuid,
  presentation,
}: {
  taskUuid: string
  presentation: DeviceActionPresentation | undefined
}) {
  const { backend } = useBackend()
  const [view, setView] = useState<DeviceActionRunView | null>(null)
  const [readError, setReadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let failures = 0
    let timer: number | undefined
    const poll = async () => {
      try {
        const next = await backend.core.deviceActions.getActionRun(taskUuid)
        if (!active) return
        failures = 0
        setReadError(null)
        setView(next)
        if (deviceActionRunState(next).settled) return
      } catch (error) {
        if (!active) return
        failures += 1
        setReadError(error instanceof Error ? error.message : '读取运行状态失败')
        if (failures >= MAX_READ_FAILURES) return
      }
      timer = window.setTimeout(() => void poll(), POLL_MS)
    }
    setView(null)
    setReadError(null)
    void poll()
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [backend, taskUuid])

  const openTask = () => navigateTo('tasks', `?task=${encodeURIComponent(taskUuid)}`)

  if (!view) {
    return (
      <div className={clsx(styles['run-result'])} role="status">
        {readError ? (
          <Alert type="warning" showIcon message="已受理，读取运行状态失败" description={readError} />
        ) : (
          <Alert type="info" showIcon message={<span><Spin size="small" /> 已受理，正在读取运行状态…</span>} />
        )}
      </div>
    )
  }

  const state = deviceActionRunState(view)
  const errors = deviceActionErrors(view)
  const values =
    state.phase === 'succeeded'
      ? describeActionResult(deviceActionReturnInfo(view), presentation).filter(
          (entry) => !['terminal', 'command_id', 'request_seq'].includes(entry.name) || !presentation,
        )
      : []
  return (
    <div className={clsx(styles['run-result'])} role="status" aria-live="polite">
      <Alert
        type={state.tone}
        showIcon
        message={
          <span>
            {!state.settled && <Spin size="small" />} {presentation?.label ?? '设备动作'}：{state.label}
          </span>
        }
        description={
          <>
            {state.detail}
            {errors.length > 0 && (
              <ul className={clsx(styles['run-result__errors'])}>
                {errors.map((error, index) => (
                  <li key={index}>
                    {error.code ? <strong>{error.code}：</strong> : null}
                    {error.message}
                    {error.detail ? `（${error.detail}）` : ''}
                  </li>
                ))}
              </ul>
            )}
            {readError ? <div>最近一次刷新失败：{readError}</div> : null}
          </>
        }
      />
      {values.length > 0 && (
        <Descriptions
          className={clsx(styles['run-result__values'])}
          title="返回结果"
          bordered
          size="small"
          column={1}
        >
          {values.map((entry) => (
            <Descriptions.Item key={entry.name} label={entry.label}>
              {formatValue(entry.value)}
            </Descriptions.Item>
          ))}
        </Descriptions>
      )}
      {state.phase === 'succeeded' && values.length === 0 && (
        <p className={clsx(styles['action-group__hint'])}>动作已完成，该动作没有返回读数。</p>
      )}
      <div className={clsx(styles['run-result__footer'])}>
        <Button type="link" onClick={openTask}>
          在任务页查看详情与处置
        </Button>
      </div>
    </div>
  )
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
