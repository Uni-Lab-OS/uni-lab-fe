import type { SiteSummary } from "@unilab-fe/core";

export type MaterialSiteAction = "load" | "unload" | "unavailable";

/**
 * 库位的人工操作方向由库位占用事实决定：
 * - 空库位只能上料；
 * - 已占用库位只能下料；
 * - 占用未知时不提供任何方向，避免覆盖未知状态。
 */
export function resolveMaterialSiteAction(
  occupancy: SiteSummary["occupancy"],
): MaterialSiteAction {
  if (!occupancy.known) return "unavailable";
  return occupancy.occupiedMaterialUuid ? "unload" : "load";
}
