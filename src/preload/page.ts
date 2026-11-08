import { ipcRenderer } from 'electron'

// 性能条目默认只留 250 条，视频站很快被图片冲掉，拉大缓冲方便后面找流地址
try {
  performance.setResourceTimingBufferSize(5000)
} catch {
  /* 老内核没有这个方法 */
}

// 页面右键信号（捕获阶段，页面 preventDefault 也拦不到这里）
window.addEventListener('contextmenu', (event) => {
  ipcRenderer.send('page:contextmenu', { x: event.clientX, y: event.clientY })
}, true)

const USER_FIELD = 'input[autocomplete=username],input[type=email],input[type=text],input[type=tel],input[name*=user i],input[name*=email i],input[name*=account i],input[name*=login i],input[name*=phone i]'

function visible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
}

function usernameFor(password: HTMLInputElement): HTMLInputElement | undefined {
  const scope: ParentNode = password.closest('form') ?? document
  const inputs = [...scope.querySelectorAll<HTMLInputElement>(USER_FIELD)].filter(visible)
  const before = inputs.filter((input) => input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING)
  return before[before.length - 1] ?? inputs[0]
}

function setValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
  if (descriptor?.set) descriptor.set.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

let filled = false

async function autofill(): Promise<void> {
  if (filled || !/^https?:$/.test(location.protocol)) return
  const credential = (await ipcRenderer.invoke('page:autofill', location.origin).catch(() => null)) as
    | { username: string; password: string }
    | null
  if (!credential?.password) return
  const password = [...document.querySelectorAll<HTMLInputElement>('input[type=password]')].find((input) => !input.value && visible(input))
  if (!password) return
  filled = true
  const username = usernameFor(password)
  if (username && !username.value && credential.username) setValue(username, credential.username)
  setValue(password, credential.password)
  ipcRenderer.send('page:autofilled', location.origin)
}

function capture(scope: ParentNode | null): void {
  if (!/^https?:$/.test(location.protocol)) return
  const password = [...(scope ?? document).querySelectorAll<HTMLInputElement>('input[type=password]')].find(
    (input) => input.value && visible(input)
  )
  if (!password) return
  const username = usernameFor(password)
  ipcRenderer.send('page:credentials', {
    origin: location.origin,
    username: username?.value ?? '',
    password: password.value
  })
}

let lastSubmit = 0

document.addEventListener('submit', (event) => {
  lastSubmit = Date.now()
  capture((event.target as HTMLElement).closest('form'))
}, true)

// 单页应用的登录按钮不一定触发表单 submit，按按钮文字补一次
document.addEventListener('click', (event) => {
  if (Date.now() - lastSubmit < 1000) return
  const target = event.target as HTMLElement | null
  const button = target?.closest('button, input[type=submit], [role=button]') as HTMLElement | null
  if (!button) return
  const label = (button.textContent || (button as HTMLInputElement).value || button.getAttribute('aria-label') || '').trim()
  if (!/登录|登入|登陆|提交|sign ?in|log ?in|submit/i.test(label)) return // i18n-ignore 页面文案特征
  capture(button.closest('form'))
}, true)

if (window.top === window) {
  const start = (): void => {
    void autofill()
    setTimeout(() => void autofill(), 1200)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
}
