# 前端端到端测试

工作流 E2E 只连接生产 `Uni-Lab-OS` composition，浏览器不得用
`page.route()` 伪造成功响应。OS fixture 使用持久 `workflow.db`、Backend-shaped
Workflow HTTP API 与全局 SSE；故障注入只允许位于浏览器之外的透明代理。

## 当前工作流门禁

- `workflow-authoring-real-os.spec.ts`：Draft、规范化差异、Apply、外部修改与多面板隔离。
- `workflow-task-runtime-real-os.spec.ts`：原生产工作台通过 Task/Jobs/commands 与全局 SSE 运行。
- `workflow-task-runtime-resilience-real-os.spec.ts`：feedback cursor、部分读取失败、SSE 重连与同库 OS restart。
- `workflow-runtime-final-gate-real-os.spec.ts`：旧 Run/WS/polling 负向门禁、command 幂等/冲突、terminal race、重载恢复与最终视觉证据。
- `workflow-material-source-native-cli-real-os.spec.ts`：由 OS 原生 `unilab` CLI 启动 ROS/FastAPI/Edge Scheduler；浏览器完成 MaterialSource palette 添加、selector 编辑、Apply/Start、重复启动的 `admission_blocked`/取消和静态位置冲突拒绝，并以 Inventory snapshot、ledger、outbox 与 native log 证明真实物料创建、Site 占用和 Reservation。
- `workflow-material-flow-projection-real-os.spec.ts`：从真实 OS Authoring draft 投影 ResourceSlot 变量卡片、显式物料边与同名隐式透传血缘；检查 `display_name`/`description` 展示、句柄相对卡片居中且落在节点外缘、独立物料配色、流向动画和五张视觉证据。

已退役的 local bridge、Canonical/Run、Task-scoped events 和旧 Debugger E2E 不得恢复。
设备执行与真实 driver 归后续 Device execution 阶段；UI1D 只用静态/单元门禁确认
临时单节点 Run 入口已移除，不伪造尚不存在的生产设备 Catalog/执行接口。

## 运行

默认 OS worktree 位于：

```text
/home/changjunhan/Uni-Lab-Core/.worktrees/uni-lab-os-runtime-integration
```

如需覆盖，设置：

```bash
export UNILAB_AUTHORING_OS_ROOT=/path/to/Uni-Lab-OS
export UNILAB_OS_PYTHON=/path/to/python
```

最终门禁还必须显式固定当前 acceptance checkout；缺少任一变量会 fail closed：

```bash
export UNILAB_EXPECTED_FE_SHA=<exact-fe-candidate-sha>
export UNILAB_EXPECTED_OS_SHA=<exact-os-checkout-sha>
export UNILAB_EXPECTED_CORE_SHA=<exact-core-baseline-sha>
```

常用命令：

```bash
pnpm test:e2e:workflow
pnpm test:e2e:workflow-final-gate
pnpm test:e2e:workflow-debug
pnpm test:e2e:workflow-material-source
pnpm test:e2e:workflow-material-flow
```

M2B 默认读取
`/home/changjunhan/Uni-Lab-Core/.worktrees/uni-lab-os-m2b-material-source-admission`
与 `/home/changjunhan/.micromamba/envs/unilab/bin/unilab`；可分别用
`UNILAB_AUTHORING_OS_ROOT`、`UNILAB_OS_CLI` 覆盖。其默认证据目录为
`../e2e-artifacts/m2b-material-source-native-cli`，包含九张设计截图、浏览器网络账本、
Inventory 前后快照/ledger/outbox、成功与阻塞的 MaterialSource Job/Task、静态拒绝记录和
OS 原生日志。

最终门禁可用 `UNILAB_E2E_ARTIFACT_DIR` 指定证据目录。账本必须记录精确 FE/OS
SHA、请求/响应、SSE cursor、WebSocket URL、浏览器诊断、显式无轮询观察窗与截图列表。

## 通过标准

- 浏览器不访问 `/api/v1/runtime/runs*`、`/api/v1/runtime/events`、Task-scoped event route 或 Runtime WebSocket。
- Task/Jobs、command accepted→applied、feedback、partial failure、SSE reconnect、OS restart 与 reload 均由真实 OS 返回。
- 原 `PersistentWorkflowAuthoringPanel`、起点/断点、Task 控制与 Output UI 保留。
- 非预期 `console.error`、`pageerror` 和未处理 Promise rejection 为零。
- 最终候选至少生成 5 张不同验收意义的截图和机器可读网络账本。
