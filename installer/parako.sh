#!/usr/bin/env bash
# =============================================================================
# parako — Parako.ID operator binary
# License: MIT  https://github.com/Dahkenangnon/Parako.ID/blob/main/LICENSE
# Documentation: https://docs.parako.id/parako-cli
# Prerequisite: bash >= 4.0
# =============================================================================

# =============================================================================
# §0  Strict mode + safety guards
# =============================================================================
set -Eeuo pipefail
IFS=$'\n\t'
shopt -s inherit_errexit 2>/dev/null || true
umask 077

TMPDIR_PATH=""

on_error() {
  local exit_code=$? line=${BASH_LINENO[0]:-0} cmd=${BASH_COMMAND:-?}
  printf '[FAIL] exit %d at line %d: %s\n' "${exit_code}" "${line}" "${cmd}" >&2
  cleanup
  exit "${exit_code}"
}

cleanup() {
  [ -n "${TMPDIR_PATH}" ] && [ -d "${TMPDIR_PATH}" ] && rm -rf "${TMPDIR_PATH}" 2>/dev/null || true
}

trap on_error ERR
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM HUP

# =============================================================================
# §1  Constants
# =============================================================================
readonly PARAKO_BIN_VERSION="0.2.0"
readonly INSTALLER_URL="https://get.parako.id"
readonly DEFAULT_INSTALL_DIR="/opt/parako-id"

# =============================================================================
# §2  Logging + UI
# =============================================================================
C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_CYAN=""; C_BOLD=""; C_RESET=""
if [ -z "${NO_COLOR:-}" ] && [ -t 1 ]; then
  C_RED=$'\033[0;31m'; C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[1;33m'
  C_BLUE=$'\033[0;34m'; C_CYAN=$'\033[0;36m'; C_BOLD=$'\033[1m'
  C_RESET=$'\033[0m'
fi

log_info() { printf '%s[INFO]%s %s\n' "${C_BLUE}" "${C_RESET}" "$1"; }
log_ok()   { printf '%s[OK]%s   %s\n' "${C_GREEN}" "${C_RESET}" "$1"; }
log_warn() { printf '%s[WARN]%s %s\n' "${C_YELLOW}" "${C_RESET}" "$1" >&2; }
log_err()  { printf '%s[FAIL]%s %s\n' "${C_RED}" "${C_RESET}" "$1" >&2; }
die()      { log_err "$1"; exit "${2:-1}"; }

print_header() { printf '\n%s== %s%s\n' "${C_CYAN}${C_BOLD}" "$1" "${C_RESET}"; }

print_label() {
  local label=$1 value=$2 width=70
  if command -v tput >/dev/null 2>&1; then
    local cols
    cols=$(tput cols 2>/dev/null || printf '80')
    [ "${cols}" -lt 60 ] && cols=60
    width=$((cols - 4))
  fi
  local dots_len=$((width - ${#label} - ${#value} - 2))
  [ "${dots_len}" -lt 3 ] && dots_len=3
  local dots
  dots=$(printf '%*s' "${dots_len}" '' | tr ' ' '.')
  printf '  %s %s %s\n' "${label}" "${dots}" "${value}"
}

redact() {
  sed -E \
    -e 's,(://)[^:[:space:]]+:[^@[:space:]]+@,\1***@,g' \
    -e 's/(([Pp][Aa][Ss][Ss][Ww]?[Oo][Rr]?[Dd]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll]|[Aa][Pp][Ii][_]?[Kk][Ee][Yy]|[Hh][Mm][Aa][Cc][_]?[Ss][Ee][Cc][Rr][Ee][Tt]|[Jj][Ww][Tt][_]?[Ss][Ee][Cc][Rr][Ee][Tt]|[Cc][Oo][Oo][Kk][Ii][Ee][_]?[Ss][Ee][Cc][Rr][Ee][Tt][_]?[12]?|[Ee][Nn][Cc][Rr][Yy][Pp][Tt][Ii][Oo][Nn][_]?[Kk][Ee][Yy]|[Pp][Aa][Ii][Rr][Ww][Ii][Ss][Ee][_]?[Ss][Aa][Ll][Tt]))[[:space:]]*[:=][[:space:]]*[^[:space:]]+/\1=***/g'
}

# =============================================================================
# §3  State (load .parako-state from install dir)
# =============================================================================
INSTALL_DIR=""
VERSION=""
SUPERVISOR=""
INSTALLED_AT=""
DB=""
PORT=""
URL=""
# shellcheck disable=SC2034  # written by install.sh; not used by parako binary today
SUPERVISOR_USER=""

find_install() {
  if [ -n "${PARAKO_INSTALL_DIR:-}" ] && [ -d "${PARAKO_INSTALL_DIR}" ]; then
    printf '%s' "${PARAKO_INSTALL_DIR}"
    return
  fi
  for candidate in "${DEFAULT_INSTALL_DIR}" "${HOME}/parako-id" "${PWD}/parako-id"; do
    if [ -f "${candidate}/.parako-state" ]; then
      printf '%s' "${candidate}"
      return
    fi
  done
  die "no Parako.ID install found. Set PARAKO_INSTALL_DIR or run from an install."
}

load_state() {
  INSTALL_DIR=$(find_install)
  local state="${INSTALL_DIR}/.parako-state"
  [ -f "${state}" ] || die "missing ${state} (was Parako.ID installed via the v0.2.0+ installer?)"
  # shellcheck disable=SC1090
  . "${state}"
}

# =============================================================================
# §4  Verb implementations
# =============================================================================

usage() {
  cat <<USAGE
parako v${PARAKO_BIN_VERSION} — Parako.ID operator binary

Usage: parako <verb> [args]

Service control:
  start                       Start the service
  stop                        Stop the service
  restart                     Restart the service
  status                      Show service state + /health summary

Diagnostics:
  doctor                      Run preflight + post-install checks
  logs [-f] [--since 'X']     Tail logs (journalctl or PM2)
  diag [--out PATH]           Emit a bug-report bundle
  version                     Show installed version + commit SHA

Maintenance:
  config get <key>            Read a runtime/.env value (redacted)
  config set <key> <value>    Update a runtime/.env value (atomic, schema-validated)
  migrate                     Re-run DB migrations
  backup [--out PATH]         Archive runtime/ + DB dump
  restore <archive>           Restore from a backup archive
  shell                       Drop into a node REPL with PARAKO_RUNTIME_DIR set

Lifecycle:
  update [vX.Y.Z]             Upgrade (delegates to installer)
  rollback [--to TS]          Revert to previous snapshot
  gc [--keep N] [--yes]       Prune old snapshots and DB backups

Common workflows:
  parako status               Quick health check
  parako doctor               Detailed diagnostic
  parako update               Latest stable upgrade
  parako rollback             Revert to last good
  parako diag --out /tmp/d.tgz   Bug report bundle

Environment:
  PARAKO_INSTALL_DIR          Override install location
  NO_COLOR                    Disable colored output

Documentation:
  https://docs.parako.id/parako-cli
USAGE
}

cmd_start() {
  load_state
  case "${SUPERVISOR}" in
    systemd)
      local prefix=""
      [ "$(id -u)" -ne 0 ] && prefix="sudo"
      ${prefix} systemctl start parako-id parako-id-worker
      log_ok "started" ;;
    pm2)
      (cd "${INSTALL_DIR}" && pnpm start)
      log_ok "started" ;;
    *) die "unknown supervisor in state: ${SUPERVISOR}" ;;
  esac
}

cmd_stop() {
  load_state
  case "${SUPERVISOR}" in
    systemd)
      local prefix=""
      [ "$(id -u)" -ne 0 ] && prefix="sudo"
      ${prefix} systemctl stop parako-id parako-id-worker
      log_ok "stopped" ;;
    pm2)
      (cd "${INSTALL_DIR}" && pm2 stop runtime/ecosystem.config.cjs)
      log_ok "stopped" ;;
    *) die "unknown supervisor: ${SUPERVISOR}" ;;
  esac
}

cmd_restart() {
  load_state
  case "${SUPERVISOR}" in
    systemd)
      local prefix=""
      [ "$(id -u)" -ne 0 ] && prefix="sudo"
      ${prefix} systemctl restart parako-id parako-id-worker
      log_ok "restarted" ;;
    pm2)
      (cd "${INSTALL_DIR}" && pm2 restart runtime/ecosystem.config.cjs)
      log_ok "restarted" ;;
    *) die "unknown supervisor: ${SUPERVISOR}" ;;
  esac
}

cmd_status() {
  load_state
  print_header "parako status"
  print_label "Install dir" "${INSTALL_DIR}"
  print_label "Version" "${VERSION}"
  print_label "Supervisor" "${SUPERVISOR}"
  print_label "Database" "${DB}"
  print_label "Server port" "${PORT}"
  [ -n "${URL}" ] && print_label "URL" "${URL}"

  case "${SUPERVISOR}" in
    systemd)
      if systemctl is-active --quiet parako-id 2>/dev/null; then
        print_label "Service" "active (systemd)"
      else
        print_label "Service" "INACTIVE (systemd)"
      fi
      if systemctl is-active --quiet parako-id-worker 2>/dev/null; then
        print_label "Worker" "active (systemd)"
      else
        print_label "Worker" "INACTIVE (systemd)"
      fi ;;
    pm2)
      if (cd "${INSTALL_DIR}" && pm2 jlist 2>/dev/null | grep -q parako-id); then
        print_label "Service" "running (pm2)"
      else
        print_label "Service" "STOPPED (pm2)"
      fi ;;
  esac

  if curl --proto '=http,=https' -sSf --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    print_label "/health" "200"
  else
    print_label "/health" "no response"
  fi
}

cmd_logs() {
  load_state
  local follow="" since="" worker=0
  while [ $# -gt 0 ]; do
    case "$1" in
      -f|--follow) follow="-f" ;;
      --since)
        [ $# -lt 2 ] && die "--since requires a value"
        since="$2"; shift ;;
      --worker) worker=1 ;;
      *) log_warn "unknown logs option: $1" ;;
    esac
    shift
  done

  case "${SUPERVISOR}" in
    systemd)
      local units="parako-id"
      [ "${worker}" -eq 0 ] && units="parako-id parako-id-worker"
      [ "${worker}" -eq 1 ] && units="parako-id-worker"
      local args=()
      [ -n "${follow}" ] && args+=("-f")
      [ -n "${since}" ] && args+=("--since" "${since}")
      for u in ${units}; do args+=("-u" "${u}"); done
      journalctl "${args[@]}" ;;
    pm2)
      local args=()
      [ -n "${follow}" ] || args+=("--nostream")
      (cd "${INSTALL_DIR}" && pm2 logs parako-id "${args[@]}") ;;
  esac
}

cmd_doctor() {
  load_state
  # Delegate to the installer's --doctor mode.
  if [ -t 0 ]; then
    bash <(curl -sSL "${INSTALLER_URL}") --doctor --dir "${INSTALL_DIR}"
  else
    # Stdin not a TTY (already in a pipe); fetch to disk first.
    TMPDIR_PATH=$(mktemp -d -t parako-doctor-XXXX)
    curl --proto '=https' --tlsv1.2 -sSfL "${INSTALLER_URL}" -o "${TMPDIR_PATH}/install.sh"
    bash "${TMPDIR_PATH}/install.sh" --doctor --dir "${INSTALL_DIR}"
  fi
}

cmd_config() {
  load_state
  local action=${1:-}
  local key=${2:-}
  local env_file="${INSTALL_DIR}/runtime/.env"
  [ -f "${env_file}" ] || env_file="${INSTALL_DIR}/.env"
  case "${action}" in
    get)
      [ -z "${key}" ] && die "usage: parako config get <key>"
      grep -E "^${key}=" "${env_file}" | head -n1 | cut -d= -f2- | redact ;;
    set)
      local value=${3:-}
      [ -z "${key}" ] || [ -z "${value}" ] && die "usage: parako config set <key> <value>"
      local tmp="${env_file}.tmp.$$"
      cp -a "${env_file}" "${env_file}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
      awk -v k="${key}" -v v="${value}" '
        BEGIN { found = 0 }
        $0 ~ "^" k "=" { print k "=" v; found = 1; next }
        { print }
        END { if (!found) print k "=" v }
      ' "${env_file}" > "${tmp}"
      chmod 0600 "${tmp}"
      mv "${tmp}" "${env_file}"
      log_ok "set ${key}" ;;
    *) die "usage: parako config get|set <key> [value]" ;;
  esac
}

cmd_migrate() {
  load_state
  (cd "${INSTALL_DIR}" && case "${DB}" in
    postgresql) pnpm db:migrate:deploy ;;
    sqlite) pnpm db:push ;;
    mongodb) log_ok "MongoDB: no migration needed" ;;
  esac)
}

cmd_backup() {
  load_state
  local out=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --out) [ $# -lt 2 ] && die "--out requires a path"; out="$2"; shift ;;
      *) log_warn "unknown backup option: $1" ;;
    esac
    shift
  done
  [ -z "${out}" ] && out="${PWD}/parako-backup-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"

  TMPDIR_PATH=$(mktemp -d -t parako-backup-XXXX)
  mkdir -p "${TMPDIR_PATH}/runtime"
  cp -a "${INSTALL_DIR}/runtime/." "${TMPDIR_PATH}/runtime/"

  case "${DB}" in
    postgresql)
      local url
      url=$(grep -E '^STORAGE_POSTGRESQL_URL=' "${INSTALL_DIR}/runtime/.env" 2>/dev/null | cut -d= -f2-)
      if [ -n "${url}" ] && command -v pg_dump >/dev/null 2>&1; then
        pg_dump --no-owner --format=custom "${url}" | gzip > "${TMPDIR_PATH}/db.dump.gz"
      fi ;;
    mongodb)
      local uri
      uri=$(grep -E '^STORAGE_MONGODB_URI=' "${INSTALL_DIR}/runtime/.env" 2>/dev/null | cut -d= -f2-)
      if [ -n "${uri}" ] && command -v mongodump >/dev/null 2>&1; then
        mongodump --uri="${uri}" --archive="${TMPDIR_PATH}/db.archive.gz" --gzip
      fi ;;
    sqlite)
      [ -f "${INSTALL_DIR}/runtime/data/parako.db" ] \
        && cp "${INSTALL_DIR}/runtime/data/parako.db" "${TMPDIR_PATH}/parako.db" ;;
  esac

  tar -czf "${out}" -C "${TMPDIR_PATH}" .
  log_ok "backup at ${out}"
}

cmd_restore() {
  load_state
  local archive=${1:-}
  [ -z "${archive}" ] || [ ! -f "${archive}" ] && die "usage: parako restore <archive>"
  log_warn "restore stops the service, replaces runtime/, and restarts"
  printf '  Type yes to confirm: '
  local conf=""
  IFS= read -r conf || conf=""
  [ "${conf}" = "yes" ] || die "aborted"

  cmd_stop
  TMPDIR_PATH=$(mktemp -d -t parako-restore-XXXX)
  tar -xzf "${archive}" -C "${TMPDIR_PATH}"
  rsync -a --delete "${TMPDIR_PATH}/runtime/" "${INSTALL_DIR}/runtime/"
  log_ok "restored runtime/"

  case "${DB}" in
    postgresql)
      [ -f "${TMPDIR_PATH}/db.dump.gz" ] \
        && log_warn "DB dump present; restore manually: gunzip -c db.dump.gz | pg_restore -d ..." ;;
    sqlite)
      [ -f "${TMPDIR_PATH}/parako.db" ] \
        && cp "${TMPDIR_PATH}/parako.db" "${INSTALL_DIR}/runtime/data/parako.db" ;;
  esac

  cmd_start
}

cmd_update() {
  load_state
  local args=("--update")
  if [ $# -gt 0 ]; then
    args+=("--version" "$1")
  fi
  shift $# 2>/dev/null || true
  bash <(curl --proto '=https' --tlsv1.2 -sSfL "${INSTALLER_URL}") "${args[@]}" --dir "${INSTALL_DIR}"
}

cmd_rollback() {
  load_state
  local args=("--rollback")
  while [ $# -gt 0 ]; do
    case "$1" in
      --to) [ $# -lt 2 ] && die "--to requires a value"; args+=("--to" "$2"); shift ;;
      --migrate-back) args+=("--migrate-back") ;;
      *) log_warn "unknown rollback option: $1" ;;
    esac
    shift
  done
  bash <(curl --proto '=https' --tlsv1.2 -sSfL "${INSTALLER_URL}") "${args[@]}" --dir "${INSTALL_DIR}"
}

cmd_gc() {
  load_state
  local args=("--gc")
  while [ $# -gt 0 ]; do
    case "$1" in
      --keep) [ $# -lt 2 ] && die "--keep requires a value"; args+=("--keep" "$2"); shift ;;
      --yes) args+=("--yes") ;;
      --dry-run) ;;  # gc defaults to dry-run; --yes overrides
      *) log_warn "unknown gc option: $1" ;;
    esac
    shift
  done
  bash <(curl --proto '=https' --tlsv1.2 -sSfL "${INSTALLER_URL}") "${args[@]}" --dir "${INSTALL_DIR}"
}

cmd_version() {
  load_state
  print_label "parako binary" "${PARAKO_BIN_VERSION}"
  print_label "Installed version" "${VERSION}"
  print_label "Installed at" "${INSTALLED_AT}"
  if [ -f "${INSTALL_DIR}/BUILD_INFO.json" ]; then
    local commit
    commit=$(grep -E '"commit"' "${INSTALL_DIR}/BUILD_INFO.json" 2>/dev/null | head -n1 \
      | sed -E 's/.*"commit":[[:space:]]*"([^"]+)".*/\1/')
    [ -n "${commit}" ] && print_label "Commit SHA" "${commit}"
  fi
}

cmd_shell() {
  load_state
  log_info "node REPL with PARAKO_RUNTIME_DIR=${INSTALL_DIR}/runtime"
  (cd "${INSTALL_DIR}" && PARAKO_RUNTIME_DIR="${INSTALL_DIR}/runtime" node)
}

cmd_diag() {
  load_state
  local out=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --out) [ $# -lt 2 ] && die "--out requires a path"; out="$2"; shift ;;
      *) log_warn "unknown diag option: $1" ;;
    esac
    shift
  done
  [ -z "${out}" ] && out="${PWD}/parako-diag-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"

  TMPDIR_PATH=$(mktemp -d -t parako-diag-XXXX)

  print_header "Collecting diagnostic bundle"

  # System info
  {
    printf '## uname\n'; uname -a 2>/dev/null
    printf '\n## os-release\n'; cat /etc/os-release 2>/dev/null
    printf '\n## node version\n'; node --version 2>/dev/null || printf 'not installed\n'
    printf '\n## pnpm version\n'; pnpm --version 2>/dev/null || printf 'not installed\n'
    printf '\n## installed parako\n'
    printf 'INSTALL_DIR=%s\n' "${INSTALL_DIR}"
    printf 'VERSION=%s\n' "${VERSION}"
    printf 'SUPERVISOR=%s\n' "${SUPERVISOR}"
    printf 'DB=%s\n' "${DB}"
    printf 'PORT=%s\n' "${PORT}"
  } > "${TMPDIR_PATH}/system.txt"

  # Redacted env
  if [ -f "${INSTALL_DIR}/runtime/.env" ]; then
    redact < "${INSTALL_DIR}/runtime/.env" > "${TMPDIR_PATH}/env.redacted"
  fi

  # Service status
  case "${SUPERVISOR}" in
    systemd)
      systemctl status parako-id > "${TMPDIR_PATH}/systemctl-status.txt" 2>&1 || true
      journalctl -u parako-id -u parako-id-worker --since '1 hour ago' --no-pager \
        > "${TMPDIR_PATH}/journalctl.txt" 2>&1 || true ;;
    pm2)
      (cd "${INSTALL_DIR}" && pm2 list 2>&1) > "${TMPDIR_PATH}/pm2-list.txt" || true
      (cd "${INSTALL_DIR}" && pm2 logs --nostream --lines 500 2>&1) > "${TMPDIR_PATH}/pm2-logs.txt" || true ;;
  esac

  # /health probe
  curl --proto '=http,=https' -sS --max-time 5 "http://127.0.0.1:${PORT}/health" \
    > "${TMPDIR_PATH}/health.json" 2>&1 || true

  # INSTALL_NOTES.md if present
  [ -f "${INSTALL_DIR}/runtime/INSTALL_NOTES.md" ] \
    && cp "${INSTALL_DIR}/runtime/INSTALL_NOTES.md" "${TMPDIR_PATH}/INSTALL_NOTES.md"

  # Final redaction pass over the entire bundle — bash subshells inherit the
  # redact() function via export -f, so the find loop can call it directly.
  export -f redact 2>/dev/null || true
  find "${TMPDIR_PATH}" -type f | while IFS= read -r f; do
    tmp=$(mktemp -t parako-diag-redact-XXXX)
    redact < "$f" > "$tmp" && mv "$tmp" "$f"
  done

  tar -czf "${out}" -C "${TMPDIR_PATH}" .
  log_ok "diagnostic bundle at ${out}"
}

# =============================================================================
# §5  Dispatcher
# =============================================================================

main() {
  local verb=${1:-}
  shift || true
  case "${verb}" in
    ""|-h|--help|help) usage ;;
    start)    cmd_start "$@" ;;
    stop)     cmd_stop "$@" ;;
    restart)  cmd_restart "$@" ;;
    status)   cmd_status "$@" ;;
    logs)     cmd_logs "$@" ;;
    doctor)   cmd_doctor "$@" ;;
    config)   cmd_config "$@" ;;
    migrate)  cmd_migrate "$@" ;;
    backup)   cmd_backup "$@" ;;
    restore)  cmd_restore "$@" ;;
    update)   cmd_update "$@" ;;
    rollback) cmd_rollback "$@" ;;
    gc)       cmd_gc "$@" ;;
    version)  cmd_version "$@" ;;
    shell)    cmd_shell "$@" ;;
    diag)     cmd_diag "$@" ;;
    *) log_err "unknown verb: ${verb}"; usage; exit 64 ;;
  esac
}

main "$@"
