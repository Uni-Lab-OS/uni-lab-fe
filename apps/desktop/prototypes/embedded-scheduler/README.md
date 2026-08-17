# Electron 内嵌 Backend + 调度器原型

> PROTOTYPE — 可丢弃。本目录只回答：“PostgreSQL/TimescaleDB、Backend HTTP
> 与调度器（Scheduler）能否作为原生载荷进入同一个 Electron 安装目录，并完成联合
> 就绪、单实例门禁、同库整栈重启和逆序停机？”它不是正式桌面运行时。

## 一键运行

在 FE 仓库根目录执行：

```bash
pnpm prototype:embedded-scheduler
```

当前原型只支持并验证 Linux x64，要求主机已有 PostgreSQL 14、`pg_config`、Git、
CMake、GCC、`apt-get` 和 `dpkg-deb`。首次运行会在用户缓存中从官方固定 tag 构建
TimescaleDB 2.19.3；只下载并解开开发头文件，不向系统安装包。后续运行复用缓存。

可覆盖输入路径并保留本轮临时产物：

```bash
UNILAB_BACKEND_ROOT=/path/to/uni-lab-backend \
UNILAB_OS_ROOT=/path/to/Uni-Lab-OS \
UNILAB_POSTGRES_ROOT=/usr \
UNILAB_TIMESCALE_ROOT=/path/to/staged/usr \
pnpm prototype:embedded-scheduler -- --keep
```

## 判定

技术上可以一起安装，但不能把两个 Backend 子命令合并成一个进程。

- 已接受决策（Accepted Decision）：`unilab server` 与 `unilab scheduler` 是两个
  独立进程，共享一个 PostgreSQL；调度器（Scheduler）通过 PostgreSQL advisory
  lock 保证当前只有一个权威实例。
- 当前原型实现（Prototype Implementation）：打包后的 Electron 临时拥有
  PostgreSQL、Backend HTTP 和调度器（Scheduler），用于验证原生资源和生命周期。
- 目标设计（Target Design）：正式产品由独立监督器（Supervisor）拥有三个进程，
  Electron 窗口只安装、连接、显示状态并发出显式启停命令。窗口关闭不得改变既有
  工作流任务（WorkflowTask）的调度权威。

## 打包布局

```text
Electron Resources/
└─ runtime/
   ├─ manifest.json                 # 平台、版本、提交与 521 个文件摘要
   ├─ backend/linux-x64/
   │  └─ unilab-backend             # server 与 scheduler 共用
   ├─ postgres/linux-x64/root/
   │  ├─ usr/lib/postgresql/14/bin/ # initdb/postgres/psql 等最小命令集
   │  ├─ usr/lib/postgresql/14/lib/ # plpgsql、dict_snowball、TimescaleDB
   │  ├─ usr/share/postgresql/14/   # initdb 与扩展 SQL
   │  └─ runtime-lib/               # 非 glibc ELF 依赖
   └─ licenses/
      └─ PROTOTYPE-NOTICES.txt
```

所有原生文件位于 asar 外。Electron 启动前逐文件检查路径边界、字节数和 SHA-256，
并恢复可执行权限。原型显式 `jit=off`，不携带 PostgreSQL LLVM JIT/bitcode；Linux
载荷仍依赖主机 glibc ABI，不能称为跨发行版静态包。

## 被验证的生命周期

```text
初始化 SCRAM 凭据（0600）与 PostgreSQL cluster
  → PostgreSQL 仅监听 127.0.0.1 + 私有 Unix socket
  → Backend HTTP 自动执行迁移并通过 /api/v1/health
  → 调度器（Scheduler）通过 /health/live 与 /health/ready
  → 第二个 Scheduler：live=200、ready=503
  → file renderer 在默认 webSecurity 下读取 Backend health
  → Scheduler → Backend HTTP → PostgreSQL 逆序停机
  → 同一 cluster、全新动态端口整栈重启
  → 再次联合就绪并逆序停机，残留进程数为 0
```

调度器（Scheduler）端口始终等于 Backend HTTP 端口加一，与 OS `bug-fix-wt`
当前 Backend 控制启动推导保持一致。只有整栈联合就绪后，OS 才可显式选择后端控制
调度权威运行模式（SchedulerAuthorityProfile：`backend_controlled`）；不得因某个
本地端口暂时可用而自动切换权威。

## Linux 实测证据

冻结输入：FE `bug-fix-wt@04f0874` 上的 throwaway 原型分支、OS
`bug-fix-wt@ca7bdc7`、Backend `feat/workflow@114a32ee`。

- Electron 33.4.11 / Linux x64 的实际 `electron-builder --dir` 产物通过。
- 瘦身后原生 runtime payload 为 131,860,126 bytes，共 521 个完整性条目。
- PostgreSQL 14.23、TimescaleDB 2.19.3；Backend schema migration 为 78。
- `material_state_history` 被确认是 TimescaleDB hypertable。
- 两个完整世代的 Backend health、Scheduler live/ready 均为 HTTP 200。
- 第二个 Scheduler 为 live HTTP 200、ready HTTP 503，单实例 advisory lock 生效。
- 同一 cluster 两次停机后的字节数均为 57,268,358，重启未新建权威数据库。
- renderer 直连 health 返回 HTTP 200；逆序停机后受监督进程数为 0。

## 尚未被证明

- 未连接真实 Edge，因而没有证明工作流任务（WorkflowTask）派发、作业执行占用
  （JobExecutionClaim）、投递重放（DeliveryReplay）或物理结算
  （PhysicalSettlement）。联合 ready 不等于实验动作端到端成功。
- 没有验证断电/WAL 损坏恢复、备份还原、schema 失败回滚或跨版本数据库升级。
- 没有验证 Windows service、macOS launchd、Intel/Apple Silicon、签名、公证、
  杀毒软件、安装/卸载和操作系统登录后恢复。
- 当前 PostgreSQL 14 + TimescaleDB 2.19.3 只为匹配本机 ABI。TimescaleDB 2.19.3
  是 PostgreSQL 14 的最后修复线；正式载荷应选择仍受支持的 PostgreSQL 16/17 组合。
- Apache-only TimescaleDB 能完成当前迁移和调度器（Scheduler）就绪，但首次启动会让
  TimescaleDB 内部 `Job History Log Retention Policy` 记录一次 license 功能错误。
  正式产品必须在“取得适用许可/使用完整发行物”与“移除 Backend 对 TimescaleDB 的
  强依赖”之间做明确决策，不能把该日志静默当成生产健康。
- 原型只带技术 notice，不满足 SBOM、第三方许可证归档、漏洞扫描或供应链签名门禁。

## 正式监督器边界

建议把以下最小接口沉淀到既有私有运行时监督器（Supervisor），不要复制到 renderer：

```text
install(profile)  → 校验平台、签名、manifest 与磁盘空间
start(profile)    → PostgreSQL → Backend HTTP → Scheduler 联合就绪
status(profile)   → installed/stopped/starting/ready/degraded/failed
stop(profile)     → 拒绝不安全停机或执行 Scheduler → HTTP → PostgreSQL
backup(profile)   → 数据库一致性备份与恢复证据
upgrade(profile)  → 备份 → 原生载荷切换 → migration → 健康门 → 可证明回滚
```

监督器状态必须独立于窗口生命周期；数据库凭据、动态端口和日志路径只通过受限本地接口
暴露必要投影。若停止时仍存在未完成工作流任务（WorkflowTask）或物理不确定性，应关闭
失败（fail closed），而不是因 Electron 退出直接杀进程。
