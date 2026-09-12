# 多肽 R1 干预与 R4 展示边界

## R1 已实现

- 公共 `WorkflowRuntimePort.interventions`，由 `workflow.interventions` capability 开放；仅当前 local-python 开放，未知 profile/Go 不猜测能力。
- 查询 open + selected，按全局 `workflow.runtime.changed` 和 SSE onOpen 重读；列表消失须 GET detail 确认 superseded 才移除。错误、部分读取失败、accepted、unknown 均不当作完成。
- 选择提交 revision + option_id + 稳定 Idempotency-Key；同一页面不确定重试复用 key，读取失败保留已知事实。
- selected + unknown 提供“重投已选处理”，仅同一页面仍持有原 key 时可用，冻结原 option/revision；accepted 禁止重投。刷新丢失原 key 后如实提示等待服务恢复，不生成替代 key。
- 原错误展示 description，其次 meta_data.error_report.error_message，旧端点缺失时只用 Job.error_info 兜底。
- 弹窗只有最小化，保留可恢复小窗；App 服务宿主及 Theia 非关闭工作台根挂载，portal 到 body。工作流面板卸载、设备/物料页切换不会卸载入口。
- 整个应用/Authority 更换会重建 projection，重新读取 open + selected；不跨服务复制干预事实。

验证命令：

```powershell
pnpm --filter @unilab/services --filter @unilab/workflow-editor test
pnpm --filter @unilab/services --filter @unilab/workflow-editor --filter @unilab/workbench-theia --filter @unilab/kernel-web typecheck
```

日志为仓库根 `.local-interventions-tests.log` 和 `.local-interventions-typecheck.log`。
控制器测试覆盖接受与完成区分、最小化/恢复、重连、SSE清理、列表/detail失败、重复请求锁与幂等重试；
组件静态渲染测试覆盖可访问标签、禁用原因和错误文本转义；宿主边界测试防止入口回到面板生命周期内。
这些不是浏览器端到端成功证明；真实模拟 TCP 异常→OS干预→UI选择→动作结果仍需联调。

限制：公共列表只有 limit（最大500），没有分页游标；达到上限显示明确提示。
Theia 干预宿主已提升至 readiness gate 外。host 离线保留最后未决投影和最小化偏好，
标记离线并禁用决定；ready 后重新读取权威状态再解锁。专门测试覆盖 offline/ready 切换。

## R4 冻结中立展示模型（待 OS 写契约）

唯一事实仍为 MaterialAggregate。展示层只投影以下稳定引用与展示字段：

| 展示项 | 来源和约束 |
| --- | --- |
| 仪器 | 可承载资源的 material id、名称；不按厂商/设备类硬编码 |
| 库位 | aggregate site 的稳定 site id、名称、所属 material id；well/tip spot 不提升为可写 Site |
| 物料 | material id、名称、template id 与当前 placement；不复制实体 |
| 选择 | selected instrument/material/site ids，候选可用性由服务capability/权威占用决定 |
| 窗口偏好 | 仅宽高相对可用视口比例，按窗口用途持久化；恢复时限制到当前视口，不保存物料业务状态 |

不在本批新增入库/移动/批量修改 API。写操作须由 OS 提供 revision、幂等键、冲突及补偿语义后接入 services port。

