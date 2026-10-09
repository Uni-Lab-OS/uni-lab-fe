# Task 业务组件

任务公共 UI 只承载纯呈现语义，不读取 backend/OS，也不发送运行控制命令。

当前已沉淀：

- `StatusBadge`：任务和 NodeJob 共用的状态标签；状态归一化仍由业务投影层负责。
- `TaskProgress`：百分比和完成节点数；`percent` 为空时显示未提供，不把缺失事实伪造成 0%。

任务详情的查询、runtime 订阅、Inspector 事实、并行分支以及 pause/resume/step/cancel 命令仍属于应用编排层，暂不放入此目录。
