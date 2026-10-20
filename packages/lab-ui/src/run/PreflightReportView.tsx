import { clsx } from 'clsx'
import { useState } from 'react'
import runStyles from '../run.module.scss'
import sharedStyles from '../shared.module.scss'
import { Icon } from '@unilab/design-v2/icons'
import type { PreflightCheckStatus, PreflightReport, ResourceCandidate } from '@unilab-fe/core'
import { formatPreflightCheckMessage } from './preflightPresentation'

export interface PreflightReportViewProps {
  readonly report: PreflightReport
  readonly candidates?: readonly ResourceCandidate[]
}

/** 后端 preflight 权威结果的展示，不根据 HTTP 接受结果推断运行状态。 */
export function PreflightReportView({ report, candidates = [] }: PreflightReportViewProps) {
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
                  title={
                    group.summaries
                      ? `${formatCount(group.summaries.length)} 类，共 ${formatCount(group.checks.length)} 项`
                      : undefined
                  }
                >
                  {group.summaries
                    ? `${formatCount(group.summaries.length)} 类 · ${formatCount(group.checks.length)} 项`
                    : group.checks.length}
                </span>
              </summary>
              <ul className={clsx(runStyles['lab-ui-preflight__list'])}>
                {group.summaries
                  ? group.summaries.map((summary) => (
                      <PreflightSummaryItem
                        key={summary.code}
                        summary={summary}
                        candidates={candidates}
                      />
                    ))
                  : group.checks.map((check, index) => (
                      <PreflightCheckItem
                        key={`${check.code}-${check.nodeUuid ?? 'global'}-${index}`}
                        check={check}
                        candidates={candidates}
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

function PreflightCheckItem({
  check,
  candidates,
}: {
  readonly check: PreflightReport['checks'][number]
  readonly candidates: readonly ResourceCandidate[]
}) {
  return (
    <li className={clsx(runStyles[`is-${check.status}`])}>
      <span className={clsx(runStyles['lab-ui-preflight__indicator'])} aria-hidden="true" />
      <div>
        <strong>{formatPreflightCheckMessage(check, candidates)}</strong>
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

interface PreflightCheckSummary {
  readonly code: string
  /** 同类检查的代表项：说明文案与状态相同，只用于展示。 */
  readonly check: PreflightReport['checks'][number]
  readonly total: number
  readonly nodeCount: number
  /** 节点名称及出现次数（同一子流程在多处展开时名称会重复），按首次出现排序。 */
  readonly nodeNames: ReadonlyArray<readonly [string, number]>
}

/** 节点名单最多展示的名称种类；其余只给数量，避免大工作流一次渲染上万行。 */
const MAX_LISTED_NODE_NAMES = 100

function PreflightSummaryItem({
  summary,
  candidates,
}: {
  readonly summary: PreflightCheckSummary
  readonly candidates: readonly ResourceCandidate[]
}) {
  const [expanded, setExpanded] = useState(false)
  const listed = summary.nodeNames.slice(0, MAX_LISTED_NODE_NAMES)
  const hidden = summary.nodeNames.length - listed.length
  return (
    <li className={clsx(runStyles[`is-${summary.check.status}`])}>
      <span className={clsx(runStyles['lab-ui-preflight__indicator'])} aria-hidden="true" />
      <div>
        <strong>{formatPreflightCheckMessage(summary.check, candidates)}</strong>
        <small>
          {summary.code}
          {summary.nodeCount > 0
            ? ` · ${formatCount(summary.nodeCount)} 个节点`
            : summary.total > 1
              ? ` · ${formatCount(summary.total)} 项`
              : ''}
        </small>
        {summary.nodeNames.length > 0 && (
          <button
            type="button"
            className={clsx(runStyles['lab-ui-preflight__nodes-toggle'])}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '收起节点' : '查看节点'}
          </button>
        )}
        {expanded && (
          <small className={clsx(runStyles['lab-ui-preflight__nodes'])}>
            {listed.map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join('、')}
            {hidden > 0 ? ` 等 ${formatCount(hidden)} 种` : ''}
          </small>
        )}
      </div>
      <span
        className={clsx(
          runStyles['lab-ui-preflight__status-tag'],
          runStyles[`is-${summary.check.status}`],
        )}
      >
        {checkStatusLabel(summary.check.status)}
      </span>
    </li>
  )
}

const preflightGroups: ReadonlyArray<{
  readonly status: PreflightCheckStatus
  readonly title: string
  /**
   * 待复核与已通过不需要操作员逐项处理，按 code 汇总成一行；大工作流每个节点都有
   * 同样的说明性检查，逐条列出会有上万行。阻塞项与待确认需要逐项处理，保持逐条。
   */
  readonly summarize: boolean
}> = [
  { status: 'blocked', title: '阻塞项', summarize: false },
  { status: 'confirmation_required', title: '待确认', summarize: false },
  { status: 'deferred', title: '待复核', summarize: true },
  { status: 'passed', title: '已通过', summarize: true },
]

function groupChecks(checks: PreflightReport['checks']) {
  return preflightGroups
    .map(({ summarize, ...group }) => {
      const matching = checks.filter((check) => check.status === group.status)
      return {
        ...group,
        checks: matching,
        summaries: summarize ? summarizeChecks(matching) : null,
      }
    })
    .filter((group) => group.checks.length > 0)
}

function summarizeChecks(checks: PreflightReport['checks']): PreflightCheckSummary[] {
  const byCode = new Map<
    string,
    {
      check: PreflightReport['checks'][number]
      total: number
      nodes: Set<string>
      names: Map<string, number>
    }
  >()
  for (const check of checks) {
    let entry = byCode.get(check.code)
    if (!entry) {
      entry = { check, total: 0, nodes: new Set(), names: new Map() }
      byCode.set(check.code, entry)
    }
    entry.total += 1
    if (check.nodeUuid) entry.nodes.add(check.nodeUuid)
    const name = check.nodeName?.trim()
    if (name) entry.names.set(name, (entry.names.get(name) ?? 0) + 1)
  }
  return [...byCode.entries()]
    .map(([code, entry]) => ({
      code,
      check: entry.check,
      total: entry.total,
      nodeCount: entry.nodes.size,
      nodeNames: [...entry.names.entries()],
    }))
    .sort((left, right) => right.total - left.total)
}

function formatCount(value: number): string {
  return value.toLocaleString('zh-CN')
}

function checkStatusLabel(status: PreflightCheckStatus): string {
  if (status === 'passed') return '已通过'
  if (status === 'blocked') return '已阻塞'
  if (status === 'deferred') return '待复核'
  return '待确认'
}
