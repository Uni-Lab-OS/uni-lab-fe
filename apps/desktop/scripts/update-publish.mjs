/** 解析安装包写入的更新源；生产产物只接受无凭据的 HTTPS 目录。 */
export function requireDesktopUpdateUrl(environment = process.env) {
  const raw = environment.UNILAB_DESKTOP_UPDATE_URL?.trim()
  if (!raw) {
    throw new Error(
      '缺少 UNILAB_DESKTOP_UPDATE_URL，拒绝生成无法更新的桌面安装包'
    )
  }
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('UNILAB_DESKTOP_UPDATE_URL 不是有效 URL')
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(
      'UNILAB_DESKTOP_UPDATE_URL 必须是无凭据、query 和 fragment 的 HTTPS 地址'
    )
  }
  return url.toString().replace(/\/$/u, '')
}
