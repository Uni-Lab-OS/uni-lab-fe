export const HOST_STYLE = `
  :host {
    box-sizing: border-box;
    color: var(--u-color-text, #172033);
    font: 13px/1.5 var(--u-font-sans, Inter, system-ui, sans-serif);
  }
  *, *::before, *::after { box-sizing: border-box; }
`

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function toneColor(tone: string): string {
  if (tone === 'success') return 'var(--u-color-success, #16803c)'
  if (tone === 'warning') return 'var(--u-color-warning, #b45309)'
  if (tone === 'danger' || tone === 'error') {
    return 'var(--u-color-danger, #c2413b)'
  }
  return 'var(--u-color-primary, #2563eb)'
}
