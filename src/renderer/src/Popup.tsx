import { useEffect, useState, type ReactNode } from 'react'
import type { LayerPayload, TabInfo, UiState } from '../../shared/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

export function PopupApp() {
  const [state, setState] = useState<UiState | null>(null)
  const [layer, setLayer] = useState<LayerPayload | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupFor, setGroupFor] = useState<TabInfo | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('popup')
    void window.browser.getState().then(setState)
    void window.browser.currentLayer().then(setLayer)
    const offState = window.browser.onState(setState)
    const offLayer = window.browser.onLayer(setLayer)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      void window.browser.closeLayer()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offState()
      offLayer()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const layerKey = layerIdentity(layer)
  useEffect(() => {
    setGroupFor(null)
    setGroupName('')
  }, [layerKey])

  if (!layer) return <div className="h-full" />

  const close = (): void => {
    void window.browser.closeLayer()
  }

  const dim = layer.kind === 'about' || Boolean(groupFor)

  return (
    <div className={`relative flex h-full w-full items-center justify-center ${dim ? 'bg-black/10' : ''}`}>
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default" onClick={close} />
      {layer.kind === 'menu' && state && <WindowMenu x={layer.x} y={layer.y} state={state} close={close} />}
      {layer.kind === 'context' && state && !groupFor && (
        <TabMenu x={layer.x} y={layer.y} state={state} tab={layer.tab} close={close} onGroup={() => setGroupFor(layer.tab)} />
      )}
      {layer.kind === 'context' && state && groupFor && (
        <GroupForm state={state} tab={groupFor} name={groupName} setName={setGroupName} close={close} />
      )}
      {layer.kind === 'about' && state && <AboutCard version={state.version} close={close} />}
    </div>
  )
}

function layerIdentity(layer: LayerPayload | null): string {
  if (!layer) return ''
  if (layer.kind === 'context') return `${layer.kind}:${layer.tab.id}`
  return layer.kind
}

async function saveGroup(state: UiState, tab: TabInfo, name: string, close: () => void): Promise<void> {
  const title = name.trim()
  if (!title) return
  const existing = state.groups.find((group) => group.name === title)
  if (existing) {
    await window.browser.assignGroup({ tabId: tab.id, groupId: existing.id })
    close()
    return
  }
  const result = await window.browser.createGroup({ name: title })
  const groupId = (result as { groupId?: string })?.groupId
  if (groupId) await window.browser.assignGroup({ tabId: tab.id, groupId })
  close()
}

function GroupForm({
  state,
  tab,
  name,
  setName,
  close
}: {
  state: UiState
  tab: TabInfo
  name: string
  setName: (value: string) => void
  close: () => void
}) {
  return (
    <form
      className="relative z-10 grid w-80 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10"
      onMouseDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault()
        void saveGroup(state, tab, name, close)
      }}
    >
      <div>
        <div className="text-base font-medium">加入分组</div>
        <p className="mt-1 text-xs text-muted-foreground">输入分组名称。已有同名分组时，这个标签会放进那一组。</p>
      </div>
      {state.groups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {state.groups.map((group) => (
            <Button
              key={group.id}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void window.browser.assignGroup({ tabId: tab.id, groupId: group.id }).finally(close)
              }}
            >
              <span className="size-2 rounded-full" style={{ background: group.color }} />
              {group.name}
            </Button>
          ))}
        </div>
      )}
      <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="分组名称" />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={close}>取消</Button>
        <Button type="submit">确定</Button>
      </div>
    </form>
  )
}

function AboutCard({ version, close }: { version: string; close: () => void }) {
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

function after(task: Promise<unknown>, close: () => void): void {
  void task.then(() => close())
}

function WindowMenu({ x, y, state, close }: { x: number; y: number; state: UiState; close: () => void }) {
  return (
    <AnchoredMenu x={x} y={y} align="end" className="w-52">
      <DropdownMenuItem onSelect={() => after(window.browser.createEnv({ name: '新环境' }), close)}>新创建窗口</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => after(window.browser.copyEnv(), close)}>复制环境编号</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => after(window.browser.devtools(), close)}>开发者工具</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => after(window.browser.toggleScreen(), close)}>{state.screenRecording ? '停止录屏' : '开始录屏'}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => after(window.browser.openSettings(), close)}>设置</DropdownMenuItem>
    </AnchoredMenu>
  )
}

function TabMenu({
  x,
  y,
  state,
  tab,
  close,
  onGroup
}: {
  x: number
  y: number
  state: UiState
  tab: TabInfo
  close: () => void
  onGroup: () => void
}) {
  const vertical = state.layout === 'left'
  return (
    <AnchoredMenu x={x} y={y} align="start" className="w-72">
      <DropdownMenuItem onSelect={() => { void window.browser.copyTab(tab.id); close() }}>复制标签信息</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.devtoolsTab(tab.id); close() }}>开发者工具</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { void window.browser.openTabBelow(tab.id); close() }}>在下方新建标签页</DropdownMenuItem>
      <DropdownMenuItem onSelect={onGroup}>将标签页添加到新组</DropdownMenuItem>
      {tab.groupId && <DropdownMenuItem onSelect={() => { void window.browser.assignGroup({ tabId: tab.id, groupId: null }); close() }}>移出分组</DropdownMenuItem>}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { void window.browser.reloadTab(tab.id); close() }}>刷新<DropdownMenuShortcut>Ctrl+R</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.duplicateTab(tab.id); close() }}>复制标签页<DropdownMenuShortcut>Ctrl+Shift+K</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.pinTab(tab.id); close() }}>{tab.pinned ? '取消固定标签页' : '固定标签页'}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.muteTab(tab.id); close() }}>{tab.muted ? '取消标签页静音' : '使标签页静音'}<DropdownMenuShortcut>Ctrl+M</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { void window.browser.closeTab(tab.id); close() }}>关闭标签页<DropdownMenuShortcut>Ctrl+W</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.closeOtherTabs(tab.id); close() }}>关闭其他标签页</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.closeTabsBelow(tab.id); close() }}>关闭以下标签页</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { void window.browser.restoreTab(); close() }}>重新打开关闭的标签页<DropdownMenuShortcut>Ctrl+Shift+T</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.updateSettings({ tabLayout: vertical ? 'top' : 'left' }); close() }}>{vertical ? '关闭垂直标签页' : '打开垂直标签页'}<DropdownMenuShortcut>Ctrl+Shift+,</DropdownMenuShortcut></DropdownMenuItem>
    </AnchoredMenu>
  )
}

function AnchoredMenu({
  x,
  y,
  align,
  className,
  children
}: {
  x: number
  y: number
  align: 'start' | 'end'
  className?: string
  children: ReactNode
}) {
  return (
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <span className="fixed size-0" style={{ left: x, top: y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={className} onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
