import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LayerPayload, TabInfo, UiState } from '../../shared/types'
import { SettingsDialog } from './Settings'
import { WorkflowEditor } from './Workflow'
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
  const layerRef = useRef(layer)
  layerRef.current = layer
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
      if (layerRef.current?.kind === 'workflow') {
        void window.browser.openLayer({ kind: 'settings', section: '工作流' })
        return
      }
      void window.browser.closeLayer()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offState()
      offLayer()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    setGroupFor(null)
    setGroupName('')
  }, [layer?.kind, layer && layer.kind === 'context' ? layer.tab.id : ''])

  if (!layer) return <div className="h-full" />

  const close = (): void => {
    void window.browser.closeLayer()
  }

  return (
    <div className={`relative flex h-full w-full items-center justify-center ${layer.kind === 'settings' || layer.kind === 'workflow' || layer.kind === 'about' || groupFor ? 'bg-black/10' : ''}`} onMouseDown={close}>
      {layer.kind === 'menu' && state && (
        <AnchoredMenu x={layer.x} y={layer.y} align="end" className="w-52">
          <DropdownMenuItem onSelect={() => void window.browser.createEnv({ name: '新环境' }).then(close)}>新创建窗口</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void window.browser.copyEnv().then(close)}>复制环境编号</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void window.browser.devtools().then(close)}>开发者工具</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void window.browser.toggleScreen().then(close)}>{state.screenRecording ? '停止录屏' : '开始录屏'}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void window.browser.openLayer({ kind: 'settings', section: '环境' })}>设置</DropdownMenuItem>
        </AnchoredMenu>
      )}
      {layer.kind === 'context' && state && !groupFor && (
        <AnchoredMenu x={layer.x} y={layer.y} align="start" className="w-72">
          <DropdownMenuItem onSelect={() => { void window.browser.copyTab(layer.tab.id); close() }}>复制标签信息</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { void window.browser.devtoolsTab(layer.tab.id); close() }}>开发者工具</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { void window.browser.openTabBelow(layer.tab.id); close() }}>在下方新建标签页</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setGroupFor(layer.tab)}>将标签页添加到新组</DropdownMenuItem>
          {layer.tab.groupId && <DropdownMenuItem onSelect={() => { void window.browser.assignGroup({ tabId: layer.tab.id, groupId: null }); close() }}>移出分组</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { void window.browser.reloadTab(layer.tab.id); close() }}>刷新<DropdownMenuShortcut>Ctrl+R</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { void window.browser.duplicateTab(layer.tab.id); close() }}>复制标签页<DropdownMenuShortcut>Ctrl+Shift+K</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { void window.browser.pinTab(layer.tab.id); close() }}>{layer.tab.pinned ? '取消固定标签页' : '固定标签页'}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { void window.browser.muteTab(layer.tab.id); close() }}>{layer.tab.muted ? '取消标签页静音' : '使标签页静音'}<DropdownMenuShortcut>Ctrl+M</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { void window.browser.closeTab(layer.tab.id); close() }}>关闭标签页<DropdownMenuShortcut>Ctrl+W</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { void window.browser.closeOtherTabs(layer.tab.id); close() }}>关闭其他标签页</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { void window.browser.closeTabsBelow(layer.tab.id); close() }}>关闭以下标签页</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { void window.browser.restoreTab(); close() }}>重新打开关闭的标签页<DropdownMenuShortcut>Ctrl+Shift+T</DropdownMenuShortcut></DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { void window.browser.updateSettings({ tabLayout: state.layout === 'left' ? 'top' : 'left' }); close() }}>{state.layout === 'left' ? '关闭垂直标签页' : '打开垂直标签页'}<DropdownMenuShortcut>Ctrl+Shift+,</DropdownMenuShortcut></DropdownMenuItem>
        </AnchoredMenu>
      )}
      {layer.kind === 'context' && state && groupFor && (
        <form
          className="grid w-80 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10"
          onMouseDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault()
            const name = groupName.trim()
            if (!name) return
            const tabId = groupFor.id
            const existing = state.groups.find((group) => group.name === name)
            const done = (): void => close()
            if (existing) {
              void window.browser.assignGroup({ tabId, groupId: existing.id }).then(done)
              return
            }
            void window.browser.createGroup({ name }).then(async (result) => {
              const groupId = (result as { groupId?: string })?.groupId
              if (groupId) await window.browser.assignGroup({ tabId, groupId })
              done()
            })
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
                    void window.browser.assignGroup({ tabId: groupFor.id, groupId: group.id }).then(close)
                  }}
                >
                  <span className="size-2 rounded-full" style={{ background: group.color }} />
                  {group.name}
                </Button>
              ))}
            </div>
          )}
          <Input
            autoFocus
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="分组名称"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>取消</Button>
            <Button type="submit">确定</Button>
          </div>
        </form>
      )}
      {layer.kind === 'settings' && state && <SettingsDialog state={state} initial={layer.section} onClose={close} />}
      {layer.kind === 'workflow' && state && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          onMouseDown={(event) => {
            event.stopPropagation()
            void window.browser.openLayer({ kind: 'settings', section: '工作流' })
          }}
        >
          <WorkflowWindow state={state} id={layer.id} />
        </div>
      )}
      {layer.kind === 'about' && state && (
        <div className="grid h-full place-items-center" onMouseDown={(event) => event.stopPropagation()}>
          <div className="absolute inset-0 bg-black/30" onMouseDown={close} />
          <div className="relative grid w-80 gap-3 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10" onMouseDown={(event) => event.stopPropagation()}>
            <div className="text-base font-medium">BrowserPilot</div>
            <div className="text-xs text-muted-foreground">版本 {state.version}</div>
            <p className="text-sm">给 Agent 用的浏览器。同一个进程里可以开多套环境，一套环境一扇窗口。</p>
            <div className="flex justify-end">
              <Button type="button" onClick={close}>关闭</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function WorkflowWindow({ state, id }: { state: UiState; id: string }) {
  const workflow = state.workflows.find((item) => item.id === id)
  const back = (): void => {
    void window.browser.openLayer({ kind: 'settings', section: '工作流' })
  }
  return (
    <div
      className="flex h-[min(860px,92vh)] w-[min(1180px,calc(100%-2rem))] flex-col overflow-hidden rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10"
      onMouseDown={(event) => event.stopPropagation()}
    >
      {workflow ? (
        <WorkflowEditor workflow={workflow} onBack={back} />
      ) : (
        <div className="grid gap-3">
          <p className="text-sm">没有这个工作流。</p>
          <div className="flex justify-end">
            <Button type="button" onClick={back}>关闭</Button>
          </div>
        </div>
      )}
    </div>
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
