import { useMemo } from 'react'
import { clsx } from 'clsx'
import { Image } from 'antd'
import { useBackend } from '../../app/BackendProvider'
import { extractVisionImagePaths, visionImageLabel } from './visionImagePaths'
import styles from './VisionImages.module.scss'

/**
 * 拍照留图缩略图：从 `source`（作业输入/输出/错误信息等任意 JSON 或文本）里找出视觉留图，
 * 点击放大，可在同组图片间切换。没有留图时不渲染任何内容。
 * 图片地址经后端的资源地址解析（与人工复核图片同一规则），跨域或本地路径不会被加载。
 */
export function VisionImages({ source, title = '拍照留图' }: { source: unknown; title?: string }) {
  const { backend } = useBackend()
  const paths = useMemo(() => extractVisionImagePaths(source), [source])
  if (paths.length === 0) return null
  const resolver = backend.core.humanInteractions
  const images = paths.flatMap((path) => {
    const url = resolver.resolveImageUrl(path)
    return url ? [{ path, url, label: visionImageLabel(path) }] : []
  })
  if (images.length === 0) return null
  return (
    <section className={clsx(styles['vision-images'])} aria-label={title}>
      <h4 className={clsx(styles['vision-images-title'])}>{title}</h4>
      <Image.PreviewGroup>
        <div className={clsx(styles['vision-images-list'])}>
          {images.map((image) => (
            <figure key={image.path} className={clsx(styles['vision-image'])}>
              <Image
                src={image.url}
                alt={image.label}
                width={148}
                height={110}
                style={{ objectFit: 'contain' }}
              />
              <figcaption title={image.path}>{image.label}</figcaption>
            </figure>
          ))}
        </div>
      </Image.PreviewGroup>
    </section>
  )
}
