import { Button, Input } from '@unilab/design-system'
import { useMemo, useRef, useState } from 'react'

import type {
  ReagentContainerOption,
  ReagentDispenseCommand,
  ReagentInventoryProjection
} from '../types'
import { uiClass } from '../uiClasses'
import { WorkstationIcon } from '../WorkstationIcon'
import styles from '../workstation.module.scss'
import { ContainerSearchSelect } from './BackendReagentDialogs'
import { ReagentDialogActions, ReagentDialogFrame } from './ReagentDialogPrimitives'

interface DispenseTargetDraft {
  key: number
  materialId: string
  quantity: string
}

export interface ReagentDispenseValues {
  commandId: string
  sourceReagentId: string
  sourceMaterialId?: string
  expectedRevision?: number
  quantityUnit?: string
  availableQuantity?: number
  targets: readonly {
    materialId: string
    quantity: number
  }[]
  reason?: string
}

/**
 * 把一瓶试剂原子地分装到一个或多个空容器；前端只收集命令，不乐观改写库存。
 */
export function BackendReagentDispenseDialog({
  item,
  containers,
  occupiedMaterialIds,
  onSave,
  onClose
}: {
  item: ReagentInventoryProjection
  containers: readonly ReagentContainerOption[]
  occupiedMaterialIds: ReadonlySet<string>
  onSave: (command: ReagentDispenseCommand) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const commandIdRef = useRef(createDispenseCommandId())
  const nextTargetKey = useRef(2)
  const [targets, setTargets] = useState<DispenseTargetDraft[]>([
    { key: 1, materialId: '', quantity: '' }
  ])
  const [reason, setReason] = useState('分装')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const errorRef = useRef<HTMLParagraphElement>(null)
  const availableQuantity = item.availableQuantity ?? item.totalQuantity
  const emptyContainers = useMemo(
    () => containers.filter(container =>
      container.id !== item.materialId && !occupiedMaterialIds.has(container.id)
    ),
    [containers, item.materialId, occupiedMaterialIds]
  )

  function updateTarget(key: number, patch: Partial<DispenseTargetDraft>): void {
    setTargets(current => current.map(target =>
      target.key === key ? { ...target, ...patch } : target
    ))
  }

  function addTarget(): void {
    setTargets(current => [
      ...current,
      { key: nextTargetKey.current++, materialId: '', quantity: '' }
    ])
  }

  function removeTarget(key: number): void {
    setTargets(current => current.filter(target => target.key !== key))
  }

  function reportError(message: string): void {
    setError(message)
    requestAnimationFrame(() => errorRef.current?.focus())
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (submitting) return
    const values: ReagentDispenseValues = {
      commandId: commandIdRef.current,
      sourceReagentId: item.id,
      ...(item.materialId ? { sourceMaterialId: item.materialId } : {}),
      ...(item.revision == null ? {} : { expectedRevision: item.revision }),
      ...(item.unit ? { quantityUnit: item.unit } : {}),
      ...(availableQuantity == null ? {} : { availableQuantity }),
      targets: targets.map(target => ({
        materialId: target.materialId,
        quantity: Number(target.quantity)
      })),
      ...(reason.trim() ? { reason: reason.trim() } : {})
    }
    const validationError = validateReagentDispense(values)
    if (validationError) {
      reportError(validationError)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onSave({
        commandId: values.commandId,
        sourceReagentId: values.sourceReagentId,
        expectedRevision: values.expectedRevision!,
        quantityUnit: values.quantityUnit!,
        targets: values.targets,
        ...(values.reason ? { reason: values.reason } : {})
      })
    } catch (submitError) {
      reportError(submitError instanceof Error
        ? submitError.message
        : '试剂分装失败，请检查目标容器和源试剂余量后重试。')
      setSubmitting(false)
    }
  }

  const selectedIds = new Set(targets.map(target => target.materialId).filter(Boolean))
  return (
    <ReagentDialogFrame
      title={`分装试剂 · ${item.name}`}
      description={`从当前容器分装到空试剂容器；成功后由 OS 原子扣减源瓶并建立分装血缘。`}
      busy={submitting}
      wide
      onClose={onClose}
    >
      <form autoComplete="off" onSubmit={(event) => void submit(event)}>
        {error ? (
          <p ref={errorRef} tabIndex={-1} className={styles.dialogErrorSummary} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.formSections}>
          <fieldset className={styles.formSection}>
            <legend>源试剂</legend>
            <dl className={styles.reagentDispenseSummary}>
              <div><dt>试剂</dt><dd>{item.name}</dd></div>
              <div><dt>当前数量</dt><dd>{formatQuantity(item.totalQuantity, item.unit)}</dd></div>
              <div><dt>可分装</dt><dd>{formatQuantity(availableQuantity, item.unit)}</dd></div>
              <div><dt>预留中</dt><dd>{formatQuantity(item.reservedQuantity, item.unit)}</dd></div>
            </dl>
          </fieldset>

          <fieldset className={styles.formSection}>
            <legend>分装目标</legend>
            <div className={styles.reagentDispenseTargets}>
              {targets.map((target, index) => {
                const selectable = emptyContainers.filter(container =>
                  container.id === target.materialId || !selectedIds.has(container.id)
                )
                return (
                  <div key={target.key} className={styles.reagentDispenseTarget}>
                    <div className={styles.reagentContainerField}>
                      <span>目标容器 {index + 1}</span>
                      <ContainerSearchSelect
                        containers={selectable}
                        disabled={submitting || emptyContainers.length === 0}
                        name=""
                        value={target.materialId}
                        onChange={materialId => updateTarget(target.key, { materialId })}
                        initialFocus={index === 0}
                        placeholder="请选择空试剂容器"
                      />
                    </div>
                    <label>
                      <span>分装数量（{item.unit ?? '—'}）</span>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={target.quantity}
                        aria-label={`目标容器 ${index + 1} 分装数量`}
                        onChange={event => updateTarget(target.key, { quantity: event.target.value })}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`移除目标容器 ${index + 1}`}
                      disabled={submitting || targets.length === 1}
                      onClick={() => removeTarget(target.key)}
                    >
                      <WorkstationIcon name="trash" />
                    </Button>
                  </div>
                )
              })}
            </div>
            {emptyContainers.length === 0 ? (
              <p className={uiClass.compactEmptyState}>当前没有可用于分装的空试剂容器。</p>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting || targets.length >= emptyContainers.length}
                onClick={addTarget}
              >
                <WorkstationIcon name="plus" />
                添加目标容器
              </Button>
            )}
          </fieldset>

          <label className={styles.dialogFieldWide}>
            <span>分装原因</span>
            <Input
              value={reason}
              maxLength={255}
              onChange={event => setReason(event.target.value)}
            />
          </label>
        </div>
        <ReagentDialogActions
          onClose={onClose}
          submitLabel="确认分装"
          disabled={submitting || emptyContainers.length === 0}
          cancelDisabled={submitting}
        />
      </form>
    </ReagentDialogFrame>
  )
}

/** 校验源修订、空目标闭集和数量守恒；OS 仍会在事务内再次权威校验。 */
export function validateReagentDispense(values: ReagentDispenseValues): string | null {
  if (!values.commandId.trim()) return '分装命令身份不能为空'
  if (!values.sourceReagentId.trim()) return '源试剂不能为空'
  if (values.expectedRevision == null || !Number.isInteger(values.expectedRevision) || values.expectedRevision < 1) {
    return '源试剂缺少可用于分装的有效修订'
  }
  if (!values.quantityUnit?.trim()) return '源试剂缺少计量单位'
  if (!Number.isFinite(values.availableQuantity) || (values.availableQuantity ?? 0) <= 0) {
    return '源试剂当前没有可分装余量'
  }
  if (values.targets.length === 0) return '请至少添加一个分装目标容器'
  const targetIds = new Set<string>()
  let total = 0
  for (const [index, target] of values.targets.entries()) {
    if (!target.materialId.trim()) return `请选择目标容器 ${index + 1}`
    if (target.materialId === values.sourceMaterialId) return '目标容器不能与源容器相同'
    if (targetIds.has(target.materialId)) return '分装目标容器不能重复'
    targetIds.add(target.materialId)
    if (!Number.isFinite(target.quantity) || target.quantity <= 0) {
      return `目标容器 ${index + 1} 的分装数量必须是大于零的有限数`
    }
    total += target.quantity
  }
  const available = values.availableQuantity!
  if (!Number.isFinite(total) || total > available + Math.max(1e-9, available * 1e-12)) {
    return `分装总量不能超过可用数量 ${available.toLocaleString('zh-CN')} ${values.quantityUnit}`
  }
  return null
}

function createDispenseCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `reagent-dispense-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function formatQuantity(quantity: number | undefined, unit: string | undefined): string {
  return quantity == null || !Number.isFinite(quantity)
    ? '—'
    : `${quantity.toLocaleString('zh-CN')} ${unit ?? ''}`.trim()
}
