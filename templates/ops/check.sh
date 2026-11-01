#!/bin/sh
# AgentHQ check: ops report.
cd "$(dirname "$0")" || exit 1
r=outputs/report.md; fail=0
[ -s "$r" ] || { echo "FAIL $r is missing or empty"; echo "CHECK FAILED"; exit 1; }
for s in 现象 原因 处理 验证; do grep -q "^## $s" "$r" && echo "ok   ## $s" || { echo "FAIL no '## $s' section"; fail=1; }; done
[ $fail -eq 0 ] && echo "CHECK PASSED" || echo "CHECK FAILED"
exit $fail
