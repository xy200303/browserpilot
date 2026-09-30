import { readFileSync } from 'fs'

const ep = JSON.parse(readFileSync(process.env.APPDATA + '/BrowserPilot/mcp.json', 'utf8'))
const tabId = process.argv[2] || 'tab-a484748dc3e7'

const res = await fetch(ep.url, {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + ep.token,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'page_evaluate',
      arguments: {
        tabId,
        source: `(() => {
          const points = [[23, 166], [35, 249], [35, 166], [23, 249]]
          const stacks = {}
          for (const [x, y] of points) stacks[x + ',' + y] = document.elementsFromPoint(x, y).slice(0, 4).map((el) => el.id || el.tagName)
          const t = document.getElementById('target').getBoundingClientRect()
          return JSON.stringify({ stacks, top: t.top, bottom: t.bottom, dpr: devicePixelRatio })
        })()`
      }
    }
  })
})
const text = await res.text()
const line = text.split('\n').find((item) => item.startsWith('data: '))
const payload = JSON.parse(line.slice(6))
console.log(payload.result.content[0].text)
