<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { withBase } from 'vitepress'
import DotField from './components/DotField.vue'
import DemoPlayer from './components/DemoPlayer.vue'
import SignalStrip from './components/SignalStrip.vue'
import { setupLanding } from './motion/setupLanding'

const ICONS = {
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6 4.5v15l13-7.5Z"/></svg>'
}

const steps = [
  {
    n: '01',
    title: 'Describe the task, or fill in parameters',
    desc: 'Say it in Claude Code, Kimi Code or Cursor. The agent calls tools over local MCP. Once a run works, save it as a workflow and replay it with new parameters.',
    src: '/shots/tasks.png',
    alt: 'Filling in workflow parameters inside BrowserPilot'
  },
  {
    n: '02',
    title: 'The agent works in the same window',
    desc: 'Open the page, find elements, wait for rendering, click and type. An overlay marks that the agent is driving; press Take over to take it back.',
    src: '/shots/agent-mask.png',
    alt: 'An overlay saying the agent is operating the browser, with a take-over button'
  },
  {
    n: '03',
    title: 'See the result, decide whether to keep it',
    desc: 'Every run records success or failure, the step it stopped at, outputs and files. Turn a working run into a workflow and one workflow_run replays the whole graph.',
    src: '/shots/run-detail.png',
    alt: 'Run detail page showing outputs, row counts and a CSV path'
  }
]

const heroGroups = [
  { cls: 'desktop-line', text: 'The browser you are already', base: 0 },
  { cls: 'desktop-line', text: 'signed in to. Your agent drives.', base: 10 },
  { cls: 'mobile-line', text: 'Already signed in,', base: 0 },
  { cls: 'mobile-line', text: 'agent keeps clicking.', base: 5 }
]
const heroChars = heroGroups.map((line) => ({
  cls: line.cls,
  chars: [...line.text].map((ch, i) => ({ ch, i: line.base + i }))
}))

const stats = [
  { value: '69', label: 'MCP tools', note: 'actual count in tool-catalog.ts' },
  { value: '22', label: 'workflow nodes', note: 'start, end, branch and loop included' },
  { value: '200', label: 'runs kept', note: 'the UI lists the latest 50' },
  { value: '3', label: 'concurrency and headless', note: 'default 3 each, adjustable in settings' }
]

const marquee = [
  'navigation', 'forms and uploads', 'tabs and environments', 'waits and retries', 'extraction',
  'downloads and media', 'per-tab capture', 'Geetest sliders', 'local MCP', 'workflow replay'
]

const modes = [
  {
    id: 'agent',
    name: 'Agent direct',
    lead: 'Say it in Claude Code, Kimi Code or Cursor. The agent finds elements, clicks, waits and reads results over MCP. Best for one-off tasks and flows that are not settled yet.',
    items: [
      { t: '69 tools', d: 'navigation, clicking, forms, screenshots, window preview, capture, media, captchas in one catalog' },
      { t: 'Failures keep evidence', d: 'a failed tool returns an errorShot, so the next turn can look at the screenshot and fix the locator' },
      { t: 'No fixed sleeps', d: 'page_wait waits for an element to appear or disappear, 1 to 60 seconds' },
      { t: 'Take over anytime', d: 'press Take over on the overlay and control returns to the human' }
    ],
    to: '/en/guide/quickstart.html',
    toText: 'Read the quickstart'
  },
  {
    id: 'workflow',
    name: 'Saved workflow',
    lead: 'Once a run works, store the steps as a node graph. Next time workflow_run executes the whole graph in the main process, without asking a model to re-plan each step.',
    items: [
      { t: '22 node types', d: 'open, click, fill, branch, loop, extract, export, CDP, captcha' },
      { t: 'Parameterised', d: 'the start node declares variables, so one graph runs different accounts or keywords' },
      { t: 'Batch', d: 'workflow_batch takes many input rows, up to 3 concurrent' },
      { t: 'Portable', d: 'the graph is JSON: import, export and publish to the market' }
    ],
    to: '/en/guide/concepts.html',
    toText: 'Read the concepts'
  },
  {
    id: 'loop',
    name: 'Human in the loop',
    lead: 'Logins, SMS codes and manual checks are not forced. A handoff node removes the overlay, leaves a message, and locks again when the next target appears.',
    items: [
      { t: 'Three control states', d: 'agent, handoff and shared behave differently on the page' },
      { t: 'Handoff waits up to 10 minutes', d: 'when the next node has a locator; without one it locks immediately' },
      { t: 'Taking over does not pause', d: 'human and agent can act together; the run returns takenOver: true' },
      { t: 'Credentials stay in the environment', d: 'logins live in the persist partition; exported cookies are plain text, keep them local' }
    ],
    to: '/en/guide/quickstart.html',
    toText: 'See how it works'
  }
]

const caps = [
  {
    title: 'Navigation and locating',
    lead: 'Find the element before clicking. If it cannot be found, fail instead of guessing.',
    items: [
      { t: 'Open, back, forward, reload', d: 'addresses are normalised; plain text uses the current search engine.', tool: 'page_navigate', level: 'yes' },
      { t: 'XPath or CSS selectors', d: 'click, type and select must match exactly one element; several matches fail instead of picking the first.', tool: 'page_click', level: 'yes' },
      { t: 'Piercing shadow DOM and iframes', d: 'pierce searches same-origin iframes and falls back to cross-origin ones (OOPIF).', tool: 'page_query', level: 'yes' },
      { t: 'Canvas and coordinate clicks', d: 'when there is no stable node, click by viewport or screenshot coordinates; page_inspect reports what is under a point.', tool: 'page_click / page_inspect', level: 'yes' }
    ]
  },
  {
    title: 'Forms and uploads',
    lead: 'Typing, selecting and uploading all go through real input.',
    items: [
      { t: 'Typing and shortcuts', d: 'trusted CDP input by default; non-Latin text uses Input.insertText.', tool: 'page_type / page_key', level: 'yes' },
      { t: 'Select, paste, upload files', d: 'uploads go straight to the file input, without the system picker.', tool: 'page_select / page_upload', level: 'yes' },
      { t: 'Precise drags', d: 'sliders and sorting; the track has acceleration, jitter and slight overshoot.', tool: 'page_drag', level: 'yes' }
    ]
  },
  {
    title: 'Tabs and environments',
    lead: 'Logins stay in the environment, not in the conversation.',
    items: [
      { t: 'One window per environment', d: 'several sites share one login inside an environment; environments never see each other.', tool: 'env_create / env_open', level: 'yes' },
      { t: 'Closing keeps logins', d: 'state lives in the Electron persist partition; only deleting the environment clears cookies.', tool: 'env_delete', level: 'yes' },
      { t: 'Globally unique tab ids', d: 'open, close, activate, group; agents address tabs by id and closed ids are not reused.', tool: 'tab_* / group_*', level: 'yes' },
      { t: 'Headless only hides the window', d: 'same Chromium, not a second headless engine; 3 windows by default.', tool: 'env_open', level: 'yes' }
    ]
  },
  {
    title: 'Waiting and retries',
    lead: 'No fixed sleeps. Wait for the element, then continue.',
    items: [
      { t: 'Wait for appear or disappear', d: '10 seconds by default, 60 max; piercing works too.', tool: 'page_wait', level: 'yes' },
      { t: 'Retry until the target shows', d: 'clicks retry up to 3 times; scrolling and swiping up to 16 and 20.', tool: 'page_click', level: 'yes' },
      { t: 'Watch for change', d: 'when text or position changes, return before and after, up to 120 seconds.', tool: 'page_watch', level: 'yes' },
      { t: 'Failures keep evidence', d: 'a failed tool attaches a screenshot; a failed run records the node, error and screenshot.', tool: 'errorShot / runs', level: 'yes' }
    ]
  },
  {
    title: 'Extraction',
    lead: 'Text and links on the page can be read as data.',
    items: [
      { t: 'Accessibility tree and batch queries', d: 'snapshot refs last one call; query returns every match with its position.', tool: 'page_snapshot / page_query', level: 'yes' },
      { t: 'Read the DOM or the raw response', d: 'dom is the live document, response is the HTML of this navigation.', tool: 'page_source', level: 'yes' },
      { t: 'Page scripts and cross-origin iframes', d: 'return JSON; a frame URL fragment runs the script inside that iframe.', tool: 'page_script', level: 'yes' },
      { t: 'CSV straight from a workflow', d: 'extract plus export, with a BOM so Excel opens it cleanly.', tool: 'extract / export', level: 'yes' }
    ]
  },
  {
    title: 'Downloads and media',
    lead: 'Page-triggered downloads land in the same manager.',
    items: [
      { t: 'Download manager', d: 'progress, pause and resume, retry, copy link; every download in one list.', tool: 'will-download', level: 'yes' },
      { t: 'Images, audio, video', d: 'direct links download as is; DASH tracks from Bilibili, Douyin and YouTube merge into mp4; m3u8 goes through ffmpeg.', tool: 'page_save_media', level: 'yes' },
      { t: 'Record a playing video', d: 'captureStream plus MediaRecorder works on any site that plays, at the cost of real time.', tool: 'page_record_video', level: 'try' },
      { t: 'Per-tab capture', d: 'HTTP records, URL filters and HAR export; headers may hold cookies, so everything stays local.', tool: 'net_*', level: 'yes' }
    ]
  },
  {
    title: 'Screenshots and recording',
    lead: 'The agent can see the screen and keep a record of the run.',
    items: [
      { t: 'Screenshots come back as images', d: 'page_screenshot returns an MCP image plus path, pixel size and bytes; huge images return only the path.', tool: 'page_screenshot', level: 'yes' },
      { t: 'Composited window preview', d: 'app shell, page, overlay, handoff banner and popups in one image; headed windows only, not a system screenshot.', tool: 'window_preview', level: 'yes' },
      { t: 'Window recording and status', d: 'stops after 300 seconds by default, 3600 max; status reports elapsed time, stop returns path, duration and bytes.', tool: 'screen', level: 'yes' }
    ]
  },
  {
    title: 'Network and debugging',
    lead: 'Failures leave evidence instead of guesswork.',
    items: [
      { t: 'Capture and HAR', d: 'recorded per tab; bodies and cookies never leave the machine.', tool: 'net_start / net_export', level: 'yes' },
      { t: 'Request interception', d: 'return fake data by URL fragment for API testing and fault injection.', tool: 'net_mock', level: 'yes' },
      { t: 'Single or batched CDP', d: 'send commands in order on one session; a child frame session can be targeted.', tool: 'page_cdp_batch', level: 'yes' }
    ]
  },
  {
    title: 'Captchas',
    lead: 'Only what works reliably is marked as supported.',
    items: [
      { t: 'Geetest v4 slider', d: 'cv then ddddocr then onnx; human-like drag and retry on a fresh image.', tool: 'captcha_solve', level: 'yes' },
      { t: 'Everything else goes to a vision agent', d: 'a screenshot with a coordinate mapping; success depends on the puzzle and the model.', tool: 'captcha_panel', level: 'try' },
      { t: 'Alphanumeric captchas', d: 'ddddocr, requires local Python and pip install ddddocr.', tool: 'captcha_read', level: 'try' },
      { t: 'Icon picking, board games', d: 'no built-in detector, no promise; hand them to a human with page_handoff.', tool: 'page_handoff', level: 'no' }
    ]
  }
]

const levelText: Record<string, string> = { yes: 'Supported', try: 'Experimental', no: 'Not supported' }

const compare = [
  {
    scene: 'Getting started',
    hand: 'Write code, install a browser, handle drivers and launch flags.',
    rpa: 'Install an RPA suite, record or drag a flow; desktop editions usually charge per seat.',
    bp: 'Install a desktop app and register its local MCP with your agent; no script needed to start.'
  },
  {
    scene: 'Login state',
    hand: 'Maintain storageState or cookies yourself; re-login when they expire.',
    rpa: 'Often tied to the desktop session or a built-in browser; switching accounts is configuration.',
    bp: 'Logins stay in the environment persist partition; several sites per environment, closing keeps them.'
  },
  {
    scene: 'Site redesign',
    hand: 'Selectors break; change code, run tests, ship a release.',
    rpa: 'Element paths break; edit the flow in the editor.',
    bp: 'It breaks too; failures carry match counts, text and a screenshot, which speeds up diagnosis, but nothing auto-heals.'
  },
  {
    scene: 'Repeated runs',
    hand: 'Put the script in CI or a scheduler; write retries and reports yourself.',
    rpa: 'Scheduling and logs are built in; good for fixed flows.',
    bp: 'workflow_run executes the whole graph; workflow_batch takes many rows, up to 3 concurrent.'
  },
  {
    scene: 'Who decides the next step',
    hand: 'The code you wrote.',
    rpa: 'The recorded flow.',
    bp: 'The agent plans; a working run becomes a workflow. BrowserPilot itself ships no model.'
  },
  {
    scene: 'Best fit',
    hand: 'Engineering teams, CI, anything that needs versioning and review.',
    rpa: 'Fixed internal systems, finance or HR form flows.',
    bp: 'Local, already signed in, human takeover required; not for desktop-less servers.'
  }
]

const specs = [
  { k: 'Version', v: '0.17.1' },
  { k: 'Runtime', v: 'Electron 45 · React 19 · TypeScript 5; Windows installer about 118 MiB, roughly 460 MB installed' },
  { k: 'Driving', v: 'Electron WebContentsView plus Chrome DevTools Protocol (Input, DOM, Accessibility, Network)' },
  { k: 'Locating', v: 'XPath or CSS; exactly one match; pierces shadow DOM and same-origin iframes, falling back to cross-origin frames' },
  { k: 'Modes', v: 'Headed first; headless hides the window (same Chromium), 3 by default, adjustable in settings' },
  { k: 'Concurrency', v: 'workflow_batch runs up to 3 at a time (setting); each environment has its own window' },
  { k: 'Credentials', v: 'Sessions live in the Electron persist partition; MCP listens on 127.0.0.1 only, Bearer token in the local mcp.json' },
  { k: 'Platforms', v: 'Windows x64 · macOS Apple Silicon · Linux x64; CI builds all three' },
  { k: 'Network', v: 'No account system; the market is read from GitHub; ffmpeg is downloaded once for media merging' },
  { k: 'License', v: 'The repository has no LICENSE file yet; the source is public but confirm terms before redistributing' },
  { k: 'Data', v: 'Windows %APPDATA%\BrowserPilot; macOS ~/Library/Application Support/BrowserPilot; Linux ~/.config/BrowserPilot' }
]

const shots = [
  { src: '/shots/tasks.png', title: 'Tasks and parameters', desc: 'Saved workflows carry parameters; fill them in and run, or let the agent call workflow_run.' },
  { src: '/shots/agent-mask.png', title: 'Agent operating', desc: 'An overlay covers the page with a take-over button; one click returns control.' },
  { src: '/shots/run-detail.png', title: 'Run detail', desc: 'Success or failure, the step it stopped at, outputs and files; failures attach a screenshot.' },
  { src: '/shots/workflow.png', title: 'Workflow canvas', desc: '22 node types connected left to right; agents never draw, they call workflow_run.' },
  { src: '/shots/settings.png', title: 'Settings, general', desc: 'MCP listens on 127.0.0.1 only, port 39221 by default; batch concurrency and the headless limit live here.' }
]

const changelog = [
  {
    v: 'v0.17.1',
    when: '2026-11-08',
    items: [
      'Tool descriptions are English-only and shorter, cutting the prompt footprint roughly in half.',
      'Workflow recording: record a sequence of tool calls into a workflow graph.',
      'Drawing strokes are verified by reading canvas pixels; wiped or empty strokes fail loudly.'
    ]
  },
  {
    v: 'v0.17.0',
    when: '2026-11-08',
    items: [
      'New stroke node draws along an SVG path with real pointer events, so strokes land in the site document.',
      'Pointer dispatch is pipelined: a stroke that took 81 seconds in a background window now takes about 1 second.',
      'Workflow locators accept visible text and role plus accessible name, not only selectors.'
    ]
  },
  {
    v: 'v0.16.0',
    when: '2026-11-07',
    items: [
      'Screenshots carry a coordinate grid by default, with the crop origin printed in the corner.',
      'window_preview supports cropped previews; grid colors follow the background of each block.',
      'Media saving and window recording default to the system download folder.'
    ]
  }
]

const faqs = [
  {
    q: 'Will it click a payment button by mistake?',
    a: 'There is no per-click confirmation: when the agent calls page_click, the click happens. Steps that need a human go through page_handoff or a handoff node, which removes the overlay, leaves a message and locks again only for the next step. For payment, delete or publish pages, put them after a handoff, or let the agent read only.'
  },
  {
    q: 'How are logins preserved? What about moving machines?',
    a: 'One environment is one Electron persist partition. Sign in once; closing the window keeps it, and environments never see each other. Deleting the environment clears cookies. To move machines, export and import cookies with env_export and env_import; the file is plain text, keep it local.'
  },
  {
    q: 'What happens when a site changes?',
    a: 'Selectors break and BrowserPilot does not repair them. A failure carries the match count, the text and a screenshot; re-locate with page_query or page_snapshot and update the workflow node. The run record shows which step stopped.'
  },
  {
    q: 'Can it run on a server?',
    a: 'No. It is a desktop app and needs a graphical session; headless only hides the window, still the same Chromium. MCP listens on 127.0.0.1 and is not exposed. For remote execution, connect to that machine over remote desktop.'
  },
  {
    q: 'Where do data and screenshots live?',
    a: 'In the user data directory: %APPDATA%\BrowserPilot on Windows, ~/Library/Application Support/BrowserPilot on macOS, ~/.config/BrowserPilot on Linux. Screenshots in screenshots, runs in runs.json, HAR in runs, exported CSV in exports, downloads in the download folder. There is no account and no cloud sync.'
  },
  {
    q: 'Which captchas are supported?',
    a: 'Geetest v4 sliders are automatic: cv, ddddocr and onnx with fallback, human-like drags and retries. Anything else is screenshotted for a vision agent through captcha_panel, with success depending on the puzzle and the model. Alphanumeric captchas work with ddddocr and local Python. Icon picking and board games have no detector; hand them to a human.'
  },
  {
    q: 'Can several accounts run at once?',
    a: 'Yes. One environment per account, each with its own window and logins. workflow_batch runs rows one at a time with up to 3 concurrent, and up to 3 headless windows by default, adjustable in settings.'
  },
  {
    q: 'Will sites detect it as a bot?',
    a: 'BrowserPilot removes the automation flags it would otherwise add: no --enable-automation, a Chrome user agent matching the bundled version, no Electron or HeadlessChrome string, and trusted CDP input by default. It is not an anti-detect browser and does not promise to bypass site risk controls; that judgement belongs to the site.'
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
          <span class="notice-text">Screenshots return as images; new window preview and recording status</span>
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
            One login per environment. The agent clicks, fills, waits and extracts in that same window; you can take over whenever you want.
            Windows, macOS and Linux, all local.
          </p>
          <div class="hero-cta">
            <a v-press class="btn primary big" :href="withBase('/en/download.html')">
              Download v0.17.1
              <span class="arw" v-html="ICONS.arrow" />
            </a>
            <a v-press class="btn ghost" href="#demo">
              <span v-html="ICONS.play" style="display:inline-flex;width:14px;height:14px" />
              Watch it run
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
            <span>Local MCP · 127.0.0.1</span>
            <span>22 workflow nodes</span>
            <span>Geetest v4 sliders</span>
            <span>Unsigned installers</span>
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
              <span>BrowserPilot · real run · window 1280 × 800</span>
            </div>
            <DemoPlayer />
          </div>
          </div>
        </div>
        <div class="demo-caption">
          <p>
            <strong>A real task:</strong> answering a general-knowledge exam on Wenjuanxing, five questions, all correct, 100 points.
            The recording starts on a blank paper, picks each answer, and ends on the result page.
          </p>
          <span class="demo-time">13 seconds · silent loop · recorded</span>
        </div>
        <div class="demo-notes">
          <div><b>01 Input</b>A real online exam; the agent reads each question and decides the answer.</div>
          <div><b>02 Actions in the window</b>Answering question by question; the window, page and recording marks are real.</div>
          <div><b>03 Result</b>Submit and the score appears: 5 / 5 correct, 100 points.</div>
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
        <span class="eyebrow reveal"><i>01</i>How it works</span>
        <h2 class="display reveal">Give the task, <span>then read the result</span></h2>
        <p class="lead reveal">
          Once a run works, save the steps as a workflow. Next time a single workflow_run replays it.
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
        <span class="eyebrow reveal"><i>02</i>Capabilities</span>
        <h2 class="display reveal">What it does, <span>what it does not</span></h2>
        <p class="lead reveal">
          Every line below maps to an MCP tool or a shipped interface behaviour. Supported means available today; experimental means implemented but dependent on external conditions;
          not supported means no promise, hand it to a human.
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
        <span class="eyebrow reveal"><i>·</i>Three modes</span>
        <h2 class="display reveal">When to use <span>which one</span></h2>
        <p class="lead reveal">
          Agent direct suits one-off tasks; saved workflows suit repetition; human in the loop suits logins, verification and anything a person must approve.
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
        <span class="eyebrow reveal"><i>03</i>Human in the loop</span>
        <h2 class="display reveal">It stops, <span>and you can interrupt</span></h2>
        <p class="lead reveal">
          Control is the first thing people ask about with this kind of tool. The table below follows what the code actually does.
        </p>
        <div class="loop">
          <div class="reveal">
            <table class="loop-table">
              <thead>
            <tr><th>Control state</th><th>What the page shows</th><th>Who is acting</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>agent</td>
              <td>An overlay saying the agent is operating the browser, with Take over in the middle.</td>
              <td>The agent; pressing Take over returns control immediately.</td>
                </tr>
                <tr>
                  <td>handoff</td>
              <td>The overlay is removed and a message stays at the top; it locks again when the next target appears.</td>
              <td>The human; a workflow handoff waits up to 10 minutes when the next node has a locator.</td>
                </tr>
                <tr>
                  <td>shared</td>
              <td>No overlay.</td>
              <td>Human and agent together; the task is not paused.</td>
                </tr>
              </tbody>
            </table>
            <div class="loop-warning">
          Individual tool calls do not write an audit log. To show the process to someone else, use run records (success or failure, node, outputs, files, screenshot)
          and the HAR capture; both are per run, not per click.
            </div>
          </div>
          <div class="loop-points">
            <div class="loop-point reveal" v-spot>
          <h4>Taking over does not pause</h4>
              <p>
          When a human presses Take over or the agent calls <code>page_unlock</code>, control becomes shared and the task continues.
          The workflow returns <code>takenOver: true</code>; the agent should re-read the page before deciding the next step.
              </p>
            </div>
            <div class="loop-point reveal" v-spot>
          <h4>When a human must do one step</h4>
              <p>
          Use <code>page_handoff</code> or the handoff node. A headless window is shown first;
          the node waits for the next target up to 10 minutes, and locks again immediately when the next node has no locator.
              </p>
            </div>
            <div class="loop-point reveal" v-spot>
          <h4>Credentials stay local</h4>
              <p>
          Sessions live in the Electron persist partition. MCP listens on 127.0.0.1 and the Bearer token is written to the local
          <code>mcp.json</code>. Cookies are never sent to a cloud service.
              </p>
            </div>
            <div class="loop-point reveal" v-spot>
          <h4>Exported cookies are plain text</h4>
              <p>
          <code>env_export</code> exists for moving machines and contains full cookies. Keep it local: do not paste it into chats,
          repositories or tickets, and delete it when done.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section alt">
      <div class="inner">
        <span class="eyebrow reveal"><i>04</i>Boundaries</span>
        <h2 class="display reveal">What we do, <span>what we do not</span></h2>
        <p class="lead reveal">
          These are out of scope. Each line has a basis in the code or the release configuration.
        </p>
        <div class="bounds">
          <div class="bound reveal" v-lift="2" v-spot>
          <h3>We do</h3>
            <ul>
          <li><strong>Run locally on the desktop.</strong>One window per environment, logins in the partition, closing keeps them.</li>
          <li><strong>Human and agent in one window.</strong>Overlay, take-over and handoff, three control states.</li>
          <li><strong>Save steps as workflows.</strong>22 node types; one <code>workflow_run</code> executes the graph.</li>
          <li><strong>Geetest v4 sliders automatically.</strong>cv, ddddocr and onnx with fallback, retrying on a fresh image.</li>
          <li><strong>Local MCP and CLI.</strong>MCP is the main entry; the CLI reads the endpoint from the Windows path today.</li>
            </ul>
          </div>
          <div class="bound no reveal" v-lift="2">
          <h3>We do not</h3>
            <ul>
          <li><strong>No fingerprint engine.</strong>We only remove automation flags we add ourselves and promise nothing about site risk control.</li>
          <li><strong>No cloud execution or account hosting.</strong>MCP listens on 127.0.0.1 and task data is never uploaded.</li>
          <li><strong>No universal captcha solving.</strong>Icon picking and board games have no built-in detector.</li>
          <li><strong>No built-in scheduler.</strong>Use the system scheduler with the CLI.</li>
          <li><strong>No NIC-level capture.</strong>Only per-tab HTTP records.</li>
          <li><strong>No password custody.</strong>The human signs in inside the environment window.</li>
          <li><strong>Unsigned installers.</strong>SmartScreen and macOS blocks follow the documented steps.</li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="inner">
        <span class="eyebrow reveal"><i>05</i>Integration</span>
        <h2 class="display reveal">Agents use MCP, <span>humans use the UI</span></h2>
        <p class="lead reveal">
          MCP is the main entry: agents call 69 tools through it. The CLI wraps the same tool set for scripts and scheduled tasks.
          The app itself has no timer.
        </p>
        <div class="integration-grid">
          <article class="codecard reveal" v-spot>
          <header><h3>MCP client configuration</h3><span>streamable HTTP</span></header>
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
          Open BrowserPilot, then Settings, General, MCP. Replace REPLACE_WITH_TOKEN with the token from
          <code>%APPDATA%\BrowserPilot\mcp.json</code>; do not paste it into chats or repositories.
            </p>
          </article>
          <article class="codecard reveal" v-spot>
            <header><h3>CLI</h3><span>Windows</span></header>
            <pre><code>"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" tools
"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" schema page_click
"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" call workflow_run --name "GitHub digest" --json-file C:\tasks\github.json</code></pre>
            <p class="note">
github.json contains <code>{"topic":"browser-automation"}</code>. The CLI reads mcp.json from the Windows
          <code>%APPDATA%</code> path only; use MCP on macOS and Linux.
            </p>
          </article>
          <article class="codecard reveal" v-spot>
          <header><h3>Batch input</h3><span>workflow_batch</span></header>
            <pre><code>{
"workflow": "GitHub digest",
  "rows": [
{ "topic": "browser-automation" },
{ "topic": "headless-browser" }
  ],
  "concurrency": 2
}</code></pre>
            <p class="note">
          Up to 3 concurrent. Each row is a full run with its own record; rows run one at a time by default.
            </p>
          </article>
          <article class="codecard reveal" v-spot>
          <header><h3>System scheduler</h3><span>not built in</span></header>
            <pre><code>set BROWSERPILOT_EXE=%LOCALAPPDATA%\Programs\BrowserPilot\BrowserPilot.exe
"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" ^
call workflow_run --name "GitHub digest" --json-file C:\tasks\github.json</code></pre>
            <p class="note">
          Save it as <code>browserpilot-morning.bat</code>, then
          <code>schtasks /Create /SC DAILY /ST 09:00 /TN "BrowserPilot digest" /TR "C:\tasks\browserpilot-morning.bat"</code>.
          The CLI waits up to 45 seconds for the app to start.
            </p>
          </article>
        </div>
      </div>
    </section>

    <section class="section alt">
      <div class="inner">
        <span class="eyebrow reveal"><i>06</i>Comparison</span>
        <h2 class="display reveal">Hand-written scripts, RPA, <span>BrowserPilot</span></h2>
        <p class="lead reveal">
          The three approaches solve different problems. The differences follow.
        </p>
        <p class="table-hint">On narrow screens the table scrolls sideways.</p>
        <div class="table-wrap reveal">
          <table class="compare">
            <thead>
            <tr><th>Dimension</th><th>Hand-written Playwright / Puppeteer</th><th>Traditional RPA</th><th>BrowserPilot</th></tr>
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
        <span class="eyebrow reveal"><i>07</i>Specifications</span>
        <h2 class="display reveal">For people evaluating the integration</h2>
        <p class="lead reveal">
          Version, driving, locating, concurrency, credentials and where data lands. Numbers come from the repository and the current installer.
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
        <span class="eyebrow reveal"><i>08</i>Interface</span>
        <h2 class="display reveal">Five screenshots</h2>
        <p class="lead reveal">
          All five are window captures of 0.13.13 on Windows at 1440 × 900; 0.14.0 changed tools only, not the UI. The Chinese home page still shows those captures.
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
        <span class="eyebrow reveal"><i>09</i>Source and build</span>
        <h2 class="display reveal">Build and license</h2>
        <p class="lead reveal">
          Main process, UI, Go CLI and the workflow market all live in public repositories. Three commands get a local build running.
        </p>
        <div class="dev-grid">
          <div class="dev-card reveal" v-spot>
          <h3>Three commands</h3>
            <pre><code>$ git clone https://github.com/xy200303/browserpilot
$ npm install
$ npm run dev</code></pre>
            <p class="muted">
          Build with <code>npm run build</code>; typecheck with <code>npm run typecheck</code>;
          package with <code>npm run dist:win</code> (or dist:mac, dist:linux).
            </p>
          </div>
          <div class="dev-card reveal d1">
          <h3>License and boundaries</h3>
            <ul class="dev-list">
          <li>Repository: <a href="https://github.com/xy200303/browserpilot" target="_blank" rel="noreferrer">xy200303/browserpilot</a></li>
          <li>Market: <a href="https://github.com/xy200303/browserpilot-market" target="_blank" rel="noreferrer">xy200303/browserpilot-market</a>; the app only downloads.</li>
          <li>Main process, React UI and Go CLI in one repository; there is no server.</li>
          <li>Windows installers are not code-signed.</li>
            </ul>
            <div class="license-note">
          As of v0.17.1 the repository has no LICENSE file. The source is public, but until the author grants written permission,
          do not redistribute it as MIT or Apache. The actual repository file is authoritative.
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="changelog" class="section alt">
      <div class="inner">
        <span class="eyebrow reveal"><i>10</i>Changelog</span>
        <h2 class="display reveal">The last three releases</h2>
        <p class="lead reveal">
          Only commits that exist in the repository. Version numbers and dates follow the release tags.
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
          Full history in
          <a href="https://github.com/xy200303/browserpilot/releases" target="_blank" rel="noreferrer">GitHub Releases</a>。
        </p>
      </div>
    </section>

    <section class="section">
      <div class="inner narrow">
        <span class="eyebrow reveal"><i>11</i>FAQ</span>
        <h2 class="display reveal">Frequently asked</h2>
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
      <h2 class="display">Install, connect your agent, <span>let it run once</span></h2>
        <p class="final-sub">
        Open the app once after installing and confirm MCP is on in Settings; then register the local endpoint with Claude Code, Kimi Code, Cursor or your own client.
        </p>
        <div class="hero-cta">
          <a v-press class="btn primary big" href="https://github.com/xy200303/browserpilot/releases/latest" target="_blank" rel="noreferrer">
        Download the latest
            <span class="arw" v-html="ICONS.arrow" />
          </a>
<a v-press class="btn ghost" :href="withBase('/en/guide/quickstart.html')">Getting started</a>
          <a v-press class="btn ghost" href="https://github.com/xy200303/browserpilot" target="_blank" rel="noreferrer">GitHub</a>
        </div>
        <p class="footnote">
      Source is public; no LICENSE in the repository yet · unsigned installers · © 2026 BrowserPilot<br />
      Recordings and screenshots come from real v0.13.13 windows at 1440 × 900; the UI is unchanged in 0.17.1.
        </p>
      </div>
    </section>
  </div>
</template>
