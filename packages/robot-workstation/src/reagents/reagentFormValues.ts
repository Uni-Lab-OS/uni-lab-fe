/**
 * 使用 CAS 标准校验位算法拒绝明显无效身份。
 * @param value 用户输入的 CAS 号。
 * @returns 格式与校验位都有效时返回 true。
 */
export function isValidCAS(value: string): boolean {
  if (!/^\d{2,7}-\d{2}-\d$/.test(value)) return false
  const digits = value.replaceAll('-', '')
  const expected = Number(digits.at(-1))
  const body = digits.slice(0, -1)
  let sum = 0
  for (let index = body.length - 1, weight = 1; index >= 0; index -= 1, weight += 1) {
    sum += Number(body[index]) * weight
  }
  return sum % 10 === expected
}

/**
 * 读取去空白文本字段。
 * @param form 浏览器表单值。
 * @param name 字段名称。
 * @returns 去除首尾空白后的字符串。
 */
export function textValue(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim()
}

/**
 * 读取可选数值；空输入保持未提供。
 * @param value 浏览器表单原始字段值。
 * @returns 数值或 undefined；有限性由调用方按领域约束校验。
 */
export function optionalNumber(
  value: FormDataEntryValue | null
): number | undefined {
  const text = String(value ?? '').trim()
  return text ? Number(text) : undefined
}
