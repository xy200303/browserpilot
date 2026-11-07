import { Button } from '@/components/ui/button'

export function AboutCard({ version, close }: { version: string; close: () => void }) {
  return (
    <div className="relative grid h-full place-items-center" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-black/30" onClick={close} />
      <div className="relative grid w-80 gap-3 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10" onMouseDown={(event) => event.stopPropagation()}>
        <div className="text-base font-medium">BrowserPilot</div>
        <div className="text-xs text-muted-foreground">版本 {version}</div>
        <p className="text-sm">给 Agent 用的浏览器。同一个进程里可以开多套环境，一套环境一扇窗口。</p>
        <div className="flex justify-end">
          <Button type="button" onClick={close}>关闭</Button>
        </div>
      </div>
    </div>
  )
}

