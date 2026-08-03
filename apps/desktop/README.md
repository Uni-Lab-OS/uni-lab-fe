# Desktop

`@unilab/desktop` 是 `@unilab/kernel-web` 的 Electron 打包层。它提供桌面窗口、受控的
系统能力和安装包，不拥有另一套页面或业务状态。

## 文件导航

- `src/main/`：Electron 主进程、窗口生命周期和认证窗口。
- `src/preload/`：最小化、类型化的 renderer bridge。
- renderer 内容直接来自 `@unilab/kernel-web`。

## 原则

- Web 与 desktop 使用相同的组件、路由、services 和 store。
- Node/Electron 能力只通过 preload 暴露窄接口；renderer 不启用任意 Node 权限。
- 本地 OS 连接仍走 Services Profile，不在主进程实现第二套物料或工作流 client。
- 桌面环境差异应限制在窗口、文件选择、协议唤起等宿主能力。
- 本地 `dev`/`preview` 使用 `build/icon.png` 作为窗口图标，并在 macOS 显式设置
  Dock 图标；安装包继续使用 `electron-builder.yml` 声明的 `icon.icns/icon.png`。

## 本地环境启动

桌面端连接栏可选择以下路径，并分别启动或停止 PLC-Sim 与领域侧 Edge。当前
界面和默认启动配置以 `sz_lab` 为例：

- `unilab` Conda 环境目录（自动识别本机兼容环境，也可手动选择；macOS/Linux
  使用 `bin/python` 与 `bin/unilab`，Windows 使用 `python.exe` 与
  `Scripts/unilab.exe`。Windows 子进程还会注入所选环境的 `CONDA_PREFIX`，并按
  Conda 激活顺序前置环境目录、`Library/bin` 与 `Scripts` 到 `PATH`）
- Uni-Lab-OS 项目根目录
- 领域项目根目录（示例：Uni-Lab-SZLab）
- 领域设备图 JSON（示例：sz_lab 设备图）
- PLC-Sim 项目根目录（可选，内部使用 `OpcUaSim/gui/backend.py`）

两个服务不再绑定为一次启动操作：

1. PLC-Sim（可选）：用户单独启动 `python -m gui.backend`，监听
   `127.0.0.1:18765`。
2. 如需使用 PLC，用户在 PLC-Sim 中上传 PLC 变量表并确认完成。
3. 领域侧 Edge：用户再单独通过 `unilab` CLI 启动 Edge。`sz_lab` 示例使用
   ROS backend、FastAPI bridge 与 Edge Scheduler，`ROS_DOMAIN_ID=42`，HTTP
   监听 `18003`；不再额外启动本地 Bridge 进程。
   每次启动会在 `runtime/ideawit-e2e` 下生成独立的
   `edge-runtime-YYYYMMDD-HHMMSS.sqlite3`，并通过 `UNILABOS_RUNTIME_DB`
   传给 Edge。

停止领域侧 Edge 不会停止 PLC-Sim；为避免变量表与设备目录状态不一致，Edge
运行期间不能启动或停止 PLC-Sim。退出桌面应用时仍会统一回收两个服务。

产品界面仅展示 OPC UA 与领域侧 Edge，不把 CLI 内部 bridge 暴露为独立服务。

启动前会校验项目结构、可执行文件和端口占用；任一进程启动失败或意外退出时，
其余进程会被统一回收。所有命令均以参数数组直接启动，不经过 renderer 或任意
shell 字符串拼接。日志分别写入 `simulator.log` 和 `edge.log`，可在应用右上角打开
日志抽屉直接查看；日志目录与读取方式均由 Electron 按当前平台处理。

## Trace 日志

Electron main 使用 `@arizeai/phoenix-otel` 将应用生命周期、renderer 异常、登录和
本地运行时启停等关键操作作为 OpenTelemetry span 上报到 Uni-Lab-OS。默认 OTLP
地址为：

```text
http://127.0.0.1:18003/api/v1/observability/otlp/v1/traces
```

Uni-Lab-OS 未启动、未启用 observability 或 Phoenix 暂不可用时，上报自动降级，
不得阻断 Electron 启动和业务操作。原有 `~/lab-pc-client.log` 文件日志继续保留。
主进程退出前会在限定时间内 flush，并通过 preload 提供 status、trace 列表和详情
查询；renderer 不直接访问 OTLP 地址。

Electron 一键启动 Edge 时会为该子进程启用 Uni-Lab-OS observability，并把用户选择的
Conda 环境 `bin` 放到 `PATH` 首位，以便 Uni-Lab-OS 找到同一环境中的 `phoenix`。
该环境需要预先安装 Uni-Lab-OS 的 `observability` 可选依赖；未安装时 Edge 继续启动，
trace 状态显示为降级。

可选环境变量：

- `UNILABOS_TRACE_ENABLED=0`：关闭 Electron trace 上报。
- `UNILABOS_OBSERVABILITY_URL`：覆盖 Uni-Lab-OS observability 根地址，仅接受无凭据
  的 loopback HTTP 地址。
- `UNILABOS_TRACE_PROJECT`：覆盖 Phoenix project，默认 `uni-lab-electron`。
- `UNILABOS_TRACE_REQUEST_TIMEOUT_MS`：查询超时，默认 `5000`。
- `UNILABOS_TRACE_SHUTDOWN_TIMEOUT_MS`：退出 flush 超时，默认 `3000`。

上报前会清除 URL 凭据与查询参数、Bearer/token/password/cookie 等敏感值，并将用户
家目录替换为 `$HOME`。不要在新增 span 属性中放入设备动作完整参数或文件内容。

## 绝对不能做

- 不得复制 `kernel-web` 页面形成第二套 renderer。
- 不得在主进程保存 Material Graph 或工作流运行权威状态。
- 不得绕过 Services capability matrix 调用本地端口。
- 不得把测试专用路径、模型或相机参数写入生产启动逻辑。

## 验证

```bash
pnpm --filter @unilab/desktop typecheck
pnpm --filter @unilab/desktop build
pnpm --filter @unilab/desktop dev
```

涉及桌面集成的变更必须至少手工验证 Profile 切换、2D/2.5D/3D/split 与窗口重载。
