#!/bin/sh
# AgentHQ check: content drafts.
cd "$(dirname "$0")" || exit 1
fail=0
n=$(find outputs -type f -name '*.md' -size +0c | wc -l | tr -d ' ')
[ "$n" -ge 1 ] && echo "ok   $n drafts" || { echo "FAIL no draft in outputs/"; fail=1; }
grep -rn -i -E '\bTODO\b|TBD|待补|xxx' outputs --include='*.md' && { echo "FAIL placeholders left"; fail=1; } || echo "ok   no placeholders"
[ $fail -eq 0 ] && echo "CHECK PASSED" || echo "CHECK FAILED"
exit $fail
