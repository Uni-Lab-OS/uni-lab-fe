import type { WorkflowAuthoringGraph } from '@unilab/services'
import { describe, expect, it } from 'vitest'

import {
  authoringSafeIdentifier,
  reorderAuthoringSourceAfterConnection
} from './workflowAuthoringNodeIdentity'

function graphOf(ids: string[], edges: string[][] = []): WorkflowAuthoringGraph {
  return {
    workflow: { uuid: 'workflow' },
    nodes: ids.map((uuid, index) => ({
      uuid,
      type: 'device',
      pose: { x: index * 100, y: 20 },
      meta_data: {
        custom: 'preserved',
        unilab: {
          authoring_source_order: index,
          authoring_result_name: uuid,
          input_bindings: { input: { parameter: 'sample' } }
        }
      }
    })),
    edges: edges.map(([source, target], index) => ({
      uuid: `edge-${index}`,
      source_node_uuid: source,
      target_node_uuid: target
    })),
    node_templates: [],
    handle_templates: []
  }
}

function sourceIds(graph: WorkflowAuthoringGraph): string[] {
  return [...graph.nodes].sort((left, right) => orderOf(left) - orderOf(right))
    .map((node) => String(node.uuid))
}

function orderOf(node: WorkflowAuthoringGraph['nodes'][number]): number {
  return (node.meta_data as { unilab: { authoring_source_order: number } })
    .unilab.authoring_source_order
}

describe('连线后的作者源码顺序', () => {
  it('把后添加的上游排到整条下游链之前，并保留图内容和原草稿', () => {
    const graph = graphOf(['a', 'b', 'source'], [['a', 'b'], ['source', 'a']])
    const original = structuredClone(graph)
    const next = reorderAuthoringSourceAfterConnection(graph)
    expect(sourceIds(next)).toEqual(['source', 'a', 'b'])
    expect(next.nodes.map((node) => node.uuid)).toEqual(['a', 'b', 'source'])
    expect(next.edges).toBe(graph.edges)
    next.nodes.forEach((node, index) => {
      expect(node.pose).toEqual(original.nodes[index]!.pose)
      expect(node.meta_data).toMatchObject({
        custom: 'preserved',
        unilab: {
          authoring_result_name: node.uuid,
          input_bindings: { input: { parameter: 'sample' } }
        }
      })
    })
    expect(graph).toEqual(original)
    expect(reorderAuthoringSourceAfterConnection(next)).toEqual(next)
  })

  it('保留已有有效顺序，优先按源码编号而非节点数组排序', () => {
    const graph = graphOf(['a', 'b', 'c'], [['a', 'c'], ['b', 'c']])
    graph.nodes.reverse()
    const next = reorderAuthoringSourceAfterConnection(graph)
    expect(sourceIds(next)).toEqual(['a', 'b', 'c'])
    expect(next.nodes).toEqual(graph.nodes)
  })

  it('分支汇合和重复节点对连线按依赖排序，孤立节点保持稳定', () => {
    const graph = graphOf(['join', 'left', 'right', 'isolated', 'source'], [
      ['source', 'left'], ['source', 'left'], ['source', 'right'],
      ['left', 'join'], ['right', 'join']
    ])
    expect(sourceIds(reorderAuthoringSourceAfterConnection(graph)))
      .toEqual(['isolated', 'source', 'left', 'right', 'join'])
  })

  it('补齐缺失或重复的编号', () => {
    const graph = graphOf(['a', 'b', 'c'], [['c', 'a']])
    graph.nodes[0]!.meta_data = {}
    graph.nodes[2]!.meta_data = structuredClone(graph.nodes[1]!.meta_data)
    const next = reorderAuthoringSourceAfterConnection(graph)
    expect(sourceIds(next)).toEqual(['b', 'c', 'a'])
    expect(next.nodes.map(orderOf)).toEqual([2, 0, 1])
  })

  it('拒绝环路和悬空连线，不修改输入图', () => {
    const graph = graphOf(['a', 'b'], [['a', 'b'], ['b', 'a']])
    const original = structuredClone(graph)
    expect(() => reorderAuthoringSourceAfterConnection(graph)).toThrow('环路')
    expect(graph).toEqual(original)
    expect(() => reorderAuthoringSourceAfterConnection(graphOf(['a'], [['a', 'missing']])))
      .toThrow('不存在的节点')
  })
})

describe('作者安全标识符', () => {
  it('把全中文符号名清洗为回退名，而不是一串下划线', () => {
    // 回归：拖入以中文命名的已发布工作流时，旧逻辑逐字符替换为 `_`，
    // 得到形如 `____` 的合法但无意义的节点名。
    expect(authoringSafeIdentifier('阿事实上', 'workflow')).toBe('workflow')
    expect(authoringSafeIdentifier('子工作流', 'workflow')).toBe('workflow')
  })

  it('去除首尾下划线并保留内部合法片段', () => {
    expect(authoringSafeIdentifier('阿a事b', 'workflow')).toBe('a_b')
    expect(authoringSafeIdentifier('__mix__', 'workflow')).toBe('mix')
  })

  it('数字开头或 Python 关键字都退化为安全名', () => {
    expect(authoringSafeIdentifier('3d扫描', 'workflow')).toBe('workflow')
    expect(authoringSafeIdentifier('class', 'workflow')).toBe('class_value')
  })
})
