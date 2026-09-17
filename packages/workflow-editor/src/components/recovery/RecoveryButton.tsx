import type { ButtonHTMLAttributes } from 'react'
export function RecoveryButton({ tone, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: string }) {
  return <button type="button" data-tone={tone} {...props} />
}
