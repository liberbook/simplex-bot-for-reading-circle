#!/bin/sh
# Starts simplex-chat as a WebSocket server (reachable on :5225).
#
# Env: PROFILE_KIND=bot|user   profile created on first start
#      DISPLAY_NAME=<name>
#      USE_LOCAL_RELAYS=1      test network: use ONLY the local relays whose
#                              fingerprints compose mounts at /relays/{smp,xftp}
#                              (SMP_HOST/XFTP_HOST override the host names)
#      SERVER_ARGS="..."       optional extra CLI args, e.g. "-s smp://... --xftp-server xftp://..."
#                              to use your own relays; default: SimpleX preset relays
set -eu

wait_file() {
  while [ ! -s "$1" ]; do sleep 1; done
  tr -d '\n' < "$1"
}
RELAY_ARGS=""
if [ "${USE_LOCAL_RELAYS:-0}" = "1" ]; then
  SMP_FP=$(wait_file /relays/smp/fingerprint)
  XFTP_FP=$(wait_file /relays/xftp/fingerprint)
  RELAY_ARGS="-s smp://${SMP_FP}@${SMP_HOST:-smp.test}:5223 --xftp-server xftp://${XFTP_FP}@${XFTP_HOST:-xftp.test}:443"
fi

case "${PROFILE_KIND:-user}" in
  bot) set -- --create-bot-display-name "$DISPLAY_NAME" --create-bot-allow-files "$@" ;;
  *)   set -- --user-display-name "$DISPLAY_NAME" "$@" ;;
esac

# The CLI's WebSocket server listens on 127.0.0.1 only; bridge the container
# port 5225 to it so the bot / test runner in other containers can connect.
CLI_PORT=5226
socat TCP-LISTEN:5225,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:${CLI_PORT} &

# db, received files and the temp folder share one volume: the CLI moves
# finished downloads from the temp folder into the files folder with rename(2),
# which fails across filesystems.
mkdir -p /data/db /data/files /data/tmp

# shellcheck disable=SC2086  # word splitting of the *_ARGS strings is intended
exec simplex-chat -p ${CLI_PORT} -d /data/db/chat --files-folder /data/files --temp-folder /data/tmp -y \
  ${RELAY_ARGS} ${SERVER_ARGS:-} "$@"
