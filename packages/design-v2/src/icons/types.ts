import type { SVGProps } from 'react'

import type { IconName } from './generated/manifest'

export type { IconName }

export type IconSize = 8 | 10 | 12 | 14 | 15 | 16 | 18 | 20 | 22 | 24 | 'sm' | 'md' | 'lg' | 'xl'

export type IconColor =
  | 'context'
  | 'default'
  | 'primary'
  | 'white'
  | 'error'
  | 'success'
  | 'inherit'

export type IconWeight = 'default' | 'strong' | 'medium' | 'compact' | 'detail' | 'hairline'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'title' | 'color'> {
  /** Figma component name without the `Icon/` prefix. */
  name: IconName
  /** Figma-supported pixel size, or a design-system size alias. Defaults to 24. */
  size?: IconSize
  /** Semantic icon color mapped to the current design theme. Defaults to context. */
  color?: IconColor
  /** Figma Bohr Icon stroke-width mode. Defaults to the exported default width. */
  weight?: IconWeight
  /** Accessible name. Omit for a decorative icon. */
  title?: string
  /** Set false when the surrounding control supplies the accessible name. */
  decorative?: boolean
}
