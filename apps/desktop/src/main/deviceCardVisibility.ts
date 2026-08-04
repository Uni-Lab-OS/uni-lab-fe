export interface DeviceCardVisibilityTarget {
  setVisible: (visible: boolean) => void
}

export class DeviceCardVisibilityController {
  private readonly occlusionSources = new Set<string>()
  private target: DeviceCardVisibilityTarget | null = null
  private appliedVisible: boolean | null = null

  attach(target: DeviceCardVisibilityTarget): void {
    if (this.target === target) return
    this.target = target
    this.appliedVisible = null
    this.sync()
  }

  detach(target: DeviceCardVisibilityTarget): void {
    if (this.target !== target) return
    this.target = null
    this.appliedVisible = null
  }

  setOccluded(source: string, occluded: boolean): void {
    assertOcclusionSource(source)
    const changed = occluded
      ? !this.occlusionSources.has(source)
      : this.occlusionSources.has(source)
    if (!changed) return
    if (occluded) this.occlusionSources.add(source)
    else this.occlusionSources.delete(source)
    this.sync()
  }

  private sync(): void {
    if (!this.target) return
    const visible = this.occlusionSources.size === 0
    if (this.appliedVisible === visible) return
    this.target.setVisible(visible)
    this.appliedVisible = visible
  }
}

function assertOcclusionSource(source: string): void {
  if (typeof source !== 'string' || source.length === 0 || source.length > 128) {
    throw new Error('device card occlusion source 无效')
  }
}
