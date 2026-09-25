import { useEffect, useMemo, useState } from 'react'
import { ConfigProvider, theme as antTheme } from 'antd'
import { getTheme, setTheme, watchTheme, type ThemeMode } from '@unilab/design-v2'
import { ComponentDemo } from './components/ComponentDemo'
import { componentRegistry, getComponent } from './components/componentRegistry'
import { Sidebar } from './components/Sidebar'
import { SpecimenFrame } from './components/SpecimenFrame'

function initialComponentId(): string {
  const requested = window.location.hash.replace(/^#\/?/, '')
  return componentRegistry.some((item) => item.id === requested) ? requested : componentRegistry[0].id
}

function themeColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
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

  const component = getComponent(selectedId)
  const antdConfig = useMemo(() => ({
    algorithm: theme.resolvedMode === 'dark' ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: {
      borderRadius: 5,
      controlHeight: 36,
      colorPrimary: themeColor('--bh-color-primary', '#5363a6'),
      colorPrimaryHover: themeColor('--bh-color-primary-hover', '#7086cc'),
      colorPrimaryActive: themeColor('--bh-color-primary-pressed', '#3d4d91'),
      colorPrimaryBg: themeColor('--bh-color-primary-background', '#eef1ff'),
      colorPrimaryBgHover: themeColor('--bh-color-primary-background-hover', '#e1e6ff'),
      colorPrimaryBorder: themeColor('--bh-color-primary-border', '#b9c5f2'),
      colorPrimaryBorderHover: themeColor('--bh-color-primary-hover', '#7086cc'),
      colorBgBase: themeColor('--bh-color-background', '#ffffff'),
      colorBgLayout: themeColor('--bh-color-background', '#ffffff'),
      colorBgContainer: themeColor('--bh-color-primary-white', '#ffffff'),
      colorBgElevated: themeColor('--bh-color-popover', '#ffffff'),
      colorText: themeColor('--bh-color-foreground', '#1f1f1f'),
      colorTextSecondary: themeColor('--bh-color-muted-foreground', '#6b7280'),
      colorTextTertiary: themeColor('--bh-color-text-description', '#6b7280'),
      colorTextQuaternary: themeColor('--bh-color-text-placeholder', '#9ca3af'),
      colorBorder: themeColor('--bh-color-border', '#d9d9d9'),
      colorBorderSecondary: themeColor('--bh-color-border', '#d9d9d9'),
      colorFill: themeColor('--bh-color-fill-1', '#f5f5f5'),
      colorFillSecondary: themeColor('--bh-color-fill-0', '#fafafa'),
      colorFillTertiary: themeColor('--bh-color-fill-1', '#f5f5f5'),
      colorFillQuaternary: themeColor('--bh-color-fill-2', '#e5e5e5'),
      colorError: themeColor('--bh-color-error-default', '#db3f3f'),
      colorErrorHover: themeColor('--bh-color-error-hover', '#e76b67'),
      colorErrorActive: themeColor('--bh-color-error-pressed', '#b52e31'),
      colorErrorBg: themeColor('--bh-color-error-subtle', '#fff1f0'),
      colorErrorBgHover: themeColor('--bh-color-error-subtle', '#fff1f0'),
      colorErrorBorder: themeColor('--bh-color-error-focus', '#db3f3f'),
      colorErrorBorderHover: themeColor('--bh-color-error-hover', '#e76b67'),
      colorSuccess: themeColor('--bh-color-success-default', '#52a63a'),
      colorSuccessHover: themeColor('--bh-color-success-hover', '#6dbd55'),
      colorSuccessActive: themeColor('--bh-color-success-pressed', '#398629'),
      colorSuccessBg: themeColor('--bh-color-success-subtle', '#f0fbe9'),
      colorWarning: themeColor('--bh-color-warning-default', '#d8a21b'),
      colorWarningHover: themeColor('--bh-color-warning-hover', '#e6b943'),
      colorWarningActive: themeColor('--bh-color-warning-pressed', '#b27b12'),
      colorWarningBg: themeColor('--bh-color-warning-subtle', '#fff9e6'),
      colorInfo: themeColor('--bh-color-primary-information', '#5363a6'),
      colorInfoBg: themeColor('--bh-color-primary-information-light', '#eef1ff'),
      controlOutline: themeColor('--bh-color-ring', '#5363a6'),
      controlOutlineWidth: 2
    }
  }), [theme.resolvedMode])

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
            <span className="mode-readout">{theme.resolvedMode === 'dark' ? 'Dark' : 'Light'} · {componentRegistry.length} pages</span>
            <button className="control-button" type="button" onClick={changeMode}>{theme.resolvedMode === 'dark' ? '切换浅色' : '切换深色'}</button>
          </div>
        </header>

        <div className="catalog-layout">
          <Sidebar components={componentRegistry} selectedId={selectedId} onSelect={selectComponent} />
          <main className="catalog-main">
            <section className="catalog-intro">
              <span className="eyebrow">COMPONENTS / FILE ORDER</span>
              <h2>按设计文件顺序逐页核验。</h2>
              <p>左侧导航来自 Figma File 的 Components 页面，当前页的状态、尺寸和变量绑定记录在审计条带中。</p>
            </section>
            <SpecimenFrame component={component}>
              <ComponentDemo component={component} />
            </SpecimenFrame>
          </main>
        </div>
      </div>
    </ConfigProvider>
  )
}
