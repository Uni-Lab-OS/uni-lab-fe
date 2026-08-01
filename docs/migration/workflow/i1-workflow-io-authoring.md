# I1 Workflow I/O authoring and Task form implementation spec

## Outcome 与基线

本轮在原 `PersistentWorkflowAuthoringPanel` 中增加 Workflow Input/Output definition、真实
Handle binding 与由 Applied Contract 生成的 Task 启动表单。OS 继续拥有 schema、默认值、
类型兼容、ResourceSlot 解析、Apply 和 Task snapshot 的最终权威；前端只编辑 Candidate、
展示 diagnostics 并提交用户明确输入。

跨仓合同由
[Core #154](https://github.com/Uni-Lab-OS/Uni-Lab-Core/issues/154) 冻结。FE 实现基线固定为
`integration/fe-os-migration@a641fa6fa38b223ec90648a2c308c67d4a57b6fd`，实现分支为
`migration/i1-workflow-io-authoring`。OS dependency 基线为
`integration/workflow-task-runtime@91b00dd030483058a6d0aafc42f143de829cc1bc`。

跨仓验收门为
[Core #157](https://github.com/Uni-Lab-OS/Uni-Lab-Core/issues/157)。

本轮复用现有 `packages/workflow-editor`、`packages/services/src/workflow.ts`、
CodeMirror、DAG、Debugger 与 Output，不建立第二套工作台、第二个 Workflow store 或
OS/backend 分叉组件。

## Phase 02H 已完成，FE 不复制其权威

OS Phase 02H 已完成：

- Task create 前 v1 input preflight；
- default/null/closed schema 与 strict normalization；
- ResourceSlot resolver port 和 `400/404/409` 映射；
- canonical `WorkflowTask.input`、exact snapshot、Job param 原子写入；
- target Handle UUID input binding 与零 partial write。

I1 FE 不实现一套可与 OS 分歧的 preflight，不在浏览器 materialize authoritative defaults，
不根据字段名/Action 名/port ordinal 猜类型或 Material。前端本地校验只为即时 UX；Task 是否
可创建及 canonical input 仍由 OS 决定。历史 OS Phase 02H ticket 不得复制为 FE I1 scope。

## 统一 service seam 与 typed projection

所有 I1 UI 继续只依赖 `packages/services/src/workflow.ts` 的 `WorkflowRuntimePort`。组件不得
直接 `fetch` Authoring、Graph、Task 或 Material API，也不得从 profile id 推断能力。

services 增加与 Core #154 closed wire 一一对应的 discriminated types/decoder：

```ts
type WorkflowValueSchema =
  | { type: "string"; /* frozen finite constraints */ }
  | { type: "integer"; /* frozen finite constraints */ }
  | { type: "number"; /* frozen finite constraints */ }
  | { type: "boolean" }
  | { type: "object" }
  | { type: "array"; items: WorkflowValueSchema }
  | { $slot: "ResourceSlot"; allowed_resource_template_uuids?: string[] }
  | { anyOf: [WorkflowValueSchema, { type: "null" }] };

type WorkflowInputBinding = { parameter: string };

type WorkflowOutputBinding =
  | { kind: "workflow_input"; parameter: string }
  | {
      kind: "node_output";
      workflow_node_uuid: string;
      source_handle_uuid: string;
    };
```

实际类型还必须包含 ordered Input/Output descriptor 与 v1 envelope，并精确表达：

- input 的 `required/default/title/description`；
- output 没有 `required/default`；
- output `implicit` 是 server-managed readonly；
- Node input binding map 的 key 是真实 target Handle UUID；
- root output binding map 的 key 是 Output Contract name。

runtime decoder 对 malformed envelope、unknown binding variant、unknown schema discriminator 和
非法 nullable shape fail closed，不把它降级成 `Record<string, unknown>` 后交给组件猜测。
opaque JSON object 的 value 内容可以开放，但其 descriptor/schema envelope 仍 closed。

`WorkflowAuthoringGraph`/aggregate 必须投影真实 WorkflowNodeTemplate、
WorkflowHandleTemplate identity、schema 与 I/O metadata。ReactFlow nodes/edges 仍只是视图，
不得成为 Apply payload 或 binding authority。

## Workflow I/O authoring UX

在现有 authoring panel 中增加两个可访问的编辑区域：

1. **Workflow Inputs**：按 contract 顺序编辑 name、type/schema、required、default、nullable、
   title、description，并把 input 绑定到 Node 的真实 target Handle；
2. **Workflow Outputs**：按 contract 顺序编辑 name、type/schema、title、description，并从
   Workflow input 或 Node 的真实 source Handle 中选择唯一 producer。

交互规则：

- selector 可以显示 Node/Handle label 帮助用户，但保存值只能是稳定 UUID/name contract；
- source selector 只列 source Handle，target selector 只列本 Node 的 target Handle；
- 已有 Edge、static param 与 Workflow input binding 冲突时，在 Apply 前展示 OS diagnostic，
  不由 UI 静默删除其中一个 provider；
- `implicit: true` output 以只读行展示来源和 schema，不能由用户新增、删除或切换；
- required/default/nullable 的非法组合在 UI 即时提示，但仍以 OS Validate/Apply 为权威；
- opaque object 使用明确 JSON editor，不从当前 object keys 生成永久字段 schema；
- `AllowedResourceTemplates` 只消费 A1 Catalog 发布的 symbol/UUID 投影，不从 display name 猜 UUID；
- Catalog fingerprint stale 时保留当前编辑内容，显示需刷新/重新选择，不自动重绑定。

JSON 与 Python 是同一 Candidate 的两个视图。JSON-side I/O 编辑修改 Candidate 后必须通过
OS `authoring/generate-python` 生成 canonical result-record Python；Python-side 编辑必须通过
OS compile 返回 Candidate。保存/Apply 前调用 OS validate，reserved I/O metadata 只能通过
Authoring Apply 原子提交，不能用普通 Graph PUT 或 metadata PUT 绕过。

canonical Python output 使用与 Action 相同的 `TypedDict`、frozen dataclass 或兼容 inline
return-annotation dict。前端不生成、解析或执行 Python；旧 `workflow_output(...)` 即使被 OS
作为 migration input 接受，CodeMirror 收到的 normalized source 也必须是 result-record
canonical form，不在 UI 暴露双轨开关。

## Applied-contract Task 启动表单

普通 Run 按钮继续调用现有 WorkflowTask controller，但在 create 前展示由当前 Applied
Workflow 的 Input Contract 生成的表单。Candidate/Draft 尚未 Apply 的 I/O 改动不得成为 Task
payload；UI 应明确提示本次执行使用 Applied revision。

表单值必须区分三种状态：

```text
untouched / omitted
explicit null（仅 nullable 输入可选）
explicit value
```

默认值显示为 OS contract 提供的提示或初始展示，但 untouched 字段提交时省略，让 OS 应用并
冻结 default。`false`、`0`、`""`、`[]` 与 `{}` 是显式值，不能被 falsy 过滤成 omission。
前端不得用字符串 coercion 生成 integer/number/bool；结构化值和 list 按 frozen schema 使用
typed control 或 JSON editor。

点击提交前先 rehydrate Applied aggregate，重新建立表单所依据的 revision。按 OS public
contract，`POST /api/v1/workflow-tasks` 不携带 expected revision，也不新增 FE 私有字段。创建
成功后以返回的 `WorkflowTask.workflow_snapshot`/revision 和 canonical `Task.input` 为准；若
实际 snapshot revision 与表单起始 revision 不同，UI 明确提示已使用更新后的 Applied
snapshot，并重新投影表单，而不是声称执行了旧 revision。

`WorkflowTaskController.create()` 扩展为接受已验证的 `input` object，但普通 Task payload 仍
只包含共享字段；起点、断点等 Debugger preview state 不进入普通 Task payload。

## ResourceSlot selector 与 codec

ResourceSlot control 显示 Material identity、类型和必要的状态摘要，但只提交：

```json
{"uuid": "<material_uuid>"}
```

严禁提交 `resource_template_uuid`、MaterialAggregate、Material tree、index、label 或前端生成的
临时 identity。`list[ResourceSlot]` 保持用户顺序和重复项；UI 不 flatten、不自动去重。

Material options 通过应用装配层注入的窄只读 port 获得，优先复用
`packages/services/src/materials.ts` 已有 Material projection；workflow-editor component 不直接
fetch，也不依赖 Material Zustand store 作为执行真值。FE 可按
`allowed_resource_template_uuids` 过滤/标注选项改善 UX，但 OS 必须重新校验。

错误展示保持权威分类：

- `400 invalid_input`：字段 shape/type/template mismatch；
- `404 not_found`：选择的 Material 不存在或已 soft-delete；
- `409 conflict`：Material Authority 报告稳定冲突或 resolver 尚未可用。

Core #154 尚未冻结 Task error envelope 的字段级扩展。存在 OS JSON Pointer diagnostics 时可
定位到 control；Backend/OS 不提供时正常降级到 form-level actionable error，不伪造“后端字段
诊断”。Reservation pending、占用详情与自动选择属于 M1/M2，不在 I1 前端推断。

## Output 停止线

I1 可以编辑并展示 Workflow Output Contract/Bindings，但不提前实现 O1：

- 不从 Job `return_info`、feedback 或 DAG 状态拼装 WorkflowTask output；
- 不在 running、failed、canceled 等状态展示 partial output；
- 不把现有 `WorkflowOutput` 的 Job/feedback surface 改称 Workflow result；
- 不因 Output Contract 已存在就乐观显示成功结果。

完整、原子、仅成功终态可见的 `WorkflowTask.output` 由 O1 交付。在此之前保持当前 Runtime
projection，不新增第二个 result store。

## RED → GREEN slices

治理阻塞解除后，按以下 slice 实施：

1. **Typed contract**：services decoder/types 对 malformed/unknown schema 和 binding 先 RED，
   再替换 workflow-editor 内泛化 I/O Record；
2. **Read-only projection**：先在现有 panel 展示 Applied input/output 与真实 Handle，再加入
   Candidate editor；
3. **Authoring mutation**：验证 JSON edit → OS generate-python → validate → Apply → reload
   fixed point，并证明 diagnostic 时保留 buffer；
4. **Task form**：补 omission/null/default/falsy/strict control 与 controller request RED；
5. **ResourceSlot**：补窄 option port、allowlist UX、只 `{uuid}` request 和 `400/404/409`；
6. **真实联调**：固定 FE/OS exact SHA，完成 scalar gate；A1 ready 后补 Catalog/result-record，
   M1 ready 后补真实 ResourceSlot success/conflict。

FE unit/component tests 至少覆盖：

- closed schema decoder、ordered descriptor、nullable/default 合法矩阵；
- input/output reorder、rename、delete、binding orphan 和 implicit readonly；
- selector 保存真实 Handle UUID，不保存 label、data_key 或 ordinal；
- Python/JSON 切换、Apply、reload 后 contract/binding 不漂移；
- compile/validate/Apply error 保留编辑文本与最后一个 valid Candidate；
- Task form untouched omission、explicit null、false/0/empty values、no coercion；
- controller 发送准确 input，普通 Task payload 不含 debugger preview；
- ResourceSlot 只发送 `{uuid}`，list 顺序/重复保持，caller template UUID 为零；
- snapshot revision 竞态提示与 canonical `Task.input` rehydrate；
- I1 不新增 Task output 聚合、旧 Run/WS/Task-scoped event 或 timer polling。

真实 OS Playwright gate 至少覆盖：

1. 编辑 input/output、绑定、Apply、reload 与 Python/JSON fixed point；
2. required/default/null/opaque object/list 的准确网络 payload 与 canonical Task input；
3. 错误 Handle、unknown binding、stale Catalog/revision 的 fail-closed UX；
4. A1 后的 `AllowedResourceTemplates` round-trip；
5. M1 后的 ResourceSlot `{uuid}` success、404 和 409；
6. 全程无 forbidden request、Runtime WebSocket、pageerror、application error 或 polling。

最终候选运行 `pnpm typecheck`、`pnpm test`、`pnpm build:web`、
`pnpm build:desktop`、相关真实 OS workflow E2E 和 `git diff --check`。E2E、review 与报告必须
固定 exact SHA；任何 production change 都使对应证据失效。

## Governance decision 与可移植性

[Core #158](https://github.com/Uni-Lab-OS/Uni-Lab-Core/issues/158) 已 Accepted，并明确
supersede Core #104 的 2 test-author / 3 reviewer 数量要求。I1 每个 round 使用恰好一名
test-author、一名 implementation owner 和一名 reviewer；同一 round 严格串行，A1/I1/M1
可以在隔离 branch/worktree 中并行。FE production implementation 仍必须先取得独立 RED
commit。

`packages/services` 的 typed port 是 FE 唯一可移植边界：组件不得依赖 snake_case wire row、
FastAPI/SQLite 细节、浏览器全局或某个部署 profile。Web、Desktop 与测试 adapter 必须消费
同一 canonical DTO/diagnostic semantics；更换 OS transport 或持久化 adapter 不得要求复制
schema store 或改写 Workflow editor domain model。

## Non-goals

- 不重做 Phase 02H preflight、Task snapshot、ResourceSlot resolver 或错误映射；
- 不新增第二套工作台、Workflow store、schema source、Python interpreter 或 backend-specific
  component；
- 不加强/旁路 `@action` decorator，不让 FE 定义 Action schema；A1 负责 Catalog；
- 不做 Material allocation、Reservation/Claim、MaterialSource、Site mutation 或自动选择；
- 不做 Composite authoring/runtime、ExecutionPlan admission、device execution 或 Debugger Hold；
- 不修改共享 Task request 增加 expected revision，不恢复 Run DTO/Runtime WebSocket/轮询；
- 不提前实现 O1 `WorkflowTask.output`。
