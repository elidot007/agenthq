# 按你的业务搭建

AgentHQ 的"业务"就是一个收件箱文件夹，加一份业务规则和一种默认做法。所有设置都写在文件里：改完运行 `hq apply`，它会把 `hq.config.json` 和 `prompts/` 推给实例（只改了 `businesses/` 或 `templates/` 不用 apply，下一张工单就生效）。

| 改什么 | 文件 | 生效 |
|---|---|---|
| 有哪些业务、默认做法、默认仓库 | `hq.config.json` → `businesses` | `hq apply` |
| 一个业务的规则、口径、禁区 | `businesses/<id>/AGENTS.md` | 下一张工单 |
| 业务的长期资料 | `businesses/<id>/knowledge/` | 下一张工单 |
| 所有工单都守的规则、能用的帮手 | `shared/AGENTS.md` | 下一张工单 |
| 一种做法的交付格式和自检 | `templates/<做法>/` | 下一张工单 |
| 定时任务 | 调度台"重复"，或 `hq.config.json` → `schedules` | 保存即生效 |
| 哪些程序能交任务 | `hq.config.json` → `senders` | `hq apply` |
| 程序消息什么时候自动接 | `hq.config.json` → `rules`、`eval.mode` | `hq apply` |
| 回复的语气、篇幅、提问方式 | `prompts/*.md` | `hq apply`（或 `hq prompts`） |

## 1. 先列出你的业务

一个业务对应一类经常要交出去、规则相近的事。按"谁来验收、交付长什么样、哪些事不能自己做"来分，而不是按部门。四五个通常就够，拿不准的先放"综合"（`general`，必须保留）。

```sh
hq business add legal --title 合同与法务 --type research
hq business add app --title App 开发 --type code --repo /home/me/projects/app
hq business list
```

`hq business add` 会写进 `hq.config.json`，建好 `inbox/<id>/` 和 `businesses/<id>/AGENTS.md`，并推送设置。直接改 `hq.config.json` 也行，改完 `hq apply`：

```json
{ "id": "app", "title": "App 开发", "type": "code", "repo": "/home/me/projects/app", "folder": "" }
```

- `id`：小写字母、数字、连字符；`folder` 留空就用 id 做收件箱文件夹名。
- `type`：这个业务的默认做法，取 `templates/` 下的文件夹名。单个请求可以在调度台"更多选项"或笔记前言里改。
- `repo`：写代码的业务的默认仓库（绝对路径）。

删除业务：从 `businesses` 里去掉它再 `hq apply`。已有的笔记和工单目录不会被删。

## 2. 写业务规则

`businesses/<id>/AGENTS.md` 会和通用规则、做法模板拼在一起，放进每张工单的目录。写执行者第一次接这类活需要知道的事，几行就够：

```markdown
# 业务：合同与法务

- 交付是审阅意见和修改稿，放 outputs/；不替我签署、不对外发送。
- 我方主体：某某有限公司；默认适用中国法律。
- 风险分三级：必须改 / 建议改 / 可接受，每条引用条款原文。
- 常用模板和历史意见在 knowledge/ 里，开工前先读。
```

好的业务规则通常包括：交付物是什么、放在哪；验收口径；不能自己做的事（会被强制先问）；固定背景信息；可以请教的人或工具。

`knowledge/` 是这个业务跨工单的记忆。执行者会读它，也会把值得留下的事实追加进去（一事一行，带来源和日期）。你也可以直接往里放资料。

## 3. 选做法，或者新建一种

做法决定工单目录的初始内容和"怎样算交付完成"。自带六种：

| 做法 | 交付 | 自检（`check.sh`） |
|---|---|---|
| `research` 调研 | `outputs/report.md`：结论、依据、来源 | 报告存在、有 `## 来源` 且至少 3 个链接、没有 TODO、不少于 600 字 |
| `code` 写代码 | 仓库工作树里 `agent/<工单名>` 分支上的提交 | 工作区干净、有新提交、仓库测试通过 |
| `content` 写内容 | `outputs/` 里每个平台一份稿件 | 有稿件、没有占位符 |
| `ops` 运维排查 | `outputs/report.md`：现象、原因、处理、验证 | 四节都在 |
| `routine` 例行 | `outputs/<日期>.md` | 今天的文件存在且非空 |
| `general` 通用 | `outputs/` 里任何文件 | 有非空文件，STATE.md 写了目标和下一步 |

新建一种做法，就是在 `templates/` 下加一个文件夹：

```
templates/contract/
  AGENTS.md     这种做法的方法和交付格式（会拼进工单的 AGENTS.md）
  STATE.md      进度模板（目标 / 验收标准 / 计划 / 已完成 / 下一步 / 待决定），调度台的"进展"读它
  check.sh      交付前自检：通过时打印 CHECK PASSED 并退出 0
  outputs/.keep
```

`check.sh` 是最有用的控制点：执行者在它通过之前不会报"已交付"。把你验收时会看的硬条件写成检查，例如"必须有 `## 风险` 一节""表格至少 10 行""引用的链接都能打开"。然后在业务里用它：`"type": "contract"`。调度台"更多选项 → 做法"的下拉框只列自带六种，新做法用业务默认值或笔记前言里的 `type:` 指定。

代码类做法（`type: code`）由 `bin/hq-prepare` 特殊处理：它在仓库里建工作树和分支，AgentHQ 的文件放在 `.hq/`，并加进仓库的 `info/exclude`，不会进提交。

## 4. 定时任务

调度台输入框选"重复"（每天 / 工作日 / 每周一 + 时间）就会存成定时任务。任意 cron 用命令行或配置：

```sh
hq schedule add weekly-report --cron "0 17 * * 5" --business general --type routine \
  --text "汇总本周已验收的请求，按业务列出交付物和未完成事项，写成周报。"
hq schedule list
hq schedule rm weekly-report
```

每次到点都是一张新工单，结果写进 `inbox/_routines/<业务>/<id>.md`，调度台的定时任务卡片显示最近一次运行。新建的定时任务从下一个时间点开始，不会立刻跑；想马上试，点卡片上的"立即运行一次"。

## 5. 让程序交任务

任何程序都可以把 JSON 文件放进 `spool/in/` 来交任务，回复写进 `spool/out/<conversation>/<消息id>.json`：

```json
{ "id": "deploy-2026-11-01-1", "sender": "ci", "conversation": "deploys", "text": "构建失败，日志在 /var/log/ci/123.log，请排查原因。", "business": "ops" }
```

可选字段：`thread`（接着同一件事说，填第一条的 id）、`type`、`repo`、`url`、`at`、`addressed`。发送者必须在 `hq.config.json` 的 `senders` 里：

```json
"senders": [
  { "id": "ci", "kind": "person", "business": "ops" },
  { "id": "monitor", "kind": "bot", "business": "ops" }
]
```

- `kind: person`：这个程序转达的是你本人的请求（例如你的聊天机器人、快捷指令），消息直接开工单。
- `kind: bot`：程序自己的消息（监控告警、定时脚本）。它不会直接开工单，而是交给 `rules` 判断。

先写到临时文件再改名放进 `spool/in/`，避免读到写了一半的文件。

## 6. 规则：哪些程序消息自动接

`rules` 用一句话描述"什么样的程序消息值得开工单、开了之后做到哪一步"。例如预设 `solo` 里的：

```json
{ "id": "ops-alert", "name": "Service alerts", "enabled": true,
  "instruction": "A monitor reports that a service the operator runs failed ... Diagnose read-only ... Restarting, rolling back or deploying needs the operator's answer first." }
```

`eval.mode` 决定规则判断的结果是否生效：

| 模式 | 效果 |
|---|---|
| `off` | 程序自己的消息一律不接 |
| `observe`（默认） | 照常判断，但只记录"本来会接"，不开工单。先跑几天，在 superagent 面板的 Decisions 里看判断准不准 |
| `auto` | 判断为接就开工单 |

你本人的请求（收件箱笔记、调度台、`kind: person` 的程序）在任何模式下都会接。

## 7. 提问边界和通用规则

`shared/AGENTS.md` 里"必须先问人"一节列出执行者不能自己决定的事；业务规则里可以再加，例如"报价超过 1 万元先问"。执行者在 `blockedCommands` 里的命令一律用不了，这是硬限制：

```json
"executor": { "maxWorkers": 3, "blockedCommands": ["sudo", "security", "osascript", "aws", "gcloud", "az", "vercel", "wrangler", "flyctl", "stripe"] }
```

把你机器上能对外造成影响的命令行工具加进去（例如发邮件、发帖、部署的 CLI）。本机装了别的编码代理或专家机器人、想让执行者使用时，写进 `shared/AGENTS.md` 的"可以调用的帮手"。

## 8. 回复风格

`prompts/communication.md`（消息怎么写、写多长）、`prompts/scope.md`（做到哪一步、什么时候停下来问）、`prompts/delivery.md`（交付要求）是实例的团队提示词，`prompts/overrides/` 覆盖执行者的系统提示词。改完 `hq prompts`。

## 例子：一个人的咨询工作室

```json
"businesses": [
  { "id": "leads", "title": "线索与提案", "type": "content" },
  { "id": "delivery", "title": "客户交付", "type": "research" },
  { "id": "finance", "title": "账务", "type": "general" },
  { "id": "general", "title": "综合", "type": "general" }
],
"schedules": [
  { "id": "monday-plan", "cron": "0 9 * * 1", "business": "general", "type": "routine", "state": "on",
    "text": "看 inbox/ 下所有未完成的请求和 knowledge/ 里的客户清单，列出本周要交付的事和截止日。" }
]
```

`businesses/finance/AGENTS.md` 写"只整理和核对，不付款、不开票、不登录网银"，`templates/` 里加一个 `invoice` 做法、自检发票字段齐全，`blockedCommands` 加上记账软件的 CLI。
