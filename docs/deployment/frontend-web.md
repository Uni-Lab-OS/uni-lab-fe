# Uni-Lab 前端部署

本文说明 `apps/kernel-web` 的生产构建与 Web 部署。该应用是浏览器和 Electron
共同使用的唯一 renderer；网页部署只发布 Vite SPA，不包含 Workspace Backend、
Go Backend、OS、Edge 或 PLC 进程。

## 1. 环境要求

- Node.js 22
- Corepack 与仓库锁定版本的 pnpm
- 一个可访问的 Uni-Lab Backend 地址
- 推荐使用仓库提供的 Nginx 镜像，以保证 SPA 回退、缓存和 Backend 同源代理一致

在仓库根目录安装依赖并完成基础检查：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @unilab/kernel-web typecheck
pnpm --filter @unilab/kernel-web test
```

## 2. 构建生产产物

```bash
pnpm build:web
```

产物位于 `apps/kernel-web/dist`。构建末尾会自动执行 JS 体积门禁：任何单个 JS
文件超过 1.5 MB 时构建失败，避免功能迭代重新生成不可控的大包。临时排查时可单独执行：

```bash
pnpm check:web:bundle-size
```

不要直接修改 `dist`。所有产物都应由相同提交重新构建。

## 3. Docker 部署（推荐）

构建镜像：

```bash
docker build -f deploy/web/Dockerfile -t unilab-web:local .
```

在 macOS / Windows Docker Desktop 上启动，并把浏览器同源请求转发到宿主机的
Backend：

```bash
docker run --rm \
  -p 8088:8080 \
  -e UNILAB_BACKEND_ORIGIN=http://host.docker.internal:8080 \
  unilab-web:local
```

Linux Docker 还需显式提供宿主机别名：

```bash
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -p 8088:8080 \
  -e UNILAB_BACKEND_ORIGIN=http://host.docker.internal:8080 \
  unilab-web:local
```

打开 `http://127.0.0.1:8088`。健康检查地址为
`http://127.0.0.1:8088/healthz`。

`UNILAB_BACKEND_ORIGIN` 必须是 Nginx 容器能够访问的地址，不能在容器中填写
`http://127.0.0.1:8080` 来代表宿主机。Nginx 会将
`/__unilab_backend/*` 去掉前缀后转发到该地址，并关闭响应缓冲以支持 SSE。

## 4. Kubernetes 部署要点

镜像监听 `8080`，建议 Deployment 和 Service 使用相同端口。容器至少配置：

```yaml
env:
  - name: UNILAB_BACKEND_ORIGIN
    value: http://uni-lab-backend:8080
ports:
  - name: http
    containerPort: 8080
readinessProbe:
  httpGet:
    path: /healthz
    port: http
livenessProbe:
  httpGet:
    path: /healthz
    port: http
```

如果通过 Ingress 发布在子路径下，需要同时调整 Vite `base` 和 Ingress rewrite；
当前标准部署假设站点位于域名根路径 `/`。

## 5. 静态服务器要求

如果不使用仓库镜像，静态服务器仍必须满足：

- 未命中的页面路径回退到 `index.html`，保证 SPA 深层路径刷新不返回 404；
- `/assets/` 中带内容哈希的文件使用 `Cache-Control: public, max-age=31536000, immutable`；
- `index.html` 使用 `Cache-Control: no-cache`，避免发布后仍引用旧哈希资源；
- `/__unilab_backend/` 反向代理到 Backend，并去掉该前缀；
- SSE 路由关闭代理缓冲并设置足够长的读取超时。

可直接参考 `deploy/web/nginx.conf`。

## 6. 发布验证

构建后执行自动回归：

```bash
pnpm test:web:deployment
```

该检查覆盖首页、入口 JS/CSS、SPA 深层路径和浏览器控制台。部署到目标环境后还应人工
确认：

1. `/healthz` 返回 200；
2. Backend 连接显示已连接；
3. 仪器、物料和工作流目录可以读取；
4. 打开 3D 页面后再加载 Three/Pascal 分包，模型资源无 404；
5. 工作流运行状态可通过 SSE 实时更新；
6. 浏览器控制台无 `console.error` 和未处理异常。

## 7. JS 分包策略

生产构建按职责拆分并使用内容哈希缓存：

- React、状态管理、代码编辑器和 DAG 图形库独立缓存；
- 工作流布局引擎（ELK）与工作流业务代码分离；
- Three 核心、Three 扩展、React Three、Pascal 运行时和 Pascal 编辑器分别输出；
- 3D 场景保持动态加载，未进入 3D 页面时不下载 Pascal 相关大包。

当前约束是单个 Web JS 不超过 1.5 MB。`apps/workbench/lib/frontend/bundle.js` 是旧
Theia Workbench 的容器产物，不属于 `kernel-web` 的网页发布目录，也不纳入 Web
体积门禁；桌面安装包应使用独立命令验证：

```bash
pnpm build:desktop
```

## 8. 回滚

镜像标签应绑定 Git 提交或发布版本，不使用可变的 `latest` 作为唯一标识。回滚时切回
上一镜像即可；由于 `index.html` 不缓存、静态资源文件名含内容哈希，无需手工清理
浏览器缓存。
