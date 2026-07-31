import { getDeviceCardBridge } from '@unilab/device-card-sdk'

import {
  escapeHtml,
  HOST_STYLE,
  toneColor
} from './styles'
import {
  normalizeTimeseries,
  timeseriesPath,
  type TimeseriesPoint
} from './series'

abstract class UElement extends HTMLElement {
  protected readonly root: ShadowRoot

  constructor() {
    super()
    this.root = this.attachShadow({ mode: 'open' })
  }

  connectedCallback(): void {
    this.render()
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.render()
  }

  protected abstract render(): void
}

export class UCardElement extends UElement {
  static observedAttributes = ['title', 'subtitle']

  protected render(): void {
    const title = this.getAttribute('title') ?? ''
    const subtitle = this.getAttribute('subtitle') ?? ''
    this.root.innerHTML = `
      <style>
        ${HOST_STYLE}
        :host { display: block; height: 100%; min-height: 0; }
        article {
          display: flex; flex-direction: column; gap: 14px;
          min-height: 100%; padding: 18px;
          background: var(--u-color-surface, #fff);
          border: 1px solid var(--u-color-border, #dce5f0);
          border-radius: var(--u-radius-card, 12px);
          box-shadow: 0 8px 28px rgb(15 23 42 / 8%);
        }
        header { display: grid; gap: 2px; }
        h2 { margin: 0; font-size: 16px; line-height: 1.3; }
        p { margin: 0; color: var(--u-color-muted, #66758a); font-size: 12px; }
        .body { display: flex; flex: 1; flex-direction: column; gap: 12px; min-height: 0; }
      </style>
      ${title || subtitle ? `
        <header>
          ${title ? `<h2>${escapeHtml(title)}</h2>` : ''}
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        </header>
      ` : ''}
      <div class="body"><slot></slot></div>
    `
  }
}

export class UMetricElement extends UElement {
  static observedAttributes = ['label', 'value', 'unit', 'tone']

  protected render(): void {
    const label = this.getAttribute('label') ?? ''
    const value = this.getAttribute('value') ?? '—'
    const unit = this.getAttribute('unit') ?? ''
    const color = toneColor(this.getAttribute('tone') ?? '')
    this.root.innerHTML = `
      <style>
        ${HOST_STYLE}
        :host { display: block; }
        .metric {
          display: grid; gap: 4px; min-width: 0; padding: 12px;
          background: var(--u-color-surface-subtle, #f7f9fc);
          border: 1px solid var(--u-color-border, #dce5f0);
          border-radius: 9px;
        }
        small { color: var(--u-color-muted, #66758a); }
        strong { color: ${color}; font-size: 22px; line-height: 1.2; }
        em { margin-left: 4px; color: var(--u-color-muted, #66758a); font-size: 12px; font-style: normal; }
      </style>
      <div class="metric">
        <small>${escapeHtml(label)}</small>
        <strong>${escapeHtml(value)}<em>${escapeHtml(unit)}</em></strong>
      </div>
    `
  }
}

export class UStatusElement extends UElement {
  static observedAttributes = ['label', 'value', 'tone']

  protected render(): void {
    const label = this.getAttribute('label') ?? ''
    const value = this.getAttribute('value') ?? '未知'
    const color = toneColor(this.getAttribute('tone') ?? '')
    this.root.innerHTML = `
      <style>
        ${HOST_STYLE}
        :host { display: inline-block; }
        .status { display: inline-flex; gap: 7px; align-items: center; }
        i { width: 8px; height: 8px; border-radius: 50%; background: ${color}; box-shadow: 0 0 0 3px color-mix(in srgb, ${color} 18%, transparent); }
        span { color: var(--u-color-muted, #66758a); }
        strong { color: var(--u-color-text, #172033); }
      </style>
      <span class="status">
        <i aria-hidden="true"></i>
        ${label ? `<span>${escapeHtml(label)}</span>` : ''}
        <strong>${escapeHtml(value)}</strong>
      </span>
    `
  }
}

export class UActionButtonElement extends UElement {
  static observedAttributes = ['action', 'variant', 'disabled']
  private busy = false
  private message = ''

  protected render(): void {
    const variant = this.getAttribute('variant') ?? 'primary'
    const disabled = this.hasAttribute('disabled') || this.busy
    const background = variant === 'danger'
      ? 'var(--u-color-danger, #c2413b)'
      : 'var(--u-color-primary, #2563eb)'
    this.root.innerHTML = `
      <style>
        ${HOST_STYLE}
        :host { display: inline-flex; flex-direction: column; gap: 4px; }
        button {
          min-height: 36px; padding: 0 14px; color: #fff; background: ${background};
          border: 0; border-radius: 8px; cursor: pointer; font: inherit; font-weight: 650;
        }
        button:disabled { cursor: not-allowed; opacity: .55; }
        small { max-width: 240px; color: var(--u-color-muted, #66758a); }
      </style>
      <button type="button" ${disabled ? 'disabled' : ''}>
        ${this.busy ? '执行中…' : '<slot></slot>'}
      </button>
      ${this.message ? `<small role="status">${escapeHtml(this.message)}</small>` : ''}
    `
    this.root.querySelector('button')?.addEventListener('click', () => {
      void this.runAction()
    })
  }

  private async runAction(): Promise<void> {
    const action = this.getAttribute('action')
    if (!action || this.busy) return
    this.busy = true
    this.message = ''
    this.render()
    try {
      const run = await getDeviceCardBridge().callAction(action)
      this.message = run.status === 'DONE'
        ? '执行完成'
        : run.error ?? `状态：${run.status}`
    } catch (error) {
      this.message = error instanceof Error ? error.message : String(error)
    } finally {
      this.busy = false
      this.render()
    }
  }
}

export interface URackSlot {
  id: string
  label?: string
  status?: 'empty' | 'occupied' | 'warning'
}

export class URackGridElement extends UElement {
  private slotsValue: readonly URackSlot[] = []
  private columnsValue = 4

  set slots(value: readonly URackSlot[]) {
    this.slotsValue = Array.isArray(value) ? value : []
    if (this.isConnected) this.render()
  }

  get slots(): readonly URackSlot[] {
    return this.slotsValue
  }

  set columns(value: number) {
    this.columnsValue = Number.isSafeInteger(value) && value > 0 ? value : 4
    if (this.isConnected) this.render()
  }

  protected render(): void {
    this.root.innerHTML = `
      <style>
        ${HOST_STYLE}
        .grid { display: grid; grid-template-columns: repeat(${this.columnsValue}, minmax(0, 1fr)); gap: 8px; }
        button {
          display: grid; gap: 3px; min-height: 70px; padding: 9px;
          color: var(--u-color-text, #172033); text-align: left;
          background: var(--u-color-surface-subtle, #f7f9fc);
          border: 1px solid var(--u-color-border, #dce5f0);
          border-radius: 8px; cursor: pointer;
        }
        button[data-status="occupied"] { background: #eef6ff; border-color: #9bc2eb; }
        button[data-status="warning"] { background: #fff7e8; border-color: #edb45c; }
        strong { overflow-wrap: anywhere; }
        small { color: var(--u-color-muted, #66758a); }
      </style>
      <div class="grid">
        ${this.slotsValue.map((slot) => `
          <button type="button" data-slot-id="${escapeHtml(slot.id)}" data-status="${escapeHtml(slot.status ?? 'empty')}">
            <strong>${escapeHtml(slot.label ?? slot.id)}</strong>
            <small>${escapeHtml(slot.status ?? 'empty')}</small>
          </button>
        `).join('')}
      </div>
    `
    this.root.querySelectorAll<HTMLButtonElement>('[data-slot-id]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          this.dispatchEvent(new CustomEvent('u-slot-select', {
            bubbles: true,
            composed: true,
            detail: { slotId: button.dataset.slotId }
          }))
        })
      })
  }
}

export interface UWell {
  id: string
  state: 'empty' | 'filled' | 'disabled'
}

export class UWellPlateElement extends UElement {
  private wellsValue: readonly UWell[] = []
  private columnsValue = 8

  set wells(value: readonly UWell[]) {
    this.wellsValue = Array.isArray(value) ? value : []
    if (this.isConnected) this.render()
  }

  get wells(): readonly UWell[] {
    return this.wellsValue
  }

  set columns(value: number) {
    this.columnsValue = Number.isSafeInteger(value) && value > 0 ? value : 8
    if (this.isConnected) this.render()
  }

  protected render(): void {
    this.root.innerHTML = `
      <style>
        ${HOST_STYLE}
        .wells { display: grid; grid-template-columns: repeat(${this.columnsValue}, 30px); gap: 6px; overflow: auto; }
        button {
          width: 30px; height: 30px; padding: 0; border-radius: 50%;
          border: 1px dashed #aab6c6; color: #64748b; background: #fff;
          cursor: pointer; font: 600 9px/1 var(--u-font-sans, system-ui);
        }
        button[data-state="filled"] { color: #1d5fa7; background: #d9e8ff; border: 1px solid #8cb9e7; }
        button[data-state="disabled"] { color: #b4bdc9; background: #eef1f5; border-style: solid; cursor: not-allowed; }
      </style>
      <div class="wells">
        ${this.wellsValue.map((well) => `
          <button
            type="button"
            data-well-id="${escapeHtml(well.id)}"
            data-state="${escapeHtml(well.state)}"
            ${well.state === 'disabled' ? 'disabled' : ''}
          >${escapeHtml(well.id)}</button>
        `).join('')}
      </div>
    `
    this.root.querySelectorAll<HTMLButtonElement>('[data-well-id]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          this.dispatchEvent(new CustomEvent('u-well-select', {
            bubbles: true,
            composed: true,
            detail: { wellId: button.dataset.wellId }
          }))
        })
      })
  }
}

export class UTimeseriesElement extends UElement {
  private pointsValue: readonly (number | TimeseriesPoint)[] = []

  set points(value: readonly (number | TimeseriesPoint)[]) {
    this.pointsValue = Array.isArray(value) ? value : []
    if (this.isConnected) this.render()
  }

  get points(): readonly (number | TimeseriesPoint)[] {
    return this.pointsValue
  }

  protected render(): void {
    const width = 480
    const height = 180
    const points = normalizeTimeseries(this.pointsValue)
    const path = timeseriesPath(points, width, height)
    this.root.innerHTML = `
      <style>
        ${HOST_STYLE}
        :host { display: block; min-height: 140px; }
        svg { display: block; width: 100%; height: auto; max-height: 220px; overflow: visible; }
        path.line { fill: none; stroke: var(--u-color-primary, #2563eb); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
        path.area { fill: color-mix(in srgb, var(--u-color-primary, #2563eb) 14%, transparent); stroke: none; }
        .empty { display: grid; min-height: 140px; place-items: center; color: var(--u-color-muted, #66758a); }
      </style>
      ${path
        ? `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="趋势图">
            <path class="line" d="${path}"></path>
          </svg>`
        : '<div class="empty">暂无趋势数据</div>'
      }
    `
  }
}

export interface ULogEntry {
  timestamp?: string
  level?: 'info' | 'success' | 'warning' | 'error'
  message: string
}

export class ULogConsoleElement extends UElement {
  private entriesValue: readonly ULogEntry[] = []

  set entries(value: readonly ULogEntry[]) {
    this.entriesValue = Array.isArray(value) ? value : []
    if (this.isConnected) this.render()
  }

  protected render(): void {
    this.root.innerHTML = `
      <style>
        ${HOST_STYLE}
        .console {
          display: grid; gap: 4px; max-height: 260px; overflow: auto;
          padding: 10px; background: #0f172a; border-radius: 8px;
          color: #dbeafe; font: 12px/1.55 var(--u-font-mono, ui-monospace, monospace);
        }
        .line { display: grid; grid-template-columns: auto auto 1fr; gap: 7px; }
        time { color: #8292a8; }
        b { color: #7dd3fc; font-weight: 600; }
        .warning b { color: #fbbf24; }
        .error b { color: #fb7185; }
        .success b { color: #86efac; }
      </style>
      <div class="console" role="log">
        ${this.entriesValue.length > 0
          ? this.entriesValue.map((entry) => `
            <div class="line ${escapeHtml(entry.level ?? 'info')}">
              <time>${escapeHtml(entry.timestamp ?? '')}</time>
              <b>${escapeHtml((entry.level ?? 'info').toUpperCase())}</b>
              <span>${escapeHtml(entry.message)}</span>
            </div>
          `).join('')
          : '<span>暂无日志</span>'
        }
      </div>
    `
  }
}

export const DEVICE_CARD_ELEMENTS = {
  'u-card': UCardElement,
  'u-metric': UMetricElement,
  'u-status': UStatusElement,
  'u-action-button': UActionButtonElement,
  'u-rack-grid': URackGridElement,
  'u-well-plate': UWellPlateElement,
  'u-timeseries': UTimeseriesElement,
  'u-log-console': ULogConsoleElement
} as const

export function registerDeviceCardElements(): void {
  for (const [name, constructor] of Object.entries(DEVICE_CARD_ELEMENTS)) {
    if (!globalThis.customElements.get(name)) {
      globalThis.customElements.define(name, constructor)
    }
  }
}
