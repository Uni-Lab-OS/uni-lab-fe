import { Emitter, type Event } from '@theia/core/lib/common/event'
import { injectable } from '@theia/core/shared/inversify'

export type WorkbenchDomain =
  | 'files'
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
  | 'files'
  | 'workflow-files'
  | 'workflow-management-files'
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
  protected filesVisible = false
  protected workflowManagementVisible = false
  protected materialVisible = headlessMaterialRendererRequested()
  protected deviceVisible = false
  protected exclusiveDomain: Exclude<
    WorkbenchDomain,
    'workflow' | 'workflow-management' | 'material' | 'device' | 'files'
  > | null = null
  protected readonly changeEmitter = new Emitter<WorkbenchViewMode>()
  protected readonly workflowManagementListRequestEmitter = new Emitter<void>()

  constructor() {
    const saved = readSavedWorkbenchMode()
    if (saved) this.applyMode(saved)
  }

  readonly onDidChangeMode: Event<WorkbenchViewMode> = this.changeEmitter.event
  /** 工作流管理入口重复点击时，请求当前工作流详情返回目录列表。 */
  readonly onDidRequestWorkflowManagementList: Event<void> =
    this.workflowManagementListRequestEmitter.event

  /** 返回当前 Workbench 主区唯一可见模式。 */
  get currentMode(): WorkbenchViewMode {
    if (this.exclusiveDomain) return this.exclusiveDomain
    if (this.filesVisible) {
      if (this.workflowVisible) return 'workflow-files'
      if (this.workflowManagementVisible) return 'workflow-management-files'
      return 'files'
    }
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
    if (domain === 'files') return this.filesVisible
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
    if (!isSplitWorkbenchView(previousMode) && this.isVisible(domain)) {
      if (domain === 'workflow-management') {
        this.workflowManagementListRequestEmitter.fire()
      }
      return
    }
    if (domain === 'files') {
      this.filesVisible = !this.filesVisible
      if (this.exclusiveDomain) {
        this.workflowVisible = false
        this.workflowManagementVisible = false
      }
      this.exclusiveDomain = null
      this.materialVisible = false
      this.deviceVisible = false
    } else if (this.filesVisible) {
      if (domain === 'workflow') {
        this.workflowVisible = !this.workflowVisible
        this.workflowManagementVisible = false
      } else if (domain === 'workflow-management') {
        this.workflowManagementVisible = !this.workflowManagementVisible
        this.workflowVisible = false
      } else {
        this.applyMode(domain)
      }
    } else if (
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
    if (nextMode !== previousMode) {
      saveWorkbenchMode(nextMode)
      this.changeEmitter.fire(nextMode)
    }
  }

  private applyMode(mode: WorkbenchViewMode): void {
    this.filesVisible = mode === 'files' || mode === 'workflow-files' ||
      mode === 'workflow-management-files'
    this.workflowVisible = mode === 'workflow' || mode === 'split' ||
      mode === 'workflow-files'
    this.workflowManagementVisible = mode === 'workflow-management' ||
      mode === 'workflow-management-files' ||
      mode === 'workflow-management-material'
    this.materialVisible = mode === 'material' || mode === 'split' ||
      mode === 'workflow-management-material' || mode === 'device-material'
    this.deviceVisible = mode === 'device' || mode === 'device-material'
    this.exclusiveDomain = mode === 'operation' || mode === 'robot-debug' ||
      mode === 'robot-points' || mode === 'workflow-tasks' ||
      mode === 'robot-bench' || mode === 'robot-reagents' ? mode : null
  }
}

const WORKBENCH_MODE_STORAGE_KEY = 'unilab.workbench.view-mode'
const WORKBENCH_MODES = new Set<WorkbenchViewMode>([
  'files', 'workflow-files', 'workflow-management-files',
  'workflow', 'material', 'device', 'robot-debug', 'operation',
  'robot-points', 'workflow-management', 'workflow-tasks', 'robot-bench',
  'robot-reagents', 'split', 'workflow-management-material', 'device-material'
])

function readSavedWorkbenchMode(): WorkbenchViewMode | null {
  try {
    const value = globalThis.localStorage?.getItem(WORKBENCH_MODE_STORAGE_KEY) ??
      globalThis.sessionStorage?.getItem(WORKBENCH_MODE_STORAGE_KEY)
    return value && WORKBENCH_MODES.has(value as WorkbenchViewMode)
      ? value as WorkbenchViewMode
      : null
  } catch { return null }
}

function saveWorkbenchMode(mode: WorkbenchViewMode): void {
  try {
    globalThis.localStorage?.setItem(WORKBENCH_MODE_STORAGE_KEY, mode)
    globalThis.sessionStorage?.setItem(WORKBENCH_MODE_STORAGE_KEY, mode)
  } catch { /* ignore */ }
}


/** 仅工作流调试入口启用调试型布局；工作流管理保持目录管理界面。 */
export function isWorkflowDebugWorkbenchView(
  mode: WorkbenchViewMode
): boolean {
  return mode === 'workflow-files' || mode === 'workflow' || mode === 'split'
}

/** 仅工作流管理入口展示目录管理界面，不复用调试画布状态。 */
export function isWorkflowManagementWorkbenchView(
  mode: WorkbenchViewMode
): boolean {
  return mode === 'workflow-management' ||
    mode === 'workflow-management-files' ||
    mode === 'workflow-management-material'
}
/** 判断当前是否为允许用户关闭任一侧的双领域分栏。 */
function isSplitWorkbenchView(mode: WorkbenchViewMode): boolean {
  return mode === 'workflow-files' || mode === 'workflow-management-files' ||
    mode === 'split' || mode === 'workflow-management-material' ||
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
