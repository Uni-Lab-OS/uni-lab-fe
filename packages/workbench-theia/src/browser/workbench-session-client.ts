import { Emitter, type Event } from '@theia/core/lib/common/event'
import { injectable } from '@theia/core/shared/inversify'
import type { WorkbenchSessionSnapshot } from '@unilab/workbench-session'

import {
  MATERIAL_RENDERER_CONTRACT,
  type MaterialRendererRequest,
  type MaterialRendererResponse,
  type WorkbenchSessionClient,
  type WorkbenchSessionServer
} from '../common/workbench-session-protocol'

export type MaterialRendererHandler = (
  request: MaterialRendererRequest
) => Promise<MaterialRendererResponse>

/** Frontend projection of the event-driven managed OS session state. */
@injectable()
export class WorkbenchSessionClientImpl implements WorkbenchSessionClient {
  private readonly changeEmitter = new Emitter<WorkbenchSessionSnapshot>()
  private materialRendererHandler: MaterialRendererHandler | null = null
  private server: WorkbenchSessionServer | null = null

  readonly onSessionChanged: Event<WorkbenchSessionSnapshot> =
    this.changeEmitter.event

  onDidChange(snapshot: WorkbenchSessionSnapshot): void {
    this.changeEmitter.fire(snapshot)
  }

  setServer(server: WorkbenchSessionServer): void {
    this.server = server
  }

  /** 安装当前挂载的唯一物料 renderer；React 重载时旧 disposer 不会清掉新实例。 */
  setMaterialRendererHandler(handler: MaterialRendererHandler): {
    dispose(): void
  } {
    this.materialRendererHandler = handler
    return {
      dispose: () => {
        if (this.materialRendererHandler === handler) {
          this.materialRendererHandler = null
        }
      }
    }
  }

  onMaterialRendererRequest(request: MaterialRendererRequest): void {
    void this.handleMaterialRendererRequest(request).then(response =>
      this.server?.completeMaterialRendererRequest(response)
    )
  }

  private async handleMaterialRendererRequest(
    request: MaterialRendererRequest
  ): Promise<MaterialRendererResponse> {
    const handler = this.materialRendererHandler
    if (!handler) {
      return {
        schemaVersion: MATERIAL_RENDERER_CONTRACT,
        requestId: request.requestId,
        ok: false,
        error: {
          code: 'material_renderer_not_mounted',
          message: '请先在 UniLab Workbench 打开物料画布'
        }
      }
    }
    try {
      return await handler(request)
    } catch (cause) {
      return {
        schemaVersion: MATERIAL_RENDERER_CONTRACT,
        requestId: request.requestId,
        ok: false,
        error: {
          code: 'material_renderer_failed',
          message: cause instanceof Error ? cause.message : String(cause)
        }
      }
    }
  }
}
