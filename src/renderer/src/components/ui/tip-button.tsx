import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * 只放图标的按钮：用 Tooltip 代替原生 title。
 *
 * 原生 title 要悬停半秒才出、样式跟系统走，和界面不搭。
 * disabled 的时候套一层 span，否则 Radix 收不到 hover（pointer-events 被按钮吃掉）。
 */
export function TipButton({ label, children, ...props }: ComponentProps<typeof Button> & { label: string }) {
  const button = <Button {...props}>{children}</Button>
  return (
    <Tooltip>
      <TooltipTrigger asChild>{props.disabled ? <span className="inline-flex">{button}</span> : button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
