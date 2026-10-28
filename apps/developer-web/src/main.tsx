import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@ant-design/v5-patch-for-react-19'
import { App as AntdApp, ConfigProvider, theme as antdTheme } from 'antd'
import { configureTheme, createAntdTheme, getTheme, watchTheme } from '@unilab/design-v2'
import '@unilab/design-v2/icons/styles.css'
import 'antd/dist/reset.css'
import './styles/global.css'
import { App } from './App'

configureTheme({ defaultMode: 'light', defaultPreset: 'default' })

function DesignSystemRoot() {
  const [designTheme, setDesignTheme] = useState(getTheme())
  useEffect(() => watchTheme(setDesignTheme), [])
  const antdConfig = useMemo(
    () =>
      createAntdTheme(designTheme, {
        defaultAlgorithm: antdTheme.defaultAlgorithm,
        darkAlgorithm: antdTheme.darkAlgorithm,
      }),
    [designTheme],
  )

  return (
    <ConfigProvider theme={antdConfig}>
      {/* 提供 App.useApp() 的确认框与消息上下文（跟随主题）；不额外包一层 DOM */}
      <AntdApp component={false}>
        <App />
      </AntdApp>
    </ConfigProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesignSystemRoot />
  </StrictMode>,
)
