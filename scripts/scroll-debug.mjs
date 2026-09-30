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
  return inner ? JSON.parse(inner) : { raw: text.slice(0, 500) }
}

await call('page_evaluate', {
  source: `window.__clicks = []; window.addEventListener('click', (event) => { window.__clicks.push({ x: Math.round(event.clientX), y: Math.round(event.clientY), id: event.target.id || event.target.tagName }) }, true); document.getElementById('target').dataset.hit = ''`
})
const tree = await call('page_snapshot', {})
const ref = tree.snapshot.match(/button "目标条目" \[ref=(e\d+)\]/)?.[1]
const before = await call('page_evaluate', {
  source: `(() => { const r = document.getElementById('target').getBoundingClientRect(); return JSON.stringify({ref:'${ref}', x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), top:Math.round(r.top), dpr:devicePixelRatio}); })()`
})
await call('page_click', { ref })
const after = await call('page_evaluate', { source: 'JSON.stringify({hit:document.getElementById("target").dataset.hit||"", clicks:window.__clicks, stack:document.elementsFromPoint(35,288).slice(0,4).map(el=>el.id||el.tagName)})' })
console.log(before.value)
console.log(after.value || after.error)
