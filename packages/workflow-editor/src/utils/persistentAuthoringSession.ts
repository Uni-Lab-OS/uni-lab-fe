import type {
  WorkflowAuthoringAggregate,
  WorkflowAuthoringChangedEvent,
  WorkflowAuthoringGraph
} from '@unilab/services'

export class AuthoringOperationQueue {
  private tail: Promise<void> = Promise.resolve()

  run<Value>(operation: () => Promise<Value>): Promise<Value> {
    const result = this.tail.then(operation, operation)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

export async function applyMaterializedWorkflowCandidate<Applied>(input: {
  save: () => Promise<WorkflowAuthoringAggregate>
  apply: (candidateHash: string) => Promise<Applied>
}): Promise<{
  saved: WorkflowAuthoringAggregate
  applied: Applied
}> {
  const saved = await input.save()
  const candidateHash = saved.candidate?.candidate_hash
  if (!candidateHash) {
    throw new Error('规范化源码已保存，但 OS 未返回可应用的工作流候选')
  }
  return {
    saved,
    applied: await input.apply(candidateHash)
  }
}

export function hasRunnableAppliedWorkflow(
  aggregate: WorkflowAuthoringAggregate | null
): boolean {
  if (!aggregate) return false
  const templateKinds = new Map(
    aggregate.applied_graph.node_templates.map((template) => [
      template.uuid,
      String(template.node_type || '').trim().toLowerCase()
    ])
  )
  return aggregate.applied_graph.nodes.some((node) => {
    if (node.disabled) return false
    const kind = templateKinds.get(node.workflow_node_template_uuid) ||
      String(node.type || '').trim().toLowerCase()
    return kind !== 'group'
  })
}

export function authoringStateMessage(
  aggregate: WorkflowAuthoringAggregate
): string {
  const labels: Record<WorkflowAuthoringAggregate['state'], string> = {
    draft_missing: '尚无 Python 草稿',
    compiling: '正在检查工作流…',
    draft_invalid: '草稿存在错误，当前仍使用已保存的工作流',
    candidate_stale: '预览已过期，请重新检查工作流',
    unapplied_source_only: '源码有尚未应用的修改，工作流图未变化',
    unapplied_graph: '工作流有尚未应用的修改',
    applied: '源码与工作流已同步',
    applied_source_stale: '源码与已保存的工作流不一致'
  }
  return labels[aggregate.state]
}

export function draftSaveMessage(
  aggregate: WorkflowAuthoringAggregate
): string {
  if (aggregate.state === 'draft_invalid') {
    return '草稿已保存，但存在错误，修复后才能应用'
  }
  if (
    aggregate.candidate?.changeset.kind === 'source_only' ||
    aggregate.state === 'unapplied_source_only'
  ) {
    return '草稿已保存，仅源码发生变化'
  }
  return '草稿已保存，有尚未应用的工作流修改'
}

export function authoringProjection(
  aggregate: WorkflowAuthoringAggregate
): { kind: 'candidate' | 'applied'; graph: WorkflowAuthoringGraph } {
  return aggregate.candidate
    ? { kind: 'candidate', graph: aggregate.candidate.graph }
    : { kind: 'applied', graph: aggregate.applied_graph }
}

export function isCurrentAuthoringInvalidation(
  event: WorkflowAuthoringChangedEvent,
  aggregate: WorkflowAuthoringAggregate | null
): boolean {
  if (!aggregate) return false
  return event.data.workflow_uuid === aggregate.workflow_uuid &&
    event.data.workflow_revision === aggregate.workflow_revision &&
    event.data.draft_hash === (aggregate.draft?.draft_hash ?? null) &&
    event.data.candidate_hash === (aggregate.candidate?.candidate_hash ?? null)
}

export function isSameAuthoringVersion(
  left: WorkflowAuthoringAggregate,
  right: WorkflowAuthoringAggregate | null
): boolean {
  if (!right) return false
  return left.workflow_uuid === right.workflow_uuid &&
    left.workflow_revision === right.workflow_revision &&
    left.state === right.state &&
    (left.draft?.draft_hash ?? null) === (right.draft?.draft_hash ?? null) &&
    (left.candidate?.candidate_hash ?? null) ===
      (right.candidate?.candidate_hash ?? null)
}

export function isAuthoringConflict(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const error = value as { code?: unknown }
  return [
    'conflict',
    'draft_hash_conflict',
    'workflow_revision_conflict',
    'candidate_hash_conflict',
    'template_catalog_conflict'
  ].includes(String(error.code || ''))
}

export function isTemplateCatalogConflict(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return String((value as { code?: unknown }).code || '') ===
    'template_catalog_conflict'
}

export function catalogConflictDecision(input: {
  dirty: boolean
  localPython: string
  localGraph: WorkflowAuthoringGraph
  observedFingerprint: string
  currentFingerprint: string
}): {
  kind: 'refresh_catalog_and_recompile'
  retainLocalPython: string
  retainLocalGraph: WorkflowAuthoringGraph
  clearDirty: false
} | null {
  if (input.observedFingerprint === input.currentFingerprint) return null
  return {
    kind: 'refresh_catalog_and_recompile',
    retainLocalPython: input.localPython,
    retainLocalGraph: input.localGraph,
    clearDirty: false
  }
}

export function diagnosticRange(diagnostic: {
  source_range?: {
    start_line: number
    start_column: number
    end_line: number
    end_column: number
  }
}): string {
  const range = diagnostic.source_range
  if (!range) return ''
  const start = `${range.start_line}:${range.start_column}`
  return `${start}–${range.end_line}:${range.end_column}`
}
