import { describe, expect, it } from 'vitest'

import { requireDesktopUpdateUrl } from './update-publish.mjs'

describe('desktop update publish URL', () => {
  it('accepts a credential-free HTTPS directory', () => {
    expect(requireDesktopUpdateUrl({
      UNILAB_DESKTOP_UPDATE_URL: 'https://updates.example.com/desktop/stable/'
    })).toBe('https://updates.example.com/desktop/stable')
  })

  it('rejects missing, insecure or credential-bearing endpoints', () => {
    expect(() => requireDesktopUpdateUrl({})).toThrow(/缺少/)
    expect(() => requireDesktopUpdateUrl({
      UNILAB_DESKTOP_UPDATE_URL: 'http://updates.example.com/desktop'
    })).toThrow(/HTTPS/)
    expect(() => requireDesktopUpdateUrl({
      UNILAB_DESKTOP_UPDATE_URL: 'https://user:secret@updates.example.com/desktop'
    })).toThrow(/无凭据/)
  })
})
