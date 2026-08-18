# Kernel Web

`@unilab/kernel-web` 是 Uni-Lab 的唯一 Web renderer，也是浏览器与 Electron
共同使用的前端组合根。它负责把通用 package、服务 Profile、路由和页面外壳组装起来，
不重新实现各业务 package 的领域逻辑。

## 职责边界

- 使用 Vite 构建单页应用；不使用 SSR。
- 在应用入口创建当前 `Services`、Query Client 和页面级 Provider。
- 组合工作流、物料、代码编辑器、2D、2.5D 与 Pascal 3D。
- 保存当前连接 Profile，并在用户切换完整 Profile 时重建服务作用域。
- 启动时自动连接默认 Edge Profile；连接配置仅在探测失败后作为恢复入口显示。
- 承担跨 panel 的轻量交互状态，例如当前选择、悬停、高亮和视图模式。

Electron 只加载本应用。禁止再创建一套 desktop renderer，也禁止为 cloud 复制一套页面树。

## 文件导航

- `src/main.tsx`：浏览器入口。
- `src/App.tsx`：应用根组件。
- `src/pages/`：页面级组合。
- `src/router/`：客户端路由。
- `src/integrations/lab-workbench/`：统一实验室工作台、跨 panel 交互与物料服务接线。

实验室工作台的详细数据流见
[`src/integrations/lab-workbench/README.md`](src/integrations/lab-workbench/README.md)。

## 状态所有权

- 服务端数据由 `@unilab/services` 与 TanStack Query 管理。
- 物料图、物料编辑事务和 undo/redo 由 `@unilab/material` 管理。
- 工作流文档状态由 `@unilab/workflow-editor` 管理。
- 布局状态由 `@unilab/workbench-layout` 管理。
- 组合层只保存跨功能引用 ID 和 UI 会话状态，不复制完整领域对象。

## 绝对不能做

- 不得直接 `fetch` 后端或根据 Profile 名称分支业务行为。
- 不得在页面层创建第二份 Material Graph、工作流图或 Pascal scene 状态。
- 不得把 panel 之间的调用实现成全局事件字符串总线。
- 不得针对某个测试模型硬编码相机、网格、尺寸或缩放。
- 不得把 `cloud-web` 或 Electron 发展成第二套 renderer。

## 验证

```bash
pnpm --filter @unilab/kernel-web typecheck
pnpm --filter @unilab/kernel-web test
pnpm --filter @unilab/kernel-web build
pnpm test:web:deployment
```

## Web 部署

完整的构建、Docker、Kubernetes、Backend 代理、发布验证和回滚说明见
[`../../docs/deployment/frontend-web.md`](../../docs/deployment/frontend-web.md)。

生产产物输出到 `apps/kernel-web/dist`。静态服务器必须把未知页面路径回退到
`index.html`，并只对带内容哈希的 `/assets/` 资源设置长期不可变缓存。

仓库提供可直接部署的 Nginx 镜像：

```bash
docker build -f deploy/web/Dockerfile -t unilab-web .
docker run --rm -p 8080:8080 \
  -e UNILAB_BACKEND_ORIGIN=http://host.docker.internal:8080 \
  unilab-web
```

容器健康检查入口为 `/healthz`。部署回归会验证首页、入口 JS/CSS 与 SPA 深层路径。

涉及物料视图时，还要用真实 OS Profile 验证 2D、2.5D、3D 和 split 共享同一选择与
Material Graph。
