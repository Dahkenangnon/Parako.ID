#!/usr/bin/env bash
# =============================================================================
# parako — Parako.ID operator binary (thin wrapper over install.sh)
# License: MIT  https://github.com/Dahkenangnon/Parako.ID/blob/main/LICENSE
#
# The parako helper is purely app-file-oriented:
#   - version, paths, doctor : read-only introspection
#   - update, rollback, gc    : delegate to install.sh
#
# Scope: application files only. Database, services, reverse proxy, TLS,
# and runtime configuration remain operator-managed.
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
  local installer install_dir
  # Inject --dir from the PARAKO_INSTALL_DIR-aware resolver if the caller did
  # not pass one. install.sh's own default is /opt/parako-id, which silently
  # misses non-root installs in $HOME or any PARAKO_INSTALL_DIR override.
  local injected=()
  if [[ " $* " != *" --dir "* ]]; then
    if install_dir=$(find_install_dir 2>/dev/null); then
      injected=(--dir "${install_dir}")
    fi
  fi
  if installer=$(locate_installer 2>/dev/null); then
    bash "${installer}" "${injected[@]}" "$@"
    return $?
  fi
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    die "no local install.sh found and neither curl nor wget available"
  fi
  log_info "fetching install.sh from ${INSTALLER_URL}"
  if command -v curl >/dev/null 2>&1; then
    bash <(curl --proto '=https' --tlsv1.2 -fsSL "${INSTALLER_URL}") "${injected[@]}" "$@"
  else
    bash <(wget --secure-protocol=TLSv1_2 --https-only -qO- "${INSTALLER_URL}") "${injected[@]}" "$@"
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

cmd_uninstall() {
  local pass=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --purge|--keep-bin|--yes|--non-interactive|--force|--no-color)
        pass+=("$1"); shift ;;
      *) pass+=("$1"); shift ;;
    esac
  done
  run_installer --uninstall "${pass[@]}"
}

cmd_clean_stale() {
  run_installer --clean-stale --doctor "$@"
}

cmd_self_update() {
  local from_url="" force=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --from-url)
        [ $# -lt 2 ] && die "--from-url requires a URL"
        from_url=$2; shift 2 ;;
      --force) force=1; shift ;;
      *) shift ;;
    esac
  done

  # Resolve the current binary path. Prefer the live executable that invoked
  # this shell; fall back to PATH lookup.
  local target_path=""
  if [ -n "${PARAKO_SELF_PATH:-}" ]; then
    target_path=${PARAKO_SELF_PATH}
  elif [ -L "${0}" ] || [ -f "${0}" ]; then
    case "${0}" in
      /*) target_path=${0} ;;
      *)  target_path=$(command -v parako 2>/dev/null || true) ;;
    esac
  fi
  [ -z "${target_path}" ] && target_path=$(command -v parako 2>/dev/null || true)
  [ -z "${target_path}" ] && die "could not resolve parako binary path; pass PARAKO_SELF_PATH=/path/to/parako"

  # Resolve the source. Prefer the contrib copy inside the current install
  # (already cosign-verified at install time). Fall back to fetching from
  # get.parako.id.
  local install_dir source_file="" source_label=""
  if [ -z "${from_url}" ] && install_dir=$(find_install_dir 2>/dev/null); then
    local candidate="${install_dir}/current/contrib/parako.sh"
    if [ -r "${candidate}" ]; then
      source_file=${candidate}
      source_label="cosign-verified ${candidate}"
    fi
  fi

  local tmp; tmp=$(mktemp) || die "could not create temp file"
  trap "rm -f '${tmp}'" EXIT

  if [ -z "${source_file}" ]; then
    local url=${from_url:-${INSTALLER_URL%/install.sh}/parako.sh}
    case "${url}" in
      https://*) ;;
      *) die "--from-url must be an HTTPS URL: ${url}" ;;
    esac
    log_info "fetching ${url}"
    if command -v curl >/dev/null 2>&1; then
      curl --proto '=https' --tlsv1.2 -fsSL "${url}" -o "${tmp}" \
        || die "fetch failed: ${url}"
    elif command -v wget >/dev/null 2>&1; then
      wget --secure-protocol=TLSv1_2 --https-only -qO "${tmp}" "${url}" \
        || die "fetch failed: ${url}"
    else
      die "no curl or wget available; install one or pass --from-url"
    fi
    source_label="TLS-only fetch from ${url}"
  else
    cp -f "${source_file}" "${tmp}" || die "could not stage source: ${source_file}"
  fi

  # Sanity gate
  [ -s "${tmp}" ] || die "downloaded helper is empty"
  head -n1 "${tmp}" | grep -q '^#!/usr/bin/env bash' \
    || die "downloaded file is not a bash script (missing shebang); refusing to install"
  bash -n "${tmp}" || die "downloaded helper has a syntax error; refusing to install"

  local new_version
  new_version=$(grep -m1 '^PARAKO_VERSION=' "${tmp}" | cut -d= -f2 | tr -d '"' || true)
  [ -n "${new_version}" ] || die "downloaded helper has no PARAKO_VERSION; refusing to install"

  if [ "${new_version}" = "${PARAKO_VERSION}" ] && [ "${force}" -eq 0 ]; then
    log_ok "parako helper already at v${PARAKO_VERSION} (use --force to reinstall)"
    return 0
  fi

  # Atomic replace.
  local need_sudo=""
  [ -w "${target_path}" ] || need_sudo="sudo"
  if [ -n "${need_sudo}" ] && [ "$(id -u)" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
    die "no write access to ${target_path}; install manually:
  cp ${tmp} ${target_path} && chmod 0755 ${target_path}"
  fi

  if ${need_sudo} install -m 0755 "${tmp}" "${target_path}"; then
    if [ "${new_version}" = "${PARAKO_VERSION}" ]; then
      log_ok "parako helper v${PARAKO_VERSION} reinstalled (forced; source: ${source_label})"
    else
      log_ok "parako helper v${PARAKO_VERSION} → v${new_version} (source: ${source_label})"
    fi
  else
    die "atomic replace failed; install manually:
  cp ${tmp} ${target_path} && chmod 0755 ${target_path}"
  fi
}

cmd_help() {
  cat <<HELPEOF
parako — Parako.ID operator binary v${PARAKO_VERSION}

Usage:
  parako <command> [options]

Commands:
  version                       Show parako, installer, and app versions
  paths                         Print resolved Parako.ID paths
  doctor                        File/config sanity report (no service / DB / network)
  update [--version vX.Y.Z]     In-place application-files update
  rollback [--to vX.Y.Z]        Switch current release pointer back; app files only
  gc [--keep N] [--yes]         Prune old releases/; never touches runtime/
  clean-stale                   Remove stale current.tmp.* symlinks from a crashed run
  self-update [--force]         Refresh this parako helper to the latest version
  uninstall [--purge] [--keep-bin]
                                Remove this install (preserves runtime/ unless --purge)
  help, --help, -h              Show this message

Scope:
  Application files only. The operator manages service lifecycle, database
  migrations and backups, reverse proxy, TLS, and runtime configuration
  (runtime/.env, runtime/jwks/).

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
    uninstall)            cmd_uninstall "$@" ;;
    self-update)          cmd_self_update "$@" ;;
    clean-stale)          cmd_clean_stale "$@" ;;
    doctor)               cmd_doctor "$@" ;;
    update)               cmd_update "$@" ;;
    rollback)             cmd_rollback "$@" ;;
    gc)                   cmd_gc "$@" ;;
    help|--help|-h)       cmd_help "$@" ;;
    *) log_err "unknown command: ${cmd}"; cmd_help; exit 2 ;;
  esac
}

main "$@"
