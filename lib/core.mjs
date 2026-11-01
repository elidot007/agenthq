// AgentHQ core helpers: configuration, paths, the dsh-superagent management API, inbox notes, times and notifications.
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

/** The AgentHQ home: HQ_HOME, else the folder this checkout of AgentHQ lives in. */
export const HOME = process.env.HQ_HOME || fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
export const run = promisify(execFile)

export function loadConfig() {
  return JSON.parse(readFileSync(join(HOME, 'hq.config.json'), 'utf8'))
}
export function saveConfig(config) {
  writeAtomic(join(HOME, 'hq.config.json'), `${JSON.stringify(config, null, 2)}\n`)
}
export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, text)
  renameSync(temporary, file)
}
export const paths = {
  inbox: join(HOME, 'inbox'),
  routines: join(HOME, 'inbox', '_routines'),
  system: join(HOME, 'inbox', '_system'),
  spoolIn: join(HOME, 'spool', 'in'),
  spoolOut: join(HOME, 'spool', 'out'),
  wake: join(HOME, 'timers', 'wake'),
  work: join(HOME, 'work'),
  state: join(HOME, 'state'),
  logs: join(HOME, 'logs'),
  prepare: join(HOME, 'bin', 'hq-prepare'),
}
export const businessFolder = business => join(paths.inbox, business.folder || business.id)
export function instanceOf(config, id) {
  const instance = id ? config.instances.find(item => item.id === id) : config.instances[0]
  if (!instance) throw new Error(`No instance ${id ?? ''} in hq.config.json`)
  return instance
}

/** Calls the dsh-superagent management API of an instance; same-origin header as the panel sends it. */
export async function api(instance, method, path, body, timeoutMs = 20000) {
  const response = await fetch(`${instance.url}/orchestrator/api/${path}`, {
    method, headers: { 'x-orchestrator-request': '1', ...body === undefined ? {} : { 'content-type': 'application/json' } },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await response.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  if (!response.ok) {
    const detail = json.error ?? json.setup?.detail ?? text.slice(0, 400)
    throw Object.assign(new Error(`${method} ${path} → ${response.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`), { status: response.status, body: json })
  }
  return json
}
/** True when the instance answers; `configured` when setup has no problem. */
export async function reachable(instance) {
  try { const state = await api(instance, 'GET', 'state', undefined, 5000); return { up: true, configured: !state.setup?.problem, state } }
  catch (error) { return { up: false, configured: false, error: String(error.message ?? error) } }
}
export async function waitUntil(check, timeoutMs, everyMs = 2000) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > end) return undefined
    await new Promise(resolve => setTimeout(resolve, everyMs))
  }
}
/** The panel address with its login token, from the newest startup log of the instance's checkout. */
export function panelUrl(instance) {
  try {
    const dir = join(instance.checkout, '.artifacts')
    const logs = readdirSync(dir).filter(name => name.startsWith(`dsh-superagent-${instance.profile}-`) && name.endsWith('.log'))
      .map(name => ({ name, at: statSync(join(dir, name)).mtimeMs })).sort((a, b) => b.at - a.at)
    for (const { name } of logs) {
      const match = /dsh web: (http:\/\/\S+)/.exec(readFileSync(join(dir, name), 'utf8'))
      if (match) return match[1]
    }
  } catch { /* No startup log yet. */ }
  return instance.url
}

// ---------- times ----------
const pad = value => String(value).padStart(2, '0')
export const localStamp = at => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
export const compactStamp = at => `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`
/** `30m`, `2h`, `1d`, `90s` as milliseconds. */
export function duration(text) {
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i.exec(String(text).trim())
  if (!match) throw new Error(`"${text}" is not a duration such as 30m, 2h or 1d`)
  return Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase()]
}
/** An ISO time, `YYYY-MM-DD HH:mm` or `HH:mm` (the next such local time), or `tomorrow HH:mm`, as a Date. */
export function when(text, now = new Date()) {
  const value = String(text).trim()
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) { const at = new Date(value); if (!Number.isNaN(at.getTime())) return at }
  let match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(value)
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))
  match = /^(?:(tomorrow|明天)\s+)?(\d{1,2}):(\d{2})$/i.exec(value)
  if (match) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(match[2]), Number(match[3]))
    if (match[1]) at.setDate(at.getDate() + 1)
    else if (at <= now) at.setDate(at.getDate() + 1)
    return at
  }
  throw new Error(`"${text}" is not a time: use 2026-11-02 09:00, 09:00, tomorrow 09:00 or an ISO time`)
}

// ---------- notes ----------
const AGENT = /^>\s*\[!agent\]/i
/** Front matter, passages and agent callouts of a note, as the inbox Source reads them. */
export function parseNote(source) {
  let body = source.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  const head = {}
  const front = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(body)
  if (front) {
    for (const line of front[1].split('\n')) {
      const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
      if (field) head[field[1].toLowerCase()] = field[2].trim().replace(/^(['"])(.*)\1$/, '$2')
    }
    body = body.slice(front[0].length)
  }
  const blocks = []
  let person = [], agent
  const flushPerson = () => { const text = person.join('\n').trim(); person = []; if (/[\p{L}\p{N}]/u.test(text)) blocks.push({ kind: 'person', text }) }
  const flushAgent = () => { if (agent) { blocks.push({ kind: 'agent', title: agent[0].replace(/^>\s*\[!agent\]\s*/i, ''), text: agent.slice(1).map(line => line.replace(/^>\s?/, '')).join('\n').replace(/<!--\s*hq:[^>]*-->/, '').trim() }); agent = undefined } }
  for (const line of body.split('\n')) {
    if (agent) { if (line.startsWith('>')) { agent.push(line); continue } flushAgent() }
    if (AGENT.test(line)) { flushPerson(); agent = [line]; continue }
    person.push(line)
  }
  flushAgent(); flushPerson()
  return { head, blocks }
}
export const isDone = head => /^(true|yes|1)$/i.test(head.done ?? '') || /^(done|closed|完成|已完成)$/i.test(head.status ?? '')
/** Where a note stands: waiting for the agent, answered (its last block is the agent's), or done. */
export function noteStatus(note) {
  if (isDone(note.head)) return 'done'
  if (/^(true|yes|1)$/i.test(note.head.draft ?? '')) return 'draft'
  const last = note.blocks.at(-1)
  if (!last) return 'empty'
  // The agent's turn is due while a person's passage is the newest block; whether an answer waits for a person, the tickets say.
  return last.kind === 'person' ? 'waiting' : 'answered'
}
const safeName = text => text.replace(/[\\/:*?"<>|#^[\]\n\r\t]+/g, ' ').trim().replace(/\s+/g, '-').slice(0, 48) || 'request'
/** A request's name when none is given: the first sentence of its first line, cut to a length a list shows whole. */
export function titleOf(text) {
  const first = String(text).split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').trim() ?? ''
  const sentence = first.split(/(?<=[。？！?!；;])/)[0] ?? first
  return (sentence.length > 32 ? `${sentence.slice(0, 31)}…` : sentence).replace(/[。；;]$/, '') || 'request'
}
/** Writes a new request note into a business folder and returns its path. A `schedule` id marks a schedule's manual run. */
export function createNote(config, businessId, { title, text, type, repo, review, schedule }) {
  const business = config.businesses.find(item => item.id === businessId)
  if (!business) throw new Error(`No business ${businessId}; known: ${config.businesses.map(item => item.id).join(', ')}`)
  const folder = businessFolder(business)
  mkdirSync(folder, { recursive: true })
  const heading = title || titleOf(text)
  let file = join(folder, `${compactStamp(new Date())}-${safeName(heading)}.md`)
  for (let n = 2; existsSync(file); n++) file = file.replace(/(-\d+)?\.md$/, `-${n}.md`)
  const head = [['title', heading], ['type', type], ['repo', repo], ['review', review], ['schedule', schedule]].filter(([, value]) => value)
  const front = head.length ? `---\n${head.map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n` : ''
  // Written whole, then renamed, so the inbox never reads a half-written note.
  writeAtomic(file, `${front}${title ? `# ${title}\n\n` : ''}${text.trim()}\n`)
  return file
}
/** Appends a passage a person writes to a note, after a blank line so it starts outside the last callout. */
export function appendPassage(file, text) {
  // A person writing again opens the request again: a done mark would file its next delivery as accepted, unseen.
  reopenNote(file)
  const current = readFileSync(file, 'utf8')
  appendFileSync(file, `${current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n'}${text.trim()}\n`)
}
/** Takes a note's done mark out of its front matter, dropping a front matter left empty; true when there was one. */
export function reopenNote(file) {
  const current = readFileSync(file, 'utf8')
  const front = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(current)
  if (!front) return false
  const lines = front[1].split('\n')
  const kept = lines.filter(line => !/^(status:\s*(done|closed|完成|已完成)|done:\s*(true|yes|1))\s*$/i.test(line))
  if (kept.length === lines.length) return false
  writeAtomic(file, `${kept.some(line => line.trim()) ? `---\n${kept.join('\n')}\n---\n` : ''}${current.slice(front[0].length)}`)
  return true
}
/** Marks a note done in its front matter. */
export function markDone(file) {
  const current = readFileSync(file, 'utf8')
  const front = /^---\n([\s\S]*?)\n---[ \t]*\n/.exec(current)
  const next = front
    ? /^status:/m.test(front[1]) ? current.replace(/^status:.*$/m, 'status: done') : current.replace(/^---\n/, '---\nstatus: done\n')
    : `---\nstatus: done\n---\n${current}`
  writeAtomic(file, next)
}
/** Every note of every business with its status and last agent message, newest first. */
export function listNotes(config, { days, business } = {}) {
  const since = days ? Date.now() - days * 86_400_000 : 0
  const notes = []
  for (const item of config.businesses) {
    if (business && item.id !== business) continue
    const folder = businessFolder(item)
    if (!existsSync(folder)) continue
    const walk = dir => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
        const file = join(dir, entry.name)
        if (entry.isDirectory()) { walk(file); continue }
        if (!entry.name.endsWith('.md')) continue
        const changed = statSync(file).mtimeMs
        if (changed < since) continue
        const note = parseNote(readFileSync(file, 'utf8'))
        const lastAgent = [...note.blocks].reverse().find(block => block.kind === 'agent')
        notes.push({ business: item.id, file, path: relative(folder, file), title: note.head.title || basename(file, '.md'), status: noteStatus(note),
          changed: new Date(changed).toISOString(), passages: note.blocks.filter(block => block.kind === 'person').length,
          lastAgent: lastAgent ? { title: lastAgent.title, text: lastAgent.text.slice(0, 600) } : null })
      }
    }
    walk(folder)
  }
  return notes.sort((a, b) => b.changed.localeCompare(a.changed))
}

// ---------- notifications ----------
/** Records a system notice for the hub and the operator's notification center; equal notices within `quietHours` are sent once. */
export async function notify(title, text, { key, quietHours = 6 } = {}) {
  const ledger = join(paths.state, 'notices.json')
  let sent = {}
  try { sent = JSON.parse(readFileSync(ledger, 'utf8')) } catch { /* First notice. */ }
  const id = key ?? `${title}|${text}`
  if (sent[id] && Date.now() - sent[id] < quietHours * 3_600_000) return false
  sent[id] = Date.now()
  writeAtomic(ledger, JSON.stringify(Object.fromEntries(Object.entries(sent).filter(([, at]) => Date.now() - at < 7 * 86_400_000))))
  mkdirSync(paths.system, { recursive: true })
  appendFileSync(join(paths.system, '通知.md'), `\n## ${localStamp(new Date())} ${title}\n\n${text}\n`)
  // A desktop notification where the system has one; the notice file above is the record either way.
  if (process.platform === 'darwin') await run('osascript', ['-e', `display notification ${JSON.stringify(text.slice(0, 180))} with title ${JSON.stringify(`AgentHQ · ${title}`)}`]).catch(() => {})
  else await run('notify-send', [`AgentHQ · ${title}`, text.slice(0, 180)]).catch(() => {})
  return true
}
export function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}
