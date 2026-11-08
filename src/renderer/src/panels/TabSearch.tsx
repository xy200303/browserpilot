import { useEffect, useRef, useState } from 'react'
import { Moon, Search } from 'lucide-react'
import type { UiState } from '../../../shared/types'
import { Input } from '@/components/ui/input'
import i18n from '../i18n'

export function TabSearch({ state, close }: { state: UiState; close: () => void }) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  useEffect(() => {
    setHighlight(0)
  }, [query])
  const keyword = query.trim().toLowerCase()
  const tabs = state.tabs.filter(
    (tab) => !keyword || tab.title.toLowerCase().includes(keyword) || tab.url.toLowerCase().includes(keyword)
  )
  const open = (tabId: string): void => {
    void window.browser.activateTab(tabId)
    close()
  }
  return (
    <div className="absolute inset-0 grid place-items-start justify-center bg-black/20 pt-[10vh]" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" aria-label={i18n.t('shell.common.close')} className="absolute inset-0 cursor-default" onClick={close} />
      <div className="relative z-10 w-[min(42rem,calc(100%-2rem))] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
          <Search size={16} className="shrink-0 text-neutral-400" />
          <Input
            ref={ref}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={i18n.t('panels.tabSearchPlaceholder')}
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHighlight((current) => Math.min(current + 1, tabs.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlight((current) => Math.max(current - 1, 0))
              }
              if (event.key === 'Enter' && tabs[highlight]) open(tabs[highlight].id)
            }}
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1">
          {tabs.length === 0 && <p className="p-4 text-sm text-neutral-500">{i18n.t('panels.tabSearchEmpty')}</p>}
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${index === highlight ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => open(tab.id)}
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center">
                {tab.hibernated ? (
                  <Moon size={14} className="text-neutral-400" />
                ) : tab.favicon ? (
                  <img src={tab.favicon} alt="" className="h-4 w-4 rounded-sm object-cover" />
                ) : (
                  <span className="grid h-4 w-4 place-items-center rounded-sm bg-neutral-200 text-[9px] text-neutral-500">
                    {(tab.title || i18n.t('shell.tabs.untitledShort')).slice(0, 1)}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-neutral-900">{tab.title || i18n.t('shell.tabs.untitled')}</span>
                <span className="block truncate text-xs text-neutral-400">{tab.url}</span>
              </span>
              {tab.active && <span className="shrink-0 text-[10px] text-neutral-400">{i18n.t('panels.current')}</span>}
            </button>
          ))}
        </div>
        <div className="border-t border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-400">{i18n.t('panels.tabSearchHint')}</div>
      </div>
    </div>
  )
}

