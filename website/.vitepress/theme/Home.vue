<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { withBase } from 'vitepress'
import DotField from './components/DotField.vue'
import SignalStrip from './components/SignalStrip.vue'
import { setupLanding } from './motion/setupLanding'

const ICONS = {
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6 4.5v15l13-7.5Z"/></svg>'
}

const steps = [
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
]

const heroGroups = [
  { cls: 'desktop-line', text: '你已经登录的浏览器，', base: 0 },
  { cls: 'desktop-line', text: 'Agent 接着用。', base: 10 },
  { cls: 'mobile-line', text: '你已经登录，', base: 0 },
  { cls: 'mobile-line', text: 'Agent 接着点。', base: 5 }
]
const heroChars = heroGroups.map((line) => ({
  cls: line.cls,
  chars: [...line.text].map((ch, i) => ({ ch, i: line.base + i }))
}))

const stats = [
  { value: '69', label: 'MCP 工具', note: 'tool-catalog.ts 的实际工具数' },
  { value: '22', label: '工作流节点', note: '开始/结束/判断/循环都算在内' },
  { value: '200', label: '运行记录上限', note: '界面列表最多显示 50 条' },
  { value: '3', label: '并发与无头窗口', note: '默认各 3，设置里可调' }
]

const marquee = [
  '导航与定位', '表单与上传', '多标签与环境', '等待与重试', '结果提取',
  '下载与媒体', '标签级抓包', '极验滑块', '本机 MCP', '工作流回放'
]

const modes = [
  {
    id: 'agent',
    name: 'Agent 直连',
    lead: '在 Claude Code、Kimi Code、Cursor 里说一句。Agent 通过 MCP 找元素、点击、等待、取结果。一次性任务、还没定型的流程，用这个更直接。',
    items: [
      { t: '69 个工具', d: '导航、点击、表单、截图、整窗预览、抓包、媒体、验证码都在同一套工具里' },
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
]

const caps = [
  {
    title: '导航与定位',
    lead: '点击前先找到元素。找不到就报错，不猜。',
    items: [
      { t: '打开、后退、前进、刷新', d: '地址规整；非 URL 文本走当前搜索引擎。', tool: 'page_navigate', level: 'yes' },
      { t: 'XPath 或 CSS 选择器', d: '点击、输入、选择必须恰好匹配一个；匹配多个直接失败，不取第一条。', tool: 'page_click', level: 'yes' },
      { t: '穿透 Shadow DOM 与 iframe', d: 'pierce 查同源 iframe；顶层找不到时自动查跨域 iframe（OOPIF）。', tool: 'page_query', level: 'yes' },
      { t: '画布与坐标点选', d: '没有稳定节点时用视口坐标或截图坐标；page_hit 反查命中的元素。', tool: 'page_click / page_hit', level: 'yes' }
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
      { t: '窗口录屏与状态', d: '默认 300 秒自动停，最长 3600；screen_status 查已录秒数，screen_stop 返回路径、时长和字节数。', tool: 'screen_start / screen_status / screen_stop', level: 'yes' }
    ]
  },
  {
    title: '网络与调试',
    lead: '失败时留下现场，不用靠猜。',
    items: [
      { t: '抓包与 HAR', d: '每个标签单独记录；正文与 Cookie 不离开本机。', tool: 'net_start / net_export', level: 'yes' },
      { t: '请求拦截', d: '按 URL 包含规则返回假数据，做接口测试和故障注入。', tool: 'net_mock', level: 'yes' },
      { t: '单条或批量 CDP', d: '同一调试会话里按顺序发命令，可指定子框架会话。', tool: 'page_cdp / page_cdp_batch', level: 'yes' }
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
]

const levelText: Record<string, string> = { yes: '已支持', try: '实验性', no: '未支持' }

const compare = [
  {
    scene: '起步',
    hand: '写代码、装浏览器、处理驱动与启动参数。',
    rpa: '装 RPA 软件，录制或拖流程；桌面版通常按席位收费。',
    bp: '装桌面应用，把本机 MCP 注册给 Agent；不需要写脚本也能先跑。'
  },
  {
    scene: '登录态',
    hand: '自己维护 storageState / Cookie，过期就重新登录。',
    rpa: '常依赖桌面会话或内置浏览器，账号切换靠配置。',
    bp: '登录留在环境的 persist 分区；一套环境多个网站，关窗不丢。'
  },
  {
    scene: '网站改版',
    hand: '选择器失效，改代码、跑测试、发版。',
    rpa: '元素路径失效，回编辑器改流程。',
    bp: '同样会失效；失败带匹配数、文字和现场截图，定位更快，但没有自动修复。'
  },
  {
    scene: '重复运行',
    hand: '脚本进 CI 或计划任务；需要自己写重试与报告。',
    rpa: '自带计划任务与日志，适合固定流程。',
    bp: 'workflow_run 一次跑完整图；workflow_batch 多行输入，最多 3 并发。'
  },
  {
    scene: '谁决定下一步',
    hand: '你写的代码。',
    rpa: '录好的流程。',
    bp: 'Agent 规划；做通后存成工作流回放。BrowserPilot 自身不带模型。'
  },
  {
    scene: '适合',
    hand: '工程团队、CI、需要版本化与代码评审的场景。',
    rpa: '固定的内部系统、财务/人事等表单流程。',
    bp: '本机、已登录、需要人随时接管的网页任务；不适合无桌面的服务器。'
  }
]

const specs = [
  { k: '版本', v: '0.14.0（2026-10-19 tag）' },
  { k: '运行时', v: 'Electron 44 · React 19 · TypeScript 5；Windows 安装包 117.3 MiB，解压后约 460 MB' },
  { k: '驱动方式', v: 'Electron WebContentsView + Chrome DevTools Protocol（Input / DOM / Accessibility / Network）' },
  { k: '定位', v: 'XPath 或 CSS；必须恰好匹配一个；可穿透 Shadow DOM、同源 iframe，顶层找不到时查跨域 iframe' },
  { k: '运行模式', v: '有头优先；无头 = 窗口隐藏（同一 Chromium），默认上限 3 扇，可在设置里调' },
  { k: '并发', v: 'workflow_batch 最多 3 路（设置上限）；不同环境各自一扇窗口' },
  { k: '凭据', v: '登录态在 Electron 的 persist 分区；MCP 只监听 127.0.0.1，Bearer 令牌在本机 mcp.json' },
  { k: '平台', v: 'Windows x64 · macOS（Apple Silicon）· Linux x64；CI 三端构建，当前素材在 Windows 采集' },
  { k: '网络', v: '应用无账号体系；市场目录从 GitHub 读取；媒体合并首次会从镜像下载 ffmpeg' },
  { k: '许可', v: '仓库暂未附 LICENSE 文件；源码公开可读，再分发前请先确认授权' },
  { k: '数据目录', v: 'Windows %APPDATA%\BrowserPilot；macOS ~/Library/Application Support/BrowserPilot；Linux ~/.config/BrowserPilot' }
]

const shots = [
  { src: '/shots/tasks.png', title: '任务与参数', desc: '保存好的工作流带参数；填完点执行，或交给 Agent 调 workflow_run。' },
  { src: '/shots/agent-mask.png', title: 'Agent 操作中', desc: '页面盖遮罩，中央是「接管」；人点一下就能拿回控制权。' },
  { src: '/shots/run-detail.png', title: '运行记录', desc: '成功/失败、停在哪一步、输出、文件；失败自动附现场截图。' },
  { src: '/shots/workflow.png', title: '工作流画布', desc: '22 种节点从左向右连；Agent 不点图，仍用 workflow_run 一次跑完。' },
  { src: '/shots/settings.png', title: '设置 · 通用', desc: 'MCP 只听 127.0.0.1，默认端口 39221；批量并发与无头窗口上限也在这里。' }
]

const changelog = [
  {
    v: 'v0.14.0',
    when: '2026-10-19',
    items: [
      'page_screenshot 把截图作为 MCP image 返回；文本结果保留路径、像素宽高和字节数。',
      '新增 window_preview：主界面、网页、遮罩、交接提示和弹层合成一张整窗预览图。',
      'screen_start 支持 maxSeconds（默认 300，最长 3600）自动停；新增 screen_status；screen_stop 返回时长和字节数。'
    ]
  },
  {
    v: 'v0.13.13',
    when: '2026-10-09',
    items: ['标签栏统一显示分割线，最后一个标签不挂尾线。', '纯界面调整，工具与工作流行为不变。']
  },
  {
    v: 'v0.13.12',
    when: '2026-10-09',
    items: ['渲染进程崩溃后，检测 webContents.isDestroyed() 并自动重建视图，恢复页面。', '修复的是崩溃后后续操作全灭的问题；提交记录里 BOSS 循环投递实测 13/13 成功。']
  }
]

const faqs = [
  {
    q: '会不会误点付款按钮？',
    a: '默认没有逐次点击确认。Agent 调 page_click 就会点。需要人把关的步骤，用 page_handoff 或工作流里的「交接」节点：遮罩去掉、页面留提示，人做完下一步才重新上锁。付款、删除、发布这类页面，最好放在交接之后，或者只让 Agent 读，不点。'
  },
  {
    q: '登录态怎么保持？换机器怎么办？',
    a: '一套环境就是一个 Electron persist 分区。登录一次，关掉窗口再打开还在；不同环境互不可见。删环境会清掉 Cookie。换机器用 env_export / env_import 导出导入 Cookie；导出文件是明文，只在本机用，不要发到对话或仓库里。'
  },
  {
    q: '网站改版了怎么办？',
    a: '选择器会失效，BrowserPilot 不会自动修复。失败时会带匹配个数、文字和现场截图；用 page_query 或 page_snapshot 重新找定位，再改工作流节点。运行记录里能看到停在哪一步。'
  },
  {
    q: '能不能跑在服务器上？',
    a: '不能。它是桌面应用，需要图形会话；所谓无头只是把窗口隐藏，仍是同一个 Chromium。MCP 只监听 127.0.0.1，不对外网开放。需要远程执行时，用远程桌面连到那台机器。'
  },
  {
    q: '数据和截图存在哪？',
    a: '都在本机用户数据目录：Windows 是 %APPDATA%\BrowserPilot，macOS 是 ~/Library/Application Support/BrowserPilot，Linux 是 ~/.config/BrowserPilot。截图在 screenshots，运行记录在 runs.json，抓包 HAR 在 runs，导出 CSV 在 exports，下载在 downloads。应用没有账号与云端同步。'
  },
  {
    q: '支持哪些验证码？',
    a: '自动支持的是极验 v4 滑块：cv、ddddocr、onnx 三引擎降级，拟人拖拽并重试。其它类型用 captcha_panel 截图交给会看图的 Agent，成功率取决于题型和模型；英数文字可以用 ddddocr，需要本机 Python。图标点选、五子棋、交换消除没有内置识别器，建议交接给人。'
  },
  {
    q: '多个账号能同时跑吗？',
    a: '能。每个账号一套环境，各自一扇窗口、各自的登录。批量运行 workflow_batch 默认一行一行来，并发最多 3；同时开着的无头窗口默认也最多 3，可在设置里调。'
  },
  {
    q: '会被网站识别成机器人吗？',
    a: 'BrowserPilot 去掉了自己会加的自动化标记：不带 --enable-automation，UA 用同版本 Chrome 标识、不出现 Electron 或 HeadlessChrome，默认输入走 CDP 的 Input 域。它不是指纹浏览器，不做指纹伪装，也不承诺绕过站点风控；判定在网站一侧。'
  }
]

const heroEl = ref<HTMLElement | null>(null)
const demoFrame = ref<HTMLElement | null>(null)
const progressEl = ref<HTMLElement | null>(null)
const railEl = ref<HTMLElement | null>(null)
const tabsEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const finalEl = ref<HTMLElement | null>(null)
const spotEl = ref<HTMLElement | null>(null)
const mode = ref('agent')
let stopLanding: (() => void) | null = null

onMounted(async () => {
  try {
    stopLanding = await setupLanding({
      heroEl,
      demoFrame,
      progressEl,
      railEl,
      tabsEl,
      panelEl,
      finalEl,
      spotEl,
      mode,
      faqs
    })
  } catch {
    stopLanding = null
  }
})

onUnmounted(() => {
  stopLanding?.()
})

</script>

<template>
  <div class="landing">
    <div ref="progressEl" class="progress" aria-hidden="true" />
    <section ref="heroEl" class="hero">
      <DotField class="hero-field" :gap="22" :radius="140" :push="34" />
      <div class="inner">
        <a class="notice" href="#changelog">
          <span class="notice-tag">v0.14.0</span>
          <span class="notice-text">截图直接回给 Agent；新增整窗合成预览与录屏状态</span>
          <span class="notice-arrow" v-html="ICONS.arrow" />
        </a>
        <div class="hero-inner">
          <span class="hero-kicker">MCP · 69 TOOLS · 0.14.0</span>
          <h1 class="hero-title">
            <span v-for="(line, li) in heroChars" :key="li" :class="['line', line.cls]">
              <span v-for="c in line.chars" :key="c.i" class="ch" :style="{ '--ci': c.i }">{{ c.ch }}</span>
            </span>
          </h1>
          <p class="hero-sub">
            一套环境一套登录。Agent 在同一扇窗口里点击、填表、等待、提取结果；你随时能接管。
            Windows / macOS / Linux，都在本机。
          </p>
          <div class="hero-cta">
            <a v-press class="btn primary big" :href="withBase('/download.html')">
              下载 v0.14.0
              <span class="arw" v-html="ICONS.arrow" />
            </a>
            <a v-press class="btn ghost" href="#demo">
              <span v-html="ICONS.play" style="display:inline-flex;width:14px;height:14px" />
              看它跑一遍
            </a>
            <a
              v-press
              class="btn quiet"
              href="https://github.com/xy200303/browserpilot"
              target="_blank"
              rel="noreferrer"
            >GitHub</a>
          </div>
          <div class="hero-meta">
            <span>本机 MCP · 127.0.0.1</span>
            <span>22 种工作流节点</span>
            <span>极验 v4 滑块</span>
            <span>安装包未签名</span>
          </div>
        </div>
      </div>
      <SignalStrip class="hero-signal" :height="64" :lines="3" />
    </section>

    <section id="demo" class="demo">
      <div class="inner">
        <div class="demo-frame-wrap">
          <div ref="demoFrame" class="demo-frame">
          <div class="window">
            <div class="window-bar">
              <i /><i /><i />
              <span>BrowserPilot · 真实运行 · 窗口 1440 × 900</span>
            </div>
            <video
              :src="withBase('/demos/run.mp4')"
              :poster="withBase('/demos/run-poster.jpg')"
              autoplay
              muted
              loop
              playsinline
              preload="none"
              aria-label="BrowserPilot 真实运行录屏：在 GitHub 话题页取前 5 个仓库并导出 CSV"
            />
          </div>
          </div>
        </div>
        <div class="demo-caption">
          <p>
            <strong>一个真实任务：</strong>在 GitHub 的 browser-automation 话题页取前 5 个仓库，导出 CSV。
            录屏从工作流画布开始，中间是填写参数、遮罩、页面加载，最后停在运行记录。
          </p>
          <span class="demo-time">35 秒 · 无声循环 · 实录</span>
        </div>
        <div class="demo-notes">
          <div><b>01 输入</b>在「GitHub 话题速览」里填 browser-automation，点执行。</div>
          <div><b>02 窗口里的动作</b>工作流在窗口里打开话题页、等仓库卡片出现、取前 5 条；遮罩上可随时接管。</div>
          <div><b>03 结果</b>运行记录写明 5 条与 CSV 路径，文件写到 exports 目录。</div>
        </div>
      </div>
    </section>

    <section class="statband">
      <div class="inner">
        <ul class="stats">
          <li v-for="(s, i) in stats" :key="s.label" class="stat reveal" :style="{ transitionDelay: i * 70 + 'ms' }">
            <strong>{{ s.value }}</strong>
            <span class="stat-label">{{ s.label }}</span>
            <span class="stat-note">{{ s.note }}</span>
          </li>
        </ul>
      </div>
    </section>

    <div class="marquee" aria-hidden="true">
      <div class="marquee-track">
        <span v-for="(w, i) in [...marquee, ...marquee]" :key="i" class="marquee-word">
          {{ w }}<i>·</i>
        </span>
      </div>
    </div>

    <section class="section">
      <div class="inner">
        <span class="eyebrow reveal"><i>01</i>怎么工作</span>
        <h2 class="display reveal">先给任务，<span>再看结果</span></h2>
        <p class="lead reveal">
          做通一次后，步骤可以存成工作流。下次调用一次 workflow_run 就行。
        </p>
        <div ref="railEl" class="pipe-rail" aria-hidden="true">
          <span class="rail-line" />
          <span v-for="n in 3" :key="n" class="rail-dot" />
        </div>
        <div class="steps">
          <figure v-for="s in steps" :key="s.n" class="step reveal" v-lift="2" v-spot>
            <div class="window sm">
              <div class="window-bar"><i /><i /><i /><span>BrowserPilot</span></div>
              <img :src="withBase(s.src)" :alt="s.alt" loading="lazy" />
            </div>
            <figcaption>
              <h3><span class="num">{{ s.n }}</span>{{ s.title }}</h3>
              <p>{{ s.desc }}</p>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>

    <section class="section alt">
      <div class="inner">
        <span class="eyebrow reveal"><i>02</i>能力清单</span>
        <h2 class="display reveal">能做什么，<span>哪些还不支持</span></h2>
        <p class="lead reveal">
          每条都对应一个 MCP 工具或一个已实现的界面行为。已支持 = 当前版本可用；实验性 = 有实现但依赖外部条件；
          未支持 = 不承诺，建议交接给人。
        </p>
        <div class="caps">
          <article v-for="c in caps" :key="c.title" class="cap reveal" v-lift="2" v-spot>
            <h3>{{ c.title }}</h3>
            <p class="cap-lead">{{ c.lead }}</p>
            <ul>
              <li v-for="it in c.items" :key="it.t">
                <strong>{{ it.t }}</strong>。{{ it.d }}
                <span class="cap-meta">
                  <code>{{ it.tool }}</code>
                  <span :class="['badge', it.level]">{{ levelText[it.level] }}</span>
                </span>
              </li>
            </ul>
          </article>
        </div>
      </div>
    </section>

    <section class="section tabs-section">
      <div class="inner">
        <span class="eyebrow reveal"><i>·</i>三种用法</span>
        <h2 class="display reveal">什么时候<span>用哪种</span></h2>
        <p class="lead reveal">
          Agent 直连适合一次性任务；保存工作流适合重复操作；人机协作适合登录、核验和需要人把关的步骤。
        </p>
        <div ref="tabsEl" class="tabs reveal" role="tablist">
          <button
            v-for="m in modes"
            :key="m.id"
            v-press
            type="button"
            role="tab"
            :aria-selected="mode === m.id"
            :class="['tab', mode === m.id && 'on']"
            @click="mode = m.id"
          >
            {{ m.name }}
          </button>
          <span class="tab-bar" aria-hidden="true" />
        </div>
        <div ref="panelEl" class="track-panel reveal" v-spot>
          <template v-for="m in modes" :key="m.id">
            <div v-if="mode === m.id" class="track-body">
              <p class="track-lead">{{ m.lead }}</p>
              <ul class="track-items">
                <li v-for="it in m.items" :key="it.t">
                  <strong>{{ it.t }}</strong>
                  <span>{{ it.d }}</span>
                </li>
              </ul>
              <a class="track-link" :href="withBase(m.to)">
                {{ m.toText }} <span v-html="ICONS.arrow" />
              </a>
            </div>
          </template>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="inner">
        <span class="eyebrow reveal"><i>03</i>人在环上</span>
        <h2 class="display reveal">它会停下来，<span>你也能随时打断</span></h2>
        <p class="lead reveal">
          控制权是这类工具最容易被问的地方。下面按代码里的实际行为写。
        </p>
        <div class="loop">
          <div class="reveal">
            <table class="loop-table">
              <thead>
                <tr><th>控制状态</th><th>页面上的表现</th><th>谁在操作</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>agent</td>
                  <td>盖一层「Agent 正在操作浏览器」，中央是「接管」。</td>
                  <td>Agent；你点「接管」立刻交还。</td>
                </tr>
                <tr>
                  <td>handoff</td>
                  <td>遮罩去掉，页面顶部留一句提示；下一步目标出现时重新上锁。</td>
                  <td>人；工作流交接最多等 10 分钟（下一个节点有定位时）。</td>
                </tr>
                <tr>
                  <td>shared</td>
                  <td>没有遮罩。</td>
                  <td>人和 Agent 同时操作；任务不暂停。</td>
                </tr>
              </tbody>
            </table>
            <div class="loop-warning">
              逐次工具调用不会写单独的审计日志。如果要把过程给别人看，用工作流的运行记录（成功/失败、节点、输出、文件、现场截图）
              和抓包 HAR；它们按运行记录，不按每次点击记录。
            </div>
          </div>
          <div class="loop-points">
            <div class="loop-point reveal" v-spot>
              <h4>接管不暂停</h4>
              <p>
                人点「接管」或 Agent 调 <code>page_unlock</code> 后，控制权变成 shared，任务继续。
                工作流返回 <code>takenOver: true</code>，Agent 应该重新读页面再决定下一步。
              </p>
            </div>
            <div class="loop-point reveal" v-spot>
              <h4>需要人做一步时</h4>
              <p>
                用 <code>page_handoff</code> 或工作流「交接」节点。窗口如果是无头的，会先显示出来；
                交接节点会等下一个目标出现，最长 10 分钟；下一个节点没有定位时会立即重新上锁。
              </p>
            </div>
            <div class="loop-point reveal" v-spot>
              <h4>凭据留在本机</h4>
              <p>
                登录态在 Electron 的 persist 分区；MCP 只监听 127.0.0.1，Bearer 令牌写在本机
                <code>mcp.json</code>。应用不把 Cookie 发给云端。
              </p>
            </div>
            <div class="loop-point reveal" v-spot>
              <h4>导出的 Cookie 是明文</h4>
              <p>
                <code>env_export</code> 是给换机用的，文件里是完整 Cookie。只在本机传递，不要贴到对话、
                仓库或工单里；不用时删掉。
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section alt">
      <div class="inner">
        <span class="eyebrow reveal"><i>04</i>边界</span>
        <h2 class="display reveal">我们做什么，<span>不做什么</span></h2>
        <p class="lead reveal">
          下面这些不做。每条都能在代码或发布配置里找到依据。
        </p>
        <div class="bounds">
          <div class="bound reveal" v-lift="2" v-spot>
            <h3>做</h3>
            <ul>
              <li><strong>本机桌面运行。</strong>一套环境一扇窗口，登录留在分区里，关窗不丢。</li>
              <li><strong>同窗口人机协作。</strong>遮罩、接管、交接，三种控制状态。</li>
              <li><strong>把步骤存成工作流。</strong>22 种节点，一次 <code>workflow_run</code> 跑完整图。</li>
              <li><strong>极验 v4 滑块自动。</strong>cv / ddddocr / onnx 三引擎降级，失败换图重试。</li>
              <li><strong>本机 MCP 与 CLI。</strong>MCP 是主入口；CLI 目前按 Windows 路径读端点。</li>
            </ul>
          </div>
          <div class="bound no reveal" v-lift="2">
            <h3>不做</h3>
            <ul>
              <li><strong>不做指纹引擎。</strong>只去掉自己会加的自动化标记，不承诺绕过站点风控。</li>
              <li><strong>不做云端执行或账号托管。</strong>MCP 只听 127.0.0.1，任务数据不上传。</li>
              <li><strong>不做通用验证码识别。</strong>图标点选、五子棋、交换消除没有内置识别器。</li>
              <li><strong>不做内置定时器。</strong>要用定时，自己写系统计划任务调 CLI。</li>
              <li><strong>不做网卡级抓包。</strong>只有标签级 HTTP 记录。</li>
              <li><strong>不代管密码。</strong>登录由人在环境窗口里完成。</li>
              <li><strong>安装包没有签名。</strong>SmartScreen 与 macOS 拦截按文档处理。</li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="inner">
        <span class="eyebrow reveal"><i>05</i>集成</span>
        <h2 class="display reveal">Agent 走 MCP，<span>人走界面</span></h2>
        <p class="lead reveal">
          MCP 是主入口，Agent 通过它调用 69 个工具。CLI 包着同一套工具，适合脚本和计划任务。
          应用本身没有定时器。
        </p>
        <div class="integration-grid">
          <article class="codecard reveal" v-spot>
            <header><h3>MCP 客户端配置</h3><span>streamable HTTP</span></header>
            <pre><code>{
  "mcpServers": {
    "browserpilot": {
      "type": "http",
      "url": "http://127.0.0.1:39221/mcp",
      "headers": { "Authorization": "Bearer REPLACE_WITH_TOKEN" }
    }
  }
}</code></pre>
            <p class="note">
              先打开 BrowserPilot → 设置 → 通用 → MCP。REPLACE_WITH_TOKEN 换成
              <code>%APPDATA%\BrowserPilot\mcp.json</code> 里的 token；不要贴到对话或仓库。
            </p>
          </article>
          <article class="codecard reveal" v-spot>
            <header><h3>CLI</h3><span>Windows</span></header>
            <pre><code>"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" tools
"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" schema page_click
"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" call workflow_run --name "GitHub 话题速览" --json-file C:\tasks\github.json</code></pre>
            <p class="note">
              github.json 里写 <code>{"话题":"browser-automation"}</code>。CLI 目前只按 Windows 的
              <code>%APPDATA%</code> 路径读 mcp.json；macOS / Linux 用 MCP。
            </p>
          </article>
          <article class="codecard reveal" v-spot>
            <header><h3>批量输入</h3><span>workflow_batch</span></header>
            <pre><code>{
  "workflow": "GitHub 话题速览",
  "rows": [
    { "话题": "browser-automation" },
    { "话题": "headless-browser" }
  ],
  "concurrency": 2
}</code></pre>
            <p class="note">
              并发上限 3。每行仍是一次完整的工作流运行，各自有运行记录；默认一行一行来。
            </p>
          </article>
          <article class="codecard reveal" v-spot>
            <header><h3>系统计划任务</h3><span>不是内置功能</span></header>
            <pre><code>set BROWSERPILOT_EXE=%LOCALAPPDATA%\Programs\BrowserPilot\BrowserPilot.exe
"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" ^
  call workflow_run --name "GitHub 话题速览" --json-file C:\tasks\github.json</code></pre>
            <p class="note">
              存成 <code>browserpilot-morning.bat</code>，再用
              <code>schtasks /Create /SC DAILY /ST 09:00 /TN "BrowserPilot 早报" /TR "C:\tasks\browserpilot-morning.bat"</code>。
              CLI 会先等应用起来，最多 45 秒。
            </p>
          </article>
        </div>
      </div>
    </section>

    <section class="section alt">
      <div class="inner">
        <span class="eyebrow reveal"><i>06</i>对照</span>
        <h2 class="display reveal">手写脚本、RPA、<span>BrowserPilot</span></h2>
        <p class="lead reveal">
          三种做法解决的问题不完全一样。下面写差异。
        </p>
        <p class="table-hint">窄屏可以左右滑动，查看完整对照。</p>
        <div class="table-wrap reveal">
          <table class="compare">
            <thead>
              <tr><th>维度</th><th>手写 Playwright / Puppeteer</th><th>传统 RPA</th><th>BrowserPilot</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in compare" :key="row.scene">
                <td class="scene">{{ row.scene }}</td>
                <td>{{ row.hand }}</td>
                <td>{{ row.rpa }}</td>
                <td class="app">{{ row.bp }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="inner">
        <span class="eyebrow reveal"><i>07</i>技术规格</span>
        <h2 class="display reveal">给要评估接入的人</h2>
        <p class="lead reveal">
          版本、驱动、定位方式、并发、凭据和数据落盘位置。数字来自仓库和当前安装包。
        </p>
        <div class="table-wrap reveal">
          <table class="specs">
            <tbody>
              <tr v-for="s in specs" :key="s.k">
                <th>{{ s.k }}</th>
                <td>{{ s.v }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="section alt">
      <div class="inner">
        <span class="eyebrow reveal"><i>08</i>界面</span>
        <h2 class="display reveal">五张界面截图</h2>
        <p class="lead reveal">
          下面五张都是 0.13.13 在 Windows 上的窗口截图，尺寸 1440 × 900；0.14.0 只改了工具，界面没有变化。
        </p>
        <div class="shots">
          <figure v-for="(s, i) in shots" :key="s.title" class="shot reveal" v-spot :style="{ transitionDelay: (i % 3) * 60 + 'ms' }">
            <div class="window sm">
              <div class="window-bar"><i /><i /><i /><span>BrowserPilot</span></div>
              <img :src="withBase(s.src)" :alt="s.title" loading="lazy" />
            </div>
            <figcaption>
              <h3>{{ s.title }}</h3>
              <p>{{ s.desc }}</p>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="inner">
        <span class="eyebrow reveal"><i>09</i>源码与构建</span>
        <h2 class="display reveal">构建与许可证</h2>
        <p class="lead reveal">
          主进程、界面、Go CLI 和工作流市场都在公开仓库里。本地开发环境用三条命令。
        </p>
        <div class="dev-grid">
          <div class="dev-card reveal" v-spot>
            <h3>三条命令</h3>
            <pre><code>$ git clone https://github.com/xy200303/browserpilot
$ npm install
$ npm run dev</code></pre>
            <p class="muted">
              构建：<code>npm run build</code>；类型检查：<code>npm run typecheck</code>；
              打包：<code>npm run dist:win</code>（或 dist:mac / dist:linux）。
            </p>
          </div>
          <div class="dev-card reveal d1">
            <h3>许可证与边界</h3>
            <ul class="dev-list">
              <li>仓库：<a href="https://github.com/xy200303/browserpilot" target="_blank" rel="noreferrer">xy200303/browserpilot</a></li>
              <li>工作流市场：<a href="https://github.com/xy200303/browserpilot-market" target="_blank" rel="noreferrer">xy200303/browserpilot-market</a>，应用只下载，不回传。</li>
              <li>主进程、React 界面、Go CLI 同仓；没有服务端。</li>
              <li>Windows 安装包未做代码签名。</li>
            </ul>
            <div class="license-note">
              截至 v0.14.0，仓库没有 LICENSE 文件。源码公开可读，但在作者给出书面许可前，
              不要把它当作 MIT / Apache 等开源许可再分发。许可证以仓库实际文件为准。
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="changelog" class="section alt">
      <div class="inner">
        <span class="eyebrow reveal"><i>10</i>更新日志</span>
        <h2 class="display reveal">最近三个版本</h2>
        <p class="lead reveal">
          只写仓库查得到的提交。版本号和日期以 Release tag 为准。
        </p>
        <div class="releases">
          <article v-for="r in changelog" :key="r.v" class="rel reveal" v-lift="2" v-spot>
            <div class="rel-head">
              <span class="rel-v">{{ r.v }}</span>
              <span class="rel-when">{{ r.when }}</span>
            </div>
            <ul>
              <li v-for="item in r.items" :key="item">{{ item }}</li>
            </ul>
          </article>
        </div>
        <p class="more reveal">
          完整历史见
          <a href="https://github.com/xy200303/browserpilot/releases" target="_blank" rel="noreferrer">GitHub Releases</a>。
        </p>
      </div>
    </section>

    <section class="section">
      <div class="inner narrow">
        <span class="eyebrow reveal"><i>11</i>常见问题</span>
        <h2 class="display reveal">常见问题</h2>
        <div class="faq-list">
          <details
            v-for="(f, i) in faqs"
            :key="f.q"
            class="faq-item reveal"
            :open="i === 0"
          >
            <summary>{{ f.q }}</summary>
            <p>{{ f.a }}</p>
          </details>
        </div>
      </div>
    </section>

    <section ref="finalEl" class="final">
      <div ref="spotEl" class="spot" aria-hidden="true" />
      <div class="final-inner reveal">
        <h2 class="display">下载，接上你的 Agent，<span>让它跑一遍</span></h2>
        <p class="final-sub">
          安装后先打开一次应用，确认设置里的 MCP 开着；再按文档把本机端点注册给 Claude Code、Kimi Code、Cursor 或你自己的客户端。
        </p>
        <div class="hero-cta">
          <a v-press class="btn primary big" href="https://github.com/xy200303/browserpilot/releases/latest" target="_blank" rel="noreferrer">
            下载最新版
            <span class="arw" v-html="ICONS.arrow" />
          </a>
          <a v-press class="btn ghost" :href="withBase('/guide/quickstart.html')">快速上手</a>
          <a v-press class="btn ghost" href="https://github.com/xy200303/browserpilot" target="_blank" rel="noreferrer">GitHub</a>
        </div>
        <p class="footnote">
          源码公开可读，仓库暂未附 LICENSE · 安装包未签名 · © 2026 BrowserPilot<br />
          页面里的运行录屏与截图来自 v0.13.13 的真实窗口，窗口 1440 × 900；0.14.0 界面未变。
        </p>
      </div>
    </section>
  </div>
</template>
