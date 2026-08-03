# 前端架构

## 原则

- `uni-lab-fe` 是唯一长期维护仓库。
- `kernel-web` 是唯一 renderer，使用 Vite + React 19，不做 SSR。
- Electron 只拥有 main、preload 和桌面打包能力。
- 仓库使用 pnpm workspace 管理 `apps/*` 和 `packages/*`。
- 业务数据归所属 package，应用只组合能力。
- Cloud、本地 Go 和本地 Python OS 遵循同一接口规范，通过
  Backend Profile 选择完整服务地址、鉴权与 workspace mode。
- 一个 Profile 只连接一个逻辑 Server：Local Python OS 是 Edge Server，
  Local Go/Cloud 是 Backend Server；两者向前端提供相同 HTTP 和 realtime
  contract，feature package 不按 Server 类型分支。
- 主题由 `design-system` 提供 semantic token，由 `app-shell` 配置和应用；
  业务 package 不维护私有视觉体系。
- Pascal Editor 保持上游依赖，Uni-Lab 扩展不进入上游源码副本。
- 工作流引擎以 `uni-lab-fe/packages/workflow-editor` 为唯一实现，不保留或
  迁移 Uni-Lab-Cloud 的工作流画布与 authoring engine。
- 初始迁移只修改 `uni-lab-fe`；当前 Uni-Lab-OS 本地桥仅补入统一的只读
  Material 查询。其余 Backend/Edge 契约仍是未来前置工作，前端不能伪装
  服务端尚未具备的能力。

## 设备卡片创作

- [设备卡片 Vibe Coding 架构](architecture/device-card-vibe-coding.md)：定义卡片
  源码、固定 Builder、Web Component Bundle、Preview/Live Runtime 与安装链路。
- [设备卡片 Agent 自动创作桥功能设计](architecture/device-card-agent-authoring-bridge.md)：
  定义本地 Agent 如何通过 Electron 随附 CLI 获取 Authoring Kit、创建或接入
  源码目录、读取诊断、导出和请求安装；Local Bridge 与薄 CLI V1 已实现。

## 依赖方向

```text
apps/kernel-web
  ├─ integrations/lab-workbench
  │    ├─ workbench-layout
  │    ├─ services
  │    ├─ material
  │    ├─ scene-runtime（目标）
  │    ├─ workflow-editor
  │    └─ pascal-host + pascal-lab-plugin
  └─ app-shell + design-system

apps/desktop ── packages kernel-web as its renderer input
```

`workbench-layout` 不导入任何业务 package。`pascal-lab-plugin` 只允许依赖
`@unilab/material/domain` 的类型、规则和几何函数，不能依赖 Material Store
或 UI；其余跨业务动作由
`apps/kernel-web/src/integrations/lab-workbench` 组合。

## 状态所有权

| 状态 | 所有者 | 实现 |
| --- | --- | --- |
| 非 Material Graph 的服务端缓存、请求状态 | `services` 的消费者 | TanStack Query |
| 后端选择与连接状态 | `kernel-web` | React context |
| panel 布局文档 | `workbench-layout` | 纯 reducer + storage port |
| 物料文档与编辑历史 | `material`（目标） | feature store |
| 高频关节与 pose 热状态 | `scene-runtime`（目标） | Zustand vanilla frame buffer |
| 工作流文档、画布与编辑历史 | `workflow-editor` | Uni-Lab FE 内部引擎 |
| Pascal 场景内部状态 | Pascal Editor | 上游 editor store |
| 组件临时状态 | 对应组件 | React local state |
| 跨 panel 选择、高亮、定位意图 | `kernel-web/integrations` | Zustand vanilla store |

跨 panel store 只保存 ID 和交互意图。例如工作流步骤选择物料时，工作流
panel 写入 `selectedMaterialIds`，2D 和 3D panel 订阅同一字段并高亮；
物料实体、工作流 JSON 和场景文档不会复制到该 store。

Material Graph 不进入 TanStack Query，也不增加独立 Material Session 或
Coordinator。`createMaterialStore` 注入当前 Material service 与 scope；
Store 的异步 actions 统一处理加载、命令、revision 冲突和清理。P1 暂不处理
Material Graph 的多客户端/多窗口结构同步；高频运行时通道不受此限制。

## 工作流边界

`packages/workflow-editor` 同时拥有工作流模型、编辑状态、代码视图和 DAG
画布，是仓库内唯一工作流引擎。Cloud 的 workflow canvas、revision
document store、canvas controller 和相关 Redux 状态均不进入迁移范围。

Cloud、本地 Go 或本地 Python 后端返回的工作流数据如有字段差异，由
`services` 或应用 adapter 转换为内部工作流模型；不能为了兼容某个后端
再引入第二套画布或编辑状态。

## Panel 调用机制

`workbench-layout` 提供四个 port：

- registry：panel 定义。
- renderers：根据 panel 类型解析 renderer。
- scope：为 renderer 提供当前 `Services` 和交互 store。
- storage：读取和保存布局文档。

应用侧的 `useLabPanelAdapter` 实现这些 port。这样 panel 之间不通过
组件 ref、DOM 事件或全局 Redux 互调，新增 package 也不需要修改
`workbench-layout`。

`AppShell` 的 Material、3D 和 Workflow 入口都使用
`LabPanelWorkspace`/`PanelLayoutRenderer`，不再各自直连第二套 feature 页面。
布局文档按 workspace preset 存入 localStorage；这里只持久化 panel 布局，
不持久化 Material Graph 或 Pascal scene。

## Pascal 边界

`pascal-host` 直接承载固定版本的 `@pascal-app/editor`，不复制
`pascalorg/editor` 源码。上游仍声明 Next peer，但项目只使用客户端组件；
Vite 用薄的 `next/image`、`next/link` 兼容组件满足上游导入，不安装 Next，
也不增加 SSR。

`pascal-lab-plugin` 是防腐层，负责：

- 注册 `lab-device`、`lab-table` 和层级节点及其 renderer/capability。
- 在 Uni-Lab 的 Z-up、毫米、degree XYZ 与 Pascal/Three 的 Y-up、米、radian
  之间转换。
- 加载 XACRO、URDF、GLTF/GLB、STL、FBX 和 OBJ 模型。
- 把 `MaterialAggregate` 转换为 Pascal scene graph，并将保存结果转换为
  `MaterialSceneMove[]`。
- 保存挂载点元数据和局部变换，提供挂载矩阵、吸附及链接查找算法。

```text
Material Store（业务事实）
        │ materialAggregatesToSceneGraph
        ▼
Pascal scene graph（编辑投影）
        │ Pascal Editor store
        ▼
save -> MaterialSceneMove[] -> Material Store action
```

Pascal store 只拥有相机、选中、编辑中的 scene graph 等 3D 会话状态，不成为
第二份物料业务真相。跨 panel 只广播 material ID 与 scene object ID。
上游升级只允许修改依赖版本、Vite 兼容层和 host/plugin 适配，不允许把
Uni-Lab 业务代码写进上游副本。

Material 聚合、静态 Site/坐标、实时关节隔离、React Flow 投影、后端
revision 和 zundo 的完整目标设计见
[Material、Scene 与实时状态设计](architecture/material-scene-runtime.md)。

当前 `SceneWorkbench` 已直接订阅应用级 Material Store；旧示例图、
Cloud-shaped Material DTO 和 scene localStorage 已删除。Pascal Host 使用上游
公开 `setScene` 更新投影，不通过 remount 或上游源码 fork 同步 Aggregate。

## Services

`packages/services/src` 保持扁平：

```text
backends.ts          # BackendProfile、workspace mode 与默认 Profile
capabilities.ts      # adapter 静态能力矩阵、capability key 与禁用原因
http.ts              # fetch、超时、鉴权、统一错误
errors.ts            # 统一 ServiceError 与 UnsupportedCapabilityError
laboratory.ts        # 设备、资源与任务
materials.ts         # 新协议 MaterialGraphPort 与原子 domain command
realtime.ts          # 实时连接生命周期
createServices.ts    # 当前 Backend Profile 的服务集合
ServicesProvider.tsx # Services + QueryClient 生命周期
```

这里不包含 Redux slice、Toast、React 业务 hook 或页面状态。

本轮 `Services.capabilities` 对完整目标契约采用 deny-by-default。当前只打开
Local Go 的 `material.readTemplates`，并使用 singleton scope 接入新 Backend
的 `/api/v1/resource-templates` 列表和详情；其余 Material、joint realtime 与
Edge compensation 能力均未达到目标语义。已有相似 CRUD、`device_status`
或旧 Cloud API 不会被包装为兼容能力；UI 使用
`getCapabilityStatus` 展示禁用原因，Store action 使用同一 capability key
抛出 `UnsupportedCapabilityError`。

当前 capability matrix 直接使用稳定的 Profile `id`，不增加单独的
`adapter`/preset 字段。名称和 URL 的修改不影响能力；未知 ID 默认全部禁用。
