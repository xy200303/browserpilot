import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ArrowLeft, ArrowRight, Bookmark, Clock3, Download, Moon, MoreVertical, PanelTop, RotateCw, Search, Star, Workflow, X } from 'lucide-react'
import i18n from './i18n'
import { searchEngineOf, type AddressSuggestion, type HistoryEntry, type SuggestionFilters, type TabInfo, type UiState } from '../../shared/types'
import { SearchEngineIcon } from '@/components/SearchEngineIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function addressPlaceholder(active: TabInfo | undefined, engineName: string): string {
  if (active?.kind === 'market') return i18n.t('address.kind.market')
  if (active?.kind === 'settings') return i18n.t('address.kind.settings')
  if (active?.kind === 'downloads') return i18n.t('address.kind.downloads')
  if (active?.kind === 'runs') return i18n.t('address.kind.runs')
  if (active?.kind === 'history') return i18n.t('address.kind.history')
  if (active?.kind === 'bookmarks') return i18n.t('address.kind.bookmarks')
  if (active?.kind === 'workflow') return active.title
  return i18n.t('address.placeholder', { engine: engineName })
}

function LoadProgress({ tab }: { tab: TabInfo | undefined }) {
  const [width, setWidth] = useState(0)
  const loading = Boolean(tab?.loading)
  useEffect(() => {
    if (!loading) {
      setWidth(100)
      const timer = setTimeout(() => setWidth(0), 260)
      return () => clearTimeout(timer)
    }
    setWidth(Math.max(8, tab?.progress ?? 0))
    const timer = setInterval(() => {
      setWidth((current) => (current >= 90 ? current : Math.min(90, current + Math.max(1.5, (90 - current) * 0.12))))
    }, 200)
    return () => clearInterval(timer)
  }, [loading, tab?.id, tab?.progress])
  return (
    <div className={`nav-progress ${loading ? 'active' : ''}`} aria-hidden="true">
      <span style={{ width: `${width}%` }} />
    </div>
  )
}

type SuggestionKind = AddressSuggestion['kind']

function fuzzyMatch(text: string, query: string): { score: number; indices: number[] } | null {
  const haystack = text.toLowerCase()
  const needle = query.trim().toLowerCase()
  if (!needle) return { score: 0, indices: [] }
  let cursor = 0
  let score = 0
  let run = 0
  const indices: number[] = []
  for (const char of needle) {
    const at = haystack.indexOf(char, cursor)
    if (at < 0) return null
    const boundary = at === 0 || /[\s\-_./:?=&#]/.test(haystack[at - 1])
    const adjacent = at === cursor
    score += 1 + (boundary ? 4 : 0) + (adjacent ? 2 + run : 0)
    score -= Math.min(2, at - cursor) * 0.3
    indices.push(at)
    cursor = at + 1
    run = adjacent ? run + 1 : 0
  }
  const exact = haystack.indexOf(needle)
  if (exact >= 0) {
    score += 15
    if (exact === 0) score += 10
    else if (/[\s\-_./:?=&#]/.test(haystack[exact - 1])) score += 5
  }
  return { score, indices }
}

function scoreSuggestion(kind: SuggestionKind, title: string, url: string, query: string, recency: number): { score: number; titleIndices: number[]; urlIndices: number[] } | null {
  const titleMatch = query ? fuzzyMatch(title, query) : { score: 0, indices: [] }
  const urlMatch = query ? fuzzyMatch(url, query) : { score: 0, indices: [] }
  if (query && !titleMatch && !urlMatch) return null
  const base = Math.max(titleMatch?.score ?? 0, urlMatch?.score ?? 0)
  const kindBonus = kind === 'bookmark' ? 4 : kind === 'tab' ? 2 : 0
  const age = Math.min(3, Math.max(0, (recency - (Date.now() - 7 * 86400000)) / (7 * 86400000) * 3))
  return { score: base + kindBonus + age, titleIndices: titleMatch?.indices ?? [], urlIndices: urlMatch?.indices ?? [] }
}

export function AddressBar({
  state,
  active,
  address,
  setAddress,
  addressRef,
  onReloadBuiltin
}: {
  state: UiState
  active: TabInfo | undefined
  address: string
  setAddress: (value: string) => void
  addressRef: RefObject<HTMLInputElement | null>
  onReloadBuiltin: (tabId: string) => void
}) {
  const builtin = active?.kind === 'market' || active?.kind === 'settings' || active?.kind === 'workflow' || active?.kind === 'downloads' || active?.kind === 'runs' || active?.kind === 'history' || active?.kind === 'bookmarks'
  const bookmarked = active?.kind === 'page' && state.bookmarks.some((item) => item.url === active.url)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [filters, setFilters] = useState<SuggestionFilters>({ history: true, bookmarks: true, tabs: true })
  const formRef = useRef<HTMLFormElement>(null)
  const suggestOpenRef = useRef(false)

  const suggestions = useMemo(() => {
    const query = address.trim()
    const now = Date.now()
    const engine = searchEngineOf(state.settings.searchEngine)
    const list: AddressSuggestion[] = []
    if (query) {
      list.push({
        key: 'search',
        kind: 'search',
        title: i18n.t('address.searchTitle', { query, engine: i18n.t(`searchEngine.${engine.id}`) }),
        url: engine.search + encodeURIComponent(query),
        titleIndices: [],
        urlIndices: [],
        score: 1_000_000
      })
    }
    const add = (kind: SuggestionKind, title: string, url: string, recency: number, favicon?: string, tabId?: string, hibernated?: boolean): void => {
      const match = scoreSuggestion(kind, title, url, query, recency)
      if (!match) return
      list.push({ key: kind + ':' + (tabId ?? url), kind, title, url, favicon, titleIndices: match.titleIndices, urlIndices: match.urlIndices, score: match.score, tabId, hibernated })
    }
    if (filters.bookmarks) {
      for (const item of state.bookmarks) add('bookmark', item.title || item.url, item.url, item.createdAt, item.favicon)
    }
    if (filters.history) {
      for (const item of history) add('history', item.title || item.url, item.url, item.visitedAt, item.favicon)
    }
    if (filters.tabs) {
      state.tabs.filter((tab) => tab.kind === 'page').forEach((tab, index) => {
        add('tab', tab.title || i18n.t('shell.tabs.untitled'), tab.url, now - index * 1000, tab.favicon, tab.id, tab.hibernated)
      })
    }
    const seen = new Set<string>()
    return list
      .filter((item) => {
        if (item.kind === 'search') return true
        if (seen.has(item.url)) return false
        seen.add(item.url)
        return true
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  }, [address, filters, history, state.bookmarks, state.settings.searchEngine, state.tabs])

  const loadHistory = (): void => {
    void window.browser.listHistory().then(setHistory).catch(() => undefined)
  }
  const choose = (url: string): void => {
    setAddress(url)
    setSuggestOpen(false)
    setHighlight(-1)
    void window.browser.navigate(url)
  }
  const select = (item: AddressSuggestion): void => {
    if (item.kind === 'tab' && item.tabId) {
      void window.browser.activateTab(item.tabId)
      setSuggestOpen(false)
      setHighlight(-1)
      return
    }
    choose(item.url)
  }
  useEffect(() => {
    setSuggestOpen(false)
    setHighlight(-1)
  }, [active?.id, active?.url])

  useEffect(() => {
    const onDown = (event: globalThis.MouseEvent): void => {
      if (formRef.current && !formRef.current.contains(event.target as Node)) {
        setSuggestOpen(false)
        setHighlight(-1)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  useEffect(() => {
    if (!suggestOpen || builtin) {
      if (suggestOpenRef.current) {
        suggestOpenRef.current = false
        window.browser.hideSuggestions()
      }
      return
    }
    suggestOpenRef.current = true
    const rect = formRef.current?.getBoundingClientRect()
    window.browser.updateSuggestions({
      items: suggestions,
      highlight,
      filters,
      query: address,
      left: rect?.left ?? 8,
      width: rect?.width ?? window.innerWidth - 16
    })
  }, [suggestOpen, builtin, suggestions, highlight, filters, address])

  useEffect(() => {
    const offHide = window.browser.onSuggestHide(() => {
      suggestOpenRef.current = false
      setSuggestOpen(false)
      setHighlight(-1)
    })
    const offFilter = window.browser.onSuggestFilter((key) => {
      setFilters((current) => ({ ...current, [key]: !current[key] }))
      setHighlight(-1)
    })
    return () => {
      offHide()
      offFilter()
      window.browser.hideSuggestions()
    }
  }, [])

  return (
    <>
      <div className="relative flex h-12 items-center gap-1 bg-[#f3f3f3] px-2">
        <Button variant="ghost" size="icon" className="no-drag" title={i18n.t('address.nav.back')} disabled={!state.canBack} onClick={() => void window.browser.back()}><ArrowLeft /></Button>
        <Button variant="ghost" size="icon" className="no-drag" title={i18n.t('address.nav.forward')} disabled={!state.canForward} onClick={() => void window.browser.forward()}><ArrowRight /></Button>
        <Button variant="ghost" size="icon" className="no-drag" title={active?.loading ? i18n.t('address.nav.stop') : i18n.t('address.nav.reload')} onClick={() => {
          if (active?.loading) {
            void window.browser.stop()
            return
          }
          if (active && active.kind !== 'page') onReloadBuiltin(active.id)
          else void window.browser.reload()
        }}>{active?.loading ? <X /> : <RotateCw />}</Button>
        <form
          ref={formRef}
          className="mx-1 flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (highlight >= 0 && suggestions[highlight]) {
              select(suggestions[highlight])
              return
            }
            setSuggestOpen(false)
            void window.browser.navigate(address)
          }}
        >
          {!builtin && <SearchEngineIcon id={state.settings.searchEngine} />}
          <Input
            ref={addressRef}
            value={address}
            onChange={(event) => {
              setAddress(event.target.value)
              setHighlight(-1)
              if (!builtin) setSuggestOpen(true)
            }}
            onFocus={(event) => {
              event.currentTarget.select()
              if (builtin) return
              loadHistory()
              setSuggestOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSuggestOpen(true)
                setHighlight((current) => Math.min(current + 1, suggestions.length - 1))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlight((current) => Math.max(current - 1, -1))
                return
              }
              if (event.key === 'Escape') {
                setSuggestOpen(false)
                setHighlight(-1)
                return
              }
              if (event.key === 'Enter' && highlight >= 0 && suggestions[highlight]) {
                event.preventDefault()
                select(suggestions[highlight])
              }
            }}
            placeholder={addressPlaceholder(active, searchEngineOf(state.settings.searchEngine).name)}
            readOnly={builtin}
          />
        </form>
        <LoadProgress tab={active} />
        <Button variant="ghost" size="icon" className="no-drag" title={bookmarked ? i18n.t('address.bookmark.remove') : i18n.t('address.bookmark.add')} onClick={() => void window.browser.toggleBookmark()}><Star fill={bookmarked ? 'currentColor' : 'none'} className={bookmarked ? 'text-amber-500' : ''} /></Button>
        <Button
          variant="ghost"
          size="icon"
          className="no-drag"
          title={i18n.t('address.bookmark.menu')}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            void window.browser.openLayer({ kind: 'bookmarks', x: rect.right, y: rect.bottom })
          }}
        >
          <Bookmark />
        </Button>
        <Button variant="ghost" size="icon" className="no-drag relative" title={i18n.t('address.downloads')} onClick={() => void window.browser.openDownloads()}><Download />{state.downloads.some((d) => d.state === 'progressing') && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-blue-600" />}</Button>
        <Button variant="ghost" size="icon" className="no-drag" title={i18n.t('address.market')} onClick={() => void window.browser.openMarket()}><Workflow /></Button>
        {state.screenRecording && <span className="rounded-md bg-destructive px-1.5 py-0.5 text-xs text-white">{i18n.t('shell.screen.badge')}</span>}
        <Button
          variant="ghost"
          size="icon"
          className="no-drag"
          title={i18n.t('address.menu')}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            void window.browser.openLayer({ kind: 'menu', x: rect.right, y: rect.bottom })
          }}
        >
          <MoreVertical />
        </Button>
      </div>
    </>
  )
}

