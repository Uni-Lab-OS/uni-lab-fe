import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { parseSpatialShadowSnapshot } from './parser'
import {
  createSpatialShadowPlaybackController,
  SpatialShadowPlaybackProvider,
  useSpatialShadowPlayback
} from './playbackController'
import { createSpatialShadowFixtureText } from './testFixture'

const snapshot = parseSpatialShadowSnapshot(createSpatialShadowFixtureText())

describe('Spatial Shadow playback controller', () => {
  it('keeps one time/playing/rate state for every subscriber', () => {
    const controller = createSpatialShadowPlaybackController(snapshot)
    const first = vi.fn()
    const second = vi.fn()
    controller.subscribe(first)
    controller.subscribe(second)

    controller.toggle()
    controller.setRate(2)
    controller.advanceBy(1.25)

    expect(controller.getState()).toMatchObject({
      timeS: 2.5,
      playing: true,
      rate: 2,
      durationS: 14,
      currentSegmentIndex: 2
    })
    expect(first).toHaveBeenCalledTimes(3)
    expect(second).toHaveBeenCalledTimes(3)
  })

  it('clamps seek, derives segment from time and selects the real segment start', () => {
    const controller = createSpatialShadowPlaybackController(snapshot)

    controller.seek(100)
    expect(controller.getState()).toMatchObject({
      timeS: 14,
      playing: false,
      currentSegmentIndex: 13
    })

    controller.selectSegment(7)
    expect(controller.getState()).toMatchObject({
      timeS: 7,
      currentSegmentIndex: 7
    })

    controller.selectSegment(999)
    expect(controller.getState().timeS).toBe(7)
  })

  it('stops at duration and replays from zero on the next toggle', () => {
    const controller = createSpatialShadowPlaybackController(snapshot)
    controller.setRate(4)
    controller.toggle()
    controller.advanceBy(10)

    expect(controller.getState()).toMatchObject({ timeS: 14, playing: false })

    controller.toggle()
    expect(controller.getState()).toMatchObject({
      timeS: 0,
      playing: true,
      currentSegmentIndex: 0
    })
  })

  it('clamps a same-snapshot duration change and resets on a new digest', () => {
    const controller = createSpatialShadowPlaybackController(snapshot)
    controller.seek(12)
    controller.toggle()
    controller.setRate(2)

    controller.setSnapshot({
      ...snapshot,
      playback: { ...snapshot.playback, duration_s: 5 }
    })
    expect(controller.getState()).toMatchObject({
      timeS: 5,
      playing: false,
      rate: 2,
      durationS: 5
    })

    controller.setSnapshot({
      ...snapshot,
      snapshot_digest: 'f'.repeat(64),
      playback: { ...snapshot.playback, duration_s: 9 }
    })
    expect(controller.getState()).toMatchObject({
      timeS: 0,
      playing: false,
      rate: 2,
      durationS: 9,
      currentSegmentIndex: 0
    })
  })

  it('keeps the injected snapshot evidence immutable while controlling playback', () => {
    const controller = createSpatialShadowPlaybackController(snapshot)
    controller.toggle()
    controller.advanceBy(2)
    controller.seek(3)

    expect(snapshot).toMatchObject({
      mode: 'shadow',
      decision: 'unknown',
      effect: 'none',
      not_workcell_activation: true
    })
  })
})

describe('SpatialShadowPlaybackProvider', () => {
  function Probe({ id }: { id: string }) {
    const playback = useSpatialShadowPlayback()
    return (
      <output
        data-probe={id}
        data-time={playback.timeS}
        data-playing={playback.playing}
        data-rate={playback.rate}
        data-segment={playback.currentSegmentIndex}
      />
    )
  }

  it('gives two interfaces the same provider-owned initial clock', () => {
    const markup = renderToStaticMarkup(
      <SpatialShadowPlaybackProvider snapshot={snapshot}>
        <Probe id="diagnostics" />
        <Probe id="pascal" />
      </SpatialShadowPlaybackProvider>
    )

    expect(markup.match(/data-time="0"/g)).toHaveLength(2)
    expect(markup.match(/data-playing="false"/g)).toHaveLength(2)
    expect(markup.match(/data-rate="1"/g)).toHaveLength(2)
    expect(markup.match(/data-segment="0"/g)).toHaveLength(2)
  })

  it('fails loudly instead of creating an implicit second clock', () => {
    expect(() => renderToStaticMarkup(<Probe id="orphan" />)).toThrowError(
      /必须在 SpatialShadowPlaybackProvider 内使用/
    )
  })
})
