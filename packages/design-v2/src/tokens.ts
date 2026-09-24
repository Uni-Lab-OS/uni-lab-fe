export type ThemeMode = 'light' | 'dark' | 'system'

export type ThemePreset = 'default' | (string & {})

export interface ThemeState {
  preset: ThemePreset
  mode: ThemeMode
  resolvedMode: 'light' | 'dark'
}

export const DESIGN_TOKEN_NAMES = [
  'color-background',
  'color-foreground',
  'color-card',
  'color-card-foreground',
  'color-popover',
  'color-popover-foreground',
  'color-primary',
  'color-primary-foreground',
  'color-secondary',
  'color-secondary-foreground',
  'color-muted',
  'color-muted-foreground',
  'color-accent',
  'color-accent-foreground',
  'color-destructive',
  'color-destructive-foreground',
  'color-border',
  'color-input',
  'color-ring',
  'color-ring-offset',
  'color-chart-1',
  'color-chart-2',
  'color-chart-3',
  'color-chart-4',
  'color-chart-5',
  'color-sidebar',
  'color-sidebar-foreground',
  'color-sidebar-primary',
  'color-sidebar-primary-foreground',
  'color-sidebar-accent',
  'color-sidebar-accent-foreground',
  'color-sidebar-border',
  'color-sidebar-ring',
  'space-1',
  'space-2',
  'space-3',
  'space-4',
  'space-5',
  'space-6',
  'space-8',
  'space-10',
  'space-12',
  'radius-sm',
  'radius-md',
  'radius-lg',
  'radius-xl',
  'font-family-sans',
  'font-family-mono',
  'shadow-sm',
  'shadow-card',
  'shadow-lg',
  'motion-fast',
  'motion-normal'
] as const

export type DesignTokenName = typeof DESIGN_TOKEN_NAMES[number]

/** 将设计 token 名称转换为 CSS variable 引用。 */
export function cssVar(name: DesignTokenName): string {
  return `var(--bh-${name})`
}

export {
  configureTheme,
  getTheme,
  setTheme,
  watchTheme,
  type SetThemeOptions,
  type ThemeControllerOptions
} from './runtime/theme'
