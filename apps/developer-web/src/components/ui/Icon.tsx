import { Icon } from '@unilab/design-v2/icons'
import type { IconColor, IconName, IconSize } from '@unilab/design-v2/icons'

export interface AppIconProps {
  readonly name: IconName
  readonly size?: IconSize
  readonly color?: IconColor
  readonly title?: string
}

export function AppIcon({ name, size = 18, color = 'context', title }: AppIconProps) {
  return <Icon name={name} size={size} color={color} title={title} />
}
