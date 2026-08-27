import { describe, expect, it } from 'vitest'

import {
  resolveAppUpdateProgressBarValue,
  type AppUpdateSnapshot
} from './appUpdate'

describe('resolveAppUpdateProgressBarValue', () => {
  it('projects download percent to the Electron progress range', () => {
    expect(resolveAppUpdateProgressBarValue(snapshot({
      phase: 'downloading',
      progressPercent: 42.3
    }))).toBeCloseTo(0.423)
    expect(resolveAppUpdateProgressBarValue(snapshot({
      phase: 'paused',
      progressPercent: 42.3
    }))).toBeCloseTo(0.423)
  })

  it('clamps invalid download progress values', () => {
    expect(resolveAppUpdateProgressBarValue(snapshot({
      phase: 'downloading',
      progressPercent: -12
    }))).toBe(0)
    expect(resolveAppUpdateProgressBarValue(snapshot({
      phase: 'downloading',
      progressPercent: 120
    }))).toBe(1)
    expect(resolveAppUpdateProgressBarValue(snapshot({
      phase: 'downloading',
      progressPercent: Number.NaN
    }))).toBe(0)
  })

  it('removes the system progress display outside download state', () => {
    expect(resolveAppUpdateProgressBarValue(snapshot({
      phase: 'available'
    }))).toBe(-1)
    expect(resolveAppUpdateProgressBarValue(snapshot({
      phase: 'downloaded',
      progressPercent: 100
    }))).toBe(-1)
    expect(resolveAppUpdateProgressBarValue(snapshot({
      phase: 'error'
    }))).toBe(-1)
  })
})

function snapshot(
  change: Partial<AppUpdateSnapshot> & Pick<AppUpdateSnapshot, 'phase'>
): AppUpdateSnapshot {
  return {
    currentVersion: '0.1.0',
    ...change
  }
}
