# UniLab 调试工作台（UniLab Workbench）

The formal Theia application for one managed-local Uni-Lab OS Workspace. It can
run in a browser or inside the shared UniLab Electron Desktop shell. The Theia
Workspace and OS WorkspaceSource use the same normalized Editable Package root.
Runtime state and diagnostics are stored below `<workspace>/.unilabos/`.

## Start with SZLab

```bash
THEIA_WORKSPACE=/absolute/path/to/Uni-Lab-SZLab \
UNILAB_OS_PROJECT=/absolute/path/to/Uni-Lab-OS \
UNILAB_PYTHON_ENV=/absolute/path/to/conda/env \
pnpm workbench
```

`UNILAB_PYTHON_ENV` is optional when the active environment or a standard local
Conda location contains both Python and the `unilab` CLI. An explicitly selected
environment is authoritative: if it becomes invalid, Workbench fails closed and
does not silently switch environments.

Workbench resolves an optional OS source checkout through that interpreter's
`unilabos` import location. An editable install therefore maps to its real
checkout regardless of where the Workspace lives; an ordinary wheel install
continues to run from the selected environment with no synthetic source path.
Workbench never infers OS from a sibling Workspace directory. `--os-project`
or `UNILAB_OS_PROJECT` is the explicit override for controlled development.

When an environment is selected, the launcher gives Theia's Python extension,
integrated terminals and the managed OS the same activated `PATH`, `CONDA_PREFIX`
and `PYTHONPATH` view (OS source root plus Editable Package root).

Open <http://127.0.0.1:3100>. The Workbench backend owns OS startup, readiness,
logs, PID identity and shutdown. Material and Workflow surfaces remain disabled
until the managed OS reports health, workflow-template and device-catalog
readiness.

The “环境管理” panel uses the user-facing name **OS** and exposes OS, PLC-Sim
and Agent as one local status chain. Set `UNILAB_PLC_SIM_PROJECT` to preselect a
PLC-Sim repository, or save the path from the panel. The machine-local selection
is persisted in `<workspace>/.unilabos/environment.local.json` and excluded by
the Workbench-managed `.gitignore`.

The browser is the control surface, not the process owner. Its RPC calls are
handled by the local Theia Node backend, so browser and desktop Workbench share
the same lifecycle. If the Theia backend is deployed remotely, the panel manages
processes on that backend host.

## Start remote mode on macOS, Linux or Windows

Remote mode keeps Theia, OS, PLC-Sim and Agent control endpoints on
`127.0.0.1`. The only browser-facing listener is the Workbench authentication
facade, which proxies authenticated HTTP and WebSocket traffic. The remote
access protocol and launcher are platform-neutral; launchd, systemd and Windows
Task Scheduler are thin process-supervision adapters over the same command.

```bash
pnpm --filter @unilab/workbench start:remote -- \
  --workspace /srv/unilab/Uni-Lab-SZLab \
  --python-env /opt/conda/envs/unilab \
  --port 3100 \
  --remote-host 0.0.0.0 \
  --remote-port 8443 \
  --public-origin https://workbench.example.com:8443 \
  --tls-cert /etc/unilab/tls/fullchain.pem \
  --tls-key /etc/unilab/tls/private-key.pem \
  --access-url-file /run/unilab-workbench/access.url
```

A non-loopback listener fails closed unless both TLS files and an HTTPS public
origin are supplied. When TLS terminates at a trusted reverse proxy, bind the
facade itself to `127.0.0.1`, configure the HTTPS `--public-origin`, preserve
the external Host header, and omit the local TLS files.

Every start creates a signed capability bound to the facade PID, port and
generation. The secret access URL is written with mode `0600` outside the
Workspace (or displayed only on an interactive TTY). The browser sends the URL
fragment once, receives an HttpOnly/SameSite session cookie, and immediately
removes the fragment. `.unilabos/runtime/remote-access.json` contains only the
token SHA-256 and process identity. Restart/update rotates the generation, so
old URLs and cookies are rejected; normal reconnects keep working until the
configured expiry.

The service template at `linux/unilab-workbench.service` pins Node 24.14.0,
uses `/run/unilab-workbench` for secret delivery, and applies bounded
control-group shutdown. Install releases below `/opt/unilab-workbench/`, point
`current` at the selected release, then restart the unit. Rollback switches the
symlink back and restarts; Workspace state migration/backup remains governed by
`.unilabos/schema.json`.

All service adapters consume the same environment contract:

```dotenv
UNILAB_NODE=/opt/unilab-workbench/node-v24.14.0/bin/node
UNILAB_WORKBENCH_ROOT=/opt/unilab-workbench/current
THEIA_WORKSPACE=/srv/unilab/Uni-Lab-SZLab
UNILAB_PYTHON_ENV=/opt/conda/envs/unilab
THEIA_PORT=3100
UNILAB_REMOTE_HOST=0.0.0.0
UNILAB_REMOTE_PORT=8443
UNILAB_REMOTE_PUBLIC_ORIGIN=https://workbench.example.com:8443
UNILAB_REMOTE_TLS_CERT=/etc/unilab/tls/fullchain.pem
UNILAB_REMOTE_TLS_KEY=/etc/unilab/tls/private-key.pem
UNILAB_REMOTE_ACCESS_URL_FILE=/run/unilab-workbench/access.url
```

Do not add a capability token to this file. Workbench generates it on every
start and writes the complete secret URL only to the configured access URL
file. The service account must be able to write that file; only the operator
who delivers the URL to the browser should be able to read it.

- Linux installs `linux/unilab-workbench.service` and a root-controlled
  `/etc/unilab/workbench.env`, then enables the systemd unit.
- macOS installs `macos/com.unilab.workbench.remote.plist` as a LaunchDaemon.
  Its launcher reads the same administrator-controlled environment file and
  runs as the dedicated `unilab` account/group. Install the file as
  `root:unilab` with mode `0640`; it must not contain a generated capability.
- Windows stores the environment file below
  `C:\ProgramData\UniLab\Workbench`, then runs the elevated
  `windows/install-remote-task.ps1`. The installer restricts the directory to
  SYSTEM and Administrators and registers a machine-start task; uninstalling
  removes the task without deleting Workspace state.

The environment activation passed to Theia, terminal, LSP and managed OS is
also platform-neutral. Windows includes the Conda root, Scripts and Library
tool directories; native watcher, ripgrep and terminal packages are pinned for
macOS, Linux and Windows on arm64 and x64. A target remains `unverified` in
`compatibility.json` until a real host has completed cold start, reconnect,
shutdown and rollback acceptance.

Remote diagnostics use the same bounded Workbench bundle: Workspace/home paths,
Bearer credentials, cookies, token/secret query or fragment values are redacted,
and Agent conversation/session bodies are excluded.

## Start as a desktop application

The packaged app opens on a dedicated Workspace welcome surface. No Theia,
managed OS, Workbench Agent or PLC-Sim process is started until a Workspace has
been selected and its Python environment has passed validation. Successful
selections are recorded as canonical paths in the machine-local application
configuration; invalid launches return to the welcome surface without replacing
the last successful entry.

From a running desktop Workbench, use **切换工作区** in the Workbench
toolbar. Unsaved editors keep Electron's native discard confirmation. After
confirmation, the current managed process tree is stopped within the bounded
shutdown window, and the same BrowserWindow returns to the welcome surface.

To exercise the packaged launcher in development without starting a Workspace:

```bash
pnpm --filter @unilab/workbench desktop:welcome
```

To keep the welcome-based Workspace launcher while rebuilding Workbench source
changes, run:

```bash
pnpm workbench:desktop:welcome:development
```

The TypeScript and Theia bundle watchers stay active after a Workspace is
selected. Refresh the Electron window after a successful bundle rebuild.
Electron main/preload changes still require restarting this command.

An explicit `--workspace` or `THEIA_WORKSPACE` remains the automation-compatible
direct-launch path and bypasses the welcome surface after successful validation.

```bash
THEIA_WORKSPACE=/absolute/path/to/Uni-Lab-SZLab \
UNILAB_OS_PROJECT=/absolute/path/to/Uni-Lab-OS \
UNILAB_PYTHON_ENV=/absolute/path/to/conda/env \
UNILAB_WORKFLOW_UUID=optional-workflow-uuid \
pnpm workbench:desktop
```

This builds the existing `apps/desktop` shell and the Workbench, waits for the
local Theia server, then opens it in Electron. Workbench therefore reuses the
Desktop preload/IPC, authentication, file dialogs, local runtime, device-card,
device-provisioning, diagnostics and safe-quit implementation. The privileged
renderer is restricted to the launcher-owned local welcome file and the active
managed `http://127.0.0.1` origin; remote renderer URLs and cross-origin
navigation are rejected.

The default desktop command builds Theia in production mode, removes source
maps, and builds only Electron main/preload code because Workbench renders from
the local Theia server. Use `pnpm workbench:desktop:development` when source
maps are needed; it keeps the same renderer-free Electron shell.

The desktop Environment Manager can enable or stop an authenticated remote
browser entrance while Electron stays open. Both entrances use the same Theia
backend, `WorkbenchSession`, managed OS, terminals and files; enabling sharing
does not launch a second environment. The secret launch URL is exposed only to
the trusted preload bridge and the configured out-of-Workspace access file.
Stopping sharing releases the remote listener and revokes its generation while
the local Electron session continues running.

To start Electron with remote sharing already enabled, use the combined mode:

```bash
pnpm workbench:desktop-remote -- \
  --workspace /absolute/path/to/Uni-Lab-SZLab \
  --remote-host 127.0.0.1 \
  --remote-port 3111 \
  --access-url-file /absolute/private/runtime/workbench-access.url
```

T12 deliberately provides shared-session semantics, not CRDT collaboration.
Local and remote clients see the same applied workflow and filesystem state,
but two people must not edit and save the same source file concurrently. A
later collaboration slice must add document-level ownership or CRDT/OT before
same-file multi-user editing can be advertised.

The legacy Electron kernel surface does not depend on Theia. Its
`LocalRuntimeManager` and Theia's `WorkbenchSession` instead share the lower
level `@unilab/local-environment` package for Conda/Python discovery and the
validated PLC-Sim launch contract.

## Desktop automatic updates

Production Workbench applications use `electron-updater` with a build-time
HTTPS generic provider. The release channel is compiled into Electron main from
`UNILAB_WORKBENCH_RELEASE_CHANNEL=production|update-test|test`; ordinary test
packages, development runs and the legacy Kernel Electron surface keep the
updater disabled. A production or isolated update-test Workbench checks 30
seconds after startup and every four hours afterwards. Download and restart are
triggered explicitly from the in-app update status; ordinary app exit does not
silently install a downloaded version. An omitted channel defaults to `test`,
so only an explicit update-capable build can enable updates.

While an update is downloading, the progress row exposes explicit pause and
resume controls. Pausing applies backpressure to the existing updater response
stream, so the pending file and checksum state remain intact; resuming continues
that same transfer instead of starting a second download.

If the response fails, the desktop shell keeps the verified download identity
and partial artifact in its OS cache instead of relying on electron-updater's
temporary `pending` directory. The failure row retains the last durable progress
and exposes **Continue download** directly. A retry sends `Range` plus `If-Range`
when a strong validator is available; it appends only a matching `206` response.
An ignored or stale range restarts safely, and the complete artifact must still
match the published SHA-512 checksum before it is handed back to
electron-updater for platform signature verification and installation.

The desktop main-process diagnostic log records the updater's effective
download mode without enabling its verbose block-plan debug output. Search for
`Workbench 更新下载模式` to distinguish `mode=differential` from `mode=full`
and its fallback reason. `Workbench 更新下载完成` records the complete package
bytes, transferred artifact bytes, planned transfer bytes, saved bytes and the
saved percentage. Update URLs are reduced to origin plus pathname before they
reach the log, so credentials and query tokens are never persisted.

On macOS, the application must be copied out of the mounted DMG before an
update can replace it. A Workbench launched from `/Volumes` rejects the install
command before process cleanup and tells the user to copy it to `/Applications`.

Every distributable build requires a credential-free update directory:

```bash
UNILAB_WORKBENCH_RELEASE_CHANNEL=production \
UNILAB_WORKBENCH_UPDATE_URL=https://updates.example.com/workbench/stable \
pnpm --filter @unilab/workbench package:win
```

The same URL can serve all platforms. Publish the immutable Windows NSIS EXE
and blockmap before atomically replacing `latest.yml`; publish the signed macOS
ZIP and ZIP blockmap before `latest-mac.yml`; publish the AppImage and blockmap
before `latest-linux.yml`. The HTTP service must support HTTPS, `GET`, `HEAD`,
byte-range requests, stable public artifact URLs, and must not cache the
`latest*.yml` metadata for long.

Every push to `main` runs both platform workflows in the `production` channel.
Windows uses the pre-created `workbench-windows-stable` rolling GitHub Release;
macOS uses `workbench-macos-stable`. Each workflow reads its published metadata,
increments the patch version only in the runner, uploads binaries and blockmaps
first, replaces metadata last, and removes superseded updater assets only after
verification. These rolling channels never replace the repository's Latest
Release. Their `GITHUB_TOKEN` only updates existing releases; bootstrapping or
recreating a release requires an authorized maintainer token.

Windows production and test workflows currently generate a new ephemeral
self-signed Authenticode certificate for each full CI build. The workflow verifies
the installer against that exact certificate thumbprint, but Windows clients do
not trust the identity and may show SmartScreen warnings. This is an interim
bridge only; replace it with a stable trusted certificate before general release.

`deploy-windows-test` builds only the Windows `test` package and
`deploy-mac-test` builds only the signed and notarized macOS `test` package.
Their filenames and Actions Artifact names include `Test`/`test`. They use the
source package version, never read or increment production Release metadata,
never upload to a rolling Release, and carry a compile-time-disabled updater.
The macOS test build generates only a DMG. Both macOS branches expose only the
DMG through Actions Artifacts; `main` still keeps its signed ZIP, blockmap, and
`latest-mac.yml` exclusively in `workbench-macos-stable` because those internal
assets are required by macOS automatic updates.
The same compiled channel selects `platform.test.bohrium.com` and
`leap-lab.test.bohrium.com` for test packages, while production packages select
`platform.bohrium.com` and `leap-lab.bohrium.com`.
Merging either test branch into `main` changes the same commit to the production
channel because the channel is derived from the protected target branch.

### Desktop packaging CI modes

The Windows workflow exposes three explicit modes. `quick` builds the
production Workbench once and validates the unpacked application without
spending time on NSIS. `full` produces and verifies the complete rolling update
bundle. `benchmark` prepares one unpacked Windows application, then reuses that
identical input to compare the baseline NSIS profile with the `.exe`
pre-compressed-resource profile. The benchmark uploads only JSON measurements;
both installers and blockmaps are still generated and verified on the runner.

The macOS workflow exposes `quick` and `full`. Pushes to `main` and
`deploy-mac-test` use signed `full` to generate, notarize and verify both DMG and
ZIP media. Only `main` publishes the ZIP update set; the test branch retains the
bundle solely as a short-lived Actions Artifact. A manual quick run remains an
unsigned validation path.

Both platform workflows first restore the pinned Runtime from the immutable
`workbench-runtime-<version>-<source>` GitHub Release. If that release does not
exist, they safely fall back to the content-addressed Actions cache and then to
the pinned Uni-Lab OS source build. An authorized maintainer creates or verifies
the immutable Runtime assets through the manually dispatched `Publish Versioned
Workbench Runtime` workflow. Each large asset has an adjacent SHA-256 manifest,
and packaging rejects a missing asset or digest mismatch instead of silently
using it.

## macOS distribution

The formal macOS arm64 application packages the shared Electron shell, Theia
frontend/backend, Pyright and Git plugins, and a pinned Node backend runtime.
It discovers an installed UniLab OS environment after Workspace selection; an
OS source checkout is optional. Every ordinary launch opens the Workspace
welcome surface with native open/create dialogs and recent successful
selections.

```bash
# Local artifact and cold-start acceptance; intentionally unsigned.
UNILAB_WORKBENCH_RELEASE_CHANNEL=test \
UNILAB_WORKBENCH_UPDATE_URL=https://updates.example.com/workbench/stable \
pnpm --filter @unilab/workbench package:mac:unsigned

# Local T14 release-candidate acceptance; ad-hoc signed and not notarized.
UNILAB_WORKBENCH_RELEASE_CHANNEL=test \
UNILAB_WORKBENCH_UPDATE_URL=https://updates.example.com/workbench/stable \
pnpm --filter @unilab/workbench package:mac:adhoc

# Formal Developer ID release; fails closed unless every credential is present.
CSC_LINK=/secure/developer-id.p12 \
CSC_KEY_PASSWORD=... \
APPLE_ID=... \
APPLE_APP_SPECIFIC_PASSWORD=... \
APPLE_TEAM_ID=... \
UNILAB_WORKBENCH_RELEASE_CHANNEL=production \
UNILAB_WORKBENCH_UPDATE_URL=https://updates.example.com/workbench/stable \
pnpm --filter @unilab/workbench package:mac
```

The build verifies the pinned Node archive SHA-256, packaged native resources,
and an executable backend HTTP smoke test before publishing the DMG, ZIP and
update metadata. The formal path Developer ID signs and notarizes the app,
submits the containing DMG for a separate notarization ticket, and requires
`codesign --verify`, Gatekeeper assessment plus stapler validation for both
media. The DMG container is notarized but intentionally not separately
code-signed because electron-builder warns that DMG signing is unnecessary and
can conflict with notarization. It never silently publishes an unsigned app.
The distinctly named `rc-adhoc` artifact verifies the signed
application bundle and installer shape for local T14 acceptance only; it does
not claim Developer ID trust or replace the formal release.

Workbench owns the packaged Theia process tree. Closing the app stops the
backend first (which in turn stops managed OS, Agent and PLC processes) and
forces termination after a five-second bound. The legacy Kernel Electron
surface remains independent from Theia.

Workspace-owned state uses `.unilabos/schema.json` and separates durable
`sessions/`, `agent/` and `audit/` data from quota-managed `runtime/`, `logs/`
and `cache/`. Schema upgrades create a backup; corrupt metadata is isolated in
`recovery/`; diagnostics redact paths and credentials and never include Agent
conversation content.

macOS arm64 is the T11 supported target. macOS x64 remains explicitly
unverified. Windows signing and distribution remain the T13 delivery slice.
