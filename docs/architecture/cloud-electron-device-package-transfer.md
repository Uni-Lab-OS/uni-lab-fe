# Electron 云端设备广场到本地可运行设备的接入闭环

> 状态：Implemented；真实 Cloud/OSS 凭据与物理仪器联调待环境验收
>
> 日期：2026-08-06
>
> 看板：LOCAL-125
>
> 硬约束：Uni-Lab-Cloud 与 uni-lab-backend 不新增接口、不新增表、不修改现有接口语义
>
> 实现范围：uni-lab-fe Electron，以及 Electron 实际使用的当前 Uni-Lab-OS
>
> 说明：本文同时记录冻结设计与截至 2026-08-06 的已落地实现；自动化覆盖不替代真实 Lab AK/SK、OSS 和物理仪器验收。

## 1. 需求结论

用户界面继续使用“添加心愿单”这个操作名称，但它不再表示保存一份设备元信息，而是启动完整的本地设备接入流程。

点击“添加心愿单”后的目标效果是：

1. Electron 从现有云端设备广场读取设备详情和设备包信息。
2. 当前 Uni-Lab-OS CLI 下载设备包 Artifact，校验摘要并编译 PackageCatalog。
3. 设备包进入当前 OS 的受管 community 缓存，驱动代码可被运行时挂载。
4. Electron 根据 PackageCatalog 中的设备初始化参数展示配置向导。
5. 用户填写真实仪器的串口、IP、端口、账号或其他驱动参数。
6. OS 将设备实例声明原子写入 Electron 当前选择的设备图 JSON。
7. Electron 受控重启当前 Uni-Lab-OS，使设备包、注册表和设备实例一起加载。
8. Electron 从当前 OS 的 `/api/v1/devices` 查询到该实例在线且 Action 可见后，才显示“设备可运行”。

设备广场读取、仅下载、添加心愿单和上传统一绑定用户明确选择的固定云端环境：测试环境 `leap-lab.test.bohrium.com`、UAT 环境 `uni-lab.uat.bohrium.com` 或正式环境 `leap-lab.bohrium.com`。本地设备接入记录持久化来源环境，重试始终回到原环境，不跟随页面后来切换。

```text
云端设备广场设备模板
          │ 现有公开查询接口
          ▼
Electron “添加心愿单”
          │
          ▼
候选：本地设备接入（LocalDeviceProvisioning）
    ├── 下载并校验设备包
    ├── 编译 PackageCatalog
    ├── 生成驱动配置表单
    ├── 写入本地设备图
    ├── 受控重启 Uni-Lab-OS
    └── 查询在线设备与 Action
          │
          ▼
本地设备实例已就绪，可在 Electron 中调用设备 Action
```

“添加心愿单”不自动执行任何真实仪器动作。这里的“可运行”是指驱动实例已经创建、设备进入当前 OS 在线设备目录、Action 合同可以被 Electron 调用；具体物理动作仍由用户明确发起。

## 2. 用户操作流程与预期效果

### 2.1 浏览云端设备

1. 用户在 Electron 打开“云端设备广场”，选择测试、UAT 或正式环境。
2. Electron 只从所选环境展示现有设备列表、筛选、详情、所属设备包和版本。
3. Electron 首屏读取 40 条，并按 Backend 返回的 `total/page/page_size` 提供“加载更多设备”，直到当前筛选结果全部展示。
4. 浏览使用现有公开接口，不要求 Backend 新字段。

预期效果：Electron 展示内容与 Uni-Lab-Cloud 当前设备广场的数据来源一致；设备超过首屏时不会静默截断在前 40 条。

### 2.2 添加心愿单并接入本地设备

1. 用户在目标环境点击设备详情中的“添加心愿单”。
2. Electron 创建一个本地设备接入作业，立即展示下载和校验进度。
3. CLI 下载设备包并返回包内设备定义、初始化参数、依赖和摘要。
4. Electron 展示“配置仪器”向导：
   - 实例名称和本地设备 ID；
   - 串口、IP、端口等驱动参数；
   - 要写入的设备图；
   - 是否显式接管同 ID、同 definition 且 UUID 为空的遗留设备节点；
   - 是否需要重启当前 OS。
5. 用户确认后，CLI 校验参数并原子更新设备图。
6. 如果当前 OS 正在运行，Electron 明确提示并执行受控重启。
7. 重启完成后，Electron 查询本地设备目录和 Action。
8. 查询成功时，心愿单条目进入“可运行”；可重试失败保留原阶段重试入口，旧版或不兼容发布保留设备详情并明确要求发布者重新发布，不显示无效的自动重试按钮。
9. 接入记录保存原云端环境；即使随后在顶部切换环境，该记录的下载重试仍访问原环境。

预期效果：设备不仅出现在本地列表中，驱动代码、设备定义和配置都已经进入当前 OS 的实际启动链路，用户可以在 Electron 选择该设备并调用它公开的 Action。

### 2.3 仅下载设备包

设备详情仍保留“仅下载设备包”操作，供开发者预取或离线检查：

- 下载并校验 Artifact；
- 写入受管缓存；
- 不修改设备图；
- 不创建设备实例；
- 不重启当前 OS；
- 不显示“设备可运行”。

因此两个操作的最终语义是：

| Electron 操作 | 结果 |
|---|---|
| 添加心愿单 | 下载 + 校验 + 配置 + 写设备图 + 重启加载 + 就绪确认 |
| 仅下载设备包 | 只把已校验 Artifact 放入受管缓存 |

### 2.4 上传设备包

1. 用户选择一个本地 Package Workspace。
2. Electron 调用 `unilab package inspect` 并展示 distribution、version、namespace、设备/资源/工作流定义和诊断。
3. 用户选择测试、UAT 或正式环境，输入该环境对应的 Lab AK/SK。
4. Electron Main 通过 stdin 把一次性 AK/SK 交给当前 OS CLI；凭据不进入 argv、`local_config.py`、本地接入记录或普通日志。
5. CLI 继续使用现有 OSS token、预签名 PUT 和 `/lab/resource`。
6. 上传后 Electron 重新读取同一环境的现有包列表/详情，确认设备广场可见性。

预期效果：用户不离开 Electron 即可上传；新包仍由现有 Electron/Cloud 设备广场查询接口展示。

## 3. 不变约束与非目标

### 3.1 明确不修改

- 不修改 `Uni-Lab-Cloud` 页面、Hook 或 service。
- 不给 `uni-lab-backend` 新增 route、DTO、数据表、迁移或状态机。
- 不新增稳定 release、download session、publish session 或 `finalize`。
- 不改变 `copy_resource`、`community-packages/resolve`、storage token 和 `/lab/resource` 的语义。
- 不把 Electron 注册成云端 Edge。
- 不做 Cloud 浏览器向某台 Electron 的远程任务投递。
- 不同时维护当前 OS 和旧 OS 两套正式设备包实现。

### 3.2 本期非目标

- 点击“添加心愿单”后自动执行真实仪器动作。
- 在缺少串口/IP等必填参数时猜测配置并启动设备。
- 跨电脑同步本地设备接入状态。
- 首版在线热加载根设备。
- 删除一个本地设备时自动删除仍被其他设备实例使用的设备包缓存。
- 把 Electron OAuth token 转换成 Lab AK/SK。

## 4. 当前实现证据

### 4.1 仓库基线

| 仓库 | 已核对基线 | 本期角色 |
|---|---|---|
| Uni-Lab-Cloud | `main@6d69d27a` | 现有设备广场交互参考和回归对象，不修改 |
| uni-lab-backend | 本地 `test@2d94a64` | 现有接口提供方，不修改 |
| uni-lab-fe | `feature/electron-device-provisioning` | Electron 页面、Main 编排和本地运行时；含 2026-08-06 分页与旧包诊断修复 |
| 当前 Uni-Lab-OS | `feature/electron-device-provisioning@6a9a549` | 下载、Catalog、设备图接入和运行时加载目标 |
| old-unilab-os代码 | `dev@1331701` | 旧 CLI 行为参考，不作为第二套正式实现 |

已核对 `/home/changjunhan/Uni-Lab-Core/CONTEXT.md`，其中尚未收录本流程的规范术语。因此本文继续使用候选本地设备接入（LocalDeviceProvisioning），不宣称为已接受决策（Accepted Decision）。

### 4.2 可直接使用的 Backend 接口

| 能力 | 方法与路径 | 鉴权 | 用途 |
|---|---|---|---|
| 设备列表 | `GET /api/v1/lab/square/list` | 无 | Electron 广场列表、分页和筛选 |
| 设备详情 | `GET /api/v1/lab/square/detail/{templateUuid}` | 无 | `package_info`、`source_registry` 和展示详情 |
| 厂商与标签 | `GET /api/v1/lab/square/manufacturers-and-tags` | 无 | 筛选项 |
| 分类 | `GET /api/v1/lab/square/category` | 无 | 分类导航 |
| 包列表 | `GET /api/v1/lab/square/packages` | 无 | 按包名聚合列表 |
| 包详情 | `GET /api/v1/lab/square/packages/{packageName}` | 无 | 包元信息和包内设备 |
| Artifact 下载 | `GET /api/v1/lab/square/packages/releases/{templateUuid}/download` | 无 | `302` 到 OSS 短效 URL |
| OSS 上传 token | `GET /api/v1/lab/storage/token` | Lab AK/SK | 现有 CLI 上传 Artifact |
| 模板上传 | `POST /api/v1/lab/resource` | Lab AK/SK | 现有 CLI 上传设备/资源模板 |

下载路由的参数当前实际是设备模板 UUID，不是稳定设备包发布版本 UUID。这是遗留兼容（Legacy Compatibility）。

设备详情中的 `package_info` 可提供包名、版本、namespace 和摘要；`source_registry.source_fqid` 标识包内规范设备定义。当前实现要求 `source_fqid`、Artifact 摘要和 `catalog_digest` 同时存在并互相一致。旧数据缺少这些字段时失败关闭并标记“旧版设备包，需要使用当前 CLI 重新发布”；Electron 不根据模板名称合成 FQID，也不猜测驱动类。

### 4.3 Cloud“心愿单”接口不是本地接入接口

Uni-Lab-Cloud 当前调用：

```http
POST /api/v1/lab/square/copy_resource

{
  "lab_uuid": "...",
  "device_uuids": ["..."]
}
```

它只把设备模板复制到云端实验室，不会下载驱动、修改 Electron 设备图或启动本地设备。本期“添加心愿单”不调用该接口。

### 4.4 当前 OS 已有的可复用能力

当前实现（Current Implementation）已经具备：

- `package_manager.community`：下载 wheel、限制大小、校验 Artifact 摘要、编译 PackageCatalog、维护缓存索引和原子替换临时文件。
- `PackageCatalog`：保存包身份、设备定义、Python module/symbol、初始化参数、Action、状态和依赖。
- `register_package_catalog`：把包内设备定义登记到 OS 注册表，但不会创建实例。
- OS 启动流程：设备图含 `community.*` class 时，解析 community 包，把 wheel 加入 `sys.path`，安装声明依赖并将 PackageCatalog 投影到注册表。
- `initialize_device_from_dict`：从设备图节点的 `class` 和 `config` 解析规范设备定义，导入驱动类并创建设备实例。
- `/api/v1/devices`：从 live HostNode 投影在线设备和 Action，可作为 Electron 的就绪确认接口。

这些事实证明“受管缓存 wheel + PackageCatalog + 设备图实例声明”可以进入当前 OS 的真实运行链路，不需要再把整个设备包源码复制到 Uni-Lab-OS 仓库。

当前维护的 Package Manager 以“带内嵌 PackageCatalog 的 wheel”为可运行 Artifact。旧 `old-unilab-os代码` CLI 上传的 tar.gz 或缺少 Artifact 摘要/Catalog 的历史包，不能直接承诺在当前 OS 中运行；Electron 应标记“遗留包不兼容”，由发布者使用当前 CLI 重新构建上传，而不是绕过校验。

### 4.5 原始缺口与交付状态

| 原始缺口 | 已交付实现 |
|---|---|
| CLI 无显式下载与写图命令 | 当前 OS 已实现 `package download/add-device/update-device/remove-device/restore-graph` |
| 无配置 Schema | PackageCatalog 初始化参数已投影为严格 JSON Schema；秘密参数使用 `writeOnly` 与 `x-unilab-secret` 合同 |
| Electron 无接入编排 | Main 已实现候选 `LocalDeviceProvisioningManager`、原子 Store、最小 IPC 和 Renderer 页面 |
| 设备图写入不安全 | OS 已实现配置校验、同目录备份、文件与目录 fsync、原子替换、恢复和幂等 |
| 缓存版本可能漂移 | 设备图保存精确 `package_cache_key`，Runtime 按固定 release wheel 加载 |
| 无可运行确认 | Main 复用 LocalRuntime stop/start，并以 `/api/v1/devices` 在线状态和 Action 数量对账 |
| 无 Electron 上传入口 | Main 复用 `package inspect/upload --json`，路径只接受本次系统选择器批准值 |
| 旧包失败后显示“未命名设备” | Main 先持久化已校验云端详情，再解析包兼容性；失败记录保留设备名称、包名、版本和可用摘要 |
| Electron 只显示设备第一页 | Renderer 依据 `total/page/page_size` 逐页加载、按模板 UUID 去重，并显示“已显示 N / total” |
| 不可兼容旧包反复重试 | `ServiceError.retryable=false` 持久化到诊断，Main 拒绝自动重试，Renderer 隐藏重试按钮 |
| 可选 object 的显式 `null` 被误判为类型错误 | FE 与 OS 统一遵循初始化 Schema：字段可选且默认值明确为 `null` 时，显式 `null` 与省略字段等价；其他类型错误仍失败关闭 |
| 云端 FQID 生成的实例 ID 含 `-`，ROS 节点启动失败 | 实例 ID 统一规范为 `[A-Za-z_][A-Za-z0-9_]{0,127}`，非法字符替换为下划线，并由 Renderer、Electron Main/IPC 与 OS CLI 在写图前共同校验 |
| Electron 中断后长期显示“激活中” | `activating`/`driver_ready` 只允许作为当前 Main 操作持有的瞬时状态；Main 重启后会按当前 Edge 和 `/api/v1/devices` 重新对账，或恢复为可重试/可移除的稳定状态 |

首版仍明确采用受控重启，不承诺在线增加根设备。真实 UAT Cloud/OSS 已使用无硬件依赖的 SZLab mock 包完成闭环；物理仪器连接与业务 Action 仍属于部署环境验收项，不是新增 Backend 开发项。

### 4.6 Electron 已有的可复用能力

- `localRuntimeManager.ts` 已验证 OS 项目、Conda 环境和设备图 JSON。
- Electron 本地运行配置已经持有 `graphPath`、OS 项目路径和 Conda 环境路径。
- 当前启动器以 `shell: false` 启动 `unilab --graph <graphPath>`，并具备停止、重启和就绪检查。
- `packages/services/src/laboratory.ts` 已读取 `/api/v1/devices` 和 Action 合同。

因此设备图必须继续由 Electron Main 和 OS CLI 通过受控路径修改，Renderer 不能直接写文件。

## 5. 领域对象与状态

### 5.1 UI 名称与领域名称

UI 操作保留“添加心愿单”，但代码和文档中的领域模块不得命名为 `WishlistStore`，因为它已经不是收藏元数据。

候选术语：本地设备接入（LocalDeviceProvisioning）。

- 中文身份：Electron 生成的 `provisioning_id`，业务去重键为 `backend_origin + template_uuid + local_instance_id`。
- 中文权威：Electron Main 负责编排和持久化；当前 OS 负责判断驱动/实例是否真正加载。
- 中文生命周期：用户点击添加开始，到设备 `ready`、明确失败、取消或移除结束。
- 中文持久事实：云端模板引用、包摘要、缓存引用、设备定义 FQID、实例 ID、目标设备图、脱敏配置、阶段和诊断。
- 中文失败语义：瞬时下载/运行时失败可以按阶段安全重试；缺少 `source_fqid`、Artifact 摘要或 PackageCatalog 的旧发布不可自动重试，必须重新发布；设备图已写但重启失败需要回滚或人工选择；物理设备连接失败不得显示 `ready`。

### 5.2 设备包已缓存不等于设备可运行

| 状态 | 持久事实 | 用户能做什么 |
|---|---|---|
| `package_cached` | wheel 已下载且摘要/Catalog 校验通过 | 离线检查，尚不能认为设备已加入 |
| `configuration_required` | 已得到目标设备定义和初始化参数 | 填写串口/IP等配置 |
| `graph_staged` | 设备实例声明已原子写入目标设备图 | 等待启动或重启 OS |
| `driver_ready` | OS 已导入驱动并创建实例 | 检查在线状态和 Action |
| `ready` | `/api/v1/devices` 返回目标实例在线且 Action 合同可用 | 在 Electron 中选择并运行设备 Action |

### 5.3 本地设备实例声明

候选术语：本地设备实例声明（LocalDeviceInstanceDeclaration）。它是设备图中的持久节点，不是云端设备模板的副本。

最小结构：

```json
{
  "id": "local-pump-1",
  "uuid": "electron-generated-uuid",
  "name": "Local Pump 1",
  "type": "device",
  "class": "community.vendor_package.pump",
  "parent": null,
  "children": [],
  "position": {"x": 0, "y": 0, "z": 0},
  "config": {
    "endpoint": "serial:///dev/ttyUSB0"
  },
  "data": {},
  "extra": {
    "unilab": {
      "package_cache_key": "community.vendor_package@1.2.0#sha256:...",
      "definition_fqid": "community.vendor_package.pump"
    }
  }
}
```

设备模板 UUID 用于追溯云端来源；运行时类身份必须使用 PackageCatalog 中的规范 FQID。两者不能混用。`package_cache_key` 固定本实例已校验的精确 release wheel；后续下载同 namespace 新版本不能悄然改变既有设备的驱动来源。

### 5.4 状态机

```text
requested
  -> resolving
  -> downloading
  -> package_cached
  -> configuration_required
  -> graph_staged
  -> restart_required
  -> activating
  -> driver_ready
  -> ready

任一阶段 -> failed | canceled
ready -> removing -> removed
removed -> restart_required -> activating -> driver_ready -> ready
```

状态推进约束：

- 只有 Artifact 摘要和 PackageCatalog 都通过后才能进入 `package_cached`。
- 必填初始化参数未齐全时必须停在 `configuration_required`。
- 设备图写入成功不等于驱动已加载。
- 当前 OS 进程完成重启不等于设备已就绪。
- 只有目标实例出现在 `/api/v1/devices` 且 online/Action 合同满足时才能进入 `ready`。
- `activating` 和 `driver_ready` 不是可跨进程无限保留的稳定状态。Electron Main
  重启后，合法实例在 Edge 在线时重新执行设备与 Action 对账，Edge 未运行时回到
  `restart_required`；对账失败进入带原阶段诊断的 `failed`。
- 历史记录的实例 ID 不满足 ROS 2 节点名规则时，不再自动重启或重复写图，而是进入
  不可重试 `failed`，提示用户先移除旧实例，再用下划线 ID 重新接入。

## 6. 目标模块与接口

### 6.1 云端设备广场模块

在 `packages/services` 保持一个小接口：

```ts
interface CloudDeviceSquarePort {
  listDevices(query: DeviceSquareQuery): Promise<DeviceSquarePage>
  getDevice(templateUuid: string): Promise<CloudDeviceDetail>
  listPackages(): Promise<DevicePackageSummary[]>
  getPackage(packageName: string, page: number, pageSize: number): Promise<DevicePackageDetail>
}
```

生产使用现有 Backend HTTP Adapter，测试使用内存 Adapter。Renderer 不直接拼接 Backend URL。

列表每次请求固定正整数页码和页大小。Renderer 保存最近成功页码与已加载条数，仅在 `loadedItems < total` 时请求下一页；分页按 `templateUuid` 合并去重。搜索或刷新会开启新的请求代次，晚到的旧筛选响应不得覆盖当前目录。

### 6.2 本地设备接入模块

Electron Main 中建立深模块 `LocalDeviceProvisioningManager`：

```ts
interface LocalDeviceProvisioningManager {
  listCloudDevices(query: DeviceSquareListQuery): Promise<DeviceSquarePage>
  getCloudDevice(templateUuid: string): Promise<DeviceSquareDetail>
  start(templateUuid: string): Promise<LocalDeviceProvisioning>
  downloadOnly(templateUuid: string): Promise<DevicePackageDownloadSummary>
  configure(input: ConfigureLocalDeviceProvisioningInput): Promise<LocalDeviceProvisioning>
  activate(provisioningId: string): Promise<LocalDeviceProvisioning>
  retry(provisioningId: string): Promise<LocalDeviceProvisioning>
  remove(provisioningId: string): Promise<LocalDeviceProvisioning>
  restore(provisioningId: string): Promise<LocalDeviceProvisioning>
  list(): Promise<LocalDeviceProvisioning[]>
  inspectWorkspace(workspacePath: string): Promise<DevicePackageInspection>
  uploadWorkspace(input: DevicePackageUploadRequest): Promise<DevicePackageUploadResult>
}
```

该模块隐藏：

- 云端设备详情和包元数据解析；
- CLI executable、参数和工作目录；
- Artifact 下载、Catalog 和缓存；
- 初始化参数 Schema；
- 设备图备份、写入、回滚；
- 当前 OS 停止、启动和就绪等待；
- `/api/v1/devices` 对账；
- 本地状态、日志和错误脱敏。

Renderer 只提交模板 UUID、用户选择的实例 ID 和配置值，不能提交任意下载 URL、wheel 路径、Python module、可执行文件或完整 argv。

### 6.3 OS 设备包获取模块

当前 `package_manager.community` 深化为可被 Graph 启动和 CLI 共同调用的接口：

```python
acquire_community_package(descriptor, working_dir) -> AcquiredPackage
```

`AcquiredPackage` 返回已校验缓存引用、PackageCatalog、目标设备定义和配置描述；调用者不需要了解临时文件、缓存索引、摘要或 wheel 成员检查。

### 6.4 OS 设备图接入模块

新增一个设备图接入深模块：

```python
stage_device_instance(
    graph_path,
    package_catalog,
    definition_fqid,
    instance_id,
    instance_uuid,
    configuration,
) -> StagedDeviceInstance
```

该模块负责：

- 从 PackageCatalog 验证 definition FQID。
- 从初始化参数生成/验证配置 Schema。
- 拒绝未知参数、缺失必填项、重复实例 ID/UUID 和无效 graph。
- 保留现有 nodes、links 和扩展字段。
- 先写同目录临时文件并 fsync，再原子替换目标设备图。
- 在替换前保留可恢复备份。
- 返回 graph fingerprint 和新增节点摘要。

Electron 不自己拼设备图 JSON，避免 Graph Schema 规则在 TypeScript 和 Python 各维护一套。

## 7. “添加心愿单”详细流程

### 7.1 解析云端设备

```text
Renderer -> Main: start(templateUuid)
Main -> Backend: GET /square/detail/{templateUuid}
Main:
  校验 package_info
  解析 source_registry.source_fqid
  生成 provisioning_id
  持久化 requested
```

Main 必须重新请求设备详情，不能信任 Renderer 携带的 URL、摘要或 source FQID。

详情校验成功后，Main 必须先保存云端设备名称、显示名、包名、版本和可用摘要，再执行包兼容性解析。这样即使旧发布缺少 `source_fqid` 或 PackageCatalog，失败记录仍然可以被用户识别；这些展示字段只用于诊断，不能替代严格包候选和 OS 校验。

### 7.2 下载、校验和配置描述

```text
Main -> CLI: package download
CLI -> Backend: GET /packages/releases/{templateUuid}/download
Backend -> CLI: 302 OSS URL
CLI:
  下载临时 wheel
  校验 Artifact digest
  编译并校验 PackageCatalog
  唯一匹配目标设备 definition
  写入 community cache/index
  输出配置描述
CLI -> Main: package_cached + device descriptor
```

配置描述至少包含：

- distribution、version、namespace 和 Artifact 摘要；
- `definition_fqid`、显示名和 module/symbol；
- 初始化参数的名称、类型、必填、默认值和说明；
- 依赖列表；
- 建议实例 ID；
- 是否需要用户配置。

初始化 Schema 中“可选且默认值明确为 `null`”的 object 字段可以保持 `null`。FE
不得强迫用户填写空对象，OS 也不得在写图时把同一值误判为类型错误；必填字段或没有
nullable 默认合同的字段仍按原规则严格校验。

### 7.3 配置真实仪器

Electron 根据 CLI 返回的 Schema 渲染表单。常见字段包括：

- 串口路径和波特率；
- IP、端口和协议；
- 设备型号或通道；
- 本地数据目录；
- 驱动明确声明的账号/密钥。

敏感字段不能写入 Electron 普通日志、CLI argv、候选本地设备接入 Store 或设备图明文。PackageCatalog 中名称匹配 `password`、`secret`、`token`、`api_key` 等规则的字符串参数会投影为 `writeOnly: true` 与 `x-unilab-secret: true`；Renderer 使用不回显、不回填的密码输入框。Main 只在本次 IPC/CLI stdin 调用中持有明文，写图成功后只持久化非秘密配置。

OS `package add-device/update-device` 把秘密写入当前 `working_dir/device-secrets/v1/` 的随机 0600 文件，设备图只保存封闭的 `device-secret-ref/v1` 引用。`initialize_device_from_dict` 在驱动构造边界解析引用，明文只进入短生命周期 `driver_params`，不回写 Resource 投影。引用缺失、损坏、权限过宽、所有者不匹配或被替换为符号链接时失败关闭。秘密更新会创建新引用；旧引用保留以支持既有设备图备份恢复。

### 7.4 原子写入设备图

Main 把配置通过 stdin 交给 CLI：

```text
Main -> CLI: package add-device + config stdin
CLI:
  重新打开缓存 Catalog
  校验 definition/config/graph
  生成 UUID 和规范 graph node
  备份设备图
  原子写入
CLI -> Main: graph_staged + fingerprint + backup path
```

备份身份按解析后的完整设备图语义计算，不按 JSON 缩进、空白或键顺序计算。
如果同名备份已经存在且原始字节不同，OS 必须重新解析并确认设备图语义完全
一致后才能复用；既有备份属于另一张图、内容损坏、无法读取或是符号链接时仍
失败关闭，且不得覆盖备份或部分修改当前图。这保证编辑器只格式化 graph 后的
接管重试不会误报“设备图备份身份冲突”，同时保留恢复链路的不可覆盖边界。

打开设备接入工作区时，Renderer 先通过 Preload 读取
`device-provisioning-ipc/v2` 能力合同，并确认 Main 明确声明
`adoptExisting: true`。版本或功能不匹配时整个工作区失败关闭，
不显示任何写图或上传入口，并提示完全退出后重启（macOS 需
`Command+Q`，仅关闭窗口不会重启 Main）。这防止开发态 Renderer 热更新
后仍连接旧 Main/Preload，从而将已勾选的接管意图静默丢失。

调用 CLI 前，Main 先把用户确认的实例 ID、显示名称、生成的稳定 UUID 和脱敏后的
非秘密配置写入候选本地设备接入（LocalDeviceProvisioning）记录。这样写图失败后的
显式接管重试复用同一个 UUID；即使 OS 已完成原子写图而 Electron 随后异常，下一次
重放也不会生成第二个设备身份。秘密参数仍不进入该记录。

实例 ID 必须满足 ROS 2 节点名合同 `[A-Za-z_][A-Za-z0-9_]{0,127}`。Renderer
在提交前给出即时错误，Main IPC 与编排器不信任 Renderer 并再次校验，OS
`package add-device/update-device` 在读取缓存、创建备份或修改设备图前执行最终校验。
删除命令仍允许按原始 ID 移除历史非法节点，保证旧记录有安全退出路径。

如果实例 ID 已存在：

- 同一 provisioning 且内容一致时幂等成功；
- 同 ID、同 definition、UUID 为空的遗留节点只有在用户勾选“接管同名旧设备”且
  CLI 收到 `--adopt-existing` 时才补齐请求 UUID；接管保留旧节点的位置、父子关系、
  连接引用、运行数据和未知扩展字段，并更新用户确认的名称、配置和精确包缓存引用；
- 同 ID、不同 definition，或已有非空 UUID 与请求不一致时始终拒绝覆盖；
- 同 ID、同 UUID 但配置不同时仍拒绝普通新增；
- 接管成功后的同身份、同包、同配置重放幂等成功，既有位置、拓扑、运行数据和扩展
  字段不参与“是否同一接入声明”的比较，但也不会被重放修改；
- 用户必须选择新 ID 或显式进入“更新设备配置”流程。

### 7.5 受控重启和就绪确认

首版不使用在线 `add_device`：

1. Electron 显示“设备图已更新，需要重启本地 OS”。
2. 用户确认后，Main 停止当前 Edge 子进程。
3. Main 使用原有 LocalRuntime 配置和同一 graphPath 重新启动。
4. OS 通过图中的 `community.*` class 命中缓存、登记 PackageCatalog、加载依赖并创建设备实例。
5. Main 等待 OS health ready。
6. Main 查询 `/api/v1/devices`，按本地实例 ID 查找设备。
7. 找到实例、`online == true` 且 Action 合同可解码时进入 `ready`。

如果 Electron Main 在第 2～7 步之间退出、重载或崩溃，下一次读取本地接入记录时：

- Edge 已运行：直接重新读取 `/api/v1/devices`，目标实例及 Action 合同满足则恢复
  `ready`，否则进入可诊断 `failed`；
- Edge 未运行：恢复为 `restart_required`，等待用户再次确认受控重启；
- 历史实例 ID 不符合 ROS 2 合同：进入不可重试 `failed`，保留“恢复设备图备份”和
  “从本地移除”路径，不再永久显示“激活中”。

如果启动或实例初始化失败：

- 保留 CLI/OS 脱敏诊断；
- 提供“修改配置后重试”；
- 提供“恢复设备图备份并重新启动”；
- 未确认在线前不得显示“设备可运行”。

## 8. CLI 合同

### 8.1 仅下载命令

```bash
unilab --working_dir <managed-working-dir> \
  --addr <backend-base-url> \
  package download \
  --template-uuid <uuid> \
  --definition-fqid <community.namespace.device> \
  --artifact-digest <sha256:...> \
  --json
```

最终 JSON 示例：

```json
{
  "status": "package_cached",
  "cache_key": "community.vendor_package@1.2.0#sha256:...",
  "distribution": "vendor-package",
  "version": "1.2.0",
  "namespace": "community.vendor_package",
  "definition_fqid": "community.vendor_package.pump",
  "configuration_schema": {
    "type": "object",
    "required": ["endpoint"],
    "properties": {
      "endpoint": {"type": "string"},
      "password": {
        "type": "string",
        "writeOnly": true,
        "x-unilab-secret": true
      },
      "retries": {"type": "integer", "default": 3}
    }
  }
}
```

### 8.2 设备图接入命令

```bash
unilab --working_dir <managed-working-dir> \
  package add-device \
  --cache-key <cache-key> \
  --definition-fqid <community.namespace.device> \
  --instance-id <local-device-id> \
  --instance-uuid <electron-generated-uuid> \
  [--adopt-existing] \
  --graph <device-graph.json> \
  --config-stdin \
  --json
```

stdin 只接受固定 Schema：

```json
{
  "display_name": "Local Pump 1",
  "configuration": {
    "endpoint": "serial:///dev/ttyUSB0",
    "password": "本次 stdin 中的一次性明文",
    "retries": 3
  }
}
```

CLI 必须同时校验退出码和最终 JSON。第一期不要求重新设计 NDJSON；Electron 可以按子进程阶段展示不定进度，最终状态以 JSON 和本地 OS 对账为准。

`--adopt-existing` 是遗留兼容（Legacy Compatibility）的显式迁移开关，不是普通
覆盖开关。它只对同 ID、同 definition、UUID 为空的设备图节点生效，并要求请求携带
合法且未被其他节点使用的 UUID。开关缺失时，CLI 返回可行动诊断；旧节点已有非空
UUID、definition 不同或请求 UUID 已被占用时，即使提供该开关也失败关闭。

### 8.3 上传接口不变，CLI 增加 stdin 凭据入口

```bash
unilab package inspect --path <workspace> --json
unilab --working_dir <managed-working-dir> \
  --addr https://uni-lab.uat.bohrium.com/api/v1 \
  package upload --path <workspace> --auth-stdin --json
```

stdin 是单个封闭 JSON 文档：

```json
{
  "schema_version": "unilab-package-upload-auth/v1",
  "ak": "<Lab AK>",
  "sk": "<Lab SK>"
}
```

`--auth-stdin` 是 Electron 使用的新安全入口：CLI 不加载或执行 `local_config.py`，也不把 AK/SK 放入进程参数。遗留人工调用仍可继续使用既有 `--config` / `--ak` / `--sk`，但 Electron 不再暴露该方式。云端仍只接收原有 Lab Authorization、storage token、OSS PUT 和 `/lab/resource`，因此 Cloud/Backend 无接口变化。

## 9. Electron 页面与状态展示

### 9.1 设备广场

- 操作台顶部提供固定环境选择：测试、UAT、正式；Renderer 不能提交任意 Cloud URL。
- 操作：“添加心愿单”“仅下载设备包”“查看包详情”。
- “添加心愿单”旁明确提示：将下载驱动、配置仪器并重启本地 OS。
- 工具栏显示云端 `total`，列表底部显示“已显示 N / total”；存在下一页时显示“加载更多设备”。
- 搜索、刷新和继续加载共享同一筛选条件；分页响应按模板 UUID 去重，旧请求不能覆盖新搜索。
- 未选择设备图、OS 项目或 Conda 环境时，先引导完成 LocalRuntime 配置。

### 9.2 本地心愿单

心愿单页面现在是本地设备接入列表，而不是收藏列表。每条显示：

- 云端设备名称和模板来源；
- 来源环境及主机名；
- 包名、版本和摘要；
- 本地实例 ID；
- 当前设备图；
- `下载中 / 待配置 / 待重启 / 加载中 / 可运行 / 失败`；
- 在线状态和 Action 数量；
- 配置、重试、启动、停止接入和移除入口。

包兼容性失败也必须保留已读取的云端名称和包信息，不能退化为“未命名设备/等待解析”。`diagnostic.retryable=false` 时展示重新发布说明并隐藏“按失败阶段重试”；这类失败没有可由本机重复调用消除的瞬时条件。

### 9.3 可运行设备

进入 `ready` 后：

- 设备出现在 Electron 现有设备列表；
- 可打开设备 Action 面板或设备卡片工作台；
- Action 执行继续走当前 OS 的设备执行接口和安全规则；
- 心愿单只保存接入来源和状态，不成为设备执行权威。

## 10. 鉴权与安全边界

| 操作 | 当前鉴权 | 处理方式 |
|---|---|---|
| 云端设备/包浏览 | 公开 | Electron Main 使用受控 Backend Profile |
| 公开 Artifact 下载 | 公开 | CLI 使用模板 UUID并跟随 Backend `302` |
| 本地设备接入 | 本机权限 | Main + 受控 CLI；不访问 Backend 写接口 |
| 本地设备 Action | 当前 OS 本机接口 | 复用现有设备 Action 安全合同 |
| OSS 上传和 `/lab/resource` | Lab AK/SK | Main 通过 stdin 交给短生命周期 CLI HTTP client |
| `copy_resource` | 云端用户/Lab 鉴权 | 本期不调用 |

安全要求：

- CLI executable 必须来自用户选择并验证过的 Conda 环境。
- 所有子进程使用参数数组和 `shell: false`。
- 云端环境只能从测试、UAT、正式三项固定映射选择，不能由 Renderer 注入 URL。
- 上传 AK/SK 使用非持久化输入框，仅在一次 IPC/CLI 调用中使用；SK 在调用结束后立即清空。
- AK/SK 不进入 argv、`local_config.py`、本地接入 Store、设备图、请求诊断文件或普通日志；`base64(ak:sk)` 同样按秘密处理。
- 驱动秘密配置不进入 argv、候选本地设备接入 Store 或设备图明文；设备图只保存 `device-secret-ref/v1`，受管秘密文件在 POSIX 平台必须是当前用户所有且权限不宽于 0600。
- 驱动构造前无法证明秘密引用可信时失败关闭；不得回退到图内明文或普通环境变量，也不得把 Catalog 中的秘密默认值投影到 Electron 表单或设备图。
- stdin 凭据合同拒绝额外字段、空值、未知 schema 和超长值，错误正文不回显输入。
- 下载初始 host 必须匹配受控 Backend Profile；限制重定向次数和响应大小。
- Artifact 摘要缺失或不匹配时不得缓存或写设备图。
- 设备图路径必须等于当前 LocalRuntime 配置的 graphPath，Renderer 不能任意指定。
- 配置值不得扩展成 Python 表达式、shell 参数或任意 module path。
- 遗留设备节点身份接管必须由 Renderer 复选框、Main 布尔意图和 CLI
  `--adopt-existing` 三层一致确认；不得根据错误文本自动覆盖，也不得改变已有非空 UUID。
- Renderer 必须在首个设备接入请求前校验 Main/Preload 的
  `device-provisioning-ipc/v2` 能力；能力缺失或版本不同时禁止操作，
  不能将旧 Main 对未知字段的忽略当成兼容。
- 修改设备图前必须停止并确认没有正在执行的设备 Action；不能在物理动作运行中重启 OS。

## 11. 移除、更新与回滚

### 11.1 移除本地设备

“从心愿单移除”现在是有副作用的设备移除流程：

1. 确认目标设备没有运行中的 Action。
2. 从设备图原子删除对应实例节点及其连接。
3. 受控重启当前 OS。
4. `/api/v1/devices` 不再返回该实例后完成。

设备包缓存不立即删除，因为同一个包可能被其他设备实例使用。缓存清理应按引用计数或独立“清理未使用设备包”操作完成。

### 11.2 更新设备包或配置

- 修改配置：重新验证 Schema，更新设备图，重启并对账。
- 同包新版本：重新下载和校验，先保留旧缓存；新版本启动成功后再切换引用。
- 新版本启动失败：恢复旧图和旧缓存引用。
- 不允许直接覆盖正在运行实例的 driver module。

### 11.3 回滚

- graph 写入失败：目标文件保持原内容。
- OS 重启失败：提供一键恢复备份图。
- 新实例初始化失败：保留失败状态和配置，不自动执行真实 Action。
- 功能开关关闭时：本地接入记录只读保留，已在设备图中的实例继续由现有 OS 运行。

## 12. 仓库修改范围

| 仓库 | 是否修改 | 内容 |
|---|---|---|
| uni-lab-fe | 必须 | 设备广场、接入向导、接入状态列表、Main 编排、CLI Adapter、图/重启/就绪对账和 IPC |
| 当前 Uni-Lab-OS | 必须 | `package download`、配置 Schema、`package add-device`、设备图原子更新和测试 |
| uni-lab-backend | 不修改 | 只运行现有查询、下载和上传兼容回归 |
| Uni-Lab-Cloud | 不修改 | 只验证 Electron 上传后现有页面可见 |
| old-unilab-os代码 | 默认不修改 | 旧行为参考，不形成第二套实现 |

与上一版相比，当前 Uni-Lab-OS 不再是“只增加薄下载命令”，还需要提供设备配置和设备图接入 CLI；否则无法达到用户要求的“驱动加载后可以运行设备”。

## 13. 分阶段实现路线

实现状态：P1～P5 的代码和自动化合同均已落地；下面保留原分期作为实现/验收追踪。真实 Backend/OSS 凭据、云端新发布传播和物理仪器 Action 仍需目标环境验收。

### P0：冻结样例和本地接入合同，2～3 人日

- 保存现有设备详情、包信息、`302` 下载和 PackageCatalog fixture。
- 选择一个包含真实初始化参数的测试设备包。
- 同时保存一个旧 tar.gz/缺 Catalog 包 fixture，冻结“不兼容并引导重新发布”的行为。
- 冻结候选本地设备接入状态机、CLI JSON 和退出码。
- 冻结设备图节点最小 Schema、备份和原子替换规则。
- 确认测试环境 graphPath、Conda 环境和安全的虚拟/测试仪器。

退出条件：能够从一个模板 UUID 唯一得到包、definition FQID 和配置字段。

### P1：OS 下载与配置描述（已实现）

- 从 `community.py` 抽出公开设备包获取接口。
- 实现 `package download`。
- 将 PackageCatalog `init_parameters` 投影为固定 JSON Schema。
- 覆盖摘要、Catalog、目标 definition、缓存命中和旧模板缺字段。

退出条件：CLI 下载完成后返回足够的设备配置描述，且没有修改设备图。

### P2：OS 设备图接入（已实现；物理仪器待验收）

- 实现 `stage_device_instance` 深模块和 `package add-device`。
- 实现参数、实例身份、Graph Schema 和重复节点校验。
- 实现 UUID 为空的同定义遗留节点显式接管，并保留其拓扑、运行数据和扩展字段。
- 实现同目录备份、fsync、原子替换、删除和恢复。
- 用真实 OS 启动验证 graph -> Catalog -> registry -> driver instance 链路。

退出条件：命令写入测试图后，重启 OS 能在 `/api/v1/devices` 查询到实例和 Action。

### P3：Electron 广场与接入向导（已实现）

- 实现 test/UAT/production 固定环境选择，并将来源环境绑定到接入记录与重试。
- 实现现有 Backend 设备广场 Adapter 和页面。
- 实现基于 `total/page/page_size` 的完整分页、模板 UUID 去重和搜索请求代次隔离。
- 实现 `LocalDeviceProvisioningManager`、本地持久化和最小 IPC。
- 实现下载进度、配置表单、实例 ID 和 graphPath 确认。
- 在包兼容性解析前保存云端展示详情，并区分可重试失败与旧发布不可重试失败。
- Renderer 只提交稳定意图，Main 重新解析云端详情和 CLI 路径。

退出条件：点击“添加心愿单”可以走到 `restart_required`，且设备图已安全写入。

### P4：受控重启与可运行确认（已实现；真实 UAT mock 已验收）

- 接入现有 LocalRuntime stop/start/readiness。
- 增加“运行中 Action 禁止重启”门禁。
- 通过 `/api/v1/devices` 对账实例、online 和 Action。
- 实现失败诊断、修改配置、恢复图和重试。

退出条件：真实 Electron 中新增设备进入现有设备列表，并可以显式调用安全测试 Action。

### P5：上传闭环与真实 E2E（真实 UAT Cloud/OSS 已验收）

- 接入现有 inspect/upload。
- 用一次性 stdin AK/SK 替代 Electron 的 `local_config.py` 选择，不在 argv 或日志中暴露秘密。
- 上传后用同一环境的现有设备广场接口确认可见性。
- 覆盖真实 Backend、OSS、Conda、设备图和测试仪器。
- 验证 Electron 与 Uni-Lab-Cloud 都能看到上传包。

实现已完成，不再使用原工期估算。2026-08-06 已在
`https://uni-lab.uat.bohrium.com/api/v1` 上传并发布
`community.unilab_szlab_mock@0.1.0`，随后通过 Electron 从同一 UAT 设备广场发现、
下载、配置、写图并启动真实 Edge；后续工作量只取决于物理仪器和对应业务 Action
的部署环境验收。

## 14. 测试矩阵与验收

| 层级 | 必测内容 |
|---|---|
| Backend 兼容回归 | list/detail/packages、公开 `302`、storage token 和 `/lab/resource` 不变 |
| Package 获取模块 | 摘要、Catalog、大小限制、definition 匹配、缓存命中和临时文件清理 |
| 设备图接入模块 | Schema、必填参数、ROS 2 实例 ID、重复 ID、原子写入、备份、恢复、删除和扩展字段保留 |
| OS 启动集成 | cache -> sys.path -> Catalog -> registry -> driver import -> instance |
| CLI 子进程 | stdin 设备配置/上传凭据、最终 JSON、退出码、取消和日志脱敏 |
| Electron Main | 版本化 IPC 能力握手、三环境固定映射、executable allowlist、`shell: false`、瞬时激活状态恢复、重启门禁和 Action 对账 |
| Electron UI | 环境切换、完整分页、搜索代次隔离、下载、配置、待重启、加载中、可运行、失败和移除 |
| 跨仓 E2E | 广场 -> 添加心愿单 -> 配置 -> 重启 -> 在线 -> Action；Workspace -> 上传 -> 广场可见 |

截至 2026-08-07 的自动化验证记录：

| 命令/范围 | 结果 |
|---|---|
| `Uni-Lab-OS: pytest tests/package_manager -q` | 97 passed；含 ROS 2 实例 ID 写图前拒绝、设备图语义相同备份复用与异图备份拒绝回归 |
| `Uni-Lab-OS: pytest tests -q` | 2647 passed、7 skipped；68 条既有弃用/收集 warning，无失败 |
| `uni-lab-fe: pnpm typecheck` | 20 个工作区项目全部通过 |
| `uni-lab-fe: pnpm test` | 全部带测试脚本的工作区包通过；其中 services 119、kernel-web 67、desktop 97；覆盖遗留瞬时激活状态恢复 |
| `uni-lab-fe: pnpm build:desktop` | 生产 Main、Preload、Renderer 构建通过 |
| `xvfb-run -a env UNILAB_E2E_ELECTRON=1 pnpm exec playwright test e2e/device-square-electron.spec.ts` | 1 passed；覆盖生产 Electron Main/Preload/Renderer v2 能力握手、45 条设备完整分页、详情保持、显式接管默认关闭、旧包不可重试诊断及桌面/紧凑截图 |
| `Uni-Lab-OS: pytest tests/package_manager/test_szlab_mock_package.py tests/package_manager/test_device_provisioning.py tests/package_manager/test_package_upload_auth.py -q` | 26 passed；覆盖可选 nullable 配置、mock Catalog、设备图写入、接入和 stdin 上传鉴权合同 |
| `uni-lab-fe: pnpm --filter @unilab/kernel-web test` | 15 files、67 tests passed；覆盖 nullable 表单值与 ROS 安全实例 ID |
| `xvfb-run -a env UNILAB_E2E_ELECTRON=1 UNILAB_E2E_CONDA_ENV=... UNILAB_E2E_OS_ROOT=... pnpm exec playwright test e2e/device-square-uat-real-edge.spec.ts` | 1 passed；真实 UAT 设备广场、OSS 下载、写图、Edge health 和 4 个 Action 对账 |

本轮截图保存在 `e2e-artifacts/device-square-electron/` 和
`e2e-artifacts/device-square-uat-real-edge/`：

- `device-square-desktop.png`：加载第二页后显示 `45 / 45`，右侧设备详情保持可见。
- `device-square-legacy-package.png`：旧包保留“旧版分液器”名称、包版本和重新发布诊断，不提供无效重试按钮。
- `device-square-compact.png`：紧凑窗口下列表与详情保持可操作。
- `device-package-upload-desktop.png`：测试/UAT/正式环境选择、一次性 Lab AK/SK 和现有 CLI 上传入口；不再选择 `local_config.py`。
- `device-square-uat-real-edge/05-uat-mock-edge-ready.png`：真实 UAT mock 包已加入本地、Edge 已连接、设备在线且 4 个 Action 可用。

常规自动化使用兼容 Backend fixture 和虚拟设备目录，证明协议、IPC、状态机与界面链路；
`device-square-uat-real-edge.spec.ts` 额外覆盖真实 Lab 鉴权后已发布的 UAT 数据与真实 OSS，
且测试代码、截图、设备图和日志均不保存 AK/SK。mock 驱动只证明运行合同，不替代物理
仪器连接和真实业务 Action 验收。

核心验收场景：

1. 点击“添加心愿单”会实际下载并校验设备包，而不是只写元信息。
2. Artifact 摘要错误或 Catalog 无效时不写设备图。
3. 遗留 tar.gz 或缺 Catalog 的包标记不兼容，不尝试作为 Python 驱动加载。
4. 旧包不兼容时仍显示云端设备名称和可用包身份，诊断为不可自动重试。
5. 云端返回 45 条设备时，首屏 40 条可继续加载到 45 条且没有重复模板。
6. 必填串口/IP缺失时停在“待配置”，不启动设备。
7. 配置通过后，设备实例声明进入用户当前选择的 graphPath。
8. Graph 写入失败不破坏原文件。
9. 当前存在运行中的设备 Action 时拒绝自动重启。
10. 重启 OS 后目标设备出现在 `/api/v1/devices`，并有预期 Action。
11. 驱动导入或连接失败时不得显示“可运行”，可修改配置后重试。
12. 移除设备后 graph 不再包含实例，重启后本地设备目录也不再包含它。
13. 仅下载设备包不会修改 graph 或重启 OS。
14. 上传仍只使用现有 storage token、OSS PUT 和 `/lab/resource`。
15. 测试、UAT、正式环境的浏览、下载、接入和上传使用同一明确环境，接入重试不漂移。
16. 上传 AK/SK 不进入 argv、`local_config.py`、持久状态、请求诊断和普通日志；非法 stdin 合同失败关闭且不回显秘密。
17. 含 `password` 的当前 wheel 可以下载并显示密码框；写图后图文件和本地接入 Store 均不含明文，驱动构造时能从受管引用得到该值。
18. 秘密文件缺失、权限过宽、引用损坏或符号链接替换时，OS 启动驱动失败关闭且错误不回显秘密。
19. 同 ID、同 definition 且 UUID 为空的遗留节点在未确认接管时失败；确认后补齐稳定
    UUID 并保留位置、父子关系、连接、运行数据和扩展字段；已有不同 UUID 始终拒绝覆盖。
20. 新 Renderer 与旧 Main/Preload 混合运行时，设备接入工作区在任何 CLI
    调用前失败关闭，显示完整重启指引；同版本组合则返回
    `device-provisioning-ipc/v2` 且接管写图 argv 必须包含 `--adopt-existing`。
21. 同一设备图仅改变 JSON 排版后再次写图时复用原备份并成功接入；同名备份
    损坏、是符号链接或解析后属于不同设备图时仍失败关闭，且当前图保持不变。
22. Electron Main 在 `activating`/`driver_ready` 阶段中断后，合法实例会按当前
    Edge 与设备目录恢复为 `ready`、`restart_required` 或 `failed`，不得永久显示
    “激活中”；历史横线 ID 变成不可重试失败，且 OS 对新横线 ID 在写图前拒绝。

最终验收不是“文件已经下载”，而是：

```text
已校验设备包
  + 有效设备实例配置
  + 设备图持久化
  + 当前 OS 成功创建实例
  + Electron 可查询在线设备和 Action
  = 本地设备接入成功
```

## 15. 接受的限制

在 Cloud/Backend 零修改约束下，明确接受：

1. 云端下载标识仍是设备模板 UUID，不是不可变 release UUID。
2. 上传 OSS PUT 和 `/lab/resource` 不是原子事务，也没有 `finalize`。
3. 上传依赖权威实验室 Lab AK/SK，Electron OAuth 不能替代。
4. 首版新增根设备需要受控重启当前 OS，不支持在线热加载。
5. “可运行”依赖设备包提供正确驱动和用户提供正确物理连接配置。
6. `/api/v1/devices` 能证明实例和 Action 已加载，但部分驱动仍需额外安全连接探测才能证明真实硬件可达。
7. 本地设备接入不跨电脑同步。
8. 删除实例不立即清理共享包缓存或 Python 依赖。
9. Electron 当前只使用一次性 AK/SK，不提供“记住凭据”；若以后增加，必须接入操作系统凭据库而不是明文文件。
10. 旧 tar.gz 或缺少内嵌 PackageCatalog/摘要的历史设备包不能直接接入当前 OS，需要使用当前 CLI 重新构建上传。
11. 本地设备秘密存储依赖操作系统账户与文件权限隔离，当前不是系统 Keychain，也不承诺密文静态存储；需要更高合规等级时应把同一 `device-secret-ref/v1` 解析端口替换为系统凭据库实现。

如果产品以后要求无重启热加载、跨电脑同步、稳定不可变发布或云端接入状态，再分别设计 OS 在线设备管理和 Backend 持久合同；本期不隐藏引入这些新能力。

## 16. 建议文件落点与开发票

### uni-lab-fe

```text
packages/services/src/deviceSquare.ts
packages/device-provisioning/
apps/desktop/src/main/localDeviceProvisioningManager.ts
apps/desktop/src/main/devicePackageCliAdapter.ts
apps/desktop/src/preload/deviceProvisioning.ts
apps/kernel-web/src/integrations/device-provisioning/
```

### 当前 Uni-Lab-OS

```text
unilabos/package_manager/community.py
unilabos/package_manager/device_provisioning.py
unilabos/package_manager/cli.py
tests/package_manager/test_cli_download.py
tests/package_manager/test_device_provisioning.py
tests/package_manager/test_device_graph_activation.py
```

推荐开发票：

1. OS：设备包获取公开接口、`package download` 和配置 Schema。
2. OS：设备图接入深模块、`package add-device`、备份/恢复和真实启动测试。
3. Electron：设备广场 Adapter 与现有接口 fixture。
4. Electron：本地设备接入状态、配置向导和 Main/IPC。
5. Electron：受控重启、运行中 Action 门禁和 `/api/v1/devices` 对账。
6. Electron：移除/更新/回滚流程。
7. Electron + OS：真实测试设备“添加心愿单 -> 可运行 Action”E2E。
8. Electron：复用现有上传链路和上传后广场可见性验证。

本路线仍不包含任何 uni-lab-backend 或 Uni-Lab-Cloud 开发票。
