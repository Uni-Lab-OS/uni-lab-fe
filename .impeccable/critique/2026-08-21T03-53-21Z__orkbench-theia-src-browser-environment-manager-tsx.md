---
target: 环境管理弹窗
total_score: 16
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 4
timestamp: 2026-08-21T03-53-21Z
slug: orkbench-theia-src-browser-environment-manager-tsx
---
Method: dual-agent (A: /root/environment_ux_assessment · B: /root/environment_detector_assessment)

# 环境管理弹窗 UX 评审

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | 系统状态可见性 | 2/4 | 卡片状态完整，但入口绿点只代表 Workspace Session，不代表 OS、PLC 与整体可运行性 |
| 2 | 符合现实世界 | 1/4 | Workspace Backend、Authority API、Generation、Registry、Dry-run 等系统术语先于用户任务 |
| 3 | 用户控制与自由 | 2/4 | 可点击关闭，但缺少 Esc、焦点圈定、关闭后焦点恢复和操作撤销 |
| 4 | 一致性与标准 | 2/4 | OS/Uni-Lab OS、Backend/Workspace Backend 混用，危险动作语义不一致 |
| 5 | 错误预防 | 2/4 | 部分动作有确认，但“应用设备图并重建本地数据”未提供同等级风险说明 |
| 6 | 识别优于回忆 | 2/4 | 选项可见，但组件关系、生效时机和故障影响需用户自行记忆 |
| 7 | 灵活与高效 | 1/4 | 固定长列表、无故障过滤，任一 busyAction 会锁定大量无关操作 |
| 8 | 美观与极简 | 2/4 | 色彩克制，但健康、故障、日常和危险操作视觉同权 |
| 9 | 错误识别与恢复 | 1/4 | 错误标题泛化、原始消息直出，缺少“原因—影响—下一步” |
| 10 | 帮助与文档 | 1/4 | 没有角色分层、组件关系或故障导向帮助 |
| **Total** | | **16/40** | **Poor：需要重做默认信息架构，而非只调样式** |

## Design Specificity Verdict

**LLM assessment：内容特异，任务模型不够特异。** 弹窗包含真实的 Uni-Lab Runtime、Workspace Backend、OS、PLC-Sim 和 Agent，但组织方式仍像通用进程控制台。产品特异性来自名词，而不是围绕实验室操作者的目标——“现在能不能运行、是否会真实下发设备、当前故障怎么恢复”——建立层级。

**Deterministic scan：** `detect.mjs` 对 `packages/workbench-theia/src/browser/environment-manager.tsx` 返回 0 项发现。表单标签、dialog 角色、日志来源分组和运行模式 `aria-pressed` 等底层语义基本存在。这个结果不是“UX 没问题”，而是确认主要问题属于检测器难以识别的信息架构、渐进披露和任务心智模型。

**Visual overlays：** 当前工具环境没有可变浏览器、tab、Playwright 或 canvas 工具，无法完成脚本注入，因此没有可靠的用户可见 overlay。视觉判断退回到最新 TSX、CSS、入口组件和测试证据。

## Overall Impression

最大的问题不是按钮数量本身，而是把五种任务叠在同一默认层：日常运行连接、首次本地配置、设备/PLC 集成、故障维修、远程共享。用户打开“环境管理”只想确认环境是否可用，却会面对最多 6 个组件、约 15 个生命周期操作、4 类日志以及路径、PID、端口和 Generation 等底层事实。

日常连接切换已经在顶部拥有更清晰的二选一入口；环境弹窗不应继续承担“切换环境”的心智模型。它应该改成“本地运行与诊断”，默认只回答三个问题：**当前能否运行、会真实执行还是模拟、需要用户做什么。**

## Cognitive Load

认知负担清单 **7/8 项失败，属于高负荷**；仅基本分组通过。

- OS 卡同时出现设备图、外部设备范围、2 个运行模式和 4 个动作，共 8 个决策项。
- PLC-Sim 卡包含 3 个字段和 5 个动作，共 8 个决策项。
- 日志区包含 4 个来源和刷新，共 5 个决策项。
- 顶层最多出现 6 个同级服务区域，健康、故障、设置和维修没有优先级。
- 用户还需记住“下次启动生效”、重启与重建的差异，以及各路径对应哪个组件。

## What's Working

1. **权威状态基础正确。** 卡片来自 Session、Runtime、PLC 和 Agent 的真实投影，并同时用文字和状态点表达，不只依赖颜色。
2. **部分高风险动作说明了影响范围。** 重建本地数据、释放端口和切换运行模式已有确认文案。
3. **日常连接选择已有更好的基点。** “本地调试 / Backend + Scheduler”只有两项选择，并说明自动同步、只读和活动任务限制；它应成为唯一日常切换入口。

## Priority Issues

### [P1] “环境”入口状态与实际可运行性不一致

**Why it matters：** 顶部状态点只读取 `session.phase`，容易让用户把“Workspace Backend 就绪”理解为“整个实验环境就绪”；OS 或 PLC 故障可能被低估。失败时系统还会自动打开完整控制台，把用户直接抛入复杂度最高的页面。

**Fix：** 日常切换继续只由顶部连接选择器负责；将弹窗改名为“本地运行与诊断”。入口显示面向任务的综合状态“可运行 / 需处理”，自动打开时只展示故障摘要和一个推荐恢复动作。

**Suggested command：** `$impeccable distill`

### [P1] 技术拓扑先于用户任务，缺少渐进披露

**Why it matters：** 普通用户被迫理解 Runtime、Workspace Backend、OS、PLC-Sim、Agent 和远程访问；这是额外设计负担，不是实验任务自身复杂度。

**Fix：** 默认层只显示“当前连接、能否运行、真实/模拟、待处理事项”。健康服务压缩成一行，异常服务置顶展开。二级分为“本地执行”“PLC 与设备”“诊断日志”；PID、Authority API、Generation、路径统一进入“技术详情”。

**Suggested command：** `$impeccable shape`

### [P1] 高风险动作、进度和恢复结果不够可信

**Why it matters：** 配置、重建、启停与端口维修并列；“应用设备图并重建本地数据”把保存与破坏性结果合在一个主按钮。失败统一成“环境操作失败”，成功也缺少可验证摘要。

**Fix：** 拆分“保存设备配置”与“重建本地数据”，破坏性操作进入独立危险区；每个组件使用局部 busy 状态。成功说明生效时机，失败映射成“原因—影响—下一步”，原始异常折叠到技术详情。

**Suggested command：** `$impeccable harden`

### [P1] Dialog 焦点与可访问性契约不完整

**Why it matters：** 当前只有 `role="dialog"`、关闭按钮和 backdrop，未见打开聚焦、焦点圈定、Esc 关闭或关闭后返回入口。Backdrop 作为 DOM 中第一个按钮还会进入正常 Tab 顺序。

**Fix：** 使用可靠 dialog/focus manager；打开时聚焦故障摘要或标题，Tab 不离开弹窗，Esc 关闭并恢复入口焦点；backdrop 移出 Tab 顺序；状态更新使用 live announcement；提升 9–11px 文字和 27–28px 控件尺寸。

**Suggested command：** `$impeccable audit`

### [P2] 同权视觉和装饰性“状态链”削弱判断

**Why it matters：** 竖线暗示组件存在顺序依赖，但源码中 OS 和 PLC-Sim 同为 order 3，且没有 order 2；它没有回答“哪个上游阻断了什么”，反而要求用户学习一条并不真实的链。

**Fix：** 顶部增加单一健康摘要和推荐动作；健康项压缩，异常项完整展开。删除状态链，除非能够明确表达真实依赖与阻断。日志默认收起，并从故障卡深链到相关来源。

**Suggested command：** `$impeccable layout`

## Persona Red Flags

**Alex（Power User）：** 固定纵向展开、无法按故障过滤、无快捷入口；任何 `busyAction` 都会让跨卡操作一起禁用。专家虽看得懂名词，仍需滚动和等待。

**Jordan（First-timer）：** 首屏出现 `MANAGED LOCAL`、Workspace Backend、Authority API、Generation、Registry、Agent 等未解释术语，没有“从这里开始”。最醒目的主按钮反而是高风险的设备图应用与重建。

**Sam（键盘/读屏用户）：** 没有焦点圈定、Esc 和焦点恢复；backdrop 可聚焦；多数状态变化没有 live region；字号和点击目标偏小。

**实验室设备集成/值守操作员：** 入口状态不能代表 OS/PLC 整体就绪。系统因 PLC 或 OS 故障自动打开时，用户仍需从完整组件列表中自行推断故障链，增加停机和误操作风险。

## Minor Observations

- `MANAGED LOCAL` 是低价值英文眉题，不符合中文优先。
- phase 直接展示 `ready`、`failed` 等英文内部值。
- 日志默认已选 OS，却提示“选择来源后点击刷新”。
- 日志中的 `workspace-backend` 被标成“Backend”，易与正式 Backend 混淆。
- “仅加载外部设备包”拥有专用 class，但当前样式未形成对应组件层级。
- 720px 响应式只改宽度，没有重排高密度内容。

## Questions to Consider

- 如果弹窗因“PLC 连接失败”自动打开，首屏唯一应该出现的动作是什么？
- “环境管理”是否其实是两个产品：日常运行连接选择器，以及仅供高级用户使用的本地服务控制台？
- 哪些角色真的需要编辑原始 graph/PLC 路径？其他角色是否只应选择已验证配置？
- 如果竖向状态链不能回答“哪个上游阻断了哪个任务”，为什么还要让用户学习它？
