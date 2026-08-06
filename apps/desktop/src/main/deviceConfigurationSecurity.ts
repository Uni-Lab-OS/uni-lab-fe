/**
 * 生成允许进入候选本地设备接入持久记录的非秘密配置投影。
 *
 * @param schema OS 从 PackageCatalog 投影的封闭配置 Schema。
 * @param configuration 已经短暂交给 CLI stdin 的本次设备配置。
 * @returns 只包含 Schema 已知且未标记为秘密字段的深拷贝。
 */
export function persistentDeviceConfiguration(
  schema: Record<string, unknown>,
  configuration: Record<string, unknown>
): Record<string, unknown> {
  const properties = record(schema.properties)
  const persistent: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(configuration)) {
    const property = record(properties[name])
    if (Object.keys(property).length === 0) continue
    if (property['x-unilab-secret'] === true) continue
    persistent[name] = structuredClone(value)
  }
  return persistent
}

/**
 * 把未知值收窄为 object；无效 Schema 失败关闭为无可持久字段。
 *
 * @param value Schema 中的未知子值。
 * @returns object 原值或空对象。
 */
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
