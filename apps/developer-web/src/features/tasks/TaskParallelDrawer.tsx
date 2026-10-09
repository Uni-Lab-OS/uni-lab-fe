import { clsx } from 'clsx'
import taskDetailInspectorStyles from './TaskDetailInspector.module.scss'
import taskParallelDrawerStyles from './TaskParallelDrawer.module.scss'
import taskDetailStyles from './taskDetail.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import { Fragment } from 'react'
import type {
  WorkflowJoinFact,
  WorkflowReadyFrontierCandidate,
  WorkflowTaskCommandLifecycle,
} from '@unilab-fe/core'

import { DebugIcon } from './TaskDetailIcons'
import type { BranchId } from './taskDetailModel'

export function ParallelDrawer({
  candidates,
  joins,
  selectedBranch,
  submittedNodeUuid,
  submittedLifecycle,
  notice,
  onSelect,
  onSubmit,
  onClose,
}: {
  candidates: readonly WorkflowReadyFrontierCandidate[]
  joins: readonly WorkflowJoinFact[]
  selectedBranch: BranchId | null
  submittedNodeUuid: string | null
  submittedLifecycle: WorkflowTaskCommandLifecycle | null
  notice: string
  onSelect: (branch: BranchId) => void
  onSubmit: () => void
  onClose: () => void
}) {
  const branchCard = (candidate: WorkflowReadyFrontierCandidate) => {
    const id = candidate.branchUuid ?? candidate.nodeUuid
    const selected = selectedBranch === id
    const submitted = submittedNodeUuid === candidate.nodeUuid
    const lifecycleLabel =
      submittedLifecycle === 'accepted'
        ? '命令已接受'
        : submittedLifecycle === 'applied'
          ? '命令已生效'
          : submittedLifecycle === 'rejected'
            ? '命令已拒绝'
            : '命令状态未知'
    return (
      <button
        type="button"
        className={clsx(
          taskParallelDrawerStyles['debug-branch-card'],
          selected
            ? clsx(
                taskDetailInspectorStyles['is-selected'],
                taskParallelDrawerStyles['is-selected'],
                appShellStyles['is-selected'],
              )
            : '',
          submitted ? taskParallelDrawerStyles['is-submitted'] : '',
        )}
        onClick={() => onSelect(id)}
      >
        <span className={clsx(taskParallelDrawerStyles['debug-branch-card-icon'])}>
          <DebugIcon name="git-branch" size={18} />
        </span>
        <span className={clsx(taskParallelDrawerStyles['debug-branch-card-body'])}>
          <span className={clsx(taskParallelDrawerStyles['debug-branch-card-head'])}>
            <strong>{candidate.label ?? candidate.nodeUuid}</strong>
            <span
              className={clsx(
                taskDetailInspectorStyles['debug-branch-state'],
                taskParallelDrawerStyles['debug-branch-state'],
                submitted
                  ? taskParallelDrawerStyles['is-submitted']
                  : candidate.selectable
                    ? taskDetailInspectorStyles['is-ready']
                    : 'is-blocked',
              )}
            >
              {submitted ? lifecycleLabel : candidate.selectable ? '可选择' : '不可选择'}
            </span>
          </span>
          <span className={clsx(taskParallelDrawerStyles['debug-branch-node'])}>
            node {candidate.nodeUuid}
          </span>
          <span className={clsx(taskParallelDrawerStyles['debug-branch-detail'])}>
            {candidate.blockedBy.join(' · ') ||
              candidate.waitReason.reason?.toString() ||
              'OS 未提供阻塞原因'}
          </span>
        </span>
        <span className={clsx(taskParallelDrawerStyles['debug-branch-card-check'])}>
          {selected ? (
            <DebugIcon name="check-circle" size={18} />
          ) : (
            <span className={clsx(taskParallelDrawerStyles['debug-radio'])} />
          )}
        </span>
      </button>
    )
  }
  const join = joins[0]
  return (
    <div className={clsx(taskDetailStyles['debug-drawer-backdrop'])} onClick={onClose}>
      <aside
        className={clsx(taskParallelDrawerStyles['debug-parallel-drawer'])}
        onClick={(event) => event.stopPropagation()}
        aria-label="并行分支选择"
      >
        <div className={clsx(taskDetailStyles['debug-inspector-head'])}>
          <h2>选择分支</h2>
          <button
            type="button"
            className={clsx(taskDetailStyles['debug-icon-button'])}
            aria-label="关闭并行分支"
            onClick={onClose}
          >
            <DebugIcon name="x" size={18} />
          </button>
        </div>
        <div className={clsx(taskParallelDrawerStyles['debug-parallel-summary'])}>
          <span>
            <DebugIcon name="git-branch" size={16} /> {candidates.length} 个候选
          </span>
          <span>
            <b>{candidates.filter((candidate) => candidate.selectable).length}</b> 个可选择
          </span>
          <span className={clsx(taskParallelDrawerStyles['debug-parallel-join'])}>
            <DebugIcon name="lock" size={14} /> {join?.ready ? 'Join 已满足' : 'Join 等待前置条件'}
          </span>
        </div>
        <div className={clsx(taskParallelDrawerStyles['debug-parallel-body'])}>
          <div className={clsx(taskParallelDrawerStyles['debug-parallel-section'])}>
            <div
              className={clsx(
                taskDetailStyles['debug-detail-section-head'],
                taskParallelDrawerStyles['debug-parallel-section-title'],
              )}
            >
              <h3>选择下一步</h3>
            </div>
            <div className={clsx(taskParallelDrawerStyles['debug-branch-list'])}>
              {candidates.map((candidate) => (
                <Fragment key={candidate.nodeUuid}>{branchCard(candidate)}</Fragment>
              ))}
            </div>
            <div className={clsx(taskParallelDrawerStyles['debug-selection-note'])}>
              <DebugIcon name="info" size={15} />
              <span>{notice}</span>
            </div>
            <button
              type="button"
              className={clsx(
                taskDetailStyles['debug-primary-button'],
                taskParallelDrawerStyles['debug-submit-branch'],
              )}
              disabled={
                !selectedBranch ||
                !candidates.some(
                  (candidate) =>
                    (candidate.branchUuid ?? candidate.nodeUuid) === selectedBranch &&
                    candidate.selectable,
                )
              }
              onClick={onSubmit}
            >
              <DebugIcon name="skip-forward" size={16} /> 执行选中节点
            </button>
          </div>
          <div className={clsx(taskParallelDrawerStyles['debug-parallel-section'])}>
            <div
              className={clsx(
                taskDetailStyles['debug-detail-section-head'],
                taskParallelDrawerStyles['debug-parallel-section-title'],
              )}
            >
              <h3>汇合条件</h3>
            </div>
            <div className={clsx(taskParallelDrawerStyles['debug-join-checks'])}>
              {join ? (
                <>
                  {join.requiredBranchUuids.map((branch) => (
                    <span key={branch}>
                      <DebugIcon
                        name={
                          join.satisfiedBranchUuids.includes(branch)
                            ? 'check-circle'
                            : 'minus-circle'
                        }
                        size={15}
                      />{' '}
                      {branch}
                    </span>
                  ))}
                  {join.missingConditions.map((condition) => (
                    <span key={condition}>
                      <DebugIcon name="minus-circle" size={15} /> {condition}
                    </span>
                  ))}
                </>
              ) : (
                <span>
                  <DebugIcon name="info" size={15} /> 未提供 Join 准入事实
                </span>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
