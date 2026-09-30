import { readFileSync } from 'fs'

const ep = JSON.parse(readFileSync(process.env.APPDATA + '/BrowserPilot/mcp.json', 'utf8'))
const tabId = process.argv[2]

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

await call('page_evaluate', { tabId, source: 'window.__clicks = []; document.getElementById("target").dataset.hit = ""' })
const box = JSON.parse((await call('page_evaluate', {
  tabId,
  source: '(() => { const r = document.getElementById("target").getBoundingClientRect(); return JSON.stringify({x: Math.round((r.left + r.width / 2) / devicePixelRatio), y: Math.round((r.top + r.height / 2) / devicePixelRatio)}); })()'
})).value)
for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
  await call('page_cdp', {
    tabId,
    method: 'Input.dispatchMouseEvent',
    params: { type, x: box.x, y: box.y, button: 'left', clickCount: 1 }
  })
}
const check = await call('page_evaluate', {
  tabId,
  source: 'JSON.stringify({hit:document.getElementById("target").dataset.hit||"", clicks:window.__clicks, box:' + JSON.stringify(box) + '})'
})
console.log(check.value || check.error)
