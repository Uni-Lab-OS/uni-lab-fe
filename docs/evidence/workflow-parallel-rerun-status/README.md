# 工作流并行再次运行与任务状态 Workbench 回归证据

本证据集于 2026-08-20 在 Workbench 中连接真实 Workspace Backend、Scheduler
和 Edge 运行时生成。回归工作流包含一个持续 30 秒的 PLC 传感器等待节点，用于
稳定观察同一工作流的并行任务事实与设备资源排队。

回归顺序：

1. 创建任务 `856b1838-ffa6-4589-af81-259496d4ee48`，HTTP 返回 201，状态为
   `running`；
2. 在第一条任务运行期间使用“再次运行”创建任务
   `34ef77c1-2f4a-42b0-b80f-a7af9d507d18`，HTTP 返回 201，状态为
   `pending`；
3. 任务列表同时显示第一条“运行中”和第二条“等待执行”；
4. 选择第二条任务后，最右侧展示该任务冻结的
   `wait_sensor_conditions` 工作流界面、节点状态与真实 Job 参数；
5. 两条任务最终依次收敛为 `succeeded`，符合共享 PLC 资源由调度器排队的语义。

截图说明：

- `01-running-task-rerun-action.png`：任务处于“运行中”时，再次运行按钮保持可用，
  悬浮提示明确“创建新的独立任务”；
- `02-parallel-task-status-and-workflow-pane.png`：左侧列出“运行中/等待执行”的两条
  独立任务，右侧为选中任务对应的冻结工作流界面。

Workbench 还会探测未配置的可选集中式 Backend 代理，因此控制台存在一次
`/__unilab_backend/api/v1/health` 的 502；本次回归使用的本地调度权威始终显示
“Workspace Backend 已连接”，工作流和任务请求均走真实本地 Authority。
