import { useEffect, useRef } from 'react'
import { useServices } from '@unilab/services'

import { createAuthoringTarget } from '../../data/authoringContext'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import { buildDeviceCardRuntimeState } from './runtimeState'

/**
 * Production Adapter for the main-process Authoring Automation Module.
 * It exposes only the neutral device-card contract, never Services, URLs or tokens.
 */
export function DeviceCardAuthoringTargetConnector(): null {
  const services = useServices()
  const authoring = window.api?.deviceCards?.authoring
  const { statusMap } = useDeviceStatus()
  const statusMapRef = useRef(statusMap)
  statusMapRef.current = statusMap

  useEffect(() => {
    if (!authoring) return
    return authoring.onTargetRequest((request) => {
      void services.laboratory.getDeviceCatalog().then(
        (devices) => authoring.resolveTargetRequest({
          requestId: request.requestId,
          ok: true,
          targets: devices.map((device) => createAuthoringTarget(
            device,
            buildDeviceCardRuntimeState(device, statusMapRef.current)
          ))
        }),
        (error: unknown) => authoring.resolveTargetRequest({
          requestId: request.requestId,
          ok: false,
          message: error instanceof Error
            ? error.message
            : '无法读取 OS 设备目录。'
        })
      )
    })
  }, [authoring, services.laboratory])

  return null
}
