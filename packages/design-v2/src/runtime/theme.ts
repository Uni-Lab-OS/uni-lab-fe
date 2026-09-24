import type { ThemeMode, ThemePreset, ThemeState } from '../tokens'

const THEME_EVENT = 'unilab:design-theme-change'
const DEFAULT_STORAGE_KEY = 'unilab.design-v2.theme'

interface StoredTheme {
  mode?: ThemeMode
  preset?: ThemePreset
}

export interface SetThemeOptions {
  mode?: ThemeMode
  preset?: ThemePreset
  storageKey?: string
  persist?: boolean
}

export interface ThemeControllerOptions {
  storageKey?: string
  defaultMode?: ThemeMode
  defaultPreset?: ThemePreset
}

let controllerOptions: Required<ThemeControllerOptions> = {
  storageKey: DEFAULT_STORAGE_KEY,
  defaultMode: 'system',
  defaultPreset: 'default'
}

let systemMediaQuery: MediaQueryList | null = null
let systemMediaQueryListener: (() => void) | null = null

/** 读取当前设计主题，不访问 DOM 的环境返回默认状态。 */
export function getTheme(): ThemeState {
  const root = getRoot()
  const stored = readStoredTheme()
  const mode = readMode(root?.dataset.themeMode)
    ?? readMode(root?.dataset.colorMode)
    ?? stored.mode
    ?? controllerOptions.defaultMode
  const preset = root?.dataset.designPreset
    ?? stored.preset
    ?? controllerOptions.defaultPreset
  return {
    mode,
    preset,
    resolvedMode: resolveMode(mode)
  }
}

/** 设置设计主题，并同步根节点属性和持久化状态。 */
export function setTheme(options: SetThemeOptions = {}): ThemeState {
  const current = getTheme()
  const next: ThemeState = {
    ...current,
    mode: options.mode ?? current.mode,
    preset: options.preset ?? current.preset,
    resolvedMode: resolveMode(options.mode ?? current.mode)
  }
  controllerOptions = {
    ...controllerOptions,
    ...(options.storageKey ? { storageKey: options.storageKey } : {})
  }

  const root = getRoot()
  if (root) {
    root.dataset.designPreset = next.preset
    root.dataset.themeMode = next.mode
    root.dataset.colorMode = next.resolvedMode
    root.style.colorScheme = next.resolvedMode
  }
  if (options.persist !== false) persistTheme(next)
  installSystemListener()
  dispatchThemeChange(next)
  return next
}

/** 订阅主题变化，返回可重复调用的清理函数。 */
export function watchTheme(listener: (state: ThemeState) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handleChange = (event: Event): void => {
    const customEvent = event as CustomEvent<ThemeState | undefined>
    listener(customEvent.detail ?? getTheme())
  }
  window.addEventListener(THEME_EVENT, handleChange)
  return () => window.removeEventListener(THEME_EVENT, handleChange)
}

/** 在应用启动时配置默认值；不会覆盖用户已经选择的主题。 */
export function configureTheme(options: ThemeControllerOptions = {}): ThemeState {
  controllerOptions = {
    ...controllerOptions,
    ...options
  }
  const stored = readStoredTheme()
  const root = getRoot()
  if (root && !root.dataset.themeMode) {
    setTheme({
      mode: stored.mode ?? controllerOptions.defaultMode,
      preset: root.dataset.designPreset
        ?? stored.preset
        ?? controllerOptions.defaultPreset,
      persist: false
    })
  }
  installSystemListener()
  return getTheme()
}

function getRoot(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement
}

function readMode(value: string | undefined): ThemeMode | null {
  return value === 'light' || value === 'dark' || value === 'system' ? value : null
}

function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readStoredTheme(): StoredTheme {
  if (typeof window === 'undefined') return {}
  try {
    const value = window.localStorage.getItem(controllerOptions.storageKey)
    return value ? JSON.parse(value) as StoredTheme : {}
  } catch {
    return {}
  }
}

function persistTheme(state: ThemeState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      controllerOptions.storageKey,
      JSON.stringify({ mode: state.mode, preset: state.preset })
    )
  } catch {
    // 本地存储不可用时仍保留内存和 DOM 状态。
  }
}

function installSystemListener(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  const state = getTheme()
  if (state.mode !== 'system') {
    removeSystemListener()
    return
  }
  if (systemMediaQuery) return
  systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  systemMediaQueryListener = () => {
    const next = getTheme()
    const root = getRoot()
    if (root) {
      root.dataset.colorMode = next.resolvedMode
      root.style.setProperty('color-scheme', next.resolvedMode)
    }
    dispatchThemeChange(next)
  }
  systemMediaQuery.addEventListener('change', systemMediaQueryListener)
}

function removeSystemListener(): void {
  if (systemMediaQuery && systemMediaQueryListener) {
    systemMediaQuery.removeEventListener('change', systemMediaQueryListener)
  }
  systemMediaQuery = null
  systemMediaQueryListener = null
}

function dispatchThemeChange(state: ThemeState): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: state }))
}
