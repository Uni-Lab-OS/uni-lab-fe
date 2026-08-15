import type {
  ReagentInfoCreateCommand,
  ReagentInfoLookupResult,
  ReagentInfoManagement,
  ReagentInfoUpdateCommand
} from '@unilab/robot-workstation'
import type { Services } from '@unilab/services'
import { useCallback, useMemo } from 'react'

/**
 * 把统一 Services 化学品字典端口适配为机械臂工作站命令端口。
 * @param services 已绑定当前运行目标的服务集合。
 * @param refresh 成功写入后触发权威目录回读的回调。
 * @returns 三项能力均开放时返回管理端口，否则失败关闭为 undefined。
 */
export function useReagentInfoManagement(
  services: Services,
  refresh: () => void
): ReagentInfoManagement | undefined {
  /** 读取 Backend 的 PubChem 候选值；输入变化时允许对话框取消旧请求。 */
  const lookupByCAS = useCallback(async (
    cas: string,
    signal?: AbortSignal
  ): Promise<ReagentInfoLookupResult> => {
    return await services.inventory.lookupCompoundByCAS(cas, signal)
  }, [services.inventory])

  /** 手工登记独立化学品身份，并标记 Workbench 写入来源。 */
  const create = useCallback(async (
    command: ReagentInfoCreateCommand
  ): Promise<void> => {
    await services.inventory.createReagentInfo({
      ...command,
      metadata: {
        ...(command.metadata ?? {}),
        source: 'frontend:robot-workstation'
      }
    })
    refresh()
  }, [refresh, services.inventory])

  /** 纠错既有化学品身份；成功后只靠 Backend 回读推进界面。 */
  const update = useCallback(async (
    command: ReagentInfoUpdateCommand
  ): Promise<void> => {
    await services.inventory.updateReagentInfo(command)
    refresh()
  }, [refresh, services.inventory])

  /** 删除未被引用的误建身份；失败时保留当前目录事实。 */
  const remove = useCallback(async (reagentInfoId: string): Promise<void> => {
    await services.inventory.deleteReagentInfo(reagentInfoId)
    refresh()
  }, [refresh, services.inventory])

  return useMemo(() => {
    const requiredCapabilities = [
      'reagentInfo.create',
      'reagentInfo.update',
      'reagentInfo.delete'
    ] as const
    if (requiredCapabilities.some(capability =>
      !services.getCapabilityStatus(capability).available
    )) return undefined
    return { lookupByCAS, create, update, delete: remove }
  }, [create, lookupByCAS, remove, services, update])
}
