# integration/peptide 源码保存迁移

2026-09-09 核对 origin 后，用户明确仅迁源码保存及相关修复，不迁 X6 与工作台整体改版。不 push。

## 提交核对

| 来源 | 提交 | 处理 |
| --- | --- | --- |
| bugfix/workflow-source-save | 46e9209a | 迁入：保存 Python 不强制接受规范化源码，保留未保存画布 |
| bugfix/workflow-source-save | 9b8eace9 | 迁入：确认画布完整差异后写回对应 IDE 文件；拒绝覆盖脏文件 |
| bugfix/workflow-source-save | 9b1a9634 | 迁入：运行原始 Python 草稿，等待 IDE 保存及 OS 同步完成，避免重复提交 |
| feature/theia-workflow-source-save | f7266091、820e7bed | 当前 HEAD 已含祖先提交：基础 IDE 保存链路和完整源码差异展示，无需重复迁入 |
| feature/theia-workflow-source-save | f61e05e9 | 不迁：只将提示改为“正在通过工作区同步保存”，依赖该分支 X6 自动同步行为；当前手动画布保存模式不能显示此状态 |
| feature/theia-workflow-source-save | 其余 15 个独有非合并提交 | 用户排除整套 X6、界面重构等功能；不引入其运行轮询、布局、目录创建等附带变更 |

远端 bugfix 顶端与 test 均为 9b1a9634。feature 顶端为 bc55c4c1，尚未包含在 test 中。用户最初分支名中的 `soure` 实际为 `source`。

3 个 bugfix 提交依次 cherry-pick --no-commit，无冲突；保留当前日志、人工干预及 V2 调试适配。以一个本地修复批提交，保留以上来源映射。

## 额外审查修复

OS 同步返回后重新读取最新画布状态；等待期间新增画布修改时只更新保存事实，保留本地编辑。已切换工作流或源码时拒绝安装旧响应。使用 deferred Promise 覆盖 clean→dirty 与切换工作流两种竞态。

## 验证

- workflow-editor 最终 448、workflow-ide-bridge 15、workbench-theia 140 项测试通过（共 603 项）。
- 上述三包 typecheck 通过。
- 追加异步覆盖防护后重跑 workflow-editor 全套 448 项及 typecheck 通过；结果记录于工作区本地 progress。
- 本批未进行真实 IDE 窗口交互验收；不将单元测试表述为完整桌面端到端验收。
