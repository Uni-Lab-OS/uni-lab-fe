import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  createServer as createHttpServer,
  request as requestHttp
} from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import net from 'node:net'

import {
  acquireRemoteAccessLease,
  createRemoteCapabilityAuthority,
  DEFAULT_REMOTE_TOKEN_TTL_MS
} from './remote-access.mjs'

const AUTH_PATH = '/__unilab/auth'
const SESSION_PATH = '/__unilab/session'
const LOGOUT_PATH = '/__unilab/logout'
const HEALTH_PATH = '/__unilab/health'
const CLOSE_TIMEOUT_MS = 5_000

/**
 * Start the sole browser-facing Workbench endpoint. Theia and every control
 * process remain on loopback; authenticated HTTP and WebSocket traffic is
 * forwarded without exposing the per-start capability to the backend.
 */
export async function startRemoteWorkbenchFacade(options) {
  assertBackendPort(options.backendPort)
  const authenticationRequired = options.authenticationRequired ?? true
  const host = options.host ?? '127.0.0.1'
  const requestedPort = options.port ?? 0
  const tls = await resolveTls(options)
  if (!isLoopbackHost(host) && !tls) {
    throw new Error(
      'Non-loopback Workbench facade requires --tls-cert and --tls-key'
    )
  }
  let publicOrigin = options.publicOrigin
    ? normalizePublicOrigin(options.publicOrigin)
    : null
  if (!isLoopbackHost(host) && !publicOrigin) {
    throw new Error('Non-loopback Workbench facade requires --public-origin')
  }
  if (!isLoopbackHost(host) && publicOrigin.protocol !== 'https:') {
    throw new Error('Non-loopback Workbench public origin must use HTTPS')
  }
  if (tls && publicOrigin && publicOrigin.protocol !== 'https:') {
    throw new Error('TLS Workbench facade public origin must use HTTPS')
  }

  let authority = null
  let lease = null
  let cookieName = null
  let closing = null
  const sockets = new Set()
  const requestHandler = (request, response) => {
    void routeRequest(request, response).catch(error => {
      options.log?.(`remote request failed: ${safeErrorMessage(error)}`)
      sendJson(response, 500, { error: 'remote_request_failed' })
    })
  }
  const server = tls
    ? createHttpsServer(tls, requestHandler)
    : createHttpServer(requestHandler)
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.on('upgrade', (request, socket, head) => {
    if (!authority || !publicOrigin || !cookieName) {
      rejectUpgrade(socket, 503, 'not_ready')
      return
    }
    if (!validHost(request, publicOrigin)) {
      rejectUpgrade(socket, 421, 'invalid_host')
      return
    }
    if (request.headers.origin !== publicOrigin.origin) {
      rejectUpgrade(socket, 403, 'invalid_origin')
      return
    }
    if (authenticationRequired) {
      const authentication = authenticateRequest(
        request,
        authority,
        cookieName
      )
      if (!authentication.valid) {
        rejectUpgrade(socket, 401, authentication.code)
        return
      }
    }
    proxyUpgrade(request, socket, head, {
      backendPort: options.backendPort,
      publicOrigin,
      cookieName,
      log: options.log,
      sockets
    })
  })

  try {
    await listen(server, requestedPort, host)
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Workbench facade did not expose a TCP address')
    }
    if (!publicOrigin) {
      const originHost = host === '::1' ? '[::1]' : host
      publicOrigin = new URL(`${tls ? 'https' : 'http'}://${originHost}:${address.port}`)
    }
    cookieName = publicOrigin.protocol === 'https:'
      ? '__Host-unilab_workbench_session'
      : 'unilab_workbench_session'
    authority = createRemoteCapabilityAuthority({
      pid: options.pid ?? process.pid,
      port: address.port,
      generation: options.generation,
      ttlMs: options.tokenTtlMs ?? DEFAULT_REMOTE_TOKEN_TTL_MS,
      now: options.now,
      secret: options.secret,
      nonce: options.nonce
    })
    lease = await acquireRemoteAccessLease({
      workspacePath: options.workspacePath,
      identity: authority.identity,
      tokenDigest: authority.tokenDigest,
      backendPort: options.backendPort,
      publicOrigin: publicOrigin.origin,
      now: options.dateNow,
      processAlive: options.processAlive
    })
    const accessUrl = authenticationRequired
      ? new URL(AUTH_PATH, publicOrigin)
      : new URL(options.rendererPath ?? '/', publicOrigin)
    if (authenticationRequired) accessUrl.hash = `token=${authority.token}`
    options.log?.(
      `remote facade ready pid=${authority.identity.pid} port=${address.port} generation=${authority.identity.generation}`
    )

    return Object.freeze({
      accessUrl: accessUrl.toString(),
      origin: publicOrigin.origin,
      identity: authority.identity,
      metadataPath: lease.metadataPath,
      close() {
        if (closing) return closing
        closing = (async () => {
          await closeServerBounded(server, sockets)
          await lease.release()
          options.log?.(
            `remote facade stopped generation=${authority.identity.generation}`
          )
        })()
        return closing
      }
    })
  } catch (error) {
    await closeServerBounded(server, sockets)
    await lease?.release()
    throw error
  }

  async function routeRequest(request, response) {
    if (!authority || !publicOrigin || !cookieName) {
      sendJson(response, 503, { error: 'not_ready' })
      return
    }
    if (!validHost(request, publicOrigin)) {
      sendJson(response, 421, { error: 'invalid_host' })
      return
    }
    const pathname = new URL(request.url ?? '/', publicOrigin).pathname
    if (pathname === HEALTH_PATH && request.method === 'GET') {
      sendJson(response, 200, { status: 'ok' })
      return
    }
    if (pathname === AUTH_PATH && request.method === 'GET') {
      serveAuthenticationBootstrap(response)
      return
    }
    if (pathname === SESSION_PATH && request.method === 'POST') {
      if (request.headers.origin !== publicOrigin.origin) {
        sendJson(response, 403, { error: 'invalid_origin' })
        return
      }
      const authentication = authenticateBearer(request, authority)
      if (!authentication.valid) {
        sendJson(response, 401, { error: authentication.code })
        return
      }
      response.setHeader('set-cookie', serializeSessionCookie(
        cookieName,
        authority.token,
        authority.identity.expiresAt - Date.now(),
        publicOrigin.protocol === 'https:'
      ))
      sendJson(response, 200, {
        redirect: options.rendererPath ?? '/'
      })
      return
    }

    if (authenticationRequired) {
      const authentication = authenticateRequest(
        request,
        authority,
        cookieName
      )
      if (!authentication.valid) {
        sendJson(response, 401, { error: authentication.code }, {
          'www-authenticate': 'UniLab-Workbench'
        })
        return
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD'
      && request.headers.origin !== publicOrigin.origin) {
      sendJson(response, 403, { error: 'invalid_origin' })
      return
    }
    if (pathname === LOGOUT_PATH && request.method === 'POST') {
      response.setHeader('set-cookie', serializeExpiredCookie(
        cookieName,
        publicOrigin.protocol === 'https:'
      ))
      sendJson(response, 200, { status: 'logged_out' })
      return
    }
    proxyHttpRequest(request, response, {
      backendPort: options.backendPort,
      publicOrigin,
      cookieName,
      log: options.log
    })
  }
}

function authenticateBearer(request, authority) {
  const authorization = request.headers.authorization
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
    return { valid: false, code: 'missing_capability' }
  }
  return authority.validate(authorization.slice('Bearer '.length))
}

function authenticateRequest(request, authority, cookieName) {
  const cookies = parseCookies(request.headers.cookie)
  const token = cookies.get(cookieName)
  if (!token) return { valid: false, code: 'missing_session' }
  return authority.validate(token)
}

function proxyHttpRequest(request, response, options) {
  const headers = forwardedHeaders(request.headers, options)
  const upstream = requestHttp({
    hostname: '127.0.0.1',
    port: options.backendPort,
    path: request.url,
    method: request.method,
    headers
  }, upstreamResponse => {
    const responseHeaders = { ...upstreamResponse.headers }
    if (typeof responseHeaders.location === 'string') {
      responseHeaders.location = rewriteLocation(
        responseHeaders.location,
        options.backendPort,
        options.publicOrigin
      )
    }
    response.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)
    upstreamResponse.pipe(response)
  })
  upstream.once('error', error => {
    options.log?.(`remote HTTP upstream unavailable: ${safeErrorMessage(error)}`)
    if (!response.headersSent) sendJson(response, 502, { error: 'upstream_unavailable' })
    else response.destroy(error)
  })
  request.once('aborted', () => upstream.destroy())
  request.pipe(upstream)
}

function proxyUpgrade(request, socket, head, options) {
  const upstream = net.connect(options.backendPort, '127.0.0.1', () => {
    const headers = forwardedHeaders(request.headers, options)
    const lines = []
    for (const [name, rawValue] of Object.entries(headers)) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue]
      for (const value of values) {
        if (value !== undefined) lines.push(`${name}: ${value}`)
      }
    }
    upstream.write(
      `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${lines.join('\r\n')}\r\n\r\n`
    )
    if (head.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  options.sockets.add(upstream)
  const close = error => {
    if (error) options.log?.(`remote WebSocket upstream unavailable: ${safeErrorMessage(error)}`)
    upstream.destroy()
    socket.destroy()
  }
  upstream.once('error', close)
  socket.once('error', close)
  upstream.once('close', () => {
    options.sockets.delete(upstream)
    socket.destroy()
  })
  upstream.once('end', () => socket.destroy())
  socket.once('close', () => upstream.destroy())
  socket.once('end', () => upstream.destroy())
}

function forwardedHeaders(headers, options) {
  const forwarded = { ...headers }
  delete forwarded.authorization
  delete forwarded['proxy-authorization']
  forwarded.cookie = withoutSessionCookie(headers.cookie, options.cookieName)
  if (!forwarded.cookie) delete forwarded.cookie
  forwarded.host = `127.0.0.1:${options.backendPort}`
  forwarded['x-forwarded-host'] = options.publicOrigin.host
  forwarded['x-forwarded-proto'] = options.publicOrigin.protocol.slice(0, -1)
  return forwarded
}

function serveAuthenticationBootstrap(response) {
  const nonce = randomBytes(18).toString('base64url')
  const source = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>UniLab Workbench 登录</title></head><body>
<main><h1>UniLab Workbench</h1><p id="status">正在验证本次启动凭据…</p></main>
<script nonce="${nonce}">(() => {
  const status = document.getElementById('status')
  const fragment = new URLSearchParams(location.hash.slice(1))
  const token = fragment.get('token')
  history.replaceState(null, '', location.pathname)
  if (!token) { status.textContent = '缺少本次启动凭据。'; return }
  fetch('${SESSION_PATH}', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token }
  }).then(async response => {
    if (!response.ok) throw new Error('凭据无效或已过期')
    const result = await response.json()
    location.replace(result.redirect)
  }).catch(error => { status.textContent = error.message })
})()</script></body></html>`
  response.writeHead(200, securityHeaders({
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`
  }))
  response.end(source)
}

function sendJson(response, statusCode, body, headers = {}) {
  if (response.headersSent) return
  response.writeHead(statusCode, securityHeaders({
    'content-type': 'application/json; charset=utf-8',
    ...headers
  }))
  response.end(JSON.stringify(body))
}

function securityHeaders(headers) {
  return {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...headers
  }
}

function validHost(request, publicOrigin) {
  return request.headers.host?.toLowerCase() === publicOrigin.host.toLowerCase()
}

function parseCookies(source) {
  const result = new Map()
  if (!source) return result
  for (const pair of source.split(';')) {
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    if (name && !result.has(name)) result.set(name, value)
  }
  return result
}

function withoutSessionCookie(source, cookieName) {
  if (!source) return undefined
  const retained = source.split(';').map(value => value.trim()).filter(value =>
    value && !value.startsWith(`${cookieName}=`)
  )
  return retained.length ? retained.join('; ') : undefined
}

function serializeSessionCookie(name, value, remainingMs, secure) {
  const maxAge = Math.max(1, Math.floor(remainingMs / 1_000))
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

function serializeExpiredCookie(name, secure) {
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`
}

function rewriteLocation(location, backendPort, publicOrigin) {
  try {
    const value = new URL(location)
    if (value.hostname === '127.0.0.1' && Number(value.port) === backendPort) {
      return `${publicOrigin.origin}${value.pathname}${value.search}${value.hash}`
    }
  } catch {
    // Relative locations are already valid through the facade.
  }
  return location
}

function rejectUpgrade(socket, statusCode, code) {
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText(statusCode)}\r\nConnection: close\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n${JSON.stringify({ error: code })}`
  )
}

function statusText(statusCode) {
  if (statusCode === 401) return 'Unauthorized'
  if (statusCode === 403) return 'Forbidden'
  if (statusCode === 421) return 'Misdirected Request'
  if (statusCode === 503) return 'Service Unavailable'
  return 'Bad Gateway'
}

async function resolveTls(options) {
  if (!options.tlsCertificatePath && !options.tlsKeyPath) return null
  if (!options.tlsCertificatePath || !options.tlsKeyPath) {
    throw new Error('Both --tls-cert and --tls-key are required')
  }
  const [cert, key] = await Promise.all([
    readFile(options.tlsCertificatePath),
    readFile(options.tlsKeyPath)
  ])
  return { cert, key, minVersion: 'TLSv1.2' }
}

function normalizePublicOrigin(value) {
  const origin = new URL(value)
  if (
    !['http:', 'https:'].includes(origin.protocol)
    || origin.username
    || origin.password
    || origin.pathname !== '/'
    || origin.search
    || origin.hash
  ) throw new Error(`Invalid Workbench public origin: ${value}`)
  return origin
}

export function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost'
}

async function listen(server, port, host) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host, port }, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

async function closeServerBounded(server, sockets) {
  if (!server.listening) return
  let closed = false
  const completion = new Promise(resolve => {
    server.close(() => {
      closed = true
      resolve()
    })
  })
  server.closeIdleConnections?.()
  await Promise.race([completion, delay(CLOSE_TIMEOUT_MS)])
  if (!closed) {
    for (const socket of sockets) socket.destroy()
    server.closeAllConnections?.()
    await Promise.race([completion, delay(250)])
  }
}

function assertBackendPort(port) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid loopback backend port: ${port}`)
  }
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
