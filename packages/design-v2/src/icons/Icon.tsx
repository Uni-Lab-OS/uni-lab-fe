import { useEffect, useState } from 'react'

import { getCachedIconData, loadIconData, type ResolvedIconData } from './generated/iconLoader'
import { IconSvg } from './IconRenderer'
import type { IconProps } from './types'

const EMPTY_ICON_DATA: ResolvedIconData = {
  body: '',
  viewBox: '0 0 24 24',
}

export function Icon({ name, ...props }: IconProps): React.JSX.Element {
  const [data, setData] = useState<ResolvedIconData | undefined>(() => getCachedIconData(name))

  useEffect(() => {
    let active = true
    const cached = getCachedIconData(name)
    setData(cached)
    if (cached)
      return () => {
        active = false
      }

    loadIconData(name)
      .then((nextData) => {
        if (active) setData(nextData)
      })
      .catch(() => {
        if (active) setData(undefined)
      })

    return () => {
      active = false
    }
  }, [name])

  return <IconSvg data={data ?? EMPTY_ICON_DATA} {...props} />
}
