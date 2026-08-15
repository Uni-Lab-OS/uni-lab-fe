import { useId, useRef, useState } from 'react'
import { Button } from '@unilab/design-system'

import styles from '../workstation.module.scss'

export const REAGENT_QUANTITY_UNITS = ['µL', 'mL', 'L', 'mg', 'g', 'kg'] as const

type ReagentQuantityUnit = typeof REAGENT_QUANTITY_UNITS[number]

const QUANTITY_UNIT_GROUPS: readonly {
  label: string
  options: readonly ReagentQuantityUnit[]
}[] = [
  { label: '体积', options: ['µL', 'mL', 'L'] },
  { label: '质量', options: ['mg', 'g', 'kg'] }
]

/** 使用 Backend 已识别的标准单位，避免自由文本在工作流中无法匹配。 */
export function QuantityUnitSelect({
  name,
  value,
  readOnly = false,
  onChange
}: {
  name: string
  value: string
  readOnly?: boolean
  onChange: (value: ReagentQuantityUnit) => void
}): React.JSX.Element {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom')
  const selectedIndex = REAGENT_QUANTITY_UNITS.findIndex(unit => unit === value)
  const [highlightedIndex, setHighlightedIndex] = useState(Math.max(0, selectedIndex))

  function openMenu(): void {
    if (readOnly) return
    const triggerRect = rootRef.current?.getBoundingClientRect()
    const dialogRect = rootRef.current?.closest('[role="dialog"]')?.getBoundingClientRect()
    if (triggerRect) {
      const visibleTop = Math.max(0, dialogRect?.top ?? 0)
      const visibleBottom = Math.min(globalThis.innerHeight, dialogRect?.bottom ?? globalThis.innerHeight)
      const menuHeight = 260
      const spaceAbove = triggerRect.top - visibleTop
      const spaceBelow = visibleBottom - triggerRect.bottom
      setPlacement(spaceBelow < menuHeight && spaceAbove > spaceBelow ? 'top' : 'bottom')
    }
    setHighlightedIndex(Math.max(0, selectedIndex))
    setOpen(true)
  }

  function select(index: number): void {
    const unit = REAGENT_QUANTITY_UNITS[index]
    if (!unit) return
    onChange(unit)
    setHighlightedIndex(index)
    setOpen(false)
  }

  function moveHighlight(direction: 1 | -1): void {
    setHighlightedIndex(current => (
      current + direction + REAGENT_QUANTITY_UNITS.length
    ) % REAGENT_QUANTITY_UNITS.length)
  }

  return (
    <div
      ref={rootRef}
      className={styles.quantityUnitSelect}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <input type="hidden" name={name} value={value} />
      <Button
        type="button"
        variant="outline"
        className={styles.quantityUnitSelectControl}
        role="combobox"
        aria-label="计量单位"
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={open ? `${listboxId}-${REAGENT_QUANTITY_UNITS[highlightedIndex]}` : undefined}
        aria-readonly={readOnly}
        onClick={() => open ? setOpen(false) : openMenu()}
        onKeyDown={event => {
          if (readOnly) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) openMenu()
            else moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (open) select(highlightedIndex)
            else openMenu()
          } else if (event.key === 'Home' && open) {
            event.preventDefault()
            setHighlightedIndex(0)
          } else if (event.key === 'End' && open) {
            event.preventDefault()
            setHighlightedIndex(REAGENT_QUANTITY_UNITS.length - 1)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
      >
        <span data-placeholder={!value || undefined}>{value || '选择'}</span>
        {!readOnly ? <span aria-hidden="true" className={styles.reagentContainerSelectArrow} /> : null}
      </Button>
      <div className={styles.quantityUnitSelectPopup} data-placement={placement} hidden={!open}>
        <div id={listboxId} role="listbox" aria-label="计量单位">
          {QUANTITY_UNIT_GROUPS.map(group => (
            <div key={group.label} role="group" aria-label={group.label}>
              <span>{group.label}</span>
              {group.options.map(unit => {
                const index = REAGENT_QUANTITY_UNITS.indexOf(unit)
                return (
                  <button
                    key={unit}
                    id={`${listboxId}-${unit}`}
                    type="button"
                    role="option"
                    aria-selected={unit === value}
                    data-highlighted={index === highlightedIndex || undefined}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => select(index)}
                  >
                    <strong>{unit}</strong>
                    {unit === value ? <b aria-hidden="true">✓</b> : null}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
