# 模型

实例里有两类模型调用：Router（判断要不要接单、起标题，`eval.model`）和执行者（干活，`executor.model`）。两者都在 `hq.config.json` 里，形如 `{ "provider": "...", "model": "...", "reasoningEffort": "high" }`；provider 和 model 必须在 DeepSeek Harness profile 里存在。

## DeepSeek 官方 API（默认）

DeepSeek Harness 自带 provider `deepseek-official`，模型 `deepseek-flash`（DeepSeek V4.1 Flash）和 `deepseek-v4-pro`，密钥读 `DEEPSEEK_API_KEY`。`setup.mjs --model deepseek` 就是这个配置。

密钥放哪里（二选一）：

- `~/.dsh/.credentials.yaml`（权限 600），实例从 tmux 启动也能读到：

  ```yaml
  version: 1
  refs:
    DEEPSEEK_API_KEY: sk-...
  ```

- 环境变量：在启动实例的 shell 里 `export DEEPSEEK_API_KEY=...`。注意 tmux 服务已经在运行时，新会话继承的是 tmux 服务的环境，不是你当前 shell 的；这种情况用上一种。

换成 Pro：把 `hq.config.json` 里 `executor.model.model` 改成 `deepseek-v4-pro`，`hq apply`。

## 任意 OpenAI 兼容接口

适用于中转、网关、本地推理服务或其他厂商：

```sh
node scripts/setup.mjs --only superagent,start --model openai-compatible \
  --provider relay --base-url http://127.0.0.1:18765/v1 --key-env RELAY_API_KEY --model-id deepseek-v4.1-flash
```

它在 profile 的 `cordis.patch.yml` 里加一个 `llm-pi-ai` provider（模板 `profile/model-openai-compatible.yml`）。已有 `hq.config.json` 时再手动把 `eval.model` 和 `executor.model` 的 provider / model 改成同样的值，`hq apply`。模板里的 `compat` 按 DeepSeek 风格的接口写；别的模型按它的文档调整 `thinkingFormat`、`contextWindow`、`maxTokens`。

中转返回"风控 / 限流"的 403、429、5xx、超时都按暂时性错误处理：实例内部会重试，看门狗对这类失败的工单再自动重试最多 2 次。

中转有日志、每行以 ISO 时间开头并带 `status=<状态码>` 时，把路径写进 `hq.config.json` 的 `monitor.relayLog`，调度台和 `hq status` 会显示近 1 小时的调用统计。

## 联网搜索

`setup.mjs --web-search` 安装 npm 包 `ds-bot`（Apache-2.0）并只加载它的免密钥搜索插件，执行者就能用 `web_search` / `web_fetch`。不装也能用：执行者可以用 `curl` 抓公开网页，调研类自检要求的来源链接需要它真的能查到。

## 并发和推理强度

- `executor.maxWorkers`：同时做几张工单（1–16），超出的排队。按接口的速率限制和钱包调。
- `reasoningEffort`：`off` / `low` / `high` / `max`。Router 用 `high` 足够；执行者默认 `max`。
- 改完 `hq apply`。
