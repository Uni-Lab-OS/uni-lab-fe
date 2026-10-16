import type {
  HumanInteractionInput,
  HumanInteractionKind,
  HumanInteractionOption,
  HumanInteractionReplyBody,
  HumanInteractionStatus,
  HumanReviewForm,
  WorkflowHumanInteraction,
} from './model'

const KINDS: readonly HumanInteractionKind[] = ['choose', 'text', 'numbers', 'sketch', 'review']
const STATUSES: readonly HumanInteractionStatus[] = ['pending', 'answered', 'timed_out', 'canceled']
const FORMS: readonly HumanReviewForm[] = ['none', 'text', 'numbers', 'sketch']

export class HumanInteractionInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HumanInteractionInputError'
  }
}

/** 解析 OS 冻结请求；结构不合法时抛错而不是猜默认值，避免向 OS 提交与请求不符的回复。 */
export function decodeHumanInteraction(value: unknown): WorkflowHumanInteraction {
  const raw = record(value, 'human_interaction')
  const interactionKind = oneOf(raw.kind, KINDS, 'human_interaction.kind')
  const args = record(raw.arguments ?? {}, 'human_interaction.arguments')
  const optionValues = stringArray(args.options ?? [], 'arguments.options')
  const optionLabels = stringArray(args.labels ?? [], 'arguments.labels')
  const forms =
    interactionKind === 'review'
      ? stringArray(args.forms ?? [], 'arguments.forms').map((form) =>
          oneOf(form, FORMS, 'arguments.forms'),
        )
      : optionValues.map(() => 'none' as const)
  if (
    (interactionKind === 'choose' || interactionKind === 'review') &&
    (optionValues.length === 0 ||
      optionLabels.length !== optionValues.length ||
      forms.length !== optionValues.length)
  ) {
    throw new HumanInteractionInputError('人工交互请求的选项、标签或表单数量不一致')
  }
  const options: HumanInteractionOption[] = optionValues.map((option, index) => ({
    value: option,
    label: optionLabels[index] || option,
    form: forms[index] ?? 'none',
  }))
  const numberLabels = stringArray(
    (interactionKind === 'review'
      ? args.number_labels
      : interactionKind === 'numbers'
        ? args.labels
        : []) ?? [],
    'arguments.number_labels',
  )
  const numberDefaults = numberArray(
    (interactionKind === 'review'
      ? args.number_defaults
      : interactionKind === 'numbers'
        ? args.defaults
        : []) ?? [],
    'arguments.number_defaults',
  )
  if (numberDefaults.length !== numberLabels.length) {
    throw new HumanInteractionInputError('人工交互请求的数值标签与默认值数量不一致')
  }
  const result = raw.result
  return {
    kind: 'workflow_human_interaction',
    source: 'os',
    interactionUuid: text(raw.uuid, 'human_interaction.uuid'),
    jobUuid: text(raw.job_uuid, 'human_interaction.job_uuid'),
    taskUuid: text(raw.task_uuid, 'human_interaction.task_uuid'),
    interactionKind,
    status: oneOf(raw.status, STATUSES, 'human_interaction.status'),
    prompt: typeof args.prompt === 'string' ? args.prompt : '',
    image: typeof args.image === 'string' ? args.image : '',
    options: interactionKind === 'choose' || interactionKind === 'review' ? options : [],
    textDefault: String((interactionKind === 'review' ? args.text_default : args.default) ?? ''),
    numberLabels,
    numberDefaults,
    openedAt: text(raw.opened_at, 'human_interaction.opened_at'),
    deadlineAt: text(raw.deadline_at, 'human_interaction.deadline_at'),
    decidedAt: typeof raw.decided_at === 'string' ? raw.decided_at : null,
    result: isRecord(result) ? result : null,
    raw,
  }
}

/** 选项要求的表单；choose 恒为 none。 */
export function formForChoice(
  interaction: WorkflowHumanInteraction,
  choice: string,
): HumanReviewForm {
  return interaction.options.find((option) => option.value === choice)?.form ?? 'none'
}

/**
 * 按 OS 校验规则构造回复体（human_commands.HumanInteractionStore.validate）。
 * review 必须带齐七个字段：未用到的文本/数值取请求默认值，非手绘选项的坐标为空数组。
 */
export function buildHumanInteractionReply(
  interaction: WorkflowHumanInteraction,
  input: HumanInteractionInput,
): HumanInteractionReplyBody {
  switch (interaction.interactionKind) {
    case 'choose':
      return { choice: requireChoice(interaction, input.choice) }
    case 'text':
      return { text: requireText(input.text ?? interaction.textDefault) }
    case 'numbers':
      return { values: requireValues(interaction, input.values) }
    case 'sketch':
      return sketchBody(requireSketch(input.sketch))
    case 'review': {
      const choice = requireChoice(interaction, input.choice)
      const form = formForChoice(interaction, choice)
      const sketch =
        form === 'sketch' ? sketchBody(requireSketch(input.sketch)) : sketchBody(EMPTY_SKETCH)
      return {
        choice,
        text: requireText(
          form === 'text' ? (input.text ?? interaction.textDefault) : interaction.textDefault,
        ),
        values:
          form === 'numbers'
            ? requireValues(interaction, input.values)
            : [...interaction.numberDefaults],
        ...sketch,
      }
    }
  }
}

const EMPTY_SKETCH: HumanSketchLike = { x: [], y: [], cornerX: [], cornerY: [] }

interface HumanSketchLike {
  readonly x: readonly number[]
  readonly y: readonly number[]
  readonly cornerX: readonly number[]
  readonly cornerY: readonly number[]
}

function sketchBody(sketch: HumanSketchLike): HumanInteractionReplyBody {
  return {
    x: [...sketch.x],
    y: [...sketch.y],
    corner_x: [...sketch.cornerX],
    corner_y: [...sketch.cornerY],
  }
}

function requireChoice(interaction: WorkflowHumanInteraction, choice: string | undefined): string {
  if (!choice || !interaction.options.some((option) => option.value === choice)) {
    throw new HumanInteractionInputError('请选择一个本次请求提供的选项')
  }
  return choice
}

function requireText(value: string): string {
  if (value.length > 4096) throw new HumanInteractionInputError('文本不能超过 4096 个字符')
  return value
}

function requireValues(
  interaction: WorkflowHumanInteraction,
  values: readonly number[] | undefined,
): number[] {
  const result = [...(values ?? interaction.numberDefaults)]
  if (result.length !== interaction.numberLabels.length) {
    throw new HumanInteractionInputError(`需要填写 ${interaction.numberLabels.length} 个数值`)
  }
  const invalid = result.findIndex((value) => typeof value !== 'number' || !Number.isFinite(value))
  if (invalid >= 0) {
    throw new HumanInteractionInputError(`“${interaction.numberLabels[invalid]}”必须是有限数值`)
  }
  return result
}

function requireSketch(sketch: HumanSketchLike | undefined): HumanSketchLike {
  if (!sketch || sketch.x.length < 3 || sketch.x.length !== sketch.y.length) {
    throw new HumanInteractionInputError('手绘轮廓至少需要 3 个点')
  }
  if (![0, 4].includes(sketch.cornerX.length) || sketch.cornerX.length !== sketch.cornerY.length) {
    throw new HumanInteractionInputError('板角需为 0 个，或按左上、右上、右下、左下标出 4 个')
  }
  const all = [...sketch.x, ...sketch.y, ...sketch.cornerX, ...sketch.cornerY]
  if (all.length > 4000 * 4 || all.some((value) => !Number.isFinite(value))) {
    throw new HumanInteractionInputError('手绘坐标无效')
  }
  return sketch
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new HumanInteractionInputError(`${field} 不是对象`)
  return value
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new HumanInteractionInputError(`${field} 缺失`)
  return value
}

function oneOf<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  field: string,
): Value {
  if (typeof value !== 'string' || !allowed.includes(value as Value)) {
    throw new HumanInteractionInputError(`${field} 不是已知取值：${String(value)}`)
  }
  return value as Value
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new HumanInteractionInputError(`${field} 不是字符串数组`)
  }
  return value as string[]
}

function numberArray(value: unknown, field: string): number[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
  ) {
    throw new HumanInteractionInputError(`${field} 不是有限数值数组`)
  }
  return value as number[]
}
