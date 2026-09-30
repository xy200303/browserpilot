import { readFileSync } from 'fs'

const ep = JSON.parse(readFileSync(process.env.APPDATA + '/BrowserPilot/mcp.json', 'utf8'))
const tabId = 'tab-7bc7eb41d296'

async function call(name, args) {
  const res = await fetch(ep.url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + ep.token,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  })
  const text = await res.text()
  const line = text.split('\n').find((item) => item.startsWith('data: '))
  const payload = JSON.parse(line.slice(6))
  const inner = payload?.result?.content?.[0]?.text
  return inner ? JSON.parse(inner) : { raw: text.slice(0, 800) }
}

const metrics = await call('page_evaluate', {
  tabId,
  source: 'JSON.stringify({dpr:devicePixelRatio, innerWidth, innerHeight, screenX:screenX, screenY:screenY})'
})
const layout = await call('page_cdp', { tabId, method: 'Page.getLayoutMetrics' })
console.log(metrics.value || metrics.error)
console.log(JSON.stringify(layout.value, null, 2).slice(0, 1500))
