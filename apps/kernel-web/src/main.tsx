import ReactDOM from 'react-dom/client'
import '@unilab/design-system/theme.css'
import './styles/global.css'
import '@unilab/pascal-host/styles/source.css'

import { loadApplicationAfterRendererDefaults } from './applicationBootstrap'

/**
 * 挂载 Web 与 Desktop 共享的唯一应用渲染器。
 *
 * @returns Promise 完成时表示 Pascal 默认值已生效且 React 根节点已挂载。
 * @throws 根节点缺失或应用模块加载失败时透传异常，避免继续运行残缺界面。
 */
async function mountApplication(): Promise<void> {
  // Pascal 0.9.2 会在模块求值时冻结 postFx 开关，因此不能静态导入 App。
  const { default: App } = await loadApplicationAfterRendererDefaults(
    () => import('./App')
  )
  const root = document.getElementById('root')
  if (!root) throw new Error('应用根节点 #root 不存在')

  // React Flow 11 在 React 19 StrictMode 的双初始化下会误报 nodeTypes。
  ReactDOM.createRoot(root).render(<App />)
}

void mountApplication()
