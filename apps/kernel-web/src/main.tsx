import ReactDOM from 'react-dom/client'
import '@unilab/design-system/theme.css'
import './styles/global.css'
import '@unilab/pascal-host/styles/source.css'

import { loadApplicationAfterRendererDefaults } from './applicationBootstrap'

async function mountApplication(): Promise<void> {
  // Pascal 0.9.2 在模块求值时冻结 postFx 开关，不能在设置默认值前静态导入 App。
  const { default: App } = await loadApplicationAfterRendererDefaults(
    () => import('./App')
  )
  const root = document.getElementById('root')
  if (!root) throw new Error('应用根节点 #root 不存在')

  // React Flow 11 在 React 19 StrictMode 的双初始化下会误报 nodeTypes。
  ReactDOM.createRoot(root).render(<App />)
}

void mountApplication()
