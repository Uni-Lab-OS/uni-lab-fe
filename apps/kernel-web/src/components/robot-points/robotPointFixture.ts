export type PointKind = 'taught' | 'offset' | 'affine_grid'
export type PointRole = 'safe' | 'approach' | 'interact' | 'retreat' | 'park'
export type ValidationState = 'approved' | 'robot_validated' | 'simulation_validated' | 'draft'
export type PointSetVersion = 'ptlc-main@v12' | 'ptlc-main@v13-draft'

export interface RobotPoint {
  id: string
  name: string
  role: PointRole
  kind: PointKind
  state: ValidationState
  group: string
  position: readonly [number, number, number]
  rotation: readonly [number, number, number]
  joints?: readonly [number, number, number, number, number, number]
  motion: readonly ('move_j' | 'move_l')[]
  maxSpeed: number
  acceleration: number
  positionTolerance: number
  rotationTolerance: number
  source: string
  validatedAt: string
}

export interface PointBinding {
  id: string
  siteUuid: string
  siteLabel: string
  owner: string
  operation: 'pick' | 'place'
  materialTypes: readonly string[]
  approach: string
  interact: string
  retreat: string
  program: string
  tool: string
  payload: string
  observation: string
  status: 'validated' | 'draft'
}

export const POINTS: readonly RobotPoint[] = [
  {
    id: 'cell.safe.park',
    name: '全局停放点',
    role: 'park',
    kind: 'taught',
    state: 'approved',
    group: '安全与停放',
    position: [250, -300, 450],
    rotation: [180, 0, 90],
    joints: [0, -28.4, -94.6, 0, 92.8, 0],
    motion: ['move_j'],
    maxSpeed: 18,
    acceleration: 20,
    positionTolerance: 3,
    rotationTolerance: 3,
    source: '真机示教 · 控制器点名 P_PARK',
    validatedAt: '2026-08-08 16:42'
  },
  {
    id: 'cell.safe.transfer-a',
    name: '跨区安全过渡 A',
    role: 'safe',
    kind: 'taught',
    state: 'robot_validated',
    group: '安全与停放',
    position: [420, -80, 520],
    rotation: [180, 0, 90],
    joints: [2.1, -31.2, -88.6, 0.3, 91.4, -1.2],
    motion: ['move_j'],
    maxSpeed: 12,
    acceleration: 18,
    positionTolerance: 4,
    rotationTolerance: 4,
    source: '真机示教 · 控制器点名 P_SAFE_A',
    validatedAt: '2026-08-09 10:14'
  },
  {
    id: 's04.p01.pick.approach',
    name: 'P01 取板接近点',
    role: 'approach',
    kind: 'offset',
    state: 'robot_validated',
    group: 'S4 移液工作站 / P01',
    position: [1280, 640, 1030],
    rotation: [180, 0, 90],
    motion: ['move_l'],
    maxSpeed: 8,
    acceleration: 10,
    positionTolerance: 2,
    rotationTolerance: 2,
    source: '由交互点沿 base +Z 120 mm 生成',
    validatedAt: '2026-08-09 15:28'
  },
  {
    id: 's04.p01.pick.interact',
    name: 'P01 取板交互点',
    role: 'interact',
    kind: 'taught',
    state: 'robot_validated',
    group: 'S4 移液工作站 / P01',
    position: [1280, 640, 910],
    rotation: [180, 0, 90],
    joints: [8.3, -44.1, -76.8, 0.1, 92.4, 8.2],
    motion: ['move_l'],
    maxSpeed: 5,
    acceleration: 8,
    positionTolerance: 1.5,
    rotationTolerance: 1,
    source: '真机示教 · 控制器点名 P_S04_P01_PICK',
    validatedAt: '2026-08-09 15:32'
  },
  {
    id: 's04.p01.pick.retreat',
    name: 'P01 取板退出点',
    role: 'retreat',
    kind: 'offset',
    state: 'simulation_validated',
    group: 'S4 移液工作站 / P01',
    position: [1280, 640, 1045],
    rotation: [180, 0, 90],
    motion: ['move_l'],
    maxSpeed: 7,
    acceleration: 10,
    positionTolerance: 2,
    rotationTolerance: 2,
    source: '由交互点沿 base +Z 135 mm 生成',
    validatedAt: '2026-08-09 14:50'
  },
  {
    id: 's04.p02.place.interact',
    name: 'P02 放板交互点',
    role: 'interact',
    kind: 'affine_grid',
    state: 'draft',
    group: 'S4 移液工作站 / P02',
    position: [1460.4, 639.8, 910],
    rotation: [180, 0, 90.1],
    motion: ['move_l'],
    maxSpeed: 5,
    acceleration: 8,
    positionTolerance: 1.5,
    rotationTolerance: 1,
    source: 'S4 双工位阵列 · r1c2 修正 +0.4 / -0.2 mm',
    validatedAt: '尚未验证'
  }
]

export const BINDINGS: readonly PointBinding[] = [
  {
    id: 'binding-s04-p01-pick-v4',
    siteUuid: 'site-s04-p01-5db3',
    siteLabel: 'P01',
    owner: 'S4 移液工作站',
    operation: 'pick',
    materialTypes: ['SBS PCR Plate', 'Deep-well Plate'],
    approach: 's04.p01.pick.approach',
    interact: 's04.p01.pick.interact',
    retreat: 's04.p01.pick.retreat',
    program: 'plate-pick@v4',
    tool: 'plate-gripper-tcp@v2',
    payload: 'pcr-plate-loaded@v1',
    observation: 'plate_gripped && site_presence_expected',
    status: 'validated'
  },
  {
    id: 'binding-s04-p02-place-v1',
    siteUuid: 'site-s04-p02-818a',
    siteLabel: 'P02',
    owner: 'S4 移液工作站',
    operation: 'place',
    materialTypes: ['SBS PCR Plate'],
    approach: 's04.p02.place.approach',
    interact: 's04.p02.place.interact',
    retreat: 's04.p02.place.retreat',
    program: 'plate-place@v1',
    tool: 'plate-gripper-tcp@v2',
    payload: 'pcr-plate-loaded@v1',
    observation: 'gripper_open && site_presence_expected',
    status: 'draft'
  }
]

export const ROLE_LABELS: Record<PointRole, string> = {
  safe: '安全点',
  approach: '接近点',
  interact: '交互点',
  retreat: '退出点',
  park: '停放点'
}

export const STATE_LABELS: Record<ValidationState, string> = {
  approved: '已批准',
  robot_validated: '真机已验证',
  simulation_validated: '仿真已验证',
  draft: '草稿'
}
