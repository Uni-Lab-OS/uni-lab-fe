import { useState } from 'react'

import type { PointConfigVersion, Pose6D, RobotPoint, WorkstationSite } from '../types'
import { buttonClass, pillClass } from '../uiClasses'
import { WorkstationIcon } from '../WorkstationIcon'
import styles from '../workstation.module.scss'

const POSE_AXES: readonly (keyof Pose6D)[] = ['x', 'y', 'z', 'rx', 'ry', 'rz']

/** 使用局部表单草稿，只有点击更新时才改变配置与状态。 */
export function PointEditor({
  site,
  point,
  onApply,
  onRemove,
  onDraftDirtyChange,
}: {
  site: WorkstationSite
  point: RobotPoint
  onApply: (point: RobotPoint) => string | null
  onRemove: () => void
  onDraftDirtyChange: (dirty: boolean) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<RobotPoint>(() => ({
    ...point,
    pose: { ...point.pose },
  }))
  const [error, setError] = useState('')
  function updateAxis(axis: keyof Pose6D, rawValue: string): void {
    const value = Number(rawValue)
    if (Number.isFinite(value)) {
      setDraft((current) => ({
        ...current,
        pose: { ...current.pose, [axis]: value },
      }))
      onDraftDirtyChange(true)
    }
  }
  return (
    <div id="point-editor-panel" className={styles.pointEditor} role="tabpanel" aria-labelledby={`point-tab-${point.id}`}>
      <div className={styles.fieldGridThree}>
        <label>
          <span>所属库位</span>
          <input value={`${site.id} · ${site.label}`} readOnly />
        </label>
        <label>
          <span>点位名称</span>
          <input
            value={draft.label}
            maxLength={64}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                label: event.target.value,
              }))
              onDraftDirtyChange(true)
            }}
          />
        </label>
        <label>
          <span>运动方式</span>
          <select
            value={draft.motion}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                motion: event.target.value as RobotPoint['motion'],
              }))
              onDraftDirtyChange(true)
            }}
          >
            <option value="LIN">直线运动 LIN</option>
            <option value="PTP">关节运动 PTP</option>
          </select>
        </label>
      </div>
      <div className={styles.poseGrid}>
        {POSE_AXES.map((axis) => (
          <label key={axis}>
            <span>{axis.toUpperCase()}</span>
            <span className={styles.unitField}>
              <input type="number" step="0.1" value={draft.pose[axis]} onChange={(event) => updateAxis(axis, event.target.value)} />
              <small>{axis.startsWith('r') ? '°' : 'mm'}</small>
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.editorActions}>
        <button className={buttonClass('danger')} type="button" disabled={point.kind !== 'custom'} onClick={onRemove}>
          <WorkstationIcon name="trash" />
          从配置移除
        </button>
        <button className={buttonClass()} type="button" disabled title="未连接设备执行端">
          读取机械臂当前位置
        </button>
        <span className={pointStatusClass(point.status)}>{pointStatusLabel(point.status)}</span>
        <button
          className={buttonClass('primary')}
          type="button"
          onClick={() => {
            const nextError = onApply(draft)
            setError(nextError ?? '')
            if (!nextError) onDraftDirtyChange(false)
          }}
        >
          更新点位
        </button>
      </div>
    </div>
  )
}

export function EmptyPointState({ onCreate }: { onCreate: () => void }): React.JSX.Element {
  return (
    <div id="point-editor-panel" className={styles.emptyState} role="tabpanel" aria-labelledby="point-tab-create">
      <WorkstationIcon name="point" />
      <h3>当前库位没有控制点</h3>
      <p>创建自定义点位后补充位姿；未经验证不能用于生产执行。</p>
      <button className={buttonClass('primary')} type="button" onClick={onCreate}>
        创建点位
      </button>
    </div>
  )
}

export function PointFileFooter({
  history,
  dirty,
  feedback,
  onPreview,
}: {
  history: readonly PointConfigVersion[]
  dirty: boolean
  feedback: string
  onPreview: () => void
}): React.JSX.Element {
  return (
    <div className={styles.fileFooter}>
      <div>
        <WorkstationIcon name="file" />
        <span>
          <strong>ST01_robot_points.json</strong>
          <small>
            当前 v{history[0]?.version ?? '—'} · {dirty ? '存在未保存修改' : '文件状态已同步'}
          </small>
        </span>
      </div>
      <div className={styles.fileActions}>
        <span className={dirty ? 'text-[var(--unilab-color-warning)]' : 'text-[#166534]'}>{dirty ? '待保存' : '已同步'}</span>
        <button className={buttonClass()} type="button" onClick={onPreview}>
          预览 JSON
        </button>
      </div>
      <details className={styles.versionHistory}>
        <summary>版本记录（{history.length}）</summary>
        <ol>
          {history.map((item) => (
            <li key={`${item.version}-${item.savedAt}`}>
              <strong>v{item.version}</strong>
              <span>{item.note}</span>
              <time>{formatDateTime(item.savedAt)}</time>
              <code>{item.fileHash}</code>
            </li>
          ))}
        </ol>
      </details>
      <p role="status">{feedback}</p>
    </div>
  )
}

export function pointStatusLabel(status: RobotPoint['status']): string {
  return status === 'verified' ? '已验证' : status === 'pending_verification' ? '待验证' : status === 'disabled' ? '已禁用' : '未标定'
}

function pointStatusClass(status: RobotPoint['status']): string {
  return pillClass(status === 'verified' ? 'success' : status === 'disabled' ? 'neutral' : 'warning')
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
}
