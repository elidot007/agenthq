# dsh-superagent 补丁

`0001-agenthq-sources.patch` 打在 [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) 的提交 `6337fc823ce20251c8de8085948165c81aaa701e` 上（`scripts/setup.mjs` 里的 `UPSTREAM_COMMIT`）。打上后上游测试和新增测试全部通过：`pnpm check` 62 个测试文件、1222 个测试。

## 改了什么

- **GitHub 可选**：关掉 GitHub 来源的部署不再要求 GitHub 账号，不装 `gh` 代理和 git 凭据助手（`src/deployment.ts`、`src/app/setup.ts`、`src/infra/environment.ts`、`src/infra/commands.ts`）。
- **三个本地来源**（插件入口 `inbox-watch`、`timer-watch`、`spool-watch`，默认关闭，profile 里启用）：
  - `src/sources/inbox.ts`、`inbox-note.ts`：每个业务一个文件夹的 Markdown 笔记；作者的每一段是一个触发，回复以 `> [!agent]` 段追加回笔记。执行环境变量 `DSH_SUPERAGENT_INBOX_NOTE / _BUSINESS / _TYPE / _REPO`。
  - `src/sources/timer.ts`、`cron.ts`：cron 定时任务，每次一个新线程；工单唤醒（到时间、文件出现或截止时间到）。
  - `src/sources/spool.ts`：程序的 JSON 投递目录和回复目录，发送者分"转达人的请求"和"程序自己"。
  - `src/sources/local-files.ts`：共用的原子写、移动、只追加一次等文件操作。
- **限流 403 视为暂时性错误**：模型中转返回"风控 / 稍后自动恢复"一类的 403 会重试（`src/executor/dsh.ts`）。
- 对应的测试、多语言文案、`docs/007-architecture.md` 的表格、`cordis.patch.yml` 的插件条目。

## 跟进上游

```sh
cd vendor/dsh-superagent
git fetch origin
git rebase origin/main            # 在 agenthq 分支上；有冲突就解决
pnpm install && pnpm check        # 必须全部通过
python3 scripts/dsh-superagent --profile superagent restart
```

确认没问题后，把新的补丁和上游提交写回本仓库，方便别人复现：

```sh
git format-patch -1 --stdout "$(git commit-tree HEAD^{tree} -p origin/main -m 'feat: AgentHQ Sources and GitHub-optional setup')" > ../../patches/0001-agenthq-sources.patch
git rev-parse origin/main         # 填进 scripts/setup.mjs 的 UPSTREAM_COMMIT 和本文件
```

这些改动对上游也有用，愿意的话可以拆成独立的 PR 提交给上游。
