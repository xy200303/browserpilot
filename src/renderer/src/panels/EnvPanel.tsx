import { useState, type FormEvent } from 'react'
import type { UiState } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { popoverPosition } from './position'

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
        找不到这套环境。
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
        <div className="text-sm font-medium">编辑环境</div>
        <label className="grid gap-1 text-xs text-neutral-500">
          名称
          <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <label className="grid gap-1 text-xs text-neutral-500">
          备注
          <Input value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="这套环境用来做什么" />
        </label>
        <p className="text-[10px] text-neutral-400">{envId}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>取消</Button>
          <Button type="submit" disabled={!name.trim() || saving}>{saving ? '保存中…' : '保存'}</Button>
        </div>
      </form>
    </div>
  )
}

