# AGENTS.md

本文件约束 `uni-lab-fe` 仓库中的开发与调试。子目录若有更具体的
`AGENTS.md`，应同时遵守；发生冲突时，以更接近目标文件的规则为准。

## 仓库与应用边界

- 本仓库是前端唯一长期维护仓库，使用 pnpm workspace。业务能力进入
  `packages/*`，`apps/*` 只做应用组合、路由、运行时装配和部署入口。
- `apps/kernel-web` 是唯一 renderer，使用 Vite React SPA；`apps/desktop`
  只是 Electron main/preload/打包外壳，直接复用同一 renderer。
- 不使用 SSR，不引入 Next 作为第二应用框架。Pascal 上游少量
  `next/image`/`next/link` import 只允许由 Vite compatibility shim 解决。
- 一个业务事实只能有一个 owner。跨 panel 交互只传稳定 id、selection、
  highlight 和 command intent，不复制 Material、Workflow 或 Pascal 场景实体。

## 物料架构原则

- `packages/material` 拥有 Material domain type、Zustand authoring store、
  undo/redo、规则与 2D/2.5D UI；`packages/services` 拥有 OS/backend adapter；
  `apps/kernel-web/src/integrations/lab-workbench` 只组合 panel 和跨 panel
  selection/highlight。
- `MaterialAggregate` 是前端物料图的唯一业务投影。React Flow、2.5D SVG 和
  Pascal scene 都从同一批 aggregate 派生，不得各自保存第二份物料实体或位置。
- 所有持久坐标使用毫米，旋转使用 XYZ degree。placement 只使用
  `unplaced | world | parent | site`；parent/site 下的局部坐标由 adapter
  明确转换，渲染器不得猜测坐标系。
- 默认 anchor 为 `root`。挂在 site 上的物料采用 follow-site：site 所在 link
  实时运动时，子物料在 3D 中跟随；不得为了跟随运动而高频改写 site 或静态
  relative position。
- `site` 表示可承载另一个物料的安装位、台面位或 hotel slot。well 与 tip spot
  是 labware 内部结构，不是长期 domain Site；当前 local OS 读投影中的兼容形态
  只能用于展示，不得据此扩展 Site CRUD 或业务规则。
- 试剂、样品、容器内容优先进入对应后端表；通用时序状态进入
  `material_state_history`。不要恢复无边界的 `material.data` 作为万能状态袋。
- 高频关节状态走独立 realtime 通道，只影响 Pascal/3D 需要更新的 link；
  React Flow 和 2.5D 不订阅关节帧。实时状态缺失时允许回退 URDF 初始关节值。
- 从模板创建后，物料是独立实例；除非未来另有明确版本迁移协议，不得因模板更新
  隐式改写既有物料。
- site 的新增/删除不是当前前端能力。任何 create/move/attach/detach/undo
  必须先有带 revision、幂等键和补偿语义的统一命令契约，不能拼接现有行级 CRUD。

## 物料服务与 capability

- UI 只能依赖 `packages/services/src/materials.ts` 暴露的 port，不得直接
  `fetch` OS 或 Go backend，也不得按 profile id 在组件中分支。
- 路径同名不代表语义相同。当前 OS local server 的 `/api/v1/materials`
  是只读 MaterialAggregate 投影；当前 Go backend 的同名接口是持久化 Material
  行 CRUD，RelativePosition、Site 与 StateHistory 另有接口。
- `ServerCapabilities` 描述当前已完整实现的语义，不描述规划。未知 profile
  deny-by-default；按钮和命令必须按 capability 明确降级，不能收到 404 后再猜。
- 本地 OS 与本地 Go backend 使用 singleton material scope，不要求
  `laboratoryId`；只有未来云端多实验室 scope 才能要求该字段。
- Edge 的模板源是 OS 已构建 Registry 经
  `/api/v1/resource-templates` 暴露的全量 summary 目录；不得保留 Cloud、
  bundle 或测试数组作为产品 fallback。列表本地搜索/分类，详情按 UUID 懒加载。
- 模板 Query key 必须至少隔离 profile id、Edge HTTP 地址和 material scope；
  切换完整 Profile 或修改地址后，不得短暂展示上一端点的目录。
- 目录 `stale=true` 时可以只读浏览缓存，但必须禁用创建并显示可恢复提示；
  `status=unresolved` 的单个模板也不得创建。目录失败且无缓存时 fail closed。
- 模板目录与 Material Graph store 严格分离：目录进入 TanStack Query，实例图进入
  Zustand。模板存在不代表当前 OS 图中已有对应实例。

## 2D、2.5D 与 Pascal 3D

- Pascal Editor 保持外部、固定版本依赖。`pascal-host` 只加载上游，
  `pascal-lab-plugin` 只实现 Uni-Lab node、模型与坐标适配；禁止 vendor/fork
  一份 Pascal renderer 到本仓库。
- 2D/3D/Split 使用同一个 Pascal Editor 的原生 view mode。2D 可叠加
  React Flow floorplan；不得创建第二个隐藏 3D scene 来实现 Split。
- 2.5D 是 `packages/material` 的通用 SVG 投影。尺寸、site、占用和标签来自
  Material Graph；可以从物理外包络画空层架，但不能伪造 occupied material、
  site id、孔位或设备数据。
- 3D 保留 Pascal 原生 scene、网格、灯光和 post-FX。不得为某个测试模型覆盖
  scene 背景、把网格画到模型之上，或写死 camera target/distance。
- “适配场景”必须从当前可见对象的 bounding volume 通用计算，不得按
  `plr_test`、设备名称或资源路径设置 case-specific camera。
- 设备标签可常显，普通物料 hover/selected/highlight 时显示；2D、2.5D 和 3D
  使用同一 material id 驱动选择和高亮。

## 工作流架构原则

- `packages/workflow-editor` 是前端工作流文档、代码编辑、DAG 画布和调试交互的唯一所有者。
  不得把 Cloud 旧版 canvas、revision store、canvas controller 或 Redux 工作流状态复制进来。
- 已应用的 Backend-shaped Workflow/Node/Edge Graph 是执行定义权威；
  WorkflowTask 创建时冻结其 snapshot 和 execution plan。ReactFlow 的
  `nodes`/`edges` 只是可视化投影，不能反向充当执行载荷。
- 前端访问本地 OS 和新 backend 必须共用 `packages/services/src/workflow.ts` 定义的
  `WorkflowRuntimePort`。组件不得直接 `fetch` 工作流接口，也不得为 OS/backend 各维护一套请求结构。
- Workflow/Task/Node/Edge/Job wire 字段保持 Backend snake_case；实体主键读
  `uuid`，关系字段读 `workflow_uuid`、`workflow_task_uuid`、
  `workflow_node_uuid`。路径和局部身份变量使用 `workflow_uuid`、`task_uuid`、
  `node_uuid`、`edge_uuid`、`job_uuid`，不得保留 `runId`、泛化 `id` 或
  camel-case wire alias。
- 运行前必须先保存/Apply 完整、包含 branch/join 等控制节点的 DAG，然后只按
  `workflow_uuid` 和 Task input 创建 WorkflowTask。调试启动只额外提交非空
  `start_node_uuids` 和 `breakpoint_node_uuids`，不得通过修改已保存 DAG 实现。
- OS/backend 是运行状态、逐节点结果、调试状态和异常的权威来源。前端只能展示或做运行前范围预览，
  不得乐观伪造 `success`、`failed`、`skipped`、`paused` 或运行终态。

## JSON / Python 编写与同步

- JSON 与 Python 是同一个 Canonical revision 的两种编写视图，不是两份独立工作流。
- JSON → Python 必须调用 `/api/v1/authoring/generate-python`；Python → Canonical 必须调用
  `/api/v1/authoring/compile`，并在应用、保存或执行前调用 `/api/v1/authoring/validate`。
- Python 转换必须使用 OS 的 `from_python_script` AST 编译路径。浏览器中绝对禁止
  `eval`、`exec` 或自行解释用户 Python，也不得伪造 revision id、诊断结果或 source map。
- Python 视图的代码标记、选中节点、起始点和断点使用 OS 返回的 `source_map` 对齐；
  JSON 视图使用稳定的 `node_id` 对齐。重新编译后必须按新 source map 重映射。
- 所有控制节点都必须保留稳定 `node_id` 并可被定位。生成 Python 时产生的隐式 join 也必须在
  source map 和代码注释中可见，不能因其不是显式设备调用而丢失。
- 编译或校验失败时保留当前编辑内容，显示结构化诊断，且不得用失败候选覆盖最后一个有效 revision。

## 调试器与 DAG 展示

- 起始点和断点必须在 DAG 与代码两个视图中同步展示，并提供可发现、可访问的按钮；
  右键设起点、双击切换断点只能作为快捷方式，不能是唯一入口。
- 设起始点后，起点之前及从整个起始前沿不可达的节点在运行前预览中置灰；真正运行后以
  OS debug projection 返回的 `out_of_scope_node_uuids` 为准。out-of-scope、
  disabled 和 runtime `skipped` 必须保持三种不同语义。执行范围外的断点不得下发。
- 断点语义是“节点被调度、申请资源、进入设备动作队列之前暂停”，不是节点执行完成后暂停。
- 断点配置只是 Task-scoped 匹配规则；只有具体 WorkflowNodeJob attempt 真正到达
  准入边界时，OS 才会持久化一个
  `WorkflowNodeAdmissionHold(reason=breakpoint)`。branch-local 单步在下一因果
  准入前沿使用同一模型的 `reason=step`；同一 Job 最多一个 Hold，重试的新 Job
  对应新的 Hold。
- `open` Hold 时 Job 仍保持 Backend `pending`；蓝色“暂停于节点前”必须来自 debug
  projection，不能根据 `pending`、计时器或前端遍历 DAG 推测。Hold 释放后不得因同一
  Job 等待资源而在本地重新显示。
- 后续单个 Hold 命令必须使用 `hold_uuid`，不得只按 Node UUID 定位，也不得乐观删除
  Hold；命令响应后仍以 REST debug projection 为准。
- 普通 Task 全局命令统一走
  `POST /api/v1/workflow-tasks/{task_uuid}/commands`，共享命令只有
  `step`、`pause`、`resume`、`cancel`。OS-only 调试启动使用
  `POST /api/v1/debug/workflow-tasks`，恢复投影使用
  `GET /api/v1/debug/workflow-tasks/{task_uuid}`；Admission Hold 命令使用
  `POST /api/v1/debug/workflow-tasks/{task_uuid}/commands`。组件不得恢复旧 Run
  命令名或自行发明语义。
- `continue`/`step` 必须显式选择单个 Hold 或 `all_open`，不得靠省略 scope 表示
  全部。`step` 只推进被选中的因果支路，其他独立支路可以继续；`resume` 只表示
  Backend Task-global pause 的恢复。
- Composite Workflow Invocation 没有 Job 或 Hold。OS debug projection 将真实内部
  Holds 聚合到组合框；`step_into` 只展开该投影，不发送命令。`step_over` 和
  `step_out` 必须发送 composite UUID 与当前完整 Hold UUID 快照，遇到 `409` 时重新
  补水，禁止用 composite UUID 乐观释放后来产生的 Holds。
- 步过/步出不得忽略内部显式断点、人工确认、异常、介入或重试。透明组合的输出 Handle
  就绪后可以在组合框仍运行时暂停外部后继，前端不得把它伪装成 completion-gated。
- Task-global pause 和 Admission Hold 是两个独立门。`resume` 只清除全局暂停；
  `continue` 只释放 Hold；step-family 只能凭 OS 持久化的精确 scoped permit 穿过
  当前全局暂停，不能乐观恢复其他支路。
- `step`/`step_over`/`step_out` 返回接受时 Hold 仍为 `open`。只有 OS 实际取得
  execution claims 并完成准入事务后，Hold 才变为 `released`、permit 才被消费，
  Node 才能显示橙色 `正在运行`。等待资源期间不得提前移除暂停态。
- 更新的全局 pause 可以取消尚未消费的旧 permit，但不会丢失原 open Hold。前端必须
  重新读取 debug projection，不能在本地推断 pause/permit 的胜负顺序。
- 使用固定中文状态：`断点暂停`、`单步暂停`、`单步已请求，等待调度`、
  `单步已请求，等待资源`、`断点暂停（工作流已全局暂停）`、
  `单步暂停（工作流已全局暂停）` 和
  `工作流已全局暂停；单步请求已取消`。
- 颜色不得混用：
  - 绿色：节点已成功 `success`。
  - 蓝色：暂停在该节点之前，节点尚未执行。
  - 橙色：节点正在 `running`。
  - 紫色：所选起始点。
  - 红色：断点。
  - 灰色：起点前/不可达或 OS 已报告 `skipped`；文字标签要区分两者。
- 颜色只能作为辅助信息。状态必须同时通过文字、CSS class/图标和可访问标签表达。
  “选中节点”的蓝色绝对不能与“正在运行”混为一谈。
- `packages/workflow-editor/src/hooks/useWorkflowDebug.ts` 只是本地 UI 状态辅助，不能作为真实运行状态机；
  运行中状态必须来自 `WorkflowRuntimePort` 的 Task、Job、debug projection 和全局 SSE
  失效通知。
- debug projection 必须保留完整 Hold attempt 历史、当前 composite-stop 投影和
  Task 创建时冻结的 `applied_source.python_source/source_hash/source_map`。既有 Task
  的代码标记只能读取这份 frozen source；coding agent 对当前 Draft 的修改不能移动
  旧 Task 标记，也不能被 frozen source 覆盖。

## 统一接口边界

前端工作流只采用以下 v1 契约：

- `GET|PUT /api/v1/workflows/{workflow_id}/graph`
- `POST /api/v1/workflows:validate`
- `POST /api/v1/authoring/compile`
- `POST /api/v1/authoring/generate-python`
- `POST /api/v1/authoring/validate`
- `POST /api/v1/workflow-tasks`
- `GET /api/v1/workflow-tasks/{task_uuid}`
- `GET /api/v1/workflow-tasks/{task_uuid}/jobs`
- `GET /api/v1/workflow-node-jobs/{job_uuid}`
- `POST /api/v1/workflow-tasks/{task_uuid}/commands`
- `POST /api/v1/debug/workflow-tasks`（仅明确配置的 OS Authority）
- `GET /api/v1/debug/workflow-tasks/{task_uuid}`（仅明确配置的 OS Authority）
- `POST /api/v1/debug/workflow-tasks/{task_uuid}/commands`（仅明确配置的 OS Authority）
- `GET /api/v1/events`（唯一工作流实时通道，SSE，使用 `Last-Event-ID`）

旧兼容 HTTP 端点不得暴露给新 UI；新功能不得依赖 `/api/run`、
`/api/runtime/local/*`、`/api/v1/runtime/runs` 或 backend 私有接口。旧 Cloud panel
`/ws/workflow/{uuid}` 已从 OS 删除，禁止重新引入 client、proxy 或协议类型。

普通 `/workflow-tasks` 请求不得加入 OS-only 字段，也不得把调试配置藏入
`meta_data`。Authority 类型是显式连接配置：选择 Backend 时不得请求 OS-only debug
路由、不得通过 capability/404 探测或 fallback；界面显示
`当前 Backend 暂不支持起始点和断点调试，可使用全局单步执行。`

## 异常与实时事件

- 普通 Task/Job/结果更新、调试状态、人工确认、介入和重试通知全部使用同一个
  `/api/v1/events` SSE。普通更新与弹窗事件只是 UI 处理不同，不得重新拆成
  WebSocket 与 SSE 两套传输。
- 普通运行态只增加一个 `workflow.runtime.changed` 事件。其 data 必须恰好包含
  `workflow_task_uuid`、始终存在的 `workflow_node_job_uuids` 数组和非空
  `projections` 数组；不得把 status、result、Hold、permit、source 或 cause 当作
  event patch。`job.feedback`、intervention 和 manual-confirmation 的既有事件名
  保持不变。
- SSE 初次连接、按 `Last-Event-ID` 重连或收到失效事件后，通过 REST 重新获取
  Task/Job 权威状态；不得恢复 Task-scoped event socket 或把轮询当成第二实时协议。
- `packages/services` 必须先连接并缓存 SSE，再并行读取 Task/Jobs/debug baseline，
  合并缓存失效后补读，最后一次性发布完整 snapshot。命令成功也立即执行同一补水；
  任一读取失败保留上一份完整 snapshot 并显示 `状态同步中断，正在重试`，不能把
  新 Jobs 与旧 debug projection 混合。
- React 组件只能订阅 `WorkflowRuntimePort` 发布的一致 snapshot；不得接触原始 SSE
  frame、cursor、`Last-Event-ID`、重连或事件合并。这些属于 services 深模块的
  Implementation。每个 Authority/Profile 独立保存 cursor，切换 Profile 必须销毁旧
  stream 和缓存作用域。
- “attention event” 是前端交互分类，不是新 event type。只有
  `intervention.required`、`manual_confirmation.required` 等需要操作者的事件在补读
  权威 REST 对象后打开弹窗；自动重试、普通失败、断点、单步和资源等待只刷新运行投影。
- HTTP 接受、SSE 送达或命令返回，不等于节点或 Task 成功。终态只能由后续权威投影确认。
- `dispatch_unknown`、`reconciling`、资源等待、取消中和结构化 problem detail 必须如实显示，
  不能折叠成“失败”或“成功”。
- 用户可见错误应包含可行动的信息；不得吞掉 Promise rejection、SSE 解析/重连错误或
  authoring diagnostics。E2E 中出现 `console.error`、`pageerror` 应视为失败。

## 绝对不能做

- 不能新增第二套 renderer、第二个 Material store 或第二份 Pascal scene。
- 不能让组件直接请求 OS/backend，或以 `backend.id` 分叉业务组件。
- 不能恢复 Cloud panel/静态 JSON 模板作为 Edge 目录 fallback，不能把模板 summary
  塞进 Material Graph Zustand store。
- 不能把 Go backend 行级 CRUD 冒充已经实现的统一 Material Graph 写协议。
- 不能把 well/tip spot 固化为长期 Site 契约。
- 不能用高频关节帧改写 relative position/site，或让 React Flow 随关节帧重渲染。
- 不能为测试场景硬编码模型尺寸、site、occupancy、camera 或颜色。
- 不能修改/复制 Pascal 上游源码来绕过 host/plugin 边界。
- 不能从 ReactFlow 图生成一个有损 DAG 后直接下发。
- 不能把“从起始点开始”的裁剪图保存成 Workflow；必须先保存完整 Graph，再由 OS
  根据 debug Task 的 start frontier 构造不可变 execution plan。
- 不能在浏览器执行用户 Python。
- 不能靠前端计时器模拟 OS 的逐节点成功、断点命中或单步完成。
- 不能为 OS 和 backend 分叉组件逻辑或复制类型；差异只能收敛在 service/backend adapter。
- 不能新增或保留 WorkflowTask/Run WebSocket，也不能将设备状态 socket 复用为工作流通道。
- 不能用绿色表示“选中”，不能用蓝色表示“运行中”。
- 不能手工编辑 `pnpm-lock.yaml`；依赖变更使用 pnpm。
- 不能为了通过测试移除控制节点、source map、错误状态或真实 OS 联调断言。

## 验证

从仓库根目录至少执行与变更相符的命令：

```bash
pnpm typecheck
pnpm test
pnpm build:web
pnpm build:desktop
pnpm test:e2e:materials
pnpm test:e2e:workflow
pnpm test:e2e:workflow-debug
```

物料/场景变更必须至少覆盖：真实 OS Material API、真实模型资源 200、2D/2.5D/
3D/Split 切换、相同孔位尺寸、site key、通用 camera fit、无 `console.error`/
`pageerror`。模板目录变更还必须覆盖 Registry 全量 summary、懒详情、Profile/地址
缓存隔离、stale 只读降级与无缓存失败。Xvfb 无法运行 Pascal post-FX 时，只能在测试 URL 使用 Pascal 官方
diagnostic escape hatch，不能改产品默认 scene。

工作流 E2E 应连接真实 local bridge/OS v1 契约，不得用路由 mock 证明“端到端成功”。
测试和截图至少覆盖：完整 DAG、控制节点、JSON/Python 往返、起始点置灰、断点暂停、
橙色运行态、绿色成功态、单步、异常和终止。
