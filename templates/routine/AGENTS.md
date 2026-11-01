# 类型：例行

- 这是定时任务开的工单，不需要确认（不要调用 orchestrator_ack）。
- 交付 `outputs/<YYYY-MM-DD>.md`，并在报告里给出结论摘要；没有新内容就报 dropped。
- `./check.sh` 检查今天的产出文件存在且非空。
