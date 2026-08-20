import { createHash } from 'node:crypto'
import {
  appendFileSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  renameSync,
  rmSync
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const GITHUB_API_VERSION = '2022-11-28'

/**
 * 从不可变 GitHub Release 下载并校验版本化 Runtime 安装器。
 * @param {{repository: string, tag: string, assetName: string, destination: string, token?: string, fetchImpl?: typeof fetch}} options 下载参数与可替换网络实现。
 * @returns {Promise<{restored: boolean, reason: 'release' | 'missing-release', sha256?: string}>} 是否恢复成功及其可信摘要。
 * @throws {Error} Release 存在但资产、摘要或下载内容不完整时抛出，禁止降级到不可信构建。
 */
export async function restoreVersionedRuntime({
  repository,
  tag,
  assetName,
  destination,
  token,
  fetchImpl = fetch
}) {
  validateInputs({ repository, tag, assetName, destination })
  const headers = githubHeaders(token)
  const releaseResponse = await fetchImpl(
    `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
    { headers }
  )
  if (releaseResponse.status === 404) {
    return { restored: false, reason: 'missing-release' }
  }
  if (!releaseResponse.ok) {
    throw new Error(
      `读取 Runtime Release 失败：HTTP ${releaseResponse.status}`
    )
  }
  const release = await releaseResponse.json()
  const checksumName = `${assetName}.sha256`
  const installerAsset = findReleaseAsset(release.assets, assetName)
  const checksumAsset = findReleaseAsset(release.assets, checksumName)
  const expectedSha256 = parseSha256Manifest(
    await downloadTextAsset(checksumAsset, headers, fetchImpl),
    assetName
  )
  const absoluteDestination = resolve(destination)
  const temporaryDestination = `${absoluteDestination}.download-${process.pid}`
  mkdirSync(dirname(absoluteDestination), { recursive: true })
  rmSync(temporaryDestination, { force: true })
  try {
    await downloadFileAsset(
      installerAsset,
      temporaryDestination,
      headers,
      fetchImpl
    )
    const actualSha256 = await hashFileSha256(temporaryDestination)
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `Runtime SHA-256 不一致：需要 ${expectedSha256}，实际 ${actualSha256}`
      )
    }
    rmSync(absoluteDestination, { force: true })
    renameSync(temporaryDestination, absoluteDestination)
    return { restored: true, reason: 'release', sha256: actualSha256 }
  } finally {
    rmSync(temporaryDestination, { force: true })
  }
}

/**
 * 从 Release 元数据中选择唯一资产。
 * @param {unknown} assets GitHub Release 返回的资产集合。
 * @param {string} expectedName 需要匹配的精确文件名。
 * @returns {{name: string, url: string}} 已校验的资产描述。
 * @throws {Error} 资产缺失、重复或下载地址无效时抛出。
 */
function findReleaseAsset(assets, expectedName) {
  const matches = Array.isArray(assets)
    ? assets.filter(asset => asset?.name === expectedName)
    : []
  if (matches.length !== 1 || typeof matches[0]?.url !== 'string') {
    throw new Error(
      `Runtime Release 资产数量异常：${expectedName} 实际 ${matches.length}`
    )
  }
  return { name: expectedName, url: matches[0].url }
}

/**
 * 解析单资产 SHA-256 清单并绑定精确文件名。
 * @param {string} manifest 清单文本。
 * @param {string} expectedName 目标资产文件名。
 * @returns {string} 小写 SHA-256 十六进制摘要。
 * @throws {Error} 清单格式或文件名不匹配时抛出。
 */
export function parseSha256Manifest(manifest, expectedName) {
  const match = manifest.trim().match(/^([a-fA-F0-9]{64})  (.+)$/u)
  if (!match || match[2] !== expectedName) {
    throw new Error(`Runtime SHA-256 清单无效：${expectedName}`)
  }
  return match[1].toLowerCase()
}

/**
 * 下载并读取小型 Release 文本资产。
 * @param {{name: string, url: string}} asset Release 资产描述。
 * @param {Record<string, string>} headers GitHub API 请求头。
 * @param {typeof fetch} fetchImpl 可替换网络实现。
 * @returns {Promise<string>} 资产文本。
 * @throws {Error} 下载失败时抛出。
 */
async function downloadTextAsset(asset, headers, fetchImpl) {
  const response = await fetchImpl(asset.url, {
    headers: { ...headers, Accept: 'application/octet-stream' }
  })
  if (!response.ok) {
    throw new Error(`下载 Runtime 资产失败：${asset.name} HTTP ${response.status}`)
  }
  return response.text()
}

/**
 * 以流式方式下载大型 Runtime 资产，避免把数百 MiB 安装器读入 Node 堆内存。
 * @param {{name: string, url: string}} asset Release 资产描述。
 * @param {string} destination 临时下载文件路径。
 * @param {Record<string, string>} headers GitHub API 请求头。
 * @param {typeof fetch} fetchImpl 可替换网络实现。
 * @returns {Promise<void>} 下载完成时返回。
 * @throws {Error} 响应失败或缺少响应体时抛出。
 */
async function downloadFileAsset(asset, destination, headers, fetchImpl) {
  const response = await fetchImpl(asset.url, {
    headers: { ...headers, Accept: 'application/octet-stream' }
  })
  if (!response.ok || !response.body) {
    throw new Error(`下载 Runtime 资产失败：${asset.name} HTTP ${response.status}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
}

/**
 * 流式计算文件 SHA-256，避免大型安装器占用额外内存。
 * @param {string} path 待校验文件路径。
 * @returns {Promise<string>} 小写 SHA-256 十六进制摘要。
 */
async function hashFileSha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/**
 * 生成不泄露令牌的 GitHub API 请求头。
 * @param {string | undefined} token GitHub Actions 临时令牌。
 * @returns {Record<string, string>} API 请求头。
 */
function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': 'unilab-workbench-runtime-restore',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  }
}

/**
 * 校验下载参数，阻止路径或 GitHub 标识为空时发起模糊请求。
 * @param {{repository: string, tag: string, assetName: string, destination: string}} options 下载参数。
 * @returns {void} 参数完整时返回。
 * @throws {Error} 任一参数为空时抛出。
 */
function validateInputs(options) {
  for (const [name, value] of Object.entries(options)) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Runtime Release 参数缺失：${name}`)
    }
  }
}

/**
 * 解析命令行的具名参数。
 * @param {string[]} arguments_ 不含 node 与脚本路径的命令行参数。
 * @returns {{repository: string, tag: string, assetName: string, destination: string}} 下载参数。
 * @throws {Error} 参数缺失或出现未知参数时抛出。
 */
export function parseRuntimeRestoreArguments(arguments_) {
  const values = {}
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index]
    const value = arguments_[index + 1]
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error(`Runtime Release 参数格式无效：${flag || '<empty>'}`)
    }
    const name = flag.slice(2)
    if (!['repository', 'tag', 'asset', 'destination'].includes(name)) {
      throw new Error(`未知 Runtime Release 参数：${flag}`)
    }
    values[name] = value
  }
  return {
    repository: values.repository,
    tag: values.tag,
    assetName: values.asset,
    destination: values.destination
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseRuntimeRestoreArguments(process.argv.slice(2))
    const result = await restoreVersionedRuntime({
      ...options,
      token: process.env['GITHUB_TOKEN']
    })
    if (process.env['GITHUB_OUTPUT']) {
      appendFileSync(
        process.env['GITHUB_OUTPUT'],
        `hit=${result.restored ? 'true' : 'false'}\n`
      )
    }
    console.log(result.restored
      ? `已恢复版本化 Runtime：${basename(options.destination)} ${result.sha256}`
      : `版本化 Runtime Release 尚未发布：${options.tag}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
