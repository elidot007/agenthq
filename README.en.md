# AgentHQ (English summary)

AgentHQ is a ticket system for AI work that runs around the clock on your own machine. You hand over a request; it opens a ticket, gives it an isolated worker session and directory, and writes the result back where the request came from for you to accept. A ticket may run for days: the worker keeps its state in `STATE.md`, schedules its own wake-ups, and asks you only for decisions.

It runs on [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype), a DeepSeek Harness plugin, with a patch (`patches/`) that adds GitHub-free Sources: a Markdown-note inbox per business, cron schedules and ticket wakes, and a JSON spool folder for programs. On top come business playbooks, per-kind ticket templates with self-checks, a local dashboard (`lib/hub/`), the `hq` command line and a watchdog.

Quick start (macOS or Linux; Node.js 22.19+, pnpm, git, tmux, python3, sqlite3):

```sh
npm install -g @deepseek-ai/dsh@0.2.1-rc.3
git clone <this repo> agenthq && cd agenthq
export DEEPSEEK_API_KEY=sk-...
node scripts/setup.mjs --owner me --preset solo
open http://127.0.0.1:3090/
```

The dashboard and the docs are in Chinese. The key files: `hq.config.json` (businesses, schedules, senders, models), `businesses/<id>/AGENTS.md` (business rules), `templates/<kind>/` (ticket templates), `prompts/` (instance prompts). Run `hq apply` after changing them. See `docs/` for details. MIT licensed.
