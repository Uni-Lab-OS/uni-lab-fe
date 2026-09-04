import { describe, expect, it } from 'vitest'

import {
  isRetryableModelLoadError,
  modelLoadRetryDelayMs
} from './modelLoadRetry'

describe('modelLoadRetry', () => {
  it('retries transient backend proxy failures', () => {
    expect(isRetryableModelLoadError('HTTP 502 loading /api/v1/material-models/foo'))
      .toBe(true)
    expect(isRetryableModelLoadError('fetch failed')).toBe(true)
    expect(isRetryableModelLoadError('xacro include not found')).toBe(false)
  })

  it('backs off retry delays', () => {
    expect(modelLoadRetryDelayMs(1)).toBe(3_000)
    expect(modelLoadRetryDelayMs(8)).toBe(10_000)
  })
})
