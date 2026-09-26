import { IconSvg, type IconRenderProps } from './IconRenderer'
import type { ResolvedIconData } from './generated/iconLoader'

export function createStaticIcon(data: ResolvedIconData): (props: IconRenderProps) => React.JSX.Element {
  function StaticIcon(props: IconRenderProps): React.JSX.Element {
    return <IconSvg data={data} {...props} />
  }

  return StaticIcon
}
