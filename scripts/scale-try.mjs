import { readFileSync } from 'fs'

const ep = JSON.parse(readFileSync(process.env.APPDATA + '/BrowserPilot/mcp.json', 'utf8'))

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
  return inner ? JSON.parse(inner) : { raw: text.slice(0, 400) }
}

await call('page_evaluate', { source: `document.getElementById('feed').style.overflow = 'visible'; document.getElementById('target').dataset.hit = ''; window.__clicks = []` })
const tree = await call('page_snapshot', {})
const ref = tree.snapshot.match(/button "目标条目" \[ref=(e\d+)\]/)?.[1]
await call('page_click', { ref })
const after = await call('page_evaluate', { source: 'JSON.stringify({hit:document.getElementById("target").dataset.hit||"", click:window.__clicks[0]||null})' })
console.log('ref', ref)
console.log(after.value || after.error)
