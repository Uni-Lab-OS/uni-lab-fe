# V2 标准调试接口迁移（2026-09-09）

## 本批范围

调试启动由已退役的 `/api/v1/debug/workflow-tasks*` 改为标准任务接口：

- `POST /api/v1/workflows/{uuid}/run-preflight`：`run_mode=step`、单个 `start_node_uuid`、`input`、`launch_overrides`。显示权威 `launch.requirements`，保留 `preflight_hash`。
- `POST /api/v1/workflow-tasks`：同一工作流 UUID、起点、输入、补充值及预检哈希；不从画布生成或裁剪执行图。
- 标准 Task/Jobs REST 与 SSE invalidation 补读；控制统一使用 `step/pause/resume/cancel`。

去除旧 Hold 控制台和唯一暂停节点推断。标准任务暂停是调度门禁，可能同时存在多个就绪节点；前端保留完整 Jobs 投影。命令 accepted 不改变显示的权威状态。HTTP 200 中的业务错误仍由服务适配器拒绝，哈希冲突不伪造任务或自动重试创建。

预检报告状态补齐 OS 当前 `runnable_now/temporarily_unavailable/invalid`。保留 Backend 已有状态类型以兼容同一运行端口。

## 任意断点后续接入

标准预检与任务创建现传 `breakpoint_node_uuids`。标准 `GET /api/v1/workflow-tasks/{uuid}/step-state` 提供候选节点、可单步状态、在途数量、配置与命中断点集合。全局 SSE 重读 Task/Jobs/step-state，不用计时器模拟运行。

工具栏显示全部就绪候选，单步只提交所选 `target_node_uuid`。多个候选未选时禁止单步；`switching_to_step` 显示在途动作等待，`can_step=false` 或读取失败时不下发。resume 保持标准无节点目标命令，恢复普通并行调度。accepted 不提前更新边界。

命中多个断点时显示完整命中列表，不编造唯一当前节点；只有权威报告一个命中且模式为 step 时，使用既有画布/代码单节点暂停高亮。

首入口预览与 OS 规则一致：没有可执行前驱（material_source 不计）时保留全图独立并行根；有前驱时展示下游预览。提交仍由 OS 验证完整断点配置，没有裁剪运行图。动态控制区域中段启动限制仍由 OS 报错。真实调试交互验收待隔离模拟工作区，不能连接真实硬件。

## 验证

工作目录：`C:/Users/yxzjr/Documents/Uni-Lab-Core/uni-lab-fe`。

```powershell
pnpm --filter @unilab/services --filter @unilab/workflow-editor test *> .local-v2-debug-tests.log
pnpm --filter @unilab/services --filter @unilab/workflow-editor --filter @unilab/workbench-theia --filter @unilab/kernel-web typecheck *> .local-v2-debug-typecheck.log
```

测试：services 220 passed，workflow-editor 446 passed。含同期主会话迁入的源码保存修复；本批新增缺失输入、阻断/缺失预检报告、哈希冲突、拒绝未支持断点、并行 Jobs、step/resume accepted 仍保留暂停状态测试。services、workflow-editor、workbench-theia、kernel-web 四包类型检查全部通过（exit 0）。服务适配器测试断言标准 URI 和完整请求配置，不作为真实 OS 端到端证明。

本批 9 个源码/测试文件：services 下 `workflow-task-runtime.test.ts`、`workflow.ts`、`workflowPort.ts`、`workflowTaskContracts.ts`；workflow-editor 下 `PersistentWorkflowAuthoringView.tsx`、`PersistentWorkflowToolbar.tsx`、`usePersistentWorkflowTaskPanel.ts`、`WorkflowTaskController.ts`、`WorkflowTaskController.test.ts`。


后续断点验证日志与命令：

```powershell
pnpm --filter @unilab/services --filter @unilab/workflow-editor test *> .local-breakpoints-tests.log
pnpm --filter @unilab/services --filter @unilab/workflow-editor --filter @unilab/workbench-theia --filter @unilab/kernel-web typecheck *> .local-breakpoints-typecheck.log
```

本次 services 231、workflow-editor 466 测试通过；services、workflow-editor、workbench-theia、kernel-web 四包类型检查全部通过（exit 0）。新增候选显式选择、accepted 状态不变、在途禁止单步、多命中展示、独立并行根预览测试。

