# 多肽集成迁移前端基线（2026-09-09）

基线源：`6c2b0a6`，工作分支：`integration/peptide`。本轮不连接真实硬件。

## 启动选库

`desktop:welcome` 依次执行 `build:desktop` 和 `start:desktop-welcome`。
后者继承环境并启动 Electron；`desktop/main.mjs` 发现显式
`THEIA_WORKSPACE` 时直接打开该工作区，`UNILAB_OS_PROJECT` 传给 OS
checkout 解析器。Workspace Host 子进程的 `PYTHONPATH` 按 OS checkout、
工作区、继承路径排序。不能把欢迎页模式理解为忽略显式选库。

在仓库根目录执行以下只读检查，已成功解析当前两个仓库和真实 Python 环境：

```powershell
$env:THEIA_WORKSPACE='C:/Users/yxzjr/Documents/Uni-Lab-Core/LabDeviceBiology'
$env:UNILAB_OS_PROJECT='C:/Users/yxzjr/Documents/Uni-Lab-Core/Uni-Lab-OS'
node --input-type=module -e "import {resolveWorkbenchLaunchConfiguration,discoverWorkbenchPythonEnvironment,discoverWorkbenchOsProject} from './apps/workbench/scripts/workbench-launch.mjs'; const c=resolveWorkbenchLaunchConfiguration([]); const p=await discoverWorkbenchPythonEnvironment({selected:'C:/Users/yxzjr/miniforge3/envs/unilab'}); console.log(JSON.stringify({...c,pythonEnvironment:p,resolvedOsProject:await discoverWorkbenchOsProject({selected:c.osProject,pythonEnvironment:p})},null,2));"
```

这仅证明真实解释器和选库解析，不代表完整 Electron/OS 联调通过。
`pnpm --filter @unilab/workbench build:desktop` 在受限 Windows 用户下失败：
esbuild 无法读取祖先目录 `../../../../..`（Access is denied），随后报告入口无法解析。
原始本地日志为仓库根 `.local-desktop-build.log`；需在有对应目录读取权限的环境重跑，
不能据此改写产品入口或降低测试要求。

## 测试

- `pnpm typecheck`：全部 workspace 通过（改动前）。
- `pnpm --filter @unilab/services --filter @unilab/workflow-editor --filter @unilab/material test`：
  services 218、workflow-editor 420、material 106，共 744 项通过。
  本地完整日志：`.local-migration-tests.log`。
- `pnpm --filter @unilab/workflow-editor test -- src/utils/dagLayout.test.ts`：
  改后 7 项通过，包含 10000 节点逆序链的节点、边保全和逐边层级验证。
- `pnpm --filter @unilab/workflow-editor typecheck`：改后通过。
  `pnpm --filter @unilab/workflow-editor test`：改后 64 文件、421 项通过；
  完整包日志：`.local-workflow-after.log`。
- Workbench 整包脚本测试存在 Windows 基线失败：POSIX 假 Python 可执行夹具不能执行、
  打包夹具的链接/可执行权限等。不将这些失败算作通过，也不修改夹具跳过行为。

## 大 DAG 第一批修复

`assignLayers` 的递归 DFS 在逆拓扑输入的长链上耗尽调用栈。
改用显式栈，保留 predecessor 遍历顺序、缓存及环回边取 0 的旧容错行为。
`separateLayerCollisions` 逐项复制整个同层数组导致宽层二次复杂度，改为局部 bucket push。
不裁剪图、不改 Canonical revision、不改变执行状态。

以下为同一 Vitest 进程中、旧 HEAD 源与新实现的单次诊断值（毫秒），
不是统计性能门禁或浏览器帧率。旧源临时副本和临时基准测试运行后已移除。
原始本地日志：`.local-dag-benchmark.log`。输入为无句柄 action 节点；宽层无边，
逆序链为 n0→n1→… 且输入节点顺序反转，均强制重新布局。

| 输入 | 节点 | 修改前 | 修改后 |
| --- | ---: | ---: | ---: |
| 宽层 | 1000 | 13.46 | 10.04 |
| 宽层 | 5000 | 65.98 | 17.30 |
| 宽层 | 10000 | 186.19 | 41.83 |
| 逆序链 | 1000 | 4.08 | 7.85 |
| 逆序链 | 5000 | 调用栈溢出 | 18.60 |
| 逆序链 | 10000 | 调用栈溢出 | 38.27 |

后续性能核查重点：`useWorkflowDag` 同步 fallback 与异步布局均构造全量元素；
`WorkflowDag` 每次 nodeStates 变化重建所有 runtimeNodes 的对象与 data；
material trace 多处重复投影。需真实浏览器 React profiler/长任务测量后再决定缓存、
对象复用或视口渲染策略，不将本批布局结果宣称为解决所有画布卡顿。

## 后续契约与界面边界

- 复位已有 UI 在 `PersistentWorkflowToolbar`，工作台宿主在
  `workbench-surface-helpers.ts` 区分本地库存重建与 Backend 发布；真实复位待模拟环境联调。
- Debug 使用 `/api/v1/debug/workflow-tasks`、preflight 和 Hold-scoped commands；
  保持独立于共享 runtime commands。并行 Hold 必须由 OS 投影决定，不前端模拟完成。
- 错误干预沿用 `/api/v1/workflow-interventions` 查询与 decisions，接受不等于解决；
  弹窗可以最小化为可恢复入口，只有权威完成/替代后移除。
- 入库窗口尺寸记忆采用相对可用视口，仪器/库位/物料模型保持中立；等待 OS 冻结写入契约。
