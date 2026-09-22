#!/bin/sh
set -eu
port="${PORT:-8080}"
sed "s/LISTEN_PORT/${port}/" /etc/forgit/nginx.conf.template > /tmp/nginx.conf
# walgit treats PORT as its own listen port. Keep it on 127.0.0.1:8081.
env -u PORT walgit serve --config /etc/walgit/walgit.toml &
walgit_pid=$!
python3 /usr/local/bin/forgit-merge.py &
merge_pid=$!
# Nginx is the port the platform treats as ready. Wait until both upstreams
# accept connections so the first request is not a 502.
python3 - <<'PY'
import socket
import sys
import time

def ready(port: int) -> bool:
    for _ in range(150):
        try:
            with socket.create_connection(("127.0.0.1", port), 0.2):
                return True
        except OSError:
            time.sleep(0.1)
    return False

if not ready(8081) or not ready(8090):
    sys.exit(1)
PY
nginx -c /tmp/nginx.conf -g "daemon off;" &
nginx_pid=$!
trap 'kill "$walgit_pid" "$merge_pid" "$nginx_pid" 2>/dev/null || true' TERM INT
# tini is PID 1. A dead merge helper must exit this script so the platform
# restarts the container; nginx alone would keep serving Git while merge 502s.
while kill -0 "$walgit_pid" 2>/dev/null && kill -0 "$merge_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
  sleep 2
done
exit 1
