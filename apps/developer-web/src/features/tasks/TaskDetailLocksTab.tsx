import { clsx } from 'clsx'
import type { WorkflowExecutionLockFact, WorkflowRecoveryFact } from '@unilab-fe/core'
import taskDetailInspectorStyles from './TaskDetailInspector.module.scss'
import taskDetailStyles from './taskDetail.module.scss'
import { DebugIcon } from './TaskDetailIcons'

export function LocksTab({
  locks,
  recovery,
}: {
  locks: readonly WorkflowExecutionLockFact[]
  recovery?: WorkflowRecoveryFact
}) {
  const canRelease =
    locks.length > 0 &&
    locks.every((lock) => lock.canRelease === true) &&
    !recovery?.requiresReconciliation
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-tab-content'])}>
      <div
        className={clsx(
          taskDetailInspectorStyles['debug-lock-guard'],
          canRelease ? taskDetailInspectorStyles['is-ready'] : '',
        )}
      >
        <div className={clsx(taskDetailInspectorStyles['debug-lock-guard-head'])}>
          <DebugIcon name={canRelease ? 'unlock' : 'shield-alert'} size={18} />
          <div>
            <strong>{canRelease ? '可释放执行锁' : '当前不可直接释放执行锁'}</strong>
          </div>
        </div>
      </div>
      <div className={clsx(taskDetailInspectorStyles['debug-lock-group'])}>
        {locks.length === 0 ? (
          <div
            className={clsx(
              taskDetailInspectorStyles['debug-empty-state'],
              taskDetailInspectorStyles['debug-lock-empty-state'],
            )}
          >
            暂无执行锁快照。
          </div>
        ) : (
          locks.map((lock, index) => (
            <LockRow
              key={`${lock.lockUuid ?? 'lock'}-${index}`}
              title={lock.lockKey ?? lock.lockUuid ?? '未命名锁'}
              scope={lock.scope ?? '未知范围'}
              state={
                lock.state === 'uncertain'
                  ? '状态不明'
                  : lock.canRelease === true
                    ? '可释放'
                    : lock.state
              }
            />
          ))
        )}
      </div>
      <div className={clsx(taskDetailInspectorStyles['debug-lock-actions'])}>
        <button
          type="button"
          className={clsx(taskDetailStyles['debug-danger-outline-button'])}
          disabled
        >
          <DebugIcon name="unlock" size={15} /> 人工解除整组锁
        </button>
      </div>
    </div>
  )
}

function LockRow({ title, scope, state }: { title: string; scope: string; state: string }) {
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-lock-row'])}>
      <span>
        <strong>{title}</strong>
        <small>{scope}</small>
      </span>
      <span
        className={clsx(
          state === '可释放'
            ? taskDetailInspectorStyles['lock-ready']
            : state === '状态不明'
              ? taskDetailInspectorStyles['lock-unknown']
              : taskDetailInspectorStyles['lock-held'],
        )}
      >
        <span className={clsx(taskDetailStyles['debug-state-dot'])} />
        {state}
      </span>
    </div>
  )
}
