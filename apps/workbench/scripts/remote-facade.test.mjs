import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { startRemoteWorkbenchFacade } from './remote-facade.mjs'

const cleanups = []

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).reverse().map(cleanup => cleanup()))
})

describe('remote Workbench authentication facade', () => {
  it('authenticates HTTP and WebSocket proxy traffic without forwarding secrets', async () => {
    const workspace = await fixtureWorkspace()
    let upgradeCookie = null
    const backend = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        url: request.url,
        host: request.headers.host,
        authorization: request.headers.authorization ?? null,
        cookie: request.headers.cookie ?? null
      }))
    })
    backend.on('upgrade', (request, socket) => {
      upgradeCookie = request.headers.cookie ?? null
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nworkbench-ready'
      )
      socket.once('end', () => socket.end())
    })
    const backendPort = await listen(backend)
    cleanups.push(() => closeServer(backend))
    const facade = await startRemoteWorkbenchFacade({
      backendPort,
      workspacePath: workspace,
      host: '127.0.0.1',
      port: 0,
      rendererPath: '/?workflowUuid=workflow-1#/srv/private/workspace'
    })
    cleanups.push(() => facade.close())

    const unauthenticated = await fetch(`${facade.origin}/private`)
    assert.equal(unauthenticated.status, 401)
    const health = await fetch(`${facade.origin}/__unilab/health`)
    assert.deepEqual(await health.json(), { status: 'ok' })
    const bootstrap = await fetch(`${facade.origin}/__unilab/auth`)
    const bootstrapSource = await bootstrap.text()
    assert.equal(bootstrap.status, 200)
    assert.doesNotMatch(bootstrapSource, /srv\/private/u)
    assert.doesNotMatch(bootstrapSource, /workflow-1/u)
    assert.doesNotMatch(bootstrapSource, new RegExp(accessToken(facade), 'u'))

    const session = await createSession(facade)
    assert.equal(session.redirect, '/?workflowUuid=workflow-1#/srv/private/workspace')
    assert.match(session.cookie, /^unilab_workbench_session=/u)
    assert.doesNotMatch(session.cookie, /Secure/u)

    const first = await fetch(`${facade.origin}/first`, {
      headers: { cookie: session.cookie }
    })
    const second = await fetch(`${facade.origin}/second`, {
      headers: { cookie: session.cookie }
    })
    assert.deepEqual(await first.json(), {
      url: '/first',
      host: `127.0.0.1:${backendPort}`,
      authorization: null,
      cookie: null
    })
    assert.equal(second.status, 200)

    const wrongOrigin = await fetch(`${facade.origin}/mutation`, {
      method: 'POST',
      headers: {
        cookie: session.cookie,
        origin: 'https://attacker.example'
      }
    })
    assert.equal(wrongOrigin.status, 403)

    const upgrade = await rawUpgrade(facade.origin, session.cookie)
    assert.match(upgrade, /^HTTP\/1\.1 101/u)
    assert.match(upgrade, /workbench-ready/u)
    assert.equal(upgradeCookie, null)

    const metadata = await readFile(facade.metadataPath, 'utf8')
    assert.doesNotMatch(metadata, new RegExp(accessToken(facade), 'u'))
  })

  it('expires sessions and rejects a previous generation after restart', async () => {
    const workspace = await fixtureWorkspace()
    const backend = createServer((_request, response) => response.end('ok'))
    const backendPort = await listen(backend)
    cleanups.push(() => closeServer(backend))
    let clock = Date.now()
    const first = await startRemoteWorkbenchFacade({
      backendPort,
      workspacePath: workspace,
      host: '127.0.0.1',
      port: 0,
      tokenTtlMs: 60_000,
      now: () => clock
    })
    const firstSession = await createSession(first)
    clock += 60_000
    const expired = await fetch(first.origin, {
      headers: { cookie: firstSession.cookie }
    })
    assert.equal(expired.status, 401)
    assert.deepEqual(await expired.json(), { error: 'expired' })
    await first.close()
    await assert.rejects(() => readFile(first.metadataPath), { code: 'ENOENT' })

    const second = await startRemoteWorkbenchFacade({
      backendPort,
      workspacePath: workspace,
      host: '127.0.0.1',
      port: 0
    })
    cleanups.push(() => second.close())
    assert.notEqual(second.identity.generation, first.identity.generation)
    const oldSession = await fetch(second.origin, {
      headers: { cookie: firstSession.cookie }
    })
    assert.equal(oldSession.status, 401)
  })

  it('refuses a cleartext non-loopback listener', async () => {
    const workspace = await fixtureWorkspace()
    await assert.rejects(() => startRemoteWorkbenchFacade({
      backendPort: 3100,
      workspacePath: workspace,
      host: '0.0.0.0',
      port: 8443,
      publicOrigin: 'http://workbench.example.test:8443'
    }), /requires --tls-cert and --tls-key/)
  })

  it('allows direct HTTP and WebSocket access when authentication is disabled', async () => {
    const workspace = await fixtureWorkspace()
    const backend = createServer((request, response) => response.end(request.url))
    backend.on('upgrade', (_request, socket) => {
      socket.end(
        'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nworkbench-ready'
      )
    })
    const backendPort = await listen(backend)
    cleanups.push(() => closeServer(backend))
    const facade = await startRemoteWorkbenchFacade({
      backendPort,
      workspacePath: workspace,
      host: '127.0.0.1',
      port: 0,
      rendererPath: '/?backend=local-go',
      authenticationRequired: false
    })
    cleanups.push(() => facade.close())

    assert.equal(facade.accessUrl, `${facade.origin}/?backend=local-go`)
    const direct = await fetch(`${facade.origin}/private`)
    assert.equal(direct.status, 200)
    assert.equal(await direct.text(), '/private')
    assert.match(await rawUpgrade(facade.origin), /^HTTP\/1\.1 101/u)
  })
})

async function createSession(facade) {
  const response = await fetch(`${facade.origin}/__unilab/session`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken(facade)}`,
      origin: facade.origin
    }
  })
  assert.equal(response.status, 200)
  return {
    ...(await response.json()),
    cookie: response.headers.get('set-cookie').split(';')[0]
  }
}

function accessToken(facade) {
  return new URLSearchParams(new URL(facade.accessUrl).hash.slice(1)).get('token')
}

async function rawUpgrade(origin, cookie) {
  const target = new URL(origin)
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(target.port), target.hostname, () => {
      socket.write([
        'GET /services HTTP/1.1',
        `Host: ${target.host}`,
        `Origin: ${target.origin}`,
        ...(cookie ? [`Cookie: ${cookie}`] : []),
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dW5pbGFiLXJlbW90ZS10ZXN0',
        '',
        ''
      ].join('\r\n'))
    })
    let result = ''
    socket.setEncoding('utf8')
    socket.on('data', chunk => {
      result += chunk
      if (result.includes('workbench-ready')) {
        socket.destroy()
        resolve(result)
      }
    })
    socket.once('error', reject)
    socket.setTimeout(5_000, () => {
      socket.destroy()
      reject(new Error('WebSocket upgrade timed out'))
    })
  })
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server.address().port
}

async function closeServer(server) {
  if (!server.listening) return
  await new Promise(resolve => server.close(resolve))
}

async function fixtureWorkspace() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'unilab-remote-facade-'))
  cleanups.push(() => rm(workspace, { recursive: true, force: true }))
  return workspace
}
