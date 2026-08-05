# @unilab/services

前端访问 local OS、新 backend 和 Cloud adapter 的统一服务边界。UI 只依赖这里的
typed port，不感知请求最终落到哪一种部署。

## Profile 与能力矩阵

Profile 是一组完整连接配置，不是单个 base URL。它至少确定 Authority 类型、HTTP
地址、工作流 SSE 地址、认证、作用域和物料 capability matrix。工作流 OS-only
调试能力只由显式 Authority 类型决定，不使用 capability discovery。应用可以通过按钮切换
完整 Profile；切换后必须销毁旧 service/订阅并重建 Query 作用域。设备高频遥测若有
独立传输，不得复用为工作流事件通道。

当前默认语义：

| Profile | 物料能力 | 说明 |
|---|---|---|
| `local-python` / edge | `material.readGraph`、`material.readTemplates` | OS 当前内存图只读投影；模板来自已构建 Registry |
| `local-go` / backend | 当前物料能力 fail closed | 现有模板/行级 CRUD 未满足统一目录与 Material Graph contract |
| cloud | fail closed | 未来迁移；未实现能力不得显示为可用 |

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

设备目录与低频 `device_status` 也服从 capability matrix。当前 unified v1 bridge
尚未实现 `devices.listOnline` 和 `devices.subscribeStatus`，因此选择 Edge Profile
时不得试探旧 `/api/v1/online-devices` 或 `/ws/device_status`；未声明的能力直接降级，
避免把预期的 404/WS 握手失败污染为运行时异常。

## 工作流端口

`src/workflow.ts` 的 `WorkflowRuntimePort` 是前端工作流唯一契约。目标 wire
contract 见
`/home/gaojing/Uni-Lab-OS/docs/developer_guide/workflow_task_runtime_migration/frontend_debug_runtime_interface.md`，
当前实现逐文件迁移计划见
[`WORKFLOW_RUNTIME_MIGRATION.md`](./WORKFLOW_RUNTIME_MIGRATION.md)。

> 当前 `src/workflow.ts` 仍是旧 Run/WebSocket/轮询实现；下表是迁移目标，不代表
> 旧代码已经兼容。迁移必须直接删除旧模型，不保留 alias 或 fallback。

| 能力 | 方法 | v1 接口 |
|---|---|---|
| 读图 | `getWorkflow` | `GET /api/v1/workflows/{id}/graph` |
| 保存 | `saveWorkflow` | `PUT /api/v1/workflows/{id}/graph` |
| 校验 | `validateWorkflow` | `POST /api/v1/workflows:validate` |
| Python → Canonical | `compilePythonWorkflow` | `POST /api/v1/authoring/compile` |
| Canonical → Python | `generatePythonWorkflow` | `POST /api/v1/authoring/generate-python` |
| 候选校验 | `validateAuthoringCandidate` | `POST /api/v1/authoring/validate` |
| 创建标准 Task | `createWorkflowTask` | `POST /api/v1/workflow-tasks` |
| Task 投影 | `getWorkflowTask` | `GET /api/v1/workflow-tasks/{task_uuid}` |
| Job 投影 | `listWorkflowNodeJobs` | `GET /api/v1/workflow-tasks/{task_uuid}/jobs` |
| 单个 Job | `getWorkflowNodeJob` | `GET /api/v1/workflow-node-jobs/{job_uuid}` |
| Task 全局命令 | `commandWorkflowTask` | `POST /api/v1/workflow-tasks/{task_uuid}/commands` |
| OS-only 调试启动 | `createDebugWorkflowTask` | `POST /api/v1/debug/workflow-tasks` |
| OS-only 调试投影 | `getWorkflowTaskDebugProjection` | `GET /api/v1/debug/workflow-tasks/{task_uuid}` |
| OS-only Hold 命令 | `commandWorkflowTaskDebug` | `POST /api/v1/debug/workflow-tasks/{task_uuid}/commands` |
| 一致运行快照 | `observeWorkflowTask` | `GET /api/v1/events` SSE + Task/Jobs/debug REST 补水 |

`observeWorkflowTask` 是深模块 Interface，不向 React 暴露 SSE 帧。模块内部使用
全局单调事件 ID 和 `Last-Event-ID`；初次连接、重连、cursor 恢复、收到
`workflow.runtime.changed` 或命令成功后，通过 Task/Job/debug REST 查询补水，只在
整个 bundle 成功后发布一致 snapshot。普通状态、结果、feedback、调试、人工确认、
介入和重试通知全部走该 SSE；不得增加 Run WebSocket、Task-scoped event socket
或轮询型第二实时协议。

## Backend adapter 约束

`BackendConfig` 可以选择 `backend` 或 `edge`，但二者的 UI 级协议都必须是
`unilab/v1`。部署差异只允许出现在 HTTP、认证、base URL 和 adapter 映射中：

- 组件不得根据 backend id 分支请求。
- 不得为 local OS 与 backend 复制 WorkflowTask、WorkflowNodeJob 或共享命令枚举。
- 旧 `/api/run`、`/api/runtime/local/*` 不得暴露给新组件。Cloud panel
  `/ws/workflow/{uuid}` 已删除，禁止重新增加 adapter。
- adapter 可解包外层 `data`，但不能改变 Canonical revision 或运行语义。

## 运行与错误语义

- 标准 `createWorkflowTask` 只提交已应用 Workflow 的 UUID、Task input 和 Backend
  字段，不提交 DAG，也不接受任何 OS-only debug 字段。
- `createDebugWorkflowTask` 仅在明确的 OS Authority 下使用，只增加非空
  `start_node_uuids` 和 `breakpoint_node_uuids`；不得发送单数 alias、
  `workflow_revision`、`target_node_uuid`、嵌套 debug 对象或隐藏在 `meta_data`
  中的执行语义。响应仍是标准 WorkflowTask。
- Backend Authority 下不得发送调试请求、不得 capability/404 探测或降级成普通执行；
  应返回确定性的本地错误并显示
  `当前 Backend 暂不支持起始点和断点调试，可使用全局单步执行。`
- debug projection 中的 `WorkflowNodeAdmissionHold` 绑定一个具体
  `workflow_node_job_uuid`，并以 `reason=breakpoint|step` 区分显式断点和因果
  单步前沿；`open` Hold 不会改写 Job 的 Backend `pending` 状态。前端按
  `hold_uuid` 保留该次 attempt 的身份，不按 Node UUID 合并重试，也不根据 Job
  状态自行生成或释放 Hold。
- `commandWorkflowTaskDebug` 的 `continue`/`step` 必须显式选择一个 Hold 或
  `all_open`；`step_over`/`step_out` 必须提交 composite UUID 与精确 Hold UUID
  快照。省略 scope 是 `422`，快照过期是 `409`。`step_into` 只是展开 OS 返回的
  composite stop 投影，不调用 API。
- step-family 命令接受后，Hold 仍保持 `open`，直到 OS 在一个事务内验证当前
  global-pause generation、取得 execution claims、释放 Hold、消费 scoped permit
  并提交 Job admission。前端不得把 HTTP acknowledgement 当成 Hold 释放或 Job
  running；资源不足或新 pause 抢先提交时，以更新后的 debug projection 为准。
- 命令响应仅表示命令已接受；随后通过 Task/Job/debug REST 投影确认状态。
- `workflow.runtime.changed` 的 data 只含 `workflow_task_uuid`、
  `workflow_node_job_uuids` 和 `projections`，是失效提示，不是状态 patch。
  `projections` 使用固定顺序 `task`、`jobs`、`debug`；数组字段始终存在。
- debug projection 的 `applied_source` 是 Task 创建时冻结的 Python/source-map
  快照。它只用于既有 Task 的代码高亮，不得覆盖当前编辑器 Draft。
- 补水失败时保留上一份完整 snapshot 并显示
  `状态同步中断，正在重试`；不得混合新 Jobs 与旧 debug projection。
- HTTP/SSE 传输成功不等于执行成功。
- `dispatch_unknown`、`reconciling` 和结构化 problem detail 必须原样保留给 UI。
- service 被销毁时必须调用 `dispose()` 关闭 SSE subscription/EventSource。

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
