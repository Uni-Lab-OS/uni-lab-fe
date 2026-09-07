import { useMemo, useState } from 'react'

import {
  getSpatialProjectionBounds,
  projectSpatialAabb,
  type SpatialProjectionPlane
} from './projection'
import type {
  SpatialAabb,
  SpatialEnvironmentCollisionFrame,
  SpatialShadowAttachment,
  SpatialShadowDiagnosticsProps,
  SpatialShadowSegment,
  SpatialShadowSnapshot,
  SpatialShadowState
} from './types'
import { useSpatialShadowPlayback } from './playbackController'
import './SpatialShadowDiagnostics.css'

const VIEWPORT = { width: 520, height: 250, padding: 22 } as const

function ReloadButton({ onReload }: { onReload?: () => void }) {
  if (!onReload) return null
  return (
    <button className="spatial-diagnostics__reload" type="button" onClick={onReload}>
      重新读取
    </button>
  )
}

function StatusSurface({
  phase,
  message,
  onReload
}: {
  phase: 'loading' | 'error' | 'unavailable'
  message: string
  onReload?: () => void
}) {
  return (
    <section
      className={`spatial-diagnostics spatial-diagnostics--${phase}`}
      data-testid="spatial-shadow-diagnostics"
      data-phase={phase}
      aria-label="空间约束自动计算"
    >
      <div className="spatial-diagnostics__empty" role={phase === 'loading' ? 'status' : 'alert'}>
        <strong>
          {phase === 'loading'
            ? '正在读取空间约束快照'
            : phase === 'unavailable'
              ? '空间约束快照不可用'
              : '空间约束快照读取失败'}
        </strong>
        <span>{message}</span>
        <ReloadButton onReload={onReload} />
      </div>
    </section>
  )
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="spatial-diagnostics__metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function Projection({
  plane,
  snapshot,
  state,
  segment,
  attachments,
  collisionFrame
}: {
  plane: SpatialProjectionPlane
  snapshot: SpatialShadowSnapshot
  state: SpatialShadowState
  segment: SpatialShadowSegment | null
  attachments: readonly SpatialShadowAttachment[]
  collisionFrame: SpatialEnvironmentCollisionFrame | null
}) {
  const selectedEnvelope =
    segment?.continuous_world_aabb ?? segment?.world_aabb ?? null
  const contactPointBoxes = (collisionFrame?.exact_contacts ?? []).map((contact) => ({
    min_m: contact.position_m,
    max_m: contact.position_m
  }))
  const contactedObjects = new Set(
    (collisionFrame?.exact_contacts ?? []).map((contact) => contact.moving_object_id)
  )
  const contactedEntities = new Set(
    (collisionFrame?.exact_contacts ?? []).map(
      (contact) => contact.environment_entity_id
    )
  )
  const boxes = useMemo(
    () => [
      ...snapshot.environment_entities.flatMap((entity) =>
        entity.component_world_aabbs.length > 0
          ? entity.component_world_aabbs
          : [entity.world_aabb]
      ),
      ...state.links.map((link) => link.world_aabb),
      ...attachments.map((attachment) => attachment.world_aabb),
      ...contactPointBoxes,
      ...(selectedEnvelope ? [selectedEnvelope] : [])
    ],
    [
      snapshot.environment_entities,
      state.links,
      attachments,
      contactPointBoxes,
      selectedEnvelope
    ]
  )
  const bounds = useMemo(
    () => getSpatialProjectionBounds(boxes, plane),
    [boxes, plane]
  )
  const label = plane === 'xy' ? '俯视图 XY' : '侧视图 XZ'
  const verticalAxis = plane === 'xy' ? 'Y' : 'Z'

  function rect(box: SpatialAabb) {
    return projectSpatialAabb(box, plane, bounds, VIEWPORT)
  }

  return (
    <figure className="spatial-diagnostics__projection">
      <figcaption>
        <strong>{label}</strong>
        <span>单位：m</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${VIEWPORT.width} ${VIEWPORT.height}`}
        role="img"
        aria-label={`${state.point_ref} 的${label} AABB 投影`}
      >
        <defs>
          <pattern id={`spatial-grid-${plane}`} width="26" height="26" patternUnits="userSpaceOnUse">
            <path d="M 26 0 L 0 0 0 26" className="spatial-diagnostics__grid-line" />
          </pattern>
        </defs>
        <rect width={VIEWPORT.width} height={VIEWPORT.height} className="spatial-diagnostics__canvas" />
        <rect width={VIEWPORT.width} height={VIEWPORT.height} fill={`url(#spatial-grid-${plane})`} />
        {snapshot.environment_entities.flatMap((entity) => {
          const components = entity.component_world_aabbs.length > 0
            ? entity.component_world_aabbs
            : [entity.world_aabb]
          return components.map((component, componentIndex) => (
            <rect
              key={`${entity.entity_id}:component:${componentIndex}`}
              {...rect(component)}
              className={`spatial-diagnostics__environment-box${contactedEntities.has(entity.entity_id) ? ' is-contact' : ''}`}
              data-spatial-entity={entity.entity_id}
            >
              <title>{`${entity.entity_id}（${entity.collision_mode} · ${componentIndex + 1}/${components.length}）`}</title>
            </rect>
          ))
        })}
        {segment && selectedEnvelope ? (
          <rect
            {...rect(selectedEnvelope)}
            className="spatial-diagnostics__corridor-box"
            data-spatial-segment={segment.segment_index}
          >
            <title>{`Segment ${segment.segment_index} 连续运动保守候选包络`}</title>
          </rect>
        ) : null}
        {state.links.map((link, index) => (
          <rect
            key={link.link_id}
            {...rect(link.world_aabb)}
            className={`spatial-diagnostics__link-box${contactedObjects.has(link.link_id) ? ' is-contact' : ''}`}
            style={{ '--spatial-link-index': index } as React.CSSProperties}
            data-spatial-link={link.link_id}
          >
            <title>{link.link_id}</title>
          </rect>
        ))}
        {attachments.map((attachment) => (
          <rect
            key={attachment.attachment_id}
            {...rect(attachment.world_aabb)}
            className={`spatial-diagnostics__attachment-box is-${attachment.kind}${contactedObjects.has(attachment.attachment_id) ? ' is-contact' : ''}`}
            data-spatial-attachment={attachment.attachment_id}
          >
            <title>{attachment.attachment_id}</title>
          </rect>
        ))}
        {(collisionFrame?.exact_contacts ?? []).map((contact, index) => {
          const point = rect({ min_m: contact.position_m, max_m: contact.position_m })
          return (
            <circle
              key={`${contact.moving_object_id}:${contact.environment_component_id}:${index}`}
              cx={point.x}
              cy={point.y}
              r="5"
              className="spatial-diagnostics__contact-point"
              data-spatial-contact={contact.environment_component_id}
            >
              <title>{`候选接触位置 ${contact.position_m.map((value) => value.toFixed(3)).join(', ')} m`}</title>
            </circle>
          )
        })}
        <text x="10" y={VIEWPORT.height - 8} className="spatial-diagnostics__axis-label">X →</text>
        <text x={VIEWPORT.width - 44} y="16" className="spatial-diagnostics__axis-label">{verticalAxis} ↑</text>
      </svg>
    </figure>
  )
}

function SegmentButton({
  segment,
  active,
  onSelect
}: {
  segment: SpatialShadowSegment
  active: boolean
  onSelect: () => void
}) {
  const collisionLabel =
    segment.environment_collision_status === 'proxy-mesh-contact'
      ? '代理接触'
      : segment.environment_collision_status === 'broad-phase-overlap-unresolved'
        ? '待精检'
        : '采样分离'
  const collisionClass =
    segment.environment_collision_status === 'proxy-mesh-contact'
      ? 'is-contact'
      : segment.environment_collision_status === 'broad-phase-overlap-unresolved'
        ? 'is-unresolved'
        : 'is-separated'
  return (
    <button
      type="button"
      className={`spatial-diagnostics__segment${active ? ' is-active' : ''}`}
      aria-pressed={active}
      onClick={onSelect}
    >
      <span className={`spatial-diagnostics__segment-state ${collisionClass}`}>
        {collisionLabel}
      </span>
      <strong>#{segment.segment_index + 1}</strong>
      <span>{segment.motion === 'move_j' ? '关节运动' : '直线运动'}</span>
      <small>CP {segment.cp}</small>
    </button>
  )
}

function ReadyDiagnostics({
  snapshot,
  statusMessage,
  onReload
}: {
  snapshot: SpatialShadowSnapshot
  statusMessage: string
  onReload?: () => void
}) {
  const [selectedStateId, setSelectedStateId] = useState(snapshot.states[0].state_id)
  const [isPlaybackView, setIsPlaybackView] = useState(true)
  const playback = useSpatialShadowPlayback()
  const playbackTime = playback.timeS
  const playbackRate = playback.rate
  const isPlaying = playback.playing
  const selectedState =
    snapshot.states.find((state) => state.state_id === selectedStateId) ??
    snapshot.states[0]
  const playbackSegment =
    [...snapshot.playback.segments]
      .reverse()
      .find((segment) => playbackTime >= segment.start_time_s - 1e-9) ??
    snapshot.playback.segments[0]
  const playbackFrame = playbackSegment.frames.reduce((nearest, frame) =>
    Math.abs(frame.time_s - playbackTime) < Math.abs(nearest.time_s - playbackTime)
      ? frame
      : nearest
  )
  const selectedSegment = isPlaybackView
    ? snapshot.segments[playbackSegment.segment_index] ?? null
    : null
  const playbackTargetState =
    snapshot.states.find(
      (state) => state.state_id === selectedSegment?.target_state_id
    ) ?? selectedState
  const collisionFrame = isPlaybackView
    ? snapshot.environment_collision.frames.find(
        (frame) =>
          frame.segment_index === playbackSegment.segment_index &&
          frame.frame_index === playbackFrame.frame_index
      ) ?? null
    : null
  const displayState: SpatialShadowState = isPlaybackView
    ? {
        ...playbackTargetState,
        state_id: `playback:${playbackSegment.segment_index}:${playbackFrame.frame_index}`,
        phase: selectedSegment?.phase ?? playbackTargetState.phase,
        payload_state: selectedSegment?.payload_state ?? playbackTargetState.payload_state,
        links: playbackFrame.links
      }
    : selectedState
  const displayAttachments = isPlaybackView ? playbackFrame.attachments : []

  const selectSegment = (segment: SpatialShadowSegment) => {
    if (isPlaying) playback.toggle()
    playback.selectSegment(segment.segment_index)
    setIsPlaybackView(true)
    setSelectedStateId(segment.target_state_id)
  }

  const togglePlayback = () => {
    setIsPlaybackView(true)
    playback.toggle()
  }
  const firstContact = snapshot.environment_collision.summary.first_contact
  const currentContact = collisionFrame?.exact_contacts[0] ?? null
  const collisionLabel =
    collisionFrame?.status === 'proxy-mesh-contact'
      ? '代理网格接触'
      : collisionFrame?.status === 'broad-phase-overlap-unresolved'
        ? '宽相重叠，几何未精检'
        : collisionFrame
          ? '该采样帧分离'
          : '端点查看模式'

  return (
    <section
      className="spatial-diagnostics"
      data-testid="spatial-shadow-diagnostics"
      data-phase="ready"
      data-spatial-decision={snapshot.decision}
      data-spatial-mode={snapshot.mode}
      data-spatial-effect={snapshot.effect}
      aria-label="空间约束自动计算"
    >
      <header className="spatial-diagnostics__header">
        <div>
          <span className="spatial-diagnostics__eyebrow">EIT TEST CASE · {snapshot.sample_id}</span>
          <h2>离线空间约束计算结果查看器</h2>
          <p>{snapshot.action_contract_id} · {snapshot.world_frame.frame_id}</p>
        </div>
        <div className="spatial-diagnostics__header-action">
          <span>{statusMessage} · digest <code>{snapshot.snapshot_digest.slice(0, 12)}</code></span>
          <ReloadButton onReload={onReload} />
        </div>
      </header>

      <div className="spatial-diagnostics__boundary" role="alert">
        <strong>结论未知：禁止据此放行</strong>
        <span>
          不是 WorkCellActivation 或完整物理仿真器。14 段 / 522 帧离线轨迹已检查；检测到 {snapshot.summary.environment_exact_contact_frame_count} 个代理接触帧，
          另有 {snapshot.summary.environment_broad_only_frame_count} 帧只到宽相。Shadow · effect=none。
        </span>
      </div>

      <ol className="spatial-diagnostics__method" aria-label="空间约束自动计算方法">
        <li><strong>1</strong><span>锁定输入与坐标系</span></li>
        <li><strong>2</strong><span>FK 得到 15 状态 × 7 连杆 AABB</span></li>
        <li><strong>3</strong><span>14 段轨迹、工具和 payload 生成离线播放帧</span></li>
        <li><strong>4</strong><span>候选配准后做 AABB 宽相，再用盒体 SAT + 源 GLB 复合凸体精检</span></li>
        <li><strong>5</strong><span>代理体、未精检形状和停止包络未合格 → unknown</span></li>
      </ol>

      <div className="spatial-diagnostics__metrics" aria-label="覆盖统计">
        <Metric value={snapshot.summary.state_count} label="机械臂状态" />
        <Metric value={snapshot.summary.segment_count} label="运动段" />
        <Metric value={snapshot.summary.sampled_segment_count} label="已采样候选" />
        <Metric value={snapshot.summary.continuous_evaluated_segment_count} label="连续包络段" />
        <Metric value={snapshot.summary.self_collision_candidate_pair_count} label="自碰撞候选对" />
        <Metric value={snapshot.summary.playback_frame_count} label="播放帧" />
        <Metric value={snapshot.summary.environment_exact_contact_frame_count} label="代理接触帧" />
        <Metric value={snapshot.environment_collision.coverage.compound_convex_component_count} label="源模型凸组件" />
        <Metric value={snapshot.summary.environment_broad_only_frame_count} label="待精检帧" />
        <Metric value={snapshot.summary.excluded_segment_count} label="连续包络未覆盖" />
        <Metric value={snapshot.summary.link_count} label="连杆 AABB / 状态" />
      </div>

      <div className="spatial-diagnostics__workspace">
        <div className="spatial-diagnostics__main">
          <div className="spatial-diagnostics__state-heading">
            <div>
              <span>{isPlaybackView ? '离线播放' : '端点状态'}</span>
              <strong>{displayState.point_ref}</strong>
            </div>
            <span>
              {displayState.phase} · {displayState.payload_state}
              {isPlaybackView ? ` · ${playbackTime.toFixed(2)} s` : ''}
            </span>
          </div>
          <div className="spatial-diagnostics__playback" aria-label="离线轨迹播放控制">
            <button type="button" onClick={togglePlayback} aria-pressed={isPlaying}>
              {isPlaying ? '暂停' : '播放'}
            </button>
            <input
              type="range"
              min="0"
              max={snapshot.playback.duration_s}
              step="0.01"
              value={playbackTime}
              aria-label="轨迹时间"
              onChange={(event) => {
                if (isPlaying) playback.toggle()
                playback.seek(Number(event.currentTarget.value))
                setIsPlaybackView(true)
              }}
            />
            <select
              value={playbackRate}
              aria-label="播放速度"
              onChange={(event) => playback.setRate(Number(event.currentTarget.value))}
            >
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
            <span>{playbackTime.toFixed(2)} / {snapshot.playback.duration_s.toFixed(2)} s</span>
          </div>
          <div
            className={`spatial-diagnostics__collision-readout${collisionFrame?.status === 'proxy-mesh-contact' ? ' is-contact' : collisionFrame?.status === 'broad-phase-overlap-unresolved' ? ' is-unresolved' : ''}`}
            data-spatial-collision-status={collisionFrame?.status ?? 'endpoint'}
          >
            <strong>{collisionLabel}</strong>
            {collisionFrame ? (
              <span>
                最近 AABB 距离下界 {collisionFrame.minimum_aabb_clearance_m.toFixed(4)} m ·
                最近对象 {collisionFrame.closest_pair.moving_object_id} ↔ {collisionFrame.closest_pair.environment_component_id}
              </span>
            ) : (
              <span>拖动时间轴可查看逐帧距离与接触位置。</span>
            )}
            {currentContact ? (
              <code>
                接触候选位置 [{currentContact.position_m.map((value) => value.toFixed(3)).join(', ')}] m
              </code>
            ) : null}
          </div>
          <div className="spatial-diagnostics__projections">
            <Projection plane="xy" snapshot={snapshot} state={displayState} segment={selectedSegment} attachments={displayAttachments} collisionFrame={collisionFrame} />
            <Projection plane="xz" snapshot={snapshot} state={displayState} segment={selectedSegment} attachments={displayAttachments} collisionFrame={collisionFrame} />
          </div>
          <div className="spatial-diagnostics__legend" aria-label="投影图例">
            <span><i className="is-environment" />环境代理 AABB</span>
            <span><i className="is-link" />当前 7 个连杆 AABB</span>
            <span><i className="is-corridor" />保守连续候选包络</span>
            <span><i className="is-tool" />随动工具</span>
            <span><i className="is-payload" />随动 payload</span>
            <span><i className="is-contact" />代理精检接触</span>
          </div>
          <div className="spatial-diagnostics__states" aria-label="状态选择">
            {snapshot.states.map((state, index) => (
              <button
                key={state.state_id}
                type="button"
                className={!isPlaybackView && state.state_id === selectedState.state_id ? 'is-active' : undefined}
                aria-pressed={!isPlaybackView && state.state_id === selectedState.state_id}
                title={`${state.point_ref} · ${state.phase}`}
                onClick={() => {
                  setSelectedStateId(state.state_id)
                  setIsPlaybackView(false)
                  if (isPlaying) playback.toggle()
                }}
              >
                {index + 1}
              </button>
            ))}
          </div>
        </div>

        <aside className="spatial-diagnostics__segments" aria-label="运动段覆盖">
          <div className="spatial-diagnostics__aside-heading">
            <strong>14 段运动覆盖</strong>
            <span>选择后定位到目标状态</span>
          </div>
          <div className="spatial-diagnostics__segment-list">
            {snapshot.segments.map((segment) => (
              <SegmentButton
                key={segment.segment_index}
                segment={segment}
                active={isPlaybackView && segment.segment_index === selectedSegment?.segment_index}
                onSelect={() => selectSegment(segment)}
              />
            ))}
          </div>
          {selectedSegment ? (
            <div className="spatial-diagnostics__selection-note">
              <strong>Segment #{selectedSegment.segment_index + 1}</strong>
              <span>
                {selectedSegment.playback_frame_count} 个播放帧 / {selectedSegment.playback_duration_s.toFixed(3)} s；
                {selectedSegment.continuous_status === 'continuous-broad-phase-candidate'
                  ? `${selectedSegment.continuous_interval_count} 个连续区间保守包络，${selectedSegment.self_collision_candidate_pair_count} 对进入精检候选。`
                  : '安全连续包络尚未覆盖；该段仅作离线播放。'}
              </span>
              <span>
                环境检查：{selectedSegment.environment_contact_frame_count} 个代理接触帧，
                {selectedSegment.environment_broad_only_frame_count} 个待精检帧；最小 AABB 距离下界
                {' '}{selectedSegment.environment_minimum_aabb_clearance_m.toFixed(4)} m。
              </span>
              <code>{selectedSegment.playback_interpolation} · {selectedSegment.playback_controller_fidelity}</code>
            </div>
          ) : null}
        </aside>
      </div>

      <details className="spatial-diagnostics__limitations">
        <summary>为什么仍是 unknown？查看 {snapshot.limitations.length} 条证据缺口</summary>
        <ul>
          {snapshot.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </details>
      <footer className="spatial-diagnostics__evidence">
        <span>快照 <code>{snapshot.snapshot_digest.slice(0, 12)}</code></span>
        <span>
          最大 TCP 位置残差 {snapshot.validation.max_residual_excluding_observed_outliers_mm.toFixed(3)} mm
          {' / '}阈值 {snapshot.validation.position_residual_threshold_mm.toFixed(3)} mm
        </span>
        <span>{snapshot.validation.within_threshold_count}/{snapshot.validation.evaluated_state_count} 状态在阈值内</span>
        {firstContact ? (
          <span>
            首次代理接触 {firstContact.time_s.toFixed(3)} s · [{firstContact.position_m.map((value) => value.toFixed(3)).join(', ')}] m
          </span>
        ) : null}
        <span>
          坐标配准：{snapshot.registration.status} · 刚体资格=false
        </span>
      </footer>
    </section>
  )
}

export function SpatialShadowDiagnostics({
  snapshot,
  status,
  onReload
}: SpatialShadowDiagnosticsProps) {
  if (status.phase !== 'ready') {
    return <StatusSurface phase={status.phase} message={status.message} onReload={onReload} />
  }
  if (!snapshot) {
    return (
      <StatusSurface
        phase="error"
        message="状态标记为 ready，但没有通过严格校验的快照；已拒绝展示。"
        onReload={onReload}
      />
    )
  }
  return (
    <ReadyDiagnostics
      snapshot={snapshot}
      statusMessage={status.message}
      onReload={onReload}
    />
  )
}
