import { useMemo, useState } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@unilab/design-system'

import type { CustomParameter, ReagentDefinition, ReagentLedgerRow, ReagentRecord } from '../types'
import { uiClass } from '../uiClasses'
import { WorkstationIcon } from '../WorkstationIcon'
import styles from '../workstation.module.scss'
import { CustomParameterFields } from './CustomParameterFields'
import { type ReagentRegistrationInput, validateRegistration } from './reagentModel'

export type ReagentDefinitionInput = Omit<ReagentDefinition, 'id' | 'code'>

interface DialogFrameProps {
  title: string
  description: string
  children: React.ReactNode
  onClose: () => void
  closeIconOnly?: boolean
}

/** 新增或编辑试剂定义；编码在内部生成且不暴露给产品界面。 */
export function DefinitionDialog({
  initial,
  onSave,
  onClose,
}: {
  initial?: ReagentDefinition
  onSave: (value: ReagentDefinitionInput) => void
  onClose: () => void
}): React.JSX.Element {
  const [custom, setCustom] = useState<CustomParameter[]>(() => initial?.custom.map((parameter) => ({ ...parameter })) ?? [])
  return (
    <DialogFrame
      title={initial ? '编辑试剂定义' : '新增试剂定义'}
      description="维护试剂共用的基础属性；名称、CAS、分子式和结构式均为必填。"
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const values = new FormData(event.currentTarget)
          onSave({
            name: textValue(values, 'name'),
            cas: textValue(values, 'cas'),
            formula: textValue(values, 'formula'),
            structure: textValue(values, 'structure'),
            molecularWeight: textValue(values, 'molecularWeight'),
            form: textValue(values, 'form') as ReagentDefinition['form'],
            defaultUnit: textValue(values, 'defaultUnit'),
            custom,
          })
        }}
      >
        <div className={styles.dialogFields}>
          <label>
            <span>试剂名称</span>
            <input name="name" data-dialog-initial-focus defaultValue={initial?.name} required />
          </label>
          <label>
            <span>CAS 号</span>
            <input name="cas" defaultValue={initial?.cas} required />
          </label>
          <label>
            <span>分子式</span>
            <input name="formula" defaultValue={initial?.formula} required />
          </label>
          <label>
            <span>结构式（文本）</span>
            <input name="structure" defaultValue={initial?.structure} required />
          </label>
          <label>
            <span>分子量</span>
            <input name="molecularWeight" defaultValue={initial?.molecularWeight} placeholder="例如 41.05 g/mol" />
          </label>
          <label>
            <span>常温形态</span>
            <select name="form" defaultValue={initial?.form ?? '液体'}>
              <option>液体</option>
              <option>固体</option>
              <option>气体</option>
              <option>液体（水溶液）</option>
            </select>
          </label>
          <label>
            <span>默认计量单位</span>
            <select name="defaultUnit" defaultValue={initial?.defaultUnit ?? 'mL'}>
              <option>mL</option>
              <option>μL</option>
              <option>g</option>
              <option>mg</option>
            </select>
          </label>
        </div>
        <CustomParameterFields value={custom} onChange={setCustom} />
        <DialogActions onClose={onClose} submitLabel={initial ? '保存修改' : '新增试剂'} />
      </form>
    </DialogFrame>
  )
}

/** 登记或编辑台账行，单位随试剂定义切换且有效期受登记日期约束。 */
export function RegistrationDialog({
  definitions,
  sites,
  initial,
  onSave,
  onClose,
}: {
  definitions: readonly ReagentDefinition[]
  sites: readonly { id: string; label: string }[]
  initial?: ReagentLedgerRow
  onSave: (value: ReagentRegistrationInput) => void
  onClose: () => void
}): React.JSX.Element {
  const initialDefinition = definitions.find((definition) => definition.id === initial?.reagentId) ?? definitions[0]
  const [reagentId, setReagentId] = useState(initialDefinition?.id ?? '')
  const [unit, setUnit] = useState(initial?.unit ?? initialDefinition?.defaultUnit ?? 'mL')
  const [registeredOn, setRegisteredOn] = useState(initial?.registeredOn ?? todayDate())
  const [expiresOn, setExpiresOn] = useState(initial?.expiresOn ?? futureDate(2))
  const [custom, setCustom] = useState<CustomParameter[]>(() => initial?.custom.map((parameter) => ({ ...parameter })) ?? [])
  const [error, setError] = useState('')
  function chooseDefinition(nextId: string): void {
    setReagentId(nextId)
    setUnit(definitions.find((definition) => definition.id === nextId)?.defaultUnit ?? 'mL')
  }
  return (
    <DialogFrame
      title={initial ? '编辑试剂台账' : '登记试剂'}
      description="本地登记不会创建物料（Material）或库存（Inventory）事实。"
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const values = new FormData(event.currentTarget)
          const input: ReagentRegistrationInput = {
            reagentId,
            densityValue: Number(values.get('densityValue')),
            densityUnit: textValue(values, 'densityUnit'),
            densityCondition: textValue(values, 'densityCondition'),
            supplier: textValue(values, 'supplier'),
            registeredOn,
            expiresOn,
            quantity: Number(values.get('quantity')),
            unit,
            siteId: textValue(values, 'siteId'),
            custom,
          }
          const nextError = validateRegistration(input)
          if (nextError) {
            setError(nextError)
            return
          }
          onSave(input)
        }}
      >
        <div className={styles.dialogFields}>
          <label>
            <span>试剂</span>
            <select data-dialog-initial-focus value={reagentId} onChange={(event) => chooseDefinition(event.target.value)} required>
              {definitions.map((definition) => (
                <option key={definition.id} value={definition.id}>
                  {definition.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>密度数值</span>
            <input name="densityValue" type="number" min="0.000001" step="any" defaultValue={initial?.densityValue ?? 0.786} required />
          </label>
          <label>
            <span>密度单位</span>
            <select name="densityUnit" defaultValue={initial?.densityUnit ?? 'g/mL'}>
              <option>g/mL</option>
              <option>g/cm³</option>
              <option>kg/m³</option>
            </select>
          </label>
          <label>
            <span>密度条件</span>
            <input name="densityCondition" defaultValue={initial?.densityCondition ?? '20℃'} required />
          </label>
          <label>
            <span>供应商</span>
            <input name="supplier" defaultValue={initial?.supplier} required />
          </label>
          <label>
            <span>登记日期</span>
            <input
              type="date"
              value={registeredOn}
              onChange={(event) => {
                setRegisteredOn(event.target.value)
                if (expiresOn < event.target.value) setExpiresOn(event.target.value)
              }}
              required
            />
          </label>
          <label>
            <span>初始 / 当前数量</span>
            <input name="quantity" type="number" min="0.000001" step="any" defaultValue={initial?.remainingQuantity ?? 4000} required />
          </label>
          <label>
            <span>计量单位</span>
            <input value={unit} readOnly />
          </label>
          <label>
            <span>有效期</span>
            <input type="date" min={registeredOn} value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} required />
          </label>
          <label>
            <span>库位</span>
            <select name="siteId" defaultValue={initial?.siteId} required>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <CustomParameterFields value={custom} onChange={setCustom} />
        {error ? (
          <p className={styles.dialogError} role="alert">
            {error}
          </p>
        ) : null}
        <DialogActions onClose={onClose} submitLabel={initial ? '保存台账修改' : '确认登记'} />
      </form>
    </DialogFrame>
  )
}

/** 归档需确认原因和归档时间，不提供反向恢复入口。 */
export function ArchiveDialog({
  name,
  onArchive,
  onClose,
}: {
  name: string
  onArchive: (reason: string, archivedAt: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [reason, setReason] = useState('')
  const [archivedAt] = useState(() => new Date().toISOString())
  return (
    <DialogFrame title="归档试剂台账" description={`归档“${name}”后，编辑、删除、归档和记录按钮都将禁用。`} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (reason.trim()) onArchive(reason.trim(), archivedAt)
        }}
      >
        <div className={styles.dialogFields}>
          <label>
            <span>归档时间</span>
            <input value={formatDateTime(archivedAt)} readOnly />
          </label>
          <label>
            <span>归档原因</span>
            <input data-dialog-initial-focus value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} required />
          </label>
        </div>
        <DialogActions onClose={onClose} submitLabel="确认归档" disabled={!reason.trim()} danger />
      </form>
    </DialogFrame>
  )
}

/** 对删除动作提供明确的不可逆范围说明。 */
export function DeleteReagentDialog({
  title,
  description,
  onDelete,
  onClose,
}: {
  title: string
  description: string
  onDelete: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <DialogFrame title={title} description={description} onClose={onClose}>
      <div className={uiClass.dialogActions}>
        <Button variant="outline" data-dialog-initial-focus onClick={onClose}>
          取消
        </Button>
        <Button variant="destructive" onClick={onDelete}>
          确认删除
        </Button>
      </div>
    </DialogFrame>
  )
}

/** 记录对话框按产品要求仅提供右上角关闭图标，不渲染底部操作区。 */
export function ReagentRecordsDialog({
  name,
  records,
  onClose,
}: {
  name: string
  records: readonly ReagentRecord[]
  onClose: () => void
}): React.JSX.Element {
  const ordered = useMemo(() => [...records].reverse(), [records])
  return (
    <DialogFrame
      title={`${name} · 操作记录`}
      description="本地变更不冒充可信设备回执；未知结果只记审计，不改变数量、位置或预留。"
      onClose={onClose}
      closeIconOnly
    >
      <div className={styles.reagentRecords}>
        {ordered.map((record) => (
          <article key={record.id} data-result={record.result}>
            <header>
              <strong>{record.action}</strong>
              <span>
                {record.result === 'success'
                  ? '成功'
                  : record.result === 'failed'
                    ? '失败'
                    : record.result === 'local'
                      ? '本地变更'
                      : '执行结果未知'}
              </span>
            </header>
            <dl>
              <div>
                <dt>任务</dt>
                <dd>{record.taskId ?? '—'}</dd>
              </div>
              <div>
                <dt>数量变化</dt>
                <dd>{record.quantityDelta ?? '未更新'}</dd>
              </div>
              <div>
                <dt>位置</dt>
                <dd>{record.fromSite || record.toSite ? `${record.fromSite ?? '—'} → ${record.toSite ?? '—'}` : '未更新'}</dd>
              </div>
              <div>
                <dt>可信回执</dt>
                <dd>{record.trusted ? '是' : '否（本地操作）'}</dd>
              </div>
            </dl>
            <footer>
              <time>{record.occurredAt}</time>
              <code>{record.traceId}</code>
            </footer>
          </article>
        ))}
      </div>
    </DialogFrame>
  )
}

/**
 * 渲染本地试剂夹具仍在使用的共享对话框外壳。
 * @param props 标题、说明、内容、关闭回调和关闭按钮显示方式。
 * @returns 使用 Radix 焦点管理的 shadcn/ui 对话框。
 */
function DialogFrame({ title, description, children, onClose, closeIconOnly = false }: DialogFrameProps): React.JSX.Element {
  /** 把 Radix 的关闭状态传给本地对话框所有者。 */
  function handleOpenChange(open: boolean): void {
    if (!open) onClose()
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        className={styles.formDialog}
        showCloseButton={false}
        portalled={false}
      >
        <div className={uiClass.panelHeader}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button
              variant={closeIconOnly ? 'ghost' : 'outline'}
              size={closeIconOnly ? 'icon-sm' : 'default'}
              data-dialog-initial-focus={closeIconOnly || undefined}
              aria-label="关闭"
            >
              {closeIconOnly ? <WorkstationIcon name="close" /> : '关闭'}
            </Button>
          </DialogClose>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function DialogActions({
  onClose,
  submitLabel,
  disabled = false,
  danger = false,
}: {
  onClose: () => void
  submitLabel: string
  disabled?: boolean
  danger?: boolean
}): React.JSX.Element {
  return (
    <div className={uiClass.dialogActions}>
      <Button variant="outline" onClick={onClose}>
        取消
      </Button>
      <Button variant={danger ? 'destructive' : 'default'} type="submit" disabled={disabled}>
        {submitLabel}
      </Button>
    </div>
  )
}

function textValue(values: FormData, name: string): string {
  return String(values.get(name) ?? '').trim()
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function futureDate(years: number): string {
  const date = new Date()
  date.setFullYear(date.getFullYear() + years)
  return date.toISOString().slice(0, 10)
}
