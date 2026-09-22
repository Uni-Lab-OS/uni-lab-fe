import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowCanvasDebugMode } from './WorkflowCanvasDebugMode'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'

function model(overrides = {}): PersistentWorkflowAuthoringModel {
  return { aggregate: {}, taskRunMode: 'normal', busy: false, task: null,
    setTaskRunMode: vi.fn(), ...overrides } as unknown as PersistentWorkflowAuthoringModel
}

describe('画布调试模式', () => {
  it('通过同一运行模型切换单步，不会创建任务', () => {
    const state = model()
    const view = WorkflowCanvasDebugMode({ model: state })
    const select = view.props.children[0]
    select.props.onChange({ currentTarget: { value: 'step' } })
    expect(state.setTaskRunMode).toHaveBeenCalledTimes(1)
    expect(state.setTaskRunMode).toHaveBeenCalledWith('step')
  })

  it('不允许选择未支持的运行到节点或不可用的调试能力', () => {
    const state = model({ debugLaunchAvailable: false })
    const select = WorkflowCanvasDebugMode({ model: state }).props.children[0]
    for (const value of ['run-to-node', 'debug']) select.props.onChange({ currentTarget: { value } })
    expect(state.setTaskRunMode).not.toHaveBeenCalled()
    const html = renderToStaticMarkup(<WorkflowCanvasDebugMode model={state} />)
    expect(html).toContain('value="run-to-node" disabled=""')
    expect(html).toContain('value="debug" disabled=""')
  })

  it('运行输入确认期间锁定模式并展示当前选择', () => {
    const state = model({ taskInputForm: {}, taskRunMode: 'step' })
    const select = WorkflowCanvasDebugMode({ model: state }).props.children[0]
    select.props.onChange({ currentTarget: { value: 'normal' } })
    expect(state.setTaskRunMode).not.toHaveBeenCalled()
    expect(select.props.disabled).toBe(true)
    expect(renderToStaticMarkup(<WorkflowCanvasDebugMode model={state} />))
      .toContain('当前调试模式：单步调试')
  })
})
