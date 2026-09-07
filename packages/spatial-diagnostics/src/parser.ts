import type {
  SpatialAabb,
  SpatialEnvironmentCollisionFrame,
  SpatialEnvironmentContact,
  Matrix4,
  SpatialPlaybackSegment,
  SpatialShadowSegment,
  SpatialShadowSnapshot,
  SpatialShadowState
} from './types'
import { readCanonicalJson, sha256Hex } from './digest'
import { SPATIAL_SHADOW_TOP_LEVEL_KEYS } from './schemaKeys'

export class SpatialShadowSnapshotParseError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'SpatialShadowSnapshotParseError'
    this.path = path
  }
}

function fail(path: string, message: string): never {
  throw new SpatialShadowSnapshotParseError(path, message)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, '必须是对象')
  }
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string
): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(path, `字段必须严格为 ${wanted.join(', ')}`)
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(path, '必须是非空字符串')
  }
  return value
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, '必须是有限数值')
  }
  return value
}

function nonNegativeNumber(value: unknown, path: string): number {
  const parsed = finiteNumber(value, path)
  if (parsed < 0) fail(path, '不得小于 0')
  return parsed
}

function nonNegativeInteger(value: unknown, path: string): number {
  const parsed = nonNegativeNumber(value, path)
  if (!Number.isInteger(parsed)) fail(path, '必须是整数')
  return parsed
}

function literal<T extends string | boolean>(
  value: unknown,
  expected: T,
  path: string
): T {
  if (value !== expected) fail(path, `必须是 ${String(expected)}`)
  return expected
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(path, `必须是 ${allowed.join(' | ')}`)
  }
  return value as T
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, '必须是数组')
  return value
}

function stringArray(value: unknown, path: string): readonly string[] {
  const parsed = array(value, path).map((item, index) =>
    string(item, `${path}[${index}]`)
  )
  if (new Set(parsed).size !== parsed.length) fail(path, '不得包含重复项')
  return parsed
}

function vector3(value: unknown, path: string): readonly [number, number, number] {
  const parsed = array(value, path)
  if (parsed.length !== 3) fail(path, '必须包含 3 个坐标值')
  return [
    finiteNumber(parsed[0], `${path}[0]`),
    finiteNumber(parsed[1], `${path}[1]`),
    finiteNumber(parsed[2], `${path}[2]`)
  ]
}

function vector6(
  value: unknown,
  path: string
): readonly [number, number, number, number, number, number] {
  const parsed = array(value, path)
  if (parsed.length !== 6) fail(path, '必须包含 6 个关节值')
  return [
    finiteNumber(parsed[0], `${path}[0]`),
    finiteNumber(parsed[1], `${path}[1]`),
    finiteNumber(parsed[2], `${path}[2]`),
    finiteNumber(parsed[3], `${path}[3]`),
    finiteNumber(parsed[4], `${path}[4]`),
    finiteNumber(parsed[5], `${path}[5]`)
  ]
}

function matrix4(value: unknown, path: string): Matrix4 {
  const rows = array(value, path)
  if (rows.length !== 4) fail(path, '必须包含 4 行')
  const parsed = rows.map((row, rowIndex) => {
    const columns = array(row, `${path}[${rowIndex}]`)
    if (columns.length !== 4) fail(`${path}[${rowIndex}]`, '必须包含 4 列')
    return columns.map((item, columnIndex) =>
      finiteNumber(item, `${path}[${rowIndex}][${columnIndex}]`)
    ) as [number, number, number, number]
  })
  return parsed as unknown as Matrix4
}

function aabb(value: unknown, path: string): SpatialAabb {
  const parsed = record(value, path)
  exactKeys(parsed, ['min_m', 'max_m'], path)
  const min = vector3(parsed.min_m, `${path}.min_m`)
  const max = vector3(parsed.max_m, `${path}.max_m`)
  for (let axis = 0; axis < 3; axis += 1) {
    if (min[axis] > max[axis]) {
      fail(path, `轴 ${axis} 的 min_m 不得大于 max_m`)
    }
  }
  return { min_m: min, max_m: max }
}

function parseEnvironmentContact(
  value: unknown,
  path: string
): SpatialEnvironmentContact {
  const parsed = record(value, path)
  exactKeys(
    parsed,
    [
      'moving_object_id',
      'moving_kind',
      'environment_entity_id',
      'environment_component_id',
      'position_m',
      'method'
    ],
    path
  )
  return {
    moving_object_id: string(parsed.moving_object_id, `${path}.moving_object_id`),
    moving_kind: oneOf(
      parsed.moving_kind,
      ['robot-link', 'tool', 'payload'],
      `${path}.moving_kind`
    ),
    environment_entity_id: string(
      parsed.environment_entity_id,
      `${path}.environment_entity_id`
    ),
    environment_component_id: string(
      parsed.environment_component_id,
      `${path}.environment_component_id`
    ),
    position_m: vector3(parsed.position_m, `${path}.position_m`),
    method: oneOf(
      parsed.method,
      [
        'triangle-vs-generated-box-sat',
        'triangle-vs-compound-convex-clipping'
      ],
      `${path}.method`
    )
  }
}

function parseEnvironmentCollisionFrame(
  value: unknown,
  path: string
): SpatialEnvironmentCollisionFrame {
  const parsed = record(value, path)
  exactKeys(
    parsed,
    [
      'segment_index',
      'frame_index',
      'time_s',
      'status',
      'minimum_aabb_clearance_m',
      'closest_pair',
      'broad_overlap_pair_count',
      'unresolved_shaped_overlap_pair_count',
      'exact_contacts'
    ],
    path
  )
  const closestPair = record(parsed.closest_pair, `${path}.closest_pair`)
  exactKeys(
    closestPair,
    ['moving_object_id', 'environment_component_id'],
    `${path}.closest_pair`
  )
  const status = oneOf(
    parsed.status,
    [
      'separated-at-sampled-frame',
      'broad-phase-overlap-unresolved',
      'proxy-mesh-contact'
    ],
    `${path}.status`
  )
  const exactContacts = array(parsed.exact_contacts, `${path}.exact_contacts`).map(
    (contact, index) =>
      parseEnvironmentContact(contact, `${path}.exact_contacts[${index}]`)
  )
  if (status === 'proxy-mesh-contact' && exactContacts.length === 0) {
    fail(`${path}.exact_contacts`, 'proxy-mesh-contact 必须包含接触事件')
  }
  if (status !== 'proxy-mesh-contact' && exactContacts.length !== 0) {
    fail(`${path}.exact_contacts`, '非接触帧不得包含精检接触事件')
  }
  return {
    segment_index: nonNegativeInteger(parsed.segment_index, `${path}.segment_index`),
    frame_index: nonNegativeInteger(parsed.frame_index, `${path}.frame_index`),
    time_s: nonNegativeNumber(parsed.time_s, `${path}.time_s`),
    status,
    minimum_aabb_clearance_m: nonNegativeNumber(
      parsed.minimum_aabb_clearance_m,
      `${path}.minimum_aabb_clearance_m`
    ),
    closest_pair: {
      moving_object_id: string(
        closestPair.moving_object_id,
        `${path}.closest_pair.moving_object_id`
      ),
      environment_component_id: string(
        closestPair.environment_component_id,
        `${path}.closest_pair.environment_component_id`
      )
    },
    broad_overlap_pair_count: nonNegativeInteger(
      parsed.broad_overlap_pair_count,
      `${path}.broad_overlap_pair_count`
    ),
    unresolved_shaped_overlap_pair_count: nonNegativeInteger(
      parsed.unresolved_shaped_overlap_pair_count,
      `${path}.unresolved_shaped_overlap_pair_count`
    ),
    exact_contacts: exactContacts
  }
}

function parseEnvironmentFirstContact(
  value: unknown,
  path: string
): SpatialEnvironmentContact & {
  segment_index: number
  frame_index: number
  time_s: number
} {
  const parsed = record(value, path)
  exactKeys(
    parsed,
    [
      'segment_index',
      'frame_index',
      'time_s',
      'moving_object_id',
      'moving_kind',
      'environment_entity_id',
      'environment_component_id',
      'position_m',
      'method'
    ],
    path
  )
  return {
    segment_index: nonNegativeInteger(parsed.segment_index, `${path}.segment_index`),
    frame_index: nonNegativeInteger(parsed.frame_index, `${path}.frame_index`),
    time_s: nonNegativeNumber(parsed.time_s, `${path}.time_s`),
    moving_object_id: string(parsed.moving_object_id, `${path}.moving_object_id`),
    moving_kind: oneOf(
      parsed.moving_kind,
      ['robot-link', 'tool', 'payload'],
      `${path}.moving_kind`
    ),
    environment_entity_id: string(
      parsed.environment_entity_id,
      `${path}.environment_entity_id`
    ),
    environment_component_id: string(
      parsed.environment_component_id,
      `${path}.environment_component_id`
    ),
    position_m: vector3(parsed.position_m, `${path}.position_m`),
    method: oneOf(
      parsed.method,
      [
        'triangle-vs-generated-box-sat',
        'triangle-vs-compound-convex-clipping'
      ],
      `${path}.method`
    )
  }
}

function artifact(value: unknown, path: string): void {
  const parsed = record(value, path)
  exactKeys(parsed, ['file', 'digest'], path)
  const file = string(parsed.file, `${path}.file`)
  if (file.startsWith('/') || file.includes('..')) {
    fail(`${path}.file`, '必须是无上级跳转的相对文件名')
  }
  const digest = string(parsed.digest, `${path}.digest`)
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    fail(`${path}.digest`, '必须是 64 位小写 SHA-256')
  }
}

function parseState(value: unknown, path: string): SpatialShadowState {
  const parsed = record(value, path)
  exactKeys(
    parsed,
    [
      'state_id',
      'step_index',
      'point_ref',
      'phase',
      'payload_state',
      'tcp_residual_mm',
      'links'
    ],
    path
  )
  const stepIndex =
    parsed.step_index === null
      ? null
      : nonNegativeInteger(parsed.step_index, `${path}.step_index`)
  const links = array(parsed.links, `${path}.links`).map((link, index) => {
    const linkPath = `${path}.links[${index}]`
    const entry = record(link, linkPath)
    exactKeys(entry, ['link_id', 'world_aabb'], linkPath)
    return {
      link_id: string(entry.link_id, `${linkPath}.link_id`),
      world_aabb: aabb(entry.world_aabb, `${linkPath}.world_aabb`)
    }
  })
  if (links.length === 0) fail(`${path}.links`, '至少需要一个连杆')
  if (new Set(links.map((link) => link.link_id)).size !== links.length) {
    fail(`${path}.links`, 'link_id 不得重复')
  }
  return {
    state_id: string(parsed.state_id, `${path}.state_id`),
    step_index: stepIndex,
    point_ref: string(parsed.point_ref, `${path}.point_ref`),
    phase: oneOf(parsed.phase, ['precondition', 'approach', 'transfer'], `${path}.phase`),
    payload_state: oneOf(
      parsed.payload_state,
      ['empty', 'plate-attached'],
      `${path}.payload_state`
    ),
    tcp_residual_mm: nonNegativeNumber(
      parsed.tcp_residual_mm,
      `${path}.tcp_residual_mm`
    ),
    links
  }
}

function parseSegment(value: unknown, path: string): SpatialShadowSegment {
  const parsed = record(value, path)
  exactKeys(
    parsed,
    [
      'segment_index',
      'source_state_id',
      'target_state_id',
      'target_step_index',
      'motion',
      'cp',
      'phase',
      'payload_state',
      'status',
      'sample_count',
      'world_aabb',
      'continuous_status',
      'continuous_interval_count',
      'continuous_world_aabb',
      'self_collision_candidate_pair_count',
      'self_collision_separated_pair_count',
      'reason_codes',
      'continuous_reason_codes',
      'playback_duration_s',
      'playback_frame_count',
      'playback_interpolation',
      'playback_controller_fidelity',
      'environment_collision_status',
      'environment_minimum_aabb_clearance_m',
      'environment_contact_frame_count',
      'environment_broad_only_frame_count',
      'environment_first_contact_time_s'
    ],
    path
  )
  const status = oneOf(
    parsed.status,
    ['sampled-candidate', 'excluded-unresolved'],
    `${path}.status`
  )
  const sampleCount =
    parsed.sample_count === null
      ? null
      : nonNegativeInteger(parsed.sample_count, `${path}.sample_count`)
  const worldAabb =
    parsed.world_aabb === null
      ? null
      : aabb(parsed.world_aabb, `${path}.world_aabb`)
  if (status === 'sampled-candidate') {
    if (sampleCount === null || sampleCount === 0 || worldAabb === null) {
      fail(path, 'sampled-candidate 必须有正 sample_count 和 world_aabb')
    }
  } else if (sampleCount !== null || worldAabb !== null) {
    fail(path, 'excluded-unresolved 必须保留 sample_count/world_aabb 为 null')
  }
  const continuousStatus = oneOf(
    parsed.continuous_status,
    ['continuous-broad-phase-candidate', 'excluded-unresolved'],
    `${path}.continuous_status`
  )
  const continuousIntervalCount =
    parsed.continuous_interval_count === null
      ? null
      : nonNegativeInteger(
          parsed.continuous_interval_count,
          `${path}.continuous_interval_count`
        )
  const continuousWorldAabb =
    parsed.continuous_world_aabb === null
      ? null
      : aabb(parsed.continuous_world_aabb, `${path}.continuous_world_aabb`)
  const candidatePairCount =
    parsed.self_collision_candidate_pair_count === null
      ? null
      : nonNegativeInteger(
          parsed.self_collision_candidate_pair_count,
          `${path}.self_collision_candidate_pair_count`
        )
  const separatedPairCount =
    parsed.self_collision_separated_pair_count === null
      ? null
      : nonNegativeInteger(
          parsed.self_collision_separated_pair_count,
          `${path}.self_collision_separated_pair_count`
        )
  if (continuousStatus === 'continuous-broad-phase-candidate') {
    if (
      continuousIntervalCount === null ||
      continuousIntervalCount === 0 ||
      continuousWorldAabb === null ||
      candidatePairCount === null ||
      separatedPairCount === null ||
      candidatePairCount + separatedPairCount !== 15
    ) {
      fail(path, '连续候选必须包含正区间数、包络和 15 个非相邻连杆对结果')
    }
  } else if (
    continuousIntervalCount !== null ||
    continuousWorldAabb !== null ||
    candidatePairCount !== null ||
    separatedPairCount !== null
  ) {
    fail(path, '连续排除项必须保留全部连续结果为 null')
  }

  return {
    segment_index: nonNegativeInteger(
      parsed.segment_index,
      `${path}.segment_index`
    ),
    source_state_id: string(parsed.source_state_id, `${path}.source_state_id`),
    target_state_id: string(parsed.target_state_id, `${path}.target_state_id`),
    target_step_index: nonNegativeInteger(
      parsed.target_step_index,
      `${path}.target_step_index`
    ),
    motion: oneOf(parsed.motion, ['move_j', 'move_l'], `${path}.motion`),
    cp: nonNegativeNumber(parsed.cp, `${path}.cp`),
    phase: oneOf(parsed.phase, ['approach', 'transfer'], `${path}.phase`),
    payload_state: oneOf(
      parsed.payload_state,
      ['empty', 'plate-attached'],
      `${path}.payload_state`
    ),
    status,
    sample_count: sampleCount,
    world_aabb: worldAabb,
    continuous_status: continuousStatus,
    continuous_interval_count: continuousIntervalCount,
    continuous_world_aabb: continuousWorldAabb,
    self_collision_candidate_pair_count: candidatePairCount,
    self_collision_separated_pair_count: separatedPairCount,
    reason_codes: stringArray(parsed.reason_codes, `${path}.reason_codes`),
    continuous_reason_codes: stringArray(
      parsed.continuous_reason_codes,
      `${path}.continuous_reason_codes`
    ),
    playback_duration_s: nonNegativeNumber(
      parsed.playback_duration_s,
      `${path}.playback_duration_s`
    ),
    playback_frame_count: nonNegativeInteger(
      parsed.playback_frame_count,
      `${path}.playback_frame_count`
    ),
    playback_interpolation: oneOf(
      parsed.playback_interpolation,
      [
        'compiled-move-l-joint-trajectory',
        'nominal-move-j',
        'nominal-unblended-move-j'
      ],
      `${path}.playback_interpolation`
    ),
    playback_controller_fidelity: oneOf(
      parsed.playback_controller_fidelity,
      ['diagnostic-compiled-move-l', 'nominal-controller-unverified'],
      `${path}.playback_controller_fidelity`
    ),
    environment_collision_status: oneOf(
      parsed.environment_collision_status,
      [
        'separated-at-sampled-frames',
        'broad-phase-overlap-unresolved',
        'proxy-mesh-contact'
      ],
      `${path}.environment_collision_status`
    ),
    environment_minimum_aabb_clearance_m: nonNegativeNumber(
      parsed.environment_minimum_aabb_clearance_m,
      `${path}.environment_minimum_aabb_clearance_m`
    ),
    environment_contact_frame_count: nonNegativeInteger(
      parsed.environment_contact_frame_count,
      `${path}.environment_contact_frame_count`
    ),
    environment_broad_only_frame_count: nonNegativeInteger(
      parsed.environment_broad_only_frame_count,
      `${path}.environment_broad_only_frame_count`
    ),
    environment_first_contact_time_s:
      parsed.environment_first_contact_time_s === null
        ? null
        : nonNegativeNumber(
            parsed.environment_first_contact_time_s,
            `${path}.environment_first_contact_time_s`
          )
  }
}

function parsePlaybackSegment(
  value: unknown,
  path: string,
  expectedLinks: readonly string[]
): SpatialPlaybackSegment {
  const parsed = record(value, path)
  exactKeys(
    parsed,
    [
      'segment_index',
      'duration_s',
      'start_time_s',
      'end_time_s',
      'interpolation',
      'controller_fidelity',
      'reason_codes',
      'frames'
    ],
    path
  )
  const duration = nonNegativeNumber(parsed.duration_s, `${path}.duration_s`)
  if (duration === 0) fail(`${path}.duration_s`, '必须大于 0')
  const start = nonNegativeNumber(parsed.start_time_s, `${path}.start_time_s`)
  const end = nonNegativeNumber(parsed.end_time_s, `${path}.end_time_s`)
  if (end <= start || !nearlyEqual(end - start, duration)) {
    fail(path, 'start_time_s/end_time_s 必须与 duration_s 一致')
  }
  const frames = array(parsed.frames, `${path}.frames`).map((frame, frameIndex) => {
    const framePath = `${path}.frames[${frameIndex}]`
    const entry = record(frame, framePath)
    exactKeys(
      entry,
      [
        'frame_index',
        'time_s',
        'segment_time_s',
        'progress',
        'joint_positions_rad',
        'links',
        'attachments'
      ],
      framePath
    )
    const declaredFrameIndex = nonNegativeInteger(
      entry.frame_index,
      `${framePath}.frame_index`
    )
    if (declaredFrameIndex !== frameIndex) {
      fail(`${framePath}.frame_index`, '必须从 0 连续递增')
    }
    const progress = nonNegativeNumber(entry.progress, `${framePath}.progress`)
    if (progress > 1) fail(`${framePath}.progress`, '不得大于 1')
    const links = array(entry.links, `${framePath}.links`).map((link, linkIndex) => {
      const linkPath = `${framePath}.links[${linkIndex}]`
      const item = record(link, linkPath)
      exactKeys(item, ['link_id', 'matrix_link_to_world', 'world_aabb'], linkPath)
      return {
        link_id: string(item.link_id, `${linkPath}.link_id`),
        matrix_link_to_world: matrix4(
          item.matrix_link_to_world,
          `${linkPath}.matrix_link_to_world`
        ),
        world_aabb: aabb(item.world_aabb, `${linkPath}.world_aabb`)
      }
    })
    if (!sameSet(expectedLinks, links.map((link) => link.link_id))) {
      fail(`${framePath}.links`, '必须包含与端点状态相同的连杆')
    }
    const attachments = array(entry.attachments, `${framePath}.attachments`).map(
      (attachment, attachmentIndex) => {
        const attachmentPath = `${framePath}.attachments[${attachmentIndex}]`
        const item = record(attachment, attachmentPath)
        exactKeys(
          item,
          [
            'attachment_id',
            'kind',
            'matrix_attachment_to_world',
            'world_aabb'
          ],
          attachmentPath
        )
        return {
          attachment_id: string(
            item.attachment_id,
            `${attachmentPath}.attachment_id`
          ),
          kind: oneOf(item.kind, ['tool', 'payload'], `${attachmentPath}.kind`),
          matrix_attachment_to_world: matrix4(
            item.matrix_attachment_to_world,
            `${attachmentPath}.matrix_attachment_to_world`
          ),
          world_aabb: aabb(item.world_aabb, `${attachmentPath}.world_aabb`)
        }
      }
    )
    if (attachments.length < 1 || attachments.length > 2) {
      fail(`${framePath}.attachments`, '必须包含工具，可选包含一个 payload')
    }
    if (
      new Set(attachments.map((attachment) => attachment.attachment_id)).size !==
      attachments.length
    ) {
      fail(`${framePath}.attachments`, 'attachment_id 不得重复')
    }
    return {
      frame_index: frameIndex,
      time_s: nonNegativeNumber(entry.time_s, `${framePath}.time_s`),
      segment_time_s: nonNegativeNumber(
        entry.segment_time_s,
        `${framePath}.segment_time_s`
      ),
      progress,
      joint_positions_rad: vector6(
        entry.joint_positions_rad,
        `${framePath}.joint_positions_rad`
      ),
      links,
      attachments
    }
  })
  if (frames.length < 2) fail(`${path}.frames`, '至少需要两个播放帧')
  if (!nearlyEqual(frames[0].progress, 0) || !nearlyEqual(frames.at(-1)!.progress, 1)) {
    fail(`${path}.frames`, '首尾 progress 必须是 0 和 1')
  }
  if (!nearlyEqual(frames[0].time_s, start) || !nearlyEqual(frames.at(-1)!.time_s, end)) {
    fail(`${path}.frames`, '首尾 time_s 必须与 segment 时间边界一致')
  }
  return {
    segment_index: nonNegativeInteger(parsed.segment_index, `${path}.segment_index`),
    duration_s: duration,
    start_time_s: start,
    end_time_s: end,
    interpolation: oneOf(
      parsed.interpolation,
      [
        'compiled-move-l-joint-trajectory',
        'nominal-move-j',
        'nominal-unblended-move-j'
      ],
      `${path}.interpolation`
    ),
    controller_fidelity: oneOf(
      parsed.controller_fidelity,
      ['diagnostic-compiled-move-l', 'nominal-controller-unverified'],
      `${path}.controller_fidelity`
    ),
    reason_codes: stringArray(parsed.reason_codes, `${path}.reason_codes`),
    frames
  }
}

function assertCount(actual: number, declared: unknown, path: string): void {
  const expected = nonNegativeInteger(declared, path)
  if (actual !== expected) fail(path, `声明为 ${expected}，实际为 ${actual}`)
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const expected = new Set(left)
  return right.every((item) => expected.has(item))
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-10
}

function validateCrossReferences(
  states: readonly SpatialShadowState[],
  segments: readonly SpatialShadowSegment[],
  partialWorldAabb: SpatialAabb,
  path: string
): void {
  const stateIds = states.map((state) => state.state_id)
  if (new Set(stateIds).size !== stateIds.length) {
    fail(`${path}.states`, 'state_id 不得重复')
  }
  const stateById = new Map(states.map((state) => [state.state_id, state]))
  const expectedLinks = states[0]?.links.map((link) => link.link_id) ?? []
  states.forEach((state, index) => {
    if (!sameSet(expectedLinks, state.links.map((link) => link.link_id))) {
      fail(`${path}.states[${index}].links`, '所有状态必须包含同一组连杆')
    }
  })

  segments.forEach((segment, index) => {
    if (segment.segment_index !== index) {
      fail(`${path}.segments[${index}].segment_index`, '必须从 0 连续递增')
    }
    if (!stateById.has(segment.source_state_id)) {
      fail(`${path}.segments[${index}].source_state_id`, '引用了不存在的状态')
    }
    const target = stateById.get(segment.target_state_id)
    if (!target) {
      fail(`${path}.segments[${index}].target_state_id`, '引用了不存在的状态')
    }
    if (target.step_index !== segment.target_step_index) {
      fail(`${path}.segments[${index}].target_step_index`, '与目标状态不一致')
    }
  })

  const sampledAabbs = segments.flatMap((segment) =>
    segment.world_aabb === null ? [] : [segment.world_aabb]
  )
  if (sampledAabbs.length === 0) {
    fail(`${path}.partial_world_aabb`, '至少需要一个已采样走廊包围盒')
  }
  for (let axis = 0; axis < 3; axis += 1) {
    const min = Math.min(...sampledAabbs.map((box) => box.min_m[axis]))
    const max = Math.max(...sampledAabbs.map((box) => box.max_m[axis]))
    if (
      !nearlyEqual(partialWorldAabb.min_m[axis], min) ||
      !nearlyEqual(partialWorldAabb.max_m[axis], max)
    ) {
      fail(`${path}.partial_world_aabb`, '必须等于已采样 segment AABB 的并集')
    }
  }
}

/**
 * 严格解析离线空间约束快照。任何缺失、多余、越界或计数不一致都会抛错；
 * 解析成功也只代表数据可展示，不代表碰撞资格或调度许可。
 */
export function parseSpatialShadowSnapshot(
  input: unknown
): SpatialShadowSnapshot {
  if (typeof input !== 'string') {
    fail('$', '必须提供原始 JSON 文本，以保留 0.0 与指数格式并校验 snapshot_digest')
  }
  let decoded: unknown
  let canonicalWithoutDigest: string
  try {
    const canonical = readCanonicalJson(input, 'snapshot_digest')
    decoded = JSON.parse(input) as unknown
    canonicalWithoutDigest = canonical.canonical
  } catch (error) {
    fail('$', `JSON 无效：${error instanceof Error ? error.message : String(error)}`)
  }
  const root = record(decoded, '$')
  exactKeys(root, SPATIAL_SHADOW_TOP_LEVEL_KEYS, '$')
  literal(root.schema, 'unilab.spatial-shadow-workbench/v0', '$.schema')
  string(root.sample_id, '$.sample_id')
  const snapshotDigest = string(root.snapshot_digest, '$.snapshot_digest')
  if (!/^[a-f0-9]{64}$/.test(snapshotDigest)) {
    fail('$.snapshot_digest', '必须是 64 位小写 SHA-256')
  }
  const calculatedDigest = sha256Hex(`${canonicalWithoutDigest}\n`)
  if (snapshotDigest !== calculatedDigest) {
    fail(
      '$.snapshot_digest',
      `摘要不匹配（声明 ${snapshotDigest}，计算 ${calculatedDigest}）`
    )
  }

  const source = record(root.source, '$.source')
  exactKeys(source, ['kind', 'workspace_relative_path', 'artifacts'], '$.source')
  literal(source.kind, 'eit-compiler-artifact-export', '$.source.kind')
  const workspacePath = string(
    source.workspace_relative_path,
    '$.source.workspace_relative_path'
  )
  if (workspacePath.startsWith('/') || workspacePath.includes('..')) {
    fail('$.source.workspace_relative_path', '必须是工作区内相对路径')
  }
  const artifacts = record(source.artifacts, '$.source.artifacts')
  const artifactKeys = [
    'certificate',
    'collision_scene',
    'continuous_collision',
    'decision',
    'environment_collision',
    'link_states',
    'motion_corridor',
    'playback'
  ] as const
  exactKeys(artifacts, artifactKeys, '$.source.artifacts')
  artifactKeys.forEach((key) => artifact(artifacts[key], `$.source.artifacts.${key}`))

  string(root.action_contract_id, '$.action_contract_id')
  literal(root.mode, 'shadow', '$.mode')
  literal(root.decision, 'unknown', '$.decision')
  literal(root.effect, 'none', '$.effect')
  literal(root.not_workcell_activation, true, '$.not_workcell_activation')
  literal(root.qualification, 'candidate-partial', '$.qualification')

  const worldFrame = record(root.world_frame, '$.world_frame')
  exactKeys(
    worldFrame,
    ['frame_id', 'handedness', 'units', 'up_axis'],
    '$.world_frame'
  )
  string(worldFrame.frame_id, '$.world_frame.frame_id')
  literal(worldFrame.handedness, 'right-handed', '$.world_frame.handedness')
  literal(worldFrame.units, 'm', '$.world_frame.units')
  literal(worldFrame.up_axis, '+Z', '$.world_frame.up_axis')

  const registration = record(root.registration, '$.registration')
  exactKeys(
    registration,
    [
      'status',
      'source_frame_id',
      'target_frame_id',
      'method',
      'matrix_source_to_target',
      'rail_fit_xy_rms_mm',
      'rail_fit_xy_max_mm',
      'world_rigid_transform_qualified'
    ],
    '$.registration'
  )
  literal(
    registration.status,
    'candidate-relative-layout',
    '$.registration.status'
  )
  string(registration.source_frame_id, '$.registration.source_frame_id')
  const registrationTarget = string(
    registration.target_frame_id,
    '$.registration.target_frame_id'
  )
  if (registrationTarget !== worldFrame.frame_id) {
    fail('$.registration.target_frame_id', '必须等于 world_frame.frame_id')
  }
  literal(
    registration.method,
    'rail-lnz-fit-plus-rail-top-contact',
    '$.registration.method'
  )
  matrix4(
    registration.matrix_source_to_target,
    '$.registration.matrix_source_to_target'
  )
  nonNegativeNumber(
    registration.rail_fit_xy_rms_mm,
    '$.registration.rail_fit_xy_rms_mm'
  )
  nonNegativeNumber(
    registration.rail_fit_xy_max_mm,
    '$.registration.rail_fit_xy_max_mm'
  )
  literal(
    registration.world_rigid_transform_qualified,
    false,
    '$.registration.world_rigid_transform_qualified'
  )

  const states = array(root.states, '$.states').map((state, index) =>
    parseState(state, `$.states[${index}]`)
  )
  if (states.length === 0) fail('$.states', '至少需要一个状态')
  const segments = array(root.segments, '$.segments').map((segment, index) =>
    parseSegment(segment, `$.segments[${index}]`)
  )
  const playbackRoot = record(root.playback, '$.playback')
  exactKeys(
    playbackRoot,
    [
      'duration_s',
      'nominal_frame_rate_hz',
      'kinematics',
      'attachment_models',
      'segments'
    ],
    '$.playback'
  )
  const playbackDuration = nonNegativeNumber(
    playbackRoot.duration_s,
    '$.playback.duration_s'
  )
  if (playbackDuration === 0) fail('$.playback.duration_s', '必须大于 0')
  const playbackFrameRate = nonNegativeNumber(
    playbackRoot.nominal_frame_rate_hz,
    '$.playback.nominal_frame_rate_hz'
  )
  if (playbackFrameRate === 0) {
    fail('$.playback.nominal_frame_rate_hz', '必须大于 0')
  }
  const playbackKinematics = record(
    playbackRoot.kinematics,
    '$.playback.kinematics'
  )
  exactKeys(
    playbackKinematics,
    ['model_id', 'joint_ids', 'position_unit', 'source'],
    '$.playback.kinematics'
  )
  literal(playbackKinematics.model_id, 'dobot-cr5', '$.playback.kinematics.model_id')
  const playbackJointIds = array(
    playbackKinematics.joint_ids,
    '$.playback.kinematics.joint_ids'
  ).map((jointId, index) => string(jointId, `$.playback.kinematics.joint_ids[${index}]`))
  const expectedPlaybackJointIds = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6']
  if (
    playbackJointIds.length !== expectedPlaybackJointIds.length ||
    playbackJointIds.some(
      (jointId, index) => jointId !== expectedPlaybackJointIds[index]
    )
  ) {
    fail(
      '$.playback.kinematics.joint_ids',
      '必须严格按 J1, J2, J3, J4, J5, J6 排列'
    )
  }
  literal(playbackKinematics.position_unit, 'rad', '$.playback.kinematics.position_unit')
  literal(
    playbackKinematics.source,
    'controller-to-model-calibration',
    '$.playback.kinematics.source'
  )
  const attachmentModels = array(
    playbackRoot.attachment_models,
    '$.playback.attachment_models'
  ).map((model, index) => {
    const path = `$.playback.attachment_models[${index}]`
    const parsed = record(model, path)
    exactKeys(
      parsed,
      ['attachment_id', 'kind', 'geometry_source', 'dimensions_m', 'placement_source'],
      path
    )
    const dimensions = vector3(parsed.dimensions_m, `${path}.dimensions_m`)
    if (dimensions.some((dimension) => dimension <= 0)) {
      fail(`${path}.dimensions_m`, '尺寸必须全部大于 0')
    }
    return {
      attachment_id: string(parsed.attachment_id, `${path}.attachment_id`),
      kind: oneOf(parsed.kind, ['tool', 'payload'], `${path}.kind`),
      geometry_source: string(parsed.geometry_source, `${path}.geometry_source`),
      dimensions_m: dimensions,
      placement_source: string(parsed.placement_source, `${path}.placement_source`)
    }
  })
  if (attachmentModels.length !== 2) {
    fail('$.playback.attachment_models', 'v0 必须包含工具和 payload 两个模型')
  }
  const expectedLinks = states[0]?.links.map((link) => link.link_id) ?? []
  const playbackSegments = array(
    playbackRoot.segments,
    '$.playback.segments'
  ).map((segment, index) =>
    parsePlaybackSegment(segment, `$.playback.segments[${index}]`, expectedLinks)
  )
  if (playbackSegments.length !== segments.length) {
    fail('$.playback.segments', '必须与 motion segments 一一对应')
  }
  playbackSegments.forEach((segment, index) => {
    if (segment.segment_index !== index) {
      fail(`$.playback.segments[${index}].segment_index`, '必须从 0 连续递增')
    }
    const motionSegment = segments[index]
    if (
      segment.duration_s !== motionSegment.playback_duration_s ||
      segment.frames.length !== motionSegment.playback_frame_count ||
      segment.interpolation !== motionSegment.playback_interpolation ||
      segment.controller_fidelity !== motionSegment.playback_controller_fidelity
    ) {
      fail(`$.playback.segments[${index}]`, '与 segment 播放摘要不一致')
    }
    if (index > 0 && !nearlyEqual(segment.start_time_s, playbackSegments[index - 1].end_time_s)) {
      fail(`$.playback.segments[${index}].start_time_s`, '时间轴必须连续')
    }
  })
  if (!nearlyEqual(playbackSegments.at(-1)?.end_time_s ?? 0, playbackDuration)) {
    fail('$.playback.duration_s', '必须等于最后一段结束时间')
  }
  const environmentCollision = record(
    root.environment_collision,
    '$.environment_collision'
  )
  exactKeys(
    environmentCollision,
    ['qualification', 'coverage', 'summary', 'frames'],
    '$.environment_collision'
  )
  literal(
    environmentCollision.qualification,
    'candidate-proxy-sampled',
    '$.environment_collision.qualification'
  )
  const environmentCoverage = record(
    environmentCollision.coverage,
    '$.environment_collision.coverage'
  )
  const environmentCoverageKeys = [
    'segment_count',
    'evaluated_frame_count',
    'environment_component_count',
    'exact_box_component_count',
    'compound_convex_component_count',
    'broad_only_component_count',
    'exact_contact_frame_count',
    'broad_only_overlap_frame_count',
    'exact_contact_event_count'
  ] as const
  exactKeys(
    environmentCoverage,
    environmentCoverageKeys,
    '$.environment_collision.coverage'
  )
  environmentCoverageKeys.forEach((key) =>
    nonNegativeInteger(
      environmentCoverage[key],
      `$.environment_collision.coverage.${key}`
    )
  )
  const environmentSummary = record(
    environmentCollision.summary,
    '$.environment_collision.summary'
  )
  exactKeys(
    environmentSummary,
    ['result', 'minimum_aabb_clearance_m', 'first_contact'],
    '$.environment_collision.summary'
  )
  const environmentResult = oneOf(
    environmentSummary.result,
    ['proxy-contact-observed', 'no-proxy-contact-at-samples'],
    '$.environment_collision.summary.result'
  )
  nonNegativeNumber(
    environmentSummary.minimum_aabb_clearance_m,
    '$.environment_collision.summary.minimum_aabb_clearance_m'
  )
  const firstContact =
    environmentSummary.first_contact === null
      ? null
      : parseEnvironmentFirstContact(
          environmentSummary.first_contact,
          '$.environment_collision.summary.first_contact'
        )
  if ((environmentResult === 'proxy-contact-observed') !== (firstContact !== null)) {
    fail(
      '$.environment_collision.summary',
      'result 与 first_contact 是否存在必须一致'
    )
  }
  const collisionFrames = array(
    environmentCollision.frames,
    '$.environment_collision.frames'
  ).map((frame, index) =>
    parseEnvironmentCollisionFrame(
      frame,
      `$.environment_collision.frames[${index}]`
    )
  )
  const expectedPlaybackFrames = playbackSegments.flatMap((segment) =>
    segment.frames.map((frame) => ({
      segment_index: segment.segment_index,
      frame_index: frame.frame_index,
      time_s: frame.time_s
    }))
  )
  if (collisionFrames.length !== expectedPlaybackFrames.length) {
    fail('$.environment_collision.frames', '必须与全部 playback frames 一一对应')
  }
  collisionFrames.forEach((frame, index) => {
    const expected = expectedPlaybackFrames[index]
    if (
      frame.segment_index !== expected.segment_index ||
      frame.frame_index !== expected.frame_index ||
      !nearlyEqual(frame.time_s, expected.time_s)
    ) {
      fail(
        `$.environment_collision.frames[${index}]`,
        'segment/frame/time 必须与 playback frame 一致'
      )
    }
  })
  segments.forEach((segment, segmentIndex) => {
    const frames = collisionFrames.filter(
      (frame) => frame.segment_index === segmentIndex
    )
    const contacts = frames.filter(
      (frame) => frame.status === 'proxy-mesh-contact'
    )
    const broadOnly = frames.filter(
      (frame) => frame.status === 'broad-phase-overlap-unresolved'
    )
    const expectedStatus =
      contacts.length > 0
        ? 'proxy-mesh-contact'
        : broadOnly.length > 0
          ? 'broad-phase-overlap-unresolved'
          : 'separated-at-sampled-frames'
    if (
      frames.length !== playbackSegments[segmentIndex].frames.length ||
      segment.environment_collision_status !== expectedStatus ||
      segment.environment_contact_frame_count !== contacts.length ||
      segment.environment_broad_only_frame_count !== broadOnly.length ||
      !nearlyEqual(
        segment.environment_minimum_aabb_clearance_m,
        Math.min(...frames.map((frame) => frame.minimum_aabb_clearance_m))
      ) ||
      (segment.environment_first_contact_time_s === null) !==
        (contacts.length === 0) ||
      (contacts.length > 0 &&
        !nearlyEqual(
          segment.environment_first_contact_time_s!,
          contacts[0].time_s
        ))
    ) {
      fail(
        `$.segments[${segmentIndex}]`,
        '环境碰撞摘要与逐帧结果不一致'
      )
    }
  })
  if (firstContact) {
    const matched = collisionFrames.find(
      (frame) =>
        frame.segment_index === firstContact.segment_index &&
        frame.frame_index === firstContact.frame_index
    )
    if (
      !matched ||
      matched.status !== 'proxy-mesh-contact' ||
      !nearlyEqual(matched.time_s, firstContact.time_s)
    ) {
      fail(
        '$.environment_collision.summary.first_contact',
        '必须引用一个实际 proxy-mesh-contact frame'
      )
    }
  }
  const entities = array(root.environment_entities, '$.environment_entities').map(
    (entity, index) => {
      const path = `$.environment_entities[${index}]`
      const parsed = record(entity, path)
      exactKeys(
        parsed,
        [
          'entity_id',
          'role',
          'geometry_path',
          'geometry_sha256',
          'geometry_format',
          'geometry_unit',
          'collision_mode',
          'component_count',
          'component_world_aabbs',
          'world_aabb'
        ],
        path
      )
      const geometrySha256 = string(
        parsed.geometry_sha256,
        `${path}.geometry_sha256`
      )
      if (!/^[a-f0-9]{64}$/.test(geometrySha256)) {
        fail(`${path}.geometry_sha256`, '必须是 64 位小写 SHA-256')
      }
      return {
        entity_id: string(parsed.entity_id, `${path}.entity_id`),
        role: oneOf(
          parsed.role,
          ['static-environment', 'stored-tool'],
          `${path}.role`
        ),
        geometry_path: string(parsed.geometry_path, `${path}.geometry_path`),
        geometry_sha256: geometrySha256,
        geometry_format: oneOf(
          parsed.geometry_format,
          ['glb', 'stl'],
          `${path}.geometry_format`
        ),
        geometry_unit: oneOf(
          parsed.geometry_unit,
          ['m', 'mm'],
          `${path}.geometry_unit`
        ),
        collision_mode: string(parsed.collision_mode, `${path}.collision_mode`),
        component_count: nonNegativeInteger(
          parsed.component_count,
          `${path}.component_count`
        ),
        component_world_aabbs: array(
          parsed.component_world_aabbs,
          `${path}.component_world_aabbs`
        ).map((component, componentIndex) => aabb(
          component,
          `${path}.component_world_aabbs[${componentIndex}]`
        )),
        world_aabb: aabb(parsed.world_aabb, `${path}.world_aabb`)
      }
    }
  )
  if (new Set(entities.map((entity) => entity.entity_id)).size !== entities.length) {
    fail('$.environment_entities', 'entity_id 不得重复')
  }

  const partialWorldAabb = aabb(root.partial_world_aabb, '$.partial_world_aabb')
  validateCrossReferences(states, segments, partialWorldAabb, '$')
  stringArray(root.reason_codes, '$.reason_codes')
  stringArray(root.limitations, '$.limitations')

  const summary = record(root.summary, '$.summary')
  exactKeys(
    summary,
    [
      'state_count',
      'segment_count',
      'sampled_segment_count',
      'excluded_segment_count',
      'link_count',
      'environment_entity_count',
      'continuous_evaluated_segment_count',
      'self_collision_candidate_pair_count',
      'playable_segment_count',
      'playback_frame_count',
      'attachment_model_count',
      'environment_exact_contact_frame_count',
      'environment_broad_only_frame_count',
      'environment_exact_contact_event_count'
    ],
    '$.summary'
  )
  const sampled = segments.filter((segment) => segment.status === 'sampled-candidate')
  const excluded = segments.filter((segment) => segment.status === 'excluded-unresolved')
  assertCount(states.length, summary.state_count, '$.summary.state_count')
  assertCount(segments.length, summary.segment_count, '$.summary.segment_count')
  assertCount(sampled.length, summary.sampled_segment_count, '$.summary.sampled_segment_count')
  assertCount(excluded.length, summary.excluded_segment_count, '$.summary.excluded_segment_count')
  assertCount(states[0].links.length, summary.link_count, '$.summary.link_count')
  assertCount(entities.length, summary.environment_entity_count, '$.summary.environment_entity_count')
  const continuousEvaluated = segments.filter(
    (segment) => segment.continuous_status === 'continuous-broad-phase-candidate'
  )
  assertCount(
    continuousEvaluated.length,
    summary.continuous_evaluated_segment_count,
    '$.summary.continuous_evaluated_segment_count'
  )
  assertCount(
    continuousEvaluated.reduce(
      (total, segment) =>
        total + (segment.self_collision_candidate_pair_count ?? 0),
      0
    ),
    summary.self_collision_candidate_pair_count,
    '$.summary.self_collision_candidate_pair_count'
  )
  assertCount(
    playbackSegments.length,
    summary.playable_segment_count,
    '$.summary.playable_segment_count'
  )
  assertCount(
    playbackSegments.reduce((total, segment) => total + segment.frames.length, 0),
    summary.playback_frame_count,
    '$.summary.playback_frame_count'
  )
  assertCount(
    attachmentModels.length,
    summary.attachment_model_count,
    '$.summary.attachment_model_count'
  )
  const exactContactFrames = collisionFrames.filter(
    (frame) => frame.status === 'proxy-mesh-contact'
  )
  const broadOnlyFrames = collisionFrames.filter(
    (frame) => frame.status === 'broad-phase-overlap-unresolved'
  )
  const exactContactEvents = collisionFrames.reduce(
    (total, frame) => total + frame.exact_contacts.length,
    0
  )
  assertCount(
    exactContactFrames.length,
    summary.environment_exact_contact_frame_count,
    '$.summary.environment_exact_contact_frame_count'
  )
  assertCount(
    broadOnlyFrames.length,
    summary.environment_broad_only_frame_count,
    '$.summary.environment_broad_only_frame_count'
  )
  assertCount(
    exactContactEvents,
    summary.environment_exact_contact_event_count,
    '$.summary.environment_exact_contact_event_count'
  )
  assertCount(
    segments.length,
    environmentCoverage.segment_count,
    '$.environment_collision.coverage.segment_count'
  )
  assertCount(
    collisionFrames.length,
    environmentCoverage.evaluated_frame_count,
    '$.environment_collision.coverage.evaluated_frame_count'
  )
  assertCount(
    exactContactFrames.length,
    environmentCoverage.exact_contact_frame_count,
    '$.environment_collision.coverage.exact_contact_frame_count'
  )
  assertCount(
    broadOnlyFrames.length,
    environmentCoverage.broad_only_overlap_frame_count,
    '$.environment_collision.coverage.broad_only_overlap_frame_count'
  )
  assertCount(
    exactContactEvents,
    environmentCoverage.exact_contact_event_count,
    '$.environment_collision.coverage.exact_contact_event_count'
  )

  const coverage = record(root.coverage, '$.coverage')
  exactKeys(
    coverage,
    [
      'total_motion_segments',
      'sampled_move_j_segments',
      'excluded_move_j_cp_segments',
      'excluded_move_l_segments'
    ],
    '$.coverage'
  )
  assertCount(segments.length, coverage.total_motion_segments, '$.coverage.total_motion_segments')
  assertCount(
    sampled.filter((segment) => segment.motion === 'move_j').length,
    coverage.sampled_move_j_segments,
    '$.coverage.sampled_move_j_segments'
  )
  assertCount(
    excluded.filter((segment) => segment.motion === 'move_j' && segment.cp > 0).length,
    coverage.excluded_move_j_cp_segments,
    '$.coverage.excluded_move_j_cp_segments'
  )
  assertCount(
    excluded.filter((segment) => segment.motion === 'move_l').length,
    coverage.excluded_move_l_segments,
    '$.coverage.excluded_move_l_segments'
  )

  const continuousAnalysis = record(
    root.continuous_analysis,
    '$.continuous_analysis'
  )
  exactKeys(
    continuousAnalysis,
    [
      'continuous_link_bound_status',
      'self_collision_status',
      'environment_collision_status',
      'overall_result'
    ],
    '$.continuous_analysis'
  )
  literal(
    continuousAnalysis.continuous_link_bound_status,
    'computed-conservative-partial',
    '$.continuous_analysis.continuous_link_bound_status'
  )
  oneOf(
    continuousAnalysis.self_collision_status,
    ['candidate-overlap', 'broad-phase-separated'],
    '$.continuous_analysis.self_collision_status'
  )
  literal(
    continuousAnalysis.environment_collision_status,
    'not-evaluated-frame-unregistered',
    '$.continuous_analysis.environment_collision_status'
  )
  literal(
    continuousAnalysis.overall_result,
    'unknown',
    '$.continuous_analysis.overall_result'
  )

  const validation = record(root.validation, '$.validation')
  exactKeys(
    validation,
    [
      'method',
      'evaluated_state_count',
      'within_threshold_count',
      'position_residual_threshold_mm',
      'max_residual_excluding_observed_outliers_mm',
      'observed_outliers'
    ],
    '$.validation'
  )
  string(validation.method, '$.validation.method')
  assertCount(states.length, validation.evaluated_state_count, '$.validation.evaluated_state_count')
  const withinThreshold = nonNegativeInteger(
    validation.within_threshold_count,
    '$.validation.within_threshold_count'
  )
  if (withinThreshold > states.length) {
    fail('$.validation.within_threshold_count', '不得超过 evaluated_state_count')
  }
  nonNegativeNumber(
    validation.position_residual_threshold_mm,
    '$.validation.position_residual_threshold_mm'
  )
  nonNegativeNumber(
    validation.max_residual_excluding_observed_outliers_mm,
    '$.validation.max_residual_excluding_observed_outliers_mm'
  )
  stringArray(validation.observed_outliers, '$.validation.observed_outliers')

  return decoded as SpatialShadowSnapshot
}
