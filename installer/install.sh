#!/usr/bin/env bash
# =============================================================================
# Parako.ID installer / updater and production lifecycle bootstrap.
# License: MIT  https://github.com/Dahkenangnon/Parako.ID/blob/main/LICENSE
# Threat model: docs/installer-security.md
#
# Responsibility statement:
#   This installer/updater safely places and updates Parako application files.
#   It verifies the release artifact, stages it, preserves operator-owned
#   runtime/config files, and switches the application release pointer.
#   The companion parako command manages migrations, backups, and systemd.
#   Reverse proxy, TLS, and application/OIDC settings remain operator-managed.
#
# Prerequisites:
#   - Debian 12 or Ubuntu 24.04, x86_64 or aarch64.
#   - bash >= 4.0 (Alpine: `apk add bash` first).
#   - GNU coreutils (for `mv -T`) and util-linux (for `flock`).
#     Alpine: `apk add coreutils util-linux` first.
#   - curl OR wget, openssl, tar, >= 2 GB free disk.
# =============================================================================

# -----------------------------------------------------------------------------
# §0  Strict mode + safety guards
# -----------------------------------------------------------------------------
set -Eeuo pipefail
IFS=$'\n\t'
shopt -s inherit_errexit 2>/dev/null || true
umask 077

TMPDIR_PATH=""
LOCK_FD=""
LOG_FILE=""
STAGING_DIR=""
CURRENT_TMP=""

on_error() {
  local exit_code=$? line=${BASH_LINENO[0]:-0} cmd=${BASH_COMMAND:-?}
  if declare -F log_err >/dev/null 2>&1; then
    log_err "exit ${exit_code} at line ${line}: ${cmd}"
  else
    printf '[FAIL] exit %d at line %d: %s\n' "${exit_code}" "${line}" "${cmd}" >&2
  fi
  cleanup
  exit "${exit_code}"
}

cleanup() {
  if [ -n "${STAGING_DIR}" ] && [ -d "${STAGING_DIR}" ]; then
    rm -rf "${STAGING_DIR}" 2>/dev/null || true
  fi
  if [ -n "${CURRENT_TMP}" ] && [ -L "${CURRENT_TMP}" ]; then
    rm -f "${CURRENT_TMP}" 2>/dev/null || true
  fi
  if [ -n "${TMPDIR_PATH}" ] && [ -d "${TMPDIR_PATH}" ]; then
    rm -rf "${TMPDIR_PATH}" 2>/dev/null || true
  fi
  if [ -n "${LOCK_FD}" ]; then
    exec 9>&- 2>/dev/null || true
  fi
}

on_interrupt() {
  if declare -F log_warn >/dev/null 2>&1; then
    log_warn "interrupted by signal"
  else
    printf '[WARN] interrupted\n' >&2
  fi
  cleanup
  exit 130
}

trap on_error ERR
trap cleanup EXIT
trap on_interrupt INT TERM HUP

# -----------------------------------------------------------------------------
# §1  Constants
# -----------------------------------------------------------------------------
readonly INSTALLER_VERSION="0.3.0"
readonly REPO_OWNER="Dahkenangnon"
readonly REPO_NAME="Parako.ID"
readonly GITHUB_API="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}"
readonly MIN_BASH_MAJOR=4
readonly MIN_DISK_BYTES=2147483648  # 2 GiB

# Cosign bootstrap chain-of-trust constants. When bumping COSIGN_VERSION,
# refresh both SHA values from sigstore/cosign's cosign_checksums.txt.
# https://github.com/sigstore/cosign/releases
readonly COSIGN_VERSION="2.4.1"
readonly COSIGN_SHA256_LINUX_AMD64="8b24b946dd5809c6bd93de08033bcf6bc0ed7d336b7785787c080f574b89249b"
readonly COSIGN_SHA256_LINUX_ARM64="3b2e2e3854d0356c45fe6607047526ccd04742d20bd44afb5be91fa2a6e7cb4a"
readonly COSIGN_CERT_IDENTITY_REGEX='https://github\.com/Dahkenangnon/Parako\.ID/\.github/workflows/release\.yml@.*'
readonly COSIGN_OIDC_ISSUER='https://token.actions.githubusercontent.com'

# Runtime subtrees the installer is allowed to copy out of the tarball into
# INSTALL_DIR/runtime/ on FIRST install only. Defense in depth: scripts/release.sh
# also sanitizes the tarball so the source paths shouldn't contain anything else.
readonly RUNTIME_FIRST_INSTALL_ALLOWLIST=(locales views)

if [ "$(id -u 2>/dev/null || printf '1000')" = "0" ]; then
  readonly DEFAULT_INSTALL_DIR="/opt/parako-id"
  readonly DEFAULT_LOG_DIR="/var/log"
  readonly DEFAULT_LOCK_DIR="/var/lock"
  readonly DEFAULT_BIN_DIR="/usr/local/bin"
  readonly RUNNING_AS_ROOT=1
else
  readonly DEFAULT_INSTALL_DIR="${PWD}/parako-id"
  readonly DEFAULT_LOG_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/parako"
  readonly DEFAULT_LOCK_DIR="${XDG_RUNTIME_DIR:-${HOME}/.cache/parako}"
  readonly DEFAULT_BIN_DIR="${HOME}/.local/bin"
  readonly RUNNING_AS_ROOT=0
fi

# Flag globals (set by parse_args).
INSTALL_DIR=""
FLAG_HELP=0
FLAG_VERSION=""
FLAG_DIR=""
FLAG_UPDATE=0
FLAG_ROLLBACK=0
FLAG_ROLLBACK_TO=""
FLAG_DOCTOR=0
FLAG_GC=0
FLAG_KEEP=3
FLAG_YES=0
FLAG_PLAN=0
FLAG_DRY_RUN=0
FLAG_OFFLINE=0
FLAG_OFFLINE_TARBALL=""
FLAG_OFFLINE_CHECKSUM=""
FLAG_OFFLINE_SIGNATURE=""
FLAG_OFFLINE_CERTIFICATE=""
FLAG_INSECURE_NO_SIGNATURE=0
FLAG_INSECURE_REASON=""
FLAG_NO_BIN=0
FLAG_NON_INTERACTIVE=0
FLAG_FORCE=0
FLAG_NO_COLOR=0
FLAG_JSON=0
FLAG_UNINSTALL=0
FLAG_PURGE=0
FLAG_KEEP_BIN=0
FLAG_CLEAN_STALE=0

# Runtime state.
DOWNLOAD_CMD=""
TAG=""
RESOLVED_INSTALL_DIR=""
RUN_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

release_architecture() {
  case "$(uname -m 2>/dev/null || printf unknown)" in
    x86_64|amd64) printf 'x64' ;;
    aarch64|arm64) printf 'arm64' ;;
    *) return 1 ;;
  esac
}

# -----------------------------------------------------------------------------
# §2  Logging + UI (color, label format, redactor)
# -----------------------------------------------------------------------------
C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_CYAN=""
C_BOLD=""; C_DIM=""; C_RESET=""

ui_init_colors() {
  if [ -n "${NO_COLOR:-}" ] || [ "${FLAG_NO_COLOR}" -eq 1 ] || [ ! -t 1 ]; then
    return 0
  fi
  C_RED=$'\033[0;31m'; C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[1;33m'
  C_BLUE=$'\033[0;34m'; C_CYAN=$'\033[0;36m'
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
}

print_header() {
  printf '\n%s== %s%s\n' "${C_CYAN}${C_BOLD}" "$1" "${C_RESET}"
}

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

# Sensitive-value redactor applied to every log write.
redact() {
  sed -E \
    -e 's,(://)[^:[:space:]]+:[^@[:space:]]+@,\1***@,g' \
    -e 's/(([Pp][Aa][Ss][Ss][Ww]?[Oo][Rr]?[Dd]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll]|[Aa][Pp][Ii][_]?[Kk][Ee][Yy]|[Aa][Pp][Ii][Kk][Ee][Yy]|[Hh][Mm][Aa][Cc][_]?[Ss][Ee][Cc][Rr][Ee][Tt]|[Jj][Ww][Tt][_]?[Ss][Ee][Cc][Rr][Ee][Tt]|[Cc][Oo][Oo][Kk][Ii][Ee][_]?[Ss][Ee][Cc][Rr][Ee][Tt][_]?[12]?|[Ee][Nn][Cc][Rr][Yy][Pp][Tt][Ii][Oo][Nn][_]?[Kk][Ee][Yy]|[Pp][Aa][Ii][Rr][Ww][Ii][Ss][Ee][_]?[Ss][Aa][Ll][Tt]))[[:space:]]*[:=][[:space:]]*[^[:space:]]+/\1=***/g'
}

_log_disk() {
  [ -z "${LOG_FILE}" ] && return 0
  local level=$1 source=$2 message=$3 ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local redacted_msg
  redacted_msg=$(printf '%s' "${message}" | redact)
  redacted_msg=${redacted_msg//\\/\\\\}
  redacted_msg=${redacted_msg//\"/\\\"}
  redacted_msg=${redacted_msg//$'\n'/ }
  printf '{"ts":"%s","level":"%s","source":"%s","message":"%s"}\n' \
    "${ts}" "${level}" "${source}" "${redacted_msg}" >> "${LOG_FILE}" 2>/dev/null || true
}

log_info() { local m; m=$(printf '%s' "$1" | redact); printf '%s[INFO]%s %s\n' "${C_BLUE}"   "${C_RESET}" "${m}"; _log_disk INFO  main "$1"; }
log_ok()   { local m; m=$(printf '%s' "$1" | redact); printf '%s[OK]%s   %s\n' "${C_GREEN}"  "${C_RESET}" "${m}"; _log_disk OK    main "$1"; }
log_warn() { local m; m=$(printf '%s' "$1" | redact); printf '%s[WARN]%s %s\n' "${C_YELLOW}" "${C_RESET}" "${m}" >&2; _log_disk WARN  main "$1"; }
log_err()  { local m; m=$(printf '%s' "$1" | redact); printf '%s[FAIL]%s %s\n' "${C_RED}"    "${C_RESET}" "${m}" >&2; _log_disk ERROR main "$1"; }
die()      { log_err "$1"; exit "${2:-1}"; }

log_init() {
  local dir="${DEFAULT_LOG_DIR}"
  if [ "${RUNNING_AS_ROOT}" -eq 0 ]; then
    mkdir -p "${dir}" 2>/dev/null || dir="${TMPDIR:-/tmp}"
  fi
  LOG_FILE="${dir}/parako-install-${RUN_TIMESTAMP}.log"
  : > "${LOG_FILE}" 2>/dev/null || {
    LOG_FILE="${TMPDIR:-/tmp}/parako-install-${RUN_TIMESTAMP}.log"
    : > "${LOG_FILE}"
  }
  chmod 0600 "${LOG_FILE}" 2>/dev/null || true
  _log_disk INFO main "installer ${INSTALLER_VERSION} starting, run ${RUN_TIMESTAMP}"
}

# -----------------------------------------------------------------------------
# §3  Minimal prompt helpers (used by beginning_ritual only)
# -----------------------------------------------------------------------------
prompt_yn_timeout() {
  local text=$1 default=$2 secs=${3:-60} hint="" answer="" rc=0
  if [ "${default}" = "yes" ]; then hint="Y/n"; else hint="y/N"; fi
  printf '  %s%s%s [%s%s%s] (%ds timeout): ' \
    "${C_CYAN}" "${text}" "${C_RESET}" "${C_DIM}" "${hint}" "${C_RESET}" "${secs}"
  # When invoked via `curl ... | bash`, stdin is the pipe (no keyboard input)
  # and read times out instantly. Fall back to the controlling /dev/tty so the
  # prompt still works in that idiom.
  if [ ! -t 0 ] && [ -r /dev/tty ]; then
    IFS= read -r -t "${secs}" answer < /dev/tty || rc=$?
  else
    IFS= read -r -t "${secs}" answer || rc=$?
  fi
  if [ "${rc}" -ne 0 ]; then
    printf '\n'
    log_warn "no response within ${secs}s; aborting"
    return 1
  fi
  [ -z "${answer}" ] && answer="${default}"
  case "${answer}" in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac
}

is_safe_path() {
  case "$1" in
    *..*|*[\;\|\&\$\`\<\>\*\?]*) return 1 ;;
    ''|/) return 1 ;;
  esac
  return 0
}

# -----------------------------------------------------------------------------
# §4  Argparse + help
# -----------------------------------------------------------------------------
print_help() {
  cat <<HELPEOF
Parako.ID installer v${INSTALLER_VERSION}

  This installer/updater safely places and updates Parako application files.
  It verifies the release artifact, stages it, preserves operator-owned
  runtime/config files, and switches the application release pointer.

  After staging, the companion parako command manages bootstrap environment,
  migrations, encrypted backups, and native systemd services. Reverse proxy,
  TLS, and application/OIDC settings remain OPERATOR responsibilities.

Common workflows:
  Fresh install (system-wide)
    curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id | sudo bash

  Update to latest stable
    parako update          # or: install.sh --update

  Safely roll back application files (database restore remains explicit)
    parako rollback        # or: install.sh --rollback

Modes (mutually exclusive):
  (no mode flag)               Fresh install
  --update                     In-place update of an existing install
  --rollback                   Switch current → previous release pointer
  --doctor                     Installed-file sanity report
  --gc                         Prune old releases/ (never touches runtime/)
  --uninstall                  Remove this install (preserves runtime/ unless --purge)

Mode modifiers:
  --to <vX.Y.Z>                (--rollback) Specific target release
  --keep <N>                   (--gc) Releases-to-retain from the deletable set
                               (current + previous always protected; default 3)
  --yes                        (--gc) Apply; default is preview only
  --purge                      (--uninstall) Also remove runtime/ (operator data)
  --keep-bin                   (--uninstall) Preserve /usr/local/bin/parako helper
  --clean-stale                Auto-remove stale current.tmp.* symlinks left by a crashed run

Source resolution:
  --version <vX.Y.Z>           Pin a release version (default: latest stable)
  --dir <path>                 Install directory (default: ${DEFAULT_INSTALL_DIR})

Preview modes (no mutations):
  --plan                       Pure preview; no network, no INSTALL_DIR writes
  --dry-run                    Download + verify; exits before INSTALL_DIR writes

Air-gapped install:
  --offline                    No network; requires --version and --tarball
  --tarball <path>             Pre-downloaded release tarball
  --checksum <path>            SHA256SUMS file
  --signature <path>           cosign signature file
  --certificate <path>         cosign certificate file

Security escape (use only when Sigstore is unreachable):
  --insecure-no-signature      Bypass cosign verification
  --reason "<text>"            (--insecure-no-signature) Required reason

Behavior:
  --no-bin                     Skip /usr/local/bin/parako install
  --non-interactive            No prompts (requires --force)
  --force                      Skip confirmation; allow overwrite of existing release
  --no-color                   Disable colored output
  --json                       (--doctor) Emit structured JSON
  --help                       Show this message

Scope:
  install.sh only verifies and stages release files. Use parako for bootstrap
  environment, migrations, encrypted backups, systemd, health, and first-admin
  activation. Reverse proxy, TLS, and admin-panel configuration are external.

See:
  https://docs.parako.id/installer
  https://docs.parako.id/installer-security
  https://github.com/${REPO_OWNER}/${REPO_NAME}/releases  (per-release migration notes)
HELPEOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --help|-h) FLAG_HELP=1 ;;
      --version)
        [ $# -lt 2 ] && die "--version requires vX.Y.Z"
        case "$2" in v*) FLAG_VERSION=$2 ;; *) FLAG_VERSION="v$2" ;; esac
        shift ;;
      --dir)
        [ $# -lt 2 ] && die "--dir requires a path"
        is_safe_path "$2" || die "--dir path unsafe: $2"
        FLAG_DIR=$2; shift ;;
      --update)   FLAG_UPDATE=1 ;;
      --rollback) FLAG_ROLLBACK=1 ;;
      --to)
        [ $# -lt 2 ] && die "--to requires vX.Y.Z"
        case "$2" in v*) FLAG_ROLLBACK_TO=$2 ;; *) FLAG_ROLLBACK_TO="v$2" ;; esac
        shift ;;
      --doctor) FLAG_DOCTOR=1 ;;
      --gc)     FLAG_GC=1 ;;
      --uninstall) FLAG_UNINSTALL=1 ;;
      --purge)     FLAG_PURGE=1 ;;
      --keep-bin)  FLAG_KEEP_BIN=1 ;;
      --clean-stale) FLAG_CLEAN_STALE=1 ;;
      --keep)
        [ $# -lt 2 ] && die "--keep requires N"
        case "$2" in ''|*[!0-9]*) die "--keep must be a non-negative integer" ;; esac
        FLAG_KEEP=$2; shift ;;
      --yes)     FLAG_YES=1 ;;
      --plan)    FLAG_PLAN=1 ;;
      --dry-run) FLAG_DRY_RUN=1 ;;
      --offline) FLAG_OFFLINE=1 ;;
      --tarball)
        [ $# -lt 2 ] && die "--tarball requires a path"
        is_safe_path "$2" || die "--tarball path unsafe"
        FLAG_OFFLINE_TARBALL=$2; shift ;;
      --checksum)
        [ $# -lt 2 ] && die "--checksum requires a path"
        is_safe_path "$2" || die "--checksum path unsafe"
        FLAG_OFFLINE_CHECKSUM=$2; shift ;;
      --signature)
        [ $# -lt 2 ] && die "--signature requires a path"
        is_safe_path "$2" || die "--signature path unsafe"
        FLAG_OFFLINE_SIGNATURE=$2; shift ;;
      --certificate)
        [ $# -lt 2 ] && die "--certificate requires a path"
        is_safe_path "$2" || die "--certificate path unsafe"
        FLAG_OFFLINE_CERTIFICATE=$2; shift ;;
      --insecure-no-signature) FLAG_INSECURE_NO_SIGNATURE=1 ;;
      --reason)
        [ $# -lt 2 ] && die "--reason requires a quoted text"
        FLAG_INSECURE_REASON=$2; shift ;;
      --no-bin)          FLAG_NO_BIN=1 ;;
      --non-interactive) FLAG_NON_INTERACTIVE=1 ;;
      --force)           FLAG_FORCE=1 ;;
      --no-color)        FLAG_NO_COLOR=1 ;;
      --json)            FLAG_JSON=1 ;;
      *) log_warn "unknown option: $1" ;;
    esac
    shift
  done

  if [ -n "${FLAG_DIR}" ]; then
    INSTALL_DIR=${FLAG_DIR}
  elif [ -z "${INSTALL_DIR}" ]; then
    INSTALL_DIR=${DEFAULT_INSTALL_DIR}
  fi
  RESOLVED_INSTALL_DIR=${INSTALL_DIR}

  local mode_count=0
  [ "${FLAG_UPDATE}"    -eq 1 ] && mode_count=$((mode_count + 1))
  [ "${FLAG_ROLLBACK}"  -eq 1 ] && mode_count=$((mode_count + 1))
  [ "${FLAG_DOCTOR}"    -eq 1 ] && mode_count=$((mode_count + 1))
  [ "${FLAG_GC}"        -eq 1 ] && mode_count=$((mode_count + 1))
  [ "${FLAG_UNINSTALL}" -eq 1 ] && mode_count=$((mode_count + 1))
  if [ "${mode_count}" -gt 1 ]; then
    die "--update, --rollback, --doctor, --gc, --uninstall are mutually exclusive"
  fi

  if [ "${FLAG_INSECURE_NO_SIGNATURE}" -eq 1 ] && [ -z "${FLAG_INSECURE_REASON}" ]; then
    die "--insecure-no-signature requires --reason \"<text>\""
  fi

  if [ "${FLAG_NON_INTERACTIVE}" -eq 1 ] && [ "${FLAG_FORCE}" -eq 0 ]; then
    die "--non-interactive also requires --force (no prompts will be possible)"
  fi
}

# -----------------------------------------------------------------------------
# §5  Preflight
# -----------------------------------------------------------------------------
PREFLIGHT_FAIL_COUNT=0
PREFLIGHT_WARN_COUNT=0

_pf_ok()   { print_label "$1" "$2 [${C_GREEN}OK${C_RESET}]"; _log_disk OK preflight "$1: $2"; }
_pf_warn() { print_label "$1" "$2 [${C_YELLOW}WARN${C_RESET}]"; PREFLIGHT_WARN_COUNT=$((PREFLIGHT_WARN_COUNT + 1)); _log_disk WARN preflight "$1: $2"; }
_pf_fail() { print_label "$1" "$2 [${C_RED}FAIL${C_RESET}]"; PREFLIGHT_FAIL_COUNT=$((PREFLIGHT_FAIL_COUNT + 1)); _log_disk ERROR preflight "$1: $2"; }

check_os_arch() {
  local kernel arch distro_id="" distro_version=""
  kernel=$(uname -s 2>/dev/null || printf 'unknown')
  arch=$(uname -m 2>/dev/null || printf 'unknown')
  if [ "${kernel}" != "Linux" ]; then
    _pf_fail "OS" "${kernel} (Parako.ID v${INSTALLER_VERSION} installer supports Linux only)"
    return
  fi
  case "${arch}" in
    x86_64|amd64)   _pf_ok "OS / arch" "Linux ${arch}" ;;
    aarch64|arm64)  _pf_ok "OS / arch" "Linux ${arch}" ;;
    *)              _pf_fail "OS / arch" "Linux ${arch} (supported: x86_64, aarch64)" ;;
  esac
  if [ -r /etc/os-release ]; then
    distro_id=$(. /etc/os-release; printf '%s' "${ID:-}")
    distro_version=$(. /etc/os-release; printf '%s' "${VERSION_ID:-}")
  fi
  case "${distro_id}:${distro_version}" in
    debian:12|ubuntu:24.04) _pf_ok "Distribution" "${distro_id} ${distro_version}" ;;
    *) _pf_fail "Distribution" "${distro_id:-unknown} ${distro_version:-unknown} (supported: Debian 12, Ubuntu 24.04)" ;;
  esac
}

check_bash_version() {
  local major=${BASH_VERSINFO[0]:-0}
  if [ "${major}" -ge "${MIN_BASH_MAJOR}" ]; then
    _pf_ok "bash" "${BASH_VERSION:-?}"
  else
    _pf_fail "bash" "version ${BASH_VERSION:-?} < ${MIN_BASH_MAJOR}.x (Alpine: \`apk add bash\` first)"
  fi
}

check_coreutils() {
  # `mv -T` is a GNU coreutils extension; BusyBox `mv` does NOT accept it.
  # https://www.gnu.org/software/coreutils/manual/html_node/mv-invocation.html
  if mv --help 2>&1 | grep -q -- '--no-target-directory'; then
    _pf_ok "coreutils" "mv -T supported (GNU)"
  else
    _pf_fail "coreutils" "GNU mv -T not supported (Alpine: \`apk add coreutils\`)"
  fi
}

check_flock() {
  # flock(1) is util-linux; not part of POSIX. BusyBox does not provide it.
  if command -v flock >/dev/null 2>&1; then
    _pf_ok "flock" "$(command -v flock)"
  else
    _pf_fail "flock" "not found (Alpine: \`apk add util-linux\`)"
  fi
}

check_downloader() {
  if command -v curl >/dev/null 2>&1; then
    _pf_ok "downloader" "curl $(curl --version 2>/dev/null | awk 'NR==1 {print $2}')"
  elif command -v wget >/dev/null 2>&1; then
    _pf_ok "downloader" "wget $(wget --version 2>/dev/null | awk 'NR==1 {print $3}')"
  else
    _pf_fail "downloader" "neither curl nor wget found"
  fi
}

check_openssl() {
  if command -v openssl >/dev/null 2>&1; then
    _pf_ok "openssl" "$(openssl version 2>/dev/null | awk '{print $1, $2}')"
  else
    _pf_fail "openssl" "not found"
  fi
}

check_tar() {
  if command -v tar >/dev/null 2>&1; then
    _pf_ok "tar" "$(tar --version 2>/dev/null | awk 'NR==1 {print $1, $4}')"
  else
    _pf_fail "tar" "not found"
  fi
}

check_disk_space() {
  local parent target=${INSTALL_DIR}
  parent=$(dirname "${target}")
  while [ ! -d "${parent}" ] && [ "${parent}" != "/" ]; do
    parent=$(dirname "${parent}")
  done
  local avail_bytes
  if command -v df >/dev/null 2>&1; then
    avail_bytes=$(df -PB1 "${parent}" 2>/dev/null | awk 'NR==2 {print $4}')
  fi
  [ -z "${avail_bytes}" ] && { _pf_warn "disk free" "could not measure"; return; }
  local avail_gib
  avail_gib=$(awk -v b="${avail_bytes}" 'BEGIN { printf "%.1f GB", b/1024/1024/1024 }')
  if [ "${avail_bytes}" -ge "${MIN_DISK_BYTES}" ]; then
    _pf_ok "disk free" "${avail_gib}"
  else
    _pf_fail "disk free" "${avail_gib} (need >= 2 GB)"
  fi
}

preflight() {
  print_header "Preflight checks"
  PREFLIGHT_FAIL_COUNT=0
  PREFLIGHT_WARN_COUNT=0

  check_os_arch
  check_bash_version
  check_coreutils
  check_flock
  check_downloader
  check_openssl
  check_tar
  check_disk_space

  if [ "${PREFLIGHT_FAIL_COUNT}" -gt 0 ]; then
    printf '\n'
    log_err "${PREFLIGHT_FAIL_COUNT} preflight check(s) failed; aborting before any download or mutation"
    exit 2
  fi
  if [ "${PREFLIGHT_WARN_COUNT}" -gt 0 ]; then
    log_warn "${PREFLIGHT_WARN_COUNT} preflight warning(s)"
  fi
}

# -----------------------------------------------------------------------------
# §6  Downloader + checksum
# -----------------------------------------------------------------------------
# References:
#   rustup curl hardening: https://rustup.rs/
#   TLS 1.2+ enforcement: --proto '=https' --tlsv1.2
# -----------------------------------------------------------------------------
readonly CURL_FLAGS=(--proto '=https' --tlsv1.2 --silent --show-error --fail --location --retry 3 --retry-delay 2 --max-time 120)
readonly WGET_FLAGS=(--secure-protocol=TLSv1_2 --https-only --quiet --tries=3 --timeout=120)

detect_downloader() {
  if command -v curl >/dev/null 2>&1; then DOWNLOAD_CMD="curl"
  elif command -v wget >/dev/null 2>&1; then DOWNLOAD_CMD="wget"
  else die "neither curl nor wget found"
  fi
}

download_file() {
  local url=$1 out=$2
  case "${url}" in https://*) ;; *) die "refusing non-HTTPS URL: ${url}" ;; esac
  if [ "${DOWNLOAD_CMD}" = "curl" ]; then
    curl "${CURL_FLAGS[@]}" -o "${out}" "${url}"
  else
    wget "${WGET_FLAGS[@]}" -O "${out}" "${url}"
  fi
}

download_stdout() {
  local url=$1
  case "${url}" in https://*) ;; *) die "refusing non-HTTPS URL: ${url}" ;; esac
  if [ "${DOWNLOAD_CMD}" = "curl" ]; then
    curl "${CURL_FLAGS[@]}" "${url}"
  else
    wget "${WGET_FLAGS[@]}" -O - "${url}"
  fi
}

compute_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    return 1
  fi
}

fetch_latest_version() {
  if [ -n "${FLAG_VERSION}" ]; then
    TAG=${FLAG_VERSION}
    log_ok "target version: ${TAG}"
    return 0
  fi
  if [ "${FLAG_OFFLINE}" -eq 1 ]; then
    die "--offline requires --version <vX.Y.Z>; the GitHub API is not reachable in offline mode"
  fi
  log_info "fetching latest release from GitHub"
  local response
  response=$(download_stdout "${GITHUB_API}/releases/latest" 2>/dev/null) \
    || die "failed to fetch latest release from GitHub API; pass --version <vX.Y.Z>"
  if command -v jq >/dev/null 2>&1; then
    TAG=$(printf '%s' "${response}" | jq -r '.tag_name // .latest // empty')
  else
    TAG=$(printf '%s' "${response}" | grep -E '"(tag_name|latest)"' | head -n1 \
      | sed -E 's/.*"(tag_name|latest)":[[:space:]]*"([^"]+)".*/\2/')
  fi
  [ -z "${TAG}" ] && die "could not parse release tag from response"
  case "${TAG}" in v*) ;; *) TAG="v${TAG}" ;; esac
  log_ok "target version: ${TAG}"
}

TARBALL_FILE=""
SIGNATURE_FILE=""
CERTIFICATE_FILE=""
CHECKSUM_FILE=""

fetch_release_artifacts() {
  if [ "${FLAG_OFFLINE}" -eq 1 ]; then
    [ -n "${FLAG_OFFLINE_TARBALL}" ] || die "--offline requires --tarball"
    [ -f "${FLAG_OFFLINE_TARBALL}" ] || die "--tarball file not found: ${FLAG_OFFLINE_TARBALL}"
    TARBALL_FILE=${FLAG_OFFLINE_TARBALL}
    CHECKSUM_FILE=${FLAG_OFFLINE_CHECKSUM}
    SIGNATURE_FILE=${FLAG_OFFLINE_SIGNATURE}
    CERTIFICATE_FILE=${FLAG_OFFLINE_CERTIFICATE}
    return 0
  fi

  TMPDIR_PATH=$(mktemp -d -t parako-XXXXXXXX)
  chmod 0700 "${TMPDIR_PATH}"

  local base_url tarball_name release_arch
  base_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${TAG}"
  release_arch=$(release_architecture) || die "unsupported release architecture"
  tarball_name="parako-id-${TAG}-linux-${release_arch}.tar.gz"
  TARBALL_FILE="${TMPDIR_PATH}/${tarball_name}"
  CHECKSUM_FILE="${TMPDIR_PATH}/SHA256SUMS"
  SIGNATURE_FILE="${TMPDIR_PATH}/${tarball_name}.sig"
  CERTIFICATE_FILE="${TMPDIR_PATH}/${tarball_name}.pem"

  log_info "downloading ${tarball_name}"
  download_file "${base_url}/${tarball_name}" "${TARBALL_FILE}"
  download_file "${base_url}/SHA256SUMS"      "${CHECKSUM_FILE}"
  if ! download_file "${base_url}/${tarball_name}.sig" "${SIGNATURE_FILE}" 2>/dev/null; then
    SIGNATURE_FILE=""
  fi
  if ! download_file "${base_url}/${tarball_name}.pem" "${CERTIFICATE_FILE}" 2>/dev/null; then
    CERTIFICATE_FILE=""
  fi
}

verify_checksum() {
  [ -n "${CHECKSUM_FILE}" ] && [ -f "${CHECKSUM_FILE}" ] || {
    die "SHA256SUMS is required for every installation"
  }
  local expected actual basename
  basename=$(basename "${TARBALL_FILE}")
  expected=$(grep -E "[[:space:]]${basename}\$" "${CHECKSUM_FILE}" | awk '{print $1}')
  [ -z "${expected}" ] && die "${basename} is not listed in SHA256SUMS"
  actual=$(compute_sha256 "${TARBALL_FILE}") || die "sha256sum or shasum is required"
  if [ "${actual}" != "${expected}" ]; then
    die "checksum mismatch: expected ${expected}, got ${actual}"
  fi
  log_ok "SHA256 verified"
}

# -----------------------------------------------------------------------------
# §7  Cosign bootstrap + verifier
# -----------------------------------------------------------------------------
# References:
#   https://docs.sigstore.dev/cosign/verifying/verify/
#   https://docs.sigstore.dev/cosign/system_config/installation/
# -----------------------------------------------------------------------------
ensure_cosign() {
  command -v cosign >/dev/null 2>&1 && return 0

  if [ "${FLAG_OFFLINE}" -eq 1 ]; then
    die "--offline requires cosign to be preinstalled on PATH; refusing to download cosign in offline mode. Install cosign v${COSIGN_VERSION} (https://docs.sigstore.dev/cosign/system_config/installation/) before re-running."
  fi

  local arch bin expected tmp
  arch=$(uname -m)
  case "${arch}" in
    x86_64|amd64)   bin="cosign-linux-amd64"; expected=${COSIGN_SHA256_LINUX_AMD64} ;;
    aarch64|arm64)  bin="cosign-linux-arm64"; expected=${COSIGN_SHA256_LINUX_ARM64} ;;
    *) die "unsupported architecture for cosign auto-install: ${arch}" ;;
  esac
  log_info "installing cosign ${COSIGN_VERSION} for signature verification"
  tmp=$(mktemp -d -t cosign-bootstrap-XXXX)
  download_file "https://github.com/sigstore/cosign/releases/download/v${COSIGN_VERSION}/${bin}" "${tmp}/cosign"
  local actual
  actual=$(compute_sha256 "${tmp}/cosign") || die "no sha256sum/shasum available"
  if [ "${actual}" != "${expected}" ]; then
    rm -rf "${tmp}"
    die "cosign bootstrap SHA256 mismatch: expected ${expected}, got ${actual}"
  fi
  if [ "${RUNNING_AS_ROOT}" -eq 1 ]; then
    install -m 0755 "${tmp}/cosign" /usr/local/bin/cosign
  else
    mkdir -p "${DEFAULT_BIN_DIR}"
    install -m 0755 "${tmp}/cosign" "${DEFAULT_BIN_DIR}/cosign"
    export PATH="${DEFAULT_BIN_DIR}:${PATH}"
  fi
  rm -rf "${tmp}"
  log_ok "cosign installed"
}

verify_release_signature() {
  if [ "${FLAG_INSECURE_NO_SIGNATURE}" -eq 1 ]; then
    log_warn "signature verification BYPASSED (--insecure-no-signature)"
    log_warn "reason: ${FLAG_INSECURE_REASON}"
    _log_disk WARN cosign "BYPASSED reason=${FLAG_INSECURE_REASON}"
    if [ "${FLAG_NON_INTERACTIVE}" -eq 0 ]; then
      printf 'Type %syes%s in full to confirm: ' "${C_RED}" "${C_RESET}"
      local conf=""
      if [ ! -t 0 ] && [ -r /dev/tty ]; then
        IFS= read -r conf < /dev/tty || conf=""
      else
        IFS= read -r conf || conf=""
      fi
      [ "${conf}" = "yes" ] || die "signature bypass requires explicit yes"
    fi
    return 0
  fi
  if [ -z "${SIGNATURE_FILE}" ] || [ ! -f "${SIGNATURE_FILE}" ]; then
    die "no signature found; pass --insecure-no-signature --reason \"<text>\" if you must proceed."
  fi
  if [ -z "${CERTIFICATE_FILE}" ] || [ ! -f "${CERTIFICATE_FILE}" ]; then
    die "no signing certificate found"
  fi
  ensure_cosign
  log_info "verifying cosign signature"
  if cosign verify-blob \
    --signature "${SIGNATURE_FILE}" \
    --certificate "${CERTIFICATE_FILE}" \
    --certificate-identity-regexp "${COSIGN_CERT_IDENTITY_REGEX}" \
    --certificate-oidc-issuer "${COSIGN_OIDC_ISSUER}" \
    "${TARBALL_FILE}" >/dev/null 2>&1; then
    log_ok "cosign verification passed"
  else
    die "cosign verification failed"
  fi
}

# -----------------------------------------------------------------------------
# §8  Locking + privileged file write helper
# -----------------------------------------------------------------------------
acquire_lock() {
  local lock_dir lock_file
  if [ -n "${PARAKO_LOCK_FILE:-}" ]; then
    lock_file=${PARAKO_LOCK_FILE}
  else
    lock_dir=${RESOLVED_INSTALL_DIR}
    [ -d "${lock_dir}" ] || lock_dir=${DEFAULT_LOCK_DIR}
    mkdir -p "${lock_dir}" 2>/dev/null || lock_dir="${TMPDIR:-/tmp}"
    lock_file="${lock_dir}/.install-lock"
  fi
  # NOTE: do not append `2>/dev/null` to a redirection-only `exec` — bash treats
  # it as another permanent redirection, silencing stderr for the rest of the
  # script and swallowing every die/log_err that follows.
  if ! { exec 9>"${lock_file}"; } 2>/dev/null; then
    die "could not open lock file ${lock_file}"
  fi
  flock --nonblock --exclusive 9 \
    || die "another installer run is in progress (lock: ${lock_file})"
  LOCK_FD=9
}

write_root_file() {
  local src=$1 dest=$2 mode=${3:-0644} owner=${4:-root:root}
  case "${dest}" in
    /usr/local/bin/parako)                         ;;
    /usr/local/bin/cosign)                         ;;
    *) die "refusing to write outside allowlist: ${dest}" ;;
  esac
  local prefix=""
  [ "${RUNNING_AS_ROOT}" -eq 0 ] && prefix="sudo"
  if [ -f "${dest}" ]; then
    ${prefix} cp -a "${dest}" "${dest}.bak.${RUN_TIMESTAMP}" \
      || return 1
  fi
  ${prefix} install -m "${mode}" -o "${owner%:*}" -g "${owner#*:}" "${src}" "${dest}" \
    || return 1
  [ -f "${dest}" ] || return 1
  log_ok "wrote ${dest} (mode ${mode}, ${owner})"
}

# -----------------------------------------------------------------------------
# §9  Beginning ritual (confirmation gate)
# -----------------------------------------------------------------------------
beginning_ritual() {
  print_header "Plan"
  print_label "Operation" "$1"
  print_label "Target version" "${TAG:-?}"
  print_label "Install dir" "${RESOLVED_INSTALL_DIR}"
  printf '\n'
  printf 'Scope: verified application artifact staging. The parako companion\n'
  printf 'handles database, backup, systemd, and health lifecycle afterward.\n\n'
  printf 'Steps:\n'
  printf '  1. Acquire an installer lock at %s/.install-lock.\n' "${RESOLVED_INSTALL_DIR}"
  printf '  2. Stage the release under %s/releases/.staging.%s.$$.\n' "${RESOLVED_INSTALL_DIR}" "${TAG}"
  printf '  3. Promote staging to %s/releases/%s/.\n' "${RESOLVED_INSTALL_DIR}" "${TAG}"
  printf '  4. Atomically switch %s/current to the new release.\n' "${RESOLVED_INSTALL_DIR}"
  printf '\n'

  if [ "${FLAG_NON_INTERACTIVE}" -eq 1 ] && [ "${FLAG_FORCE}" -eq 1 ]; then
    log_info "non-interactive mode; proceeding in 5 seconds (Ctrl+C to abort)"
    sleep 5
    return 0
  fi
  if [ "${FLAG_FORCE}" -eq 1 ]; then return 0; fi
  if ! prompt_yn_timeout "Proceed?" "no" 60; then
    log_info "aborted by operator"
    exit 0
  fi
}

# -----------------------------------------------------------------------------
# §10  .parako-state (mode 0644, NO secrets)
# -----------------------------------------------------------------------------
write_parako_state() {
  local version=$1 previous=${2:-} bin_path=${3:-}
  # Preserve existing PARAKO_BIN_PATH on update/rollback when caller does not
  # pass an explicit path (binary install only happens on fresh install path).
  if [ -z "${bin_path}" ]; then
    bin_path=$(read_state_field PARAKO_BIN_PATH 2>/dev/null || true)
  fi
  local state_file="${RESOLVED_INSTALL_DIR}/.parako-state"
  local state_tmp="${state_file}.tmp.$$"
  {
    printf '# Parako.ID installer state — no secrets, safe to read.\n'
    printf 'INSTALL_DIR=%s\n'       "${RESOLVED_INSTALL_DIR}"
    printf 'VERSION=%s\n'           "${version}"
    printf 'PREVIOUS_VERSION=%s\n'  "${previous}"
    printf 'INSTALLED_AT=%s\n'      "${RUN_TIMESTAMP}"
    printf 'INSTALLER_VERSION=%s\n' "${INSTALLER_VERSION}"
    [ -n "${bin_path}" ] && printf 'PARAKO_BIN_PATH=%s\n' "${bin_path}"
  } > "${state_tmp}"
  chmod 0644 "${state_tmp}"
  mv -f "${state_tmp}" "${state_file}"
}

read_state_field() {
  local field=$1 file="${RESOLVED_INSTALL_DIR}/.parako-state"
  [ -r "${file}" ] || return 1
  grep -E "^${field}=" "${file}" | head -n1 | cut -d= -f2-
}

# -----------------------------------------------------------------------------
# §11  parako operator-binary install (non-fatal)
# -----------------------------------------------------------------------------
install_parako_binary() {
  PARAKO_BIN_RESOLVED=""
  if [ "${FLAG_NO_BIN}" -eq 1 ]; then
    log_info "--no-bin: skipping /usr/local/bin/parako install"
    return 0
  fi
  local src="${RESOLVED_INSTALL_DIR}/current/contrib/parako.sh"
  if [ ! -f "${src}" ]; then
    log_warn "parako helper not found at ${src}; skipping operator-binary install"
    log_warn "after future release, install with: cp ${RESOLVED_INSTALL_DIR}/current/contrib/parako.sh /usr/local/bin/parako && chmod 0755 /usr/local/bin/parako"
    return 0
  fi
  if [ "${RUNNING_AS_ROOT}" -eq 1 ]; then
    if write_root_file "${src}" "/usr/local/bin/parako" 0755 root:root; then
      PARAKO_BIN_RESOLVED="/usr/local/bin/parako"
    else
      log_warn "could not install /usr/local/bin/parako; install manually:"
      log_warn "  cp ${src} /usr/local/bin/parako && chmod 0755 /usr/local/bin/parako"
    fi
  else
    if mkdir -p "${DEFAULT_BIN_DIR}" 2>/dev/null \
       && install -m 0755 "${src}" "${DEFAULT_BIN_DIR}/parako" 2>/dev/null; then
      log_ok "installed parako at ${DEFAULT_BIN_DIR}/parako"
      PARAKO_BIN_RESOLVED="${DEFAULT_BIN_DIR}/parako"
      case ":${PATH}:" in
        *":${DEFAULT_BIN_DIR}:"*) ;;
        *) log_warn "${DEFAULT_BIN_DIR} is not on PATH; add it to your shell init to use \`parako\`" ;;
      esac
    else
      log_warn "could not install ${DEFAULT_BIN_DIR}/parako; install manually:"
      log_warn "  cp ${src} ${DEFAULT_BIN_DIR}/parako && chmod 0755 ${DEFAULT_BIN_DIR}/parako"
    fi
  fi
}

# -----------------------------------------------------------------------------
# §12  Next-steps card
# -----------------------------------------------------------------------------
print_next_steps_card() {
  local current=$1 previous=${2:-}
  print_header "Parako.ID ${current} release pointer updated"
  print_label "Install dir"      "${RESOLVED_INSTALL_DIR}"
  print_label "Current release"  "${RESOLVED_INSTALL_DIR}/releases/${current}"
  if [ -n "${previous}" ]; then
    print_label "Previous release" "${RESOLVED_INSTALL_DIR}/releases/${previous}  (kept for rollback)"
  fi
  print_label "Runtime"          "${RESOLVED_INSTALL_DIR}/runtime"
  printf '\n  Production lifecycle:\n\n'
  if [ -z "${previous}" ]; then
    printf '    1. Create an offline age identity and record its printed recipient:\n'
    printf '         parako backup-keygen /root/parako-backup.agekey\n\n'
    printf '    2. Create bootstrap-only configuration (application/OIDC settings stay in admin):\n'
    printf '         parako config init --url https://id.example.com \\\n'
    printf '           --adapter postgresql --database-url postgresql://... \\\n'
    printf '           --backup-recipient age1...\n\n'
    printf '    3. Provision an external HTTPS reverse proxy, then deploy:\n'
    printf '         sudo parako deploy\n\n'
    printf '    4. Create and open the single-use first-admin activation URL:\n'
    printf '         sudo parako admin bootstrap --email admin@example.com\n\n'
  else
    printf '    The release pointer changed. If this command was run directly,\n'
    printf '    services and migrations were not orchestrated. Use parako update for\n'
    printf '    future updates; it requires backup, migration, and readiness gates.\n\n'
  fi
}

# -----------------------------------------------------------------------------
# §13  install_main / update_main shared core
# -----------------------------------------------------------------------------
_first_install_runtime_populate() {
  # Allowlist copy of shipped runtime/ subtrees into operator-owned runtime/.
  # Called only when ${RESOLVED_INSTALL_DIR}/runtime did not exist before this run.
  local release_dir=$1 dest="${RESOLVED_INSTALL_DIR}/runtime"
  mkdir -p "${dest}"
  local sub
  for sub in "${RUNTIME_FIRST_INSTALL_ALLOWLIST[@]}"; do
    if [ -d "${release_dir}/runtime/${sub}" ]; then
      cp -a "${release_dir}/runtime/${sub}" "${dest}/${sub}"
    fi
  done
  log_ok "runtime/ populated from shipped defaults (locales, views)"
  log_info "runtime/.env and runtime/jwks/ are operator-owned — create them yourself:"
  log_info "  cp ${RESOLVED_INSTALL_DIR}/current/contrib/.env.sample ${RESOLVED_INSTALL_DIR}/runtime/.env"
}

_link_release_runtime() {
  local release_dir=$1
  local runtime_link="${release_dir}/runtime"
  rm -rf "${runtime_link}"
  # Relative target survives a rename of the install dir (rollback to an older
  # release still resolves to the shared runtime via ../../runtime).
  ln -s "../../runtime" "${runtime_link}"
}

_atomic_pointer_swap() {
  # mv -T is GNU coreutils only; checked in preflight.
  CURRENT_TMP="${RESOLVED_INSTALL_DIR}/current.tmp.$$"
  ln -s "${RESOLVED_INSTALL_DIR}/releases/${TAG}" "${CURRENT_TMP}"
  mv -Tf "${CURRENT_TMP}" "${RESOLVED_INSTALL_DIR}/current"
  CURRENT_TMP=""
}

_extract_to_staging() {
  STAGING_DIR="${RESOLVED_INSTALL_DIR}/releases/.staging.${TAG}.$$"
  [ -e "${STAGING_DIR}" ] && die "staging dir already exists: ${STAGING_DIR}"
  mkdir -p "${STAGING_DIR}"
  log_info "extracting tarball to staging"
  tar -xzf "${TARBALL_FILE}" -C "${STAGING_DIR}" --strip-components=1 \
    || die "tar extraction failed"
  [ -f "${STAGING_DIR}/dist/src/index.js" ] \
    || die "smoke check failed: dist/src/index.js missing in extracted release"
  validate_staged_release
  log_ok "extraction smoke-checked"
}

validate_staged_release() {
  local node_bin="${STAGING_DIR}/node/bin/node"
  local manifest="${STAGING_DIR}/release-manifest.json"
  local expected_arch expected_version
  expected_arch=$(release_architecture) || die "unsupported release architecture"
  expected_version="${TAG#v}"

  [ -x "${node_bin}" ] || die "release is missing its bundled Node.js runtime"
  [ -x "${STAGING_DIR}/tools/age/age" ] \
    || die "release is missing its bundled age encryption tool"
  [ -f "${manifest}" ] || die "release is missing release-manifest.json"
  [ -d "${STAGING_DIR}/prisma/migrations/sqlite" ] \
    || die "release is missing SQLite migrations"
  [ -d "${STAGING_DIR}/prisma/migrations/postgresql" ] \
    || die "release is missing PostgreSQL migrations"
  [ -f "${STAGING_DIR}/node_modules/@prisma/client/index.js" ] \
    || die "release is missing its SQLite Prisma client"
  [ -f "${STAGING_DIR}/prisma/generated/postgresql/index.js" ] \
    || die "release is missing its PostgreSQL Prisma client"

  "${node_bin}" -e '
    const crypto = require("node:crypto");
    const fs = require("node:fs");
    const path = require("node:path");
    const [file, expectedVersion, expectedArch, releaseRoot] = process.argv.slice(1);
    const m = JSON.parse(fs.readFileSync(file, "utf8"));
    const failures = [];
    const filesRecursively = directory => fs
      .readdirSync(directory, { withFileTypes: true })
      .flatMap(entry => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? filesRecursively(target) : [target];
      })
      .sort();
    const hashDirectory = directory => {
      const digest = crypto.createHash("sha256");
      for (const entry of filesRecursively(directory)) {
        digest.update(path.relative(directory, entry));
        digest.update("\0");
        digest.update(fs.readFileSync(entry));
        digest.update("\0");
      }
      return digest.digest("hex");
    };
    const hashFile = target => crypto
      .createHash("sha256")
      .update(fs.readFileSync(target))
      .digest("hex");
    if (m.schemaVersion !== 1) failures.push("unsupported schemaVersion");
    if (m.product !== "parako.id") failures.push("unexpected product");
    if (m.version !== expectedVersion) failures.push("version mismatch");
    if (m.platform?.os !== "linux") failures.push("OS mismatch");
    if (m.platform?.architecture !== expectedArch) failures.push("architecture mismatch");
    if (m.runtime?.node?.bundled !== true) failures.push("Node.js runtime is not declared bundled");
    const expectedClients = {
      sqlite: "node_modules/@prisma/client/index.js",
      postgresql: "prisma/generated/postgresql/index.js",
    };
    for (const [adapter, expectedPath] of Object.entries(expectedClients)) {
      const clientPath = m.runtime?.databaseClients?.[adapter]?.path;
      if (clientPath !== expectedPath) {
        failures.push(`${adapter} Prisma client contract missing`);
      } else {
        const resolvedClient = path.resolve(releaseRoot, clientPath);
        if (!resolvedClient.startsWith(path.resolve(releaseRoot) + path.sep)) {
          failures.push(`${adapter} Prisma client path escapes release root`);
        } else if (!fs.existsSync(resolvedClient)) {
          failures.push(`${adapter} Prisma client missing`);
        }
      }
    }
    if (!m.migrations?.sqlite?.sha256 || !m.migrations?.postgresql?.sha256) {
      failures.push("migration checksums missing");
    }
    for (const adapter of ["sqlite", "postgresql"]) {
      const migration = m.migrations?.[adapter];
      if (migration?.path && migration?.sha256) {
        const directory = path.resolve(releaseRoot, migration.path);
        if (!directory.startsWith(path.resolve(releaseRoot) + path.sep)) {
          failures.push(`${adapter} migration path escapes release root`);
        } else if (hashDirectory(directory) !== migration.sha256) {
          failures.push(`${adapter} migration checksum mismatch`);
        }
      }
    }
    if (m.services?.redis?.required !== true) failures.push("Redis contract missing");
    const sbom = m.supplyChain?.sbom;
    if (!sbom?.path || !sbom?.sha256) {
      failures.push("SBOM checksum missing");
    } else {
      const sbomPath = path.resolve(releaseRoot, sbom.path);
      if (!sbomPath.startsWith(path.resolve(releaseRoot) + path.sep)) {
        failures.push("SBOM path escapes release root");
      } else if (hashFile(sbomPath) !== sbom.sha256) {
        failures.push("SBOM checksum mismatch");
      }
    }
    if (failures.length) {
      console.error(failures.join("; "));
      process.exit(1);
    }
  ' "${manifest}" "${expected_version}" "${expected_arch}" "${STAGING_DIR}" \
    || die "release manifest compatibility validation failed"
  log_ok "release manifest verified (v${expected_version}, linux-${expected_arch})"
}

_promote_staging() {
  local target="${RESOLVED_INSTALL_DIR}/releases/${TAG}"
  if [ -d "${target}" ]; then
    if [ "${FLAG_FORCE}" -eq 1 ]; then
      local archived="${RESOLVED_INSTALL_DIR}/releases/.replaced-${TAG}.$$"
      log_warn "releases/${TAG} already exists; --force in effect, archiving as $(basename "${archived}")"
      mv -T "${target}" "${archived}"
    else
      die "releases/${TAG} already exists; pass --force to archive it and proceed"
    fi
  fi
  mv -T "${STAGING_DIR}" "${target}"
  STAGING_DIR=""
  log_ok "promoted staging to releases/${TAG}"
}

_sanity_check_no_stale_current_tmp() {
  local stale_files
  mapfile -t stale_files < <(find "${RESOLVED_INSTALL_DIR}" -maxdepth 1 -name 'current.tmp.*' 2>/dev/null)
  [ "${#stale_files[@]}" -eq 0 ] && return 0

  if [ "${FLAG_CLEAN_STALE}" -eq 1 ]; then
    # Lock is already held by the caller, so no concurrent installer can be
    # writing these. Remove and continue.
    local f
    for f in "${stale_files[@]}"; do
      rm -f "${f}" 2>/dev/null \
        && log_info "removed stale temp symlink: ${f}" \
        || log_warn "could not remove stale temp symlink: ${f}"
    done
    return 0
  fi

  die "stale temp symlink found: ${stale_files[0]}; pass --clean-stale to auto-remove or inspect and rm manually"
}

install_main() {
  local mode=${1:-install}
  preflight
  fetch_latest_version
  fetch_release_artifacts
  verify_checksum
  verify_release_signature

  if [ "${FLAG_DRY_RUN}" -eq 1 ]; then
    log_ok "--dry-run: download + verify succeeded for ${TAG}"
    log_info "no INSTALL_DIR writes performed; ${RESOLVED_INSTALL_DIR} untouched"
    return 0
  fi

  # Writability deferred to here; not done in preflight.
  if [ ! -d "${RESOLVED_INSTALL_DIR}" ]; then
    if [ "${RUNNING_AS_ROOT}" -eq 1 ]; then
      mkdir -p "${RESOLVED_INSTALL_DIR}"
    elif mkdir -p "${RESOLVED_INSTALL_DIR}" 2>/dev/null; then
      log_info "created ${RESOLVED_INSTALL_DIR} as $(id -un)"
    elif command -v sudo >/dev/null 2>&1; then
      log_info "creating ${RESOLVED_INSTALL_DIR} (sudo)"
      sudo mkdir -p "${RESOLVED_INSTALL_DIR}"
      sudo chown "$(id -u):$(id -g)" "${RESOLVED_INSTALL_DIR}"
    else
      die "cannot create ${RESOLVED_INSTALL_DIR}: parent not writable and no sudo available"
    fi
  fi
  [ -w "${RESOLVED_INSTALL_DIR}" ] \
    || die "${RESOLVED_INSTALL_DIR} not writable by $(id -un)"

  _sanity_check_no_stale_current_tmp

  beginning_ritual "${mode}"

  mkdir -p "${RESOLVED_INSTALL_DIR}/releases"
  acquire_lock

  local previous_version=""
  if [ "${mode}" = "update" ]; then
    previous_version=$(basename "$(readlink -f "${RESOLVED_INSTALL_DIR}/current")")
    case "${previous_version}" in v*) ;; *) previous_version="" ;; esac
  fi

  _extract_to_staging
  _promote_staging

  local release_dir="${RESOLVED_INSTALL_DIR}/releases/${TAG}"
  if [ ! -d "${RESOLVED_INSTALL_DIR}/runtime" ]; then
    _first_install_runtime_populate "${release_dir}"
  else
    log_info "runtime/ exists; not touched (operator-managed)"
  fi

  _link_release_runtime "${release_dir}"
  _atomic_pointer_swap

  install_parako_binary
  write_parako_state "${TAG}" "${previous_version}" "${PARAKO_BIN_RESOLVED:-}"

  print_next_steps_card "${TAG}" "${previous_version}"
}

# -----------------------------------------------------------------------------
# §14  update_main
# -----------------------------------------------------------------------------
update_main() {
  [ -L "${RESOLVED_INSTALL_DIR}/current" ] \
    || die "no existing install detected at ${RESOLVED_INSTALL_DIR}/current; run without --update for a fresh install"
  install_main "update"
}

# -----------------------------------------------------------------------------
# §15  rollback_main
# -----------------------------------------------------------------------------
rollback_main() {
  preflight
  RESOLVED_INSTALL_DIR=${INSTALL_DIR}
  [ -d "${RESOLVED_INSTALL_DIR}" ] || die "install dir not found: ${RESOLVED_INSTALL_DIR}"
  [ -L "${RESOLVED_INSTALL_DIR}/current" ] \
    || die "no current symlink at ${RESOLVED_INSTALL_DIR}/current"

  _sanity_check_no_stale_current_tmp
  acquire_lock

  local current_target target
  current_target=$(basename "$(readlink -f "${RESOLVED_INSTALL_DIR}/current")")
  if [ -n "${FLAG_ROLLBACK_TO}" ]; then
    target=${FLAG_ROLLBACK_TO}
  else
    target=$(read_state_field PREVIOUS_VERSION || true)
  fi
  [ -n "${target}" ] || die "no previous version recorded; pass --to <vX.Y.Z>"
  [ -d "${RESOLVED_INSTALL_DIR}/releases/${target}" ] \
    || die "target release not on disk: ${RESOLVED_INSTALL_DIR}/releases/${target}"
  [ "${target}" = "${current_target}" ] \
    && die "target ${target} is already current; nothing to do"

  print_header "Rollback plan"
  print_label "Current"   "${current_target}"
  print_label "Target"    "${target}"
  printf '\n'
  printf 'Scope: application files only. Apply any reverse database migration\n'
  printf 'for %s manually before restarting on the older release.\n\n' "${current_target}"
  if [ "${FLAG_FORCE}" -eq 0 ] && [ "${FLAG_NON_INTERACTIVE}" -eq 0 ]; then
    if ! prompt_yn_timeout "Proceed with app-file rollback?" "no" 60; then
      log_info "aborted by operator"
      exit 0
    fi
  fi

  TAG=${target}
  _atomic_pointer_swap
  write_parako_state "${target}" "${current_target}"

  print_header "Rollback complete"
  print_label "Current" "${target}"
  print_label "Previous" "${current_target}  (kept; rollback again to switch back)"
  printf '\n  Restart your service with your own process manager.\n'
  printf '  If you migrated the database when going to %s, you must apply the\n' "${current_target}"
  printf '  reverse migration manually — see the %s release notes.\n\n' "${current_target}"
}

# -----------------------------------------------------------------------------
# §16  doctor_main (file/config only; no service / DB / network)
# -----------------------------------------------------------------------------
doctor_main() {
  RESOLVED_INSTALL_DIR=${INSTALL_DIR}
  local install_dir=${RESOLVED_INSTALL_DIR}
  local current_link="${install_dir}/current"
  local current_target=""
  local pkg_version="unknown"
  local installed_at=""
  local previous=""

  if [ -L "${current_link}" ]; then
    current_target=$(basename "$(readlink -f "${current_link}")")
  fi
  if [ -L "${current_link}" ] && [ -f "${current_link}/package.json" ]; then
    pkg_version=$(grep -E '"version"' "${current_link}/package.json" | head -n1 \
      | sed -E 's/.*"version":[[:space:]]*"([^"]+)".*/\1/')
  fi
  if [ -r "${install_dir}/.parako-state" ]; then
    installed_at=$(grep -E '^INSTALLED_AT=' "${install_dir}/.parako-state" | cut -d= -f2- || true)
    previous=$(grep -E '^PREVIOUS_VERSION=' "${install_dir}/.parako-state" | cut -d= -f2- || true)
  fi
  local entry="${current_link}/dist/src/index.js"
  local env_file="${install_dir}/runtime/.env"
  local jwks_file="${install_dir}/runtime/jwks/jwks.json"

  local entry_present=1; [ -f "${entry}" ] || entry_present=0
  local env_present=1;   [ -f "${env_file}" ] || env_present=0
  local jwks_present=1;  [ -f "${jwks_file}" ] || jwks_present=0
  local releases_count=0
  if [ -d "${install_dir}/releases" ]; then
    releases_count=$(find "${install_dir}/releases" -maxdepth 1 -mindepth 1 -name 'v*' -type d 2>/dev/null | wc -l | tr -d ' ')
  fi

  if [ "${FLAG_JSON}" -eq 1 ]; then
    printf '{\n'
    printf '  "install_dir": "%s",\n'    "${install_dir}"
    printf '  "current": "%s",\n'        "${current_target}"
    printf '  "previous": "%s",\n'       "${previous}"
    printf '  "version": "%s",\n'        "${pkg_version}"
    printf '  "installed_at": "%s",\n'   "${installed_at}"
    printf '  "entry_present": %s,\n'    "$([ "${entry_present}" -eq 1 ] && printf 'true' || printf 'false')"
    printf '  "env_present": %s,\n'      "$([ "${env_present}"   -eq 1 ] && printf 'true' || printf 'false')"
    printf '  "jwks_present": %s,\n'     "$([ "${jwks_present}"  -eq 1 ] && printf 'true' || printf 'false')"
    printf '  "releases_on_disk": %s\n'  "${releases_count}"
    printf '}\n'
    return 0
  fi

  print_header "Parako.ID doctor"
  print_label "Install dir"     "${install_dir}"
  print_label "Current release" "${current_target:-<none>}"
  print_label "Previous"        "${previous:-<none>}"
  print_label "Version"         "${pkg_version}"
  print_label "Installed at"    "${installed_at:-<unknown>}"
  if [ "${entry_present}" -eq 1 ]; then
    _pf_ok "dist/src/index.js" "present"
  else
    _pf_fail "dist/src/index.js" "missing under current/"
  fi
  if [ "${env_present}" -eq 1 ]; then
    _pf_ok "runtime/.env" "present"
  else
    _pf_warn "runtime/.env" "missing (operator must create; copy from current/contrib/.env.sample)"
  fi
  if [ "${jwks_present}" -eq 1 ]; then
    _pf_ok "runtime/jwks/jwks.json" "present"
  else
    print_label "runtime/jwks/jwks.json" "absent [${C_BLUE}INFO${C_RESET}] (only required for file-backed key storage)"
  fi
  print_label "Releases on disk" "${releases_count}"
  printf '\n'
  printf '  Doctor checks application files only. For service status, database\n'
  printf '  connectivity, and HTTP health, use your supervisor, DB client, and\n'
  printf '  health probe respectively.\n'
}

# -----------------------------------------------------------------------------
# §17  gc_main (prune releases/ only; never touches runtime/)
# -----------------------------------------------------------------------------
gc_main() {
  RESOLVED_INSTALL_DIR=${INSTALL_DIR}
  local install_dir=${RESOLVED_INSTALL_DIR}
  [ -d "${install_dir}/releases" ] || die "no releases/ dir at ${install_dir}"

  acquire_lock

  local current="" previous=""
  if [ -L "${install_dir}/current" ]; then
    current=$(basename "$(readlink -f "${install_dir}/current")")
  fi
  previous=$(read_state_field PREVIOUS_VERSION 2>/dev/null || true)

  # All versioned releases on disk, newest mtime first.
  local all=()
  while IFS= read -r line; do all+=("${line}"); done < <(
    find "${install_dir}/releases" -maxdepth 1 -mindepth 1 -name 'v*' -type d -printf '%T@ %f\n' 2>/dev/null \
      | sort -rn | awk '{print $2}'
  )

  # Build the deletable set (= all \ {current, previous}).
  local deletable=() retained=() v
  for v in "${all[@]}"; do
    if [ "${v}" = "${current}" ] || [ "${v}" = "${previous}" ]; then
      continue
    fi
    deletable+=("${v}")
  done

  # Keep N most recent of the deletable set; rest are slated for deletion.
  local to_delete=() i=0
  for v in "${deletable[@]}"; do
    if [ "${i}" -lt "${FLAG_KEEP}" ]; then
      retained+=("${v}")
    else
      to_delete+=("${v}")
    fi
    i=$((i + 1))
  done

  print_header "GC plan"
  print_label "Install dir"  "${install_dir}"
  print_label "Current"      "${current:-<none>} (always retained)"
  print_label "Previous"     "${previous:-<none>} (always retained)"
  print_label "Keep policy"  "--keep ${FLAG_KEEP} (from the deletable set)"

  printf '\n  Will retain: '
  if [ ${#retained[@]} -eq 0 ]; then printf '<none beyond protected>'; else printf '%s ' "${retained[@]}"; fi
  printf '\n'
  printf '  Will delete: '
  if [ ${#to_delete[@]} -eq 0 ]; then printf '<none>'; else printf '%s ' "${to_delete[@]}"; fi
  printf '\n\n'

  if [ ${#to_delete[@]} -eq 0 ]; then
    log_info "nothing to delete"
    return 0
  fi

  if [ "${FLAG_YES}" -eq 0 ]; then
    printf '  (preview only; pass --yes to apply)\n'
    return 0
  fi

  for v in "${to_delete[@]}"; do
    rm -rf "${install_dir}/releases/${v}" \
      || log_warn "failed to remove releases/${v}"
    log_ok "removed releases/${v}"
  done
  log_info "runtime/ untouched (gc does not manage operator data)"
}

# -----------------------------------------------------------------------------
# §18  uninstall_main (remove install pointer + releases; runtime preserved
#      unless --purge; parako binary removed unless --keep-bin)
# -----------------------------------------------------------------------------
uninstall_main() {
  preflight
  RESOLVED_INSTALL_DIR=${INSTALL_DIR}
  [ -d "${RESOLVED_INSTALL_DIR}" ] || die "install dir not found: ${RESOLVED_INSTALL_DIR}"

  _sanity_check_no_stale_current_tmp
  acquire_lock

  # Inventory operator data under runtime/ before deciding what to remove.
  local has_operator_data=0
  local notes=()
  local rt="${RESOLVED_INSTALL_DIR}/runtime"
  if [ -d "${rt}" ]; then
    [ -s "${rt}/.env" ] && { has_operator_data=1; notes+=("runtime/.env"); }
    if [ -d "${rt}/jwks" ] && [ -n "$(find "${rt}/jwks" -mindepth 1 -not -name '.gitkeep' 2>/dev/null | head -n1)" ]; then
      has_operator_data=1; notes+=("runtime/jwks/ (signing keys — destroying breaks every issued token)")
    fi
    local sub
    for sub in uploads backups config-backups logs data; do
      if [ -d "${rt}/${sub}" ] && [ -n "$(find "${rt}/${sub}" -mindepth 1 -not -name '.gitkeep' 2>/dev/null | head -n1)" ]; then
        has_operator_data=1; notes+=("runtime/${sub}/")
      fi
    done
  fi

  local current_target=""
  [ -L "${RESOLVED_INSTALL_DIR}/current" ] \
    && current_target=$(basename "$(readlink -f "${RESOLVED_INSTALL_DIR}/current")") || true

  print_header "Uninstall plan"
  print_label "Install dir"     "${RESOLVED_INSTALL_DIR}"
  print_label "Current release" "${current_target:-<none>}"
  printf '\n'
  printf '  Will remove: %s/{current, releases/, .parako-state, .install-lock}\n' "${RESOLVED_INSTALL_DIR}"
  if [ "${FLAG_PURGE}" -eq 1 ]; then
    printf '  Will remove: %s/runtime/  (--purge)\n' "${RESOLVED_INSTALL_DIR}"
    if [ "${has_operator_data}" -eq 1 ]; then
      printf '    Operator data that will be destroyed:\n'
      local n; for n in "${notes[@]}"; do printf '      - %s\n' "${n}"; done
    fi
  else
    printf '  Will preserve: %s/runtime/  (operator-managed; pass --purge to also remove)\n' "${RESOLVED_INSTALL_DIR}"
  fi
  # Resolve binary path: prefer state-file, fall back to PATH lookup.
  local bin_path
  bin_path=$(read_state_field PARAKO_BIN_PATH 2>/dev/null || true)
  if [ -z "${bin_path}" ]; then
    bin_path=$(command -v parako 2>/dev/null || true)
  fi
  if [ "${FLAG_KEEP_BIN}" -eq 1 ]; then
    printf '  Will preserve: %s  (--keep-bin)\n' "${bin_path:-<no parako binary found>}"
  elif [ -n "${bin_path}" ] && [ -f "${bin_path}" ]; then
    printf '  Will remove: %s  (parako helper binary)\n' "${bin_path}"
  fi
  printf '\n'

  if [ "${has_operator_data}" -eq 1 ] && [ "${FLAG_PURGE}" -eq 0 ]; then
    log_info "operator data present under runtime/ — will be preserved without --purge"
  fi

  if [ "${FLAG_FORCE}" -eq 0 ] && [ "${FLAG_NON_INTERACTIVE}" -eq 0 ]; then
    if ! prompt_yn_timeout "Proceed with uninstall?" "no" 60; then
      log_info "aborted by operator"
      exit 0
    fi
    if [ "${FLAG_PURGE}" -eq 1 ] && [ "${has_operator_data}" -eq 1 ]; then
      printf '  --purge will destroy operator data. Type %syes%s in full to confirm: ' "${C_RED}" "${C_RESET}"
      local conf=""
      if [ ! -t 0 ] && [ -r /dev/tty ]; then
        IFS= read -r conf < /dev/tty || conf=""
      else
        IFS= read -r conf || conf=""
      fi
      [ "${conf}" = "yes" ] || die "--purge with operator data requires explicit yes"
    fi
  fi

  # Atomic-ish removal: current pointer first (clients lose target immediately),
  # then releases/, then state metadata. Lock is released on EXIT trap.
  if [ -L "${RESOLVED_INSTALL_DIR}/current" ] || [ -e "${RESOLVED_INSTALL_DIR}/current" ]; then
    rm -rf "${RESOLVED_INSTALL_DIR}/current"
    log_ok "removed current symlink"
  fi
  if [ -d "${RESOLVED_INSTALL_DIR}/releases" ]; then
    rm -rf "${RESOLVED_INSTALL_DIR}/releases"
    log_ok "removed releases/"
  fi
  rm -f "${RESOLVED_INSTALL_DIR}/.parako-state"
  # Lock file is still held; the EXIT trap closes FD 9; remove the file last.

  if [ "${FLAG_PURGE}" -eq 1 ] && [ -d "${rt}" ]; then
    rm -rf "${rt}"
    log_ok "removed runtime/  (--purge)"
  fi

  if [ "${FLAG_KEEP_BIN}" -eq 0 ] && [ -n "${bin_path}" ] && [ -f "${bin_path}" ]; then
    local need_sudo=""
    [ -w "${bin_path}" ] || need_sudo="sudo"
    if [ -n "${need_sudo}" ] && [ "${RUNNING_AS_ROOT}" -eq 0 ] && ! command -v sudo >/dev/null 2>&1; then
      log_warn "cannot remove ${bin_path} (no sudo available); rm manually"
    else
      ${need_sudo} rm -f "${bin_path}" \
        && log_ok "removed ${bin_path}" \
        || log_warn "could not remove ${bin_path}; rm manually"
    fi
  fi

  print_header "Uninstall complete"
  print_label "Install dir"  "${RESOLVED_INSTALL_DIR}"
  if [ "${FLAG_PURGE}" -eq 1 ]; then
    print_label "Runtime"   "removed"
  else
    print_label "Runtime"   "${rt}  (preserved)"
  fi
  printf '\n'
  printf '  To reinstall: curl --proto =https --tlsv1.2 -fsSL https://get.parako.id | bash\n\n'
}

# -----------------------------------------------------------------------------
# §19  --plan (pure preview; no network, no INSTALL_DIR writes)
# -----------------------------------------------------------------------------
plan_main() {
  local mode=${1:-install}
  RESOLVED_INSTALL_DIR=${INSTALL_DIR}
  local target=${FLAG_VERSION:-<latest>}
  print_header "--plan (no network, no mutations)"
  print_label "Operation"      "${mode}"
  print_label "Target version" "${target}"
  print_label "Install dir"    "${RESOLVED_INSTALL_DIR}"
  printf '\n'
  printf '  Scope: verified application artifact staging. parako handles the\n'
  printf '  production database and service lifecycle after installation.\n\n'
  printf '  Would resolve %s, download + cosign-verify the artifact, stage it under\n' "${target}"
  printf '    %s/releases/.staging.<tag>.$$\n' "${RESOLVED_INSTALL_DIR}"
  printf '  then atomically swap %s/current.\n' "${RESOLVED_INSTALL_DIR}"
  printf '\n  Use --dry-run to download + verify against a TMPDIR scratch space (no install).\n'
}

# -----------------------------------------------------------------------------
# §19  Dispatcher
# -----------------------------------------------------------------------------
main() {
  parse_args "$@"
  ui_init_colors
  log_init
  detect_downloader

  if [ "${FLAG_HELP}" -eq 1 ]; then
    print_help
    exit 0
  fi

  if [ "${FLAG_PLAN}" -eq 1 ]; then
    if [ "${FLAG_UPDATE}" -eq 1 ]; then plan_main "update"
    else plan_main "install"
    fi
    exit 0
  fi

  if [ "${FLAG_UNINSTALL}" -eq 1 ]; then uninstall_main; exit 0; fi
  if [ "${FLAG_DOCTOR}" -eq 1 ]; then doctor_main; exit 0; fi
  if [ "${FLAG_GC}"     -eq 1 ]; then gc_main;     exit 0; fi
  if [ "${FLAG_ROLLBACK}" -eq 1 ]; then rollback_main; exit 0; fi
  if [ "${FLAG_UPDATE}"   -eq 1 ]; then update_main;   exit 0; fi

  install_main "install"
}

main "$@"
