import { useEffect, useState } from 'react'

import { useWorkbench } from '../context/WorkbenchContext'
import { shouldShowConnectionRecovery } from '../context/connectionPolicy'
import { useBackendConnection } from '../hooks/useBackendConnection'

import styles from './ConnectionBar.module.scss'
import LocalRuntimeLauncher, {
  LocalRuntimeLogLauncher
} from './LocalRuntimeLauncher'

const LOCAL_RUNTIME_EDGE_API_URL = 'http://127.0.0.1:18003'

export default function ConnectionBar(): React.JSX.Element {
  const {
    backend,
    backendEnabled,
    connection,
    availableBackends,
    selectBackend,
    updateBackend
  } = useWorkbench()
  const { reconnect } = useBackendConnection()
  const [draftUrl, setDraftUrl] = useState(backend.apiUrl)

  useEffect(() => {
    setDraftUrl(backend.apiUrl)
  }, [backend.id, backend.apiUrl])

  const showRecovery = shouldShowConnectionRecovery(
    backendEnabled,
    connection
  )
  const trimmedDraftUrl = draftUrl.trim()
  const hasDraftChange = trimmedDraftUrl !== backend.apiUrl
  const targetName = backend.serverKind === 'edge' ? 'Edge' : backend.name
  const showConnected = backendEnabled && connection === 'connected'
  const showDisconnected = backendEnabled && connection === 'disconnected'
  const statusLabel = showRecovery
    ? `${targetName} 连接失败`
    : showConnected
      ? `${targetName} 已连接`
      : showDisconnected
        ? `${targetName} 未连接`
        : null

  const handleApply = (): void => {
    const trimmed = draftUrl.trim()
    if (!trimmed) return
    if (trimmed !== backend.apiUrl) {
      updateBackend({ apiUrl: trimmed })
      return
    }
    void reconnect()
  }

  const handleRuntimeReady = (): void => {
    if (backend.id !== 'local-python') {
      selectBackend('local-python')
      return
    }
    if (backend.apiUrl !== LOCAL_RUNTIME_EDGE_API_URL) {
      updateBackend({ apiUrl: LOCAL_RUNTIME_EDGE_API_URL })
      return
    }
    void reconnect()
  }

  return (
    <div
      className={[
        styles.root,
        showRecovery ? styles.error : '',
        showConnected ? styles.connected : ''
      ].filter(Boolean).join(' ')}
      role="group"
      aria-label={`${targetName} 连接配置`}
      data-connection-state={connection}
    >
      <LocalRuntimeLogLauncher />
      {statusLabel ? (
        <span
          className={styles.status}
          role={showRecovery ? 'alert' : 'status'}
        >
          <span className={styles.statusDot} aria-hidden="true" />
          {statusLabel}
        </span>
      ) : null}
      <select
        className={styles.field}
        aria-label="切换服务配置"
        value={backend.id}
        onChange={(event) => selectBackend(event.target.value)}
      >
        {availableBackends.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </select>
      <input
        className={`${styles.field} ${styles.url}`}
        aria-label="服务 API 地址"
        value={draftUrl}
        spellCheck={false}
        placeholder="服务 API 地址"
        aria-invalid={showRecovery || undefined}
        onChange={(event) => setDraftUrl(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (hasDraftChange || showRecovery) handleApply()
          }
        }}
      />
      {hasDraftChange || showRecovery ? (
        <button
          type="button"
          className={styles.action}
          disabled={!trimmedDraftUrl}
          onClick={handleApply}
        >
          {hasDraftChange ? '应用' : '重试'}
        </button>
      ) : null}
      <LocalRuntimeLauncher onReady={handleRuntimeReady} />
    </div>
  )
}
