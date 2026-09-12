# 日志查询迁移（R8/R9）

当前依赖 OS `8ecc3f02`（包含 `5358e0dc`） 的 `/v1/logs/{component}` 筛选契约。

- 单个紧凑多选下拉：TRACE/DEBUG/INFO/WARN/ERROR/FATAL/SYSTEM/LOG 与 Ping / Pong 心跳，默认全选，可清空。清空为 levels=[]、heartbeat=false，不会退回全部。
- 心跳是同一下拉中的独立项，与普通级别取并集；普通级别仅含非心跳记录。匹配 `< PING`、`> PONG`、方向反转及 `keepalive ping/pong`，大小写不敏感；不修改真实 severity。
- 固定显示筛选后最近 500 条，无条数控件。完整当前可查询日志先按记录合并 traceback、过滤，再取最近 500 条；不在字节尾部窗口内过滤。旧 levels/categories 交集仅保留 API 兼容。
- UI→launcher→Theia session service→Workspace Host 原样透传 query。新查询响应验证统计字段，旧 Host 不支持历史查询时显示错误，不能将旧 tail 伪装为全历史结果。
- Agent 本地源读取完整当前文件，使用同口径解析、matchAll 和有界环形缓冲；仍需内存容纳当前文件原文，未引入历史索引。OS/Agent 均不声称搜索已轮转归档文件。
- UI 对服务已筛选内容只格式化显示，不再次按级别/类别裁剪。计数明确表示“筛选后最近 X 条（上限 500）”，不是全历史总条数。
- 筛选变化使旧请求世代失效并清空旧条件内容；空结果时保留筛选控件。
- JSON 消息只去 ANSI，保留原始嵌套字符串引号/反斜杠。Biology 的中文可读原始 wire 字段不被二次 JSON.parse。

共享输入输出 fixture：`packages/workbench-session/src/log-query.fixture.json`，覆盖 LOGURU、ROS、Traceback、心跳、嵌套 JSON 中文、空集合。可供 OS 同一测试读取。

验证：

```powershell
pnpm --filter @unilab/workbench-session test -- src/log-query.test.ts src/workspace-host-session.test.ts
pnpm --filter @unilab/workbench-theia test
pnpm --filter @unilab/workbench-session --filter @unilab/workbench-theia typecheck
```

Session 15 项通过，含真实本地 HTTP adapter query 透传、2500 条新日志之前的错误仍可查。
Theia 全部 140 项通过（日志 UI 7 项通过）。原路径测试用 POSIX 输入/预期，Windows 的原生
resolve 合法补盘符导致失败；产品路径实现正确。本批改为 tmpdir 构造当前平台真实绝对路径，
仍严格断言读取副本位于同级 .readable 目录且保留源文件名，不跳过测试。
两个包 typecheck 通过。本地日志：`.local-log-session-tests.log`、`.local-log-ui-tests.log`、`.local-log-typecheck.log`。
OS 亦执行共享 fixture，全部 5 例逐字通过，包含 CRLF、嵌套转义和中文。

这些单元/适配器测试不代替桌面 UI 实测；仍需以新构建验证真实日志源切换、心跳复选、旧 error 查询和中文 wire 展示。

## 紧凑下拉与独立心跳（2026-09-09 后续批）

当前 Theia 工作台入口改为一个紧凑多选下拉，默认全选，含 TRACE/DEBUG/INFO/WARN/ERROR/FATAL/SYSTEM/LOG 与 Ping / Pong 心跳。单项选中显示名称；支持原生键盘选择、Escape/外点击关闭与失焦关闭。删除类别选择器与条数选择器，固定完整当前历史筛选后最近 500 条。

新增可选 `heartbeat` 查询参数：省略时保留旧 levels/categories 交集；显式 true/false 时，心跳记录仅按该布尔值匹配，非心跳记录按 levels 与 runtime 类别匹配。因此 ERROR + 心跳包括所有等级心跳与非心跳 ERROR，不改变真实 severity。明确清空发送 levels=[]、heartbeat=false。

显式 heartbeat 查询必须收到 `filterSemantics: "heartbeat-union-v1"`，并继续验证完整历史统计字段。旧 Host 缺少任一能力时显示错误，禁止降级伪装。OS 配套提交 8ecc3f02；Agent 使用相同纯查询模块。共享 fixture 由 5 例增至 9 例。

本批仅改 Theia 当前入口，不改 legacy kernel-web 的预截快照 IPC 和界面，避免暗示它具备相同历史查询能力。

验证：Session 16 项，Theia 144 项；两个包 typecheck。本地独立日志位于工作区根 `.local/fe-log-dropdown-{session,theia}-{tests,types}.log`。未通过自动化测试冒充真实键盘/布局 UI 验收；主线待新构建核查窄侧栏、展开层滚动、键盘和外点击关闭。

OS 配套 8ecc3f02：跨仓共享 9 fixture 全通过，相关联合 22 tests 通过，证据 `.local/log-shared-fixture-final.log`。
