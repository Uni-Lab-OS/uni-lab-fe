# @unilab/services

前端访问 local OS、新 backend 和 Cloud adapter 的统一服务边界。UI 只依赖这里的
typed port，不感知请求最终落到哪一种部署。

## Profile 与能力矩阵

Profile 是一组完整连接配置，不是单个 base URL。它至少确定 backend 类型、HTTP/WS
地址、认证、作用域和 capability matrix。应用可以通过按钮切换完整 Profile；切换后必须
销毁旧 service/订阅并重建 Query 作用域。

当前默认语义：

| Profile | 物料能力 | 说明 |
|---|---|---|
| `local-python` / edge | `material.readGraph`、`material.readTemplates` | OS 当前内存图只读投影；模板来自已构建 Registry |
| `local-go` / backend | 当前物料能力 fail closed | 现有模板/行级 CRUD 未满足统一目录与 Material Graph contract |
| cloud | fail closed | 未来迁移；未实现能力不得显示为可用 |

`local-python` / Edge 的连通性探测使用统一 v1 路径
`GET /api/v1/health`；`GET /health` 是已退出当前 Edge profile 的旧 bridge 路径。

非云本地作用域是 singleton，不发送伪造的 `laboratoryId`。同一路径或相同 JSON 字段不代表
同一业务语义；adapter 只有在能完整满足 typed port 时才能声明 capability。

## 物料端口

`src/materials.ts` 当前提供：

| 能力 | Services 方法 | 当前来源 |
|---|---|---|
| 模板列表 | `listTemplates` | Edge `/api/v1/resource-templates`，一次读取全量 summary |
| 模板详情 | `getTemplate` | Edge `/api/v1/resource-templates/{uuid}`，按需读取 |
| Material Graph | `getGraph` | OS 当前内存态经 `/api/v1/materials` 分页聚合投影 |

模板 adapter 将服务端 snake_case DTO 映射为领域 camelCase，保留 catalog
`revision/stale`、模板 `contentHash/status/creation`，并归一化
`geometry/containerLayout/configuration/assets`。相对 asset URL 必须基于当前
`BackendConfig.apiUrl` 解析，组件不得自行拼接。

模板列表是轻量、全量目录，不发送 Cloud 风格分页参数。前端 Query cache 以完整
Profile 身份（包含实际 Edge HTTP 地址）和 scope 隔离；搜索、设备/耗材分类在本地进行，
详情只有在用户选中模板后才请求。`stale=true` 只允许浏览，创建必须禁用。

`getGraph` 要求每一行能还原完整 `placement`、`rendering` 和 `sites`，并合并为一个
`MaterialAggregate`。普通 Go backend `materials` 行虽然也位于 `/api/v1/materials`，
但当前并不保证这些聚合字段，因此不能把它冒充 `material.readGraph`。

OS 侧由 `unilab -g/--graph` 在启动时选择设备图。graph 文件只读一次，随后 OS 内部可继续
修改同一个 `ResourceTreeSet`；services 每次读取都通过 bridge 刷新这份当前内存态，
不会把文件或 bridge cache 当作第二事实源。

当前三种 Profile 都没有可声明的统一物料写能力。不得在 adapter 内依次调用 material、
relative-position 和 site 的行级 CRUD 来伪装一个原子命令；在 revision、幂等、失败补偿
和 edge/backend 一致性没有统一前，UI 必须明确显示只读/不可用。

OS 与 Go backend 的逐路由、字段和调用链对照记录在 Uni-Lab-OS：
`unilabos/app/local_bridge/MATERIAL_API.md`。

## 设备端口

设备目录与低频 `device_status` 也服从 capability matrix。`local-python` 已打开
`devices.subscribeStatus`：HTTP API 走 Bridge `:8014`，状态 WS 走 Edge FastAPI
`:18003/api/v1/ws/device_status`（不是 Bridge，也不是旧路径 `/ws/device_status`）。
未声明的其它能力仍直接降级。

## 工作流端口

`src/workflow.ts` 的 `WorkflowRuntimePort` 是前端工作流唯一契约：

| 能力 | 方法 | v1 接口 |
|---|---|---|
| 读图 | `getWorkflow` | `GET /api/v1/workflows/{id}/graph` |
| 保存 | `saveWorkflow` | `PUT /api/v1/workflows/{id}/graph` |
| 校验 | `validateWorkflow` | `POST /api/v1/workflows:validate` |
| Python → Canonical | `compilePythonWorkflow` | `POST /api/v1/authoring/compile` |
| Canonical → Python | `generatePythonWorkflow` | `POST /api/v1/authoring/generate-python` |
| 候选校验 | `validateAuthoringCandidate` | `POST /api/v1/authoring/validate` |
| 创建 Task | `createWorkflowTask` | `POST /api/v1/workflow-tasks` |
| Task 列表/投影 | `listWorkflowTasks` / `getWorkflowTask` | `GET /api/v1/workflow-tasks` / `GET /api/v1/workflow-tasks/{task_uuid}` |
| Task 的 Job 投影 | `listWorkflowTaskJobs` | `GET /api/v1/workflow-tasks/{task_uuid}/jobs` |
| 单个 Job 投影 | `getWorkflowNodeJob` | `GET /api/v1/workflow-node-jobs/{job_uuid}` |
| Job feedback 补读 | `listWorkflowNodeJobFeedback` | `GET /api/v1/workflow-node-jobs/{job_uuid}/feedback` |
| Task 命令 | `commandWorkflowTask` | `POST /api/v1/workflow-tasks/{task_uuid}/commands` |
| Runtime 失效通知 | `subscribeWorkflowRuntime` | `SSE /api/v1/events` |

Runtime SSE 只消费 `workflow.runtime.changed`，事件体只有
`workflow_task_uuid`。它以全局事件 `id` 去重并通过 `Last-Event-ID` 重连，只负责
使 REST 投影失效；调用方必须重新读取 Task/Jobs/feedback，不得把事件当状态补丁。

UI1D 已删除旧 `createRun`、`getRun`、Run node/event page、旧 debug command、
`cancelRun`、Runtime WebSocket 和 polling fallback。旧
`/api/v1/runtime/runs*` 不再存在于公共 port；恢复同名 adapter 属于合同回退。

## Backend adapter 约束

`BackendConfig` 可以选择 `backend` 或 `edge`，但二者的 UI 级协议都必须是
`unilab/v1`。部署差异只允许出现在 HTTP、认证、base URL 和 adapter 映射中：

- 组件不得根据 backend id 分支请求。
- 不得为 local OS 与 backend 复制 `WorkflowRun`、`WorkflowRunNode` 或命令枚举。
- 旧 `/api/run`、`/api/runtime/local/*` 不得暴露给新组件。Cloud panel
  `/ws/workflow/{uuid}` 已删除，禁止重新增加 adapter。
- adapter 可解包外层 `data`，但不能改变 Canonical revision 或运行语义。

## 运行与错误语义

- Task 只能引用 OS 已应用的 Workflow UUID；前端不得提交临时 DAG 绕过 Authoring
  authority。
- 普通 Task 创建不携带本地起始点或断点预览；Debugger launch 等 OS-only 扩展另行冻结。
- command 响应仅表示 durable accepted；随后通过全局 SSE invalidation 和
  Task/Jobs/feedback REST 投影确认 applied 状态。
- HTTP/SSE 传输成功不等于执行成功。
- `dispatch_unknown`、`reconciling` 和结构化 problem detail 必须原样保留给 UI。
- service 被销毁时必须调用 `dispose()` 关闭全局 SSE subscription 和重连计时器。

## 适配器绝对不能做

- 不得让组件知道 `local-go`、`local-python` 或 cloud 名称。
- 不得仅凭 HTTP 200、相似路径或可解包 JSON 声明 capability。
- 不得静默补造 placement、Site、模型尺寸或 revision。
- 不得把 `well`/`tip-spot` 兼容项升级为长期领域 `Site`。
- 不得把高频 joint pose 混入 Material Graph 查询缓存。
- 不得为 Edge 模板请求恢复分页/Cloud 私有 DTO，或在请求失败时返回 bundle 内置目录。
- 不得忽略 `stale`、`unresolved` 或 `creation.available=false` 而打开创建按钮。

## 修改检查

```bash
pnpm --filter @unilab/services typecheck
pnpm --filter @unilab/services test
pnpm --filter @unilab/workflow-editor typecheck
pnpm test:e2e:workflow
pnpm test:e2e:materials
```

新增接口时先扩充 port 和契约测试，再接组件。不要在组件里先写临时 `fetch`。
