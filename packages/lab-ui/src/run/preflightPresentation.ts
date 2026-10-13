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
  _context: PreflightMessageContext = {},
): string {
  // 数量库存的文案由 OS 写好库位名。这里再拼一句会只留下第一只瓶子。
  if (check.code === 'quantity_inventory_unavailable') return check.message
  const matched = candidates.filter(
    (candidate) =>
      check.message.includes(candidate.id) ||
      containsString(check.details, candidate.id) ||
      candidateIdentityValues(candidate.metadata).some(
        (id) => check.message.includes(id) || containsString(check.details, id),
      ),
  )
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
