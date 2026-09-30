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
  return inner ? JSON.parse(inner) : { raw: text.slice(0, 200) }
}

const points = []
for (let x = 0; x <= 120; x += 15) points.push([x, 249])
for (let y = 200; y <= 280; y += 10) points.push([35, y])
points.push([633, 58], [35, 58], [10, 240], [50, 250])

const lines = []
for (const [x, y] of points) {
  await call('page_evaluate', { tabId, source: 'window.__clicks = []' })
  await call('page_cdp', { tabId, method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x, y, button: 'left', clickCount: 1 } })
  await call('page_cdp', { tabId, method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 } })
  const value = JSON.parse((await call('page_evaluate', { tabId, source: 'JSON.stringify(window.__clicks[0]||{})' })).value)
  lines.push(`${x},${y} -> ${value.id || value.tag || '-'} ${(value.path || []).join('/')}`)
}
console.log(lines.join('\n'))
