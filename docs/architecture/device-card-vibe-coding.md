# 设备包驱动的本地 Vibe Coding 卡片设计

状态：Proposed；V1 纵向切片已在前端分支实现
日期：2026-07-31
适用范围：`uni-lab-fe`、Uni-Lab-OS、设备包仓库、本地卡片开发工具

## 0. 结论

目标流程应当是：

```text
用户上传设备包到 Electron
→ Electron 将设备包交给 Uni-Lab-OS 安装
→ OS 登记 Device Type、Action、状态字段和参数 Schema
→ Electron 获取并导出 Card Authoring Kit
→ 用户在自己电脑上的 Cursor/Codex/VS Code 等环境中 Vibe Coding
→ 用户在 Electron 中授权本地 card-project 源码目录
→ Electron 内置 Builder 自动检查、诊断并刷新 Mock 预览
→ 用户安装当前源码，或导出 .ulcard 供其他 Electron 导入
→ Electron 从新快照重新校验并权威构建
→ 构建产物安装到本地 Artifact Store
→ WebContentsView 加载本地产物
→ 卡片通过受控能力订阅状态和调用 Action
```

Electron **不是** Vibe Coding 编辑器，也不负责 AI 生成源码。Electron 的职责是：

- 提供设备卡片开发所需的稳定上下文。
- 监视用户明确授权的源码目录并生成结构化诊断，不提供源码编辑能力。
- 接收当前源码快照或用户从其他机器带来的 `.ulcard`。
- 对源码做独立、权威的校验和重新构建。
- 安装、加载、更新和回滚卡片产物。
- 把卡片请求安全地转发到现有设备能力。

“上传代码到 Electron”不能等价为在主 renderer 中直接执行用户上传的 JS。源码
必须先进入 Import Pipeline，只有重新构建并成功安装的不可变 Artifact 才能进入
Runtime。

本设计不使用 iframe。卡片以 Web Component 为开发/交付规范，运行在 Electron
`WebContentsView` 中。WebContentsView 加载的是本机 Artifact Store 中的内容，不是
远程页面。

### 0.1 当前实现落点

本分支已经实现可运行的第一条纵向链路：

- `packages/device-card-sdk`：Manifest、Authoring Context、Host Bridge，以及
  Vue/React hooks。
- `packages/device-card-authoring-kit`：确定性 ZIP、设备绑定项目、三套框架模板、
  Agent 规则、Manifest Schema、SDK 类型、UI Catalog、Mock 和示例。
- `packages/device-card-ui`：`u-card`、`u-metric`、`u-status`、
  `u-action-button`、rack、well plate、timeseries、log console 等受控组件。
- `packages/device-card-builder`：固定 Builder、Vue SFC/React/原生 Web Component
  编译、导入白名单、危险源码检查和 `.ulcard` 归档安全限制。
- `packages/device-card-tooling`：`init/check/dev/preview/test/build/pack/inspect`。
- `packages/device-card-host`：受限源码快照、本地目录指纹轮询/诊断、开发构建、导入后
  权威重编译和不可变 Artifact Store。
- `apps/desktop`：独立 card preload、非持久 session、禁网 `WebContentsView`、
  IPC 能力白名单，以及用户授权的本地源码工作区。
- `apps/kernel-web`：设备卡片管理页、完整 Authoring Kit ZIP 导出、Artifact
  导入、本地源码目录状态/诊断/安装/导出、Preview bounds 管理，以及经
  `@unilab/services` 提交的 Action。

当前纵向切片不等于本文所有后续能力均已完成。签名、回滚 UI、媒体协议、
Feature Packs、完整 JSON Schema 表单和专用 OS Authoring Context 端点仍是后续项。

## 1. 产品目标

### 1.1 目标

- 用户可以先上传一个没有前端卡片的设备驱动包。
- OS 安装驱动后能向 Electron 提供稳定、版本化的设备能力描述。
- Electron 可以把设备能力、SDK 类型、UI 元素目录和规则导出给本地 Vibe Coding 工具。
- 用户可以在任意本地代码编辑器或 Coding Agent 中开发卡片。
- 用户只上传受约束的 Card Source Project，不上传任意 Node/Electron 项目。
- Electron 不信任用户本地的构建结论，必须使用自己的 Builder 重新构建。
- 卡片导入成功后无需重启 Electron。
- 卡片支持实时状态、Action、表单、图表和轻量实例配置。
- 新版本导入失败时保留最后一个有效版本。
- 卡片代码不进入主 React renderer。
- 卡片运行时不访问公网或任意远程 JavaScript URL。

### 1.2 V1 非目标

- 不在 Electron 内提供 AI 对话式代码生成。
- 不在 Electron 内提供完整源码编辑器。
- 不允许卡片任意安装 npm 依赖。
- 不运行用户提供的 `package.json` scripts。
- 不允许卡片提供 Electron main、preload 或 CSP。
- 不允许卡片直接访问 OS 地址、token、文件系统或 Electron IPC。
- 不允许卡片自行创建 HTTP/WebSocket 连接。
- 不允许卡片操作 Host 未绑定的其他 Device Instance。
- 不在一个滚动列表中同时运行几十个 WebContentsView。
- 不负责把用户本地 Git 仓库自动提交或推送到远程。

## 2. 角色与权威来源

### 2.1 角色

**Uni-Lab-OS**

安装设备包，登记设备类型、Action 和状态 Schema，运行设备并提供权威状态。

**Electron**

连接 OS、导出 Authoring Kit、管理用户授权的本地源码工作区、导入 Card Source、
重新构建、安装 Artifact、创建 WebContentsView，并把卡片能力连接到现有 services。

**Local Coding Environment**

用户自己的本地目录和编辑器，例如 Cursor、Codex、VS Code、Claude Code。Vibe
Coding 发生在这里，不发生在 Electron。

**Card CLI（可选）**

仅用于 Uni-Lab monorepo 开发、CI 或未来独立发行。默认用户路径由 Electron 内置
Builder 提供检查、Mock 预览和打包，不依赖 CLI 或 npm Registry。CLI 不连接真实
设备，不执行真实 Action。

**Card Source Project**

本地 Git 仓库中的可编辑源码。它是用户卡片源码的唯一长期权威。

**Imported/Workspace Source Snapshot**

Electron 从已授权目录或 `.ulcard` 创建的不可变源码快照。它用于审计、诊断和重建，
不是可编辑草稿。

**Card Artifact**

Electron 使用自己的 Builder 从 Imported Source Snapshot 构建出的不可变产物。

### 2.2 权威来源

| 事实 | 唯一权威 |
|---|---|
| 驱动、Device Type、Action 和状态 Schema | Uni-Lab-OS Driver PackageCatalog |
| 设备实时状态和 Action 结果 | Uni-Lab-OS runtime |
| 可编辑卡片源码 | 用户本地设备包/Card Git 仓库 |
| Electron 收到的源码版本 | Imported Source Snapshot |
| Electron 可执行卡片产物 | Artifact Store |
| Panel 位置、设备绑定和轻量配置 | `workbench-layout` 文档 |

明确禁止：

- Electron 把 Imported Source Snapshot 当作可编辑源码权威。
- 卡片保存第二份设备权威状态。
- 工作台布局保存源码、Bundle、本地文件路径或 WebContents ID。
- OS 管理 Electron 原生 View 生命周期。

## 3. 两次上传

本产品有两个不同的上传操作，界面和文案必须区分。

### 3.1 上传设备包

输入是：

```text
device-package.zip
```

目标是：

```text
安装驱动
→ 注册 Device Type
→ 获得 Action/状态 Schema
→ 生成 Authoring Context
```

### 3.2 导入卡片源码

输入是：

```text
my-card.ulcard
```

目标是：

```text
校验源码包
→ Electron 重新构建
→ 安装 Artifact
→ 加载卡片
```

建议 UI 文案：

- “上传设备包”
- “导出卡片开发包”
- “导入卡片源码”
- “查看导入诊断”
- “应用到设备”
- “回滚卡片版本”

不要把两个入口都叫“上传代码”。

## 4. 端到端用户流程

### 4.1 设备能力准备

```text
1. 用户在 Electron 中上传 device-package.zip
2. Electron 通过 packages/services 将设备包交给 OS
3. OS 校验、安装驱动并编译 PackageCatalog
4. OS 返回 packageId、deviceTypeId 和安装诊断
5. Electron 请求 DeviceCardAuthoringContext
6. Electron 展示可用于卡片的状态字段和 Action
7. 用户点击“导出卡片开发包”
8. Electron 生成 <device-type>.unilab-card-kit.zip
```

### 4.2 用户本地 Vibe Coding

```text
1. 用户在自己的设备包仓库或新目录中解压 Authoring Kit
2. 用户在 Electron 中点击“打开源码目录”，授权 card-project 目录
3. 用户在 Cursor/Codex/VS Code 中描述卡片需求
4. Coding Agent 按 SDK、Device Schema 和 UI Catalog 修改源码
5. Electron 内置固定 Builder 在每次保存后自动生成结构化诊断
6. Coding Agent 读取 .unilab-card/diagnostics.json 并修复错误
7. WebContentsView 自动刷新 Mock 预览
8. 用户确认后在 Electron 中安装当前源码或导出 my-card.ulcard
```

### 4.3 导入 Electron

```text
1. 用户在 Electron 点击“导入卡片源码”
2. 用户选择 my-card.ulcard
3. Electron 读取并校验 Source Package
4. Electron 对照当前 OS Authoring Context 校验权限
5. Electron Builder 独立重新构建
6. 构建成功后生成 Artifact digest
7. Electron 原子安装 Artifact
8. Electron 使用 Mock 模式打开预览
9. 用户确认“应用到设备”
10. 用户选择一个兼容的 Device Instance
11. 工作台创建 device-card Panel
12. WebContentsView 加载本地 Artifact
13. Capability Host 转发真实状态和 Action
```

### 4.4 修改与重新导入

```text
1. 用户继续在本地目录修改源码
2. Electron 自动创建源码快照并重新检查
3. 检查成功后刷新开发预览
4. 用户点击“安装当前源码”
5. Electron 再次权威构建为新的内容哈希
6. 新 View ready 后替换旧 View
7. 新版本失败时继续保留最后一个有效预览和已安装 Artifact
```

Electron 不修改用户源码、Manifest 或业务文档，只在用户明确授权的项目内写入
`.unilab-card/diagnostics.json`。该文件属于可删除的生成状态，应加入 `.gitignore`。

## 5. 总体架构

```text
┌──────────────────────────────────────────────────────────┐
│                    Uni-Lab-OS                            │
│ Device Package → PackageCatalog → Authoring Context     │
│ Device Runtime → State / Action Run                     │
└─────────────────────────────┬────────────────────────────┘
                              │ packages/services
                              ▼
┌──────────────────────────────────────────────────────────┐
│                  Electron React Renderer                 │
│                                                          │
│ Device Package UI → Authoring Kit Export                │
│ Card Import Center → Import/Build Diagnostics           │
│ Workbench device-card Panel → Card View Port            │
│ Capability Host → laboratory / realtime                 │
└─────────────────────────────┬────────────────────────────┘
                              │ narrow preload
                              ▼
┌──────────────────────────────────────────────────────────┐
│                   Electron Main Process                  │
│ Source Import Store / Builder utilityProcess            │
│ Artifact Store / Custom Protocol / View Manager         │
└─────────────────────────────┬────────────────────────────┘
                              │ local unilab-card://
                              ▼
┌──────────────────────────────────────────────────────────┐
│                 Sandboxed WebContentsView                │
│ Trusted Card Shell → Device Card SDK → User Card Bundle │
└──────────────────────────────────────────────────────────┘

              用户本地目录（代码编辑仍在 Electron 之外）
┌──────────────────────────────────────────────────────────┐
│ Authoring Kit + Card Source + Local Coding Agent         │
│              ▲ 自动诊断 / 文件保存事件                   │
└───────────────┼──────────────────────────────────────────┘
                │ 用户显式授权一个项目目录
┌───────────────┴──────────────────────────────────────────┐
│ Electron Local Card Workspace                           │
│ Snapshot → Check/Build → diagnostics.json → Mock Preview │
└──────────────────────────────────────────────────────────┘
```

## 6. 模块与 seam

### 6.1 目标模块

| 模块 | 位置建议 | 职责 |
|---|---|---|
| Device Card SDK | `packages/device-card-sdk` | 作者接口、Manifest、协议和内置 UI |
| Authoring Kit | `packages/device-card-authoring-kit` | ZIP、模板、Schema、类型、规则和示例 |
| Device Card CLI | `packages/device-card-tooling`（可选） | monorepo/CI 的 init/check/preview/pack，不是用户硬依赖 |
| Device Card Host | `packages/device-card-host` | Workspace、Snapshot、Import、Build、Artifact 和能力契约 |
| Device Card Services | `packages/services/src/deviceCards.ts` | OS Authoring Context 与目录 |
| Card Import Center | `apps/kernel-web/src/features/device-cards` | 导出 Kit、导入 Source、诊断 |
| Electron Card Adapter | `apps/desktop/src/main/device-cards` | Builder、Store、Protocol、View |
| Workbench Integration | `apps/kernel-web/src/integrations/lab-workbench` | 固定 device-card Panel |

不在 `packages/panel-runtime` 建立第二套 runtime。

### 6.2 外部 seam

```ts
interface DeviceCardCatalogPort {
  getAuthoringContext(
    deviceTypeId: string
  ): Promise<DeviceCardAuthoringContext>

  exportAuthoringKit(
    deviceTypeId: string
  ): Promise<CardAuthoringKit>
}

interface CardImportPort {
  inspect(sourcePackage: Uint8Array): Promise<CardImportInspection>
  import(sourcePackage: Uint8Array): Promise<CardImportResult>
}

interface CardBuildPort {
  build(request: CardBuildRequest): Promise<CardBuildResult>
}

interface CardViewPort {
  open(spec: CardInstanceSpec): Promise<void>
  presentMany(
    presentations: readonly CardViewPresentation[]
  ): Promise<void>
  reload(instanceId: string, artifactDigest: string): Promise<void>
  close(instanceId: string): Promise<void>
}
```

每个 seam 有生产和测试 Adapter：

| Seam | Production Adapter | Test Adapter |
|---|---|---|
| DeviceCardCatalogPort | OS HTTP adapter | In-memory catalog |
| CardImportPort | Electron IPC adapter | In-memory import |
| CardBuildPort | utilityProcess adapter | Deterministic fake builder |
| CardViewPort | WebContentsView adapter | In-memory view |
| CardCapabilityPort | Services adapter | Mock device |

## 7. 目标仓库结构

```text
uni-lab-fe/
├── packages/
│   ├── device-card-sdk/
│   │   ├── src/
│   │   │   ├── defineDeviceCard.ts
│   │   │   ├── context.ts
│   │   │   ├── manifest.ts
│   │   │   ├── protocol.ts
│   │   │   └── index.ts
│   │   └── package.json
│   ├── device-card-ui/
│   │   ├── src/
│   │   │   ├── primitives/
│   │   │   ├── device/
│   │   │   ├── labware/
│   │   │   ├── chart/
│   │   │   ├── theme/
│   │   │   └── index.ts
│   │   └── package.json
│   ├── device-card-host/
│   │   ├── src/
│   │   │   ├── authoringKit.ts
│   │   │   ├── import.ts
│   │   │   ├── builder.ts
│   │   │   ├── capabilityHost.ts
│   │   │   ├── runtimeGuards.ts
│   │   │   └── index.ts
│   │   └── package.json
│   └── services/
│       └── src/deviceCards.ts
├── apps/
│   ├── kernel-web/
│   │   └── src/
│   │       ├── features/device-cards/
│   │       │   ├── CardAuthoringKitExport.tsx
│   │       │   ├── CardImportDialog.tsx
│   │       │   ├── CardImportInspection.tsx
│   │       │   ├── CardBuildDiagnostics.tsx
│   │       │   ├── CardPreviewHost.tsx
│   │       │   └── CardManager.tsx
│   │       └── integrations/lab-workbench/
│   │           └── DeviceCardPanel.tsx
│   └── desktop/
│       └── src/
│           ├── main/device-cards/
│           │   ├── cardManager.ts
│           │   ├── sourceImportStore.ts
│           │   ├── artifactStore.ts
│           │   ├── builderProcess.ts
│           │   ├── protocol.ts
│           │   ├── viewManager.ts
│           │   └── permissions.ts
│           └── preload/
│               ├── index.ts
│               └── card.ts
└── docs/architecture/
    └── device-card-vibe-coding.md
```

本地作者工具可以位于同一仓库，也可以独立发布：

```text
device-card-tooling/
├── cli/
├── templates/
├── rules/
└── examples/
```

## 8. OS 设备能力投影

### 8.1 设备包最小结构

```text
device-package/
├── device-package.yaml
├── driver/
│   └── centrifuge.py
└── registry/
    └── centrifuge.yaml
```

目标 `device-package.yaml`：

```yaml
schema_version: 1
package_id: vendor.centrifuge
version: 1.0.0

device_types:
  - centrifuge

frontend:
  cards: []
```

卡片可以后续在同一 Git 仓库中添加，但上传驱动时不强制存在。

### 8.2 Authoring Context

#### 8.2.1 当前 OS 分支的真实适配

已核对相邻 Uni-Lab-OS 工作区的
`integration/workflow-task-runtime` 分支。当前可直接复用的公开契约是：

```text
GET  /api/v1/devices
GET  /api/v1/workflow-node-templates
POST /api/v1/runtime/runs
GET  /api/v1/runtime/runs/{run_id}
GET  /api/v1/runtime/runs/{run_id}/nodes
GET  /api/v1/runtime/runs/{run_id}/events
```

其中 `GET /api/v1/devices` 返回 Edge 权威的设备实例、Driver Device Type、
正式 property `stateSchema`、online、busy、`actionRef`、`inputSchema` 和
`outputSchema`。前端通过 `packages/services/src/laboratory.ts` 读取并组装当前
V1 Authoring Context，卡片 Action 仍通过同一个
`POST /api/v1/runtime/runs` 单 Action workflow 提交路径执行。

`stateSchema` 只投影驱动 `status_properties` 的正式 property，字段来源标记为
`driver/resolved`；`online` 和 `actionBusy` 由 Host 补充。Action 输入、Action
输出和运行时样本都不能扩张实时状态合同。没有正式 property 的设备仍可生成
Action-only 卡片，但不得虚构 `status`、`current_position` 等状态。

项目内的 `authoring-context.json` 只是离线预览快照。Builder 会把产物标记为
`host` 或 `project-only`；只有 Electron 从当前设备目录取得的 Host Context 才能
授权 Live 能力。每次打开 Live 卡片时，Host 都会重新校验 Manifest 请求的 Action
和状态字段，项目快照以及旧 V1 无来源字段都不能扩张当前设备权限。

OS 同时提供：

```text
GET /internal/v1/runtime-actions
GET /api/runtime/local/actions
```

第一个端点是 OS 到 local bridge 的 loopback 内部同步面，第二个是兼容投影。
卡片、Electron main 和前端组件都不能直连内部端点，也不能缓存一份目录成为新的
Action 权威。

当前契约仍未一次性投影媒体 Channel、风险等级和 SDK/UI Catalog 版本。

因此，下述专用端点仍是目标契约，不是当前代码已经存在的 API。

#### 8.2.2 目标端点

建议 OS 后续新增：

```http
GET /api/v1/device-types/{device_type_id}/card-authoring-context
```

返回：

```ts
interface DeviceCardAuthoringContext {
  schemaVersion: 1
  packageId: string
  packageVersion: string
  deviceTypeId: string
  title: string
  description?: string

  stateFields: Array<{
    name: string
    schema: JsonSchema
    unit?: string
    description?: string
    updateRateHz?: number
    status: 'resolved' | 'unresolved'
  }>

  actions: Array<{
    name: string
    title: string
    description?: string
    inputSchema: JsonSchema
    resultSchema?: JsonSchema
    riskLevel: 'normal' | 'dangerous' | 'emergency'
  }>

  mediaChannels: Array<{
    name: string
    title: string
    kind: 'image'
    mediaTypes: Array<'image/png' | 'image/jpeg' | 'image/webp'>
    maxBytes: number
    maxRateHz?: number
  }>

  sdk: {
    hostProtocolVersion: 1
    compatibleSdkRange: string
    uiCatalogVersion: string
  }
}
```

约束：

- Action 来自 OS Driver PackageCatalog 的正式登记结果。
- Action 参数必须使用完整 JSON Schema。
- 状态类型不能从某一帧实时值临时猜测。
- 媒体引用来自 OS Driver 声明的 Channel，不能是任意文件路径或 URL。
- 无法解析的状态字段标记 `unresolved`。
- `riskLevel` 由设备包/OS 决定，卡片不能降低。
- 设备包通过 `@action(risk_level='normal' | 'dangerous' | 'emergency')`
  声明风险；OS `/api/v1/devices` 必须以 `riskLevel` 投影，未知值失败关闭。
- Authoring Context 必须版本化。
- UI 只通过 `packages/services` 获取该投影。

## 9. Card Authoring Kit

Authoring Kit 是 Electron 和用户本地 Vibe Coding 环境之间的主要交付物。

当前前端实现已提供 `packages/device-card-authoring-kit`。设备卡片页在没有任何已安装
卡片时也可以选择 OS 设备与 Vue/React/Lite Profile，并导出确定性的
`<device-type>.unilab-card-kit.zip`。ZIP 保存走 Electron 受信任 preload 的二进制
保存接口，renderer 不能指定任意覆盖路径。

### 9.1 导出结构

```text
centrifuge.unilab-card-kit/
├── README.md
├── AGENTS.md
├── CARD_SPEC.md
├── kit-metadata.json
├── authoring-context.json
├── card-manifest.schema.json
├── ui-catalog.json
├── card-project/
│   ├── package.json
│   ├── tsconfig.json
│   ├── card.manifest.json
│   ├── authoring-context.json
│   ├── mock.json
│   ├── AGENTS.md
│   ├── CARD_SPEC.md
│   ├── src/card.vue
│   └── .unilab-card/*.d.ts
├── sdk/
│   ├── index.d.ts
│   ├── ui-elements.d.ts
│   ├── framework.d.ts
│   ├── vue-shim.d.ts
│   └── protocol-version.json
├── examples/
│   ├── status-card/
│   ├── action-card/
│   ├── rack-card/
│   └── trend-card/
├── mocks/
│   └── default-state.json
└── templates/
    ├── web-component-lite/
    ├── vue-web-component/
    └── react-web-component/
```

### 9.2 给 Vibe Coding Agent 的规则

`AGENTS.md`/`CARD_SPEC.md` 至少包含：

- 业务能力只能使用 `@unilab/device-card-sdk`。
- UI 只能使用 Authoring Kit 中列出的 `u-*` 元素和主题 token。
- `vue-web-component-v1` Profile 可以使用 Builder 固定版本的 Vue 3 SFC
  语法，但不能自行安装 Vue 插件。
- 不允许 Node、Electron、fetch、WebSocket、eval。
- 只能使用 `authoring-context.json` 中存在的状态和 Action。
- 权限变更必须同步修改 Manifest。
- 不能自己注册任意 `customElements`。
- 不处理设备连接和鉴权。
- Action 参数必须满足 JSON Schema。
- 必须使用 SDK 生命周期管理订阅。
- 必须支持 Mock 模式。
- 必须使用内置 UI 元素和主题 token。
- 必须保持 Electron 本地工作区自动检查通过；Agent 读取
  `.unilab-card/diagnostics.json` 获取同一 Builder 的诊断。

“可以使用 Vue”不等于“允许任意 npm 依赖”。Vue 编译器和运行时由 Card Toolchain
固定，用户上传包中不携带 `node_modules`。Electron Builder 把 `card.vue` 编译为
Host 指定名称的 Custom Element；卡片代码不能决定注册名，也不能注册其他全局元素。
Authoring Kit 提供 SDK/UI/固定框架的编辑器类型快照，不需要安装
`@unilab/device-card-tooling`，也不访问 npm Registry。

### 9.3 Kit 版本绑定

Kit 记录：

```ts
interface CardAuthoringKitMetadata {
  kitVersion: 1
  generatedAt: string
  deviceTypeId: string
  deviceId?: string
  authoringProfile: DeviceCardAuthoringProfile
  authoringContextDigest: string
  sdkVersion: string
  toolingVersion: string
  hostProtocolVersion: 1
  uiCatalogVersion: string
}
```

目标状态下，导入卡片时 Electron 会重新获取当前 Authoring Context。Kit 只用于
本地创作，不是导入时的最终权威。当前 V1 已在导入时权威重编译，并在 Live 打开时
对照当前 OS 设备目录校验 Device Type 与 Action；待 OS 专用端点完成后，把完整
Context digest、状态 Schema、媒体和风险等级校验前移到导入阶段。

## 10. 用户本地 Card Project

建议直接放在设备包 Git 仓库：

```text
device-package/
├── driver/
├── registry/
└── frontend/
    └── cards/
        └── centrifuge-dashboard/
            ├── card.manifest.json
            ├── src/
            │   ├── card.vue
            │   └── theme.css
            ├── mock.json
            ├── CARD_SPEC.md
            ├── tsconfig.json
            └── .unilab-card/
                ├── context.json
                ├── sdk.d.ts
                ├── ui-elements.d.ts
                └── vue-shim.d.ts
```

如果用户不维护设备包仓库，也可以在独立目录中开发：

```text
my-centrifuge-card/
├── card.manifest.json
├── src/
├── mock.json
└── .unilab-card/
```

用户本地目录是可编辑源码权威。Electron 不通过 IPC 回写业务源码，只允许工作区
模块原子写入 `.unilab-card/diagnostics.json`。每次构建先把允许的文件复制为受限
快照，Builder 不直接信任正在变化的目录。

## 11. Electron Local Card Workspace 与可选 CLI

### 11.1 默认工作流

默认用户工作流不依赖 npm：

```text
打开源码目录
→ Electron 记录本次目录授权
→ 对允许的源码创建有大小上限的不可变快照
→ 内置 Builder 自动检查并构建
→ 原子写入 .unilab-card/diagnostics.json
→ 成功时刷新隔离 Mock 预览
→ 用户安装当前源码或导出 .ulcard
```

构建失败时保留最后一个成功开发预览；安装动作始终基于一次新的源码快照并再次执行
生产模式权威构建。V1 使用跨平台目录指纹轮询，忽略 `.git`、`.unilab-card` 和
`node_modules`；关闭工作区后停止轮询，并清理 Electron `userData` 下的临时开发
Artifact。

### 11.2 可选 CLI

```bash
unilab-card init ./centrifuge-card --profile vue
unilab-card check ./centrifuge-card --context ./authoring-context.json
unilab-card dev ./centrifuge-card
unilab-card test ./centrifuge-card
unilab-card pack ./centrifuge-card --out centrifuge-dashboard.ulcard
```

`preview` 是 `dev` 的别名。检查归档可执行：

```bash
unilab-card inspect centrifuge-dashboard.ulcard
```

这些命令只用于 Uni-Lab monorepo 开发或未来 CI。当前未发布 CLI 包时使用：

```bash
pnpm card init ./centrifuge-card --profile vue
pnpm card dev ./centrifuge-card
pnpm card pack ./centrifuge-card --out centrifuge-dashboard.ulcard
```

### 11.3 Workspace/CLI 共同职责

- 生成项目模板。
- 安装/更新本地 Authoring Context。
- 提供固定 Builder 的 TypeScript/TSX/Vue 编译检查。
- 校验 Manifest。
- 校验状态/Action 权限。
- 使用 Mock Adapter 做浏览器预览。
- 打包 `.ulcard`。

### 11.4 Workspace/CLI 非职责

- 不连接真实设备。
- 不保存 OS token。
- 不调用真实 Action。
- 不签发正式 Artifact。
- 不决定 Electron 是否接受卡片。
- 不把本地预览结果冒充 Electron 运行结果。

开发工作区检查用于缩短反馈周期。Electron 安装流水线仍会从新的源码快照独立重复
所有关键校验，不把开发预览视为已安装 Artifact。

## 12. Card Source Package

### 12.1 `.ulcard` 格式

`.ulcard` 是 ZIP 容器，内部只允许：

```text
card.manifest.json
src/**/*.ts
src/**/*.tsx
src/**/*.vue
src/**/*.css
assets/**/*.svg
assets/**/*.png
assets/**/*.webp
assets/**/*.json
mock.json
source-metadata.json
```

V1 仍然限制为单一入口，但允许把领域图、托盘轮廓和本地图标拆成多个受支持的源码/
资源文件。这样既能承载 pTLC 和东方理工已有的网格、图表、工站示意图，又不会接受
任意 Web 工程。

禁止包含：

- `node_modules`
- `dist`
- executable
- symlink
- preload
- Electron main 脚本
- 构建脚本
- lockfile 中的任意第三方依赖
- 绝对路径
- `..` 路径
- HTML 入口
- JavaScript/WASM 二进制依赖
- Manifest 未声明或 Builder 不识别的文件类型

Electron 不接受用户提供的预构建 `entry.js` 作为本地源码导入的运行产物。

### 12.2 Source Metadata

```json
{
  "sourcePackageVersion": 1,
  "createdBy": "unilab-card-cli",
  "cliVersion": "1.0.0",
  "authoringContextDigest": "...",
  "sourceDigest": "..."
}
```

这些字段只用于诊断，Electron 必须重新计算 digest。

## 13. Card Manifest

```json
{
  "schemaVersion": 1,
  "id": "vendor.centrifuge.dashboard",
  "version": "0.1.0",
  "title": "离心机监控",
  "deviceTypes": ["centrifuge"],
  "sdkVersion": "^1.0.0",
  "hostProtocolVersion": 1,
  "authoringProfile": "vue-web-component-v1",
  "entry": "src/card.vue",
  "uiFeatures": [
    "core",
    "device",
    "chart"
  ],
  "permissions": {
    "state": [
      "status",
      "current_speed",
      "temperature"
    ],
    "actions": [
      "start",
      "stop"
    ],
    "media": []
  },
  "config": {
    "version": 1,
    "defaults": {
      "showTemperature": true
    },
    "schema": {
      "type": "object",
      "properties": {
        "showTemperature": {
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  }
}
```

Manifest 是权限的唯一源码事实。运行时实际权限是：

```text
Manifest 声明
∩ 当前 OS Authoring Context
∩ 当前用户服务端权限
= 实际允许能力
```

## 14. Device Card SDK

### 14.1 作者接口

```ts
interface DeviceCardContext {
  readonly mode: 'mock' | 'live'
  readonly device: Readonly<DeviceCardDescriptor>
  readonly state: Readonly<Record<string, unknown>>
  readonly config: Readonly<Record<string, JsonValue>>

  subscribe(keys: readonly string[]): void

  callAction(
    action: string,
    params?: Record<string, unknown>
  ): Promise<ActionRun>

  readMedia(
    mediaRef: string,
    options?: { maxBytes?: number }
  ): Promise<Blob>

  saveConfig(
    patch: Record<string, JsonValue>
  ): Promise<void>
}

interface DeviceCardDefinition {
  setup?(ctx: DeviceCardContext): void | (() => void)
  render(ctx: DeviceCardContext): TemplateResult
}

function defineDeviceCard(
  definition: DeviceCardDefinition
): DeviceCardDefinition
```

不允许卡片传 `deviceId`：

```ts
// 正确
ctx.callAction('start', { speed: 3000 })

// 不存在的接口
ctx.callAction('other-device', 'start', { speed: 3000 })
```

Device Instance 由 Host 在创建 Card Instance 时绑定。

### 14.2 UI 元素

领域仓库盘点表明，卡片作者最常需要的不是完整 UI 框架，而是少量稳定的实验室/
设备交互元素。V1 提供：

```text
u-card
u-section
u-grid
u-metric
u-status
u-gauge
u-progress
u-alert
u-tabs
u-dialog
u-tooltip
u-table
u-log-console
u-job-status
u-schema-form
u-input
u-number-input
u-select
u-switch
u-action-button
u-action-form
u-slot-grid
u-rack-grid
u-well-plate
u-device-map
u-timeseries
u-image-viewer
u-empty
u-error
```

这些元素形成独立的 `device-card-ui` Module。它的 interface 只包含 JSON 可序列化的
属性、CustomEvent 和 CSS token；内部可以使用 ECharts 或其他经过审核的
Implementation，但不能把 Element Plus、ECharts option、Vue Store 或 Axios 类型泄漏
给卡片作者。

V1 暂不提供：

- 完整 Element Plus。
- Handsontable/完整电子表格编辑器。
- CodeMirror/PLC 或流程源码编辑器。
- 机器人连续 Jog 控件。
- pTLC 完整流程编辑器。
- 东方理工 `dynamic-graph` 的完整工站场景。
- 任意 HTML/SVG 注入元素。
- 用户自带 ECharts、zrender、RDKit 或 WASM。

这些能力要么不属于小卡片，要么有明显的体积、设备耦合或安全成本。

### 14.3 示例

```ts
import {
  defineDeviceCard,
  html
} from '@unilab/device-card-sdk'

export default defineDeviceCard({
  setup(ctx) {
    ctx.subscribe([
      'status',
      'current_speed',
      'temperature'
    ])
  },

  render(ctx) {
    return html`
      <u-card title="离心机">
        <u-status
          label="状态"
          value=${ctx.state.status}
        ></u-status>

        <u-gauge
          label="当前转速"
          value=${ctx.state.current_speed}
          unit="rpm"
          max="5000"
        ></u-gauge>

        <u-metric
          label="温度"
          value=${ctx.state.temperature}
          unit="℃"
        ></u-metric>

        <u-action-button action="start">
          启动
        </u-action-button>

        <u-action-button action="stop" variant="danger">
          停止
        </u-action-button>
      </u-card>
    `
  }
})
```

### 14.4 Vue SFC Profile

`vue-web-component-v1` 使用 SDK 提供的 Vue Adapter：

```vue
<script setup lang="ts">
import { useDeviceCard } from '@unilab/device-card-sdk/vue'

const { state } = useDeviceCard({
  state: ['status', 'current_speed', 'temperature'],
})
</script>

<template>
  <u-card title="离心机">
    <u-status label="状态" :value="state.status" />
    <u-gauge
      label="当前转速"
      :value="state.current_speed"
      unit="rpm"
      :max="5000"
    />
    <u-metric label="温度" :value="state.temperature" unit="℃" />
    <u-action-button action="start">
      启动
    </u-action-button>
    <u-action-button action="stop" variant="danger">
      停止
    </u-action-button>
  </u-card>
</template>
```

Builder 负责：

1. 编译 SFC。
2. 注入 Device Card Context。
3. 把根组件包装成 Host 命名的 Custom Element。
4. 注入所声明 UI Feature 的本地版本。
5. 生成确定性的单入口 Artifact。

Web Component 是创作和生命周期 interface；真正的安全隔离仍然来自独立
WebContentsView、sandbox、CSP 和 Capability Host。

## 15. Electron Import Center

Electron 不提供源码编辑器，只提供导入和诊断。

### 15.1 导入界面

```text
选择 .ulcard
→ 显示卡片 ID/版本/设备类型
→ 显示状态权限和 Action 权限
→ 显示 Authoring Context 是否过期
→ 显示 Source Package 校验
→ 点击“构建并预览”
→ 显示 Electron Builder 诊断
→ Mock Preview
→ 点击“安装到本机”
```

### 15.2 CardImportPort

```ts
interface CardImportPort {
  inspect(
    sourcePackage: Uint8Array
  ): Promise<CardImportInspection>

  buildAndInstall(
    sourcePackage: Uint8Array,
    options: {
      channel: 'development' | 'release'
    }
  ): Promise<CardImportResult>
}
```

`inspect()` 不产生安装副作用。

### 15.3 Import Inspection

```ts
interface CardImportInspection {
  sourceDigest: string
  manifest: CardManifest
  compatible: boolean
  authoringContextChanged: boolean
  permissions: {
    state: PermissionInspection[]
    actions: PermissionInspection[]
    media: PermissionInspection[]
  }
  diagnostics: CardDiagnostic[]
}
```

用户必须在构建前看到：

- 新增状态权限
- 新增 Action 权限
- dangerous/emergency Action
- SDK/Protocol 不兼容
- Authoring Context 变化

## 16. Source Import Store

Electron 可以保留不可变 Imported Source Snapshot，但不将其作为编辑草稿。

```text
app.getPath('userData')/
└── device-cards/
    ├── imports/
    │   └── <source-digest>/
    │       ├── source.ulcard
    │       ├── inspection.json
    │       └── build-diagnostics.json
    └── artifacts/
        └── <artifact-digest>/
```

```ts
interface ImportedSourceRecord {
  sourceDigest: string
  importedAt: string
  manifest: CardManifest
  authoringContextDigest: string
  sourcePackagePath: string
  lastBuildStatus: 'success' | 'failed'
}
```

规则：

- Snapshot 不可原地修改。
- 同一 source digest 不重复保存。
- 用户修改源码后必须从本地重新 pack/import。
- Electron 可以提供“导出原始上传包”，但不提供编辑。
- 构建失败不能覆盖最后一个有效 Artifact。

## 17. Electron Builder

### 17.1 运行位置

Builder 使用 Electron `utilityProcess`：

```text
React Renderer
→ CardImportPort
→ Electron Main
→ Builder utilityProcess
→ BuildResult
```

用户源码只能作为 Builder 输入。Builder 不得 `eval`、直接 `import` 或运行用户脚本。

### 17.2 CardBuildPort

```ts
interface CardBuildRequest {
  sourceDigest: string
  sourcePackage: CardSourcePackage
  authoringContext: DeviceCardAuthoringContext
  channel: 'development' | 'release'
}

type CardBuildResult =
  | {
      status: 'success'
      sourceDigest: string
      artifact: CardArtifactCandidate
      diagnostics: CardDiagnostic[]
    }
  | {
      status: 'failed'
      sourceDigest: string
      diagnostics: CardDiagnostic[]
    }
```

### 17.3 构建约束

- 固定版本 TypeScript/esbuild。
- 固定版本 Vue SFC Compiler；仅用于 `vue-web-component-v1` Profile。
- `platform: 'browser'`。
- `format: 'esm'`。
- `bundle: true`。
- 虚拟文件系统。
- 禁止 npm install。
- 禁止 package scripts。
- 只允许 `@unilab/device-card-sdk`、`@unilab/device-card-ui/types` 和 Profile
  明确开放的 `vue` 子集。
- `u-*` UI 实现由 Electron 的本地、版本化 Runtime 提供，不从用户源码或远程 URL
  下载。
- 禁止 Node built-in。
- 禁止远程 import。
- 禁止 `eval`、`new Function` 和动态字符串 import。
- SVG 必须经过结构化清洗，拒绝 script、event handler、`foreignObject` 和外部引用。
- 图片必须通过 MIME magic bytes、像素和解码预算校验，不能只信任扩展名。
- 默认禁止 Worker、WASM、SharedArrayBuffer。
- 构建超时 10 秒。
- 单文件最大 512 KB。
- 总源码最大 4 MB。
- JS Bundle 最大 1 MB。
- Artifact 总大小最大 8 MB。

CLI 构建成功不代表 Electron 可以跳过重新构建。

## 18. Artifact Store

### 18.1 Artifact

```text
artifact/
├── manifest.json
├── entry.js
└── assets/
```

```ts
interface CardArtifactRecord {
  artifactDigest: string
  sourceDigest: string
  cardId: string
  cardVersion: string
  channel: 'development' | 'release'
  trust: 'local-unsigned' | 'package-signed'
  installedAt: string
  manifest: CardManifest
}
```

### 18.2 开发与发布通道

**development**

- 允许同一 Card ID 反复导入。
- 每次构建都生成新的内容哈希。
- 本地别名 `local-latest` 指向最新有效 Artifact。
- 标记为 `local-unsigned`。

**release**

- `cardId + version` 不可变。
- 同版本不同 source digest 必须拒绝。
- 共享分发版本必须有设备包签名。

### 18.3 原子安装

```text
1. 写入随机 staging 目录
2. 校验路径、MIME、数量和大小
3. 计算 Artifact digest
4. 校验 Manifest 与当前 Authoring Context
5. release 时校验签名
6. 原子 rename 到 digest 目录
7. 原子更新 Catalog
8. 保留上一已知可用 Artifact
```

## 19. WebContentsView Runtime

### 19.1 禁止直接 import

禁止：

```ts
await import(uploadedUserCardModule)
```

直接 import 会让用户代码与主 React 应用共享：

- JavaScript 事件循环
- `window`
- `localStorage`
- `fetch`
- 主 preload 暴露的 `window.api`
- `customElements`
- 全局 prototype

本设计使用独立 WebContentsView。

### 19.2 WebContentsView 配置

```ts
const view = new WebContentsView({
  webPreferences: {
    preload: cardPreloadPath,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: false,
    spellcheck: false,
    partition: 'unilab-card-sandbox'
  }
})
```

卡片必须使用专用 preload，不能复用主窗口 preload。

每个 View 必须：

- 拒绝 window open
- 拒绝顶层导航
- 拒绝下载
- 拒绝所有 permission check/request
- 禁止访问非 `unilab-card:` 资源
- 监听 `render-process-gone`
- 关闭时显式关闭 `webContents`

### 19.3 本地协议

```text
unilab-card://<artifact-digest>/index.html
unilab-card://<artifact-digest>/entry.js
unilab-card://<artifact-digest>/assets/...
unilab-card://runtime/<runtime-version>/core.js
unilab-card://runtime/<runtime-version>/features/chart.js
```

这是本地内容协议。Electron 的 `loadURL()` 只是加载接口名称，不产生远程代码依赖。
`runtime` 命名空间只映射到 Electron 安装包内经过版本固定的可信文件，Artifact
不能写入或覆盖它。

`index.html` 由可信 Card Host 生成。Source Package 和 Artifact 都不能覆盖：

- HTML bootstrap
- CSP
- preload
- MessagePort bridge
- UI runtime

建议 CSP：

```text
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'none';
worker-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none';
```

## 20. Card Capability Protocol

主进程建立 MessagePort：

```text
Main React Renderer ← MessagePort A
Card WebContentsView ← MessagePort B
```

主进程只管理传输和 View，不复制设备业务逻辑。

### 20.1 Host → Card

```ts
type HostToCardMessage =
  | {
      type: 'init'
      protocolVersion: 1
      cardInstanceId: string
      mode: 'mock' | 'live'
      device: DeviceCardDescriptor
      config: JsonObject
      theme: CardTheme
      locale: string
    }
  | {
      type: 'state'
      sequence: number
      timestamp: number
      values: Record<string, unknown>
    }
  | {
      type: 'action-result'
      requestId: string
      run: ActionRun
    }
  | {
      type: 'config-changed'
      config: JsonObject
    }
  | {
      type: 'media-result'
      requestId: string
      mediaType: string
      bytes: ArrayBuffer
    }
  | {
      type: 'error'
      requestId?: string
      error: CardRuntimeError
    }
```

### 20.2 Card → Host

```ts
type CardToHostMessage =
  | {
      type: 'ready'
      protocolVersion: 1
    }
  | {
      type: 'subscribe-state'
      subscriptionId: string
      keys: string[]
    }
  | {
      type: 'unsubscribe-state'
      subscriptionId: string
    }
  | {
      type: 'call-action'
      requestId: string
      action: string
      params: Record<string, unknown>
    }
  | {
      type: 'save-config'
      requestId: string
      patch: JsonObject
    }
  | {
      type: 'read-media'
      requestId: string
      mediaRef: string
      maxBytes: number
    }
  | {
      type: 'log'
      level: 'info' | 'warn' | 'error'
      message: string
    }
```

每条消息必须经过运行时守卫。

### 20.3 图片和领域媒体

pTLC 液位、视觉调试和东方理工化学结构等场景说明卡片需要图片，但卡片不能直接
请求原 SPA 的 `/api/...` URL。

状态中只下发不透明引用：

```ts
interface CardMediaDescriptor {
  ref: string
  kind: 'image'
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  width?: number
  height?: number
  byteLength?: number
}
```

卡片通过 `read-media` 请求，Host 校验 Device Instance、Manifest 权限、MIME、大小
和生命周期，再通过 MessagePort 转移 ArrayBuffer。SDK 创建并回收 Blob URL。

V1 只支持快照和低频刷新，不承诺高帧率 MJPEG/视频。高帧率视觉流应使用后续的
Host-owned Media View，而不是通过每张卡片重复传输。

## 21. 状态与 Action

### 21.1 DeviceStateHub

当前 `RealtimeService.subscribeDeviceStatus()` 每次订阅会创建一个 WebSocket。多卡片
场景应加深 implementation：

```ts
interface DeviceStateHub {
  subscribe(
    deviceId: string,
    keys: readonly string[],
    listener: (snapshot: DeviceStateSnapshot) => void
  ): () => void
}
```

内部负责：

- 一个 Services 实例一个底层状态连接
- 按 Device Instance 和字段扇出
- 引用计数
- 最后状态缓存
- 断线重连
- 字段过滤
- 更新合并

### 21.2 Action

```text
Card call-action
→ Card Instance 绑定检查
→ Manifest 权限检查
→ 当前 Authoring Context 检查
→ Electron 主进程按当前 OS Action JSON Schema 检查参数
→ Host 风险确认
→ packages/services DeviceCardActionController 创建 Device Action Task
→ device_action_task.changed SSE 失效通知后 REST rehydrate 权威终态
→ action-result 发回卡片
```

卡片不能传入任意 Device ID，也不能用内部确认按钮替代 Host 确认。

## 22. Mock 与 Live

### 22.1 Local CLI Preview

本地 CLI 只使用：

- `mock.json`
- Authoring Kit 示例状态
- 用户手工修改的 Mock 状态

不连接真实设备。

### 22.2 Electron Import Preview

导入 Electron 后先使用 Mock：

- 验证 WebContentsView 加载
- 验证布局
- 验证状态更新
- 模拟 Action 成功/失败
- 显示卡片日志

### 22.3 Live

用户明确点击“应用到设备”后才进入 Live：

- 选择兼容 Device Instance
- 检查 Server Capability
- 使用 `services.laboratory`
- 使用 DeviceStateHub
- dangerous/emergency Action 由 Host 确认
- 设备目录由 `device.catalog.changed` SSE 通知失效后重读 REST，UI 不定时轮询。
- Action Task 不使用 250ms 轮询或前端假超时；只有 OS 终态能结束运行。

## 23. 工作台集成

### 23.1 固定 Panel

```ts
const DEVICE_CARD_PANEL = {
  id: 'device-card',
  title: '设备卡片',
  category: 'data',
  singleton: false,
  closability: 'when-multiple-tabs'
}
```

通过现有 `createPanelRegistry(manifest, contributions)` 注入。不为每张卡片创建新 Panel
类型。

### 23.2 Panel 配置

```json
{
  "id": "device-card-centrifuge-01",
  "panelType": "device-card",
  "config": {
    "deviceId": "centrifuge-01",
    "deviceTypeId": "centrifuge",
    "cardId": "vendor.centrifuge.dashboard",
    "versionPolicy": "local-latest",
    "userConfig": {
      "showTemperature": true
    }
  }
}
```

布局不保存：

- 源码
- `.ulcard`
- Bundle
- 本地文件路径
- Artifact digest
- WebContents ID
- 设备实时状态
- token

### 23.3 现有代码演进

- `panelAdapter.tsx` 增加可信 `DeviceCardPanel` renderer。
- `createPanelRegistry()` contributions 注册 `device-card`。
- `panelLayouts.ts` 的 `lab` preset 允许 `device-card`。
- `PanelRendererProps` 增加通用 `updateConfig(patch)` 和 `isActive`。
- `PanelHost` 把 `updateConfig` 转为现有 `update-panel-config` command。
- `DeviceCardPanel` 只渲染占位元素并管理 CardViewPort。

不新增第二套布局 Store 或事件总线。

## 24. WebContentsView 布局协调

React 只渲染占位元素：

```tsx
<div
  ref={placeholderRef}
  data-card-instance-id={cardInstanceId}
/>
```

`CardViewLayoutCoordinator` 观察：

- ResizeObserver
- window resize
- 页面 scroll
- Panel split resize
- Tab 激活/隐藏
- Panel 拖拽
- Modal 打开/关闭

```ts
interface CardViewPresentation {
  instanceId: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  visible: boolean
}
```

每个动画帧最多批量发送一次 bounds。

### 24.1 产品约束

WebContentsView 不属于 DOM，因此：

- React Modal 不能自然覆盖它。
- 拖拽遮罩可能被它遮挡。
- 圆角和复杂 z-index 较难。
- 每张卡片消耗独立 WebContents 资源。

V1 约束：

- View 只覆盖 Panel 内容区。
- 非激活 Tab 必须隐藏。
- Modal、菜单或拖拽时隐藏相关 View。
- 同时可见 View 默认最多 4 个。
- 卡片列表使用截图或静态缩略图。
- 自定义卡片主要用于设备详情和工作台 Panel。

如果产品要求几十张自定义卡片同时滚动展示，应重新评估容器；WebContentsView 不适合
该场景。

## 25. 重新导入、热更新和回滚

### 25.1 Development 导入

```text
用户修改本地源码
→ Electron 目录指纹轮询发现变更
→ 受限源码快照
→ 自动检查并更新 diagnostics.json
→ 成功后刷新开发 View
→ 用户点击安装当前源码
→ Electron 从新快照重新构建
→ 生成新 Artifact digest
→ 创建隐藏的新 View
→ 新 View ready
→ 交换 bounds
→ 关闭旧 View
```

卡片 ID 可以相同，但 Artifact 永远内容寻址、不可原地覆盖。

### 25.2 失败处理

如果发生：

- Source 校验失败
- 构建失败
- Artifact 安装失败
- View load timeout
- Renderer crash
- Protocol mismatch

则：

- 保留 Imported Source Snapshot 和诊断
- 不修改 active Artifact alias
- 保留旧 View
- 提供“查看诊断”和“回滚”

## 26. 将源码放回设备包

Electron 不自动改写用户 Git 仓库。推荐两种方式：

### 26.1 用户直接在设备包仓库开发

源码已经位于：

```text
device-package/frontend/cards/<card-id>/
```

用户提交 Git 即可。Electron 导入只是本机安装验证。

### 26.2 用户在独立目录开发

用户将验证后的 Card Source Project 手动复制到设备包仓库，再提交 Git。

未来可以增加“导出标准 Card Source 目录”，但 Electron 仍不负责 Git commit/push。

设备包正式发布时，CI 应使用相同 Builder 再次构建并签名 Artifact。Electron 本地
`local-unsigned` 产物不能直接成为共享正式版本。

## 27. 安全与稳定性

### 27.1 Source Import

- ZIP 路径白名单
- 禁止 symlink
- 禁止 `..`
- 文件数量和大小限制
- Manifest JSON Schema
- 当前 Authoring Context 校验
- import 白名单
- Source digest 重算

### 27.2 Builder

- utilityProcess
- 超时终止
- 虚拟文件系统
- 不执行源码
- 不运行 npm scripts
- 不读取任意本地文件
- 不访问网络

### 27.3 WebContentsView

- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`
- `webSecurity: true`
- 专用 preload
- 严格 CSP
- deny permissions
- deny navigation/window open
- deny 网络
- Runtime 消息守卫

### 27.4 AI 代码信任

即使代码由用户自己的 Coding Agent 生成，也必须视为不可信输入，因为它可能：

- 生成死循环
- 泄漏订阅
- 使用不存在字段
- 误调用 Action
- 扩大权限
- 使用不允许依赖
- 造成高 CPU/内存

本地作者身份不能替代运行隔离。

## 28. 错误模型

```text
DEVICE_PACKAGE_INSTALL_FAILED
CARD_AUTHORING_CONTEXT_UNAVAILABLE
CARD_AUTHORING_KIT_EXPORT_FAILED
CARD_SOURCE_PACKAGE_INVALID
CARD_SOURCE_PATH_INVALID
CARD_SOURCE_TOO_LARGE
CARD_MANIFEST_INVALID
CARD_PERMISSION_INVALID
CARD_CONTEXT_OUTDATED
CARD_BUILD_FAILED
CARD_BUILD_TIMEOUT
CARD_ARTIFACT_INVALID
CARD_INTEGRITY_MISMATCH
CARD_VERSION_IMMUTABLE
CARD_SIGNATURE_INVALID
CARD_SDK_INCOMPATIBLE
CARD_DEVICE_INCOMPATIBLE
CARD_PROTOCOL_MISMATCH
CARD_LOAD_TIMEOUT
CARD_RENDERER_CRASHED
CARD_PERMISSION_DENIED
CARD_ACTION_INVALID
CARD_CONFIG_INVALID
CARD_VIEW_LIMIT_REACHED
```

用户可执行的恢复动作：

- 重新导入源码包
- 查看 Import/Build 诊断
- 导出当前 Authoring Kit
- 回滚上一 Artifact
- 切换通用 Schema 卡片
- 回到本地目录继续修改

## 29. 测试策略

### 29.1 Authoring Context

- 设备包安装后生成稳定 Device Type ID。
- Action 包含完整 inputSchema。
- 状态字段类型和单位稳定。
- unresolved 字段不被伪装成 resolved。
- riskLevel 不能由卡片降低。
- Kit metadata 与 context digest 一致。

### 29.2 Local Card Workspace

- 目录指纹轮询忽略 `.git`、`.unilab-card` 和 `node_modules`。
- 每次检查先生成受大小、文件数和扩展名限制的不可变快照。
- 自动检查拒绝未知状态字段、Action 和危险源码。
- preview 只使用 Mock，失败时保留最后一个成功构建。
- error 状态禁止安装和导出。
- diagnostics 原子写入，且不会触发轮询自循环。
- 关闭工作区后释放轮询任务并清理临时 Artifact。

可选 CLI 继续覆盖 init/check/preview/pack 与 Electron Builder 的一致性。

### 29.3 Import Pipeline

- 路径穿越被拒绝。
- symlink 被拒绝。
- 非白名单文件被拒绝。
- Authoring Context 过期产生明确诊断。
- inspect 无安装副作用。
- 构建失败不改变 active Artifact。

### 29.4 Builder

- 禁止 Node import。
- 禁止远程 import。
- 禁止任意依赖。
- 超时能终止 utilityProcess。
- 同一输入生成确定性 Bundle。
- Electron 不信任 CLI 预构建结果。

### 29.5 WebContentsView

- `window.api` 不存在。
- Node built-in 不可用。
- 网络被拒绝。
- window open 被拒绝。
- permission 被拒绝。
- crash 不影响主 renderer。
- close 后 WebContents 被销毁。
- 非激活 Tab 不可见。

### 29.6 Capability Host

- 不能订阅 Manifest 外字段。
- 不能调用 Manifest 外 Action。
- 不能指定其他 Device Instance。
- Action 参数必须通过 JSON Schema。
- dangerous/emergency Action 由 Host 确认。
- Action 终态来自 OS。
- 多卡片共享底层状态连接。

### 29.7 端到端

```text
上传设备包
→ OS 注册 Device Type/Action/状态
→ Electron 导出 Authoring Kit
→ 用户在外部目录创建 Card Source
→ CLI check/preview/pack
→ Electron 导入 .ulcard
→ Electron 重新构建
→ Mock Preview
→ 应用到真实设备
→ 接收真实状态
→ 执行真实 Action
→ 修改本地源码并重新导入
→ 无重启热更新
→ 故障版本回滚
```

## 30. 领域组件盘点与可行性校准

本节不是依据组件名称推测，而是对以下快照做的静态盘点：

| 仓库 | 检查版本 | 现役前端 |
|---|---|---|
| `Uni-Lab-OS/pTLC_platformUI` | `c65b34a`，`codex/ui-upper-next`，2026-07-17 | `eit_ptlc/web` |
| `/home/changjunhan/Uni-Lab-Core/device_package_u` | `8c21dc0`，`main`，2026-05-08 | `frontend` |

`pTLC_platformUI/UI-Upper` 已被该仓库明确标记为过时存档，本设计不把它当作现役
实现。盘点针对源码的结构和依赖，不代表已经在真实硬件上验收全部功能。

### 30.1 技术栈结论

两个领域前端的共同基础是：

- Vue 3.5。
- Vite 5。
- Axios。
- 独立 Web SPA。
- 由前端直接连接各自 FastAPI HTTP/WS 接口。

差异是：

| 维度 | pTLC | 东方理工设备包 |
|---|---|---|
| Vue 文件 | 43 个，约 8.3k 行 | 58 个，约 31k 行 |
| UI 基础 | 原生 HTML 控件 + 自定义 CSS | Element Plus |
| 状态 | Pinia +事件 WS +局部轮询 | 页面本地状态 + REST 轮询 +局部 WS |
| 图表 | 少量 Canvas/自绘 | ECharts |
| 表格 | 原生表格 | Element Plus Table + Handsontable |
| 编辑器 | CodeMirror 6 | Handsontable、表单型编辑 |
| 实验室可视化 | 货架、液位、图像标注 | 孔板、货架、AGV 地图、工站场景、化学结构 |
| 专用依赖 | CodeMirror | ECharts、Element Plus、Handsontable、OpenChemLib、RDKit 路径、zrender 图模块 |

因此，让领域用户继续使用 Vue SFC 是低摩擦选择。Electron 主 UI 是 React 并不构成
阻碍：卡片在单独的 WebContentsView 文档中运行，Electron Builder 可以固定 Vue
版本并把 SFC 编译为 Custom Element。

不推荐要求这些同学全部改写成手写原生 DOM，也不推荐把 Electron 主应用改成 Vue。

### 30.2 pTLC 组件盘点

现役 `eit_ptlc/web` 的主要 UI 能力如下：

| 类别 | 现有实现 | 对卡片平台的价值 | 原样复用 |
|---|---|---|---|
| 动作表单 | `ActionDetail`、`ParamEditor`、`ValueInput` | 很高；参数类型与 OS Action Schema 高度一致 | 否 |
| 动作结果 | ActionResult、运行状态、错误展示 | 很高；可形成统一 Action Run UI | 否 |
| 状态/告警 | `StatusBar`、`AlarmBanner`、`MonitorDock` | 高 | 部分 |
| 日志/步骤 | `StepTree`、Debug Dock | 高；适合只读步骤/日志卡片 | 部分 |
| 货架 | `RackDiagram` | 高；适合数据驱动的槽位网格 | 小改后可用 |
| 液位 | `WaterLevelGrid`、`WaterLevelChannel` | 中高；需要 Host 图像帧能力 | 否 |
| 图像/HITL | `ImageLightbox`、Overlay、`HitlModal` | 中；需要受控图片和人工确认能力 | 否 |
| 机器人控制 | `RobotJogPanel`、Teach/Calibration | 业务价值高但风险高 | 否 |
| 流程编辑 | Node/Variable/Param Editor、CodeMirror | 不适合作为小卡片 V1 | 否 |
| PLC 编辑部署 | POU/Compile/Symbol/Version Panel | 不属于设备卡片 | 否 |

pTLC 给出了一个很有价值的 Schema 交集：

```text
int | float | bool | string | enum | point_ref
+ required/default/min/max/options
```

这应直接进入 `u-schema-form` 和 `u-action-form` 的 V1 interface。卡片作者只需给出
Action 名，UI Module 根据 Authoring Context 渲染表单、校验参数并显示 Action Run
状态，不应在每张卡片里重复手写。

pTLC 现有组件大多直接 import `api`、Pinia Store 或 Router。这些调用是其独立 SPA
的合理 Implementation，但不能成为卡片 interface。迁移方式应是：

```text
现有组件
  API/Store/Router + UI
        ↓ 拆分
纯数据 View（props + events）
        +
Card Adapter（ctx.state + ctx.callAction）
```

例如 `RackDiagram` 的网格渲染值得提炼，但其内部
`api.listPointGrids()` 必须移到 Adapter，由属性传入 `rows/cols/slots/highlight`。

### 30.3 东方理工设备包组件盘点

东方理工前端对通用卡片最有价值的实现是：

| 能力 | 现有实现 | 评价 | 建议 |
|---|---|---|---|
| 指标与设备汇总 | `DeviceStatusView` 的 metrics/status | 高可迁移 | 提炼 `u-metric`、`u-status` |
| 日志 | `ResultConsole` | 高可迁移 | 提炼 `u-log-console` |
| 异步任务 | `JobPanel` | 模式可迁移 | Host 订阅 Action Run，删除组件内部轮询 |
| 趋势图 | `BatteryChart` | 高可迁移 | ECharts 藏在 `u-timeseries` 内部 |
| AGV 工站地图 | `AgvMapView` | 高可迁移 | 提炼数据驱动的 `u-device-map` |
| 货架槽位 | `ShelfGrid` | 高可迁移 | 与 pTLC RackDiagram 合并为 `u-rack-grid` |
| 孔板选择 | `WellGrid` | 高可迁移 | 提炼 `u-well-plate` |
| 响应式表格 | `ResponsiveTable` | 高可迁移 | 提炼 `u-table` |
| 化学结构 | `StructurePreview` | 中 | 后续做受控 Chemistry Feature Pack |
| 危险品展示 | `HazardDisplay` | 中高 | 先提炼纯展示的 hazard/status 数据模型 |
| 资源管理 | Resource Panel 和多个 Dialog | 中 | 拆成槽位图 + Schema Form + Action |
| 机器人 Jog | `ArmJogPanel` | 风险高 | 不进入通用 UI V1 |
| 表格编辑 | `EditableSpreadsheet` | 体积/许可/复杂度高 | 不进入卡片 V1 |
| 完整工站图 | `NTUStationGraph`/`dynamic-graph` | 有价值但当前不可直接复用 | 单独重构 |

东方理工大量使用 Element Plus。它证明了 Dialog、Table、Form、Tag、Alert、Tabs、
Descriptions、Steps 等交互需求真实存在，但不意味着 Card SDK 应暴露 Element Plus。

盘点到的高频 Element Plus 元素包括：

- Button、Table/TableColumn、Form/FormItem。
- Descriptions、Tag、Input/InputNumber、Select。
- Dialog、Tabs、Alert、Radio、Checkbox、Switch。
- Steps、Tooltip、Pagination、Image、Empty。

应把其中卡片必需的语义收敛到少量 `u-*` 元素。这样后续可以替换 UI
Implementation，而不要求所有用户源码跟着 Element Plus 主版本迁移。

仓库内还保留了 `kaimisiterui/eit_chemical_manager/web/frontend` 子前端。它与根
`frontend` 有一组重复的化学组件，并额外包含 SMILES Renderer Compare：

- RDKit.js。
- OpenChemLib。
- Indigo Ketcher WASM。
- Marvin JS 占位（明确需要商业许可）。

该实现通过 Vite 插件从 `node_modules` 复制 RDKit/Indigo 的 JS 和 WASM 到
`public/`，再用 `<script>` 动态加载。这证明化学结构渲染确实是领域需求，也证明它
不适合让普通 `.ulcard` 自带依赖；更合理的形态是经过许可、体积和安全审核的
`chemistry-v1` Feature Pack。

### 30.4 四类迁移判断

#### A. 可以优先提炼

满足“数据输入、事件输出、无设备网络”的实现：

- Battery/Temperature 等时序图。
- KPI、状态、告警和连接摘要。
- 日志控制台和 Action Run 状态。
- AGV/工位二维地图。
- Rack/Shelf/Slot/Well Plate 网格。
- 响应式只读表格。
- 图片查看、缩放和简单标注图层。

这些能力可成为深 Module：卡片作者学习一个小 interface，内部获得响应式布局、空态、
错误态、主题、可访问性、resize、销毁和性能处理。

#### B. 需要先拆 Adapter

以下实现的 UI 有价值，但目前直接连接 URL、Store 或轮询器：

- `JobPanel`。
- pTLC `ActionDetail`。
- WaterLevel Grid/Channel。
- Resource Panel。
- Device Status 页面。
- HITL Modal。

必须把“如何取数据/调用动作”替换成 Card SDK Adapter。UI Module 不得知道 HTTP
路径、token、Device ID 或轮询间隔。

#### C. 需要 Feature Pack

化学结构展示依赖 RDKit/OpenChemLib/WASM，完整工站图依赖 zrender、SVG 模型和较大
配置。这类能力不能让每个用户随包上传依赖，建议由 Electron 安装和版本化：

```text
core
device
chart
labware
chemistry-v1      # 后续
station-scene-v1  # 后续
```

Manifest 的 `uiFeatures` 声明卡片需要的 Feature Pack。Import Center 展示体积和能力
变化，Runtime 只从本地可信目录加载对应版本。

#### D. 不适合作为卡片能力

- PLC 源码编辑、编译和部署。
- 任意代码编辑器。
- 完整流程编排器。
- 自动 npm install。
- 任意 REST/WS 控制台。
- 未经 Host 安全门的连续 Jog/E-Stop/Teach 控制。

这些是独立工作台工具或 Host 能力，不应通过自定义卡片绕过产品权限模型。

### 30.5 `dynamic-graph` 专项判断

东方理工的工站图表达能力有复用价值，但当前快照不能原样进入 Card Runtime：

- 约 3.4k 行 TypeScript，并携带大量设备 SVG 模型。
- 多处读取 `window.webb.store` 全局对象。
- 依赖特定 Vite alias 和“SVG 作为字符串”插件。
- 使用 zrender、lodash 等实现依赖。
- 上层 `NTUStationGraph` 内部创建轮询器并连接业务资源。
- `frontend/src/lib/dynamic-graph/runtime/*` 被源码 import，但该目录未被 Git 跟踪；
  仓库根 `.gitignore` 的通用 `runtime/` 规则会忽略它。
- `vue-i18n`、Quasar、date-fns 等源码 import 没有作为顶层依赖完整声明。

所以它当前属于“业务 SPA 内迁移中的实现”，还不是可发布的通用 Module。

可行的重构 seam 是：

```ts
interface StationSceneModel {
  station: StationGeometry
  slots: readonly StationSlot[]
  resources: readonly StationResource[]
  selection: readonly string[]
}

interface StationSceneElement extends HTMLElement {
  model: StationSceneModel
}

type StationSceneEvent =
  | { type: 'slot-select'; slotId: string }
  | { type: 'resource-select'; resourceId: string }
```

`StationScene` 只能渲染模型和发送选择事件。网络轮询、资源写入和设备控制全部留给
Card Adapter/Capability Host。完成以下条件后才进入 `station-scene-v1`：

1. 所有源码和 SVG 资产可从干净 checkout 构建。
2. 移除 `window.webb`、Quasar 和业务 URL。
3. 所有直接依赖固定并通过许可审查。
4. 用 JSON fixture 做离线渲染测试。
5. 有明确的 mount/update/destroy interface。
6. Bundle、首帧和内存达到 Card Runtime 预算。

### 30.6 对原方案的具体修订

盘点后，本设计作出以下调整：

1. V1 增加 `vue-web-component-v1` Authoring Profile。
2. Electron 固定 Vue Compiler/Runtime；用户包不能提供 Vue 或 npm 依赖。
3. `.ulcard` 允许受控的 `.vue/.ts/.tsx/.css` 和本地图片/SVG/JSON 资产。
4. 新建 `device-card-ui`，不直接复用 React `design-system`，也不暴露 Element Plus。
5. UI Catalog 优先覆盖 Action Schema、状态、日志、趋势、Rack/Slot/Well/Map。
6. ECharts 只作为 `u-timeseries` 的内部 Implementation。
7. 图像和视频通过 Host 媒体能力进入卡片，不允许卡片请求原有 `/api` URL。
8. Chemistry 和 Station Scene 采用 Host-owned Feature Pack，推迟到 V1 后。
9. Robot Jog、PLC 编辑、流程编辑不进入通用卡片 V1。
10. 先移植三种代表性组件验证方案，而不是一开始建设完整组件库。

### 30.7 可行性结论

| 目标 | 判断 | 原因 |
|---|---|---|
| 外部本地 Vibe Coding | 高 | 两个团队已有 Vue/Vite 经验，Kit 可直接喂给 Coding Agent |
| 上传源码后免重启加载 | 高 | Builder + 内容哈希 Artifact + WebContentsView 可独立换版 |
| Web Component 交付形式 | 高 | Vue SFC 可以由固定工具链编译为 Custom Element |
| 不使用 iframe | 高 | WebContentsView 是原生子 WebContents，不是页面 iframe |
| 复用简单领域组件 | 高 | 图表、地图、Rack、Well、日志已接近 props/events 形式 |
| 原样复用完整页面 | 低 | 直接依赖 Router、Store、Axios、业务 URL |
| 原样复用 dynamic-graph | 低 | 全局对象、缺失跟踪文件、构建插件和依赖耦合明显 |
| 自定义卡片安全隔离 | 中高 | 取决于是否坚持 WebContentsView、CSP、Capability Host 和重建 |
| 一个页面几十张重卡片 | 低 | 每张 WebContentsView 和重型图形运行时都有资源成本 |

总体结论是“方案可行，但复用的是领域交互模型和纯 View，不是复制现有 SPA”。第一版
应把常见需求做成稳定 UI Catalog，让 Vibe Coding Agent 组合这些元素；真正特殊的设备
卡片仍可写 Vue/CSS，但数据和动作必须穿过同一个 Card SDK seam。

### 30.8 首轮兼容性 Spike

正式实现前用三个来源不同的组件做两周以内的技术 Spike：

1. 从东方理工 `BatteryChart` 提炼 `u-timeseries`，验证固定 ECharts
   Implementation、resize、销毁和 Bundle 预算。
2. 合并 pTLC `RackDiagram` 与东方理工 `ShelfGrid/WellGrid` 的数据模型，验证
   `u-slot-grid/u-rack-grid/u-well-plate`。
3. 用 pTLC Action Schema 实现 `u-action-form`，验证
   `enum/point_ref/min/max/default/required` 和 dangerous Action Host 确认。

每个 Spike 必须满足：

```text
Vue SFC 本地创作
→ CLI Mock Preview
→ .ulcard
→ Electron 重新构建
→ WebContentsView
→ 无 fetch/WebSocket
→ Mock/Live 使用同一 UI
→ 卸载后无订阅、Timer、Chart 泄漏
```

`dynamic-graph` 和 RDKit 不作为 V1 架构是否成立的前置条件。

### 30.9 许可风险

检查快照中没有发现这两个仓库根目录的 License 文件。即使仓库属于同一合作范围，
也应在复制具体实现到 MIT 的 `uni-lab-fe` 前确认代码和第三方资产的授权。

在确认前可以：

- 复用交互需求、数据模型思想和公开 interface。
- 根据产品需求重新实现 `device-card-ui`。

不要直接复制：

- 大段 Vue/CSS 实现。
- dynamic-graph 源码和设备 SVG 资产。
- 依赖库源码、WASM 或可能受单独许可约束的素材。

## 31. 分阶段实施

### Phase 0：契约与许可

- 固定 Device Package schema。
- 固定 Authoring Context。
- 固定 Authoring Kit V1。
- 固定 `.ulcard` Source Package V1。
- 固定 Manifest V1。
- 固定 Host Protocol V1。
- 固定 `web-component-lite-v1` 和 `vue-web-component-v1` Profile。
- 确认参考 `card-framework` GPL 与当前前端 MIT 的许可处理。
- 确认 pTLC、东方理工组件和设备 SVG 资产的许可/代码归属。

完成标准：OS、Electron、CLI 和设备包仓库使用同一组 Schema。

### Phase 1：OS 能力与 Kit 导出

- 设备包安装返回 packageId/deviceTypeId。
- Driver PackageCatalog 生成 Authoring Context。
- `packages/services/src/deviceCards.ts`。
- Electron “导出卡片开发包”。（前端 V1 已实现）
- Kit 模板、类型和规则。（前端 V1 已实现）

完成标准：上传无卡片设备包后，用户能得到可交给 Coding Agent 的完整 Kit。

当前前端侧完成标准已满足；整个 Phase 1 仍受 OS 专用 Authoring Context 端点、
正式状态 Schema、媒体和风险等级缺口限制。

### Phase 2：SDK、本地工作区与可选 CLI

- `defineDeviceCard()`。
- Vue SDK Adapter 和固定 SFC Profile。
- `device-card-ui` 的 core/device/chart/labware V1。
- `u-timeseries`、`u-rack-grid`、`u-well-plate`、`u-action-form` Spike。
- `init/check/preview/pack`。
- Mock Adapter。
- `.ulcard` Schema 和测试。
- Electron 源码目录授权、跨平台目录轮询、结构化诊断、自动 Mock Preview、安装与导出。

完成标准：用户可在 Electron 外部用 Vue SFC 完成一张 Mock 卡片，由 Electron 自动
检查和预览，并直接安装或导出 `.ulcard`；卡片源码没有 Axios、WebSocket、私有
Tooling 依赖或用户自带 npm 依赖。

### Phase 3：Import 与 Builder

- Import Center。
- inspect。
- Source Import Store。
- Builder utilityProcess。
- 固定 Vue SFC Compiler 和 Profile allowlist。
- Artifact Store。
- 构建诊断。

完成标准：Electron 能拒绝不合法源码，并从合法 `.ulcard` 构建不可变 Artifact。

### Phase 4：WebContentsView Host

- 专用 card preload。
- 本地协议。
- View Manager。
- MessagePort。
- CSP、权限、网络和导航限制。
- Mock Preview。

完成标准：Artifact 可在 WebContentsView 中运行，且不能访问主 preload。

### Phase 5：真实设备与工作台

- `device-card` Panel。
- CardViewLayoutCoordinator。
- DeviceStateHub。
- Action Capability Host。
- 配置持久化。
- 热更新和回滚。

完成标准：导入卡片可绑定真实设备并完成状态/Action 链路。

### Phase 6：设备包正式分发

- 设备包仓库 cards 目录规范。
- CI 重新构建。
- Artifact 签名。
- 正式 Catalog。
- release 版本不可变。

完成标准：另一台 Electron 安装相同设备包后可以使用正式卡片。

## 32. 首个可验证纵切

第一轮建议使用 `virtual_centrifuge`：

```text
1. 上传 virtual_centrifuge 设备包
2. OS 返回 Authoring Context
3. Electron 导出 centrifuge.unilab-card-kit.zip
4. 解压并在 Electron 中打开 card-project 源码目录
5. 使用本地 Coding Agent 生成卡片
6. Electron 自动 check 并写入 diagnostics.json
7. WebContentsView 自动 preview --mock
8. Electron 导出 .ulcard 或安装当前源码
9. Electron inspect
10. Electron Builder 从新快照权威重建
11. WebContentsView Mock Preview
12. 绑定 virtual_centrifuge 实例
13. 收到 current_speed/temperature/status
14. 调用 start/stop
15. 本地修改标题并重新 pack/import
16. 不重启完成热更新
17. 导入故障版本并验证回滚
```

先完成该纵切，再考虑卡片市场和远程发布。

## 33. 必须避免

- 不在 Electron 内实现 Vibe Coding。
- 不在 Electron 内建立 AI Generation Port。
- 不建立 Electron Draft Editor/Store。
- 不要求用户从 npm Registry 安装私有 Card Tooling。
- 不把用户上传源码直接 import 到主 renderer。
- 不信任用户本地 dist。
- 不复用主窗口 preload。
- 不让卡片或 Import UI 直接请求 OS。
- 不执行用户 package scripts。
- 不运行 npm install。
- 不把 Element Plus、ECharts option 或 Vue Store 作为 Card SDK interface。
- 不直接复制带 Axios/Router/业务 Store 的领域页面作为卡片。
- 不让 Electron 自动改写用户 Git 仓库。
- 除 `.unilab-card/diagnostics.json` 外不回写用户授权的源码目录。
- 不把本地 `local-unsigned` 冒充正式发布版本。
- 不把源码、路径或 WebContents ID 写进布局。
- 不为每张卡片创建不同 Panel 类型。
- 不在 `packages/panel-runtime` 建第二套 runtime。
- 不为每张卡片创建重复设备状态 WebSocket。

## 34. 最终验收不变量

- Vibe Coding 发生在 Electron 外部的用户本地目录。
- 默认开发工作流不依赖 npm Registry；固定 Builder 随 Electron 分发。
- OS 是设备能力的唯一权威。
- Authoring Kit 只用于创作，导入时 Electron 必须重新校验当前 Context。
- 用户上传的是 Card Source Package，不是可信可执行 Bundle。
- Electron 必须重新构建源码。
- Vue/图表等运行时版本必须由 Electron 固定，不能由用户源码包携带。
- UI 元素必须以 JSON 属性/事件为 interface，不泄漏具体 UI 框架类型。
- 只有 Builder 成功的开发 Artifact 可以进入隔离 Mock Preview；只有成功安装的
  不可变 Artifact 可以进入 Live Runtime。
- Card WebContents 不拥有 OS 地址、token 或任意 Electron 能力。
- Card Instance 只能操作 Host 绑定的 Device Instance。
- Preview 默认使用 Mock。
- Live 必须由用户明确选择真实设备。
- Action 终态只来自 OS。
- 工作台只认识一个 `device-card` Panel。
- 重新导入失败不能破坏最后有效版本。
- View 关闭时必须释放订阅、MessagePort 和 WebContents。
- Electron 不修改用户本地业务源码；唯一允许的回写是可删除且已忽略的
  `.unilab-card/diagnostics.json`。
- 主 React renderer 不执行用户上传的卡片代码。

## 35. 参考

- Uni-Lab-OS `feat/card-framework`：
  <https://github.com/Uni-Lab-OS/Uni-Lab-OS/tree/feat/card-framework>
- 本次实际核对的 Uni-Lab-OS 分支：
  <https://github.com/Uni-Lab-OS/Uni-Lab-OS/tree/codex/private-github-snapshot-20260725>
- pTLC 现役上位机：
  <https://github.com/Uni-Lab-OS/pTLC_platformUI/tree/codex/ui-upper-next/eit_ptlc/web>
- 东方理工设备包前端（本地盘点）：
  `/home/changjunhan/Uni-Lab-Core/device_package_u/frontend`
- Electron WebContentsView：
  <https://www.electronjs.org/docs/latest/api/web-contents-view>
- Electron MessagePorts：
  <https://www.electronjs.org/docs/latest/tutorial/message-ports>
- Electron Custom Protocol：
  <https://www.electronjs.org/docs/latest/api/protocol>
- Electron Security：
  <https://www.electronjs.org/docs/latest/tutorial/security>
- Electron Process Sandboxing：
  <https://www.electronjs.org/docs/latest/tutorial/sandbox>
