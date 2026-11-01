// Operator actions the dashboard and the command line share: schedules, attachments, files, tickets and the processing pause.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { applySettings } from './apply.mjs'
import { api, businessFolder, compactStamp, instanceOf, paths, run, saveConfig } from './core.mjs'

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/
/** Adds or replaces a schedule and pushes the Timer Source's settings. */
export async function saveSchedule(config, entry) {
  if (!SLUG.test(entry.id ?? '')) throw new Error('定时任务 id 只能用小写字母、数字和连字符')
  if (!String(entry.text ?? '').trim()) throw new Error('定时任务要写清做什么')
  if (!config.businesses.some(item => item.id === entry.business)) throw new Error(`没有业务 ${entry.business}`)
  const schedule = { id: entry.id, cron: String(entry.cron).trim(), business: entry.business, type: entry.type || 'routine', text: String(entry.text).trim(), state: entry.state === 'off' ? 'off' : 'on' }
  config.schedules = [...config.schedules.filter(item => item.id !== schedule.id), schedule]
  saveConfig(config)
  await applySettings(instanceOf(config), config, () => {})
  return schedule
}
export async function removeSchedule(config, id) {
  config.schedules = config.schedules.filter(item => item.id !== id)
  saveConfig(config)
  await applySettings(instanceOf(config), config, () => {})
}
export async function setScheduleState(config, id, state) {
  const schedule = config.schedules.find(item => item.id === id)
  if (!schedule) throw new Error(`没有定时任务 ${id}`)
  schedule.state = state === 'off' ? 'off' : 'on'
  saveConfig(config)
  await applySettings(instanceOf(config), config, () => {})
  return schedule
}
/** A schedule id from a request's words when it is written mostly in ASCII, else a time stamp: the ASCII bits of a Chinese
 * request are file names and commands, which would name it wrongly. */
export function scheduleId(config, text) {
  const source = String(text).toLowerCase()
  const ascii = source.match(/[a-z0-9]/g)?.length ?? 0, cjk = source.match(/[\u3400-\u9fff]/g)?.length ?? 0
  const words = ascii > cjk * 2 ? source.match(/[a-z0-9]+/g)?.slice(0, 3).join('-') ?? '' : ''
  let id = (words || `task-${compactStamp(new Date()).toLowerCase()}`).slice(0, 32).replace(/^-+|-+$/g, '') || 'task'
  if (!SLUG.test(id)) id = `task-${Date.now().toString(36)}`
  for (let n = 2; config.schedules.some(item => item.id === id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`
  return id
}
/** Saves an uploaded file next to the business's notes, in a folder the inbox does not read, and returns its path. */
export function saveAttachment(config, businessId, name, data) {
  const business = config.businesses.find(item => item.id === businessId) ?? config.businesses.find(item => item.id === 'general')
  const dir = join(businessFolder(business), '_attachments')
  mkdirSync(dir, { recursive: true })
  const clean = basename(String(name || 'file')).replace(/[\\/:*?"<>|\n\r\t]+/g, '-').slice(-80) || 'file'
  let file = join(dir, `${compactStamp(new Date())}-${clean}`)
  for (let n = 2; existsSync(file); n++) file = join(dir, `${compactStamp(new Date())}-${n}-${clean}`)
  writeFileSync(file, data)
  return file
}
/** True for a path inside the folders the dashboard may show or reveal: the inbox and the ticket directories. */
export function viewable(path) {
  if (!path || !isAbsolute(path)) return false
  return [paths.inbox, paths.work].some(root => { const rest = relative(root, resolve(path)); return rest && !rest.startsWith('..') && !isAbsolute(rest) })
}
const TEXT = new Set(['.md', '.markdown', '.txt', '.json', '.csv', '.tsv', '.log', '.yaml', '.yml', '.toml', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.sh',
  '.html', '.css', '.sql', '.xml', '.ini', '.env.example', ''])
const IMAGE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
/** What a preview of a file shows: its text, an image type the browser loads by itself, or only its size. */
export function fileView(path) {
  if (!viewable(path)) throw new Error('这个文件不在收件箱或工单目录里')
  const info = statSync(path)
  if (info.isDirectory()) return { path, name: basename(path), size: 0, kind: 'directory' }
  const extension = extname(path).toLowerCase()
  if (IMAGE[extension]) return { path, name: basename(path), size: info.size, kind: 'image' }
  if (TEXT.has(extension) && info.size <= 600_000) return { path, name: basename(path), size: info.size, kind: extension === '.md' || extension === '.markdown' ? 'markdown' : 'text', text: readFileSync(path, 'utf8') }
  return { path, name: basename(path), size: info.size, kind: 'binary' }
}
export const imageType = path => IMAGE[extname(path).toLowerCase()]
/** Shows a file or folder in Finder, or opens it with its default app. */
export async function reveal(path, open = false) {
  if (!viewable(path) || !existsSync(path)) throw new Error('这个路径不在收件箱或工单目录里')
  if (process.platform === 'darwin') await run('open', open ? [path] : ['-R', path], { timeout: 10_000 })
  // Elsewhere the desktop opens the file, or shows the folder that holds it.
  else await run('xdg-open', [open || statSync(path).isDirectory() ? path : dirname(path)], { timeout: 10_000 })
}
export async function ticketAction(config, id, action) {
  if (!/^[A-Za-z0-9]+$/.test(id ?? '') || !['retry', 'stop'].includes(action)) throw new Error('bad ticket action')
  return api(instanceOf(config), 'POST', `tickets/${id}/${action}`, {})
}
export async function setPaused(config, paused) {
  return api(instanceOf(config), 'POST', 'executor/pause', { paused: !!paused })
}
