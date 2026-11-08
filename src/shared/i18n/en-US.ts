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
  }
}
