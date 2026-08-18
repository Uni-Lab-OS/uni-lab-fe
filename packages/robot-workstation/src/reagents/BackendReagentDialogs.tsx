import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button, Input, Textarea } from '@unilab/design-system'

import type {
  CustomParameter,
  ReagentContainerOption,
  ReagentCreateCommand,
  ReagentInfoProjection,
  ReagentInventoryProjection,
  ReagentUpdateCommand
} from '../types'
import { uiClass } from '../uiClasses'
import styles from '../workstation.module.scss'
import {
  ReagentDialogActions,
  ReagentDialogFrame,
  reagentDialogErrorMessage
} from './ReagentDialogPrimitives'
import { optionalNumber, textValue } from './reagentFormValues'
import { CustomParameterFields } from './CustomParameterFields'
import { QuantityUnitSelect, REAGENT_QUANTITY_UNITS } from './QuantityUnitSelect'

type EditorProps = {
  containers: readonly ReagentContainerOption[]
  infos?: readonly ReagentInfoProjection[]
  occupiedMaterialIds: ReadonlySet<string>
  onClose: () => void
} & (
  | {
      mode: 'create'
      onSave: (command: ReagentCreateCommand) => Promise<void>
    }
  | {
      mode: 'edit'
      item: ReagentInventoryProjection
      onSave: (command: ReagentUpdateCommand) => Promise<void>
    }
)

/**
 * 编辑 Backend 试剂实例；创建时选择既有容器，更新时固定身份和计量单位。
 * @param props 创建或编辑上下文、容器目录和真实写入回调。
 * @returns 支持键盘焦点约束、内联校验和提交错误恢复的模态表单。
 */
export function BackendReagentEditorDialog(props: EditorProps): React.JSX.Element {
  const availableContainers = useMemo(
    () => props.containers.filter(container =>
      !props.occupiedMaterialIds.has(container.id)
    ),
    [props.containers, props.occupiedMaterialIds]
  )
  const initial = props.mode === 'edit' ? props.item : undefined
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const errorRef = useRef<HTMLParagraphElement>(null)
  const [selectedInfoId, setSelectedInfoId] = useState('')
  const [densityGPerMl, setDensityGPerMl] = useState(
    initial?.densityGPerMl == null ? '' : String(initial.densityGPerMl)
  )
  const [quantityUnit, setQuantityUnit] = useState(initial?.unit ?? '')
  const [advancedOpen, setAdvancedOpen] = useState(
    props.mode === 'edit' && Boolean(initial?.concentrationValue != null || initial?.description)
  )
  const [customParameters, setCustomParameters] = useState<CustomParameter[]>([])
  const selectedInfo = props.infos?.find(info => info.id === selectedInfoId)

  /** 切换试剂目录项时只带入参考密度，不替用户猜测计量单位。 */
  function selectReagentInfo(infoId: string): void {
    const nextInfo = props.infos?.find(info => info.id === infoId)
    setSelectedInfoId(infoId)
    setDensityGPerMl(nextInfo?.densityGPerMl == null ? '' : String(nextInfo.densityGPerMl))
    setQuantityUnit('')
  }

  function reportError(message: string): void {
    setError(message)
    requestAnimationFrame(() => errorRef.current?.focus())
  }

  /** 校验完整表单并向 Backend 提交一次创建或乐观修订更新。 */
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (submitting) return
    const form = new FormData(event.currentTarget)
    const values = reagentEditorValues(form)
    const validationError = validateReagentEditor(values, props.mode)
    if (validationError) {
      reportError(validationError)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      if (props.mode === 'create') {
        await props.onSave(reagentCreateCommand(values, customParameters))
      } else {
        await props.onSave({
          id: props.item.id,
          quantity: values.quantity,
          quantityUnit: props.item.unit ?? values.quantityUnit,
          expectedRevision: props.item.revision ?? 0,
          ...concentrationCommand(values),
          ...(values.description ? { description: values.description } : {}),
          ...(props.item.metadata ? { metadata: props.item.metadata } : {})
        })
      }
    } catch (submitError) {
      reportError(reagentDialogErrorMessage(submitError, '库存保存失败，请检查连接后重试。'))
      setSubmitting(false)
    }
  }

  const noAvailableContainer = props.mode === 'create' && availableContainers.length === 0
  return (
    <ReagentDialogFrame
      title={props.mode === 'create' ? '试剂入库登记' : `编辑库存 · ${props.item.name}`}
      description={props.mode === 'create'
        ? '从试剂目录选择试剂并装入一个试剂容器，登记初始库存。'
        : `修订 ${props.item.revision ?? '未知'} · 容器 ${props.item.lotLabel ?? props.item.materialId ?? '未知'}`}
      busy={submitting}
      wide={props.mode === 'create'}
      onClose={props.onClose}
    >
      <form autoComplete="off" onSubmit={(event) => void handleSubmit(event)}>
        <div className={styles.formRequiredNote}><span aria-hidden="true">*</span> 必填</div>
        {error ? <p ref={errorRef} tabIndex={-1} className={styles.dialogErrorSummary} role="alert">{error}</p> : null}
        <div className={styles.formSections}>
          {props.mode === 'create' ? (
            <fieldset className={styles.formSection}>
              <legend>试剂与容器</legend>
              <div className={styles.dialogFields}>
                <div className={styles.reagentContainerField}>
                  <span>试剂容器 <b aria-hidden="true">*</b></span>
                  <ContainerSearchSelect containers={availableContainers} disabled={noAvailableContainer} />
                </div>
                <div className={styles.reagentContainerField}>
                  <span>试剂名称 <b aria-hidden="true">*</b></span>
                  <ReagentInfoSearchSelect
                    infos={props.infos ?? []}
                    value={selectedInfoId}
                    onChange={selectReagentInfo}
                  />
                  <input type="hidden" name="reagentInfoId" value={selectedInfoId} />
                  <input type="hidden" name="physicalState" value={selectedInfo?.physicalState ?? 'unknown'} />
                </div>
                {selectedInfo ? (
                  <div className={styles.reagentIdentitySummary}>
                    <span>{selectedInfo.cas ?? 'CAS 未登记'}</span>
                    <strong>{selectedInfo.name}</strong>
                    <small>{[selectedInfo.molecularFormula, physicalStateLabel(selectedInfo.physicalState)].filter(Boolean).join(' · ')}</small>
                  </div>
                ) : null}
              </div>
            </fieldset>
          ) : (
            <div className={styles.reagentIdentitySummary}>
              <span>{props.item.cas ?? 'CAS 未提供'}</span>
              <strong>{props.item.name}</strong>
              <small>{props.item.molecularFormula ?? props.item.reagentInfoId ?? '试剂信息未完整返回'}</small>
            </div>
          )}

          <fieldset className={styles.formSection}>
            <legend>库存计量</legend>
            <div className={styles.dialogFields}>
              <div className={styles.reagentQuantityField}>
                <span>{props.mode === 'create' ? '初始数量' : '当前数量'} <b aria-hidden="true">*</b></span>
                <div className={styles.reagentQuantityControl}>
                  <Input
                    name="quantity"
                    aria-label={props.mode === 'create' ? '初始数量' : '当前数量'}
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    defaultValue={initial?.totalQuantity ?? ''}
                    data-dialog-initial-focus={props.mode === 'edit' || undefined}
                    required
                  />
                  <QuantityUnitSelect
                    name="quantityUnit"
                    value={quantityUnit}
                    readOnly={props.mode === 'edit'}
                    onChange={setQuantityUnit}
                  />
                </div>
                {props.mode === 'edit' ? <small>库存建立后不能修改计量单位。</small> : null}
              </div>
              {props.mode === 'create' ? (
                <label>
                  <span>密度（g/mL）</span>
                  <Input
                    name="densityGPerMl"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={densityGPerMl}
                    onChange={event => setDensityGPerMl(event.target.value)}
                  />
                  {selectedInfo?.densityGPerMl != null ? <small>已带入身份中的参考密度，可修改。</small> : null}
                </label>
              ) : null}
              {props.mode === 'create' && densityGPerMl ? (
                <label>
                  <span>密度条件</span>
                  <Input name="densityCondition" placeholder="例如 20 °C" maxLength={64} />
                </label>
              ) : null}
            </div>
          </fieldset>

          {props.mode === 'create' ? (
            <fieldset className={styles.formSection}>
              <legend>批次信息</legend>
              <div className={styles.dialogFields}>
                <label>
                  <span>供应商</span>
                  <Input name="supplier" maxLength={255} />
                </label>
                <label>
                  <span>生产日期（有效期开始）</span>
                  <Input name="productionDate" type="date" />
                </label>
                <label>
                  <span>截止日期（有效期结束）</span>
                  <Input name="expiryDate" type="date" />
                </label>
              </div>
            </fieldset>
          ) : null}

          <details
            className={styles.formAdvanced}
            open={advancedOpen}
            onToggle={event => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary>更多信息</summary>
            <div className={styles.dialogFields}>
              <label>
                <span>浓度数值</span>
                <Input
                  name="concentrationValue"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  defaultValue={initial?.concentrationValue ?? ''}
                />
              </label>
              <label>
                <span>浓度单位</span>
                <Input
                  name="concentrationUnit"
                  maxLength={32}
                  placeholder="例如 %、mol/L"
                  defaultValue={initial?.concentrationUnit ?? ''}
                />
              </label>
              <label className={styles.dialogFieldWide}>
                <span>说明</span>
                <Textarea name="description" rows={3} maxLength={1000} defaultValue={initial?.description ?? ''} />
              </label>
            </div>
            {props.mode === 'create' ? (
              <CustomParameterFields value={customParameters} onChange={setCustomParameters} />
            ) : null}
          </details>
        </div>
        {noAvailableContainer ? (
          <p className={styles.dialogError} role="alert">
            没有可选试剂容器。请先在物料模块创建带 container 标签的试剂容器。
          </p>
        ) : null}
        <ReagentDialogActions
          onClose={props.onClose}
          submitLabel={submitting ? '正在保存…' : props.mode === 'create' ? '确认登记' : '保存修改'}
          disabled={submitting || noAvailableContainer}
          cancelDisabled={submitting}
        />
      </form>
    </ReagentDialogFrame>
  )
}

/** 使用独立触发器与搜索浮层完成试剂容器选择。 */
function ContainerSearchSelect({
  containers,
  disabled
}: {
  containers: readonly ReagentContainerOption[]
  disabled: boolean
}): React.JSX.Element {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const selected = containers.find(container => container.id === selectedId)
  const options = useMemo(
    () => filterReagentContainers(containers, query),
    [containers, query]
  )

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  function select(container: ReagentContainerOption): void {
    setSelectedId(container.id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div
      ref={rootRef}
      className={styles.reagentContainerSelect}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <input type="hidden" name="materialId" value={selectedId} />
      <Button
        type="button"
        variant="outline"
        className={styles.reagentContainerSelectControl}
        data-dialog-initial-focus
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(true)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
      >
        <span className={selected ? styles.reagentContainerSelectValue : styles.reagentContainerSelectPlaceholder}>
          {selected ? reagentContainerLabel(selected) : '请选择试剂容器'}
        </span>
        <span aria-hidden="true" className={styles.reagentContainerSelectArrow} />
      </Button>
      <div
        className={styles.reagentContainerSelectPopup}
        hidden={!open}
      >
        <Input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="搜索名称、条码或 UUID"
          aria-label="搜索试剂容器"
          aria-autocomplete="list"
          aria-controls={listboxId}
          role="combobox"
          autoComplete="off"
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              setOpen(false)
              rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
            } else if (event.key === 'Enter' && options[0]) {
              event.preventDefault()
              select(options[0])
            }
          }}
        />
        <div id={listboxId} role="listbox" className={styles.reagentContainerSelectMenu}>
          {options.length > 0 ? options.map(container => (
            <Button
              key={container.id}
              type="button"
              variant="ghost"
              size="sm"
              role="option"
              aria-selected={container.id === selectedId}
              onClick={() => select(container)}
            >
              <span>
                <strong>{container.name}</strong>
                <small>{container.barcode || container.id}</small>
              </span>
              {container.id === selectedId ? <b aria-hidden="true">✓</b> : null}
            </Button>
          )) : (
            <p>没有匹配的试剂容器</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** 使用名称、CAS 和别名搜索试剂目录，避免长目录退化为原生下拉框。 */
function ReagentInfoSearchSelect({
  infos,
  value,
  onChange
}: {
  infos: readonly ReagentInfoProjection[]
  value: string
  onChange: (infoId: string) => void
}): React.JSX.Element {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = infos.find(info => info.id === value)
  const options = useMemo(() => filterReagentInfos(infos, query), [infos, query])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  function select(info: ReagentInfoProjection): void {
    onChange(info.id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div
      ref={rootRef}
      className={styles.reagentContainerSelect}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <Button
        type="button"
        variant="outline"
        className={styles.reagentContainerSelectControl}
        role="combobox"
        aria-label="选择试剂名称"
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        disabled={infos.length === 0}
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(true)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
      >
        <span className={selected ? styles.reagentContainerSelectValue : styles.reagentContainerSelectPlaceholder}>
          {selected ? reagentInfoLabel(selected) : infos.length === 0 ? '暂无可选试剂名称' : '请选择试剂名称'}
        </span>
        <span aria-hidden="true" className={styles.reagentContainerSelectArrow} />
      </Button>
      <div className={styles.reagentContainerSelectPopup} hidden={!open}>
        <Input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="搜索名称、CAS、别名或分子式"
          aria-label="搜索试剂名称"
          aria-autocomplete="list"
          aria-controls={listboxId}
          role="combobox"
          autoComplete="off"
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              setOpen(false)
              rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
            } else if (event.key === 'Enter' && options[0]) {
              event.preventDefault()
              select(options[0])
            }
          }}
        />
        <div id={listboxId} role="listbox" className={styles.reagentContainerSelectMenu}>
          {options.length > 0 ? options.map(info => (
            <Button
              key={info.id}
              type="button"
              variant="ghost"
              size="sm"
              role="option"
              aria-selected={info.id === value}
              onClick={() => select(info)}
            >
              <span>
                <strong>{info.name}</strong>
                <small>{[info.cas, info.molecularFormula, info.nameEn].filter(Boolean).join(' · ') || '无扩展信息'}</small>
              </span>
              {info.id === value ? <b aria-hidden="true">✓</b> : null}
            </Button>
          )) : (
            <p>没有匹配的试剂名称</p>
          )}
        </div>
      </div>
    </div>
  )
}

function reagentContainerLabel(container: ReagentContainerOption): string {
  return `${container.name} · ${container.barcode || container.id}`
}

/** 按名称、CAS、别名和分子式筛选试剂目录。 */
function filterReagentInfos(
  infos: readonly ReagentInfoProjection[],
  query: string
): readonly ReagentInfoProjection[] {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  if (!normalized) return infos
  return infos.filter(info => [
    info.name,
    info.nameEn,
    ...info.aliases,
    info.cas,
    info.molecularFormula
  ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN').includes(normalized))
}

function reagentInfoLabel(info: ReagentInfoProjection): string {
  return [info.name, info.cas].filter(Boolean).join(' · ')
}

function physicalStateLabel(value: string): string {
  if (value === 'liquid') return '液体'
  if (value === 'solid') return '固体'
  if (value === 'gas') return '气体'
  return '未确定'
}

/**
 * 对 Backend 试剂软删除提供显式范围和文字确认。
 * @param props 待删除试剂、异步删除回调和关闭回调。
 * @returns 只有输入“删除”后才可提交的危险操作模态框。
 */
export function BackendReagentDeleteDialog({
  item,
  onDelete,
  onClose
}: {
  item: ReagentInventoryProjection
  onDelete: () => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const [confirmation, setConfirmation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  /** 提交软删除并等待 Backend 台账闭合完成。 */
  async function handleDelete(): Promise<void> {
    if (submitting || confirmation !== '删除') return
    setSubmitting(true)
    setError('')
    try {
      await onDelete()
    } catch (deleteError) {
      setError(reagentDialogErrorMessage(deleteError, '试剂删除失败，请刷新后重试。'))
      setSubmitting(false)
    }
  }

  return (
    <ReagentDialogFrame
      title={`删除 ${item.name}`}
      description={`Backend 会将 ${formatQuantity(item.totalQuantity, item.unit)} 余量闭合为零、追加 remove 台账并软删除试剂；被任务预留或修订冲突时会拒绝。`}
      busy={submitting}
      onClose={onClose}
    >
      <div className={styles.deleteConfirmation}>
        <label>
          <span>输入“删除”确认</span>
          <Input
            data-dialog-initial-focus
            value={confirmation}
            onChange={event => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </label>
        {error ? <p className={styles.dialogError} role="alert">{error}</p> : null}
      </div>
      <div className={uiClass.dialogActions}>
        <Button variant="outline" disabled={submitting} onClick={onClose}>取消</Button>
        <Button
          variant="destructive"
          type="button"
          disabled={submitting || confirmation !== '删除'}
          onClick={() => void handleDelete()}
        >
          {submitting ? '正在删除…' : '确认软删除'}
        </Button>
      </div>
    </ReagentDialogFrame>
  )
}

export interface EditorValues {
  materialId: string
  reagentInfoId: string
  physicalState: ReagentCreateCommand['physicalState']
  densityGPerMl?: number
  quantity: number
  quantityUnit: string
  concentrationValue?: number
  concentrationUnit?: string
  description?: string
  supplier?: string
  densityCondition?: string
  productionDate?: string
  expiryDate?: string
}

/** 从浏览器 FormData 读取试剂表单值，空数值保持 undefined。 */
function reagentEditorValues(form: FormData): EditorValues {
  const densityGPerMl = optionalNumber(form.get('densityGPerMl'))
  const concentrationValue = optionalNumber(form.get('concentrationValue'))
  const description = textValue(form, 'description')
  const concentrationUnit = textValue(form, 'concentrationUnit')
  const supplier = textValue(form, 'supplier')
  const densityCondition = textValue(form, 'densityCondition')
  const productionDate = textValue(form, 'productionDate')
  const expiryDate = textValue(form, 'expiryDate')
  return {
    materialId: textValue(form, 'materialId'),
    reagentInfoId: textValue(form, 'reagentInfoId'),
    physicalState: (textValue(form, 'physicalState') || 'unknown') as EditorValues['physicalState'],
    ...(densityGPerMl == null ? {} : { densityGPerMl }),
    quantity: Number(form.get('quantity')),
    quantityUnit: textValue(form, 'quantityUnit'),
    ...(concentrationValue == null ? {} : { concentrationValue }),
    ...(concentrationUnit ? { concentrationUnit } : {}),
    ...(description ? { description } : {}),
    ...(supplier ? { supplier } : {}),
    ...(densityCondition ? { densityCondition } : {}),
    ...(productionDate ? { productionDate } : {}),
    ...(expiryDate ? { expiryDate } : {})
  }
}

/**
 * 校验 Backend 试剂创建和更新共同不变量。
 * @param values 规范化后的表单值。
 * @param mode 创建时额外校验容器和既有试剂目录项，编辑时保持既有目录关联。
 * @returns 第一个可行动错误；合法时返回 null。
 */
export function validateReagentEditor(
  values: EditorValues,
  mode: 'create' | 'edit'
): string | null {
  if (mode === 'create' && !values.materialId) return '请选择试剂容器'
  if (mode === 'create' && !values.reagentInfoId) return '请选择试剂名称'
  if (!Number.isFinite(values.quantity) || values.quantity < 0) return '数量必须是大于等于零的有限数'
  if (!values.quantityUnit) return '计量单位不能为空'
  if (mode === 'create' && !REAGENT_QUANTITY_UNITS.some(unit => unit === values.quantityUnit)) {
    return '请选择 Backend 支持的计量单位'
  }
  if (values.densityGPerMl != null && (!Number.isFinite(values.densityGPerMl) || values.densityGPerMl <= 0)) {
    return '密度必须是大于零的有限数'
  }
  if ((values.concentrationValue == null) !== !values.concentrationUnit) {
    return '浓度数值和单位必须同时填写或同时留空'
  }
  if (values.concentrationValue != null && (!Number.isFinite(values.concentrationValue) || values.concentrationValue < 0)) {
    return '浓度必须是大于等于零的有限数'
  }
  if (
    values.productionDate &&
    values.expiryDate &&
    values.expiryDate < values.productionDate
  ) {
    return '截止日期不能早于生产日期'
  }
  return null
}

/** 将已校验表单转换为使用既有试剂目录 UUID 的库存创建命令。 */
export function reagentCreateCommand(
  values: EditorValues,
  customParameters: readonly CustomParameter[]
): ReagentCreateCommand {
  return {
    materialId: values.materialId,
    reagentInfoId: values.reagentInfoId,
    physicalState: values.physicalState,
    ...(values.densityGPerMl == null ? {} : { densityGPerMl: values.densityGPerMl }),
    ...concentrationCommand(values),
    quantity: values.quantity,
    quantityUnit: values.quantityUnit,
    metadata: {
      supplier: values.supplier,
      density_condition: values.densityCondition,
      production_date: values.productionDate,
      expiry_date: values.expiryDate,
      custom_parameters: customParameters
    },
    ...(values.description ? { description: values.description } : {})
  }
}

/** 按名称、条码或稳定 UUID 筛选试剂容器候选。 */
export function filterReagentContainers(
  containers: readonly ReagentContainerOption[],
  query: string
): readonly ReagentContainerOption[] {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  if (!normalized) return containers
  return containers.filter(container => [
    container.name,
    container.barcode,
    container.id
  ].some(value => value?.toLocaleLowerCase('zh-CN').includes(normalized)))
}

/** 将可选浓度投影为成对命令字段。 */
function concentrationCommand(values: EditorValues): Pick<
  ReagentCreateCommand,
  'concentrationValue' | 'concentrationUnit'
> {
  return values.concentrationValue == null || !values.concentrationUnit
    ? {}
    : {
        concentrationValue: values.concentrationValue,
        concentrationUnit: values.concentrationUnit
      }
}

/** 格式化当前权威数量；缺失时保留未知。 */
function formatQuantity(value: number | undefined, unit: string | undefined): string {
  return value == null ? '未知数量' : `${value.toLocaleString('zh-CN')} ${unit ?? ''}`.trim()
}
