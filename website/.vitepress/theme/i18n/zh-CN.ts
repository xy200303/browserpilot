export const zhCN = {
  hero: {
    notice: { tag: 'v0.19.0', text: '性能版：10 标签内存降约 30%，用户目录减半，安装包更小' },
    kicker: 'MCP · 99 TOOLS · 0.19.0',
    title: ['你已经登录的浏览器，', 'Agent 接着用。'],
    titleMobile: ['你已经登录，', 'Agent 接着点。'],
    sub: '一套环境一套登录。Agent 在同一扇窗口里点击、填表、等待、提取结果；你随时能接管。 Windows / macOS / Linux，都在本机。',
    cta: { download: '下载 v0.19.0', watch: '看它跑一遍' },
    meta: ['本机 MCP · 127.0.0.1', '22 种工作流节点', '极验 v4 滑块', '安装包未签名']
  },
  demo: {
    bar: 'BrowserPilot · 真实运行 · 窗口 1280 × 800',
    captionStrong: '一个真实任务：',
    caption: '在问卷星的「生活常识在线考试」里自动答题，5 道题全部答对，拿到 100 分。录屏从空白试卷开始，中间是逐题选择，最后停在成绩页。',
    time: '13 秒 · 无声循环 · 实录',
    notes: [
      { b: '01 输入', text: '打开一份真实的在线考试，Agent 自己读题、判断答案。' },
      { b: '02 窗口里的动作', text: '在页面里逐题点选答案；窗口、页面和录屏标记都是真的。' },
      { b: '03 结果', text: '点交卷，当场出分：答对 5 / 5 题，100 分。' }
    ]
  },
  stats: [
    { value: '99', label: 'MCP 工具', note: 'tool-catalog.ts 的实际工具数' },
    { value: '22', label: '工作流节点', note: '开始/结束/判断/循环都算在内' },
    { value: '200', label: '运行记录上限', note: '界面列表最多显示 50 条' },
    { value: '3', label: '并发与无头窗口', note: '默认各 3，设置里可调' }
  ],
  marquee: [
    '导航与定位', '表单与上传', '多标签与环境', '等待与重试', '结果提取',
    '下载与媒体', '标签级抓包', '极验滑块', '本机 MCP', '工作流回放'
  ],
  how: {
    eyebrow: '怎么工作',
    title: '先给任务，<span>再看结果</span>',
    lead: '做通一次后，步骤可以存成工作流。下次调用一次 workflow_run 就行。'
  },
  steps: [
    {
      n: '01',
      title: '先说一句，或者填参数',
      desc: '在 Claude Code、Kimi Code、Cursor 里说一句。Agent 通过本机 MCP 调工具。做通一次后可以存成工作流，下次填参数直接跑。',
      src: '/shots/tasks.png',
      alt: '在 BrowserPilot 里填写工作流参数'
    },
    {
      n: '02',
      title: 'Agent 在同一个窗口里操作',
      desc: '打开页面、找元素、等渲染、点击和填写。Agent 操作时盖遮罩，点「接管」就交还。',
      src: '/shots/agent-mask.png',
      alt: '页面上覆盖着「Agent 正在操作浏览器」遮罩与接管按钮'
    },
    {
      n: '03',
      title: '看结果，决定要不要存下来',
      desc: '每次运行留下成功或失败、停在哪一步、输出和文件。做通一次后写成工作流，下次调用一次 workflow_run 就跑完整张图。',
      src: '/shots/run-detail.png',
      alt: '运行记录页面，显示输出、条数与 CSV 路径'
    }
  ],
  capsSection: {
    eyebrow: '能力清单',
    title: '能做什么，<span>哪些还不支持</span>',
    lead: '每条都对应一个 MCP 工具或一个已实现的界面行为。已支持 = 当前版本可用；实验性 = 有实现但依赖外部条件；未支持 = 不承诺，建议交接给人。'
  },
  levels: { yes: '已支持', try: '实验性', no: '未支持' },
  caps: [
    {
      title: '导航与定位',
      lead: '点击前先找到元素。找不到就报错，不猜。',
      items: [
        { t: '打开、后退、前进、刷新', d: '地址规整；非 URL 文本走当前搜索引擎。', tool: 'page_navigate', level: 'yes' },
        { t: 'XPath 或 CSS 选择器', d: '点击、输入、选择必须恰好匹配一个；匹配多个直接失败，不取第一条。', tool: 'page_click', level: 'yes' },
        { t: '穿透 Shadow DOM 与 iframe', d: 'pierce 查同源 iframe；顶层找不到时自动查跨域 iframe（OOPIF）。', tool: 'page_query', level: 'yes' },
        { t: '画布与坐标点选', d: '没有稳定节点时用视口坐标或截图坐标；page_inspect 反查命中的元素。', tool: 'page_click / page_inspect', level: 'yes' }
      ]
    },
    {
      title: '表单与上传',
      lead: '输入、选择、上传，都按真实操作走。',
      items: [
        { t: '逐键输入与快捷键', d: '默认走 CDP 可信输入；非拉丁字符用 Input.insertText。', tool: 'page_type / page_key', level: 'yes' },
        { t: '选择、粘贴、上传文件', d: '上传直接交给文件控件，不弹系统选择框。', tool: 'page_select / page_upload', level: 'yes' },
        { t: '精确拖拽', d: '拖滑块或排序；轨迹带加减速、抖动与微过冲。', tool: 'page_drag', level: 'yes' }
      ]
    },
    {
      title: '多标签与环境',
      lead: '登录留在环境里，不留在对话里。',
      items: [
        { t: '一套环境一扇窗口', d: '一套环境里多个网站共享登录；不同环境互不可见。', tool: 'env_create / env_open', level: 'yes' },
        { t: '关窗不清登录', d: '登录态在 Electron 的 persist 分区；只有删环境才清 Cookie。', tool: 'env_delete', level: 'yes' },
        { t: '标签全局唯一', d: '开、关、切换、分组；Agent 用 tabId 指定，关掉的编号不复用。', tool: 'tab_* / group_*', level: 'yes' },
        { t: '无头只是窗口不显示', d: '仍是同一个 Chromium，不是另一套 headless 内核；默认最多 3 扇。', tool: 'env_open', level: 'yes' }
      ]
    },
    {
      title: '等待与重试',
      lead: '不写死 sleep。等元素出现再继续。',
      items: [
        { t: '等元素出现或消失', d: '默认 10 秒，最长 60 秒；穿透模式同样可用。', tool: 'page_wait', level: 'yes' },
        { t: '点到目标出现为止', d: '点击后等下一个目标，最多 3 次；滚动/滑动到目标最多 16/20 次。', tool: 'page_click', level: 'yes' },
        { t: '盯住变化', d: '元素文字或位置变了就返回前后快照，最长 120 秒。', tool: 'page_watch', level: 'yes' },
        { t: '失败留现场', d: '工具失败自动附一张截图；工作流失败记录节点、错误、截图，有抓包时附 HAR。', tool: 'errorShot / runs', level: 'yes' }
      ]
    },
    {
      title: '结果提取',
      lead: '页面上的文字和链接，可以直接读成数据。',
      items: [
        { t: '无障碍树与批量查询', d: '快照只对这一次有效；按同一定位取全部匹配与位置。', tool: 'page_snapshot / page_query', level: 'yes' },
        { t: '读 DOM 或原始响应', d: 'dom 是当前文档，response 是这次导航的 HTML。', tool: 'page_source', level: 'yes' },
        { t: '页面脚本与跨域 iframe', d: '返回 JSON；frame 填子框架 URL 的一段即可在跨域 iframe 里跑。', tool: 'page_script', level: 'yes' },
        { t: '工作流直接写 CSV', d: 'extract + export，带 BOM，Excel 打开不乱码。', tool: 'extract / export', level: 'yes' }
      ]
    },
    {
      title: '下载与媒体',
      lead: '网页触发的下载也进管理器。',
      items: [
        { t: '下载管理器', d: '进度、暂停/继续、重试、复制链接；所有网页下载进同一列表。', tool: 'will-download', level: 'yes' },
        { t: '图片、音频、视频', d: '直链直接下；B站/抖音/YouTube 抓 DASH 轨合并 mp4；m3u8 交 ffmpeg。', tool: 'page_save_media', level: 'yes' },
        { t: '实时录页面视频', d: 'captureStream + MediaRecorder，任何能播的站都能录；代价是要实时播完。', tool: 'page_record_video', level: 'try' },
        { t: '标签级抓包', d: 'HTTP 记录、按 URL 过滤、导出 HAR；请求头可能含 Cookie，只留本机。', tool: 'net_*', level: 'yes' }
      ]
    },
    {
      title: '截图与录屏',
      lead: 'Agent 能看到画面，也能把过程留下。',
      items: [
        { t: '网页截图直接回图', d: 'page_screenshot 把截图作为 MCP image 返回，同时给路径、像素宽高和字节数；超大图只给路径。', tool: 'page_screenshot', level: 'yes' },
        { t: '整窗合成预览', d: '主界面、网页、遮罩、交接提示和弹层合成一张图；只对有头窗口有效，不冒充系统级窗口截图。', tool: 'window_preview', level: 'yes' },
        { t: '窗口录屏与状态', d: '默认 300 秒自动停，最长 3600；screen 的 action=status 查已录秒数，action=stop 返回路径、时长和字节数。', tool: 'screen', level: 'yes' }
      ]
    },
    {
      title: '网络与调试',
      lead: '失败时留下现场，不用靠猜。',
      items: [
        { t: '抓包与 HAR', d: '每个标签单独记录；正文与 Cookie 不离开本机。', tool: 'net_start / net_export', level: 'yes' },
        { t: '请求拦截', d: '按 URL 包含规则返回假数据，做接口测试和故障注入。', tool: 'net_mock', level: 'yes' },
        { t: '单条或批量 CDP', d: '同一调试会话里按顺序发命令，可指定子框架会话。', tool: 'page_cdp_batch', level: 'yes' }
      ]
    },
    {
      title: '验证码',
      lead: '能稳定做的才标已支持。',
      items: [
        { t: '极验 v4 滑块', d: 'cv → ddddocr → onnx 三引擎降级；拟人拖拽，失败换图重试。', tool: 'captcha_solve', level: 'yes' },
        { t: '其它类型交给看图 Agent', d: '截图带回坐标映射，自己算点击位置；成功率取决于模型与题型。', tool: 'captcha_panel', level: 'try' },
        { t: '英数文字验证码', d: 'ddddocr，需要本机 Python 与 pip install ddddocr。', tool: 'captcha_read', level: 'try' },
        { t: '图标点选、五子棋、交换消除', d: '没有内置识别器，不承诺自动完成；建议 page_handoff 交给人。', tool: 'page_handoff', level: 'no' }
      ]
    }
  ],
  modesSection: {
    eyebrow: '三种用法',
    title: '什么时候<span>用哪种</span>',
    lead: 'Agent 直连适合一次性任务；保存工作流适合重复操作；人机协作适合登录、核验和需要人把关的步骤。'
  },
  modes: [
    {
      id: 'agent',
      name: 'Agent 直连',
      lead: '在 Claude Code、Kimi Code、Cursor 里说一句。Agent 通过 MCP 找元素、点击、等待、取结果。一次性任务、还没定型的流程，用这个更直接。',
      items: [
        { t: '99 个工具', d: '导航、点击、表单、截图、整窗预览、抓包、媒体、验证码都在同一套工具里' },
        { t: '失败留现场', d: '工具失败自动附 errorShot，Agent 下一轮能看着截图改定位' },
        { t: '不写死 sleep', d: 'page_wait 等元素出现或消失，1–60 秒' },
        { t: '随时接管', d: '页面遮罩上的「接管」一按，控制权回到人' }
      ],
      to: '/guide/quickstart.html',
      toText: '看快速上手'
    },
    {
      id: 'workflow',
      name: '保存工作流',
      lead: '做通一次后，把步骤存成节点图。下次调用 workflow_run，主进程一次跑完，不用再让模型重想每一步。',
      items: [
        { t: '22 种节点', d: '打开、点击、填写、判断、循环、提取、导出、CDP、验证码' },
        { t: '参数化', d: '开始节点声明变量，同一张图换输入就能跑不同账号或关键词' },
        { t: '批量', d: 'workflow_batch 多行输入，并发最多 3' },
        { t: '可导出', d: '整张图是 JSON，能导入导出，也能放进市场' }
      ],
      to: '/guide/concepts.html',
      toText: '看核心概念'
    },
    {
      id: 'loop',
      name: '人机协作',
      lead: '登录、短信、人工核验这些步骤不硬做。交接节点会去掉遮罩、留一句提示，等下一步目标出现再重新上锁。',
      items: [
        { t: '三种控制状态', d: 'agent / handoff / shared，页面表现各不相同' },
        { t: '交接最多 10 分钟', d: '下一个节点有定位时等待；没有定位会立即重新上锁' },
        { t: '接管不暂停', d: '人和 Agent 同时操作，工作流返回 takenOver: true' },
        { t: '凭据留在环境', d: '登录在 persist 分区，导出 Cookie 是明文，只在本机用' }
      ],
      to: '/guide/interface.html',
      toText: '看界面说明'
    }
  ],
  control: {
    eyebrow: '人在环上',
    title: '它会停下来，<span>你也能随时打断</span>',
    lead: '控制权是这类工具最容易被问的地方。下面按代码里的实际行为写。',
    tableHead: ['控制状态', '页面上的表现', '谁在操作'],
    rows: [
      { state: 'agent', show: '盖一层「Agent 正在操作浏览器」，中央是「接管」。', who: 'Agent；你点「接管」立刻交还。' },
      { state: 'handoff', show: '遮罩去掉，页面顶部留一句提示；下一步目标出现时重新上锁。', who: '人；工作流交接最多等 10 分钟（下一个节点有定位时）。' },
      { state: 'shared', show: '没有遮罩。', who: '人和 Agent 同时操作；任务不暂停。' }
    ],
    audit: '逐次工具调用不会写单独的审计日志。如果要把过程给别人看，用工作流的运行记录（成功/失败、节点、输出、文件、现场截图）和抓包 HAR；它们按运行记录，不按每次点击记录。',
    cards: [
      { h: '接管不暂停', p: '人点「接管」或 Agent 调 <code>page_unlock</code> 后，控制权变成 shared，任务继续。工作流返回 <code>takenOver: true</code>，Agent 应该重新读页面再决定下一步。' },
      { h: '需要人做一步时', p: '用 <code>page_handoff</code> 或工作流「交接」节点。窗口如果是无头的，会先显示出来；交接节点会等下一个目标出现，最长 10 分钟；下一个节点没有定位时会立即重新上锁。' },
      { h: '凭据留在本机', p: '登录态在 Electron 的 persist 分区；MCP 只监听 127.0.0.1，Bearer 令牌写在本机 <code>mcp.json</code>。应用不把 Cookie 发给云端。' },
      { h: '导出的 Cookie 是明文', p: '<code>env_export</code> 是给换机用的，文件里是完整 Cookie。只在本机传递，不要贴到对话、仓库或工单里；不用时删掉。' }
    ]
  },
  bounds: {
    eyebrow: '边界',
    title: '我们做什么，<span>不做什么</span>',
    lead: '下面这些不做。每条都能在代码或发布配置里找到依据。',
    doTitle: '做',
    do: [
      '<strong>本机桌面运行。</strong>一套环境一扇窗口，登录留在分区里，关窗不丢。',
      '<strong>同窗口人机协作。</strong>遮罩、接管、交接，三种控制状态。',
      '<strong>把步骤存成工作流。</strong>22 种节点，一次 <code>workflow_run</code> 跑完整图。',
      '<strong>极验 v4 滑块自动。</strong>cv / ddddocr / onnx 三引擎降级，失败换图重试。',
      '<strong>本机 MCP 与 CLI。</strong>MCP 是主入口；CLI 目前按 Windows 路径读端点。'
    ],
    dontTitle: '不做',
    dont: [
      '<strong>不做指纹引擎。</strong>只去掉自己会加的自动化标记，不承诺绕过站点风控。',
      '<strong>不做云端执行或账号托管。</strong>MCP 只听 127.0.0.1，任务数据不上传。',
      '<strong>不做通用验证码识别。</strong>图标点选、五子棋、交换消除没有内置识别器。',
      '<strong>不做内置定时器。</strong>要用定时，自己写系统计划任务调 CLI。',
      '<strong>不做网卡级抓包。</strong>只有标签级 HTTP 记录。',
      '<strong>不代管密码。</strong>登录由人在环境窗口里完成。',
      '<strong>安装包没有签名。</strong>SmartScreen 与 macOS 拦截按文档处理。'
    ]
  },
  integration: {
    eyebrow: '集成',
    title: 'Agent 走 MCP，<span>人走界面</span>',
    lead: 'MCP 是主入口，Agent 通过它调用 99 个工具。CLI 包着同一套工具，适合脚本和计划任务。应用本身没有定时器。',
    cliTitle: 'CLI',
    cliTag: 'Windows',
    cliNote: 'github.json 里写 <code>&#123;"话题":"browser-automation"&#125;</code>。CLI 目前只按 Windows 的 <code>%APPDATA%</code> 路径读 mcp.json；macOS / Linux 用 MCP。',
    sampleWorkflow: 'GitHub 话题速览',
    sampleKeyword: '话题',
    mcpTitle: 'MCP 客户端配置',
    mcpTag: 'streamable HTTP',
    mcpNote: '先打开 BrowserPilot → 设置 → 通用 → MCP。REPLACE_WITH_TOKEN 换成 <code>%APPDATA%\\BrowserPilot\\mcp.json</code> 里的 token；不要贴到对话或仓库。',
    batchTitle: '批量输入',
    batchTag: 'workflow_batch',
    batchNote: '并发上限 3。每行仍是一次完整的工作流运行，各自有运行记录；默认一行一行来。',
    taskTitle: '系统计划任务',
    taskTag: '不是内置功能',
    taskNote: '存成 <code>browserpilot-morning.bat</code>，再用 <code>schtasks /Create /SC DAILY /ST 09:00 /TN "BrowserPilot 早报" /TR "C:\\tasks\\browserpilot-morning.bat"</code>。CLI 会先等应用起来，最多 45 秒。'
  },
  compareSection: {
    eyebrow: '对照',
    title: '手写脚本、RPA、<span>BrowserPilot</span>',
    lead: '三种做法解决的问题不完全一样。下面写差异。',
    hint: '窄屏可以左右滑动，查看完整对照。',
    head: ['维度', '手写 Playwright / Puppeteer', '传统 RPA', 'BrowserPilot']
  },
  compare: [
    { scene: '起步', hand: '写代码、装浏览器、处理驱动与启动参数。', rpa: '装 RPA 软件，录制或拖流程；桌面版通常按席位收费。', bp: '装桌面应用，把本机 MCP 注册给 Agent；不需要写脚本也能先跑。' },
    { scene: '登录态', hand: '自己维护 storageState / Cookie，过期就重新登录。', rpa: '常依赖桌面会话或内置浏览器，账号切换靠配置。', bp: '登录留在环境的 persist 分区；一套环境多个网站，关窗不丢。' },
    { scene: '网站改版', hand: '选择器失效，改代码、跑测试、发版。', rpa: '元素路径失效，回编辑器改流程。', bp: '同样会失效；失败带匹配数、文字和现场截图，定位更快，但没有自动修复。' },
    { scene: '重复运行', hand: '脚本进 CI 或计划任务；需要自己写重试与报告。', rpa: '自带计划任务与日志，适合固定流程。', bp: 'workflow_run 一次跑完整图；workflow_batch 多行输入，最多 3 并发。' },
    { scene: '谁决定下一步', hand: '你写的代码。', rpa: '录好的流程。', bp: 'Agent 规划；做通后存成工作流回放。BrowserPilot 自身不带模型。' },
    { scene: '适合', hand: '工程团队、CI、需要版本化与代码评审的场景。', rpa: '固定的内部系统、财务/人事等表单流程。', bp: '本机、已登录、需要人随时接管的网页任务；不适合无桌面的服务器。' }
  ],
  specsSection: {
    eyebrow: '技术规格',
    title: '给要评估接入的人',
    lead: '版本、驱动、定位方式、并发、凭据和数据落盘位置。数字来自仓库和当前安装包。'
  },
  specs: [
    { k: '版本', v: '0.19.0' },
    { k: '运行时', v: 'Electron 45 · React 19 · TypeScript 5；Windows 安装包约 118 MiB，解压后约 320 MB' },
    { k: '驱动方式', v: 'Electron WebContentsView + Chrome DevTools Protocol（Input / DOM / Accessibility / Network）' },
    { k: '定位', v: 'XPath 或 CSS；必须恰好匹配一个；可穿透 Shadow DOM、同源 iframe，顶层找不到时查跨域 iframe' },
    { k: '运行模式', v: '有头优先；无头 = 窗口隐藏（同一 Chromium），默认上限 3 扇，可在设置里调' },
    { k: '并发', v: 'workflow_batch 最多 3 路（设置上限）；不同环境各自一扇窗口' },
    { k: '凭据', v: '登录态在 Electron 的 persist 分区；MCP 只监听 127.0.0.1，Bearer 令牌在本机 mcp.json' },
    { k: '平台', v: 'Windows x64 · macOS（Apple Silicon）· Linux x64；CI 三端构建' },
    { k: '网络', v: '应用无账号体系；市场目录从 GitHub 读取；媒体合并首次会从镜像下载 ffmpeg' },
    { k: '许可', v: '仓库暂未附 LICENSE 文件；源码公开可读，再分发前请先确认授权' },
    { k: '数据目录', v: 'Windows %APPDATA%\\BrowserPilot；macOS ~/Library/Application Support/BrowserPilot；Linux ~/.config/BrowserPilot' }
  ],
  shotsSection: {
    eyebrow: '界面',
    title: '五张界面截图',
    lead: '下面五张都是 0.13.13 在 Windows 上的窗口截图，尺寸 1440 × 900；0.14.0 之后只改了工具，界面没有变化。'
  },
  shots: [
    { src: '/shots/tasks.png', title: '任务与参数', desc: '保存好的工作流带参数；填完点执行，或交给 Agent 调 workflow_run。' },
    { src: '/shots/agent-mask.png', title: 'Agent 操作中', desc: '页面盖遮罩，中央是「接管」；人点一下就能拿回控制权。' },
    { src: '/shots/run-detail.png', title: '运行记录', desc: '成功/失败、停在哪一步、输出、文件；失败自动附现场截图。' },
    { src: '/shots/workflow.png', title: '工作流画布', desc: '22 种节点从左向右连；Agent 不点图，仍用 workflow_run 一次跑完。' },
    { src: '/shots/settings.png', title: '设置 · 通用', desc: 'MCP 只听 127.0.0.1，默认端口 39221；批量并发与无头窗口上限也在这里。' }
  ],
  build: {
    eyebrow: '源码与构建',
    title: '构建与许可证',
    lead: '主进程、界面、Go CLI 和工作流市场都在公开仓库里。本地开发环境用三条命令。',
    h: '三条命令',
    commands: '安装：<code>npm install</code>；构建：<code>npm run build</code>；类型检查：<code>npm run typecheck</code>；打包：<code>npm run dist:win</code>（或 dist:mac / dist:linux）。',
    licenseTitle: '许可证与边界',
    license: [
      '仓库：<a href="https://github.com/xy200303/browserpilot" target="_blank" rel="noreferrer">xy200303/browserpilot</a>',
      '工作流市场：<a href="https://github.com/xy200303/browserpilot-market" target="_blank" rel="noreferrer">xy200303/browserpilot-market</a>，应用只下载，不回传。',
      '主进程、React 界面、Go CLI 同仓；没有服务端。',
      'Windows 安装包未做代码签名。'
    ],
    note: '截至 v0.19.0，仓库没有 LICENSE 文件。源码公开可读，但在作者给出书面许可前，不要把它当作 MIT / Apache 等开源许可再分发。许可证以仓库实际文件为准。'
  },
  changelogSection: {
    eyebrow: '更新日志',
    title: '最近三个版本',
    lead: '只写仓库查得到的提交。版本号和日期以 Release tag 为准。',
    more: '完整历史见'
  },
  changelog: [
    {
      v: 'v0.19.0',
      when: '2026-11-09',
      items: [
        '10 标签内存约降 30%，标签超过 8 个或系统内存紧张时自动休眠后台页。',
        '用户目录清理后 501 MB → 254 MB；截图改为 120 张 / 80 MB / 14 天保留。',
        '截图与窗口预览去掉 base64 往返，截图耗时约降 25%；录屏和媒体下载改流式落盘。',
        '安装包 app.asar 从 14.2 MB 降到 4.5 MB。'
      ]
    },
    {
      v: 'v0.18.0',
      when: '2026-11-08',
      items: [
        '界面中英双语：跟随系统，也可在设置里固定中文或英文。',
        '99 个工具描述改为英文并精简；检索加同义词别名与部分命中兜底。',
        '修视图被休眠或回收后，打开书签、页面右键菜单、整窗预览的主进程崩溃。'
      ]
    },
    {
      v: 'v0.17.1',
      when: '2026-11-08',
      items: [
        '工具描述全部改为英文并精简，提示词占用大约减半。',
        '新增 workflow_record：把一串工具调用录成工作流图。',
        '落笔后读画布像素校验；被重绘覆盖或没画上会直接报错。'
      ]
    }
  ],
  faqSection: { eyebrow: '常见问题', title: '常见问题' },
  faqs: [
    { q: '会不会误点付款按钮？', a: '默认没有逐次点击确认。Agent 调 page_click 就会点。需要人把关的步骤，用 page_handoff 或工作流里的「交接」节点：遮罩去掉、页面留提示，人做完下一步才重新上锁。付款、删除、发布这类页面，最好放在交接之后，或者只让 Agent 读，不点。' },
    { q: '登录态怎么保持？换机器怎么办？', a: '一套环境就是一个 Electron persist 分区。登录一次，关掉窗口再打开还在；不同环境互不可见。删环境会清掉 Cookie。换机器用 env_export / env_import 导出导入 Cookie；导出文件是明文，只在本机用，不要发到对话或仓库里。' },
    { q: '网站改版了怎么办？', a: '选择器会失效，BrowserPilot 不会自动修复。失败时会带匹配个数、文字和现场截图；用 page_query 或 page_snapshot 重新找定位，再改工作流节点。运行记录里能看到停在哪一步。' },
    { q: '能不能跑在服务器上？', a: '不能。它是桌面应用，需要图形会话；所谓无头只是把窗口隐藏，仍是同一个 Chromium。MCP 只监听 127.0.0.1，不对外网开放。需要远程执行时，用远程桌面连到那台机器。' },
    { q: '数据和截图存在哪？', a: '都在本机用户数据目录：Windows 是 %APPDATA%\\BrowserPilot，macOS 是 ~/Library/Application Support/BrowserPilot，Linux 是 ~/.config/BrowserPilot。截图在 screenshots，运行记录在 runs.json，抓包 HAR 在 runs，导出 CSV 在 exports，下载在 downloads。应用没有账号与云端同步。' },
    { q: '支持哪些验证码？', a: '自动支持的是极验 v4 滑块：cv、ddddocr、onnx 三引擎降级，拟人拖拽并重试。其它类型用 captcha_panel 截图交给会看图的 Agent，成功率取决于题型和模型；英数文字可以用 ddddocr，需要本机 Python。图标点选、五子棋、交换消除没有内置识别器，建议交接给人。' },
    { q: '多个账号能同时跑吗？', a: '能。每个账号一套环境，各自一扇窗口、各自的登录。批量运行 workflow_batch 默认一行一行来，并发最多 3；同时开着的无头窗口默认也最多 3，可在设置里调。' },
    { q: '会被网站识别成机器人吗？', a: 'BrowserPilot 去掉了自己会加的自动化标记：不带 --enable-automation，UA 用同版本 Chrome 标识、不出现 Electron 或 HeadlessChrome，默认输入走 CDP 的 Input 域。它不是指纹浏览器，不做指纹伪装，也不承诺绕过站点风控；判定在网站一侧。' }
  ],
  final: {
    title: '下载，接上你的 Agent，<span>让它跑一遍</span>',
    sub: '安装后先打开一次应用，确认设置里的 MCP 开着；再按文档把本机端点注册给 Claude Code、Kimi Code、Cursor 或你自己的客户端。',
    download: '下载最新版',
    docs: '快速上手',
    footnote: '源码公开可读，仓库暂未附 LICENSE · 安装包未签名 · © 2026 BrowserPilot',
    footnote2: '页面里的运行录屏与截图来自真实窗口；界面语言可在设置里切换。'
  }
} as const
