import { clsx } from 'clsx'
import runStyles from '../run.module.scss'
import sharedStyles from '../shared.module.scss'
import { Icon } from '@unilab/design-v2/icons'
import type { PreflightCheckStatus, PreflightReport } from '@unilab-fe/core'

export interface PreflightReportViewProps {
  readonly report: PreflightReport
}

/** 后端 preflight 权威结果的展示，不根据 HTTP 接受结果推断运行状态。 */
export function PreflightReportView({ report }: PreflightReportViewProps) {
  const groups = groupChecks(report.checks)

  return (
    <section
      className={clsx(
        runStyles['lab-ui-preflight'],
        runStyles[`lab-ui-preflight--${report.status}`],
      )}
      aria-label="运行前检查"
    >
      <header className={clsx(runStyles['lab-ui-preflight__header'])}>
        <h2>运行前检查</h2>
      </header>
      {report.checks.length === 0 ? (
        <p className={clsx(sharedStyles['lab-ui-list-empty'])}>后端没有返回检查项。</p>
      ) : (
        <div className={clsx(runStyles['lab-ui-preflight__groups'])}>
          {groups.map((group) => (
            <details
              className={clsx(
                runStyles['lab-ui-preflight__group'],
                runStyles[`is-${group.status}`],
              )}
              key={group.status}
              open={group.status === 'blocked' || group.status === 'confirmation_required'}
            >
              <summary>
                <span>{group.title}</span>
                <span
                  className={clsx(
                    runStyles['lab-ui-preflight__tag'],
                    runStyles[`is-${group.status}`],
                  )}
                >
                  {group.checks.length}
                </span>
              </summary>
              <ul className={clsx(runStyles['lab-ui-preflight__list'])}>
                {group.checks.map((check, index) => (
                  <PreflightCheckItem
                    key={`${check.code}-${check.nodeUuid ?? 'global'}-${index}`}
                    check={check}
                  />
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
      {!report.canRun && (
        <div className={clsx(runStyles['lab-ui-preflight__alert'])} role="alert">
          <Icon name="alerts-feedback/alert-circle" color="error" size={16} decorative />
          <div>
            <strong>当前不能提交</strong>
            <p>请先处理运行前检查中的阻塞项。</p>
          </div>
        </div>
      )}
    </section>
  )
}

function PreflightCheckItem({ check }: { readonly check: PreflightReport['checks'][number] }) {
  return (
    <li className={clsx(runStyles[`is-${check.status}`])}>
      <span className={clsx(runStyles['lab-ui-preflight__indicator'])} aria-hidden="true" />
      <div>
        <strong>{check.message}</strong>
        <small>
          {check.code}
          {check.nodeName ? ` · ${check.nodeName}` : ''}
        </small>
      </div>
      <span
        className={clsx(runStyles['lab-ui-preflight__status-tag'], runStyles[`is-${check.status}`])}
      >
        {checkStatusLabel(check.status)}
      </span>
    </li>
  )
}

const preflightGroups: ReadonlyArray<{
  readonly status: PreflightCheckStatus
  readonly title: string
}> = [
  { status: 'blocked', title: '阻塞项' },
  { status: 'confirmation_required', title: '待确认' },
  { status: 'deferred', title: '待复核' },
  { status: 'passed', title: '已通过' },
]

function groupChecks(checks: PreflightReport['checks']) {
  return preflightGroups
    .map((group) => ({
      ...group,
      checks: checks.filter((check) => check.status === group.status),
    }))
    .filter((group) => group.checks.length > 0)
}

function checkStatusLabel(status: PreflightCheckStatus): string {
  if (status === 'passed') return '已通过'
  if (status === 'blocked') return '已阻塞'
  if (status === 'deferred') return '待复核'
  return '待确认'
}
