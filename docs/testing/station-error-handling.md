# 工站异常处置（节点错误）测试说明

适用范围：`apps/developer-web` 的工站级节点错误处置，以及它在任务详情「异常处置」标签页、
应用壳横幅和总览「异常任务」区的全部投影。

## 1. 覆盖范围

| 能力 | 入口 | 权威来源 |
| --- | --- | --- |
| 发现工站暂停 / 仍有错误 | 总览「异常」指标卡的提示行与「去处置」按钮；其它页面由应用壳横幅负责发现 | `GET /api/v1/stations/{id}/error-handling` |
| 节点级决定（重试节点 / 取消任务） | 任务详情 → 异常处置 → 异常处理 | `POST /api/v1/stations/{id}/errors/{decision_id}/decision` |
| 进入 / 返回 / 完成手动处理 | 同上（选项文案取自 OS 的 `options`） | `POST …/decision`（`enter_manual_handling`）、`POST …/sessions/{id}/return`、`POST …/sessions/{id}/complete` |
| 工站级恢复调度 | 总览「异常」指标卡 → 「恢复调度」对话框 | `POST /api/v1/stations/{id}/resume` |
| 继续应用已受理未生效的命令 | 同一对话框（有错误时从指标卡「查看全部」进入） | `POST /api/v1/stations/{id}/control-commands/{uuid}/apply` |

节点决定与工站恢复是**两级事实，必须分开表达**（`StationResumeCard` 是全前端唯一实现）：

- 节点决定（取消/重试/手动）**一律不带** `resume_requested`：决定只决定这个节点；
- 工站是「全站暂停」，恢复是全局门禁（无待处置错误 + 无待应用命令 + 无未完成人工动作
  + 操作员在同一快照上确认），所以它只能作为独立动作出现；
- **重试在工站暂停时会停在 `pending`**，必须先恢复调度才会派发 —— 这不做成隐式副作用，
  而是在界面上直接写明「工站才会继续派发节点」；
- 不能再恢复时只显示当前门禁原因，不放灰按钮、不放勾选框。
- **任务终态后错误只剩一件事**：任务 `canceled/failed/succeeded/timeout` 时，节点不会再执行，重试与
  手动处理都不会派发任何东西，因此界面只给「关闭异常事实」（OS 的 `cancel_task` 语义，它会一并收尾
  该任务剩余的错误事实），并说明「关闭之后工站才能恢复调度」。

人工处置的状态机（必须按 OS 契约走，不能自创入口）：

- 没有会话时可「手动处理」（是否提供只认 OS `options` 的声明，按钮文案沿用本页短标签）；
- 会话一旦建立就不会被「完成」消掉，因此错误回到 `DECISION_REQUIRED` 后
  再次动手必须走 `sessions/{id}/return`，重新 `enter` 会被 OS 以
  `active_session_conflict` 拒绝；
- `sessions/{id}/complete` 只结束这一轮现场处理，把错误交回「异常处理」；
- 手动执行设备动作、上下料登记与逻辑占用释放仍由 Uni-Lab OS 控制台承担，
  界面必须如实说明，不能假装已经支持。

首屏只保留一个工站异常入口：总览不再同时渲染顶部横幅、工站卡片和指标提示，
跨任务的工站级动作收在按需打开的对话框里。对话框是**决策容器**：`needsAction`
消失（恢复调度或继续应用在 OS 侧生效）即自动收起，不留空壳；判定只看重新读到的
快照，回执为 `PENDING` 而快照仍暂停时必须留在原地说明原因。

不变量：

- 工站快照是唯一事实源。任何决定/恢复/继续应用之后都必须重新读取快照确认生效，
  不允许用回执、HTTP 202 或本地状态推断「已恢复」。
- 结果未知（网络中断、5xx、超时）时保留原始意图与同一个幂等键；`4xx`（408 除外）
  视为确定拒绝，丢弃意图并显示 OS 给出的可行动文案。
- 颜色只作辅助：状态一律同时用文案、图标与可访问标签表达。
- 多行 Python traceback 只进折叠的原文块；摘要区只放一行结论。
- 工站状态刷新由全局 SSE 的 `station.error_handling.changed`（payload 只有
  `station_id`，是 invalidation 不是状态 patch）驱动；只有在实时连接不可用时才降级为
  15 秒兜底轮询。节点已失败但快照里没有对应错误事实时，异常处置页会补读一次。

## 2. 单元与组件测试

```bash
pnpm --filter @unilab-fe/core test            # 端口/编解码/错误码映射
pnpm --filter @unilab/developer-web test      # provider、面板、横幅、任务详情
```

覆盖到的分支（持续补充中）：

- 错误码映射：6 个并发/会话冲突码、6 个人工处置冲突码、404 按 detail 区分
  「工站不存在」与「会话/决定/命令/占用不存在」、OS 中文可行动说明原样透出、422 字段拒绝。
- Provider：快照读取失败的降级、`FAILED` 回执不得当成功、仅 `dispatch_error` 的待应用、
  未确认意图复用同一幂等键、会话字段按错误事实的 `session_id` 携带、继续应用失败后重读。
- 展示层：每个 stage 的文字标签（含 `RESOLVED`）、`RUNNING` 但仍有错误时不得显示成「一切正常」、
  已处理错误不再提供决定入口、窄屏与长文本不溢出。
- 任务详情异常标签页：摘要只取 traceback 最后一行、完整原文折叠保留、
  失败节点只补读一次工站快照、无错误事实时说明原因。
- 总览工站对话框（`OverviewPage.test.tsx`）：恢复生效（快照回到 `RUNNING`）后自行收起；
  回执 `PENDING` 而快照仍 `PAUSED` 时不得收起，并如实说明「已受理但仍待应用」。

## 3. 真实 OS 端到端

前置：developer-web 通过同源代理 `/__unilab_backend` 指向真实 local OS；OS 以
`runtimeMode: normal` 运行并连接 PLC-Sim（SZLab 探针是纯软件设备，仿真器只需保证
其它设备可实例化）。

```bash
UNILAB_FE_E2E_URL=http://127.0.0.1:4176 \
  npx playwright test e2e/developer-web-station-error-handling.spec.ts
```

用例：

1. 失败节点给出处置入口 → 勾选现场确认并点「重试节点」 → 任务 `succeeded`、工站恢复 `RUNNING`、
   后继节点完成、进度 100%。
2. 「取消任务」必须二次确认 → 任务 `canceled`、工站恢复 `RUNNING`。
3. 页面停在工站干净状态时由别的入口制造失败 → 8 秒内（远小于 15 秒兜底轮询）「异常」指标卡自行
   出现「工站调度已暂停」与「去处置」，证明刷新来自 SSE 失效通知而不是轮询。
4. 取消但不勾选恢复调度 → 任务 `canceled`、工站保持 `PAUSED` 且无待处置错误 →
   从指标卡「恢复调度」打开对话框、勾选确认后恢复 → `RUNNING`，且对话框自行收起。

所有用例断言浏览器 `console.error` / `pageerror` 为空；终态只认 OS 的 Task 与工站快照投影。

## 4. 明确未接入的部分（不是缺陷，是边界）

以下 OS 端点已存在，但本前端尚未提供界面，UI 文案必须如实说明而不是假装支持：

- `GET /sessions/{id}/devices/{device_id}/actions`、`POST /sessions/{id}/manual-actions`、
  `GET /manual-actions/{id}`、`POST /manual-actions/{id}/stops`、
  `POST /manual-actions/{id}/review`（手动动作目录、执行、停止与现场核对）；
- `GET /sessions/{id}/inventory`、`POST /sessions/{id}/inventory-corrections`
  （上下料登记）；
- `GET/POST /sessions/{id}/resource-usage|resource-dispositions`（逻辑占用登记与释放）；
- `GET /events?after=`（事件游标补读）。

「异常处置」在遇到人工处置会话时显示会话身份（`sessionId` 与版本）与
「完成手动处理」，并明确写出上述动作仍需在 Uni-Lab OS 控制台完成。