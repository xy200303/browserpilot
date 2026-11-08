import { useState } from 'react'
import { ChevronDown, Settings2, Star, X } from 'lucide-react'
import type { UiState } from '../../../shared/types'
import { Button } from '@/components/ui/button'
import { popoverPosition } from './position'
import i18n from '../i18n'

export function BookmarksPanel({ x, y, state, close }: { x: number; y: number; state: UiState; close: () => void }) {
  const width = 320
  const [folded, setFolded] = useState(false)
  const { left, top } = popoverPosition(x, y, width, 8, 360)
  return (
    <div className="absolute z-20 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl" style={{ left, top, width }}>
      <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2">
        <Star size={15} className="text-amber-500" />
        <span className="text-sm font-medium">{i18n.t('address.bookmark.menu')}</span>
        <span className="text-xs text-neutral-400">{state.bookmarks.length}</span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={i18n.t('panels.manageBookmarks')}
          onClick={() => {
            void window.browser.openBookmarksPage()
            close()
          }}
        >
          <Settings2 />
        </Button>
        <Button type="button" variant="ghost" size="icon-xs" title={i18n.t('shell.common.close')} onClick={close}><X /></Button>
      </div>
      <button type="button" className="flex w-full items-center gap-2 border-b border-neutral-100 px-3 py-2 text-left text-sm hover:bg-neutral-50" onClick={() => setFolded(!folded)}>
        <ChevronDown size={14} className={`text-neutral-500 transition-transform ${folded ? "-rotate-90" : ""}`} />
        <Star size={14} className="text-amber-500" />
        <span className="font-medium">{i18n.t('panels.bar')}</span>
        <span className="text-xs text-neutral-400">{state.bookmarks.length}</span>
      </button>
      {!folded && (
      <div className="max-h-[55vh] overflow-y-auto p-1">
        {state.bookmarks.length === 0 && (
          <div className="px-3 py-8 text-center">
            <Star size={20} className="mx-auto text-neutral-300" />
            <p className="mt-2 text-sm text-neutral-500">{i18n.t('panels.emptyBookmarks')}</p>
            <p className="mt-1 text-xs text-neutral-400">{i18n.t('bookmarks.emptyHint')}</p>
          </div>
        )}
        {state.bookmarks.map((item) => (
          <button
            key={item.id}
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-neutral-100"
            title={item.url}
            onClick={() => {
              void window.browser.openBookmark(item.url)
              close()
            }}
          >
            <span className="grid h-4 w-4 shrink-0 place-items-center">
              {item.favicon ? (
                <img src={item.favicon} alt="" className="h-4 w-4 rounded-sm object-cover" />
              ) : (
                <Star size={13} className="text-neutral-400" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">{item.title || item.url}</span>
          </button>
        ))}
      </div>
      )}
    </div>
  )
}
