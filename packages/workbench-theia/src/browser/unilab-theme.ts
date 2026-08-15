export function applyUniLabTheme(
  themeType: string,
  root: Pick<HTMLElement, 'dataset'> = document.documentElement
): void {
  root.dataset.theme = themeType === 'dark' ? 'dark' : 'light'
}
