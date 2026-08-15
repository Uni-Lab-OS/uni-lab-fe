import { useState } from 'react'

import type { PointConfigVersion, SiteCatalogRecord, WorkstationSite } from '../types'
import { buttonClass, uiClass } from '../uiClasses'
import { useAccessibleDialog } from '../useAccessibleDialog'
import styles from '../workstation.module.scss'
import { serializePointFile } from './pointFile'

interface DialogFrameProps {
  title: string
  description: string
  children: React.ReactNode
  onClose: () => void
}

/** 从未加入工站配置的权威库位（Site）主表记录中选择。 */
export function SitePickerDialog({
  sites,
  onSelect,
  onClose,
}: {
  sites: readonly SiteCatalogRecord[]
  onSelect: (site: SiteCatalogRecord) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <DialogFrame title="选择库位" description="库位来自只读主表；加入后自动生成四个待标定标准点位。" onClose={onClose}>
      <div className={styles.dialogChoiceList}>
        {sites.length ? (
          sites.map((site, index) => (
            <button key={site.id} type="button" data-dialog-initial-focus={index === 0 || undefined} onClick={() => onSelect(site)}>
              <strong>
                {site.id} · {site.label}
              </strong>
              <small>
                {site.category}
                {site.materialLabel ? ` · ${site.materialLabel}` : ''}
              </small>
            </button>
          ))
        ) : (
          <p>所有可用库位都已加入当前工站。</p>
        )}
      </div>
    </DialogFrame>
  )
}

/** 保存前强制收集版本说明，提交后再执行文件写入。 */
export function SavePointDialog({
  version,
  onSave,
  onClose,
}: {
  version: string
  onSave: (note: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [note, setNote] = useState('')
  return (
    <DialogFrame title={`保存点位配置 v${version}`} description="版本说明会随本次文件记录保存，且不记录操作人。" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (note.trim()) onSave(note.trim())
        }}
      >
        <label className={styles.dialogSingleField}>
          <span>版本说明（必填）</span>
          <textarea data-dialog-initial-focus value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} required />
        </label>
        <div className={uiClass.dialogActions}>
          <button className={buttonClass()} type="button" onClick={onClose}>
            取消
          </button>
          <button className={buttonClass('primary')} type="submit" disabled={!note.trim()}>
            保存文件
          </button>
        </div>
      </form>
    </DialogFrame>
  )
}

/** 删除仅代表从当前配置移除，确认文案明确不删除权威库位或历史。 */
export function RemovePointDialog({
  pointLabel,
  onConfirm,
  onClose,
}: {
  pointLabel: string
  onConfirm: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <DialogFrame
      title="从配置移除点位"
      description={`“${pointLabel}”将从当前文件草稿移除；历史版本和权威数据不会被硬删除。`}
      onClose={onClose}
    >
      <div className={uiClass.dialogActions}>
        <button className={buttonClass()} type="button" data-dialog-initial-focus onClick={onClose}>
          取消
        </button>
        <button className={buttonClass('danger')} type="button" onClick={onConfirm}>
          确认移除
        </button>
      </div>
    </DialogFrame>
  )
}

/** 预览即将保存的 JSON 结构；正式版本说明在保存对话框中填写。 */
export function PointJsonDialog({
  sites,
  version,
  history,
  onClose,
}: {
  sites: WorkstationSite[]
  version: string
  history: readonly PointConfigVersion[]
  onClose: () => void
}): React.JSX.Element {
  return (
    <DialogFrame
      title="预览点位 JSON"
      description={`${sites.length} 个库位 · ${sites.reduce((total, site) => total + site.points.length, 0)} 个点位 · ${history.length} 条版本记录`}
      onClose={onClose}
    >
      <pre className={styles.pointJsonPreview}>{serializePointFile(sites, version, '保存时填写版本说明', history)}</pre>
    </DialogFrame>
  )
}

/** 为点位配置流程提供统一的模态框、Escape 关闭和焦点约束。 */
function DialogFrame({ title, description, children, onClose }: DialogFrameProps): React.JSX.Element {
  const dialogRef = useAccessibleDialog(onClose)
  return (
    <div className={uiClass.dialogBackdrop} role="presentation">
      <section
        ref={dialogRef}
        className={styles.formDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="point-dialog-title"
        tabIndex={-1}
      >
        <div className={uiClass.panelHeader}>
          <div>
            <h2 id="point-dialog-title">{title}</h2>
            <small>{description}</small>
          </div>
          <button className={buttonClass()} type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}
