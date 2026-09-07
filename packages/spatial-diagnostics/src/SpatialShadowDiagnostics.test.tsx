import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { parseSpatialShadowSnapshot } from './parser'
import { SpatialShadowPlaybackProvider } from './playbackController'
import { SpatialShadowDiagnostics } from './SpatialShadowDiagnostics'
import { createSpatialShadowFixtureText } from './testFixture'

describe('SpatialShadowDiagnostics', () => {
  it('shows the EIT coverage without converting shadow evidence into permission', () => {
    const snapshot = parseSpatialShadowSnapshot(createSpatialShadowFixtureText())
    const markup = renderToStaticMarkup(
      <SpatialShadowPlaybackProvider snapshot={snapshot}>
        <SpatialShadowDiagnostics
          snapshot={snapshot}
          status={{ phase: 'ready', message: '已读取' }}
        />
      </SpatialShadowPlaybackProvider>
    )

    expect(markup).toContain('15</strong><span>机械臂状态')
    expect(markup).toContain('14</strong><span>运动段')
    expect(markup).toContain('4</strong><span>已采样候选')
    expect(markup).toContain('4</strong><span>连续包络段')
    expect(markup).toContain('8</strong><span>自碰撞候选对')
    expect(markup).toContain('10</strong><span>连续包络未覆盖')
    expect(markup).toContain('结论未知：禁止据此放行')
    expect(markup).toContain('离线空间约束计算结果查看器')
    expect(markup).toContain('不是 WorkCellActivation 或完整物理仿真器')
    expect(markup).toContain('effect=none')
    expect(markup).toContain('14 段轨迹、工具和 payload 生成离线播放帧')
    expect(markup).toContain('28</strong><span>播放帧')
    expect(markup).toContain('aria-label="离线轨迹播放控制"')
    expect(markup).toContain('data-spatial-attachment="tool:TOOL_SUCTION"')
    expect(markup).toContain('盒体 SAT + 源 GLB 复合凸体精检')
    expect(markup).toContain('compound-convex · 1/1')
    expect(markup).toContain('1</strong><span>代理接触帧')
    expect(markup).toContain('data-spatial-collision-status="separated-at-sampled-frame"')
    expect(markup).toContain('首次代理接触 3.000 s')
    expect(markup).toContain('刚体资格=false')
    expect(markup).toContain('最大 TCP 位置残差 0.250 mm')
    expect(markup).toContain('data-spatial-link="Link6"')
  })

  it('fails closed when ready is reported without a validated snapshot', () => {
    const markup = renderToStaticMarkup(
      <SpatialShadowDiagnostics
        snapshot={null}
        status={{ phase: 'ready', message: '错误的上游状态' }}
      />
    )

    expect(markup).toContain('data-phase="error"')
    expect(markup).toContain('已拒绝展示')
    expect(markup).not.toContain('data-spatial-decision')
  })
})
