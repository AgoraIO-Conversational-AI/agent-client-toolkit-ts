#!/bin/sh
set -eu

node /app/server/server.mjs &
server_pid="$!"

trap 'kill "$server_pid" "$nginx_pid" 2>/dev/null || true; exit 0' INT TERM

nginx -g 'daemon off;' &
nginx_pid="$!"

while kill -0 "$server_pid" 2>/dev/null && kill -0 "$nginx_pid" 2>/dev/null; do
  sleep 1
done

kill "$server_pid" "$nginx_pid" 2>/dev/null || true
exit 1
