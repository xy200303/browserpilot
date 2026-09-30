import { readFileSync } from 'fs'

const ep = JSON.parse(readFileSync(process.env.APPDATA + '/BrowserPilot/mcp.json', 'utf8'))
const page = 'file:///C:/Users/34834/AppData/Local/Temp/bp-form.html?v=4'

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
  return inner ? JSON.parse(inner) : { raw: text.slice(0, 400) }
}

const opened = await call('tab_open', { url: page })
const tabId = opened.tabId
const tree = await call('page_snapshot', { tabId })
const feed = tree.snapshot.match(/region "动态" \[ref=(e\d+)\]/)?.[1]
const swipe = await call('page_swipe', { tabId, ref: feed, direction: 'up', untilRole: 'button', untilName: '目标条目' })
const after = (await call('page_evaluate', {
  tabId,
  source: `(() => { const t = document.getElementById('target'); const f = document.getElementById('feed'); const tr = t.getBoundingClientRect(); const fr = f.getBoundingClientRect(); return JSON.stringify({ scrollTop: f.scrollTop, top: tr.top, feedTop: fr.top, feedBottom: fr.bottom, inside: tr.top >= fr.top && tr.bottom <= fr.bottom, downs: window.__downs || [] }); })()`
})).value
console.log(JSON.stringify({ feed, swipe: swipe.error || 'ok', after }, null, 2))
