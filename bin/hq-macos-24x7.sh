#!/bin/sh
# Keeps this Mac awake and back after a power cut, so AgentHQ runs around the clock. Needs your password (sudo).
# Undo: sudo pmset -a sleep 1 autorestart 0
set -e
sudo pmset -a sleep 0 disksleep 0 autorestart 1 womp 1
pmset -g | grep -E '^\s*(sleep|disksleep|autorestart|womp)\b'
