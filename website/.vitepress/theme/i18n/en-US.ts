import type { MessageShape } from './shape'
import type { zhCN } from './zh-CN'

export const enUS: MessageShape<typeof zhCN> = {
  hero: {
    notice: { tag: 'v0.19.0', text: 'Performance release: ~30% less memory with 10 tabs, half the user data, smaller package' },
    kicker: 'MCP · 99 TOOLS · 0.19.0',
    title: ['The browser you are already', 'signed in to. Your agent drives.'],
    titleMobile: ['Already signed in,', 'your agent drives.'],
    sub: 'One login per environment. The agent clicks, fills, waits and extracts in that same window; you can take over whenever you want. Windows, macOS and Linux, all local.',
    cta: { download: 'Download v0.19.0', watch: 'Watch it run' },
    meta: ['Local MCP · 127.0.0.1', '22 workflow nodes', 'Geetest v4 sliders', 'Unsigned installers']
  },
  demo: {
    bar: 'BrowserPilot · real run · window 1280 × 800',
    captionStrong: 'A real task: ',
    caption: 'answering a general-knowledge exam on Wenjuanxing, five questions, all correct, 100 points. The recording starts on a blank paper, picks each answer, and ends on the result page.',
    time: '13 seconds · silent loop · recorded',
    notes: [
      { b: '01 Input', text: 'A real online exam; the agent reads each question and decides the answer.' },
      { b: '02 Actions in the window', text: 'Answering question by question; the window, page and recording marks are real.' },
      { b: '03 Result', text: 'Submit and the score appears: 5 / 5 correct, 100 points.' }
    ]
  },
  stats: [
    { value: '99', label: 'MCP tools', note: 'actual count in tool-catalog.ts' },
    { value: '22', label: 'workflow nodes', note: 'start, end, branch and loop included' },
    { value: '200', label: 'runs kept', note: 'the UI lists the latest 50' },
    { value: '3', label: 'concurrency and headless', note: 'default 3 each, adjustable in settings' }
  ],
  marquee: [
    'navigation', 'forms and uploads', 'tabs and environments', 'waits and retries', 'extraction',
    'downloads and media', 'per-tab capture', 'Geetest sliders', 'local MCP', 'workflow replay'
  ],
  how: {
    eyebrow: 'How it works',
    title: 'Give the task, <span>then read the result</span>',
    lead: 'Once a run works, save the steps as a workflow. Next time a single workflow_run replays it.'
  },
  steps: [
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
  ],
  capsSection: {
    eyebrow: 'Capabilities',
    title: 'What it does, <span>what it does not</span>',
    lead: 'Every line maps to an MCP tool or a shipped interface behaviour. Supported means available today; experimental means implemented but dependent on external conditions; not supported means no promise, hand it to a human.'
  },
  levels: { yes: 'Supported', try: 'Experimental', no: 'Not supported' },
  caps: [
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
        { t: 'Window recording and status', d: 'stops after 300 seconds by default, 3600 max; action=status reports elapsed time, action=stop returns path, duration and bytes.', tool: 'screen', level: 'yes' }
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
  ],
  modesSection: {
    eyebrow: 'Three modes',
    title: 'When to use <span>which one</span>',
    lead: 'Agent direct suits one-off tasks; saved workflows suit repetition; human in the loop suits logins, verification and anything a person must approve.'
  },
  modes: [
    {
      id: 'agent',
      name: 'Agent direct',
      lead: 'Say it in Claude Code, Kimi Code or Cursor. The agent finds elements, clicks, waits and reads results over MCP. Best for one-off tasks and flows that are not settled yet.',
      items: [
        { t: '99 tools', d: 'navigation, clicking, forms, screenshots, window preview, capture, media, captchas in one catalog' },
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
  ],
  control: {
    eyebrow: 'Human in the loop',
    title: 'It stops, <span>and you can interrupt</span>',
    lead: 'Control is the first thing people ask about with this kind of tool. The table below follows what the code actually does.',
    tableHead: ['Control state', 'What the page shows', 'Who is acting'],
    rows: [
      { state: 'agent', show: 'An overlay saying the agent is operating the browser, with Take over in the middle.', who: 'The agent; pressing Take over returns control immediately.' },
      { state: 'handoff', show: 'The overlay is removed and a message stays at the top; it locks again when the next target appears.', who: 'The human; a workflow handoff waits up to 10 minutes when the next node has a locator.' },
      { state: 'shared', show: 'No overlay.', who: 'Human and agent together; the task is not paused.' }
    ],
    audit: 'Individual tool calls do not write an audit log. To show the process to someone else, use run records (success or failure, node, outputs, files, screenshot) and the HAR capture; both are per run, not per click.',
    cards: [
      { h: 'Taking over does not pause', p: 'When a human presses Take over or the agent calls <code>page_unlock</code>, control becomes shared and the task continues. The workflow returns <code>takenOver: true</code>; the agent should re-read the page before deciding the next step.' },
      { h: 'When a human must do one step', p: 'Use <code>page_handoff</code> or the handoff node. A headless window is shown first; the node waits for the next target up to 10 minutes, and locks again immediately when the next node has no locator.' },
      { h: 'Credentials stay local', p: 'Sessions live in the Electron persist partition. MCP listens on 127.0.0.1 and the Bearer token is written to the local <code>mcp.json</code>. Cookies are never sent to a cloud service.' },
      { h: 'Exported cookies are plain text', p: '<code>env_export</code> exists for moving machines and contains full cookies. Keep it local: do not paste it into chats, repositories or tickets, and delete it when done.' }
    ]
  },
  bounds: {
    eyebrow: 'Boundaries',
    title: 'What we do, <span>what we do not</span>',
    lead: 'These are out of scope. Each line has a basis in the code or the release configuration.',
    doTitle: 'We do',
    do: [
      '<strong>Run locally on the desktop.</strong> One window per environment, logins in the partition, closing keeps them.',
      '<strong>Human and agent in one window.</strong> Overlay, take-over and handoff, three control states.',
      '<strong>Save steps as workflows.</strong> 22 node types; one <code>workflow_run</code> executes the graph.',
      '<strong>Geetest v4 sliders automatically.</strong> cv, ddddocr and onnx with fallback, retrying on a fresh image.',
      '<strong>Local MCP and CLI.</strong> MCP is the main entry; the CLI reads the endpoint from the Windows path today.'
    ],
    dontTitle: 'We do not',
    dont: [
      '<strong>No fingerprint engine.</strong> We only remove automation flags we add ourselves and promise nothing about site risk control.',
      '<strong>No cloud execution or account hosting.</strong> MCP listens on 127.0.0.1 and task data is never uploaded.',
      '<strong>No universal captcha solving.</strong> Icon picking and board games have no built-in detector.',
      '<strong>No built-in scheduler.</strong> Use the system scheduler with the CLI.',
      '<strong>No NIC-level capture.</strong> Only per-tab HTTP records.',
      '<strong>No password custody.</strong> The human signs in inside the environment window.',
      '<strong>Unsigned installers.</strong> SmartScreen and macOS blocks follow the documented steps.'
    ]
  },
  integration: {
    eyebrow: 'Integration',
    title: 'Agents use MCP, <span>humans use the UI</span>',
    lead: 'MCP is the main entry: agents call 99 tools through it. The CLI wraps the same tool set for scripts and scheduled tasks. The app itself has no timer.',
    cliTitle: 'CLI',
    cliTag: 'Windows',
    cliNote: 'github.json contains <code>&#123;"topic":"browser-automation"&#125;</code>. The CLI reads mcp.json from the Windows <code>%APPDATA%</code> path only; use MCP on macOS and Linux.',
    sampleWorkflow: 'GitHub digest',
    sampleKeyword: 'topic',
    mcpTitle: 'MCP client configuration',
    mcpTag: 'streamable HTTP',
    mcpNote: 'Open BrowserPilot, then Settings, General, MCP. Replace REPLACE_WITH_TOKEN with the token from <code>%APPDATA%\\BrowserPilot\\mcp.json</code>; do not paste it into chats or repositories.',
    batchTitle: 'Batch input',
    batchTag: 'workflow_batch',
    batchNote: 'Up to 3 concurrent. Each row is a full run with its own record; rows run one at a time by default.',
    taskTitle: 'System scheduler',
    taskTag: 'not built in',
    taskNote: 'Save it as <code>browserpilot-morning.bat</code>, then <code>schtasks /Create /SC DAILY /ST 09:00 /TN "BrowserPilot digest" /TR "C:\\tasks\\browserpilot-morning.bat"</code>. The CLI waits up to 45 seconds for the app to start.'
  },
  compareSection: {
    eyebrow: 'Comparison',
    title: 'Hand-written scripts, RPA, <span>BrowserPilot</span>',
    lead: 'The three approaches solve different problems. The differences follow.',
    hint: 'On narrow screens the table scrolls sideways.',
    head: ['Dimension', 'Hand-written Playwright / Puppeteer', 'Traditional RPA', 'BrowserPilot']
  },
  compare: [
    { scene: 'Getting started', hand: 'Write code, install a browser, handle drivers and launch flags.', rpa: 'Install an RPA suite, record or drag a flow; desktop editions usually charge per seat.', bp: 'Install a desktop app and register its local MCP with your agent; no script needed to start.' },
    { scene: 'Login state', hand: 'Maintain storageState or cookies yourself; re-login when they expire.', rpa: 'Often tied to the desktop session or a built-in browser; switching accounts is configuration.', bp: 'Logins stay in the environment persist partition; several sites per environment, closing keeps them.' },
    { scene: 'Site redesign', hand: 'Selectors break; change code, run tests, ship a release.', rpa: 'Element paths break; edit the flow in the editor.', bp: 'It breaks too; failures carry match counts, text and a screenshot, which speeds up diagnosis, but nothing auto-heals.' },
    { scene: 'Repeated runs', hand: 'Put the script in CI or a scheduler; write retries and reports yourself.', rpa: 'Scheduling and logs are built in; good for fixed flows.', bp: 'workflow_run executes the whole graph; workflow_batch takes many rows, up to 3 concurrent.' },
    { scene: 'Who decides the next step', hand: 'The code you wrote.', rpa: 'The recorded flow.', bp: 'The agent plans; a working run becomes a workflow. BrowserPilot itself ships no model.' },
    { scene: 'Best fit', hand: 'Engineering teams, CI, anything that needs versioning and review.', rpa: 'Fixed internal systems, finance or HR form flows.', bp: 'Local, already signed in, human takeover required; not for desktop-less servers.' }
  ],
  specsSection: {
    eyebrow: 'Specifications',
    title: 'For people evaluating the integration',
    lead: 'Version, driving, locating, concurrency, credentials and where data lands. Numbers come from the repository and the current installer.'
  },
  specs: [
    { k: 'Version', v: '0.19.0' },
    { k: 'Runtime', v: 'Electron 45 · React 19 · TypeScript 5; Windows installer about 118 MiB, roughly 320 MB installed' },
    { k: 'Driving', v: 'Electron WebContentsView plus Chrome DevTools Protocol (Input, DOM, Accessibility, Network)' },
    { k: 'Locating', v: 'XPath or CSS; exactly one match; pierces shadow DOM and same-origin iframes, falling back to cross-origin frames' },
    { k: 'Modes', v: 'Headed first; headless hides the window (same Chromium), 3 by default, adjustable in settings' },
    { k: 'Concurrency', v: 'workflow_batch runs up to 3 at a time (setting); each environment has its own window' },
    { k: 'Credentials', v: 'Sessions live in the Electron persist partition; MCP listens on 127.0.0.1 only, Bearer token in the local mcp.json' },
    { k: 'Platforms', v: 'Windows x64 · macOS Apple Silicon · Linux x64; CI builds all three' },
    { k: 'Network', v: 'No account system; the market is read from GitHub; ffmpeg is downloaded once for media merging' },
    { k: 'License', v: 'The repository has no LICENSE file yet; the source is public but confirm terms before redistributing' },
    { k: 'Data', v: 'Windows %APPDATA%\\BrowserPilot; macOS ~/Library/Application Support/BrowserPilot; Linux ~/.config/BrowserPilot' }
  ],
  shotsSection: {
    eyebrow: 'Interface',
    title: 'Five screenshots',
    lead: 'All five are window captures of 0.13.13 on Windows at 1440 × 900; later releases changed tools only, not the UI.'
  },
  shots: [
    { src: '/shots/tasks.png', title: 'Tasks and parameters', desc: 'Saved workflows carry parameters; fill them in and run, or let the agent call workflow_run.' },
    { src: '/shots/agent-mask.png', title: 'Agent operating', desc: 'An overlay covers the page with a take-over button; one click returns control.' },
    { src: '/shots/run-detail.png', title: 'Run detail', desc: 'Success or failure, the step it stopped at, outputs and files; failures attach a screenshot.' },
    { src: '/shots/workflow.png', title: 'Workflow canvas', desc: '22 node types connected left to right; agents never draw, they call workflow_run.' },
    { src: '/shots/settings.png', title: 'Settings, general', desc: 'MCP listens on 127.0.0.1 only, port 39221 by default; batch concurrency and the headless limit live here.' }
  ],
  build: {
    eyebrow: 'Source and build',
    title: 'Build and license',
    lead: 'Main process, UI, Go CLI and the workflow market all live in public repositories. Three commands get a local build running.',
    h: 'Three commands',
    commands: 'Install with <code>npm install</code>; build with <code>npm run build</code>; typecheck with <code>npm run typecheck</code>; package with <code>npm run dist:win</code> (or dist:mac, dist:linux).',
    licenseTitle: 'License and boundaries',
    license: [
      'Repository: <a href="https://github.com/xy200303/browserpilot" target="_blank" rel="noreferrer">xy200303/browserpilot</a>',
      'Market: <a href="https://github.com/xy200303/browserpilot-market" target="_blank" rel="noreferrer">xy200303/browserpilot-market</a>; the app only downloads.',
      'Main process, React UI and Go CLI in one repository; there is no server.',
      'Windows installers are not code-signed.'
    ],
    note: 'As of v0.19.0 the repository has no LICENSE file. The source is public, but until the author grants written permission, do not redistribute it as MIT or Apache. The actual repository file is authoritative.'
  },
  changelogSection: {
    eyebrow: 'Changelog',
    title: 'The last three releases',
    lead: 'Only commits that exist in the repository. Version numbers and dates follow the release tags.',
    more: 'Full history in'
  },
  changelog: [
    {
      v: 'v0.19.0',
      when: '2026-11-09',
      items: [
        'Memory for 10 tabs is about 30% lower; background tabs sleep beyond 8 live tabs or under system memory pressure.',
        'User data shrank from 501 MB to 254 MB after cleanup; screenshots keep 120 files, 80 MB and 14 days.',
        'Screenshots and window preview no longer round-trip base64; capture is about 25% faster. Recording and media downloads stream to disk.',
        'app.asar dropped from 14.2 MB to 4.5 MB.'
      ]
    },
    {
      v: 'v0.18.0',
      when: '2026-11-08',
      items: [
        'Interface in Chinese and English: follow the system, or pin one language in settings.',
        'All 99 tool descriptions rewritten in English and shortened; search gained aliases and a partial-match fallback.',
        'Fixed main-process crashes when opening a bookmark, the page context menu or window preview after a view was recycled.'
      ]
    },
    {
      v: 'v0.17.1',
      when: '2026-11-08',
      items: [
        'Tool descriptions are English-only and shorter, cutting the prompt footprint roughly in half.',
        'Workflow recording: record a sequence of tool calls into a workflow graph.',
        'Drawing strokes are verified by reading canvas pixels; wiped or empty strokes fail loudly.'
      ]
    }
  ],
  faqSection: { eyebrow: 'FAQ', title: 'Frequently asked' },
  faqs: [
    { q: 'Will it click a payment button by mistake?', a: 'There is no per-click confirmation: when the agent calls page_click, the click happens. Steps that need a human go through page_handoff or a handoff node, which removes the overlay, leaves a message and locks again only for the next step. For payment, delete or publish pages, put them after a handoff, or let the agent read only.' },
    { q: 'How are logins preserved? What about moving machines?', a: 'One environment is one Electron persist partition. Sign in once; closing the window keeps it, and environments never see each other. Deleting the environment clears cookies. To move machines, export and import cookies with env_export and env_import; the file is plain text, keep it local.' },
    { q: 'What happens when a site changes?', a: 'Selectors break and BrowserPilot does not repair them. A failure carries the match count, the text and a screenshot; re-locate with page_query or page_snapshot and update the workflow node. The run record shows which step stopped.' },
    { q: 'Can it run on a server?', a: 'No. It is a desktop app and needs a graphical session; headless only hides the window, still the same Chromium. MCP listens on 127.0.0.1 and is not exposed. For remote execution, connect to that machine over remote desktop.' },
    { q: 'Where do data and screenshots live?', a: 'In the user data directory: %APPDATA%\\BrowserPilot on Windows, ~/Library/Application Support/BrowserPilot on macOS, ~/.config/BrowserPilot on Linux. Screenshots in screenshots, runs in runs.json, HAR in runs, exported CSV in exports, downloads in the download folder. There is no account and no cloud sync.' },
    { q: 'Which captchas are supported?', a: 'Geetest v4 sliders are automatic: cv, ddddocr and onnx with fallback, human-like drags and retries. Anything else is screenshotted for a vision agent through captcha_panel, with success depending on the puzzle and the model. Alphanumeric captchas work with ddddocr and local Python. Icon picking and board games have no detector; hand them to a human.' },
    { q: 'Can several accounts run at once?', a: 'Yes. One environment per account, each with its own window and logins. workflow_batch runs rows one at a time with up to 3 concurrent, and up to 3 headless windows by default, adjustable in settings.' },
    { q: 'Will sites detect it as a bot?', a: 'BrowserPilot removes the automation flags it would otherwise add: no --enable-automation, a Chrome user agent matching the bundled version, no Electron or HeadlessChrome string, and trusted CDP input by default. It is not an anti-detect browser and does not promise to bypass site risk controls; that judgement belongs to the site.' }
  ],
  final: {
    title: 'Install, connect your agent, <span>let it run once</span>',
    sub: 'Open the app once after installing and confirm MCP is on in Settings; then register the local endpoint with Claude Code, Kimi Code, Cursor or your own client.',
    download: 'Download the latest',
    docs: 'Getting started',
    footnote: 'Source is public; no LICENSE in the repository yet · unsigned installers · © 2026 BrowserPilot',
    footnote2: 'Recordings and screenshots come from real windows; the interface language can be switched in settings.'
  }
}
