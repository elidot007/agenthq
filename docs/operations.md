# 运行和维护

## 一直在线

- 调度台和看门狗由 launchd（macOS）或 systemd 用户服务（Linux）常驻，`setup.mjs` 已装好。实例本身跑在 tmux 里，挂了由看门狗拉起。
- 机器要常开：
  - macOS：`bin/hq-macos-24x7.sh`（要 sudo）关闭睡眠、断电恢复后自动开机。撤销：`sudo pmset -a sleep 1 autorestart 0`。
  - Linux：`loginctl enable-linger $USER`，让用户服务在没登录时也运行。
- 日志：macOS `~/Library/Logs/agenthq/`，Linux `journalctl --user -u agenthq-hub`；实例日志在 `vendor/dsh-superagent/.artifacts/`。
- 通知写进 `inbox/_system/通知.md`，同时弹桌面通知（macOS 通知中心，Linux `notify-send`）。

## 启停

```sh
python3 vendor/dsh-superagent/scripts/dsh-superagent --profile superagent status|start|stop|restart
```

`stop` 后看门狗不会自动拉起，直到你再 `start`。只想暂停接新单、让正在做的做完：调度台"系统 → 暂停接单"。

## 备份

看门狗每天用 SQLite 备份接口把 `orchestrator.sqlite` 复制到 `state/backups/<实例>/`，保留 14 天（`watchdog.backupDays`）。请求笔记、工单目录和配置都是普通文件，用你平常的备份方式备份 AgentHQ 目录即可。

## 升级

- AgentHQ：`git pull`，然后 `hq apply`，重启调度台（macOS `launchctl kickstart -k gui/$(id -u)/local.agenthq.superagent.hub`，Linux `systemctl --user restart agenthq-hub`）。
- dsh-superagent：见 [patches/README.md](../patches/README.md)。
- DeepSeek Harness：先确认新版本在 dsh-superagent 的 `engines.dsh` 范围内，`npm install -g @deepseek-ai/dsh@<版本>`，再重启实例。

## 在手机或别的电脑上用

调度台没有登录，谁能打开它就能让执行者用你的账号干活，所以它只监听 127.0.0.1。需要远程访问时，放在只有你自己能进的网络后面，例如 Tailscale：

```sh
tailscale serve --bg --https=3090 http://127.0.0.1:3090
```

这会在你的 tailnet 里提供 `https://<机器名>.<tailnet>.ts.net:3090/`，只有登录了同一 tailnet 的设备能访问。不要用 `tailscale funnel` 或端口转发把它放到公网。

## 安全

- 执行者用你的系统账号运行，能读写你能读写的文件。重要的东西靠这几层：`blockedCommands` 硬限制、通用规则里的"必须先问人"、代码只进 `agent/` 分支、每个工单目录都是 git 仓库可回看。
- 把能对外造成影响的命令行工具加进 `blockedCommands`。想要更强的隔离，就给 AgentHQ 单独建一个系统账号，用那个账号安装和运行。
- 密钥只放在 `~/.dsh/.credentials.yaml`（权限 600）或环境变量里，不要写进笔记、业务规则或配置。
- 网页、文件、邮件里的指令对执行者来说都是数据；通用规则要求它不照做。

## 排错

| 现象 | 看哪里 |
|---|---|
| 调度台打不开 | 调度台服务的日志；`hq hub` 前台跑一次看报错 |
| 右上角"N 个问题" / 实例不在线 | `hq status`；实例日志 `vendor/dsh-superagent/.artifacts/` 最新文件 |
| `setup:` 不是 ok | 实例在等设置：`hq apply`；仍不行就打开 superagent 面板（`hq status` 打印的地址）看 Settings |
| 新笔记十分钟"没有接单" | 文件夹名是否和业务对应、笔记是否带 `draft: true`、owner 是否和 `hq.config.json` 一致；superagent 面板的 Triggers 和 Decisions |
| 工单失败 | 请求详情里的失败原因；模型密钥和额度；`hq api GET tickets/<id>` |
| 程序投递没反应 | 发送者是否在 `senders`；`kind: bot` 时规则和 `eval.mode`（`observe` 只记录不接单） |
| 唤醒没发生 | `timers/wake/` 里的请求文件；格式错的会被移进 `timers/wake/.bad/` |
