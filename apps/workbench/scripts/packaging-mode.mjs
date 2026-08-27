export const WORKBENCH_PACKAGE_MODES = Object.freeze([
  'full',
  'directory',
  'prepackaged'
])

export const WORKBENCH_RELEASE_CHANNELS = Object.freeze([
  'production',
  'update-test',
  'test'
])

export const WINDOWS_PRECOMPRESSED_PROFILES = Object.freeze({
  none: Object.freeze([]),
  exe: Object.freeze(['.exe'])
})

/**
 * 解析 Workbench 介质生成模式，避免 CI 通过任意字符串绕过发布校验。
 * @param {string | undefined} value 环境变量传入的候选模式。
 * @returns {'full' | 'directory' | 'prepackaged'} 已校验的介质生成模式。
 * @throws {Error} 候选模式不在受支持集合中时抛出。
 */
export function resolveWorkbenchPackageMode(value) {
  const mode = value?.trim() || 'full'
  if (!WORKBENCH_PACKAGE_MODES.includes(mode)) {
    throw new Error(
      `不支持的 Workbench 介质生成模式：${mode}；仅支持 ${WORKBENCH_PACKAGE_MODES.join('、')}`
    )
  }
  return mode
}

/**
 * 解析桌面发布通道，使测试包与生产更新通道保持显式隔离。
 * @param {string | undefined} value 环境变量传入的候选通道。
 * @returns {'production' | 'update-test' | 'test'} 已校验的发布通道。
 * @throws {Error} 候选通道不在受支持集合中时抛出。
 */
export function resolveWorkbenchReleaseChannel(value) {
  const channel = value?.trim() || 'test'
  if (!WORKBENCH_RELEASE_CHANNELS.includes(channel)) {
    throw new Error(
      `不支持的 Workbench 发布通道：${channel}；仅支持 ${WORKBENCH_RELEASE_CHANNELS.join('、')}`
    )
  }
  return channel
}

/**
 * 判断发布通道是否必须生成并消费自动更新介质。
 * update-test 使用测试业务环境与隔离 Release，不会接触生产 stable 源。
 */
export function supportsWorkbenchUpdates(channel) {
  return channel === 'production' || channel === 'update-test'
}

/**
 * 解析 Windows 已压缩资源配置，只允许经过 CI A/B 明确验证的配置档位。
 * @param {string | undefined} value 环境变量传入的配置档位。
 * @returns {{name: 'none' | 'exe', extensions: readonly string[]}} 配置名称与扩展名集合。
 * @throws {Error} 配置档位未知时抛出，避免正式包静默改变压缩语义。
 */
export function resolveWindowsPrecompressedProfile(value) {
  const name = value?.trim() || 'none'
  const extensions = WINDOWS_PRECOMPRESSED_PROFILES[name]
  if (!extensions) {
    throw new Error(
      `不支持的 Windows 已压缩资源配置：${name}；仅支持 ${Object.keys(WINDOWS_PRECOMPRESSED_PROFILES).join('、')}`
    )
  }
  return { name, extensions }
}

/**
 * 判断当前运行是否为允许超过正式体积预算的隔离基准。
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} environment 当前进程环境变量。
 * @returns {boolean} 仅当显式值为 1 时返回 true。
 */
export function allowsOversizePackagingBenchmark(environment = process.env) {
  return environment['UNILAB_WORKBENCH_ALLOW_OVERSIZE_BENCHMARK'] === '1'
}
