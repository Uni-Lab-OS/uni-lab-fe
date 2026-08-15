# Electron 内嵌 Backend 原型

> PROTOTYPE — 可丢弃。该目录只回答“Go Backend 二进制能否作为 Electron
> `extraResources` 被打包、从安装资源目录启动、自动迁移 SQLite，并在重启后继续读取同一数据库”。
> 它不是正式的桌面运行时实现。

## 一键运行

在 FE 仓库根目录执行：

```bash
pnpm prototype:embedded-backend
```

默认会从相邻 `local-246-backend` 或 `uni-lab-backend` 工作树构建 Backend；也可显式指定：

```bash
UNILAB_BACKEND_ROOT=/path/to/uni-lab-backend \
UNILAB_OS_ROOT=/path/to/Uni-Lab-OS \
pnpm prototype:embedded-backend -- --keep
```

`--keep` 保留临时解包产物和用户数据，默认运行结束后删除。原型只做当前原生平台构建；
Backend 当前使用 CGO SQLite，不能把一台 Linux 主机上的构建当作 macOS/Windows 产物。

## 原型验证的候选设计（Candidate Design）

```text
Electron 安装包
└─ resources/backend/
   ├─ manifest.json
   └─ <platform>-<arch>/unilab-backend[.exe]

Electron main（原型进程所有者）
├─ 从 resourcesPath 读取并校验 manifest
├─ 只绑定 127.0.0.1:<动态端口>
├─ DATABASE_DSN = app userData/backend/unilab.db
├─ stdout/stderr = app userData/logs/backend-generation-*.log
├─ GET /api/v1/health 就绪门
├─ 使用默认 Web 安全策略验证 file renderer 直连是否通过 CORS
└─ 停止 → 同库重启 → 再次读取工作流目录
```

二进制必须位于 asar 外部；SQLite 迁移已经编译进 Go 二进制，因此安装包不需要携带
Backend 源码或 SQL 文件目录。

当前 Backend 没有额外开放 CORS；原型会如实记录默认 Web 安全策略下的
`rendererDirectFetch`。Linux Electron 33 的 `file://` 探针当前可以直连回环 Backend，
但正式 Workbench 仍应复用既有受信任同源代理来冻结动态地址和权威选择。无论探针结果
如何，都不要通过关闭 Electron `webSecurity` 或允许任意 Origin 解决连接问题。

## 结论边界

当前 Backend 的 HTTP 进程支持 SQLite，原型可以验证资源、工作流定义和 HTTP 读写面的
本地持久化。但持久调度器（Scheduler）只支持 PostgreSQL，并且按已接受 ADR 与 HTTP
进程分离。因此本原型不能证明以下能力：

- Backend 控制模式下的工作流任务（WorkflowTask）推进；
- Edge WebSocket 控制面、作业执行占用（JobExecutionClaim）和崩溃恢复；
- macOS 签名/公证、Windows 签名与杀毒软件兼容；
- Electron 窗口退出后继续持有生产执行生命周期。

正式方案若要提供完整 Backend + Scheduler，应让独立监督器（Supervisor）而不是窗口
生命周期拥有 Backend HTTP、Scheduler 和 PostgreSQL 三个进程；Electron 只负责安装、
显式启动/停止、状态展示和完整 Profile 切换。否则会把工作流任务权威（WorkflowTask
Authority）错误绑定到 UI 进程。

## 方案比较

| 候选方案 | 能力 | 主要代价 | 判断 |
|---|---|---|---|
| Electron 子进程 + Backend HTTP + SQLite | 本地资源、模板、工作流定义与 HTTP 读写；自动迁移和重启恢复 | 没有持久调度器（Scheduler）和 Edge 控制面 | 可作为第一阶段开发/单机数据服务 |
| Electron 直接拥有 Backend HTTP + Scheduler | 表面上一键启动 | 窗口退出、崩溃或更新会切断权威进程；Scheduler 仍缺 PostgreSQL | 不采用 |
| 独立监督器（Supervisor）+ Backend HTTP + Scheduler + PostgreSQL/TimescaleDB | 完整生产调度、Edge 控制和持久恢复 | 三类原生 payload、数据库升级/备份、签名、公证和恢复门禁 | 目标设计（Target Design）候选 |
| 保持外部 Backend，Electron 只连接 | 现有生产权威语义最清楚 | 不满足完全离线的一键安装 | 继续作为远程/集中部署模式 |

## 接入现有三个仓库

- FE：Backend 二进制使用与现有 Runtime 相同的 manifest + SHA-256 资源合同，但应放在
  独立 `resources/backend`。Kernel Web 已能通过 `backend=local-go&backendUrl=...`
  选择完整 Profile；Theia Workbench 已有 `UNILAB_BACKEND_PROXY_TARGET` 同源代理。
- OS：完整 Backend 控制模式必须使用 `--control_plane backend --app_bridges
  edge_control fastapi`。当前本地分端口规则会从 Backend HTTP 端口推导
  `Scheduler = HTTP + 1`，所以两项端口必须作为同一个启动计划分配。
- Backend：同一个 Go 二进制用 `server` 和 `scheduler` 两个子命令启动。HTTP 可用 SQLite；
  Scheduler 明确要求 PostgreSQL，并依赖 TimescaleDB 迁移，不能静默降级到 SQLite。

## 建议的交付顺序

1. 先把本原型的 payload 清单、回环绑定、用户数据目录、日志和就绪门沉淀为正式
   `DesktopBackendInstallation`，只声明 Backend HTTP + SQLite 已支持的能力。
2. 把进程所有权下沉到现有私有运行时监督器（Supervisor），Electron 窗口只连接，关闭
   窗口不自动终止正在执行的权威服务。
3. 再设计 PostgreSQL/TimescaleDB 原生 payload、备份/恢复、schema 升级失败回滚和
   `server`/`scheduler` 联合就绪门；完成前不得让 OS 切入 `backend_controlled`。
4. 分别在 Linux、macOS Intel、macOS Apple Silicon、Windows 原生主机验证 CGO 二进制、
   文件权限、签名、公证、安装/卸载、升级和崩溃恢复。
