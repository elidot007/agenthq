// AgentHQ 调度台: hand over work, see what needs you, follow each request, accept results.
const $ = id => document.getElementById(id)
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const unesc = value => String(value).replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]))
const store = { get: (key, fallback) => { try { return JSON.parse(localStorage.getItem(`hq:${key}`)) ?? fallback } catch { return fallback } },
  set: (key, value) => localStorage.setItem(`hq:${key}`, JSON.stringify(value)) }
async function call(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-hq-request': '1' }, body: JSON.stringify(body) })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error || `请求失败（${response.status}）`)
  return json
}
function toast(text, { action, onAction, bad, ms = 4200 } = {}) {
  const node = document.createElement('div')
  node.className = `toast${bad ? ' bad' : ''}`
  node.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`
  if (action) node.querySelector('button').onclick = () => { node.remove(); onAction?.() }
  $('toasts').append(node)
  setTimeout(() => node.remove(), ms)
}
const fail = error => toast(error.message ?? String(error), { bad: true, ms: 6000 })

// ---------- time ----------
const pad = n => String(n).padStart(2, '0')
const clock = at => `${pad(at.getHours())}:${pad(at.getMinutes())}`
function dayWord(at) {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const days = Math.floor((at.setHours ? new Date(at).setHours(0, 0, 0, 0) - start : 0) / 86_400_000)
  return days === 0 ? '今天' : days === -1 ? '昨天' : days === 1 ? '明天' : `${at.getMonth() + 1}月${at.getDate()}日`
}
function ago(iso) {
  const at = new Date(iso), diff = Date.now() - at
  if (Number.isNaN(diff)) return ''
  if (diff < 0) return `${dayWord(at)} ${clock(at)}`
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 60 * 10) return `${Math.round(minutes / 60)} 小时前`
  return `${dayWord(at)} ${clock(at)}`
}
const ahead = iso => { const at = new Date(iso); return Number.isNaN(at.getTime()) ? '' : `${dayWord(at)} ${clock(at)}` }
/** One-line text with absolute paths cut to their last part, so a result reads as words. */
const tidy = text => String(text).replace(/\/(?:Volumes|Users|private)\/[^\s，。；、）)]+/g, path => `…/${path.replace(/\/+$/, '').split('/').slice(-1)[0]}`)
const size = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1_048_576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`

// ---------- markdown ----------
const PATH = /(?:\/(?:Volumes|Users|private\/tmp|tmp)\/)[^\s<>"'`，。；、：！？）)\]]+/g
const isPath = text => /^\/(Volumes|Users|private\/tmp|tmp)\/\S+$/.test(text.trim())
const shortPath = path => { const parts = path.replace(/\/+$/, '').split('/'); return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : path }
const chip = path => `<span class="path" role="button" tabindex="0" data-path="${esc(path)}" title="${esc(path)}">${esc(shortPath(path))}</span>`
function inline(text) {
  const slots = []
  const keep = html => `\u0000${slots.push(html) - 1}\u0000`
  let s = esc(text)
  s = s.replace(/`([^`]+)`/g, (_, code) => keep(isPath(unesc(code)) ? chip(unesc(code).trim()) : `<code>${code}</code>`))
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => keep(`<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`))
  s = s.replace(/(^|[\s(（：:])(https?:\/\/[^\s<]+[^\s<.,;:!?)）。，；：])/g, (_, before, url) => before + keep(`<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`))
  s = s.replace(PATH, match => keep(chip(unesc(match))))
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[Number(n)])
}
function md(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let i = 0
  const para = []
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para.length = 0 } }
  while (i < lines.length) {
    const line = lines[i]
    const fence = /^\s*```(\S*)/.exec(line)
    if (fence) {
      flush(); const body = []; i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      i++; out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`); continue
    }
    if (/^\s*$/.test(line)) { flush(); i++; continue }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) { flush(); const level = Math.min(4, heading[1].length); out.push(`<h${level}>${inline(heading[2])}</h${level}>`); i++; continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue }
    if (/^\s*>/.test(line)) {
      flush(); const body = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${md(body.join('\n'))}</blockquote>`); continue
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      flush(); const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => inline(cell.trim()))
      const head = cells(line); i += 2; const rows = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]))
      out.push(`<table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (item) {
      flush(); const ordered = /\d/.test(item[2]); const items = []
      while (i < lines.length) {
        const next = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
        if (next && /\d/.test(next[2]) === ordered) { items.push(next[3]); i++; continue }
        if (lines[i] && /^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += `\n${lines[i].trim()}`; i++; continue }
        break
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(text => `<li>${text.split('\n').map(inline).join('<br>')}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`); continue
    }
    para.push(line); i++
  }
  flush()
  return out.join('')
}

// ---------- state ----------
let home = null, tab = store.get('tab', null), bizFilter = '', query = ''
const TYPE_LABEL = { research: '调研', code: '写代码', content: '写内容', ops: '运维排查', general: '通用', routine: '例行' }
const TABS = [['you', '需要你'], ['active', '进行中'], ['review', '待验收'], ['done', '已完成'], ['all', '全部']]
const GROUPS = { you: '需要你', review: '待验收', active: '进行中', done: '已完成' }
const bizTitle = id => home?.businesses.find(item => item.id === id)?.title ?? id

// ---------- composer ----------
const PLACEHOLDERS = {
  research: '例如：调研国内三家 AI Agent 平台的定价和最近三个月的动态，给出对比结论和来源，周五前要。',
  product: '例如：在登录页加"记住我"选项，勾选后 30 天免登录；改完跑通测试。',
  content: '例如：为小红书写一篇介绍我们新功能的笔记，面向独立开发者，800 字左右，附 3 个标题备选。',
  ops: '例如：官网从昨晚 10 点开始偶尔 502，请只读排查原因，给出处理建议，先别重启。',
  crossborder: '例如：整理这周的询盘，按优先级起草回复，先给我看，不要直接发。',
  competition: '例如：比赛 11 月 15 日截止，按提交要求倒排计划，每天推进一部分，提交前给我确认。',
  general: '写下要做的事：要什么、交付什么、什么时候要。',
}
const TEMPLATES = [
  { name: '调研一个问题', business: 'research', text: '调研：【问题】\n要回答：【想知道的几点】\n交付：结论在前，附依据和来源。' },
  { name: '写一篇稿子', business: 'content', text: '为【平台】写一篇关于【主题】的稿子。\n读者：【谁】\n篇幅：【字数】\n要求：【语气、要点、禁忌】' },
  { name: '改代码', business: 'product', text: '在【仓库/模块】里【要改什么】。\n验收：【怎样算好，例如跑通哪些测试、页面上看到什么】' },
  { name: '排查故障', business: 'ops', text: '【服务】从【时间】开始出现【现象】。\n请只读排查原因，给出处理建议；重启、回滚、部署先问我。' },
  { name: '分几天完成', business: 'general', text: '这件事分几天做：【目标】\n每天 09:00 继续推进，【截止日期】前完成，每完成一步在笔记里告诉我。' },
]
const composer = { business: store.get('business', 'research'), deadline: '', repeat: '', attachments: [], uploading: 0 }
const deadlineDate = () => {
  const at = new Date(); at.setSeconds(0, 0)
  if (composer.deadline === 'today') at.setHours(18, 0)
  else if (composer.deadline === 'tomorrow') { at.setDate(at.getDate() + 1); at.setHours(18, 0) }
  else if (composer.deadline === 'friday') { at.setDate(at.getDate() + ((5 - at.getDay() + 7) % 7 || (at.getHours() >= 18 ? 7 : 0))); at.setHours(18, 0) }
  else if (composer.deadline === 'pick' && $('deadline-date').value) { const [y, m, d] = $('deadline-date').value.split('-').map(Number); return new Date(y, m - 1, d, 18, 0) }
  else return null
  return at
}
const repeatCron = () => {
  if (!composer.repeat) return null
  const [h, m] = ($('repeat-time').value || '09:00').split(':').map(Number)
  return { daily: `${m} ${h} * * *`, weekdays: `${m} ${h} * * 1-5`, weekly: `${m} ${h} * * 1` }[composer.repeat]
}
const repeatWords = () => ({ daily: '每天', weekdays: '工作日', weekly: '每周一' }[composer.repeat] + ' ' + ($('repeat-time').value || '09:00'))
const effectiveType = () => $('ask-type').value || home?.businesses.find(item => item.id === composer.business)?.type || 'general'
function renderComposer() {
  const chips = $('biz-chips')
  if (home && !chips.childElementCount) {
    for (const business of home.businesses) {
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'chip'; button.setAttribute('role', 'radio'); button.dataset.id = business.id
      button.textContent = business.title
      button.onclick = () => { composer.business = business.id; store.set('business', business.id); renderComposer(); $('ask-text').focus() }
      chips.append(button)
    }
    if (!home.businesses.some(item => item.id === composer.business)) composer.business = home.businesses[0]?.id
    $('templates').innerHTML = TEMPLATES.map((item, index) => `<button type="button" data-template="${index}">${esc(item.name)}</button>`).join('')
  }
  for (const button of chips.children) button.setAttribute('aria-checked', String(button.dataset.id === composer.business))
  const chosen = home?.businesses.find(item => item.id === composer.business)
  $('biz-hint').textContent = chosen ? `按「${TYPE_LABEL[effectiveType()] ?? '通用'}」方式处理${effectiveType() === 'code' ? '，在仓库里开分支提交' : ''}` : ''
  for (const [seg, value] of [['deadline-seg', composer.deadline], ['repeat-seg', composer.repeat]])
    for (const button of $(seg).children) button.setAttribute('aria-checked', String(button.dataset.v === value))
  $('deadline-date').hidden = composer.deadline !== 'pick' || !!composer.repeat
  $('deadline-seg').style.opacity = composer.repeat ? .4 : 1
  $('repeat-time').hidden = !composer.repeat
  const code = effectiveType() === 'code'
  $('repo-field').hidden = !code
  if (code) { $('composer-more').hidden = false; $('more-btn').setAttribute('aria-expanded', 'true') }
  const business = home?.businesses.find(item => item.id === composer.business)
  $('ask-text').placeholder = PLACEHOLDERS[composer.business] ?? PLACEHOLDERS.general
  if (business?.repo && !$('ask-repo').value) $('ask-repo').placeholder = business.repo
  const recent = store.get('repos', [])
  $('repo-list').innerHTML = [...new Set([business?.repo, ...recent].filter(Boolean))].map(path => `<option value="${esc(path)}">`).join('')
  $('send-text').textContent = composer.repeat ? '设为定时任务' : '交给 AgentHQ'
  const text = $('ask-text').value.trim()
  const due = composer.repeat ? `${repeatWords()} 自动交给「${business?.title ?? ''}」` : deadlineDate() ? `截止 ${ahead(deadlineDate().toISOString())}` : ''
  const needsRepo = code && !$('ask-repo').value.trim() && !business?.repo
  $('send-note').textContent = composer.uploading ? `正在上传 ${composer.uploading} 个附件…` : needsRepo ? '写代码要填仓库路径' : due
  $('send-btn').disabled = !text || composer.uploading > 0 || needsRepo
  $('attachments').innerHTML = composer.attachments.map((file, index) => `<span class="file-chip${file.busy ? ' busy' : ''}" title="${esc(file.path ?? file.name)}">${esc(file.name)}${file.busy ? ' · 上传中' : `<button type="button" data-remove="${index}" aria-label="移除">×</button>`}</span>`).join('')
  store.set('draft', { text: $('ask-text').value, title: $('ask-title').value, repo: $('ask-repo').value })
}
function grow(area, max = 360) { area.style.height = 'auto'; area.style.height = `${Math.min(max, area.scrollHeight + 2)}px` }
async function upload(files) {
  for (const file of files) {
    const entry = { name: file.name, busy: true }
    composer.attachments.push(entry); composer.uploading++; renderComposer()
    try {
      const response = await fetch(`/api/upload?business=${encodeURIComponent(composer.business)}`, { method: 'POST', headers: { 'x-hq-request': '1', 'x-file-name': encodeURIComponent(file.name) }, body: file })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error)
      entry.path = json.path; entry.busy = false
    } catch (error) { composer.attachments.splice(composer.attachments.indexOf(entry), 1); fail(error) }
    composer.uploading--; renderComposer()
  }
}
async function send() {
  if ($('send-btn').disabled) return
  const text = $('ask-text').value.trim(), repo = $('ask-repo').value.trim()
  const body = { business: composer.business, text, title: $('ask-title').value.trim(), type: $('ask-type').value, repo: effectiveType() === 'code' ? repo : '',
    attachments: composer.attachments.map(file => file.path).filter(Boolean) }
  if (composer.repeat) body.repeat = { cron: repeatCron() }
  else if (deadlineDate()) body.deadline = deadlineDate().toISOString()
  $('send-btn').disabled = true
  try {
    const result = await call('/api/ask', body)
    if (repo) store.set('repos', [repo, ...store.get('repos', []).filter(item => item !== repo)].slice(0, 8))
    $('ask-text').value = ''; $('ask-title').value = ''; composer.attachments = []; composer.deadline = ''; composer.repeat = ''; grow($('ask-text'))
    renderComposer()
    if (result.schedule) toast(`已设为定时任务：${result.schedule.when}`)
    else toast('已交给 AgentHQ，十几秒内开工', { action: '查看', onAction: () => openRequest({ file: result.file }) })
    await refresh(true)
  } catch (error) { fail(error); renderComposer() }
}
function setupComposer() {
  const draft = store.get('draft', {})
  $('ask-text').value = draft.text ?? ''; $('ask-title').value = draft.title ?? ''; $('ask-repo').value = draft.repo ?? ''
  const area = $('ask-text')
  area.addEventListener('input', () => { grow(area); renderComposer() })
  for (const id of ['ask-title', 'ask-repo', 'ask-type', 'deadline-date', 'repeat-time']) $(id).addEventListener('input', renderComposer)
  $('deadline-seg').onclick = event => { const v = event.target.closest('button')?.dataset.v; if (v === undefined) return; composer.deadline = v; renderComposer(); if (v === 'pick') $('deadline-date').showPicker?.() }
  $('repeat-seg').onclick = event => { const v = event.target.closest('button')?.dataset.v; if (v === undefined) return; composer.repeat = v; renderComposer() }
  $('more-btn').onclick = () => { const open = $('composer-more').hidden; $('composer-more').hidden = !open; $('more-btn').setAttribute('aria-expanded', String(open)) }
  $('templates').onclick = event => {
    const index = event.target.closest('[data-template]')?.dataset.template
    if (index === undefined) return
    const template = TEMPLATES[Number(index)]
    composer.business = template.business; store.set('business', template.business)
    area.value = area.value.trim() ? `${area.value.trim()}\n\n${template.text}` : template.text
    grow(area); renderComposer(); area.focus()
    const start = area.value.indexOf('【'), end = area.value.indexOf('】', start)
    if (start >= 0) area.setSelectionRange(start, end + 1)
  }
  $('attach-btn').onclick = () => $('file-input').click()
  $('file-input').onchange = event => { upload([...event.target.files]); event.target.value = '' }
  $('attachments').onclick = event => { const index = event.target.closest('[data-remove]')?.dataset.remove; if (index !== undefined) { composer.attachments.splice(Number(index), 1); renderComposer() } }
  const drop = $('drop')
  for (const name of ['dragenter', 'dragover']) drop.addEventListener(name, event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); drop.classList.add('over') } })
  for (const name of ['dragleave', 'drop']) drop.addEventListener(name, () => drop.classList.remove('over'))
  drop.addEventListener('drop', event => { if (event.dataTransfer?.files.length) { event.preventDefault(); upload([...event.dataTransfer.files]) } })
  area.addEventListener('paste', event => { const files = [...(event.clipboardData?.files ?? [])]; if (files.length) { event.preventDefault(); upload(files) } })
  $('send-btn').onclick = send
  $('composer').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send() } })
  grow(area)
}

// ---------- board ----------
function visible() {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return (home?.items ?? []).filter(item => (tab === 'all' || item.bucket === tab) && (!bizFilter || item.business === bizFilter)
    && words.every(word => `${item.title} ${item.request} ${item.headline} ${bizTitle(item.business)}`.toLowerCase().includes(word)))
}
function actionsFor(item) {
  const buttons = []
  if (item.bucket === 'you' && item.file) buttons.push(['answer', item.status === 'answer' ? '回答' : '补充'])
  if (item.ticket?.retry) buttons.push(['retry', '重试'])
  if (item.bucket === 'review' && item.file) buttons.push(['accept', '验收通过'])
  return buttons.map(([act, label]) => `<button type="button" class="ghost" data-act="${act}">${label}</button>`).join('')
}
function rowHtml(item) {
  const defaultType = home.businesses.find(business => business.id === item.business)?.type
  const meta = [bizTitle(item.business), item.source !== '收件箱' ? `来自${item.source}` : null, item.type && item.type !== defaultType ? TYPE_LABEL[item.type] : null,
    item.passages > 1 ? `补充过 ${item.passages - 1} 次` : null].filter(Boolean)
  return `<div class="row ${item.bucket}" role="button" tabindex="0" data-id="${esc(item.id)}">
    <div class="stamp ${item.tone}" title="${esc(item.label)}">${esc(item.short)}</div>
    <div><div class="row-title">${esc(item.title)}</div>
      <div class="row-meta"><span class="state ${item.tone}">${esc(item.label)}</span>${meta.map(text => `<span>${esc(text)}</span>`).join('')}<span>${esc(ago(item.changed))}</span></div>
      ${item.headline ? `<div class="row-line">${esc(tidy(item.headline))}</div>` : ''}</div>
    <div class="row-actions">${actionsFor(item)}</div></div>`
}
function renderBoard() {
  const counts = home.counts
  if (!tab || (tab === 'you' && !counts.you && !store.get('tab', null))) tab = counts.you ? 'you' : counts.active ? 'active' : counts.review ? 'review' : 'all'
  $('tabs').innerHTML = TABS.map(([id, label]) => `<button type="button" role="tab" class="tab ${id}" data-tab="${id}" aria-selected="${tab === id}">${label}${id !== 'all' && id !== 'done' && counts[id] ? `<span class="n">${counts[id]}</span>` : ''}</button>`).join('')
  const select = $('biz-filter')
  if (select.options.length <= 1) for (const business of home.businesses) select.add(new Option(business.title, business.id))
  const items = visible()
  let html
  if (!items.length) {
    const words = { you: ['没有需要你处理的事', '执行者有问题要你决定、或者卡住需要你出手时，会出现在这里。'], active: ['没有进行中的请求', '在上面写下要做的事，按 ⌘↩ 交出去。'],
      review: ['没有待验收的交付', '执行者交付后会出现在这里，点"验收通过"归档。'], done: ['还没有完成的请求', ''], all: ['还没有请求', '在上面写下要做的事，按 ⌘↩ 交出去。'] }[tab]
    // An empty tab points at the tabs that do have something, so nothing waits unseen behind it.
    const elsewhere = query || bizFilter ? [] : ['you', 'review', 'active'].filter(id => id !== tab && counts[id])
    const jump = elsewhere.length ? `<div class="empty-jump">${elsewhere.map(id => `<button type="button" class="ghost" data-tab="${id}">去看${GROUPS[id]} ${counts[id]}</button>`).join('')}</div>` : ''
    html = `<div class="empty"><strong>${query || bizFilter ? '没有符合条件的请求' : words[0]}</strong>${query || bizFilter ? '换个关键词或业务试试。' : words[1]}${jump}</div>`
  } else if (tab === 'all') {
    html = Object.keys(GROUPS).map(bucket => { const group = items.filter(item => item.bucket === bucket); return group.length ? `<div class="group-title">${GROUPS[bucket]}</div>${group.map(rowHtml).join('')}` : '' }).join('')
  } else html = items.map(rowHtml).join('')
  $('list').innerHTML = html
}
function renderSide() {
  const { counts } = home
  $('stats').innerHTML = [['you', '需要你', counts.you], ['review', '待验收', counts.review], ['active', '进行中', counts.active],
    ['done', '已完成', counts.done]].map(([id, label, n]) => `<button type="button" class="stat ${id}${n ? '' : ' zero'}" data-tab="${id}"><b>${n}</b><span>${label}</span></button>`).join('')
  $('schedules').innerHTML = home.schedules.length ? home.schedules.map(item => `<div class="sched" data-schedule="${esc(item.id)}">
      <div><div class="sched-when">${esc(item.when)} · ${esc(bizTitle(item.business))}</div><div class="sched-text">${esc(item.text.replace(/`/g, ''))}</div></div>
      <button type="button" class="switch" role="switch" aria-checked="${item.state === 'on'}" aria-label="开关 ${esc(item.id)}" data-toggle></button>
      <div class="sched-last">${item.last ? `<button type="button" class="last-run" data-open-last title="打开这次运行"><span class="pill ${item.last.tone === 'seal' ? 'bad' : item.last.bucket === 'done' || item.last.bucket === 'review' ? 'ok' : ''}">${esc(item.last.label)}</span><span>上次${item.last.manual ? '手动运行' : ''} ${esc(ago(item.last.updatedAt))} ›</span></button>` : '<span>还没有运行过</span>'}</div>
      <div class="sched-tools"><button type="button" class="ghost" data-run>立即运行一次</button>${item.log ? '<button type="button" class="ghost" data-log>运行记录</button>' : ''}<button type="button" class="ghost danger" data-remove-schedule>删除</button></div></div>`).join('')
    : '<div class="empty" style="padding:10px 0">还没有定时任务。在上面选"重复"，就能把一件事设成定时任务。</div>'
  const sys = home.system, main = sys.instances[0]
  const relay = Object.entries(sys.models)
  const bad = relay.filter(([status]) => status !== '200').reduce((sum, [, n]) => sum + n, 0), total = relay.reduce((sum, [, n]) => sum + n, 0)
  $('system-mini').innerHTML = `<div class="kv"><dt>执行器</dt><dd>${main?.up ? `${main.load?.running ?? 0} 个在跑 · ${main.load?.queued ?? 0} 个排队 · 上限 ${main.load?.maxWorkers ?? '?'}${sys.paused ? ' · <span class="pill warn">已暂停接单</span>' : ''}` : '<span class="pill bad">不在线</span>'}</dd>
    ${sys.relay ? `<dt>模型</dt><dd>${total ? `近 1 小时 ${total} 次调用${bad ? `，<span class="pill ${bad / total > .1 ? 'bad' : 'warn'}">${bad} 次出错</span>` : '，全部正常'}` : '近 1 小时没有调用'}</dd>` : ''}
    ${sys.dsbot.installed === false ? '' : `<dt>DS Bot</dt><dd>${sys.dsbot.online ? `在线${sys.dsbot.questions ? ` · ${sys.dsbot.questions} 个问题待回答` : ''}` : '离线（DeepSeek Harness 桌面端未开）'}</dd>`}
    <dt>看门狗</dt><dd>${sys.watchdog?.at ? `${esc(ago(sys.watchdog.at))}巡检 · ${/ok/.test(sys.watchdog.summary ?? '') ? '正常' : esc(sys.watchdog.summary)}` : '还没运行'}</dd></div>`
  const chipNode = $('system-chip')
  const problems = sys.instances.flatMap(item => item.up ? [...item.setup ? [item.setup] : [], ...item.problems] : [`${item.title}不在线`])
  chipNode.className = `system-chip ${problems.length ? 'bad' : sys.paused ? 'paused' : 'ok'}`
  $('system-text').textContent = problems.length ? `${problems.length} 个问题` : sys.paused ? '已暂停接单' : main?.load?.running ? `运转正常 · ${main.load.running} 个在跑` : '运转正常'
}
function renderSystem() {
  const sys = home.system
  $('sysdrawer').innerHTML = `<div class="card-head"><h2>系统</h2><button type="button" class="icon" data-close-sys aria-label="关闭">×</button></div>
    ${sys.instances.map(item => `<div class="callout ${item.up && !item.setup && !item.problems.length ? '' : 'seal'}" style="margin-bottom:12px">
      <div class="block-title">${esc(item.title)}</div>
      <dl class="kv"><dt>状态</dt><dd>${item.up ? item.setup ? `等待设置：${esc(item.setup)}` : '在线' : `不在线：${esc(item.error)}`}</dd>
      ${item.up ? `<dt>负载</dt><dd>${item.load.running} 个在跑 · ${item.load.queued} 个排队 · 上限 ${item.load.maxWorkers}</dd>` : ''}
      ${item.problems.map(p => `<dt>问题</dt><dd>${esc(p)}</dd>`).join('')}</dl>
      <div class="head-actions">${item.up ? `<button type="button" class="ghost" data-pause="${item.paused ? 0 : 1}">${item.paused ? '恢复接单' : '暂停接单'}</button>` : ''}
        <a class="ghost" style="text-decoration:none" href="${esc(item.panel)}" target="_blank" rel="noreferrer">打开 superagent 面板</a></div></div>`).join('')}
    ${sys.relay ? `<div class="block-title">模型中转（近 1 小时）</div>
    <div style="margin-bottom:14px">${Object.entries(sys.models).map(([status, n]) => `<span class="pill ${status === '200' ? 'ok' : status === 'ERR' ? 'bad' : 'warn'}" style="margin:0 6px 6px 0">${esc(status)} × ${n}</span>`).join('') || '<span class="sub">没有调用</span>'}</div>` : ''}
    ${sys.dsbot.installed === false ? '' : `<div class="block-title">DS Bot</div><p class="sub" style="margin-top:0">${sys.dsbot.online ? `在线，${sys.dsbot.questions} 个问题、${sys.dsbot.approvals} 个审批等你。` : '离线。打开 DeepSeek Harness 桌面端后，可以对任意 Bot 说"交给 HQ ……"。'}</p>`}
    <div class="block-title">看门狗</div><p class="sub" style="margin-top:0">${sys.watchdog?.at ? `${esc(ago(sys.watchdog.at))}：${esc(sys.watchdog.summary)}` : '还没运行'}。每 5 分钟巡检：拉起挂掉的实例、重试暂时性失败、提醒长时间没进展的工单、每天备份。</p>
    <div class="block-title">最近通知</div>${sys.notices.length ? sys.notices.map(item => `<div class="callout" style="margin-bottom:8px"><b>${esc(item.title)}</b><div class="sub">${esc(item.text)}</div></div>`).join('') : '<p class="sub" style="margin-top:0">没有通知。</p>'}
    <div class="block-title">命令行</div><p class="sub" style="margin-top:0"><code>hq ask</code> 交任务 · <code>hq attention</code> 看待办 · <code>hq status</code> 看状态 · <code>hq help</code> 全部命令</p>`
}

// ---------- request drawer ----------
let current = null, detail = null, detailKey = '', poll = null
const STATUS_LABEL = item => item ? `${item.label}` : ''
function quickFor(item) {
  if (!item?.file) return []
  if (item.status === 'answer') return ['按你推荐的做', '都可以，你定', '先等等，我想想']
  if (item.bucket === 'review') return ['✓ 验收通过', '需要修改：']
  if (item.status === 'failed' || item.status === 'blocked') return ['再试一次', '换个思路：']
  if (item.bucket === 'done') return ['接着做：']
  return ['补充：', '优先做这个，今天内完成', '先停一下，等我确认']
}
function itemFor(target) { return home?.items.find(item => target.file ? item.file === target.file : item.id === target.ticket || item.ticket?.id === target.ticket) }
async function openRequest(target, focusReply = false) {
  current = target
  history.replaceState(null, '', target.file ? `#r=${encodeURIComponent(target.file)}` : `#t=${target.ticket}`)
  $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); $('scrim').hidden = false
  $('drawer-head').innerHTML = '<div class="sub">加载中…</div>'; $('drawer-body').innerHTML = ''; detailKey = ''
  $('reply-text').value = ''
  await loadDetail()
  clearInterval(poll); poll = setInterval(() => document.visibilityState === 'visible' && loadDetail(), 4000)
  if (focusReply) $('reply-text').focus()
}
function closeDrawers() {
  for (const id of ['drawer', 'sysdrawer']) { $(id).classList.remove('open'); $(id).setAttribute('aria-hidden', 'true') }
  $('scrim').hidden = true; current = null; clearInterval(poll)
  if (location.hash) history.replaceState(null, '', location.pathname)
}
async function loadDetail() {
  if (!current) return
  try {
    const query = current.file ? `file=${encodeURIComponent(current.file)}` : `ticket=${current.ticket}`
    const next = await call(`/api/request?${query}`)
    const key = JSON.stringify(next) + JSON.stringify(itemFor(current))
    if (key === detailKey) return
    detailKey = key; detail = next; renderDetail()
  } catch (error) { $('drawer-head').innerHTML = `<div class="sub">${esc(error.message)}</div>` }
}
function renderDetail() {
  const item = itemFor(current) ?? {}
  const t = detail.ticket, note = detail.note
  const title = item.title ?? t?.title ?? '请求'
  const actions = []
  if (note && item.bucket === 'review') actions.push('<button type="button" class="primary" data-detail="accept">✓ 验收通过</button>')
  if (note?.done) actions.push('<button type="button" class="ghost" data-detail="reopen">重新打开</button>')
  if (t?.retry) actions.push('<button type="button" class="ghost" data-detail="retry">重试</button>')
  if (note) actions.push('<button type="button" class="ghost" data-detail="note">打开笔记</button>')
  if (detail.dir) actions.push('<button type="button" class="ghost" data-detail="dir">工单目录</button>')
  // Last, apart from the rest: the one action that cannot be taken back.
  if (t?.stop) actions.push('<button type="button" class="ghost danger push" data-detail="stop">停止这张工单</button>')
  $('drawer-head').innerHTML = `<div class="head-top"><div class="stamp ${item.tone ?? 'slate'}">${esc(item.short ?? '…')}</div>
    <div class="head-title"><h2>${esc(title)}</h2><div class="head-meta"><span>${esc(STATUS_LABEL(item))}</span><span>${esc(bizTitle(item.business ?? note?.business))}</span>
      ${item.type ? `<span>${esc(TYPE_LABEL[item.type] ?? item.type)}</span>` : ''}${item.created ? `<span>${esc(ago(item.created))}提交</span>` : ''}${t ? `<span title="${esc(t.id)}">工单 ${esc(t.id.slice(0, 8))}</span>` : ''}</div></div>
    <button type="button" class="icon" data-detail="close" aria-label="关闭">×</button></div><div class="head-actions">${actions.join('')}</div>`
  const blocks = []
  if (t?.attention?.question && !t.ended && item.status === 'answer') blocks.push(`<div class="callout seal"><div class="block-title">需要你回答</div><div class="md">${md(String(t.attention.question).replace(/<[^>]+>/g, ''))}</div><div class="sub" style="margin-top:6px">在下面回复，执行者会接着做。</div></div>`)
  if ((item.status === 'failed' || item.status === 'blocked') && t?.report) blocks.push(`<div class="callout seal"><div class="block-title">${item.status === 'failed' ? '失败原因' : '卡在哪里'}</div><div class="md">${md(t.report.summary)}</div></div>`)
  const state = detail.state
  if (state && !t?.ended) {
    const list = (name, max = 6) => (state[name] ?? []).filter(line => line && !/^无$/.test(line)).slice(-max)
    const rows = [['目标', list('目标', 3)], ['下一步', list('下一步', 4)], ['已完成', list('已完成', 6)], ['待决定', list('待决定', 4)]].filter(([, lines]) => lines.length)
    const wake = detail.wakes[0]
    blocks.push(`<div><div class="block-title">进展</div><div class="callout progress">${rows.map(([name, lines]) => `<div class="progress-row"><span>${name}</span><ul>${lines.map(line => `<li>${inline(line)}</li>`).join('')}</ul></div>`).join('')}
      ${wake ? `<div class="progress-row"><span>下次继续</span><div>${wake.at ? esc(ahead(wake.at)) : '后台作业结束时'}${wake.note ? ` · ${inline(wake.note)}` : ''}</div></div>` : ''}
      ${detail.jobs.length ? `<div class="progress-row"><span>后台作业</span><ul>${detail.jobs.map(job => `<li>${esc(job.name)}：${job.done ? `已结束（退出码 ${esc(job.exit)}）` : '运行中'} ${chip(job.log)}</li>`).join('')}</ul></div>` : ''}
      ${rows.length || wake || detail.jobs.length ? '' : '<div class="sub">执行者还没写进展。</div>'}</div></div>`)
  }
  if (detail.outputs.length || detail.code) {
    const files = detail.outputs.map(file => `<div class="file-row"><div><div class="name">${esc(file.name)}</div><div class="sub">${size(file.size)} · ${esc(ago(file.changed))}</div></div>
      <div class="acts"><button type="button" class="ghost" data-preview="${esc(file.path)}">预览</button><button type="button" class="ghost" data-finder="${esc(file.path)}">Finder</button></div></div>`).join('')
    const code = detail.code ? `<div class="callout"><div class="sub">分支</div><div class="name" style="font-family:var(--mono)">${esc(detail.code.branch)}</div>
      ${detail.code.commits.length ? `<div class="sub" style="margin-top:6px">提交</div><ul style="margin:2px 0;padding-left:18px">${detail.code.commits.map(line => `<li><code>${esc(line)}</code></li>`).join('')}</ul>` : '<div class="sub">还没有提交</div>'}
      ${detail.code.files.length ? `<pre style="margin:6px 0 0;font:12px/1.5 var(--mono);white-space:pre-wrap">${esc(detail.code.files.join('\n'))}</pre>` : ''}
      ${detail.code.dirty.length ? `<div class="sub" style="margin-top:6px">未提交的改动 ${detail.code.dirty.length} 处</div>` : ''}</div>` : ''
    blocks.push(`<div><div class="block-title">交付</div><div class="files">${code}${files}</div></div>`)
  }
  const thread = []
  if (note) for (const block of note.blocks) thread.push(block.kind === 'person'
    ? `<div class="msg me"><div class="msg-head"><b>我</b></div><div class="md">${md(block.text)}</div></div>`
    : `<div class="msg agent"><div class="msg-head"><b>AgentHQ</b><span>${esc(block.label)}</span><span>${esc(block.at)}</span></div><div class="md">${md(block.text)}</div></div>`)
  else {
    if (item.request) thread.push(`<div class="msg me"><div class="msg-head"><b>${esc(item.source)}</b></div><div class="md">${md(item.request)}</div></div>`)
    if (t?.report) thread.push(`<div class="msg agent"><div class="msg-head"><b>AgentHQ</b><span>${esc(ago(t.report.at))}</span></div><div class="md">${md(t.report.summary)}</div></div>`)
  }
  blocks.push(`<div><div class="block-title">对话</div><div class="thread">${thread.join('') || '<div class="sub">还没有内容。</div>'}</div></div>`)
  $('drawer-body').innerHTML = blocks.join('')
  $('reply').hidden = !note
  $('quick').innerHTML = quickFor(item).map(text => `<button type="button" data-quick="${esc(text)}">${esc(text)}</button>`).join('')
  updateReply()
}
function updateReply() { $('reply-send').disabled = !$('reply-text').value.trim(); grow($('reply-text'), 220) }
async function sendReply() {
  const text = $('reply-text').value.trim()
  if (!text || !current?.file) return
  $('reply-send').disabled = true
  try { await call('/api/reply', { file: current.file, text }); $('reply-text').value = ''; toast('已补充，执行者会接着处理'); await refresh(true); await loadDetail() }
  catch (error) { fail(error) }
  updateReply()
}
/** Accepts a delivery; from the request page this also closes it, since nothing is left to do there. */
async function accept(file, { close = false } = {}) {
  await call('/api/done', { file })
  if (close && current?.file === file) closeDrawers()
  toast('已验收，归入已完成', { action: '撤销', ms: 8000, onAction: async () => {
    try { await call('/api/reopen', { file }); toast('已撤销，回到待验收') } catch (error) { fail(error) }
    await refresh(true); if (current?.file === file) loadDetail()
  } })
  await refresh(true)
}
async function preview(path) {
  try {
    const file = await call(`/api/file?path=${encodeURIComponent(path)}`)
    if (file.kind === 'directory') { await call('/api/reveal', { path }); return }
    $('preview-name').textContent = file.name
    $('preview-meta').textContent = `${size(file.size)} · ${path}`
    $('preview-body').innerHTML = file.kind === 'markdown' ? `<div class="md">${md(file.text)}</div>` : file.kind === 'text' ? `<pre class="plain">${esc(file.text)}</pre>`
      : file.kind === 'image' ? `<img alt="${esc(file.name)}" src="/api/raw?path=${encodeURIComponent(path)}">` : '<p class="sub">这个文件不能在这里预览，点"打开"用默认程序打开。</p>'
    $('preview-finder').onclick = () => call('/api/reveal', { path }).catch(fail)
    $('preview-open').onclick = () => call('/api/reveal', { path, open: true }).catch(fail)
    $('preview').showModal()
  } catch (error) { fail(error) }
}

// ---------- refresh ----------
let loading = false
async function refresh(force = false) {
  if (loading && !force) return
  loading = true
  try {
    home = await call('/api/home')
    renderComposer(); renderBoard(); renderSide()
    if ($('sysdrawer').classList.contains('open')) renderSystem()
  } catch (error) { $('system-chip').className = 'system-chip bad'; $('system-text').textContent = '连不上调度台服务' }
  loading = false
}
function wire() {
  $('tabs').onclick = event => { const id = event.target.closest('[data-tab]')?.dataset.tab; if (id) { tab = id; store.set('tab', id); renderBoard() } }
  $('stats').onclick = event => { const id = event.target.closest('[data-tab]')?.dataset.tab; if (id) { tab = id; store.set('tab', id); renderBoard(); $('list').scrollIntoView({ behavior: 'smooth', block: 'start' }) } }
  $('biz-filter').onchange = event => { bizFilter = event.target.value; renderBoard() }
  $('search').addEventListener('input', event => { query = event.target.value; if (query && tab !== 'all') { tab = 'all' } renderBoard() })
  $('list').addEventListener('click', async event => {
    const jump = event.target.closest('[data-tab]')?.dataset.tab
    if (jump) { tab = jump; store.set('tab', jump); renderBoard(); return }
    const row = event.target.closest('.row'); if (!row) return
    const item = home.items.find(entry => entry.id === row.dataset.id); if (!item) return
    const act = event.target.closest('[data-act]')?.dataset.act
    const target = item.file ? { file: item.file } : { ticket: item.ticket?.id ?? item.id }
    if (act === 'accept') return accept(item.file).catch(fail)
    if (act === 'retry') return call('/api/ticket', { id: item.ticket.id, action: 'retry' }).then(() => { toast('已重新开始'); refresh(true) }, fail)
    openRequest(target, act === 'answer')
  })
  $('list').addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.classList.contains('row')) event.target.click() })
  $('drawer').addEventListener('click', async event => {
    const act = event.target.closest('[data-detail]')?.dataset.detail
    const path = event.target.closest('[data-path]')?.dataset.path ?? event.target.closest('[data-preview]')?.dataset.preview
    const finder = event.target.closest('[data-finder]')?.dataset.finder
    const quick = event.target.closest('[data-quick]')?.dataset.quick
    if (path) return preview(path)
    if (finder) return call('/api/reveal', { path: finder }).catch(fail)
    if (quick) {
      if (quick === '✓ 验收通过') return accept(current.file, { close: true }).catch(fail)
      if (quick.endsWith('：')) { $('reply-text').value = quick; $('reply-text').focus(); updateReply(); return }
      $('reply-text').value = quick; updateReply(); return sendReply()
    }
    try {
      if (act === 'close') closeDrawers()
      else if (act === 'accept') await accept(current.file, { close: true })
      else if (act === 'reopen') { await call('/api/reopen', { file: current.file }); toast('已重新打开'); await refresh(true); await loadDetail() }
      else if (act === 'retry') { await call('/api/ticket', { id: detail.ticket.id, action: 'retry' }); toast('已重新开始'); await loadDetail() }
      else if (act === 'stop') { if (confirm('停止这张工单？执行者会停下，之后在笔记里再写一段不会自动恢复。')) { await call('/api/ticket', { id: detail.ticket.id, action: 'stop' }); toast('已停止'); await refresh(true); await loadDetail() } }
      else if (act === 'note') await call('/api/reveal', { path: current.file, open: true })
      else if (act === 'dir') await call('/api/reveal', { path: detail.dir })
    } catch (error) { fail(error) }
  })
  $('drawer').addEventListener('keydown', event => { const path = event.target.dataset?.path; if (path && event.key === 'Enter') preview(path) })
  $('reply-text').addEventListener('input', updateReply)
  $('reply-text').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); sendReply() } })
  $('reply-send').onclick = sendReply
  $('scrim').onclick = closeDrawers
  $('preview-close').onclick = () => $('preview').close()
  const openSystem = () => { renderSystem(); $('sysdrawer').classList.add('open'); $('sysdrawer').setAttribute('aria-hidden', 'false'); $('scrim').hidden = false }
  $('system-chip').onclick = openSystem; $('system-more').onclick = openSystem
  $('sysdrawer').addEventListener('click', async event => {
    if (event.target.closest('[data-close-sys]')) return closeDrawers()
    const pause = event.target.closest('[data-pause]')?.dataset.pause
    if (pause !== undefined) { try { await call('/api/pause', { paused: pause === '1' }); toast(pause === '1' ? '已暂停接单：新请求会排队，正在做的不受影响' : '已恢复接单'); await refresh(true) } catch (error) { fail(error) } }
  })
  $('schedules').addEventListener('click', async event => {
    const node = event.target.closest('[data-schedule]'); if (!node) return
    const id = node.dataset.schedule, schedule = home.schedules.find(item => item.id === id)
    try {
      if (event.target.closest('[data-toggle]')) { const state = schedule.state === 'on' ? 'off' : 'on'; event.target.setAttribute('aria-checked', String(state === 'on')); await call('/api/schedule/state', { id, state }); toast(state === 'on' ? `已开启：${schedule.when}` : '已暂停这个定时任务'); await refresh(true) }
      else if (event.target.closest('[data-run]')) { const result = await call('/api/schedule/run', { id }); toast('已交出一次', { action: '查看', onAction: () => openRequest({ file: result.file }) }); await refresh(true) }
      else if (event.target.closest('[data-open-last]')) openRequest(schedule.last.file ? { file: schedule.last.file } : { ticket: schedule.last.ticket })
      else if (event.target.closest('[data-log]')) preview(schedule.log)
      else if (event.target.closest('[data-remove-schedule]')) { if (confirm(`删除定时任务「${schedule.when}」？已经产生的记录会保留。`)) { await call('/api/schedule/remove', { id }); toast('已删除'); await refresh(true) } }
    } catch (error) { fail(error); refresh(true) }
  })
  $('new-schedule').onclick = () => { composer.repeat = composer.repeat || 'daily'; renderComposer(); window.scrollTo({ top: 0, behavior: 'smooth' }); $('ask-text').focus() }
  document.addEventListener('keydown', event => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')
    if (event.key === 'Escape') { if ($('preview').open) return; if (current || $('sysdrawer').classList.contains('open')) closeDrawers(); else if (typing) document.activeElement.blur() }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === '/') { event.preventDefault(); $('search').focus() }
    if (event.key === 'n') { event.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); $('ask-text').focus() }
  })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh() })
}
setupComposer(); wire()
await refresh(true)
const hash = new URLSearchParams(location.hash.slice(1))
if (hash.get('r')) openRequest({ file: hash.get('r') })
else if (hash.get('t')) openRequest({ ticket: hash.get('t') })
setInterval(() => document.visibilityState === 'visible' && refresh(), 5000)
