import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Info, KeyRound, Layers, Plus, Radio, Search, Shield, SlidersHorizontal, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import { searchEngines, type LanguageSetting, type PasswordEntry, type SearchEngineId, type TabLayout, type UiState } from '../../shared/types'
import { SearchEngineIcon } from '@/components/SearchEngineIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from 'cn'
import i18n from './i18n'

const sections = ['env', 'net', 'general', 'passwords', 'privacy', 'about'] as const
type Section = (typeof sections)[number]
type Env = UiState['envs'][number]

const icons = {
  env: Layers,
  net: Radio,
  general: SlidersHorizontal,
  passwords: KeyRound,
  privacy: Shield,
  about: Info
}

export function SettingsPage({ state: external }: { state?: UiState }) {
  const requested = new URLSearchParams(window.location.search).get('section')
  const legacy: Record<string, Section> = { 环境: 'env', 抓包: 'net', 通用: 'general', 密码: 'passwords', 隐私: 'privacy', 关于: 'about' } // i18n-ignore 兼容旧链接
  const initial = sections.find((item) => item === requested) ?? legacy[requested ?? ''] ?? 'env'
  const [local, setLocal] = useState<UiState | null>(null)
  useEffect(() => {
    if (external) return
    void window.browser.getState().then(setLocal)
    return window.browser.onState(setLocal)
  }, [external])
  const state = external ?? local
  if (!state) return <div className="h-full bg-white" />
  return <SettingsDialog state={state} initial={initial} />
}

function SettingsDialog({ state, initial }: { state: UiState; initial: Section }) {
  const { t } = useTranslation()
  const [section, setSection] = useState<Section>(initial)
  return (
    <div className="flex h-full bg-white text-sm text-foreground">
      <nav className="flex w-44 shrink-0 flex-col gap-1 border-r p-3">
        <div className="px-2 py-1.5 text-sm font-medium">{t('settings.title')}</div>
        {sections.map((item) => {
          const Icon = icons[item]
          return (
            <Button
              key={item}
              type="button"
              variant="ghost"
              className={cn(
                'h-auto w-full justify-start px-2.5 py-2',
                section === item ? 'bg-muted font-medium hover:bg-muted' : 'hover:bg-muted/70'
              )}
              onClick={() => setSection(item)}
            >
              <Icon />
              {t(`settings.sections.${item}`)}
            </Button>
          )
        })}
      </nav>
      <div className="min-h-0 min-w-0 flex-1">
        {section === 'env' && <EnvPage state={state} />}
        {section === 'net' && <div className="h-full overflow-y-auto"><Captures state={state} /></div>}
        {section === 'general' && <div className="h-full overflow-y-auto"><General state={state} /></div>}
        {section === 'passwords' && <div className="h-full overflow-y-auto"><Passwords state={state} /></div>}
        {section === 'privacy' && <div className="h-full overflow-y-auto"><Privacy state={state} /></div>}
        {section === 'about' && <div className="h-full overflow-y-auto"><About state={state} /></div>}
      </div>
    </div>
  )
}

function EnvPage({ state }: { state: UiState }) {
  const pageRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const env = state.envs.find((item) => item.id === picked)

  if (env) return <EnvDetail env={env} onBack={() => setPicked(null)} />

  const envs = state.envs.filter((item) => hit(query, `${item.name} ${item.remark} ${item.id} ${item.sites.map((site) => site.domain).join(' ')}`))

  return (
    <div ref={pageRef} className="relative flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 px-5 pt-4">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={i18n.t('settings.env.search')} className="search-field bg-background pl-8" />
        </div>
        <Button type="button" variant="outline" className="bg-white" onClick={() => setCreateOpen(true)}>
          <Plus />{i18n.t('settings.env.new')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <h2 className="pt-5 text-lg font-semibold">{i18n.t('settings.env.title')}</h2>
        <p className="pt-1 text-xs text-muted-foreground">{i18n.t('settings.env.detail')}</p>
        {envs.length === 0 && (
          <p className="pt-4 text-sm text-muted-foreground">{query.trim() ? i18n.t('settings.env.noMatch') : i18n.t('settings.env.empty')}</p>
        )}
        <div className="grid grid-cols-1 gap-3 pt-4 md:grid-cols-2 xl:grid-cols-3">
          {envs.map((item) => (
            <article key={item.id} className="rounded-xl border bg-white p-4">
              <div className="flex items-start gap-3">
                <button type="button" className="border-0 bg-transparent p-0" onClick={() => setPicked(item.id)} aria-label={item.name}>
                  <Mark>{item.name.slice(0, 1) || i18n.t('settings.env.initial')}</Mark>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button type="button" className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-sm font-medium" onClick={() => setPicked(item.id)}>
                      {item.name}
                    </button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void window.browser.openEnv(item.id)}>
                      {item.windowOpen ? i18n.t('settings.env.show') : i18n.t('settings.env.open')}
                    </Button>
                  </div>
                  <button type="button" className="mt-1 line-clamp-2 w-full border-0 bg-transparent p-0 text-left text-xs leading-5 text-muted-foreground" onClick={() => setPicked(item.id)}>
                    {envText(item)}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
      {pageRef.current && (
        <CreateEnvDialog container={pageRef.current} open={createOpen} onOpenChange={setCreateOpen} />
      )}
    </div>
  )
}

function envText(env: Env): string {
  const status = env.windowOpen ? (env.headless ? i18n.t('settings.env.statusHeadless') : i18n.t('settings.env.statusHeaded')) : i18n.t('settings.env.statusClosed')
  const sites = env.sites.length ? i18n.t('settings.env.sites', { count: env.sites.length }) : i18n.t('settings.env.noSites')
  return [env.remark, status, sites].filter(Boolean).join(' · ')
}

function hit(query: string, text: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return text.toLowerCase().includes(needle)
}

function EnvDetail({ env, onBack }: { env: Env; onBack: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [name, setName] = useState(env.name)
  const [remark, setRemark] = useState(env.remark)
  const [ask, setAsk] = useState(false)
  useEffect(() => {
    setName(env.name)
    setRemark(env.remark)
  }, [env.id, env.name, env.remark])
  return (
    <div ref={rootRef} className="relative h-full overflow-y-auto bg-white">
      <div className="border-b px-4 py-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>{i18n.t('settings.env.back')}</Button>
      </div>
      <div className="grid max-w-xl gap-4 px-4 py-4">
        <div className="flex items-start gap-3">
          <Mark large>{env.name.slice(0, 1) || i18n.t('settings.env.initial')}</Mark>
          <div className="min-w-0">
            <h1 className="text-base font-medium">{env.name}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{env.id} · {env.windowOpen ? (env.headless ? i18n.t('settings.env.headless') : i18n.t('settings.env.headed')) : i18n.t('settings.env.notOpen')}</p>
          </div>
        </div>
        <Label className="grid gap-1 text-xs text-muted-foreground">
          {i18n.t('settings.env.name')}
          <Input className="solid-field" value={name} onChange={(event) => setName(event.target.value)} />
        </Label>
        <Label className="grid gap-1 text-xs text-muted-foreground">
          {i18n.t('settings.env.remark')}
          <Input className="solid-field" value={remark} onChange={(event) => setRemark(event.target.value)} placeholder={i18n.t('settings.env.remark')} />
        </Label>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void window.browser.updateEnv({ env: env.id, name, remark })}>{i18n.t('settings.env.save')}</Button>
          <Button type="button" variant="outline" onClick={() => void window.browser.openEnv(env.id)}>{env.windowOpen ? i18n.t('settings.env.show') : i18n.t('settings.env.open')}</Button>
          {!env.isDefault && <Button type="button" variant="outline" onClick={() => setAsk(true)}>{i18n.t('settings.env.delete')}</Button>}
        </div>
        <div className="grid gap-2">
          <h2 className="text-sm font-medium">{i18n.t('settings.env.websites')}</h2>
          {env.sites.length === 0 && <p className="text-xs text-muted-foreground">{i18n.t('settings.env.noSitesDetail')}</p>}
          {env.sites.map((site) => (
            <div key={site.domain} className="flex items-start justify-between gap-4 rounded-xl border p-3">
              <span className="min-w-0 truncate text-sm">{site.domain}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {site.cookiePresent ? i18n.t('settings.env.cookieOn') : i18n.t('settings.env.cookieOff')} · {new Date(site.lastOpenedAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
      {rootRef.current && (
        <ConfirmDialog
          container={rootRef.current}
          open={ask}
          title={i18n.t('settings.env.deleteTitle')}
          detail={`{i18n.t('settings.env.deleteDetail', { name: env.name })}`}
          onOpenChange={setAsk}
          onConfirm={() => {
            void window.browser.deleteEnv(env.id)
            onBack()
          }}
        />
      )}
    </div>
  )
}

function CreateEnvDialog({ container, open, onOpenChange }: { container: HTMLElement; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState(i18n.t('settings.env.newTitle'))
  const [remark, setRemark] = useState('')
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="absolute inset-0 z-20 bg-black/30" />
        <Dialog.Content className="absolute top-1/2 left-1/2 z-20 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-white p-4 shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="text-base font-medium">{i18n.t('settings.env.newTitle')}</Dialog.Title>
            <Dialog.Close className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label={i18n.t('shell.common.close')}>
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">{i18n.t('settings.env.newDetail')}</Dialog.Description>
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void window.browser.createEnv({ name, remark })
              setRemark('')
              onOpenChange(false)
            }}
          >
            <Label className="grid gap-1 text-xs text-muted-foreground">
              {i18n.t('settings.env.name')}
              <Input className="solid-field" value={name} onChange={(event) => setName(event.target.value)} />
            </Label>
            <Label className="grid gap-1 text-xs text-muted-foreground">
              {i18n.t('settings.env.remark')}
              <Input className="solid-field" value={remark} onChange={(event) => setRemark(event.target.value)} placeholder={i18n.t('settings.env.remark')} />
            </Label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{i18n.t('shell.common.cancel')}</Button>
              <Button type="submit">{i18n.t('settings.env.create')}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Heading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-b px-4 py-4">
      <h2 className="text-base font-medium">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return <div className="divide-y border-b bg-white">{children}</div>
}

function Captures({ state }: { state: UiState }) {
  return (
    <section>
      <Heading title={i18n.t('settings.net.title')} detail={i18n.t('settings.net.detail')} />
      <Card>
        {state.captures.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">{i18n.t('settings.net.empty')}</p>}
        {state.captures.map((item) => (
          <div key={item.id} className="truncate px-4 py-3 text-sm">
            <span className="mr-2 text-muted-foreground">{item.method}</span>
            {item.status ?? ''} {item.url}
          </div>
        ))}
      </Card>
    </section>
  )
}

function permissionLabel(permission: string): string {
  if (permission === 'media') return i18n.t('settings.privacy.perm.media')
  if (permission === 'geolocation') return i18n.t('settings.privacy.perm.geolocation')
  if (permission === 'notifications') return i18n.t('settings.privacy.perm.notifications')
  if (permission === 'clipboard-read') return i18n.t('settings.privacy.perm.clipboard')
  if (permission === 'display-capture') return i18n.t('settings.privacy.perm.display')
  if (permission === 'midiSysex') return i18n.t('settings.privacy.perm.midi')
  if (permission === 'pointerLock') return i18n.t('settings.privacy.perm.pointerLock')
  if (permission === 'fullscreen') return i18n.t('settings.privacy.perm.fullscreen')
  if (permission === 'openExternal') return i18n.t('settings.privacy.perm.openExternal')
  return permission
}

function Privacy({ state }: { state: UiState }) {
  const [history, setHistory] = useState(true)
  const [cookies, setCookies] = useState(true)
  const [cache, setCache] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const clear = async (): Promise<void> => {
    setBusy(true)
    await window.browser.clearData({ history, cookies, cache })
    setBusy(false)
    setConfirm(false)
    setMessage(i18n.t('settings.privacy.cleared'))
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-5">
      <h1 className="text-lg font-semibold">{i18n.t('settings.privacy.title')}</h1>
      <p className="mt-1 text-xs text-muted-foreground">{i18n.t('settings.privacy.scope', { env: state.envName })}</p>

      <section className="mt-5 rounded-xl border p-4">
        <h2 className="text-sm font-medium">{i18n.t('settings.privacy.clearTitle')}</h2>
        <div className="mt-3 grid gap-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-neutral-900" checked={history} onChange={(event) => setHistory(event.target.checked)} />{i18n.t('settings.privacy.history')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-neutral-900" checked={cookies} onChange={(event) => setCookies(event.target.checked)} />{i18n.t('settings.privacy.cookies')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-neutral-900" checked={cache} onChange={(event) => setCache(event.target.checked)} />{i18n.t('settings.privacy.cache')}</label>
        </div>
        {!confirm ? (
          <Button type="button" variant="outline" className="mt-4" onClick={() => setConfirm(true)}>{i18n.t('settings.privacy.clearSelected')}</Button>
        ) : (
          <div className="mt-4 flex gap-2">
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void clear()}>{busy ? i18n.t('settings.privacy.clearing') : i18n.t('settings.privacy.confirmClear')}</Button>
            <Button type="button" variant="ghost" onClick={() => setConfirm(false)}>{i18n.t('shell.common.cancel')}</Button>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{i18n.t('settings.privacy.clearHint')}</p>
        {message && <p className="mt-2 text-xs text-green-600">{message}</p>}
      </section>

      <section className="mt-5 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">{i18n.t('settings.privacy.permissions')}</h2>
          {state.permissions.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => void window.browser.clearPermissions()}>{i18n.t('settings.privacy.clearAll')}</Button>
          )}
        </div>
        {state.permissions.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">{i18n.t('settings.privacy.none')}</p>
        ) : (
          <div className="mt-3 divide-y divide-neutral-100">
            {state.permissions.map((rule) => (
              <div key={rule.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{rule.origin}</p>
                  <p className="text-xs text-muted-foreground">{permissionLabel(rule.permission)} · {rule.decision === 'allow' ? i18n.t('settings.privacy.allow') : i18n.t('settings.privacy.deny')}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => void window.browser.revokePermission(rule.id)}>{i18n.t('settings.privacy.revoke')}</Button>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{i18n.t('settings.privacy.permissionHint')}</p>
      </section>
    </div>
  )
}

function Passwords({ state }: { state: UiState }) {
  const [items, setItems] = useState<PasswordEntry[]>([])
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [vault, setVault] = useState<{ available: boolean; secure: boolean; backend?: string } | null>(null)
  useEffect(() => {
    let alive = true
    void window.browser.listPasswords().then((list) => {
      if (alive) setItems(list)
    })
    return () => {
      alive = false
    }
  }, [state.envId])

  useEffect(() => {
    let alive = true
    void window.browser
      .passwordStorageStatus()
      .then((status) => {
        if (alive) setVault(status)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [state.envId])

  const reload = async (): Promise<void> => {
    setRevealed({})
    setItems(await window.browser.listPasswords())
  }

  const toggleReveal = async (item: PasswordEntry): Promise<void> => {
    if (revealed[item.id]) {
      setRevealed((previous) => {
        const next = { ...previous }
        delete next[item.id]
        return next
      })
      return
    }
    const got = await window.browser.revealPassword(item.id)
    if (got) setRevealed((previous) => ({ ...previous, [item.id]: got.locked ? i18n.t('settings.passwords.revealFailed') : got.password }))
  }

  return (
    <section>
      <Heading title={i18n.t('settings.passwords.title')} detail={i18n.t('settings.passwords.detail')} />
      <Card>
        <Row
          title={i18n.t('settings.passwords.protect')}
          detail={!vault ? i18n.t('settings.passwords.checking') : vault.secure ? i18n.t('settings.passwords.secure') + (vault.backend ? ' (' + vault.backend + ')' : '') : i18n.t('settings.passwords.insecure')}
        >
          <span className={vault && !vault.secure ? 'text-xs text-amber-700' : 'text-xs text-muted-foreground'}>
            {!vault ? i18n.t('settings.passwords.checkingShort') : vault.secure ? i18n.t('settings.passwords.encrypted') : i18n.t('settings.passwords.plain')}
          </span>
        </Row>
        {vault && !vault.secure && (
          <p className="px-4 pb-3 text-xs leading-relaxed text-amber-700">
            {i18n.t('settings.passwords.insecureDetail')}
          </p>
        )}
      </Card>
      <Card>
        <Row title={i18n.t('settings.passwords.autoSave')} detail={i18n.t('settings.passwords.autoSaveDetail')}>
          <Switch checked={state.settings.passwordSave} onCheckedChange={(passwordSave) => void window.browser.updateSettings({ passwordSave })} />
        </Row>
        <Row title={i18n.t('settings.passwords.autoFill')} detail={i18n.t('settings.passwords.autoFillDetail')}>
          <Switch checked={state.settings.passwordAutofill} onCheckedChange={(passwordAutofill) => void window.browser.updateSettings({ passwordAutofill })} />
        </Row>
      </Card>
      <Card>
        {items.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">{i18n.t('settings.passwords.empty')}</p>}
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm">{item.origin}</div>
              <div className="truncate text-xs text-muted-foreground">
                {item.username || i18n.t('settings.passwords.noUsername')} · {new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                {revealed[item.id] && <span className="ml-2 font-mono text-foreground">{revealed[item.id]}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => void toggleReveal(item)}>{revealed[item.id] ? i18n.t('settings.passwords.hide') : i18n.t('settings.passwords.show')}</Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title={i18n.t('settings.passwords.delete')}
                onClick={() => {
                  void window.browser.deletePassword(item.id).then(reload)
                }}
              >
                <X />
              </Button>
            </div>
          </div>
        ))}
      </Card>
      {items.length > 0 && (
        <div className="px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void window.browser.clearPasswords().then(reload)
            }}
          >
            {i18n.t('settings.passwords.clear')}
          </Button>
        </div>
      )}
    </section>
  )
}

function General({ state }: { state: UiState }) {
  const { t } = useTranslation()
  const settings = state.settings
  return (
    <section>
      <Heading title={t('settings.general.title')} detail={t('settings.general.detail')} />
      <Card>
        <Row title={t('settings.general.language.title')} detail={t('settings.general.language.detail')}>
          <Select value={settings.language ?? 'auto'} onValueChange={(value) => void window.browser.updateSettings({ language: value as LanguageSetting })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('settings.general.language.auto')}</SelectItem>
              <SelectItem value="zh-CN">简体中文</SelectItem>{/* i18n-ignore 语言名用自身语言显示 */}
              <SelectItem value="en-US">English</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row title={i18n.t('settings.general.searchEngine')} detail={i18n.t('settings.general.searchEngineDetail')}>
          <Select value={settings.searchEngine} onValueChange={(value) => void window.browser.updateSettings({ searchEngine: value as SearchEngineId })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {searchEngines.map((engine) => (
                <SelectItem key={engine.id} value={engine.id}>
                  <SearchEngineIcon id={engine.id} />
                  {i18n.t(`searchEngine.${engine.id}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row title={i18n.t('settings.general.tabLayout')} detail={i18n.t('settings.general.tabLayoutDetail')}>
          <Select value={settings.tabLayout} onValueChange={(value) => void window.browser.updateSettings({ tabLayout: value as TabLayout })}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="top">{i18n.t('settings.general.top')}</SelectItem>
              <SelectItem value="left">{i18n.t('settings.general.left')}</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row title={i18n.t('settings.general.downloadDir')} detail={i18n.t('settings.general.downloadDirDetail')}>
          <div className="flex items-center gap-2">
            <span className="max-w-64 truncate text-xs text-muted-foreground" title={settings.downloadDir || i18n.t('settings.general.systemDir')}>
              {settings.downloadDir || i18n.t('settings.general.systemDir')}
            </span>
            <Button variant="outline" size="sm" onClick={() => void window.browser.pickDownloadDir()}>{i18n.t('settings.general.choose')}</Button>
            {settings.downloadDir && (
              <Button variant="ghost" size="sm" onClick={() => void window.browser.updateSettings({ downloadDir: '' })}>{i18n.t('settings.general.resetDefault')}</Button>
            )}
          </div>
        </Row>
        <Row title={i18n.t('settings.general.toolMode')} detail={i18n.t('settings.general.toolModeDetail')}>
          <Select value={settings.toolMode} onValueChange={(value) => void window.browser.updateSettings({ toolMode: value as 'full' | 'search' })}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="search">{i18n.t('settings.general.search')}</SelectItem>
              <SelectItem value="full">{i18n.t('settings.general.full')}</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row title={i18n.t('settings.general.connect')} detail={i18n.t('settings.general.connectDetail')}>
          <Button variant="outline" size="sm" onClick={() => void window.browser.copyConnectPrompt()}>{i18n.t('settings.general.copyPrompt')}</Button>
        </Row>
        <Row title={i18n.t('settings.general.mcp')} detail={i18n.t('settings.general.mcpDetail')}>
          <Switch checked={settings.mcpEnabled} onCheckedChange={(mcpEnabled) => void window.browser.updateSettings({ mcpEnabled })} />
        </Row>
      </Card>
      <Card>
        <div className="grid gap-3 px-4 py-3">
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <Field label={i18n.t('settings.general.field.address')}>
              <Input value="127.0.0.1" readOnly />
            </Field>
            <Field label={i18n.t('settings.general.field.port')}>
              <Input type="number" value={settings.port} onChange={(event) => void window.browser.updateSettings({ port: Number(event.target.value) })} />
            </Field>
          </div>
          <Field label={i18n.t('settings.general.field.endpoint')}>
            <Input value={`http://127.0.0.1:${settings.port}/mcp`} readOnly />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={i18n.t('settings.general.field.concurrency')}>
              <Input
                type="number"
                min={1}
                max={3}
                value={settings.batchConcurrency}
                onChange={(event) => void window.browser.updateSettings({ batchConcurrency: Math.min(3, Math.max(1, Number(event.target.value) || 1)) })}
              />
            </Field>
            <Field label={i18n.t('settings.general.field.headlessLimit')}>
              <Input
                type="number"
                min={1}
                value={settings.headlessLimit}
                onChange={(event) => void window.browser.updateSettings({ headlessLimit: Math.max(1, Number(event.target.value) || 1) })}
              />
            </Field>
          </div>
        </div>
      </Card>
    </section>
  )
}

function About({ state }: { state: UiState }) {
  return (
    <section>
      <div className="flex items-center gap-3 border-b px-4 py-4">
        <svg viewBox="0 0 64 64" className="size-10 shrink-0" aria-hidden="true">
          <rect width="64" height="64" rx="16" fill="#243044" />
          <circle cx="32" cy="32" r="14" fill="none" stroke="#E6EDF5" strokeWidth="2.4" />
          <ellipse cx="32" cy="32" rx="6.4" ry="14" fill="none" stroke="#E6EDF5" strokeWidth="2.2" />
          <path d="M18 32h28" fill="none" stroke="#C4A574" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        <div>
          <h2 className="text-base font-medium">{i18n.t('settings.about.title')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{i18n.t('settings.about.tagline')}</p>
        </div>
      </div>
      <Card>
        <Row title={i18n.t('settings.about.version')} detail={i18n.t('settings.about.versionDetail')}>
          <span className="text-sm tabular-nums">{state.version ? `v${state.version}` : '…'}</span>
        </Row>
      </Card>
    </section>
  )
}

function Row({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm">{title}</div>
        <div className="truncate text-xs text-muted-foreground" title={detail}>{detail}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </Label>
  )
}

function Mark({ children, large }: { children: ReactNode; large?: boolean }) {
  return (
    <span className={cn('grid shrink-0 place-items-center rounded-lg bg-muted text-sm font-medium', large ? 'size-10' : 'size-9')}>
      {children}
    </span>
  )
}

function ConfirmDialog({
  container,
  open,
  title,
  detail,
  onOpenChange,
  onConfirm
}: {
  container: HTMLElement
  open: boolean
  title: string
  detail: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="absolute inset-0 z-20 bg-black/30" />
        <Dialog.Content className="absolute top-1/2 left-1/2 z-20 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-white p-4 shadow-lg">
          <Dialog.Title className="text-base font-medium">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">{detail}</Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{i18n.t('shell.common.cancel')}</Button>
            <Button type="button" variant="destructive" onClick={onConfirm}>{i18n.t('settings.env.delete')}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
