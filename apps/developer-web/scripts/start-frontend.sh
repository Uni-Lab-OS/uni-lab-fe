#!/usr/bin/env bash
# 启动打包后的 developer-web（dist），并把 API 反向代理到 workspace backend。
#
# 用法:
#   bash start-frontend.sh --check         只打印解析到的配置并探测 backend，不启动
#   bash start-frontend.sh                 起静态服务，复用已在运行的 backend
#   bash start-frontend.sh --restart-os    先重启 backend + edge，再起静态服务
#
# 脚本既可以在仓库里跑（apps/developer-web/scripts），也可以随 dist 一起发布后
# 在 dist 目录里跑：DIST 默认取脚本所在目录，其次取仓库的 ../dist。
#
# 所有事实都可以用环境变量覆盖，也可以写进同目录的 start-frontend.local.env：
#   UNILAB_DIST       dist 目录
#   UNILAB_BACKEND    backend 地址，例如 http://127.0.0.1:52734
#   UNILAB_WORKSPACE  设备包工作区，用来读 session.json
#   UNILAB_SESSION    直接指定 session.json
#   UNILAB_GRAPH      启动图 json（--restart-os 需要，否则从 session.json 读）
#   UNILAB_PYTHON     unilab 环境的 python（--restart-os 需要）
#   UNILAB_OS_ROOT    uni-lab-os 仓库路径（--restart-os 需要）
#   UNILAB_FE_PORT    前端端口，默认 4177

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LOCAL_ENV="${UNILAB_LOCAL_ENV:-$SCRIPT_DIR/start-frontend.local.env}"
if [[ -f $LOCAL_ENV ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$LOCAL_ENV"
  set +a
fi

FE_PORT="${UNILAB_FE_PORT:-4177}"
BACKEND="${UNILAB_BACKEND:-}"
WORKSPACE="${UNILAB_WORKSPACE:-}"
GRAPH="${UNILAB_GRAPH:-}"
OS_ROOT="${UNILAB_OS_ROOT:-}"
PY="${UNILAB_PYTHON:-}"
SERVER="$SCRIPT_DIR/serve-dist.py"

die() {
  echo "错误：$*" >&2
  exit 1
}

report() { printf '  %-12s %s\n' "$1" "$2"; }

dist_dir() {
  if [[ -n ${UNILAB_DIST:-} ]]; then
    printf '%s' "$UNILAB_DIST"
  elif [[ -f $SCRIPT_DIR/index.html ]]; then
    printf '%s' "$SCRIPT_DIR"
  elif [[ -f $SCRIPT_DIR/../dist/index.html ]]; then
    (cd "$SCRIPT_DIR/../dist" && pwd)
  else
    printf '%s' "$SCRIPT_DIR"
  fi
}

session_file() {
  if [[ -n ${UNILAB_SESSION:-} ]]; then
    printf '%s' "$UNILAB_SESSION"
  elif [[ -n $WORKSPACE ]]; then
    printf '%s' "$WORKSPACE/.unilabos/runtime/workbench/session.json"
  fi
}

# 从 session.json 读取一个字段；$1 是取值表达式，作用在 session 对象上。
read_session() {
  local file="$1" expr="$2"
  /usr/bin/python3 -c "
import json, sys
with open(sys.argv[1]) as handle:
    session = json.load(handle)
print($expr)
" "$file"
}

session_backend() {
  local file="$1" address
  address=$(read_session "$file" '
(
    lambda component: component["address"]
    if component.get("phase") == "ready" and component.get("address")
    else sys.exit("session.json 里的 backend 未就绪，请先重启工作区")
)(session["components"]["backend"])
') || return 1
  printf '%s' "$address"
}

resolve_backend() {
  if [[ -n $BACKEND ]]; then
    printf '%s' "$BACKEND"
    return 0
  fi
  local file
  file=$(session_file)
  [[ -n $file ]] || return 1
  [[ -f $file ]] || return 1
  session_backend "$file"
}

probe() {
  local url="$1" code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || true)
  printf '%s' "${code:-无响应}"
}

cmd_check() {
  local dist file resolved
  dist=$(dist_dir)
  file=$(session_file || true)
  echo "解析到的启动配置："
  report "前端端口" "$FE_PORT"
  report "dist" "$dist"
  if [[ -f $dist/index.html ]]; then
    report "index.html" "存在"
  else
    report "index.html" "缺失 ← dist 路径不对"
  fi
  report "服务器脚本" "$([[ -f $SERVER ]] && echo "$SERVER" || echo "缺失 ← serve-dist.py 必须与脚本同目录")"
  report "工作区" "${WORKSPACE:-未设置}"
  report "session" "${file:-未设置 ← 需要 UNILAB_WORKSPACE 或 UNILAB_SESSION}"
  if [[ -n $file && -f $file ]]; then
    resolved=$(resolve_backend || true)
  else
    resolved=""
  fi
  report "backend" "${resolved:-未解析到 ← 用 UNILAB_BACKEND 直接指定}"
  if [[ -n $resolved ]]; then
    report "接口探测" "$(probe "$resolved/api/v1/workflows?limit=1") ← /api/v1/workflows"
  fi
  report "启动图" "${GRAPH:-未设置（--restart-os 时从 session.json 读）}"
  report "python" "${PY:-未设置}${PY:+ $([[ -x $PY ]] && echo 可用 || echo 不可执行)}"
  report "OS 仓库" "${OS_ROOT:-未设置}"
}

stop_frontend() {
  local fe_pid
  fe_pid=$(lsof -nP -iTCP:"$FE_PORT" -sTCP:LISTEN -t | head -n 1 || true)
  if [[ -n $fe_pid ]]; then
    kill "$fe_pid"
    echo "已停止占用 $FE_PORT 的进程 $fe_pid"
  fi
}

serve() {
  local backend="$1" dist
  dist=$(dist_dir)
  [[ -f $dist/index.html ]] || die "dist 目录缺少 index.html：$dist"
  [[ -f $SERVER ]] || die "缺少服务器脚本：$SERVER"
  stop_frontend
  echo "打包前端将连接 $backend"
  echo "打开前端的地址是 http://127.0.0.1:${FE_PORT}/"
  UNILAB_BACKEND="$backend" UNILAB_FE_PORT="$FE_PORT" UNILAB_DIST="$dist" \
    exec /usr/bin/python3 "$SERVER"
}

cmd_serve() {
  local backend
  backend=$(resolve_backend) ||
    die "没有解析到 backend：设置 UNILAB_BACKEND=http://host:port，或设置 UNILAB_WORKSPACE 指向工作区以便读取 session.json"
  echo "启动图 ${GRAPH:-$(
    local file
    file=$(session_file)
    [[ -n $file && -f $file ]] && read_session "$file" 'session["configuration"]["graphPath"]'
  )}（未重启）"
  echo "PLC 未重启"
  serve "$backend"
}

cmd_restart_os() {
  [[ -n $PY ]] || die "重启 OS 需要 UNILAB_PYTHON 指向 unilab 环境的 python"
  [[ -x $PY ]] || die "UNILAB_PYTHON 不可执行：$PY"
  [[ -n $OS_ROOT ]] || die "重启 OS 需要 UNILAB_OS_ROOT 指向 uni-lab-os 仓库"
  [[ -n $WORKSPACE ]] || die "重启 OS 需要 UNILAB_WORKSPACE 指向设备包工作区"
  local file backend
  file=$(session_file)
  if [[ -z $GRAPH && -n $file && -f $file ]]; then
    GRAPH=$(read_session "$file" 'session["configuration"]["graphPath"]')
  fi
  [[ -n $GRAPH ]] || die "重启 OS 需要 UNILAB_GRAPH 指向启动图 json"
  export PYTHONPATH="$OS_ROOT"
  stop_frontend
  backend=$("$PY" -m unilabos.app.main workspace restart \
    --component all \
    --workspace "$WORKSPACE" \
    --graph "$GRAPH" \
    --wait 180 \
    --json | "$PY" -c 'import json, sys
data = json.load(sys.stdin)
components = data["result"]["components"]
backend = components["backend"]
edge = components["edge"]
if data.get("phase") != "succeeded" or backend.get("phase") != "ready" or not backend.get("address"):
    raise SystemExit("backend 未就绪")
if edge.get("phase") != "ready":
    raise SystemExit("edge 未就绪")
print(backend["address"])') || return 1
  echo "启动图 $GRAPH"
  echo "PLC 未重启"
  serve "$backend"
}

case "${1:-}" in
  --check) cmd_check ;;
  --restart-os) cmd_restart_os ;;
  --frontend-only | "") cmd_serve ;;
  *)
    echo "用法: bash $(basename "$0") [--check|--frontend-only|--restart-os]" >&2
    exit 2
    ;;
esac