import type { ComponentSpec } from './componentRegistry'

type SidebarProps = {
  components: ComponentSpec[]
  selectedId: string
  onSelect: (id: string) => void
}

export function Sidebar({ components, selectedId, onSelect }: SidebarProps): React.JSX.Element {
  return (
    <aside className="catalog-sidebar" aria-label="Design file components">
      <div className="sidebar-heading">
        <span className="eyebrow">FILE / COMPONENTS</span>
        <strong>组件规范</strong>
        <span className="sidebar-caption">Accordion → Upload</span>
      </div>
      <nav className="catalog-nav">
        <button
          className={`catalog-nav-item icon-library-nav-item ${selectedId === 'icons' ? 'catalog-nav-item-active' : ''}`}
          type="button"
          aria-current={selectedId === 'icons' ? 'page' : undefined}
          onClick={() => onSelect('icons')}
        >
          <span className="catalog-nav-index">◎</span>
          <span>Icon 图标集合</span>
          <span className="icon-library-nav-count">1227</span>
        </button>
        {components.map((component, index) => (
          <button
            className={`catalog-nav-item ${component.id === selectedId ? 'catalog-nav-item-active' : ''}`}
            key={component.id}
            type="button"
            aria-current={component.id === selectedId ? 'page' : undefined}
            onClick={() => onSelect(component.id)}
          >
            <span className="catalog-nav-index">{String(index + 1).padStart(2, '0')}</span>
            <span>{component.name}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}
