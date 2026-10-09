import { clsx } from 'clsx'
import sharedStyles from '../../styles/shared.module.scss'
import {
  StatusBadge as LabStatusBadge,
  statusMeta,
  type StatusTone as LabStatusTone,
} from '@unilab/lab-ui'

export type StatusTone = LabStatusTone

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <LabStatusBadge
      status={status}
      meta={statusMeta(status)}
      label={label}
      className={clsx(sharedStyles['status-badge'])}
    />
  )
}
