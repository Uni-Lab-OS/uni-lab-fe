import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@unilab/design-system'

import { uiClass } from '../uiClasses'
import { WorkstationIcon } from '../WorkstationIcon'
import styles from '../workstation.module.scss'

/**
 * 渲染试剂模块共享模态框，并在提交期间阻止关闭造成操作状态丢失。
 * @param props 标题、说明、忙碌状态、内容和关闭回调。
 * @returns 带焦点约束和可访问名称的模态框。
 */
export function ReagentDialogFrame({
  title,
  description,
  busy,
  wide = false,
  children,
  onClose
}: {
  title: string
  description: string
  busy: boolean
  wide?: boolean
  children: React.ReactNode
  onClose: () => void
}): React.JSX.Element {
  /** 只在没有写请求进行时接受 Radix 发出的关闭状态。 */
  function handleOpenChange(open: boolean): void {
    if (!open && !busy) onClose()
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        className={`${styles.formDialog} ${wide ? styles.formDialogWide : ''}`}
        aria-busy={busy}
        showCloseButton={false}
        portalled={false}
      >
        <div className={uiClass.panelHeader}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" disabled={busy} aria-label="关闭">
              <WorkstationIcon name="close" />
            </Button>
          </DialogClose>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/**
 * 渲染试剂表单共享的取消与提交动作。
 * @param props 关闭回调、提交文案和禁用状态。
 * @returns 固定在表单末尾的操作区。
 */
export function ReagentDialogActions({
  onClose,
  submitLabel,
  disabled,
  cancelDisabled = false
}: {
  onClose: () => void
  submitLabel: string
  disabled: boolean
  cancelDisabled?: boolean
}): React.JSX.Element {
  return (
    <div className={uiClass.dialogActions}>
      <Button variant="outline" disabled={cancelDisabled} onClick={onClose}>取消</Button>
      <Button type="submit" disabled={disabled}>{submitLabel}</Button>
    </div>
  )
}

/**
 * 把未知写入异常转换为可行动中文错误，同时保留 Backend 原始消息。
 * @param error 未信任异常。
 * @param fallback 没有可读消息时使用的提示。
 * @returns 可以直接展示给用户的错误文案。
 */
export function reagentDialogErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
