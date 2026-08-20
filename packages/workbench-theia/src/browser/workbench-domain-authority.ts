import type {
  ServerCapability,
  Services
} from '@unilab/services'

import {
  createWorkbenchServices,
  type WorkbenchConnectionMode,
  type WorkbenchConnectionTarget
} from './workbench-connection-profile'

const REQUIRED_RUNTIME_CAPABILITIES: readonly ServerCapability[] = [
  'devices.listOnline',
  'devices.listActions',
  'material.readGraph',
  'workflow.readDefinitions',
  'workflow.runTasks'
]

export class WorkbenchAuthorityUnavailableError extends Error {
  constructor(
    readonly mode: WorkbenchConnectionMode,
    message: string
  ) {
    super(message)
    this.name = 'WorkbenchAuthorityUnavailableError'
  }
}

/**
 * 在提交 Runtime Authority 切换前验证完整目标，而不是切换后逐接口回退。
 * @param target 待选择的整套 Runtime Backend Client 配置。
 * @param createServicesForTarget 测试可替换的组合根工厂。
 * @returns 目标具备最低运行合同且健康时完成；候选客户端始终被释放。
 */
export async function preflightWorkbenchRuntimeAuthority(
  target: WorkbenchConnectionTarget,
  createServicesForTarget: (
    target: WorkbenchConnectionTarget
  ) => Services = createWorkbenchServices
): Promise<void> {
  const candidate = createServicesForTarget(target)
  try {
    const required = [
      ...REQUIRED_RUNTIME_CAPABILITIES,
      ...(target.mode === 'local' ? ['workflow.authoring' as const] : [])
    ] satisfies ServerCapability[]
    const missing = required.filter(
      capability => !candidate.getCapabilityStatus(capability).available
    )
    if (missing.length > 0) {
      throw new WorkbenchAuthorityUnavailableError(
        target.mode,
        `${target.title} 缺少运行能力：${missing.join('、')}`
      )
    }
    if (!await candidate.laboratory.ping()) {
      throw new WorkbenchAuthorityUnavailableError(
        target.mode,
        `${target.title} 未通过 /api/v1/health 就绪检查`
      )
    }
    try {
      await candidate.workflow.listWorkflows({ page: 1, page_size: 1 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new WorkbenchAuthorityUnavailableError(
        target.mode,
        `${target.title} 工作流目录不可用：${message}`
      )
    }
  } finally {
    candidate.dispose()
  }
}
