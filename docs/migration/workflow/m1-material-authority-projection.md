# FE M1：Material authority projection 消费设计

日期：2026-08-01

分支：`migration/m1-material-authority-projection`

基线：`integration/fe-os-migration@a641fa6fa38b223ec90648a2c308c67d4a57b6fd`

控制面：

- [Core #155](https://github.com/Uni-Lab-OS/Uni-Lab-Core/issues/155)：M1 Material/Site
  Authority、Reservation/Claim 与恢复合同；
- [Core #156](https://github.com/Uni-Lab-OS/Uni-Lab-Core/issues/156)：contention、fencing、
  restart 跨仓验收 gate；
- [Core #158](https://github.com/Uni-Lab-OS/Uni-Lab-Core/issues/158)：test-author/reviewer
  治理冲突裁决。

## 1. 结果与停止线

FE M1 只消费 OS 权威的 Material/Site、Task Reservation 与 Job Claim read projection，
并把它们投影到现有 `MaterialAggregate`、WorkflowTask/WorkflowNodeJob 状态和状态提示。
前端不参与 resource resolution、reservation、claim、fencing、release 或 reconciliation
决策。

本轮后续 production 必须：

- 继续以 `packages/material` 的 `MaterialAggregate` 作为唯一 Material business projection；
- 只通过 `packages/services/src/materials.ts` 及共享 Workflow runtime port 请求 OS；组件
  不直接 `fetch`；
- Task 启动时只提交 closed ResourceSlot `{uuid}`；
- 原样区分 OS 的 `400 invalid_input`、`404 not_found`、`409 conflict`；
- 如实展示 Reservation waiting/contention、Claim active/fenced/released 与
  reconciliation；
- 通过既有全局 SSE invalidation 后 REST rehydrate，不消费 event patch，不增加 polling 或
  WebSocket。

本设计不修改 production code。Core #158 Accepted、OS DTO gate 冻结、独立 RED gate 被明确
允许之前，不开始 FE production RED 或 implementation。

Feishu OKF《01.1 工作流协议》revision 9（wiki node
`Qa1EwFWB1iqx4OkfNXhcvTh3nPf`）仍把 Site label 写成跨端 identity；Core #155 与 OS exact
baseline 则采用 stable Site UUID。FE 本轮只实现 UUID 候选合同，不做 label fallback；M1
Accepted 前必须先在正式 Feishu Protocol 中记录 supersession。

## 2. 单一权威与前端所有权

权威关系固定为：

```text
OS Material Module durable truth
  -> closed REST DTO
  -> packages/services adapter
  -> one MaterialAggregate projection
  -> React Flow / 2.5D / Pascal / Workflow picker
```

规则：

1. Zustand Material store 不保存第二份 OS row、Reservation、Claim 或 allocation state；
2. React Flow、Pascal、Workflow editor、Task launch form 不各自复制 Material/Site entity；
3. Reservation/Claim 是 runtime read projection，可由 TanStack Query/共享 runtime controller
   按稳定 Task/Job UUID 缓存；它们不是 MaterialAggregate 的可编辑字段；
4. frontend selection、disabled option、spinner 和 toast 都不是 authority。刷新后必须以 OS
   REST projection 为准；
5. 不用 `config.sites`、数组 ordinal、display name、barcode、React key 或 Pascal object id
   推断 stable Material/Site identity；
6. 不乐观标记“已预留”“已 Claim”“已释放”，也不因请求完成、SSE 到达或本地计时器伪造
   lifecycle。

## 3. OS DTO gate

FE production 类型/adapter 开始前，OS 必须在 exact implementation spec/contract tests 中
冻结并提供以下内容：

- Material list/detail 的 route、pagination、closed fields 与 enum；
- Site 的 stable `uuid`、owner `material_uuid`、`sort_order`、template allowlist、nullable
  `occupied_material_uuid`、geometry、version；
- Reservation 按 `workflow_task_uuid` 查询的 route、complete member shape、lifecycle 与
  authority-owned waiting/contention reason；
- Claim 按 `job_uuid + attempt` 查询的 route、typed complete members、
  `active/fenced/released`、fencing generation/token 的 read-only 诊断形状与 stable reason；
- Task `pending` 且零 Reservation 时，能够区分“等待 Material contention”与普通尚未
  admission 的显式字段；FE 不从空数组自行猜 reason；
- `400/404/409` problem detail 的 machine code、字段诊断位置与可安全展示的 reason；
- global SSE event name、closed invalidation payload、cursor/replay 规则，以及收到事件后需
  rehydrate 的 REST resources；
- restart 后 Reservation/Claim/fenced state 的读回语义。

这些项目未冻结时，FE 只保留现有行为，不先造 speculative DTO、capability、fixture、route
或 UI 假状态。路径同名不等于语义相同；不得把当前 legacy `/api/v1/materials` 中
`config.sites` 的兼容 projection 当成 M1 Site contract。

建议 adapter 内部 raw DTO 语义如下，字段拼写最终以 OS DTO gate 为准：

```text
MaterialAuthorityDTO
  uuid
  resource_template_uuid
  parent_uuid?
  code
  disposition
  version
  create_time / update_time

SiteAuthorityDTO
  uuid
  material_uuid
  name / sort_order
  allowed_resource_template_uuids
  occupied_material_uuid?
  geometry
  version

TaskReservationDTO
  workflow_task_uuid
  status
  members[] { material_uuid }
  waiting_reason?

JobExecutionClaimDTO
  workflow_node_job_uuid
  attempt
  status: active | fenced | released
  members[] { kind, uuid }
  fencing_generation
  reason?
```

raw DTO 只能存在于 services adapter boundary；React component 不读取 snake_case network
object。`fencing_generation` 只供诊断/新旧投影识别，FE 永不把它回传为 commit/release 权限。

## 4. MaterialAggregate / Site 投影

OS Material 与 Site DTO 经一个 adapter 合并为现有 `MaterialAggregate`：

| OS authority field | FE projection |
|---|---|
| `Material.uuid` | `material.id` |
| `resource_template_uuid` | `material.sourceTemplateId` |
| `code` | `material.code` |
| Material `version` | `aggregate.revision` |
| `parent_uuid` | composition 对应的 `placement.kind='parent'`，但不得由 Site occupancy 推导 |
| `Site.uuid` | `site.id` |
| `Site.material_uuid` | `site.ownerMaterialId` |
| `allowed_resource_template_uuids` | `site.allowedTemplateIds` |
| nullable `occupied_material_uuid` | 兼容当前 UI 的 `occupiedMaterialIds=[] | [uuid]` |

M1 Site 一个位点最多一个 occupant，因此 adapter 只能生成空数组或单元素数组，不能把 FE
现有 `capacity` 或 legacy `config.sites` 扩展为多占用权威。`Material.parent_uuid` 与 Site
occupancy 分别投影；不能因为 child 在 composition 中就自动标记 occupied，也不能因为
occupied 就改写 composition parent。

`Disposition` 作为 OS read-only business state 进入 Material domain 的只读展示字段或伴随
projection；具体字段落点由 DTO gate 后的 module review 决定。它不能塞回无边界 `config`
并由组件自行解释。`reserved/in_use` 不映射为 Disposition；分别由 Reservation/Claim
projection 展示。

## 5. ResourceSlot codec 与 Task form

用户在 Task launch form 或 typed Action input 中选择 Material 时，可显示 name、code、
template、Site 和当前权威状态，但请求值严格为：

```json
{"uuid":"<material-uuid>"}
```

规则：

- 不发送 `resource_template_uuid`、Material body、Site body、barcode、display label、local
  index、Reservation/Claim 或 authority selector；
- nullable slot 的 `null`、omission 与 default 继续遵守 I1/02H contract，M1 不另造规则；
- `list[ResourceSlot]` 是上述 closed object 的数组，保持顺序与重复引用；
- picker 的 template/filter 只是输入辅助，OS 仍重新验证；
- Task readback 中 canonical `{uuid, resource_template_uuid}` 是 OS snapshot projection，不代表
  下次 create 可把 template 回传；
- Material graph stale、DTO malformed 或 authority unavailable 时 fail closed，禁用提交并展示
  可恢复提示，不从 fixture/Cloud/cache 选一个替代 Material。

## 6. 400 / 404 / 409 展示

services adapter 保留 HTTP status、machine code、field diagnostics 与安全 reason，统一转换为
现有 structured `ServiceError`；组件不靠 message string 分类。

| OS response | FE 含义与展示 |
|---|---|
| `400 invalid_input` | ResourceSlot shape/type/template 或 Task 字段错误；定位对应字段，保留用户其他输入，不自动改值。 |
| `404 not_found` | Material/Site 不存在或已 soft-delete；标记当前选择失效，要求用户重新选择，不静默按 code/name 重绑。 |
| `409 conflict` | stable non-runnable disposition、fence、version 或 `material_in_use`；显示 OS reason 与建议动作，不乐观重试/释放。 |

另一个 Task 的 Reservation contention 不属于上述 create-time 409：Task 已成功创建并保持
`pending`，FE 进入 waiting 展示。late Job Claim contention 同样保持 Job pending，不显示成
Job failed。未知 4xx/5xx 不降级为三类之一，也不触发 local allocation fallback。

## 7. waiting / contention / Claim 状态展示

状态必须同时用文字、图标/CSS state 与 accessible label 表达，颜色只作辅助：

| 权威 projection | 用户可见语义 | 禁止展示 |
|---|---|---|
| Task `pending` + reservation waiting reason | `等待物料预留`，可显示冲突资源与 OS 安全 reason | `创建失败`、`输入无效` |
| complete Reservation `active` | `物料已为此任务预留` | `设备已占用`、`正在执行` |
| Job pending + claim contention reason | `等待执行资源` | `Job failed` |
| Claim `active` | `执行资源已占用`；只有 OS 后续状态决定是否已 dispatch | `动作成功` |
| Claim `fenced` | `状态核对中，资源仍锁定`，提供 operator guidance | `已释放`、`可再次运行` |
| Claim `released` | 历史上已释放；当前 availability 仍由最新 OS Material/Claim projection 决定 | 仅凭该历史行显示 `空闲` |
| Job `execution_unknown` / Task `waiting_reconciliation` | 复用现有 `reconciling` 展示并关联 fenced Claim | 自动 retry、自动 cancel success |

cancel HTTP accepted 只表示 intent durable；在 Claim 仍 active/fenced 时 UI 必须继续显示资源
受保护。restart/reconnect 后先 REST rehydrate Task、Jobs、Reservation、Claims 和 Material
projection，再解除 loading；不得用重启前 Zustand/Query cache 覆盖新权威状态。

## 8. SSE 与刷新

只使用现有全局 `GET /api/v1/events`：

1. 按 event `id` 去重，断开后使用 `Last-Event-ID`；
2. 收到 M1 invalidation 后 invalidate 对应 Material graph、Reservation/Claim 与关联 Task/Job
   query；
3. 通过 REST rehydrate closed projection；
4. partial read failure 保留明确 stale/loading/error，不把旧值包装成 fresh；
5. event payload 不是 state patch，不直接 mutate MaterialAggregate 或 Claim lifecycle。

不增加 material WebSocket、Task-scoped event route、timer polling fallback、静态假运行状态或
第二个 runtime controller。

## 9. M2 与本地权威停止线

在 Core #140～#146 分别 Accepted 前，FE M1 禁止实现或占位：

- MaterialSource node/mode/flow role；
- existing 自动选择、`create_new`、CandidateSiteSet；
- warehouse/mount selector、lot deduction、sensor occupancy/freshness；
- Backend allocation handoff、per-Material progress 或 Site status workflow；
- “没有匹配物料时自动创建”、随机/最近/第一个可用选择；
- capability flag、mock DTO、disabled button 或空 panel 形式的 speculative M2 surface。

FE 也不得建立浏览器 reservation/claim table、local lock、optimistic allocated flag 或把
`MaterialAggregate`/React Flow index 当作 availability authority。所有 allocation 决策由 OS；
前端只有 command intent、selection 与 read projection。

## 10. DTO gate 后的 RED 与验收

Core #158 裁决治理人数且 OS DTO gate 固定后，按被确认的唯一 agent gate 编写 RED。最低
验收：

1. services adapter 对 closed Material/Site/Reservation/Claim DTO 严格解析，unknown/missing/
   invalid enum fail closed；
2. `config.sites` 不再作为 M1 authority，single occupant 映射稳定；
3. Task request 对单个/nullable/list ResourceSlot 只发送 `{uuid}`；
4. exact 400/404/409 使用 machine code 呈现且不丢 field diagnostics；
5. 两 Task 争用同一 Material：获胜方 active Reservation，等待方 pending + zero Reservation，
   UI 不误报失败；
6. Claim active/fenced/released、stale attempt 与 cancellation/restart 时的状态文字准确；
7. SSE reconnect/cursor replay 后 REST rehydrate，不消费 patch、无 polling/WebSocket；
8. malformed/partial REST、OS restart 和 stale cache fail closed；
9. `MaterialAggregate` 仍唯一，组件无 direct fetch、local allocation 或第二 store；
10. 静态守护不存在 M2 #140～#146 placeholder/selector/create-new 实现。

跨仓 Accepted 证据以 Core #156 为准：真实 OS、同一 SQLite authority、并发/fault/restart、
stale fence、SSE + REST rehydration；route mock 或纯前端 fixture 不能作为完整 E2E。

## 11. 完成定义

FE M1 只有在以下条件全部满足后才能进入 implementation/Accepted：

- Core #155、#156 的合同仍有效，Core #158 已明确解决 production RED 门禁；
- OS DTO gate 的 route、DTO、reason、problem detail 与 SSE invalidation exact shape 已冻结；
- FE 只消费 authority projection，ResourceSlot request 只有 `{uuid}`；
- waiting/contention/fenced/reconciling 不被折叠成 success/failure；
- `MaterialAggregate` 仍是唯一 Material business projection，无 direct fetch/第二 store/本地锁；
- M2 #140～#146 无 production、DTO、capability、fixture 或 UI placeholder；
- typecheck、单测、Web/Desktop build、真实 OS E2E 与 exact-SHA Standards/Spec review 全绿。
