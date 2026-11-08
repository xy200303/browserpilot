import type { MessageShape } from '../shape'
import type { zhMain } from '../zh-CN/main'

export const enMain: MessageShape<typeof zhMain> = {
  main: {
    perm: {
      media: 'camera and microphone',
      geolocation: 'your location',
      notifications: 'notifications',
      clipboard: 'the clipboard',
      display: 'screen sharing',
      midi: 'MIDI devices',
      pointerLock: 'pointer lock',
      fullscreen: 'fullscreen',
      openExternal: 'an external app'
    },
    prompt: {
      title: 'Site permission',
      message: '{{origin}} wants to use {{permission}}',
      detail: 'Applies to this environment only; other environments are separate.',
      remember: 'Remember this choice',
      allow: 'Allow',
      deny: 'Deny'
    },
    menu: {
      openInNewTab: 'Open in new tab',
      copyLink: 'Copy link address',
      viewImage: 'Open image in new tab',
      saveImageAs: 'Save image as…',
      copyImage: 'Copy image',
      copyImageAddress: 'Copy image address',
      saveVideoAs: 'Save video as…',
      saveAudioAs: 'Save audio as…',
      cut: 'Cut',
      copy: 'Copy',
      paste: 'Paste',
      selectAll: 'Select all',
      reload: 'Reload',
      viewSource: 'View page source',
      inspect: 'Inspect',
      nativeMenu: 'Page menu'
    },
    dialog: {
      saveAs: 'Save as',
      allFiles: 'All files',
      selectDownloadDir: 'Choose download folder',
      exportWorkflow: 'Export workflow',
      importWorkflow: 'Import workflow',
      json: 'JSON file'
    },
    label: {
      mp4: 'MP4 video',
      m4a: 'Audio',
      png: 'PNG image',
      jpg: 'JPEG image',
      jpeg: 'JPEG image',
      webp: 'WebP image',
      gif: 'GIF image',
      svg: 'SVG image',
      mp3: 'MP3 audio'
    },
    err: {
      noEnv: 'No such environment {{id}}',
      headlessLimit: 'Headless window limit reached ({{limit}})',
      noWorkflow: 'No such workflow {{id}}',
      noTab: 'No such tab {{id}}',
      downloadFailed: 'Download failed',
      saveFailed: 'Save failed',
      notPage: 'Only page tabs support this'
    },
    placeholder: {
      unnamedFile: 'Untitled file',
      newEnv: 'New environment',
      noRemark: 'No note'
    },
    paramHint: {
      number: 'a number',
      time: 'a time like 2026-09-30 11:58',
      timeRange: 'a range like 2026-09-30 11:58 ~ 2026-09-30 18:00',
      select: 'one of: {{options}}',
      selectAny: 'single choice',
      checkbox: 'multiple, comma separated: {{options}}',
      checkboxAny: 'multiple, comma separated',
      text: 'text'
    },
    lock: {
      working: 'The agent is operating the browser',
      takeOver: 'Take over'
    },
    screen: {
      notStarted: 'Recording did not start',
      notMp4: 'Could not write an mp4'
    },
    agent: {
      runInstalled: 'Ask BrowserPilot to run the installed workflow: {{name}}.',
      runHint: 'Call workflow_run with name "{{name}}".',
      inputs: 'Use these values for inputs (match by name, do not invent):\n{{list}}',
      noParams: 'This workflow takes no parameters.',
      unlock: 'Call page_unlock when done.'
    }
  }
}
