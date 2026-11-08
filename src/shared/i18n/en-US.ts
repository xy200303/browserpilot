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
  }
}
