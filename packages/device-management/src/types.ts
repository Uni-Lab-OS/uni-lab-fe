import type { Services } from '@unilab/services'

export type DeviceManagementConnection =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

export interface DeviceManagementBackend {
  id: string
  name: string
  apiUrl: string
}

export interface DeviceManagementPanelProps {
  services: Services
  backend: DeviceManagementBackend
  connection: DeviceManagementConnection
  backendEnabled?: boolean
  active?: boolean
}
