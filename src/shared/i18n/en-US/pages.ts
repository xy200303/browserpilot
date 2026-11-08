import type { MessageShape } from '../shape'
import type { zhPages } from '../zh-CN/pages'

export const enPages: MessageShape<typeof zhPages> = {
  downloads: {
    title: 'Downloads',
    clear: 'Clear finished',
    empty: 'Nothing yet. Files downloaded in the browser, saved media and agent exports all show up here.',
    progress: 'Downloading {{done}}{{total}}{{pct}}',
    paused: 'Paused {{done}}',
    completed: '{{done}} · finished',
    cancelled: 'Cancelled',
    failed: 'Failed: {{error}}',
    failedPlain: 'Failed',
    action: {
      pause: 'Pause',
      resume: 'Resume',
      cancel: 'Cancel',
      retry: 'Retry',
      open: 'Open',
      show: 'Show in folder',
      copyLink: 'Copy download link'
    }
  },
  history: {
    title: 'History',
    count: '{{count}} entries',
    today: 'Today',
    yesterday: 'Yesterday',
    date: '{{year}}-{{month}}-{{day}}',
    deleteOne: 'Delete this entry',
    refresh: 'Refresh',
    clear: 'Clear history',
    confirmClear: 'Click again to clear this environment',
    placeholder: 'Search titles or addresses',
    empty: 'No history yet',
    noMatch: 'No matching entries',
    emptyHint: 'Entries appear here after you browse.',
    footer: 'History stays on this machine, isolated per environment, capped at 3000 entries.'
  },
  bookmarks: {
    title: 'Bookmarks',
    count: '{{count}} entries',
    clear: 'Clear bookmarks',
    confirmClear: 'Click again to clear this environment',
    placeholder: 'Search bookmarks',
    empty: 'No bookmarks yet',
    emptyHint: 'Press Ctrl+D on a page, or use the star on the right of the address bar.',
    noMatch: 'No matching bookmarks',
    delete: 'Delete bookmark',
    footer: 'Bookmarks stay on this machine, isolated per environment.'
  },
  env: {
    missing: 'This environment is gone.',
    edit: 'Edit environment',
    name: 'Name',
    remark: 'Note',
    remarkPlaceholder: 'What this environment is for',
    saving: 'Saving…',
    save: 'Save'
  },
  about: {
    version: 'Version {{version}}',
    tagline: 'A browser for agents. Multiple isolated environments in one process, one window each.'
  },
  suggestions: {
    kind: {
      search: 'Search',
      bookmark: 'Bookmark',
      history: 'History',
      tab: 'Tab'
    },
    filter: 'Filter:',
    tabs: 'Tabs',
    noMatch: 'No matching entries'
  },
  panels: {
    manageBookmarks: 'Manage bookmarks',
    bar: 'Bookmarks bar',
    emptyBookmarks: 'No saved pages yet',
    current: 'Current',
    tabSearchPlaceholder: 'Search tabs',
    tabSearchEmpty: 'No matching tabs',
    tabSearchHint: '↑↓ select · Enter open · Esc close'
  }
}
