#!/bin/sh
# AgentHQ check: general ticket.
cd "$(dirname "$0")" || exit 1
fail=0
found=$(find outputs -type f ! -name '.keep' -size +0c 2>/dev/null | head -1)
[ -n "$found" ] && echo "ok   outputs: $found" || { echo "FAIL outputs/ has no non-empty file"; fail=1; }
awk '/^## 目标/{f=1;next} /^## /{f=0} f&&NF{n++} END{exit n>0?0:1}' STATE.md && echo "ok   STATE.md 目标" || { echo "FAIL STATE.md 目标 is empty"; fail=1; }
awk '/^## 下一步/{f=1;next} /^## /{f=0} f&&NF{n++} END{exit n>0?0:1}' STATE.md && echo "ok   STATE.md 下一步" || { echo "FAIL STATE.md 下一步 is empty"; fail=1; }
[ $fail -eq 0 ] && echo "CHECK PASSED" || echo "CHECK FAILED"
exit $fail
