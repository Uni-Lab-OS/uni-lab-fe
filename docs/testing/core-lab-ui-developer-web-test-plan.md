# core / lab-ui / developer-web 测试方案

## 目标与范围

本方案覆盖三类风险：领域契约被错误解码、组件把后端事实误呈现为本地状态、页面旅程在真实 OS/Backend 上断链。测试分为单测、组件测试、端侧 E2E 和用户旅程测试；单测保持纯函数和 adapter 可重复，页面组合与真实请求由 Playwright 端侧测试验证。

覆盖率门槛按包配置：单测集合的行、语句和函数覆盖率目标为 95%；分支覆盖率对兼容性 codec 和可选后端字段采用较低的防御性门槛，当前配置为 core 80%、lab-ui 88%、developer-web 85%，报告会保留未覆盖行号，便于后续新增 OS 投影时补齐。core gate 排除高组合的 codec、SSE 和兼容 client 文件，但这些文件仍由专门契约测试执行。

## 用例完备性与执行状态

本文件的“完备”指每个风险点都有明确的用例、实现文件和验收断言；它不等同于本轮已经连接真实 OS 执行。单测/组件用例必须在无后端条件下可重复运行；依赖任务、NodeJob、模型或恢复过程的 Playwright 用例保留真实数据前置检查，缺少数据时只能按原因 skip。真实 OS 的通过率、skip 和服务可用性单独记录，不回填为用例设计结论。

## Case 矩阵

### CORE

| ID | 层级 | 场景 | 关键断言 |
| --- | --- | --- | --- |
| C-001 | 单测 | capability profile | local-go/local-python 白名单，未知 profile deny-by-default |
| C-002 | 单测 | transport JSON/HTTP 错误 | token、JSON body、HTTP 5xx、retryable 与 problem detail |
| C-003 | 单测 | SSE runtime events | SSE 解析、workflow/device 两类失效通知、重复 id 去重、未知/非法帧忽略、HTTP 流失败、断线重连、Last-Event-ID、dispose |
| C-004 | 单测 | workflow/device/material/reagent codec | 正常 envelope、别名字段、可选字段、重复标识、非法枚举和类型 |
| C-005 | 单测 | run preparation | preflight、submit、node job、冲突任务提示、资源选择保护 |
| C-006 | 单测 | task command | accepted/applied/rejected/unknown 生命周期，稳定幂等键和 target node |
| C-007 | 单测 | debug facts/recovery | frontier、join、progress、resource wait、lock、execution unknown |
| C-008 | 单测 | Zustand scenario store | loading/ready/error、stale request、reload、command、runtime subscription、clearError |
| C-009 | 单测 | React store factory | React store 初始状态和 scenario 组合 |
| C-010 | 单测 | scenario orchestration | candidate 聚合、部分读取失败、任务/作业刷新与 feedback cursor |

### LAB-UI

| ID | 层级 | 场景 | 关键断言 |
| --- | --- | --- | --- |
| L-001 | 组件 | DefinitionList/StatusBadge | 空值文案、mono/wide/form、完成/运行/等待/阻断/隔离/未知状态和显式 meta |
| L-002 | 组件 | SchemaInputField | enum、boolean、number/integer、ResourceSlot、object/array、nullable、disabled、error |
| L-003 | 组件 | DeviceActionList/ParameterFields/StatusBadge | 空动作、选中、busy、参数转换、错误和只读 |
| L-004 | 组件 | SitePicker/MaterialSitePresentation/MaterialInspector | 空库位、空闲/占用/未知、site/material selection、occupant 回调 |
| L-005 | 组件 | reagent summaries | 英文名/分子式缺省与完整值、数量/单位缺省与完整值、可用/空/未知库存状态 |
| L-006 | 组件 | workflow inputs/inventory | 空参数、schema 受控变更、库存需求可拆分和空态 |
| L-007 | 组件 | preflight/run summary/submit | 四类检查分组、阻断告警、normal/step/single-node 运行模式、提交禁用/忙态/回调 |
| L-008 | 组件 | TaskProgress | 百分比 clamp、OS 未提供、bar 无障碍属性 |

### DEVELOPER-WEB

| ID | 层级 | 场景 | 关键断言 |
| --- | --- | --- | --- |
| D-001 | 单测 | route/navigation | 合法路由、未知路由、pushState 和 popstate |
| D-002 | 单测 | backend query | loading、success、Error/非 Error、reload、查询 key 变化后的旧请求结果丢弃 |
| D-003 | 单测 | task/material/workflow projection | 状态归一化、时间、资源名称、拓扑布局、嵌套节点归并、重复/非法边过滤、site fact、workflow contract |
| D-004 | 组件 | AsyncState/PageHeader/TableText | loading/table skeleton、错误重试、冲突提示、空态、标题/操作和样式 |
| D-005 | 组件 | AppShell | 主导航、active route、折叠侧边栏、BackendProvider 生命周期 |
| D-006 | 端侧 E2E | route smoke | 总览、工作流、任务、设备、物料、试剂入口均可打开 |
| D-007 | 用户旅程 | debug target gate | 未选工作流/设备时禁止进入调试 |
| D-008 | 用户旅程 | workflow-to-preflight | 从 developer-web 工作流目录打开详情、进入调试并完成运行前检查；阻塞时禁止误提交 |
| D-009 | 用户旅程 | runtime recovery | pause/resume/step/cancel accepted 与实际状态分离，SSE 重连后 rehydrate |
| D-010 | 用户旅程 | failure recovery | backend error、partial read、retry、unknown/reconciling 文案可行动 |
| D-011 | 单测/组件 | material and reagent boundary helpers | 材料节点隐藏/选择、库位占用事实、容量单位换算、容量展示、试剂物态/台账/化合物状态标签 |
| D-012 | 用户旅程 | material graph to management | 物料关系图进入物料管理，返回后恢复关系图入口；管理页展示同一 Material Graph 投影 |
| D-013 | 用户旅程 | reagent inventory/catalog | 库存/目录切换、各自搜索字段、输入清空后回到完整列表语义 |
| D-014 | 用户旅程 | task inspector | 任务详情打开 NodeJob，输入输出、资源、异常处置、执行锁、Trace/日志五个检查面板均可切换 |
| D-015 | 组件 | reagent capability boundary | inventory/catalog 的历史、分装、编辑、删除、录入和详情操作按 capability 逐项禁用；可用操作把原始实体交给回调 |

### E2E 实现映射

developer-web 的页面入口由 `e2e/developer-web-user-journeys.spec.ts` 覆盖；真实 Task/Job 运行和故障恢复由 Workbench 真实 OS E2E 覆盖，两者不混用入口：

| Case | 真实实现 | 验收边界 |
| --- | --- | --- |
| D-008 | `e2e/developer-web-user-journeys.spec.ts`、`e2e/workflow-task-runtime-real-os.spec.ts` | developer-web 目录 → 详情 → 调试 → preflight；Workbench 真实 workflow UI 创建 Task、读取 Jobs |
| D-009 | `e2e/workflow-task-runtime-real-os.spec.ts`、`e2e/workflow-runtime-final-gate-real-os.spec.ts` | pause/resume/step/cancel、幂等重放、终态竞态和 Task/Job 投影 |
| D-010 | `e2e/workflow-task-runtime-resilience-real-os.spec.ts`、`e2e/workflow-runtime-final-gate-real-os.spec.ts` | partial read、feedback cursor、SSE reconnect、OS restart、unknown/reconciling 和失败恢复 |
| D-011 | `apps/developer-web/src/features/materials/*.test.ts`、`apps/developer-web/src/features/reagents/reagentCapacity.test.ts`、`apps/developer-web/src/features/reagents/reagentModalShared.test.ts`、`apps/developer-web/src/features/tasks/TaskInspectorComponents.test.tsx`、`packages/lab-ui/src/domain-components.test.tsx` | helper 与展示边界不依赖真实后端；覆盖未知值、容量维度、物态/台账标签和检查器状态分支 |
| D-012 | `e2e/developer-web-user-journeys.spec.ts` | developer-web 物料关系图 → 物料管理 → 返回关系图；只验证页面边界和回退入口 |
| D-013 | `e2e/developer-web-user-journeys.spec.ts` | developer-web 试剂库存/目录 tab、搜索占位语义和清空搜索；数据读写执行另行验证 |
| D-014 | `e2e/developer-web-user-journeys.spec.ts` | developer-web 任务详情选中真实 NodeJob 后遍历五类检查面板；无任务或无 Job 时带原因 skip |
| D-015 | `apps/developer-web/src/features/reagents/ReagentTables.test.tsx` | capability 全禁用时保持读取可用、写操作逐项禁用；开放 capability 时回调收到完整 Reagent/ReagentInfo |

`e2e/helpers/browser-diagnostics.ts` 是 developer-web 与真实 OS workflow E2E 共用的浏览器诊断入口；每个 suite 都必须把 `console.error` 和 `pageerror` 纳入最终断言。真实 OS E2E 仍需由运行环境提供 OS/Backend，缺少前置条件时只能带原因 skip，不能用路由 mock 替代。

## 测试数据与隔离

- Core 和 lab-ui 使用最小领域 fixture，所有 UUID、revision、sequence 固定，避免按名称猜实体。
- developer-web 单测 mock 只放在 composition boundary；不 mock core codec 或页面内部状态。
- Playwright 默认连接真实 local OS/Backend；需要目录、模型或任务的 case 在前置检查失败时明确 skip，并输出原因。
- E2E 每个 case 使用独立 URL/search 参数，断言结束后不写回持久化 fixture；运行状态以 OS REST/SSE 投影为准。

## 执行命令

```bash
pnpm --filter @unilab-fe/core test:coverage
pnpm --filter @unilab/lab-ui test:coverage
pnpm --filter @unilab/developer-web test:coverage
pnpm --filter @unilab-fe/core typecheck
pnpm --filter @unilab/lab-ui typecheck
pnpm --filter @unilab/developer-web typecheck
pnpm exec playwright test e2e/developer-web.spec.ts e2e/developer-web-user-journeys.spec.ts
```

全仓库门禁仍执行根目录 `pnpm typecheck`、`pnpm test`、`pnpm build:web`、`pnpm build:desktop`；真实 OS 联调继续使用仓库已有的 workflow/material E2E 命令。
