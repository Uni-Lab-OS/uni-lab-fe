import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

import type { WorkflowNode } from '../utils/parseWorkflow'
import { useWorkflowDag } from './useWorkflowDag'

vi.mock('reactflow', () => ({
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: {
    Bottom: 'bottom',
    Left: 'left',
    Right: 'right',
    Top: 'top'
  },
  useNodesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()],
  useEdgesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()]
}))

it('carries managed material-transfer safety into WorkflowNodeData only when supplied', () => {
  const transfer: WorkflowNode = {
    id: 'transfer',
    name: 'RobotB 转运',
    type: 'workflow',
    className: 'robot_b_material_transfer',
    labNodeType: 'workflow',
    visualKind: 'robot-transfer',
    materialTransferSafety: {
      hardwareExecutable: false,
      blockers: [{
        code: 'uncalibrated_robot_route',
        message: 'RobotB 路线尚未标定'
      }],
      source: { device: 'plate_hotel', site: 'interaction_site' },
      target: { device: 'labeler', site: 'operator_slot_01' }
    }
  }
  const ordinary: WorkflowNode = {
    ...transfer,
    id: 'ordinary',
    name: '标准物料转运',
    materialTransferSafety: undefined
  }

  const markup = renderToStaticMarkup(
    <ProjectionHarness nodes={[transfer, ordinary]} />
  )

  expect(markup).toContain(
    'data-transfer-safety="false:uncalibrated_robot_route:' +
      'plate_hotel:labeler"'
  )
  expect(markup).toContain('data-ordinary-safety="absent"')
})

function ProjectionHarness({ nodes }: { nodes: WorkflowNode[] }) {
  const projection = useWorkflowDag(nodes, [])
  const byId = new Map(projection.nodes.map((node) => [node.id, node.data]))
  const transfer = byId.get('transfer')?.materialTransferSafety
  const ordinary = byId.get('ordinary')?.materialTransferSafety
  return (
    <output
      data-transfer-safety={transfer
        ? [
            transfer.hardwareExecutable,
            transfer.blockers[0]?.code,
            transfer.source?.device,
            transfer.target?.device
          ].join(':')
        : 'absent'}
      data-ordinary-safety={ordinary ? 'present' : 'absent'}
    />
  )
}
