# Electron 异常处置与人工确认

## 目标与入口

在现有 Electron / Theia Workbench 中补齐 OS 已实现的异常处置和人工确认操作，不创建新的业务 renderer。

- 工作区顶部：存在工站异常、暂停、请求结果不明或读取失败时显示恢复入口，即使没有打开工作流也可处理。
- 实验操作、工作流调试、任务详情的运行面板：工站状态、人工确认节点和任务资源恢复。
- 工站正常运行且没有错误时明确显示正常状态，不提示用户恢复已经运行的工站。

## 功能

- 工站：查看错误、重试当前节点、取消任务、进入/返回人工处置、完成人工处置、确认恢复调度、继续应用已受理命令。
- 人工处置：设备动作目录与参数表单、执行/停止单点动作、查看结果、记录人工核对、批量上下料位置登记、选择并释放逻辑占用。
- 任务恢复：查看锁及设备占用、任务级资源解锁、历史人工动作结果核对、失败转运实际位置结算。
- 人工确认节点：按 Job UUID 批准/拒绝；显示截止时间及服务端确认状态；只开放服务端 actions 允许的动作。

## 边界与状态

业务组件位于 `packages/workflow-editor`，接口适配位于 `packages/services`。`WorkflowRuntimePort.recovery` 是可选的 OS 专属端口，由 `workflow.recovery` capability 显式开放；当前仅 local-python 开放，Backend 和未知配置关闭。

本次接入 OS 已有恢复契约：`/api/v1/stations/local/*`、Job 的 `manual-confirmation` 和 `settle-material-transfer`、Task 的 `execution-locks` 及 OS 专属 `unlock_resources` 命令。普通运行命令仍只有 step/pause/resume/cancel，不扩展普通 Runtime 命令联合类型。

- OS 是执行状态的唯一权威；命令已受理不等于已应用，更不等于设备动作成功。
- 工站写操作带站点/会话/决定版本；需要恢复调度时还带现场确认及快照身份。
- 工站操作和任务恢复操作在提交前按服务地址保存原请求身份；网络结果不明时只允许确认同一个请求。
- 读取失败、连接中断、隐藏工作流或正在提交时关闭对应写操作。
- SSE 复用服务层全局连接，使用原有事件去重与重连机制，仅用于触发 REST 补读；新增识别 station.error_handling.changed 和人工确认 required/resolved 事件。
- 人工确认不保存为前端成功状态；截止时间只限制按钮，最终 timed_out 等状态仍由 OS 返回。
- 物料更正使用恢复会话内的版本化命令，不拼接普通 Material CRUD。

## 验证

- 服务能力与恢复接口单测：15 项通过。
- 恢复控制器、人工确认及动作参数单测：8 项通过。
- 已有任务控制器与冻结任务端口测试：26 项通过。
- 隔离的真实 OS HTTP 链路：1 项通过，覆盖批准/拒绝、相反决定冲突、同请求幂等重放、人工处置开始/完成、库存和占用读取、取消任务后保持暂停。
- OS 人工确认 API、工站控制与人工处置完成门禁测试：51 项通过。
- services、workflow-editor、workbench-theia 类型检查通过；Web、Electron 和 Theia 构建通过。
- 浏览器加载桌面共用的 Theia 产物，已验证工站入口和对话框，未发现新增 console error。

更广的既有 `WorkflowPanel.test.tsx` 有 5 项失败：4 项服务端静态渲染期等待会话发布、1 项隐藏面板投影源码断言。临时屏蔽新增恢复组件后，完全相同的 5 项仍失败，未改动这些既有断言。

未对真实设备执行恢复、单点动作或物料写操作。隔离 HTTP 验证使用真实 OS API/调度/SQLite 存储，设备派发边界使用测试替身。

## 复现隔离 HTTP 验证

从 OS 仓库启动测试实例（环境需要能导入 OS 测试依赖）：

```sh
PYTHONPATH=. python ../uni-lab-fe/e2e/support/recovery-os-fixture.py --port 49871 --manifest /tmp/unilab-recovery-fixture.json
```

在 `uni-lab-fe/packages/services` 执行：

```sh
UNILAB_RECOVERY_FIXTURE=/tmp/unilab-recovery-fixture.json \
UNILAB_RECOVERY_TEST_URL=http://127.0.0.1:49871 \
pnpm exec vitest run src/workflowRecovery.integration.test.ts
```

该测试会改变隔离实例的任务状态，每次验证应启动新实例；未设置以上环境变量时默认跳过。结束后停止测试实例。


## 7.6 后续能力补齐

- 单锁入口调用 OS force-release，使用原 Claim/Fence、原因和物理确认；结果不明保留原请求。接口按作业整组释放，并支持 already_released。没有为此接口虚构 Idempotency-Key 协议。
- 工站命令详情可展开查看状态、结果及应用/下发错误；展开时每 2 秒补读。
- 人工处置候选改为分页物料实例与动作模板组合，筛选和 UUID 语义对齐 OS。
- 按用户明确要求补齐 7.6 刷新策略，增加有生命周期的 1.5/5 秒工站补读和 30 秒任务对账；这是对仓库旧“不新增轮询”指南的本任务范围例外。SSE 仍为主通道，定时器仅补读 REST，不模拟结果、不重试写操作。
- 快照比较忽略全局事件游标，未变化的读取结果保留对象身份；读取串行，退出后清理计时器并忽略旧请求结果。

### 7.6 验证记录

- 恢复服务定向测试 10 项、控制器与人工确认测试 11 项通过。
- OS 执行锁释放测试 7 项通过，覆盖严格现场确认、过期 Claim/Fence 拒绝及重复释放。
- 隔离真实 HTTP 恢复链路 1 项通过，新增命令详情 GET 核对。测试实例不注册物料目录路由，因此目录另在当前 OS 只读验证，返回 9 个候选。
- services、workflow-editor 类型检查以及 Electron/Theia 构建通过。桌面构建包含共享 Web renderer。
- 未在真实设备上触发释放或手动动作；本轮没有做新增按钮的浏览器交互自动化验收。
