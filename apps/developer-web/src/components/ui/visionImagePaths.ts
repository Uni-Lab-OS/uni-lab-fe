/**
 * 从作业的输入、输出、错误信息里找出相机留图地址。
 *
 * 设备包的相机设备经 OS 设备文件路由开放留图：`/api/v1/devices/{设备}/files/{根名}/{相对路径}`
 * （刮粉紫外相机 imaging 的 images/photos、视觉标定相机 vision 的 plate、展缸相机 liquid_vision 的 tanks）；
 * 旧版设备包的 `/api/vision/image/...`、`/api/vision/plate/...` 仍然识别。结果字段与报错文本里都可能出现。
 * 这里只认这些前缀下的 png/jpg（路径可含百分号编码，如中文样品名），不含 `..`，最多取前 `limit` 张。
 */
const VISION_IMAGE =
  /\/api\/(?:vision\/(?:image|plate)|v1\/devices\/[A-Za-z0-9_-]+\/files\/[A-Za-z0-9_-]+)\/[A-Za-z0-9_.%/-]+?\.(?:png|jpe?g)(?![A-Za-z0-9_.%/-])/gi

export function extractVisionImagePaths(value: unknown, limit = 12): string[] {
  const found = new Set<string>()
  const visit = (current: unknown, depth: number) => {
    if (found.size >= limit || depth > 8) return
    if (typeof current === 'string') {
      for (const match of current.matchAll(VISION_IMAGE)) {
        if (!match[0].includes('..')) found.add(match[0])
        if (found.size >= limit) return
      }
    } else if (Array.isArray(current)) {
      current.forEach((item) => visit(item, depth + 1))
    } else if (current && typeof current === 'object') {
      Object.values(current).forEach((item) => visit(item, depth + 1))
    }
  }
  visit(value, 0)
  return [...found]
}

const IMAGE_LABELS: Record<string, string> = {
  'calibration.png': '识别标注',
  'original.jpg': '原图',
  'overlay.png': '识别叠加',
  'raw.png': '原图',
  'mask.png': '二值掩膜',
  'hist.png': '灰度直方图',
}

/** 给操作员看的图片名：已知留图用中文名，其余用文件名。 */
export function visionImageLabel(path: string): string {
  const name = path.split('/').pop() ?? path
  return IMAGE_LABELS[name] ?? name
}
