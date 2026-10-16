/** OS HumanCommands 的五种人工交互；结果只能由操作员提交，OS 校验后才继续调度。 */
export type HumanInteractionKind = 'choose' | 'text' | 'numbers' | 'sketch' | 'review'

/** pending 才可回复；answered/timed_out/canceled 为终态，以 OS 持久投影为准。 */
export type HumanInteractionStatus = 'pending' | 'answered' | 'timed_out' | 'canceled'

/** review 每个选项附带的表单：none 直接提交，其余要求操作员补充对应输入。 */
export type HumanReviewForm = 'none' | 'text' | 'numbers' | 'sketch'

export interface HumanInteractionOption {
  readonly value: string
  readonly label: string
  /** 仅 review 有表单；choose 选项恒为 none。 */
  readonly form: HumanReviewForm
}

/** OS 冻结的人工交互请求（GET /workflow-tasks/{task}/human-interactions 的一项）。 */
export interface WorkflowHumanInteraction {
  readonly kind: 'workflow_human_interaction'
  readonly source: 'os'
  readonly interactionUuid: string
  readonly jobUuid: string
  readonly taskUuid: string
  readonly interactionKind: HumanInteractionKind
  readonly status: HumanInteractionStatus
  readonly prompt: string
  /** OS 给出的图片引用（通常是 /api/vision/image/... 相对路径）；空串表示无图。 */
  readonly image: string
  readonly options: readonly HumanInteractionOption[]
  /** text 的默认值，或 review 中“text”表单的默认值。 */
  readonly textDefault: string
  /** numbers 的标签，或 review 中“numbers”表单的标签。 */
  readonly numberLabels: readonly string[]
  readonly numberDefaults: readonly number[]
  readonly openedAt: string
  readonly deadlineAt: string
  readonly decidedAt: string | null
  readonly result: Readonly<Record<string, unknown>> | null
  readonly raw: Readonly<Record<string, unknown>>
}

/** 草图坐标均为图片原始像素；轮廓至少 3 点，板角为 0 个或按左上、右上、右下、左下 4 个。 */
export interface HumanSketchInput {
  readonly x: readonly number[]
  readonly y: readonly number[]
  readonly cornerX: readonly number[]
  readonly cornerY: readonly number[]
}

/** 操作员在界面上的输入；按交互类型取用相关字段。 */
export interface HumanInteractionInput {
  readonly choice?: string
  readonly text?: string
  readonly values?: readonly number[]
  readonly sketch?: HumanSketchInput
}

/** 提交给 OS 的回复体，字段名与 OS HumanInteractionReply 一致。 */
export interface HumanInteractionReplyBody {
  readonly choice?: string
  readonly text?: string
  readonly values?: readonly number[]
  readonly x?: readonly number[]
  readonly y?: readonly number[]
  readonly corner_x?: readonly number[]
  readonly corner_y?: readonly number[]
}
