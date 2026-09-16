import { useEffect, useState, type ReactNode } from 'react'
import { WorkflowButton } from './WorkflowButton'
import { loadingConfirmationDisabledReason, type WorkflowLoadingView } from '../utils/workflowLoadingView'
import { clampRelativeDialogSize, DEFAULT_LOADING_DIALOG_SIZE, LOADING_DIALOG_SIZE_KEY, readRelativeDialogSize } from '../utils/relativeDialogSize'
import styles from './WorkflowLoadingDialog.module.scss'

export interface WorkflowLoadingDialogProps {
  view: WorkflowLoadingView
  online: boolean
  busy: boolean
  minimized: boolean
  error: string | null
  navigation?: ReactNode
  onMinimize: () => void
  onRestore: () => void
  onRefresh: () => void
  /** 仅已实现标准入库确认协议的宿主可提供；本组件不构造写入载荷。 */
  onConfirm?: () => void
  onReplay?: () => void
}

/** 入库只读确认视图。生命周期与权威读取由常驻干预宿主管理，不提供关闭/自动确认。 */
export function WorkflowLoadingDialog(props: WorkflowLoadingDialogProps) {
  const { view, online, busy, minimized, error, onMinimize, onRestore, onRefresh, onConfirm } = props
  const [size, setSize] = useState(DEFAULT_LOADING_DIALOG_SIZE)
  useEffect(() => {
    try { setSize(readRelativeDialogSize(window.localStorage.getItem(LOADING_DIALOG_SIZE_KEY))) } catch { /* 偏好不可用不影响干预。 */ }
  }, [])
  const resize = (dimension: 'width' | 'height', percent: number) => {
    const next = clampRelativeDialogSize({ ...size, [dimension]: percent / 100 })
    setSize(next)
    try { window.localStorage.setItem(LOADING_DIALOG_SIZE_KEY, JSON.stringify(next)) } catch { /* 只丢失尺寸偏好。 */ }
  }
  const multipleInstruments = new Set(view.rows.map(row => row.instrument.id)).size > 1
  const disabledReason = loadingConfirmationDisabledReason(view, online, busy, Boolean(onConfirm))
  const status = !online ? '连接离线，入库事项仍保留'
    : busy ? '正在提交入库确认，请等待服务结果'
    : view.status === 'selected' ? '确认已提交，等待服务更新库存' : '等待人工核对入库明细'
  if (minimized) return <aside className={styles.minimized} aria-label="待确认入库小窗">
    <button type="button" onClick={onRestore}>恢复入库窗口</button>
    <span role="status">{status}</span>{error && <span role="alert">{error}</span>}
  </aside>
  return <section className={styles.dialog} role="dialog" aria-modal="false" aria-label={view.title}
    style={{ width: `${size.width * 100}vw`, height: `${size.height * 100}vh` }}>
    <header><strong>{view.title}</strong><button type="button" onClick={onMinimize}>最小化</button></header>
    {props.navigation}
    <div className={styles.body}>
    <p role="status">{status}</p>
    {view.description && <p>{view.description}</p>}
    {error && <p role="alert">{error}</p>}
    <div className={styles.table}><table><thead><tr><th>位置</th><th>物料</th><th>数量</th><th>核对状态</th></tr></thead>
      <tbody>{view.rows.map(row => <tr key={row.key}>
        <td>{multipleInstruments ? `${row.instrument.label} · ` : ''}{row.site.label}</td>
        <td>{row.material.label}<small>{row.material.identity === 'existing' ? '已有物料' : '计划物料，尚未入库'}</small></td>
        <td>{row.quantity} {row.unit}</td><td>{row.confirmationStatus && <span>{row.confirmationStatus} · </span>}{row.availability.allowed ? '可核对' : row.availability.reason || '暂不可用'}</td>
      </tr>)}</tbody></table></div>
    <p>请核对实物与目标库位。确认后仍需等待服务返回最新库存。</p>
    <details><summary>调整窗口大小</summary><div className={styles.dimensions}>
      <label>窗口宽度<input aria-label="窗口宽度百分比" type="range" min="30" max="95" value={Math.round(size.width * 100)} onChange={event => resize('width', Number(event.target.value))} />{Math.round(size.width * 100)}%</label>
      <label>窗口高度<input aria-label="窗口高度百分比" type="range" min="30" max="95" value={Math.round(size.height * 100)} onChange={event => resize('height', Number(event.target.value))} />{Math.round(size.height * 100)}%</label>
    </div></details>
    {props.onReplay && <WorkflowButton type="button" disabled={!online || busy} disabledReason={!online ? '连接离线' : '正在提交'} onClick={props.onReplay}>重投已确认入库</WorkflowButton>}
    </div>
    <footer><WorkflowButton type="button" disabled={!online || busy} disabledReason={!online ? '连接离线' : '正在提交'} onClick={onRefresh}>重新读取</WorkflowButton>
      <WorkflowButton type="button" disabled={disabledReason !== null} disabledReason={disabledReason || ''}
        onClick={() => { if (!disabledReason) onConfirm?.() }}>确认已放置</WorkflowButton></footer>
  </section>
}
