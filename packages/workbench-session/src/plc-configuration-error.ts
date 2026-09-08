/** Workspace Host 在未配置 PLC-Sim 项目或变量表时返回的稳定错误码。 */
export const PLC_CONFIGURATION_MISSING_CODE = 'plc_configuration_missing'

/**
 * 判断 Workspace Host 是否因未配置 PLC-Sim 而拒绝启动。
 *
 * @param error 前端捕获的 Host 操作错误。
 * @returns 仅当错误码为 `plc_configuration_missing` 时为 true。
 */
export function isPlcConfigurationMissingError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return text.includes(`[${PLC_CONFIGURATION_MISSING_CODE}]`)
}
