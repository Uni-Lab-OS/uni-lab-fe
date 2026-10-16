import type { HumanInteractionReplyBody, WorkflowHumanInteraction } from './model'

/**
 * 工作流人工交互（OS HumanCommands：choose/text/numbers/sketch/review）。
 * 与 manual_confirmation 的批准/拒绝是不同接口：这里提交的是结构化回复，
 * OS 校验并持久化后才继续调度；回复受理不等于后续设备动作已执行。
 */
export interface WorkflowHumanInteractionPort {
  listForTask(taskUuid: string): Promise<readonly WorkflowHumanInteraction[]>
  reply(interactionUuid: string, body: HumanInteractionReplyBody): Promise<WorkflowHumanInteraction>
  /** 把 OS 给出的图片引用解析为浏览器可加载的地址；不是可访问的 URL 时返回 null。 */
  resolveImageUrl(image: string): string | null
}
