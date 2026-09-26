import { useMemo, useState } from 'react'
import {
  ICON_CATEGORIES,
  ICON_MANIFEST,
  ICON_NAMES,
  Icon,
  type IconName,
  type IconColor,
} from '@unilab/design-v2/icons'

const INITIAL_RESULT_LIMIT = 120
const RESULT_STEP = 120

const COLOR_OPTIONS: Array<{ value: IconColor; label: string; variable: string }> = [
  { value: 'context', label: 'Context', variable: '--bh-color-icon-context' },
  { value: 'default', label: 'Default', variable: '--bh-color-icon-default' },
  { value: 'primary', label: 'Primary', variable: '--bh-color-primary' },
  { value: 'white', label: 'White', variable: '--bh-color-primary-white' },
  { value: 'error', label: 'Error', variable: '--bh-color-error-default' },
  { value: 'success', label: 'Success', variable: '--bh-color-success-default' },
  { value: 'inherit', label: 'Inherit', variable: 'currentColor' },
]

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase()
}

export function IconGallery(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [color, setColor] = useState<IconColor>('primary')
  const [customColor, setCustomColor] = useState('#4654e8')
  const [useCustomColor, setUseCustomColor] = useState(false)
  const [resultLimit, setResultLimit] = useState(INITIAL_RESULT_LIMIT)

  const normalizedQuery = normalizeSearch(query)
  const filteredNames = useMemo(() => ICON_NAMES.filter((name) => {
    const entry = ICON_MANIFEST[name]
    const matchesCategory = category === 'all' || entry.categorySlug === category
    if (!matchesCategory) return false
    if (!normalizedQuery) return true
    return [name, entry.figmaName, entry.category].some((value) => normalizeSearch(value).includes(normalizedQuery))
  }), [category, normalizedQuery])

  const visibleNames = filteredNames.slice(0, resultLimit)
  const selectedColor = COLOR_OPTIONS.find((option) => option.value === color)
  const iconStyle = useCustomColor ? ({ '--bh-icon-color': customColor } as React.CSSProperties) : undefined

  const clearFilters = (): void => {
    setQuery('')
    setCategory('all')
    setColor('primary')
    setCustomColor('#4654e8')
    setUseCustomColor(false)
    setResultLimit(INITIAL_RESULT_LIMIT)
  }

  const updateQuery = (value: string): void => {
    setQuery(value)
    setResultLimit(INITIAL_RESULT_LIMIT)
  }

  const updateCategory = (value: string): void => {
    setCategory(value)
    setResultLimit(INITIAL_RESULT_LIMIT)
  }

  return (
    <section className="icon-gallery" aria-labelledby="icon-gallery-title">
      <header className="icon-gallery-header">
        <div>
          <span className="eyebrow">ICON LIBRARY / FIGMA EXPORT</span>
          <h2 id="icon-gallery-title">按名称和主题色查找图标。</h2>
          <p>这里展示 Bohr icon 页面导出的公开组件。颜色使用 design-v2 语义变量，也可以用自定义色检查图标在业务场景中的表现。</p>
        </div>
        <div className="icon-gallery-total">
          <strong>{ICON_NAMES.length}</strong>
          <span>Figma icons</span>
        </div>
      </header>

      <section className="icon-gallery-controls" aria-label="图标筛选和颜色设置">
        <div className="icon-gallery-search-row">
          <label className="icon-gallery-search">
            <span className="sr-only">搜索图标</span>
            <input
              type="search"
              value={query}
              placeholder="Search name, category, or Figma name"
              onChange={(event) => updateQuery(event.target.value)}
            />
            <span aria-hidden="true">⌕</span>
          </label>
          <label className="icon-gallery-select-label">
            <span>Category</span>
            <select value={category} onChange={(event) => updateCategory(event.target.value)}>
              <option value="all">All categories · {ICON_NAMES.length}</option>
              {ICON_CATEGORIES.map((item) => (
                <option key={item.slug} value={item.slug}>{item.name} · {item.count}</option>
              ))}
            </select>
          </label>
          <button className="control-button icon-gallery-reset" type="button" onClick={clearFilters}>Reset</button>
        </div>

        <div className="icon-gallery-color-row">
          <div className="icon-gallery-color-picker">
            <span className="icon-gallery-control-label">Theme color</span>
            <div className="icon-color-options" role="listbox" aria-label="图标颜色角色">
              {COLOR_OPTIONS.map((option) => (
                <button
                  className={`icon-color-option ${!useCustomColor && color === option.value ? 'icon-color-option-active' : ''}`}
                  key={option.value}
                  type="button"
                  aria-selected={!useCustomColor && color === option.value}
                  onClick={() => {
                    setColor(option.value)
                    setUseCustomColor(false)
                  }}
                >
                  <span className="icon-color-dot" style={{ color: option.value === 'inherit' ? 'var(--bh-color-foreground)' : `var(${option.variable}, currentColor)` }} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <label className={`icon-custom-color ${useCustomColor ? 'icon-custom-color-active' : ''}`}>
            <input type="color" value={customColor} onChange={(event) => { setCustomColor(event.target.value); setUseCustomColor(true) }} />
            <span>Custom</span>
            <code>{customColor.toUpperCase()}</code>
          </label>
        </div>
      </section>

      <div className="icon-gallery-summary">
        <span><strong>{filteredNames.length}</strong> results</span>
        <span>{useCustomColor ? `Custom · ${customColor.toUpperCase()}` : `${selectedColor?.label} · ${selectedColor?.variable}`}</span>
      </div>

      {visibleNames.length > 0 ? (
        <div className="icon-gallery-grid" aria-live="polite">
          {visibleNames.map((name) => (
            <IconCard key={name} name={name} color={useCustomColor ? 'inherit' : color} style={iconStyle} />
          ))}
        </div>
      ) : (
        <div className="icon-gallery-empty">
          <Icon name="general/search-lg" size={24} color="context" />
          <strong>No icons found</strong>
          <span>Try another name, category, or clear the filters.</span>
        </div>
      )}

      {visibleNames.length < filteredNames.length && (
        <div className="icon-gallery-load-more">
          <span>Showing {visibleNames.length} of {filteredNames.length}</span>
          <button className="control-button" type="button" onClick={() => setResultLimit((limit) => limit + RESULT_STEP)}>Load more</button>
        </div>
      )}
    </section>
  )
}

function IconCard({ name, color, style }: { name: IconName; color: IconColor; style?: React.CSSProperties }): React.JSX.Element {
  const entry = ICON_MANIFEST[name]
  return (
    <article className="icon-card">
      <div className="icon-card-preview">
        <Icon name={name} size={24} color={color} style={style} />
      </div>
      <div className="icon-card-meta">
        <strong title={entry.figmaName}>{name.split('/')[1]}</strong>
        <span>{entry.category}</span>
      </div>
      <code title={entry.figmaName}>{entry.figmaName}</code>
    </article>
  )
}
