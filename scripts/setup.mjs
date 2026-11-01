#!/usr/bin/env node
// AgentHQ setup: writes hq.config.json from a preset, installs the patched dsh-superagent into a DeepSeek Harness profile,
// starts it, pushes the settings, and installs the dashboard and the watchdog as user services. Each step is idempotent:
// run it again after a failure, or with --only to redo one step. `node scripts/setup.mjs --help` lists the options.
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HQ_HOME = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM = 'https://github.com/deepseek-ai/dsh-superagent-prototype.git'
// The upstream commit patches/0001-agenthq-sources.patch applies to; see patches/README.md to move to a newer one.
const UPSTREAM_COMMIT = '6337fc823ce20251c8de8085948165c81aaa701e'
const HELP = `node scripts/setup.mjs [options]

  --owner <id>            your id on the inbox notes (lowercase letters, digits, dashes)       default: $USER
  --name <name>           your name, as workers address you                                     default: the id
  --preset <name>         minimal | solo | content-studio | shop (see presets/)                 default: solo
  --model deepseek        the DeepSeek official API; set DEEPSEEK_API_KEY                       (default)
  --model openai-compatible --base-url <url> --key-env <VAR> --model-id <id> [--provider <id>]
                          any OpenAI-compatible endpoint, such as a relay or a gateway
  --relay-log <file>      a relay log with "status=<code>" lines, shown on the dashboard        optional
  --web-search            add the keyless web search of the ds-bot npm package for workers
  --profile <name>        DeepSeek Harness profile for the instance                             default: superagent
  --port <n>              the instance's panel port                                              default: 3082
  --hub-port <n>          the dashboard port                                                     default: 3090
  --superagent-dir <dir>  where to clone the patched dsh-superagent                              default: ./vendor/dsh-superagent
  --upstream <url|path>   the dsh-superagent repository to clone                                 default: GitHub
  --workers <n>           tickets worked at once (1-16)                                          default: 3
  --only <steps>          comma-separated: config, superagent, start, service, link
  --skip <steps>          the same steps, skipped
  --dry-run               print what would happen, change nothing
`
const args = process.argv.slice(2)
const flag = name => args.includes(`--${name}`)
const opt = (name, fallback) => { const at = args.indexOf(`--${name}`); return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback }
if (flag('help') || flag('h')) { console.log(HELP); process.exit(0) }
const dry = flag('dry-run')
const steps = ['config', 'superagent', 'start', 'service', 'link']
const only = opt('only', '').split(',').filter(Boolean), skip = opt('skip', '').split(',').filter(Boolean)
const doing = step => (!only.length || only.includes(step)) && !skip.includes(step)
const say = text => console.log(`\n▸ ${text}`)
const fail = text => { console.error(`\n✗ ${text}`); process.exit(1) }
const fill = (text, values) => text.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => values[key] ?? '')
const write = (file, text, mode) => { if (dry) { console.log(`  would write ${file}`); return } mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); if (mode) chmodSync(file, mode) }
function sh(command, list, options = {}) {
  console.log(`  $ ${[command, ...list].join(' ')}`)
  if (dry) return ''
  const result = spawnSync(command, list, { stdio: options.capture ? 'pipe' : 'inherit', encoding: 'utf8', cwd: options.cwd, env: { ...process.env, ...options.env } })
  if (result.status !== 0 && !options.allowFail) fail(`${command} ${list.join(' ')} exited ${result.status}${options.capture ? `: ${result.stderr || result.stdout}` : ''}`)
  return options.capture ? result.stdout : String(result.status)
}
const which = name => spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim()

const owner = opt('owner', (process.env.USER || 'me').toLowerCase().replace(/[^a-z0-9-]/g, '-'))
if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(owner)) fail('--owner is lowercase letters, digits and dashes')
const profile = opt('profile', 'superagent'), port = Number(opt('port', 3082)), hubPort = Number(opt('hub-port', 3090))
const superagentDir = resolve(opt('superagent-dir', join(HQ_HOME, 'vendor', 'dsh-superagent')))
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const stateDir = join(dshHome, 'state', profile)
const model = opt('model', 'deepseek')
if (!['deepseek', 'openai-compatible'].includes(model)) fail('--model is deepseek or openai-compatible')
const relay = { provider: opt('provider', 'relay'), baseURL: opt('base-url', ''), keyEnv: opt('key-env', ''), modelId: opt('model-id', '') }
if (model === 'openai-compatible' && (!relay.baseURL || !relay.keyEnv || !relay.modelId)) fail('--model openai-compatible needs --base-url, --key-env and --model-id')
const modelRef = effort => model === 'deepseek' ? { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: effort }
  : { provider: relay.provider, model: relay.modelId, reasoningEffort: effort }

// ---------- prerequisites ----------
say('检查依赖')
const need = { node: '22.19', git: '2.32', pnpm: '', tmux: '', python3: '', dsh: '0.2.1', sqlite3: '' }
const missing = Object.keys(need).filter(name => !which(name) && !(name === 'node'))
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 19)) missing.push('node ≥ 22.19')
for (const name of Object.keys(need)) console.log(`  ${which(name) ? '✓' : '✗'} ${name}${which(name) ? '' : '（缺）'}`)
if (missing.length && (doing('superagent') || doing('start'))) {
  fail(`缺少：${missing.join(', ')}。安装方法见 docs/install.md；DeepSeek Harness：npm install -g @deepseek-ai/dsh@0.2.1-rc.3`)
}

// ---------- config ----------
if (doing('config')) {
  say('写配置 hq.config.json')
  const file = join(HQ_HOME, 'hq.config.json')
  if (existsSync(file)) console.log('  hq.config.json 已存在，保留不动（要重来就先删掉它）')
  else {
    const presetName = opt('preset', 'solo'), presetDir = join(HQ_HOME, 'presets', presetName)
    if (!existsSync(join(presetDir, 'preset.json'))) fail(`没有预设 ${presetName}；可选：${readdirSync(join(HQ_HOME, 'presets')).join(', ')}`)
    const preset = JSON.parse(readFileSync(join(presetDir, 'preset.json'), 'utf8'))
    const example = JSON.parse(readFileSync(join(HQ_HOME, 'hq.config.example.json'), 'utf8'))
    const config = { ...example, owner: { id: owner, name: opt('name', owner) },
      instances: [{ ...example.instances[0], profile, url: `http://127.0.0.1:${port}`, checkout: superagentDir, stateDir }],
      businesses: preset.businesses, schedules: preset.schedules, senders: preset.senders, rules: preset.rules,
      eval: { ...example.eval, model: modelRef('high') },
      executor: { ...example.executor, maxWorkers: Math.min(16, Math.max(1, Number(opt('workers', example.executor.maxWorkers)))), model: modelRef('max') },
      hub: { port: hubPort }, monitor: { relayLog: opt('relay-log', '') } }
    write(file, `${JSON.stringify(config, null, 2)}\n`)
    for (const business of preset.businesses) {
      const target = join(HQ_HOME, 'businesses', business.id, 'AGENTS.md'), source = join(presetDir, 'businesses', business.id, 'AGENTS.md')
      if (!existsSync(target) && existsSync(source)) { if (!dry) { mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target) } else console.log(`  would copy ${source}`) }
      if (!dry) { mkdirSync(join(HQ_HOME, 'businesses', business.id, 'knowledge'), { recursive: true }); writeFileSync(join(HQ_HOME, 'businesses', business.id, 'knowledge', '.keep'), '') }
    }
    console.log(`  预设 ${presetName}：${preset.businesses.map(item => item.title).join('、')}`)
  }
}

// ---------- superagent ----------
if (doing('superagent')) {
  say(`安装打过补丁的 dsh-superagent 到 ${superagentDir}`)
  if (!existsSync(join(superagentDir, '.git'))) {
    sh('git', ['clone', '--quiet', opt('upstream', UPSTREAM), superagentDir])
    sh('git', ['-C', superagentDir, 'checkout', '--quiet', '-B', 'agenthq', UPSTREAM_COMMIT])
    sh('git', ['-C', superagentDir, '-c', 'user.name=AgentHQ setup', '-c', 'user.email=agenthq@localhost', 'am', '--quiet', join(HQ_HOME, 'patches', '0001-agenthq-sources.patch')])
  } else console.log('  已有克隆，跳过 clone 和补丁')
  sh('pnpm', ['install', '--frozen-lockfile'], { cwd: superagentDir })
  sh('pnpm', ['build'], { cwd: superagentDir })
  const profileDir = join(dshHome, 'profiles', profile)
  if (!existsSync(profileDir)) sh('dsh', [profile, '--from-default-profile', 'web', '--dump-config'], { capture: true })
  else console.log(`  已有 profile ${profile}，保留它的其他配置`)
  sh('dsh', ['plugin', '--profile', profile, 'add', `link:${superagentDir}`])
  if (flag('web-search')) sh('dsh', ['plugin', '--profile', profile, 'add', 'ds-bot@^0.2.4'])
  const patch = join(profileDir, 'cordis.patch.yml')
  if (existsSync(patch) && !dry) copyFileSync(patch, `${patch}.before-agenthq-${Date.now()}`)
  const modelBlock = model === 'deepseek' ? readFileSync(join(HQ_HOME, 'profile', 'model-deepseek.yml'), 'utf8')
    : fill(readFileSync(join(HQ_HOME, 'profile', 'model-openai-compatible.yml'), 'utf8'), { PROVIDER: relay.provider, KEY_ENV: relay.keyEnv, BASE_URL: relay.baseURL, MODEL_ID: relay.modelId })
  const web = flag('web-search') ? readFileSync(join(HQ_HOME, 'profile', 'web-search-ds-bot.yml'), 'utf8') : ''
  write(patch, fill(readFileSync(join(HQ_HOME, 'profile', 'cordis.patch.yml.tmpl'), 'utf8'), { HQ_HOME, PORT: String(port), STATE_DIR: stateDir, MODEL: modelBlock, WEB: web }), 0o600)
}

// ---------- start ----------
if (doing('start')) {
  say(`启动实例（tmux 会话 dsh-${profile}，端口 ${port}）并推送设置`)
  const key = model === 'deepseek' ? 'DEEPSEEK_API_KEY' : relay.keyEnv
  const credentials = join(dshHome, '.credentials.yaml')
  const known = process.env[key] || (existsSync(credentials) && new RegExp(`^\\s+${key}:`, 'm').test(readFileSync(credentials, 'utf8')))
  if (!known) console.log(`  ! 没找到模型密钥 ${key}：在 ${credentials} 的 refs 下加一行 "${key}: <密钥>"（文件权限 600），或在启动 tmux 前 export ${key}。不影响安装，但工单要等有密钥才能跑。`)
  const script = join(superagentDir, 'scripts', 'dsh-superagent'), url = `http://127.0.0.1:${port}`
  const code = sh('python3', [script, '--profile', profile, '--url', url, 'start'], { allowFail: true, cwd: superagentDir })
  if (!dry && !['0', '3'].includes(code)) fail(`实例没有正常启动（退出码 ${code}），看 ${superagentDir}/.artifacts 下最新的日志`)
  sh(process.execPath, [join(HQ_HOME, 'bin', 'hq'), 'apply'], { env: { HQ_HOME } })
}

// ---------- service ----------
if (doing('service')) {
  const node = process.execPath, PATH = [dirname(node), join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':')
  if (platform() === 'darwin') {
    say('安装 launchd 任务（调度台常驻，看门狗每 5 分钟）')
    const logs = join(homedir(), 'Library', 'Logs', 'agenthq'), agents = join(homedir(), 'Library', 'LaunchAgents')
    if (!dry) mkdirSync(logs, { recursive: true })
    const template = readFileSync(join(HQ_HOME, 'service', 'launchd.plist.tmpl'), 'utf8')
    for (const [command, schedule] of [['hub', '<key>KeepAlive</key><true/>'], ['watchdog', '<key>StartInterval</key><integer>300</integer>']]) {
      const label = `${opt('label-prefix', 'local.agenthq')}.${profile}.${command}`, file = join(agents, `${label}.plist`)
      write(file, fill(template, { LABEL: label, NODE: node, HQ_HOME, COMMAND: command, PATH, USER_HOME: homedir(), LOGS: logs, SCHEDULE: schedule }))
      sh('launchctl', ['bootout', `gui/${process.getuid()}`, file], { allowFail: true, capture: true })
      sh('launchctl', ['bootstrap', `gui/${process.getuid()}`, file])
    }
  } else if (which('systemctl')) {
    say('安装 systemd 用户服务（调度台常驻，看门狗每 5 分钟）')
    const units = join(homedir(), '.config', 'systemd', 'user')
    for (const name of ['agenthq-hub.service', 'agenthq-watchdog.service', 'agenthq-watchdog.timer'])
      write(join(units, name), fill(readFileSync(join(HQ_HOME, 'service', `${name}.tmpl`), 'utf8'), { NODE: node, HQ_HOME, PATH, HUB_PORT: String(hubPort) }))
    sh('systemctl', ['--user', 'daemon-reload'])
    sh('systemctl', ['--user', 'enable', '--now', 'agenthq-hub.service', 'agenthq-watchdog.timer'])
    console.log('  机器重启后也要运行：loginctl enable-linger $USER')
  } else console.log('  ! 没有 launchd 或 systemd：手动常驻 `hq hub`，每 5 分钟跑一次 `hq watchdog`（docs/operations.md）')
}

// ---------- link ----------
if (doing('link')) {
  say('把 hq 命令放进 ~/.local/bin，把 agenthq 技能放进 ~/.dsh/skills')
  const bin = join(homedir(), '.local', 'bin', 'hq')
  if (!dry) { mkdirSync(dirname(bin), { recursive: true }); try { unlinkSync(bin) } catch {} symlinkSync(join(HQ_HOME, 'bin', 'hq'), bin) } else console.log(`  would link ${bin}`)
  write(join(dshHome, 'skills', 'agenthq', 'SKILL.md'), fill(readFileSync(join(HQ_HOME, 'skill', 'agenthq', 'SKILL.md.tmpl'), 'utf8'), { HQ_HOME, HUB_PORT: String(hubPort) }))
  if (!(process.env.PATH ?? '').split(':').includes(dirname(bin))) console.log(`  ! ${dirname(bin)} 不在 PATH 里：把它加进 shell 配置`)
}

console.log(`\n完成。调度台：http://127.0.0.1:${hubPort}/   检查：hq status   下一步：docs/businesses.md 按你的业务改配置`)
