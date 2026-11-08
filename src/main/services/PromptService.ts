type PromptEnv = {
  id: string
  name: string
  remark?: string
}

function envLines(env: PromptEnv): string[] {
  return [
    'Software: BrowserPilot',
    'Environment: ' + (env.name || env.id),
    'Environment id: ' + env.id,
    'Environment note: ' + (env.remark?.trim() || 'none')
  ]
}

export function buildEnvPrompt(env: PromptEnv): string {
  return [
    'You are using BrowserPilot, a local browser for agents, to carry out a task.',
    '',
    ...envLines(env),
    '',
    'Operate this environment through BrowserPilot MCP tools. Do not launch Chrome or another browser.',
    'Pass env: "' + env.id + '" on tool calls; if this environment already has tabs, tabId alone is enough.',
    'When a human must sign in, solve a captcha or confirm something, call page_handoff and page_unlock afterwards.'
  ].join('\n')
}

export function buildTabPrompt(
  env: PromptEnv,
  tab: { id: string; title?: string; url?: string; page: boolean }
): string {
  const lines = [
    'You are using BrowserPilot, a local browser for agents, to operate an open tab.',
    '',
    ...envLines(env),
    'Tab id: ' + tab.id,
    'Tab title: ' + (tab.title || 'untitled'),
    'Tab url: ' + (tab.url || 'empty')
  ]
  if (tab.page) {
    lines.push(
      '',
      'Use this tabId with page_* and tab_* tools. Do not open another tab or switch environments.',
      'Use page_wait instead of hard-coded sleeps.',
      'When a human must sign in, solve a captcha or confirm something, call page_handoff and page_unlock afterwards.'
    )
  } else {
    lines.push('', 'This is a built-in BrowserPilot page, not a web page: page_* tools do not apply. Open a tab when you need web automation.')
  }
  return lines.join('\n')
}

export type ConnectInfo = {
  url: string
  token: string
  file: string
  skillUrl: string
  skillPath?: string
  cliPath: string
  version?: string
}

export function buildConnectPrompt(info: ConnectInfo): string {
  const lines = [
    'BrowserPilot v' + (info.version || '') + ' is installed on this machine. Connect it to yourself as follows:',
    '',
    '1) Register the MCP server (Streamable HTTP):',
    '   URL: ' + info.url,
    '   Authorization: Bearer ' + info.token,
    '   Name the server browserpilot; add only this entry and leave my other MCP servers untouched.',
    '   The same connection details are stored locally in ' + info.file + '. The token is local: do not forward it or paste it anywhere public.',
    '',
    '2) Install the companion skill:',
    '   Read ' + info.skillUrl + ' and install it into your user-level skills directory.'
  ]
  if (info.skillPath) lines.push('   A local copy exists at ' + info.skillPath)
  lines.push(
    '',
    '3) CLI fallback when MCP is unavailable: ' + info.cliPath,
    '   browserpilot search <keyword>                 # find tools',
    '   browserpilot schema <tool>                    # show parameters',
    '   browserpilot call <tool> --json-file args.json',
    '',
    '4) After wiring it up, call env_list to confirm the connection, then operate the browser as I ask.',
    '   When a human must sign in, solve a captcha or confirm something, call page_handoff and page_unlock afterwards.',
    '',
    'If only a few tools show up in MCP, call search_tools first; I can also switch Settings > General > Tool list to All.'
  )
  return lines.join('\n')
}
