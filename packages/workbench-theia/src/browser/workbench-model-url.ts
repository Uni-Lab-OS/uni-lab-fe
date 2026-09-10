/**
 * 把领域包发布的模型路径解析到当前 Workbench 后端代理。
 * @param backendUrl Workbench 当前调度权威的 API 根地址，可能包含同源代理前缀。
 * @param modelPath 领域包或后端目录投影给出的绝对/根相对模型路径。
 * @returns 可由浏览器直接读取且保留代理前缀的模型 URL。
 */
export function resolveWorkbenchModelUrl(
  backendUrl: string,
  modelPath: string,
  topologyDigest?: string | null
): string {
  if (!modelPath || /^https?:\/\//u.test(modelPath)) return modelPath
  const normalizedBackend = backendUrl.replace(/\/+$/u, '')
  const base = modelPath.startsWith('/')
    ? `${normalizedBackend}${modelPath}`
    : new URL(modelPath, `${normalizedBackend}/`).toString()
  const digest = topologyDigest?.trim()
  if (!digest || !modelPath.includes('/kinematic-models/')) return base
  const url = new URL(base)
  url.searchParams.set('v', digest)
  return url.toString()
}
