import { useEffect, useRef, useState } from 'react'
import type { DeviceAction } from '@unilab/services'

import { shortIdentifier } from './devicePanelFormat'
import { deviceClass } from './deviceStyles'

export interface UnlockIntent {
  deviceId: string
  deviceName: string
  actionName: string
  actionRef: string
  actionLabel: string
  expectedJobId: string
}

export interface UnlockOperation {
  actionRef: string
  state: 'pending' | 'success' | 'error'
  message: string
}

export function DeviceLockControl({
  action,
  canForceUnlock,
  operation,
  onRequestUnlock
}: {
  action: DeviceAction
  canForceUnlock: boolean
  operation: UnlockOperation | null
  onRequestUnlock: () => void
}): React.JSX.Element | null {
  const currentOperation = operation?.actionRef === action.actionRef
    ? operation
    : null
  if (!action.isBusy) {
    return currentOperation?.state === 'success' ? (
      <div
        className={deviceClass('edge-device__lock-result is-success')}
        role="status"
      >
        <strong>动作锁已释放</strong>
        <span>{currentOperation.message}</span>
      </div>
    ) : null
  }

  const pending = currentOperation?.state === 'pending'
  return (
    <div className={deviceClass('edge-device__lock-panel')} aria-label="设备动作锁状态">
      <div className={deviceClass('edge-device__lock-copy')}>
        <span className={deviceClass('edge-device__lock-icon')} aria-hidden="true">
          <LockIcon />
        </span>
        <div>
          <strong>此动作被设备锁占用</strong>
          <p>
            {action.currentJobId
              ? '锁持有者已确认；请先核对关联运行，再决定是否手动解锁。'
              : '锁持有者信息缺失。为避免误释放新任务，当前只允许刷新设备状态。'}
          </p>
          {action.currentJobId ? (
            <code title={action.currentJobId}>
              Job {shortIdentifier(action.currentJobId)}
            </code>
          ) : null}
        </div>
      </div>
      {canForceUnlock && action.currentJobId ? (
        <button
          type="button"
          className={deviceClass('edge-device__unlock-button')}
          disabled={pending}
          onClick={onRequestUnlock}
        >
          {pending ? '正在解锁…' : '手动解锁'}
        </button>
      ) : null}
      {currentOperation ? (
        <div
          className={deviceClass('edge-device__lock-result', `is-${currentOperation.state}`)}
          role={currentOperation.state === 'error' ? 'alert' : 'status'}
        >
          <span>{currentOperation.message}</span>
        </div>
      ) : null}
    </div>
  )
}

export function UnlockConfirmationDialog({
  intent,
  operation,
  onCancel,
  onConfirm
}: {
  intent: UnlockIntent
  operation: UnlockOperation | null
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const [confirmed, setConfirmed] = useState(false)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const currentOperation = operation?.actionRef === intent.actionRef
    ? operation
    : null
  const pending = currentOperation?.state === 'pending'

  useEffect(() => {
    setConfirmed(false)
    confirmationRef.current?.focus()
  }, [intent.actionRef, intent.expectedJobId])

  return (
    <div
      className={deviceClass('edge-device__unlock-layer')}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) onCancel()
      }}
    >
      <section
        className={deviceClass('edge-device__unlock-dialog')}
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-unlock-title"
        aria-describedby="device-unlock-description"
      >
        <header>
          <span className={deviceClass('edge-device__unlock-dialog-icon')} aria-hidden="true">
            <LockIcon />
          </span>
          <div>
            <h2 id="device-unlock-title">确认手动解锁</h2>
            <p>{intent.deviceName} · {intent.actionLabel}</p>
          </div>
        </header>
        <div className={deviceClass('edge-device__unlock-dialog-body')}>
          <p id="device-unlock-description">
            手动解锁不会证明物理动作已自然结束。OS 会请求取消当前动作，
            并释放该 Action 的当前与排队 Job。
          </p>
          <div className={deviceClass('edge-device__unlock-warning')} role="note">
            只有在现场确认设备已经停止、无人仍在操作、相关工作流不会继续下发动作时，
            才能继续。
          </div>
          <dl>
            <div>
              <dt>Action</dt>
              <dd><code>{intent.actionRef}</code></dd>
            </div>
            <div>
              <dt>当前 holder</dt>
              <dd><code>{intent.expectedJobId}</code></dd>
            </div>
          </dl>
          <label className={deviceClass('edge-device__unlock-confirmation')}>
            <input
              ref={confirmationRef}
              type="checkbox"
              checked={confirmed}
              disabled={pending}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>我已确认设备处于安全状态，并理解此操作会取消关联 Job。</span>
          </label>
          {currentOperation?.state === 'error' ? (
            <p className={deviceClass('edge-device__unlock-dialog-error')} role="alert">
              {currentOperation.message}。请刷新设备状态，确认 holder 后再重试。
            </p>
          ) : null}
        </div>
        <footer>
          <button
            type="button"
            className={deviceClass('edge-device__unlock-cancel')}
            disabled={pending}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className={deviceClass('edge-device__unlock-confirm')}
            disabled={!confirmed || pending}
            onClick={onConfirm}
          >
            {pending ? '正在请求 OS…' : '确认并解锁'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function LockIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14v2" />
    </svg>
  )
}
