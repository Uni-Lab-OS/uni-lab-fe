import { useEffect, useMemo, useState } from 'react'
import { ConfigProvider, theme as antTheme } from 'antd'
import { createAntdTheme, getTheme, setTheme, watchTheme, type ThemeMode } from '@unilab/design-v2'
import { ComponentDemo } from './components/ComponentDemo'
import { componentRegistry, getComponent } from './components/componentRegistry'
import { IconGallery } from './components/IconGallery'
import { Sidebar } from './components/Sidebar'
import { SpecimenFrame } from './components/SpecimenFrame'

function initialComponentId(): string {
  const requested = window.location.hash.replace(/^#\/?/, '')
  if (requested === 'icons') return requested
  return componentRegistry.some((item) => item.id === requested)
    ? requested
    : componentRegistry[0].id
}

export function App(): React.JSX.Element {
  const [theme, setThemeState] = useState(getTheme())
  const [selectedId, setSelectedId] = useState(initialComponentId)

  useEffect(() => watchTheme(setThemeState), [])
  useEffect(() => {
    const onHashChange = (): void => setSelectedId(initialComponentId())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const isIconPage = selectedId === 'icons'
  const component = isIconPage ? null : getComponent(selectedId)
  const antdConfig = useMemo(
    () =>
      createAntdTheme(theme, {
        defaultAlgorithm: antTheme.defaultAlgorithm,
        darkAlgorithm: antTheme.darkAlgorithm,
      }),
    [theme.preset, theme.resolvedMode],
  )

  const selectComponent = (id: string): void => {
    setSelectedId(id)
    window.history.replaceState(null, '', `#${id}`)
  }

  const changeMode = (): void => {
    const next: ThemeMode = theme.resolvedMode === 'dark' ? 'light' : 'dark'
    setTheme({ mode: next, preset: 'default' })
  }

  return (
    <ConfigProvider theme={antdConfig}>
      <div className="preview-app">
        <header className="preview-header">
          <div className="brand-lockup">
            <span className="brand-mark">U</span>
            <div>
              <p className="eyebrow">UNI-LAB / DESIGN V2</p>
              <h1>内部组件规范站</h1>
            </div>
          </div>
          <div className="header-controls">
            <span className="mode-readout">
              {theme.resolvedMode === 'dark' ? 'Dark' : 'Light'} · {componentRegistry.length}{' '}
              components · 1227 icons
            </span>
            <button className="control-button" type="button" onClick={changeMode}>
              {theme.resolvedMode === 'dark' ? '切换浅色' : '切换深色'}
            </button>
          </div>
        </header>

        <div className="catalog-layout">
          <Sidebar
            components={componentRegistry}
            selectedId={selectedId}
            onSelect={selectComponent}
          />
          <main className="catalog-main">
            {isIconPage ? (
              <IconGallery />
            ) : (
              <>
                <section className="catalog-intro">
                  <span className="eyebrow">COMPONENTS / FILE ORDER</span>
                  <h2>按设计文件顺序逐页核验。</h2>
                  <p>
                    左侧导航来自 Figma File 的 Components
                    页面，当前页的状态、尺寸和变量绑定记录在审计条带中。
                  </p>
                </section>
                {component && (
                  <SpecimenFrame component={component}>
                    <ComponentDemo component={component} />
                  </SpecimenFrame>
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </ConfigProvider>
  )
}
