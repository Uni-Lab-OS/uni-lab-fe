import { describe, expect, it } from 'vitest'
import { DEFAULT_LOADING_DIALOG_SIZE, readRelativeDialogSize } from './relativeDialogSize'

describe('relative loading dialog preference', () => {
  it('uses relative dimensions independent of display resolution', () => {
    expect(readRelativeDialogSize('{"width":0.7,"height":0.5}')).toEqual({ width: 0.7, height: 0.5 })
  })
  it('clamps stale dimensions to the visible viewport', () => {
    expect(readRelativeDialogSize('{"width":4,"height":-1}')).toEqual({ width: 0.95, height: 0.3 })
  })
  it.each([null, '{broken', 'null', '{}', '{"width":"0.7","height":0.5}'])('recovers malformed preferences %s', value => {
    expect(readRelativeDialogSize(value)).toEqual(DEFAULT_LOADING_DIALOG_SIZE)
  })
})
