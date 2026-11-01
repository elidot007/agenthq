#!/bin/sh
# AgentHQ check: research report.
cd "$(dirname "$0")" || exit 1
r=outputs/report.md; fail=0
[ -s "$r" ] && echo "ok   $r exists" || { echo "FAIL $r is missing or empty"; echo "CHECK FAILED"; exit 1; }
grep -q '^## 来源' "$r" && echo "ok   ## 来源 section" || { echo "FAIL no '## 来源' section"; fail=1; }
links=$(awk '/^## 来源/{f=1;next} /^## /{f=0} f' "$r" | grep -o 'https\{0,1\}://[^ )>]*' | sort -u | wc -l | tr -d ' ')
[ "$links" -ge 3 ] && echo "ok   $links source links" || { echo "FAIL only $links source links (need 3)"; fail=1; }
grep -n -i -E '\bTODO\b|TBD|待补' "$r" && { echo "FAIL placeholders left"; fail=1; } || echo "ok   no placeholders"
chars=$(wc -m < "$r" | tr -d ' ')
[ "$chars" -ge 600 ] && echo "ok   $chars characters" || { echo "FAIL report has only $chars characters"; fail=1; }
[ $fail -eq 0 ] && echo "CHECK PASSED" || echo "CHECK FAILED"
exit $fail
