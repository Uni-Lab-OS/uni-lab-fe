'use strict'

const fs = require('node:fs')

const originalCopyFile = fs.promises.copyFile.bind(fs.promises)

/**
 * Windows keeps loaded `.node` and DLL files locked. Theia copies node-pty's
 * unchanged prebuilds on every watch rebuild, so avoid only that no-op copy.
 * A changed native payload must still fail instead of mixing JS and binaries.
 */
async function copyFileWithNativeGuard(
  source,
  target,
  mode,
  options = {}
) {
  const platform = options.platform ?? process.platform
  const copyFile = options.copyFile ?? originalCopyFile
  if (
    platform === 'win32'
    && isWorkbenchNodePtyCopy(source, target)
    && await filesEqual(source, target)
  ) {
    return
  }
  try {
    if (mode === undefined) return await copyFile(source, target)
    return await copyFile(source, target, mode)
  } catch (error) {
    if (
      platform === 'win32'
      && isWorkbenchNodePtyCopy(source, target)
      && error?.code === 'EBUSY'
    ) {
      throw new Error(
        'Workbench 原生终端模块已变更且正被运行中的开发窗口占用；'
          + '请关闭该 Workbench 窗口后重新执行构建。',
        { cause: error }
      )
    }
    throw error
  }
}

function isWorkbenchNodePtyCopy(source, target) {
  const sourcePath = normalizedPath(source)
  const targetPath = normalizedPath(target)
  return sourcePath.includes('/node-pty/prebuilds/win32-')
    && targetPath.includes('/apps/workbench/lib/prebuilds/win32-')
}

async function filesEqual(source, target) {
  try {
    const [sourceStat, targetStat] = await Promise.all([
      fs.promises.stat(source),
      fs.promises.stat(target)
    ])
    if (
      !sourceStat.isFile()
      || !targetStat.isFile()
      || sourceStat.size !== targetStat.size
    ) return false
    const [sourceBytes, targetBytes] = await Promise.all([
      fs.promises.readFile(source),
      fs.promises.readFile(target)
    ])
    return sourceBytes.equals(targetBytes)
  } catch {
    return false
  }
}

function normalizedPath(value) {
  return String(value).replaceAll('\\', '/').toLowerCase()
}

fs.promises.copyFile = (source, target, mode) => copyFileWithNativeGuard(
  source,
  target,
  mode
)

module.exports = {
  copyFileWithNativeGuard,
  filesEqual,
  isWorkbenchNodePtyCopy
}
