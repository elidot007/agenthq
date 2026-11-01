// Requests as the operator sees them: each inbox note joined with its ticket, a status in plain words, and the details a
// request page shows (conversation, progress, deliverables, wakes, background jobs, code changes).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { api, businessFolder, isDone, parseNote, paths, run } from './core.mjs'

export const TYPE_LABEL = { research: '调研', code: '写代码', content: '写内容', ops: '运维排查', general: '通用', routine: '例行' }
/** Every status a request can be in, with the bucket the dashboard files it under. */
export const STATUS = {
  answer: { label: '等你回答', short: '待答', tone: 'seal', bucket: 'you' },
  blocked: { label: '受阻，需要你', short: '受阻', tone: 'seal', bucket: 'you' },
  failed: { label: '失败了', short: '失败', tone: 'seal', bucket: 'you' },
  delivery: { label: '消息没送到', short: '未达', tone: 'seal', bucket: 'you' },
  unrouted: { label: '没有接单', short: '未接', tone: 'seal', bucket: 'you' },
  review: { label: '等你验收', short: '待验', tone: 'amber', bucket: 'review' },
  delivered: { label: '已交付，待验收', short: '待验', tone: 'amber', bucket: 'review' },
  completed: { label: '已完成', short: '完成', tone: 'jade', bucket: 'done' },
  submitted: { label: '已提交，等待接单', short: '提交', tone: 'slate', bucket: 'active' },
  followup: { label: '已补充，等待处理', short: '补充', tone: 'slate', bucket: 'active' },
  queued: { label: '排队中', short: '排队', tone: 'slate', bucket: 'active' },
  working: { label: '处理中', short: '处理', tone: 'indigo', bucket: 'active' },
  waiting: { label: '等待中', short: '等待', tone: 'slate', bucket: 'active' },
  draft: { label: '草稿', short: '草稿', tone: 'mute', bucket: 'active' },
  accepted: { label: '已验收', short: '完成', tone: 'jade', bucket: 'done' },
  dropped: { label: '无需处理', short: '略过', tone: 'mute', bucket: 'done' },
  stopped: { label: '已停止', short: '停止', tone: 'mute', bucket: 'done' },
}
const OUTCOME = { completed: 'delivered', merged: 'delivered', closed: 'stopped', dropped: 'dropped', stopped: 'stopped' }
const SOURCE_LABEL = { inbox: '收件箱', timer: '定时', spool: '投递', github: 'GitHub', feishu: '飞书' }

/** Plain text of Markdown for one-line previews. */
export const plain = (text, max = 160) => String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[#>\-*\d.\s]+/gm, '').replace(/\s+/g, ' ').trim().slice(0, max)
/** A time as 今天 / 明天 / 昨天 or a date, with its clock, for people. */
export function dayClock(iso) {
  const at = new Date(iso), start = new Date(); start.setHours(0, 0, 0, 0)
  const day = new Date(at); day.setHours(0, 0, 0, 0)
  const days = Math.round((day - start) / 86_400_000)
  const word = days === 0 ? '今天' : days === 1 ? '明天' : days === -1 ? '昨天' : `${at.getMonth() + 1}月${at.getDate()}日`
  return `${word} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}
/** The sections of a STATE.md, by heading. */
export function stateSections(dir) {
  const file = [join(dir ?? '', 'STATE.md'), join(dir ?? '', '.hq', 'STATE.md')].find(path => dir && existsSync(path))
  if (!file) return null
  const sections = {}
  let current
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) { current = heading[1]; sections[current] = []; continue }
    if (current && line.trim()) sections[current].push(line.replace(/^\s*[-*]\s+/, '').trim())
  }
  return { file, sections }
}
/** Pending wake requests by ticket id, earliest first. */
export function pendingWakes() {
  const wakes = {}
  if (!existsSync(paths.wake)) return wakes
  for (const name of readdirSync(paths.wake).filter(item => item.endsWith('.json') && !item.startsWith('.'))) {
    try {
      const request = JSON.parse(readFileSync(join(paths.wake, name), 'utf8'))
      ;(wakes[request.ticket] ??= []).push(request)
    } catch { /* A request the Timer Source sets aside. */ }
  }
  for (const list of Object.values(wakes)) list.sort((a, b) => String(a.at ?? a.deadline ?? '').localeCompare(String(b.at ?? b.deadline ?? '')))
  return wakes
}
/**
 * When a request note was created: its birth time while that agrees with its `YYYYMMDD-HHMM-` name, else the name, which
 * survives copies. The birth time also settles the hour a clock change repeats, which the name cannot tell apart.
 */
function createdOf(file, info) {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-/.exec(basename(file))
  const born = info.birthtimeMs || info.mtimeMs
  if (!match) return new Date(born).toISOString()
  const named = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])).getTime()
  return new Date(Math.abs(born - named) <= 2 * 3_600_000 ? born : named).toISOString()
}
function notesOf(config, sinceDays = 45) {
  const since = Date.now() - sinceDays * 86_400_000
  const notes = []
  for (const business of config.businesses) {
    const folder = businessFolder(business)
    if (!existsSync(folder)) continue
    const walk = dir => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
        const file = join(dir, entry.name)
        if (entry.isDirectory()) { walk(file); continue }
        if (!entry.name.endsWith('.md')) continue
        const info = statSync(file)
        const note = parseNote(readFileSync(file, 'utf8'))
        const done = isDone(note.head)
        if (done && info.mtimeMs < since) continue
        const path = relative(folder, file)
        notes.push({ file, business, path, note, done, draft: /^(true|yes|1)$/i.test(note.head.draft ?? ''), changed: new Date(info.mtimeMs).toISOString(),
          created: createdOf(file, info), thread: `inbox:${business.id}/${path.replace(/\.md$/i, '')}` })
      }
    }
    walk(folder)
  }
  return notes
}
/** The status of a request from its note and its ticket. */
export function statusOf(item, ticket) {
  const blocks = item.note?.blocks ?? []
  const last = blocks.at(-1)
  if (item.draft) return 'draft'
  if (ticket && !ticket.ended) {
    if (ticket.stage === 'working') return ticket.action === 'queued' ? 'queued' : 'working'
    // The person wrote after AgentHQ's latest passage: an answer or a follow-up. The ticket keeps its question until the
    // worker reports again, so the note tells: not yet read by the inbox, or read but not yet with the worker, else in hand.
    if (last?.kind === 'person' && blocks.some(block => block.kind === 'agent') && !item.done)
      return Date.parse(item.changed) > Date.parse(ticket.updatedAt) || ticket.undelivered ? 'followup' : 'working'
    if (ticket.stage === 'person') return ticket.action ?? 'answer'
    return 'waiting'
  }
  if (item.note && last?.kind === 'person' && !item.done) {
    if (ticket && Date.parse(item.changed) > Date.parse(ticket.updatedAt) + 2000) return 'followup'
    if (!ticket) return Date.now() - Date.parse(item.changed) < 10 * 60_000 ? 'submitted' : 'unrouted'
  }
  if (item.done) return 'accepted'
  const ended = OUTCOME[ticket?.ended?.outcome] ?? 'delivered'
  // A schedule's or a program's request has no note to accept: its delivered result is simply done.
  return !item.note && ended === 'delivered' ? 'completed' : ended
}
/** The schedule a ticket ran for, from its `timer:run/<id>/<stamp>` Thread. */
const scheduleOf = ticket => ticket.threads?.find(thread => thread.key.startsWith('timer:run/'))?.key.slice('timer:run/'.length).split('/')[0] ?? null
const pick = tickets => tickets?.find(ticket => ticket.state === 'open') ?? tickets?.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
function businessOfTicket(config, ticket) {
  try {
    const meta = JSON.parse(readFileSync(join(ticket.directory, '.hq', 'ticket.json'), 'utf8'))
    return config.businesses.find(item => item.id === meta.business)
  } catch { return undefined }
}
function headline(status, item, ticket, wake, state) {
  const blocks = item.note?.blocks ?? []
  const lastAgent = [...blocks].reverse().find(block => block.kind === 'agent')
  // A passage the person wrote after AgentHQ's latest one: what the worker is now taking up.
  const reply = blocks.at(-1)?.kind === 'person' && lastAgent ? plain(blocks.at(-1).text, 100) : ''
  const next = state?.sections['下一步']?.find(line => !/^无|^已交付/.test(line))
  switch (status) {
    case 'answer': return plain(ticket?.attention?.question ?? lastAgent?.text, 200)
    case 'failed': case 'blocked': return plain(ticket?.summary, 200)
    case 'waiting': return wake?.at ? `下次继续：${dayClock(wake.at)}${wake.note ? ` · ${plain(wake.note, 80)}` : ''}`
      : wake?.whenExists ? `等后台作业结束${wake.note ? ` · ${plain(wake.note, 80)}` : ''}` : next ? `下一步：${plain(next, 160)}` : '等待新的消息'
    case 'working': return reply ? `正在处理你的补充：${reply}` : next ? `下一步：${plain(next, 160)}` : lastAgent ? plain(lastAgent.text, 160) : '正在处理'
    case 'queued': return '等空出的执行位'
    case 'submitted': return '收件箱十几秒内会读到，随后开工单'
    case 'followup': return reply ? `你的补充「${reply}」会交给原来的执行者` : '补充的内容会交给原来的执行者'
    case 'unrouted': return '十分钟内没有接单：在笔记里补一句"请处理"，或重新提交'
    default: return plain(lastAgent?.text ?? ticket?.summary, 180)
  }
}
/** Every request: inbox notes joined with their tickets, and tickets that came from schedules or the spool. */
export async function requests(config, instance) {
  const fetchList = state => api(instance, 'GET', `tickets?state=${state}&limit=100`, undefined, 8000).then(list => list.items, () => [])
  const [open, ended] = await Promise.all([fetchList('open'), fetchList('ended')])
  const byThread = new Map()
  for (const ticket of [...open, ...ended]) for (const thread of ticket.threads ?? []) (byThread.get(thread.key) ?? byThread.set(thread.key, []).get(thread.key)).push(ticket)
  const wakes = pendingWakes()
  const used = new Set(), items = []
  for (const item of notesOf(config)) {
    const ticket = pick(byThread.get(item.thread))
    if (ticket) used.add(ticket.id)
    const status = statusOf(item, ticket)
    const state = ticket && !ticket.ended ? stateSections(ticket.directory) : null
    const wake = ticket ? wakes[ticket.id]?.[0] : undefined
    const persons = item.note.blocks.filter(block => block.kind === 'person')
    items.push({ kind: 'note', id: item.file, file: item.file, source: '收件箱', business: item.business.id, title: item.note.head.title || basename(item.file, '.md').replace(/^\d{8}-\d{4}-/, ''),
      type: item.note.head.type || item.business.type, created: item.created, changed: item.changed, status, ...STATUS[status],
      headline: headline(status, item, ticket, wake, state), request: plain(persons[0]?.text, 140), passages: persons.length,
      ticket: ticket ? { id: ticket.id, state: ticket.state, stage: ticket.stage, action: ticket.action, updatedAt: ticket.updatedAt, retry: ticket.actions?.retry, stop: ticket.actions?.stop } : null,
      wake: wake?.at ?? null, schedule: item.note.head.schedule || null })
  }
  for (const ticket of [...open, ...ended.slice(0, 40)]) {
    if (used.has(ticket.id)) continue
    const source = ticket.threads?.[0]?.source ?? ''
    if (source === 'inbox') continue
    const business = businessOfTicket(config, ticket)
    const status = statusOf({}, ticket)
    const state = !ticket.ended ? stateSections(ticket.directory) : null
    const wake = wakes[ticket.id]?.[0]
    items.push({ kind: 'ticket', id: ticket.id, file: null, source: SOURCE_LABEL[source] ?? source, business: business?.id ?? 'general', title: ticket.title,
      type: business?.type ?? 'general', created: ticket.createdAt, changed: ticket.updatedAt, status, ...STATUS[status],
      headline: headline(status, {}, ticket, wake, state), request: plain(ticket.threads?.[0]?.title, 140), passages: 0,
      ticket: { id: ticket.id, state: ticket.state, stage: ticket.stage, action: ticket.action, updatedAt: ticket.updatedAt, retry: ticket.actions?.retry, stop: ticket.actions?.stop },
      wake: wake?.at ?? null, schedule: scheduleOf(ticket) })
  }
  const rank = { you: 0, review: 1, active: 2, done: 3 }
  return items.sort((a, b) => rank[a.bucket] - rank[b.bucket] || b.changed.localeCompare(a.changed))
}
const AGENT_TITLE = /^(.*?)\s*·\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*$/
/** Everything the request page shows. */
export async function requestDetail(config, instance, { file, ticket: ticketId }) {
  let note = null, ticket = null, thread
  if (file) {
    const business = config.businesses.find(item => file.startsWith(`${businessFolder(item)}/`))
    if (!business) throw new Error('not an inbox note')
    const parsed = parseNote(readFileSync(file, 'utf8'))
    const path = relative(businessFolder(business), file)
    thread = `inbox:${business.id}/${path.replace(/\.md$/i, '')}`
    // The heading a titled note opens with only repeats the title the page already shows.
    const heading = parsed.head.title ? `# ${parsed.head.title}` : null
    note = { file, business: business.id, head: parsed.head, done: isDone(parsed.head), blocks: parsed.blocks.map((block, index) => {
      if (block.kind !== 'agent') return { kind: 'person', text: index === 0 && heading && block.text.split('\n')[0].trim() === heading
        ? block.text.split('\n').slice(1).join('\n').trim() : block.text }
      const title = AGENT_TITLE.exec(block.title)
      return { kind: 'agent', label: title?.[1] ?? block.title, at: title?.[2] ?? '', text: block.text }
    }) }
    const lists = await Promise.all(['open', 'ended'].map(state => api(instance, 'GET', `tickets?state=${state}&limit=100`, undefined, 8000).then(list => list.items, () => [])))
    const match = pick(lists.flat().filter(item => item.threads?.some(entry => entry.key === thread)))
    ticketId = match?.id
  }
  if (ticketId) ticket = await api(instance, 'GET', `tickets/${ticketId}`, undefined, 8000).catch(() => null)
  const dir = ticket?.directory || null
  const state = dir ? stateSections(dir) : null
  const outputs = []
  const outputsDir = dir && existsSync(join(dir, 'outputs')) ? join(dir, 'outputs') : null
  if (outputsDir) {
    const walk = at => { for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      else { const info = statSync(path); outputs.push({ path, name: relative(outputsDir, path), size: info.size, changed: new Date(info.mtimeMs).toISOString() }) }
    } }
    walk(outputsDir)
  }
  let code = null
  if (dir && existsSync(join(dir, '.hq', 'base'))) {
    const git = async (...args) => (await run('git', ['-C', dir, ...args], { timeout: 10_000 }).catch(() => ({ stdout: '' }))).stdout.trim()
    const base = readFileSync(join(dir, '.hq', 'base'), 'utf8').trim()
    code = { branch: await git('branch', '--show-current'), commits: (await git('log', '--format=%h %s', `${base}..HEAD`)).split('\n').filter(Boolean),
      files: (await git('diff', '--stat', `${base}..HEAD`)).split('\n').filter(Boolean), dirty: (await git('status', '--short', '--', '.', ':!.hq')).split('\n').filter(Boolean) }
  }
  const jobs = []
  if (dir && existsSync(join(dir, '.hq', 'jobs'))) {
    for (const name of readdirSync(join(dir, '.hq', 'jobs')).filter(item => item.endsWith('.cmd'))) {
      const stem = name.slice(0, -4), exit = join(dir, '.hq', 'jobs', `${stem}.exit`)
      jobs.push({ name: stem, command: readFileSync(join(dir, '.hq', 'jobs', name), 'utf8').trim(), done: existsSync(exit), exit: existsSync(exit) ? readFileSync(exit, 'utf8').trim() : null,
        log: join(dir, '.hq', 'jobs', `${stem}.log`) })
    }
  }
  const reports = (ticket?.assignments ?? []).map(item => item.report).filter(Boolean)
  return { note, thread, dir, state: state?.sections ?? null, stateFile: state?.file ?? null, outputs, code, jobs,
    wakes: ticketId ? pendingWakes()[ticketId] ?? [] : [],
    ticket: ticket && { id: ticket.id, title: ticket.title, state: ticket.state, stage: ticket.stage, action: ticket.action, ended: ticket.ended,
      attention: ticket.attention, summary: ticket.summary, report: reports[0] ?? null, createdAt: ticket.createdAt, updatedAt: ticket.updatedAt,
      retry: ticket.actions?.retry, stop: ticket.actions?.stop, source: ticket.threads?.[0]?.source ?? '' } }
}
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
/** A cron expression in plain words where it has a common shape. */
export function describeCron(cron) {
  const fields = String(cron).trim().split(/\s+/)
  const alias = { '@hourly': '每小时整点', '@daily': '每天 00:00', '@weekly': '每周日 00:00', '@monthly': '每月 1 日 00:00' }[cron.trim()]
  if (alias) return alias
  if (fields.length !== 5) return cron
  const [m, h, dom, mon, dow] = fields
  const time = /^\d+$/.test(m) && /^\d+$/.test(h) ? `${h.padStart(2, '0')}:${m.padStart(2, '0')}` : null
  if (/^\*\/\d+$/.test(m) && h === '*' && dom === '*' && mon === '*' && dow === '*') return `每 ${m.slice(2)} 分钟`
  if (m === '0' && h === '*' && dom === '*' && mon === '*' && dow === '*') return '每小时整点'
  if (!time || mon !== '*') return cron
  if (dom === '*' && dow === '*') return `每天 ${time}`
  if (dom === '*' && dow === '1-5') return `工作日 ${time}`
  if (dom === '*' && /^[0-7](,[0-7])*$/.test(dow)) return `每${dow.split(',').map(day => WEEKDAYS[Number(day)].slice(1)).join('、').replace(/^/, '周')} ${time}`
  if (/^\d+$/.test(dom) && dow === '*') return `每月 ${dom} 日 ${time}`
  return cron
}
/** Each schedule with its latest run: a ticket on its `timer:run/<id>/…` Thread, or a note filed by 立即运行一次. */
export function scheduleRuns(config, items) {
  const runs = {}
  for (const item of items) if (item.schedule && !(runs[item.schedule]?.changed > item.changed)) runs[item.schedule] = item
  return config.schedules.map(schedule => {
    const run = runs[schedule.id], log = join(paths.routines, schedule.business || 'general', `${schedule.id}.md`)
    return { ...schedule, when: describeCron(schedule.cron), log: existsSync(log) ? log : null,
      last: run ? { file: run.file, ticket: run.ticket?.id ?? null, updatedAt: run.changed, status: run.status, label: run.label, tone: run.tone, bucket: run.bucket,
        manual: run.kind === 'note' } : null }
  })
}
