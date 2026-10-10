# core / lab-ui / developer-web 测试方案

## 目标与范围

本方案覆盖三类风险：领域契约被错误解码、组件把后端事实误呈现为本地状态、页面旅程在真实 OS/Backend 上断链。测试分为单测、组件测试、端侧 E2E 和用户旅程测试；单测保持纯函数和 adapter 可重复，页面组合与真实请求由 Playwright 端侧测试验证。

覆盖率门槛按包配置：单测集合的行、语句和函数覆盖率目标为 95%；分支覆盖率对兼容性 codec 和可选后端字段采用较低的防御性门槛，当前配置为 core 80%、lab-ui 88%、developer-web 85%，报告会保留未覆盖行号，便于后续新增 OS 投影时补齐。core gate 排除高组合的 codec、SSE 和兼容 client 文件，但这些文件仍由专门契约测试执行。

## Case 矩阵

### CORE

| ID | 层级 | 场景 | 关键断言 |
| --- | --- | --- | --- |
| C-001 | 单测 | capability profile | local-go/local-python 白名单，未知 profile deny-by-default |
| C-002 | 单测 | transport JSON/HTTP 错误 | token、JSON body、HTTP 5xx、retryable 与 problem detail |
| C-003 | 单测 | SSE runtime events | SSE 解析、事件去重、断线重连、Last-Event-ID、dispose |
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
| L-001 | 组件 | DefinitionList/StatusBadge | 空值文案、mono/wide/form、已知/未知状态和显式 meta |
| L-002 | 组件 | SchemaInputField | enum、boolean、number/integer、ResourceSlot、object/array、nullable、disabled、error |
| L-003 | 组件 | DeviceActionList/ParameterFields/StatusBadge | 空动作、选中、busy、参数转换、错误和只读 |
| L-004 | 组件 | SitePicker/MaterialSitePresentation/MaterialInspector | 空库位、空闲/占用/未知、site/material selection、occupant 回调 |
| L-005 | 组件 | reagent summaries | 英文名/分子式缺省、数量缺省、库存状态语义 |
| L-006 | 组件 | workflow inputs/inventory | 空参数、schema 受控变更、库存需求可拆分和空态 |
| L-007 | 组件 | preflight/run summary/submit | 四类检查分组、阻断告警、运行模式、提交禁用/忙态/回调 |
| L-008 | 组件 | TaskProgress | 百分比 clamp、OS 未提供、bar 无障碍属性 |

### DEVELOPER-WEB

| ID | 层级 | 场景 | 关键断言 |
| --- | --- | --- | --- |
| D-001 | 单测 | route/navigation | 合法路由、未知路由、pushState 和 popstate |
| D-002 | 单测 | backend query | loading、success、Error/非 Error、reload、代际取消 |
| D-003 | 单测 | task/material/workflow projection | 状态归一化、时间、资源名称、拓扑布局、site fact、workflow contract |
| D-004 | 组件 | AsyncState/PageHeader/TableText | loading/table skeleton、错误重试、冲突提示、空态、标题/操作和样式 |
| D-005 | 组件 | AppShell | 主导航、active route、折叠侧边栏、BackendProvider 生命周期 |
| D-006 | 端侧 E2E | route smoke | 总览、工作流、任务、设备、物料、试剂入口均可打开 |
| D-007 | 用户旅程 | debug target gate | 未选工作流/设备时禁止进入调试 |
| D-008 | 用户旅程 | workflow-to-task | 从工作流目录打开详情、配置输入、提交后以 OS Task/Job 投影确认 |
| D-009 | 用户旅程 | runtime recovery | pause/resume/step/cancel accepted 与实际状态分离，SSE 重连后 rehydrate |
| D-010 | 用户旅程 | failure recovery | backend error、partial read、retry、unknown/reconciling 文案可行动 |

### E2E 实现映射

上述 D-008～D-010 不由 route smoke 用例重复实现，统一落在已有真实 OS E2E：

| Case | 真实实现 | 验收边界 |
| --- | --- | --- |
| D-008 | `e2e/workflow-task-runtime-real-os.spec.ts` | 真实 workflow UI 创建 Task、读取 Jobs，并验证 command accepted → applied 和 reload 恢复 |
| D-009 | `e2e/workflow-task-runtime-real-os.spec.ts`、`e2e/workflow-runtime-final-gate-real-os.spec.ts` | pause/resume/step/cancel、幂等重放、终态竞态和 Task/Job 投影 |
| D-010 | `e2e/workflow-task-runtime-resilience-real-os.spec.ts`、`e2e/workflow-runtime-final-gate-real-os.spec.ts` | partial read、feedback cursor、SSE reconnect、OS restart、unknown/reconciling 和失败恢复 |

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
