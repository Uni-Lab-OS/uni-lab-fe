import { useEffect, useRef, useState } from 'react'
import SmilesDrawer from 'smiles-drawer'

import styles from '../workstation.module.scss'

type RenderState = 'drawing' | 'ready' | 'invalid'

/** 将后端返回的 SMILES 在浏览器本地绘制成紧凑的二维结构图。 */
export function MoleculeStructure2D({
  name,
  smiles,
  size = 'default'
}: {
  name: string
  smiles?: string
  size?: 'default' | 'compact'
}): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const [state, setState] = useState<RenderState>(smiles ? 'drawing' : 'invalid')

  useEffect(() => {
    const svg = svgRef.current
    const normalized = smiles?.trim()
    if (!svg || !normalized) {
      setState('invalid')
      return
    }

    let active = true
    svg.replaceChildren()
    setState('drawing')
    SmilesDrawer.parse(normalized, tree => {
      if (!active) return
      const drawer = new SmilesDrawer.SvgDrawer({
        width: 148,
        height: 88,
        bondLength: 18,
        bondThickness: 1.1,
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSizeLarge: 10,
        fontSizeSmall: 5,
        padding: 8,
        compactDrawing: true
      })
      drawer.draw(tree, svg, 'light')
      setState('ready')
    }, () => {
      if (active) setState('invalid')
    })

    return () => { active = false }
  }, [smiles])

  const fallback = smiles ? 'SMILES 无法解析' : '暂无结构'
  return (
    <figure
      className={styles.moleculeStructure}
      data-state={state}
      data-size={size}
      title={smiles}
      aria-label={smiles ? `${name} 的二维分子结构` : `${name} 暂无二维分子结构`}
    >
      <svg ref={svgRef} viewBox="0 0 148 88" data-smiles={smiles} aria-hidden="true" />
      {state === 'drawing' ? <span role="status">正在绘制…</span> : null}
      {state === 'invalid' ? <span>{fallback}</span> : null}
    </figure>
  )
}
