#!/bin/sh
set -eu
port="${PORT:-8080}"
sed "s/LISTEN_PORT/${port}/" /etc/forgit/nginx.conf.template > /tmp/nginx.conf
# walgit treats PORT as its own listen port. Keep it on 127.0.0.1:8081.
env -u PORT walgit serve --config /etc/walgit/walgit.toml &
walgit_pid=$!
python3 /usr/local/bin/forgit-merge.py &
merge_pid=$!
nginx -c /tmp/nginx.conf -g "daemon off;" &
nginx_pid=$!
trap 'kill "$walgit_pid" "$merge_pid" "$nginx_pid" 2>/dev/null || true' TERM INT
while kill -0 "$walgit_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
  sleep 2
done
exit 1
