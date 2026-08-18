import { describe, expect, it } from 'vitest'

import type {
  WorkflowHandlePort,
  WorkflowLink,
  WorkflowNode
} from './parseWorkflow'
import {
  layoutWorkflowPrimarySampleFlow,
  WORKFLOW_PRIMARY_SAMPLE_COLUMN_GAP,
  WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW
} from './workflowPrimarySampleLayout'
import { WORKFLOW_SUPPORTING_BRANCH_NODE_GAP } from './workflowPrimarySampleBranchLayout'

describe('layoutWorkflowPrimarySampleFlow', () => {
  /** 验证主样品路径优先于声明顺序，并在第四个节点后反向换行。 */
  it('uses the primary sample as a serpentine backbone', () => {
    const reagentOutput = resourceSlotHandle(
      'reagent-output',
      'reagent',
      'source'
    )
    const primaryOutput = resourceSlotHandle(
      'primary-output',
      'sample',
      'source'
    )
    const actionNodes = Array.from({ length: 6 }, (_, index) =>
      sampleAction(`step-${index + 1}`, index < 5)
    )
    actionNodes[2]!.handles?.push(resourceSlotHandle(
      'step-3-reagent-input',
      'reagent',
      'target'
    ))
    const nodes: WorkflowNode[] = [
      materialSource('reagent-source', '试剂', 'reagent', reagentOutput),
      materialSource(
        'primary-source',
        '主样品',
        'primary_sample',
        primaryOutput
      ),
      ...actionNodes
    ]
    const links: WorkflowLink[] = [
      materialLink(
        'primary-source',
        primaryOutput.uuid,
        'step-1',
        'step-1-input'
      ),
      ...Array.from({ length: 5 }, (_, index) => materialLink(
        `step-${index + 1}`,
        `step-${index + 1}-output`,
        `step-${index + 2}`,
        `step-${index + 2}-input`
      )),
      materialLink(
        'reagent-source',
        reagentOutput.uuid,
        'step-3',
        'step-3-reagent-input'
      )
    ]

    const result = layoutWorkflowPrimarySampleFlow(nodes, links)
    const positions = new Map(
      result.nodes.map((node) => [node.id, { x: node.x, y: node.y }])
    )
    const backbone = result.primarySample?.backboneNodeIds ?? []

    expect(result.primarySample?.hasPrimarySample).toBe(true)
    expect(backbone).toEqual([
      'primary-source',
      'step-1',
      'step-2',
      'step-3',
      'step-4',
      'step-5',
      'step-6'
    ])
    expect(WORKFLOW_PRIMARY_SAMPLE_NODES_PER_ROW).toBe(4)
    expect(positions.get('primary-source')?.x)
      .toBeLessThan(positions.get('step-1')?.x ?? 0)
    expect(positions.get('step-1')?.x)
      .toBeLessThan(positions.get('step-2')?.x ?? 0)
    expect(positions.get('step-3')?.x).toBe(
      positions.get('step-4')?.x
    )
    expect(positions.get('step-4')?.x)
      .toBeGreaterThan(positions.get('step-5')?.x ?? 0)
    expect(positions.get('step-3')?.y)
      .toBeLessThan(positions.get('step-4')?.y ?? 0)
    expect(result.nodePorts?.get('step-3')).toEqual({
      target: 'left',
      source: 'right'
    })
    expect(result.nodePorts?.get('step-4')).toMatchObject({
      target: 'right',
      source: 'left'
    })
    expect(result.edgeDirections?.get(2)).toBe('LR')
    expect(result.edgeDirections?.get(3)).toBe('LR')
    expect([...result.nodePorts?.values() ?? []].every((ports) =>
      [ports.target, ports.source].every((side) =>
        side === 'left' || side === 'right'
      )
    )).toBe(true)
    expect(backbone).not.toContain('reagent-source')
    expect(positions.get('reagent-source')?.y)
      .toBeLessThan(positions.get('step-3')?.y ?? 0)
    expect(positions.get('reagent-source')?.x)
      .toBeLessThan(positions.get('step-3')?.x ?? 0)
  })

  /** 验证反向蛇形行的辅助物料按实际接入列排列，避免来源连线互相穿越。 */
  it('orders supporting materials by physical anchor column', () => {
    const primaryOutput = resourceSlotHandle(
      'primary-output',
      'sample',
      'source'
    )
    const westReagentOutput = resourceSlotHandle(
      'west-reagent-output',
      'west_reagent',
      'source'
    )
    const eastReagentOutput = resourceSlotHandle(
      'east-reagent-output',
      'east_reagent',
      'source'
    )
    const actionNodes = Array.from({ length: 6 }, (_, index) =>
      sampleAction(`step-${index + 1}`, index < 5)
    )
    actionNodes[3]!.handles?.push(resourceSlotHandle(
      'step-4-east-reagent-input',
      'east_reagent',
      'target'
    ))
    actionNodes[5]!.handles?.push(resourceSlotHandle(
      'step-6-west-reagent-input',
      'west_reagent',
      'target'
    ))
    const nodes: WorkflowNode[] = [
      materialSource(
        'east-reagent-source',
        '东侧接入试剂',
        'reagent',
        eastReagentOutput
      ),
      materialSource(
        'west-reagent-source',
        '西侧接入试剂',
        'reagent',
        westReagentOutput
      ),
      materialSource(
        'primary-source',
        '主样品',
        'primary_sample',
        primaryOutput
      ),
      ...actionNodes
    ]
    const primaryLinks = [
      materialLink(
        'primary-source',
        primaryOutput.uuid,
        'step-1',
        'step-1-input'
      ),
      ...Array.from({ length: 5 }, (_, index) => materialLink(
        `step-${index + 1}`,
        `step-${index + 1}-output`,
        `step-${index + 2}`,
        `step-${index + 2}-input`
      ))
    ]
    const supportingLinks = [
      materialLink(
        'east-reagent-source',
        eastReagentOutput.uuid,
        'step-4',
        'step-4-east-reagent-input'
      ),
      materialLink(
        'west-reagent-source',
        westReagentOutput.uuid,
        'step-6',
        'step-6-west-reagent-input'
      )
    ]

    const result = layoutWorkflowPrimarySampleFlow(
      nodes,
      [...primaryLinks, ...supportingLinks]
    )
    const positions = new Map(
      result.nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }])
    )
    const optimizedCrossings = countTwoBandCrossings(
      supportingLinks,
      positions
    )
    const declarationOrderCrossings = countOrderInversions([
      { sourceOrder: 0, targetOrder: 3 },
      { sourceOrder: 1, targetOrder: 1 }
    ])

    expect(declarationOrderCrossings).toBe(1)
    expect(optimizedCrossings).toBe(0)
    expect(positions.get('west-reagent-source')?.x)
      .toBeLessThan(positions.get('east-reagent-source')?.x ?? 0)
    expect(positions.get('step-6')?.x)
      .toBeLessThan(positions.get('step-4')?.x ?? 0)
    expect(positions.get('west-reagent-source')?.x)
      .toBeGreaterThan(positions.get('step-6')?.x ?? 0)
    expect(positions.get('east-reagent-source')?.x)
      .toBeGreaterThan(positions.get('step-4')?.x ?? 0)
    expect(Math.abs(
      (positions.get('west-reagent-source')?.x ?? 0) -
      (positions.get('step-6')?.x ?? 0)
    )).toBeLessThanOrEqual(WORKFLOW_SUPPORTING_BRANCH_NODE_GAP)
    expect(Math.abs(
      (positions.get('east-reagent-source')?.x ?? 0) -
      (positions.get('step-4')?.x ?? 0)
    )).toBeLessThanOrEqual(WORKFLOW_SUPPORTING_BRANCH_NODE_GAP)
  })

  /** 验证辅助物料来源与预处理动作聚成短链，并让汇入端贴近主样品动作。 */
  it('packs a supporting material chain next to its primary join', () => {
    const primaryOutput = resourceSlotHandle(
      'primary-output',
      'sample',
      'source'
    )
    const reagentOutput = resourceSlotHandle(
      'reagent-output',
      'reagent',
      'source'
    )
    const reagentPreparedOutput = resourceSlotHandle(
      'reagent-prepared-output',
      'reagent',
      'source'
    )
    const step1 = sampleAction('step-1', true)
    const step2 = sampleAction('step-2', false)
    step2.handles?.push(resourceSlotHandle(
      'step-2-reagent-input',
      'reagent',
      'target'
    ))
    const reagentPreparation: WorkflowNode = {
      id: 'prepare-reagent',
      name: '准备辅助试剂',
      type: 'action',
      className: 'Action',
      labNodeType: 'Action',
      handles: [
        resourceSlotHandle('prepare-reagent-input', 'reagent', 'target'),
        reagentPreparedOutput
      ]
    }
    const nodes = [
      materialSource(
        'primary-source',
        '主样品',
        'primary_sample',
        primaryOutput
      ),
      materialSource(
        'reagent-source',
        '辅助试剂',
        'reagent',
        reagentOutput
      ),
      reagentPreparation,
      step1,
      step2
    ]
    const links = [
      materialLink(
        'primary-source',
        primaryOutput.uuid,
        'step-1',
        'step-1-input'
      ),
      materialLink(
        'step-1',
        'step-1-output',
        'step-2',
        'step-2-input'
      ),
      materialLink(
        'reagent-source',
        reagentOutput.uuid,
        'prepare-reagent',
        'prepare-reagent-input'
      ),
      materialLink(
        'prepare-reagent',
        reagentPreparedOutput.uuid,
        'step-2',
        'step-2-reagent-input'
      )
    ]

    const result = layoutWorkflowPrimarySampleFlow(nodes, links)
    const positions = new Map(result.nodes.map((node) => [node.id, node]))
    const sourceX = positions.get('reagent-source')?.x ?? 0
    const preparationX = positions.get('prepare-reagent')?.x ?? 0
    const joinX = positions.get('step-2')?.x ?? 0

    expect(Math.abs(sourceX - preparationX))
      .toBe(WORKFLOW_SUPPORTING_BRANCH_NODE_GAP)
    expect(Math.abs(sourceX - preparationX))
      .toBeLessThan(WORKFLOW_PRIMARY_SAMPLE_COLUMN_GAP)
    expect(Math.abs(preparationX - joinX))
      .toBeLessThanOrEqual(WORKFLOW_SUPPORTING_BRANCH_NODE_GAP)
    expect(positions.get('reagent-source')?.y)
      .toBe(positions.get('prepare-reagent')?.y)
    expect(result.nodePorts?.get('prepare-reagent')).toEqual({
      target: 'left',
      source: 'right'
    })
    expect(positions.get('reagent-source')?.y)
      .toBeLessThan(positions.get('step-2')?.y ?? 0)
  })

  /**
   * 支路可能先以执行依赖接入当前行的 pick，随后才把物料送入下一条蛇形主线。
   * MaterialSource 必须跟随整条支路留在 pick 前侧，不能被后续物料汇入点单独拉走。
   */
  it('keeps a supporting branch before its earlier dependency attachment', () => {
    const primaryOutput = resourceSlotHandle(
      'primary-output',
      'sample',
      'source'
    )
    const vialOutput = resourceSlotHandle(
      'vial-output',
      'vial',
      'source'
    )
    const transferredVialOutput = resourceSlotHandle(
      'transferred-vial-output',
      'vial',
      'source'
    )
    const openedVialOutput = resourceSlotHandle(
      'opened-vial-output',
      'vial',
      'source'
    )
    const step1 = sampleAction('step-1', true)
    const step2 = sampleAction('step-2', true)
    const pick = sampleAction('pick', true)
    const pour = sampleAction('pour', false)
    pour.handles?.push(resourceSlotHandle(
      'pour-vial-input',
      'vial',
      'target'
    ))
    const transfer: WorkflowNode = {
      id: 'transfer-vial',
      name: '转运样品瓶',
      type: 'action',
      className: 'Action',
      labNodeType: 'Action',
      visualKind: 'robot-transfer',
      handles: [
        resourceSlotHandle('transfer-vial-input', 'vial', 'target'),
        transferredVialOutput
      ]
    }
    const openVial: WorkflowNode = {
      id: 'open-vial',
      name: '样品瓶开盖',
      type: 'action',
      className: 'Action',
      labNodeType: 'Action',
      handles: [
        resourceSlotHandle('open-vial-input', 'vial', 'target'),
        openedVialOutput
      ]
    }
    const nodes: WorkflowNode[] = [
      materialSource('vial-source', '样品瓶', 'consumable', vialOutput),
      materialSource(
        'primary-source',
        '主样品',
        'primary_sample',
        primaryOutput
      ),
      transfer,
      openVial,
      step1,
      step2,
      pick,
      pour
    ]
    const links: WorkflowLink[] = [
      materialLink('primary-source', primaryOutput.uuid, 'step-1', 'step-1-input'),
      materialLink('step-1', 'step-1-output', 'step-2', 'step-2-input'),
      materialLink('step-2', 'step-2-output', 'pick', 'pick-input'),
      materialLink('pick', 'pick-output', 'pour', 'pour-input'),
      materialLink(
        'vial-source',
        vialOutput.uuid,
        'transfer-vial',
        'transfer-vial-input'
      ),
      materialLink(
        'transfer-vial',
        transferredVialOutput.uuid,
        'open-vial',
        'open-vial-input'
      ),
      materialLink(
        'vial-source',
        vialOutput.uuid,
        'pour',
        'pour-vial-input'
      ),
      readyLink('open-vial', 'pick')
    ]

    const result = layoutWorkflowPrimarySampleFlow(nodes, links)
    const x = new Map(result.nodes.map((node) => [node.id, node.x ?? 0]))

    expect(x.get('vial-source')).toBeLessThan(x.get('transfer-vial') ?? 0)
    expect(x.get('transfer-vial')).toBeLessThan(x.get('open-vial') ?? 0)
    expect(x.get('open-vial')).toBeLessThan(x.get('pick') ?? 0)
  })

  /** 验证主干中转运节点与前后动作的主轴间距均压缩为普通列距的一半。 */
  it('halves both adjacent gaps around a robot transfer', () => {
    const primaryOutput = resourceSlotHandle(
      'primary-output',
      'sample',
      'source'
    )
    const source = materialSource(
      'primary-source',
      '主样品',
      'primary_sample',
      primaryOutput
    )
    const before = sampleAction('before', true)
    const transfer = {
      ...sampleAction('transfer', true),
      visualKind: 'robot-transfer' as const
    }
    const after = sampleAction('after', false)
    const links = [
      materialLink('primary-source', primaryOutput.uuid, 'before', 'before-input'),
      materialLink('before', 'before-output', 'transfer', 'transfer-input'),
      materialLink('transfer', 'transfer-output', 'after', 'after-input')
    ]

    const result = layoutWorkflowPrimarySampleFlow(
      [source, before, transfer, after],
      links
    )
    const positions = new Map(result.nodes.map((node) => [node.id, node.x]))

    expect((positions.get('before') ?? 0) -
      (positions.get('primary-source') ?? 0))
      .toBe(WORKFLOW_PRIMARY_SAMPLE_COLUMN_GAP)
    expect((positions.get('transfer') ?? 0) -
      (positions.get('before') ?? 0))
      .toBe((WORKFLOW_PRIMARY_SAMPLE_COLUMN_GAP + 184) / 2)
    expect((positions.get('after') ?? 0) -
      (positions.get('transfer') ?? 0))
      .toBe((WORKFLOW_PRIMARY_SAMPLE_COLUMN_GAP + 120) / 2)
  })

  /** 同一蛇形行必须按主样品 Handle 轴对齐，而不是按不同高度节点的顶边对齐。 */
  it('aligns primary material handles across action, transfer and source nodes', () => {
    const primaryOutput = resourceSlotHandle(
      'primary-output',
      'sample',
      'source'
    )
    const reagentOutput = resourceSlotHandle(
      'reagent-output',
      'reagent',
      'source'
    )
    const catalystOutput = resourceSlotHandle(
      'catalyst-output',
      'catalyst',
      'source'
    )
    const first = sampleAction('first', true)
    const second: WorkflowNode = {
      ...sampleAction('second', true),
      handles: [
        resourceSlotHandle('second-reagent-input', 'reagent', 'target'),
        // 模拟真实 S09：输出声明穿插在输入之间。渲染层仍会先展示全部输入，
        // 因此布局也必须按“输入优先”计算主样品卡片行号。
        resourceSlotHandle('second-catalyst-output', 'catalyst', 'source'),
        resourceSlotHandle('second-input', 'sample', 'target'),
        resourceSlotHandle('second-catalyst-input', 'catalyst', 'target'),
        resourceSlotHandle('second-output', 'sample', 'source')
      ]
    }
    const transfer: WorkflowNode = {
      ...sampleAction('transfer', false),
      visualKind: 'robot-transfer'
    }
    const nodes = [
      materialSource('reagent-source', '试剂', 'reagent', reagentOutput),
      materialSource('catalyst-source', '催化剂', 'reagent', catalystOutput),
      materialSource(
        'primary-source',
        '主样品',
        'primary_sample',
        primaryOutput
      ),
      first,
      second,
      transfer
    ]
    const links = [
      materialLink('primary-source', primaryOutput.uuid, 'first', 'first-input'),
      materialLink('first', 'first-output', 'second', 'second-input'),
      materialLink('second', 'second-output', 'transfer', 'transfer-input'),
      materialLink(
        'reagent-source',
        reagentOutput.uuid,
        'second',
        'second-reagent-input'
      ),
      materialLink(
        'catalyst-source',
        catalystOutput.uuid,
        'second',
        'second-catalyst-input'
      )
    ]

    const result = layoutWorkflowPrimarySampleFlow(nodes, links)
    const yByNode = new Map(result.nodes.map((node) => [node.id, node.y ?? 0]))
    const handleAxes = [
      (yByNode.get('primary-source') ?? 0) + 92,
      (yByNode.get('first') ?? 0) + 64,
      (yByNode.get('second') ?? 0) + 95,
      (yByNode.get('transfer') ?? 0) + 90
    ]

    expect(new Set(handleAxes).size).toBe(1)
    expect(result.nodePorts?.get('transfer')).toEqual({
      target: 'left',
      source: 'right'
    })
    expect(result.edgeDirections?.get(2)).toBe('LR')
  })
})

/**
 * 统计两条水平带之间的直连边次序反转数，作为交叉数回归指标。
 *
 * @param links 连接辅助物料与主样品（Primary Sample）主干的边。
 * @param positions 节点 UUID 到布局坐标的映射。
 * @returns 端点次序相反、因而必然交叉的边对数量。
 */
function countTwoBandCrossings(
  links: readonly WorkflowLink[],
  positions: ReadonlyMap<string, { x: number; y: number }>
): number {
  return countOrderInversions(links.map((link) => ({
    sourceOrder: positions.get(link.source)?.x ?? 0,
    targetOrder: positions.get(link.target)?.x ?? 0
  })))
}

/**
 * 统计两组端点排序中的逆序边对。
 *
 * @param edges 每条边在来源带和目标带中的相对位置。
 * @returns 严格逆序的边对数量；共享端点不计为交叉。
 */
function countOrderInversions(
  edges: ReadonlyArray<{ sourceOrder: number; targetOrder: number }>
): number {
  let crossings = 0
  edges.forEach((left, leftIndex) => {
    edges.slice(leftIndex + 1).forEach((right) => {
      if (
        (left.sourceOrder - right.sourceOrder) *
          (left.targetOrder - right.targetOrder) < 0
      ) crossings += 1
    })
  })
  return crossings
}

/**
 * 创建声明物料流角色（MaterialFlowRole）的物料来源（MaterialSource）。
 *
 * @param id 节点稳定身份。
 * @param name 中文优先展示名称。
 * @param flowRole 物料流角色 wire 值。
 * @param output 物料占位符（ResourceSlot）输出句柄。
 * @returns 可供布局测试使用的最小物料来源节点。
 */
function materialSource(
  id: string,
  name: string,
  flowRole: string,
  output: WorkflowHandlePort
): WorkflowNode {
  return {
    id,
    name,
    type: 'material_source',
    className: 'MaterialSource',
    labNodeType: 'MaterialSource',
    handles: [output],
    materialSource: {
      mode: 'existing',
      flowRole,
      mountUuid: 'mount-1',
      resourceTemplateUuid: 'template-1'
    }
  }
}

/**
 * 创建透传主样品物料占位符（ResourceSlot）的操作节点。
 *
 * @param id 节点稳定身份。
 * @param hasOutput 是否仍向下游输出同一主样品身份。
 * @returns 带同字段输入、可选输出句柄的操作节点。
 */
function sampleAction(id: string, hasOutput: boolean): WorkflowNode {
  return {
    id,
    name: id,
    type: 'action',
    className: 'Action',
    labNodeType: 'Action',
    handles: [
      resourceSlotHandle(`${id}-input`, 'sample', 'target'),
      ...(hasOutput
        ? [resourceSlotHandle(`${id}-output`, 'sample', 'source')]
        : [])
    ]
  }
}

/**
 * 创建有类型物料占位符（ResourceSlot）句柄。
 *
 * @param uuid 句柄稳定身份。
 * @param dataKey 动作参数或结果字段名。
 * @param ioType 输入或输出方向。
 * @returns 最小可追踪物料句柄。
 */
function resourceSlotHandle(
  uuid: string,
  dataKey: string,
  ioType: 'source' | 'target'
): WorkflowHandlePort {
  return {
    uuid,
    handleKey: dataKey,
    displayName: dataKey,
    dataKey,
    ioType,
    valueType: 'ResourceSlot',
    valueSchema: { $slot: 'ResourceSlot' }
  }
}

/**
 * 创建物料占位符（ResourceSlot）之间的工作流边。
 *
 * @param source 来源节点 UUID。
 * @param sourceHandleUuid 来源输出句柄 UUID。
 * @param target 目标节点 UUID。
 * @param targetHandleUuid 目标输入句柄 UUID。
 * @returns 可供物料追踪与布局使用的工作流边。
 */
function materialLink(
  source: string,
  sourceHandleUuid: string,
  target: string,
  targetHandleUuid: string
): WorkflowLink {
  return {
    source,
    sourceHandleUuid,
    target,
    targetHandleUuid,
    type: 'control'
  }
}

/** 创建不承载物料身份的节点就绪依赖。 */
function readyLink(source: string, target: string): WorkflowLink {
  return {
    source,
    target,
    type: 'control'
  }
}
