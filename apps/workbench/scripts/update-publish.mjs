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

/** 解析稳定更新通道使用的三段式数字版本。 */
export function parseStableWorkbenchVersion(version, label = 'Workbench 版本') {
  if (typeof version !== 'string' || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(version)) {
    throw new Error(`${label}必须是 x.y.z 格式的稳定版本：${String(version)}`)
  }
  const parts = version.split('.').map(Number)
  if (parts.some(part => !Number.isSafeInteger(part))) {
    throw new Error(`${label}超出安全整数范围：${version}`)
  }
  return parts
}

/** 从 electron-builder 生成的 latest.yml 读取稳定版本。 */
export function readWorkbenchUpdateMetadataVersion(metadata) {
  if (typeof metadata !== 'string') {
    throw new Error('Workbench 更新元数据必须是文本')
  }
  const versionLine = metadata
    .split(/\r?\n/u)
    .find(line => /^version\s*:/u.test(line))
  if (!versionLine) {
    throw new Error('Workbench 更新元数据缺少 version')
  }
  const rawVersion = versionLine.slice(versionLine.indexOf(':') + 1).trim()
  const version = rawVersion.replace(/^(['"])(.*)\1$/u, '$2')
  parseStableWorkbenchVersion(version, '已发布 Workbench 版本')
  return version
}

/**
 * 选择下一次滚动发布版本：源码显式提升时保留源码版本，否则将线上 patch 加一。
 */
export function selectNextWorkbenchVersion(sourceVersion, publishedVersion = null) {
  const source = parseStableWorkbenchVersion(sourceVersion, '源码 Workbench 版本')
  if (publishedVersion === null) return sourceVersion

  const published = parseStableWorkbenchVersion(
    publishedVersion,
    '已发布 Workbench 版本'
  )
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] > published[index]) return sourceVersion
    if (source[index] < published[index]) break
  }

  if (published[2] === Number.MAX_SAFE_INTEGER) {
    throw new Error(`已发布 Workbench patch 版本无法继续递增：${publishedVersion}`)
  }
  return `${published[0]}.${published[1]}.${published[2] + 1}`
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

/** 筛选并校验 macOS 当前唯一分发介质 DMG。 */
export function selectMacosDmgArtifacts(names) {
  const artifacts = names.filter(name => /\.dmg$/iu.test(name))
  if (artifacts.length !== 1) {
    throw new Error(`Workbench macOS 产物必须且只能包含 1 个 DMG，实际 ${artifacts.length} 个`)
  }
  return artifacts
}
