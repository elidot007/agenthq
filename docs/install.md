# 安装

## 依赖

| 依赖 | 版本 | 用途 |
|---|---|---|
| macOS 或 Linux | | Windows 请用 WSL2 |
| Node.js | 22.19+ 或 24+ | `hq`、调度台、看门狗 |
| pnpm | 11 | 构建 dsh-superagent |
| git | 2.32+ | 克隆和打补丁；代码工单的工作树 |
| tmux | | 实例在 tmux 会话里常驻 |
| python3 | 3.8+ | dsh-superagent 的启停脚本 |
| sqlite3 | | 看门狗每天备份工单数据库 |
| DeepSeek Harness | `@deepseek-ai/dsh` 0.2.1 系列 | 运行实例 |
| 模型 API | | DeepSeek 官方 API，或任意 OpenAI 兼容接口（[models.md](models.md)） |

```sh
npm install -g @deepseek-ai/dsh@0.2.1-rc.3 pnpm
# macOS: brew install tmux sqlite      Debian/Ubuntu: sudo apt install tmux sqlite3 python3 git
```

## 一键安装

```sh
git clone https://github.com/elidot007/agenthq.git agenthq && cd agenthq
export DEEPSEEK_API_KEY=sk-...
node scripts/setup.mjs --owner me --name 我 --preset solo
```

AgentHQ 的数据都放在这个目录里（`inbox/`、`work/` 等），放在你打算长期保留的位置。

常用选项（`node scripts/setup.mjs --help` 看全部）：

| 选项 | 默认 | 说明 |
|---|---|---|
| `--owner` / `--name` | `$USER` | 你的 id（笔记作者）和执行者称呼你的名字 |
| `--preset` | `solo` | `minimal` / `solo` / `content-studio` / `shop`，见 `presets/` |
| `--model` | `deepseek` | `openai-compatible` 时再给 `--base-url --key-env --model-id` |
| `--web-search` | 关 | 给执行者加免密钥联网搜索（npm 包 ds-bot 的搜索插件） |
| `--dsh-profile` | `superagent` | DeepSeek Harness profile 名；tmux 会话叫 `dsh-<profile>` |
| `--port` / `--hub-port` | 3082 / 3090 | 实例面板端口 / 调度台端口 |
| `--workers` | 3 | 同时做几张工单 |
| `--only` / `--skip` | | 只做或跳过某几步：`config,superagent,start,service,link` |
| `--dry-run` | | 只打印要做什么 |

它做的事，按顺序：

1. **config**：没有 `hq.config.json` 时按预设生成，并把预设的业务规则复制到 `businesses/`。已有就不动。
2. **superagent**：把 dsh-superagent 克隆到 `vendor/dsh-superagent`，切到补丁对应的上游提交，打上 `patches/0001-agenthq-sources.patch`，`pnpm install && pnpm build`；建 DeepSeek Harness profile（已有就保留），安装插件，写 profile 的 `cordis.patch.yml`（旧文件先备份）。
3. **start**：在 tmux 里启动实例，再运行 `hq apply` 推送来源、业务、规则、模型和提示词。
4. **service**：macOS 装 launchd 任务，Linux 装 systemd 用户服务：调度台常驻，看门狗每 5 分钟一轮。
5. **link**：`~/.local/bin/hq` 指向 `bin/hq`；`~/.dsh/skills/agenthq/SKILL.md` 让 DeepSeek Harness 里的智能体也能用 `hq` 交任务。

每一步都可以重复运行。失败了修好原因再跑一遍，或用 `--only` 只重做那一步。

## 检查

```sh
hq status                     # 实例在线、setup: ok、负载
hq ask general "冒烟测试：在 outputs/hello.md 写一句自我介绍，不超过 50 字。"
open http://127.0.0.1:3090/   # Linux 用浏览器打开
```

半分钟内笔记里会出现"已接单"，一两分钟后出现交付。

## 手动安装

按 `scripts/setup.mjs` 里的步骤逐条执行即可，关键命令：

```sh
git clone https://github.com/deepseek-ai/dsh-superagent-prototype.git vendor/dsh-superagent
cd vendor/dsh-superagent
git checkout -B agenthq 6337fc823ce20251c8de8085948165c81aaa701e
git am ../../patches/0001-agenthq-sources.patch
pnpm install --frozen-lockfile && pnpm build
dsh superagent --from-default-profile web --dump-config > /dev/null   # 只在新建 profile 时
dsh plugin --profile superagent add "link:$PWD"
# 用 profile/cordis.patch.yml.tmpl 和 profile/model-*.yml 写 ~/.dsh/profiles/superagent/cordis.patch.yml
python3 scripts/dsh-superagent --profile superagent start
cd ../.. && cp hq.config.example.json hq.config.json   # 改 owner、instances、businesses
bin/hq apply
```

## 卸载

```sh
python3 vendor/dsh-superagent/scripts/dsh-superagent --profile superagent stop
# macOS
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.agenthq.superagent.hub.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.agenthq.superagent.watchdog.plist
rm ~/Library/LaunchAgents/local.agenthq.superagent.*.plist
# Linux
systemctl --user disable --now agenthq-hub.service agenthq-watchdog.timer
rm ~/.local/bin/hq
```

profile（`~/.dsh/profiles/superagent`）、工单数据库（`~/.dsh/state/superagent`）和 AgentHQ 目录里的数据要不要删，你自己决定。
