# 设备卡片 Agent 自动创作桥功能设计

状态：Implemented（V1）
日期：2026-08-03
适用范围：`uni-lab-fe`、Uni-Lab Electron、Uni-Lab OS、设备包仓库、本地 Coding Agent
关联文档：[`device-card-vibe-coding.md`](./device-card-vibe-coding.md)

## 0. 决策摘要

本功能允许用户或本地 Coding Agent 自动获取设备卡片 Authoring Kit、创建卡片源码目录、接入 Electron 本地开发工作区，并持续读取固定 Builder 的结构化诊断。

采用以下方案：

```text
Coding Agent
  → 随 Electron 分发的薄 CLI（V1）/ MCP Adapter（后续）
  → Electron Local Authoring Bridge
  → Device Card Authoring Automation Module
      ├── OS Device Catalog / Authoring Context
      ├── Authoring Kit / Source Project Generator
      ├── Local Card Workspace
      └── Electron 固定 Builder
```

关键约束：

- CLI 不携带第二套 Builder，也不从 npm Registry 安装私有 Tooling。
- Vue、React、SDK、UI Catalog 和 Builder 版本随 Electron 固定发布。
- 用户不需要安装 Node.js、npm、pnpm、Vue CLI、React CLI 或 Vite。
- Vibe Coding 发生在用户自己的编辑器和源码目录中，不发生在 Electron 内。
- Agent、Electron 和源码目录在 V1 中必须位于同一台电脑。
- 查询、生成项目、Mock 构建和读取诊断可以自动执行。
- 安装、替换已安装卡片和进入 Live Runtime 必须由用户确认。
- 卡片运行时仍使用隔离 `WebContentsView`，本功能不改变卡片安全模型。

### 0.1 V1 实现落点

| 能力 | 实现 |
|---|---|
| Agent Protocol | `packages/device-card-sdk/src/agentProtocol.ts` |
| 共享 Context | `packages/device-card-authoring-kit/src/context.ts` |
| Authoring Automation Module | `packages/device-card-host/src/authoringAutomation.ts` |
| Local Bridge | `apps/desktop/src/main/deviceCardAgentBridge.ts` |
| 目录与安装确认 | `apps/desktop/src/main/deviceCardAgentPermissions.ts` |
| Renderer Target Adapter | `DeviceCardAuthoringTargetConnector.tsx` |
| 薄 CLI | `packages/device-card-agent-cli` |
| CLI 安装器 | `apps/desktop/src/main/deviceCardAgentCli.ts` |
| 用户入口 | `DeviceCardWorkbench.tsx` |

V1 的目录授权与活动工作区会话绑定。关闭工作区即撤销 Agent 对该项目的
Bridge 操作能力，不保留永久目录授权。此策略比持久化授权更严格。

## 1. 背景与问题

当前纵向切片已经具备：

- 根据 Device Catalog 创建 Authoring Context。
- 导出完整 Authoring Kit ZIP。
- 生成 Vue、React 和原生 Web Component 源码项目。
- 在 Electron 中授权一个本地源码目录。
- 使用 Electron 固定 Builder 自动检查、构建和刷新 Mock 预览。
- 原子写入 `.unilab-card/diagnostics.json`。
- 从新源码快照执行生产模式权威构建并安装 Artifact。

但上述能力目前主要通过 Electron Renderer 的按钮和文件选择器调用。外部 Coding Agent 无法稳定地：

1. 查询当前可创作设备及其真实 `deviceId`。
2. 获取设备 Action、状态和参数 Schema。
3. 自动生成 Authoring Kit 或可直接编辑的源码目录。
4. 请求 Electron 接管指定源码目录。
5. 以机器可读方式等待 Builder 检查结果。
6. 在不复制 Builder 的前提下完成一条龙创作循环。

如果直接把现有 `@unilab/device-card-tooling` 作为用户依赖，会重新引入 Registry、版本漂移和本地 Builder 不可信的问题。因此需要一个由 Electron 分发、只调用 Electron 能力的 Agent 入口。

## 2. 产品目标

### 2.1 目标

- 用户能从 Electron UI 一键创建可交给 Agent 的卡片源码目录。
- Agent 能通过 CLI 查询设备、创建项目、接入工作区和读取诊断。
- Agent 能在一次命令后获得源码目录、上下文文件和诊断文件的绝对路径。
- 默认工作流完全不依赖 npm Registry。
- Uni-Lab OS 是设备能力的唯一权威；Electron Authoring Automation Module 是
  Authoring Context 生成与分发、Builder、工作区状态和安装动作的唯一实现。
- CLI 输出稳定、版本化的 JSON，适合 Codex、Claude Code、Cursor 等工具使用。
- 同一个底层 Interface 可以被 Renderer IPC、CLI 和未来 MCP Adapter 复用。
- 用户可明确知道哪些动作自动执行，哪些动作需要确认。
- Electron 未运行、OS 未连接、设备缺少 ID、目录未授权等情况都有确定错误码。

### 2.2 非目标

- 不在 Electron 中实现 AI 对话或源码编辑器。
- 不允许 Agent 自动调用真实设备 Action。
- 不允许 CLI 绕过 Electron 安装任意 Bundle。
- 不允许 CLI 自行下载 Vue、React、SDK 或 Builder。
- 不把未鉴权的 HTTP 服务暴露在 `localhost` 端口。
- 不支持 V1 远程 Agent 连接另一台电脑上的 Electron。
- 不在 V1 提供正式签名、Catalog、市场发布或自动 Git push。
- 不执行用户源码中的 `package.json` scripts。

## 3. 用户与使用场景

### 3.1 普通实验用户

希望上传设备包后，通过 Electron 选择设备和开发框架，生成一个可以交给 Agent 的项目，不关心 Node、Vite 或打包工具。

### 3.2 设备包开发者

希望将卡片源码放入设备包 Git 仓库的 `frontend/cards/` 目录，使用本地 Agent 反复修改并在 Electron 中自动预览。

### 3.3 Coding Agent

需要稳定、机器可读的设备上下文、项目路径和诊断结果；不能获得 Electron、OS token、任意文件系统或真实设备控制权限。

### 3.4 CI 维护者

继续使用现有 standalone Tooling 做一致性检查。CI 不是本地 Agent Bridge 的主要调用者，也不依赖正在运行的 Electron。

## 4. 用户环境要求

### 4.1 必需环境

| 项目 | 要求 |
|---|---|
| Uni-Lab Electron | 安装支持 Agent Bridge 的版本 |
| Uni-Lab OS | Electron 已连接；创建设备项目时必须可访问 Device Catalog |
| 设备包 | 已安装，且 OS 能返回稳定的 Device Type、Device ID、Action 和 Schema |
| 源码目录 | 当前系统用户可写，建议位于设备包 Git 仓库中 |
| Coding Agent | 能执行本地命令并读写项目文件 |
| 运行位置 | Agent、Electron、CLI 和源码目录位于同一台电脑 |

### 4.2 不需要的环境

- Node.js
- npm 或 pnpm
- 私有 npm Registry
- `@unilab/device-card-tooling`
- Vue CLI、Create React App 或 Vite
- Docker
- 独立预览 Web Server

Git 是推荐项，但不是功能依赖。Coding Agent 本身是否需要互联网取决于 Agent 产品；卡片 Builder 和卡片运行时不需要访问 npm Registry，卡片运行时禁止联网。

### 4.3 设备目录前置条件

每个可创作设备至少需要：

```ts
interface DeviceCardAuthoringTarget {
  deviceId: string
  deviceTypeId: string
  title: string
  online: boolean
  actions: DeviceCardAuthoringAction[]
}
```

要求：

- `deviceId` 必须非空且在当前 OS 会话中唯一。
- `deviceTypeId` 必须稳定，不能长期使用实例 ID 代替设备类型。
- Action 必须具有稳定名称和输入、输出 Schema。
- 状态 Schema 缺失时可生成 `partial` Context，但必须标记字段来源和未解析状态。
- Device Catalog 不满足最低要求时，CLI 返回结构化错误，不生成伪造项目。

## 5. 用户体验

### 5.1 Electron UI 优先流程

```text
用户安装设备包
→ Electron 获取 Device Catalog
→ 用户选择“本地 · robot-01 · 在线”
→ 用户选择 Vue / React / Web Component Lite
→ 点击“为 Agent 准备项目”
→ 选择本地目标目录并确认授权
→ Electron 创建源码项目并接入工作区
→ Electron 显示项目路径、诊断路径和可复制 Agent 命令
→ 用户在该目录启动 Coding Agent
→ Agent 编写源码并读取 diagnostics.json
→ Electron 自动刷新隔离 Mock 预览
→ 用户确认安装当前源码或导出 .ulcard
```

Electron UI 成功页至少显示：

- 设备名称、`deviceId` 和 `deviceTypeId`
- 创作 Profile
- 项目绝对路径
- `authoring-context.json` 路径
- `.unilab-card/diagnostics.json` 路径
- 当前工作区状态
- “复制 Agent 命令”按钮
- “在文件管理器中打开”按钮
- “关闭工作区”按钮

### 5.2 Agent 一条龙流程

用户可直接要求 Agent：

> 为 `robot-01` 创建一个 Vue 设备卡片并持续修复到检查通过。

Agent 执行：

```bash
unilab-card-agent devices list --json

unilab-card-agent authoring bootstrap \
  --device-id robot-01 \
  --profile vue \
  --dir ./frontend/cards/robot-card \
  --json

unilab-card-agent workspace status \
  --project ./frontend/cards/robot-card \
  --wait \
  --timeout 120 \
  --json
```

首次目录接入时 Electron 弹出授权确认。用户允许后，Agent 获得项目和诊断路径，但不获得 Electron token、OS 凭据或任意目录访问能力。

### 5.3 Electron 未运行

默认行为：

```json
{
  "ok": false,
  "error": {
    "code": "ELECTRON_NOT_RUNNING",
    "message": "Uni-Lab Electron 未运行。"
  }
}
```

用户可显式使用：

```bash
unilab-card-agent authoring bootstrap ... --launch-electron
```

CLI 可以启动 Electron，但不能静默绕过登录、目录授权或安装确认。

### 5.4 不同电脑上的 Agent

V1 不建立远程 Bridge。跨电脑流程保持为：

```text
Electron 导出 Authoring Kit
→ 用户传到开发电脑
→ Agent 编写源码
→ Agent/用户生成 .ulcard 源码包
→ 用户回到 Electron 导入
→ Electron 权威重构建
```

## 6. 功能需求

| 编号 | 功能 | V1 |
|---|---|---|
| F1 | CLI 查询可创作设备和上下文可用性 | 必须 |
| F2 | CLI 导出完整 Authoring Kit | 必须 |
| F3 | CLI 直接生成可编辑源码目录 | 必须 |
| F4 | 一条命令生成项目并接入 Electron 工作区 | 必须 |
| F5 | 返回项目、上下文和诊断的绝对路径 | 必须 |
| F6 | 查询、等待和强制重新检查工作区 | 必须 |
| F7 | Electron 自动刷新 Mock Preview | 复用现有能力 |
| F8 | 请求导出检查通过的 `.ulcard` | 必须 |
| F9 | 请求安装当前源码并由用户确认 | 必须 |
| F10 | MCP Adapter | 后续 |
| F11 | 多工作区并发 | 后续；V1 单活动工作区 |
| F12 | 远程 Agent Bridge | 非目标 |

## 7. CLI Interface

CLI 命名：`unilab-card-agent`。它随 Electron 安装包分发，不通过 npm Registry 安装。

### 7.1 通用约定

- `--json` 时 stdout 只能输出一个版本化 JSON 文档。
- 人类日志、进度和调试信息写入 stderr。
- 所有返回路径必须是绝对路径。
- JSON 字段使用 camelCase。
- 时间使用 ISO 8601 UTC 字符串。
- 未识别参数返回非零退出码，不进行部分执行。
- 目录已存在且非空时默认拒绝覆盖。
- 任何需要用户确认的命令都返回 `approvalId` 和确认状态。

### 7.2 查询设备

```bash
unilab-card-agent devices list --json
```

示例输出：

```json
{
  "schemaVersion": "device-card-agent-result/v1",
  "ok": true,
  "devices": [
    {
      "deviceId": "robot-01",
      "deviceTypeId": "robot-arm",
      "title": "本地机械臂",
      "online": true,
      "actionCount": 8,
      "contextAvailability": "partial"
    }
  ]
}
```

`contextAvailability`：

- `ready`：Device Type、Action 和状态 Schema 完整。
- `partial`：允许 Mock 创作，但含 unresolved 状态字段。
- `blocked`：缺少 Device ID、Device Type 或必要契约，不能生成项目。

### 7.3 导出 Authoring Kit

```bash
unilab-card-agent kit export \
  --device-id robot-01 \
  --profile vue \
  --out ./robot-authoring-kit.zip \
  --json
```

成功返回 ZIP 绝对路径、内容摘要、Context digest 和版本信息。

### 7.4 创建并接入项目

```bash
unilab-card-agent authoring bootstrap \
  --device-id robot-01 \
  --profile vue \
  --dir ./frontend/cards/robot-card \
  --json
```

语义：

1. 从当前 OS 目录解析目标设备。
2. 生成权威 Authoring Context。
3. 在空目录中物化完整源码项目。
4. 请求用户授权该目录。
5. 接入 Electron Local Card Workspace。
6. 创建受限源码快照并调用固定 Builder。
7. 等待首轮状态变为 `ready` 或 `error`。
8. 返回所有 Agent 所需路径。

示例输出：

```json
{
  "schemaVersion": "device-card-agent-result/v1",
  "ok": true,
  "session": {
    "sessionId": "card-session-01J...",
    "deviceId": "robot-01",
    "deviceTypeId": "robot-arm",
    "profile": "vue-web-component-v1",
    "projectDir": "/abs/device-package/frontend/cards/robot-card",
    "contextPath": "/abs/device-package/frontend/cards/robot-card/authoring-context.json",
    "manifestPath": "/abs/device-package/frontend/cards/robot-card/card.manifest.json",
    "diagnosticsPath": "/abs/device-package/frontend/cards/robot-card/.unilab-card/diagnostics.json",
    "state": "ready",
    "revision": 2,
    "previewMode": "mock"
  }
}
```

### 7.5 接入已有项目

```bash
unilab-card-agent workspace attach \
  --project ./frontend/cards/robot-card \
  --device-id robot-01 \
  --json
```

Electron 必须重新从 OS 生成 Authoring Context。项目内旧 Context 只能用于差异提示，不能覆盖当前 OS 权威。

V1 同时只能有一个活动工作区。如果已有不同工作区，默认返回 `WORKSPACE_ACTIVE`，不能静默关闭。用户显式确认后才能使用 `--replace`。

### 7.6 查询和等待状态

```bash
unilab-card-agent workspace status \
  --project ./frontend/cards/robot-card \
  --json

unilab-card-agent workspace status \
  --project ./frontend/cards/robot-card \
  --wait \
  --after-revision 12 \
  --timeout 120 \
  --json
```

状态为 `error` 表示请求成功但源码检查失败，因此普通 `status` 仍返回退出码 0。Agent 必须读取 `diagnostics`。只有使用 `--require-ready` 时，`error` 才返回构建失败退出码。

### 7.7 强制重新检查

```bash
unilab-card-agent workspace recheck \
  --project ./frontend/cards/robot-card \
  --json
```

### 7.8 导出源码包

```bash
unilab-card-agent workspace export \
  --project ./frontend/cards/robot-card \
  --out ./robot-card.ulcard \
  --json
```

只有当前源码状态为 `ready` 才允许导出。导出的必须是检查通过的源码快照，不是用户提供的 `dist`。

### 7.9 请求安装

```bash
unilab-card-agent workspace install \
  --project ./frontend/cards/robot-card \
  --json
```

CLI 只能创建安装请求。Electron 显示设备、Card ID、版本、权限和源码摘要，用户确认后才执行新的生产源码快照和权威构建。CLI 等待确认结果或在超时后返回 `APPROVAL_TIMEOUT`。

### 7.10 关闭工作区

```bash
unilab-card-agent workspace detach \
  --project ./frontend/cards/robot-card \
  --json
```

关闭后 Electron 停止目录轮询，清理临时开发 Artifact，但不删除用户源码。

## 8. 深模块与 Interface

### 8.1 Authoring Automation Module

所有业务行为放入一个深模块。Renderer、CLI 和 MCP 只通过同一个 Interface 调用：

```ts
interface DeviceCardAuthoringAutomation {
  listTargets(): Promise<DeviceCardAuthoringTargetSummary[]>

  prepare(
    input: PrepareDeviceCardAuthoringInput
  ): Promise<DeviceCardAuthoringSession>

  getStatus(
    sessionId: string
  ): Promise<DeviceCardWorkspaceStatus>

  exportKit(
    input: ExportDeviceCardKitInput
  ): Promise<ExportedDeviceCardKit>

  exportSource(
    sessionId: string,
    destination: string
  ): Promise<ExportedDeviceCardSource>

  requestInstall(
    sessionId: string
  ): Promise<DeviceCardInstallApproval>

  close(sessionId: string): Promise<void>
}
```

Interface 不暴露：

- Builder 路径或版本选择。
- npm dependency 安装。
- Electron WebContents ID。
- OS 地址或 token。
- 任意文件读写。
- 真实设备 Action。
- Artifact Store 的内部目录。

目录轮询、快照限制、Builder、最后有效预览、诊断原子写入、生产重构建和临时目录清理都隐藏在模块实现中。

### 8.2 Adapter

| Adapter | 调用方 | 职责 |
|---|---|---|
| Renderer IPC Adapter | Electron `kernel-web` | UI、选择器、确认弹窗 |
| Local Bridge Adapter | 本机 CLI | 鉴权、协议版本、请求转发 |
| CLI Adapter | Coding Agent/终端用户 | 参数解析、JSON 输出、退出码 |
| MCP Adapter | 支持 MCP 的 Agent | 后续提供工具发现；复用同一 Interface |
| In-memory Adapter | 测试 | 目录、授权和状态机测试 |

CLI 不重复 Authoring Context、Kit、Builder 或工作区实现。

## 9. 模块落点

### 9.1 复用现有模块

| 能力 | 当前落点 |
|---|---|
| Authoring Kit ZIP | `packages/device-card-authoring-kit/src/kit.ts` |
| Source Project | `packages/device-card-authoring-kit/src/project.ts` |
| 固定 Builder | `packages/device-card-builder` |
| Local Workspace | `packages/device-card-host/src/workspace.ts` |
| 安装和 Artifact Store | `packages/device-card-host/src/index.ts` |
| Electron View/IPC | `apps/desktop/src/main/deviceCardManager.ts` |
| 当前 Context Adapter | `apps/kernel-web/src/data/authoringContext.ts` |

### 9.2 建议新增或调整

```text
packages/device-card-sdk/
└── src/agentProtocol.ts

packages/device-card-authoring-kit/
└── src/context.ts

packages/device-card-host/
└── src/authoringAutomation.ts

packages/device-card-agent-cli/
└── src/main.ts

apps/desktop/src/main/
├── deviceCardAgentBridge.ts
└── deviceCardAgentPermissions.ts
```

调整原则：

- 将 Authoring Context 的纯生成逻辑从 Renderer 下沉到共享模块。
- 共享逻辑接受中立的 Authoring Target，不让 Authoring Kit 依赖 `@unilab/services`。
- OS HTTP/WebSocket 仍通过 Adapter 接入，不把 transport 类型泄漏到 Authoring Interface。
- CLI 以可执行文件形式随 Electron 打包，不发布成用户必须从 npm 安装的私有包。
- 现有 `device-card-tooling` 保持 monorepo/CI 定位，不作为默认 Agent Bridge。

## 10. 本地 Bridge

### 10.1 传输

V1 使用本机用户级 IPC：

| 平台 | 传输 |
|---|---|
| Linux | Unix Domain Socket，优先位于用户 runtime 目录 |
| macOS | Unix Domain Socket，位于当前用户应用支持目录 |
| Windows | 当前用户 SID 作用域的 Named Pipe |

不监听 `0.0.0.0`，不开放固定 TCP 端口，不使用无鉴权的 localhost HTTP。

### 10.2 握手

每次连接必须交换：

```ts
interface DeviceCardAgentHandshake {
  protocolVersion: 1
  clientVersion: string
  clientPid: number
  nonce: string
  capabilityToken: string
}
```

要求：

- Socket/Pipe 只允许当前系统用户访问。
- Electron 生成短期 capability token，token 文件权限仅当前用户可读。
- token 不写入项目、不输出到 CLI JSON、不进入日志。
- token 绑定用户、Electron 会话和协议版本。
- Electron 退出时 token 立即失效。
- 协议版本不兼容时返回 `PROTOCOL_MISMATCH`。

### 10.3 请求格式

Bridge 使用长度前缀 JSON 消息或 JSON-RPC 2.0。消息必须有 `requestId`、方法名和版本化参数，不依赖命令行文本解析。

建议方法：

```text
authoring.targets.list
authoring.session.prepare
authoring.session.attach
authoring.session.get
authoring.session.recheck
authoring.session.export
authoring.session.install.request
authoring.session.close
authoring.kit.export
```

## 11. 权限模型

| 操作 | 自动执行 | 用户确认 | 说明 |
|---|---:|---:|---|
| 查询设备目录 | 是 | 否 | 只返回创作所需公开契约 |
| 导出 Kit | 是 | 首次目标目录授权 | 不包含 OS token |
| 创建新项目 | 是 | 目标目录授权 | 目录必须为空或不存在 |
| 接入已有项目 | 否 | 是 | 展示真实路径和设备目标 |
| 自动检查和 Mock Preview | 是 | 否 | 仅使用隔离 Runtime |
| 导出 `.ulcard` | 是 | 目标文件授权 | 仅允许 ready 快照 |
| 安装卡片 | 否 | 每次确认 | 执行新的生产构建 |
| 替换已安装版本 | 否 | 每次确认 | 展示权限差异 |
| 进入 Live Runtime | 否 | 是 | 绑定明确设备实例 |
| 调用真实设备 Action | 不属于本功能 | 不允许 Agent Bridge | 继续走受控 Card Host |

Agent Bridge 永远不能成为通用 Electron IPC 代理。

## 12. 源码目录规则

- 用户源码目录是可编辑源码的唯一长期权威。
- 新建项目时目标目录必须不存在或为空。
- 不覆盖已有文件；未来如支持更新模板，必须逐文件显示差异。
- 用户明确批准向空目录或不存在的目录执行 `bootstrap` 时，Electron 可以写入
  首次生成的项目文件。
- 项目创建或接入完成后，Electron 仅允许写入
  `.unilab-card/diagnostics.json` 及其原子临时文件。
- Builder 每次从允许文件创建不可变快照，不直接信任变化中的目录。
- 忽略 `.git`、`.unilab-card` 和 `node_modules` 的变化。
- 拒绝 symlink、路径穿越、未知扩展名、超限文件数和超限体积。
- 不读取源码目录之外的相对路径。
- 关闭工作区不删除源码目录。
- CLI JSON 可以返回路径，但日志和遥测不得上传绝对路径。

推荐目录：

```text
device-package/
├── driver/
├── registry/
└── frontend/
    └── cards/
        └── robot-card/
            ├── AGENTS.md
            ├── CARD_SPEC.md
            ├── README.md
            ├── card.manifest.json
            ├── authoring-context.json
            ├── mock.json
            ├── src/
            └── .unilab-card/
                ├── sdk.d.ts
                ├── ui-elements.d.ts
                ├── framework.d.ts
                └── diagnostics.json
```

## 13. 工作区状态模型

```text
preparing
  → awaiting_authorization
  → building
  → ready
  → error
  → building
  → ready
  → awaiting_install_approval
  → installed
  → closed
```

规则：

- `error` 可以保留最后一次成功的 Mock Artifact，但当前源码不能安装或导出。
- `building` 期间保留最后有效预览。
- 每次状态变化增加单调递增的 `revision`。
- CLI 的 `--wait --after-revision N` 等待大于 N 的稳定状态。
- `ready` 只表示开发检查通过；安装仍必须创建新快照并执行生产模式构建。
- Electron 重启后 V1 不自动恢复工作区，用户或 Agent 需要重新 attach。

## 14. 错误协议

统一错误结构：

```json
{
  "schemaVersion": "device-card-agent-result/v1",
  "ok": false,
  "error": {
    "code": "DEVICE_ID_MISSING",
    "message": "目标设备缺少稳定 Device ID。",
    "retryable": false,
    "details": {}
  }
}
```

最低错误码：

| 错误码 | 含义 | 可重试 |
|---|---|---:|
| `INVALID_ARGUMENT` | CLI 参数无效 | 否 |
| `ELECTRON_NOT_RUNNING` | Electron 未运行 | 是 |
| `PROTOCOL_MISMATCH` | CLI 与 Electron 协议不兼容 | 否 |
| `AUTHENTICATION_FAILED` | 本地 Bridge 握手失败 | 是 |
| `AUTHORIZATION_DENIED` | 用户拒绝目录或操作授权 | 否 |
| `OS_UNAVAILABLE` | Electron 无法连接 OS | 是 |
| `DEVICE_NOT_FOUND` | Device Catalog 中不存在目标设备 | 是 |
| `DEVICE_ID_MISSING` | 设备缺少稳定 ID | 否 |
| `DEVICE_TYPE_UNRESOLVED` | 缺少稳定 Device Type | 否 |
| `DIRECTORY_NOT_EMPTY` | bootstrap 目标目录非空 | 否 |
| `DIRECTORY_OUTSIDE_GRANT` | 请求路径不在授权根目录 | 否 |
| `WORKSPACE_ACTIVE` | 已存在另一个活动工作区 | 否 |
| `WORKSPACE_NOT_FOUND` | 会话或项目未接入 | 是 |
| `BUILD_FAILED` | Builder 检查失败 | 是 |
| `CURRENT_SOURCE_NOT_READY` | 当前源码不能导出或安装 | 是 |
| `APPROVAL_TIMEOUT` | 用户未在规定时间确认 | 是 |
| `INTERNAL_ERROR` | 未分类内部错误 | 视情况 |

建议退出码：

| 退出码 | 类别 |
|---:|---|
| 0 | 请求成功；状态可能为 ready 或 error |
| 2 | 参数或用法错误 |
| 3 | Electron/Bridge 不可用 |
| 4 | 鉴权或授权失败 |
| 5 | OS 或设备目标不可用 |
| 6 | `--require-ready` 条件下构建未通过 |
| 7 | 用户确认超时或拒绝 |
| 10 | 内部错误 |

## 15. MCP Adapter（后续）

CLI 是 V1 的通用入口，因为所有主流 Agent 都能调用本地命令。MCP 作为后续 Adapter，复用同一个 Local Bridge 和 Authoring Interface。

建议工具：

```text
unilab_card_list_devices
unilab_card_prepare_project
unilab_card_get_workspace_status
unilab_card_wait_for_workspace
unilab_card_export_source
unilab_card_request_install
```

不提供：

- 任意 shell 执行。
- 任意文件读取。
- OS token 获取。
- Electron IPC 透传。
- 真实设备 Action 调用。

## 16. Electron UI 调整

设备卡片工作台增加：

- “为 Agent 准备项目”主操作。
- “导出 Authoring Kit”保留为跨电脑和手动流程。
- CLI 安装状态：未安装、已安装、版本不兼容。
- “安装 Agent CLI 到 PATH”操作。
- 当前 Bridge 状态和协议版本。
- 项目创建成功页及“复制 Agent 命令”。
- 外部 Agent 请求目录授权弹窗。
- 安装请求确认弹窗。
- 活动工作区冲突提示，不静默替换。

设备卡片工作台的 Agent 状态区域提供：

- 启用/停用 Agent Bridge。
- 安装/移除 CLI PATH 入口。
- 查看当前已授权项目目录。
- 通过关闭工作区撤销会话级目录授权。
- 查看最近 Agent 请求记录，不记录源码内容。

## 17. 打包与升级

- CLI bundle 随 Electron 版本构建并进入应用资源；Electron 生成平台 launcher，
  使用自身 Node 运行时执行 CLI，不依赖全局 Node。
- CLI 与 Electron 使用独立的 `protocolVersion` 协商兼容性。
- Electron Builder、SDK 和 UI Catalog 版本不由 CLI 决定。
- electron-builder 将 CLI bundle 加入应用资源，并提供用户触发的 PATH launcher
  安装。
- 升级 Electron 时同步升级 CLI；旧 CLI 遇到协议不兼容必须明确失败。
- 卸载 Electron 时提供移除 PATH 入口的清理步骤。
- V1 不允许自动从网络下载新的 CLI 或 Builder。

## 18. 测试策略

### 18.1 Authoring Automation Module

- 完整 Device Target 生成稳定 Context。
- 缺少 Device ID 或 Device Type 时阻止 bootstrap。
- `partial` Context 保留 unresolved 字段和来源。
- 新项目不覆盖非空目录。
- 返回路径全部为绝对路径。
- 工作区失败时保留最后有效预览但阻止安装和导出。

### 18.2 Local Bridge

- 不同系统用户不能连接 Socket/Pipe。
- 错误 token、过期 token 和旧协议版本被拒绝。
- Electron 退出后已有 token 失效。
- 请求体大小、并发数和速率有限制。
- 不存在任意方法调用或任意路径读取。

### 18.3 CLI

- 在未安装 Node.js 的干净机器上可运行。
- `--json` stdout 可被严格 JSON Parser 读取。
- stderr 不污染 JSON 输出。
- Electron 未运行、OS 离线、设备不存在、目录拒绝都有稳定错误码。
- `status --wait` 能按 revision 等待并正确超时。
- 非空目录默认不被修改。

### 18.4 Electron E2E

- UI 创建项目后，Agent 能读取生成目录。
- Agent 保存源码后 Electron 自动构建和预览。
- 非法 `fetch`、动态 import、symlink 和路径穿越产生结构化诊断。
- Agent 请求安装时必须出现 Electron 确认。
- 拒绝安装后 Artifact Store 不变化。
- 确认安装后从新源码快照执行生产构建。
- 关闭工作区后停止轮询并清理临时 Artifact。

### 18.5 打包验证

- Windows、macOS、Linux 安装包均包含对应 CLI。
- 打包后的 CLI 能连接打包后的 Electron。
- 打包后的固定 Builder 可编译 Vue、React 和 Lite Profile。
- CLI 不依赖全局 Node 或 npm。

## 19. 验收标准

### A1：零前端环境

在没有 Node、npm、pnpm、Vue CLI 和 React CLI 的新用户机器上，安装 Electron 后可以运行：

```bash
unilab-card-agent authoring bootstrap ... --json
```

并获得可编辑源码目录。

### A2：Agent 一条龙

Agent 能查询设备、创建项目、读取规则、修改代码、等待诊断，并在检查通过后通知用户确认安装。

### A3：Builder 唯一

CLI 不包含可选择的 Builder，不下载 Builder，Electron 对预览、导出和安装使用固定版本。

### A4：安全授权

Agent 只能访问用户明确授权的项目目录；不能调用任意 Electron IPC、读取 OS token 或操作真实设备。

### A5：错误闭环

源码错误写入 `diagnostics.json`，CLI 返回对应 revision；修复后自动进入 `ready` 并刷新 Mock 预览。

### A6：生产重构建

开发检查通过后，安装仍从新源码快照执行独立生产构建。失败时保留旧 Artifact。

### A7：用户最终控制

安装、替换卡片和进入 Live Runtime 均不能由 Agent 静默完成。

### A8：可追踪版本

CLI 返回 Agent 协议、Kit、SDK、Builder、Host Protocol 和 UI Catalog 版本，问题可以定位到具体组合。

## 20. 实施阶段

### Phase 1：共享 Interface

- 定义 Agent Protocol 和错误码。
- 将 Authoring Context 纯生成逻辑下沉到共享模块。
- 建立 Authoring Automation Module。
- 通过 In-memory Adapter 完成接口测试。

### Phase 2：Electron Local Bridge

- 实现 Unix Socket/Named Pipe。
- 实现 capability token、协议握手和方法白名单。
- 接入 OS Device Catalog、Kit 和 Local Workspace。
- 增加目录授权和安装确认 UI。

### Phase 3：随包 CLI

- 实现 `devices`、`kit export`、`authoring bootstrap`。
- 实现 `workspace attach/status/recheck/export/install/detach`。
- 实现稳定 JSON、退出码和 `--launch-electron`。
- 接入 electron-builder 打包和 PATH 安装。

### Phase 4：Agent 体验

- 工作台增加“为 Agent 准备项目”。
- 生成可复制的 Agent Prompt 和命令。
- 完成无 Node 环境 E2E。
- 更新设备卡片架构图和用户文档。

### Phase 5：可选 MCP

- 在 CLI 和 Bridge 稳定后增加 MCP Adapter。
- 不扩大权限，只提升工具发现和结构化调用体验。

## 21. 当前实现与后续项

截至本文日期：

V1 已具备：

- Authoring Kit 和源码项目生成。
- Vue、React、Lite 固定 Builder。
- Electron 本地源码工作区。
- 目录轮询和结构化诊断。
- Mock WebContentsView Preview。
- 安装时权威重构建和 Artifact Store。
- 外部 Agent 可调用的本地 Bridge。
- 随 Electron 分发的薄 CLI。
- Agent Protocol 和稳定错误码。
- CLI PATH 安装与版本协商。
- 外部目录授权与 Agent 安装确认 UI。
- Bridge 启停、当前授权目录和最近请求展示。
- CLI 与 Bridge 的真实 Socket 集成测试。
- Linux unpacked 安装目录和 Electron 内置 Node 运行 CLI 的打包验证。

后续项：

- MCP Adapter。
- 多活动工作区。
- 远程 Agent Bridge。
- Windows、macOS 安装包的发布 CI 与签名验证。
- 如产品未来需要跨重启授权，再单独设计持久化 grant 与撤销记录；V1 不保存。

本文同时作为 V1 实现说明和开发验收依据。Phase 5 MCP 及上述后续项不属于
当前 V1 已实现范围。
