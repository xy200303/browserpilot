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
  const payload = line ? JSON.parse(line.slice(6)) : null
  const inner = payload?.result?.content?.[0]?.text
  return inner ? JSON.parse(inner) : { raw: text.slice(0, 800) }
}

const box = await call('page_evaluate', {
  tabId,
  source: `(() => { const t = document.getElementById('target'); const r = t.getBoundingClientRect(); return JSON.stringify({top:r.top,left:r.left,width:r.width,height:r.height,transform:document.getElementById('track').style.transform}); })()`
})
const tree = await call('page_cdp', { tabId, method: 'Accessibility.getFullAXTree' })
const nodes = tree.value?.nodes ?? []
const button = nodes.find((item) => item.role?.value === 'button' && item.name?.value === '目标条目')
const quads = button ? await call('page_cdp', { tabId, method: 'DOM.getContentQuads', params: { backendNodeId: button.backendDOMNodeId } }) : null
const rect = JSON.parse(box.value)
const x = Math.round(rect.left + rect.width / 2)
const y = Math.round(rect.top + rect.height / 2)
const hit = await call('page_cdp', { tabId, method: 'DOM.getNodeForLocation', params: { x, y } })
const described = hit.value?.nodeId ? await call('page_cdp', { tabId, method: 'DOM.describeNode', params: { nodeId: hit.value.nodeId } }) : null
console.log(JSON.stringify({
  box: rect,
  button: button && { backendDOMNodeId: button.backendDOMNodeId, name: button.name },
  quads: quads?.value ?? quads?.error,
  hitAt: { x, y },
  hit: described?.value?.node ?? hit
}, null, 2).slice(0, 2500))
