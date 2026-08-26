import { BoxGeometry, Group, Mesh } from 'three'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@pascal-app/core', () => ({
  sceneRegistry: { nodes: new Map() }
}))
vi.mock('@pascal-app/viewer', () => ({
  useViewer: {
    getState: () => ({ geometryRevision: 0, itemLoadFailures: {} })
  }
}))

import { inspectMaterialSceneObject } from './materialSceneRuntime'

describe('Pascal 物料场景运行时回读', () => {
  it('返回唯一 Three 场景中父子链计算后的世界坐标', () => {
    const railLink = new Group()
    railLink.name = 'robot_rail_carriage_link'
    railLink.position.set(0.45, 0.1, -0.2)
    const robot = new Group()
    robot.name = 'robot_arm_tool0'
    robot.position.set(0.2, 0.3, 0.4)
    const payload = new Group()
    payload.position.set(0, 0, 0.14)
    payload.add(new Mesh(new BoxGeometry(0.01, 0.02, 0.03)))
    railLink.add(robot)
    robot.add(payload)

    const state = inspectMaterialSceneObject('lab-payload', payload)

    expect(state.nodeId).toBe('lab-payload')
    expect(state.parentName).toBe('robot_arm_tool0')
    expect(state.meshCount).toBe(1)
    expect(state.geometryTypes).toEqual(['BoxGeometry'])
    expect(state.worldPositionM).toEqual([0.65, 0.4, 0.34])
    expect(state.worldOrientationXyzw).toEqual([0, 0, 0, 1])
  })
})
