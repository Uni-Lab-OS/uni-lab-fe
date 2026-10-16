import { useRef, useState, type MouseEvent } from 'react'
import { clsx } from 'clsx'
import type { HumanSketchInput } from '@unilab-fe/core'
import styles from './TaskHumanInteraction.module.scss'

export type SketchMode = 'contour' | 'corners'

export const CORNER_LABELS = ['左上', '右上', '右下', '左下'] as const

export const EMPTY_SKETCH: HumanSketchInput = { x: [], y: [], cornerX: [], cornerY: [] }

export interface ImageState {
  readonly status: 'loading' | 'loaded' | 'error'
  readonly width: number
  readonly height: number
}

/**
 * 在 OS 图片上标点。坐标始终换算为图片原始像素（naturalWidth/Height），
 * 与显示缩放、容器滚动和设备像素比无关；不提交 CSS 屏幕坐标。
 */
export function SketchCanvas({
  src,
  mode,
  value,
  editable,
  onChange,
  onImageState,
}: {
  src: string
  mode: SketchMode
  value: HumanSketchInput
  editable: boolean
  onChange: (next: HumanSketchInput) => void
  onImageState?: (state: ImageState) => void
}) {
  const [image, setImage] = useState<ImageState>({ status: 'loading', width: 0, height: 0 })
  const overlay = useRef<SVGSVGElement | null>(null)

  const update = (next: ImageState) => {
    setImage(next)
    onImageState?.(next)
  }

  const addPoint = (event: MouseEvent<SVGSVGElement>) => {
    if (!editable || image.status !== 'loaded' || !overlay.current) return
    const point = toImagePixel(
      overlay.current.getBoundingClientRect(),
      event.clientX,
      event.clientY,
      image,
    )
    if (!point) return
    if (mode === 'contour') {
      onChange({ ...value, x: [...value.x, point.x], y: [...value.y, point.y] })
    } else if (value.cornerX.length < 4) {
      onChange({
        ...value,
        cornerX: [...value.cornerX, point.x],
        cornerY: [...value.cornerY, point.y],
      })
    }
  }

  const radius = Math.max(4, Math.round(Math.max(image.width, image.height) / 160))
  const contour = value.x.map((x, index) => `${x},${value.y[index]}`).join(' ')

  return (
    <div className={clsx(styles['sketch-frame'])}>
      <img
        src={src}
        alt="人工复核图片"
        className={clsx(styles['sketch-image'])}
        onLoad={(event) =>
          update({
            status: 'loaded',
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
        onError={() => update({ status: 'error', width: 0, height: 0 })}
      />
      {image.status === 'loaded' && (
        <svg
          ref={overlay}
          className={clsx(styles['sketch-overlay'], editable && styles['sketch-overlay-editable'])}
          viewBox={`0 0 ${image.width} ${image.height}`}
          preserveAspectRatio="none"
          role={editable ? 'application' : 'img'}
          aria-label={
            editable
              ? mode === 'contour'
                ? '点击添加轮廓点'
                : '按左上、右上、右下、左下点击板角'
              : '标注预览'
          }
          onClick={addPoint}
        >
          {value.x.length >= 2 && (
            <polygon
              className={clsx(styles['sketch-contour'])}
              points={contour}
              strokeWidth={radius / 2}
            />
          )}
          {value.x.map((x, index) => (
            <circle
              key={`c${index}`}
              className={clsx(styles['sketch-point'])}
              cx={x}
              cy={value.y[index]}
              r={radius}
            />
          ))}
          {value.cornerX.map((x, index) => (
            <g key={`k${index}`}>
              <rect
                className={clsx(styles['sketch-corner'])}
                x={x - radius}
                y={(value.cornerY[index] ?? 0) - radius}
                width={radius * 2}
                height={radius * 2}
              />
              <text
                className={clsx(styles['sketch-corner-label'])}
                x={x + radius * 1.5}
                y={(value.cornerY[index] ?? 0) - radius * 1.5}
                fontSize={radius * 4}
              >
                {CORNER_LABELS[index]}
              </text>
            </g>
          ))}
        </svg>
      )}
      {image.status === 'loading' && <p className={clsx(styles['sketch-status'])}>图片加载中…</p>}
    </div>
  )
}

/** 屏幕坐标 → 图片原始像素；点在图片外返回 null。保留一位小数。 */
export function toImagePixel(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
  image: Pick<ImageState, 'width' | 'height'>,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  const x = ((clientX - rect.left) / rect.width) * image.width
  const y = ((clientY - rect.top) / rect.height) * image.height
  if (x < 0 || y < 0 || x > image.width || y > image.height) return null
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
}
