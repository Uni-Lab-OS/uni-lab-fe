---
goal: Desktop Production and Test Release Channels
version: 1.0
date_created: 2026-08-19
last_updated: 2026-08-19
owner: UniLab Frontend Team
status: 'Completed'
tags: [infrastructure, ci, electron, release, update]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

本方案将 Windows 与 macOS 桌面构建统一为两个明确通道：`main` 生成生产包并维护滚动热更新，`deploy-windows-test` 与 `deploy-mac-test` 生成可安装测试包但永久禁用热更新。

## 1. Requirements & Constraints

- **REQ-001**: 每次 push 到 `main` 时，`.github/workflows/package-windows.yml` 与 `.github/workflows/package-macos.yml` 必须分别执行完整生产构建。
- **REQ-002**: push 到 `deploy-windows-test` 时只能构建 Windows 测试安装包；push 到 `deploy-mac-test` 时只能构建 macOS 测试安装包。
- **REQ-003**: 生产包必须启用 Electron 自动更新，并分别使用 `workbench-windows-stable` 与 `workbench-macos-stable` 滚动 Release。
- **REQ-004**: 测试包文件名与 Actions Artifact 名称必须包含 `Test` 或 `test`，不能与生产包混淆。
- **REQ-005**: 测试包默认连接 Bohrium 测试登录/API，生产包默认连接 Bohrium 正式登录/API；两者必须由同一个编译期发布通道选择。
- **REQ-006**: macOS 测试通道只生成 DMG，生产与测试 Actions Artifact 都只交付 DMG；生产滚动 Release 仍保留自动更新必需的 ZIP、blockmap 与 `latest-mac.yml`。
- **SEC-001**: 测试包必须在 Electron 主进程编译期关闭更新能力，不能依赖运行时环境变量或仅依赖 CI 不上传元数据。
- **SEC-002**: GitHub Release 上传步骤和正式版本递增步骤必须以 `UNILAB_WORKBENCH_RELEASE_CHANNEL == 'production'` 为必要条件。
- **SEC-003**: Windows 所有完整构建暂时使用当次 CI 生成的临时自签名证书，并必须校验安装包签名证书与当次证书指纹完全一致。
- **CON-001**: macOS 测试包继续使用现有 Developer ID 签名和 Apple 公证材料，以保证测试安装行为与生产包一致。
- **CON-002**: Windows 与 macOS 生产更新继续复用既有稳定 Release tag 和下载 URL，不创建第二套生产更新源。
- **GUD-001**: 正式发布必须先上传安装二进制与 blockmap，最后替换更新元数据，避免客户端观察到不完整版本。
- **PAT-001**: 所有构建入口统一使用 `UNILAB_WORKBENCH_RELEASE_CHANNEL=production|test`，无效值必须失败关闭。

## 2. Implementation Steps

### Implementation Phase 1

- **GOAL-001**: 建立应用内发布通道合同并区分测试产物。

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | 在 `apps/workbench/scripts/packaging-mode.mjs` 增加 `resolveWorkbenchReleaseChannel`，只接受 `production` 与 `test`。 | ✅ | 2026-08-19 |
| TASK-002 | 在 `apps/desktop/electron.vite.config.ts` 将发布通道编译为 `__UNILAB_WORKBENCH_RELEASE_CHANNEL__`，在 `apps/desktop/src/main/index.ts` 仅为 `production` 启用 `AppUpdateManager`，并由 `apps/desktop/src/main/authConfig.ts` 选择同通道登录/API。依赖 TASK-001 的通道值合同。 | ✅ | 2026-08-19 |
| TASK-003 | 在 `apps/workbench/scripts/package-portable.mjs` 与 `apps/workbench/scripts/package-macos.mjs` 为测试通道生成包含 `Test` 的安装介质文件名。依赖 TASK-001。 | ✅ | 2026-08-19 |

### Implementation Phase 2

- **GOAL-002**: 将 GitHub Actions 入口切换为 `main` 生产通道与两个测试分支。

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | 修改 `.github/workflows/package-windows.yml`：`main` 和 `deploy-windows-test` push 均执行 full，只有 `main` 读取正式版本并发布滚动更新。 | ✅ | 2026-08-19 |
| TASK-005 | 修改 `.github/workflows/package-macos.yml`：`main` 和 `deploy-mac-test` push 均执行 signed full，只有 `main` 生成并发布 ZIP 自动更新介质。 | ✅ | 2026-08-19 |
| TASK-006 | 修改两个工作流的 Artifact 名称、步骤摘要与 Release 描述，使生产和测试通道可直接辨认；macOS Actions Artifact 只包含 DMG。依赖 TASK-004 与 TASK-005。 | ✅ | 2026-08-19 |

### Implementation Phase 3

- **GOAL-003**: 建立分支并关闭实现验证。

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | 从包含本方案实现的同一提交创建 `deploy-windows-test` 与 `deploy-mac-test` 本地分支。 | ✅ | 2026-08-19 |
| TASK-008 | 执行仓库类型检查、桌面与 Workbench 单元测试、YAML 解析、工作流 Shell 语法检查及方案标识符唯一性检查。 | ✅ | 2026-08-19 |
| TASK-009 | 更新本文件为 `Completed`，填写所有任务完成日期并提交实现。依赖 TASK-001 至 TASK-008。 | ✅ | 2026-08-19 |

## 3. Alternatives

- **ALT-001**: 仅通过“不上传测试 Release”阻止热更新。未采用，因为测试包仍会包含正式更新 URL，未来 CI 条件回归时可能误发布或误更新。
- **ALT-002**: 为测试包维护独立热更新 Release。未采用，因为当前要求明确规定只有生产包走热更新。
- **ALT-003**: 继续使用 `deploy-windows` 与 `deploy-mac` 作为生产入口。未采用，因为生产触发源必须收敛到受保护的 `main`。

## 4. Dependencies

- **DEP-001**: GitHub Actions 的 `windows-2022` 与 `macos-14` runner。
- **DEP-002**: macOS Actions secrets：`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。
- **DEP-003**: 预创建的 GitHub Releases：`workbench-windows-stable` 与 `workbench-macos-stable`。
- **DEP-004**: `electron-builder` 的 generic provider、NSIS、DMG、ZIP 与 blockmap 生成能力。
- **DEP-005**: Windows runner 必须支持 `New-SelfSignedCertificate`、`Export-PfxCertificate` 与 Authenticode 签名校验。

## 5. Files

- **FILE-001**: `.github/workflows/package-windows.yml`，Windows 生产/测试触发、版本、Artifact 与发布门禁。
- **FILE-002**: `.github/workflows/package-macos.yml`，macOS 生产/测试触发、签名、版本、Artifact 与发布门禁。
- **FILE-003**: `apps/desktop/electron.vite.config.ts`，主进程发布通道编译常量。
- **FILE-004**: `apps/desktop/src/main/index.ts`、`apps/desktop/src/main/buildGlobals.d.ts` 与 `apps/desktop/src/main/authConfig.ts`，运行时更新能力、登录/API 环境门禁与常量类型。
- **FILE-005**: `apps/workbench/scripts/packaging-mode.mjs`，发布通道解析合同。
- **FILE-006**: `apps/workbench/scripts/package-portable.mjs` 与 `apps/workbench/scripts/package-macos.mjs`，测试介质命名。
- **FILE-007**: `apps/workbench/scripts/*.test.mjs` 与 `apps/desktop/src/main/*.test.ts`，发布通道及 CI 静态合同测试。
- **FILE-008**: `apps/workbench/README.md`，分支矩阵与生产热更新边界说明。

## 6. Testing

- **TEST-001**: `pnpm typecheck` 必须成功。
- **TEST-002**: `pnpm --filter @unilab/workbench test` 必须成功，并断言 main/test 分支触发矩阵和 metadata-last 发布顺序。
- **TEST-003**: `pnpm --filter @unilab/desktop test` 必须成功，并覆盖生产/测试更新开关。
- **TEST-004**: 两个 Workflow YAML 必须可解析，所有 Bash 与 PowerShell `run` 块必须通过语法检查。
- **TEST-005**: 方案文件的 TASK/GOAL 与 bullet declaration 标识符重复检查必须返回空结果。

## 7. Risks & Assumptions

- **RISK-001**: 两个工作流都监听 `main` 会同时占用 Windows 与 macOS runner；通过平台独立 concurrency group 隔离，任一平台失败不取消另一平台。
- **RISK-002**: 测试分支如果缺少 macOS secrets 将无法生成可安装的 signed 测试包；该失败应保持显式，不能静默降级为 unsigned。
- **RISK-003**: 测试包与生产包仍共享应用数据目录和应用标识，只保证文件及发布通道可区分；并行安装隔离不属于本次范围。
- **RISK-004**: Windows 生产包当前使用每次构建变化的临时自签名证书，不具备稳定发布者身份且可能触发 SmartScreen；正式大规模分发前必须替换为稳定可信证书。
- **ASSUMPTION-001**: `main` 是受保护生产分支，只有已评审代码能够合入。
- **ASSUMPTION-002**: 两个测试分支从同一个已验证实现提交创建，并通过后续合并持续同步业务代码。

## 8. Related Specifications / Further Reading

[Workbench desktop packaging documentation](../apps/workbench/README.md)

[electron-builder auto update documentation](https://www.electron.build/auto-update.html)
