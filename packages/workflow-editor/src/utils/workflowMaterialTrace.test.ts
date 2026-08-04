import { describe, expect, it } from 'vitest'

import type {
  WorkflowHandlePort,
  WorkflowLink,
  WorkflowNode
} from './parseWorkflow'
import {
  materialTraceAccent,
  projectMaterialTraces
} from './workflowMaterialTrace'

const sourceUuid = '20000000-0000-4000-8000-000000000001'
const firstActionUuid = '20000000-0000-4000-8000-000000000002'
const secondActionUuid = '20000000-0000-4000-8000-000000000003'

describe('Material trace projection', () => {
  it('projects one stable material identity through an implicit three-node chain', () => {
    const sourceOutput = resourceSlotHandle('source-output', 'material', 'source')
    const firstInput = resourceSlotHandle('first-input', 'sample', 'target')
    const firstOutput = resourceSlotHandle(
      'first-output',
      'sample',
      'source',
      true
    )
    const secondInput = resourceSlotHandle('second-input', 'sample', 'target')
    const nodes: WorkflowNode[] = [
      workflowNode(sourceUuid, 'assay_plate', 'material_source', [sourceOutput]),
      workflowNode(firstActionUuid, 'prepare', 'action', [firstInput, firstOutput]),
      workflowNode(secondActionUuid, 'analyze', 'action', [secondInput])
    ]
    const links: WorkflowLink[] = [
      link(sourceUuid, sourceOutput.uuid, firstActionUuid, firstInput.uuid),
      link(firstActionUuid, firstOutput.uuid, secondActionUuid, secondInput.uuid)
    ]

    const projection = projectMaterialTraces(nodes, links)
    const accent = materialTraceAccent(sourceUuid)

    expect(projection.edgeAccents).toEqual(new Map([[0, accent], [1, accent]]))
    expect(projection.handleAccentsByNode.get(firstActionUuid)).toEqual(new Map([
      [firstInput.uuid, accent],
      [firstOutput.uuid, accent]
    ]))
    expect(projection.handleAccentsByNode.get(secondActionUuid)).toEqual(
      new Map([[secondInput.uuid, accent]])
    )
    expect(projection.chipsByNode.get(firstActionUuid)).toEqual([
      materialChip(firstInput.uuid, accent)
    ])
    expect(projection.chipsByNode.get(secondActionUuid)).toEqual([
      materialChip(secondInput.uuid, accent)
    ])
  })

  it('keeps two material sources distinct when they enter the same Action', () => {
    const reagentUuid = '20000000-0000-4000-8000-000000000004'
    const sampleOutput = resourceSlotHandle('sample-output', 'material', 'source')
    const reagentOutput = resourceSlotHandle('reagent-output', 'material', 'source')
    const sampleInput = resourceSlotHandle('sample-input', 'sample', 'target')
    const reagentInput = resourceSlotHandle('reagent-input', 'reagent', 'target')
    const nodes: WorkflowNode[] = [
      workflowNode(sourceUuid, '样品板', 'material_source', [sampleOutput]),
      workflowNode(reagentUuid, '试剂槽', 'material_source', [reagentOutput]),
      workflowNode(firstActionUuid, '混合', 'action', [sampleInput, reagentInput])
    ]
    const links = [
      link(sourceUuid, sampleOutput.uuid, firstActionUuid, sampleInput.uuid),
      link(reagentUuid, reagentOutput.uuid, firstActionUuid, reagentInput.uuid)
    ]

    const projection = projectMaterialTraces(nodes, links)

    expect(projection.edgeAccents.get(0)).toBe(materialTraceAccent(sourceUuid))
    expect(projection.edgeAccents.get(1)).toBe(materialTraceAccent(reagentUuid))
    expect(projection.edgeAccents.get(0)).not.toBe(projection.edgeAccents.get(1))
    expect(projection.chipsByNode.get(firstActionUuid)).toEqual([
      materialChip(sampleInput.uuid, materialTraceAccent(sourceUuid), {
        sourceNodeUuid: sourceUuid,
        sourceNodeName: '样品板'
      }),
      materialChip(reagentInput.uuid, materialTraceAccent(reagentUuid), {
        sourceNodeUuid: reagentUuid,
        sourceNodeName: '试剂槽'
      })
    ])
  })

  it('starts a new material trace at an explicit ResourceSlot producer', () => {
    const producedOutput = resourceSlotHandle(
      'produced-output',
      'product',
      'source',
      false,
      '产物板'
    )
    const targetInput = resourceSlotHandle('target-input', 'product', 'target')
    const nodes: WorkflowNode[] = [
      workflowNode(firstActionUuid, 'prepare', 'action', [producedOutput]),
      workflowNode(secondActionUuid, 'analyze', 'action', [targetInput])
    ]
    const links = [
      link(firstActionUuid, producedOutput.uuid, secondActionUuid, targetInput.uuid)
    ]

    const projection = projectMaterialTraces(nodes, links)
    const accent = materialTraceAccent(`${firstActionUuid}:${producedOutput.uuid}`)

    expect(projection.edgeAccents.get(0)).toBe(accent)
    expect(projection.chipsByNode.get(secondActionUuid)).toEqual([{
      handleUuid: targetInput.uuid,
      sourceNodeUuid: firstActionUuid,
      sourceNodeName: 'prepare',
      sourceHandleName: '产物板',
      accent,
    }])
  })

  it('keeps adjacent material identities distinct when stable hashes collide', () => {
    const middleUuid = '20000000-0000-4000-8000-000000000009'
    const sharedOutputUuid = '40000000-0000-4000-8000-000000000005'
    const firstOutput = resourceSlotHandle(
      sharedOutputUuid,
      'prepared',
      'source',
      false,
      'Prepared'
    )
    const middleInput = resourceSlotHandle('middle-input', 'sample', 'target')
    const middleOutput = resourceSlotHandle(
      sharedOutputUuid,
      'prepared',
      'source',
      false,
      'Prepared'
    )
    const lastInput = resourceSlotHandle('last-input', 'prepared', 'target')
    const nodes = [
      workflowNode(sourceUuid, 'prepared', 'action', [firstOutput]),
      workflowNode(middleUuid, 'verified', 'action', [
        middleInput,
        middleOutput
      ]),
      workflowNode(secondActionUuid, 'analyzed', 'action', [lastInput])
    ]
    const links = [
      link(sourceUuid, firstOutput.uuid, middleUuid, middleInput.uuid),
      link(middleUuid, middleOutput.uuid, secondActionUuid, lastInput.uuid)
    ]

    expect(materialTraceAccent(`${sourceUuid}:${sharedOutputUuid}`)).toBe(
      materialTraceAccent(`${middleUuid}:${sharedOutputUuid}`)
    )
    const projection = projectMaterialTraces(nodes, links)
    expect(projection.edgeAccents.get(0)).not.toBe(
      projection.edgeAccents.get(1)
    )
  })

  it('does not infer a material trace from presentation hints or scalar edges', () => {
    const hintedOutput: WorkflowHandlePort = {
      uuid: 'hinted-output',
      handleKey: 'temperature',
      displayName: '温度',
      ioType: 'source',
      valueType: 'number',
      valueSchema: { type: 'number' },
      dataKey: 'temperature',
      editorControl: 'material_port',
      implicitPassthrough: false
    }
    const scalarInput: WorkflowHandlePort = {
      ...hintedOutput,
      uuid: 'scalar-input',
      ioType: 'target',
      editorControl: 'variable_selector'
    }
    const nodes = [
      workflowNode(firstActionUuid, 'measure', 'action', [hintedOutput]),
      workflowNode(secondActionUuid, 'report', 'action', [scalarInput])
    ]

    const projection = projectMaterialTraces(nodes, [
      link(firstActionUuid, hintedOutput.uuid, secondActionUuid, scalarInput.uuid)
    ])

    expect(projection.edgeAccents).toEqual(new Map())
    expect(projection.handleAccentsByNode).toEqual(new Map())
    expect(projection.chipsByNode).toEqual(new Map())
  })

  it('fails closed when an edge lacks authoritative Handle semantics', () => {
    const nodes: WorkflowNode[] = [
      workflowNode(sourceUuid, 'assay_plate', 'material_source'),
      workflowNode(firstActionUuid, 'mix', 'action')
    ]

    const projection = projectMaterialTraces(nodes, [
      link(sourceUuid, 'unknown-source', firstActionUuid, 'unknown-target')
    ])

    expect(projection.edgeAccents).toEqual(new Map())
    expect(projection.chipsByNode).toEqual(new Map())
    expect(materialTraceAccent(sourceUuid)).not.toMatch(
      /success|warning|danger|error/i
    )
  })
})

function resourceSlotHandle(
  uuid: string,
  dataKey: string,
  ioType: 'source' | 'target',
  implicitPassthrough = false,
  displayName = dataKey
): WorkflowHandlePort {
  return {
    uuid,
    handleKey: dataKey,
    displayName,
    ioType,
    valueType: 'ResourceSlot',
    valueSchema: { $slot: 'ResourceSlot' },
    dataKey,
    editorControl: 'material_port',
    allowedResourceTemplateUuids: null,
    implicitPassthrough
  }
}

function workflowNode(
  id: string,
  name: string,
  type: string,
  handles?: WorkflowHandlePort[]
): WorkflowNode {
  return {
    id,
    name,
    type,
    className: type,
    labNodeType: type,
    handles
  }
}

function link(
  source: string,
  sourceHandleUuid: string,
  target: string,
  targetHandleUuid: string
): WorkflowLink {
  return {
    source,
    target,
    type: 'control',
    sourceHandleUuid,
    targetHandleUuid
  }
}

function materialChip(
  handleUuid: string,
  accent: string,
  overrides: Partial<{
    sourceNodeUuid: string
    sourceNodeName: string
    sourceHandleName: string
  }> = {}
): {
  handleUuid: string
  sourceNodeUuid: string
  sourceNodeName: string
  sourceHandleName: string
  accent: string
} {
  return {
    handleUuid,
    sourceNodeUuid: overrides.sourceNodeUuid ?? sourceUuid,
    sourceNodeName: overrides.sourceNodeName ?? 'assay_plate',
    sourceHandleName: overrides.sourceHandleName ?? 'material',
    accent,
  }
}
