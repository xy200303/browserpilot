import { useState, type FormEvent } from 'react'
import type { UiState } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { popoverPosition } from './position'
import i18n from '../i18n'

export function EnvPanel({ x, y, envId, state, close }: { x: number; y: number; envId: string; state: UiState; close: () => void }) {
  const env = state.envs.find((item) => item.id === envId)
  const [name, setName] = useState(env?.name ?? '')
  const [remark, setRemark] = useState(env?.remark ?? '')
  const [saving, setSaving] = useState(false)
  const width = 320
  const { left, top } = popoverPosition(x, y, width, 88, 260)

  if (!env) {
    return (
      <div className="absolute z-20 rounded-xl border border-neutral-200 bg-white p-4 text-sm shadow-xl" style={{ left, top, width }}>
        {i18n.t('env.missing')}
      </div>
    )
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const next = name.trim()
    if (!next) return
    setSaving(true)
    await window.browser.updateEnv({ env: envId, name: next, remark: remark.trim() })
    setSaving(false)
    close()
  }

  return (
    <div className="absolute z-20 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl" style={{ left, top, width }}>
      <form className="grid gap-3 p-3" onSubmit={(event) => void save(event)}>
        <div className="text-sm font-medium">{i18n.t('env.edit')}</div>
        <label className="grid gap-1 text-xs text-neutral-500">
          {i18n.t('env.name')}
          <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <label className="grid gap-1 text-xs text-neutral-500">
          {i18n.t('env.remark')}
          <Input value={remark} onChange={(event) => setRemark(event.target.value)} placeholder={i18n.t('env.remarkPlaceholder')} />
        </label>
        <p className="text-[10px] text-neutral-400">{envId}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>{i18n.t('shell.common.cancel')}</Button>
          <Button type="submit" disabled={!name.trim() || saving}>{saving ? i18n.t('env.saving') : i18n.t('env.save')}</Button>
        </div>
      </form>
    </div>
  )
}

