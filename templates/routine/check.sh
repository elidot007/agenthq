#!/bin/sh
# AgentHQ check: routine output for today.
cd "$(dirname "$0")" || exit 1
f="outputs/$(date +%Y-%m-%d).md"
[ -s "$f" ] && { echo "ok   $f"; echo "CHECK PASSED"; exit 0; } || { echo "FAIL $f is missing or empty"; echo "CHECK FAILED"; exit 1; }
