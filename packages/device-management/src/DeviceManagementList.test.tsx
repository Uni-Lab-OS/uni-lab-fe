import type { Services } from '@unilab/services'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { DeviceManagementList } from './DeviceManagementList'

describe('DeviceManagementList', () => {
  it('renders a list-only device management surface without detail or AI creation', () => {
    const markup = renderToStaticMarkup(
      <DeviceManagementList
        services={servicesFixture()}
        backend={{ id: 'local', name: 'Workspace Backend', apiUrl: '' }}
        backendEnabled={false}
        connection="disconnected"
        onOpenActions={vi.fn()}
      />
    )

    expect(markup).toContain('data-device-management="list"')
    expect(markup).toContain('设备管理')
    expect(markup).toContain('等待设备连接')
    expect(markup).not.toContain('查看详情')
    expect(markup).not.toContain('AI 创建设备')
  })
})

/** 构造 SSR 所需的只读服务轮廓；effect 不会发起设备请求。 */
function servicesFixture(): Services {
  return {
    laboratory: {},
    capabilities: { devices: { listActions: true } },
    getCapabilityStatus: () => ({ available: true })
  } as unknown as Services
}
