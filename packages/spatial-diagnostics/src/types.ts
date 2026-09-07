export type Vector3 = readonly [number, number, number]
export type Matrix4 = readonly [
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number],
  readonly [number, number, number, number]
]

export interface SpatialAabb {
  min_m: Vector3
  max_m: Vector3
}

export interface SpatialArtifactReference {
  file: string
  digest: string
}

export type SpatialEnvironmentCollisionFrameStatus =
  | 'separated-at-sampled-frame'
  | 'broad-phase-overlap-unresolved'
  | 'proxy-mesh-contact'

export interface SpatialEnvironmentContact {
  moving_object_id: string
  moving_kind: 'robot-link' | 'tool' | 'payload'
  environment_entity_id: string
  environment_component_id: string
  position_m: Vector3
  method:
    | 'triangle-vs-generated-box-sat'
    | 'triangle-vs-compound-convex-clipping'
}

export interface SpatialEnvironmentCollisionFrame {
  segment_index: number
  frame_index: number
  time_s: number
  status: SpatialEnvironmentCollisionFrameStatus
  minimum_aabb_clearance_m: number
  closest_pair: {
    moving_object_id: string
    environment_component_id: string
  }
  broad_overlap_pair_count: number
  unresolved_shaped_overlap_pair_count: number
  exact_contacts: readonly SpatialEnvironmentContact[]
}

export interface SpatialShadowStateLink {
  link_id: string
  world_aabb: SpatialAabb
}

export interface SpatialPlaybackLink extends SpatialShadowStateLink {
  matrix_link_to_world: Matrix4
}

export interface SpatialShadowAttachment {
  attachment_id: string
  kind: 'tool' | 'payload'
  matrix_attachment_to_world: Matrix4
  world_aabb: SpatialAabb
}

export interface SpatialPlaybackFrame {
  frame_index: number
  time_s: number
  segment_time_s: number
  progress: number
  joint_positions_rad: readonly [number, number, number, number, number, number]
  links: readonly SpatialPlaybackLink[]
  attachments: readonly SpatialShadowAttachment[]
}

export type SpatialPlaybackInterpolation =
  | 'compiled-move-l-joint-trajectory'
  | 'nominal-move-j'
  | 'nominal-unblended-move-j'

export interface SpatialPlaybackSegment {
  segment_index: number
  duration_s: number
  start_time_s: number
  end_time_s: number
  interpolation: SpatialPlaybackInterpolation
  controller_fidelity:
    | 'diagnostic-compiled-move-l'
    | 'nominal-controller-unverified'
  reason_codes: readonly string[]
  frames: readonly SpatialPlaybackFrame[]
}

export interface SpatialAttachmentModel {
  attachment_id: string
  kind: 'tool' | 'payload'
  geometry_source: string
  dimensions_m: Vector3
  placement_source: string
}

export type SpatialShadowPhase = 'precondition' | 'approach' | 'transfer'
export type SpatialPayloadState = 'empty' | 'plate-attached'

export interface SpatialShadowState {
  state_id: string
  step_index: number | null
  point_ref: string
  phase: SpatialShadowPhase
  payload_state: SpatialPayloadState
  tcp_residual_mm: number
  links: readonly SpatialShadowStateLink[]
}

export type SpatialMotion = 'move_j' | 'move_l'
export type SpatialSegmentStatus =
  | 'sampled-candidate'
  | 'excluded-unresolved'
export type SpatialContinuousSegmentStatus =
  | 'continuous-broad-phase-candidate'
  | 'excluded-unresolved'

export interface SpatialShadowSegment {
  segment_index: number
  source_state_id: string
  target_state_id: string
  target_step_index: number
  motion: SpatialMotion
  cp: number
  phase: Exclude<SpatialShadowPhase, 'precondition'>
  payload_state: SpatialPayloadState
  status: SpatialSegmentStatus
  sample_count: number | null
  world_aabb: SpatialAabb | null
  continuous_status: SpatialContinuousSegmentStatus
  continuous_interval_count: number | null
  continuous_world_aabb: SpatialAabb | null
  self_collision_candidate_pair_count: number | null
  self_collision_separated_pair_count: number | null
  reason_codes: readonly string[]
  continuous_reason_codes: readonly string[]
  playback_duration_s: number
  playback_frame_count: number
  playback_interpolation: SpatialPlaybackInterpolation
  playback_controller_fidelity:
    | 'diagnostic-compiled-move-l'
    | 'nominal-controller-unverified'
  environment_collision_status:
    | 'separated-at-sampled-frames'
    | 'broad-phase-overlap-unresolved'
    | 'proxy-mesh-contact'
  environment_minimum_aabb_clearance_m: number
  environment_contact_frame_count: number
  environment_broad_only_frame_count: number
  environment_first_contact_time_s: number | null
}

export interface SpatialEnvironmentEntity {
  entity_id: string
  role: 'static-environment' | 'stored-tool'
  geometry_path: string
  geometry_sha256: string
  geometry_format: 'glb' | 'stl'
  geometry_unit: 'm' | 'mm'
  collision_mode: string
  component_count: number
  component_world_aabbs: readonly SpatialAabb[]
  world_aabb: SpatialAabb
}

export interface SpatialShadowSnapshot {
  schema: 'unilab.spatial-shadow-workbench/v0'
  sample_id: string
  snapshot_digest: string
  source: {
    kind: 'eit-compiler-artifact-export'
    workspace_relative_path: string
    artifacts: {
      certificate: SpatialArtifactReference
      collision_scene: SpatialArtifactReference
      environment_collision: SpatialArtifactReference
      decision: SpatialArtifactReference
      continuous_collision: SpatialArtifactReference
      link_states: SpatialArtifactReference
      motion_corridor: SpatialArtifactReference
      playback: SpatialArtifactReference
    }
  }
  action_contract_id: string
  mode: 'shadow'
  decision: 'unknown'
  effect: 'none'
  not_workcell_activation: true
  qualification: 'candidate-partial'
  world_frame: {
    frame_id: string
    handedness: 'right-handed'
    units: 'm'
    up_axis: '+Z'
  }
  registration: {
    status: 'candidate-relative-layout'
    source_frame_id: string
    target_frame_id: string
    method: 'rail-lnz-fit-plus-rail-top-contact'
    matrix_source_to_target: Matrix4
    rail_fit_xy_rms_mm: number
    rail_fit_xy_max_mm: number
    world_rigid_transform_qualified: false
  }
  coverage: {
    total_motion_segments: number
    sampled_move_j_segments: number
    excluded_move_j_cp_segments: number
    excluded_move_l_segments: number
  }
  summary: {
    state_count: number
    segment_count: number
    sampled_segment_count: number
    excluded_segment_count: number
    link_count: number
    environment_entity_count: number
    continuous_evaluated_segment_count: number
    self_collision_candidate_pair_count: number
    playable_segment_count: number
    playback_frame_count: number
    attachment_model_count: number
    environment_exact_contact_frame_count: number
    environment_broad_only_frame_count: number
    environment_exact_contact_event_count: number
  }
  continuous_analysis: {
    continuous_link_bound_status: 'computed-conservative-partial'
    self_collision_status: 'candidate-overlap' | 'broad-phase-separated'
    environment_collision_status: 'not-evaluated-frame-unregistered'
    overall_result: 'unknown'
  }
  validation: {
    method: string
    evaluated_state_count: number
    within_threshold_count: number
    position_residual_threshold_mm: number
    max_residual_excluding_observed_outliers_mm: number
    observed_outliers: readonly string[]
  }
  partial_world_aabb: SpatialAabb
  reason_codes: readonly string[]
  limitations: readonly string[]
  environment_entities: readonly SpatialEnvironmentEntity[]
  states: readonly SpatialShadowState[]
  segments: readonly SpatialShadowSegment[]
  playback: {
    duration_s: number
    nominal_frame_rate_hz: number
    kinematics: {
      model_id: 'dobot-cr5'
      joint_ids: readonly [string, string, string, string, string, string]
      position_unit: 'rad'
      source: 'controller-to-model-calibration'
    }
    attachment_models: readonly SpatialAttachmentModel[]
    segments: readonly SpatialPlaybackSegment[]
  }
  environment_collision: {
    qualification: 'candidate-proxy-sampled'
    coverage: {
      segment_count: number
      evaluated_frame_count: number
      environment_component_count: number
      exact_box_component_count: number
      compound_convex_component_count: number
      broad_only_component_count: number
      exact_contact_frame_count: number
      broad_only_overlap_frame_count: number
      exact_contact_event_count: number
    }
    summary: {
      result: 'proxy-contact-observed' | 'no-proxy-contact-at-samples'
      minimum_aabb_clearance_m: number
      first_contact: (SpatialEnvironmentContact & {
        segment_index: number
        frame_index: number
        time_s: number
      }) | null
    }
    frames: readonly SpatialEnvironmentCollisionFrame[]
  }
}

export interface SpatialDiagnosticsStatus {
  phase: 'loading' | 'ready' | 'error' | 'unavailable'
  message: string
}

export interface SpatialShadowDiagnosticsProps {
  snapshot: SpatialShadowSnapshot | null
  status: SpatialDiagnosticsStatus
  onReload?: () => void
}
