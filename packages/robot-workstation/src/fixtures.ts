import type {
  BenchHistoryRecord,
  BenchMaterialProjection,
  BenchSiteProjection,
  PointConfigVersion,
  Pose6D,
  ReagentDefinition,
  ReagentLedgerRow,
  RobotActionStep,
  RobotPoint,
  SiteCatalogRecord,
  WorkstationSite,
} from './types'

/** 本地动作调试默认位姿，仅用于界面验收，不代表机器人遥测。 */
export const DEFAULT_POSE: Pose6D = {
  x: 612.4,
  y: -184.2,
  z: 218.5,
  rx: 179.9,
  ry: 1.2,
  rz: 89.6,
}

/** 本地动作步骤夹具；步骤状态不得替代可信设备回执。 */
export const ACTION_STEPS: readonly RobotActionStep[] = [
  actionStep('step-home', '移动至待机位', 'PTP', 'A01_HOME', 30, {
    x: 420,
    y: 0,
    z: 620,
    rx: 180,
    ry: 0,
    rz: 90,
  }),
  actionStep('step-approach', '移动至取料接近位', 'LIN', 'A01_APPROACH', 20, {
    ...DEFAULT_POSE,
    z: 348.6,
  }),
  actionStep('step-pick', '下降至取料位', 'LIN', 'A01_PICK', 15, DEFAULT_POSE),
  actionStep('step-grip', '夹爪闭合', 'IO', 'DO_Gripper_Close', null, DEFAULT_POSE),
  actionStep('step-lift', '抬升工件', 'LIN', 'A01_LIFT', 20, {
    ...DEFAULT_POSE,
    z: 420,
  }),
  actionStep('step-target', '移动至二号料盘接近位', 'PTP', 'A02_APPROACH', 30, {
    x: 540,
    y: -42,
    z: 360,
    rx: 180,
    ry: 0,
    rz: 90,
  }),
]

/** 可加入当前工站配置的库位（Site）主表只读夹具。 */
export const WORKSTATION_SITE_CATALOG: readonly SiteCatalogRecord[] = [
  {
    id: 'A01',
    label: '一号料盘',
    category: '原料库位',
    materialLabel: 'PN-2031',
  },
  {
    id: 'A02',
    label: '二号料盘',
    category: '原料库位',
    materialLabel: 'PN-2032',
  },
  { id: 'A03', label: '三号料盘', category: '缓存库位' },
  {
    id: 'A04',
    label: '四号料盘',
    category: '原料库位',
    materialLabel: 'PN-2034',
  },
  { id: 'B01', label: '机械臂缓存位', category: '缓存库位' },
  {
    id: 'F01',
    label: '装配治具',
    category: '工装库位',
    materialLabel: 'FIXTURE-A',
  },
]

/** 当前工站已纳入本地配置的库位（Site）与机械臂点位。 */
export const WORKSTATION_SITES: readonly WorkstationSite[] = [
  {
    id: 'A01',
    label: '一号料盘',
    category: '原料库位',
    materialLabel: 'PN-2031',
    calibrated: true,
    points: [
      point('A01_HOME', '待机位', 'home', 'PTP', { x: 420, y: 0, z: 620, rx: 180, ry: 0, rz: 90 }, 'verified'),
      point('A01_APPROACH', '接近位', 'approach', 'LIN', { ...DEFAULT_POSE, z: 348.6 }, 'verified'),
      point('A01_PICK', '取料位', 'interact', 'LIN', DEFAULT_POSE, 'verified'),
      point('A01_LIFT', '取料抬升位', 'retreat', 'LIN', { ...DEFAULT_POSE, z: 420 }, 'verified'),
      point('A01_VISION', '视觉校正位', 'custom', 'PTP', { x: 570, y: -140, z: 430, rx: 180, ry: 0, rz: 90 }, 'pending_verification'),
    ],
  },
  {
    id: 'A02',
    label: '二号料盘',
    category: '原料库位',
    materialLabel: 'PN-2032',
    calibrated: true,
    points: [
      point('A02_HOME', '待机位', 'home', 'PTP', { x: 430, y: -20, z: 620, rx: 180, ry: 0, rz: 90 }, 'verified'),
      point('A02_APPROACH', '接近位', 'approach', 'PTP', { x: 540, y: -42, z: 360, rx: 180, ry: 0, rz: 90 }, 'verified'),
      point('A02_PICK', '取料位', 'interact', 'LIN', { x: 540, y: -42, z: 220, rx: 180, ry: 0, rz: 90 }, 'verified'),
      point('A02_LIFT', '取料抬升位', 'retreat', 'LIN', { x: 540, y: -42, z: 420, rx: 180, ry: 0, rz: 90 }, 'verified'),
    ],
  },
  {
    id: 'A03',
    label: '三号料盘',
    category: '缓存库位',
    calibrated: false,
    points: createStandardPoints('A03'),
  },
]

/** 本地点位文件已有版本；不展示操作人，但保留文件哈希与说明。 */
export const POINT_CONFIG_HISTORY: readonly PointConfigVersion[] = [
  {
    version: '1.7',
    note: '校准二号料盘取料抬升位',
    savedAt: '2026-08-11T09:32:00+08:00',
    fileHash: 'sha256:6d1f…12ba',
  },
  {
    version: '1.6',
    note: '加入三号料盘标准点位草稿',
    savedAt: '2026-08-09T16:18:00+08:00',
    fileHash: 'sha256:bc82…a911',
  },
]

/** 实验台库位（Site）只读投影；未知状态携带不可确认原因。 */
export const BENCH_SITES: readonly BenchSiteProjection[] = [
  benchSite('L-S04-01', '原料暂存位', 'S04 磁搅', '磁搅工作台 · 左侧 A1', '试剂瓶', null, null, 'empty', 8, 18, 19),
  benchSite(
    'L-S04-02',
    '反应瓶待机位',
    'S04 磁搅',
    '磁搅工作台 · 右侧 A2',
    '反应容器',
    '50mL 玻璃反应瓶',
    'EXP-024',
    'occupied',
    27,
    29,
    24,
  ),
  benchSite(
    'L-S05-02',
    '拍照检测位',
    'S05 拍照检测',
    '视觉台 · 中央',
    '样品杯',
    '样品杯 SC-2080',
    null,
    'unknown',
    47,
    22,
    20,
    '最近一次移动结果为 execution_unknown',
  ),
  benchSite('L-S08-02', '开关盖位', 'S08 开关盖', '开关盖工位 · A2', '试剂瓶', '试剂瓶 RB-741', null, 'occupied', 70, 18, 20),
  benchSite('L-S07-01', '固体加料位', 'S07 固体加料', '粉末投料口', '试剂瓶', '氯化钠试剂瓶', 'EXP-021', 'occupied', 35, 64, 20),
  benchSite(
    'L-RB-01',
    '机械臂缓存位',
    'SZLab 机械臂',
    '机械臂可达区',
    '孔板',
    '96 孔板 PL-9032',
    null,
    'unknown',
    64,
    62,
    22,
    '设备执行端离线，现场状态无法核对',
  ),
]

/** 与库位（Site）投影共享身份的物料（Material）只读投影。 */
export const BENCH_MATERIALS: readonly BenchMaterialProjection[] = BENCH_SITES.filter((site) => site.materialName).map((site, index) => ({
  id: `MAT-${String(1842 + index * 97)}`,
  name: site.materialName ?? '未命名物料',
  template: site.materialType,
  location: site.position,
  status: site.status === 'unknown' ? 'unknown' : site.workflowLabel ? 'reserved' : 'idle',
  workflowLabel: site.workflowLabel,
  siteId: site.id,
}))

/** 库位历史与物料流转演示记录，任务、动作和 Trace 均保持可关联。 */
export const BENCH_HISTORY: readonly BenchHistoryRecord[] = [
  history('site-h1', 'site', 'L-S04-02', 'EXP-024', '可信 MOVE 回执确认占用', '2026-08-12 10:32', 'trace-exp024-move'),
  history('site-h2', 'site', 'L-S04-02', 'EXP-023', '释放库位占用', '2026-08-11 17:06', 'trace-exp023-release'),
  history('site-h3', 'site', 'L-S07-01', 'EXP-021', '可信 CONSUME 回执确认现场物料', '2026-08-12 09:48', 'trace-exp021-consume'),
  history('site-h4', 'site', 'L-S05-02', null, '移动结果未知，进入人工核对', '2026-08-12 08:15', 'trace-unknown-2080'),
  history('material-h1', 'material', 'MAT-1842', 'EXP-024', '从原料区移动至反应瓶待机位', '2026-08-12 10:32', 'trace-exp024-move'),
  history('material-h2', 'material', 'MAT-1939', null, '动作结果未知，位置未自动更新', '2026-08-12 08:15', 'trace-unknown-2080'),
  history('material-h3', 'material', 'MAT-2133', 'EXP-021', '实际消耗 12.5 g，位置保持不变', '2026-08-12 09:48', 'trace-exp021-consume'),
]

/** 试剂库基础信息夹具；编码仅作内部身份，不在产品列表展示。 */
export const REAGENT_DEFINITIONS: readonly ReagentDefinition[] = [
  reagent('reagent-acn', 'RGT-ACN-001', '乙腈', '75-05-8', 'C₂H₃N', 'CC#N', '41.05 g/mol', '液体', 'mL', [
    { name: '品牌货号', value: 'ACN-4L-01' },
  ]),
  reagent('reagent-meoh', 'RGT-MEOH-001', '甲醇', '67-56-1', 'CH₄O', 'CO', '32.04 g/mol', '液体', 'mL', []),
  reagent('reagent-nacl', 'RGT-NACL-001', '氯化钠', '7647-14-5', 'NaCl', '[Na+].[Cl-]', '58.44 g/mol', '固体', 'g', [
    { name: '粒径', value: '100-200' },
  ]),
  reagent('reagent-hcl', 'RGT-HCL-005', '盐酸', '7647-01-0', 'HCl', 'Cl', '36.46 g/mol', '液体（水溶液）', 'mL', [
    { name: '开封温度', value: '20' },
  ]),
]

/** 试剂台账夹具；数量与位置仅是本地演示快照，不是库存（Inventory）权威。 */
export const REAGENT_LEDGER: readonly ReagentLedgerRow[] = [
  ledger(
    '1a3b78a7-acn',
    'RL-20260812-001',
    'reagent-acn',
    0.786,
    'g/mL',
    '20℃',
    '国药集团',
    '2028-06-30',
    2860,
    500,
    'mL',
    'L-S04-01',
    '原料暂存位',
    'EXP-024',
    '使用中',
  ),
  ledger(
    '2b4c89b8-meoh',
    'RL-20260812-002',
    'reagent-meoh',
    0.792,
    'g/mL',
    '20℃',
    '默克',
    '2028-05-18',
    3480,
    0,
    'mL',
    'L-PAS-01',
    '试剂暂存位',
    null,
    '可用',
  ),
  ledger(
    '3c5d90c9-nacl',
    'RL-20260812-003',
    'reagent-nacl',
    2.165,
    'g/cm³',
    '25℃',
    '阿拉丁',
    '2029-01-12',
    438,
    25,
    'g',
    'L-S07-01',
    '固体加料位',
    'EXP-021',
    '已预留',
  ),
  ledger(
    '4d6e01da-hcl',
    'RL-20260812-004',
    'reagent-hcl',
    1.008,
    'g/mL',
    '20℃',
    '坛墨质检',
    '2027-08-05',
    760,
    120,
    'mL',
    'L-S06-01',
    '耐酸暂存位',
    'EXP-020',
    '状态不明',
  ),
]

/** 创建动作步骤夹具。所有参数仅描述演示目标，不产生机器人指令。 */
function actionStep(
  id: string,
  label: string,
  motion: RobotActionStep['motion'],
  pointName: string,
  speed: number | null,
  pose: Pose6D,
): RobotActionStep {
  return { id, label, motion, pointName, speed, pose }
}

/** 创建机械臂点位，并显式保留点位状态机的当前状态。 */
function point(
  id: string,
  label: string,
  kind: RobotPoint['kind'],
  motion: RobotPoint['motion'],
  pose: Pose6D,
  status: RobotPoint['status'],
): RobotPoint {
  return { id, label, kind, motion, pose: { ...pose }, status }
}

/** 为从库位（Site）主表加入工站的新库位生成四个待标定标准点位。 */
export function createStandardPoints(siteId: string): RobotPoint[] {
  const emptyPose: Pose6D = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }
  return [
    point(`${siteId}_HOME`, '待机位', 'home', 'PTP', emptyPose, 'uncalibrated'),
    point(`${siteId}_APPROACH`, '接近位', 'approach', 'PTP', emptyPose, 'uncalibrated'),
    point(`${siteId}_PICK`, '取料位', 'interact', 'LIN', emptyPose, 'uncalibrated'),
    point(`${siteId}_LIFT`, '取料抬升位', 'retreat', 'LIN', emptyPose, 'uncalibrated'),
  ]
}

/** 创建实验台库位只读投影，并保留状态不明时的可解释原因。 */
function benchSite(
  id: string,
  name: string,
  device: string,
  position: string,
  materialType: string,
  materialName: string | null,
  workflowLabel: string | null,
  status: BenchSiteProjection['status'],
  x: number,
  y: number,
  width: number,
  unknownReason?: string,
): BenchSiteProjection {
  return {
    id,
    name,
    device,
    position,
    materialType,
    materialName,
    workflowLabel,
    status,
    unknownReason,
    x,
    y,
    width,
  }
}

/** 创建可按任务筛选的实验台历史或流转记录。 */
function history(
  id: string,
  objectKind: BenchHistoryRecord['objectKind'],
  objectId: string,
  taskId: string | null,
  action: string,
  occurredAt: string,
  traceId: string,
): BenchHistoryRecord {
  return { id, objectKind, objectId, taskId, action, occurredAt, traceId }
}

/** 创建试剂库基础信息，并复制自定义参数以隔离共享夹具。 */
function reagent(
  id: string,
  code: string,
  name: string,
  cas: string,
  formula: string,
  structure: string,
  molecularWeight: string,
  form: ReagentDefinition['form'],
  defaultUnit: string,
  custom: ReagentDefinition['custom'],
): ReagentDefinition {
  return {
    id,
    code,
    name,
    cas,
    formula,
    structure,
    molecularWeight,
    form,
    defaultUnit,
    custom: custom.map((parameter) => ({ ...parameter })),
  }
}

/** 创建试剂台账演示快照；未知结果记录不驱动数量、位置或预留变化。 */
function ledger(
  id: string,
  internalNumber: string,
  reagentId: string,
  densityValue: number,
  densityUnit: string,
  densityCondition: string,
  supplier: string,
  expiresOn: string,
  remainingQuantity: number,
  reservedQuantity: number,
  unit: string,
  siteId: string,
  siteLabel: string,
  workflowLabel: string | null,
  displayStatus: ReagentLedgerRow['displayStatus'],
): ReagentLedgerRow {
  const unknown = displayStatus === '状态不明'
  return {
    id,
    internalNumber,
    reagentId,
    densityValue,
    densityUnit,
    densityCondition,
    supplier,
    registeredOn: '2026-08-12',
    expiresOn,
    remainingQuantity,
    reservedQuantity,
    unit,
    siteId,
    siteLabel,
    workflowLabel,
    displayStatus,
    custom: [],
    records: [
      {
        id: `${id}-record-1`,
        taskId: workflowLabel,
        action: unknown ? '设备结果待核对，未自动更新数量或位置' : '登记台账快照',
        quantityDelta: null,
        fromSite: null,
        toSite: null,
        result: unknown ? 'execution_unknown' : 'local',
        trusted: false,
        occurredAt: '2026-08-12 09:30',
        traceId: unknown ? 'trace-execution-unknown' : `trace-${internalNumber}`,
      },
    ],
  }
}
