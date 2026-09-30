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
  return inner ? JSON.parse(inner) : { raw: text.slice(0, 300) }
}

const hits = []
for (let y = 430; y <= 650; y += 15) {
  await call('page_evaluate', { tabId, source: 'window.__clicks = []; document.getElementById("target").dataset.hit = ""' })
  await call('page_cdp', { tabId, method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 35, y, button: 'left', clickCount: 1 } })
  await call('page_cdp', { tabId, method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: 35, y, button: 'left', clickCount: 1 } })
  const value = (await call('page_evaluate', { tabId, source: 'JSON.stringify({hit:document.getElementById("target").dataset.hit||"", id:(window.__clicks[0]&&window.__clicks[0].id)||"", path:(window.__clicks[0]&&window.__clicks[0].path)||[]})' })).value
  hits.push({ y, ...JSON.parse(value) })
}
console.log(hits.filter((item) => item.hit === '1' || item.id === 'target' || (item.path || []).includes('target') || (item.path || []).includes('track')).map((item) => JSON.stringify(item)).join('\n') || 'none on target/track')
console.log('sample', hits.filter((_, index) => index % 2 === 0).map((item) => `${item.y}:${item.id || item.path?.[0] || '-'}`).join(' '))
