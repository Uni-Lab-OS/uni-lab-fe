# Uni-Lab FE 正式技术设计前置验证收口

状态：2026-09-24，技术设计准入基线。

本文把领域模型讨论、真实 OS 合同验证、OS Console 源码审计和现有 FE workspace
盘点合并为一个收口结论。后续不再以“继续验证”为理由扩大抽象模型；只有发现会改变
权威边界、核心生命周期或第一阶段产品范围的新事实时，才重新打开本阶段。

## 1. 当前阶段

```text
总体架构与领域模型                  已完成
Run Preparation / Execution 语义    已完成第一轮收敛
最小 OS 垂直切片                    已完成到技术设计所需深度
现有 FE packages / host 盘点        已完成前置分类
正式技术设计准入                    通过
正式技术设计                        下一阶段
正式产品实现                        尚未开始
```

`runPreparationDomain.ts`、`osRunPreparationAdapter.ts` 和
`taskRuntimeReadDomain.ts` 是验证阶段的 provisional artifacts。它们证明 DTO、错误和
状态边界可落地，但不自动成为正式 package、接口或目录设计。

## 2. 已完成并可作为技术设计输入的验证

### 2.1 权威与生命周期

- OS/Backend 是 Workflow、Device、Material、Site、Inventory、Task、Job、Claim 和
  Settlement 的权威；FE 不创建或模拟这些事实。
- Draft、Published Revision、Run Configuration、Execution Snapshot、WorkflowTask 和
  TaskRuntimeSummary 是不同生命周期，不使用万能 Workflow 类型合并。
- ActionDefinition、ActionInvocation、ExecutionAttempt、DeviceCommand 和
  OperatorOperation 保持区分。
- `execution_unknown` / 物理证据不足不是普通失败；FE 不释放资源、推进下游或盲目重试。

### 2.2 Run Preparation 最小切片

已使用真实 Published `experiment_operation` 完成：

```text
Published Revision
  → ActionDefinition / ActionResourceContract
  → Material / Inventory / Site concrete selection
  → POST Preflight
  → SubmitRun
  → Task / Jobs / Events / NodeJob Detail
```

Preflight 对完整输入返回 `runnable_now / can_run=true`。唯一一次 SubmitRun 创建了 Task，
随后因 OS inventory 中 `robot.gripper` Site 角色不唯一而安全取消。该错误属于 OS 工作区
资源事实，不是 FE DTO 或模型错误。真实设备动作不再作为 FE 技术设计准入条件。

### 2.3 三个纵向切片的验证结论

| 切片 | 已验证事实 | 技术设计前不再追加的验证 |
| --- | --- | --- |
| Workflow Debugging | Task/NodeJob/Attempt、events cursor、step-state、locks、feedback、intervention 和标准 commands 均有 OS 合同；旧 `/debug/*` 已退役 | 不实现完整 breakpoint、waterfall、SSE 或 Trace UI |
| Device Action Debugging | OS `device-action-runs` 复用标准 WorkflowTask/NodeJob；Action schema 和资源合同来自 Registry/模板 | 不执行真实硬件动作，不再造设备专属运行模型 |
| Material / Reagent / Inventory | Material UUID、Site、Site Occupancy、Reagent Catalog、Inventory instance/lot/quantity、Claim/Settlement 保持独立；OS Console 与真实 read API 已交叉核对 | 不在 FE 验证结算算法，不实现通用 SubstitutionPolicy |

三条切片已足以证明目标能力需要共享同一组领域事实，同时使用不同 scenario ViewModel；
不需要在技术设计前继续为每个设备或动作重复端到端验证。

## 3. 已知但不阻塞技术设计的 OS 缺口

| 缺口 | 处理原则 |
| --- | --- |
| 没有统一 Binding Candidate API | 技术设计保留 Query seam；第一阶段由 OS 现有 Material/Inventory/Site read model 组合，fixture 只允许存在于 Adapter 测试 |
| ActionResourceContract 没有独立查询路由 | 从 ActionDefinition/WorkflowNodeTemplate 元数据读取；缺失时显式 unavailable，不猜测 |
| 没有统一 TaskRuntimeSummary 端点 | 不由 FE 宣称新的权威摘要；消费 OS Task Presentation 或分别展示 Task/Jobs 事实 |
| 缺少统一 Domain Fact Version / Preflight Report ID | 保留可选版本字段；SubmitRun 继续由 OS 重新准入 |
| Event Contract 不完整 | 第一阶段使用 Query、Command response、主动刷新和有限轮询；SSE/WebSocket 不阻塞设计 |
| 普通 Published Workflow 当前为空 | 使用已发布 ExperimentOperation 验证合同；不为验证目的实现完整 Editor/Publish 流程 |

以上项目进入正式技术设计的“外部能力假设和降级策略”，不再作为无限期验证待办。

## 4. 现有 workspace 结构盘点

当前 workspace 包含 4 个 app 和 24 个 package。另有 `apps/cloud-web` 与
`packages/panel-runtime` 两个只有 README、没有 `package.json` 的残留目录，不属于
workspace，也不作为目标架构输入。

### 4.1 Product host

| 模块 | 当前事实 | 技术设计处置 |
| --- | --- | --- |
| `apps/kernel-web` | 汇聚 12 个本地 package；当前 Web/Electron renderer | 历史产品宿主和交互参考；不作为目标领域中心 |
| `apps/desktop` | Electron 宿主，当前直接依赖 kernel-web 和本地运行环境 | 保留宿主能力参考；不得拥有领域事实 |
| `apps/workbench` + `packages/workbench-theia` | Theia/Workspace/OS 生命周期和调试工作台；workbench-theia 汇聚 10 个 package | 保留开发宿主参考；不得成为领域 package |
| `apps/vscode-extension` | Workflow IDE bridge 的 VSCode adapter | 可选开发工具 adapter；不进入第一阶段产品核心 |
| OS `frontend/` | OS 内置运营/调试 Console | 功能与合同参考，不迁移 React 页面源码 |

### 4.2 领域、场景和 Adapter 候选

| 模块 | 当前混合职责 | 技术设计处置 |
| --- | --- | --- |
| `packages/services` | Profile、HTTP、capability、Workflow、Task、Device、Material、Inventory、Realtime、legacy compatibility | 保留为事实来源与迁移 Adapter；停止继续扩张成全局 Kernel，正式设计时按领域 seam 收深 |
| `packages/material` | Material 类型、规则、规范化 store、undo、2D/2.5D UI | 领域语义和投影实现参考；不直接等同目标 headless Material module |
| `packages/workflow-editor` | Authoring、DAG、Run Preparation、Runtime、调试交互与 UI | 场景和 UI 参考；应从中提取 Definition/Preparation/Execution seam，不整体迁移 |
| `packages/device-management` | Device 读模型、动作可用性与管理 UI | Device/Action 场景参考；不拥有 Task/Job 事实 |
| `packages/robot-workstation` | 实验室运营页面和设备/试剂展示 | scenario/semantic UI 参考；不提升为领域权威 |
| `packages/testing` | Services fixture/test helper | 测试基础设施；与正式 domain module 分离 |

### 4.3 宿主基础设施候选

`app-shell`、`code-editor`、`design-system`、`local-environment`、
`workbench-layout`、`workbench-session`、`workflow-ide-bridge` 和
`device-provisioning` 属于 UI/宿主/环境基础设施。正式设计可以按产品宿主需求选择性复用，
但不得用它们定义 Workflow、Material、Device 或 Execution 的领域模型。

### 4.4 低优先级扩展和历史兼容

- `device-card-sdk`、`device-card-ui`、`device-card-builder`、`device-card-host`、
  `device-card-authoring-kit`、`device-card-agent-cli`、`device-card-tooling`：作为设备
  扩展生态冻结在第一阶段核心设计之外；只有明确的真实 caller 才保留 seam。
- `pascal-host`、`pascal-lab-plugin`：3D/插件视图参考；不得拥有第二份 Material Graph。
- 旧 `/debug/*`、旧 Runtime transport、Cloud DTO 和 Backend/Edge fallback：归入明确
  compatibility adapter 或删除候选，不进入新 domain interface。

## 5. 删除测试与过度设计裁剪

正式技术设计前停止以下工作：

1. 不继续验证真实设备物理动作；
2. 不为每个 Action/Device 重复 Run Preparation 端到端测试；
3. 不先创建六个完整领域 package；
4. 不设计新的全局 FE Domain Store；
5. 不引入通用 SubstitutionPolicy；
6. 不先实现完整 Event Bus、SSE/WebSocket、Timeline 或 Trace 聚合；
7. 不先迁移完整 Workflow Editor、kernel-web 或旧 packages；
8. 不把 TaskRuntimeSummary、ExecutionSnapshot 或 Runtime Port 扩张成新总内核；
9. 不为 `apps/cloud-web`、`packages/panel-runtime` 等非 workspace 残留补实现；
10. 不因为只有一个 Adapter 就预先建立可插拔抽象；一个 Adapter 是假设 seam，至少两个
    真实 Adapter 才证明 seam 需要长期存在。

## 6. 正式技术设计必须回答的问题

下一阶段只需要回答以下技术问题，不再回到领域概念讨论：

1. 目标 headless domain modules 的最小集合和依赖方向；
2. Run Preparation、Workflow Debugging、Device Debugging、Laboratory Operations 的
   scenario modules 如何组合领域 Query/Command；
3. OS Adapter seam 与 wire DTO 的目录位置、错误模型和 capability 表达；
4. semantic components 与 scenario ViewModel 的输入边界；
5. Browser、Desktop、Workbench 三类 host 如何装配同一组 headless modules；
6. 现有包的 retain / extract / compatibility / freeze / delete 迁移清单；
7. 第一阶段产品页面范围和旧实现退出顺序。

正式技术设计不得重新讨论 OS 是否权威、FE 是否创建 Claim、`unknown` 是否是失败、是否
需要通用 SubstitutionPolicy，以及是否先实现完整 Event Bus；这些问题已经关闭。

## 7. 技术设计准入结论

以下准入条件已经满足：

- [x] 领域权威和核心生命周期已明确；
- [x] 三个纵向切片已达到设计验证深度；
- [x] 最小真实 OS 合同链路已验证；
- [x] OS Console 与 OS 源码已交叉审计；
- [x] 已知 Backend/OS 缺口已被显式记录并具有降级原则；
- [x] 现有 workspace package、主要依赖汇聚点和非 workspace 残留已盘点；
- [x] product host、scenario、domain candidate、adapter、extension 和 compatibility
  的职责类别已分开；
- [x] 过度验证和过度设计项目已经停止；
- [x] 第一阶段正式技术设计必须回答的问题已经限定。

结论：**技术设计前置验证阶段关闭，下一阶段可以正式开展目标 FE 技术设计。**

本结论不表示 provisional TypeScript 类型和 Adapter 已被冻结，也不表示现有 package
目录可以直接迁移；它只表示继续验证不会显著降低正式技术设计的主要风险。
