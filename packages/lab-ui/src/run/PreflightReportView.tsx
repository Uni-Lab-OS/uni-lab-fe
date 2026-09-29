import type { PreflightCheckStatus, PreflightReport } from '@unilab-fe/core'

export interface PreflightReportViewProps {
  readonly report: PreflightReport
}

/** 后端 preflight 权威结果的展示，不根据 HTTP 接受结果推断运行状态。 */
export function PreflightReportView({ report }: PreflightReportViewProps) {
  return (
    <section
      className={`lab-ui-preflight lab-ui-preflight--${report.status}`}
      aria-label="运行前检查"
    >
      <header className="lab-ui-preflight__header">
        <div>
          <span className="lab-ui-eyebrow">运行前检查</span>
          <h2>{preflightStatusLabel(report.status)}</h2>
        </div>
        <span>{report.canRun ? '可以提交' : '暂不可提交'}</span>
      </header>
      {report.checks.length === 0 ? (
        <p className="lab-ui-list-empty">后端没有返回检查项。</p>
      ) : (
        <ul className="lab-ui-preflight__list">
          {report.checks.map((check, index) => (
            <PreflightCheckItem
              key={`${check.code}-${check.nodeUuid ?? 'global'}-${index}`}
              check={check}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function PreflightCheckItem({
  check,
}: {
  readonly check: PreflightReport['checks'][number]
}) {
  return (
    <li className={`is-${check.status}`}>
      <span className="lab-ui-preflight__indicator" aria-hidden="true" />
      <div>
        <strong>{check.message}</strong>
        <small>
          {check.code}
          {check.nodeName ? ` · ${check.nodeName}` : ''}
        </small>
      </div>
      <span>{checkStatusLabel(check.status)}</span>
    </li>
  )
}

function preflightStatusLabel(status: PreflightReport['status']): string {
  if (status === 'runnable_now') return '检查通过'
  if (status === 'temporarily_unavailable') return '暂不可用'
  return '参数无效'
}

function checkStatusLabel(status: PreflightCheckStatus): string {
  if (status === 'passed') return '已通过'
  if (status === 'blocked') return '已阻塞'
  if (status === 'deferred') return '待复核'
  return '待确认'
}
