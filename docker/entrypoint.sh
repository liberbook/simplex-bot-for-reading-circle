#!/bin/bash
# Runs the two processes of the bot in one container and stops when either
# ends (so the container restarts as a whole under `restart: unless-stopped`).
# Starts as root only to give /data to the `bot` user, then re-executes itself
# unprivileged.
#
# /data (mount it):  conatus.json  settings (optional; env CONATUS_* work too)
#                    db/  files/  deleted/  state/  tmp/   created here
# Env: BOT_NAME          display name, used when the profile is created on the first start
#      SERVER_ARGS       extra CLI args, e.g. "-s smp://... --xftp-server xftp://..." for own relays
#      USE_LOCAL_RELAYS  =1 in the test network: use only the relays whose fingerprints are in /relays
set -euo pipefail
DIRS=(db files deleted state tmp)

if [ "$(id -u)" = "0" ]; then
  for d in "${DIRS[@]}"; do mkdir -p "/data/$d"; done
  for d in /data "${DIRS[@]/#//data/}"; do
    [ "$(stat -c %u "$d")" = "1000" ] || chown -R bot:bot "$d"
  done
  exec setpriv --reuid=bot --regid=bot --init-groups "$0" "$@"
fi

RELAY_ARGS=""
if [ "${USE_LOCAL_RELAYS:-0}" = "1" ]; then
  while [ ! -s /relays/smp/fingerprint ] || [ ! -s /relays/xftp/fingerprint ]; do sleep 1; done
  RELAY_ARGS="-s smp://$(tr -d '\n' < /relays/smp/fingerprint)@${SMP_HOST:-smp.test}:5223 \
              --xftp-server xftp://$(tr -d '\n' < /relays/xftp/fingerprint)@${XFTP_HOST:-xftp.test}:443"
fi
CONFIG_ARGS=""
[ -f /data/conatus.json ] && CONFIG_ARGS="--config /data/conatus.json"

# The CLI echoes every command it receives; drop that chatter so the container log shows the bot's log.
# shellcheck disable=SC2086
simplex-chat -p 5225 -d /data/db/chat --files-folder /data/files --temp-folder /data/tmp -y \
  --create-bot-display-name "${BOT_NAME:-conatus}" --create-bot-allow-files ${RELAY_ARGS} ${SERVER_ARGS:-} \
  > >(grep --line-buffered -v -E '^(received command "|client connected$|Current user: )' | sed -u 's/^/cli: /') 2>&1 &
CLI=$!
# paths inside the container are fixed; they override the config file
# shellcheck disable=SC2086
node /app/src/main.js ${CONFIG_ARGS} --server ws://127.0.0.1:5225 --dir /data/files --deleted-dir /data/deleted --state-dir /data/state &
BOT=$!

stop() { kill "$CLI" "$BOT" 2>/dev/null || true; }
trap stop TERM INT
wait -n "$CLI" "$BOT" || true
echo "a process ended, stopping the container"
stop
wait || true
