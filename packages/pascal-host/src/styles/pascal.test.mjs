import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const stylesheet = await readFile(
  new URL('./pascal.css', import.meta.url),
  'utf8'
)

test('物料 3D 视图隐藏 Pascal 内置相机操作提示', () => {
  assert.match(
    stylesheet,
    /\.pascal-editor-host section\[aria-label='Camera controls hint'\],\s*\.pascal-editor-host section\[aria-label='3D 视角操作提示'\]\s*\{[^}]*display:\s*none;/s
  )
})
