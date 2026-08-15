import { useEffect, useRef, useState } from 'react'
import { Button, Input, Textarea } from '@unilab/design-system'

import type {
  CustomParameter,
  ReagentInfoCreateCommand,
  ReagentInfoLookupCandidate,
  ReagentInfoLookupResult,
  ReagentInfoProjection,
  ReagentInfoUpdateCommand,
  ReagentPhysicalState
} from '../types'
import { uiClass } from '../uiClasses'
import styles from '../workstation.module.scss'
import {
  ReagentDialogActions,
  ReagentDialogFrame,
  reagentDialogErrorMessage
} from './ReagentDialogPrimitives'
import { MoleculeStructure2D } from './MoleculeStructure2D'
import { isValidCAS, optionalNumber, textValue } from './reagentFormValues'
import { PhysicalStateSelect } from './PhysicalStateSelect'
import { CustomParameterFields } from './CustomParameterFields'

type EditorProps = {
  onClose: () => void
  onLookup: (cas: string, signal?: AbortSignal) => Promise<ReagentInfoLookupResult>
} & (
  | {
      mode: 'create'
      onSave: (command: ReagentInfoCreateCommand) => Promise<void>
    }
  | {
      mode: 'edit'
      item: ReagentInfoProjection
      onSave: (command: ReagentInfoUpdateCommand) => Promise<void>
    }
)

interface LookupFormFields {
  nameEn: string
  molecularFormula: string
  smiles: string
  inchiKey: string
  molecularWeight: string
}

interface LookupFeedback {
  phase: 'loading' | 'success' | 'warning'
  message: string
  blocksSubmit: boolean
}

/**
 * 手工登记或纠错 Backend 化学品字典身份。
 * @param props 创建/编辑上下文、真实写入回调和关闭回调。
 * @returns 支持可空 CAS、完整化学字段和错误恢复的模态表单。
 */
export function ReagentInfoEditorDialog(props: EditorProps): React.JSX.Element {
  const initial = props.mode === 'edit' ? props.item : undefined
  const initialPhysicalState = normalizePhysicalState(initial?.physicalState)
  const initialCustomParameters = reagentInfoCustomParameters(initial?.metadata)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const errorRef = useRef<HTMLParagraphElement>(null)
  const [cas, setCAS] = useState(initial?.cas ?? '')
  const [lookupFields, setLookupFields] = useState<LookupFormFields>({
    nameEn: initial?.nameEn ?? '',
    molecularFormula: initial?.molecularFormula ?? '',
    smiles: initial?.smiles ?? '',
    inchiKey: initial?.inchiKey ?? '',
    molecularWeight: initial?.molecularWeight == null
      ? ''
      : String(initial.molecularWeight)
  })
  const [lookupFeedback, setLookupFeedback] = useState<LookupFeedback | null>(null)
  const [customParameters, setCustomParameters] = useState<CustomParameter[]>(
    initialCustomParameters
  )
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(initial?.description || initialCustomParameters.length > 0)
  )
  const lastCandidate = useRef<ReagentInfoLookupCandidate | null>(null)

  function reportError(message: string): void {
    setError(message)
    requestAnimationFrame(() => errorRef.current?.focus())
  }

  useEffect(() => {
    const normalizedCAS = cas.trim()
    const initialCAS = initial?.cas?.trim() ?? ''

    /** 清除上一 CAS 自动写入的值，但不覆盖用户随后手工修改的字段。 */
    const clearPreviousCandidate = (): void => {
      if (!lastCandidate.current) return
      const previous = lastCandidate.current
      setLookupFields(current => mergeLookupFields(current, previous, null))
      lastCandidate.current = null
    }

    if (
      !normalizedCAS ||
      !isValidCAS(normalizedCAS) ||
      (props.mode === 'edit' && normalizedCAS === initialCAS)
    ) {
      clearPreviousCandidate()
      setLookupFeedback(null)
      return
    }

    const controller = new AbortController()
    setLookupFeedback({
      phase: 'loading',
      message: '正在通过 Backend 查询 PubChem…',
      blocksSubmit: true
    })
    const timeout = globalThis.setTimeout(() => {
      void props.onLookup(normalizedCAS, controller.signal).then(result => {
        if (controller.signal.aborted) return
        if (result.status === 'ok' && result.compound) {
          const previous = lastCandidate.current
          setLookupFields(current => mergeLookupFields(current, previous, result.compound ?? null))
          lastCandidate.current = result.compound
          setLookupFeedback({
            phase: 'success',
            message: '已从 PubChem 补全可用字段，请核对后保存。',
            blocksSubmit: false
          })
          return
        }
        clearPreviousCandidate()
        setLookupFeedback({
          phase: 'warning',
          message: result.message ?? compoundLookupFallback(result.status),
          blocksSubmit: result.status === 'registered'
        })
      }).catch(lookupError => {
        if (controller.signal.aborted) return
        clearPreviousCandidate()
        setLookupFeedback({
          phase: 'warning',
          message: reagentDialogErrorMessage(
            lookupError,
            'PubChem 查询失败，仍可手工填写化学信息。'
          ),
          blocksSubmit: false
        })
      })
    }, 500)
    return () => {
      globalThis.clearTimeout(timeout)
      controller.abort()
    }
  }, [cas, initial?.cas, props.mode, props.onLookup])

  /** 读取并校验完整化学身份，只向上层提交一次 Backend 命令。 */
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (submitting || lookupFeedback?.phase === 'loading') return
    if (lookupFeedback?.blocksSubmit) {
      reportError(lookupFeedback.message)
      return
    }
    const values = reagentInfoEditorValues(new FormData(event.currentTarget))
    const validationError = validateReagentInfoEditor(values) ?? validateCustomParameters(customParameters)
    if (validationError) {
      reportError(validationError)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const command = reagentInfoCommand(values, initial?.metadata, customParameters)
      if (props.mode === 'create') {
        await props.onSave(command)
      } else {
        await props.onSave({ ...command, id: props.item.id })
      }
    } catch (submitError) {
      reportError(reagentDialogErrorMessage(
        submitError,
        '试剂基础信息保存失败，请检查字段或连接后重试。'
      ))
      setSubmitting(false)
    }
  }

  return (
    <ReagentDialogFrame
      title={props.mode === 'create' ? '新建试剂身份' : `编辑身份 · ${props.item.name}`}
      description={props.mode === 'create'
        ? '输入 CAS 可自动补全化学信息；无 CAS 的自配物质可直接填写名称。'
        : '修改共享化学身份，不会改动库存数量和容器信息。'}
      busy={submitting}
      wide
      onClose={props.onClose}
    >
      <form autoComplete="off" onSubmit={(event) => void handleSubmit(event)}>
        <div className={styles.formRequiredNote}><span aria-hidden="true">*</span> 必填</div>
        {error ? <p ref={errorRef} tabIndex={-1} className={styles.dialogErrorSummary} role="alert">{error}</p> : null}
        <div className={styles.formSections}>
          <fieldset className={styles.formSection}>
            <legend>核心身份</legend>
            <div className={styles.dialogFields}>
              <label>
                <span>CAS 号</span>
                <Input name="cas" value={cas} onChange={event => setCAS(event.target.value)} placeholder="例如 64-17-5" maxLength={64} data-dialog-initial-focus />
                <small className={styles.lookupFeedback} data-phase={lookupFeedback?.phase ?? 'idle'} aria-live="polite">
                  {lookupFeedback?.message ?? '有效 CAS 会自动补全化学信息；自配物质可留空。'}
                </small>
              </label>
              <label>
                <span>试剂名称 <b aria-hidden="true">*</b></span>
                <Input
                  name="chemicalIdentityName"
                  defaultValue={initial?.name ?? ''}
                  maxLength={255}
                  required
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label>
                <span>英文名称</span>
                <Input name="nameEn" value={lookupFields.nameEn} onChange={event => setLookupFields(current => ({ ...current, nameEn: event.target.value }))} maxLength={255} />
              </label>
              <label>
                <span>别名</span>
                <Input name="aliases" defaultValue={initial?.aliases.join('，') ?? ''} placeholder="多个别名用逗号分隔" />
              </label>
            </div>
          </fieldset>

          <fieldset className={styles.formSection}>
            <legend>
              化学信息
              {lookupFeedback?.phase === 'success' ? <small>PubChem 已补全</small> : null}
            </legend>
            <div className={styles.dialogFields}>
              <label>
                <span>分子式</span>
                <Input name="molecularFormula" value={lookupFields.molecularFormula} onChange={event => setLookupFields(current => ({ ...current, molecularFormula: event.target.value }))} />
              </label>
              <label>
                <span>分子量（g/mol）</span>
                <Input name="molecularWeight" type="number" min="0" step="any" inputMode="decimal" value={lookupFields.molecularWeight} onChange={event => setLookupFields(current => ({ ...current, molecularWeight: event.target.value }))} />
              </label>
              <label>
                <span>SMILES</span>
                <Input name="smiles" className={uiClass.mono} value={lookupFields.smiles} onChange={event => setLookupFields(current => ({ ...current, smiles: event.target.value }))} />
              </label>
              <div className={styles.structurePreviewField}>
                <span>2D 结构</span>
                <MoleculeStructure2D name={initial?.name ?? '当前试剂'} smiles={lookupFields.smiles} />
              </div>
              <input type="hidden" name="inchiKey" value={lookupFields.inchiKey} />
            </div>
          </fieldset>

          <fieldset className={styles.formSection}>
            <legend>物理属性</legend>
            <div className={styles.dialogFields}>
              <label>
                <span>常温物态</span>
                <PhysicalStateSelect name="physicalState" defaultValue={initialPhysicalState} />
              </label>
              <label>
                <span>参考密度（g/mL）</span>
                <Input name="densityGPerMl" type="number" min="0" step="any" inputMode="decimal" defaultValue={initial?.densityGPerMl ?? ''} />
              </label>
            </div>
          </fieldset>

          <details
            className={styles.formAdvanced}
            open={advancedOpen}
            onToggle={event => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary>更多信息</summary>
            <div className={styles.dialogFields}>
              <label className={styles.dialogFieldWide}>
                <span>说明</span>
                <Textarea name="description" rows={3} maxLength={1000} defaultValue={initial?.description ?? ''} />
              </label>
            </div>
            <CustomParameterFields value={customParameters} onChange={setCustomParameters} />
          </details>
        </div>
        <ReagentDialogActions
          onClose={props.onClose}
          submitLabel={submitting ? '正在保存…' : props.mode === 'create' ? '创建身份' : '保存修改'}
          disabled={submitting || lookupFeedback?.phase === 'loading' || Boolean(lookupFeedback?.blocksSubmit)}
          cancelDisabled={submitting}
        />
      </form>
    </ReagentDialogFrame>
  )
}

/**
 * 对化学品字典删除提供历史引用边界说明和文字确认。
 * @param props 待删除身份、异步删除回调和关闭回调。
 * @returns 只有输入“删除”后才可提交的危险操作模态框。
 */
export function ReagentInfoDeleteDialog({
  item,
  onDelete,
  onClose
}: {
  item: ReagentInfoProjection
  onDelete: () => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const [confirmation, setConfirmation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  /** 请求 Backend 删除误建身份，引用冲突时保留对话框和原始错误。 */
  async function handleDelete(): Promise<void> {
    if (submitting || confirmation !== '删除') return
    setSubmitting(true)
    setError('')
    try {
      await onDelete()
    } catch (deleteError) {
      setError(reagentDialogErrorMessage(
        deleteError,
        '试剂基础信息删除失败，请刷新后重试。'
      ))
      setSubmitting(false)
    }
  }

  return (
    <ReagentDialogFrame
      title={`删除 ${item.name}`}
      description="仅从未被库存、仓库或工作流历史引用的误建化学身份可以删除；有关联记录时 Backend 会拒绝并保留审计身份。"
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
          {submitting ? '正在删除…' : '确认删除身份'}
        </Button>
      </div>
    </ReagentDialogFrame>
  )
}

export interface ReagentInfoEditorValues extends ReagentInfoCreateCommand {}

/**
 * 合并一次 PubChem 候选值，只替换空字段或上一轮自动填充值。
 * @param current 当前表单字段。
 * @param previous 上一 CAS 自动填入的候选值。
 * @param next 当前 CAS 的新候选值；null 表示清除上一轮自动补全。
 * @returns 保留用户手工编辑并同步隐藏 InChIKey 的表单字段。
 */
export function mergeLookupFields(
  current: LookupFormFields,
  previous: ReagentInfoLookupCandidate | null,
  next: ReagentInfoLookupCandidate | null
): LookupFormFields {
  return {
    nameEn: replaceAutoFilledValue(current.nameEn, previous?.name, next?.name),
    molecularFormula: replaceAutoFilledValue(
      current.molecularFormula,
      previous?.molecularFormula,
      next?.molecularFormula
    ),
    smiles: replaceAutoFilledValue(current.smiles, previous?.smiles, next?.smiles),
    inchiKey: next?.inchiKey ?? '',
    molecularWeight: replaceAutoFilledValue(
      current.molecularWeight,
      numberText(previous?.molecularWeight),
      numberText(next?.molecularWeight)
    )
  }
}

/** 已登记 CAS 阻止重复创建；其他降级状态仍允许用户手工录入。 */
function compoundLookupFallback(status: ReagentInfoLookupResult['status']): string {
  if (status === 'registered') return '该 CAS 已登记，请直接选择现有试剂身份。'
  if (status === 'not_found') return 'PubChem 未收录该 CAS，请手工填写化学信息。'
  return 'PubChem 暂时不可用，请手工填写化学信息。'
}

/** 只有空值或未被用户改写的自动值才跟随新候选更新。 */
function replaceAutoFilledValue(
  current: string,
  previous: string | undefined,
  next: string | undefined
): string {
  return !current.trim() || (previous != null && current === previous)
    ? next ?? ''
    : current
}

/** 把可选分子量转换为 number 输入使用的稳定文本。 */
function numberText(value: number | undefined): string | undefined {
  return value == null ? undefined : String(value)
}

/**
 * 校验 Backend 化学品字典的当前必填项、CAS 校验位与正数参考属性。
 * @param values 已规范化的完整表单值。
 * @returns 第一个可行动错误；合法时返回 null。
 */
export function validateReagentInfoEditor(
  values: ReagentInfoEditorValues
): string | null {
  if (!values.name) return '试剂名称不能为空'
  if (values.cas && !isValidCAS(values.cas)) return 'CAS 号校验位不正确，请修正或留空'
  if (!isPhysicalState(values.physicalState)) return '请选择有效的常温物态'
  if (values.molecularWeight != null && (
    !Number.isFinite(values.molecularWeight) || values.molecularWeight <= 0
  )) return '分子量必须是大于零的有限数'
  if (values.densityGPerMl != null && (
    !Number.isFinite(values.densityGPerMl) || values.densityGPerMl <= 0
  )) return '参考密度必须是大于零的有限数'
  return null
}

/**
 * 从浏览器表单读取完整化学身份，空白可空字段保持 undefined。
 * @param form 浏览器 FormData。
 * @returns 已去空白、去重别名并保留可空语义的表单值。
 */
function reagentInfoEditorValues(form: FormData): ReagentInfoEditorValues {
  const aliases = [...new Set(textValue(form, 'aliases').split(/[,，;；\n]/)
    .map(alias => alias.trim()).filter(Boolean))]
  const physicalState = textValue(form, 'physicalState') as ReagentPhysicalState
  return {
    name: textValue(form, 'chemicalIdentityName'),
    aliases,
    physicalState,
    ...optionalTextCommand('nameEn', textValue(form, 'nameEn')),
    ...optionalTextCommand('cas', textValue(form, 'cas')),
    ...optionalTextCommand('molecularFormula', textValue(form, 'molecularFormula')),
    ...optionalTextCommand('smiles', textValue(form, 'smiles')),
    ...optionalTextCommand('inchiKey', textValue(form, 'inchiKey')),
    ...optionalNumberCommand('molecularWeight', optionalNumber(form.get('molecularWeight'))),
    ...optionalNumberCommand('densityGPerMl', optionalNumber(form.get('densityGPerMl'))),
    ...optionalTextCommand('description', textValue(form, 'description'))
  }
}

/**
 * 把表单值投影为写命令，并在编辑时原样保留不可见的 Backend 元数据。
 * @param values 已校验表单值。
 * @param metadata 既有权威元数据；创建时为空。
 * @returns 可交给 Workbench 数据适配层的创建命令。
 */
function reagentInfoCommand(
  values: ReagentInfoEditorValues,
  metadata: Record<string, unknown> | undefined,
  customParameters: readonly CustomParameter[]
): ReagentInfoCreateCommand {
  const nextMetadata = mergeReagentInfoMetadata(metadata, customParameters)
  return { ...values, ...(nextMetadata ? { metadata: nextMetadata } : {}) }
}

/** 从身份元数据中读取前端约定的名称/值扩展字段。 */
export function reagentInfoCustomParameters(
  metadata?: Record<string, unknown>
): CustomParameter[] {
  if (!Array.isArray(metadata?.custom_parameters)) return []
  return metadata.custom_parameters.flatMap(parameter => {
    if (!isRecord(parameter)) return []
    const name = typeof parameter.name === 'string' ? parameter.name.trim() : ''
    const value = typeof parameter.value === 'string' ? parameter.value.trim() : ''
    return name && value ? [{ name, value }] : []
  })
}

/** 保留 Backend 其他元数据，只更新自定义参数命名空间。 */
export function mergeReagentInfoMetadata(
  metadata: Record<string, unknown> | undefined,
  customParameters: readonly CustomParameter[]
): Record<string, unknown> | undefined {
  const nextMetadata = { ...(metadata ?? {}) }
  const normalizedParameters = customParameters.map(parameter => ({
    name: parameter.name.trim(),
    value: parameter.value.trim()
  })).filter(parameter => parameter.name && parameter.value)
  if (normalizedParameters.length > 0) nextMetadata.custom_parameters = normalizedParameters
  else delete nextMetadata.custom_parameters
  return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined
}

/** 确保扩展字段完整且名称唯一，避免后续展示出现含糊的重复键。 */
export function validateCustomParameters(
  customParameters: readonly CustomParameter[]
): string | null {
  const names = new Set<string>()
  for (const parameter of customParameters) {
    const name = parameter.name.trim()
    const value = parameter.value.trim()
    if (!name || !value) return '自定义参数的名称和值都不能为空'
    const normalizedName = name.toLocaleLowerCase('zh-CN')
    if (names.has(normalizedName)) return `自定义参数名称“${name}”重复`
    names.add(normalizedName)
  }
  return null
}

/** 判断未信任元数据元素是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把非空文本映射到类型安全的可选命令字段。 */
function optionalTextCommand<Key extends keyof ReagentInfoCreateCommand>(
  key: Key,
  value: string
): Partial<Pick<ReagentInfoCreateCommand, Key>> {
  return value ? { [key]: value } as Partial<Pick<ReagentInfoCreateCommand, Key>> : {}
}

/** 把存在的数值映射到类型安全的可选命令字段。 */
function optionalNumberCommand<Key extends 'molecularWeight' | 'densityGPerMl'>(
  key: Key,
  value: number | undefined
): Partial<Pick<ReagentInfoCreateCommand, Key>> {
  return value == null ? {} : { [key]: value } as Pick<ReagentInfoCreateCommand, Key>
}

/** 判断未信任表单值是否属于 Backend 当前物态闭集。 */
function isPhysicalState(value: string): value is ReagentPhysicalState {
  return value === 'solid' || value === 'liquid' || value === 'gas' || value === 'unknown'
}

/** 将 Backend 可能扩展的物态值收敛为当前编辑器支持的闭集。 */
function normalizePhysicalState(value: string | undefined): ReagentPhysicalState {
  return value && isPhysicalState(value) ? value : 'unknown'
}
