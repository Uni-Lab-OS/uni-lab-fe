import { WorkbenchLaunchError } from './launch-error'

const MAX_STARTUP_OUTPUT_CHARACTERS = 128 * 1024
const ANSI_SEQUENCE = /\u001B\[[0-?]*[ -/]*[@-~]/g

export interface WorkbenchStartupFailureMonitor {
  observe(chunk: string | Uint8Array): void
  failure(): WorkbenchLaunchError | null
}

/** Retain the first fatal startup diagnosis while stdout/stderr continue flowing. */
export function createWorkbenchStartupFailureMonitor(): WorkbenchStartupFailureMonitor {
  let output = ''
  let detectedFailure: WorkbenchLaunchError | null = null

  return {
    observe(chunk) {
      if (detectedFailure) return
      const text = typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk).toString('utf8')
      output = `${output}${text}`
        .replace(ANSI_SEQUENCE, '')
        .slice(-MAX_STARTUP_OUTPUT_CHARACTERS)
      detectedFailure = diagnoseFatalWorkbenchStartupOutput(output)
    },
    failure() {
      return detectedFailure
    }
  }
}

/**
 * Recognize only a terminal PLC/OPC UA failure in the OS backend thread.
 * A temporary `Host node not initialized` response is intentionally insufficient.
 */
export function diagnoseFatalWorkbenchStartupOutput(
  output: string
): WorkbenchLaunchError | null {
  const backendThreadMatch = /Exception in thread ["']?backend_thread["']?:?/ig
  const matches = [...output.matchAll(backendThreadMatch)]
  const lastBackendThreadFailure = matches.at(-1)
  if (lastBackendThreadFailure?.index === undefined) return null

  const traceback = output.slice(lastBackendThreadFailure.index)
  const hostInitializationContext = /(?:HostNode|host_node\.py|initialize_device)/i
    .test(traceback)
  const plcOrOpcUaContext = /(?:szlab_poly_plc|opcua[./\\]|OPC\s*UA|connect_socket)/i
    .test(traceback)
  const connectionContext = /(?:client connect failed|connect_socket|socket\.create_connection)/i
    .test(traceback)

  if (!hostInitializationContext || !plcOrOpcUaContext || !connectionContext) {
    return null
  }

  if (
    /(?:socket\.gaierror|nodename nor servname|name or service not known|getaddrinfo failed)/i
      .test(traceback)
  ) {
    return new WorkbenchLaunchError(
      'plc_connection_failed',
      '无法解析 PLC 的 OPC UA 主机名，OS 设备目录未完成初始化。',
      '检查设备图中的 PLC OPC UA 地址；使用本机 PLC-Sim 时应填写其 127.0.0.1 地址和实际端口，确认服务已启动后重试。'
    )
  }

  if (
    /(?:ConnectionRefusedError|WinError 10061|connection refused|actively refused)/i
      .test(traceback)
  ) {
    return new WorkbenchLaunchError(
      'plc_connection_failed',
      'PLC 的 OPC UA 连接被拒绝，OS 设备目录未完成初始化。',
      '启动 PLC 或 PLC-Sim，并确认设备图中的 OPC UA 地址和端口与服务监听地址一致后重试。'
    )
  }

  if (/(?:socket\.timeout|TimeoutError|timed out|connection timeout)/i.test(traceback)) {
    return new WorkbenchLaunchError(
      'plc_connection_failed',
      '连接 PLC 的 OPC UA 服务超时，OS 设备目录未完成初始化。',
      '检查 PLC 网络可达性、OPC UA 地址和端口，确认服务可连接后重试。'
    )
  }

  return null
}
