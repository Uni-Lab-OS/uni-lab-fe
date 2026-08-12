/** 解析安装包写入的更新源；生产产物只接受无凭据的 HTTPS 目录。 */
export function requireWorkbenchUpdateUrl(environment = process.env) {
  const raw = environment.UNILAB_WORKBENCH_UPDATE_URL?.trim()
  if (!raw) {
    throw new Error(
      '缺少 UNILAB_WORKBENCH_UPDATE_URL，拒绝生成无法更新的 Workbench 安装包'
    )
  }
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('UNILAB_WORKBENCH_UPDATE_URL 不是有效 URL')
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(
      'UNILAB_WORKBENCH_UPDATE_URL 必须是无凭据、query 和 fragment 的 HTTPS 地址'
    )
  }
  return url.toString().replace(/\/$/u, '')
}

/** 筛选并校验 Windows/Linux 更新目录必须原子发布的完整产物集合。 */
export function selectPortableUpdateArtifacts(names, targetPlatform) {
  if (!['linux-64', 'win-64'].includes(targetPlatform)) {
    throw new Error(`不支持的 Workbench 更新平台：${targetPlatform}`)
  }
  const matcher = targetPlatform === 'linux-64'
    ? /(?:\.AppImage(?:\.blockmap)?|latest-linux\.yml)$/iu
    : /(?:-setup\.exe(?:\.blockmap)?|latest\.yml)$/iu
  const artifacts = names.filter(name => matcher.test(name))
  const metadata = targetPlatform === 'linux-64'
    ? 'latest-linux.yml'
    : 'latest.yml'
  const blockmap = targetPlatform === 'linux-64'
    ? /\.AppImage\.blockmap$/iu
    : /-setup\.exe\.blockmap$/iu
  if (!artifacts.includes(metadata)) {
    throw new Error(`Workbench 更新产物缺少 ${metadata}`)
  }
  if (!artifacts.some(name => blockmap.test(name))) {
    throw new Error(`Workbench 更新产物缺少 ${targetPlatform} blockmap`)
  }
  return artifacts
}

/** 筛选并校验 macOS updater 使用的 ZIP、blockmap 与 metadata。 */
export function selectMacosUpdateArtifacts(names) {
  const artifacts = names.filter(name =>
    /(?:\.dmg(?:\.blockmap)?|\.zip(?:\.blockmap)?|latest-mac\.yml)$/iu.test(name)
  )
  if (!artifacts.includes('latest-mac.yml')) {
    throw new Error('Workbench 更新产物缺少 latest-mac.yml')
  }
  if (!artifacts.some(name => /\.zip$/iu.test(name))) {
    throw new Error('Workbench 更新产物缺少 macOS ZIP')
  }
  if (!artifacts.some(name => /\.zip\.blockmap$/iu.test(name))) {
    throw new Error('Workbench 更新产物缺少 macOS ZIP blockmap')
  }
  return artifacts
}
