import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const previewBin = resolve(appRoot, 'node_modules/.bin/vite')
const origin = 'http://127.0.0.1:4173'
const backend = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  response.end(request.url === '/api/v1/health' ? '{"status":"ok"}' : '{}')
})
await new Promise((resolveListen, rejectListen) => {
  backend.once('error', rejectListen)
  backend.listen(0, '127.0.0.1', resolveListen)
})
const backendAddress = backend.address()
if (!backendAddress || typeof backendAddress === 'string') {
  throw new Error('Regression backend did not bind to a TCP port')
}
const server = spawn(previewBin, ['preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
  cwd: appRoot,
  env: {
    ...process.env,
    UNILAB_BACKEND_PROXY_TARGET: `http://127.0.0.1:${backendAddress.port}`
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

let output = ''
server.stdout.on('data', (chunk) => { output += chunk })
server.stderr.on('data', (chunk) => { output += chunk })

async function waitUntilReady() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(origin)
      if (response.ok) return
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error(`Web preview did not become ready.\n${output}`)
}

try {
  await waitUntilReady()
  const indexResponse = await fetch(origin)
  const index = await indexResponse.text()
  if (!indexResponse.ok || !index.includes('<div id="root"></div>')) {
    throw new Error(`Root document regression failed: ${indexResponse.status}`)
  }
  if (/\/assets\/vendor-(?:three|pascal)[^"']+\.js/.test(index)) {
    throw new Error('Root document eagerly preloads the lazy 3D renderer dependencies')
  }

  const assetPaths = [...index.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]
    .map((match) => match[1])
  if (assetPaths.length < 2) throw new Error('Root document does not reference JS and CSS assets')

  for (const assetPath of assetPaths) {
    const response = await fetch(`${origin}${assetPath}`)
    if (!response.ok) throw new Error(`Asset regression failed: ${assetPath} -> ${response.status}`)
  }

  const fallbackResponse = await fetch(`${origin}/deployment-regression/nested-route`)
  const fallback = await fallbackResponse.text()
  if (!fallbackResponse.ok || !fallback.includes('<div id="root"></div>')) {
    throw new Error(`SPA fallback regression failed: ${fallbackResponse.status}`)
  }

  const manifestIndex = await readFile(resolve(appRoot, 'dist/index.html'), 'utf8')
  if (manifestIndex !== index) throw new Error('Preview did not serve the current production build')

  const { chromium } = await import('@playwright/test')
  const bundledChromium = chromium.executablePath()
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  let executablePath
  try {
    await access(bundledChromium)
  } catch {
    await access(systemChrome)
    executablePath = systemChrome
  }
  const browser = await chromium.launch({ headless: true, executablePath })
  const browserErrors = []
  try {
    const page = await browser.newPage()
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
    })
    page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
    page.on('response', (response) => {
      if (response.status() >= 400) {
        browserErrors.push(`response: ${response.status()} ${response.url()}`)
      }
    })
    page.on('requestfailed', (request) => {
      browserErrors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`)
    })
    await page.goto(origin, { waitUntil: 'networkidle' })
    await page.locator('#root').waitFor({ state: 'attached' })
    if (browserErrors.length > 0) {
      throw new Error(`Browser regression reported errors:\n${browserErrors.join('\n')}`)
    }
  } finally {
    await browser.close()
  }

  console.log(`Web deployment regression passed: root, ${assetPaths.length} entry assets, SPA fallback, browser console`)
} finally {
  server.kill('SIGTERM')
  backend.close()
}
