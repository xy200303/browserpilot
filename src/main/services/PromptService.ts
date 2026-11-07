type PromptEnv = {
  id: string
  name: string
  remark?: string
}

function envLines(env: PromptEnv): string[] {
  return [
    '软件名称：BrowserPilot',
    '环境名称：' + (env.name || env.id),
    '环境编号：' + env.id,
    '环境备注：' + (env.remark?.trim() || '未填写')
  ]
}

export function buildEnvPrompt(env: PromptEnv): string {
  return [
    '你现在使用 BrowserPilot（给 Agent 用的本机浏览器）执行任务。',
    '',
    ...envLines(env),
    '',
    '请通过 BrowserPilot 的 MCP 工具操作这套环境，不要另开 Chrome 或其它浏览器。',
    '调用工具时传 env: "' + env.id + '"；如果这套环境里已经有标签，也可以只传 tabId。',
    '需要人登录、过验证码或确认时用 page_handoff，做完后调用 page_unlock。'
  ].join('\n')
}

export function buildTabPrompt(
  env: PromptEnv,
  tab: { id: string; title?: string; url?: string; page: boolean }
): string {
  const lines = [
    '你现在使用 BrowserPilot（给 Agent 用的本机浏览器）操作一个已经打开的标签页。',
    '',
    ...envLines(env),
    '标签编号：' + tab.id,
    '标签标题：' + (tab.title || '未命名'),
    '标签地址：' + (tab.url || '空')
  ]
  if (tab.page) {
    lines.push(
      '',
      '请直接用这个 tabId 调用 page_* / tab_* 工具，不要另开标签或切换环境。',
      '需要等页面时用 page_wait，不要写死 sleep。',
      '需要人登录、过验证码或确认时用 page_handoff，做完后调用 page_unlock。'
    )
  } else {
    lines.push('', '这是 BrowserPilot 的内置页面，不是网页，不能用 page_* 操作；需要网页操作时先打开一个标签页。')
  }
  return lines.join('\n')
}
