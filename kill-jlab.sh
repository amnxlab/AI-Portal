#!/usr/bin/env bash
# Kill all Jupyter/JupyterLab processes — works both interactively and
# non-interactively (e.g. called from an SSH exec_command without a TTY).

if [ -t 0 ] && [ -t 1 ]; then
  # Interactive terminal — show running processes and ask for confirmation
  ps -ef | grep jupyter | grep -v grep
  echo
  read -p "Kill all Jupyter sessions? [y/N] " ans
  if [[ ! "$ans" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# Graceful SIGTERM first
pkill -TERM -f 'jupyter[- ]lab' 2>/dev/null || true

starttime=$(date +%s)
while pgrep -f 'jupyter[- ]lab' >/dev/null 2>&1; do
  elapsed=$(( $(date +%s) - starttime ))
  if [ "$elapsed" -ge 8 ]; then
    # Escalate to SIGKILL after 8 s
    pkill -KILL -f 'jupyter[- ]lab' 2>/dev/null || true
    pkill -KILL -f jupyter           2>/dev/null || true
    break
  fi
  sleep 1
done
echo "All JupyterLab sessions stopped."
