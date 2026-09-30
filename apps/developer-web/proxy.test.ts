import { afterEach, expect, it, vi } from 'vitest'
import { resolveConfig } from 'vite'
import { fileURLToPath } from 'node:url'

afterEach(() => vi.unstubAllEnvs())

it('defaults to the Uni-Lab-OS Console backend port', async () => {
  vi.stubEnv('VITE_UNILAB_PROXY_TARGET', '')
  vi.stubEnv('VITE_EDGE_API_URL', '')
  const config = await resolveConfig({
    configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
  }, 'serve', 'development')
  const proxy = config.server.proxy?.['/__unilab_backend']
  expect(proxy).toMatchObject({ target: 'http://127.0.0.1:59394' })
})

it('uses the OS console Workspace Backend URL for the Studio proxy', async () => {
  vi.stubEnv('VITE_UNILAB_PROXY_TARGET', '')
  vi.stubEnv('VITE_EDGE_API_URL', 'http://127.0.0.1:49307')
  const config = await resolveConfig({
    configFile: fileURLToPath(new URL('./vite.config.ts', import.meta.url)),
  }, 'serve', 'development')
  const proxy = config.server.proxy?.['/__unilab_backend']
  expect(proxy).toMatchObject({ target: 'http://127.0.0.1:49307' })
  if (proxy && typeof proxy !== 'string') {
    expect(proxy.rewrite?.('/__unilab_backend/api/v1/workflows?page=1'))
      .toBe('/api/v1/workflows?page=1')
  }
})
