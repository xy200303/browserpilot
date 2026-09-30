import { readFileSync, writeFileSync } from 'fs'

const ep = JSON.parse(readFileSync(process.env.APPDATA + '/BrowserPilot/mcp.json', 'utf8'))
const page = 'file:///C:/Users/34834/AppData/Local/Temp/bp-form.html'
writeFileSync('C:/Users/34834/AppData/Local/Temp/bp-cover.txt', 'cover')

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
  const data = inner ? JSON.parse(inner) : { raw: text.slice(0, 400) }
  console.log('\n==', name, data.ok === false ? data.error : 'ok')
  return data
}

function refOf(snapshot, role, name) {
  const pattern = new RegExp(`${role} "${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"(?: value="[^"]*")? \\[ref=(e\\d+)\\]`)
  return snapshot.match(pattern)?.[1]
}

const opened = await call('tab_open', { url: page })
const tabId = opened.tabId
await call('recording_begin', { tabId })
let tree = await call('page_snapshot', { tabId })
const title = refOf(tree.snapshot, 'textbox', '标题')
const body = refOf(tree.snapshot, 'textbox', '正文')
const cover = refOf(tree.snapshot, 'textbox', '封面') || refOf(tree.snapshot, 'button', '封面')
const cat = refOf(tree.snapshot, 'button', '分类')
console.log({ title, body, cover, cat, snapshot: tree.snapshot })
await call('page_type', { tabId, ref: title, text: '旧标题' })
await call('page_paste', { tabId, ref: body, text: '旧正文' })
if (cover) await call('page_upload', { tabId, ref: cover, paths: ['C:\\Users\\34834\\AppData\\Local\\Temp\\bp-cover.txt'] })
else await call('page_upload', { tabId, paths: ['C:\\Users\\34834\\AppData\\Local\\Temp\\bp-cover.txt'] })
await call('page_select', { tabId, ref: cat, option: '科技' })
const seen = await call('page_snapshot', { tabId })
const feed = refOf(seen.snapshot, 'region', '动态')
const target = refOf(seen.snapshot, 'button', '目标条目')
console.log('target ref', target, 'feed', feed)
await call('page_swipe', { tabId, ref: feed, direction: 'up', untilRole: 'button', untilName: '目标条目' })
tree = await call('page_snapshot', { tabId })
const openRef = refOf(tree.snapshot, 'button', '目标条目')
if (openRef) await call('page_click', { tabId, ref: openRef })
const saved = await call('recording_save', {
  tabId,
  name: '发文章试跑',
  params: [
    { name: '标题', fromStep: 1 },
    { name: '正文', fromStep: 2 },
    { name: '封面', fromStep: 3 }
  ]
})
console.log('saved', saved.recording, saved.error)
await call('page_navigate', { tabId, url: page })
const run = await call('recording_run', {
  recording: saved.recording,
  tabId,
  params: { 标题: '九月更新', 正文: '这是正文', 封面: 'C:\\Users\\34834\\AppData\\Local\\Temp\\bp-cover.txt' }
})
console.log(JSON.stringify(run, null, 2).slice(0, 1200))
const check = await call('page_evaluate', {
  tabId,
  source: `(() => { const t = document.getElementById('target'); const f = document.getElementById('feed'); const tr = t.getBoundingClientRect(); const fr = f.getBoundingClientRect(); return JSON.stringify({title:document.getElementById('title').value,body:document.getElementById('body').value,file:document.getElementById('fileName').textContent,picked:document.getElementById('picked').textContent,hit:t.dataset.hit||'',top:Math.round(tr.top),feedTop:Math.round(fr.top),feedBottom:Math.round(fr.bottom)}); })()`
})
console.log('check', check.value || check.error)
