// Pushes hq.config.json and prompts/ to a dsh-superagent instance through its management API.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { api, businessFolder, HOME, paths, reachable, waitUntil } from './core.mjs'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
/** The settings blocks hq.config.json implies, keyed as the API saves them. */
export function desiredBlocks(config, current) {
  const persons = config.senders.filter(sender => sender.kind === 'person').map(sender => ({ id: sender.id }))
  const bots = config.senders.filter(sender => sender.kind === 'bot').map(sender => ({ id: sender.id }))
  const policySources = { ...current.blocks.policy.value.sources,
    inbox: { ...current.blocks.policy.value.sources.inbox, allowed: [{ id: config.owner.id, name: config.owner.name }] },
    timer: { ...current.blocks.policy.value.sources.timer, allowed: [{ id: 'operator', name: config.owner.name }] },
    spool: { ...current.blocks.policy.value.sources.spool, allowed: persons, ...bots.length ? { bots } : {} } }
  return {
    'source:github': { enabled: false, config: current.sources.find(source => source.id === 'github')?.value.config ?? {} },
    'source:inbox': { enabled: true, config: { root: paths.inbox, owner: config.owner.id, settleSeconds: 10, pollSeconds: 5,
      businesses: config.businesses.map(item => ({ id: item.id, title: item.title ?? '', folder: item.folder ?? '', type: item.type ?? '', repo: item.repo ?? '' })) } },
    'source:timer': { enabled: true, config: { schedules: config.schedules.map(item => ({ id: item.id, cron: item.cron, business: item.business ?? '',
      type: item.type ?? '', text: item.text, state: item.state ?? 'on' })), wakeDir: paths.wake, reportsDir: paths.routines, pollSeconds: 15 } },
    'source:spool': { enabled: true, config: { inDir: paths.spoolIn, outDir: paths.spoolOut, pollSeconds: 5,
      senders: config.senders.map(item => ({ id: item.id, kind: item.kind, business: item.business ?? '' })) } },
    policy: { rules: config.rules, sources: policySources },
    eval: { mode: config.eval.mode, timeoutSeconds: config.eval.timeoutSeconds, model: config.eval.model ?? null },
    executor: { model: config.executor.model ?? null, maxWorkers: config.executor.maxWorkers, directory: paths.work, prepare: paths.prepare,
      blockedCommands: config.executor.blockedCommands },
  }
}
/** Writes the folders and per-business defaults the Sources and the prepare command read. */
export function ensureFolders(config) {
  for (const dir of [paths.inbox, paths.routines, paths.system, paths.spoolIn, paths.spoolOut, paths.wake, paths.work, paths.state, paths.logs]) mkdirSync(dir, { recursive: true })
  for (const business of config.businesses) {
    mkdirSync(businessFolder(business), { recursive: true })
    const dir = join(HOME, 'businesses', business.id)
    mkdirSync(join(dir, 'knowledge'), { recursive: true })
    writeFileSync(join(dir, 'type'), business.type ?? 'general')
    writeFileSync(join(dir, 'repo'), business.repo ?? '')
    if (!existsSync(join(dir, 'AGENTS.md'))) writeFileSync(join(dir, 'AGENTS.md'), `# 业务：${business.title || business.id}\n\n- 在这里写这个业务的目标、约定、可以请教的 DS Bot 和常用资料。\n`)
  }
}
/**
 * Saves each block that differs from what the instance holds. The GitHub switch goes first: while setup waits, any save restarts
 * the instance, so the rest waits until it answers with setup done.
 */
export async function applySettings(instance, config, log = console.log) {
  ensureFolders(config)
  const settle = async () => {
    const ready = await waitUntil(async () => { const r = await reachable(instance); return r.up && r.configured ? r : undefined }, 120_000, 2000)
    if (!ready) { const r = await reachable(instance); throw new Error(`${instance.id} did not come back with setup done: ${r.up ? JSON.stringify(r.state.setup?.problem) : r.error}`) }
  }
  const order = ['source:github', 'source:inbox', 'source:timer', 'source:spool', 'policy', 'eval', 'executor']
  for (const block of order) {
    const current = await api(instance, 'GET', 'settings')
    const want = desiredBlocks(config, current)[block]
    const held = block.startsWith('source:') ? current.sources.find(source => source.id === block.slice(7)) : current.blocks[block]
    if (!held) throw new Error(`${instance.id} has no settings block ${block}; is the ${block.slice(7)} Source plugin enabled in the profile?`)
    if (same(held.value, want)) { log(`= ${block}`); continue }
    const saved = await api(instance, 'PUT', `settings/${block}`, { value: want, revision: held.revision }, 120_000)
    log(`✓ ${block} (revision ${saved.revision}${saved.restarting ? ', restarting' : ''})`)
    if (saved.restarting) { await new Promise(resolve => setTimeout(resolve, 3000)); await settle() }
  }
}
const read = file => readFileSync(join(HOME, 'prompts', file), 'utf8').trim()
/** The prompt configuration prompts/ describes: the three team sections and the worker overrides. */
export function desiredPrompts() {
  return {
    communication: read('communication.md'), scope: read('scope.md'), delivery: read('delivery.md'), skills: {},
    overrides: { 'runtime/worker': { text: read('overrides/runtime-worker.md') }, 'runtime/work': { text: read('overrides/runtime-work.md') } },
  }
}
export async function pushPrompts(instance, log = console.log) {
  const view = await api(instance, 'GET', 'prompts')
  const want = desiredPrompts()
  const now = view.current.config
  const comparable = config => ({ ...config, overrides: Object.fromEntries(Object.entries(config.overrides ?? {}).map(([key, value]) => [key, value.text])) })
  if (same(comparable(now), comparable(want))) { log('= prompts'); return }
  const saved = await api(instance, 'PUT', 'prompts', { config: want, baseRevision: view.current.revision })
  log(`✓ prompts (revision ${saved.revision ?? saved.current?.revision ?? '?'})`)
}
