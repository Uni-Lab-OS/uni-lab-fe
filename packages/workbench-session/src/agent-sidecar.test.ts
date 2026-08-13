import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import * as asar from '@electron/asar'

import { describe, expect, it } from 'vitest'

import {
  ensureManagedLocalAgentDefaults,
  isProtectedAgentRequest,
  managedConversationRequestBody,
  managedLocalAgentAuthStatus,
  managedLocalBootstrapScript,
  normalizeAgentRendererArchiveEntry,
  prepareRenderer,
  waitForManagedAgentApi
} from './agent-sidecar'

async function createRendererArchive(
  root: string,
  files: Record<string, string>
): Promise<string> {
  const source = join(root, 'source')
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(source, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, contents)
  }
  const archive = join(root, 'agent.asar')
  await asar.createPackage(source, archive)
  return archive
}

describe('Workbench Agent renderer cache', () => {
  it('normalizes Windows and POSIX archive entries', () => {
    expect(normalizeAgentRendererArchiveEntry('\\out\\renderer\\index.html'))
      .toBe('/out/renderer/index.html')
    expect(normalizeAgentRendererArchiveEntry('/out/renderer/index.html'))
      .toBe('/out/renderer/index.html')
  })

  it('extracts the renderer and repairs a stale marker-only cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'unilab-agent-renderer-'))
    try {
      const archive = await createRendererArchive(root, {
        'out/renderer/index.html': '<main>UniLab Agent</main>',
        'out/renderer/assets/index.js': 'window.agentReady = true'
      })
      const dataDir = join(root, 'data')
      const rendererDir = await prepareRenderer(archive, dataDir)

      await expect(readFile(join(rendererDir, 'index.html'), 'utf8'))
        .resolves.toBe('<main>UniLab Agent</main>')
      await expect(readFile(join(rendererDir, 'assets', 'index.js'), 'utf8'))
        .resolves.toBe('window.agentReady = true')
      await expect(readFile(join(rendererDir, '.ready'), 'utf8'))
        .resolves.toBe('unilab-agent-renderer/v1\n')

      await rm(join(rendererDir, 'index.html'), { force: true })
      await expect(prepareRenderer(archive, dataDir)).resolves.toBe(rendererDir)
      await expect(readFile(join(rendererDir, 'index.html'), 'utf8'))
        .resolves.toBe('<main>UniLab Agent</main>')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not mark or retain an archive without a renderer entry point', async () => {
    const root = await mkdtemp(join(tmpdir(), 'unilab-agent-renderer-'))
    try {
      const archive = await createRendererArchive(root, {
        'out/renderer/assets/index.js': 'window.agentReady = true'
      })
      const dataDir = join(root, 'data')

      await expect(prepareRenderer(archive, dataDir))
        .rejects.toThrow('missing out/renderer/index.html')
      await expect(readdir(join(dataDir, 'renderer-cache')))
        .resolves.toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('Workbench Agent private-state boundary', () => {
  it('rejects direct, encoded and traversal access to .unilabos', () => {
    expect(isProtectedAgentRequest('/api/files?path=../.unilabos/agent/aionui')).toBe(true)
    expect(isProtectedAgentRequest('/api/files?path=..%2F.unilabos%2Fsession.json')).toBe(true)
    expect(isProtectedAgentRequest('/api/files?path=%252Eunilabos%252Fsession.json')).toBe(true)
    expect(isProtectedAgentRequest('/api/files?path=.unilabos/session.json')).toBe(true)
    expect(isProtectedAgentRequest('/api/files', JSON.stringify({ path: '.unilabos/logs' }))).toBe(true)
    expect(isProtectedAgentRequest('/api/files', '{"path":"\\u002eunilabos/logs"}')).toBe(true)
  })

  it('allows ordinary Editable Package files and provider/session APIs', () => {
    expect(isProtectedAgentRequest('/api/files?path=workflows/s06_robot.py')).toBe(false)
    expect(isProtectedAgentRequest('/api/conversations', '{"provider":"codex"}')).toBe(false)
  })
})

describe('Workbench Agent managed-local identity bridge', () => {
  it('publishes the aioncore system identity without a login credential', () => {
    expect(managedLocalAgentAuthStatus()).toEqual({
      mode: 'password',
      authenticated: true,
      user: {
        id: 'system_default_user',
        name: 'UniLab Local',
        username: 'system_default_user',
        avatarUrl: null
      }
    })
  })

  it('does not expose the renderer until the assistants API is ready', async () => {
    let attempts = 0
    const server = createServer((request, response) => {
      attempts += 1
      response.writeHead(attempts < 3 ? 503 : 200, {
        'content-type': 'application/json'
      })
      response.end(JSON.stringify(request.url === '/api/assistants'
        ? { success: true, data: [] }
        : { error: 'unexpected route' }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('test server did not expose a TCP port')
    }

    try {
      await expect(waitForManagedAgentApi(address.port, 2_000, 1))
        .resolves.toBeUndefined()
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => (
        error ? reject(error) : resolve()
      )))
    }
    expect(attempts).toBe(3)
  })

  it('seeds Simplified Chinese once and primes the renderer language', async () => {
    const requests: Array<{ method: string; url: string; body: string }> = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        requests.push({
          method: request.method ?? '',
          url: request.url ?? '',
          body: Buffer.concat(chunks).toString('utf8')
        })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(request.url?.startsWith('/api/settings/client')
          ? { success: true, data: {} }
          : { success: true, data: { language: 'en-US' } }))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('test server did not expose a TCP port')
    }

    try {
      expect(await ensureManagedLocalAgentDefaults(address.port)).toBe('zh-CN')
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => (
        error ? reject(error) : resolve()
      )))
    }

    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'PATCH',
        url: '/api/settings',
        body: JSON.stringify({ language: 'zh-CN' })
      }),
      expect.objectContaining({
        method: 'PUT',
        url: '/api/settings/client',
        body: JSON.stringify({
          'guid.lastAssistantId': 'bare:8e1acf31',
          'unilab.defaultLanguageVersion': '1'
        })
      })
    ]))

    const bootstrap = managedLocalBootstrapScript('zh-CN')
    expect(bootstrap).toContain('window.__initialLanguage = "zh-CN"')
    expect(bootstrap).toContain(
      "localStorage.setItem('i18nextLng', \"zh-CN\")"
    )
  })
})

describe('Workbench Agent managed Workspace binding', () => {
  it('replaces AionUI temporary mode without changing the selected assistant', () => {
    const body = Buffer.from(JSON.stringify({
      name: 'Inspect the project',
      assistant: {
        id: 'bare:2d23ff1c',
        conversation_overrides: { permission: 'auto' }
      },
      extra: {
        workspace: '',
        custom_workspace: false,
        default_files: []
      }
    }))

    expect(JSON.parse(managedConversationRequestBody(
      body,
      '/workspace/Uni-Lab-SZLab'
    ).toString('utf8'))).toEqual({
      name: 'Inspect the project',
      assistant: {
        id: 'bare:2d23ff1c',
        conversation_overrides: { permission: 'auto' }
      },
      extra: {
        workspace: '/workspace/Uni-Lab-SZLab',
        custom_workspace: true,
        default_files: []
      }
    })
  })
})
