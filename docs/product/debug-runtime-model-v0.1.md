# Uni-Lab 调试运行时模型 v0.1

> 本文完成调试产品设计的第四步：定义一次调试运行中的对象、状态、依赖、证据和处置动作。
>
> 本文是产品概念模型，不要求新增一个前端自有的万能运行实体，也不替代 OS 的 Task、NodeJob、Event、Command 和安全结算合同。

## 1. 模型要解决什么问题

真实 SZLab 运行要求调试人员同时追踪：

```text
我想验证什么
  → 现在是否具备执行条件
  → 哪个节点和设备实际发生了什么
  → 现场事实与 Host 账本是否一致
  → 当前可以采取什么安全动作
```

因此，运行时模型不能只有一个 `status`。至少需要把以下事实分开：

1. **运行生命周期**：这次 Task 是否已创建、正在运行或已经结束；
2. **控制状态**：调度闸门是打开、暂停、切换单步还是等待控制切换；
3. **节点执行状态**：NodeJob 当前是在等待、执行、成功、失败还是结果未知；
4. **依赖和准入状态**：节点为什么还不能开始；
5. **证据状态**：输入、命令、现场见证、账本和输出是否完整、一致、足够新；
6. **资源结算状态**：锁、预留、库存和清理是否已经收敛。

这些轴可以组合成一个面向调试人员的“当前关注状态”，但不能相互覆盖。比如：

- Task 可以是 `succeeded`，但某个节点的历史记录可能仍然不完整；
- NodeJob 可以是 `execution_unknown`，但设备本身仍然在线；
- 节点可以已经具备执行资格，但因为共享机器人被占用而暂时等待；
- 命令接口可以返回 `succeeded`，但这只表示控制命令已被 OS 接受，不表示设备动作已经完成。

## 2. 一次调试运行的概念对象

### 2.1 `DebugRunContext`

这是产品层的运行上下文组合，不是要在前端重新创建的后端实体：

```text
DebugRunContext
├── DefinitionRevision       已发布的工作流修订
├── RunConfiguration          本次输入、环境和资源绑定草稿
├── PreflightReport           OS 返回的只读准入报告
├── Task                      提交后由 OS 创建的一次运行身份
├── NodeJobs                  每个节点的本次执行实例和 attempt
├── RuntimeEvents             带 cursor 的持久运行事件
├── Evidence                  从 Job、Command、Feedback、账本和设备见证读取的证据
└── DispositionCapabilities   当前允许的等待、控制、对账或人工处置
```

它们的生命周期不同：

```text
DefinitionRevision
      ↓ 选择
RunConfiguration / BindingDraft
      ↓ POST Preflight
PreflightReport
      ↓ 通过后 SubmitRun
Task → NodeJob / Attempt → Event / Feedback / Evidence
                         ↓
                 Cleanup / Settlement
```

其中 `RunConfiguration` 在提交前可以修改；`DefinitionRevision` 和提交后的 Task 输入必须冻结；`PreflightReport` 是检查时刻的报告，不能被前端自行延长有效期。

### 2.2 对象边界

| 对象 | 事实含义 | 产品上允许做的事情 |
| --- | --- | --- |
| `DefinitionRevision` | 本次运行依赖的已发布版本、节点、边和输入契约 | 查看版本、预览结构、开始准备；不能修改运行中的版本 |
| `RunConfiguration` | 本次输入、仿真 / 真机、优先级、描述和资源绑定草稿 | 编辑、重新 Preflight；不直接写设备、物料或库存 |
| `PreflightReport` | OS 在指定时刻对输入、资源和运行范围做的准入判断 | 查看检查项、跳转阻断事实；不能由 FE 重算为“可运行” |
| `Task` | 一次完整工作流或单设备动作的运行身份 | 查看生命周期、控制和清理；通过 OS Command 发出控制意图 |
| `NodeJob` | 某个工作流节点在该 Task 中的一次执行实例 | 查看当前 attempt、input、output、feedback 和状态 |
| `Attempt` | NodeJob 的一次尝试及其事件、命令和结果 | 比较失败尝试与当前尝试；不能把历史压成当前状态 |
| `DeviceCommand` | 发给设备执行器的带身份、幂等和账本状态的命令 | 查看命令证据、对账或按安全规则处理未知结果 |
| `ResourceFact` | 物料、Site、设备能力、库存、占用和锁等事实 | 查看其对本次运行的影响；不在运行页面复制资源主数据 |
| `Evidence` | 支持某个状态判断的输入、输出、现场见证、账本或人工记录 | 查看来源、时间、关联 ID、一致性和新鲜度 |
| `Disposition` | 针对当前事实允许的下一步动作及其完成条件 | 只显示满足前置条件的 OS / 产品动作 |

设备单点动作也复用 `Task + 单个 NodeJob`，不新增 `DeviceDebugRun` 运行模型。

## 3. 状态模型：六条轴，不做一个总状态

### 3.1 Task 生命周期

Task 生命周期保留 OS 原始状态：

```text
pending → admission_blocked / running
running → canceling → canceled
running → succeeded | failed | timeout
```

`admission_blocked` 表示任务尚未进入正常派发；它不是某个设备动作失败。终态也不自动代表清理和证据已经完成，必须同时读取 `cleanupStatus` 和注意事项。

### 3.2 控制状态

控制状态描述调度闸门和调试方式，而非设备是否正在运动：

| 控制状态 | 含义 | 典型动作 |
| --- | --- | --- |
| `active` | 普通调度，满足依赖的节点可派发 | 暂停、切换单步、取消 |
| `paused` | 后续节点不再派发；已在途动作不因此停止 | 继续、单步、取消 |
| `switching_to_step` | 正在等待在途 Job 排空，准备进入单步 | 等待状态生效 |
| `step` | 单步模式；每次只放行一个候选节点 | 查看候选、执行单步、恢复普通模式 |
| `waiting_intervention` | 需要人工确认或异常处置 | 打开处置项、确认、重试或停止 |
| `waiting_reconciliation` | 物理结果或账本结果尚未核对 | 对账、人工取消、解除阻断 |

`pause`、`resume`、`switch_to_step` 和 `step` 都是 Task Command。HTTP 成功或命令返回 `succeeded` 不能直接投影为设备动作已完成。

### 3.3 节点执行状态

NodeJob 必须保留 OS 返回的原始状态和未知值。产品展示可以按以下语义分组，但不能把未知值强制映射为 `failed`：

| 语义组 | 说明 | 调试关注点 |
| --- | --- | --- |
| `not_started` | 尚未获得执行资格 | 哪个依赖未满足 |
| `waiting` | 已具备部分条件，正在等待资源、锁、设备或上游结果 | 等待谁、等待什么、是否有预计依据 |
| `running` | 已有当前 attempt 在执行 | 当前命令、设备反馈、开始时间 |
| `succeeded` | 动作或节点返回成功 | 结果是否还有账本或证据待收敛 |
| `failed` | 已确认执行失败 | 是否允许重试，失败证据是什么 |
| `execution_unknown` | 不能确认动作是否发生 | 必须进入核对路径，禁止盲目重发 |
| `canceled / skipped` | 被控制命令或运行范围终止 | 是否需要清理、补偿或人工确认 |

OS 的 `status`、`startState`、`waitReason`、`attempt` 和 `uncertaintyReason` 都属于节点事实；FE 只做显示投影和排序。

### 3.4 证据状态

证据状态描述“当前判断有多可靠”，不等于执行状态：

| 证据状态 | 含义 |
| --- | --- |
| `unavailable` | 尚未产生或暂时读不到证据 |
| `partial` | 有动作结果，但缺少现场见证、账本或历史记录中的一部分 |
| `complete` | 当前判断所需的证据均已到达 |
| `contradictory` | 两个来源对同一事实给出冲突结果 |
| `stale` | 有结果但已超过可接受的新鲜度，不能作为当前准入依据 |

例如，投粉动作返回成功但 balance history 写入失败时，工艺执行可以是 `succeeded`，证据状态仍是 `partial`；这不应被统一显示成普通失败。

### 3.5 资源结算状态

结算状态覆盖物料、锁、预留和清理：

```text
not_started → pending → settled
                     ↘ requires_attention
```

物料物理位置、Host 账本、库存扣减、Execution Claim 和清理状态必须分别读取。`cleanupStatus=settled` 只表示 OS 的清理流程已收敛，不代表每个节点都有完整业务输出。

### 3.6 页面关注状态

页面可以生成一个用于排序和入口提示的关注状态，但它必须是投影，不得成为新的业务状态。优先级建议为：

```text
需要安全核对 / 结算
  > 需要人工干预
  > 准入或资源阻断
  > 正在执行 / 等待共享资源
  > 证据不完整或已过期
  > 已完成且已收敛
```

页面显示关注状态时，必须同时展示触发它的原始事实，例如 `execution_unknown`、`Host ledger commit failed` 或 `waiting for szlab_mixer_robot claim`。

## 4. 依赖模型：节点为什么不能开始

工作流图只表达结构依赖。真实运行还需要以下依赖类型：

| 依赖类型 | S07 示例 | 未满足时应表达什么 |
| --- | --- | --- |
| `structural` | 两个搬运分支完成后才能投粉 | 哪些上游 NodeJob 尚未完成 |
| `input` | `target_mass_g` 必须在 `(0, 100]` | 实际值、约束和影响节点 |
| `material` | 烧杯、粉桶必须是本次运行绑定的实例 | 缺哪个实例、当前绑定状态 |
| `site` | 烧杯在 S0722、粉桶在 P01 | 当前 Site、目标 Site、最后见证 |
| `inventory` | 溶剂 / 试剂数量满足本次消耗 | 已预留数量、需要数量、差额 |
| `capability` | S07 或机器人具备相应 Action | 缺失的设备能力或版本 |
| `claim` | 两个分支共享 `szlab_mixer_robot` | 当前占用节点、等待节点和释放依据 |
| `evidence` | 物理放料和 Host 账本均确认 | 缺失或冲突的证据 |
| `settlement` | 上游物料转运已完成结算 | 哪个锁、预留或账本仍未收敛 |

每个被阻断的 NodeJob 至少需要一个结构化 `blockedBy` 项：

```text
blockedBy {
  kind: material | site | claim | evidence | ...
  code: 稳定原因码
  message: 面向调试人员的解释
  sourceIds: 相关 Task / Job / Resource / Command 身份
  observed: 当前事实
  required: 开始执行所需事实
  suggestedDisposition: 当前允许的下一步动作
}
```

OS 负责判断准入、Claim、账本和安全门禁；FE 可以整理呈现 `blockedBy`，但不能把多个资源查询的局部结果自行合成为“可执行”。

## 5. 证据模型：一个节点的完整可追溯链

节点详情不只显示 `input / output` 三个 JSON 区块，而应按执行阶段组织证据：

| 证据阶段 | 典型内容 | 关联身份 |
| --- | --- | --- |
| `input_snapshot` | 本次输入、资源绑定、目标 Site、目标质量 | Task、NodeJob、Attempt |
| `dispatch` | Action、参数、命令 ID、幂等键、提交时间 | NodeJob、Attempt、DeviceCommand |
| `physical_witness` | PLC、传感器、Site、设备反馈、最后读数 | DeviceCommand、Resource、时间 |
| `ledger` | Host transfer、库存预留 / 扣减、物料当前归属 | Resource、Inventory、Task |
| `output` | return value、feedback、照片、检测、称量或密度结果 | NodeJob、Attempt |
| `intervention` | 人工确认、对账理由、取消原因、操作人和时间 | Command、Review、Task |

每条证据至少应带：

```text
evidence {
  kind
  status
  source
  occurredAt
  correlationIds: task / job / attempt / command / resource
  value
  authority
  freshness
}
```

证据来源的权威性必须可见。例如：设备 PLC 读数、Host 账本、Action 返回和人工现场确认不是同一种来源。出现冲突时，页面要显示“事实冲突待处理”，不能只保留最后写入的值。

`NodeJobDetail` 适合读取当前 Job 的最小事实；Attempt 历史、运行事件、Timeline、人工处置和安全结算应保持独立读模型，不能全部塞进一个详情对象。

## 6. 处置动作模型：按钮不是状态

每个动作都必须同时说明可用性、前置条件、影响范围和完成条件。产品层可以把 OS 返回的命令能力投影为：

```text
DispositionCapability {
  kind
  available
  requiresConfirmation
  preconditions[]
  affectedIds[]
  expectedEffect
  completionSignal
  riskLevel
}
```

典型动作如下：

| 动作 | 适用事实 | 不能假设的结果 |
| --- | --- | --- |
| `wait` | 等待共享 Claim、设备或上游节点 | 等待不代表一定会自动成功 |
| `pause` | 暂停后续派发 | 不会中断已经在途的设备动作 |
| `resume` | 控制状态允许恢复 | 命令接受不代表节点立刻开始 |
| `switch_to_step` / `step` | develop / step 门禁满足 | 单步只放行候选节点，不代表节点成功 |
| `retry` | 已确认失败且资源状态允许 | 不能用于 `execution_unknown` 或物理已成功但账本失败 |
| `reconcile` | 命令或物料结果未知 | 对账完成前不能解除所有运动阻断 |
| `resolve_unknown_as_canceled` | 现场确认安全且命令仍为 UNKNOWN | 人工取消不等于证明物理动作从未发生 |
| `manual_confirm` | 需要操作员确认现场或证据 | 需要记录人员、理由和时间 |
| `cancel` / `controlled_stop` | 运行仍可被取消 | 取消后仍可能有清理和结算阶段 |

命令自身也有生命周期：

```text
available
  → submitted
  → accepted / rejected
  → effective / superseded / unknown
```

页面必须分别显示“命令已提交”“控制状态已生效”“设备动作已完成”三个事实。

## 7. S07 的运行时状态演练

| 阶段 | 关键状态组合 | 主阻断 / 证据 | 允许的下一步 |
| --- | --- | --- | --- |
| Preflight | Task 尚未创建；检查项 `passed / blocked / deferred` | 输入、Site、设备能力或占用不满足 | 修正配置、重新 Preflight |
| 两个分支开始 | Task `running`；两个 NodeJob 可能分别 `running / waiting` | 共享机器人 Claim 竞争 | 查看占用节点、等待或处理占用节点 |
| 烧杯 / 粉桶取放 | NodeJob `running`；有 pick / place Command | 物理见证、设备反馈、Site 变化 | 查看命令和现场证据 |
| 物理放料成功、账本失败 | NodeJob 不能简化成普通 `failed`；证据 `partial / contradictory` | 实物可能已移动，Host 未提交 | 禁止重发；进入人工对账 |
| 机器人 `UNKNOWN` | 控制 / 节点进入 `waiting_reconciliation` 语义 | 命令可能已执行；新运动被安全阻断 | `reconcile` 或确认安全后人工取消 |
| 两个前置完成 | 投粉 NodeJob 获得执行资格 | 烧杯、粉桶、P01、目标质量和设备状态均满足 | 派发投粉 |
| 投粉成功、历史写入失败 | 执行 `succeeded`；证据 `partial` | 工艺结果有，但历史记录不完整 | 按业务规则继续或补齐证据 |
| 收尾结算 | Task 可能已结束；cleanup / settlement 仍 `pending` | 锁、库存、物料归属或清理未收敛 | 等待结算或处理注意事项 |

这个演练说明，运行详情需要围绕“当前最需要处理的事实”组织，而不是围绕某一个静态对象或单一颜色状态组织。

## 8. 仿真 / 真机的模型边界

仿真 / 真机是 `RunConfiguration.environment` 的上下文属性，不是 Task 的生命周期状态，也不是“开发模型 / 生成模式”的替代名称。

两种环境应复用相同的：

- 工作流版本、输入和资源绑定合同；
- NodeJob、Attempt、Command 和 Feedback 结构；
- 并行依赖、共享 Claim 和账本语义；
- 状态、证据和处置动作的展示模型。

差异应体现在设备执行器和可用证据来源。为了完成 UI 验收，仿真还需要可重复触发至少这些故障场景：共享资源等待、Site 见证失败、物理成功账本失败、`UNKNOWN`、证据缺失。当前仓库证明了这些状态在真实驱动和运行合同中存在，但“仿真默认是否注入、如何配置注入”仍是业务和测试环境决策。

## 9. 对前端实现边界的约束

1. FE 读取 OS 的 Task / Job / Event / Command / Preflight 合同，不创建第二套运行权威。
2. FE 可以生成关注状态、节点分组和阻断链路的展示投影，但必须保留原始状态、原因码和来源 ID。
3. FE 不在客户端自行计算 Claim、库存结算、物理安全或“可运行”结论。
4. React Query 或其他缓存只缓存读模型；运行配置草稿和当前选择属于场景状态。
5. SSE / WebSocket 只作为失效通知时，收到通知后重新读取权威读模型，不能把通知当成状态补丁。
6. `NodeJobDetail`、Attempt History、Runtime Events、Control State、Timeline 和 Intervention 保持独立端口；不要扩展成一个万能对象。

## 10. 第四步完成判定

第四步完成的标准是：

- 已定义一次调试运行的对象边界和生命周期；
- 已把运行、控制、节点、证据、结算拆成独立状态轴；
- 已定义节点依赖和 `blockedBy` 的表达方式；
- 已定义证据来源、关联身份和冲突处理；
- 已定义处置动作的前置条件与完成条件；
- 已用 S07 演练等待、账本失败、`UNKNOWN`、证据不完整和清理结算；
- 已明确 FE 只能做展示投影，OS 继续拥有准入、Claim、幂等、安全和结算权威。

下一步进入第五步：把这个运行时模型转成三个可走通的调试任务流——从零启动、运行中定位、未知结果处置——再据此收敛页面信息层级和交互路径。

