# 领域设备包 Edge 自定义启动命令：跨平台与安全设计调研

> 状态：已实现，待产品验收
> 调研日期：2026-08-05
> 源码基线：`integration/fe-os-migration@7560eef6607a70cdfff4a0676ce8cc410d934405`
> 范围：桌面端“挂载领域设备包的领域侧 Edge”启动器；不改变 Edge、领域设备包或调度器（Scheduler）的运行权威。

## 结论

首版应继续使用结构化进程规范：

```ts
spawn(executable, args, {
  cwd,
  env,
  shell: false,
  windowsHide: true
})
```

“用户自定义启动命令”在产品合同中应表示独立的 `executable`、`args[]`、`cwd` 和 `extraEnv[]`，而不是一段交给 shell 解析的自由字符串。Node.js 的 `spawn()` 原生接受命令和参数数组，`shell` 默认即为 `false`；官方同时警告：启用 shell 后，含 shell 元字符的未净化输入可触发任意命令执行。Node.js 新版本还已弃用 `shell: true` 时另传 `args` 的方式。[Node.js `spawn()` 文档](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)

推荐的首版能力边界：

1. “托管默认值”保持现有行为，老配置升级后不变。
2. “自定义”允许修改可执行文件、逐项参数、工作目录、额外环境变量和结构化就绪端口。
3. 可执行文件和工作目录支持平台无关占位符，由 Electron 主进程解析；不使用 `$VAR`、`%VAR%` 或 PowerShell 变量语法。
4. Windows 首版只直接运行原生 `.exe`；显式拒绝 `.cmd`、`.bat`、PowerShell 脚本和自由 shell 字符串，并给出可行动提示。
5. renderer 只编辑配置和展示预览；Electron 主进程负责二次校验、占位符解析、批准确认、生成最终进程规范和启动。
6. 命令预览来自主进程实际解析结果，但只是展示，不再被解析回执行输入。

这一边界既覆盖当前的 `Scripts/unilab.exe`，也保留了 Linux/macOS 的 `bin/unilab`，并避免把 Windows、POSIX shell 和 PowerShell 三套互不相同的引用规则引入一个文本框。

## 本次实现决策（Implementation Decision）

本次交付采用结构化首版接口：用户可覆盖 `executable + cwd + args[] + extraEnv[]`；Conda/PYTHONPATH、随机 `ROS_DOMAIN_ID`、运行数据库、可观测性、固定就绪端口和领域设备动作目录就绪门继续由 Electron 启动器管理。`cwd` 必须是已存在的绝对目录，环境变量不能覆盖启动器权威字段，也不能保存名称明显为密码、令牌或认证信息的值。这样自定义模板可以覆盖真实领域包启动差异，同时不改变现有进程回收和“领域侧 Edge 已就绪”的判定语义。

- 配置 key 升级为 `unilab.local-runtime-launch-config.v3`；v1/v2 自动进入 `generated` 模式。
- 自定义模式要求挂载领域设备包，使用 `{{...}}` 闭集占位符；界面允许先切换模式，再通过必填校验引导补齐领域目录。
- renderer 提供可执行文件、工作目录、逐行参数、逐行 `NAME=value` 环境变量、占位符说明和仅展示的参数边界预览。
- Electron 主进程重新校验 IPC schema、占位符、长度、绝对工作目录、环境变量名称和可执行文件，并在每次启动前显示原生确认对话框。
- Windows 只接受绝对 `.exe`，拒绝 `.cmd/.bat/.ps1`、`cmd.exe` 与 PowerShell。
- 自定义就绪端口、持久批准 fingerprint、秘密存储和多平台 profile 留待后续独立需求；本次不扩大这些权威接口。

### 维护文件拆分设计

本次触及三个既有超长文件，但没有在启动命令改造中同时搬迁大量成熟日志/生命周期代码。后续按稳定 seam 分轮拆分：

| 文件 | 当前行数 | 当前职责 | 本次决定 |
| --- | ---: | --- | --- |
| `apps/kernel-web/src/components/LocalRuntimeLauncher.tsx` | 1966 | 启动入口、配置弹窗、日志抽屉、存储迁移 | 本次只把新编辑器提取为独立组件；按下列 1–3 步继续拆分 |
| `apps/kernel-web/src/components/LocalRuntimeLauncher.module.scss` | 1547 | 启动器、弹窗、日志与自定义命令样式 | 与 React seam 同步拆成三个 CSS module，避免选择器跨组件漂移 |
| `apps/desktop/src/main/localRuntimeManager.ts` | 1355 | 启动计划、环境、就绪门、日志和进程生命周期 | 新命令解析已独立；后续按计划解析/日志 I/O seam 迁移 |
| `apps/desktop/src/main/index.ts` | 987 | Electron 组合根、IPC 与安全确认 | 本次只加入窄 IPC；后续把本地运行 IPC 整体下沉 |

这些文件均已超过 800 行，因此不能把“不拆分”作为长期状态；本次暂缓搬迁的具体原因是要让 Windows 行为修复与大规模纯移动保持可独立审查、可独立回滚。

1. 先把 `LocalRuntimeLauncher.tsx` 的配置迁移与校验提取到 `localRuntimeConfig.ts`，原有 renderer 测试改为直接覆盖纯归一化接口。
2. 再把日志读取、ANSI 解析、虚拟列表和日志抽屉提取到 `LocalRuntimeLogDrawer.tsx`，保留 `LocalRuntimeLogsSnapshot` 作为唯一外部接口。
3. 把剩余配置对话框、服务状态与入口编排分别放入 `LocalRuntimeDialog.tsx` 和约 300 行的 `LocalRuntimeLauncher.tsx`；SCSS 同步按 launcher/dialog/log 三个 CSS module 拆分。
4. 将 `localRuntimeManager.ts` 的启动计划解析移入 `localRuntimeLaunchPlan.ts`、日志 I/O 移入 `localRuntimeLogs.ts`，管理器只保留进程生命周期；现有 `resolveLocalRuntimeLaunchPlan` 测试是迁移保护面。
5. 将 `index.ts` 的本地运行 IPC 注册与原生确认移入 `localRuntimeIpc.ts`，主入口只负责组合 Electron 模块。每一步先移动测试再移动实现，避免与本功能的 Windows 行为修复混在同一变更中。

## 当前实现证据（Current Implementation）

当前实现已经具备一个适合扩展的结构化边界：

- IPC 配置目前只有五个路径字段，尚无自定义进程规范。[共享类型](https://github.com/Uni-Lab-OS/uni-lab-fe/blob/7560eef6607a70cdfff4a0676ce8cc410d934405/apps/desktop/src/shared/localRuntime.ts#L1-L16)
- renderer 通过窄化的 `startEdge(config)` preload 方法发起请求，没有暴露原始 `ipcRenderer`。[preload bridge](https://github.com/Uni-Lab-OS/uni-lab-fe/blob/7560eef6607a70cdfff4a0676ce8cc410d934405/apps/desktop/src/preload/index.ts#L198-L235)
- 主进程验证请求来自主窗口，并对 payload 做运行时类型检查；当前检查只覆盖五个字符串字段。[sender 与 payload 校验](https://github.com/Uni-Lab-OS/uni-lab-fe/blob/7560eef6607a70cdfff4a0676ce8cc410d934405/apps/desktop/src/main/index.ts#L668-L723)
- 启动计划内部已经是 `command + args + cwd + env`，不是 shell 字符串。[`LocalRuntimeSpawnSpec`](https://github.com/Uni-Lab-OS/uni-lab-fe/blob/7560eef6607a70cdfff4a0676ce8cc410d934405/apps/desktop/src/main/localRuntimeManager.ts#L26-L37)
- 实际启动固定为 `shell: false`，并分别捕获 stdout/stderr；这一点应保留。[进程启动器](https://github.com/Uni-Lab-OS/uni-lab-fe/blob/7560eef6607a70cdfff4a0676ce8cc410d934405/apps/desktop/src/main/localRuntimeManager.ts#L401-L444)
- 当前领域设备包 Edge 的 `unilab` 参数、`cwd` 和环境变量由主进程生成。[默认 Edge 进程规范](https://github.com/Uni-Lab-OS/uni-lab-fe/blob/7560eef6607a70cdfff4a0676ce8cc410d934405/apps/desktop/src/main/localRuntimeManager.ts#L800-L840)
- Windows 已使用 Conda 环境的 `Scripts/unilab.exe`，并按 Windows 规则合并 `PATH`、`PYTHONPATH` 和 Conda 环境变量。[Windows 环境与可执行文件解析](https://github.com/Uni-Lab-OS/uni-lab-fe/blob/7560eef6607a70cdfff4a0676ce8cc410d934405/apps/desktop/src/main/localRuntimeManager.ts#L891-L973)
- 启动成功不是“进程已创建”，而是继续检查健康接口、工作流模板目录和领域设备动作目录；自定义命令仍必须服从这个就绪合同。[Edge 就绪门](https://github.com/Uni-Lab-OS/uni-lab-fe/blob/7560eef6607a70cdfff4a0676ce8cc410d934405/apps/desktop/src/main/localRuntimeManager.ts#L247-L325)
- renderer 当前将 v2 配置保存在 `localStorage`，读取时兼容 v1；迁移应延续这一模式，但自定义命令的执行批准不能只存在 renderer。[存储与迁移入口](https://github.com/Uni-Lab-OS/uni-lab-fe/blob/7560eef6607a70cdfff4a0676ce8cc410d934405/apps/kernel-web/src/components/LocalRuntimeLauncher.tsx#L26-L34)；[v1/v2 读取](https://github.com/Uni-Lab-OS/uni-lab-fe/blob/7560eef6607a70cdfff4a0676ce8cc410d934405/apps/kernel-web/src/components/LocalRuntimeLauncher.tsx#L1554-L1580)
- 已有单元测试同时断言 POSIX 与 Windows 的可执行文件路径、参数数组、环境变量大小写和路径分隔符，可作为回归基线。[启动计划测试](https://github.com/Uni-Lab-OS/uni-lab-fe/blob/7560eef6607a70cdfff4a0676ce8cc410d934405/apps/desktop/src/main/localRuntimeManager.test.ts#L102-L166)；[Windows 测试](https://github.com/Uni-Lab-OS/uni-lab-fe/blob/7560eef6607a70cdfff4a0676ce8cc410d934405/apps/desktop/src/main/localRuntimeManager.test.ts#L198-L244)

## 两种配置模型比较

| 维度 | 自由 shell 字符串 | `executable + args[]` 结构化配置 |
| --- | --- | --- |
| Linux/macOS/Windows 一致性 | 差；`/bin/sh`、`cmd.exe`、PowerShell 语法不同 | 好；进程规范一致，平台差异集中在 executable/path/env resolver |
| 空格与引号 | 用户必须理解当前 shell 的引用规则 | 每个数组项就是一个参数；用户不手写包裹引号 |
| 注入边界 | shell 元字符具有执行语义 | `&`、`|`、`;` 等只是普通参数字符 |
| `.exe` | 可运行，但经历额外 shell 解析 | 可直接运行，符合当前实现 |
| `.cmd` / `.bat` | 能运行，但必须接受 `cmd.exe` 语义 | 不能当原生可执行文件；需单独脚本模式 |
| 环境变量 | 常与命令文本混在一起，跨平台语法不同 | 独立 key/value 合并和校验 |
| 工作目录 | 常靠 `cd ... && ...`，停止和错误归因更复杂 | `cwd` 是进程创建选项 |
| 命令预览 | 预览就是执行体，误编辑风险高 | 预览由最终 argv 派生，不参与执行 |
| 测试 | 必须测多种 shell parser | 可对纯解析函数逐字段断言 |
| 进程树停止 | shell 会增加中间进程，可能留下孙进程 | 直接管理实际 Edge 进程；与现有停止逻辑一致 |

Node.js 还明确示例说明：通过 shell 启动的进程可能在父 shell 被终止后留下子进程。因此对需要可靠停止、退出清理和 Windows `taskkill /t` 的本地 Edge，直接启动实际可执行文件更合适。[Node.js 子进程终止说明](https://nodejs.org/api/child_process.html#subprocesskillsignal)

## Windows 兼容语义

### `.exe` 与参数

Windows 最终使用一条命令行字符串创建进程，C/C++ 运行时再把字符串解析为 `argv`。空格、双引号和双引号前连续反斜杠都有专门规则；手工拼字符串很容易在路径含空格、尾反斜杠或字面引号时改变参数边界。[Microsoft C 命令行参数解析规则](https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments?view=msvc-170)

因此：

- UI 中每一项 `args[]` 都是最终参数值，不要求也不允许用户为了空格额外包一层引号。
- `spawn()` 保持 `windowsVerbatimArguments: false`（默认值），让 Node.js 为原生可执行文件执行参数引用；不要自行实现一套 Windows quoting。[Node.js `windowsVerbatimArguments`](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)
- executable 优先解析成绝对路径。Microsoft 指出，当程序路径含空格且可执行文件名只从命令行首 token 推导时，可能错误执行同目录层级下的另一个程序；显式 application path 可避免该歧义。[Microsoft `CreateProcessW` 安全说明](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw#security-remarks)
- 首版 Windows 自定义 executable 应要求 `.exe` 绝对路径，或使用主进程提供的 `${UNILAB_EXECUTABLE}` / `${PYTHON_EXECUTABLE}` 占位符。Python 模块或脚本应表达为 `python.exe` 加参数，不把 `.py` 当 executable。

### `.cmd`、`.bat` 与 PowerShell

`.cmd` 和 `.bat` 不是可直接创建的原生进程。Node.js 官方说明它们需要 terminal，并给出的选择是 shell、`exec()`，或显式启动 `cmd.exe /c`；Microsoft 的 `CreateProcessW` 文档也要求启动 `cmd.exe` 后传 `/c` 和批处理文件名。[Node.js Windows 脚本说明](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows)；[Microsoft `CreateProcessW`](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)

这不应被隐藏在“自动识别扩展名后打开 shell”中，因为 `cmd /c` 对首尾引号有额外剥离规则，`& | ( )` 等字符也有控制语义。[Microsoft `cmd` 规则](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd#remarks)

首版策略：

- executable 以 `.cmd`、`.bat`、`.ps1` 结尾时失败关闭。
- 错误文案指出：请选择原生 `.exe`；例如当前 Conda 环境应使用 `Scripts/unilab.exe`。
- 如果后续确有脚本需求，新增显式的 `kind: 'windows-cmd-script' | 'powershell-script'` 合同、平台限定、主进程确认和独立测试；不得在 `kind: 'native'` 中自动降级到 shell。

### 环境变量与工作目录

Node.js 指出 Windows 环境变量名不区分大小写；如果传入 `PATH` 和 `Path` 等重复键，只会按其内部排序取一个值。[Node.js 环境变量说明](https://nodejs.org/api/child_process.html#child_process)

因此主进程应：

- Windows 上以大小写不敏感方式检测重复键和受保护键，最终只保留规范键名 `PATH`、`PYTHONPATH`、`CONDA_PREFIX` 等。
- 禁止环境变量名包含 `=`；Win32 环境块使用 `name=value` 表示一项。[Microsoft `CreateProcessW` 环境块](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)
- `cwd` 必须在主进程展开为存在的绝对目录。Windows 支持本地绝对路径与 UNC 路径；不要用 `cd` 模拟工作目录。[Microsoft `CreateProcessW` 的 `lpCurrentDirectory`](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw)
- 保持当前 Windows Conda 环境激活逻辑，尤其是环境根目录、`Library/bin`、`Scripts` 的 `PATH` 顺序；自定义 `extraEnv` 不应绕过该基线。

## 候选配置合同（Candidate Design）

建议把公共配置升级为显式版本 envelope，并使用完整、无隐式数组合并的平台 profile：

```ts
type LocalRuntimePlatform = 'win32' | 'linux' | 'darwin'

interface EdgeNativeProcessTemplate {
  kind: 'native'
  executable: string
  args: string[]
  cwd: string
  extraEnv: Array<{ name: string; value: string }>
  readiness: {
    edgeHttpPort: number
    hostLinkPort: number
  }
}

interface EdgeCustomLaunchConfig {
  profiles: {
    default: EdgeNativeProcessTemplate
    win32?: EdgeNativeProcessTemplate
    linux?: EdgeNativeProcessTemplate
    darwin?: EdgeNativeProcessTemplate
  }
}

interface LocalRuntimeLaunchConfigV3 {
  schemaVersion: 3
  paths: {
    graphPath: string
    osProjectPath: string
    domainProjectPath: string
    environmentPath: string
    simulatorProjectPath: string
  }
  edgeLaunch:
    | { mode: 'managed' }
    | { mode: 'custom'; custom: EdgeCustomLaunchConfig }
}
```

解析规则：当前平台的完整 profile 优先，否则使用 `default`；不对 `args` 或 `extraEnv` 做逐项 partial merge，避免“Windows 只覆盖 executable，却意外继承不适用参数”的隐式行为。

### 占位符

占位符应由主进程按字段逐项展开，未知占位符直接报错：

| 占位符 | 主进程解析值 |
| --- | --- |
| `${UNILAB_EXECUTABLE}` | Linux/macOS 的 `<env>/bin/unilab` 或 Windows 的 `<env>\Scripts\unilab.exe` |
| `${PYTHON_EXECUTABLE}` | Linux/macOS 的 `<env>/bin/python` 或 Windows 的 `<env>\python.exe` |
| `${GRAPH_PATH}` | 已校验设备图 JSON |
| `${OS_PROJECT}` | 已校验 Uni-Lab-OS 根目录 |
| `${DOMAIN_PROJECT}` | 已校验领域设备包根目录；本功能中必填 |
| `${RUNTIME_DIR}` | launcher 创建并管理的本次运行目录 |
| `${EDGE_HTTP_PORT}` | `readiness.edgeHttpPort` |
| `${HOST_LINK_PORT}` | `readiness.hostLinkPort` |

不要复用 shell 的 `$VAR`、`${VAR}` 或 `%VAR%` 展开语义；这里的 `${...}` 是应用自己的封闭模板语法，展开结果仍然是一个 argv 项的一部分，不会再次解释 shell 元字符。若要避免与现有环境变量写法混淆，也可以使用更显式的 `{{DOMAIN_PROJECT}}`，但必须只保留一套语法。

默认 profile 应由代码生成，不要在迁移时把当前默认参数永久复制进用户的 `custom` 配置。这样以后默认 CLI 参数变化时，`mode: 'managed'` 的用户仍自动得到新默认值。

### 环境变量合并权威

建议固定合并顺序：

1. 经过平台规范化的父进程环境。
2. 当前已有的 Conda 激活环境。
3. 用户 `extraEnv`，但不能覆盖受保护键或保存敏感变量。
4. launcher 管理的运行变量，例如运行数据库、观测配置、HostLink 端口和随机 ROS 域编号；这些字段最后写入并保持权威。

受保护键至少包括：`PATH`、`PYTHONPATH`、所有 `CONDA_*`、`UNILABOS_RUNTIME_DB`、`UNILABOS_HOSTLINKCONFIG_PORT`。如果产品需要让用户固定 `ROS_DOMAIN_ID` 或改变观测开关，应增加有类型的专用字段并做范围/枚举校验，不应通过任意环境变量覆盖实现。

PATH 类扩展也应提供 `extraPathEntries[]` / `extraPythonPathEntries[]` 之类的结构化字段，而不是要求用户重写完整 PATH。

### 就绪合同

命令自定义和“Edge 是否可用”是两个独立合同，不能从自由参数文本反向猜端口：

- 主进程用 `readiness.edgeHttpPort` 做端口占用检查并构建 health、模板目录和设备目录 URL。
- 主进程用 `readiness.hostLinkPort` 生成 `UNILABOS_HOSTLINKCONFIG_PORT` 并做占用检查。
- `${EDGE_HTTP_PORT}` 和 `${HOST_LINK_PORT}` 让默认及自定义 argv 与就绪检查使用同一事实源。
- 挂载领域设备包时继续要求领域设备动作目录就绪。一个自定义命令即使成功创建进程，只要没有真正加载领域设备包，也不能报告“领域侧 Edge 已就绪”。

## IPC 与权限边界

Electron 官方建议开启 context isolation、只通过 preload 暴露逐消息方法，并校验所有 IPC sender；不能因为用了 `contextBridge` 就认为 payload 可信。[Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation#security-considerations)；[Electron IPC 指南](https://www.electronjs.org/docs/latest/tutorial/ipc#pattern-2-renderer-to-main-two-way)；[Electron sender 校验](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages)

自定义 executable 把现有“启动固定 unilab CLI”的能力扩大为“启动用户选定的本地程序”，属于明显的权限扩张。建议：

- 继续只暴露 `previewEdgeLaunch(config)` 和 `startEdge(config)` 两个领域化方法，不暴露通用 `spawn`、`exec` 或任意 IPC channel。
- 主进程验证 `event.senderFrame` 是主窗口 main frame；当前仅比较 `event.sender` 与主窗口 `webContents`，对未来 iframe 场景不够细。
- 主进程对结构、字段长度、占位符、路径、扩展名、端口、环境变量名和数量做完整校验；renderer 校验只负责即时 UX。
- “高级：自定义 executable”第一次启动及内容变化后，由主进程原生对话框显示解析后的 executable、argv、cwd、非敏感 env 和领域项目，要求用户明确确认。
- 对批准内容计算稳定 fingerprint；批准记录放在主进程管理的 Electron `userData`，不能把“已批准”布尔值放进 renderer `localStorage`。fingerprint 至少覆盖 platform、resolved executable、args、cwd、extraEnv、readiness 和领域项目路径。
- 如果首版不准备实现主进程批准存储，则把 executable 固定为 `${UNILAB_EXECUTABLE}`，只开放 args/cwd/extraEnv；这比把任意 executable 直接交给 renderer 安全。

## UI 与命令预览

推荐交互：

1. 单选“使用推荐命令 / 自定义”。
2. 自定义区分别编辑“可执行文件”“参数列表”“工作目录”“额外环境变量”“就绪端口”。
3. 参数列表一行一个参数，支持空字符串参数；不要自动按空格拆分，也不要自动去掉用户输入的字面双引号。
4. 提供“从当前推荐命令开始编辑”和“恢复推荐命令”，但用户必须明确切换到 `custom` 才冻结副本。
5. 提供“解析预览”。预览由主进程返回：平台、executable、带索引 argv、cwd、环境变量差异、就绪 URL、fingerprint。
6. 单行 shell 风格文本只能作为辅助显示，标注“仅预览；实际按参数数组启动”。真正可核对的内容应是 argv 表格。
7. 环境变量名匹配 `TOKEN|SECRET|PASSWORD|PASS|KEY|COOKIE|AUTH` 时默认遮盖值；日志也不能记录完整环境。
8. 当前平台没有匹配 profile、Windows 选了 `.cmd/.bat/.ps1`、存在未知占位符或端口冲突时，在启动前明确失败。

单行预览需要平台感知引用，但不能被当成执行输入。Windows C 运行时的引号/反斜杠规则与 PowerShell 解析规则不同；PowerShell 7.3 还改变过原生命令参数传递行为。[Microsoft PowerShell 原生命令参数说明](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_parsing#passing-arguments-that-contain-quote-characters)

## 持久化与迁移

建议使用新的 key `unilab.local-runtime-launch-config.v3`：

- v1/v2 读取成功后迁移为 `schemaVersion: 3`、原路径进入 `paths`、`edgeLaunch.mode = 'managed'`。
- 迁移不得生成 `custom` 默认参数副本，也不得改变当前启动行为。
- v3 写入成功后可以继续保留旧 key 一个发布周期用于回滚；读取优先 v3。
- JSON 损坏、未知 schema version、字段超限或 custom profile 不完整时失败关闭，保留原文本用于诊断，并向用户提供“恢复推荐配置”；不得静默执行部分配置。
- `localStorage` 只保存偏好，不保存秘密和执行批准。需要秘密环境变量时，应另行设计主进程安全存储，本需求不应顺手把 token/password 放入 v3 JSON。
- 配置可限制总大小（例如 64 KiB）、参数数（例如 128）、环境变量数（例如 64）和单值长度，防止 renderer 向主进程提交无界 payload。

## 校验与错误处理

主进程校验应按以下次序给出可行动错误：

1. schema 和平台 profile 是否完整。
2. 字段是否含 NUL；预览/日志字段可额外拒绝 CR/LF，防止显示与日志伪造。
3. 占位符是否来自闭集，必需路径是否已选择。
4. executable 展开后是否为存在的绝对普通文件；Windows native 模式是否为 `.exe`。
5. `cwd` 是否为存在的绝对目录。
6. env name 是否合法、是否重复、是否覆盖受保护键；Windows 比较不区分大小写。
7. 端口是否为合法整数、互不相同且当前可用。
8. 生成最终计划并返回预览；启动时重新解析，确保预览后配置没有变化。
9. spawn 的 `ENOENT` 要区分“executable 不存在”和“cwd 不存在”；`EACCES` 显示无执行权限；进程在就绪前退出时同时给出 exit code/signal 和日志入口。
10. 进程存在但 health/目录超时，应显示实际探测 URL、等待时长和“命令可能使用了不同端口/未挂载领域设备包”的提示。

不要把 shell 元字符黑名单当安全措施。在 `shell: false` 下它们本来只是参数数据；在 shell 模式下则很难靠不完整黑名单覆盖 `cmd`、PowerShell 和 POSIX shell 的全部语法。

## 可测试设计

把解析器保持为近似纯函数：

```ts
resolveEdgeLaunchPlan(config, {
  platform,
  inheritedEnv,
  randomRosDomainId,
  now
}): Promise<LocalRuntimeLaunchPlan>
```

最低测试矩阵：

### 解析单元测试

- v1/v2 → v3 后仍为 `managed`，最终默认计划与当前快照完全一致。
- `win32` 将 `${UNILAB_EXECUTABLE}` 解析为 `Scripts\unilab.exe`；Linux/macOS 解析为 `bin/unilab`。
- executable、cwd、领域项目和设备图路径均包含空格、中文和括号。
- argv 覆盖空字符串、内嵌空格、字面双引号、尾反斜杠、`& | ; $ % !`，解析后数组逐项不变。
- Windows `.cmd/.bat/.ps1` 在 native 模式失败并给出明确建议。
- 未知占位符、NUL、重复 env、Windows 下 `PATH`/`Path` 冲突、受保护键覆盖和端口冲突失败。
- 平台 profile 完整替换而不是 partial merge；缺省 profile fallback 行为固定。
- 命令预览的 fingerprint 对所有执行相关字段敏感，对纯 UI 字段不敏感。
- secret-like env 在预览和日志中遮盖。

### 主进程与 IPC 测试

- 非主窗口、子 frame 和已销毁窗口不能调用 preview/start。
- preload 只暴露固定方法，不能指定 IPC channel。
- renderer 提交伪造类型、超大数组或未来 schema version 时主进程拒绝。
- 自定义 executable 改变后旧批准 fingerprint 失效。
- `startEdge` 必须重新 resolve，不能直接执行 renderer 提交的 preview spec。

### 真机/CI 进程测试

- Ubuntu 与 Windows CI 各用 `process.execPath` 启动一个 fixture，fixture 把实际 `argv`、cwd 和选定 env 写到临时文件，断言含空格/引号/尾反斜杠时真实子进程收到的值一致。仅在 Linux 上把 `platform` 参数伪装成 `win32` 不能证明 Windows quoting 正确。
- Windows 验证带空格的 `.exe` 绝对路径可启动、`windowsHide` 生效、停止时 `taskkill.exe /t /f` 回收子进程树。
- Linux/macOS 验证 detached process group 的停止与意外退出清理。
- 自定义端口同时驱动 argv/env、端口预检、health URL、模板目录 URL 和设备目录 URL。
- 自定义进程能启动但不提供 health、只提供 health 却没有领域设备动作、就绪前退出三种错误必须可区分。

### UI 测试

- managed/custom 切换、从推荐命令开始编辑、恢复默认值。
- 参数一行一项，不按空格错误拆分；空参数可见且可访问。
- Windows profile 与当前平台提示、脚本扩展名错误、受保护 env 错误。
- 主进程解析预览、敏感值遮盖、批准对话框前后的启动状态。
- localStorage v1/v2/v3 迁移、损坏配置恢复和未来版本失败关闭。

## 推荐实施顺序

1. 先增加 v3 共享类型、主进程 schema parser 和迁移测试，默认仍全部走 `managed`。
2. 抽出 platform-aware template resolver，让 managed 与 custom 最终都产生现有 `LocalRuntimeSpawnSpec`。
3. 增加 `previewEdgeLaunch` IPC、主 frame sender 校验、主进程二次校验和 redacted preview。
4. 增加 renderer 结构化编辑器和迁移 UI，不引入 shell 文本执行。
5. 增加自定义 executable 原生确认/fingerprint；如果此步延期，首版锁定 `${UNILAB_EXECUTABLE}`。
6. 补齐 Windows CI 真进程测试，再开放 Windows 产品入口。
7. 最后用真实 Uni-Lab-SZLab 领域设备包与 Uni-Lab-OS 验证 health、模板目录、领域设备动作、日志和停止回收；截图只能证明 UI/就绪状态，不能替代 argv 与 Windows CI 测试。

## 不建议纳入首版

- 任意 shell 字符串、管道、重定向、`&&`、命令替换。
- 自动运行 `.cmd`、`.bat` 或 `.ps1`。
- 根据用户输入文本猜测当前 shell 或自动在 cmd/PowerShell/POSIX shell 间切换。
- 从命令字符串反向解析端口、工作目录或环境变量。
- 将执行批准保存在 renderer `localStorage`。
- 把完整 env 或潜在秘密写入启动日志、Trace 或截图。

如果后续明确需要 shell 组合能力，应作为新的高风险、平台特定功能单独设计，而不是放宽本合同的 `native + shell:false` 不变量。
