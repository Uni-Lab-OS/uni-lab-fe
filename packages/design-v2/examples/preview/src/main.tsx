import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { configureTheme } from '@unilab/design-v2'

import { App } from './App'
import 'antd/dist/reset.css'
import './styles.css'

configureTheme({ defaultMode: 'light', defaultPreset: 'default' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
