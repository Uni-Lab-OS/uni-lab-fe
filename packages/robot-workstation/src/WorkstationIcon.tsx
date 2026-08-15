import type { SVGProps } from 'react'

export type WorkstationIconName =
  | 'arm'
  | 'bench'
  | 'chevron'
  | 'download'
  | 'edit'
  | 'file'
  | 'flask'
  | 'folder'
  | 'jog'
  | 'map'
  | 'material'
  | 'plus'
  | 'point'
  | 'save'
  | 'search'
  | 'shield'
  | 'site'
  | 'stop'
  | 'history'
  | 'close'
  | 'trash'

/** 渲染工作站统一线性图标，图标不单独承担状态含义。 */
export function WorkstationIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: WorkstationIconName }): React.JSX.Element {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.7,
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...props}>
      <g {...common}>{iconPath(name)}</g>
    </svg>
  )
}

/** 返回指定图标的 SVG 路径片段。 */
function iconPath(name: WorkstationIconName): React.JSX.Element {
  switch (name) {
    case 'arm':
      return (
        <>
          <path d="M4 20h16M8 20v-3l3-2 1-5 4-2 2 2-3 4-1 4" />
          <circle cx="13" cy="8" r="2" />
          <path d="m18 10 2-2" />
        </>
      )
    case 'bench':
      return (
        <>
          <rect x="3" y="5" width="18" height="12" rx="2" />
          <path d="M8 17v3M16 17v3M3 10h18M9 5v5" />
        </>
      )
    case 'chevron':
      return <path d="m9 6 6 6-6 6" />
    case 'download':
      return (
        <>
          <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" />
        </>
      )
    case 'edit':
      return (
        <>
          <path d="M4 20h4L19 9l-4-4L4 16z" />
          <path d="m13 7 4 4M4 20l1-5" />
        </>
      )
    case 'file':
      return (
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v5h5" />
        </>
      )
    case 'flask':
      return (
        <>
          <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" />
          <path d="M8 15h8" />
        </>
      )
    case 'folder':
      return <path d="M3 6h7l2 2h9v11H3z" />
    case 'jog':
      return (
        <>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
        </>
      )
    case 'map':
      return (
        <>
          <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
          <path d="M9 3v15m6-12v15" />
        </>
      )
    case 'material':
      return (
        <>
          <path d="m12 3 8 4-8 4-8-4z" />
          <path d="m4 7v9l8 5 8-5V7M12 11v10" />
        </>
      )
    case 'plus':
      return <path d="M12 5v14M5 12h14" />
    case 'point':
      return (
        <>
          <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="2.5" />
        </>
      )
    case 'save':
      return (
        <>
          <path d="M4 4h14l2 2v14H4z" />
          <path d="M8 4v6h8V4M8 20v-6h8v6" />
        </>
      )
    case 'search':
      return (
        <>
          <circle cx="10" cy="10" r="6" />
          <path d="m15 15 5 5" />
        </>
      )
    case 'shield':
      return (
        <>
          <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z" />
          <path d="m9 12 2 2 4-4" />
        </>
      )
    case 'site':
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M8 8h3v3H8zm5 0h3v3h-3zM8 13h3v3H8zm5 0h3v3h-3z" />
        </>
      )
    case 'stop':
      return (
        <>
          <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" />
          <path d="M9 9h6v6H9z" />
        </>
      )
    case 'history':
      return (
        <>
          <path d="M4 8V4m0 0h4M4 4l3 3a8 8 0 1 1-2 8" />
          <path d="M12 8v5l3 2" />
        </>
      )
    case 'close':
      return <path d="m6 6 12 12M18 6 6 18" />
    case 'trash':
      return (
        <>
          <path d="M4 7h16M9 3h6l1 4H8zM6 7l1 14h10l1-14M10 11v6m4-6v6" />
        </>
      )
  }
}
