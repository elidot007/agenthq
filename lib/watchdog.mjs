// One supervision round, run by launchd every few minutes: keeps each instance up, nudges stuck work, retries passing
// failures, backs up state, and tells the operator only what needs them.
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { api, localStamp, notify, paths, readJson, run, writeAtomic } from './core.mjs'

const PASSING = /风控|限流|稍后|rate.?limit|too many requests|temporar|throttl|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|overloaded|\b(408|429|50[0-4])\b/i
async function service(instance, action, extra = []) {
  const script = join(instance.checkout, 'scripts', 'dsh-superagent')
  try {
    const { stdout } = await run('python3', [script, '--profile', instance.profile, '--url', instance.url, ...extra, action], { timeout: 420_000, cwd: instance.checkout })
    return { code: 0, out: stdout }
  } catch (error) {
    return { code: typeof error.code === 'number' ? error.code : 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}
const parsed = text => { try { return JSON.parse(text.slice(text.indexOf('{'))) } catch { return {} } }
async function backup(instance, state, keepDays) {
  const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (state.backups?.[instance.id] === today) return
  const dir = join(paths.state, 'backups', instance.id)
  mkdirSync(dir, { recursive: true })
  const source = join(instance.stateDir, 'orchestrator.sqlite')
  if (!existsSync(source)) return
  // The SQLite backup API copies a database that is in use consistently.
  await run('sqlite3', [source, `.backup '${join(dir, `${today}.sqlite`)}'`], { timeout: 120_000 })
  for (const name of readdirSync(dir).filter(item => item.endsWith('.sqlite')).sort().slice(0, -keepDays)) rmSync(join(dir, name))
  state.backups = { ...state.backups, [instance.id]: today }
}
export async function watchdog(config, log = console.log) {
  const file = join(paths.state, 'watchdog.json')
  const state = readJson(file, {})
  const limits = config.watchdog ?? {}
  const notes = []
  for (const instance of config.instances) {
    const status = await service(instance, 'status')
    const view = parsed(status.out)
    if (status.code === 1) {
      if (view.manually_stopped) { notes.push(`${instance.id}: stopped by hand`); continue }
      const restarts = (state.restarts?.[instance.id] ?? []).filter(at => Date.now() - at < 3_600_000)
      if (restarts.length >= (limits.maxRestartsPerHour ?? 3)) {
        await notify('实例起不来', `${instance.title} 一小时内重启了 ${restarts.length} 次仍不正常；看 ${instance.checkout}/.artifacts 下最新的日志。`, { key: `restart-loop:${instance.id}` })
        notes.push(`${instance.id}: restart limit reached`)
        continue
      }
      const again = await service(instance, 'restart', ['--respect-stop'])
      state.restarts = { ...state.restarts, [instance.id]: [...restarts, Date.now()] }
      notes.push(`${instance.id}: restarted (exit ${again.code})`)
      if (again.code === 1) await notify('实例重启失败', `${instance.title} 重启后仍不正常（退出码 1）。`, { key: `restart-failed:${instance.id}`, quietHours: 1 })
      continue
    }
    if (status.code === 2) {
      const errors = Object.entries(view.errors ?? {}).map(([part, item]) => `${part}: ${typeof item === 'string' ? item : item.detail ?? JSON.stringify(item)}`).join('；')
      await notify('部件报错', `${instance.title}：${errors || '见面板'}`, { key: `errors:${instance.id}:${errors}` })
    }
    if (status.code === 3) await notify('等待设置', `${instance.title}：${view.setup?.detail ?? '见面板'}`, { key: `setup:${instance.id}:${view.setup?.code}` })
    if (status.code !== 0 && status.code !== 2) { notes.push(`${instance.id}: status ${status.code}`); continue }
    // Work that needs a nudge: passing failures get a retry, and long silence gets one notice a day.
    try {
      const open = (await api(instance, 'GET', 'tickets?state=open&limit=50')).items
      const retried = state.retried ?? {}
      for (const ticket of open) {
        if (ticket.stage === 'person' && ticket.actions?.retry) {
          const detail = await api(instance, 'GET', `tickets/${ticket.id}`)
          const report = (detail.assignments?.items ?? detail.assignments ?? []).map(item => item.report).filter(Boolean).at(0)
          const tries = retried[ticket.id] ?? []
          if (report?.state === 'failed' && PASSING.test(report.summary ?? '') && tries.length < (limits.maxAutoRetries ?? 2)
            && (!tries.length || Date.now() - tries.at(-1) > 15 * 60_000)) {
            await api(instance, 'POST', `tickets/${ticket.id}/retry`)
            retried[ticket.id] = [...tries, Date.now()]
            notes.push(`${instance.id}: retried ${ticket.id.slice(0, 8)}`)
          }
        }
        const quietHours = (Date.now() - Date.parse(ticket.updatedAt)) / 3_600_000
        if (ticket.stage === 'working' && quietHours > (limits.progressHours ?? 3)) {
          await notify('工单长时间没有进展', `${ticket.title}（${ticket.id.slice(0, 8)}）已 ${quietHours.toFixed(1)} 小时没有新报告；目录 ${ticket.directory ?? ''}`,
            { key: `quiet:${ticket.id}`, quietHours: 24 })
        }
      }
      state.retried = Object.fromEntries(Object.entries(retried).filter(([, tries]) => Date.now() - tries.at(-1) < 7 * 86_400_000))
    } catch (error) { notes.push(`${instance.id}: tickets unreadable (${error.message})`) }
    try { await backup(instance, state, limits.backupDays ?? 14) } catch (error) { notes.push(`${instance.id}: backup failed (${error.message})`) }
    notes.push(`${instance.id}: ok${status.code === 2 ? ' with errors' : ''}`)
  }
  state.at = new Date().toISOString()
  state.summary = notes.join('; ')
  writeAtomic(file, `${JSON.stringify(state, null, 2)}\n`)
  log(`${localStamp(new Date())} ${state.summary}`)
}
