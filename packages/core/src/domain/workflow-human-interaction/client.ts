import type { RequestTransport } from '../../transport/request'
import { decodeHumanInteraction } from './codec'
import type { HumanInteractionReplyBody, WorkflowHumanInteraction } from './model'
import type { WorkflowHumanInteractionPort } from './port'

export class WorkflowHumanInteractionClient implements WorkflowHumanInteractionPort {
  constructor(
    private readonly transport: RequestTransport,
    /** 后端根地址（与 HTTP transport 相同），用于把 OS 给出的 /api/... 图片路径解析为可加载地址。 */
    private readonly assetBaseUrl: string | null = null,
    private readonly apiPrefix = '/api/v1',
  ) {}

  async listForTask(taskUuid: string): Promise<readonly WorkflowHumanInteraction[]> {
    const response = await this.transport.request<unknown>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-tasks/${encodeURIComponent(taskUuid)}/human-interactions`,
    })
    const items = unwrap(response.data)
    if (!Array.isArray(items)) throw new Error('OS 返回的人工交互列表不是数组')
    return items.map(decodeHumanInteraction)
  }

  async reply(
    interactionUuid: string,
    body: HumanInteractionReplyBody,
  ): Promise<WorkflowHumanInteraction> {
    const response = await this.transport.request<unknown>({
      method: 'POST',
      url: `${this.apiPrefix}/workflow-human-interactions/${encodeURIComponent(interactionUuid)}/reply`,
      body,
    })
    return decodeHumanInteraction(unwrap(response.data))
  }

  resolveImageUrl(image: string): string | null {
    const value = image.trim()
    if (!value) return null
    if (value.startsWith('/api/')) {
      return this.assetBaseUrl ? `${this.assetBaseUrl.replace(/\/$/, '')}${value}` : value
    }
    // 只接受与后端同源的绝对地址；本地文件路径等不可由浏览器加载，交给界面明确提示。
    if (this.assetBaseUrl && /^https?:\/\//.test(value)) {
      try {
        return new URL(value).origin === new URL(this.assetBaseUrl).origin ? value : null
      } catch {
        return null
      }
    }
    return null
  }
}

function unwrap(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'data' in value) {
    return (value as { data: unknown }).data
  }
  return value
}
