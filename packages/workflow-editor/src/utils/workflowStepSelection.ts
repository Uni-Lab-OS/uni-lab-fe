/** 只在当前任务就绪列表内保留手选项，否则默认服务发布的首项。 */
export function workflowStepSelection(
  taskUuid: string | undefined,
  candidates: readonly { node_uuid: string }[],
  selected: { taskUuid: string | undefined; nodeUuid: string } | null
): string {
  return selected && selected.taskUuid === taskUuid && candidates.some(row => row.node_uuid === selected.nodeUuid)
    ? selected.nodeUuid
    : candidates[0]?.node_uuid ?? ''
}
