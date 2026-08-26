import { lstatSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MEBIBYTE = 1024 * 1024

/**
 * 统计文件或目录实际包含的字节数；符号链接只计算链接自身，避免重复计数。
 * @param {string} path 需要统计的文件系统路径。
 * @returns {number} 路径占用的逻辑字节数。
 */
export function measurePathBytes(path) {
  const stats = lstatSync(path)
  if (!stats.isDirectory() || stats.isSymbolicLink()) return stats.size
  return readdirSync(path).reduce(
    (total, name) => total + measurePathBytes(join(path, name)),
    0
  )
}

/**
 * 按成品 resources 的顶层条目生成稳定降序体积报告。
 * @param {string} resourcesDirectory Electron 成品 resources 目录。
 * @returns {{schemaVersion: number, totalBytes: number, entries: Array<{name: string, bytes: number}>}} 资源体积报告。
 */
export function createPackagedResourceReport(resourcesDirectory) {
  const entries = readdirSync(resourcesDirectory)
    .map(name => ({
      name,
      bytes: measurePathBytes(join(resourcesDirectory, name))
    }))
    .sort((left, right) => {
      if (left.bytes !== right.bytes) return right.bytes - left.bytes
      if (left.name === right.name) return 0
      return left.name < right.name ? -1 : 1
    })
  return {
    schemaVersion: 1,
    totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    entries
  }
}

/**
 * 把体积报告写入构建日志，便于比较不同 Actions 运行。
 * @param {{totalBytes: number, entries: Array<{name: string, bytes: number}>}} report 资源体积报告。
 * @param {(message: string) => void} log 日志输出函数。
 */
export function logPackagedResourceReport(report, log = console.log) {
  log(`Workbench resources total: ${formatMebibytes(report.totalBytes)} MiB`)
  for (const entry of report.entries) {
    log(`  ${entry.name}: ${formatMebibytes(entry.bytes)} MiB (${entry.bytes} bytes)`)
  }
}

function formatMebibytes(bytes) {
  return (bytes / MEBIBYTE).toFixed(1)
}
