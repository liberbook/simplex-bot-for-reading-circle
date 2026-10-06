#!/usr/bin/env bash
# Builds the Docker test network, runs the end-to-end scenario and tears
# everything down (including volumes).
#   scripts/e2e.sh            run once
#   KEEP=1 scripts/e2e.sh     keep containers/volumes for inspection
# Succeeds only if the runner exits 0 AND reports that all steps passed
# (a container dying early aborts the run and must not count as success).
set -uo pipefail
cd "$(dirname "$0")/../docker"
compose() { docker compose -f compose.yml "$@"; }

./cli/fetch-cli.sh || exit 1
compose build || exit 1
compose down -v --remove-orphans >/dev/null 2>&1
compose up --exit-code-from runner --attach runner --attach bot
status=$?
if [ "$status" -eq 0 ] && ! compose logs --no-log-prefix runner 2>/dev/null | grep -q "E2E: all .* steps passed"; then
  echo "runner did not report success (a container exited early?)"
  status=1
fi
if [ "${KEEP:-0}" = "1" ]; then
  echo "containers kept; inspect with: docker compose -f docker/compose.yml logs <service>; clean up with: docker compose -f docker/compose.yml down -v"
else
  compose down -v --remove-orphans >/dev/null 2>&1
fi
echo "E2E exit code: $status"
exit $status
