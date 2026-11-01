// The AgentHQ dashboard server: static pages from lib/hub/ and a small loopback API over requests, schedules and the system.
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { appendPassage, createNote, instanceOf, loadConfig, markDone, paths, reopenNote, titleOf } from './core.mjs'
import { fileView, imageType, removeSchedule, reveal, saveAttachment, saveSchedule, scheduleId, setPaused, setScheduleState, ticketAction, viewable } from './manage.mjs'
import { describeCron, requestDetail, requests, scheduleRuns } from './requests.mjs'
import { summary } from './summary.mjs'

const STATIC = fileURLToPath(new URL('./hub/', import.meta.url))
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' }
const inbox = file => typeof file === 'string' && viewable(file) && file.startsWith(`${paths.inbox}/`) && file.endsWith('.md')
/** The latest system notices, newest first, from inbox/_system/通知.md. */
function notices() {
  const file = join(paths.system, '通知.md')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split(/\n(?=## )/).filter(part => part.startsWith('## ')).slice(-6).reverse()
    .map(part => { const [head, ...rest] = part.split('\n'); return { title: head.slice(3).trim(), text: rest.join(' ').trim() } })
}
let homeCache = { at: 0, value: undefined }
async function home() {
  if (homeCache.value && Date.now() - homeCache.at < 2500) return homeCache.value
  const config = loadConfig()
  const instance = instanceOf(config)
  const [items, system] = await Promise.all([requests(config, instance), summary(config)])
  const schedules = scheduleRuns(config, items)
  const counts = { you: 0, review: 0, active: 0, done: 0 }
  for (const item of items) counts[item.bucket] += 1
  const main = system.instances[0]
  const value = { at: new Date().toISOString(), items, counts,
    businesses: config.businesses.map(({ id, title, type, repo }) => ({ id, title, type, repo })),
    schedules, owner: config.owner,
    system: { ok: system.instances.every(item => item.up && !item.setup && !item.problems.length), instances: system.instances.map(item => ({ id: item.id, title: item.title, up: item.up,
      setup: item.setup, paused: item.paused, load: item.load, problems: item.problems, panel: item.panel, error: item.error })), paused: !!main?.paused,
      models: system.models.lastHour, relay: system.models.relay, dsbot: system.dsbot, watchdog: system.watchdog, notices: notices() } }
  homeCache = { at: Date.now(), value }
  return value
}
const forget = () => { homeCache.at = 0 }
const deadlineText = value => {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  return `\n\n截止：${at.toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })} 之前。`
}
export async function serveHub(config) {
  const port = config.hub?.port ?? 3090
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  const server = createServer(async (request, response) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" })
      response.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
    }
    try {
      // Only this machine's browser, addressing the hub by its loopback name, may read or change anything.
      if (!hosts.has(request.headers.host ?? '')) return send(403, { error: 'loopback only' })
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
        if (!/^[a-z0-9-]+\.(html|css|js|svg)$/.test(name) || !existsSync(join(STATIC, name))) return send(404, 'not found', 'text/plain')
        return send(200, readFileSync(join(STATIC, name)), TYPES[extname(name)])
      }
      if (request.method === 'GET') {
        if (url.pathname === '/api/home') return send(200, await home())
        if (url.pathname === '/api/request') {
          const config = loadConfig(), file = url.searchParams.get('file'), ticket = url.searchParams.get('ticket')
          if (file && !inbox(file)) return send(400, { error: 'not an inbox note' })
          return send(200, await requestDetail(config, instanceOf(config), { file, ticket }))
        }
        if (url.pathname === '/api/file') return send(200, fileView(url.searchParams.get('path') ?? ''))
        if (url.pathname === '/api/raw') {
          const path = url.searchParams.get('path') ?? ''
          if (!viewable(path) || !imageType(path)) return send(400, { error: 'not an image here' })
          response.writeHead(200, { 'content-type': imageType(path), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
          return createReadStream(path).pipe(response)
        }
        return send(404, { error: 'not found' })
      }
      if (request.method !== 'POST') return send(405, { error: 'method' })
      if (request.headers['x-hq-request'] !== '1' || (request.headers.origin && !hosts.has(new URL(request.headers.origin).host))) return send(403, { error: 'same-origin requests only' })
      const chunks = []
      let size = 0
      for await (const chunk of request) { size += chunk.length; if (size > 60_000_000) return send(413, { error: '文件太大（上限 60 MB）' }); chunks.push(chunk) }
      const raw = Buffer.concat(chunks)
      forget()
      const config = loadConfig()
      if (url.pathname === '/api/upload') {
        const name = decodeURIComponent(String(request.headers['x-file-name'] ?? 'file'))
        return send(200, { path: saveAttachment(config, url.searchParams.get('business') ?? 'general', name, raw), name })
      }
      const body = raw.length ? JSON.parse(raw.toString('utf8')) : {}
      switch (url.pathname) {
        case '/api/ask': {
          const text = String(body.text ?? '').trim()
          if (!text) return send(400, { error: '先写下要做的事' })
          if (!config.businesses.some(item => item.id === body.business)) return send(400, { error: '选一个业务' })
          const attachments = (Array.isArray(body.attachments) ? body.attachments : []).filter(path => viewable(path))
          const full = `${text}${attachments.length ? `\n\n附件：\n${attachments.map(path => `- ${path}`).join('\n')}` : ''}${deadlineText(body.deadline)}`
          if (body.repeat && body.repeat.cron) {
            const schedule = await saveSchedule(config, { id: body.repeat.id || scheduleId(config, body.title || text), cron: body.repeat.cron, business: body.business,
              type: body.type || 'routine', text: full, state: 'on' })
            return send(200, { schedule: { ...schedule, when: describeCron(schedule.cron) } })
          }
          return send(200, { file: createNote(config, body.business, { title: body.title || undefined, text: full, type: body.type || undefined, repo: body.repo || undefined }) })
        }
        case '/api/reply':
          if (!inbox(body.file) || !String(body.text ?? '').trim()) return send(400, { error: 'bad reply' })
          appendPassage(body.file, String(body.text)); return send(200, { ok: true })
        case '/api/done':
          if (!inbox(body.file)) return send(400, { error: 'not an inbox note' })
          markDone(body.file); return send(200, { ok: true })
        case '/api/reopen':
          if (!inbox(body.file)) return send(400, { error: 'not an inbox note' })
          reopenNote(body.file); return send(200, { ok: true })
        case '/api/ticket': return send(200, await ticketAction(config, body.id, body.action))
        case '/api/reveal': await reveal(String(body.path ?? ''), !!body.open); return send(200, { ok: true })
        case '/api/pause': return send(200, await setPaused(config, body.paused))
        case '/api/schedule': return send(200, await saveSchedule(config, body))
        case '/api/schedule/state': return send(200, await setScheduleState(config, body.id, body.state))
        case '/api/schedule/remove': await removeSchedule(config, body.id); return send(200, { ok: true })
        case '/api/schedule/run': {
          const schedule = config.schedules.find(item => item.id === body.id)
          if (!schedule) return send(404, { error: '没有这个定时任务' })
          // A run by hand is an ordinary request, followed and accepted like one; the schedule's card shows it as its latest run.
          return send(200, { file: createNote(config, schedule.business || 'general', { title: `${titleOf(schedule.text)} · 手动运行`, text: schedule.text, type: schedule.type, schedule: schedule.id }) })
        }
        default: return send(404, { error: 'not found' })
      }
    } catch (error) { send(500, { error: String(error.message ?? error) }) }
  })
  await new Promise(done => server.listen(port, '127.0.0.1', done))
  console.log(`AgentHQ hub: http://127.0.0.1:${port}/`)
}
