export type LatestViewOpenOutcome = 'committed' | 'superseded'

interface LatestViewOpenCoordinatorOptions<View> {
  activate: (view: View) => void
  dispose: (view: View) => void
}

/**
 * Owns the latest-wins lifecycle for asynchronously loaded native views.
 *
 * A replacement is staged until its load succeeds, so the current view remains
 * visible. Starting another open or explicitly closing invalidates every older
 * load; failures caused by that invalidation are reported as `superseded`, while
 * a genuine failure of the latest candidate is still thrown to the caller.
 */
export class LatestViewOpenCoordinator<View> {
  private generation = 0
  private active: View | null = null
  private readonly pending = new Set<View>()

  constructor(
    private readonly options: LatestViewOpenCoordinatorOptions<View>
  ) {}

  getActive(): View | null {
    return this.active
  }

  async open(
    candidate: View,
    load: () => Promise<void>
  ): Promise<LatestViewOpenOutcome> {
    const generation = ++this.generation
    this.disposePending()
    this.pending.add(candidate)

    try {
      await load()
    } catch (error) {
      const stillOwned = this.pending.delete(candidate)
      if (stillOwned) this.options.dispose(candidate)
      if (generation !== this.generation) return 'superseded'
      throw error
    }

    const stillOwned = this.pending.delete(candidate)
    if (generation !== this.generation) {
      if (stillOwned) this.options.dispose(candidate)
      return 'superseded'
    }
    if (!stillOwned) {
      throw new Error('Staged view was destroyed before activation.')
    }

    const previous = this.active
    try {
      this.options.activate(candidate)
    } catch (error) {
      this.options.dispose(candidate)
      throw error
    }
    this.active = candidate
    if (previous && previous !== candidate) this.options.dispose(previous)
    return 'committed'
  }

  /** Explicit close/destroy: no already-started load may commit afterwards. */
  closeAll(): void {
    ++this.generation
    this.disposePending()
    const active = this.active
    this.active = null
    if (active) this.options.dispose(active)
  }

  /** Keep coordinator state in sync if Electron destroys a view externally. */
  forget(view: View): void {
    this.pending.delete(view)
    if (this.active === view) this.active = null
  }

  private disposePending(): void {
    for (const view of [...this.pending]) {
      this.pending.delete(view)
      this.options.dispose(view)
    }
  }
}
