import { searchEngineOf, type SearchEngineId } from '../../../shared/types'

export function SearchEngineIcon({ id }: { id: SearchEngineId }) {
  const name = searchEngineOf(id).name
  return (
    <span className="grid size-4 shrink-0 place-items-center" title={name} aria-hidden="true">
      {id === 'bing' && (
        <svg viewBox="0 0 16 16" className="size-4">
          <path fill="#00809d" d="M2.2 1.2h3.2v13.1L2.2 16z" />
          <path fill="#00a4ef" d="M5.4 1.2v8.1l5.6 1.6-2.2-3.2L5.4 6.2z" />
          <path fill="#7fba00" d="M5.4 9.3 11 10.9 13.6 7.4 8.8 5.4z" />
          <path fill="#ffb900" d="M8.8 5.4 13.6 7.4 14.6 4.2 10.2 2.6z" />
        </svg>
      )}
      {id === 'baidu' && (
        <svg viewBox="0 0 16 16" className="size-4">
          <circle cx="8" cy="10.2" r="3.1" fill="#2932e1" />
          <circle cx="3.7" cy="6.4" r="1.25" fill="#2932e1" />
          <circle cx="6.5" cy="3.8" r="1.25" fill="#2932e1" />
          <circle cx="9.8" cy="3.9" r="1.25" fill="#2932e1" />
          <circle cx="12.4" cy="6.6" r="1.25" fill="#2932e1" />
        </svg>
      )}
      {id === 'google' && (
        <svg viewBox="0 0 48 48" className="size-4">
          <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z" />
        </svg>
      )}
      {id === 'sogou' && (
        <svg viewBox="0 0 16 16" className="size-4">
          <rect width="16" height="16" rx="3" fill="#fb4f2f" />
          <path fill="#fff" d="M4.2 8.2c.2-2 1.4-3.4 3.8-3.4 2.2 0 3.6 1.2 3.8 3.2H9.6c-.1-.8-.6-1.3-1.6-1.3s-1.6.6-1.7 1.5H4.2zm0 1.2h6.2c-.3 1.6-1.6 2.6-3.1 2.6S4.6 11 4.2 9.4z" />
        </svg>
      )}
      {id === 'duckduckgo' && (
        <svg viewBox="0 0 16 16" className="size-4">
          <circle cx="8" cy="8" r="7" fill="#de5833" />
          <path fill="#fff" d="M3.6 9.4c.8-2.2 2.6-3.4 5-3.4 1.5 0 2.6.5 3.2 1.4-.8.2-1.6.6-2.1 1.2H3.6z" />
          <circle cx="6.2" cy="6.3" r=".7" fill="#fff" />
        </svg>
      )}
    </span>
  )
}
