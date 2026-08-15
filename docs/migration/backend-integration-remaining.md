# Backend 联调剩余项

## 当前前端基线

`local-go` Profile 已经只通过共享 Service Port 接入以下 Backend 能力：

- 设备、设备动作、资源模板、物料图与工作流目录只读；
- 设备单动作正式任务（WorkflowTask + WorkflowNodeJob）；
- 已有工作流的运行准备、运行预检、`normal`、`step`、`single_node` 正式运行；
- 工作流任务、节点作业与持久反馈的 REST 补读；
- Backend 不支持的能力继续按 capability matrix 关闭失败。

本文件只记录需要 Backend 仓库继续提供或收敛的合同，不授权前端拼装私有接口、轮询
推导终态或建立第二套运行状态机。

## Backend 待改清单

| 优先级 | 差异 | Backend 简单修改方案 | 前端接入验收条件 |
|---|---|---|---|
| P0 | 全局 SSE 没有覆盖 Task、Job、命令和反馈每次权威变化的统一失效事件 | 在状态事务提交后写入 `workflow.runtime.changed`，载荷固定为 `{workflow_task_uuid}`；设备单动作可复用该事件，或补充 `{task_uuid}` 的 `device_action_task.changed` | 支持 `Last-Event-ID` 补发、事件 ID 单调且不把状态塞入事件；前端收到事件后只触发 REST 补读，随后才可开启 `workflow.subscribeEvents` 并移除手动刷新依赖 |
| P0 | 工作流任务 `input` 当前固定为空，不能运行带 Workflow I/O 的已发布工作流 | 按已发布 `input_contract` 校验、默认值归一化并在创建 Task 时冻结输入；执行计划和历史投影读取同一冻结值 | 非空输入可原样回读；非法、未知或缺失必填字段返回稳定错误；Scheduler 重启后含义不变 |
| P0 | Backend 的行级工作流编辑接口与前端 Canonical Authoring 聚合、Draft、Apply、冲突语义不同 | 提供 workflow-scoped Authoring GET、Draft PUT、Apply POST，以及 `workflow.authoring.changed` 失效事件；修订冲突返回稳定 409 合同 | 前端可删除 Backend 私有拼装，启用 `workflow.authoring`，并通过同一 aggregate 完成加载、保存、应用与冲突恢复 |
| P0 | 单动作/工作流在断线、重启、执行结果未知与清理阶段仍缺生产 Edge 验收 | 用真实 Edge 覆盖 Command ACK/重放、Job Token、feedback/outcome 幂等、Scheduler 重启、`execution_unknown` 和 `requires_attention` 收敛 | UI 不轮询、不猜终态；只靠 SSE 失效 + REST 补读可恢复并呈现三条状态轴 |
| P1 | 运行预检可能返回 `requires_confirmation`，但没有通用的确认令牌和创建提交合同 | 预检返回一次性或内容寻址的确认身份；创建 Task 携带该身份，服务端重新校验修订和检查结果 | 前端可以展示逐项确认并安全提交；当前仍对该状态关闭失败 |
| P1 | 物料写合同尚未与前端 `MaterialGraphPort` 的 move/attach/detach/updateSite 原子命令完全同构 | 在现有 revision、idempotency key、ledger 与 receipt 基础上，明确每种图命令的目标聚合、涉及的多聚合修订和返回聚合集合；补充统一冲突码 | 任一图操作只需一次原子命令；相同命令可重放；冲突后能用 receipt/最新图恢复，前端才开启物料写 capability |
| P1 | 工作流物料输入虽使用 `ResourceSlot`，但运行时 Site/物料占用意图和多目标 claim 返回尚未形成稳定前端合同 | 为输入选择、Site 约束、执行占用声明和预检详情定义 typed DTO；保持物料（Material）、库存（Inventory）和库位（Site）身份分离 | 前端不解析 `param` 私有结构即可选择物料并定位预检冲突，Task 冻结所选身份与数量 |
| P2 | `/api/v1/material-shapes` 缺失，浏览器会请求后退回实心包围盒 | 提供可缓存的只读形状目录，或在 capability/模板详情中明确声明无自定义形状 | 返回稳定 `items` 数组与缓存标识；接口缺失不再产生 404 噪声 |
| P2 | 浏览器直接跨源连接 Backend 时 OPTIONS/CORS 未开放 | 增加可配置 Origin 白名单，允许实际方法/请求头及 SSE；生产默认不使用通配符 | 本地前端无需 Vite 代理也能完成 REST、错误响应和 SSE 重连；预检请求返回正确 CORS 头 |
| P2 | 生产数据库部署尚未验证 PostgreSQL 与时序历史的容量、保留和迁移策略 | 固化迁移、备份恢复、反馈/事件保留清理和 TimescaleDB（若采用）部署基线 | 压测、升级和恢复演练有可复现脚本，历史清理不破坏 SSE 游标或任务审计 |

## 明确不由前端补洞

- 不把 `job.feedback`、`intervention.*` 等领域事件猜成 Task/Job 状态补丁；
- 不用定时轮询替代缺失的全局失效事件；
- 不把多个 Backend 行级 CRUD 拼成一次“看似原子”的物料或工作流写操作；
- 不把 `single_node` 正式运行冒充 Debugger Hold，也不在浏览器维护调度状态机；
- 不因同路径或同字段名就启用 capability，必须先完成语义和恢复验收。
