import type { Node } from 'reactflow'

import type { MaterialAttachTargetState } from '../rules'
import type { MaterialId } from '../types'

export type MaterialSiteDropState = MaterialAttachTargetState

export interface MaterialFlowNodeData {
  materialId: MaterialId
  siteDropStateById?: Readonly<Record<string, MaterialSiteDropState>>
}

export type MaterialFlowNode = Node<
  MaterialFlowNodeData,
  'material'
>
