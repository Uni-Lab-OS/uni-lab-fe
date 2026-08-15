# 本地启动与真实联调指南

本文说明如何以 Uni-Lab Workbench 为唯一前端入口，在本地启动并切换两套运行连接：

- **直连 Edge / OS**：Workbench 托管本地 OS，由本地调度器创建并推进任务；
- **Backend + Scheduler**：Go Backend 持有工作流任务（WorkflowTask）与作业（Job）权威，Edge 只执行设备动作。

不要单独启动 `kernel-web`。仓库根目录的 `pnpm dev` 与 `pnpm workbench` 都启动正式 Theia Workbench。

## 1. 联调拓扑

```text
                                      ┌─ PostgreSQL
Workbench ──同源代理──> Go Backend ───┤
    │                                 └─ Scheduler <──> Edge <──> PLC-Sim
    │
    └──托管本地 OS ───────────────────────────────────────> SZLab 设备
```

Workbench 会始终托管一套本地 OS 会话。页面顶部的“运行连接”只决定**后续新建任务**由本地 OS 还是 Backend 持有调度权威；它不会迁移已有任务，也不会让另一套调度器接管已有任务。

## 2. 已验证基线与端口

本文按以下分支组合验证。切换到其他分支后应重新执行健康检查和最小验收。

| 仓库 | 分支 | 用途 |
|---|---|---|
| `uni-lab-fe` | `feat/backend-real-integration` | Workbench 与前端适配 |
| `uni-lab-backend` | `feat/workflow` | Backend、Scheduler、演示数据与 mock Edge |
| `Uni-Lab-OS` | `product/durable-scheduler-kernel` | Workbench 托管 OS 与真实 Edge 客户端 |
| `Uni-Lab-SZLab` | `main` | SZLab 设备包、图和 PLC 驱动 |
| `PLC-Sim` | `main` | OPC UA PLC 仿真 |

默认端口：

| 服务 | 地址 |
|---|---|
| Workbench | `http://127.0.0.1:3100` |
| Backend HTTP | `http://127.0.0.1:8080` |
| Scheduler 控制面 | `http://127.0.0.1:8081` |
| mock Edge 调试接口 | `http://127.0.0.1:8090` |
| PLC OPC UA | `opc.tcp://127.0.0.1:4855/xuse_sim/` |
| PLC Edge FastAPI | `http://127.0.0.1:18004` |
| Workbench 托管 OS | 动态端口，见会话文件 |

## 3. 一次性准备

要求 Node.js 20 或 22、pnpm 10.13.1、Go 1.26.5、Python 3.11、PostgreSQL、TimescaleDB、`curl` 和 `jq`。先把本机实际绝对路径写入当前 Shell：

```bash
export UNILAB_FE_REPO=/absolute/path/to/uni-lab-fe
export UNILAB_BACKEND_REPO=/absolute/path/to/uni-lab-backend
export UNILAB_OS_REPO=/absolute/path/to/Uni-Lab-OS
export UNILAB_SZLAB_REPO=/absolute/path/to/Uni-Lab-SZLab
export UNILAB_PLC_SIM_REPO=/absolute/path/to/PLC-Sim
export UNILAB_PYTHON_ENV=/absolute/path/to/python-3.11-env
```

下文的“另开终端”默认新终端也已导出这组路径；Backend 与 Scheduler 终端还必须导出同一个 `DATABASE_DSN`。可以从已配置的 Shell 启动 `tmux` 后分窗，或在每个独立终端重复执行变量块。不要把含密码的 DSN 提交到任一仓库。

安装前端依赖：

```bash
cd "$UNILAB_FE_REPO"
corepack enable
pnpm install
```

准备 OS、SZLab 与 PLC-Sim Python 环境：

```bash
"$UNILAB_PYTHON_ENV/bin/python" -m pip install -e "$UNILAB_OS_REPO"
"$UNILAB_PYTHON_ENV/bin/python" -m pip install -e "$UNILAB_SZLAB_REPO"
"$UNILAB_PYTHON_ENV/bin/python" -m pip install -e "$UNILAB_PLC_SIM_REPO/OpcUaSim"
```

### PostgreSQL

Scheduler 依赖 PostgreSQL 的 advisory lock 与 `LISTEN/NOTIFY`，不能使用 SQLite。第一次创建本地数据库时，数据库角色应与运行 Backend 的系统用户匹配，以便通过本机 Unix Socket 的 peer 认证：

```bash
export UNILAB_DB_ROLE="$(id -un)"
export UNILAB_DB_NAME=unilab_local

sudo systemctl start postgresql
sudo -u postgres createuser --createdb "$UNILAB_DB_ROLE"
sudo -u postgres createdb --owner="$UNILAB_DB_ROLE" "$UNILAB_DB_NAME"
sudo -u postgres psql -d "$UNILAB_DB_NAME" \
  -c 'CREATE EXTENSION IF NOT EXISTS timescaledb;'

export DB_DRIVER=postgres
export DATABASE_DSN="host=/var/run/postgresql user=$UNILAB_DB_ROLE dbname=$UNILAB_DB_NAME sslmode=disable"
```

`createuser` 或 `createdb` 报“已存在”时可忽略，不要删除已有联调数据库。如果本机使用密码认证，可把 `DATABASE_DSN` 改为 PostgreSQL URL。

如果 `CREATE EXTENSION` 报 TimescaleDB 不可用，先按 PostgreSQL 主版本安装对应 TimescaleDB 扩展并重启 PostgreSQL；不要跳过该步骤或手工标记迁移已完成。

## 4. 启动 Workbench 与直连 Edge / OS

在前端仓库启动 Workbench：

```bash
cd "$UNILAB_FE_REPO"

THEIA_WORKSPACE="$UNILAB_SZLAB_REPO" \
UNILAB_OS_PROJECT="$UNILAB_OS_REPO" \
UNILAB_PYTHON_ENV="$UNILAB_PYTHON_ENV" \
UNILAB_PLC_SIM_PROJECT="$UNILAB_PLC_SIM_REPO" \
UNILAB_BACKEND_PROXY_TARGET=http://127.0.0.1:8080 \
UNILAB_AGENT_ENABLED=0 \
THEIA_PORT=3100 \
pnpm dev
```

打开 <http://127.0.0.1:3100>。第一次启动时，在“环境管理”中选择：

- Workspace：`Uni-Lab-SZLab`；
- OS：上面的 Python 3.11 环境及 `Uni-Lab-OS` 源码目录；
- 图：`deployment/graphs/szlab-plc-sim-local.json`；
- PLC-Sim：`PLC-Sim` 仓库。

Workbench Node 后端负责 OS 的启动、健康检查、日志、PID 与停止，不要再手工启动第二个 OS。会话就绪后选择顶部的“直连 Edge / OS”。

可从会话文件读取动态 OS 地址并检查真实健康状态：

```bash
export UNILAB_OS_URL="$(jq -r '.identity.backendUrl' \
  "$UNILAB_SZLAB_REPO/.unilabos/runtime/workbench/session.json")"
curl -fsS "$UNILAB_OS_URL/api/v1/health" | jq
```

预期返回 `status=ok` 且调度器（Scheduler）为 ready。随后可在设备页运行单动作，或在工作流页使用 OS 提供的创作、调试和运行能力。

## 5. 启动 Backend + Scheduler + mock Edge

以下命令分别放在三个终端中运行。三个进程必须使用同一个 `DATABASE_DSN`。

先执行迁移并写入幂等的演示数据：

```bash
cd "$UNILAB_BACKEND_REPO"

DB_DRIVER=postgres DATABASE_DSN="$DATABASE_DSN" \
  go run ./cmd/server migrate
DB_DRIVER=postgres DATABASE_DSN="$DATABASE_DSN" \
  go run ./cmd/server demo-seed
```

终端 A，启动 Backend：

```bash
cd "$UNILAB_BACKEND_REPO"

DB_DRIVER=postgres \
DATABASE_DSN="$DATABASE_DSN" \
HTTP_ADDR=127.0.0.1:8080 \
go run ./cmd/server server
```

终端 B，启动调度器（Scheduler）：

```bash
cd "$UNILAB_BACKEND_REPO"

DB_DRIVER=postgres \
DATABASE_DSN="$DATABASE_DSN" \
SCHEDULER_ADDR=127.0.0.1:8081 \
go run ./cmd/server scheduler
```

终端 C，启动后端自带的 mock Edge：

```bash
cd "$UNILAB_BACKEND_REPO"

SCHEDULER_URL=http://127.0.0.1:8081 \
BACKEND_URL=http://127.0.0.1:8080 \
MOCK_EDGE_KEY=local-demo-edge \
MOCK_EDGE_INSTANCE_UUID=80000000-0000-4000-8000-000000000001 \
MOCK_EDGE_DEBUG_ADDR=127.0.0.1:8090 \
go run ./cmd/mock-edge
```

启动 Workbench 时已经设置了 `UNILAB_BACKEND_PROXY_TARGET`，浏览器通过 Theia 的 `/__unilab_backend` 同源代理访问 Backend，不需要 Backend 开 CORS。代理目标在 Workbench 启动时固定，修改后必须重启 Workbench。

检查四个关键事实：

```bash
curl -fsS http://127.0.0.1:8080/api/v1/health | jq
curl -fsS http://127.0.0.1:8081/health/live | jq
curl -fsS http://127.0.0.1:8081/health/ready | jq
curl -fsS http://127.0.0.1:8090/debug/state | jq '{connected, devices}'
```

在 Workbench 顶部打开“运行连接”，手动选择“Backend + Scheduler”。预期显示“Backend 已连接”。最小验收路径：

1. 工作流页能看到“样品加热与定量输送”；
2. 点击“运行工作流”进入“已有工作流运行”，创建任务后等待权威状态变为成功；
3. 设备页能看到在线 mock Edge 设备，并能运行设备单动作；
4. 物料页能读取 Backend 物料列表/物料图；Backend 写能力仍按 capability 关闭。

可以通过 mock Edge 调试接口模拟失败或断线：

```bash
curl -fsS -X PUT http://127.0.0.1:8090/debug/profile \
  -H 'Content-Type: application/json' \
  -d '{"delay_ms":1500,"outcome":"failed","disconnected":false,"require_intervention":false}' | jq

curl -fsS -X POST http://127.0.0.1:8090/debug/actions \
  -H 'Content-Type: application/json' \
  -d '{"type":"reset"}' | jq
```

## 6. 接入真实 Edge 与 PLC-Sim

这一节复现已验证的完整链路：

```text
Workbench → Backend → Scheduler → OS Edge → SZLab PLC 驱动 → OPC UA PLC-Sim
```

Backend 与 Scheduler 保持运行。mock Edge 可以同时运行，因为它使用不同的 Edge 身份和物料。

### 6.1 初始化 PLC 模板与物料

先同步 SZLab PLC 模板：

```bash
export UNILAB_PLC_FIXTURE="$UNILAB_FE_REPO/e2e/fixtures/plc-edge-runtime"

export UNILAB_TEMPLATE_SYNC_RESPONSE="$(curl -fsS -X POST \
  http://127.0.0.1:8080/api/v1/resource-templates \
  -H 'Content-Type: application/json' \
  --data-binary "@$UNILAB_PLC_FIXTURE/backend-template-sync.json")"

export UNILAB_PLC_TEMPLATE_UUID="$(printf '%s' "$UNILAB_TEMPLATE_SYNC_RESPONSE" | \
  jq -er 'select(.code == 0) | .data.templates[] |
    select(.name == "community.szlab_poly_studio.szlab_poly_plc") | .uuid')"
```

查询已存在的 PLC 物料；新数据库中没有时再创建：

```bash
export UNILAB_PLC_MATERIAL_UUID="$(curl -fsS -G \
  http://127.0.0.1:8080/api/v1/materials \
  --data-urlencode 'barcode=PLC-SIM-EDGE-LOCAL' | \
  jq -r '.data.items[0].uuid // empty')"

if [ -z "$UNILAB_PLC_MATERIAL_UUID" ]; then
  export UNILAB_PLC_MATERIAL_UUID="$(jq -n \
    --arg template_uuid "$UNILAB_PLC_TEMPLATE_UUID" \
    '{
      resource_template_uuid: $template_uuid,
      barcode: "PLC-SIM-EDGE-LOCAL",
      name: "SZLab PLC 仿真 Edge",
      config: {
        opcua_url: "opc.tcp://127.0.0.1:4855/xuse_sim/",
        simulator: "127.0.0.1:4855",
        transport: "opcua"
      },
      data: {status: "ready"},
      meta_data: {source: "local-plc-integration"},
      idempotency_key: "local-plc-edge-material-v1"
    }' | curl -fsS -X POST http://127.0.0.1:8080/api/v1/materials \
      -H 'Content-Type: application/json' \
      --data-binary @- | jq -er 'select(.code == 0) | .data.uuid')"
fi

printf 'PLC material UUID: %s\n' "$UNILAB_PLC_MATERIAL_UUID"
```

### 6.2 启动 PLC-Sim

另开终端：

```bash
"$UNILAB_PYTHON_ENV/bin/python" \
  "$UNILAB_PLC_SIM_REPO/OpcUaSim/server.py" \
  --host 127.0.0.1 \
  --port 4855 \
  --csv "$UNILAB_SZLAB_REPO/szlab_poly_studio/devices/szlab_poly_plc/szlab_plc_0810.csv" \
  --ns-index 4 \
  --ns-uri urn:xuse:sim \
  --connection-state "$UNILAB_PLC_SIM_REPO/OpcUaSim/data/runtime/server-connections.json"
```

### 6.3 启动真实 OS Edge

另开终端。`UNILAB_PLC_MATERIAL_UUID` 必须使用 6.1 得到的值：

```bash
export UNILAB_PLC_MATERIAL_UUID=replace-with-uuid-from-step-6.1
export UNILAB_PLC_FIXTURE="$UNILAB_FE_REPO/e2e/fixtures/plc-edge-runtime"

UNILAB_PLC_MATERIAL_UUID="$UNILAB_PLC_MATERIAL_UUID" \
UNILAB_PLC_BARCODE=PLC-SIM-EDGE-LOCAL \
UNILABOS_EDGECONTROLCONFIG_API_KEY=local-integration \
UNILABOS_EDGECONTROLCONFIG_INSTANCE_UUID=91000000-0000-4000-8000-000000000001 \
UNILABOS_EDGECONTROLCONFIG_CAPABILITY_REVISION=szlab-plc-opcua-v1 \
UNILABOS_EDGECONTROLCONFIG_EDGE_KEY=szlab-plc-sim-edge \
"$UNILAB_PYTHON_ENV/bin/python" "$UNILAB_PLC_FIXTURE/start_plc_edge.py" \
  --workspace "$UNILAB_SZLAB_REPO" \
  --graph "$UNILAB_PLC_FIXTURE/plc-edge.json" \
  --config "$UNILAB_SZLAB_REPO/deployment/local_config.py" \
  --working_dir "$UNILAB_SZLAB_REPO/.unilabos/backend-integration/runtime" \
  --backend ros \
  --app_bridges websocket fastapi \
  --port 18004 \
  --disable_browser \
  --action_mode real \
  --external_devices_only \
  --ros_domain_id 95 \
  --ros_discovery_server off \
  --hostlink_addr 127.0.0.1:37684 \
  --addr http://127.0.0.1:8080/api/v1
```

当前兼容启动器只补齐 OS 旧 Edge 注册描述，不模拟动作结果。设备动作仍由真实 SZLab PLC 驱动访问本地 OPC UA 仿真，并把最终结果经 Backend 持久化。

### 6.4 确认 Edge 能力并导入工作流

```bash
ss -ltn | rg ':(4855|8080|8081|18004)\b'

curl -fsS http://127.0.0.1:8080/api/v1/devices | \
  jq '.data[] | select(.material.barcode == "PLC-SIM-EDGE-LOCAL") |
    {name: .material.name, edge_status, dispatchable, actions}'
```

预期 `edge_status=online`、`dispatchable=true`，并含 `check_opcua_connection`。Backend 在导入工作流时会立即校验设备实例真实声明的动作，因此必须先看到上述在线事实，再导入工作流。

只在目录中还没有同名工作流时导入：

```bash
export UNILAB_PLC_WORKFLOW_UUID="$(curl -fsS \
  'http://127.0.0.1:8080/api/v1/workflows?page=1&page_size=100' | \
  jq -r '.data.items[] | select(.name == "PLC 仿真连接检查工作流") | .uuid' | head -n 1)"

if [ -z "$UNILAB_PLC_WORKFLOW_UUID" ]; then
  export UNILAB_PLC_WORKFLOW_UUID="$(curl -fsS -X POST \
    http://127.0.0.1:8080/api/v1/workflows/import \
    -H 'Content-Type: application/json' \
    --data-binary "@$UNILAB_PLC_FIXTURE/workflow-import.json" | \
    jq -er 'select(.code == 0) | .data.workflow.uuid')"
fi

printf 'PLC workflow UUID: %s\n' "$UNILAB_PLC_WORKFLOW_UUID"
```

### 6.5 验收真实链路

在 Workbench 中选择“Backend + Scheduler”后：

1. 工作流页运行“PLC 仿真连接检查工作流”；
2. 等待 WorkflowTask 和唯一 Job 都进入 `succeeded`；
3. 设备页选择“SZLab PLC 仿真 Edge”；
4. 选择“检查 OPC UA 仿真连接”，点击“运行此动作”；
5. 结果中的 `return_value.connected` 应为 `true`。

## 7. 切换连接时的规则

- 切换只影响后续创建的任务；已有任务继续由创建它的调度权威推进；
- 有活动任务时，Workbench 会阻止切换；先等待终态或取消并确认终态；
- “连接成功”只说明健康检查成功，不代表 WorkflowTask 或 Job 成功；
- Backend 模式中的任务终态必须来自 Backend REST 权威投影，不根据前端计时器或 HTTP 201 猜测；
- Workbench 记住上次手动选择；要覆盖初始值可使用查询参数 `?workbenchConnection=edge` 或 `?workbenchConnection=backend`。

## 8. 常见问题

| 现象 | 检查与处理 |
|---|---|
| 打开的是旧 `kernel-web` | 必须从 `uni-lab-fe` 根目录运行 `pnpm dev`；不要运行 `apps/kernel-web` 的 Vite 命令 |
| Workbench 显示 Backend 502 | 先检查 `:8080/api/v1/health`；确认启动 Workbench 时设置了 `UNILAB_BACKEND_PROXY_TARGET`，修改后重启 Workbench |
| Scheduler live 但不 ready | 通常是 PostgreSQL、迁移或 advisory lock 问题；确认只有一个 Scheduler 使用该数据库，并查看 Scheduler 日志 |
| 设备存在但 `dispatchable=false` | 检查 Edge 是否 online、物料绑定是否唯一、Edge 上报动作名称/类型是否与模板一致 |
| PLC 动作失败连接 | 检查 `:4855` 是否监听、图中的 OPC UA URL 是否为 `127.0.0.1:4855/xuse_sim/`，再看 Edge 日志 |
| OS 地址不是固定端口 | 这是 Workbench 托管会话的正常行为，从 `.unilabos/runtime/workbench/session.json` 读取 `identity.backendUrl` |
| `/api/v1/material-shapes` 返回 404 | 当前 Go Backend 尚未提供自定义形状目录；前端会降级到列表/2D 或实心包围盒，不影响工作流和设备动作链路 |
| Backend 物料页不能移动/挂载/撤销 | 当前 Backend 只完成物料目录与物料图只读适配，图写命令尚未对齐 revision、幂等与补偿语义，前端按 capability 关闭这些操作 |
| Backend 工作流不能创作或断点调试 | 当前只接入已有工作流运行和正式 `normal`/`step`/`single_node` 模式；Canonical Authoring 与 Debugger Hold 仍由 OS 提供 |

## 9. 停止顺序

用各自终端的 `Ctrl+C` 停止进程，建议顺序为：PLC Edge、PLC-Sim、mock Edge、Scheduler、Backend，最后停止 Workbench。Workbench 停止时会负责关闭自己托管的 OS；不要直接删除 `.unilabos/runtime` 中的 PID 或会话文件。

## 10. 当前仍未收敛的接口细节

完整清单见 [Backend 联调剩余项](migration/backend-integration-remaining.md)。最影响本地联调的差异是：

- Backend 全局 SSE 还未覆盖每次 Task/Job/命令/反馈权威变化，当前已有运行界面仍保留手动刷新恢复入口；
- Backend 尚无与前端 Canonical Authoring 聚合同构的 Draft/Apply/冲突合同；
- Backend 物料图写命令尚未与 OS 的 revision、幂等、原子挂载/移动和补偿语义收敛；
- `/api/v1/material-shapes` 尚未提供；
- OS Edge 注册描述尚未原生携带 Backend 所需的 Material UUID 和动作能力，本指南的 PLC 启动器是联调兼容层，不是最终产品接口。
