import type {
  DeviceActionDeclaration,
  DeviceActionDeclarationDevice,
  WorkflowActionNodeTemplate
} from '@unilab/services'

export interface ExperimentOperationProjectedAction {
  actionName: string
  typeName: string
  label: string
  isBusy: boolean
  template: WorkflowActionNodeTemplate | null
}

export interface ExperimentOperationProjectedDevice {
  deviceId: string
  deviceKey: string
  machineName: string
  online: boolean
  dispatchable: boolean
  dispatchBlockReason: string | null
  actions: ExperimentOperationProjectedAction[]
}

export interface ExperimentOperationDeviceActionProjection {
  deviceCount: number
  declaredActionCount: number
  matchedActionCount: number
  devices: ExperimentOperationProjectedDevice[]
  unboundTemplates: WorkflowActionNodeTemplate[]
}

/**
 * 把设备实例声明与可执行动作模板按公开稳定身份唯一关联。
 *
 * 设备实例只提供调度与连接事实；节点创建仍只携带模板 UUID，不把设备实例
 * 偷渡进 Canonical Workflow 草稿。
 */
export function projectExperimentOperationDeviceActions(
  devices: readonly DeviceActionDeclarationDevice[],
  templates: readonly WorkflowActionNodeTemplate[],
  query: string
): ExperimentOperationDeviceActionProjection {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchedTemplateUuids = new Set<string>()
  let matchedActionCount = 0

  const joined = devices.map(device => {
    const deviceMatches = matchesQuery(normalizedQuery, [
      device.machineName,
      device.deviceKey,
      device.namespace
    ])
    const actions = device.actions.map(action => {
      const matches = matchingTemplates(device, action, templates)
      const template = matches.length === 1 ? matches[0] ?? null : null
      if (template) {
        matchedTemplateUuids.add(template.uuid)
        matchedActionCount += 1
      }
      return {
        actionName: action.actionName,
        typeName: action.typeName,
        label: template?.displayName || action.actionName,
        isBusy: action.isBusy,
        template
      }
    })
    const visibleActions = deviceMatches
      ? actions
      : actions.filter(action => matchesQuery(normalizedQuery, [
          action.label,
          action.actionName,
          action.typeName,
          action.template?.actionClass
        ]))
    return {
      deviceId: device.id,
      deviceKey: device.deviceKey,
      machineName: device.machineName,
      online: device.online,
      dispatchable: device.dispatchable,
      dispatchBlockReason: device.dispatchBlockReason,
      actions: visibleActions
    }
  })

  const unboundTemplates = templates
    .filter(template => !matchedTemplateUuids.has(template.uuid))
    .filter(template => matchesQuery(normalizedQuery, [
      template.displayName,
      template.name,
      template.actionType,
      template.actionClass
    ]))
    .sort(compareTemplate)

  return {
    deviceCount: devices.length,
    declaredActionCount: devices.reduce(
      (total, device) => total + device.actions.length,
      0
    ),
    matchedActionCount,
    devices: joined
      .filter(device => !normalizedQuery || device.actions.length > 0 ||
        matchesQuery(normalizedQuery, [device.machineName, device.deviceKey]))
      .sort((left, right) => left.machineName.localeCompare(
        right.machineName,
        'zh-CN'
      )),
    unboundTemplates
  }
}

function matchingTemplates(
  device: DeviceActionDeclarationDevice,
  action: DeviceActionDeclaration,
  templates: readonly WorkflowActionNodeTemplate[]
): WorkflowActionNodeTemplate[] {
  return templates.filter(template =>
    template.resourceTemplateUuid === device.resourceTemplateUuid &&
    template.name === action.actionName &&
    template.actionType === action.typeName
  )
}

function matchesQuery(query: string, values: unknown[]): boolean {
  return !query || values.some(value =>
    typeof value === 'string' && value.toLocaleLowerCase().includes(query)
  )
}

function compareTemplate(
  left: WorkflowActionNodeTemplate,
  right: WorkflowActionNodeTemplate
): number {
  return (left.displayName || left.name).localeCompare(
    right.displayName || right.name,
    'zh-CN'
  )
}
