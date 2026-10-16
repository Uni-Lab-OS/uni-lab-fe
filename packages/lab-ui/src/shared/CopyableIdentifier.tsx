import { useState } from 'react'
import styles from './CopyableIdentifier.module.scss'

/** 展示完整稳定标识；剪贴板不可用时仍可手动选择复制。 */
export function CopyableIdentifier({ value, label }: { value: string; label: string }) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const [error, setError] = useState(false)

  const copy = async () => {
    setError(false)
    try {
      await navigator.clipboard.writeText(value)
      setCopiedValue(value)
    } catch {
      setCopiedValue(null)
      setError(true)
    }
  }

  return (
    <span className={styles.identifier}>
      <code className={styles.value}>{value}</code>
      <button type="button" className={styles.copy} aria-label={`复制${label}`} onClick={copy}>
        {copiedValue === value ? '已复制' : '复制'}
      </button>
      {copiedValue === value && (
        <span className={styles.srOnly} role="status">
          {label}已复制
        </span>
      )}
      {error && (
        <span className={styles.error} role="alert">
          复制失败，请选中 UUID 手动复制
        </span>
      )}
    </span>
  )
}
