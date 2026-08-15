/**
 * Launch the normal Workbench renderer and attach a headless Chromium client.
 *
 * This is intentionally an Adapter around the same Theia/React/Pascal bundles;
 * it contains no second scene, layout, or screenshot implementation.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const workspace = path.resolve(required('--workspace'))
const port = Number(required('--port'))
const readyFile = path.resolve(required('--ready-file'))
const backendMain = path.join(projectRoot, 'lib', 'backend', 'main.js')
const browser = process.env.UNILAB_HEADLESS_BROWSER ?? defaultBrowser()
if (!existsSync(backendMain)) throw new Error(`Workbench build missing: ${backendMain}`)
if (!existsSync(browser)) throw new Error(`Headless browser missing: ${browser}`)

const runtime = path.dirname(readyFile)
mkdirSync(runtime, { recursive: true })
const address = `http://127.0.0.1:${port}`
const sharedEnvironment = {
  ...process.env,
  THEIA_WORKSPACE: workspace,
  UNILAB_WORKBENCH_RENDERER_URL: address,
  UNILAB_RENDERER_MANAGED_HEADLESS: '1',
  UNILAB_AGENT_ENABLED: '0'
}
const children = []
const theia = launch(process.execPath, [
  backendMain,
  workspace,
  '--hostname',
  '127.0.0.1',
  '--port',
  String(port),
  '--plugins=local-dir:plugins'
], { cwd: projectRoot, env: sharedEnvironment })

await waitFor(`${address}/`, 90_000)
const rendererUrl = `${address}/?headlessRenderer=material&disable=postFx#${encodeURI(workspace)}`
launch(browser, [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-component-update',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--use-angle=swiftshader',
  `--user-data-dir=${path.join(runtime, 'chromium-profile')}`,
  rendererUrl
], { cwd: workspace, env: sharedEnvironment })

const token = readFileSync(
  path.join(workspace, '.unilabos', 'runtime', 'workbench', 'host.token'),
  'utf8'
).trim()
await waitFor(
  `${address}/__unilab_renderer/v1/material/scene?view=2.5d`,
  120_000,
  { Authorization: `Bearer ${token}` }
)
writeFileSync(readyFile, JSON.stringify({
  schemaVersion: 'unilab-headless-material-renderer/v1',
  pid: process.pid,
  address,
  rendererUrl,
  startedAt: new Date().toISOString()
}, null, 2) + '\n', { mode: 0o600 })

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stop(signal))
}
theia.once('exit', (code, signal) => {
  if (!stopping) {
    stop('SIGTERM')
    process.exitCode = signal ? 1 : code ?? 0
  }
})
await new Promise(resolve => process.once('beforeExit', resolve))

function launch(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: 'inherit' })
  children.push(child)
  child.once('error', error => {
    console.error(`[UniLab Headless Renderer] ${error.message}`)
    stop('SIGTERM')
    process.exitCode = 1
  })
  return child
}

function stop(signal) {
  if (stopping) return
  stopping = true
  for (const child of children.reverse()) {
    if (!child.killed) child.kill(signal)
  }
}

async function waitFor(url, timeoutMs, headers = {}) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers })
      if (response.ok) return
      last = `HTTP ${response.status}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`renderer readiness timeout: ${last}`)
}

function required(name) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : ''
  if (!value) throw new Error(`${name} is required`)
  return value
}

function defaultBrowser() {
  let candidates
  if (process.platform === 'darwin') {
    candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ]
  } else if (process.platform === 'win32') {
    candidates = [
      path.join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA ?? '', 'Chromium', 'Application', 'chrome.exe')
    ]
  } else {
    candidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge'
    ]
  }
  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0]
}
