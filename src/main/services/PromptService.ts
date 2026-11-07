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
    'BrowserPilot v' + (info.version || '') + ' 已装在本机。把它接到你身上，按下面做：',
    '',
    '1) 注册 MCP 服务（Streamable HTTP）：',
    '   URL: ' + info.url,
    '   Authorization: Bearer ' + info.token,
    '   服务器名字用 browserpilot；只加这一条，我已有的其它 MCP 服务器不要动。',
    '   同样的连接信息也写在本机：' + info.file + '。口令只在本机用，不要转发或贴到公开地方。',
    '',
    '2) 安装配套 skill：',
    '   读取 ' + info.skillUrl + '，安装到你的用户级 skills 目录。'
  ]
  if (info.skillPath) lines.push('   本机也有一份：' + info.skillPath)
  lines.push(
    '',
    '3) 命令行工具（MCP 不可用时）：' + info.cliPath,
    '   browserpilot search 关键词                    # 搜工具',
    '   browserpilot schema <工具>                    # 看参数',
    '   browserpilot call <工具> --json-file args.json',
    '',
    '4) 装好后先调 env_list 确认连上，再按我的要求操作浏览器。',
    '   需要人登录、过验证码或确认时用 page_handoff，做完调用 page_unlock。',
    '',
    '如果 MCP 里只看到少量工具，先调 search_tools 搜；也可以让我在设置 > 通用把「工具列表」切成「全部」。'
  )
  return lines.join('\n')
}
