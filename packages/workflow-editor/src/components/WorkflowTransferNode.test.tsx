import type { PropsWithChildren } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Position } from 'reactflow'

import type { WorkflowNodeData } from './WorkflowNodeCard'
import WorkflowTransferNode from './WorkflowTransferNode'

vi.mock('reactflow', () => ({
  Handle: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <i {...props}>{children}</i>
  ),
  Position: {
    Bottom: 'bottom',
    Left: 'left',
    Right: 'right',
    Top: 'top'
  }
}))

describe('WorkflowTransferNode managed safety', () => {
  it('visibly marks a non-hardware-executable transfer with blocker diagnostics', () => {
    const markup = renderTransfer({
      hardwareExecutable: false,
      blockers: [
        {
          code: 'uncalibrated_robot_route',
          message: 'RobotB 路线尚未标定'
        },
        {
          code: 'unnamed_robot_commands',
          message: '原始关系未提供取放命令名'
        }
      ],
      source: {
        device: 'plate_hotel',
        mountResource: 'hotel-carrier',
        site: 'interaction_site'
      },
      target: {
        device: 'labeler',
        mountResource: 'labeler-carrier',
        site: 'operator_slot_01'
      }
    })

    expect(markup).toContain('仅虚拟/未标定')
    expect(markup).toContain(
      'data-workflow-material-transfer-hardware-executable="false"'
    )
    expect(markup).toContain(
      'data-workflow-material-transfer-safety="virtual-only"'
    )
    expect(markup).toContain(
      'data-workflow-material-transfer-blockers="' +
        'uncalibrated_robot_route,unnamed_robot_commands"'
    )
    expect(markup).toContain('RobotB 路线尚未标定；原始关系未提供取放命令名')
    expect(markup).toContain(
      'data-workflow-material-transfer-source-site="interaction_site"'
    )
    expect(markup).toContain(
      'data-workflow-material-transfer-target-site="operator_slot_01"'
    )
  })

  it('leaves an ordinary canonical material transfer unchanged', () => {
    const markup = renderTransfer(undefined)

    expect(markup).not.toContain('仅虚拟/未标定')
    expect(markup).not.toContain('data-workflow-material-transfer-safety=')
    expect(markup).not.toContain(
      'data-workflow-material-transfer-hardware-executable='
    )
  })
})

function renderTransfer(
  materialTransferSafety: WorkflowNodeData['materialTransferSafety']
): string {
  return renderToStaticMarkup(
    <WorkflowTransferNode
      data={{
        id: 'transfer-node',
        name: 'RobotB 转运',
        color: '#6657c7',
        kind: 'workflow',
        visualKind: 'robot-transfer',
        materialTransferSafety
      }}
      materialPort={{
        key: 'resource',
        variableName: 'resource',
        label: '96 孔板',
        description: '96 孔板 · 物料流',
        accent: '#6657c7',
        targetHandle: {
          uuid: 'resource-target',
          handleKey: 'resource',
          displayName: 'resource',
          dataKey: 'resource',
          ioType: 'target',
          valueType: 'ResourceSlot'
        },
        sourceHandle: {
          uuid: 'resource-source',
          handleKey: 'resource',
          displayName: 'resource',
          dataKey: 'resource',
          ioType: 'source',
          valueType: 'ResourceSlot'
        }
      }}
      materialTargetPosition={Position.Left}
      materialSourcePosition={Position.Right}
      stateVisible={false}
      stateLabel="待执行"
      structuralTargetHandles={null}
      structuralSourceHandles={null}
    />
  )
}
