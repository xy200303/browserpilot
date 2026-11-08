import { useEffect, useRef, useState, type ReactNode } from 'react'
import i18n from './i18n'
import type { LayerPayload, SuggestPayload, TabInfo, UiState } from '../../shared/types'
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
import { AboutCard } from './panels/AboutCard'
import { SuggestionsPanel } from './panels/SuggestionsPanel'
import { EnvPanel } from './panels/EnvPanel'
import { BookmarksPanel } from './panels/BookmarksPanel'
import { TabSearch } from './panels/TabSearch'

export function PopupApp() {
  const [state, setState] = useState<UiState | null>(null)
  const [layer, setLayer] = useState<LayerPayload | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupFor, setGroupFor] = useState<TabInfo | null>(null)
  const [suggestData, setSuggestData] = useState<SuggestPayload | null>(null)
  const layerRef = useRef<LayerPayload | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('popup')
    void window.browser.getState().then(setState)
    void window.browser.currentLayer().then(setLayer)
    const offState = window.browser.onState(setState)
    const offLayer = window.browser.onLayer(setLayer)
    const offSuggest = window.browser.onSuggestData(setSuggestData)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (layerRef.current?.kind === 'suggest') window.browser.hideSuggestions()
      else void window.browser.closeLayer()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offState()
      offLayer()
      offSuggest()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    layerRef.current = layer
  }, [layer])

  const layerKey = layerIdentity(layer)
  useEffect(() => {
    setGroupFor(null)
    setGroupName('')
  }, [layerKey])

  if (!layer) return <div className="h-full" />

  const close = (): void => {
    if (layer?.kind === 'suggest') window.browser.hideSuggestions()
    else void window.browser.closeLayer()
  }

  const dim = layer.kind === 'about' || Boolean(groupFor)

  return (
    <div className={`relative flex h-full w-full items-center justify-center ${dim ? 'bg-black/10' : ''}`}>
      <button type="button" aria-label={i18n.t('shell.common.close')} className="absolute inset-0 cursor-default" onClick={close} />
      {layer.kind === 'menu' && state && <WindowMenu x={layer.x} y={layer.y} state={state} close={close} />}
      {layer.kind === 'context' && state && !groupFor && (
        <TabMenu x={layer.x} y={layer.y} state={state} tab={layer.tab} close={close} onGroup={() => setGroupFor(layer.tab)} />
      )}
      {layer.kind === 'context' && state && groupFor && (
        <GroupForm state={state} tab={groupFor} name={groupName} setName={setGroupName} close={close} />
      )}
      {layer.kind === 'about' && state && <AboutCard version={state.version} close={close} />}
      {layer.kind === 'tabs' && state && <TabSearch state={state} close={close} />}
      {layer.kind === 'bookmarks' && state && <BookmarksPanel x={layer.x} y={layer.y} state={state} close={close} />}
      {layer.kind === 'suggest' && suggestData && <SuggestionsPanel data={suggestData} />}
      {layer.kind === 'env' && state && <EnvPanel x={layer.x} y={layer.y} envId={layer.envId} state={state} close={close} />}
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
        <div className="text-base font-medium">{i18n.t('menu.group.title')}</div>
        <p className="mt-1 text-xs text-muted-foreground">{i18n.t('menu.group.detail')}</p>
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
      <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={i18n.t('menu.group.placeholder')} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={close}>{i18n.t('shell.common.cancel')}</Button>
        <Button type="submit">{i18n.t('shell.common.ok')}</Button>
      </div>
    </form>
  )
}

function after(task: Promise<unknown>, close: () => void): void {
  void task.then(() => close())
}

function WindowMenu({ x, y, state, close }: { x: number; y: number; state: UiState; close: () => void }) {
  return (
    <AnchoredMenu x={x} y={y} align="end" className="w-52">
      <DropdownMenuItem onSelect={() => after(window.browser.createEnv({ name: i18n.t('menu.newEnv') }), close)}>{i18n.t('menu.newEnv')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => after(window.browser.copyEnv(), close)}>{i18n.t('menu.copyAgentPrompt')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => after(window.browser.devtools(), close)}>{i18n.t('menu.devtools')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => after(window.browser.toggleScreen(), close)}>{state.screenRecording ? i18n.t('menu.stopScreen') : i18n.t('menu.startScreen')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => after(window.browser.openHistoryPage(), close)}>{i18n.t('menu.history')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void window.browser.openLayer({ kind: 'bookmarks', x, y })}>{i18n.t('menu.bookmarks')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void window.browser.openTabSearch()}>{i18n.t('menu.searchTabs')}<DropdownMenuShortcut>Ctrl+Shift+A</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => after(window.browser.restoreTab(), close)}>{i18n.t('menu.reopenTab')}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => after(window.browser.openSettings(), close)}>{i18n.t('menu.settings')}</DropdownMenuItem>
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
      <DropdownMenuItem onSelect={() => { void window.browser.copyTab(tab.id); close() }}>{i18n.t('menu.copyTabPrompt')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.devtoolsTab(tab.id); close() }}>{i18n.t('menu.devtools')}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { void window.browser.openTabBelow(tab.id); close() }}>{i18n.t('menu.newTabBelow')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={onGroup}>{i18n.t('menu.addToGroup')}</DropdownMenuItem>
      {tab.groupId && <DropdownMenuItem onSelect={() => { void window.browser.assignGroup({ tabId: tab.id, groupId: null }); close() }}>{i18n.t('menu.removeFromGroup')}</DropdownMenuItem>}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { void window.browser.reloadTab(tab.id); close() }}>{i18n.t('menu.reload')}<DropdownMenuShortcut>Ctrl+R</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.duplicateTab(tab.id); close() }}>{i18n.t('menu.duplicateTab')}<DropdownMenuShortcut>Ctrl+Shift+K</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.pinTab(tab.id); close() }}>{tab.pinned ? i18n.t('menu.unpin') : i18n.t('menu.pin')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.muteTab(tab.id); close() }}>{tab.muted ? i18n.t('menu.unmuteTab') : i18n.t('menu.muteTab')}<DropdownMenuShortcut>Ctrl+M</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem disabled={tab.hibernated || tab.kind !== 'page' || tab.active} onSelect={() => { void window.browser.hibernateTab(tab.id); close() }}>{i18n.t('menu.hibernateTab')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.hibernateOtherTabs(); close() }}>{i18n.t('menu.hibernateOthers')}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { void window.browser.closeTab(tab.id); close() }}>{i18n.t('menu.closeTab')}<DropdownMenuShortcut>Ctrl+W</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.closeOtherTabs(tab.id); close() }}>{i18n.t('menu.closeOthers')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.closeTabsBelow(tab.id); close() }}>{i18n.t('menu.closeBelow')}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => { void window.browser.restoreTab(); close() }}>{i18n.t('menu.reopenTab')}<DropdownMenuShortcut>Ctrl+Shift+T</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void window.browser.updateSettings({ tabLayout: vertical ? 'top' : 'left' }); close() }}>{vertical ? i18n.t('menu.verticalOff') : i18n.t('menu.verticalOn')}<DropdownMenuShortcut>Ctrl+Shift+,</DropdownMenuShortcut></DropdownMenuItem>
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
