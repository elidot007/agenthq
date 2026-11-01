# 调度台和 hq 命令

调度台：<http://127.0.0.1:3090/>（端口在 `hq.config.json` 的 `hub.port`）。它只读写本机文件和实例的管理接口，不调用模型，页面每 5 秒刷新一次。外观跟随系统的浅色 / 深色，手机宽度也能用。

## 交代一件事

- 在顶部输入框写：要什么、交付什么、什么时候要。执行者看不到你别处的上下文，写成自包含的一段。
- **交给**：选业务（记住上次的选择），右侧提示会按什么做法处理。
- **截止**：今天 / 明天 / 本周五 / 选日期，会写进请求末尾。
- **重复**：选了就变成定时任务，按钮变成"设为定时任务"。
- **附件**：拖进输入框、粘贴，或点"添加附件"。文件存到 `inbox/<业务>/_attachments/`，路径写进请求。
- **从模板开始**：填好常用写法，并选中第一个要改的【】。
- **更多选项**：标题、做法；选写代码时要填仓库路径（记住最近用过的）。
- `⌘↩` / `Ctrl+↩` 交出；`n` 回到输入框，`/` 搜索。

## 请求列表

每条请求是一篇笔记和它的工单合在一起。标签：

| 标签 | 里面有什么 |
|---|---|
| 需要你 | 等你回答、受阻、失败了、消息没送到、十分钟没人接单 |
| 进行中 | 已提交、排队中、处理中、已补充等待处理、等待中（写明下次几点继续） |
| 待验收 | 已交付，等你验收 |
| 已完成 | 已验收、无需处理、已停止，以及定时任务和程序交来的已完成工单 |

空标签会提示别的标签里还有什么。可以按业务筛选、按关键词搜索。

## 请求详情

点一条请求，右侧打开：

- **需要你回答**：执行者的问题，通常带它推荐的选项。
- **进展**：工单 `STATE.md` 的目标、下一步、已完成、待决定，下次唤醒时间，后台作业。
- **交付**：`outputs/` 里的文件（预览 Markdown、文本和图片，或在文件管理器里显示），代码工单的分支、提交和改动文件。
- **对话**：笔记里你和执行者的全部来往。
- 底部回复框：补充、回答或提修改意见，交给同一个执行者。快捷回复：按你推荐的做 / 都可以，你定 / 需要修改 / 再试一次 等。
- 按钮：验收通过（8 秒内可撤销）、重新打开、重试、停止这张工单、打开笔记、工单目录。

已验收的请求再补充一段，会自动重新打开，新的交付回到"待验收"。

## 定时任务和系统

右侧"定时任务"卡片：开关、立即运行一次、删除，点"上次"打开最近一次运行。"系统"（右上角状态点）：实例在线和负载、暂停 / 恢复接单（正在做的不受影响）、近 1 小时模型调用（配置了 `monitor.relayLog` 时）、DS Bot（装了 `botctl` 时）、看门狗和最近通知、superagent 自带面板的入口。

## 收件箱笔记

不用调度台也可以直接写笔记：在 `inbox/<业务>/` 下新建 `.md` 文件，停止修改 10 秒后会被读取。前言可选：

```markdown
---
title: 竞品定价调研
type: research          # 不写按业务默认
repo: /abs/path         # 写代码时
draft: true             # 写好前先不交，去掉这行才交
---
调研国内三家 AI Agent 平台的定价……
```

执行者的确认、问题和结果以 `> [!agent]` 段追加在笔记末尾。不要改动这些段；在它们后面另起一段写就是补充。验收：调度台点按钮，或前言加 `status: done`。名字以 `_` 或 `.` 开头的文件和文件夹不会被读取。

## hq 命令

```
hq ask <业务> <文字…> [--title T] [--type T] [--repo /abs]   交任务（写一篇笔记）
hq reply <笔记> <文字…>                                     补充 / 回答
hq done <笔记>                                              验收
hq notes [业务] [--days N] [--json]                         最近的笔记
hq status [--json] · hq attention [--json]                  状态 · 只看需要你的事
hq business add|list · hq schedule add|list|rm             业务、定时任务
hq apply · hq prompts                                       推送配置 · 只推提示词
hq watchdog · hq hub                                        跑一轮看门狗 · 启动调度台
hq api [METHOD] [path]                                      直接调用实例管理接口
```

工单里的执行者用：`hq wake (--in 2h | --at "2026-11-02 09:00" | --when-exists /abs/file) [--deadline 6h] --note "下一步"`，`hq job start --name N [--deadline 6h] -- <命令>`，`hq job status`。

## 调度台 API

给脚本和其他工具用。只接受 Host 为 `127.0.0.1:<端口>` 或 `localhost:<端口>` 的请求；POST 必须带 `x-hq-request: 1`，跨源请求会被拒绝。

| 方法 | 路径 | 参数 |
|---|---|---|
| GET | `/api/home` | 请求列表、计数、业务、定时任务、系统状态 |
| GET | `/api/request?file=<笔记>` 或 `?ticket=<id>` | 一条请求的详情 |
| GET | `/api/file?path=` · `/api/raw?path=` | 预览文件（仅限 `inbox/` 和 `work/` 内） |
| POST | `/api/ask` | `{ business, text, title?, type?, repo?, deadline?, attachments?, repeat?: { cron } }` |
| POST | `/api/reply` · `/api/done` · `/api/reopen` | `{ file, text? }` |
| POST | `/api/ticket` | `{ id, action: "retry" \| "stop" }` |
| POST | `/api/pause` | `{ paused }` |
| POST | `/api/schedule` · `/api/schedule/state` · `/api/schedule/remove` · `/api/schedule/run` | 定时任务 |
| POST | `/api/upload?business=` | 文件内容作为请求体，文件名放 `x-file-name` 头 |
| POST | `/api/reveal` | `{ path, open? }` 在文件管理器中显示或打开 |

```sh
curl -s -X POST http://127.0.0.1:3090/api/ask -H 'x-hq-request: 1' -H 'content-type: application/json' \
  -d '{"business":"general","text":"整理本周的会议纪要，列出待办和负责人。"}'
```
