# 使用本地 Agent 开发设备卡片

Uni-Lab Electron 可以把设备合同、Vue/React/Web Component 模板、固定
Builder 和结构化诊断提供给本机 Coding Agent。用户不需要安装 Node.js、npm、
pnpm、Vite 或 `@unilab/device-card-tooling`。

## 准备

1. 启动 Uni-Lab Electron 并登录。
2. 连接 Uni-Lab OS，确认“设备卡片”页面能看到带真实 Device ID 的设备。
3. 在 Agent 状态区域启用 Agent Bridge。
4. 点击“安装 Agent CLI 到 PATH”。如果页面提示目录不在 PATH，按提示把
   `~/.local/bin`（Windows 为显示的 Uni-Lab bin 目录）加入终端 PATH。

验证：

```bash
unilab-card-agent devices list --json
```

CLI 只能连接同一系统用户、同一台电脑上正在运行的 Electron。Bridge token
保存在 Electron 用户目录，不进入设备包、终端输出或日志。

## 从 Electron 创建项目

1. 在“设备卡片”选择设备实例和 Vue、React 或 Web Component Lite。
2. 点击“为 Agent 准备项目”。
3. 选择不存在或为空的目标目录，例如
   `device-package/frontend/cards/robot-card`。
4. 创建完成后点击“复制 Agent 命令”，或在文件管理器中打开项目。

项目包含：

```text
robot-card/
├── AGENTS.md
├── CARD_SPEC.md
├── README.md
├── authoring-context.json
├── card.manifest.json
├── mock.json
├── src/
└── .unilab-card/
    ├── sdk.d.ts
    ├── ui-elements.d.ts
    ├── framework.d.ts
    └── diagnostics.json
```

Agent 修改源码后，Electron 自动创建受限快照、调用固定 Builder 并刷新隔离
预览。Agent 应持续读取 `.unilab-card/diagnostics.json`，直到状态为 `ready`。

## 让 Agent 一条龙创建

也可以把以下目标直接交给 Agent：

> 查询设备 `robot-01`，在 `frontend/cards/robot-card` 创建 Vue 设备卡片，
> 持续读取 Electron 诊断并修复到 ready；不要安装卡片或调用真实设备 Action。

Agent 使用：

```bash
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

首次创建或接入目录时，Electron 会显示授权确认。Agent 无法绕过该确认。

## 常用命令

```bash
# 导出完整 Authoring Kit
unilab-card-agent kit export --device-id robot-01 --profile vue \
  --out ./robot-kit.zip --json

# 接入已有项目
unilab-card-agent workspace attach --device-id robot-01 \
  --project ./frontend/cards/robot-card --json

# 强制重新检查
unilab-card-agent workspace recheck \
  --project ./frontend/cards/robot-card --json

# 导出检查通过的源码快照
unilab-card-agent workspace export \
  --project ./frontend/cards/robot-card --out ./robot-card.ulcard --json

# 请求安装；Electron 必须再次由用户确认
unilab-card-agent workspace install \
  --project ./frontend/cards/robot-card --json

# 关闭工作区并撤销本次会话的目录能力
unilab-card-agent workspace detach \
  --project ./frontend/cards/robot-card --json
```

V1 同时只允许一个活动工作区。需要替换时使用 `--replace`，Electron 会在关闭
旧工作区前显示新目录和被替换目录；拒绝授权不会关闭旧工作区。

## 安全与安装语义

- CLI 没有 Builder、npm 安装、任意文件读取、通用 Electron IPC 或真实设备
  Action 能力。
- Preview 继续运行在禁止 Node 和网络的隔离 `WebContentsView` 中。
- `ready` 只代表开发检查通过。安装时 Electron 会重新创建源码快照并执行独立
  生产构建。
- 安装、替换和 Live Runtime 都不能由 Agent 静默完成。
- 关闭 Electron 或停用 Bridge 后 token 立即失效。

## 常见错误

| 错误码 | 处理 |
|---|---|
| `ELECTRON_NOT_RUNNING` | 启动 Electron，或使用 `--launch-electron` |
| `OS_UNAVAILABLE` | 登录并检查当前 Backend/OS 连接 |
| `DEVICE_NOT_FOUND` | 重新运行 `devices list`，使用真实 Device ID |
| `DIRECTORY_NOT_EMPTY` | 选择新的空目录，不能覆盖已有文件 |
| `WORKSPACE_ACTIVE` | 关闭当前工作区，或显式使用 `--replace` |
| `BUILD_FAILED` | 读取 `.unilab-card/diagnostics.json` 并修复源码 |
| `AUTHORIZATION_DENIED` | 用户需要在 Electron 中重新批准目录 |

协议、权限和实现细节见
[Agent 自动创作桥功能设计](architecture/device-card-agent-authoring-bridge.md)。
