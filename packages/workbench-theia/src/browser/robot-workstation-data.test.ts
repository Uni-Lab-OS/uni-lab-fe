import type { MaterialAggregate } from '@unilab/material'
import { describe, expect, it } from 'vitest'

import { projectBenchSnapshot, projectReagentContainers } from './robot-workstation-data'

describe('robot workstation real-data projection', () => {
  /** 证明实验台从公共物料图解析库位占用、真实毫米位置且不生成模拟历史。 */
  it('projects authoritative site occupancy without fixture records', () => {
    const bench = aggregate({
      id: 'bench-1',
      name: '实验台一号',
      template: 'bench-template',
      sites: [{
        id: 'site-1',
        ownerMaterialId: 'bench-1',
        key: 'slot-1',
        name: '加料位',
        anchor: { kind: 'root' },
        poseInAnchor: {
          positionMm: [100, 200, 30],
          rotationDegXYZ: [0, 0, 0]
        },
        sizeMm: [80, 60, 10],
        capacity: 1,
        allowedTemplateIds: ['reagent-template'],
        occupiedMaterialIds: ['bottle-1']
      }]
    })
    const bottle = aggregate({
      id: 'bottle-1',
      name: '乙醇瓶',
      template: 'reagent-template',
      placement: {
        kind: 'site',
        parentId: 'bench-1',
        siteId: 'site-1',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    expect(projectBenchSnapshot([bench, bottle])).toEqual({
      sites: [{
        id: 'site-1',
        name: '加料位',
        device: '实验台一号',
        position: '100 mm, 200 mm, 30 mm',
        materialType: 'reagent-template',
        materialName: '乙醇瓶',
        workflowLabel: null,
        status: 'occupied',
        x: 100,
        y: 200,
        width: 80
      }],
      materials: [{
        id: 'bottle-1',
        name: '乙醇瓶',
        template: 'reagent-template',
        location: '加料位',
        status: 'idle',
        workflowLabel: null,
        siteId: 'site-1'
      }],
      history: []
    })
  })

  /** 证明 placement 与 SiteOccupancy 不一致时前端不会宣称已确认放置。 */
  it('keeps inconsistent physical placement unknown', () => {
    const bench = aggregate({
      id: 'bench-1',
      name: '实验台一号',
      template: 'bench-template',
      sites: [{
        id: 'site-1',
        ownerMaterialId: 'bench-1',
        key: 'slot-1',
        name: '加料位',
        anchor: { kind: 'root' },
        poseInAnchor: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        },
        sizeMm: [50, 50, 10],
        capacity: 1,
        allowedTemplateIds: [],
        occupiedMaterialIds: []
      }]
    })
    const bottle = aggregate({
      id: 'bottle-1',
      name: '状态不明物料',
      template: 'reagent-template',
      placement: {
        kind: 'site',
        parentId: 'bench-1',
        siteId: 'site-1',
        offsetPose: {
          positionMm: [0, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      }
    })

    expect(projectBenchSnapshot([bench, bottle]).materials[0]?.status).toBe('unknown')
  })

  /** 证明试剂创建候选只接受 Backend 模板明确带 container 标签的物料。 */
  it('projects only tagged Backend containers for reagent selection', () => {
    const bottle = aggregate({
      id: 'bottle-1',
      name: '空试剂瓶',
      template: 'container-template'
    })
    const device = aggregate({
      id: 'device-1',
      name: '机械臂',
      template: 'device-template'
    })

    expect(projectReagentContainers([device, bottle], [{
      uuid: 'container-template',
      tags: ['容器', 'container']
    }, {
      uuid: 'device-template',
      tags: ['device']
    }])).toEqual([{
      id: 'bottle-1',
      name: '空试剂瓶',
      barcode: 'bottle-1',
      templateId: 'container-template'
    }])
  })
})

/**
 * 创建最小合法的公共物料图聚合，供投影合同测试使用。
 * @param input 需要覆盖的物料身份、放置关系与库位集合。
 * @returns 符合 MaterialAggregate 合同的测试记录。
 */
function aggregate(input: {
  id: string
  name: string
  template: string
  placement?: MaterialAggregate['placement']
  sites?: MaterialAggregate['sites']
}): MaterialAggregate {
  return {
    material: {
      id: input.id,
      sourceTemplateId: input.template,
      code: input.id,
      name: input.name,
      config: {},
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z'
    },
    placement: input.placement ?? { kind: 'unplaced' },
    sites: input.sites ?? [],
    revision: 1
  }
}
