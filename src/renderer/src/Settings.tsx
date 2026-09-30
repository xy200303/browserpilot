import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Info, Layers, Radio, SlidersHorizontal, Workflow } from 'lucide-react'
import { WorkflowRun } from './Market'
import { searchEngines, type SearchEngineId, type TabLayout, type UiState } from '../../shared/types'
import { SearchEngineIcon } from '@/components/SearchEngineIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from 'cn'

const sections = ['环境', '工作流', '抓包', '通用', '关于'] as const
type Section = (typeof sections)[number]

const icons = {
  环境: Layers,
  工作流: Workflow,
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === '环境' && <Envs state={state} />}
        {section === '工作流' && <Workflows state={state} />}
        {section === '抓包' && <Captures state={state} />}
        {section === '通用' && <General state={state} />}
        {section === '关于' && <About state={state} />}
      </div>
    </div>
  )
}

function Heading({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b px-4 py-4">
      <div className="min-w-0">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
      {action}
    </div>
  )
}

function Card({ children }: { children: ReactNode }) {
  return <div className="divide-y border-b bg-white">{children}</div>
}

function Envs({ state }: { state: UiState }) {
  const [name, setName] = useState('新环境')
  const [remark, setRemark] = useState('')
  return (
    <section>
      <Heading title="环境" detail="一套环境里可以登录多个网站。新建的窗口都是有头的，关掉窗口不会清掉登录。" />
      <Card>
        <form
          className="flex items-center gap-2 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            void window.browser.createEnv({ name, remark })
            setRemark('')
          }}
        >
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="名称" className="w-36" />
          <Input value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="备注" className="min-w-0 flex-1" />
          <Button type="submit">新建</Button>
        </form>
      </Card>
      {state.envs.map((env) => (
        <EnvCard key={env.id} env={env} />
      ))}
    </section>
  )
}

function EnvCard({ env }: { env: UiState['envs'][number] }) {
  const name = useRef<HTMLInputElement>(null)
  const remark = useRef<HTMLInputElement>(null)
  return (
    <Card>
      <div className="grid gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <Input key={env.name} ref={name} defaultValue={env.name} className="w-36" />
          <Input key={env.remark} ref={remark} defaultValue={env.remark} placeholder="备注" className="min-w-0 flex-1" />
          <Button
            type="button"
            onClick={() => void window.browser.updateEnv({
              env: env.id,
              name: name.current?.value ?? env.name,
              remark: remark.current?.value ?? env.remark
            })}
          >
            保存
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{env.id}</span>
          <span>{env.windowOpen ? (env.headless ? '无头' : '有头') : '未打开'}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void window.browser.openEnv(env.id)}>
            {env.windowOpen ? '显示' : '打开'}
          </Button>
          {!env.isDefault && (
            <Button type="button" size="sm" variant="destructive" onClick={() => void window.browser.deleteEnv(env.id)}>
              删除
            </Button>
          )}
        </div>
        <div className="grid gap-1 border-t pt-3">
          {env.sites.length === 0 && <div className="text-xs text-muted-foreground">还没有打开过的网站。</div>}
          {env.sites.map((site) => (
            <div key={site.domain} className="flex justify-between gap-4 text-sm">
              <span className="truncate">{site.domain}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {site.cookiePresent ? 'Cookie 还在' : '没有 Cookie'} · {new Date(site.lastOpenedAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

function Workflows({ state }: { state: UiState }) {
  const [notice, setNotice] = useState('')
  return (
    <section>
      <Heading
        title="工作流"
        detail="点一条在内容区打开画布。右侧端点是下一步，判断的每个分支各有一个端点。"
        action={
          <Button
            type="button"
            onClick={() => {
              void window.browser.importWorkflow().then((result) => {
                if (!result.canceled && result.name) setNotice(`已导入 ${result.name}`)
              }).catch((error: unknown) => {
                setNotice(error instanceof Error ? error.message : '导入失败')
              })
            }}
          >
            导入
          </Button>
        }
      />
      {notice && <p className="border-b px-4 py-2 text-xs text-muted-foreground">{notice}</p>}
      {state.workflows.length === 0 && <p className="border-b px-4 py-3 text-xs text-muted-foreground">还没有保存的工作流。</p>}
      {state.workflows.map((item) => (
        <Card key={item.id}>
          <div className="flex items-center gap-3 px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-w-0 flex-1 flex-col items-start gap-1 px-0 py-0 text-left"
              onClick={() => void window.browser.openWorkflow(item.id)}
            >
              <span className="text-sm font-normal">{item.name}</span>
              <span className="text-xs font-normal text-muted-foreground">{item.id}</span>
              <span className="text-sm font-normal text-muted-foreground">{item.params.map((param) => param.name).join('、') || '没有参数'}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void window.browser.exportWorkflow(item.id).then((result) => {
                  if (!result.canceled && result.path) setNotice(`已导出 ${result.name}`)
                }).catch((error: unknown) => {
                  setNotice(error instanceof Error ? error.message : '导出失败')
                })
              }}
            >
              导出
            </Button>
          </div>
          <WorkflowRun workflow={item} />
        </Card>
      ))}
    </section>
  )
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
          <Select
            value={settings.searchEngine}
            onValueChange={(value) => void window.browser.updateSettings({ searchEngine: value as SearchEngineId })}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
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
          <Select
            value={settings.tabLayout}
            onValueChange={(value) => void window.browser.updateSettings({ tabLayout: value as TabLayout })}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
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
              <Input
                type="number"
                value={settings.port}
                onChange={(event) => void window.browser.updateSettings({ port: Number(event.target.value) })}
              />
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
        <div className="truncate text-xs text-muted-foreground" title={detail}>
          {detail}
        </div>
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
