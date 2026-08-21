import type {
  WorkflowAuthoringGraph,
  WorkflowInputDescriptor,
  WorkflowOutputBinding,
  WorkflowOutputDescriptor,
  WorkflowValueSchema
} from '@unilab/services'

export interface WorkflowInputTargetBinding {
  parameter: string
  workflowNodeUuid: string
  targetHandleUuid: string
}

export interface WorkflowIoBindingOptions {
  inputTargets: Array<{
    workflowNodeUuid: string
    targetHandleUuid: string
  }>
  outputSources: Array<
    | { kind: 'workflow_input'; parameter: string }
    | {
        kind: 'node_output'
        workflowNodeUuid: string
        sourceHandleUuid: string
      }
  >
}

export function addWorkflowInput(
  graph: WorkflowAuthoringGraph,
  descriptor: WorkflowInputDescriptor
): WorkflowAuthoringGraph {
  requireInputDescriptorContract(descriptor)
  const next = cloneGraph(graph)
  const io = mutableIo(next)
  requireNewName(
    descriptor.name,
    io.inputContract.parameters.map(({ name }) => name),
    'Workflow input'
  )
  io.inputContract.parameters.push(structuredClone(descriptor))
  synchronizeImplicitOutputs(io)
  return next
}

export function updateWorkflowInput(
  graph: WorkflowAuthoringGraph,
  currentName: string,
  descriptor: WorkflowInputDescriptor
): WorkflowAuthoringGraph {
  requireInputDescriptorContract(descriptor)
  const next = cloneGraph(graph)
  const io = mutableIo(next)
  const index = requireNamedIndex(
    currentName,
    io.inputContract.parameters,
    'Workflow input'
  )
  requireAvailableName(
    descriptor.name,
    currentName,
    io.inputContract.parameters.map(({ name }) => name),
    'Workflow input'
  )
  if (
    descriptor.name !== currentName &&
    io.outputContract.outputs.some(({ name, implicit }) =>
      name === descriptor.name && !implicit
    )
  ) {
    throw new Error('工作流入参名称与显式出参冲突')
  }
  io.inputContract.parameters[index] = structuredClone(descriptor)
  if (descriptor.name !== currentName) {
    renameInputBindings(next, currentName, descriptor.name)
    for (const binding of Object.values(io.outputBindings)) {
      if (
        binding.kind === 'workflow_input' &&
        binding.parameter === currentName
      ) binding.parameter = descriptor.name
    }
    const oldImplicit = io.outputContract.outputs.find(
      ({ name, implicit }) => name === currentName && implicit
    )
    if (oldImplicit) {
      oldImplicit.name = descriptor.name
      io.outputBindings[descriptor.name] =
        io.outputBindings[currentName] ?? {
          kind: 'workflow_input',
          parameter: descriptor.name
        }
      delete io.outputBindings[currentName]
    }
  }
  synchronizeImplicitOutputs(io)
  return next
}

export function removeWorkflowInput(
  graph: WorkflowAuthoringGraph,
  name: string
): WorkflowAuthoringGraph {
  const next = cloneGraph(graph)
  const io = mutableIo(next)
  const index = requireNamedIndex(
    name,
    io.inputContract.parameters,
    'Workflow input'
  )
  io.inputContract.parameters.splice(index, 1)
  removeInputBindings(next, name)
  for (const [outputName, binding] of Object.entries(io.outputBindings)) {
    if (
      binding.kind === 'workflow_input' &&
      binding.parameter === name
    ) delete io.outputBindings[outputName]
  }
  io.outputContract.outputs = io.outputContract.outputs.filter(
    (output) => !(output.name === name && output.implicit)
  )
  synchronizeImplicitOutputs(io)
  return next
}

export function moveWorkflowInput(
  graph: WorkflowAuthoringGraph,
  name: string,
  direction: 'up' | 'down'
): WorkflowAuthoringGraph {
  const next = cloneGraph(graph)
  const parameters = mutableIo(next).inputContract.parameters
  moveNamedDescriptor(parameters, name, direction, 'Workflow input')
  return next
}

export function bindWorkflowInput(
  graph: WorkflowAuthoringGraph,
  binding: WorkflowInputTargetBinding
): WorkflowAuthoringGraph {
  const next = cloneGraph(graph)
  const io = mutableIo(next)
  if (!io.inputContract.parameters.some(
    ({ name }) => name === binding.parameter
  )) throw new Error('工作流入参不存在')
  requireOwnedHandle(
    next,
    binding.workflowNodeUuid,
    binding.targetHandleUuid,
    'target'
  )
  next.nodes = next.nodes.map((node) => {
    if (node.uuid !== binding.workflowNodeUuid) return node
    const metaData = recordOrEmpty(node.meta_data)
    const unilab = recordOrEmpty(metaData.unilab)
    return {
      ...node,
      meta_data: {
        ...metaData,
        unilab: {
          ...unilab,
          input_bindings: {
            ...recordOrEmpty(unilab.input_bindings),
            [binding.targetHandleUuid]: { parameter: binding.parameter }
          }
        }
      }
    }
  })
  return next
}

export function unbindWorkflowInput(
  graph: WorkflowAuthoringGraph,
  workflowNodeUuid: string,
  targetHandleUuid: string
): WorkflowAuthoringGraph {
  const next = cloneGraph(graph)
  requireOwnedHandle(next, workflowNodeUuid, targetHandleUuid, 'target')
  next.nodes = next.nodes.map((node) => {
    if (node.uuid !== workflowNodeUuid) return node
    const metaData = recordOrEmpty(node.meta_data)
    const unilab = recordOrEmpty(metaData.unilab)
    const inputBindings = { ...recordOrEmpty(unilab.input_bindings) }
    delete inputBindings[targetHandleUuid]
    return {
      ...node,
      meta_data: {
        ...metaData,
        unilab: { ...unilab, input_bindings: inputBindings }
      }
    }
  })
  return next
}

export function addWorkflowOutput(
  graph: WorkflowAuthoringGraph,
  descriptor: WorkflowOutputDescriptor
): WorkflowAuthoringGraph {
  if (descriptor.implicit) {
    throw new Error('系统生成的工作流出参由服务器管理，不可新增')
  }
  const next = cloneGraph(graph)
  const io = mutableIo(next)
  requireNewName(
    descriptor.name,
    io.outputContract.outputs.map(({ name }) => name),
    'Workflow output'
  )
  io.outputContract.outputs.push({
    ...structuredClone(descriptor),
    implicit: false
  })
  return next
}

export function updateWorkflowOutput(
  graph: WorkflowAuthoringGraph,
  currentName: string,
  descriptor: WorkflowOutputDescriptor
): WorkflowAuthoringGraph {
  const next = cloneGraph(graph)
  const io = mutableIo(next)
  const index = requireNamedIndex(
    currentName,
    io.outputContract.outputs,
    'Workflow output'
  )
  if (io.outputContract.outputs[index]?.implicit || descriptor.implicit) {
    throw new Error('系统生成的工作流出参不可修改')
  }
  requireAvailableName(
    descriptor.name,
    currentName,
    io.outputContract.outputs.map(({ name }) => name),
    'Workflow output'
  )
  io.outputContract.outputs[index] = {
    ...structuredClone(descriptor),
    implicit: false
  }
  if (descriptor.name !== currentName) {
    const binding = io.outputBindings[currentName]
    if (binding) io.outputBindings[descriptor.name] = binding
    delete io.outputBindings[currentName]
  }
  return next
}

export function removeWorkflowOutput(
  graph: WorkflowAuthoringGraph,
  name: string
): WorkflowAuthoringGraph {
  const next = cloneGraph(graph)
  const io = mutableIo(next)
  const index = requireNamedIndex(
    name,
    io.outputContract.outputs,
    'Workflow output'
  )
  if (io.outputContract.outputs[index]?.implicit) {
    throw new Error('系统生成的工作流出参不可删除')
  }
  io.outputContract.outputs.splice(index, 1)
  delete io.outputBindings[name]
  return next
}

export function moveWorkflowOutput(
  graph: WorkflowAuthoringGraph,
  name: string,
  direction: 'up' | 'down'
): WorkflowAuthoringGraph {
  const next = cloneGraph(graph)
  const outputs = mutableIo(next).outputContract.outputs
  const output = outputs.find((item) => item.name === name)
  if (output?.implicit) {
    throw new Error('系统生成的工作流出参顺序由服务器管理')
  }
  moveNamedDescriptor(outputs, name, direction, 'Workflow output')
  return next
}

export function bindWorkflowOutput(
  graph: WorkflowAuthoringGraph,
  name: string,
  binding: WorkflowOutputBinding
): WorkflowAuthoringGraph {
  const next = cloneGraph(graph)
  const io = mutableIo(next)
  const output = io.outputContract.outputs.find((item) => item.name === name)
  if (!output) throw new Error('工作流出参不存在')
  if (output.implicit) {
    throw new Error('系统生成的工作流出参绑定不可修改')
  }
  if (binding.kind === 'workflow_input') {
    if (!io.inputContract.parameters.some(
      ({ name }) => name === binding.parameter
    )) throw new Error('工作流入参不存在')
  } else {
    requireOwnedHandle(
      next,
      binding.workflow_node_uuid,
      binding.source_handle_uuid,
      'source'
    )
  }
  io.outputBindings[name] = structuredClone(binding)
  return next
}

export function unbindWorkflowOutput(
  graph: WorkflowAuthoringGraph,
  name: string
): WorkflowAuthoringGraph {
  const next = cloneGraph(graph)
  const io = mutableIo(next)
  const output = io.outputContract.outputs.find((item) => item.name === name)
  if (!output) throw new Error('工作流出参不存在')
  if (output.implicit) {
    throw new Error('系统生成的工作流出参绑定不可解除')
  }
  delete io.outputBindings[name]
  return next
}

export function projectWorkflowIoBindingOptions(
  graph: WorkflowAuthoringGraph
): WorkflowIoBindingOptions {
  const io = mutableIo(cloneGraph(graph))
  const inputTargets: WorkflowIoBindingOptions['inputTargets'] = []
  const outputSources: WorkflowIoBindingOptions['outputSources'] =
    io.inputContract.parameters.map(({ name }) => ({
      kind: 'workflow_input',
      parameter: name
    }))
  for (const node of graph.nodes) {
    // Group nodes only describe canvas hierarchy. They do not own a published
    // Workflow Node template or any bindable Handles.
    if (node.type === 'group') continue
    const nodeUuid = requiredString(node.uuid, 'Workflow Node UUID')
    const templateUuid = requiredString(
      node.workflow_node_template_uuid,
      'Workflow Node template UUID'
    )
    for (const handle of graph.handle_templates) {
      if (handle.workflow_node_template_uuid !== templateUuid) continue
      const handleUuid = requiredString(handle.uuid, 'Workflow Handle UUID')
      if (handle.io_type === 'target') {
        inputTargets.push({
          workflowNodeUuid: nodeUuid,
          targetHandleUuid: handleUuid
        })
      } else if (handle.io_type === 'source') {
        outputSources.push({
          kind: 'node_output',
          workflowNodeUuid: nodeUuid,
          sourceHandleUuid: handleUuid
        })
      }
    }
  }
  return { inputTargets, outputSources }
}

interface MutableIo {
  inputContract: { version: 1; parameters: WorkflowInputDescriptor[] }
  outputContract: { version: 1; outputs: WorkflowOutputDescriptor[] }
  outputBindings: Record<string, WorkflowOutputBinding>
}

function mutableIo(graph: WorkflowAuthoringGraph): MutableIo {
  const metaData = recordOrEmpty(graph.workflow.meta_data)
  const unilab = recordOrEmpty(metaData.unilab)
  const inputContract = recordOrEmpty(unilab.input_contract)
  const outputContract = recordOrEmpty(unilab.output_contract)
  const outputBindings = recordOrEmpty(unilab.output_bindings)
  const parameters = Array.isArray(inputContract.parameters)
    ? inputContract.parameters as WorkflowInputDescriptor[]
    : []
  const outputs = Array.isArray(outputContract.outputs)
    ? outputContract.outputs as WorkflowOutputDescriptor[]
    : []
  const io: MutableIo = {
    inputContract: { version: 1, parameters },
    outputContract: { version: 1, outputs },
    outputBindings: outputBindings as Record<string, WorkflowOutputBinding>
  }
  graph.workflow.meta_data = {
    ...metaData,
    unilab: {
      ...unilab,
      input_contract: io.inputContract,
      output_contract: io.outputContract,
      output_bindings: io.outputBindings
    }
  }
  return io
}

function synchronizeImplicitOutputs(io: MutableIo): void {
  const slotInputs = new Map(
    io.inputContract.parameters
      .filter(({ schema }) => containsResourceSlot(schema))
      .map((descriptor) => [descriptor.name, descriptor])
  )
  io.outputContract.outputs = io.outputContract.outputs.filter(
    ({ name, implicit }) => !implicit || slotInputs.has(name)
  )
  for (const [name, descriptor] of slotInputs) {
    const existing = io.outputContract.outputs.find(
      (output) => output.name === name
    )
    // D-068 keeps historical explicit same-name outputs compatible. The OS
    // checks their schema assignability; FE only synthesizes the server-managed
    // pass-through when no explicit producer already owns that output name.
    if (existing && !existing.implicit) continue
    const implicit: WorkflowOutputDescriptor = {
      name,
      schema: structuredClone(descriptor.schema),
      implicit: true
    }
    if (existing) {
      io.outputContract.outputs[
        io.outputContract.outputs.indexOf(existing)
      ] = implicit
    } else {
      io.outputContract.outputs.push(implicit)
    }
    io.outputBindings[name] = {
      kind: 'workflow_input',
      parameter: name
    }
  }
  const outputNames = new Set(io.outputContract.outputs.map(({ name }) => name))
  for (const name of Object.keys(io.outputBindings)) {
    if (!outputNames.has(name)) delete io.outputBindings[name]
  }
}

function containsResourceSlot(schema: WorkflowValueSchema): boolean {
  if ('$slot' in schema) return true
  if ('anyOf' in schema) return containsResourceSlot(schema.anyOf[0])
  return schema.type === 'array' && containsResourceSlot(schema.items)
}

function requireInputDescriptorContract(
  descriptor: WorkflowInputDescriptor
): void {
  const nullable = 'anyOf' in descriptor.schema
  const hasDefault = Object.hasOwn(descriptor, 'default')
  if (descriptor.required) {
    if (nullable || hasDefault) {
      throw new Error('必填的工作流入参不能允许为空，也不能设置默认值')
    }
    return
  }
  if (containsResourceSlot(descriptor.schema) && !nullable) {
    throw new Error('选填的资源位工作流入参必须允许为空')
  }
  if (!hasDefault) {
    throw new Error('选填的工作流入参必须声明默认值')
  }
  if (nullable && descriptor.default !== null) {
    throw new Error('允许为空的工作流入参，其默认值必须是 null')
  }
}

function moveNamedDescriptor<T extends { name: string }>(
  descriptors: T[],
  name: string,
  direction: 'up' | 'down',
  label: string
): void {
  const index = requireNamedIndex(name, descriptors, label)
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= descriptors.length) return
  const current = descriptors[index]
  const replacement = descriptors[target]
  if (!current || !replacement) return
  descriptors[index] = replacement
  descriptors[target] = current
}

function renameInputBindings(
  graph: WorkflowAuthoringGraph,
  currentName: string,
  nextName: string
): void {
  for (const node of graph.nodes) {
    const metaData = recordOrEmpty(node.meta_data)
    const unilab = recordOrEmpty(metaData.unilab)
    const inputBindings = recordOrEmpty(unilab.input_bindings)
    for (const value of Object.values(inputBindings)) {
      const binding = recordOrEmpty(value)
      if (binding.parameter === currentName) binding.parameter = nextName
    }
  }
}

function removeInputBindings(
  graph: WorkflowAuthoringGraph,
  name: string
): void {
  for (const node of graph.nodes) {
    const metaData = recordOrEmpty(node.meta_data)
    const unilab = recordOrEmpty(metaData.unilab)
    const inputBindings = recordOrEmpty(unilab.input_bindings)
    for (const [handleUuid, value] of Object.entries(inputBindings)) {
      if (recordOrEmpty(value).parameter === name) delete inputBindings[handleUuid]
    }
  }
}

function requireOwnedHandle(
  graph: WorkflowAuthoringGraph,
  nodeUuid: string,
  handleUuid: string,
  ioType: 'source' | 'target'
): void {
  const node = graph.nodes.find(({ uuid }) => uuid === nodeUuid)
  if (!node) throw new Error('工作流节点不存在')
  const handle = graph.handle_templates.find(({ uuid }) => uuid === handleUuid)
  if (
    !handle ||
    handle.io_type !== ioType ||
    handle.workflow_node_template_uuid !== node.workflow_node_template_uuid
  ) {
    throw new Error(
      `Workflow ${ioType} Handle 不存在或不属于所选节点 owner`
    )
  }
}

function requireNamedIndex(
  name: string,
  values: Array<{ name: string }>,
  label: string
): number {
  const index = values.findIndex((item) => item.name === name)
  if (index < 0) throw new Error(`${label} 不存在`)
  return index
}

function requireNewName(
  name: string,
  names: string[],
  label: string
): void {
  requireName(name, label)
  if (names.includes(name)) throw new Error(`${label} 名称重复`)
}

function requireAvailableName(
  name: string,
  currentName: string,
  names: string[],
  label: string
): void {
  requireName(name, label)
  if (name !== currentName && names.includes(name)) {
    throw new Error(`${label} 名称重复`)
  }
}

function requireName(name: string, label: string): void {
  if (!name.trim()) throw new Error(`${label} 名称不能为空`)
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} 缺失`)
  return value
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function cloneGraph(graph: WorkflowAuthoringGraph): WorkflowAuthoringGraph {
  return structuredClone(graph)
}
