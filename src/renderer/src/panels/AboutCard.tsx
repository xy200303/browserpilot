import { Button } from '@/components/ui/button'
import i18n from '../i18n'

export function AboutCard({ version, close }: { version: string; close: () => void }) {
  return (
    <div className="relative grid h-full place-items-center" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" aria-label={i18n.t('shell.common.close')} className="absolute inset-0 bg-black/30" onClick={close} />
      <div className="relative grid w-80 gap-3 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10" onMouseDown={(event) => event.stopPropagation()}>
        <div className="text-base font-medium">BrowserPilot</div>
        <div className="text-xs text-muted-foreground">{i18n.t('about.version', { version })}</div>
        <p className="text-sm">{i18n.t('about.tagline')}</p>
        <div className="flex justify-end">
          <Button type="button" onClick={close}>{i18n.t('shell.common.close')}</Button>
        </div>
      </div>
    </div>
  )
}

