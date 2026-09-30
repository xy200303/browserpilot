import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Info, Layers, Plus, Radio, Search, SlidersHorizontal, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { searchEngines, type SearchEngineId, type TabLayout, type UiState } from '../../shared/types'
import { SearchEngineIcon } from '@/components/SearchEngineIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from 'cn'

const sections = ['环境', '抓包', '通用', '关于'] as const
type Section = (typeof sections)[number]
type Env = UiState['envs'][number]

const icons = {
  环境: Layers,
  抓包: Radio,
  通用: SlidersHorizontal,
  关于: Info
}

export function SettingsPage({ state: external }: { state?: UiState }) {
  const requested = new URLSearchParams(window.location.search).get('section')
  const initial = sections.find((item) => item === requested) ?? '环境'
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
  const [section, setSection] = useState<Section>(initial)
  return (
    <div className="flex h-full bg-white text-sm text-foreground">
      <nav className="flex w-44 shrink-0 flex-col gap-1 border-r p-3">
        <div className="px-2 py-1.5 text-sm font-medium">设置</div>
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
              {item}
            </Button>
          )
        })}
      </nav>
      <div className="min-h-0 min-w-0 flex-1">
        {section === '环境' && <EnvPage state={state} />}
        {section === '抓包' && <div className="h-full overflow-y-auto"><Captures state={state} /></div>}
        {section === '通用' && <div className="h-full overflow-y-auto"><General state={state} /></div>}
        {section === '关于' && <div className="h-full overflow-y-auto"><About state={state} /></div>}
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
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索环境或网站" className="search-field bg-background pl-8" />
        </div>
        <Button type="button" variant="outline" className="bg-white" onClick={() => setCreateOpen(true)}>
          <Plus />新建
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <h2 className="pt-5 text-lg font-semibold">环境</h2>
        <p className="pt-1 text-xs text-muted-foreground">一套环境里可以登录多个网站。新建的窗口都是有头的，关掉窗口不会清掉登录。</p>
        {envs.length === 0 && (
          <p className="pt-4 text-sm text-muted-foreground">{query.trim() ? '没有匹配的环境' : '还没有环境'}</p>
        )}
        <div className="grid grid-cols-1 gap-3 pt-4 md:grid-cols-2 xl:grid-cols-3">
          {envs.map((item) => (
            <article key={item.id} className="rounded-xl border bg-white p-4">
              <div className="flex items-start gap-3">
                <button type="button" className="border-0 bg-transparent p-0" onClick={() => setPicked(item.id)} aria-label={item.name}>
                  <Mark>{item.name.slice(0, 1) || '环'}</Mark>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <button type="button" className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-sm font-medium" onClick={() => setPicked(item.id)}>
                      {item.name}
                    </button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void window.browser.openEnv(item.id)}>
                      {item.windowOpen ? '显示' : '打开'}
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
  const status = env.windowOpen ? (env.headless ? '无头窗口开着' : '有头窗口开着') : '窗口没打开'
  const sites = env.sites.length ? `${env.sites.length} 个网站` : '还没有打开过的网站'
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
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>返回</Button>
      </div>
      <div className="grid max-w-xl gap-4 px-4 py-4">
        <div className="flex items-start gap-3">
          <Mark large>{env.name.slice(0, 1) || '环'}</Mark>
          <div className="min-w-0">
            <h1 className="text-base font-medium">{env.name}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{env.id} · {env.windowOpen ? (env.headless ? '无头' : '有头') : '未打开'}</p>
          </div>
        </div>
        <Label className="grid gap-1 text-xs text-muted-foreground">
          名称
          <Input className="solid-field" value={name} onChange={(event) => setName(event.target.value)} />
        </Label>
        <Label className="grid gap-1 text-xs text-muted-foreground">
          备注
          <Input className="solid-field" value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="备注" />
        </Label>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void window.browser.updateEnv({ env: env.id, name, remark })}>保存</Button>
          <Button type="button" variant="outline" onClick={() => void window.browser.openEnv(env.id)}>{env.windowOpen ? '显示' : '打开'}</Button>
          {!env.isDefault && <Button type="button" variant="outline" onClick={() => setAsk(true)}>删除</Button>}
        </div>
        <div className="grid gap-2">
          <h2 className="text-sm font-medium">网站</h2>
          {env.sites.length === 0 && <p className="text-xs text-muted-foreground">还没有打开过的网站。</p>}
          {env.sites.map((site) => (
            <div key={site.domain} className="flex items-start justify-between gap-4 rounded-xl border p-3">
              <span className="min-w-0 truncate text-sm">{site.domain}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {site.cookiePresent ? 'Cookie 还在' : '没有 Cookie'} · {new Date(site.lastOpenedAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
      {rootRef.current && (
        <ConfirmDialog
          container={rootRef.current}
          open={ask}
          title="删除环境"
          detail={`从本机删除「${env.name}」。这套里的登录会一起去掉。`}
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
  const [name, setName] = useState('新环境')
  const [remark, setRemark] = useState('')
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="absolute inset-0 z-20 bg-black/30" />
        <Dialog.Content className="absolute top-1/2 left-1/2 z-20 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-white p-4 shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="text-base font-medium">新建环境</Dialog.Title>
            <Dialog.Close className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="关闭">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">新建的窗口是有头的。关掉窗口不会清掉登录。</Dialog.Description>
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
              名称
              <Input className="solid-field" value={name} onChange={(event) => setName(event.target.value)} />
            </Label>
            <Label className="grid gap-1 text-xs text-muted-foreground">
              备注
              <Input className="solid-field" value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="备注" />
            </Label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button type="submit">新建</Button>
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
      <Heading title="抓包" detail="当前网页标签上的请求。正文里的 Cookie 只留在本机。" />
      <Card>
        {state.captures.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">还没有记录。让 Agent 对这个标签调用 net_start。</p>}
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

function General({ state }: { state: UiState }) {
  const settings = state.settings
  return (
    <section>
      <Heading title="通用" detail="这些选项保存在本机，改完即生效。" />
      <Card>
        <Row title="搜索引擎" detail="新标签页打开这个搜索引擎的首页。地址栏里输入文字时，也用它来搜索。">
          <Select value={settings.searchEngine} onValueChange={(value) => void window.browser.updateSettings({ searchEngine: value as SearchEngineId })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {searchEngines.map((engine) => (
                <SelectItem key={engine.id} value={engine.id}>
                  <SearchEngineIcon id={engine.id} />
                  {engine.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row title="标签栏" detail="顶部是横条。左侧是竖排，靠近时盖住网页展开，点顶部固定后网页才让开。">
          <Select value={settings.tabLayout} onValueChange={(value) => void window.browser.updateSettings({ tabLayout: value as TabLayout })}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="top">顶部</SelectItem>
              <SelectItem value="left">左侧</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row title="MCP" detail="只听 127.0.0.1。关掉后再打开会换一次端口上的服务。">
          <Switch checked={settings.mcpEnabled} onCheckedChange={(mcpEnabled) => void window.browser.updateSettings({ mcpEnabled })} />
        </Row>
      </Card>
      <Card>
        <div className="grid gap-3 px-4 py-3">
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <Field label="监听地址">
              <Input value="127.0.0.1" readOnly />
            </Field>
            <Field label="端口">
              <Input type="number" value={settings.port} onChange={(event) => void window.browser.updateSettings({ port: Number(event.target.value) })} />
            </Field>
          </div>
          <Field label="端点">
            <Input value={`http://127.0.0.1:${settings.port}/mcp`} readOnly />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="批量并发上限">
              <Input
                type="number"
                min={1}
                max={3}
                value={settings.batchConcurrency}
                onChange={(event) => void window.browser.updateSettings({ batchConcurrency: Math.min(3, Math.max(1, Number(event.target.value) || 1)) })}
              />
            </Field>
            <Field label="无头窗口上限">
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
          <h2 className="text-base font-medium">关于</h2>
          <p className="mt-1 text-xs text-muted-foreground">给 Agent 用的浏览器。同一个进程里可以开多套环境，一套环境一扇窗口。</p>
        </div>
      </div>
      <Card>
        <Row title="当前版本" detail="安装包里的版本号">
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="button" variant="destructive" onClick={onConfirm}>删除</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
