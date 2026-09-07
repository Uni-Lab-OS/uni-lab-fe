import { readCanonicalJson, sha256Hex } from './digest'
import type { SpatialAabb, SpatialShadowSnapshot } from './types'

function box(min = 0, max = 2): SpatialAabb {
  return { min_m: [min, min, min], max_m: [max, max, max] }
}

const identity = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1]
] as const

export function createSpatialShadowFixtureText(): string {
  const sampledIndexes = new Set([0, 1, 11, 12])
  const moveLIndexes = new Set([3, 4, 5, 6, 7, 8, 9])
  const states = Array.from({ length: 15 }, (_, stateIndex) => ({
    state_id: `state:${stateIndex}`,
    step_index: stateIndex === 0 ? null : stateIndex,
    point_ref: stateIndex === 0 ? 'P1' : `P${stateIndex}`,
    phase:
      stateIndex === 0
        ? ('precondition' as const)
        : stateIndex < 8
          ? ('approach' as const)
          : ('transfer' as const),
    payload_state: stateIndex < 8 ? ('empty' as const) : ('plate-attached' as const),
    tcp_residual_mm: 0.25,
    links: Array.from({ length: 7 }, (_, linkIndex) => ({
      link_id: linkIndex === 0 ? 'base_link' : `Link${linkIndex}`,
      world_aabb: box(linkIndex / 10, linkIndex / 10 + 0.2)
    }))
  }))
  const segments = Array.from({ length: 14 }, (_, segmentIndex) => {
    const sampled = sampledIndexes.has(segmentIndex)
    const motion = moveLIndexes.has(segmentIndex) ? ('move_l' as const) : ('move_j' as const)
    return {
      segment_index: segmentIndex,
      source_state_id: `state:${segmentIndex}`,
      target_state_id: `state:${segmentIndex + 1}`,
      target_step_index: segmentIndex + 1,
      motion,
      cp: sampled || motion === 'move_l' ? 0.0 : 2.0,
      phase: segmentIndex < 7 ? ('approach' as const) : ('transfer' as const),
      payload_state: segmentIndex < 7 ? ('empty' as const) : ('plate-attached' as const),
      status: sampled ? ('sampled-candidate' as const) : ('excluded-unresolved' as const),
      sample_count: sampled ? 8 : null,
      world_aabb: sampled ? box() : null,
      continuous_status: sampled
        ? ('continuous-broad-phase-candidate' as const)
        : ('excluded-unresolved' as const),
      continuous_interval_count: sampled ? 7 : null,
      continuous_world_aabb: sampled ? box(-0.1, 2.1) : null,
      self_collision_candidate_pair_count: sampled ? 2 : null,
      self_collision_separated_pair_count: sampled ? 13 : null,
      reason_codes: [sampled ? 'discrete-aabb-union-candidate-only' : 'interpolation-unresolved'],
      continuous_reason_codes: [
        sampled
          ? 'linear-joint-interpolation-conservative-bound'
          : 'interpolation-unresolved'
      ],
      playback_duration_s: 1,
      playback_frame_count: 2,
      playback_interpolation:
        motion === 'move_l'
          ? ('compiled-move-l-joint-trajectory' as const)
          : segmentIndex === 2 || segmentIndex === 10 || segmentIndex === 13
            ? ('nominal-unblended-move-j' as const)
            : ('nominal-move-j' as const),
      playback_controller_fidelity:
        motion === 'move_l'
          ? ('diagnostic-compiled-move-l' as const)
          : ('nominal-controller-unverified' as const),
      environment_collision_status:
        segmentIndex === 2
          ? ('proxy-mesh-contact' as const)
          : ('separated-at-sampled-frames' as const),
      environment_minimum_aabb_clearance_m: segmentIndex === 2 ? 0 : 0.1,
      environment_contact_frame_count: segmentIndex === 2 ? 1 : 0,
      environment_broad_only_frame_count: 0,
      environment_first_contact_time_s: segmentIndex === 2 ? 3 : null
    }
  })
  const playbackSegments = segments.map((segment) => ({
    segment_index: segment.segment_index,
    duration_s: 1,
    start_time_s: segment.segment_index,
    end_time_s: segment.segment_index + 1,
    interpolation: segment.playback_interpolation,
    controller_fidelity: segment.playback_controller_fidelity,
    reason_codes: ['diagnostic-playback-not-controller-execution'],
    frames: [0, 1].map((frameIndex) => ({
      frame_index: frameIndex,
      time_s: segment.segment_index + frameIndex,
      segment_time_s: frameIndex,
      progress: frameIndex,
      joint_positions_rad: [0, 0.1, 0.2, 0.3, 0.4, frameIndex * 0.1] as const,
      links: states[segment.segment_index + frameIndex].links.map(link => ({
        ...link,
        matrix_link_to_world: identity
      })),
      attachments: [
        {
          attachment_id: 'tool:TOOL_SUCTION',
          kind: 'tool' as const,
          matrix_attachment_to_world: identity,
          world_aabb: box(0.7, 0.9)
        },
        ...(segment.segment_index >= 7
          ? [
              {
                attachment_id: 'payload:plate',
                kind: 'payload' as const,
                matrix_attachment_to_world: identity,
                world_aabb: box(0.8, 0.95)
              }
            ]
          : [])
      ]
    }))
  }))
  const firstContact = {
    segment_index: 2,
    frame_index: 1,
    time_s: 3,
    moving_object_id: 'tool:TOOL_SUCTION',
    moving_kind: 'tool' as const,
    environment_entity_id: 'environment:test',
    environment_component_id: 'environment:test:component:0',
    position_m: [0.8, 0.8, 0.8] as const,
    method: 'triangle-vs-generated-box-sat' as const
  }
  const collisionFrames = playbackSegments.flatMap((segment) =>
    segment.frames.map((frame) => {
      const isContact = segment.segment_index === 2 && frame.frame_index === 1
      return {
        segment_index: segment.segment_index,
        frame_index: frame.frame_index,
        time_s: frame.time_s,
        status: isContact
          ? ('proxy-mesh-contact' as const)
          : ('separated-at-sampled-frame' as const),
        minimum_aabb_clearance_m: isContact ? 0 : 0.1,
        closest_pair: {
          moving_object_id: 'tool:TOOL_SUCTION',
          environment_component_id: 'environment:test:component:0'
        },
        broad_overlap_pair_count: isContact ? 1 : 0,
        unresolved_shaped_overlap_pair_count: 0,
        exact_contacts: isContact
          ? [
              {
                moving_object_id: firstContact.moving_object_id,
                moving_kind: firstContact.moving_kind,
                environment_entity_id: firstContact.environment_entity_id,
                environment_component_id: firstContact.environment_component_id,
                position_m: firstContact.position_m,
                method: firstContact.method
              }
            ]
          : []
      }
    })
  )
  const payload: Omit<SpatialShadowSnapshot, 'snapshot_digest'> = {
    schema: 'unilab.spatial-shadow-workbench/v0',
    sample_id: 'eit-test-fixture',
    source: {
      kind: 'eit-compiler-artifact-export',
      workspace_relative_path: '.unilab/spatial-shadow/current.v0.json',
      artifacts: {
        certificate: { file: 'certificate.json', digest: '1'.repeat(64) },
        collision_scene: { file: 'scene.json', digest: '2'.repeat(64) },
        continuous_collision: { file: 'continuous.json', digest: '6'.repeat(64) },
        decision: { file: 'decision.json', digest: '3'.repeat(64) },
        environment_collision: { file: 'environment-collision.json', digest: '8'.repeat(64) },
        link_states: { file: 'states.json', digest: '4'.repeat(64) },
        motion_corridor: { file: 'corridor.json', digest: '5'.repeat(64) },
        playback: { file: 'playback.json', digest: '7'.repeat(64) }
      }
    },
    action_contract_id: 'robot.tank.pick',
    mode: 'shadow',
    decision: 'unknown',
    effect: 'none',
    not_workcell_activation: true,
    qualification: 'candidate-partial',
    world_frame: {
      frame_id: 'test.z-up',
      handedness: 'right-handed',
      units: 'm',
      up_axis: '+Z'
    },
    registration: {
      status: 'candidate-relative-layout',
      source_frame_id: 'test.source-z-up',
      target_frame_id: 'test.z-up',
      method: 'rail-lnz-fit-plus-rail-top-contact',
      matrix_source_to_target: [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1]
      ],
      rail_fit_xy_rms_mm: 1.5,
      rail_fit_xy_max_mm: 2.3,
      world_rigid_transform_qualified: false
    },
    coverage: {
      total_motion_segments: 14,
      sampled_move_j_segments: 4,
      excluded_move_j_cp_segments: 3,
      excluded_move_l_segments: 7
    },
    summary: {
      state_count: 15,
      segment_count: 14,
      sampled_segment_count: 4,
      excluded_segment_count: 10,
      link_count: 7,
      environment_entity_count: 1,
      continuous_evaluated_segment_count: 4,
      self_collision_candidate_pair_count: 8,
      playable_segment_count: 14,
      playback_frame_count: 28,
      attachment_model_count: 2,
      environment_exact_contact_frame_count: 1,
      environment_broad_only_frame_count: 0,
      environment_exact_contact_event_count: 1
    },
    continuous_analysis: {
      continuous_link_bound_status: 'computed-conservative-partial',
      self_collision_status: 'candidate-overlap',
      environment_collision_status: 'not-evaluated-frame-unregistered',
      overall_result: 'unknown'
    },
    validation: {
      method: 'test-fk-vs-tcp',
      evaluated_state_count: 15,
      within_threshold_count: 15,
      position_residual_threshold_mm: 1.0,
      max_residual_excluding_observed_outliers_mm: 0.25,
      observed_outliers: []
    },
    partial_world_aabb: box(),
    reason_codes: ['continuous-collision-not-computed'],
    limitations: ['environment-frame-registration-unqualified', 'stop-model-missing'],
    environment_entities: [
      {
        entity_id: 'environment:test',
        role: 'static-environment',
        geometry_path: 'artifacts/test/runtime.stl',
        geometry_sha256: 'a'.repeat(64),
        geometry_format: 'stl',
        geometry_unit: 'm',
        collision_mode: 'compound-convex',
        component_count: 1,
        component_world_aabbs: [box(-1, 3)],
        world_aabb: box(-1, 3)
      }
    ],
    states,
    segments,
    playback: {
      duration_s: 14,
      nominal_frame_rate_hz: 10,
      kinematics: {
        model_id: 'dobot-cr5',
        joint_ids: ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'],
        position_unit: 'rad',
        source: 'controller-to-model-calibration'
      },
      attachment_models: [
        {
          attachment_id: 'tool:TOOL_SUCTION',
          kind: 'tool',
          geometry_source: 'proxy:tool_suction',
          dimensions_m: [0.15, 0.12, 0.16],
          placement_source: 'test-tool-mount'
        },
        {
          attachment_id: 'payload:plate',
          kind: 'payload',
          geometry_source: 'device-manifest:deepwell_24_10ml',
          dimensions_m: [0.1275, 0.0855, 0.044],
          placement_source: 'test-tool-tcp'
        }
      ],
      segments: playbackSegments
    },
    environment_collision: {
      qualification: 'candidate-proxy-sampled',
      coverage: {
        segment_count: 14,
        evaluated_frame_count: 28,
        environment_component_count: 1,
        exact_box_component_count: 0,
        compound_convex_component_count: 1,
        broad_only_component_count: 0,
        exact_contact_frame_count: 1,
        broad_only_overlap_frame_count: 0,
        exact_contact_event_count: 1
      },
      summary: {
        result: 'proxy-contact-observed',
        minimum_aabb_clearance_m: 0,
        first_contact: firstContact
      },
      frames: collisionFrames
    }
  }
  const withoutDigest = JSON.stringify(payload)
  const canonical = readCanonicalJson(withoutDigest).canonical
  const digest = sha256Hex(`${canonical}\n`)
  return JSON.stringify({ ...payload, snapshot_digest: digest })
}
