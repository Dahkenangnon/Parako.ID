#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
PARAKO_SH="${ROOT_DIR}/installer/parako.sh"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

test_deploy_waits_for_cold_start() (
  # shellcheck source=../parako.sh
  source "${PARAKO_SH}"

  local health_attempts=0
  local services_stopped=0

  require_root() { :; }
  cmd_config_check() { :; }
  run_bundled_cli() { :; }
  cmd_db() { :; }
  cmd_service() { :; }
  command() { :; }
  sleep() { :; }
  systemctl() {
    case "${1:-}" in
      is-active) return 0 ;;
      stop) services_stopped=1; return 0 ;;
      *) return 0 ;;
    esac
  }
  check_health() {
    health_attempts=$((health_attempts + 1))
    [ "${health_attempts}" -ge 7 ]
  }

  cmd_deploy

  [ "${health_attempts}" -eq 7 ] \
    || fail "deploy stopped polling before a 12-second cold start completed"
  [ "${services_stopped}" -eq 0 ] \
    || fail "deploy stopped healthy services after a slow cold start"
)

test_deploy_waits_for_cold_start
printf 'PASS: native deploy tolerates a cold application start\n'
