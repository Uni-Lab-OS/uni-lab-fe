import type { ThemeState } from '../tokens'

export interface AntdThemeAlgorithms<TAlgorithm> {
  defaultAlgorithm: TAlgorithm
  darkAlgorithm: TAlgorithm
}

export interface AntdThemeConfig<TAlgorithm> {
  algorithm: TAlgorithm
  token: Record<string, string | number>
}

function themeColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function themeFont(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/**
 * Bridge design-v2 semantic tokens to AntD ConfigProvider's theme contract.
 * The AntD algorithms are supplied by the consuming app so this package does
 * not need to make AntD a runtime dependency of the design token layer.
 */
export function createAntdTheme<TAlgorithm>(
  theme: Pick<ThemeState, 'resolvedMode'>,
  algorithms: AntdThemeAlgorithms<TAlgorithm>,
): AntdThemeConfig<TAlgorithm> {
  return {
    algorithm: theme.resolvedMode === 'dark' ? algorithms.darkAlgorithm : algorithms.defaultAlgorithm,
    token: {
      fontFamily: themeFont(
        '--bh-font-family-sans',
        'Inter, ui-sans-serif, system-ui, sans-serif',
      ),
      borderRadius: 5,
      controlHeight: 36,
      colorPrimary: themeColor('--bh-color-primary', '#5363a6'),
      colorPrimaryHover: themeColor('--bh-color-primary-hover', '#7086cc'),
      colorPrimaryActive: themeColor('--bh-color-primary-pressed', '#3d4d91'),
      colorPrimaryBg: themeColor('--bh-color-primary-background', '#eef1ff'),
      colorPrimaryBgHover: themeColor('--bh-color-primary-background-hover', '#e1e6ff'),
      colorPrimaryBorder: themeColor('--bh-color-primary-border', '#b9c5f2'),
      colorPrimaryBorderHover: themeColor('--bh-color-primary-hover', '#7086cc'),
      colorBgBase: themeColor('--bh-color-background', '#ffffff'),
      colorBgLayout: themeColor('--bh-color-background', '#ffffff'),
      colorBgContainer: themeColor('--bh-color-primary-white', '#ffffff'),
      colorBgElevated: themeColor('--bh-color-popover', '#ffffff'),
      colorText: themeColor('--bh-color-foreground', '#1f1f1f'),
      colorTextSecondary: themeColor('--bh-color-muted-foreground', '#6b7280'),
      colorTextTertiary: themeColor('--bh-color-text-description', '#6b7280'),
      colorTextQuaternary: themeColor('--bh-color-text-placeholder', '#9ca3af'),
      colorTextDisabled: themeColor('--bh-color-text-disabled', '#c9cdd5'),
      colorBorder: themeColor('--bh-color-border', '#d9d9d9'),
      colorBorderSecondary: themeColor('--bh-color-border', '#d9d9d9'),
      colorBorderDisabled: themeColor('--bh-color-border-1', '#e5e6ec'),
      colorFill: themeColor('--bh-color-fill-1', '#f5f5f5'),
      colorFillSecondary: themeColor('--bh-color-fill-0', '#fafafa'),
      colorFillTertiary: themeColor('--bh-color-fill-1', '#f5f5f5'),
      colorFillQuaternary: themeColor('--bh-color-fill-2', '#e5e5e5'),
      colorBgContainerDisabled: themeColor('--bh-color-fill-1', '#f2f3f5'),
      colorError: themeColor('--bh-color-error-default', '#db3f3f'),
      colorErrorHover: themeColor('--bh-color-error-hover', '#e76b67'),
      colorErrorActive: themeColor('--bh-color-error-pressed', '#b52e31'),
      colorErrorBg: themeColor('--bh-color-error-subtle', '#fff1f0'),
      colorErrorBgHover: themeColor('--bh-color-error-subtle', '#fff1f0'),
      colorErrorBorder: themeColor('--bh-color-error-focus', '#db3f3f'),
      colorErrorBorderHover: themeColor('--bh-color-error-hover', '#e76b67'),
      colorSuccess: themeColor('--bh-color-success-default', '#52a63a'),
      colorSuccessHover: themeColor('--bh-color-success-hover', '#6dbd55'),
      colorSuccessActive: themeColor('--bh-color-success-pressed', '#398629'),
      colorSuccessBg: themeColor('--bh-color-success-subtle', '#f0fbe9'),
      colorWarning: themeColor('--bh-color-warning-default', '#d8a21b'),
      colorWarningHover: themeColor('--bh-color-warning-hover', '#e6b943'),
      colorWarningActive: themeColor('--bh-color-warning-pressed', '#b27b12'),
      colorWarningBg: themeColor('--bh-color-warning-subtle', '#fff9e6'),
      colorInfo: themeColor('--bh-color-primary-information', '#5363a6'),
      colorInfoBg: themeColor('--bh-color-primary-information-light', '#eef1ff'),
      controlOutline: themeColor('--bh-color-ring', '#5363a6'),
      controlOutlineWidth: 2,
    },
  }
}
