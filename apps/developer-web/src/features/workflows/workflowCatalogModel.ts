import type { PublishedWorkflowRevisionSummary } from '@unilab-fe/core'

export function filterWorkflowCatalog(
  items: readonly PublishedWorkflowRevisionSummary[],
  kind: PublishedWorkflowRevisionSummary['workflowType'],
  keyword: string,
): PublishedWorkflowRevisionSummary[] {
  const normalizedKeyword = keyword.trim().toLowerCase()
  return items.filter((item) => {
    const matchesKind = item.workflowType === kind
    const matchesKeyword =
      !normalizedKeyword ||
      `${item.name} ${item.workflowUuid}`.toLowerCase().includes(normalizedKeyword)
    return matchesKind && matchesKeyword
  })
}

export function countWorkflowKinds(
  items: readonly PublishedWorkflowRevisionSummary[] | undefined,
): Record<PublishedWorkflowRevisionSummary['workflowType'], number> {
  return {
    experiment_operation:
      items?.filter((item) => item.workflowType === 'experiment_operation').length ?? 0,
    workflow: items?.filter((item) => item.workflowType === 'workflow').length ?? 0,
  }
}
