# Uni-Lab Developer Web

面向实验调试人员的生产工作台。页面只通过 `@unilab-fe/core` 的领域 port 读取运行时事实，并通过 `@unilab/services` 执行需要后端能力声明的写入操作。

## 本地运行

```bash
pnpm install
pnpm --filter @unilab/developer-web dev
```

默认页面地址为 `http://127.0.0.1:4176`，开发代理将 `/__unilab_backend/*` 转发到 `http://127.0.0.1:8002`。真实环境可以通过环境变量覆盖：

- `VITE_UNILAB_API_URL`：后端 API 根地址；相对地址会解析为当前页面同源地址。
- `VITE_UNILAB_PROXY_TARGET`：Vite 开发代理目标地址。
- `VITE_EDGE_API_URL`：与 Uni-Lab-OS Console 共用的 workspace backend 地址，优先级高于默认的 8002。
- `VITE_UNILAB_BACKEND_ID`：后端 profile，默认 `local-python`；使用 Go backend 时设为 `local-go`。
- `sessionStorage.unilab.access_token`：可选访问令牌，写入请求由 composition root 统一读取。

默认代理目标与 Uni-Lab-OS 前端一致，为 `http://127.0.0.1:8002`。SZLab workspace backend
通常使用动态端口，真实联调时将 `VITE_EDGE_API_URL` 设置为启动日志中的地址（例如
`http://127.0.0.1:49307`），并在
`Uni-Lab-SZLab` 仓库使用与当前 Uni-Lab-OS 匹配的启动脚本。当前页面不会内置 SZLab
样例数据；后端不可用时会显示请求错误，避免把示例误认为运行时事实。运行工作流调试时，
入参会提交到 core 的 `run-preflight` 与 `workflow-tasks` 接口，任务详情读取
`workflow-task-presentations`、`workflow-tasks/:id/jobs` 和节点 feedback 接口。

## 代码边界

- `src/app/backend.ts` 是唯一 composition root，负责装配 core、services 和 transport。
- `src/hooks/useBackendQuery.ts` 统一处理请求生命周期、刷新和连接状态。
- `src/features/*` 按业务域拆分页面；页面不直接调用 `fetch`。
- 试剂写入和物料上下料按钮根据后端 capability 显式启用或禁用，不在后端不可用时伪造成功。

## 测试

```bash
pnpm --filter @unilab-fe/core test
pnpm --filter @unilab/developer-web test
pnpm --filter @unilab/developer-web typecheck
pnpm --filter @unilab/developer-web build
UNILAB_FE_E2E_URL=http://127.0.0.1:4176 pnpm exec playwright test e2e/developer-web.spec.ts
```

最后一条需要本机已安装 Playwright 浏览器；它只验证真实页面路由和页面标题，不注入前端 fixture。
