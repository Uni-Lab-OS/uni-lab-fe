import type { IconColor, IconProps, IconSize, IconWeight } from './types'
import type { ResolvedIconData } from './generated/iconLoader'

export type IconRenderProps = Omit<IconProps, 'name'>

const sizeClasses: Record<Exclude<IconSize, number>, string> = {
  sm: 'bh-icon--sm',
  md: 'bh-icon--md',
  lg: 'bh-icon--lg',
  xl: 'bh-icon--xl',
}

const colorClasses: Record<IconColor, string> = {
  context: 'bh-icon--context',
  default: 'bh-icon--default',
  primary: 'bh-icon--primary',
  white: 'bh-icon--white',
  error: 'bh-icon--error',
  success: 'bh-icon--success',
  inherit: 'bh-icon--inherit',
}

const weightClasses: Record<IconWeight, string> = {
  default: 'bh-icon--default-weight',
  strong: 'bh-icon--strong',
  medium: 'bh-icon--medium',
  compact: 'bh-icon--compact',
  detail: 'bh-icon--detail',
  hairline: 'bh-icon--hairline',
}

export function IconSvg({
  data,
  ...props
}: { data: ResolvedIconData } & IconRenderProps): React.JSX.Element {
  const {
    size = 24,
    color,
    weight = 'default',
    title,
    decorative,
    className,
    style,
    ...svgProps
  } = props
  const isDecorative = decorative ?? !title
  const classes = [
    'bh-icon',
    typeof size === 'string' ? sizeClasses[size] : undefined,
    colorClasses[color ?? 'context'],
    weightClasses[weight],
    className,
  ]
    .filter(Boolean)
    .join(' ')
  const pixelSize = typeof size === 'number' ? `${size}px` : undefined
  const mergedStyle = {
    ...style,
    ...(pixelSize ? { '--bh-icon-size': pixelSize } : {}),
  } as React.CSSProperties

  return (
    <svg
      {...svgProps}
      className={classes}
      style={mergedStyle}
      viewBox={data.viewBox}
      fill="none"
      focusable="false"
      role={isDecorative ? undefined : 'img'}
      aria-hidden={isDecorative ? true : undefined}
      aria-label={isDecorative ? undefined : title}
      xmlns="http://www.w3.org/2000/svg"
      dangerouslySetInnerHTML={
        title
          ? { __html: `<title>${escapeTitle(title)}</title>${data.body}` }
          : { __html: data.body }
      }
    />
  )
}

function escapeTitle(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  )
}
