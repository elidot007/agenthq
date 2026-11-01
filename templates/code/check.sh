#!/bin/sh
# AgentHQ check: code ticket in a worktree (installed as .hq/check.sh).
cd "$(dirname "$0")/.." || exit 1
fail=0
base=$(cat .hq/base 2>/dev/null)
[ -z "$(git status --porcelain --untracked-files=normal -- . ':!.hq')" ] && echo "ok   working tree clean" || { echo "FAIL uncommitted changes:"; git status --short -- . ':!.hq'; fail=1; }
if [ -n "$base" ]; then
  ahead=$(git rev-list --count "$base"..HEAD 2>/dev/null || echo 0)
  [ "$ahead" -ge 1 ] && echo "ok   $ahead commits on $(git branch --show-current)" || { echo "FAIL no new commit since $base"; fail=1; }
fi
if [ -s .hq/check.cmd ]; then
  echo "run  $(cat .hq/check.cmd)"
  sh -c "$(cat .hq/check.cmd)" > .hq/check.log 2>&1 && echo "ok   tests passed" || { echo "FAIL tests failed (tail of .hq/check.log):"; tail -20 .hq/check.log; fail=1; }
else
  echo "FAIL .hq/check.cmd is empty: write the repository's test command there"; fail=1
fi
[ $fail -eq 0 ] && echo "CHECK PASSED" || echo "CHECK FAILED"
exit $fail
