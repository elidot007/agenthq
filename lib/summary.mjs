// One view of everything AgentHQ runs: instances and what needs a person, notes, the model relay, DS Bot and the watchdog.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { api, listNotes, panelUrl, paths, readJson, run } from './core.mjs'

const STAGE_LABEL = { delivery: '消息没送到', answer: '等你回答', review: '等你验收', blocked: '受阻', failed: '失败' }
async function instanceView(instance) {
  const panel = panelUrl(instance)
  try {
    const [state, overview, open] = await Promise.all([api(instance, 'GET', 'state', undefined, 6000), api(instance, 'GET', 'overview', undefined, 6000),
      api(instance, 'GET', 'tickets?state=open&limit=50', undefined, 6000)])
    const problems = overview.problems.map(problem => problem.kind === 'setup' ? `setup: ${problem.detail}` : problem.kind === 'source-error'
      ? `来源 ${problem.source.id}: ${problem.source.health.detail}` : problem.kind === 'runtime-error' ? `${problem.name}: ${problem.detail}` : problem.kind)
      .filter(text => text !== 'no-allowed' || !state.setup?.problem)
    return { id: instance.id, title: instance.title, up: true, panel, setup: state.setup?.problem?.detail ?? null, paused: state.paused,
      load: state.load, health: Object.fromEntries(Object.entries(state.health).map(([name, item]) => [name, item.state])), problems,
      person: overview.person, open: open.items, flow: overview.flow }
  } catch (error) {
    return { id: instance.id, title: instance.title, up: false, panel, error: String(error.message ?? error), problems: [], person: [], open: [], load: {} }
  }
}
/**
 * Model calls of the last hour by status, from the log of a model relay when `monitor.relayLog` names one: lines that start
 * with an ISO time and hold `status=<code>`. Without a relay log the dashboard shows no model line.
 */
function relayCalls(config) {
  const log = String(config.monitor?.relayLog ?? '').replace(/^~(?=\/)/, homedir())
  const counts = {}
  if (!log) return counts
  try {
    const size = statSync(log).size
    const text = readFileSync(log, 'utf8').slice(Math.max(0, size - 400_000))
    const since = new Date(Date.now() - 3_600_000).toISOString()
    for (const line of text.split('\n')) {
      if (line.slice(0, 24) < since) continue
      const status = /status=(\S+)/.exec(line)?.[1]
      if (status) counts[status] = (counts[status] ?? 0) + 1
    }
  } catch { /* No relay log. */ }
  return counts
}
let botCache = { at: 0, value: { online: false, questions: 0, approvals: 0 } }
async function dsbot() {
  if (Date.now() - botCache.at < 60_000) return botCache.value
  const json = async (...args) => JSON.parse((await run('botctl', args, { timeout: 8000 })).stdout)
  let value = { installed: true, online: false, questions: 0, approvals: 0 }
  // DS Bot is optional: without its botctl command the dashboard leaves it out.
  if (!(await run('sh', ['-c', 'command -v botctl']).then(() => true, () => false))) { botCache = { at: Date.now(), value: { ...value, installed: false } }; return botCache.value }
  try {
    const [questions, approvals] = await Promise.all([json('questions'), json('approvals')])
    const count = list => Array.isArray(list) ? list.length : Array.isArray(list?.items) ? list.items.length : Object.keys(list ?? {}).length
    value = { installed: true, online: true, questions: count(questions), approvals: count(approvals) }
  } catch { /* DS Bot runs only while DeepSeek Harness desktop is open. */ }
  botCache = { at: Date.now(), value }
  return value
}
export async function summary(config) {
  const instances = await Promise.all(config.instances.map(instanceView))
  const attention = []
  for (const instance of instances) {
    if (!instance.up) { attention.push({ instance: instance.id, label: '实例不在线', title: instance.error, link: instance.panel }); continue }
    if (instance.setup) attention.push({ instance: instance.id, label: '设置未完成', title: instance.setup, link: instance.panel })
    for (const ticket of instance.person) {
      const label = STAGE_LABEL[ticket.action] ?? STAGE_LABEL[ticket.stage] ?? '需要你'
      attention.push({ instance: instance.id, label, title: ticket.title, ticket: ticket.id, link: ticket.reply?.url || instance.panel })
    }
  }
  const notes = listNotes(config, { days: 14 })
  const watchdog = readJson(join(paths.state, 'watchdog.json'), {})
  const routines = config.schedules.map(schedule => {
    const file = join(paths.routines, schedule.business || 'general', `${schedule.id}.md`)
    return { ...schedule, log: existsSync(file) ? file : null, lastAt: existsSync(file) ? new Date(statSync(file).mtimeMs).toISOString() : null }
  })
  return { at: new Date().toISOString(), instances, attention, notes, routines, businesses: config.businesses.map(({ id, title, type }) => ({ id, title, type })),
    models: { lastHour: relayCalls(config), relay: !!config.monitor?.relayLog }, dsbot: await dsbot(), watchdog }
}
