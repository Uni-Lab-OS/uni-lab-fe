import type { MaterialId } from './types'

export interface ParsedMaterialConfig {
  valid: boolean
  value?: Record<string, unknown>
  message?: string
}

/**
 * 解析用户输入的物料配置 JSON，并拒绝数组、null 与标量。
 * @param text 配置编辑器中的 JSON 文本。
 * @returns 可提交对象或面向用户的校验原因。
 */
export function parseMaterialConfigText(text: string): ParsedMaterialConfig {
  try {
    const value: unknown = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { valid: false, message: '配置必须是一个 JSON 对象' }
    }
    return { valid: true, value: value as Record<string, unknown> }
  } catch {
    return { valid: false, message: '配置不是有效的 JSON' }
  }
}

/**
 * 从稳定父子索引收集待删除物料及全部后代身份。
 * @param rootId 用户选择的删除根物料 UUID。
 * @param childrenByParentId 物料聚合派生的父子索引。
 * @returns 以根节点开头的确定性深度优先身份列表。
 */
export function collectMaterialSubtreeIds(
  rootId: MaterialId,
  childrenByParentId: Readonly<Record<MaterialId, readonly MaterialId[]>>
): readonly MaterialId[] {
  const result: MaterialId[] = []
  const visit = (materialId: MaterialId): void => {
    result.push(materialId)
    for (const childId of childrenByParentId[materialId] ?? []) {
      visit(childId)
    }
  }
  visit(rootId)
  return result
}

/**
 * 将内部放置类型转换为用户可读标签。
 * @param kind 物料聚合中的 placement kind。
 * @returns 与物料领域语言一致的中文标签。
 */
export function materialPlacementLabel(kind: string): string {
  if (kind === 'world') return '全局坐标'
  if (kind === 'parent') return '父级对象'
  if (kind === 'site') return '库位'
  if (kind === 'unplaced') return '未放置'
  return kind
}

/**
 * 将未知异常转换为可行动的物料写入错误信息。
 * @param error 服务端口抛出的未知异常。
 * @returns 可直接展示且不伪造结果的错误文本。
 */
export function materialCrudErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '物料写入失败，请刷新后重试'
}
