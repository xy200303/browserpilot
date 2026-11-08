import type { MessageShape } from './zh-CN'
import { zhCN } from './zh-CN'

export const enUS: MessageShape<typeof zhCN> = {
  app: {
    name: 'BrowserPilot'
  },
  settings: {
    title: 'Settings',
    sections: {
      env: 'Environments',
      net: 'Network',
      general: 'General',
      passwords: 'Passwords',
      privacy: 'Privacy',
      about: 'About'
    },
    general: {
      title: 'General',
      detail: 'Stored on this machine. Changes apply immediately.',
      language: {
        title: 'Language',
        detail: 'Interface only. Tool descriptions and errors stay in English so the same prompt is not doubled per language.',
        auto: 'Follow system'
      }
    }
  },
  shell: {
    screen: {
      noMp4: 'Could not write an mp4 this time',
      notStarted: 'Recording did not start',
      badge: 'REC'
    },
    tabs: {
      scrollLeft: 'Scroll left',
      scrollRight: 'Scroll right',
      new: 'New tab',
      close: 'Close',
      mute: 'Mute',
      unmute: 'Unmute',
      untitled: 'New tab',
      untitledShort: 'N'
    },
    window: {
      minimize: 'Minimize',
      restore: 'Restore',
      maximize: 'Maximize',
      close: 'Close'
    },
    env: {
      editTitle: 'Edit environment name and note'
    },
    find: {
      placeholder: 'Find in page',
      action: 'Find',
      close: 'Close find bar'
    },
    error: {
      offline: 'You are offline',
      notFound: 'This site can not be reached',
      refused: 'Connection refused',
      timeout: 'Connection timed out',
      cert: 'Certificate problem',
      generic: 'This page is not available',
      code: 'Error {{code}}',
      retry: 'Retry',
      back: 'Go back',
      hint: {
        offline: 'Check the cable, Wi-Fi or proxy settings, then retry.',
        notFound: 'Check the address, or whether the domain still exists.',
        refused: 'The server refused the connection. The service may be down or on another port.',
        timeout: 'The server did not answer in time. Try again later.',
        cert: 'The certificate could not be verified. Do not enter passwords or payment details here.',
        changed: 'The network changed. Retrying usually helps.',
        fallback: 'The page failed to load. Retry or go back.'
      }
    },
    workflow: {
      missing: 'No such workflow.'
    },
    common: {
      close: 'Close',
      cancel: 'Cancel',
      ok: 'OK'
    }
  },
  address: {
    kind: {
      market: 'Workflows',
      settings: 'Settings',
      downloads: 'Downloads',
      runs: 'Runs',
      history: 'History',
      bookmarks: 'Bookmarks'
    },
    placeholder: 'Search {{engine}} or enter an address',
    searchTitle: '{{query}} - {{engine}} search',
    nav: {
      back: 'Back',
      forward: 'Forward',
      stop: 'Stop loading',
      reload: 'Reload'
    },
    bookmark: {
      add: 'Bookmark this page',
      remove: 'Remove bookmark',
      menu: 'Bookmarks'
    },
    downloads: 'Downloads',
    market: 'Workflows',
    menu: 'Menu'
  },
  menu: {
    newEnv: 'New environment',
    copyAgentPrompt: 'Copy agent prompt',
    devtools: 'Developer tools',
    startScreen: 'Start recording',
    stopScreen: 'Stop recording',
    history: 'History',
    bookmarks: 'Bookmarks',
    searchTabs: 'Search tabs',
    reopenTab: 'Reopen closed tab',
    settings: 'Settings',
    copyTabPrompt: 'Copy tab prompt',
    newTabBelow: 'New tab below',
    addToGroup: 'Add tab to new group',
    removeFromGroup: 'Remove from group',
    reload: 'Reload',
    duplicateTab: 'Duplicate tab',
    pin: 'Pin tab',
    unpin: 'Unpin tab',
    muteTab: 'Mute tab',
    unmuteTab: 'Unmute tab',
    hibernateTab: 'Hibernate tab',
    hibernateOthers: 'Hibernate other tabs',
    closeTab: 'Close tab',
    closeOthers: 'Close other tabs',
    closeBelow: 'Close tabs below',
    verticalOn: 'Enable vertical tabs',
    verticalOff: 'Disable vertical tabs',
    group: {
      title: 'Add to group',
      detail: 'Enter a group name. An existing group with the same name is reused.',
      placeholder: 'Group name'
    }
  },
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
  rail: {
    newTab: 'New tab',
    closeOthers: 'Close other tabs',
    pin: 'Pin tab rail',
    unpin: 'Unpin tab rail',
    options: 'Tab options'
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
  },
  market: {
    run: 'Run',
    running: 'Running',
    runFailed: 'Run failed',
    runDone: 'Run finished',
    noParams: 'No parameters for this run.',
    copiedPrompt: 'Agent prompt copied',
    copyFailed: 'Copy failed',
    giveToAgent: 'Hand to agent',
    runs: 'Runs',
    timeFrom: 'Start',
    timeTo: 'End',
    timeSeparator: 'to'
  },
  marketPage: {
    all: 'All',
    noDescription: 'No description',
    catalogError: 'Could not reach the catalog on GitHub',
    searchPlaceholder: 'Search workflows',
    installedCount: 'Installed {{count}}',
    import: 'Import',
    importing: 'Importing',
    installedOnly: 'Installed',
    catalog: 'Catalog',
    noMatch: 'No matching workflows',
    noneInstalled: 'No workflows installed yet',
    noneAvailable: 'No workflows to install',
    install: 'Install',
    installing: 'Installing',
    delete: 'Delete',
    deleting: 'Deleting',
    deleteTitle: 'Delete workflow',
    deleteDetail: 'Delete "{{name}}" from this machine. Copies in the catalog can be installed again.',
    importTitle: 'Import',
    importDetail: 'Install from a GitHub address, or pick a JSON file on this machine.',
    importOnline: 'From URL',
    importUrlPlaceholder: 'Workflow JSON address on GitHub',
    importLocal: 'From file',
    pickJson: 'Choose JSON file',
    back: 'Back',
    openCanvas: 'Open canvas',
    export: 'Export',
    installedNotice: 'Installed {{name}}',
    importedNotice: 'Imported {{name}}',
    deletedNotice: 'Deleted {{name}}',
    exportedNotice: 'Exported {{name}}',
    installFailed: 'Install failed',
    importFailed: 'Import failed',
    deleteFailed: 'Delete failed',
    exportFailed: 'Export failed'
  }
}
