import {
  cloudEnvironmentOption,
  type CloudEnvironment
} from '@unilab/device-provisioning'
import type { WorkbenchReleaseChannel } from './releaseChannel'

/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-24
 * Prompt Summary: pc-client 登录配置(Bohrium 统一登录),与 web goToLogin 保持一致
 * Context: 复用 web/src/utils/login.ts 的 /login?business=Bohrium&redirect= 流程
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */

export interface DesktopAuthDefaults {
  OAUTH_URL: string
  SITE_URL: string
  API_URL: string
}

/** 把桌面发布通道绑定到不可混用的 Bohrium 登录与 API 环境。 */
export function desktopAuthDefaults(
  releaseChannel: WorkbenchReleaseChannel
): DesktopAuthDefaults {
  if (releaseChannel === 'production') {
    return {
      OAUTH_URL: 'https://platform.bohrium.com',
      SITE_URL: 'https://leap-lab.bohrium.com/leap-lab',
      API_URL: 'https://leap-lab.bohrium.com/api/v1'
    }
  }
  return {
    OAUTH_URL: 'https://platform.test.bohrium.com',
    SITE_URL: 'https://leap-lab.test.bohrium.com/leap-lab',
    API_URL: 'https://leap-lab.test.bohrium.com/api/v1'
  }
}

const configuredReleaseChannel = process.env.UNILAB_WORKBENCH_RELEASE_CHANNEL
const releaseChannel: WorkbenchReleaseChannel = configuredReleaseChannel === 'production'
  ? 'production'
  : configuredReleaseChannel === 'update-test'
    ? 'update-test'
    : 'test'
const defaultAuthConfig = desktopAuthDefaults(releaseChannel)

// 与 web 端保持一致的鉴权配置；本地运行仍允许通过环境变量覆盖。
// 说明:web 真正生效的登录是 utils/login.ts 的 goToLogin —— 走 Bohrium 统一登录
// (/login?business=Bohrium&redirect=...),登录后 Bohrium 通过 ?token= 回跳并在
// .bohrium.com 写 brmToken cookie。此前使用的 /oauth/?redirect_uri=.../api/auth/callback/brm_oauth/
// 流程在后端并无对应路由(仅 casdoor 回调),回调地址 404,故弃用。
export const AUTH_CONFIG = {
  // Bohrium 统一登录平台地址，由编译期发布通道选择测试或正式域名。
  OAUTH_URL: process.env.PC_CLIENT_OAUTH_URL || defaultAuthConfig.OAUTH_URL,
  // 登录成功后的回跳地址(前端站点),Bohrium 会在其后追加 ?token=<brmToken>
  // 对应 web goToLogin 里的 redirect: window.location.href
  SITE_URL: process.env.PC_CLIENT_SITE_URL || defaultAuthConfig.SITE_URL,
  // Electron 云端设备广场复用的既有 Backend API 根地址。
  API_URL: process.env.PC_CLIENT_API_URL || defaultAuthConfig.API_URL
} as const

/**
 * 把配置的 Cloud 地址规范化为 CLI 需要的 `/api/v1` API 根。
 *
 * @param configuredUrl PC_CLIENT_API_URL 或内置测试环境地址。
 * @returns 无凭据、query、fragment 且以 `/api/v1` 结尾的 HTTP(S) URL。
 * @throws 配置不是受支持的 HTTP(S) URL 时失败关闭。
 */
export function cloudApiRootUrl(
  configuredUrl: string = AUTH_CONFIG.API_URL
): string {
  const url = parseCloudUrl(configuredUrl)
  const path = url.pathname.replace(/\/+$/u, '')
  url.pathname = path.endsWith('/api/v1') ? path : `${path}/api/v1`
  return url.toString().replace(/\/$/u, '')
}

/**
 * 把 Cloud API 根投影为 services 使用的 base URL，避免重复追加 `/api/v1`。
 *
 * @param configuredUrl PC_CLIENT_API_URL 或内置测试环境地址。
 * @returns 保留部署前缀但去掉末尾 `/api/v1` 的 HTTP(S) URL。
 */
export function cloudServiceBaseUrl(
  configuredUrl: string = AUTH_CONFIG.API_URL
): string {
  const apiRoot = new URL(cloudApiRootUrl(configuredUrl))
  apiRoot.pathname = apiRoot.pathname.replace(/\/api\/v1$/u, '') || '/'
  return apiRoot.toString().replace(/\/$/u, '')
}

/**
 * 把固定云端环境解析为 OS CLI 使用的 `/api/v1` 根地址。
 *
 * @param environment 用户在设备广场操作台选择的环境身份。
 * @returns 对应测试、UAT 或正式部署的固定 API 根地址。
 * @remarks 测试环境保留 PC_CLIENT_API_URL 覆盖，供本地兼容 Backend E2E 使用。
 */
export function cloudApiRootUrlForEnvironment(
  environment: CloudEnvironment
): string {
  const configuredUrl = environment === 'test' && process.env.PC_CLIENT_API_URL
    ? process.env.PC_CLIENT_API_URL
    : cloudEnvironmentOption(environment).apiUrl
  return cloudApiRootUrl(configuredUrl)
}

/**
 * 把固定云端环境解析为 services 不重复追加 `/api/v1` 的 base URL。
 *
 * @param environment 用户在设备广场操作台选择的环境身份。
 * @returns 对应部署的无凭据 HTTP(S) service base URL。
 */
export function cloudServiceBaseUrlForEnvironment(
  environment: CloudEnvironment
): string {
  return cloudServiceBaseUrl(cloudApiRootUrlForEnvironment(environment))
}

/** 校验 Cloud 地址不携带凭据、query 或 fragment。 */
function parseCloudUrl(configuredUrl: string): URL {
  let url: URL
  try {
    url = new URL(configuredUrl.trim())
  } catch {
    throw new Error('Cloud API 地址不是合法 URL')
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error('Cloud API 地址必须是无凭据、query 和 fragment 的 HTTP(S) URL')
  }
  return url
}

// web 端按 hostname 区分 test/uat/prod 对应的 cookie 名,这里全部纳入探测范围
export const TOKEN_COOKIE_NAMES = ['brmToken', 'test-brmToken', 'uat-brmToken'] as const

// 构造 Bohrium 统一登录地址(与 web/src/utils/login.ts 的 goToLogin 完全一致)
// business=Bohrium 指定业务方,redirect 为登录后的回跳地址
export function buildOAuthUrl(): string {
  const params = new URLSearchParams({
    business: 'Bohrium',
    t: String(Date.now()),
    redirect: AUTH_CONFIG.SITE_URL,
    lang: 'zh-cn'
  })
  return `${AUTH_CONFIG.OAUTH_URL}/login?${params.toString()}`
}
