import { Emitter, type Event } from '@theia/core/lib/common/event'
import { injectable } from '@theia/core/shared/inversify'

export type WorkbenchDomain =
  | 'workflow'
  | 'material'
  | 'device'
  | 'robot-debug'
  | 'operation'
  | 'robot-points'
  | 'workflow-management'
  | 'workflow-tasks'
  | 'robot-bench'
  | 'robot-reagents'
export type WorkbenchViewMode =
  | 'empty'
  | 'workflow'
  | 'material'
  | 'device'
  | 'robot-debug'
  | 'operation'
  | 'robot-points'
  | 'workflow-management'
  | 'workflow-tasks'
  | 'robot-bench'
  | 'robot-reagents'
  | 'split'
  | 'workflow-management-material'
  | 'device-material'

export type RobotWorkbenchViewMode = Extract<
  WorkbenchViewMode,
  `robot-${string}`
>

/**
 * The single UI authority for which UniLab domain surfaces are visible.
 *
 * The service contains presentation state only. Workflow, Material and OS
 * facts remain owned by their existing stores and WorkbenchSession.
 */
@injectable()
export class WorkbenchViewState {
  protected workflowVisible = !headlessMaterialRendererRequested()
  protected workflowManagementVisible = false
  protected materialVisible = headlessMaterialRendererRequested()
  protected deviceVisible = false
  protected exclusiveDomain: Exclude<
    WorkbenchDomain,
    'workflow' | 'workflow-management' | 'material' | 'device'
  > | null = null
  protected readonly changeEmitter = new Emitter<WorkbenchViewMode>()

  readonly onDidChangeMode: Event<WorkbenchViewMode> = this.changeEmitter.event

  /** 返回当前 Workbench 主区唯一可见模式。 */
  get currentMode(): WorkbenchViewMode {
    if (this.exclusiveDomain) return this.exclusiveDomain
    if (this.deviceVisible && this.materialVisible) return 'device-material'
    if (this.deviceVisible) return 'device'
    if (this.workflowManagementVisible && this.materialVisible) {
      return 'workflow-management-material'
    }
    if (this.workflowManagementVisible) return 'workflow-management'
    if (this.workflowVisible && this.materialVisible) return 'split'
    if (this.workflowVisible) return 'workflow'
    if (this.materialVisible) return 'material'
    return 'empty'
  }

  /** 判断一个领域入口当前是否在 Workbench 主区可见。 */
  isVisible(domain: WorkbenchDomain): boolean {
    if (this.exclusiveDomain) return this.exclusiveDomain === domain
    if (domain === 'workflow') return this.workflowVisible
    if (domain === 'workflow-management') {
      return this.workflowManagementVisible
    }
    if (domain === 'material') return this.materialVisible
    if (domain === 'device') return this.deviceVisible
    return false
  }

  /**
   * 切换一个领域主区；物料可与工作流或设备组成分栏，机械臂入口保持互斥。
   * @param domain 用户从 Workbench 活动栏选择的领域入口。
   * @returns 无返回值；模式变化时发布一次呈现事件。
   */
  toggle(domain: WorkbenchDomain): void {
    const previousMode = this.currentMode
    // 主区必须始终保留至少一个活动领域。单视图下再次点击当前入口
    // 只用于保持焦点，不能把唯一活动项关闭成 empty。
    if (!isSplitWorkbenchView(previousMode) && this.isVisible(domain)) return
    if (
      domain !== 'workflow' &&
      domain !== 'workflow-management' &&
      domain !== 'material' &&
      domain !== 'device'
    ) {
      this.exclusiveDomain = this.exclusiveDomain === domain ? null : domain
    } else if (this.exclusiveDomain) {
      // 从机械臂等互斥页面返回主区时，明确选择用户点击的领域。
      // 不能反转离开主区前遗留的可见标记，否则“物料 → 试剂 → 物料”
      // 会把 materialVisible 从 true 切成 false，导致主区与活动栏选中态不一致。
      this.exclusiveDomain = null
      this.workflowVisible = domain === 'workflow'
      this.workflowManagementVisible = domain === 'workflow-management'
      this.materialVisible = domain === 'material'
      this.deviceVisible = domain === 'device'
    } else {
      this.exclusiveDomain = null
      if (domain === 'workflow') {
        const nextVisible = !this.workflowVisible
        this.workflowVisible = nextVisible
        if (nextVisible) {
          this.workflowManagementVisible = false
          this.deviceVisible = false
        }
      } else if (domain === 'workflow-management') {
        const nextVisible = !this.workflowManagementVisible
        this.workflowManagementVisible = nextVisible
        if (nextVisible) {
          this.workflowVisible = false
          this.deviceVisible = false
        }
      } else if (domain === 'material') {
        this.materialVisible = !this.materialVisible
      } else {
        const nextVisible = !this.deviceVisible
        this.deviceVisible = nextVisible
        if (nextVisible) {
          this.workflowVisible = false
          this.workflowManagementVisible = false
        }
      }
    }
    const nextMode = this.currentMode
    if (nextMode !== previousMode) this.changeEmitter.fire(nextMode)
  }
}

/** 判断当前是否为允许用户关闭任一侧的双领域分栏。 */
function isSplitWorkbenchView(mode: WorkbenchViewMode): boolean {
  return mode === 'split' || mode === 'workflow-management-material' ||
    mode === 'device-material'
}

function headlessMaterialRendererRequested(): boolean {
  try {
    return typeof globalThis.location !== 'undefined' && new URLSearchParams(
      globalThis.location.search
    ).get('headlessRenderer') === 'material'
  } catch {
    return false
  }
}

/**
 * 判断当前主区是否为四个机械臂工站入口之一。
 * @param mode Workbench 当前模式。
 * @returns 以 robot- 开头的正式工站模式返回 true。
 */
export function isRobotWorkbenchViewMode(
  mode: WorkbenchViewMode
): mode is RobotWorkbenchViewMode {
  return mode.startsWith('robot-')
}
