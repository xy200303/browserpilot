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
  const payload = line ? JSON.parse(line.slice(6)) : null
  const inner = payload?.result?.content?.[0]?.text
  return inner ? JSON.parse(inner) : { raw: text.slice(0, 400) }
}

const started = await call('screen_start', {})
if (started.ok === false) {
  console.log(JSON.stringify({ start: started.error }))
  process.exit(1)
}
await new Promise((resolve) => setTimeout(resolve, 1500))
const stopped = await call('screen_stop', {})
if (stopped.ok === false) {
  console.log(JSON.stringify({ stop: stopped.error }))
  process.exit(1)
}
const data = readFileSync(stopped.path)
const head = data.subarray(4, 8).toString('ascii')
console.log(JSON.stringify({ path: stopped.path, bytes: data.length, box: head }))
