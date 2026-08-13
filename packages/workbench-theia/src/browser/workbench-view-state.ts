import { Emitter, type Event } from '@theia/core/lib/common/event'
import { injectable } from '@theia/core/shared/inversify'

export type WorkbenchDomain = 'workflow' | 'material' | 'device'
export type WorkbenchViewMode =
  | 'empty'
  | 'workflow'
  | 'material'
  | 'device'
  | 'split'

/**
 * The single UI authority for which UniLab domain surfaces are visible.
 *
 * The service contains presentation state only. Workflow, Material and OS
 * facts remain owned by their existing stores and WorkbenchSession.
 */
@injectable()
export class WorkbenchViewState {
  protected workflowVisible = true
  protected materialVisible = false
  protected deviceVisible = false
  protected readonly changeEmitter = new Emitter<WorkbenchViewMode>()

  readonly onDidChangeMode: Event<WorkbenchViewMode> = this.changeEmitter.event

  get currentMode(): WorkbenchViewMode {
    if (this.deviceVisible) return 'device'
    if (this.workflowVisible && this.materialVisible) return 'split'
    if (this.workflowVisible) return 'workflow'
    if (this.materialVisible) return 'material'
    return 'empty'
  }

  isVisible(domain: WorkbenchDomain): boolean {
    if (domain === 'workflow') return this.workflowVisible
    if (domain === 'material') return this.materialVisible
    return this.deviceVisible
  }

  /**
   * 确保指定领域工作面可见，并在已经可见时保持幂等。
   *
   * @param domain 要在主工作区聚焦的工作流、物料或仪器设备领域。
   * @returns 无返回值；仅在最终展示模式变化时发布一次事件。
   */
  show(domain: WorkbenchDomain): void {
    const previousMode = this.currentMode
    if (domain === 'device') {
      this.deviceVisible = true
    } else {
      this.deviceVisible = false
      if (domain === 'workflow') {
        this.workflowVisible = true
      } else {
        this.materialVisible = true
      }
    }
    const nextMode = this.currentMode
    if (nextMode !== previousMode) this.changeEmitter.fire(nextMode)
  }

  toggle(domain: WorkbenchDomain): void {
    const previousMode = this.currentMode
    if (domain === 'device') {
      this.deviceVisible = !this.deviceVisible
    } else {
      this.deviceVisible = false
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
