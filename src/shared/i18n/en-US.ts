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
  },
  settings2: {
    env: {
      search: 'Search environments or sites',
      new: 'New',
      title: 'Environments',
      detail: 'One environment can hold logins for many sites. New windows are headed; closing a window keeps the logins.',
      noMatch: 'No matching environments',
      empty: 'No environments yet',
      initial: 'E',
      open: 'Open',
      show: 'Show',
      statusHeadless: 'Headless window open',
      statusHeaded: 'Headed window open',
      statusClosed: 'Window closed',
      sites: '{{count}} sites',
      noSites: 'No sites opened yet',
      back: 'Back',
      name: 'Name',
      remark: 'Note',
      save: 'Save',
      delete: 'Delete',
      websites: 'Sites',
      noSitesDetail: 'No sites opened yet.',
      cookieOn: 'Cookies kept',
      cookieOff: 'No cookies',
      deleteTitle: 'Delete environment',
      deleteDetail: 'Delete "{{name}}" from this machine. Its logins go too.',
      newTitle: 'New environment',
      newDetail: 'New windows are headed. Closing a window keeps the logins.',
      create: 'Create',
      headless: 'Headless',
      headed: 'Headed',
      notOpen: 'Closed'
    },
    net: {
      title: 'Network',
      detail: 'Requests from this tab. Bodies and cookies stay on this machine.',
      empty: 'Nothing recorded yet. Have the agent call net_start on this tab.'
    },
    privacy: {
      title: 'Privacy and data',
      scope: 'Applies to environment "{{env}}" only.',
      clearTitle: 'Clear browsing data',
      history: 'Browsing history',
      cookies: 'Cookies and site data',
      cache: 'Cache',
      clearSelected: 'Clear selected data',
      clearing: 'Clearing…',
      confirmClear: 'Confirm clear',
      cleared: 'Selected data cleared.',
      clearHint: 'Clearing cookies signs sites out of this environment; clearing cache makes pages reload.',
      permissions: 'Site permissions',
      clearAll: 'Clear all',
      none: 'No site permissions remembered.',
      allow: 'Allow',
      deny: 'Deny',
      revoke: 'Revoke',
      permissionHint: 'System dialogs appear when a page asks for camera, microphone, notifications or location; tick remember and they show up here.',
      perm: {
        media: 'Camera / microphone',
        geolocation: 'Location',
        notifications: 'Notifications',
        clipboard: 'Clipboard',
        display: 'Screen sharing',
        midi: 'MIDI devices',
        pointerLock: 'Pointer lock',
        fullscreen: 'Fullscreen',
        openExternal: 'Open external app'
      }
    },
    passwords: {
      title: 'Passwords',
      detail: 'Logins are remembered when you sign in and filled next time. Isolated per environment, stored on this machine.',
      protect: 'Password protection',
      checking: 'Checking system keychain…',
      secure: 'System keychain in use',
      insecure: 'No system keychain; passwords are only encoded locally',
      checkingShort: 'Checking',
      encrypted: 'Encrypted',
      plain: 'Not encrypted',
      revealFailed: '(cannot be decrypted: keychain unavailable or changed)',
      insecureDetail: 'Systems without gnome-keyring or kwallet (headless Ubuntu and so on) take this path: the file stays local, but anyone who can read this user directory can decrypt it. Turn off auto save, or set up a keychain and restart; delete stored passwords here.',
      autoSave: 'Save automatically',
      autoSaveDetail: 'Remember credentials when a login form is submitted. Existing entries still autofill after turning this off.',
      autoFill: 'Autofill',
      autoFillDetail: 'Fill account and password on login pages, without overwriting what is already typed.',
      empty: 'No saved passwords yet. Sign in once inside this environment and they appear here.',
      noUsername: '(no account)',
      hide: 'Hide',
      show: 'Show',
      delete: 'Delete',
      clear: 'Clear passwords for this environment'
    },
    general: {
      searchEngine: 'Search engine',
      searchEngineDetail: 'New tabs open this engine home page. Typing in the address bar also searches with it.',
      tabLayout: 'Tab bar',
      tabLayoutDetail: 'Top is a horizontal strip. Left is vertical and overlays the page until pinned.',
      top: 'Top',
      left: 'Left',
      downloadDir: 'Download folder',
      downloadDirDetail: 'Page downloads, media saved by the agent and window recordings land here. Default is the system download folder.',
      systemDir: 'System download folder',
      choose: 'Choose…',
      resetDefault: 'Reset to default',
      toolMode: 'Tool list',
      toolModeDetail: 'What the agent can see. Search mode exposes core tools and leaves the rest to search_tools; full mode exposes everything and costs more context.',
      search: 'On demand',
      full: 'All',
      connect: 'Connect an agent',
      connectDetail: 'Copy a prompt for another agent: MCP address and token, skill and CLI installation.',
      copyPrompt: 'Copy prompt',
      mcp: 'MCP',
      mcpDetail: 'Listens on 127.0.0.1 only. Turning it off and on again restarts the service on the port.',
      field: {
        address: 'Listen address',
        port: 'Port',
        endpoint: 'Endpoint',
        concurrency: 'Batch concurrency',
        headlessLimit: 'Headless window limit'
      }
    },
    about: {
      title: 'About',
      tagline: 'A browser for agents. Multiple isolated environments in one process, one window each.',
      version: 'Version',
      versionDetail: 'Version shipped in the installer'
    }
  }
}
