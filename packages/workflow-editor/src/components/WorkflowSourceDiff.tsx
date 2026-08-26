import { diffArrays, diffWordsWithSpace } from 'diff'
import Prism from 'prismjs'
import 'prismjs/components/prism-python'
import { useMemo, useRef, useState } from 'react'
import type { RefObject, UIEvent } from 'react'

export type WorkflowSourceDiffRowKind =
  | 'unchanged'
  | 'modified'
  | 'added'
  | 'deleted'

export interface WorkflowSourceDiffRow {
  kind: WorkflowSourceDiffRowKind
  beforeLineNumber: number | null
  afterLineNumber: number | null
  beforeText: string | null
  afterText: string | null
}

export interface SourceDiffRange {
  start: number
  end: number
}

interface PendingChange {
  added: string[]
  removed: string[]
}

interface SyntaxSegment {
  text: string
  tokenTypes: string[]
}

interface CodeSegment extends SyntaxSegment {
  changed: boolean
}

interface ReviewCodeRow extends WorkflowSourceDiffRow {
  type: 'code'
  key: string
  beforeSegments: CodeSegment[]
  afterSegments: CodeSegment[]
}

interface ReviewHunkRow {
  type: 'hunk'
  key: string
  label: string
}

interface ReviewCollapsedRow {
  type: 'collapsed'
  key: string
  count: number
}

type ReviewRow = ReviewCodeRow | ReviewHunkRow | ReviewCollapsedRow

interface UnifiedCodeRow {
  type: 'unified-code'
  key: string
  kind: 'unchanged' | 'added' | 'deleted'
  marker: ' ' | '+' | '-'
  markerLabel: '未修改' | '新增' | '删除'
  beforeLineNumber: number | null
  afterLineNumber: number | null
  segments: CodeSegment[]
}

type UnifiedReviewRow =
  | UnifiedCodeRow
  | ReviewHunkRow
  | ReviewCollapsedRow

const HUNK_CONTEXT_LINES = 3

/**
 * 把源码差异投影为对齐的行，供左右对照和统一差异共同使用。
 *
 * @param before 保存前的 Python 源码。
 * @param after OS 生成或规范化后的 Python 源码。
 * @returns 带双侧行号和增删改语义的对齐行。
 */
export function buildWorkflowSourceDiff(
  before: string,
  after: string
): WorkflowSourceDiffRow[] {
  const rows: WorkflowSourceDiffRow[] = []
  let beforeLineNumber = 1
  let afterLineNumber = 1
  let pending: PendingChange = { added: [], removed: [] }

  const flushPending = (): void => {
    const count = Math.max(pending.removed.length, pending.added.length)
    for (let index = 0; index < count; index += 1) {
      const beforeText = pending.removed[index] ?? null
      const afterText = pending.added[index] ?? null
      const kind = beforeText !== null && afterText !== null
        ? 'modified'
        : beforeText !== null
          ? 'deleted'
          : 'added'

      rows.push({
        kind,
        beforeLineNumber: beforeText === null ? null : beforeLineNumber++,
        afterLineNumber: afterText === null ? null : afterLineNumber++,
        beforeText,
        afterText
      })
    }
    pending = { added: [], removed: [] }
  }

  for (const change of diffArrays(sourceLines(before), sourceLines(after))) {
    const lines = change.value
    if (change.removed) {
      pending.removed.push(...lines)
      continue
    }
    if (change.added) {
      pending.added.push(...lines)
      continue
    }

    flushPending()
    for (const line of lines) {
      rows.push({
        kind: 'unchanged',
        beforeLineNumber: beforeLineNumber++,
        afterLineNumber: afterLineNumber++,
        beforeText: line,
        afterText: line
      })
    }
  }
  flushPending()

  return rows
}

/**
 * 计算一对修改行中真正变化的词元范围。
 *
 * @param before 修改前的代码行。
 * @param after 修改后的代码行。
 * @returns 两侧各自需要加强调的字符范围。
 */
export function buildIntralineSourceDiff(
  before: string,
  after: string
): {
  beforeRanges: SourceDiffRange[]
  afterRanges: SourceDiffRange[]
} {
  const beforeRanges: SourceDiffRange[] = []
  const afterRanges: SourceDiffRange[] = []
  let beforeOffset = 0
  let afterOffset = 0

  for (const change of diffWordsWithSpace(before, after)) {
    if (change.removed) {
      beforeRanges.push({
        start: beforeOffset,
        end: beforeOffset + change.value.length
      })
      beforeOffset += change.value.length
      continue
    }
    if (change.added) {
      afterRanges.push({
        start: afterOffset,
        end: afterOffset + change.value.length
      })
      afterOffset += change.value.length
      continue
    }
    beforeOffset += change.value.length
    afterOffset += change.value.length
  }

  return { beforeRanges, afterRanges }
}

/**
 * 呈现 Git 代码审查式 Python 差异：宽屏左右对照，窄屏统一视图。
 *
 * @param props.before 保存前的源码。
 * @param props.after 保存后或待接受的源码。
 * @returns 带语法、hunk 和行内变更的可滚动代码差异视图。
 */
export function WorkflowSourceDiff({
  before,
  after
}: {
  before: string
  after: string
}): React.JSX.Element {
  const rows = useMemo(
    () => buildWorkflowSourceDiff(before, after),
    [after, before]
  )
  const codeRows = useMemo(
    () => buildReviewCodeRows(before, after, rows),
    [after, before, rows]
  )
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const reviewRows = useMemo(
    () => buildReviewRows(codeRows, expandedGroups),
    [codeRows, expandedGroups]
  )
  const unifiedRows = useMemo(
    () => buildUnifiedRows(reviewRows),
    [reviewRows]
  )
  const beforeScroller = useRef<HTMLDivElement>(null)
  const afterScroller = useRef<HTMLDivElement>(null)
  const additions = rows.filter((row) =>
    row.kind === 'added' || row.kind === 'modified'
  ).length
  const deletions = rows.filter((row) =>
    row.kind === 'deleted' || row.kind === 'modified'
  ).length

  const expandGroup = (key: string): void => {
    setExpandedGroups((current) => new Set([...current, key]))
  }

  return (
    <div
      className="persistent-source-diff"
      aria-label="Python 代码差异"
    >
      <header className="persistent-source-diff__file-header">
        <span className="persistent-source-diff__language" aria-hidden="true">
          PY
        </span>
        <strong>工作流源码</strong>
        <span
          className="persistent-source-diff__stat is-added"
          aria-label={`${additions} 行新增`}
        >
          +{additions}
        </span>
        <span
          className="persistent-source-diff__stat is-deleted"
          aria-label={`${deletions} 行删除`}
        >
          −{deletions}
        </span>
      </header>

      <div className="persistent-source-diff__split">
        <SourcePane
          id="persistent-source-diff-before"
          title="当前 Python"
          side="before"
          rows={reviewRows}
          scrollerRef={beforeScroller}
          syncTargetRef={afterScroller}
          onExpandGroup={expandGroup}
        />
        <SourcePane
          id="persistent-source-diff-after"
          title="生成的完整 Python"
          side="after"
          rows={reviewRows}
          scrollerRef={afterScroller}
          syncTargetRef={beforeScroller}
          onExpandGroup={expandGroup}
        />
      </div>

      <section className="persistent-source-diff__unified">
        <h3 id="persistent-source-diff-unified-title">Python 代码差异</h3>
        <div
          className="persistent-source-diff__scroller"
          role="region"
          aria-labelledby="persistent-source-diff-unified-title"
          tabIndex={0}
        >
          <div className="persistent-source-diff__table" role="table">
            {unifiedRows.map((row) => row.type === 'unified-code' ? (
              <UnifiedCodeRowView key={row.key} row={row} />
            ) : (
              <ReviewMetaRow
                key={row.key}
                row={row}
                unified
                onExpandGroup={expandGroup}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function SourcePane({
  id,
  title,
  side,
  rows,
  scrollerRef,
  syncTargetRef,
  onExpandGroup
}: {
  id: string
  title: string
  side: 'before' | 'after'
  rows: ReviewRow[]
  scrollerRef: RefObject<HTMLDivElement | null>
  syncTargetRef: RefObject<HTMLDivElement | null>
  onExpandGroup: (key: string) => void
}): React.JSX.Element {
  const handleScroll = (event: UIEvent<HTMLDivElement>): void => {
    const target = syncTargetRef.current
    if (target && target.scrollTop !== event.currentTarget.scrollTop) {
      target.scrollTop = event.currentTarget.scrollTop
    }
  }

  return (
    <section className="persistent-source-diff__pane">
      <h3 id={`${id}-title`}>{title}</h3>
      <div
        ref={scrollerRef}
        className="persistent-source-diff__scroller"
        role="region"
        aria-labelledby={`${id}-title`}
        tabIndex={0}
        onScroll={handleScroll}
      >
        <div className="persistent-source-diff__table" role="table">
          {rows.map((row) => row.type === 'code' ? (
            <SourcePaneCodeRow key={row.key} row={row} side={side} />
          ) : (
            <ReviewMetaRow
              key={row.key}
              row={row}
              unified={false}
              onExpandGroup={onExpandGroup}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function SourcePaneCodeRow({
  row,
  side
}: {
  row: ReviewCodeRow
  side: 'before' | 'after'
}): React.JSX.Element {
  const text = side === 'before' ? row.beforeText : row.afterText
  const lineNumber = side === 'before'
    ? row.beforeLineNumber
    : row.afterLineNumber
  const segments = side === 'before' ? row.beforeSegments : row.afterSegments
  const presentation = sidePresentation(row.kind, side, text)

  return (
    <div
      className={`persistent-source-diff__row is-${presentation.kind}`}
      role="row"
    >
      <span className="persistent-source-diff__line-number" role="cell">
        {lineNumber ?? ''}
      </span>
      <span
        className="persistent-source-diff__marker"
        role="cell"
        aria-label={presentation.markerLabel}
      >
        {presentation.marker}
      </span>
      <CodeCell segments={segments} />
    </div>
  )
}

function UnifiedCodeRowView({
  row
}: {
  row: UnifiedCodeRow
}): React.JSX.Element {
  return (
    <div
      className={`persistent-source-diff__row is-${row.kind}`}
      role="row"
    >
      <span className="persistent-source-diff__line-number" role="cell">
        {row.beforeLineNumber ?? ''}
      </span>
      <span className="persistent-source-diff__line-number" role="cell">
        {row.afterLineNumber ?? ''}
      </span>
      <span
        className="persistent-source-diff__marker"
        role="cell"
        aria-label={row.markerLabel}
      >
        {row.marker}
      </span>
      <CodeCell segments={row.segments} />
    </div>
  )
}

function ReviewMetaRow({
  row,
  unified,
  onExpandGroup
}: {
  row: ReviewHunkRow | ReviewCollapsedRow
  unified: boolean
  onExpandGroup: (key: string) => void
}): React.JSX.Element {
  return (
    <div
      className={
        `persistent-source-diff__row ${
          row.type === 'hunk'
            ? 'persistent-source-diff__hunk'
            : 'persistent-source-diff__collapsed'
        }`
      }
      role="row"
    >
      <span className="persistent-source-diff__line-number" role="cell" />
      {unified && (
        <span className="persistent-source-diff__line-number" role="cell" />
      )}
      <span className="persistent-source-diff__marker" role="cell">
        {row.type === 'hunk' ? '' : '⋯'}
      </span>
      <span className="persistent-source-diff__meta-cell" role="cell">
        {row.type === 'hunk' ? (
          <code>{row.label}</code>
        ) : (
          <button type="button" onClick={() => onExpandGroup(row.key)}>
            展开 {row.count} 行未修改代码
          </button>
        )}
      </span>
    </div>
  )
}

function CodeCell({
  segments
}: {
  segments: CodeSegment[]
}): React.JSX.Element {
  return (
    <code role="cell">
      {segments.length > 0
        ? segments.map((segment, index) => {
            const classNames = segment.tokenTypes
              .map((type) => `token-${safeTokenType(type)}`)
            if (segment.changed) classNames.push('is-intraline-change')
            return (
              <span
                key={`${index}-${segment.text}`}
                className={classNames.join(' ') || undefined}
              >
                {segment.text}
              </span>
            )
          })
        : '\u00a0'}
    </code>
  )
}

function sidePresentation(
  kind: WorkflowSourceDiffRowKind,
  side: 'before' | 'after',
  text: string | null
): {
  kind:
    | WorkflowSourceDiffRowKind
    | 'modified-before'
    | 'modified-after'
    | 'placeholder'
  marker: ' ' | '+' | '-' | '~'
  markerLabel: '未修改' | '新增' | '删除' | '修改前' | '修改后' | '占位'
} {
  if (text === null) {
    return { kind: 'placeholder', marker: ' ', markerLabel: '占位' }
  }
  if (kind === 'modified') {
    return {
      kind: side === 'before' ? 'modified-before' : 'modified-after',
      marker: side === 'before' ? '-' : '+',
      markerLabel: side === 'before' ? '修改前' : '修改后'
    }
  }
  if (kind === 'deleted') {
    return { kind, marker: '-', markerLabel: '删除' }
  }
  if (kind === 'added') {
    return { kind, marker: '+', markerLabel: '新增' }
  }
  return { kind, marker: ' ', markerLabel: '未修改' }
}

function buildReviewCodeRows(
  before: string,
  after: string,
  rows: WorkflowSourceDiffRow[]
): ReviewCodeRow[] {
  const beforeSyntax = tokenizePythonSource(before)
  const afterSyntax = tokenizePythonSource(after)

  return rows.map((row, index) => {
    const intraline = row.kind === 'modified'
      ? buildIntralineSourceDiff(row.beforeText ?? '', row.afterText ?? '')
      : { beforeRanges: [], afterRanges: [] }

    return {
      ...row,
      type: 'code',
      key: `code-${index}`,
      beforeSegments: decorateSyntaxLine(
        syntaxLine(beforeSyntax, row.beforeLineNumber, row.beforeText),
        intraline.beforeRanges
      ),
      afterSegments: decorateSyntaxLine(
        syntaxLine(afterSyntax, row.afterLineNumber, row.afterText),
        intraline.afterRanges
      )
    }
  })
}

function buildReviewRows(
  rows: ReviewCodeRow[],
  expandedGroups: ReadonlySet<string>
): ReviewRow[] {
  const changedIndexes = rows.flatMap((row, index) =>
    row.kind === 'unchanged' ? [] : [index]
  )
  if (changedIndexes.length === 0) {
    return rows
  }

  const ranges: Array<{ start: number; end: number }> = []
  for (const index of changedIndexes) {
    const start = Math.max(0, index - HUNK_CONTEXT_LINES)
    const end = Math.min(rows.length - 1, index + HUNK_CONTEXT_LINES)
    const previous = ranges.at(-1)
    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end)
    } else {
      ranges.push({ start, end })
    }
  }

  const reviewRows: ReviewRow[] = []
  let cursor = 0
  for (const range of ranges) {
    appendHiddenRows(reviewRows, rows, cursor, range.start - 1, expandedGroups)
    reviewRows.push({
      type: 'hunk',
      key: `hunk-${range.start}-${range.end}`,
      label: buildHunkLabel(rows, range.start, range.end)
    })
    reviewRows.push(...rows.slice(range.start, range.end + 1))
    cursor = range.end + 1
  }
  appendHiddenRows(
    reviewRows,
    rows,
    cursor,
    rows.length - 1,
    expandedGroups
  )
  return reviewRows
}

function appendHiddenRows(
  reviewRows: ReviewRow[],
  rows: ReviewCodeRow[],
  start: number,
  end: number,
  expandedGroups: ReadonlySet<string>
): void {
  if (start > end) return
  const key = `collapsed-${start}-${end}`
  if (expandedGroups.has(key)) {
    reviewRows.push(...rows.slice(start, end + 1))
    return
  }
  reviewRows.push({
    type: 'collapsed',
    key,
    count: end - start + 1
  })
}

function buildHunkLabel(
  rows: ReviewCodeRow[],
  start: number,
  end: number
): string {
  const slice = rows.slice(start, end + 1)
  const before = hunkCoordinate(rows, slice, start, 'beforeLineNumber')
  const after = hunkCoordinate(rows, slice, start, 'afterLineNumber')
  return `@@ -${before.start},${before.count} +${after.start},${after.count} @@`
}

function hunkCoordinate(
  allRows: ReviewCodeRow[],
  rows: ReviewCodeRow[],
  startIndex: number,
  field: 'beforeLineNumber' | 'afterLineNumber'
): { start: number; count: number } {
  const lineNumbers = rows.flatMap((row) => {
    const lineNumber = row[field]
    return lineNumber === null ? [] : [lineNumber]
  })
  if (lineNumbers.length > 0) {
    return { start: lineNumbers[0], count: lineNumbers.length }
  }
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const lineNumber = allRows[index]?.[field]
    if (lineNumber !== null && lineNumber !== undefined) {
      return { start: lineNumber, count: 0 }
    }
  }
  return { start: 0, count: 0 }
}

function buildUnifiedRows(rows: ReviewRow[]): UnifiedReviewRow[] {
  return rows.flatMap((row): UnifiedReviewRow[] => {
    if (row.type !== 'code') return [row]
    if (row.kind === 'modified') {
      return [
        {
          type: 'unified-code',
          key: `${row.key}-before`,
          kind: 'deleted',
          marker: '-',
          markerLabel: '删除',
          beforeLineNumber: row.beforeLineNumber,
          afterLineNumber: null,
          segments: row.beforeSegments
        },
        {
          type: 'unified-code',
          key: `${row.key}-after`,
          kind: 'added',
          marker: '+',
          markerLabel: '新增',
          beforeLineNumber: null,
          afterLineNumber: row.afterLineNumber,
          segments: row.afterSegments
        }
      ]
    }

    const marker = row.kind === 'added'
      ? '+'
      : row.kind === 'deleted'
        ? '-'
        : ' '
    const markerLabel = row.kind === 'added'
      ? '新增'
      : row.kind === 'deleted'
        ? '删除'
        : '未修改'
    return [{
      type: 'unified-code',
      key: row.key,
      kind: row.kind,
      marker,
      markerLabel,
      beforeLineNumber: row.beforeLineNumber,
      afterLineNumber: row.afterLineNumber,
      segments: row.beforeText === null ? row.afterSegments : row.beforeSegments
    }]
  })
}

function tokenizePythonSource(source: string): SyntaxSegment[][] {
  const normalized = normalizeNewlines(source)
  if (!normalized) return []
  const tokens = Prism.tokenize(normalized, Prism.languages.python)
  const flattened = tokens.flatMap((token) => flattenPrismToken(token, []))
  const lines: SyntaxSegment[][] = [[]]

  for (const segment of flattened) {
    const parts = segment.text.split('\n')
    parts.forEach((part, index) => {
      if (part) {
        lines.at(-1)!.push({ ...segment, text: part })
      }
      if (index < parts.length - 1) lines.push([])
    })
  }
  if (normalized.endsWith('\n')) lines.pop()
  return lines
}

function flattenPrismToken(
  token: string | Prism.Token,
  inheritedTypes: string[]
): SyntaxSegment[] {
  if (typeof token === 'string') {
    return token ? [{ text: token, tokenTypes: inheritedTypes }] : []
  }
  const aliases = typeof token.alias === 'string'
    ? [token.alias]
    : token.alias ?? []
  const tokenTypes = [...new Set([...inheritedTypes, token.type, ...aliases])]
  const contents = Array.isArray(token.content)
    ? token.content
    : [token.content]
  return contents.flatMap((content) => flattenPrismToken(content, tokenTypes))
}

function syntaxLine(
  lines: SyntaxSegment[][],
  lineNumber: number | null,
  fallbackText: string | null
): SyntaxSegment[] {
  if (lineNumber === null || fallbackText === null) return []
  return lines[lineNumber - 1] ?? [{ text: fallbackText, tokenTypes: [] }]
}

function decorateSyntaxLine(
  segments: SyntaxSegment[],
  changedRanges: SourceDiffRange[]
): CodeSegment[] {
  const decorated: CodeSegment[] = []
  let offset = 0

  for (const segment of segments) {
    const start = offset
    const end = start + segment.text.length
    const boundaries = new Set([start, end])
    for (const range of changedRanges) {
      if (range.start > start && range.start < end) boundaries.add(range.start)
      if (range.end > start && range.end < end) boundaries.add(range.end)
    }
    const ordered = [...boundaries].sort((left, right) => left - right)
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const partStart = ordered[index]
      const partEnd = ordered[index + 1]
      decorated.push({
        text: segment.text.slice(partStart - start, partEnd - start),
        tokenTypes: segment.tokenTypes,
        changed: changedRanges.some((range) =>
          partStart < range.end && partEnd > range.start
        )
      })
    }
    offset = end
  }
  return decorated
}

function safeTokenType(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

function normalizeNewlines(source: string): string {
  return source.replace(/\r\n?/g, '\n')
}

function sourceLines(source: string): string[] {
  const normalized = normalizeNewlines(source)
  if (!normalized) {
    return []
  }
  const lines = normalized.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}
