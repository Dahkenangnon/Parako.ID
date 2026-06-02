#!/usr/bin/env bash
# =============================================================================
# parako — Parako.ID operator binary (thin wrapper over install.sh)
# License: MIT  https://github.com/Dahkenangnon/Parako.ID/blob/main/LICENSE
#
# The parako helper is purely app-file-oriented:
#   - version, paths, doctor : read-only introspection
#   - update, rollback, gc    : delegate to install.sh
#
# It does NOT manage databases, services, nginx, TLS, or production secrets.
# Those remain operator responsibilities.
# =============================================================================

set -Eeuo pipefail
IFS=$'\n\t'
shopt -s inherit_errexit 2>/dev/null || true

PARAKO_VERSION="0.2.0"
INSTALLER_URL="${PARAKO_INSTALLER_URL:-https://get.parako.id}"
DEFAULT_INSTALL_DIR_ROOT="/opt/parako-id"
DEFAULT_INSTALL_DIR_USER="${HOME:-/tmp}/parako-id"

# -----------------------------------------------------------------------------
# Colors + logging
# -----------------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[0;31m'; C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[1;33m'
  C_BLUE=$'\033[0;34m'; C_CYAN=$'\033[0;36m'
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_CYAN=""
  C_BOLD=""; C_DIM=""; C_RESET=""
fi

log_info() { printf '%s[INFO]%s %s\n' "${C_BLUE}"   "${C_RESET}" "$1"; }
log_ok()   { printf '%s[OK]%s   %s\n' "${C_GREEN}"  "${C_RESET}" "$1"; }
log_warn() { printf '%s[WARN]%s %s\n' "${C_YELLOW}" "${C_RESET}" "$1" >&2; }
log_err()  { printf '%s[FAIL]%s %s\n' "${C_RED}"    "${C_RESET}" "$1" >&2; }
die()      { log_err "$1"; exit "${2:-1}"; }

print_header() { printf '\n%s== %s%s\n' "${C_CYAN}${C_BOLD}" "$1" "${C_RESET}"; }
print_kv() { printf '  %s%-22s%s %s\n' "${C_DIM}" "$1" "${C_RESET}" "$2"; }

# -----------------------------------------------------------------------------
# Install-directory + state discovery
# -----------------------------------------------------------------------------
find_install_dir() {
  if [ -n "${PARAKO_INSTALL_DIR:-}" ] && [ -d "${PARAKO_INSTALL_DIR}" ]; then
    printf '%s' "${PARAKO_INSTALL_DIR}"
    return 0
  fi
  if [ -d "${DEFAULT_INSTALL_DIR_ROOT}" ]; then
    printf '%s' "${DEFAULT_INSTALL_DIR_ROOT}"
    return 0
  fi
  if [ -d "${DEFAULT_INSTALL_DIR_USER}" ]; then
    printf '%s' "${DEFAULT_INSTALL_DIR_USER}"
    return 0
  fi
  return 1
}

read_pkg_version() {
  local install_dir=$1
  local pkg="${install_dir}/current/package.json"
  [ -r "${pkg}" ] || { printf 'unknown'; return; }
  if command -v jq >/dev/null 2>&1; then
    jq -r '.version // "unknown"' "${pkg}"
  else
    grep -E '"version"' "${pkg}" | head -n1 \
      | sed -E 's/.*"version":[[:space:]]*"([^"]+)".*/\1/'
  fi
}

read_state_field() {
  local install_dir=$1 field=$2
  local file="${install_dir}/.parako-state"
  [ -r "${file}" ] || return 1
  grep -E "^${field}=" "${file}" | head -n1 | cut -d= -f2-
}

read_current_target() {
  local install_dir=$1
  if [ -L "${install_dir}/current" ]; then
    basename "$(readlink -f "${install_dir}/current")"
  else
    printf ''
  fi
}

# -----------------------------------------------------------------------------
# Helpers — delegate to install.sh
# -----------------------------------------------------------------------------
# Prefer a local installer (shipped beside this binary or under contrib/), fall
# back to fetching install.sh from get.parako.id.
locate_installer() {
  local install_dir candidate
  if install_dir=$(find_install_dir 2>/dev/null); then
    candidate="${install_dir}/current/contrib/install.sh"
    if [ -r "${candidate}" ]; then printf '%s' "${candidate}"; return 0; fi
  fi
  candidate="$(dirname "$0")/install.sh"
  if [ -r "${candidate}" ]; then printf '%s' "${candidate}"; return 0; fi
  return 1
}

run_installer() {
  local installer
  if installer=$(locate_installer 2>/dev/null); then
    bash "${installer}" "$@"
    return $?
  fi
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    die "no local install.sh found and neither curl nor wget available"
  fi
  log_info "fetching install.sh from ${INSTALLER_URL}"
  if command -v curl >/dev/null 2>&1; then
    bash <(curl --proto '=https' --tlsv1.2 -fsSL "${INSTALLER_URL}") "$@"
  else
    bash <(wget --secure-protocol=TLSv1_2 --https-only -qO- "${INSTALLER_URL}") "$@"
  fi
}

# -----------------------------------------------------------------------------
# Commands
# -----------------------------------------------------------------------------
cmd_version() {
  local install_dir=""
  if install_dir=$(find_install_dir 2>/dev/null); then
    local current_target previous pkg_version
    current_target=$(read_current_target "${install_dir}")
    previous=$(read_state_field "${install_dir}" PREVIOUS_VERSION 2>/dev/null || true)
    pkg_version=$(read_pkg_version "${install_dir}")
    print_header "parako"
    print_kv "parako helper"   "${PARAKO_VERSION}"
    print_kv "install dir"     "${install_dir}"
    print_kv "current release" "${current_target:-<none>}"
    print_kv "previous release" "${previous:-<none>}"
    print_kv "app version"     "${pkg_version}"
  else
    print_header "parako"
    print_kv "parako helper"   "${PARAKO_VERSION}"
    print_kv "install dir"     "<not found> (set PARAKO_INSTALL_DIR or run install)"
  fi
}

cmd_paths() {
  local install_dir
  install_dir=$(find_install_dir 2>/dev/null) \
    || die "no Parako.ID install dir found; set PARAKO_INSTALL_DIR or run the installer first"
  print_header "Parako.ID paths"
  print_kv "install dir"       "${install_dir}"
  print_kv "current symlink"   "${install_dir}/current"
  if [ -L "${install_dir}/current" ]; then
    print_kv "current target"  "$(readlink -f "${install_dir}/current")"
  fi
  print_kv "runtime"           "${install_dir}/runtime"
  print_kv "env file"          "${install_dir}/runtime/.env"
  print_kv "jwks dir"          "${install_dir}/runtime/jwks"
  print_kv "logs dir"          "${install_dir}/runtime/logs"
  print_kv "releases dir"      "${install_dir}/releases"
  print_kv "state file"        "${install_dir}/.parako-state"
  print_kv "install log dir"   "/var/log (or \$XDG_STATE_HOME/parako for non-root)"
  printf '\n  Point your supervisor (systemd / pm2 / docker) at %s/current.\n\n' "${install_dir}"
}

cmd_doctor() {
  run_installer --doctor "$@"
}

cmd_update() {
  local pass=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --version)
        [ $# -lt 2 ] && die "--version requires vX.Y.Z"
        pass+=(--version "$2"); shift 2 ;;
      *) pass+=("$1"); shift ;;
    esac
  done
  run_installer --update "${pass[@]}"
}

cmd_rollback() {
  local pass=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --to)
        [ $# -lt 2 ] && die "--to requires vX.Y.Z"
        pass+=(--to "$2"); shift 2 ;;
      *) pass+=("$1"); shift ;;
    esac
  done
  run_installer --rollback "${pass[@]}"
}

cmd_gc() {
  local pass=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --keep)
        [ $# -lt 2 ] && die "--keep requires N"
        pass+=(--keep "$2"); shift 2 ;;
      --yes) pass+=(--yes); shift ;;
      *) pass+=("$1"); shift ;;
    esac
  done
  run_installer --gc "${pass[@]}"
}

cmd_help() {
  cat <<HELPEOF
parako — Parako.ID operator binary v${PARAKO_VERSION}

Usage:
  parako <command> [options]

Commands:
  version                   Show parako, installer, and app versions
  paths                     Print resolved Parako.ID paths
  doctor                    File/config sanity report (no service / DB / network)
  update [--version vX.Y.Z] In-place application-files update
  rollback [--to vX.Y.Z]    Switch current release pointer back; app files only
  gc [--keep N] [--yes]     Prune old releases/; never touches runtime/
  help, --help, -h          Show this message

What parako does NOT do (operator responsibilities):
  - start / stop / restart your service
  - run database migrations
  - back up or restore the database
  - configure nginx, TLS, or supervisor
  - mutate runtime/.env or runtime/jwks/

For migration commands and any breaking changes, read the release notes:
  https://github.com/Dahkenangnon/Parako.ID/releases
HELPEOF
}

# -----------------------------------------------------------------------------
# Dispatcher
# -----------------------------------------------------------------------------
main() {
  if [ $# -eq 0 ]; then cmd_help; exit 0; fi
  local cmd=$1; shift
  case "${cmd}" in
    version|--version|-v) cmd_version "$@" ;;
    paths)                cmd_paths "$@" ;;
    doctor)               cmd_doctor "$@" ;;
    update)               cmd_update "$@" ;;
    rollback)             cmd_rollback "$@" ;;
    gc)                   cmd_gc "$@" ;;
    help|--help|-h)       cmd_help "$@" ;;
    *) log_err "unknown command: ${cmd}"; cmd_help; exit 2 ;;
  esac
}

main "$@"
