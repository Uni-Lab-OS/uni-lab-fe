import { useId, useRef, useState } from 'react'
import { Button } from '@unilab/design-system'

import type { ReagentPhysicalState } from '../types'
import styles from '../workstation.module.scss'

const PHYSICAL_STATE_OPTIONS: readonly {
  value: ReagentPhysicalState
  label: string
}[] = [
  { value: 'unknown', label: '未确定' },
  { value: 'liquid', label: '液体' },
  { value: 'solid', label: '固体' },
  { value: 'gas', label: '气体' }
]

/** 使用工作台视觉与完整键盘语义选择试剂常温物态。 */
export function PhysicalStateSelect({
  name,
  defaultValue
}: {
  name: string
  defaultValue: ReagentPhysicalState
}): React.JSX.Element {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const initialValue = PHYSICAL_STATE_OPTIONS.some(option => option.value === defaultValue)
    ? defaultValue
    : 'unknown'
  const [value, setValue] = useState<ReagentPhysicalState>(initialValue)
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom')
  const [highlightedIndex, setHighlightedIndex] = useState(() =>
    Math.max(0, PHYSICAL_STATE_OPTIONS.findIndex(option => option.value === initialValue))
  )
  const selected = PHYSICAL_STATE_OPTIONS.find(option => option.value === value) ?? PHYSICAL_STATE_OPTIONS[0]

  function openMenu(): void {
    const triggerRect = rootRef.current?.getBoundingClientRect()
    const dialogRect = rootRef.current?.closest('[role="dialog"]')?.getBoundingClientRect()
    if (triggerRect) {
      const visibleTop = Math.max(0, dialogRect?.top ?? 0)
      const visibleBottom = Math.min(globalThis.innerHeight, dialogRect?.bottom ?? globalThis.innerHeight)
      const menuHeight = PHYSICAL_STATE_OPTIONS.length * 40 + 14
      const spaceAbove = triggerRect.top - visibleTop
      const spaceBelow = visibleBottom - triggerRect.bottom
      setPlacement(spaceBelow < menuHeight && spaceAbove > spaceBelow ? 'top' : 'bottom')
    }
    setHighlightedIndex(Math.max(0, PHYSICAL_STATE_OPTIONS.findIndex(option => option.value === value)))
    setOpen(true)
  }

  function select(index: number): void {
    const option = PHYSICAL_STATE_OPTIONS[index]
    if (!option) return
    setValue(option.value)
    setHighlightedIndex(index)
    setOpen(false)
  }

  function moveHighlight(direction: 1 | -1): void {
    setHighlightedIndex(current => (
      current + direction + PHYSICAL_STATE_OPTIONS.length
    ) % PHYSICAL_STATE_OPTIONS.length)
  }

  return (
    <div
      ref={rootRef}
      className={styles.physicalStateSelect}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <input type="hidden" name={name} value={value} />
      <Button
        type="button"
        variant="outline"
        className={styles.physicalStateSelectControl}
        role="combobox"
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={open ? `${listboxId}-${PHYSICAL_STATE_OPTIONS[highlightedIndex]?.value}` : undefined}
        onClick={() => open ? setOpen(false) : openMenu()}
        onKeyDown={event => {
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
            setHighlightedIndex(PHYSICAL_STATE_OPTIONS.length - 1)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
      >
        <span className={styles.physicalStateSelectValue}>
          <i aria-hidden="true" data-state={selected.value} />
          <span>{selected.label}</span>
        </span>
        <span aria-hidden="true" className={styles.reagentContainerSelectArrow} />
      </Button>
      <div className={styles.physicalStateSelectPopup} data-placement={placement} hidden={!open}>
        <div id={listboxId} role="listbox" aria-label="常温物态">
          {PHYSICAL_STATE_OPTIONS.map((option, index) => (
            <button
              key={option.value}
              id={`${listboxId}-${option.value}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              data-highlighted={index === highlightedIndex || undefined}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => select(index)}
            >
              <i aria-hidden="true" data-state={option.value} />
              <strong>{option.label}</strong>
              {option.value === value ? <b aria-hidden="true">✓</b> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
