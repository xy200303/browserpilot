import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Briefcase, ChartColumn, Globe, Plus, Search, SquareCheck, Trash2, Type, Workflow, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import type { UiState } from '../../shared/types'
import { workflowSite } from '../../shared/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WorkflowUse } from './Market'
import { WorkflowMark } from './WorkflowMark'

type MarketItem = {
  slug: string
  name: string
  description: string
  author: string
  category: string
  site: string
  icon: string
  file: string
}

type SavedWorkflow = UiState['workflows'][number]

const marks: Record<string, typeof Globe> = {
  'open-page': Globe,
  'page-title': Type,
  'boss-apply': Briefcase,
  'guba-collect': ChartColumn
}

function explain(reason: unknown, fallback: string): string {
  const raw = reason instanceof Error ? reason.message : fallback
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '') || fallback
}

function hit(query: string, name: string, description: string): boolean {
  const text = query.trim().toLowerCase()
  if (!text) return true
  return `${name} ${description}`.toLowerCase().includes(text)
}

function savedDescription(workflow: SavedWorkflow, listed?: MarketItem): string {
  return listed?.description || workflow.remark || workflow.params.map((param) => param.name).join('、') || '没有说明'
}

export function MarketPage({ state: external }: { state?: UiState }) {
  const pageRef = useRef<HTMLDivElement>(null)
  const [local, setLocal] = useState<UiState | null>(null)
  const [items, setItems] = useState<MarketItem[]>([])
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [listError, setListError] = useState('')
  const [importError, setImportError] = useState('')
  const [category, setCategory] = useState('全部')
  const [query, setQuery] = useState('')
  const [installedOnly, setInstalledOnly] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<SavedWorkflow | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [picked, setPicked] = useState<{ kind: 'saved' | 'catalog'; id: string } | null>(null)

  const load = (): void => {
    void window.browser.listMarket().then((result) => {
      setItems(result.items)
      setListError('')
    }).catch((reason: unknown) => {
      setListError(explain(reason, '目录连不上 GitHub'))
    })
  }

  useEffect(() => {
    if (external) return
    void window.browser.getState().then(setLocal)
    return window.browser.onState(setLocal)
  }, [external])

  useEffect(() => {
    load()
  }, [])

  const state = external ?? local
  const saved = state?.workflows ?? []
  const savedNames = new Set(saved.map((item) => item.name))
  const categories = ['全部', ...items.map((item) => item.category).filter((name, index, list) => list.indexOf(name) === index)]
  const inCategory = category === '全部' ? items : items.filter((item) => item.category === category)
  const savedVisible = (category === '全部'
    ? saved
    : saved.filter((workflow) => items.some((item) => item.name === workflow.name && item.category === category))
  ).filter((workflow) => {
    const listed = items.find((item) => item.name === workflow.name)
    return hit(query, workflow.name, savedDescription(workflow, listed))
  })
  const catalog = inCategory.filter((item) => !savedNames.has(item.name) && hit(query, item.name, item.description))
  const catalogItem = picked?.kind === 'catalog' ? items.find((item) => item.slug === picked.id) : undefined
  const savedItem = picked?.kind === 'saved' ? saved.find((item) => item.id === picked.id) : undefined
  const installed = catalogItem ? saved.find((workflow) => workflow.name === catalogItem.name) : undefined
  const visible = installedOnly ? savedVisible : catalog

  const install = (input: { file?: string; url?: string }, key: string) => {
    setBusy(key)
    setImportError('')
    setNotice('')
    void window.browser.installMarket(input).then((savedName) => {
      setNotice(`已安装 ${savedName.name}`)
      setImportOpen(false)
      setInstalledOnly(true)
      setQuery('')
    }).catch((reason: unknown) => {
      setImportError(explain(reason, '安装失败'))
    }).finally(() => setBusy(''))
  }

  const bringIn = (): void => {
    setImportError('')
    setNotice('')
    void window.browser.importWorkflow().then((result) => {
      if (result.canceled || !result.name) return
      setNotice(`已导入 ${result.name}`)
      setImportOpen(false)
      setInstalledOnly(true)
      setQuery('')
    }).catch((reason: unknown) => {
      setImportError(explain(reason, '导入失败'))
    })
  }

  if (savedItem) {
    return (
      <SavedDetail
        workflow={savedItem}
        notice={notice}
        onBack={() => { setPicked(null); setNotice('') }}
        onDeleted={() => { setNotice(`已删除 ${savedItem.name}`); setPicked(null) }}
      />
    )
  }

  if (catalogItem) {
    return (
      <MarketDetail
        item={catalogItem}
        installed={installed}
        busy={busy === catalogItem.slug}
        notice={notice}
        error={importError}
        onBack={() => { setPicked(null); setNotice(''); setImportError('') }}
        onInstall={() => install({ file: catalogItem.file }, catalogItem.slug)}
      />
    )
  }

  return (
    <div ref={pageRef} className="relative flex h-full flex-col bg-white text-foreground">
      <div className="flex items-center gap-2 px-5 pt-4">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工作流" className="search-field bg-background pl-8" />
        </div>
        <Button type="button" variant={installedOnly ? 'secondary' : 'outline'} className={installedOnly ? undefined : 'bg-white'} onClick={() => setInstalledOnly((value) => !value)}>
          <SquareCheck />已安装 {saved.length}
        </Button>
        <Button type="button" variant="outline" className="bg-white" onClick={() => { setImportError(''); setImportOpen(true) }}>
          <Plus />导入
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <h2 className="pt-5 text-lg font-semibold">{installedOnly ? '已安装' : '目录'}</h2>
        <div className="flex flex-wrap gap-2 py-3">
          {categories.map((name) => (
            <Button key={name} type="button" size="sm" variant={category === name ? 'secondary' : 'ghost'} className="rounded-lg" onClick={() => setCategory(name)}>
              {name}
            </Button>
          ))}
        </div>
        {notice && <p className="pb-3 text-xs text-muted-foreground">{notice}</p>}
        {!installedOnly && listError && <p className="pb-3 text-sm text-muted-foreground">{listError}</p>}
        {visible.length === 0 && (installedOnly || !listError) && (
          <p className="text-sm text-muted-foreground">
            {query.trim() ? '没有匹配的工作流' : installedOnly ? '还没有安装工作流' : '没有可安装的工作流'}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {installedOnly
            ? savedVisible.map((workflow) => {
              const listed = items.find((item) => item.name === workflow.name)
              return (
                <FlowCard
                  key={workflow.id}
                  name={workflow.name}
                  description={savedDescription(workflow, listed)}
                  icon={workflow.icon || listed?.icon}
                  site={workflowSite(workflow.graph.nodes) || listed?.site || ''}
                  mark={<Workflow className="size-4" />}
                  onOpen={() => { setNotice(''); setPicked({ kind: 'saved', id: workflow.id }) }}
                  onRemove={() => { setDeleteError(''); setPendingDelete(workflow) }}
                />
              )
            })
            : catalog.map((item) => (
              <FlowCard
                key={item.slug}
                name={item.name}
                description={item.description}
                icon={item.icon}
                site={item.site}
                mark={<MarkIcon slug={item.slug} />}
                busy={busy === item.slug}
                onOpen={() => { setNotice(''); setImportError(''); setPicked({ kind: 'catalog', id: item.slug }) }}
                onInstall={() => install({ file: item.file }, item.slug)}
              />
            ))}
        </div>
      </div>
      {pageRef.current && (
        <ImportDialog
          container={pageRef.current}
          open={importOpen}
          busy={busy === 'url'}
          error={importError}
          onOpenChange={setImportOpen}
          onUrl={(url) => install({ url }, 'url')}
          onLocal={bringIn}
        />
      )}
      {pageRef.current && (
        <DeleteDialog
          container={pageRef.current}
          open={pendingDelete !== null}
          name={pendingDelete?.name ?? ''}
          busy={busy === 'delete'}
          error={deleteError}
          onOpenChange={(open) => { if (!open) setPendingDelete(null) }}
          onConfirm={() => {
            if (!pendingDelete) return
            const target = pendingDelete
            setBusy('delete')
            setDeleteError('')
            void window.browser.deleteWorkflow(target.id).then(() => {
              setNotice(`已删除 ${target.name}`)
              setPendingDelete(null)
            }).catch((reason: unknown) => {
              setDeleteError(explain(reason, '删除失败'))
            }).finally(() => setBusy(''))
          }}
        />
      )}
    </div>
  )
}

function MarkIcon({ slug }: { slug: string }) {
  const Mark = marks[slug] ?? Globe
  return <Mark className="size-4" />
}

function FlowCard({
  name,
  description,
  icon,
  site,
  mark,
  busy,
  onOpen,
  onInstall,
  onRemove
}: {
  name: string
  description: string
  icon?: string
  site?: string
  mark: ReactNode
  busy?: boolean
  onOpen: () => void
  onInstall?: () => void
  onRemove?: () => void
}) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-start gap-3">
        <button type="button" className="border-0 bg-transparent p-0" onClick={onOpen} aria-label={name}>
          <WorkflowMark icon={icon} site={site}>{mark}</WorkflowMark>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button type="button" className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-sm font-medium" onClick={onOpen}>
              {name}
            </button>
            {onInstall && (
              <Button type="button" variant="outline" size="icon-sm" title="安装" disabled={busy} onClick={onInstall}>
                <Plus />
              </Button>
            )}
            {onRemove && (
              <Button type="button" variant="outline" size="icon-sm" title="删除" onClick={onRemove}>
                <Trash2 />
              </Button>
            )}
          </div>
          <button type="button" className="mt-1 line-clamp-2 w-full border-0 bg-transparent p-0 text-left text-xs leading-5 text-muted-foreground" onClick={onOpen}>
            {description || '没有说明'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteDialog({
  container,
  open,
  name,
  busy,
  error,
  onOpenChange,
  onConfirm
}: {
  container: HTMLElement
  open: boolean
  name: string
  busy: boolean
  error: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="absolute inset-0 z-20 bg-black/30" />
        <Dialog.Content className="absolute top-1/2 left-1/2 z-20 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-white p-4 shadow-lg">
          <Dialog.Title className="text-base font-medium">删除工作流</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">从本机删除「{name}」。目录里的还可以再安装。</Dialog.Description>
          {error && <p className="mt-3 text-xs text-muted-foreground">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? '删除中' : '删除'}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ImportDialog({
  container,
  open,
  busy,
  error,
  onOpenChange,
  onUrl,
  onLocal
}: {
  container: HTMLElement
  open: boolean
  busy: boolean
  error: string
  onOpenChange: (open: boolean) => void
  onUrl: (url: string) => void
  onLocal: () => void
}) {
  const [url, setUrl] = useState('')
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="absolute inset-0 z-20 bg-black/30" />
        <Dialog.Content className="absolute top-1/2 left-1/2 z-20 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-white p-4 shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="text-base font-medium">导入</Dialog.Title>
            <Dialog.Close className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="关闭">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">从 GitHub 地址安装，或从本机选择一份 JSON。</Dialog.Description>
          <form
            className="mt-4 grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!url.trim()) return
              onUrl(url.trim())
            }}
          >
            <Label>在线导入</Label>
            <div className="flex gap-2">
              <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="GitHub 上的工作流 JSON 地址" className="search-field min-w-0 flex-1 bg-background" />
              <Button type="submit" disabled={busy}>{busy ? '导入中' : '导入'}</Button>
            </div>
          </form>
          <div className="mt-4 grid gap-2">
            <Label>本地导入</Label>
            <Button type="button" variant="outline" onClick={onLocal}>选择本机 JSON</Button>
          </div>
          {error && <p className="mt-3 text-xs text-muted-foreground">{error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function MarketDetail({
  item,
  installed,
  busy,
  notice,
  error,
  onBack,
  onInstall
}: {
  item: MarketItem
  installed: SavedWorkflow | undefined
  busy: boolean
  notice: string
  error: string
  onBack: () => void
  onInstall: () => void
}) {
  const source = markSource(item, installed)
  return (
    <div className="h-full overflow-y-auto bg-white text-foreground">
      <div className="border-b px-4 py-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}><ArrowLeft />返回</Button>
      </div>
      <div className="grid max-w-xl gap-4 px-4 py-4">
        <div className="flex items-start gap-3">
          <WorkflowMark icon={source.icon} site={source.site} large><MarkIcon slug={item.slug} /></WorkflowMark>
          <div className="min-w-0">
            <h1 className="text-base font-medium">{item.name}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{item.category} · {item.author}</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{item.description}</p>
        {!installed && <Button type="button" disabled={busy} onClick={onInstall}>{busy ? '安装中' : '安装'}</Button>}
        {installed && <SavedActions workflow={installed} />}
        {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
        {error && <p className="text-xs text-muted-foreground">{error}</p>}
      </div>
    </div>
  )
}

function markSource(item: MarketItem, local?: SavedWorkflow): { icon: string; site: string } {
  const fromGraph = local ? workflowSite(local.graph.nodes) : ''
  return { icon: local?.icon || item.icon, site: fromGraph || item.site }
}

function SavedDetail({ workflow, notice, onBack, onDeleted }: { workflow: SavedWorkflow; notice: string; onBack: () => void; onDeleted: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div ref={rootRef} className="relative h-full overflow-y-auto bg-white text-foreground">
      <div className="border-b px-4 py-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}><ArrowLeft />返回</Button>
      </div>
      <div className="grid max-w-xl gap-4 px-4 py-4">
        <div className="flex items-start gap-3">
          <WorkflowMark icon={workflow.icon} site={workflowSite(workflow.graph.nodes)} large><Workflow className="size-5" /></WorkflowMark>
          <div className="min-w-0">
            <h1 className="text-base font-medium">{workflow.name}</h1>
            <p className="mt-1 text-xs text-muted-foreground">{workflow.remark || workflow.params.map((param) => param.name).join('、') || '没有说明'}</p>
          </div>
        </div>
        <SavedActions workflow={workflow} extra={notice} onDelete={() => { setError(''); setAsk(true) }} />
      </div>
      {rootRef.current && (
        <DeleteDialog
          container={rootRef.current}
          open={ask}
          name={workflow.name}
          busy={busy}
          error={error}
          onOpenChange={setAsk}
          onConfirm={() => {
            setBusy(true)
            setError('')
            void window.browser.deleteWorkflow(workflow.id).then(() => onDeleted()).catch((reason: unknown) => {
              setError(explain(reason, '删除失败'))
            }).finally(() => setBusy(false))
          }}
        />
      )}
    </div>
  )
}

function SavedActions({ workflow, extra, onDelete }: { workflow: SavedWorkflow; extra?: string; onDelete?: () => void }) {
  const [notice, setNotice] = useState('')
  const text = extra || notice
  return (
    <>
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => void window.browser.openWorkflow(workflow.id)}>打开画布</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void window.browser.exportWorkflow(workflow.id).then((result) => {
              if (!result.canceled && result.path) setNotice(`已导出 ${result.name}`)
            }).catch((reason: unknown) => {
              setNotice(explain(reason, '导出失败'))
            })
          }}
        >
          导出
        </Button>
        {onDelete && <Button type="button" variant="outline" onClick={onDelete}>删除</Button>}
      </div>
      <WorkflowUse workflow={workflow} />
      {text && <p className="text-xs text-muted-foreground">{text}</p>}
    </>
  )
}
