import { Emitter, type Event } from '@theia/core/lib/common/event'
import { injectable } from '@theia/core/shared/inversify'

export type WorkbenchDomain =
  | 'workflow'
  | 'material'
  | 'device'
  | 'robot-debug'
  | 'robot-points'
  | 'robot-bench'
  | 'robot-reagents'
export type WorkbenchViewMode =
  | 'empty'
  | 'workflow'
  | 'material'
  | 'device'
  | 'robot-debug'
  | 'robot-points'
  | 'robot-bench'
  | 'robot-reagents'
  | 'split'

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
  protected materialVisible = headlessMaterialRendererRequested()
  protected exclusiveDomain: Exclude<
    WorkbenchDomain,
    'workflow' | 'material'
  > | null = null
  protected readonly changeEmitter = new Emitter<WorkbenchViewMode>()

  readonly onDidChangeMode: Event<WorkbenchViewMode> = this.changeEmitter.event

  /** 返回当前 Workbench 主区唯一可见模式。 */
  get currentMode(): WorkbenchViewMode {
    if (this.exclusiveDomain) return this.exclusiveDomain
    if (this.workflowVisible && this.materialVisible) return 'split'
    if (this.workflowVisible) return 'workflow'
    if (this.materialVisible) return 'material'
    return 'empty'
  }

  /** 判断一个领域入口当前是否在 Workbench 主区可见。 */
  isVisible(domain: WorkbenchDomain): boolean {
    if (this.exclusiveDomain) return this.exclusiveDomain === domain
    if (domain === 'workflow') return this.workflowVisible
    if (domain === 'material') return this.materialVisible
    return false
  }

  /**
   * 切换一个领域主区；设备与四个机械臂入口保持互斥，工作流与物料可组成分栏。
   * @param domain 用户从 Workbench 活动栏选择的领域入口。
   * @returns 无返回值；模式变化时发布一次呈现事件。
   */
  toggle(domain: WorkbenchDomain): void {
    const previousMode = this.currentMode
    // 主区必须始终保留至少一个活动领域。单视图下再次点击当前入口
    // 只用于保持焦点，不能把唯一活动项关闭成 empty。
    if (previousMode !== 'split' && this.isVisible(domain)) return
    if (domain !== 'workflow' && domain !== 'material') {
      this.exclusiveDomain = this.exclusiveDomain === domain ? null : domain
    } else {
      this.exclusiveDomain = null
      if (domain === 'workflow') {
        this.workflowVisible = !this.workflowVisible
      } else {
        this.materialVisible = !this.materialVisible
      }
    }
    const nextMode = this.currentMode
    if (nextMode !== previousMode) this.changeEmitter.fire(nextMode)
  }
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
