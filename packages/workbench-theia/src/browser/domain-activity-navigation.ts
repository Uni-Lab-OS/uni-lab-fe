export interface DomainActivityEntry {
  openInWorkbench: () => void
}

/**
 * 将 Theia 活动栏当前选中的所有者转发到 UniLab 主工作区。
 *
 * @param selectedOwner 当前活动栏标题的所有者；null 表示侧栏已收起。
 * @param entries 允许转发的 UniLab 领域入口集合。
 * @returns 无返回值；非领域入口不会触发任何工作区切换。
 */
export function openSelectedDomainActivity(
  selectedOwner: unknown,
  entries: readonly DomainActivityEntry[]
): void {
  const selectedEntry = entries.find(entry => entry === selectedOwner)
  selectedEntry?.openInWorkbench()
}
