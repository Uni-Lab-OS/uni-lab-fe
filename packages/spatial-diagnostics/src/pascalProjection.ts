import type {
  Matrix4,
  SpatialAabb,
  SpatialShadowSnapshot,
  Vector3
} from './types'

export type SpatialPascalBoxRole =
  | 'environment'
  | 'corridor'
  | 'robot-link'
  | 'tool'
  | 'payload'

export type SpatialPascalContactRole = 'first-contact' | 'current-contact'

export interface SpatialPascalBox {
  id: string
  label: string
  role: SpatialPascalBoxRole
  /** Row-major local-box-to-Pascal rigid transform. */
  matrix: readonly number[]
  size: Vector3
}

export interface SpatialPascalContact {
  id: string
  role: SpatialPascalContactRole
  label: string
  position: Vector3
}

export interface SpatialPascalCapsule {
  id: string
  label: string
  role: 'robot-link' | 'tool' | 'payload'
  start: Vector3
  end: Vector3
  radius: number
}

export interface SpatialShadowPascalOverlay {
  sampleId: string
  registrationStatus: 'candidate-relative-layout'
  registrationQualified: false
  decision: 'unknown'
  effect: 'none'
  currentTimeS: number
  durationS: number
  segmentIndex: number
  frameIndex: number
  collisionStatus:
    | 'separated-at-sampled-frame'
    | 'broad-phase-overlap-unresolved'
    | 'proxy-mesh-contact'
  minimumClearanceM: number
  firstContactTimeS: number | null
  firstContactTargetPositionM: Vector3 | null
  boxes: readonly SpatialPascalBox[]
  l1Capsules: readonly SpatialPascalCapsule[]
  trajectory: readonly Vector3[]
  contacts: readonly SpatialPascalContact[]
}

type MutableMatrix4 = [
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number]
]

const SOURCE_Z_UP_TO_PASCAL: MutableMatrix4 = [
  [1, 0, 0, 0],
  [0, 0, 1, 0],
  [0, -1, 0, 0],
  [0, 0, 0, 1]
]

function multiply(left: Matrix4, right: Matrix4): MutableMatrix4 {
  const result = Array.from({ length: 4 }, () => [0, 0, 0, 0]) as MutableMatrix4
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      result[row][column] = [0, 1, 2, 3].reduce(
        (sum, index) => sum + left[row][index] * right[index][column],
        0
      )
    }
  }
  return result
}

/** 候选配准是刚体矩阵；用 R^T 和 -R^Tt 精确求逆并拒绝缩放猜测。 */
export function invertSpatialRigidTransform(matrix: Matrix4): MutableMatrix4 {
  const inverse: MutableMatrix4 = [
    [matrix[0][0], matrix[1][0], matrix[2][0], 0],
    [matrix[0][1], matrix[1][1], matrix[2][1], 0],
    [matrix[0][2], matrix[1][2], matrix[2][2], 0],
    [0, 0, 0, 1]
  ]
  for (let row = 0; row < 3; row += 1) {
    inverse[row][3] = -(
      inverse[row][0] * matrix[0][3] +
      inverse[row][1] * matrix[1][3] +
      inverse[row][2] * matrix[2][3]
    )
  }
  return inverse
}

/** 从快照 target frame 逆配准到正式 GLB source frame，再转 Pascal Y-up。 */
export function spatialTargetToPascalMatrix(
  matrixSourceToTarget: Matrix4
): MutableMatrix4 {
  return multiply(
    SOURCE_Z_UP_TO_PASCAL,
    invertSpatialRigidTransform(matrixSourceToTarget)
  )
}

export function transformSpatialPoint(
  matrix: Matrix4,
  point: Vector3
): Vector3 {
  return [
    matrix[0][0] * point[0] + matrix[0][1] * point[1] +
      matrix[0][2] * point[2] + matrix[0][3],
    matrix[1][0] * point[0] + matrix[1][1] * point[1] +
      matrix[1][2] * point[2] + matrix[1][3],
    matrix[2][0] * point[0] + matrix[2][1] * point[1] +
      matrix[2][2] * point[2] + matrix[2][3]
  ]
}

function boxCenter(box: SpatialAabb): Vector3 {
  return [
    (box.min_m[0] + box.max_m[0]) / 2,
    (box.min_m[1] + box.max_m[1]) / 2,
    (box.min_m[2] + box.max_m[2]) / 2
  ]
}

function boxSize(box: SpatialAabb): Vector3 {
  return [
    box.max_m[0] - box.min_m[0],
    box.max_m[1] - box.min_m[1],
    box.max_m[2] - box.min_m[2]
  ]
}

function boxBoundingSphereRadius(box: SpatialAabb): number {
  const size = boxSize(box)
  return Math.hypot(size[0], size[1], size[2]) / 2
}

function boxTransform(matrix: Matrix4, box: SpatialAabb): readonly number[] {
  const center = boxCenter(box)
  const translation: MutableMatrix4 = [
    [1, 0, 0, center[0]],
    [0, 1, 0, center[1]],
    [0, 0, 1, center[2]],
    [0, 0, 0, 1]
  ]
  return multiply(matrix, translation).flat()
}

function spatialBox(
  transform: Matrix4,
  id: string,
  label: string,
  role: SpatialPascalBoxRole,
  box: SpatialAabb
): SpatialPascalBox {
  return {
    id,
    label,
    role,
    matrix: boxTransform(transform, box),
    size: boxSize(box)
  }
}

function attachmentBox(
  transform: Matrix4,
  matrixAttachmentToWorld: Matrix4,
  id: string,
  label: string,
  role: 'tool' | 'payload',
  size: Vector3
): SpatialPascalBox {
  return {
    id,
    label,
    role,
    matrix: multiply(transform, matrixAttachmentToWorld).flat(),
    size
  }
}

function samePoint(left: Vector3, right: Vector3): boolean {
  return left.every((value, index) => Math.abs(value - right[index]) <= 1e-9)
}

/** 生成当前播放帧所需的同场景只读几何，不携带任何准入或控制效果。 */
export function projectSpatialShadowToPascal(
  snapshot: SpatialShadowSnapshot,
  requestedTimeS: number
): SpatialShadowPascalOverlay {
  const currentTimeS = Math.min(
    snapshot.playback.duration_s,
    Math.max(0, requestedTimeS)
  )
  const playbackSegment = [...snapshot.playback.segments]
    .reverse()
    .find(segment => currentTimeS >= segment.start_time_s - 1e-9) ??
    snapshot.playback.segments[0]
  const playbackFrame = playbackSegment.frames.reduce((nearest, frame) =>
    Math.abs(frame.time_s - currentTimeS) < Math.abs(nearest.time_s - currentTimeS)
      ? frame
      : nearest
  )
  const segment = snapshot.segments.find(
    candidate => candidate.segment_index === playbackSegment.segment_index
  )
  const collisionFrame = snapshot.environment_collision.frames.find(
    frame => frame.segment_index === playbackSegment.segment_index &&
      frame.frame_index === playbackFrame.frame_index
  )
  const transform = spatialTargetToPascalMatrix(
    snapshot.registration.matrix_source_to_target
  )
  const boxes: SpatialPascalBox[] = snapshot.environment_entities.flatMap(entity => {
    const components = entity.component_world_aabbs.length > 0
      ? entity.component_world_aabbs
      : [entity.world_aabb]
    return components.map((component, componentIndex) => spatialBox(
      transform,
      `environment:${entity.entity_id}:component:${componentIndex}`,
      `${entity.entity_id} · ${entity.collision_mode} ${componentIndex + 1}/${components.length}`,
      'environment',
      component
    ))
  })
  const corridor = segment?.continuous_world_aabb ?? segment?.world_aabb
  if (corridor) {
    boxes.push(spatialBox(
      transform,
      `corridor:${playbackSegment.segment_index}`,
      `Segment #${playbackSegment.segment_index + 1}`,
      'corridor',
      corridor
    ))
  }
  boxes.push(...playbackFrame.links.map(link => spatialBox(
    transform,
    `link:${link.link_id}`,
    link.link_id,
    'robot-link',
    link.world_aabb
  )))
  const attachmentModels = new Map(
    snapshot.playback.attachment_models.map(model => [model.attachment_id, model])
  )
  boxes.push(...playbackFrame.attachments.map(attachment => {
    const model = attachmentModels.get(attachment.attachment_id)
    return attachmentBox(
      transform,
      attachment.matrix_attachment_to_world,
      `attachment:${attachment.attachment_id}`,
      attachment.attachment_id,
      attachment.kind,
      model?.dimensions_m ?? boxSize(attachment.world_aabb)
    )
  }))

  const l1Capsules: SpatialPascalCapsule[] = []
  const appendSweptCapsules = (
    idPrefix: string,
    label: string,
    role: SpatialPascalCapsule['role'],
    samples: readonly { center: Vector3; radius: number }[]
  ) => {
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1]
      const current = samples[index]
      l1Capsules.push({
        id: `${idPrefix}:${playbackSegment.segment_index}:${index - 1}`,
        label,
        role,
        start: transformSpatialPoint(transform, previous.center),
        end: transformSpatialPoint(transform, current.center),
        radius: Math.max(previous.radius, current.radius)
      })
    }
  }
  const l1LinkId = playbackSegment.frames[0]?.links.some(
    link => link.link_id === 'Link6'
  ) ? 'Link6' : playbackSegment.frames[0]?.links.at(-1)?.link_id
  if (l1LinkId) {
    appendSweptCapsules(
      `l1:link:${l1LinkId}`,
      `${l1LinkId} L1 扫掠包络`,
      'robot-link',
      playbackSegment.frames.flatMap(frame => {
        const link = frame.links.find(candidate => candidate.link_id === l1LinkId)
        return link ? [{
          center: boxCenter(link.world_aabb),
          radius: boxBoundingSphereRadius(link.world_aabb)
        }] : []
      })
    )
  }
  const attachmentIds = new Set(
    playbackSegment.frames.flatMap(frame =>
      frame.attachments.map(attachment => attachment.attachment_id)
    )
  )
  for (const attachmentId of attachmentIds) {
    const samples = playbackSegment.frames.flatMap(frame => {
      const attachment = frame.attachments.find(
        candidate => candidate.attachment_id === attachmentId
      )
      return attachment ? [{
        center: boxCenter(attachment.world_aabb),
        radius: boxBoundingSphereRadius(attachment.world_aabb)
      }] : []
    })
    const role = playbackSegment.frames
      .flatMap(frame => frame.attachments)
      .find(attachment => attachment.attachment_id === attachmentId)?.kind
    if (role) {
      appendSweptCapsules(
        `l1:attachment:${attachmentId}`,
        `${attachmentId} L1 扫掠包络`,
        role,
        samples
      )
    }
  }

  const trajectory = snapshot.playback.segments
    .flatMap(candidate => candidate.frames)
    .map(frame => frame.links.find(link => link.link_id === 'Link6') ?? frame.links.at(-1))
    .filter((link): link is NonNullable<typeof link> => Boolean(link))
    .map(link => transformSpatialPoint(transform, boxCenter(link.world_aabb)))
    .filter((point, index, points) => index === 0 || !samePoint(point, points[index - 1]))

  const firstContact = snapshot.environment_collision.summary.first_contact
  const currentContact = collisionFrame?.exact_contacts[0] ?? null
  const contacts: SpatialPascalContact[] = []
  if (firstContact) {
    contacts.push({
      id: 'first-contact',
      role: 'first-contact',
      label: `首次代理接触 ${firstContact.time_s.toFixed(3)} s`,
      position: transformSpatialPoint(transform, firstContact.position_m)
    })
  }
  if (
    currentContact &&
    (!firstContact || !samePoint(currentContact.position_m, firstContact.position_m))
  ) {
    contacts.push({
      id: `current-contact:${playbackSegment.segment_index}:${playbackFrame.frame_index}`,
      role: 'current-contact',
      label: '当前帧代理接触',
      position: transformSpatialPoint(transform, currentContact.position_m)
    })
  }

  return {
    sampleId: snapshot.sample_id,
    registrationStatus: snapshot.registration.status,
    registrationQualified: snapshot.registration.world_rigid_transform_qualified,
    decision: snapshot.decision,
    effect: snapshot.effect,
    currentTimeS,
    durationS: snapshot.playback.duration_s,
    segmentIndex: playbackSegment.segment_index,
    frameIndex: playbackFrame.frame_index,
    collisionStatus: collisionFrame?.status ?? 'separated-at-sampled-frame',
    minimumClearanceM: collisionFrame?.minimum_aabb_clearance_m ?? 0,
    firstContactTimeS: firstContact?.time_s ?? null,
    firstContactTargetPositionM: firstContact?.position_m ?? null,
    boxes,
    l1Capsules,
    trajectory,
    contacts
  }
}
