import { useState, type ReactNode } from 'react'
import { siteLogo } from '../../shared/icon'

export function WorkflowMark({
  icon,
  site,
  children,
  large
}: {
  icon?: string
  site?: string
  children: ReactNode
  large?: boolean
}) {
  const src = icon || siteLogo(site || '')
  const [broken, setBroken] = useState(false)
  const box = large ? 'size-10' : 'size-9'
  return (
    <span className={`grid ${box} shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-foreground`}>
      {src && !broken
        ? <img key={src} src={src} alt="" className="size-5 object-contain" onError={() => setBroken(true)} />
        : children}
    </span>
  )
}
