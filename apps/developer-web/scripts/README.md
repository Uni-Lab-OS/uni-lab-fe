# 启动打包后的 developer-web

本目录是 `@unilab/developer-web` 的构建产物（`pnpm --filter @unilab/developer-web build`）。
按本文档把它跑起来，领域开发者就能在浏览器里调试真实前端界面，不需要装
node、pnpm 或任何前端工具链——服务器只用 Python 标准库。

不要在浏览器里用 `file://` 直接打开 `index.html`：产物引用的是绝对路径
`/assets/...` 并走 ES module 加载，必须经 HTTP 提供。

## 给 AI 的执行顺序

1. **先自检，不要直接启动**：

   ```bash
   bash start-frontend.sh --check
   ```

   这一步只打印解析到的配置并探测 backend，不占用端口。看哪些项显示"未设置"或"缺失"。

2. **补齐缺失事实**：写进同目录的 `start-frontend.local.env`（推荐，见下方模板）
   或用环境变量传入。最少要能解析出 backend 地址。

3. **启动并验证**：

   ```bash
   bash start-frontend.sh
   ```

   另开一个终端验证（端口默认 4177，可用 `UNILAB_FE_PORT` 改）：

   ```bash
   curl -s -o /dev/null -w '首页 %{http_code} %{content_type}\n' http://127.0.0.1:4177/
   curl -s -o /dev/null -w '接口 %{http_code} %{content_type}\n' "http://127.0.0.1:4177/api/v1/workflows?limit=1"
   ```

   期望 `首页 200 text/html` 与 `接口 200 application/json`。**如果接口返回
   `text/html`，说明代理没生效，前端会整页报错**，见"常见故障"。

4. **浏览器验收**：打开 `http://127.0.0.1:4177/`，确认页面渲染出后端真实数据
   （总览页会出现真实的工站/任务列表），且控制台没有 `error`。空数据或红字报错
   都算没起来。

## 需要先确认的事实

| 事实 | 环境变量 | 从哪来 |
| --- | --- | --- |
| backend 地址 | `UNILAB_BACKEND` | 工作区 `session.json` 的 `components.backend.address`，例如 `http://127.0.0.1:52734` |
| 工作区路径 | `UNILAB_WORKSPACE` | 设备包工作区根目录，设为它就能自动读 `session.json` 和启动图 |
| session.json | `UNILAB_SESSION` | 默认是 `<UNILAB_WORKSPACE>/.unilabos/runtime/workbench/session.json` |
| dist 目录 | `UNILAB_DIST` | 默认取脚本所在目录；在仓库里跑时自动用 `../dist` |
| 启动图 json | `UNILAB_GRAPH` | 默认从 `session.json` 的 `configuration.graphPath` 读，仅 `--restart-os` 需要 |
| unilab Python | `UNILAB_PYTHON` | uni-lab-os 仓库的 `.venv/bin/python`，仅 `--restart-os` 需要 |
| uni-lab-os 仓库 | `UNILAB_OS_ROOT` | 仅 `--restart-os` 需要，会作为 `PYTHONPATH` |
| 前端端口 | `UNILAB_FE_PORT` | 默认 `4177` |

`start-frontend.local.env` 模板：

```bash
UNILAB_WORKSPACE=/path/to/Uni-Lab-Workspace
UNILAB_PYTHON=/path/to/Uni-Lab-OS/.venv/bin/python
UNILAB_OS_ROOT=/path/to/Uni-Lab-OS
# UNILAB_BACKEND=http://127.0.0.1:52734   # 不想读 session.json 时直接指定
# UNILAB_FE_PORT=4177
```

## 命令

```bash
bash start-frontend.sh --check        # 只自检：打印配置 + 探测 backend，不启动
bash start-frontend.sh                # 起静态服务，复用已在运行的 backend（默认）
bash start-frontend.sh --restart-os   # 先重启 backend + edge（PLC 不动），再起静态服务
```

`--restart-os` 会真实重启工作区组件，确认当前没有正在跑的实验再执行。它会用
`--component all` 重启 backend 和 edge，并从重启结果里取新的 backend 地址。

## 服务器行为

`serve-dist.py` 只做两件事，都用标准库实现：

- **静态托管**：把 dist 目录当站点根；找不到的文件回退到 `index.html`（SPA 深链
  直接刷新可用）。会挡住目录穿越。
- **反向代理**：把 `/api/*` 和 `/__unilab_backend/*` 转发到 backend。SSE
  （`/api/v1/events`）按流式转发，不做缓冲。

两个前缀都代理是刻意的：dist 里的 JS 在**构建期**就把 API 根地址烧进了产物——

- 用 `VITE_UNILAB_API_URL=/` 构建 → 请求 `/api/v1/...`
- 用默认配置构建 → 请求 `/__unilab_backend/api/v1/...`

因为烧在产物里，**改 `.env` 或环境变量对已经打好的 dist 无效**，必须重新
`vite build`。要让前端连到别的 backend，改的是本服务器的代理目标
（`UNILAB_BACKEND`），不是前端配置。

## 常见故障

| 现象 | 原因与处理 |
| --- | --- |
| 接口返回 `text/html` 而不是 JSON | 请求打到了静态回退。确认访问的是 `/api/v1/...` 或 `/__unilab_backend/api/v1/...`；其它前缀不会被代理 |
| 接口 502 `backend unavailable` | backend 没起或地址不对。用 `--check` 看探测结果；必要时 `--restart-os` |
| 页面白屏、控制台报 module/404 | dist 路径不对或没走 HTTP。重跑 `--check` 确认 `index.html 存在`，并确认用 `http://` 而不是 `file://` |
| 端口被占用 | 脚本会先 kill 掉占用 `UNILAB_FE_PORT` 的进程；想并存就换端口 |
| 页面有数据但一直"连接中" | SSE 被中间层缓冲。本服务器已按流式转发，若前面又加了一层代理需同样关闭缓冲 |
| `session.json 里的 backend 未就绪` | 工作区 backend 崩了或还在启动。看 `session.json` 的 `components.backend.phase`，或 `--restart-os` |