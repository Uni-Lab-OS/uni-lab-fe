import type { PreflightCheck, ResourceCandidate } from '@unilab-fe/core'

export interface PreflightMessageContext {
  readonly workflowInput?: Readonly<Record<string, unknown>>
}

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi

/**
 * 把后端预检中的资源身份转换成操作员能识别的名称。
 *
 * 预检结果仍以 OS 返回的 check 为准，这里只负责把 message 做展示层投影，
 * 不改变 code、status 或 blocking 语义。
 */
export function formatPreflightCheckMessage(
  check: PreflightCheck,
  candidates: readonly ResourceCandidate[] = [],
  context: PreflightMessageContext = {},
): string {
  const matched = candidates.filter(
    (candidate) =>
      check.message.includes(candidate.id) ||
      containsString(check.details, candidate.id) ||
      candidateIdentityValues(candidate.metadata).some(
        (id) => check.message.includes(id) || containsString(check.details, id),
      ),
  )
  const material = matched.find((candidate) => candidate.resourceKind === 'material')
  const inventory = matched.find((candidate) => candidate.resourceKind === 'inventory')
  const site = matched.find((candidate) => candidate.resourceKind === 'site')
  const reagentName =
    textFromMetadata(material?.metadata, ['reagent_name', 'reagentName']) ??
    textFromDetails(check.details, ['reagent_name', 'reagentName']) ??
    inventory?.label
  const containerName =
    textFromMetadata(material?.metadata, ['container_name', 'containerName']) ??
    textFromDetails(check.details, ['container_name', 'containerName']) ??
    material?.label ??
    textFromMetadata(inventory?.metadata, ['container_name', 'containerName']) ??
    site?.label

  if (
    check.code === 'quantity_inventory_unavailable' &&
    (/库存|数量|试剂|预留/.test(check.message) || hasReagentSourceField(context.workflowInput))
  ) {
    const availability = /不足|小于|不够/.test(check.message) ? '数量不足' : '没有可用数量'
    if (reagentName && containerName) {
      return `试剂“${reagentName}”在容器“${containerName}”中${availability}`
    }
    if (containerName) return `容器“${containerName}”中的试剂${availability}`

    const sourceContainer = reagentSourceContainer(context.workflowInput)
    if (sourceContainer) return `容器“${sourceContainer}”中的试剂${availability}`

    return '液体试剂来源容器未填写，无法确认试剂库存'
  }

  const replacements = matched
    .flatMap((candidate) =>
      [candidate.id, ...candidateIdentityValues(candidate.metadata)].map(
        (id) => [id, candidate.label] as const,
      ),
    )
    .sort(([left], [right]) => right.length - left.length)
  let message = replacements.reduce(
    (current, [id, label]) => current.replace(new RegExp(escapeRegExp(id), 'g'), label),
    check.message,
  )
  // 候选读取失败时也不能把原始 UUID 直接暴露给操作员。
  return message.replace(UUID_PATTERN, '相关资源')
}

function reagentSourceContainer(
  workflowInput: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  if (!workflowInput) return undefined
  const preferred = Object.entries(workflowInput).find(
    ([key, value]) =>
      /reagent/i.test(key) && /source.*site|site.*source/i.test(key) && isText(value),
  )
  if (preferred && isText(preferred[1])) return preferred[1].trim()
  return undefined
}

function hasReagentSourceField(workflowInput: Readonly<Record<string, unknown>> | undefined): boolean {
  return Object.keys(workflowInput ?? {}).some(
    (key) => /reagent/i.test(key) && /source.*site|site.*source/i.test(key),
  )
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function containsString(value: unknown, target: string): boolean {
  if (typeof value === 'string') return value === target
  if (Array.isArray(value)) return value.some((item) => containsString(item, target))
  if (!value || typeof value !== 'object') return false
  return Object.values(value).some((item) => containsString(item, target))
}

function candidateIdentityValues(metadata: Readonly<Record<string, unknown>>): string[] {
  const values: string[] = []
  for (const [key, value] of Object.entries(metadata)) {
    if (/(?:uuid|id)$/i.test(key) && typeof value === 'string' && value.length > 0) {
      values.push(value)
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      values.push(...candidateIdentityValues(value as Readonly<Record<string, unknown>>))
    }
  }
  return values
}

function textFromMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!metadata) return undefined
  return keys
    .map((key) => metadata[key])
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

function textFromDetails(
  details: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  return textFromMetadata(details, keys)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
