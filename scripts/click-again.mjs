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
  return inner ? JSON.parse(inner) : { raw: text.slice(0, 500) }
}

const tree = await call('page_snapshot', { tabId })
const ref = tree.snapshot.match(/button "目标条目"(?: value="[^"]*")? \[ref=(e\d+)\]/)?.[1]
await call('page_evaluate', { tabId, source: 'window.__clicks = []; document.getElementById("target").dataset.hit = ""' })
const click = await call('page_click', { tabId, ref })
const check = await call('page_evaluate', {
  tabId,
  source: `JSON.stringify({hit:document.getElementById('target').dataset.hit||'', clicks:window.__clicks})`
})
console.log(JSON.stringify({ ref, click: click.error || 'ok', check: check.value }, null, 2))
