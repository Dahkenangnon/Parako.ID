#!/usr/bin/env bash
# =============================================================================
# Parako.ID Installer
# License: MIT  https://github.com/Dahkenangnon/Parako.ID/blob/main/LICENSE
# Threat model: docs/installer-security.md
# Prerequisite: bash >= 4.0 (Alpine: `apk add bash` before running)
# =============================================================================

# =============================================================================
# §0  Strict mode + safety guards
# -----------------------------------------------------------------------------
# Invariants:
#   - errexit, nounset, pipefail, errtrace, IFS, inherit_errexit, umask 077.
#   - ERR trap reports failing line + command; EXIT trap cleans up tempdir + lock.
#   - INT/TERM/HUP trap reports interruption and exits 130.
# References:
#   http://redsymbol.net/articles/unofficial-bash-strict-mode/
#   https://www.shellcheck.net/wiki/SC2310 (set -e gotchas)
# =============================================================================
set -Eeuo pipefail
IFS=$'\n\t'
shopt -s inherit_errexit 2>/dev/null || true
umask 077

# Filled in §1 once paths exist; declared here so cleanup is safe early.
TMPDIR_PATH=""
LOCK_FD=""
LOG_FILE=""

on_error() {
  local exit_code=$? line=${BASH_LINENO[0]:-0} cmd=${BASH_COMMAND:-?}
  # Avoid recursion if log_err itself fails.
  if declare -F log_err >/dev/null 2>&1; then
    log_err "exit ${exit_code} at line ${line}: ${cmd}"
  else
    printf '[ERR]  exit %d at line %d: %s\n' "${exit_code}" "${line}" "${cmd}" >&2
  fi
  cleanup
  exit "${exit_code}"
}

cleanup() {
  if [ -n "${TMPDIR_PATH}" ] && [ -d "${TMPDIR_PATH}" ]; then
    rm -rf "${TMPDIR_PATH}" 2>/dev/null || true
  fi
  if [ -n "${LOCK_FD}" ]; then
    # LOCK_FD is always 9 (set by acquire_lock); close that FD explicitly.
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

# =============================================================================
# §1  Constants + paths
# -----------------------------------------------------------------------------
# Invariants:
#   - All constants are read-only after this section.
#   - Paths are resolved deterministically; no surprise sudo re-execs.
# =============================================================================

readonly INSTALLER_VERSION="0.2.0"
readonly REPO_OWNER="Dahkenangnon"
readonly REPO_NAME="Parako.ID"
readonly GITHUB_API="https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}"
readonly DEFAULT_PORT=9007
readonly MIN_NODE_MAJOR=24
readonly MIN_PNPM_MAJOR=11
readonly MIN_BASH_MAJOR=4
readonly MIN_DISK_BYTES=2147483648  # 2 GiB
readonly HEALTH_PATH="/health"
readonly HEALTH_FALLBACK_PATH="/.well-known/openid-configuration"
readonly HEALTH_TIMEOUT_SECS=15
readonly TIME_SKEW_TOLERANCE_SECS=60

# Cosign bootstrap chain-of-trust constants. Updated by the maintainer when the
# cosign release bumps. Verification source: sigstore/cosign GitHub Releases.
# https://github.com/sigstore/cosign/releases
readonly COSIGN_VERSION="2.4.1"
# Real SHA256 values from sigstore/cosign v2.4.1 cosign_checksums.txt.
# When bumping COSIGN_VERSION, re-fetch from:
#   curl -sSfL https://github.com/sigstore/cosign/releases/download/v${COSIGN_VERSION}/cosign_checksums.txt
# Procedure documented in docs/installer-security.md#updating-cosign-bootstrap-constants
readonly COSIGN_SHA256_LINUX_AMD64="8b24b946dd5809c6bd93de08033bcf6bc0ed7d336b7785787c080f574b89249b"
readonly COSIGN_SHA256_LINUX_ARM64="3b2e2e3854d0356c45fe6607047526ccd04742d20bd44afb5be91fa2a6e7cb4a"

# Cosign identity for Parako.ID release signing (set when CI starts signing).
readonly COSIGN_CERT_IDENTITY_REGEX='https://github\.com/Dahkenangnon/Parako\.ID/\.github/workflows/release\.yml@.*'
readonly COSIGN_OIDC_ISSUER='https://token.actions.githubusercontent.com'

# Installation directory defaults: /opt/parako-id (root) or ./parako-id (user).
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
FLAG_PORT=""
FLAG_NO_START=0
FLAG_NON_INTERACTIVE=0
FLAG_UPDATE=0
FLAG_FORCE=0
FLAG_PLAN=0
FLAG_DRY_RUN=0
FLAG_DOCTOR=0
FLAG_ROLLBACK=0
FLAG_ROLLBACK_TO=""
FLAG_MIGRATE_BACK=0
FLAG_GC=0
FLAG_KEEP=3
FLAG_YES=0
FLAG_JSON=0
FLAG_NO_COLOR=0
FLAG_WITH_NGINX=0
FLAG_WITH_TLS=0
FLAG_DOMAIN=""
FLAG_TLS_EMAIL=""
FLAG_MULTI_TENANT=0
FLAG_BASE_DOMAIN=""
FLAG_CERTBOT_DNS_PLUGIN=""
FLAG_DEMO=0
FLAG_OFFLINE=0
FLAG_OFFLINE_TARBALL=""
FLAG_OFFLINE_CHECKSUM=""
FLAG_OFFLINE_SIGNATURE=""
FLAG_OFFLINE_CERTIFICATE=""
FLAG_INSECURE_NO_SIGNATURE=0
FLAG_INSECURE_REASON=""
FLAG_BOOTSTRAP_ADMIN_EMAIL=""
FLAG_DB=""
FLAG_POSTGRES_URL=""
FLAG_MONGO_URI=""
FLAG_REDIS_URL=""
FLAG_SUPERVISOR=""

# Wizard answers.
BOOTSTRAP_ADMIN_PASSWORD=""
ANS_ENV="development"
ANS_PORT="${DEFAULT_PORT}"
ANS_URL=""
ANS_DB="sqlite"
ANS_MONGO_URI="mongodb://localhost:27017/parako-id"
ANS_PG_URL="postgresql://localhost:5432/parako"
ANS_REDIS="no"
ANS_REDIS_HOST="localhost"
ANS_REDIS_PORT="6379"
ANS_SUPERVISOR="systemd"

# Sniffed environment.
SNIFFED_MONGO=""
SNIFFED_POSTGRES=""
SNIFFED_REDIS=""
SNIFFED_INIT=""

# Runtime state.
DOWNLOAD_CMD=""
TAG=""
RESOLVED_INSTALL_DIR=""
RUN_TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# =============================================================================
# §2  Logging + UI (color, label format, spinner, redactor)
# -----------------------------------------------------------------------------
# Invariants:
#   - Output is plain text. NO Unicode box-drawing characters.
#   - Colors auto-disabled on non-TTY or when NO_COLOR is set.
#   - Every log line passes through redact() before going to disk OR stdout.
#   - Log file is mode 0600, JSON-lines on disk for tooling, human on stdout.
# Reference:
#   https://no-color.org/
# =============================================================================

# Color codes; emptied later if NO_COLOR or non-TTY.
C_RED=""
C_GREEN=""
C_YELLOW=""
C_BLUE=""
C_CYAN=""
C_BOLD=""
C_DIM=""
C_RESET=""

ui_init_colors() {
  if [ -n "${NO_COLOR:-}" ] || [ "${FLAG_NO_COLOR}" -eq 1 ] || [ ! -t 1 ]; then
    return 0
  fi
  C_RED=$'\033[0;31m'
  C_GREEN=$'\033[0;32m'
  C_YELLOW=$'\033[1;33m'
  C_BLUE=$'\033[0;34m'
  C_CYAN=$'\033[0;36m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_RESET=$'\033[0m'
}

# Section header. Plain text, no boxes.
print_header() {
  printf '\n%s== %s%s\n' "${C_CYAN}${C_BOLD}" "$1" "${C_RESET}"
}

# Dotted-label fact row. Renders: "  label .........  value"
# Total width auto-fits terminal up to 80 cols.
print_label() {
  local label=$1 value=$2 width=70
  if command -v tput >/dev/null 2>&1; then
    local cols
    cols=$(tput cols 2>/dev/null || printf '80')
    [ "${cols}" -lt 60 ] && cols=60
    width=$((cols - 4))
  fi
  local lbl_len=${#label} val_len=${#value}
  local dots_len=$((width - lbl_len - val_len - 2))
  [ "${dots_len}" -lt 3 ] && dots_len=3
  local dots
  dots=$(printf '%*s' "${dots_len}" '' | tr ' ' '.')
  printf '  %s %s %s\n' "${label}" "${dots}" "${value}"
}

# Sensitive-value redactor. Used by ALL log writes.
redact() {
  # Remove credential-bearing URI authority (scheme://user:pass@host).
  # Mask any KEY=VALUE pair where KEY matches a sensitive name.
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
  # JSON-lines for tooling. printf escapes embedded quotes; we limit message
  # to single-line for simplicity.
  redacted_msg=${redacted_msg//\\/\\\\}
  redacted_msg=${redacted_msg//\"/\\\"}
  redacted_msg=${redacted_msg//$'\n'/ }
  printf '{"ts":"%s","level":"%s","source":"%s","message":"%s"}\n' \
    "${ts}" "${level}" "${source}" "${redacted_msg}" >> "${LOG_FILE}" 2>/dev/null || true
}

log_info() {
  local msg
  msg=$(printf '%s' "$1" | redact)
  printf '%s[INFO]%s %s\n' "${C_BLUE}" "${C_RESET}" "${msg}"
  _log_disk INFO main "$1"
}

log_ok() {
  local msg
  msg=$(printf '%s' "$1" | redact)
  printf '%s[OK]%s   %s\n' "${C_GREEN}" "${C_RESET}" "${msg}"
  _log_disk OK main "$1"
}

log_warn() {
  local msg
  msg=$(printf '%s' "$1" | redact)
  printf '%s[WARN]%s %s\n' "${C_YELLOW}" "${C_RESET}" "${msg}" >&2
  _log_disk WARN main "$1"
}

log_err() {
  local msg
  msg=$(printf '%s' "$1" | redact)
  printf '%s[FAIL]%s %s\n' "${C_RED}" "${C_RESET}" "${msg}" >&2
  _log_disk ERROR main "$1"
}

die() { log_err "$1"; exit "${2:-1}"; }

# Set up the log file. Called immediately after color init.
log_init() {
  local dir
  if [ "${RUNNING_AS_ROOT}" -eq 1 ]; then
    dir="${DEFAULT_LOG_DIR}"
  else
    dir="${DEFAULT_LOG_DIR}"
    mkdir -p "${dir}" 2>/dev/null || dir="${TMPDIR:-/tmp}"
  fi
  LOG_FILE="${dir}/parako-install-${RUN_TIMESTAMP}.log"
  # mode 0600 even if mkdir created the dir 0755.
  : > "${LOG_FILE}" 2>/dev/null || {
    # If we can't write to /var/log, fall back to TMPDIR.
    LOG_FILE="${TMPDIR:-/tmp}/parako-install-${RUN_TIMESTAMP}.log"
    : > "${LOG_FILE}"
  }
  chmod 0600 "${LOG_FILE}" 2>/dev/null || true
  _log_disk INFO main "installer ${INSTALLER_VERSION} starting, run ${RUN_TIMESTAMP}"
}

# =============================================================================
# §3  Input helpers
# -----------------------------------------------------------------------------
# Invariants:
#   - All prompts go to stderr by way of printf (so command substitution captures
#     only the chosen value via read -r answer; answer is printed via printf '%s').
#   - Validators (is_valid_*) accept exactly one argument and return 0/1.
# =============================================================================

prompt_value() {
  local text=$1 default=${2:-} answer=""
  if [ -n "${default}" ]; then
    printf '  %s%s%s [%s%s%s]: ' "${C_CYAN}" "${text}" "${C_RESET}" "${C_DIM}" "${default}" "${C_RESET}"
  else
    printf '  %s%s%s: ' "${C_CYAN}" "${text}" "${C_RESET}"
  fi
  IFS= read -r answer || answer=""
  [ -z "${answer}" ] && [ -n "${default}" ] && answer="${default}"
  printf '%s' "${answer}"
}

prompt_choice() {
  local text=$1 options=$2 default=$3 answer="" saved_ifs
  while true; do
    printf '  %s%s%s (%s%s%s) [%s%s%s]: ' \
      "${C_CYAN}" "${text}" "${C_RESET}" \
      "${C_DIM}" "${options}" "${C_RESET}" \
      "${C_DIM}" "${default}" "${C_RESET}"
    IFS= read -r answer || answer=""
    [ -z "${answer}" ] && answer="${default}"
    saved_ifs=${IFS}
    IFS=/
    for opt in ${options}; do
      if [ "${answer}" = "${opt}" ]; then
        IFS=${saved_ifs}
        printf '%s' "${answer}"
        return 0
      fi
    done
    IFS=${saved_ifs}
    printf '  %sInvalid choice.%s Please enter one of: %s\n' "${C_RED}" "${C_RESET}" "${options}" >&2
  done
}

prompt_yn() {
  local text=$1 default=$2 hint="" answer=""
  if [ "${default}" = "yes" ]; then hint="Y/n"; else hint="y/N"; fi
  printf '  %s%s%s [%s%s%s]: ' "${C_CYAN}" "${text}" "${C_RESET}" "${C_DIM}" "${hint}" "${C_RESET}"
  IFS= read -r answer || answer=""
  [ -z "${answer}" ] && answer="${default}"
  case "${answer}" in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac
}

prompt_yn_timeout() {
  local text=$1 default=$2 secs=${3:-60} hint="" answer=""
  if [ "${default}" = "yes" ]; then hint="Y/n"; else hint="y/N"; fi
  printf '  %s%s%s [%s%s%s] (%ds timeout): ' \
    "${C_CYAN}" "${text}" "${C_RESET}" "${C_DIM}" "${hint}" "${C_RESET}" "${secs}"
  if ! IFS= read -r -t "${secs}" answer; then
    printf '\n'
    log_warn "no response within ${secs}s; aborting"
    return 1
  fi
  [ -z "${answer}" ] && answer="${default}"
  case "${answer}" in y|Y|yes|YES|Yes) return 0 ;; *) return 1 ;; esac
}

is_valid_port() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

is_valid_url() {
  case "$1" in
    https://*|http://*) ;;
    *) return 1 ;;
  esac
  # Reject shell metacharacters.
  case "$1" in *[\;\|\&\$\`\<\>]*) return 1 ;; esac
  return 0
}

is_valid_domain() {
  # Conservative RFC 1035-ish check.
  case "$1" in
    ''|*[!a-zA-Z0-9._-]*|.*|*.|*..*) return 1 ;;
  esac
  return 0
}

is_valid_email() {
  case "$1" in
    ''|*[\;\|\&\$\`\<\>]*) return 1 ;;
    *@*.*) return 0 ;;
    *) return 1 ;;
  esac
}

is_safe_path() {
  case "$1" in
    *..*|*[\;\|\&\$\`\<\>\*\?]*) return 1 ;;
    ''|/) return 1 ;;
  esac
  return 0
}

# =============================================================================
# §4  Args parser + help
# -----------------------------------------------------------------------------
# Invariants:
#   - Every flag value is validated by an explicit is_valid_* function.
#   - Unknown flags emit a warning but do not abort (forward compatibility).
#   - Mutually exclusive modes (--update / --rollback / --doctor / --gc / --demo)
#     are detected after parsing.
# =============================================================================

print_help() {
  cat <<HELPEOF
Parako.ID installer v${INSTALLER_VERSION}

Install, update, roll back, or diagnose a Parako.ID server.

Common workflows:
  Fresh install (interactive)
    curl -sSL https://get.parako.id | bash

  Fresh install (system-wide, sudo)
    curl -sSL https://get.parako.id | sudo bash

  Production install (non-interactive)
    curl -sSL https://get.parako.id | sudo bash -s -- \\
      --non-interactive --force \\
      --domain auth.example.com \\
      --db postgres --postgres-url 'postgresql://parako:***@localhost/parako' \\
      --redis-url 'redis://localhost:6379' \\
      --supervisor systemd \\
      --with-nginx --with-tls --tls-email admin@example.com \\
      --bootstrap-admin admin@example.com

  Update to latest stable
    curl -sSL https://get.parako.id | sudo bash -s -- --update

  Preview an update without changing anything
    curl -sSL https://get.parako.id | sudo bash -s -- --update --plan

  Roll back to the previous snapshot
    curl -sSL https://get.parako.id | sudo bash -s -- --rollback

  Diagnose an existing install
    curl -sSL https://get.parako.id | sudo bash -s -- --doctor

Modes (mutually exclusive):
  (no flag)               Fresh install
  --update                In-place upgrade of an existing installation
  --rollback              Restore the previous snapshot
  --doctor                Diagnose an existing install (no mutation)
  --gc                    Garbage-collect old snapshots
  --demo                  Ephemeral SQLite install in /tmp for evaluation

Mode modifiers:
  --plan                  Show what an --update would do without mutating
  --dry-run               Do everything except the directory swap
  --to YYYYMMDDHHMMSS     (--rollback) Target a specific snapshot
  --migrate-back          (--rollback) Reverse DB migrations (use with care)
  --keep N                (--gc) Number of snapshots to retain (default 3)

Configuration flags:
  --version X.Y.Z         Install/update to a specific version
  --dir <path>            Override install directory
  --port <port>           Override server port
  --supervisor <s>        systemd | pm2 (default: auto-detected)
  --db <type>             sqlite | postgres | mongo
  --postgres-url <url>    PostgreSQL connection URL
  --mongo-uri <uri>       MongoDB URI
  --redis-url <url>       Redis URL
  --domain <d>            Public domain
  --bootstrap-admin <e>   Seed an initial admin user with this email

Reverse proxy / TLS:
  --with-nginx            Render and install an nginx vhost
  --with-tls              Run certbot for Let's Encrypt
  --tls-email <e>         Email for certbot registration
  --multi-tenant          Enable multi-tenancy + wildcard nginx config
  --base-domain <d>       Base domain for multi-tenancy
  --certbot-dns-plugin <p>  certbot DNS plugin for wildcard cert

Air-gapped / offline install:
  --offline               Skip all network calls
  --tarball <path>        (--offline) Pre-downloaded release tarball
  --checksum <path>       (--offline) SHA256SUMS file
  --signature <path>      (--offline) cosign signature
  --certificate <path>    (--offline) cosign certificate

Security escape (USE WITH CARE):
  --insecure-no-signature Bypass cosign verification
  --reason "<text>"       (--insecure-no-signature) Required reason logged

Behaviour:
  --no-start              Skip auto-start after install
  --non-interactive       Use all defaults; no prompts
  --force                 Skip confirmation prompts
  --yes                   (--gc) Apply, not dry-run
  --json                  (--doctor) Emit structured JSON
  --no-color              Disable colored output

Environment:
  INSTALL_DIR             Installation directory
  NO_COLOR                Disable colored output
  PARAKO_RELEASE_MIRROR   Fallback release manifest URL
  PARAKO_LOCK_FILE        Override installer lock file path

Documentation:
  https://docs.parako.id/installer
  https://docs.parako.id/parako-cli
  https://docs.parako.id/installer-security
HELPEOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --help|-h) FLAG_HELP=1 ;;
      --version)
        [ $# -lt 2 ] && die "--version requires a value"
        FLAG_VERSION=$2; shift ;;
      --dir)
        [ $# -lt 2 ] && die "--dir requires a path"
        is_safe_path "$2" || die "--dir value is unsafe: $2"
        FLAG_DIR=$2; shift ;;
      --port)
        [ $# -lt 2 ] && die "--port requires a value"
        is_valid_port "$2" || die "--port value is not a valid port: $2"
        FLAG_PORT=$2; shift ;;
      --supervisor)
        [ $# -lt 2 ] && die "--supervisor requires a value"
        case "$2" in systemd|pm2) FLAG_SUPERVISOR=$2 ;; *) die "--supervisor must be systemd or pm2" ;; esac
        shift ;;
      --db)
        [ $# -lt 2 ] && die "--db requires a value"
        case "$2" in sqlite|postgres|postgresql|mongo|mongodb)
          case "$2" in postgres) FLAG_DB="postgresql" ;; mongo) FLAG_DB="mongodb" ;; *) FLAG_DB=$2 ;; esac
          ;;
        *) die "--db must be sqlite, postgres, or mongo" ;;
        esac
        shift ;;
      --postgres-url)
        [ $# -lt 2 ] && die "--postgres-url requires a value"
        FLAG_POSTGRES_URL=$2; shift ;;
      --mongo-uri)
        [ $# -lt 2 ] && die "--mongo-uri requires a value"
        FLAG_MONGO_URI=$2; shift ;;
      --redis-url)
        [ $# -lt 2 ] && die "--redis-url requires a value"
        FLAG_REDIS_URL=$2; shift ;;
      --domain)
        [ $# -lt 2 ] && die "--domain requires a value"
        is_valid_domain "$2" || die "--domain is not a valid domain: $2"
        FLAG_DOMAIN=$2; shift ;;
      --bootstrap-admin)
        [ $# -lt 2 ] && die "--bootstrap-admin requires an email"
        is_valid_email "$2" || die "--bootstrap-admin is not a valid email: $2"
        FLAG_BOOTSTRAP_ADMIN_EMAIL=$2; shift ;;
      --no-start) FLAG_NO_START=1 ;;
      --non-interactive) FLAG_NON_INTERACTIVE=1 ;;
      --update) FLAG_UPDATE=1 ;;
      --rollback) FLAG_ROLLBACK=1 ;;
      --to)
        [ $# -lt 2 ] && die "--to requires a timestamp"
        FLAG_ROLLBACK_TO=$2; shift ;;
      --migrate-back) FLAG_MIGRATE_BACK=1 ;;
      --doctor) FLAG_DOCTOR=1 ;;
      --gc) FLAG_GC=1 ;;
      --keep)
        [ $# -lt 2 ] && die "--keep requires a number"
        case "$2" in ''|*[!0-9]*) die "--keep must be a non-negative integer" ;; esac
        FLAG_KEEP=$2; shift ;;
      --yes) FLAG_YES=1 ;;
      --plan) FLAG_PLAN=1 ;;
      --dry-run) FLAG_DRY_RUN=1 ;;
      --force) FLAG_FORCE=1 ;;
      --json) FLAG_JSON=1 ;;
      --no-color) FLAG_NO_COLOR=1 ;;
      --with-nginx) FLAG_WITH_NGINX=1 ;;
      --with-tls) FLAG_WITH_TLS=1 ;;
      --tls-email)
        [ $# -lt 2 ] && die "--tls-email requires an email"
        is_valid_email "$2" || die "--tls-email is not a valid email: $2"
        FLAG_TLS_EMAIL=$2; shift ;;
      --multi-tenant) FLAG_MULTI_TENANT=1 ;;
      --base-domain)
        [ $# -lt 2 ] && die "--base-domain requires a domain"
        is_valid_domain "$2" || die "--base-domain is not a valid domain: $2"
        FLAG_BASE_DOMAIN=$2; shift ;;
      --certbot-dns-plugin)
        [ $# -lt 2 ] && die "--certbot-dns-plugin requires a plugin name"
        FLAG_CERTBOT_DNS_PLUGIN=$2; shift ;;
      --demo) FLAG_DEMO=1 ;;
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
      *) log_warn "unknown option: $1" ;;
    esac
    shift
  done

  # --dir overrides INSTALL_DIR which overrides DEFAULT_INSTALL_DIR.
  if [ -n "${FLAG_DIR}" ]; then
    INSTALL_DIR=${FLAG_DIR}
  elif [ -z "${INSTALL_DIR}" ]; then
    INSTALL_DIR=${INSTALL_DIR:-${DEFAULT_INSTALL_DIR}}
  fi

  # Mutually exclusive modes.
  local mode_count=0
  [ "${FLAG_UPDATE}" -eq 1 ] && mode_count=$((mode_count + 1))
  [ "${FLAG_ROLLBACK}" -eq 1 ] && mode_count=$((mode_count + 1))
  [ "${FLAG_DOCTOR}" -eq 1 ] && mode_count=$((mode_count + 1))
  [ "${FLAG_GC}" -eq 1 ] && mode_count=$((mode_count + 1))
  [ "${FLAG_DEMO}" -eq 1 ] && mode_count=$((mode_count + 1))
  if [ "${mode_count}" -gt 1 ]; then
    die "--update, --rollback, --doctor, --gc, --demo are mutually exclusive"
  fi

  # --insecure-no-signature requires --reason.
  if [ "${FLAG_INSECURE_NO_SIGNATURE}" -eq 1 ] && [ -z "${FLAG_INSECURE_REASON}" ]; then
    die "--insecure-no-signature requires --reason \"<text>\""
  fi

  # --with-tls requires --with-nginx.
  if [ "${FLAG_WITH_TLS}" -eq 1 ] && [ "${FLAG_WITH_NGINX}" -eq 0 ]; then
    die "--with-tls requires --with-nginx"
  fi

  # Non-interactive enforcement of required flags.
  if [ "${FLAG_NON_INTERACTIVE}" -eq 1 ] && [ "${FLAG_FORCE}" -eq 0 ]; then
    die "--non-interactive also requires --force (no prompts will be possible)"
  fi
}

# =============================================================================
# §5  Preflight checks (FAIL FAST)
# -----------------------------------------------------------------------------
# Invariants:
#   - No mutation of system state. Read-only inspection only.
#   - Every check emits exactly one labeled fact row with [OK]/[WARN]/[FAIL].
#   - Any FAIL exits the script with code 2 BEFORE any download or mutation.
#   - Network calls limited to: api.github.com, time.cloudflare.com,
#     raw.githubusercontent.com (mirror fallback only).
# =============================================================================

PREFLIGHT_FAIL_COUNT=0
PREFLIGHT_WARN_COUNT=0

_pf_ok()   { print_label "$1" "$2 [${C_GREEN}OK${C_RESET}]"; _log_disk OK preflight "$1: $2"; }
_pf_warn() { print_label "$1" "$2 [${C_YELLOW}WARN${C_RESET}]"; PREFLIGHT_WARN_COUNT=$((PREFLIGHT_WARN_COUNT + 1)); _log_disk WARN preflight "$1: $2"; }
_pf_fail() { print_label "$1" "$2 [${C_RED}FAIL${C_RESET}]"; PREFLIGHT_FAIL_COUNT=$((PREFLIGHT_FAIL_COUNT + 1)); _log_disk ERROR preflight "$1: $2"; }

check_bash_version() {
  local major=${BASH_VERSINFO[0]:-0}
  if [ "${major}" -ge "${MIN_BASH_MAJOR}" ]; then
    _pf_ok "bash" "${BASH_VERSION:-?}"
  else
    _pf_fail "bash" "${BASH_VERSION:-?} (need >= ${MIN_BASH_MAJOR})"
  fi
}

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    _pf_fail "Node.js" "not installed (need >= ${MIN_NODE_MAJOR})"
    return
  fi
  local nv major
  nv=$(node --version 2>/dev/null || printf 'v0')
  major=$(printf '%s' "${nv}" | sed 's/^v//' | cut -d. -f1)
  if [ "${major}" -ge "${MIN_NODE_MAJOR}" ]; then
    _pf_ok "Node.js" "${nv}"
  else
    _pf_fail "Node.js" "${nv} (need >= v${MIN_NODE_MAJOR})"
  fi
}

check_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    if command -v corepack >/dev/null 2>&1; then
      _pf_warn "pnpm" "missing (corepack present; will activate)"
    else
      _pf_fail "pnpm" "not installed (need >= ${MIN_PNPM_MAJOR})"
    fi
    return
  fi
  local pv major
  pv=$(pnpm --version 2>/dev/null || printf '0')
  major=$(printf '%s' "${pv}" | cut -d. -f1)
  if [ "${major}" -ge "${MIN_PNPM_MAJOR}" ]; then
    _pf_ok "pnpm" "${pv}"
  else
    _pf_fail "pnpm" "${pv} (need >= ${MIN_PNPM_MAJOR})"
  fi
}

check_openssl() {
  if ! command -v openssl >/dev/null 2>&1; then
    _pf_fail "openssl" "not installed (required for secrets)"
    return
  fi
  local ov
  ov=$(openssl version 2>/dev/null | cut -d' ' -f2)
  _pf_ok "openssl" "${ov:-installed}"
}

check_disk_space() {
  local target=${INSTALL_DIR:-${DEFAULT_INSTALL_DIR}}
  local parent
  parent=$(dirname "${target}")
  [ -d "${parent}" ] || parent="/"
  local avail_kib avail_gib
  # df -P is POSIX; busybox df supports it.
  avail_kib=$(df -P "${parent}" 2>/dev/null | awk 'NR==2 {print $4}')
  if [ -z "${avail_kib}" ]; then
    _pf_warn "disk free" "cannot determine"
    return
  fi
  local avail_bytes=$((avail_kib * 1024))
  avail_gib=$(awk -v b="${avail_bytes}" 'BEGIN { printf "%.1f GB", b/1024/1024/1024 }')
  if [ "${avail_bytes}" -ge "${MIN_DISK_BYTES}" ]; then
    _pf_ok "disk free" "${avail_gib}"
  else
    _pf_fail "disk free" "${avail_gib} (need >= 2 GB)"
  fi
}

check_port_free() {
  local port=${FLAG_PORT:-${DEFAULT_PORT}}
  # bash /dev/tcp redirect: opens a TCP connection. If it succeeds, port is busy.
  # We close immediately by redirecting from /dev/null.
  if (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    exec 3<&- 3>&- 2>/dev/null || true
    _pf_fail "port ${port}" "in use"
  else
    _pf_ok "port ${port}" "free"
  fi
}

check_dns() {
  local host="api.github.com"
  local ok=0
  if command -v getent >/dev/null 2>&1; then
    getent hosts "${host}" >/dev/null 2>&1 && ok=1
  elif command -v nslookup >/dev/null 2>&1; then
    nslookup "${host}" >/dev/null 2>&1 && ok=1
  else
    (exec 3<>"/dev/tcp/${host}/443") 2>/dev/null && ok=1
    exec 3<&- 3>&- 2>/dev/null || true
  fi
  if [ "${ok}" -eq 1 ]; then
    _pf_ok "DNS" "${host}"
  else
    _pf_fail "DNS" "could not resolve ${host}"
  fi
}

check_time_sync() {
  # Parse the Date: header from time.cloudflare.com.
  local remote local_ts skew tolerance=${TIME_SKEW_TOLERANCE_SECS}
  local hdr
  if command -v curl >/dev/null 2>&1; then
    hdr=$(curl --proto '=https' --tlsv1.2 -sI --max-time 5 'https://time.cloudflare.com' 2>/dev/null \
      | awk -F': ' 'tolower($1)=="date" {print $2}' | tr -d '\r')
  elif command -v wget >/dev/null 2>&1; then
    hdr=$(wget -S --spider --timeout=5 -q 'https://time.cloudflare.com' 2>&1 \
      | awk -F': ' 'tolower($1)~/date/ {print $2}' | tr -d '\r' | head -n1)
  fi
  if [ -z "${hdr}" ]; then
    _pf_warn "system time" "cannot reach time.cloudflare.com (will trust local clock)"
    return
  fi
  if ! remote=$(date -d "${hdr}" +%s 2>/dev/null); then
    _pf_warn "system time" "could not parse remote Date header"
    return
  fi
  local_ts=$(date +%s)
  skew=$((remote > local_ts ? remote - local_ts : local_ts - remote))
  if [ "${skew}" -le "${tolerance}" ]; then
    _pf_ok "system time" "within ${skew}s of UTC"
  else
    _pf_fail "system time" "drift ${skew}s exceeds ${tolerance}s (sync NTP first)"
  fi
}

check_os_release() {
  if [ -f /etc/os-release ] && grep -q '^NAME=' /etc/os-release; then
    local name
    name=$(awk -F= '$1=="PRETTY_NAME"{gsub(/"/, "", $2); print $2}' /etc/os-release)
    _pf_ok "OS" "${name:-Linux}"
  else
    _pf_warn "OS" "unrecognized; not /etc/os-release"
  fi
}

check_umask_sane() {
  local u
  u=$(umask)
  case "${u}" in
    0077|077|0007|007|0022|022|0027|027) _pf_ok "umask" "${u}" ;;
    *) _pf_warn "umask" "${u} (broad permissions)" ;;
  esac
}

check_urandom() {
  if [ -r /dev/urandom ]; then
    _pf_ok "/dev/urandom" "readable"
  else
    _pf_fail "/dev/urandom" "not readable"
  fi
}

check_sudo() {
  if [ "${RUNNING_AS_ROOT}" -eq 1 ]; then
    _pf_ok "privileges" "running as root"
    return
  fi
  if command -v sudo >/dev/null 2>&1; then
    if sudo -n true 2>/dev/null; then
      _pf_ok "sudo" "available (passwordless)"
    else
      _pf_warn "sudo" "available (will prompt for password)"
    fi
  else
    _pf_warn "sudo" "not installed (system-wide install will fail)"
  fi
}

check_for_with_nginx() {
  [ "${FLAG_WITH_NGINX}" -eq 1 ] || return 0
  if ! command -v nginx >/dev/null 2>&1; then
    _pf_fail "nginx" "not installed (required by --with-nginx)"
    return
  fi
  local v
  v=$(nginx -v 2>&1 | sed 's|^nginx version: nginx/||')
  _pf_ok "nginx" "${v}"
}

check_for_with_tls() {
  [ "${FLAG_WITH_TLS}" -eq 1 ] || return 0
  # Port 80 must be reachable for HTTP-01 challenge.
  if (exec 3<>"/dev/tcp/127.0.0.1/80") 2>/dev/null; then
    exec 3<&- 3>&- 2>/dev/null || true
    _pf_warn "port 80" "in use (certbot HTTP challenge may conflict)"
  else
    _pf_ok "port 80" "free"
  fi
  if command -v certbot >/dev/null 2>&1; then
    _pf_ok "certbot" "$(certbot --version 2>&1 | head -n1)"
  else
    _pf_warn "certbot" "not installed (will offer to install)"
  fi
  [ -n "${FLAG_TLS_EMAIL}" ] || _pf_fail "--tls-email" "required when --with-tls is set"
}

preflight() {
  print_header "Preflight checks"
  PREFLIGHT_FAIL_COUNT=0
  PREFLIGHT_WARN_COUNT=0

  check_bash_version
  check_node
  check_pnpm
  check_openssl
  check_disk_space
  check_port_free
  check_dns
  check_time_sync
  check_os_release
  check_umask_sane
  check_urandom
  check_sudo
  check_for_with_nginx
  check_for_with_tls

  if [ "${PREFLIGHT_FAIL_COUNT}" -gt 0 ]; then
    printf '\n'
    log_err "${PREFLIGHT_FAIL_COUNT} preflight check(s) failed; aborting before any download or mutation"
    exit 2
  fi
  if [ "${PREFLIGHT_WARN_COUNT}" -gt 0 ]; then
    log_warn "${PREFLIGHT_WARN_COUNT} preflight warning(s)"
  fi
}

# =============================================================================
# §6  Environment sniffer (smart defaults)
# -----------------------------------------------------------------------------
# Invariants:
#   - No mutation. Probes only.
#   - Detected services populate SNIFFED_* globals used by the wizard defaults.
# =============================================================================

sniff_environment() {
  print_header "Detected on this host"

  if (exec 3<>"/dev/tcp/127.0.0.1/27017") 2>/dev/null; then
    exec 3<&- 3>&- 2>/dev/null || true
    SNIFFED_MONGO="localhost:27017"
    print_label "MongoDB" "${SNIFFED_MONGO}"
  fi
  if (exec 3<>"/dev/tcp/127.0.0.1/5432") 2>/dev/null; then
    exec 3<&- 3>&- 2>/dev/null || true
    SNIFFED_POSTGRES="localhost:5432"
    print_label "PostgreSQL" "${SNIFFED_POSTGRES}"
  fi
  if command -v redis-cli >/dev/null 2>&1; then
    if redis-cli -h localhost -p 6379 ping >/dev/null 2>&1; then
      SNIFFED_REDIS="localhost:6379"
      print_label "Redis" "${SNIFFED_REDIS}"
    fi
  elif (exec 3<>"/dev/tcp/127.0.0.1/6379") 2>/dev/null; then
    exec 3<&- 3>&- 2>/dev/null || true
    SNIFFED_REDIS="localhost:6379"
    print_label "Redis" "${SNIFFED_REDIS}"
  fi
  # PID 1 detection — feeds the supervisor default.
  if [ -r /proc/1/comm ]; then
    SNIFFED_INIT=$(cat /proc/1/comm 2>/dev/null)
    print_label "init system" "${SNIFFED_INIT} (pid 1)"
  fi
}

# =============================================================================
# §7  Mirror-aware downloader
# -----------------------------------------------------------------------------
# Invariants:
#   - Every download uses TLS 1.2+. No --insecure / -k.
#   - PARAKO_RELEASE_MIRROR (if set) must match an allowlist or be explicitly
#     confirmed by the operator.
# References:
#   https://users.rust-lang.org/t/how-to-send-1-proceed-with-installation-default-in-a-single-command/89235
# =============================================================================

readonly CURL_FLAGS=(--proto '=https' --tlsv1.2 --silent --show-error --fail --location --retry 3 --retry-delay 2 --max-time 120)
readonly WGET_FLAGS=(--secure-protocol=TLSv1_2 --https-only --quiet --tries=3 --timeout=120)

detect_downloader() {
  if command -v curl >/dev/null 2>&1; then
    DOWNLOAD_CMD="curl"
  elif command -v wget >/dev/null 2>&1; then
    DOWNLOAD_CMD="wget"
  else
    die "neither curl nor wget found"
  fi
}

download_file() {
  local url=$1 out=$2
  case "${url}" in
    https://*) ;;
    *) die "refusing non-HTTPS URL: ${url}" ;;
  esac
  if [ "${DOWNLOAD_CMD}" = "curl" ]; then
    curl "${CURL_FLAGS[@]}" -o "${out}" "${url}"
  else
    wget "${WGET_FLAGS[@]}" -O "${out}" "${url}"
  fi
}

download_stdout() {
  local url=$1
  case "${url}" in
    https://*) ;;
    *) die "refusing non-HTTPS URL: ${url}" ;;
  esac
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
    case "${FLAG_VERSION}" in v*) TAG="${FLAG_VERSION}" ;; *) TAG="v${FLAG_VERSION}" ;; esac
    log_ok "target version: ${TAG}"
    return 0
  fi
  log_info "fetching latest release from GitHub"
  local response=""
  if response=$(download_stdout "${GITHUB_API}/releases/latest" 2>/dev/null); then
    :
  elif [ -n "${PARAKO_RELEASE_MIRROR:-}" ]; then
    log_warn "GitHub API unreachable; trying mirror ${PARAKO_RELEASE_MIRROR}"
    case "${PARAKO_RELEASE_MIRROR}" in
      https://*) ;;
      *) die "PARAKO_RELEASE_MIRROR must be HTTPS" ;;
    esac
    response=$(download_stdout "${PARAKO_RELEASE_MIRROR}" 2>/dev/null) \
      || die "Failed to fetch from mirror as well"
  else
    die "Failed to fetch latest release from GitHub API. Set PARAKO_RELEASE_MIRROR or use --version."
  fi
  if command -v jq >/dev/null 2>&1; then
    TAG=$(printf '%s' "${response}" | jq -r '.tag_name // .latest // empty')
  else
    TAG=$(printf '%s' "${response}" | grep -E '"(tag_name|latest)"' | head -n1 \
      | sed -E 's/.*"(tag_name|latest)":[[:space:]]*"([^"]+)".*/\2/')
  fi
  [ -z "${TAG}" ] && die "Could not parse release tag from response"
  case "${TAG}" in v*) ;; *) TAG="v${TAG}" ;; esac
  log_ok "target version: ${TAG}"
}

# Fetch tarball + signature + certificate + SHA256SUMS into TMPDIR_PATH.
# Sets globals: TARBALL_FILE, SIGNATURE_FILE, CERTIFICATE_FILE, CHECKSUM_FILE.
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

  local base_url tarball_name
  base_url="https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${TAG}"
  tarball_name="parako-id-${TAG}.tar.gz"
  TARBALL_FILE="${TMPDIR_PATH}/${tarball_name}"
  CHECKSUM_FILE="${TMPDIR_PATH}/SHA256SUMS"
  SIGNATURE_FILE="${TMPDIR_PATH}/${tarball_name}.sig"
  CERTIFICATE_FILE="${TMPDIR_PATH}/${tarball_name}.pem"

  log_info "downloading ${tarball_name}"
  download_file "${base_url}/${tarball_name}" "${TARBALL_FILE}"
  download_file "${base_url}/SHA256SUMS" "${CHECKSUM_FILE}"
  # Signature + certificate may not exist on pre-v0.2.0 releases.
  if ! download_file "${base_url}/${tarball_name}.sig" "${SIGNATURE_FILE}" 2>/dev/null; then
    SIGNATURE_FILE=""
  fi
  if ! download_file "${base_url}/${tarball_name}.pem" "${CERTIFICATE_FILE}" 2>/dev/null; then
    CERTIFICATE_FILE=""
  fi
}

verify_checksum() {
  [ -n "${CHECKSUM_FILE}" ] && [ -f "${CHECKSUM_FILE}" ] || {
    log_warn "no SHA256SUMS file; skipping checksum verification"
    return 0
  }
  local expected actual basename
  basename=$(basename "${TARBALL_FILE}")
  expected=$(grep -E "[[:space:]]${basename}\$" "${CHECKSUM_FILE}" | awk '{print $1}')
  [ -z "${expected}" ] && {
    log_warn "${basename} not listed in SHA256SUMS; skipping"
    return 0
  }
  actual=$(compute_sha256 "${TARBALL_FILE}") || {
    log_warn "sha256sum/shasum not available; skipping"
    return 0
  }
  if [ "${actual}" != "${expected}" ]; then
    die "checksum mismatch: expected ${expected}, got ${actual}"
  fi
  log_ok "SHA256 verified"
}

# =============================================================================
# §8  Cosign bootstrap + verifier
# -----------------------------------------------------------------------------
# Invariants:
#   - cosign verification is MANDATORY for tarball-mode installs/updates.
#   - Escape hatch (--insecure-no-signature) requires --reason and is logged.
#   - Cosign binary, if auto-installed, is verified against an inlined SHA256.
# Reference:
#   https://docs.sigstore.dev/cosign/verifying/verify/
#   https://docs.sigstore.dev/cosign/system_config/installation/
# =============================================================================

ensure_cosign() {
  command -v cosign >/dev/null 2>&1 && return 0

  local arch bin expected tmp
  arch=$(uname -m)
  case "${arch}" in
    x86_64|amd64) bin="cosign-linux-amd64"; expected=${COSIGN_SHA256_LINUX_AMD64} ;;
    aarch64|arm64) bin="cosign-linux-arm64"; expected=${COSIGN_SHA256_LINUX_ARM64} ;;
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
      IFS= read -r conf || conf=""
      [ "${conf}" = "yes" ] || die "signature bypass requires explicit yes"
    fi
    return 0
  fi
  if [ -z "${SIGNATURE_FILE}" ] || [ ! -f "${SIGNATURE_FILE}" ]; then
    die "no signature found; releases prior to v0.2.0 are unsigned. Pass --insecure-no-signature --reason \"<text>\" if you must proceed."
  fi
  if [ -z "${CERTIFICATE_FILE}" ] || [ ! -f "${CERTIFICATE_FILE}" ]; then
    die "no signing certificate found"
  fi
  ensure_cosign
  log_info "verifying cosign signature"
  if cosign verify-blob \
    --bundle "${SIGNATURE_FILE}" \
    --certificate "${CERTIFICATE_FILE}" \
    --certificate-identity-regexp "${COSIGN_CERT_IDENTITY_REGEX}" \
    --certificate-oidc-issuer "${COSIGN_OIDC_ISSUER}" \
    "${TARBALL_FILE}" >/dev/null 2>&1; then
    log_ok "cosign verification passed"
  else
    die "cosign verification failed"
  fi
}

# =============================================================================
# §9  Wizard
# -----------------------------------------------------------------------------
# Invariants:
#   - Defaults pulled from §6 sniff_environment when available.
#   - Edit loop allows the operator to revise any field before commit.
# =============================================================================

collect_answers() {
  print_header "Configuration"
  printf '  Press Enter to accept defaults.\n\n'

  # Apply flag overrides first.
  [ -n "${FLAG_PORT}" ] && ANS_PORT=${FLAG_PORT}
  [ -n "${FLAG_DOMAIN}" ] && ANS_URL="https://${FLAG_DOMAIN}"
  [ -n "${FLAG_DB}" ] && ANS_DB=${FLAG_DB}
  [ -n "${FLAG_POSTGRES_URL}" ] && ANS_PG_URL=${FLAG_POSTGRES_URL}
  [ -n "${FLAG_MONGO_URI}" ] && ANS_MONGO_URI=${FLAG_MONGO_URI}
  [ -n "${FLAG_SUPERVISOR}" ] && ANS_SUPERVISOR=${FLAG_SUPERVISOR}

  if [ -n "${FLAG_REDIS_URL}" ]; then
    ANS_REDIS="yes"
    # Parse redis://host:port
    local hp
    hp=${FLAG_REDIS_URL#redis://}
    hp=${hp%%/*}
    ANS_REDIS_HOST=${hp%:*}
    ANS_REDIS_PORT=${hp#*:}
    [ "${ANS_REDIS_PORT}" = "${hp}" ] && ANS_REDIS_PORT="6379"
  fi

  # Sniffed defaults.
  [ -n "${SNIFFED_MONGO}" ] && ANS_MONGO_URI="mongodb://${SNIFFED_MONGO}/parako-id"
  [ -n "${SNIFFED_REDIS}" ] && {
    ANS_REDIS="yes"
    ANS_REDIS_HOST=${SNIFFED_REDIS%:*}
    ANS_REDIS_PORT=${SNIFFED_REDIS#*:}
  }
  [ "${SNIFFED_INIT}" = "systemd" ] && ANS_SUPERVISOR="systemd"

  if [ "${FLAG_NON_INTERACTIVE}" -eq 1 ]; then
    # Non-interactive mode: trust flags + defaults.
    [ -z "${ANS_DB}" ] && ANS_DB="sqlite"
    return 0
  fi

  ANS_ENV=$(prompt_choice "Environment" "development/production" "${ANS_ENV}")
  printf '\n'
  while true; do
    ANS_PORT=$(prompt_value "Server port" "${ANS_PORT}")
    printf '\n'
    is_valid_port "${ANS_PORT}" && break
    log_warn "Invalid port number"
  done

  if [ "${ANS_ENV}" = "production" ]; then
    while true; do
      ANS_URL=$(prompt_value "Deployment URL (e.g. https://auth.example.com)" "${ANS_URL}")
      printf '\n'
      is_valid_url "${ANS_URL}" && break
      log_warn "Deployment URL is required for production and must be https://..."
    done
  else
    ANS_URL=$(prompt_value "Deployment URL (optional)" "${ANS_URL}")
    printf '\n'
  fi

  ANS_SUPERVISOR=$(prompt_choice "Process supervisor" "systemd/pm2" "${ANS_SUPERVISOR}")
  printf '\n'

  ANS_DB=$(prompt_choice "Database" "sqlite/mongodb/postgresql" "${ANS_DB}")
  printf '\n'
  case "${ANS_DB}" in
    mongodb)
      ANS_MONGO_URI=$(prompt_value "MongoDB URI" "${ANS_MONGO_URI}")
      printf '\n' ;;
    postgresql)
      ANS_PG_URL=$(prompt_value "PostgreSQL URL" "${ANS_PG_URL}")
      printf '\n' ;;
  esac

  local redis_def="${ANS_REDIS}"
  [ "${ANS_ENV}" = "production" ] && [ -z "${SNIFFED_REDIS}" ] && redis_def="yes"
  if prompt_yn "Enable Redis" "${redis_def}"; then
    ANS_REDIS="yes"
    printf '\n'
    ANS_REDIS_HOST=$(prompt_value "Redis host" "${ANS_REDIS_HOST}")
    printf '\n'
    while true; do
      ANS_REDIS_PORT=$(prompt_value "Redis port" "${ANS_REDIS_PORT}")
      printf '\n'
      is_valid_port "${ANS_REDIS_PORT}" && break
      log_warn "Invalid port"
    done
  else
    ANS_REDIS="no"
    printf '\n'
  fi
}

print_summary() {
  print_header "Configuration summary"
  print_label "Environment" "${ANS_ENV}"
  print_label "Port" "${ANS_PORT}"
  [ -n "${ANS_URL}" ] && print_label "Deployment URL" "${ANS_URL}"
  print_label "Supervisor" "${ANS_SUPERVISOR}"
  print_label "Database" "${ANS_DB}"
  case "${ANS_DB}" in
    mongodb) print_label "MongoDB URI" "$(printf '%s' "${ANS_MONGO_URI}" | redact)" ;;
    postgresql) print_label "PostgreSQL URL" "$(printf '%s' "${ANS_PG_URL}" | redact)" ;;
  esac
  print_label "Redis" "${ANS_REDIS}"
  if [ "${ANS_REDIS}" = "yes" ]; then
    print_label "Redis host" "${ANS_REDIS_HOST}"
    print_label "Redis port" "${ANS_REDIS_PORT}"
  fi
}

edit_field() {
  case "$1" in
    1) ANS_ENV=$(prompt_choice "Environment" "development/production" "${ANS_ENV}"); printf '\n' ;;
    2) while true; do
         ANS_PORT=$(prompt_value "Server port" "${ANS_PORT}")
         printf '\n'
         is_valid_port "${ANS_PORT}" && break
       done ;;
    3) ANS_URL=$(prompt_value "Deployment URL" "${ANS_URL}"); printf '\n' ;;
    4) ANS_SUPERVISOR=$(prompt_choice "Supervisor" "systemd/pm2" "${ANS_SUPERVISOR}"); printf '\n' ;;
    5) ANS_DB=$(prompt_choice "Database" "sqlite/mongodb/postgresql" "${ANS_DB}"); printf '\n'
       case "${ANS_DB}" in
         mongodb) ANS_MONGO_URI=$(prompt_value "MongoDB URI" "${ANS_MONGO_URI}"); printf '\n' ;;
         postgresql) ANS_PG_URL=$(prompt_value "PostgreSQL URL" "${ANS_PG_URL}"); printf '\n' ;;
       esac ;;
    6) if prompt_yn "Enable Redis" "${ANS_REDIS}"; then
         ANS_REDIS="yes"; printf '\n'
         ANS_REDIS_HOST=$(prompt_value "Redis host" "${ANS_REDIS_HOST}"); printf '\n'
         while true; do
           ANS_REDIS_PORT=$(prompt_value "Redis port" "${ANS_REDIS_PORT}")
           printf '\n'
           is_valid_port "${ANS_REDIS_PORT}" && break
         done
       else ANS_REDIS="no"; printf '\n'; fi ;;
    *) log_warn "invalid field number: $1" ;;
  esac
}

confirm_or_edit() {
  while true; do
    print_summary
    printf '\n  Is this correct? [%sY%s/n/e]  Y=proceed, n=abort, e=edit: ' "${C_BOLD}" "${C_RESET}"
    local answer=""
    IFS= read -r answer || answer=""
    case "${answer}" in
      ""|y|Y|yes|Yes|YES) return 0 ;;
      n|N|no|No|NO) log_info "aborted by operator"; exit 0 ;;
      e|E|edit|Edit|EDIT)
        printf '\n  Which value to edit?\n'
        printf '  1) Environment  2) Port  3) URL  4) Supervisor  5) Database  6) Redis\n'
        printf '  Enter field number (1-6): '
        local fnum=""
        IFS= read -r fnum || fnum=""
        edit_field "${fnum}" ;;
      *) printf '  Please enter Y, n, or e.\n' >&2 ;;
    esac
  done
}

# =============================================================================
# §10 Connection validators
# -----------------------------------------------------------------------------
# Invariants:
#   - Validation requires the release tarball to be extracted (we use its
#     bundled node_modules to drive the DB clients).
# =============================================================================

validate_mongodb() {
  log_info "testing MongoDB connection"
  if (cd "${RESOLVED_INSTALL_DIR}" && PARAKO_TEST_URI=$1 node -e "
    const{MongoClient}=require('mongodb');
    MongoClient.connect(process.env.PARAKO_TEST_URI,{serverSelectionTimeoutMS:5000})
      .then(c=>{c.close();process.exit(0)}).catch(()=>process.exit(1));
  " 2>/dev/null); then
    log_ok "MongoDB connection OK"
    return 0
  fi
  log_warn "could not connect to MongoDB"
  return 1
}

validate_postgresql() {
  log_info "testing PostgreSQL connection"
  if (cd "${RESOLVED_INSTALL_DIR}" && PARAKO_TEST_URI=$1 node -e "
    const{Client}=require('pg');
    const c=new Client({connectionString:process.env.PARAKO_TEST_URI,connectionTimeoutMillis:5000});
    c.connect().then(()=>{c.end();process.exit(0)}).catch(()=>process.exit(1));
  " 2>/dev/null); then
    log_ok "PostgreSQL connection OK"
    return 0
  fi
  log_warn "could not connect to PostgreSQL"
  return 1
}

validate_redis() {
  log_info "testing Redis connection"
  if (cd "${RESOLVED_INSTALL_DIR}" && PARAKO_TEST_HOST=$1 PARAKO_TEST_PORT=$2 node -e "
    const R=require('ioredis');
    const r=new R({host:process.env.PARAKO_TEST_HOST,port:Number(process.env.PARAKO_TEST_PORT),lazyConnect:true,connectTimeout:5000,maxRetriesPerRequest:1});
    r.connect().then(()=>r.ping()).then(()=>{r.disconnect();process.exit(0)}).catch(()=>process.exit(1));
  " 2>/dev/null); then
    log_ok "Redis connection OK"
    return 0
  fi
  log_warn "could not connect to Redis"
  return 1
}

validate_connections() {
  local retry=""
  if [ "${ANS_DB}" = "mongodb" ]; then
    while true; do
      validate_mongodb "${ANS_MONGO_URI}" && break
      [ "${FLAG_NON_INTERACTIVE}" -eq 1 ] && { log_warn "proceeding with unvalidated URI"; break; }
      printf '  Enter new URI or Enter to skip: '
      IFS= read -r retry || retry=""
      [ -z "${retry}" ] && { log_warn "proceeding with unvalidated URI"; break; }
      ANS_MONGO_URI=${retry}
    done
  fi
  if [ "${ANS_DB}" = "postgresql" ]; then
    while true; do
      validate_postgresql "${ANS_PG_URL}" && break
      [ "${FLAG_NON_INTERACTIVE}" -eq 1 ] && { log_warn "proceeding with unvalidated URL"; break; }
      printf '  Enter new URL or Enter to skip: '
      IFS= read -r retry || retry=""
      [ -z "${retry}" ] && { log_warn "proceeding with unvalidated URL"; break; }
      ANS_PG_URL=${retry}
    done
  fi
  if [ "${ANS_REDIS}" = "yes" ]; then
    while true; do
      validate_redis "${ANS_REDIS_HOST}" "${ANS_REDIS_PORT}" && break
      [ "${FLAG_NON_INTERACTIVE}" -eq 1 ] && { log_warn "proceeding with unvalidated Redis"; break; }
      printf '  Enter new host:port or Enter to skip: '
      IFS= read -r retry || retry=""
      [ -z "${retry}" ] && { log_warn "proceeding with unvalidated Redis"; break; }
      ANS_REDIS_HOST=${retry%:*}
      local np
      np=${retry#*:}
      [ "${np}" != "${retry}" ] && [ -n "${np}" ] && ANS_REDIS_PORT=${np}
    done
  fi
}

# =============================================================================
# §11 Secret + .env generator
# -----------------------------------------------------------------------------
# Invariants:
#   - .env is written atomically (write to .tmp, then mv).
#   - Mode 0600 enforced regardless of umask.
#   - Secrets sourced from openssl rand or /dev/urandom; never logged.
# =============================================================================

apply_guards() {
  if [ "${ANS_ENV}" = "production" ] && [ "${ANS_DB}" = "sqlite" ]; then
    log_warn "SQLite is not recommended for production; consider PostgreSQL or MongoDB"
  fi
  if [ "${ANS_ENV}" = "production" ] && [ -z "${ANS_URL}" ]; then
    die "deployment URL is required for production environments"
  fi
}

_gen_hex32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
  fi
}

generate_env_file() {
  local env_file="${RESOLVED_INSTALL_DIR}/runtime/.env"
  local env_tmp="${env_file}.tmp.$$"
  mkdir -p "$(dirname "${env_file}")"
  log_info "generating runtime/.env"

  local ek jw c1 c2 hm ps
  ek=$(_gen_hex32)
  jw=$(_gen_hex32)
  c1=$(_gen_hex32)
  c2=$(_gen_hex32)
  hm=$(_gen_hex32)
  ps=$(_gen_hex32)

  local pp uf mt
  if [ "${ANS_ENV}" = "development" ]; then pp="true"; uf="true"; else pp="false"; uf="false"; fi
  if [ "${FLAG_MULTI_TENANT}" -eq 1 ]; then mt="true"; else mt="false"; fi

  {
    printf '# Parako.ID — generated by installer v%s on %s\n' "${INSTALLER_VERSION}" "${RUN_TIMESTAMP}"
    printf 'DEPLOYMENT_ENVIRONMENT=%s\n' "${ANS_ENV}"
    printf 'DEPLOYMENT_SERVER_PORT=%s\n' "${ANS_PORT}"
    [ -n "${ANS_URL}" ] && printf 'DEPLOYMENT_URL=%s\n' "${ANS_URL}"
    printf '\nSTORAGE_ADAPTER=%s\n' "${ANS_DB}"
    case "${ANS_DB}" in
      mongodb) printf 'STORAGE_MONGODB_URI=%s\n' "${ANS_MONGO_URI}" ;;
      sqlite)  printf 'STORAGE_SQLITE_PATH=./runtime/data/parako.db\n' ;;
      postgresql) printf 'STORAGE_POSTGRESQL_URL=%s\nDATABASE_URL=%s\n' "${ANS_PG_URL}" "${ANS_PG_URL}" ;;
    esac
    if [ "${ANS_REDIS}" = "yes" ]; then
      printf '\nREDIS_HOST=%s\nREDIS_PORT=%s\nOIDC_STORAGE_ADAPTER=redis\n' \
        "${ANS_REDIS_HOST}" "${ANS_REDIS_PORT}"
    fi
    printf '\n'
    printf 'ENCRYPTION_KEY=%s\n' "${ek}"
    printf 'JWT_SECRET=%s\n' "${jw}"
    printf 'COOKIE_SECRET_1=%s\n' "${c1}"
    printf 'COOKIE_SECRET_2=%s\n' "${c2}"
    printf 'HMAC_SECRET=%s\n' "${hm}"
    printf 'PAIRWISE_SALT=%s\n' "${ps}"
    printf '\n'
    printf 'SECURITY_LOGGING_ENABLED=true\n'
    printf 'SECURITY_LOGGING_LEVEL=info\n'
    printf 'SECURITY_LOGGING_PRETTY_PRINT=%s\n' "${pp}"
    printf 'SECURITY_LOGGING_FILE_LOGGING_ENABLED=true\n'
    printf 'SECURITY_LOGGING_FILE_LOGGING_DIRECTORY=runtime/logs\n'
    printf 'MULTI_TENANCY_ENABLED=%s\n' "${mt}"
    printf 'USE_FILE_CONFIG=%s\n' "${uf}"
    if [ "${FLAG_WITH_TLS}" -eq 1 ]; then
      printf 'COOKIES_SECURE=true\n'
    fi
    if [ -n "${FLAG_BOOTSTRAP_ADMIN_EMAIL}" ]; then
      printf '\n# Bootstrap admin (seeded on first start; REMOVE these two lines after first successful login)\n'
      printf 'PARAKO_BOOTSTRAP_ADMIN_EMAIL=%s\n' "${FLAG_BOOTSTRAP_ADMIN_EMAIL}"
      printf 'PARAKO_BOOTSTRAP_ADMIN_PASSWORD=%s\n' "${BOOTSTRAP_ADMIN_PASSWORD}"
    fi
  } > "${env_tmp}"

  chmod 0600 "${env_tmp}"
  mv "${env_tmp}" "${env_file}"
  log_ok "runtime/.env written (mode 0600)"
}

# Generate the bootstrap admin password before .env is written so it can both
# be embedded and printed in the recovery card. Must run before generate_env_file.
maybe_generate_bootstrap_password() {
  [ -z "${FLAG_BOOTSTRAP_ADMIN_EMAIL}" ] && return 0
  # 16 hex chars (~64 bits of entropy) is plenty for a single-use bootstrap
  # password that the operator rotates immediately.
  BOOTSTRAP_ADMIN_PASSWORD=$(_gen_hex32 | cut -c1-16)
}

# =============================================================================
# §12 INSTALL_NOTES.md generator
# -----------------------------------------------------------------------------
# Invariants:
#   - Mode 0600.
#   - Secrets redacted by redact() and by structural omission (no .env values).
#   - Records every wizard answer, all selected flags, version, snapshot path.
# =============================================================================

generate_install_notes() {
  local notes="${RESOLVED_INSTALL_DIR}/runtime/INSTALL_NOTES.md"
  local notes_tmp="${notes}.tmp.$$"
  mkdir -p "$(dirname "${notes}")"

  local operator
  operator=$(id -un 2>/dev/null || printf 'unknown')

  {
    printf '# Parako.ID Install Notes\n\n'
    printf 'Generated by installer v%s.\n' "${INSTALLER_VERSION}"
    printf 'Sensitive values redacted as `***`.\n\n'
    printf '## Run\n\n'
    printf '- Version: %s\n' "${TAG:-${INSTALLER_VERSION}}"
    printf '- Date: %s\n' "${RUN_TIMESTAMP}"
    printf '- Operator: %s (uid=%s)\n' "${operator}" "$(id -u 2>/dev/null || printf '?')"
    printf '- Install dir: %s\n' "${RESOLVED_INSTALL_DIR}"
    printf '- Run mode: %s\n' "$( [ "${FLAG_UPDATE}" -eq 1 ] && printf 'update' || printf 'install' )"
    printf '\n'
    printf '## Configuration\n\n'
    printf '- Environment: %s\n' "${ANS_ENV}"
    printf '- Server port: %s\n' "${ANS_PORT}"
    [ -n "${ANS_URL}" ] && printf '- Deployment URL: %s\n' "${ANS_URL}"
    printf '- Supervisor: %s\n' "${ANS_SUPERVISOR}"
    printf '- Database: %s\n' "${ANS_DB}"
    case "${ANS_DB}" in
      mongodb) printf '- MongoDB URI: %s\n' "$(printf '%s' "${ANS_MONGO_URI}" | redact)" ;;
      postgresql) printf '- PostgreSQL URL: %s\n' "$(printf '%s' "${ANS_PG_URL}" | redact)" ;;
    esac
    printf '- Redis: %s\n' "${ANS_REDIS}"
    if [ "${ANS_REDIS}" = "yes" ]; then
      printf '- Redis host:port: %s:%s\n' "${ANS_REDIS_HOST}" "${ANS_REDIS_PORT}"
    fi
    printf '\n'
    printf '## Flags\n\n'
    printf '- Non-interactive: %s\n' "${FLAG_NON_INTERACTIVE}"
    printf '- With nginx: %s\n' "${FLAG_WITH_NGINX}"
    printf '- With TLS: %s\n' "${FLAG_WITH_TLS}"
    printf '- Multi-tenant: %s\n' "${FLAG_MULTI_TENANT}"
    [ -n "${FLAG_BOOTSTRAP_ADMIN_EMAIL}" ] && printf '- Bootstrap admin email: %s\n' "${FLAG_BOOTSTRAP_ADMIN_EMAIL}"
    if [ "${FLAG_INSECURE_NO_SIGNATURE}" -eq 1 ]; then
      printf '\n## SECURITY EXCEPTION\n\n'
      printf 'Signature verification was bypassed via `--insecure-no-signature`.\n'
      printf 'Reason: %s\n' "${FLAG_INSECURE_REASON}"
    fi
    printf '\n## Trust\n\n'
    printf '- Cosign identity regex: `%s`\n' "${COSIGN_CERT_IDENTITY_REGEX}"
    printf '- Cosign OIDC issuer: `%s`\n' "${COSIGN_OIDC_ISSUER}"
    printf '\n## Files outside %s\n\n' "${RESOLVED_INSTALL_DIR}"
    printf '- `/etc/systemd/system/parako-id.service`\n'
    printf '- `/etc/systemd/system/parako-id-worker.service`\n'
    [ "${FLAG_WITH_NGINX}" -eq 1 ] && printf '- `/etc/nginx/sites-available/parako-id`\n'
    printf '- `%s/parako`\n' "${DEFAULT_BIN_DIR}"
    printf '- `%s`\n' "${LOG_FILE}"
    printf '\n## See also\n\n'
    printf '- `parako --help`\n'
    printf '- https://docs.parako.id/installer\n'
    printf '- https://docs.parako.id/installer-security\n'
  } > "${notes_tmp}"

  chmod 0600 "${notes_tmp}"
  mv "${notes_tmp}" "${notes}"
  log_ok "INSTALL_NOTES.md written"
}

# =============================================================================
# §13 Supervisor setup (systemd / PM2)
# -----------------------------------------------------------------------------
# Invariants:
#   - Supervisor decision persisted in $INSTALL_DIR/.supervisor for --update.
#   - systemd path delegates to compiled `dist/scripts/manage/systemd.js install`.
# =============================================================================

write_supervisor_marker() {
  local marker="${RESOLVED_INSTALL_DIR}/.supervisor"
  printf '%s\n' "${ANS_SUPERVISOR}" > "${marker}"
  chmod 0644 "${marker}"
}

read_supervisor() {
  local marker="${RESOLVED_INSTALL_DIR}/.supervisor"
  if [ -f "${marker}" ]; then
    head -n1 "${marker}" | tr -d '[:space:]'
  else
    printf 'pm2'
  fi
}

setup_systemd() {
  local node_path
  node_path=$(command -v node 2>/dev/null || printf '/usr/bin/node')
  log_info "installing systemd unit files"
  local prefix=""
  [ "${RUNNING_AS_ROOT}" -eq 0 ] && prefix="sudo"
  (cd "${RESOLVED_INSTALL_DIR}" && \
    ${prefix} node dist/scripts/manage/systemd.js install \
      --user "$(id -un)" \
      --dir "${RESOLVED_INSTALL_DIR}" \
      --env-file "${RESOLVED_INSTALL_DIR}/runtime/.env" \
      --node-path "${node_path}" \
      --force) \
    || die "failed to install systemd services"
  ${prefix} systemctl enable --now parako-id parako-id-worker \
    || die "failed to enable/start systemd services"
  log_ok "systemd services installed and started"
}

start_application() {
  case "${ANS_SUPERVISOR}" in
    systemd)
      if [ "${ANS_ENV}" = "production" ]; then
        setup_systemd
      else
        log_info "development mode: starting foreground via pnpm dev (Ctrl-C to stop)"
        (cd "${RESOLVED_INSTALL_DIR}" && pnpm dev)
      fi
      ;;
    pm2)
      if [ "${ANS_ENV}" = "production" ]; then
        log_info "starting Parako.ID via PM2"
        (cd "${RESOLVED_INSTALL_DIR}" && pnpm start) \
          || die "PM2 start failed"
      else
        log_info "development mode: pnpm dev"
        (cd "${RESOLVED_INSTALL_DIR}" && pnpm dev)
      fi
      ;;
    *) die "unknown supervisor: ${ANS_SUPERVISOR}" ;;
  esac
}

# =============================================================================
# §14 DB migration + pre-update backup
# -----------------------------------------------------------------------------
# Invariants:
#   - Migrations idempotent (Prisma).
#   - DB backup runs BEFORE extract during --update; failure aborts update.
#   - Backups retained: 3 most recent in runtime/backups/.
# =============================================================================

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then return 0; fi
  if command -v corepack >/dev/null 2>&1; then
    log_info "activating pnpm via corepack"
    corepack enable >/dev/null 2>&1 || true
    corepack prepare "pnpm@${MIN_PNPM_MAJOR}" --activate >/dev/null 2>&1 || true
  fi
  command -v pnpm >/dev/null 2>&1 || die "pnpm not available; install Node >= ${MIN_NODE_MAJOR} with corepack and try again"
}

install_dependencies() {
  # Release tarballs ship with node_modules pre-bundled. If present, skip.
  if [ -d "${RESOLVED_INSTALL_DIR}/node_modules" ] \
     && [ -f "${RESOLVED_INSTALL_DIR}/node_modules/.modules.yaml" ]; then
    log_ok "dependencies bundled in release"
    return 0
  fi
  ensure_pnpm
  log_info "installing production dependencies (pnpm install --prod)"
  (cd "${RESOLVED_INSTALL_DIR}" && pnpm install --prod --frozen-lockfile 2>&1 | _log_disk DEBUG pnpm "$(cat)") \
    || die "pnpm install failed"
  log_ok "dependencies installed"
}

run_db_migrations() {
  case "${ANS_DB}" in
    postgresql)
      log_info "applying PostgreSQL migrations"
      (cd "${RESOLVED_INSTALL_DIR}" && pnpm db:migrate:deploy 2>&1 | _log_disk DEBUG prisma "$(cat)") \
        || die "PostgreSQL migrations failed"
      log_ok "migrations applied" ;;
    sqlite)
      log_info "syncing SQLite schema"
      (cd "${RESOLVED_INSTALL_DIR}" && pnpm db:push 2>&1 | _log_disk DEBUG prisma "$(cat)") \
        || die "SQLite schema sync failed"
      log_ok "schema synced" ;;
    mongodb)
      log_ok "MongoDB requires no migration (indexes built on connect)" ;;
    *) log_warn "unknown DB type: ${ANS_DB}; skipping migrations" ;;
  esac
}

backup_db_before_update() {
  local backup_dir="${RESOLVED_INSTALL_DIR}/runtime/backups"
  mkdir -p "${backup_dir}"
  chmod 0700 "${backup_dir}"
  local prev_ver=${1:-unknown}
  local stamp="pre-${prev_ver}-${RUN_TIMESTAMP}"
  case "${ANS_DB}" in
    postgresql)
      log_info "backing up PostgreSQL via pg_dump"
      if command -v pg_dump >/dev/null 2>&1; then
        (cd "${RESOLVED_INSTALL_DIR}" && \
          pg_dump --no-owner --format=custom "${ANS_PG_URL}" 2>/dev/null \
          | gzip > "${backup_dir}/${stamp}.dump.gz") \
          || die "pg_dump failed; aborting update"
        log_ok "PostgreSQL backup at ${backup_dir}/${stamp}.dump.gz"
      else
        die "pg_dump not installed; required for safe PostgreSQL update"
      fi
      ;;
    mongodb)
      log_info "backing up MongoDB via mongodump"
      if command -v mongodump >/dev/null 2>&1; then
        mongodump --uri="${ANS_MONGO_URI}" --archive="${backup_dir}/${stamp}.archive.gz" --gzip >/dev/null 2>&1 \
          || die "mongodump failed; aborting update"
        log_ok "MongoDB backup at ${backup_dir}/${stamp}.archive.gz"
      else
        log_warn "mongodump not installed; skipping logical DB backup (filesystem snapshot still taken)"
      fi
      ;;
    sqlite)
      log_info "backing up SQLite via .backup"
      local sqlite_path="${RESOLVED_INSTALL_DIR}/runtime/data/parako.db"
      if [ -f "${sqlite_path}" ] && command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 "${sqlite_path}" ".backup ${backup_dir}/${stamp}.db" \
          || die "sqlite3 .backup failed; aborting update"
        gzip -f "${backup_dir}/${stamp}.db"
        log_ok "SQLite backup at ${backup_dir}/${stamp}.db.gz"
      else
        log_warn "SQLite file or sqlite3 CLI missing; skipping DB backup"
      fi
      ;;
  esac
  # Retain 3 most recent of each kind.
  ls -1t "${backup_dir}"/pre-*.dump.gz 2>/dev/null | tail -n +4 | xargs -r rm -f
  ls -1t "${backup_dir}"/pre-*.archive.gz 2>/dev/null | tail -n +4 | xargs -r rm -f
  ls -1t "${backup_dir}"/pre-*.db.gz 2>/dev/null | tail -n +4 | xargs -r rm -f
}

# =============================================================================
# §15 Health check (lightweight /health endpoint)
# -----------------------------------------------------------------------------
# Invariants:
#   - Polls /health (added in src/app.ts:159-218). Falls back to
#     /.well-known/openid-configuration for installs older than v0.2.0.
#   - 15s window, 0.5s interval.
# =============================================================================

_probe_url() {
  local url=$1
  if [ "${DOWNLOAD_CMD}" = "curl" ]; then
    curl --proto '=https,=http' --tlsv1.2 -sSf --max-time 2 "${url}" >/dev/null 2>&1
  else
    wget -q --timeout=2 -O - "${url}" >/dev/null 2>&1
  fi
}

health_check() {
  local port=$1
  local primary="http://127.0.0.1:${port}${HEALTH_PATH}"
  local fallback="http://127.0.0.1:${port}${HEALTH_FALLBACK_PATH}"
  log_info "health probe ${primary}"
  local deadline now
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECS ))
  while true; do
    if _probe_url "${primary}"; then
      log_ok "health check passed"
      return 0
    fi
    if _probe_url "${fallback}"; then
      log_ok "health check passed (legacy endpoint)"
      return 0
    fi
    now=$(date +%s)
    [ "${now}" -ge "${deadline}" ] && break
    sleep 0.5
  done
  log_warn "health check timed out after ${HEALTH_TIMEOUT_SECS}s"
  return 1
}

read_port_from_env() {
  local env=$1/runtime/.env
  [ ! -f "${env}" ] && env=$1/.env
  [ ! -f "${env}" ] && { printf '%s' "${DEFAULT_PORT}"; return; }
  local p
  p=$(grep -E '^DEPLOYMENT_SERVER_PORT=' "${env}" | cut -d= -f2 | tr -d '"' | tr -d "'" | tr -d ' ')
  [ -z "${p}" ] && p=${DEFAULT_PORT}
  printf '%s' "${p}"
}

read_installed_version() {
  local pkg=$1/package.json
  [ ! -f "${pkg}" ] && { printf 'unknown'; return; }
  if command -v jq >/dev/null 2>&1; then
    jq -r '.version // "unknown"' "${pkg}"
  else
    grep '"version"' "${pkg}" | head -n1 | sed -E 's/.*"version":[[:space:]]*"([^"]+)".*/\1/'
  fi
}

read_installed_db() {
  local env=$1/runtime/.env
  [ ! -f "${env}" ] && env=$1/.env
  [ ! -f "${env}" ] && { printf 'sqlite'; return; }
  local db
  db=$(grep -E '^STORAGE_ADAPTER=' "${env}" | cut -d= -f2 | tr -d '"' | tr -d "'" | tr -d ' ')
  [ -z "${db}" ] && db="sqlite"
  printf '%s' "${db}"
}

read_pg_url_from_env() {
  local env=$1/runtime/.env
  [ ! -f "${env}" ] && env=$1/.env
  [ ! -f "${env}" ] && return 0
  grep -E '^STORAGE_POSTGRESQL_URL=' "${env}" | cut -d= -f2- | tr -d '"' | tr -d "'"
}

read_mongo_uri_from_env() {
  local env=$1/runtime/.env
  [ ! -f "${env}" ] && env=$1/.env
  [ ! -f "${env}" ] && return 0
  grep -E '^STORAGE_MONGODB_URI=' "${env}" | cut -d= -f2- | tr -d '"' | tr -d "'"
}

# =============================================================================
# §16 Beginning ritual
# -----------------------------------------------------------------------------
# Invariants:
#   - Runs AFTER preflight + sniff + wizard, BEFORE any mutation.
#   - Six labeled panels in plain text. No box-drawing.
#   - Interactive: 60s timeout. --non-interactive --force: 5s grace + Ctrl+C.
# =============================================================================

print_plan_panel() {
  print_header "Plan"
  local op="fresh install"
  [ "${FLAG_UPDATE}" -eq 1 ] && op="in-place update"
  [ "${FLAG_ROLLBACK}" -eq 1 ] && op="rollback"
  [ "${FLAG_DEMO}" -eq 1 ] && op="demo (ephemeral)"
  print_label "Operation" "${op}"
  print_label "Version" "${TAG:-?}"
  print_label "Install directory" "${RESOLVED_INSTALL_DIR:-${INSTALL_DIR}}"
  print_label "Database" "${ANS_DB}"
  print_label "Supervisor" "${ANS_SUPERVISOR}"
  [ -n "${ANS_URL}" ] && print_label "URL" "${ANS_URL}"
  if [ "${FLAG_WITH_NGINX}" -eq 1 ]; then
    if [ "${FLAG_WITH_TLS}" -eq 1 ]; then
      print_label "nginx + TLS" "yes (certbot)"
    else
      print_label "nginx" "yes"
    fi
  fi
  [ "${FLAG_MULTI_TENANT}" -eq 1 ] && print_label "Multi-tenant" "yes (base: ${FLAG_BASE_DOMAIN})"
  printf '\n  Files that will be written outside %s:\n' "${RESOLVED_INSTALL_DIR:-${INSTALL_DIR}}"
  if [ "${ANS_SUPERVISOR}" = "systemd" ] && [ "${ANS_ENV}" = "production" ]; then
    printf '    /etc/systemd/system/parako-id.service\n'
    printf '    /etc/systemd/system/parako-id-worker.service\n'
  fi
  [ "${FLAG_WITH_NGINX}" -eq 1 ] && printf '    /etc/nginx/sites-available/parako-id\n'
  printf '    %s/parako\n' "${DEFAULT_BIN_DIR}"
  printf '    %s\n' "${LOG_FILE}"
}

print_install_notes_panel() {
  print_header "Install notes"
  printf '  Operator answers will be written to:\n'
  printf '    %s/runtime/INSTALL_NOTES.md (mode 0600; secrets redacted)\n' \
    "${RESOLVED_INSTALL_DIR:-${INSTALL_DIR}}"
}

print_log_panel() {
  print_header "Install log"
  printf '  %s\n' "${LOG_FILE}"
}

print_assurances_panel() {
  printf '\n'
  printf 'Before anything changes on your system:\n'
  printf '  - Every preflight check above passed.\n'
  if [ "${FLAG_INSECURE_NO_SIGNATURE}" -eq 0 ] && [ "${FLAG_DEMO}" -eq 0 ]; then
    printf '  - The release tarball will be verified via cosign (Sigstore).\n'
  fi
  if [ "${FLAG_UPDATE}" -eq 1 ]; then
    printf '  - A complete snapshot is taken before any mutation.\n'
    printf '  - A database backup is taken before migration.\n'
    printf '  - Automatic rollback restores the prior state on failure.\n'
  fi
  printf '  - You can roll back later with `parako rollback`.\n'
}

beginning_ritual() {
  print_plan_panel
  print_install_notes_panel
  print_log_panel
  print_assurances_panel
  printf '\n'

  if [ "${FLAG_NON_INTERACTIVE}" -eq 1 ] && [ "${FLAG_FORCE}" -eq 1 ]; then
    log_info "non-interactive mode; proceeding in 5 seconds (Ctrl+C to abort)"
    sleep 5
    return 0
  fi
  if [ "${FLAG_FORCE}" -eq 1 ]; then
    return 0
  fi
  if ! prompt_yn_timeout "Proceed?" "no" 60; then
    log_info "aborted by operator"
    exit 0
  fi
}

# =============================================================================
# §17 Recovery summary card
# -----------------------------------------------------------------------------
# Invariants:
#   - Plain text. No boxes.
#   - Names URL, admin path, supervisor, log/notes paths, common parako verbs.
# =============================================================================

print_recovery_card() {
  local url="http://localhost:${ANS_PORT}"
  [ -n "${ANS_URL}" ] && url=${ANS_URL}
  print_header "Parako.ID installed"
  print_label "URL" "${url}"
  print_label "Admin panel" "${url}/admin"
  print_label "Install dir" "${RESOLVED_INSTALL_DIR}"
  print_label "Supervisor" "${ANS_SUPERVISOR}"
  print_label "Install notes" "${RESOLVED_INSTALL_DIR}/runtime/INSTALL_NOTES.md"
  print_label "Install log" "${LOG_FILE}"

  if [ -n "${FLAG_BOOTSTRAP_ADMIN_EMAIL}" ] && [ -n "${BOOTSTRAP_ADMIN_PASSWORD}" ]; then
    printf '\n  %sFirst-login admin credentials (shown only once):%s\n' "${C_BOLD}${C_YELLOW}" "${C_RESET}"
    print_label "  Email" "${FLAG_BOOTSTRAP_ADMIN_EMAIL}"
    print_label "  Password" "${BOOTSTRAP_ADMIN_PASSWORD}"
    printf '\n  %sSAVE THIS PASSWORD NOW.%s After first login at %s/auth/login:\n' \
      "${C_BOLD}${C_RED}" "${C_RESET}" "${url}"
    printf '    1. Change the password via the admin panel.\n'
    printf '    2. Remove PARAKO_BOOTSTRAP_ADMIN_EMAIL and PARAKO_BOOTSTRAP_ADMIN_PASSWORD\n'
    printf '       from %s/runtime/.env\n' "${RESOLVED_INSTALL_DIR}"
    printf '    3. parako restart\n'
  fi

  printf '\n  Common operations:\n'
  printf '    parako status                 Show service state\n'
  printf '    parako doctor                 Run health + security checks\n'
  printf '    parako logs -f                Tail logs\n'
  printf '    parako update                 Upgrade to latest stable\n'
  printf '    parako rollback               Revert to previous snapshot\n'
  printf '    parako backup --out FILE      Disaster-recovery archive\n'
  if [ -z "${FLAG_BOOTSTRAP_ADMIN_EMAIL}" ]; then
    printf '\n  Visit %s/auth/register to create your first user.\n' "${url}"
  fi
}

print_demo_card() {
  local url="http://localhost:${ANS_PORT}"
  print_header "Parako.ID DEMO MODE"
  printf '  %sThis install is ephemeral and intended for evaluation only.%s\n\n' "${C_RED}${C_BOLD}" "${C_RESET}"
  print_label "URL" "${url}"
  print_label "Install dir" "${RESOLVED_INSTALL_DIR}"
  if [ -n "${DEMO_ADMIN_EMAIL:-}" ] && [ -n "${DEMO_ADMIN_PASSWORD:-}" ]; then
    print_label "Admin email" "${DEMO_ADMIN_EMAIL}"
    print_label "Admin password" "${DEMO_ADMIN_PASSWORD} (one-time, shown only here)"
  fi
  printf '\n  Register OIDC clients via %s/admin/oidc-clients after login.\n' "${url}"
  printf '\n  To tear this demo down:\n'
  if [ -n "${DEMO_PID:-}" ]; then
    printf '    kill %s\n' "${DEMO_PID}"
  fi
  printf '    rm -rf %s\n' "${RESOLVED_INSTALL_DIR}"
}

# =============================================================================
# §18 Install main flow
# -----------------------------------------------------------------------------
# Invariants:
#   - Calls preflight() first; any FAIL aborts.
#   - Calls beginning_ritual() AFTER wizard + before mutation.
#   - On failure, EXIT trap cleans up tempdir; partial install dir is reported.
# =============================================================================

ensure_install_dir() {
  local target=$1 parent
  parent=$(dirname "${target}")
  [ -d "${target}" ] && return 0
  if [ -w "${parent}" ] 2>/dev/null; then
    mkdir -p "${target}"
    return 0
  fi
  if [ "${RUNNING_AS_ROOT}" -eq 1 ]; then
    mkdir -p "${target}"
  elif command -v sudo >/dev/null 2>&1; then
    log_info "creating ${target} (sudo)"
    sudo mkdir -p "${target}"
    sudo chown "$(id -u):$(id -g)" "${target}"
  else
    die "cannot create ${target}: parent not writable and no sudo available"
  fi
}

install_main() {
  preflight
  sniff_environment

  fetch_latest_version
  fetch_release_artifacts
  verify_checksum
  verify_release_signature

  local install_dir=${INSTALL_DIR:-${DEFAULT_INSTALL_DIR}}
  ensure_install_dir "${install_dir}"
  log_info "extracting to ${install_dir}"
  tar -xzf "${TARBALL_FILE}" -C "${install_dir}" --strip-components=1 \
    || die "extraction failed"
  RESOLVED_INSTALL_DIR=$(cd "${install_dir}" && pwd)
  log_ok "extracted"

  collect_answers
  [ "${FLAG_NON_INTERACTIVE}" -eq 0 ] && confirm_or_edit

  apply_guards

  beginning_ritual

  maybe_generate_bootstrap_password
  generate_env_file
  [ "${FLAG_NON_INTERACTIVE}" -eq 0 ] && validate_connections
  install_dependencies
  run_db_migrations
  write_supervisor_marker
  generate_install_notes
  write_parako_state
  install_parako_binary

  if [ "${FLAG_WITH_NGINX}" -eq 1 ]; then
    setup_nginx
  fi
  if [ "${FLAG_WITH_TLS}" -eq 1 ]; then
    setup_tls
  fi

  print_recovery_card

  if [ "${FLAG_NO_START}" -eq 0 ]; then
    start_application
  else
    log_info "skipped auto-start (--no-start)"
    case "${ANS_SUPERVISOR}" in
      systemd) printf '  Start with: sudo systemctl start parako-id parako-id-worker\n' ;;
      pm2) printf '  Start with: cd %s && pnpm start\n' "${RESOLVED_INSTALL_DIR}" ;;
    esac
  fi
}

# =============================================================================
# §19 Update main flow
# -----------------------------------------------------------------------------
# Invariants:
#   - Snapshot before mutation; DB backup before extract.
#   - Atomic mv-based swap; rollback on health-check failure.
#   - --plan: no mutations, exit 0. --dry-run: everything except swap, exit 0.
# =============================================================================

stop_service_for_update() {
  local supervisor=$1
  case "${supervisor}" in
    systemd)
      log_info "stopping systemd services"
      local prefix=""
      [ "${RUNNING_AS_ROOT}" -eq 0 ] && prefix="sudo"
      ${prefix} systemctl stop parako-id parako-id-worker 2>/dev/null \
        || log_warn "systemctl stop returned non-zero" ;;
    pm2)
      log_info "stopping PM2 processes"
      (cd "${RESOLVED_INSTALL_DIR}" && pm2 stop runtime/ecosystem.config.cjs 2>/dev/null) \
        || log_warn "pm2 stop returned non-zero" ;;
  esac
}

start_service_for_update() {
  local supervisor=$1
  case "${supervisor}" in
    systemd)
      log_info "starting systemd services"
      local prefix=""
      [ "${RUNNING_AS_ROOT}" -eq 0 ] && prefix="sudo"
      ${prefix} systemctl start parako-id parako-id-worker \
        || die "failed to start systemd services" ;;
    pm2)
      log_info "starting PM2 processes"
      (cd "${RESOLVED_INSTALL_DIR}" && pnpm start) \
        || die "PM2 start failed" ;;
  esac
}

print_update_plan() {
  local current_version=$1 target_version=$2
  print_header "Update plan"
  print_label "Current version" "${current_version}"
  print_label "Target version" "${target_version}"
  print_label "Install dir" "${RESOLVED_INSTALL_DIR}"
  print_label "Supervisor" "$(read_supervisor)"
  print_label "Database" "${ANS_DB}"
  printf '\n  Steps:\n'
  printf '    1. Take filesystem snapshot at %s.backup.%s\n' "${RESOLVED_INSTALL_DIR}" "${RUN_TIMESTAMP}"
  printf '    2. Stop service\n'
  printf '    3. Take logical DB backup to runtime/backups/pre-%s-%s.*\n' "${current_version}" "${RUN_TIMESTAMP}"
  printf '    4. Download + verify (cosign) target release\n'
  printf '    5. Extract to %s.new.%s\n' "${RESOLVED_INSTALL_DIR}" "${RUN_TIMESTAMP}"
  printf '    6. Preserve runtime/{.env,jwks,views,assets,config-backups,data,uploads}\n'
  printf '    7. Run database migrations\n'
  printf '    8. Atomic directory swap\n'
  printf '    9. Start service + health-check (/health)\n'
  printf '   10. If health-check fails: restore snapshot automatically\n'
}

update_main() {
  preflight

  local install_dir=${INSTALL_DIR:-${DEFAULT_INSTALL_DIR}}
  RESOLVED_INSTALL_DIR=$(cd "${install_dir}" 2>/dev/null && pwd) \
    || die "no existing installation at ${install_dir}; run without --update for fresh install"

  [ -f "${RESOLVED_INSTALL_DIR}/runtime/.env" ] || [ -f "${RESOLVED_INSTALL_DIR}/.env" ] \
    || die "no .env in ${RESOLVED_INSTALL_DIR}; refusing to update an unconfigured install"
  [ -f "${RESOLVED_INSTALL_DIR}/dist/src/index.js" ] \
    || die "install at ${RESOLVED_INSTALL_DIR} looks broken (no dist/src/index.js)"

  if [ -d "${RESOLVED_INSTALL_DIR}/.git" ]; then
    die "git-clone install detected; see docs/installer-from-source.md for the manual update procedure"
  fi

  local current_version supervisor port
  current_version=$(read_installed_version "${RESOLVED_INSTALL_DIR}")
  supervisor=$(read_supervisor)
  ANS_DB=$(read_installed_db "${RESOLVED_INSTALL_DIR}")
  ANS_PG_URL=$(read_pg_url_from_env "${RESOLVED_INSTALL_DIR}")
  ANS_MONGO_URI=$(read_mongo_uri_from_env "${RESOLVED_INSTALL_DIR}")
  port=$(read_port_from_env "${RESOLVED_INSTALL_DIR}")

  fetch_latest_version

  if [ "${FLAG_PLAN}" -eq 1 ]; then
    print_update_plan "${current_version}" "${TAG}"
    log_info "--plan: no mutations performed"
    return 0
  fi

  beginning_ritual

  fetch_release_artifacts
  verify_checksum
  verify_release_signature

  # 1. Filesystem snapshot
  local timestamp=${RUN_TIMESTAMP}
  local backup_dir="${RESOLVED_INSTALL_DIR}.backup.${timestamp}"
  log_info "snapshotting to ${backup_dir}"
  cp -a "${RESOLVED_INSTALL_DIR}" "${backup_dir}" \
    || die "snapshot failed; aborting"
  log_ok "snapshot created"

  # 2. Stop service
  stop_service_for_update "${supervisor}"

  # 3. DB backup
  backup_db_before_update "${current_version}"

  # 4. Extract new release to sibling
  local new_dir="${RESOLVED_INSTALL_DIR}.new.${timestamp}"
  ensure_install_dir "${new_dir}"
  log_info "extracting to ${new_dir}"
  tar -xzf "${TARBALL_FILE}" -C "${new_dir}" --strip-components=1 \
    || die "extraction failed"

  # 5. Preserve runtime state.
  log_info "preserving instance state"
  local preserve_runtime="jwks views assets config-backups data uploads"
  for sub in ${preserve_runtime}; do
    if [ -d "${RESOLVED_INSTALL_DIR}/runtime/${sub}" ]; then
      rm -rf "${new_dir}/runtime/${sub}"
      mkdir -p "${new_dir}/runtime"
      cp -a "${RESOLVED_INSTALL_DIR}/runtime/${sub}" "${new_dir}/runtime/${sub}" 2>/dev/null || true
    fi
  done
  # Top-level legacy paths from v0.1.x layouts.
  if [ -d "${RESOLVED_INSTALL_DIR}/data" ] && [ ! -d "${new_dir}/runtime/data" ]; then
    rm -rf "${new_dir}/data"
    cp -a "${RESOLVED_INSTALL_DIR}/data" "${new_dir}/data" 2>/dev/null || true
  fi
  # Always preserve runtime/.env and .supervisor marker.
  if [ -f "${RESOLVED_INSTALL_DIR}/runtime/.env" ]; then
    cp -a "${RESOLVED_INSTALL_DIR}/runtime/.env" "${new_dir}/runtime/.env"
  elif [ -f "${RESOLVED_INSTALL_DIR}/.env" ]; then
    mkdir -p "${new_dir}/runtime"
    cp -a "${RESOLVED_INSTALL_DIR}/.env" "${new_dir}/runtime/.env"
  fi
  cp -a "${RESOLVED_INSTALL_DIR}/.supervisor" "${new_dir}/.supervisor" 2>/dev/null \
    || printf '%s\n' "${supervisor}" > "${new_dir}/.supervisor"

  # 6. Install deps + migrate against new code.
  local old_dir=${RESOLVED_INSTALL_DIR}
  RESOLVED_INSTALL_DIR=${new_dir}
  install_dependencies
  run_db_migrations
  RESOLVED_INSTALL_DIR=${old_dir}

  if [ "${FLAG_DRY_RUN}" -eq 1 ]; then
    log_info "--dry-run: skipping directory swap and start"
    rm -rf "${new_dir}"
    rm -rf "${backup_dir}"
    start_service_for_update "${supervisor}"
    return 0
  fi

  # 7. Atomic swap
  local old_archived="${RESOLVED_INSTALL_DIR}.old.${timestamp}"
  mv "${RESOLVED_INSTALL_DIR}" "${old_archived}" \
    || die "swap failed (could not move old dir)"
  if ! mv "${new_dir}" "${RESOLVED_INSTALL_DIR}"; then
    log_err "swap failed; restoring previous"
    mv "${old_archived}" "${RESOLVED_INSTALL_DIR}" || true
    die "update aborted"
  fi
  log_ok "directory swap complete"

  # 8. Start + health check + auto-rollback
  start_service_for_update "${supervisor}"
  if health_check "${port}"; then
    log_ok "update to ${TAG} complete"
    log_info "snapshot: ${backup_dir}"
    log_info "previous install: ${old_archived}"
    log_info "remove with: parako gc --keep 3 --yes"
  else
    log_err "health check failed; rolling back to ${current_version}"
    stop_service_for_update "${supervisor}"
    local failed="${RESOLVED_INSTALL_DIR}.failed.${timestamp}"
    mv "${RESOLVED_INSTALL_DIR}" "${failed}" || true
    mv "${old_archived}" "${RESOLVED_INSTALL_DIR}" \
      || die "catastrophic rollback failure: old=${old_archived}, broken=${failed}"
    start_service_for_update "${supervisor}"
    log_err "rollback complete; previous version restored"
    log_err "broken upgrade preserved at ${failed}"
    log_err "snapshot at ${backup_dir}"
    exit 1
  fi
}

# =============================================================================
# §20 Rollback main flow
# -----------------------------------------------------------------------------
# Invariants:
#   - Operator explicitly chose rollback; do NOT auto-revert on health failure.
#   - DB rollback only if --migrate-back.
# =============================================================================

list_snapshots() {
  local dir=$1
  local parent
  parent=$(dirname "${dir}")
  local base
  base=$(basename "${dir}")
  find "${parent}" -maxdepth 1 -name "${base}.backup.*" -type d 2>/dev/null | sort -r
}

rollback_main() {
  preflight

  local install_dir=${INSTALL_DIR:-${DEFAULT_INSTALL_DIR}}
  RESOLVED_INSTALL_DIR=$(cd "${install_dir}" 2>/dev/null && pwd) \
    || die "no installation at ${install_dir}"

  local snapshots
  snapshots=$(list_snapshots "${RESOLVED_INSTALL_DIR}")
  if [ -z "${snapshots}" ]; then
    log_warn "no snapshots found for ${RESOLVED_INSTALL_DIR}"
    return 0
  fi

  local target_snapshot
  if [ -n "${FLAG_ROLLBACK_TO}" ]; then
    target_snapshot="${RESOLVED_INSTALL_DIR}.backup.${FLAG_ROLLBACK_TO}"
    [ -d "${target_snapshot}" ] || die "snapshot not found: ${target_snapshot}"
  else
    target_snapshot=$(printf '%s\n' "${snapshots}" | head -n1)
  fi

  print_header "Rollback plan"
  print_label "Current install" "${RESOLVED_INSTALL_DIR}"
  print_label "Will restore" "${target_snapshot}"
  print_label "Current is discarded to" "${RESOLVED_INSTALL_DIR}.rollback-discarded.${RUN_TIMESTAMP}"
  if [ "${FLAG_MIGRATE_BACK}" -eq 1 ]; then
    print_label "DB rollback" "yes (--migrate-back)"
  else
    print_label "DB rollback" "no (operator judgement)"
  fi

  printf '\n  Available snapshots:\n'
  printf '%s\n' "${snapshots}" | head -n 10 | sed 's/^/    /'
  printf '\n'

  if [ "${FLAG_FORCE}" -eq 0 ]; then
    if ! prompt_yn_timeout "Proceed with rollback?" "no" 60; then
      log_info "aborted by operator"
      exit 0
    fi
  fi

  local supervisor port
  supervisor=$(read_supervisor)
  port=$(read_port_from_env "${RESOLVED_INSTALL_DIR}")

  stop_service_for_update "${supervisor}"

  local discarded="${RESOLVED_INSTALL_DIR}.rollback-discarded.${RUN_TIMESTAMP}"
  mv "${RESOLVED_INSTALL_DIR}" "${discarded}" \
    || die "could not move current install aside"
  mv "${target_snapshot}" "${RESOLVED_INSTALL_DIR}" \
    || { mv "${discarded}" "${RESOLVED_INSTALL_DIR}" || true
         die "could not restore snapshot"
       }

  if [ "${FLAG_MIGRATE_BACK}" -eq 1 ]; then
    log_warn "DB rollback requested; running migrations against restored version"
    ANS_DB=$(read_installed_db "${RESOLVED_INSTALL_DIR}")
    run_db_migrations
  fi

  start_service_for_update "${supervisor}"

  if health_check "${port}"; then
    log_ok "rollback complete; service is healthy"
    log_info "discarded install at ${discarded}"
  else
    log_err "rollback restored snapshot, but health check FAILED"
    log_err "service is stopped; investigate logs and rerun --update once cause is known"
    exit 1
  fi
}

# =============================================================================
# §21 Doctor main flow
# -----------------------------------------------------------------------------
# Invariants:
#   - No mutation.
#   - Reports preflight + post-install checks.
#   - --json emits structured output.
# =============================================================================

doctor_main() {
  print_header "parako doctor"
  preflight

  local install_dir=${INSTALL_DIR:-${DEFAULT_INSTALL_DIR}}
  if [ ! -d "${install_dir}" ]; then
    log_warn "no install at ${install_dir}; preflight-only mode"
    return 0
  fi
  RESOLVED_INSTALL_DIR=$(cd "${install_dir}" && pwd)

  print_header "Runtime"
  local supervisor port version
  supervisor=$(read_supervisor)
  port=$(read_port_from_env "${RESOLVED_INSTALL_DIR}")
  version=$(read_installed_version "${RESOLVED_INSTALL_DIR}")
  print_label "Installed version" "${version}"
  print_label "Supervisor" "${supervisor}"
  print_label "Server port" "${port}"

  case "${supervisor}" in
    systemd)
      if systemctl is-active --quiet parako-id 2>/dev/null; then
        _pf_ok "systemd parako-id" "active"
      else
        _pf_fail "systemd parako-id" "not active"
      fi
      if systemctl is-active --quiet parako-id-worker 2>/dev/null; then
        _pf_ok "systemd parako-id-worker" "active"
      fi ;;
    pm2)
      if (cd "${RESOLVED_INSTALL_DIR}" && pm2 jlist 2>/dev/null | grep -q parako-id); then
        _pf_ok "PM2 parako-id" "running"
      else
        _pf_fail "PM2 parako-id" "not running"
      fi ;;
  esac

  if _probe_url "http://127.0.0.1:${port}/health"; then
    _pf_ok "/health" "200"
  elif _probe_url "http://127.0.0.1:${port}/readyz"; then
    _pf_ok "/readyz" "200 (legacy)"
  else
    _pf_fail "/health" "no response"
  fi

  print_header "Configuration"
  local env_file="${RESOLVED_INSTALL_DIR}/runtime/.env"
  [ -f "${env_file}" ] || env_file="${RESOLVED_INSTALL_DIR}/.env"
  if [ -f "${env_file}" ]; then
    local perm
    perm=$(stat -c '%a' "${env_file}" 2>/dev/null || stat -f '%Op' "${env_file}" 2>/dev/null | tail -c 4)
    case "${perm}" in
      600|0600) _pf_ok ".env permissions" "0600" ;;
      *) _pf_fail ".env permissions" "${perm} (should be 0600)" ;;
    esac
  else
    _pf_fail ".env" "missing"
  fi

  print_header "Storage"
  ANS_DB=$(read_installed_db "${RESOLVED_INSTALL_DIR}")
  case "${ANS_DB}" in
    postgresql)
      ANS_PG_URL=$(read_pg_url_from_env "${RESOLVED_INSTALL_DIR}")
      validate_postgresql "${ANS_PG_URL}" && _pf_ok "PostgreSQL" "reachable" || _pf_fail "PostgreSQL" "unreachable" ;;
    mongodb)
      ANS_MONGO_URI=$(read_mongo_uri_from_env "${RESOLVED_INSTALL_DIR}")
      validate_mongodb "${ANS_MONGO_URI}" && _pf_ok "MongoDB" "reachable" || _pf_fail "MongoDB" "unreachable" ;;
    sqlite)
      if [ -f "${RESOLVED_INSTALL_DIR}/runtime/data/parako.db" ] \
         || [ -f "${RESOLVED_INSTALL_DIR}/data/parako.db" ]; then
        _pf_ok "SQLite" "file present"
      else
        _pf_warn "SQLite" "DB file not found"
      fi ;;
  esac

  if [ "${FLAG_JSON}" -eq 1 ]; then
    printf '{"timestamp":"%s","version":"%s","supervisor":"%s","port":%s,"db":"%s","failures":%d,"warnings":%d,"healthy":%s}\n' \
      "${RUN_TIMESTAMP}" "${version}" "${supervisor}" "${port}" "${ANS_DB}" \
      "${PREFLIGHT_FAIL_COUNT}" "${PREFLIGHT_WARN_COUNT}" \
      "$( [ "${PREFLIGHT_FAIL_COUNT}" -eq 0 ] && printf 'true' || printf 'false' )"
  fi

  if [ "${PREFLIGHT_FAIL_COUNT}" -eq 0 ] && [ "${PREFLIGHT_WARN_COUNT}" -eq 0 ]; then
    printf '\nAll checks passed.\n'
  elif [ "${PREFLIGHT_FAIL_COUNT}" -eq 0 ]; then
    printf '\n%d warning(s), 0 failures.\n' "${PREFLIGHT_WARN_COUNT}"
  else
    printf '\n%d failure(s), %d warning(s).\n' "${PREFLIGHT_FAIL_COUNT}" "${PREFLIGHT_WARN_COUNT}"
    exit 1
  fi
}

# =============================================================================
# §22 GC main flow
# -----------------------------------------------------------------------------
# Invariants:
#   - Default --dry-run; --yes required to actually delete.
#   - Retains N most recent snapshots per category.
# =============================================================================

gc_main() {
  local install_dir=${INSTALL_DIR:-${DEFAULT_INSTALL_DIR}}
  RESOLVED_INSTALL_DIR=$(cd "${install_dir}" 2>/dev/null && pwd) \
    || die "no installation at ${install_dir}"

  print_header "Snapshot inventory"
  local parent
  parent=$(dirname "${RESOLVED_INSTALL_DIR}")
  local base
  base=$(basename "${RESOLVED_INSTALL_DIR}")

  local total_kept=0 total_purge=0
  local categories="backup old failed rollback-discarded"
  local cat snaps purge_list keep_list
  for cat in ${categories}; do
    snaps=$(find "${parent}" -maxdepth 1 -name "${base}.${cat}.*" -type d 2>/dev/null | sort -r)
    [ -z "${snaps}" ] && continue
    keep_list=$(printf '%s\n' "${snaps}" | head -n "${FLAG_KEEP}")
    purge_list=$(printf '%s\n' "${snaps}" | tail -n +"$((FLAG_KEEP + 1))")
    while IFS= read -r s; do
      [ -n "${s}" ] && { print_label "keep    ${cat}" "$(basename "${s}")"; total_kept=$((total_kept + 1)); }
    done <<<"${keep_list}"
    while IFS= read -r s; do
      [ -n "${s}" ] && { print_label "purge   ${cat}" "$(basename "${s}")"; total_purge=$((total_purge + 1)); }
    done <<<"${purge_list}"
    if [ "${FLAG_YES}" -eq 1 ] && [ -n "${purge_list}" ]; then
      while IFS= read -r s; do
        [ -n "${s}" ] && rm -rf "${s}"
      done <<<"${purge_list}"
    fi
  done

  # DB backups: same retention.
  local backup_dir="${RESOLVED_INSTALL_DIR}/runtime/backups"
  if [ -d "${backup_dir}" ]; then
    for pat in 'pre-*.dump.gz' 'pre-*.archive.gz' 'pre-*.db.gz'; do
      local files
      files=$(ls -1t "${backup_dir}"/${pat} 2>/dev/null || true)
      [ -z "${files}" ] && continue
      local purge
      purge=$(printf '%s\n' "${files}" | tail -n +"$((FLAG_KEEP + 1))")
      while IFS= read -r f; do
        [ -n "${f}" ] && { print_label "purge   db-backup" "$(basename "${f}")"; total_purge=$((total_purge + 1)); }
        [ -n "${f}" ] && [ "${FLAG_YES}" -eq 1 ] && rm -f "${f}"
      done <<<"${purge}"
    done
  fi

  printf '\n'
  print_label "Kept" "${total_kept}"
  print_label "Purged" "${total_purge}"
  if [ "${FLAG_YES}" -eq 0 ] && [ "${total_purge}" -gt 0 ]; then
    log_warn "dry-run; pass --yes to actually delete"
  fi
}

# =============================================================================
# §23 nginx + TLS + multi-tenant helpers
# -----------------------------------------------------------------------------
# Invariants:
#   - Every privileged file write goes through write_root_file().
#   - Path allowlist enforced inside write_root_file (defense in depth).
#   - Existing files backed up before overwrite; restored if verify fails.
# =============================================================================

write_root_file() {
  local src=$1 dest=$2 mode=${3:-0644} owner=${4:-root:root}
  case "${dest}" in
    /etc/systemd/system/parako-id*.service) ;;
    /etc/nginx/sites-available/parako-id) ;;
    /etc/nginx/sites-available/parako-id-multi-tenant) ;;
    /usr/local/bin/parako) ;;
    /usr/local/bin/cosign) ;;
    *) die "refusing to write outside allowlist: ${dest}" ;;
  esac
  local prefix=""
  [ "${RUNNING_AS_ROOT}" -eq 0 ] && prefix="sudo"

  if [ -f "${dest}" ]; then
    ${prefix} cp -a "${dest}" "${dest}.bak.${RUN_TIMESTAMP}" \
      || die "could not back up existing ${dest}"
  fi

  ${prefix} install -m "${mode}" -o "${owner%:*}" -g "${owner#*:}" "${src}" "${dest}" \
    || die "install failed for ${dest}"

  [ -f "${dest}" ] || die "post-write verification failed: ${dest}"
  log_ok "wrote ${dest} (mode ${mode}, ${owner})"
}

_render_nginx_single_tenant() {
  local out=$1 domain=$2 port=$3
  cat > "${out}" <<NGINXEOF
upstream parako_${RUN_TIMESTAMP} {
    server 127.0.0.1:${port};
    keepalive 64;
}

server {
    listen 80;
    server_name ${domain};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${domain};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://parako_${RUN_TIMESTAMP};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 90s;
    }

    location /css/ {
        proxy_pass http://parako_${RUN_TIMESTAMP};
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /js/ {
        proxy_pass http://parako_${RUN_TIMESTAMP};
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
NGINXEOF
}

_render_nginx_multi_tenant() {
  local out=$1 base=$2 port=$3
  cat > "${out}" <<NGINXEOF
upstream parako_${RUN_TIMESTAMP} {
    server 127.0.0.1:${port};
    keepalive 64;
}

server {
    listen 80;
    server_name *.${base} _ops.${base} _platforms.${base};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name *.${base} _ops.${base} _platforms.${base};

    ssl_certificate /etc/letsencrypt/live/${base}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${base}/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://parako_${RUN_TIMESTAMP};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 90s;
    }
}
NGINXEOF
}

setup_nginx() {
  local domain port tmp dest
  if [ "${FLAG_MULTI_TENANT}" -eq 1 ]; then
    domain=${FLAG_BASE_DOMAIN}
    [ -z "${domain}" ] && die "--multi-tenant requires --base-domain"
  else
    domain=${FLAG_DOMAIN}
    if [ -z "${domain}" ] && [ -n "${ANS_URL}" ]; then
      domain=${ANS_URL#http*://}
      domain=${domain%%/*}
    fi
    [ -z "${domain}" ] && die "--with-nginx requires --domain (or a Deployment URL)"
  fi
  port=${ANS_PORT}
  tmp=$(mktemp -t parako-nginx-XXXX)
  if [ "${FLAG_MULTI_TENANT}" -eq 1 ]; then
    _render_nginx_multi_tenant "${tmp}" "${domain}" "${port}"
    dest=/etc/nginx/sites-available/parako-id-multi-tenant
  else
    _render_nginx_single_tenant "${tmp}" "${domain}" "${port}"
    dest=/etc/nginx/sites-available/parako-id
  fi

  if [ -f "${dest}" ] && [ "${FLAG_FORCE}" -eq 0 ]; then
    if ! diff -q "${tmp}" "${dest}" >/dev/null 2>&1; then
      log_warn "${dest} exists with different contents; pass --force to overwrite"
      rm -f "${tmp}"
      return 0
    fi
    log_info "${dest} already matches; no-op"
    rm -f "${tmp}"
  else
    write_root_file "${tmp}" "${dest}" 0644 root:root
    rm -f "${tmp}"
    local prefix=""
    [ "${RUNNING_AS_ROOT}" -eq 0 ] && prefix="sudo"
    ${prefix} ln -sf "${dest}" "/etc/nginx/sites-enabled/$(basename "${dest}")"
    ${prefix} nginx -t || die "nginx -t failed"
    ${prefix} systemctl reload nginx || die "nginx reload failed"
    log_ok "nginx configured"
  fi
}

setup_tls() {
  local domain
  if [ "${FLAG_MULTI_TENANT}" -eq 1 ]; then
    domain=${FLAG_BASE_DOMAIN}
  else
    domain=${FLAG_DOMAIN:-${ANS_URL#http*://}}
    domain=${domain%%/*}
  fi
  [ -z "${domain}" ] && die "TLS requires a domain"
  [ -z "${FLAG_TLS_EMAIL}" ] && die "--with-tls requires --tls-email"

  if ! command -v certbot >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      log_info "installing certbot"
      local prefix=""
      [ "${RUNNING_AS_ROOT}" -eq 0 ] && prefix="sudo"
      ${prefix} apt-get update -qq
      ${prefix} apt-get install -y -qq certbot python3-certbot-nginx \
        || die "certbot install failed"
    else
      die "certbot not installed; install it manually then re-run --with-tls"
    fi
  fi

  local prefix=""
  [ "${RUNNING_AS_ROOT}" -eq 0 ] && prefix="sudo"

  if [ "${FLAG_MULTI_TENANT}" -eq 1 ]; then
    if [ -z "${FLAG_CERTBOT_DNS_PLUGIN}" ]; then
      log_warn "multi-tenant requires wildcard cert; --certbot-dns-plugin not set"
      log_warn "skipping certbot; run manually:"
      printf '  sudo certbot certonly --dns-PLUGIN -d "%s" -d "*.%s" --email "%s" --agree-tos\n' \
        "${domain}" "${domain}" "${FLAG_TLS_EMAIL}"
      return 0
    fi
    ${prefix} certbot certonly "--dns-${FLAG_CERTBOT_DNS_PLUGIN}" \
      -d "${domain}" -d "*.${domain}" \
      --email "${FLAG_TLS_EMAIL}" --agree-tos --non-interactive \
      || die "certbot wildcard issuance failed"
  else
    ${prefix} certbot --nginx -d "${domain}" \
      --email "${FLAG_TLS_EMAIL}" --agree-tos --non-interactive --redirect \
      || die "certbot --nginx failed"
  fi
  log_ok "TLS provisioned for ${domain}"
}

# =============================================================================
# §24 Demo mode helpers
# -----------------------------------------------------------------------------
# Invariants:
#   - Forced install dir under /tmp (ephemeral).
#   - SQLite + foreground supervisor + auto-seeded admin (via env vars read by
#     master-tenant-bootstrap on first start).
#   - Prints prominent DEMO MODE banner; never confused with production.
# =============================================================================

DEMO_ADMIN_EMAIL=""
DEMO_ADMIN_PASSWORD=""
DEMO_PID=""

demo_main() {
  # Demo forces specific choices that override flags.
  ANS_ENV="development"
  ANS_DB="sqlite"
  ANS_REDIS="no"
  ANS_PORT=${FLAG_PORT:-9007}
  ANS_SUPERVISOR="pm2"  # use pm2 for backgrounded process, simpler teardown

  INSTALL_DIR="/tmp/parako-id-demo-$$"
  DEMO_ADMIN_EMAIL="demo@parako.id"
  DEMO_ADMIN_PASSWORD=$(_gen_hex32 | cut -c1-16)

  preflight
  sniff_environment
  fetch_latest_version
  fetch_release_artifacts
  verify_checksum
  verify_release_signature

  ensure_install_dir "${INSTALL_DIR}"
  log_info "extracting demo install to ${INSTALL_DIR}"
  tar -xzf "${TARBALL_FILE}" -C "${INSTALL_DIR}" --strip-components=1 \
    || die "extraction failed"
  RESOLVED_INSTALL_DIR=$(cd "${INSTALL_DIR}" && pwd)

  apply_guards
  beginning_ritual
  generate_env_file
  install_dependencies
  run_db_migrations
  write_supervisor_marker
  generate_install_notes
  write_parako_state

  # Seed admin via env vars (read by master-tenant-bootstrap).
  export PARAKO_BOOTSTRAP_ADMIN_EMAIL="${DEMO_ADMIN_EMAIL}"
  export PARAKO_BOOTSTRAP_ADMIN_PASSWORD="${DEMO_ADMIN_PASSWORD}"

  log_info "starting demo server in background"
  mkdir -p "${RESOLVED_INSTALL_DIR}/runtime/logs"
  # Run node directly (no subshell) so $! captures the node PID, not a subshell.
  cd "${RESOLVED_INSTALL_DIR}"
  nohup node dist/src/index.js \
    > "${RESOLVED_INSTALL_DIR}/runtime/logs/demo.log" 2>&1 &
  DEMO_PID=$!
  cd - >/dev/null
  sleep 2

  if health_check "${ANS_PORT}"; then
    print_demo_card
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "http://localhost:${ANS_PORT}/auth/login" >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then
      open "http://localhost:${ANS_PORT}/auth/login" >/dev/null 2>&1 &
    fi
  else
    die "demo server did not become healthy; see ${RESOLVED_INSTALL_DIR}/runtime/logs/demo.log"
  fi
}

# =============================================================================
# §25 parako binary copier + state file
# -----------------------------------------------------------------------------
# Invariants:
#   - parako.sh is copied to /usr/local/bin/parako (system) or ~/.local/bin
#     (user) via write_root_file().
#   - .parako-state records install dir + version + supervisor, mode 0600.
# =============================================================================

write_parako_state() {
  local state_file="${RESOLVED_INSTALL_DIR}/.parako-state"
  local state_tmp="${state_file}.tmp.$$"
  {
    printf 'INSTALL_DIR=%s\n' "${RESOLVED_INSTALL_DIR}"
    printf 'VERSION=%s\n' "${TAG:-${INSTALLER_VERSION}}"
    printf 'SUPERVISOR=%s\n' "${ANS_SUPERVISOR}"
    printf 'SUPERVISOR_USER=%s\n' "$(id -un)"
    printf 'INSTALLED_AT=%s\n' "${RUN_TIMESTAMP}"
    printf 'DB=%s\n' "${ANS_DB}"
    printf 'PORT=%s\n' "${ANS_PORT}"
    [ -n "${ANS_URL}" ] && printf 'URL=%s\n' "${ANS_URL}"
  } > "${state_tmp}"
  chmod 0600 "${state_tmp}"
  mv "${state_tmp}" "${state_file}"
}

install_parako_binary() {
  # parako.sh is published alongside install.sh at get.parako.id. Look for it
  # in three places, in order of preference:
  #   1. Beside install.sh (only present for --offline installs or when the
  #      maintainer ran install.sh from a checkout).
  #   2. Inside the extracted release tarball at contrib/parako.sh (future:
  #      CI may ship parako.sh inside the tarball).
  #   3. Fetch from https://get.parako.id/parako.sh (the standard path).
  local src="" tmp_parako=""
  if [ -f "$(dirname "$0")/parako.sh" ] 2>/dev/null; then
    src="$(dirname "$0")/parako.sh"
  elif [ -f "${RESOLVED_INSTALL_DIR}/contrib/parako.sh" ]; then
    src="${RESOLVED_INSTALL_DIR}/contrib/parako.sh"
  else
    log_info "fetching parako binary from get.parako.id"
    tmp_parako="${TMPDIR_PATH:-/tmp}/parako.sh.$$"
    if download_file "https://get.parako.id/parako.sh" "${tmp_parako}" 2>/dev/null; then
      # Sanity check: must be a bash script with our header.
      if head -n5 "${tmp_parako}" | grep -q 'parako — Parako.ID operator binary'; then
        src="${tmp_parako}"
      else
        log_warn "fetched parako.sh failed sanity check; not installing"
        rm -f "${tmp_parako}"
      fi
    else
      log_warn "could not fetch parako.sh from get.parako.id; skipping operator binary install"
      log_warn "you can install it manually: curl -sSL https://get.parako.id/parako.sh -o /usr/local/bin/parako && chmod +x /usr/local/bin/parako"
    fi
  fi

  [ -z "${src}" ] && return 0

  if [ "${RUNNING_AS_ROOT}" -eq 1 ]; then
    write_root_file "${src}" "/usr/local/bin/parako" 0755 root:root
  else
    mkdir -p "${DEFAULT_BIN_DIR}"
    install -m 0755 "${src}" "${DEFAULT_BIN_DIR}/parako"
    log_ok "installed parako at ${DEFAULT_BIN_DIR}/parako"
    case ":${PATH}:" in
      *":${DEFAULT_BIN_DIR}:"*) ;;
      *) log_warn "${DEFAULT_BIN_DIR} is not on PATH; add it to your shell init to use \`parako\`" ;;
    esac
  fi

  [ -n "${tmp_parako}" ] && rm -f "${tmp_parako}"
}

# =============================================================================
# §26 Dispatcher (main "$@")
# -----------------------------------------------------------------------------
# Invariants:
#   - parse_args runs first; --help short-circuits.
#   - Lock file taken before any mode dispatch.
#   - Mode dispatch is mutually exclusive (enforced in parse_args).
# =============================================================================

acquire_lock() {
  local lock_dir lock_file
  if [ -n "${PARAKO_LOCK_FILE:-}" ]; then
    lock_file=${PARAKO_LOCK_FILE}
  else
    lock_dir=${DEFAULT_LOCK_DIR}
    mkdir -p "${lock_dir}" 2>/dev/null || lock_dir="${TMPDIR:-/tmp}"
    lock_file="${lock_dir}/parako-installer.lock"
  fi
  exec 9>"${lock_file}" 2>/dev/null || {
    log_warn "could not open lock file ${lock_file}; running without lock"
    return 0
  }
  if command -v flock >/dev/null 2>&1; then
    flock --nonblock --exclusive 9 2>/dev/null || die "another installer run in progress (lock: ${lock_file})"
    LOCK_FD=9
  else
    log_warn "flock not available; concurrent installer runs are not prevented"
  fi
}

print_banner() {
  printf '\nparako.id installer v%s\n' "${INSTALLER_VERSION}"
}

main() {
  parse_args "$@"
  if [ "${FLAG_HELP}" -eq 1 ]; then
    print_help
    exit 0
  fi

  ui_init_colors
  log_init
  acquire_lock
  print_banner

  detect_downloader

  if [ "${FLAG_DOCTOR}" -eq 1 ]; then
    doctor_main
    return
  fi
  if [ "${FLAG_GC}" -eq 1 ]; then
    gc_main
    return
  fi
  if [ "${FLAG_ROLLBACK}" -eq 1 ]; then
    rollback_main
    return
  fi
  if [ "${FLAG_DEMO}" -eq 1 ]; then
    demo_main
    return
  fi
  if [ "${FLAG_UPDATE}" -eq 1 ]; then
    update_main
    return
  fi

  install_main
}

main "$@"


