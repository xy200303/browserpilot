import { readFileSync } from 'fs'

const ep = JSON.parse(readFileSync(process.env.APPDATA + '/BrowserPilot/mcp.json', 'utf8'))
const page = 'file:///C:/Users/34834/AppData/Local/Temp/bp-form.html'

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
  const payload = line ? JSON.parse(line.slice(6)) : null
  const inner = payload?.result?.content?.[0]?.text
  return inner ? JSON.parse(inner) : { raw: text.slice(0, 800) }
}

function refOf(snapshot, role, name) {
  const pattern = new RegExp(`${role} "${name}"(?: value="[^"]*")? \\[ref=(e\\d+)\\]`)
  return snapshot.match(pattern)?.[1]
}

const opened = await call('tab_open', { url: page })
const tabId = opened.tabId
const swipe = await call('page_swipe', { tabId, direction: 'up', untilRole: 'button', untilName: '目标条目' })
const mid = await call('page_evaluate', { tabId, source: 'JSON.stringify({cap:window.__cap, transform:document.getElementById("track").style.transform})' })
const tree = await call('page_snapshot', { tabId })
const ref = refOf(tree.snapshot, 'button', '目标条目')
const click = await call('page_click', { tabId, ref })
const check = await call('page_evaluate', {
  tabId,
  source: `(() => { const t = document.getElementById('target'); const r = t.getBoundingClientRect(); return JSON.stringify({hit:t.dataset.hit||'', clicks:window.__clicks, top:Math.round(r.top), left:Math.round(r.left), width:Math.round(r.width), height:Math.round(r.height)}); })()`
})
console.log(JSON.stringify({ tabId, swipe: swipe.error || 'ok', mid: mid.value, ref, click: click.error || 'ok', check: check.value || check.error }, null, 2))
