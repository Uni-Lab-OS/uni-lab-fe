# @unilab/workflow-editor

Uni-Lab 前端唯一的工作流编辑器与调试 UI。

该 package 拥有工作流文档、代码编辑、DAG 画布和编辑状态。不得引入
Uni-Lab-Cloud 的 workflow canvas、revision store、canvas controller 或
Redux 状态。不同后端的工作流数据必须先通过 `services`/app adapter 转换为
本 package 的内部模型。

> 当前产品代码仍在使用旧 `WorkflowRun`、`/api/v1/runtime/runs`、
> Workflow WebSocket/轮询和前端调试状态机。它们是待删除实现，不是兼容合同。
> 分阶段迁移见
> [`../services/WORKFLOW_RUNTIME_MIGRATION.md`](../services/WORKFLOW_RUNTIME_MIGRATION.md)；
> OS 调试 wire contract 见
> `/home/gaojing/Uni-Lab-OS/docs/developer_guide/workflow_task_runtime_migration/frontend_debug_runtime_interface.md`。

## 它负责什么

- 在 Backend-shaped JSON 和 Python 两种编写模式间切换。
- 用同一个稳定 UUID 图驱动代码、DAG、保存和校验。
- 展示完整控制流 DAG，包括 branch、join 和分支边。
- 编辑 launch-scoped 多起点、断点，并发送准确的 Task/Hold 命令 intent。
- 消费 `@unilab/services` 发布的一致 Task/Jobs/debug snapshot，展示逐节点结果、
  Hold、组合暂停、异常与 attention。

它不负责选择 backend、拼接 URL、解释用户 Python 或执行 DAG；这些能力分别属于
应用壳、`@unilab/services` 和 OS/backend。

## 单一数据流

```text
Authoring Draft (JSON or Python)
        │
        ├─ compile / validate / preview ─► Candidate Graph + diagnostics
        └─ Save / Authoring Apply ───────► persisted Workflow revision
                                                   │
                                                   └─ create WorkflowTask

global SSE invalidation ─► services REST rehydration bundle
                         └► coherent Task + Jobs + debug snapshot ─► UI
```

ReactFlow 的 `nodes`/`edges` 不是保存或执行输入。普通运行前先将完整图保存/Apply
到 Authority，再以 `workflow_uuid` 和 Task input 创建 WorkflowTask。OS 高级调试
只在 Task 创建时额外提交 `start_node_uuids` 和 `breakpoint_node_uuids`；运行请求
不携带 DAG、revision、`pause_on_start` 或嵌套 debug 对象。

## JSON / Python 切换

切到 Python 时调用：

1. `generatePythonWorkflow`：已应用 Graph → Python 候选及 `source_map`。
2. `validateAuthoringCandidate`：确认候选与 action catalog、schema 一致。
3. 验证成功后才替换编辑器内容。

Python 发生编辑后，切回 JSON、保存、校验或运行前调用：

1. `compilePythonWorkflow`：使用 OS 的 `from_python_script` AST 编译器。
2. `validateAuthoringCandidate`：验证候选。
3. 用候选 Graph 更新 DAG preview 和 `source_map`。
4. 只有显式保存/Apply 才更新持久化 Workflow；运行前必须完成该步骤。

失败时保留用户当前代码和上一个有效 revision。不要在浏览器执行 Python，也不要用
前端正则或行号猜测重建 DAG。

运行中的代码高亮不使用当前 Draft，而使用 Task 创建时冻结在 debug projection
中的 `applied_source.python_source` 与 `source_map`。coding agent 后续修改本地
Python 只改变 Draft/Candidate，不得移动已运行 Task 的标记，也不得用 frozen source
覆盖 Draft。

## 起始点、断点、Hold 与组合调试

- 节点卡片中的按钮是主入口；DAG 右键设起始点、双击切换断点是快捷方式。
- 起始点和断点同时投影到 DAG 与代码行。Python 使用 `source_map`，JSON 使用稳定
  `workflow_node_uuid` 的位置映射。
- 运行前可按多起点做范围预览；Task 创建后必须使用 OS 返回的
  `active_node_uuids` 和 `out_of_scope_node_uuids`，不能在浏览器生成运行事实。
- 断点表示“具体 WorkflowNodeJob 在申请设备/物料/Site 和进入动作队列前暂停”。
  一个蓝色暂停位置来自一个 `open` Admission Hold，Job 本身仍为 `pending`。
- `continue`/branch-local `step` 必须选择一个 Hold 或显式 `all_open`；
  Task-global `resume` 不释放 Hold，Hold `continue` 也不越过 global pause。
- `step_into` 只展开 composite frame，不调用 API；`step_over`/`step_out`
  使用 OS 投影中的 composite UUID 与精确 Hold UUID 快照。
- 命令 HTTP 成功只表示接受。Hold 在 OS 完成 claim/admission 事务前仍为 open，
  前端不能乐观显示 running。

### 视觉语义

| 展示 | 含义 |
|---|---|
| 绿色 + `已成功` | Job 已报告 `success` |
| 蓝色 + `断点暂停`/`单步暂停` | 该 Job 的 Admission Hold 为 `open` |
| 橙色 + `正在运行` | Job 已实际 admitted 并报告 `running` |
| 紫色起点标记 | 本次 debug Task 的 start frontier 成员 |
| 红色断点标记 | 本次 debug Task 的 breakpoint 配置 |

状态必须有文字或标记，不能只靠颜色。选中态不得复用蓝色暂停语义。
`out_of_scope`、Workflow `disabled` 和 runtime `skipped` 是三个不同事实；
其最终灰度、标签和组合框优先级等待 P1-1 最后一项 grill，迁移实现不得提前合并。

## 主要文件

- `src/components/WorkflowPanel.tsx`：编写、保存、Task 启动和调试 intent 的组合入口；
  迁移后不再拥有 transport 或运行状态机。
- `src/components/WorkflowDag.tsx`：只读拓扑投影及节点快捷交互。
- `src/components/WorkflowNodeCard.tsx`：节点状态、起始点和断点的可访问入口。
- `src/utils/canonicalWorkflow.ts`：当前旧 Canonical/UI 辅助；迁移时改用稳定 Backend UUID。
- `src/utils/parseWorkflowJson.ts`：Cloud JSON 的严格识别、Canonical v2
  导入和兼容投影；不得成为运行载荷。
- `src/utils/debugControls.ts`：迁移后按 Task control、Hold、permit 与 composite
  projection 计算可用动作和中文文案。
- `src/utils/parseWorkflow.ts`：画布所需的只读解析。
- `src/hooks/useWorkflowDag.ts`：ReactFlow 布局与视图状态。

## Cloud JSON 导入

工具栏的“导入 JSON”当前以 Canonical v2 为第一识别顺序；如果不是 Canonical，
则自动识别旧 Cloud `data.nodes/data.edges` 导出并在内存中严格迁移。它是 authoring
导入能力，不是允许旧 Canonical 继续充当执行协议。迁移完成后：

1. 导入结果先成为 Draft/Candidate，不产生可运行 Task。
2. `device_name + template_name` 组成 `action_ref`。
3. `param` 逐项成为 tagged literal binding。
4. `ready → ready` 成为 control edge；非 `ready` handle 成为同时匹配
   `input_bindings` 的 data edge。
5. `pose.position` 只进入 `layout.nodes`，不进入执行内容哈希。
6. 调用当前 Profile 的 OS/backend 校验；只有 action/schema 验证通过并成功保存/Apply
   为 Backend-shaped Graph，后续才可创建 Task。

迁移必须 fail-closed。重复 UUID、悬空边、依赖环、禁用节点、Cloud Group、
混合控制/数据 handle（包括没有显式分支条件契约的 `true/false → ready`）、
同一输入的多数据源，以及字面量与数据边争用同一输入时，都明确拒绝，不能猜测后
生成可运行载荷。`parent_uuid` 仅是 Cloud 画布分组信息，迁移时展平并向用户显示
警告。

浏览器 E2E 使用 `e2e/fixtures/host-node-test-latency` 声明 action contract，
再由真实 offline local bridge 完成导入校验和整图运行；该 Profile 只是测试夹具，
不能作为生产 Edge 的注册方式。

## 修改检查

```bash
pnpm --filter @unilab/workflow-editor typecheck
pnpm --filter @unilab/workflow-editor test
pnpm test:e2e:workflow
pnpm test:e2e:workflow-debug
pnpm test:e2e:workflow-actions
```

涉及运行和调试时，E2E 必须连接真实 v1 local bridge/OS，且检查浏览器
`console.error` 与 `pageerror` 均为空。
