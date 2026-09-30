# FE 最小垂直切片：OS API 盘点与 provisional ports

状态：2026-09-24，接口核对、adapter 验证和一次受控 OS SubmitRun 联调记录。

本文只记录 `Published Workflow Revision → Run Preparation → Preflight` 的验证边界；
不重新定义 Workflow/Task/Job、Claim/Settlement 或完整 Event 架构。

## 当前主线和第一条切片

当前主线已经完成领域模型、运行语义和页面边界收敛。新阶段验证的是：FE 能否只消费
OS/Backend 的 Published Revision、`inventory_requirements` 和 ActionResourceContract，
在本地维护 Run Configuration / Binding Draft，并把只读 Preflight 请求交给 OS。

第一条实现切片的边界是：

```text
Published Revision
  → graph + inventory_requirements + ActionDefinition 只读映射
  → RunConfiguration / BindingDraft（场景草稿）
  → POST run-preflight（零业务写入）
  → 仅在 preflight 可运行时暴露 SubmitRun 出口
```

`SubmitRun → TaskRuntimeSummary → NodeJob Detail` 是紧随其后的接通项；本轮只把
SubmitRun 和 NodeJob Detail 做成 adapter 端口，TaskRuntimeSummary 的后端缺口保持显式。

## 已存在的 OS/Backend 接口

| 能力 | 当前接口 | 事实/备注 |
| --- | --- | --- |
| Published Revision 目录 | `GET /api/v1/workflows?page=&page_size=&status=published` | OS `workflow_api.py` 支持 `status=published`；返回普通工作流与 `experiment_operation` 摘要和 `revision`。生产模式会由 OS 强制只暴露已发布普通工作流，Adapter 不再提前丢弃类型。 |
| Published Revision 详情 | `GET /api/v1/workflows/{workflow_uuid}` | 返回公开 Workflow 摘要及派生 `status`。 |
| Revision 图快照 | `GET /api/v1/workflows/{workflow_uuid}/graph` | 返回 `workflow`、`nodes`、`edges`、`node_templates`、`handle_templates`、`inventory_requirements`。 |
| 数量需求 | 图快照中的 `inventory_requirements[]` | 当前稳定字段包括 `uuid`、`workflow_uuid`、`consume_node_uuid`、`requirement_key`、`target_type`、`required_quantity`、`quantity_unit`、`allow_split`、`meta_data`。数量绑定在 Task 输入准备时由 OS 冻结。 |
| ActionDefinition | `GET /api/v1/workflow-node-templates`、`GET /api/v1/workflow-node-templates/{template_uuid}` | 只读节点模板/动作目录；详情的 `template.meta_data` 是 ActionResourceContract 可能出现的承载位置。没有独立的合同 CRUD。 |
| Device | `GET /api/v1/devices` | Backend-shaped 设备摘要包含 `material.uuid`、设备绑定、在线/Edge 状态和动作声明；FE 现有 `backendDevices` adapter 已消费该合同。 |
| Material | `GET /api/v1/materials/graph`，以及资源合同路由的 `GET /api/v1/materials/{material_uuid}` | Graph 是只读 Material/Site 投影；不要在 FE 把它转成第二套物料事实。 |
| Site | `GET /api/v1/materials/{material_uuid}/sites`、`GET /api/v1/sites/{site_uuid}` | Site 是 Material 所有者下的位置事实；等价候选只能消费 OS 显式提供的集合。 |
| Inventory | Edge Inventory：`GET /api/v1/inventory/instances`、`/lots`、`/snapshot`；Backend Reagent：`GET /api/v1/reagents`、`/reagents/{id}` | 两套路由的 DTO 和响应包络不同：`inventory/instances` 当前直接返回 `{ instances: [...] }`，必须在 adapter 内映射；不能把缺少的某个字段当作 `0`。 |
| 只读 Preflight | `GET /api/v1/workflows/{workflow_uuid}/run-preflight`；`POST` 同路径 | POST DTO：`run_mode`、可选 `target_node_uuid`、`input`、`inventory_bindings[]`。OS 返回 `runnable_now`、`temporarily_unavailable`、`invalid`，检查项状态为 `passed/blocked/deferred/confirmation_required`。实现不创建 Task、Reservation、Claim 或 DeviceCommand。 |
| SubmitRun | `POST /api/v1/workflow-tasks` | DTO 接受 `workflow_uuid`、`run_mode`、`target_node_uuid`、`priority`、`input`、`inventory_bindings`、`description`、`meta_data`；OS 在服务端重新准入并创建 Task/Job。FE 只提交命令，不设置运行状态。 |
| Task 详情 | `GET /api/v1/workflow-tasks/{task_uuid}` | 返回 Task 持久事实，含生命周期、控制/清理字段、snapshot/plan 和错误信息。 |
| Task Jobs | `GET /api/v1/workflow-tasks/{task_uuid}/jobs` | 返回该 Task 的 NodeJob 集合。 |
| NodeJob Detail | `GET /api/v1/workflow-node-jobs/{job_uuid}` | 返回 `executor_kind`、`status`、`attempt`、参数、反馈/结果/控制数据、`uncertainty_reason` 等。 `execution_unknown` 必须原样展示。 |
| Job Feedback | `GET /api/v1/workflow-node-jobs/{job_uuid}/feedback` | 现有接口为页码读取；FE 现有 adapter 已在服务层投影为 sequence cursor。 |

## provisional FE ports

`packages/services/src/runPreparationDomain.ts` 冻结的是语义端口，不是新的全局领域
Store：

- `PublishedWorkflowRevision`：不可变已发布定义和图快照。
- `RunConfiguration`：本次运行输入/模式/目标节点草稿。
- `BindingDraft`：用户选择的具体库存实例和资源引用；只保存在场景边界。
- `PreflightReportView`：OS 只读报告，保留事实状态和检查项。
- `SubmittedRun`：表示 SubmitRun 请求被 OS 接受并返回 Task 身份，不表示运行成功。
- `NodeJobDetailView`：NodeJob 事实的最小读取投影。
- `RunPreparationViewModel`：页面组合投影，不重新计算准入、Claim、Settlement 或可用操作。

`packages/services/src/osRunPreparationAdapter.ts` 是唯一的 OS wire adapter：

- `listPublishedRevisions` 使用已发布过滤；
- `getPublishedRevision` 同时读取 Workflow 摘要和 graph，防止 revision/身份漂移；
- `requestPreflight` 使用 OS POST 合同，不复用旧的 GET-only 兼容函数；
- `submitRun` 只调用 `/workflow-tasks`，不直接调用 Reservation/Claim；
- `getNodeJobDetail` 保留 `execution_unknown` 和 `uncertainty_reason`；
- `ActionResourceContract` 缺失时返回 `null`，不从参数名猜资源影响。

Query/Command 层由 `createRunPreparationQueries` 和 `createRunPreparationCommands` 提供，
只转发到 adapter。React Query 可以缓存这些 Query 返回值，但不承载 Binding 草稿、Task
状态机或 UI 状态。

## 缺口与 fixture 规则

| 缺口 | 当前判断 | 允许的验证替身 |
| --- | --- | --- |
| 统一 Binding Candidate API | OS 只有设备、物料、Site、Inventory 分散查询，没有一个按 Requirement + Run Configuration 返回候选/冲突/解释的聚合接口。 | 仅可在 adapter 边界使用 `source: 'fixture'` 的候选集；fixture 不得推导等价 Lot/Device 策略，也不得写入业务事实。 |
| 独立 ActionResourceContract API | 合同随 ActionDefinition/模板元数据出现，当前无独立查询路由。 | 合同缺失必须显示“未提供合同”，不能用 fixture 冒充 OS 合同；UI 结构测试可以使用明确 `source: 'fixture'` 的 adapter。 |
| TaskRuntimeSummary | OS 当前提供 Task、Jobs、NodeJob、Feedback 分散读接口，没有统一的四状态轴权威摘要端点。 | 不允许 FE 拼出权威摘要。结构测试可使用 fixture，但必须标记为验证替身；生产路径应等待 OS read model。 |
| Domain Fact Version / Preflight Report Version | 当前 Preflight 返回 `workflow_revision` 和 `checked_at`，未看到统一 fact version/report id 合同。 | FE 只保留可用字段；不能自行生成版本来宣称新鲜度。 |
| 全量 Event Contract | 已有 `/api/v1/events` 与现有 FE SSE 类型，但本切片不依赖事件总线。 | 首阶段用 Query/Command response；不在 adapter 中新增 SSE/WebSocket。 |

## 旧 FE 合同的注意事项

现有 `backendWorkflowRuntime.ts` 是迁移期兼容层：

- `loadBackendWorkflowRunPreflight` 只读 GET，且把状态限制为 `ready/requires_confirmation/blocked`；
- `backendWorkflowTaskCreateBody` 会拒绝非空 `input`。

这两个行为与当前 OS `workflow_api.py` 的 POST preflight/Task DTO 不一致，因此新切片
使用独立 `osRunPreparationAdapter`，不修改旧 editor/runtime 合同，也不让旧兼容层反向
决定 provisional domain ports。

## 验证顺序

1. 用一个已有 Published Revision 读取 graph 和 `inventory_requirements`。
2. 读取 ActionDefinition；若合同缺失，明确显示缺口。
3. 在场景内编辑 `RunConfiguration` 和 `BindingDraft`，不产生任何后端写入。
4. POST Preflight，确认 `runnable_now`、阻塞、deferred 和 confirmation_required 的展示。
5. 只有 Preflight 通过才调用 SubmitRun；接收 Task 身份后重新读取 Task/Jobs。
6. 接入 NodeJob Detail；验证 `execution_unknown` 不被映射为普通 failed。
7. 后端补充 TaskRuntimeSummary 后，再冻结 Task 页面四状态轴和实时刷新边界。

本轮实现与测试只覆盖 adapter、ports 和 ViewModel；没有实现完整 Workflow Editor、
全量 packages 迁移、通用 SubstitutionPolicy、FE Domain Store 或新的 Event Bus。

## OS 内置 Console 交叉验证（2026-09-23）

### 实际运行环境

用户给出的 `127.0.0.1:4174` 当前连接被拒绝；同一台机器上已发现一个正在运行的
SZLab workspace backend，Console 实际地址为 `http://127.0.0.1:49307/console/`，
API 文档为 `http://127.0.0.1:49307/api/docs`。只读 workspace status 显示：

- workspace/backend 均 ready，workflow runtime `ready`，加载进度 `27/27`；
- capabilities 为 `authoring`、`inventory`、`workflow-run`、`station-scheduler`；
- 当前进程是 develop + dry-run，`external_devices_only=true`，因此不能把“页面可见”
  当成设备真实在线或动作已经执行；
- 当前 backend 运行命令使用 `--workspace .../Uni-Lab-SZLab`、SZLab PLC-sim graph、
  `--action_mode simulate` 和端口 `49307`。

本轮只读取 Console 和 API，不点击“提交任务”、设备单点动作或会改变库存/任务状态的
控件。

### 内置 Console 能力盘点

| Console 区域 | 实测能力 | 对当前 FE 领域模型的含义 |
| --- | --- | --- |
| 试剂 | 试剂目录、容器库存、数量/浓度/物性、目录与库存两个视图 | `Material`/`Inventory` 是不同读模型；数量和物性来自 OS，不由 FE 推导 |
| 物料 | 128 个资源节点的层级图、站点占用、任务引用、遗留占用/待确认筛选、实时刷新 | `Material`、`Site`、任务引用和资源状态应保持可追溯来源，不能合并成一个 FE 事实表 |
| 设备 | 按设备显示已发布动作 schema，参数由 schema 生成；提交单点动作后产生可追踪 Task/Job | `ActionDefinition` 是只读目录；FE 不创建 `Task`/`DeviceCommand`，动作提交仍是 OS Command |
| 实验室操作 | 21 个设备模板、130 个 Action、`condition`/`repeat_until` 控制节点，以及一个已发布可复用子流程 | `ActionResourceContract`/控制节点属于已发布定义；`experiment_operation` 需要单独识别 |
| 工作流 | 普通工作流的拓扑、输入/输出 contracts、运行前诊断、物料运行准备、Preflight、提交入口 | 现有 UI 已经具备最小垂直切片的完整页面边界 |
| 任务 | 并行任务矩阵、节点状态、Task/NodeJob/Attempt/feedback、暂停/恢复/取消、单步执行、人工确认、锁/释放/结算保护 | `TaskRuntimeSummary` 必须是 OS 任务事实的 read model；`unknown` 对应“结果待核对/人工复核”，不是普通失败 |

### 关键工作流实测

普通工作流列表当前显示 26 个 source definitions、Published count 为 0。选中的
`S03→S07→S06→S09→S04→S05 烧杯搬运`（UUID
`0a6b3005-833d-491b-9fd4-fe6545846dab`，revision 2）能够读取 11 nodes、5 edges、
3 node templates 和 41 handles，但当前 graph 的 Preflight 返回 `invalid`，原因是
`execution_plan_invalid`（组合工作流入边引用快照外来源连接点）。这说明“有 source
definition”不等于“已有可运行 Published Revision”。

Console 还展示了一个真正已发布的 `experiment_operation`：
`SZLab 标准物料转运`（UUID `e7c53119-9fde-5250-9bf5-264f23d157a8`，revision 2）。
它的 graph 为 1 node/0 edges，Preflight 返回 `runnable_now`、`can_run=true`，但设备
选择和资源锁仍是 dispatch 时 deferred。这是当前环境可用于验证“已发布定义 → Preflight”
的最小探针；它是可复用子操作，不应被误标为普通实验工作流。

### 2026-09-24 只读 POST Preflight 复核

当前 backend 的普通 Published Revision 列表仍为空；按 `workflow_type=experiment_operation`
读取到上述 revision 的公开 DTO，明确包含 `workflow_type=experiment_operation`。对它发送不带
输入的只读 POST Preflight：

- `execution_plan` 通过，执行计划为 1 个节点；
- `quantity_inventory` 阻塞，原因是缺少必填 Workflow input；
- `device_selection` 与 `resource_lock` 仍为 dispatch 时 `deferred`；
- 最终报告为 `temporarily_unavailable / can_run=false`。

同一 revision 的无请求体 GET 探针曾返回 `runnable_now`，但 POST 结果证明真正携带运行输入
时仍会进行输入合同校验。因此 FE 必须以 POST Preflight 的报告作为 SubmitRun 门禁，不能把
默认 GET 探针或静态 graph 可生成误当成“这次具体运行可提交”。本轮只读复核阶段仍未调用
SubmitRun；随后在用户明确授权后，使用同一份 Preflight 通过的具体输入做了一次受控提交，
结果见下文。

随后使用当前 Material Graph 的真实候选再次 POST Preflight：

```json
{
  "resource": {"uuid": "435cb608-a607-5cbc-87e3-141d247bb3c5"},
  "source_warehouse": {"uuid": "474e7b34-bff7-53d3-9161-bfcbffc02a01"},
  "target_device": "szlab_mixer_robot",
  "target_warehouse": {"uuid": "777f4916-7e37-5d7f-8802-d3b15f5fa2c1"},
  "source_site": "L1B1",
  "target_site": "88d9e960-2366-5a9f-9361-48f10ac94785"
}
```

结果为 `runnable_now / can_run=true`：`quantity_inventory` 与 `execution_plan` 通过，
`device_selection` 和 `resource_lock` 仍明确标为 dispatch 时 `deferred`。这验证了当前
`experiment_operation` 可以作为真实 `Published Revision → Run Preparation → POST Preflight`
探针；同时也验证了 FE 应把 ResourceSlot、设备固定 ID 和 Site key 当作不同类型处理，不能
把它们收敛成一个 `selectedResources` 字符串字典。OS ActionResourceContract 明确要求
`target_site` 使用 Site UUID；页面上的 `S041` 只能作为候选显示 key，不能直接替代最终输入。
本次 Preflight 通过后才进入受控 SubmitRun 验证，结果见下文。

### 2026-09-24 受控 SubmitRun 与运行读模型复核

在用户明确授权后，Adapter 使用上一节中 `runnable_now / can_run=true` 的完整输入，向
`POST /api/v1/workflow-tasks` 发起了唯一一次受控提交。请求包含 `workflow_uuid`、
`run_mode=normal`、`priority=normal`、`description`、受控 `meta_data`、完整 `input`
和空的 `inventory_bindings`；FE 没有创建 Reservation、Claim、Task 或 DeviceCommand。

OS 返回通用 `code=1`，响应没有返回 Task UUID；后端日志随后确认任务记录实际已创建，
Task UUID 为 `95a60b70-ce52-4cb2-a474-c83b5da72e99`，但提交本地调度器失败：

```text
StationResourceError: gripper_site_role_invalid
夹爪角色必须唯一
```

因此没有盲目重试，也没有修改库存、设备或任务状态。只读读取该 Task 得到：

- Task `status=canceled`，`cleanup_status=settled`，无 active execution lock；
- `workflow_input` NodeJob `succeeded`，material-transfer NodeJob 和 workflow-output
  NodeJob 均为 `canceled`，且 transfer Job `start_state=NOT_STARTED`；
- Task events 接口返回连续 sequence `1..7`，覆盖 pending、Job transition 和最终 canceled；
- 每个 NodeJob Detail 与 `/feedback` 均可读取，反馈为空；
- `workflow-task-presentations?view=matrix` 能返回同一 Task 的运行摘要投影；
- `/timeline` 当前 `running=[]`、`completed=[]`，说明未进入设备执行阶段。

这次联调已经验证了 `SubmitRun → Task → Jobs → events → NodeJob Detail` 的接口可达性和
失败后读模型形状，但没有验证物理动作成功。当前剩余阻塞是 SZLab inventory 的
`robot.gripper` 角色配置重复；它属于 OS/工作区调度准入问题，FE 不应通过猜测或本地规则绕过。

### 对 provisional ports 的修正

内置 Console 的 Run Preparation 会从 graph 中的 `material_source` 节点读取
`resource_template_uuid`、`material_uuid`、mount/site 引用，再从 Material/Inventory
快照投影候选项。候选项还展示当前 location、owner/mount、taskReferences 和来源节点。
OS 当前没有一个“按 requirement 聚合候选、冲突和解释”的统一 API；因此：

1. 这不是新增的 FE 领域事实，也不是允许 FE 自行执行 binding 的依据；候选只是
   `MaterialBindingCandidateView` 的页面投影，最终准入仍由 OS Preflight/SubmitRun 决定。
2. 现有 `ResourceCandidateView` 若要承载内置 Console 的真实行为，需要后续补充
   `sourceNodeId`、`currentLocation`、`taskReferences`、owner/mount 和 provenance；
   这些字段必须标明来自 OS snapshot 或明确的 `fixture`，不能在 FE 推断占用/等价替代。
3. `inventory_requirements` 在 Console 中是只读约束。页面没有创建 Reservation/Claim，
   也没有复制资源结算；OS 在任务创建、执行和 settlement 边界重新校验。

因此，内置 Console 反向确认了当前切片边界：

```text
Published Revision
  → graph / contracts / material-source projection
  → Run Configuration + Binding Draft（场景状态）
  → OS Preflight（只读准入）
  → OS SubmitRun（唯一任务创建命令）
  → Task/Job/feedback/step-state read model
```

其中最后一段目前由多个 Task/Job/feedback/step-state 接口组成，尚不存在统一的
`TaskRuntimeSummary` 权威端点；FE 不应先拼出一个新的全局运行事实。下一条安全实现入口是
修复或更换 OS/工作区中具有唯一 `robot.gripper` 角色的设备资源配置，
然后复用同一份 Run Preparation 输入重新进行一次受控联调；在此之前不再重试 SubmitRun。

## OS Console 源码深读：运行观察与调试边界（2026-09-23）

上一节只按页面盘点能力还不够。继续阅读 `Uni-Lab-OS/frontend/src`、
`workflow_api.py`、`workflow/service.py`、`workflow/store.py` 和 scheduler 后，可以把
“任务运行 UI”拆成以下几条不同的链路：

### 1. 任务矩阵不是运行事件时间线

`TasksPage` 首屏调用的是：

```text
GET /api/v1/workflow-task-presentations?view=matrix&terminal_limit=20
```

这是 Edge-only 的紧凑展示投影，返回活动/需关注 Task、最近终态 Task 以及每个 Task 的
紧凑 Job 状态。用户点击节点后，页面才按需读取：

```text
GET /api/v1/workflow-tasks/{task_uuid}
GET /api/v1/workflow-tasks/{task_uuid}/jobs
```

`TaskNodeInspector` 展示 `WorkflowNodeJob.param`、`return_info`、`feedback_data`、
错误信息、attempt、开始/结束时间和人工核对记录。这里的 `TaskNode`、进度百分比、
等待原因和状态颜色都是前端 read-model projection，不是新的 Task/Job 事实。

特别要注意：`adaptTask` 为矩阵按 `workflow_node_uuid` 选择当前 Job；完整历史 attempt
并不会自动变成一个 FE 状态机。错误人工处理 Job 会被单独保留用于历史核对，其他 attempt
历史仍应通过 OS 的 Job/事件接口读取。

### 2. 真正的任务运行事件是持久 journal

OS 已有：

```text
GET /api/v1/workflow-tasks/{task_uuid}/events
    ?after_sequence=<exclusive cursor>&limit=<1..500>
```

它读取 `workflow_runtime_journal`，使用单调递增的排他 cursor，并返回：

```text
task_transition
job_transition
command_consumed
feedback_committed
uncertainty_opened
uncertainty_resolved
lock_operator_released
startup_recovered
```

事件行包含 Task/Job/Command 身份、from/to status、attempt、executor kind、创建时间；
派发事件补充实际 `param`，明确终态事件补充 `return_info` 和 `error_info`。这才是可以
支撑“事件 waterfall / 可重放时间线”的后端事实源。当前内置 `TasksPage` 没有直接读取
这个接口，而是通过 `/api/v1/events` 收到 `workflow.runtime.changed` 后重新读取矩阵。

因此，FE 需要区分两个概念：

- `RuntimeInvalidationNotice`：SSE 只表示“请重新读取”；丢失一条通知不能推导业务状态；
- `TaskRuntimeEventPage`：带 cursor 的持久运行事件，可用于 timeline/waterfall、审计和
  断线续读。

### 3. Timeline 与 Trace 不是同一个模型

OS scheduler 还提供：

```text
GET /api/v1/timeline?window_s=3600
```

该接口返回按 `device_id` / `device_action_key` 分组所需的泳道数据：

- `running`：开始时间、已运行时长、预估时长、预估来源；
- `completed`：实际开始/结束、实际时长、状态、成功类型；
- `estimator`：默认时长和历史统计。

这是调度器的设备泳道投影，适合“资源并行/设备占用 waterfall”，不等价于
`workflow_runtime_journal` 的业务事件序列，也不等价于 OpenTelemetry Trace。

任务页的 `Trace` 按 `readiness.observability.traceUiUrl` 和 Task 的 trace context 生成
SigNoz 深链接；没有完整 trace id 时，页面生成按 `workflow.task.uuid` 的 trace explorer
查询。于是实际可见的“完整 waterfall”可能来自外部 SigNoz，而不是当前 FE 自己的
`TaskRuntimeSummary`。

### 4. 单点调试实际复用标准 Task/Job

`DevicesPage` 的“设备单点动作”不是另一种执行事实。它通过：

```text
POST /api/v1/device-action-runs
GET  /api/v1/workflow-tasks/{task_uuid}
GET  /api/v1/workflow-node-jobs/{job_uuid}
POST /api/v1/workflow-tasks/{task_uuid}/commands  (type=cancel)
```

后端创建或幂等复用标准 WorkflowTask + 单个 WorkflowNodeJob。前端将原始参数和
幂等键保存在 sessionStorage；网络结果未知时冻结设备、Action 和参数，要求使用同一
幂等身份确认，禁止盲目重发物理动作。该页面还以 1.5 秒轮询读取 Task/Job，直至双方
都进入明确终态。

这证明 `DeviceActionRun` 是一个 command/read-model 入口，不应在 FE 领域模型中再造一套
“设备调试任务”实体。

### 5. 暂停、恢复、单步是带门禁的 Task Command

标准命令接口为：

```text
POST /api/v1/workflow-tasks/{task_uuid}/commands
```

支持 `pause`、`resume`、`cancel`、`switch_to_step`、`step`（以及受保护的
`unlock_resources`）。命令带幂等键，返回 `pending/succeeded/rejected`，不能把 HTTP 成功
误解为设备动作已经完成。

后端语义比 UI 按钮复杂：

- `pause` 只关闭后续派发闸门，不中断已经在途的设备动作；
- `switch_to_step` 先进入 `switching_to_step`，等待在途 Job 排空，再进入 `step + paused`；
- `step-state` 返回 OS 计算的 ready candidates、是否必须选择、在途 Job 数和 `can_step`；
- `step` 只能在 `step + paused + no in-flight job` 时放行一个候选节点；完成后再次暂停；
- `resume` 在普通模式恢复自动调度，在 step 模式切回 normal 并重新打开 dispatch gate；
- `step` 和 `switch_to_step` 由 API 强制要求 develop 模式。

因此 FE 需要的不是 `isPaused` 一个布尔值，而是至少：

```text
TaskControlState {
  executionMode: normal | switching_to_step | step
  controlStatus
  dispatchGate
  inFlightJobCount
  requiresSelection
  canStep
  candidates[]
}
```

### 6. 断点逻辑仍存在于 OS 内部，但旧 Debug API 已退役

OS 的 store/service 仍保留 `workflow_task_debug_configuration`、
`breakpoint_node_uuids`、admission hold 和 debug command 的历史实现；它能够从指定起点
裁剪可达执行子图，并在断点/单步位置建立持久 Hold。

但公开的：

```text
/api/v1/debug/workflow-tasks
/api/v1/debug/workflow-tasks/{task_uuid}
/api/v1/debug/workflow-tasks/{task_uuid}/commands
```

当前固定返回 HTTP 410，提示改用标准 step Task。也就是说，不能因为源码里还有
`breakpoint_node_uuids` 就在 FE 重新暴露旧 Debug API；如果未来需要“显式断点”，应先确认
OS 是否把它重新纳入标准 Published Revision/Task Command 合同。

### 7. 恢复与未知结果是独立的控制链

任务页还接入了三套不应合并的处置边界：

- `workflow-interventions`：设备动作异常的 retry/skip/abort 决策和超时默认策略；
- `manual-confirmation` / `resolve-uncertain`：人工确认、执行结果未知和历史核对；
- `execution-locks` / `force-release` / 物理结算：按 Claim/Fence 和现场安全确认处置持久
  设备、物料、库位锁。

执行锁释放会要求 expected Claim、fencing token、人工原因和物理安全确认；物料转运结算
则读取冻结的来源/目标库位上下文，选择现场真实位置后更新权威库存并释放锁，且不会重新
执行机器人动作。这些是 OS Command，不是 FE 的 Task 状态派生。

### 对当前 provisional FE ports 的结论

现有最小切片 ports 足以覆盖 `Published Revision → Run Preparation → Preflight`，但
不足以承载内置 Console 的完整运行观察/调试能力。后续若进入 Task 页面，应新增独立的
读取/命令端口，而不是扩张 `TaskRuntimeSummary` 成万能对象：

| provisional port | OS 来源 | 是否应进入第一条切片 |
| --- | --- | --- |
| `TaskRuntimePresentation` | `/workflow-task-presentations?view=matrix` | 否，先保持矩阵读模型边界 |
| `TaskRuntimeEventPage` | `/workflow-tasks/{id}/events` | 否，作为第二阶段 timeline/waterfall 读链路 |
| `TaskControlState` | `/workflow-tasks/{id}/step-state` | 否，进入单步调试阶段 |
| `TaskCommand` / `TaskCommandResult` | `/workflow-tasks/{id}/commands` | 否，进入明确的控制命令阶段 |
| `TaskTraceReference` | readiness + trace context | 可作为外部观察链接，不作为 FE 事件事实 |
| `SchedulerTimelineView` | `/timeline` | 否，设备泳道观察单独验证 |
| `WorkflowIntervention` / `ManualReview` | 干预、确认、核对接口 | 否，恢复与未知结果阶段 |
| `ExecutionLockSnapshot` | `/execution-locks` | 否，安全处置阶段 |

所以当前阶段不应因为看到了复杂调试页面，就把 Timeline、SSE、Trace、Task 控制和恢复
全部提前塞进 Run Preparation。正确的边界是先完成 Published Revision + Preflight 的
真实读链路；之后以 OS 已有的 cursor、幂等命令和安全门禁为依据，分阶段增加运行观察和
调试端口。

## Runtime/Debug Contract Audit 收口（2026-09-23）

这次对比进一步沿着 OS 内置 Console 的真实调用链检查了 provisional FE ports。结论不是
“把 Console 复制到 FE”，而是确认哪些事实已经有稳定的 OS 合同、哪些必须拆成独立的后续
读/命令端口。

### 合同矩阵与阶段边界

| OS 合同 | provisional FE port | 事实语义 | 阶段 |
| --- | --- | --- | --- |
| `GET /workflow-task-presentations?view=matrix` | `TaskRuntimePresentation` | 任务矩阵投影，适合列表/总览 | 第二阶段，只读 |
| `GET /workflow-tasks/{id}` + `/jobs` | `TaskRuntimeSummary` / `NodeJobDetail` | Task 与 Job 当前读模型 | 第二阶段，只读 |
| `GET /workflow-tasks/{id}/events?after_sequence=...` | `TaskRuntimeEventPage` | 带独占递增 cursor 的运行日志；事件可带 dispatch 参数、terminal return/error | 第二阶段，waterfall 读链路 |
| `GET /workflow-tasks/{id}/step-state` | `TaskControlState` | `normal/switching_to_step/step`、dispatch gate、in-flight、候选节点与 `can_step` | 第二阶段，develop 调试 |
| `POST /workflow-tasks/{id}/commands` | `TaskCommand` / `TaskCommandResult` | 带幂等键的 pause/resume/cancel/switch-to-step/step；HTTP 成功不等于物理动作完成 | 第二阶段，命令链路 |
| `GET /timeline` | `SchedulerTimelineView` | 调度器设备泳道：running/completed/estimator | 第三阶段，与事件日志分开 |
| readiness `traceUiUrl` + Task trace context | `TaskTraceReference` | 外部 SigNoz 观察链接，不是 FE 自有事件事实 | 可选外链 |
| interventions、manual confirmation、resolve-uncertain | `WorkflowIntervention` / `ManualReview` | retry/skip/abort、人工确认、未知结果核对 | 第三阶段，恢复链路 |
| execution-locks、force-release、settlement | `ExecutionLockSnapshot` / safety commands | Claim/Fence、物理安全确认、库存结算 | 第三阶段，安全链路 |

这些接口的共同约束已经在 OS 中得到验证：事件分页使用独占递增 sequence，命令返回
`pending/succeeded/rejected` 并要求幂等身份，未知结果必须冻结原始动作身份；SSE 目前主要
承担失效通知和重新读取，不能被当作业务事件总线。旧的 `/debug/workflow-tasks*` 路由固定
返回 HTTP 410，不是新的 FE 适配目标。

### 在当前 SubmitRun 之前必须补齐的四个契约缺口

1. **Run metadata 还不完整。** OS 的 `WorkflowTaskCreateRequest` 和内置 Workflow 页面
   支持 `priority`（`normal/high`）、`description` 及 `meta_data`；当前
   `RunConfiguration`/adapter 只序列化 workflow、run mode、target、input 和
   `inventory_bindings`。在补齐这些字段前，FE 的 `SubmitRun` 不能声称与 Console 的
   Run Preparation 语义等价。`priority/description` 应作为显式 Run Configuration
   字段；`meta_data` 则先保持为受控扩展，不要用任意全局对象替代领域类型。

2. **Published Revision 的 workflow type 尚未进入 FE 投影。** OS 同时存在普通
   `workflow` 与 `experiment_operation` 入口；后者可能已有可运行的 Published
   Revision，但不能把它和普通 revision 仅凭名称或 graph 形状混同。FE 应在 provisional
   revision projection 中保留 OS 返回的 workflow type，或明确由 Adapter 将其投影为
   可审计的 `sourceKind`，否则 Run Preparation 的能力提示会失真。

3. **`selectedResources` 的序列化边界必须显式。** 当前 `BindingDraft` 同时持有
   `inventoryBindings` 与 `selectedResources`，但 SubmitRun 请求只直接发送前者。若资源选择
   只是被压入 `input`，Adapter 必须有单元测试证明映射和来源；若不是，就会出现“UI 显示已
   选择、OS 实际未收到”的静默丢失。FE 不能自行创建 Reservation/Claim 来弥补这一缺口。

4. **当前 `NodeJobDetail` 不是 Attempt 历史。** 它适合第一屏的当前 Job 事实和 uncertainty
   状态，但 Console 的事件、重试、恢复和单步观察需要独立的 event page、attempt history
   与 control state；不能把这些字段继续堆进一个万能 `TaskRuntimeSummary`。

本次 `transfer_material_atomic` ActionResourceContract 还补充确认了一个输入类型边界：
`resource`、`source_warehouse`、`target_warehouse` 是 `{ uuid }` ResourceSlot，
`target_device` 是设备固定 ID 字符串，`source_site` 是来源库位名/字符串，而
`target_site` 是带 `site_selector` 约束的 Site UUID。FE 的通用 `RunConfiguration.input`
可以暂时承载这些 OS input，但页面映射必须读取 Action schema/contract，不能把 Site 的
显示 key、UUID 和设备 Material UUID 混成同一种候选值。

另有一个需要清理的工程信号：FE 旧的 `workflow-task-runtime` 兼容 port/tests 仍引用已退役
的 `/debug/*` API。它们不能作为新领域模型的后端事实来源；进入运行观察实现前，应将其标记
为 legacy compatibility，或迁移到上表中的标准 Task/Job contracts。

### 本轮最小修正状态（2026-09-24）

- `PublishedWorkflowRevision` / summary 已保留 OS 的 `workflowType`，Adapter 对缺失或未知
  类型显式报错，不再把 `experiment_operation` 隐式当作普通 Workflow。
- `RunConfiguration` 已加入 `priority`、`description` 和受控 `metadata`；SubmitRun
  Adapter 会完整发送 OS 的 `priority`、`description`、`meta_data` 字段，并默认显式发送
  `priority=normal`。
- `selectedResources` 尚无 OS 独立请求字段。本轮没有把它猜测性地塞进 `input`，而是对
  非空但未映射的选择返回 `UNMAPPED_RESOURCE_SELECTION`，防止 UI 选择被静默丢弃；后续只有
  在确认 Workflow input/ResourceSlot 的具体映射后才解除该门禁。
- `NodeJobDetail` 仍保持当前 Job 投影；Attempt history、runtime events 和 control state
  仍留在第二阶段，没有借本轮修正扩张模型。

上述修正已由 `@unilab/services` 的 34 个测试文件、219 个测试覆盖，并通过 services
typecheck。真实 OS SubmitRun 已完成一次受控联调，但因 OS 调度器的
`gripper_site_role_invalid` 安全准入错误而取消；因此当前结论是“FE 请求合同、Preflight
门禁和运行失败后的 Task/Job 读链路已验证”，不是“已完成真实设备动作执行闭环”。

### 收口决策

- 第一条切片仍只验证 `Published Revision → Run Preparation → Preflight`，但在进入
  `SubmitRun` 前先补齐并测试 Run Configuration 的 metadata、workflow type 和资源选择
  映射；不引入 Timeline、SSE/WebSocket、Trace 聚合或旧 Debug API。
- 第二阶段按 `TaskRuntimePresentation`、`TaskRuntimeSummary`、`TaskRuntimeEventPage`、
  `TaskControlState`、`TaskCommand` 的顺序实现运行观察与单步控制；每个端口保持独立，
  React Query 只缓存读模型，场景状态留在页面/命令上下文。
- 第三阶段再接入设备 timeline、intervention/manual review、unknown recovery 和
  execution-lock/settlement。这些命令必须继续由 OS 负责 Claim、Fence、幂等和安全门禁。

## 第二阶段入口：Task Runtime 只读 Adapter（2026-09-24）

真实设备动作不再作为 FE 主线的验证门槛。基于上一阶段已经验证的 Task/Job/Event 路由，
本阶段先接通只读运行观察边界：

- `packages/services/src/taskRuntimeReadDomain.ts` 新增 `TaskRuntimeReadPort`；
- `GET /api/v1/workflow-task-presentations` 映射为 OS 提供的紧凑矩阵读模型，批量携带 Job
  状态，不在 FE 逐任务拼装矩阵；
- `GET /api/v1/workflow-tasks/{task_uuid}/events` 映射为独立的递增 cursor 事件页；
- NodeJob Detail 和 Feedback 复用 OS 事实接口，并保留 `execution_unknown` 等未知状态；
- 暂不新增 `TaskRuntimeSummary` 权威类型，因为 OS 尚未提供统一摘要端点；不把 Task、Jobs、
  Events 的组合结果伪装成新的领域事实。

本入口没有接入 React Query、全局 Store、SSE/WebSocket 或 Task 控制命令。下一步应在页面
场景边界消费这些 query 端口，先实现任务矩阵与单个 NodeJob Detail 的只读展示，再单独评估
事件 waterfall；暂停/恢复/单步/人工确认等命令必须等 read model 和安全门禁稳定后再接入。

本轮是代码与运行合同的设计审计，没有向 OS 发起写入，也没有提前修改 FE 实现；因此下一次
实现可以从上述四个缺口的最小类型/序列化修正开始，而不是重新设计整体运行时模型。
