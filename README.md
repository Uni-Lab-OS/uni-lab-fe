# Uni-Lab Frontend

Uni-Lab 的长期维护前端仓库。项目使用 pnpm workspace 管理 Vite React
应用、Electron 桌面外壳和可复用业务包。

## 开发

环境要求：Node.js 20 或 22、pnpm 10.13.1。

```bash
corepack enable
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm workbench       # 正式 Uni-Lab Theia Workbench
pnpm dev             # 同样启动正式 Uni-Lab Theia Workbench
pnpm typecheck       # 全工作区类型检查
pnpm test            # 全工作区单元测试
pnpm test:e2e:materials # 启动真实 OS 图场景并验证 2D/3D（Linux 需 Xvfb）
pnpm build:web       # 浏览器产物
pnpm build:desktop   # Electron main/preload/renderer 产物
pnpm build           # 构建所有包含 build 脚本的项目
```

## 目录

```text
uni-lab-fe/
├── apps/
│   ├── kernel-web/             # 唯一 Vite React SPA / renderer 源码
│   ├── desktop/                # Electron main、preload、打包配置
│   └── cloud-web/              # 未来云端应用入口，目前仅占位
└── packages/
    ├── services/               # BackendConfig、HTTP/WS 与业务服务
    ├── design-system/          # 主题 token 和通用 UI
    ├── app-shell/              # 应用外壳与布局原语
    ├── workbench-layout/       # 可拆分、拖拽和持久化的工作台布局
    ├── material/               # 物料模型、模板逻辑和物料 UI
    ├── workflow-editor/        # Uni-Lab FE 唯一工作流引擎与编辑器
    ├── code-editor/            # CodeMirror 封装
    ├── device-card-agent-cli/  # 随 Electron 分发的本地 Agent 薄 CLI
    ├── pascal-host/            # Pascal Editor 上游加载与 React 宿主
    ├── pascal-lab-plugin/      # Uni-Lab 场景能力适配
    └── testing/                # 跨包测试工具
```

`apps/desktop` 没有自己的 renderer 源码。它的 electron-vite 配置直接以
`apps/kernel-web/index.html` 为输入，因此 Web 和桌面不会形成两套前端。
项目不使用 SSR。

工作流引擎以 `packages/workflow-editor` 中从原 `uni-lab-fe` 拆出的实现为
唯一来源。Uni-Lab-Cloud 的 workflow canvas、revision store 和 authoring
engine 不迁入本仓库；如需兼容 Cloud，只在 `services` 中适配接口数据。

3D 编辑器直接使用固定版本的 Pascal 官方包，Uni-Lab 的物料节点、模型加载、
坐标转换和挂载规则集中在 `packages/pascal-lab-plugin`。`kernel-web` 的
“3D 场景”按需加载该能力，Electron 复用同一个入口。仓库没有 Pascal 源码
副本，也不引入 Next 或 SSR。

## 后端切换

应用通过完整的 `BackendConfig` 切换服务实例，内置 Local Go、Local
Python OS 和 Uni-Lab Cloud 三种默认配置。切换配置后会重新创建
`Services` 和 TanStack Query 缓存；UI 与业务包不直接依赖某一种部署形态。

详细依赖规则、状态所有权和跨 panel 通信方式见
[架构说明](docs/architecture.md)。迁移范围和当前进度见
[迁移记录](docs/migration.md)。

本地启动 Workbench、直连 Edge / OS，以及联调 Backend、Scheduler、mock Edge
和 PLC-Sim 的完整步骤见[本地启动与真实联调指南](docs/local-workbench-integration.md)。

设备包开发者使用本地 Coding Agent 创建 Vue/React/Web Component 卡片时，见
[设备卡片 Agent 使用指南](docs/device-card-agent-authoring.md)。
