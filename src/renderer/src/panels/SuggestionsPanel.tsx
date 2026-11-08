import type { ReactNode } from 'react'
import { Clock3, Moon, PanelTop, Search, Star } from 'lucide-react'
import type { AddressSuggestion, SuggestPayload } from '../../../shared/types'
import i18n from '../i18n'

function suggestionHighlight(text: string, indices: number[], className: string): ReactNode {
  if (!indices.length) return text
  const nodes: ReactNode[] = []
  let last = 0
  for (const index of indices) {
    if (index < last || index >= text.length) continue
    if (index > last) nodes.push(text.slice(last, index))
    nodes.push(<mark key={index} className={'rounded-sm px-0 text-inherit ' + className}>{text[index]}</mark>)
    last = index + 1
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function suggestionKindLabel(kind: AddressSuggestion['kind']): string {
  if (kind === 'search') return i18n.t('suggestions.kind.search')
  if (kind === 'bookmark') return i18n.t('suggestions.kind.bookmark')
  if (kind === 'history') return i18n.t('suggestions.kind.history')
  return i18n.t('suggestions.kind.tab')
}

export function SuggestionsPanel({ data }: { data: SuggestPayload }) {
  return (
    <div className="absolute top-0 overflow-hidden border-b border-neutral-200 bg-white shadow-lg" style={{ left: data.left, width: data.width }}>
      <div className="max-h-[70vh] overflow-y-auto">
        {data.items.length === 0 && <p className="px-4 py-8 text-center text-sm text-neutral-500">{i18n.t('suggestions.noMatch')}</p>}
        {data.items.map((item, index) => (
          <button
            key={item.key}
            type="button"
            className={'flex w-full items-center gap-2 px-4 py-2 text-left ' + (index === data.highlight ? 'bg-neutral-100' : 'hover:bg-neutral-50')}
            onClick={() => window.browser.pickSuggestion(item.key)}
          >
            <span className="grid h-4 w-4 shrink-0 place-items-center">
              {item.kind === 'search' ? (
                <Search size={13} className="text-neutral-500" />
              ) : item.kind === 'bookmark' ? (
                <Star size={13} className="text-amber-500" />
              ) : item.kind === 'history' ? (
                <Clock3 size={13} className="text-neutral-400" />
              ) : item.hibernated ? (
                <Moon size={13} className="text-neutral-400" />
              ) : item.favicon ? (
                <img src={item.favicon} alt="" className="h-4 w-4 rounded-sm object-cover" />
              ) : (
                <PanelTop size={13} className="text-neutral-400" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-neutral-900">{suggestionHighlight(item.title, item.titleIndices, 'bg-amber-100')}</span>
              <span className="block truncate text-xs text-neutral-400">{suggestionHighlight(item.url, item.urlIndices, 'bg-blue-100 text-blue-600')}</span>
            </span>
            <span className="shrink-0 text-[10px] text-neutral-400">{suggestionKindLabel(item.kind)}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 border-t border-neutral-100 px-4 py-1.5 text-[11px] text-neutral-500">
        <span className="pr-1">{i18n.t('suggestions.filter')}</span>
        <button
          type="button"
          className={'flex items-center gap-1 rounded px-1.5 py-0.5 ' + (data.filters.history ? 'bg-neutral-200 text-neutral-800' : 'text-neutral-400 hover:bg-neutral-100')}
          onClick={() => window.browser.toggleSuggestFilter('history')}
        ><Clock3 size={12} />{i18n.t('history.title')}</button>
        <button
          type="button"
          className={'flex items-center gap-1 rounded px-1.5 py-0.5 ' + (data.filters.bookmarks ? 'bg-neutral-200 text-neutral-800' : 'text-neutral-400 hover:bg-neutral-100')}
          onClick={() => window.browser.toggleSuggestFilter('bookmarks')}
        ><Star size={12} />{i18n.t('address.bookmark.menu')}</button>
        <button
          type="button"
          className={'flex items-center gap-1 rounded px-1.5 py-0.5 ' + (data.filters.tabs ? 'bg-neutral-200 text-neutral-800' : 'text-neutral-400 hover:bg-neutral-100')}
          onClick={() => window.browser.toggleSuggestFilter('tabs')}
        ><PanelTop size={12} />{i18n.t('suggestions.tabs')}</button>
      </div>
    </div>
  )
}

