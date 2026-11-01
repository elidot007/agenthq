# 类型：代码

- 你在用户仓库的独立工作树里，分支 `agent/<工单短名>`。AgentHQ 的文件在 `.hq/`（不会进提交）。
- 先读仓库的 AGENTS.md / README，找到测试命令，写进 `.hq/check.cmd`（一行 shell 命令，例如 `npm test`）。
- 改动小而完整，附测试；提交身份：`git -c user.name=AgentHQ -c user.email=agenthq@localhost commit -m "..."`。
- 不改 main/master，不 push，不合并。交付是这个分支上的提交和测试结果。
- `.hq/check.sh` 检查：工作区干净、分支上有新提交、`.hq/check.cmd` 里的测试通过。
