#!/usr/bin/env bash
# Secure source distribution installer for Parako.ID.
# Builds an exact stable tag or full commit SHA as a non-root owner, then
# atomically activates an immutable release. It never installs system packages,
# databases, Redis, reverse proxies, TLS, or systemd units.

set -Eeuo pipefail
IFS=$'\n\t'
shopt -s inherit_errexit 2>/dev/null || true
umask 077

INSTALLER_VERSION="0.3.0"
DEFAULT_REPOSITORY="https://github.com/Dahkenangnon/Parako.ID.git"
DEFAULT_INSTALL_DIR="/opt/parako-id"
MODE="install"
REPOSITORY="${PARAKO_GIT_REPOSITORY:-${DEFAULT_REPOSITORY}}"
INSTALL_DIR="${PARAKO_INSTALL_DIR:-${DEFAULT_INSTALL_DIR}}"
OWNER="${PARAKO_INSTALL_OWNER:-${SUDO_USER:-}}"
REF=""
ROLLBACK_TO=""
KEEP=2
PLAN=0
YES=0
NON_INTERACTIVE=0
KEEP_BIN=0
PURGE=0
STAGING_DIR=""
PARAKO_BIN_PATH=""
BUILT_VERSION=""

log() { printf '[%s] %s\n' "$1" "$2"; }
die() { log FAIL "$1" >&2; exit "${2:-1}"; }

cleanup() {
  if [ -n "${STAGING_DIR}" ] && [ -d "${STAGING_DIR}" ]; then
    case "${STAGING_DIR}" in
      "${INSTALL_DIR}"/.staging.git.*)
        chmod -R u+w "${STAGING_DIR}" 2>/dev/null || true
        rm -rf -- "${STAGING_DIR}" ;;
      *) log WARN "refusing to clean unexpected staging path: ${STAGING_DIR}" >&2 ;;
    esac
  fi
}
trap cleanup EXIT INT TERM HUP

usage() {
  cat <<EOF
Parako.ID Git installer v${INSTALLER_VERSION}

Usage:
  install-git.sh --ref <vX.Y.Z|full-commit-sha> [options]
  install-git.sh --update --ref <vX.Y.Z|full-commit-sha> [options]
  install-git.sh --rollback [--to <release|full-commit-sha>] [options]
  install-git.sh --gc [--keep N] --yes [options]
  install-git.sh --doctor [options]
  install-git.sh --uninstall --yes [--purge] [--keep-bin] [options]

Options:
  --ref REF             Stable vX.Y.Z tag or full 40-character commit SHA
  --repository URL      Trusted HTTPS or SSH repository mirror
  --dir DIR             Install root (default: ${DEFAULT_INSTALL_DIR})
  --owner USER          Existing non-root account used to fetch and build
  --plan                Print the operation without network calls or writes
  --non-interactive     Disable prompts (destructive operations still need --yes)
  --help                Show this help

Host requirements:
  Linux, git, Node.js >=24, pnpm >=11, age, age-keygen, tar, flock, and GNU mv.
  Redis is operator-managed and defaults to 127.0.0.1:6379 at deploy time.
  SQLite is the default database; PostgreSQL and MongoDB require complete URIs.
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --ref) [ $# -ge 2 ] || die "--ref requires a value"; REF=$2; shift 2 ;;
      --version) [ $# -ge 2 ] || die "--version requires vX.Y.Z"; REF="v${2#v}"; shift 2 ;;
      --repository) [ $# -ge 2 ] || die "--repository requires a URL"; REPOSITORY=$2; shift 2 ;;
      --dir) [ $# -ge 2 ] || die "--dir requires a path"; INSTALL_DIR=$2; shift 2 ;;
      --owner) [ $# -ge 2 ] || die "--owner requires a user"; OWNER=$2; shift 2 ;;
      --plan) PLAN=1; shift ;;
      --dry-run) PLAN=1; shift ;;
      --non-interactive) NON_INTERACTIVE=1; shift ;;
      --keep-bin) KEEP_BIN=1; shift ;;
      --force|--no-color) shift ;; # compatibility with the shared operator CLI
      --update) MODE="update"; shift ;;
      --rollback) MODE="rollback"; shift ;;
      --to) [ $# -ge 2 ] || die "--to requires a release"; ROLLBACK_TO=$2; shift 2 ;;
      --gc) MODE="gc"; shift ;;
      --keep) [ $# -ge 2 ] || die "--keep requires a number"; KEEP=$2; shift 2 ;;
      --doctor) MODE="doctor"; shift ;;
      --uninstall) MODE="uninstall"; shift ;;
      --purge) PURGE=1; shift ;;
      --yes) YES=1; shift ;;
      --help|-h) usage; exit 0 ;;
      *) die "unknown option: $1" 2 ;;
    esac
  done
}

validate_common() {
  case "${INSTALL_DIR}" in
    /*) ;;
    *) die "--dir must be an absolute path" ;;
  esac
  case "${INSTALL_DIR}" in
    *$'\n'*|*[\;\&\|\`\$\<\>\!]*|/|/usr|/etc|/var|/opt|/home)
      die "unsafe install directory: ${INSTALL_DIR}" ;;
  esac
  [[ "${KEEP}" =~ ^[1-9][0-9]*$ ]] || die "--keep must be a positive integer"
  if [ -z "${OWNER}" ]; then
    if [ "$(id -u)" -ne 0 ]; then OWNER=$(id -un); else die "--owner is required when running as root"; fi
  fi
  [ "${OWNER}" != "root" ] || die "--owner must be a non-root account"
  id -u "${OWNER}" >/dev/null 2>&1 || die "--owner account does not exist: ${OWNER}"
}

validate_ref() {
  case "${REF}" in
    v[0-9]*.[0-9]*.[0-9]*)
      [[ "${REF}" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
        || die "--ref must be a stable vX.Y.Z tag or full commit SHA" ;;
    *)
      [[ "${REF}" =~ ^[0-9a-fA-F]{40}$ ]] \
        || die "--ref must be a stable vX.Y.Z tag or full commit SHA" ;;
  esac
}

validate_repository() {
  case "${REPOSITORY}" in
    https://*)
      [[ "${REPOSITORY}" != https://*@* ]] || die "repository URL must not contain credentials" ;;
    ssh://*)
      [[ "${REPOSITORY}" =~ ^ssh://([A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+(:[0-9]+)?/[^[:space:]]+$ ]] \
        || die "invalid SSH repository URL" ;;
    git@*:* )
      [[ "${REPOSITORY}" =~ ^git@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+(\.git)?$ ]] \
        || die "invalid SSH repository URL" ;;
    /*)
      [ "${PARAKO_GIT_ALLOW_LOCAL:-0}" = "1" ] \
        || die "local repositories are test-only; use a trusted HTTPS or SSH URL" ;;
    *) die "repository must use HTTPS or SSH" ;;
  esac
  case "${REPOSITORY}" in *$'\n'*|*' '*|*'?'*|*'#'*) die "unsafe repository URL" ;; esac
}

require_command() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

version_major() {
  "$1" --version 2>/dev/null | head -n1 | sed -E 's/[^0-9]*([0-9]+).*/\1/'
}

preflight() {
  [ "$(uname -s)" = "Linux" ] || die "Git distribution supports Linux only"
  for command_name in git node pnpm tar flock mv awk sed grep sha256sum install; do require_command "${command_name}"; done
  [ "$(version_major node)" -ge 24 ] || die "Node.js >=24 is required"
  [ "$(version_major pnpm)" -ge 11 ] || die "pnpm >=11 is required"
  mv --help 2>&1 | grep -q -- '-T' || die "GNU mv with -T support is required"
  require_command age
  require_command age-keygen
}

run_as_owner() {
  if [ "$(id -un)" = "${OWNER}" ]; then
    "$@"
  elif [ "$(id -u)" -eq 0 ]; then
    runuser -u "${OWNER}" -- "$@"
  else
    die "run as ${OWNER} or root"
  fi
}

state_file() { printf '%s/.parako-state' "${INSTALL_DIR}"; }
state_value() {
  local key=$1 file
  file=$(state_file)
  [ -r "${file}" ] || return 1
  grep -E "^${key}=" "${file}" | head -n1 | cut -d= -f2-
}

require_git_install() {
  [ -L "${INSTALL_DIR}/current" ] || die "no Parako.ID installation found in ${INSTALL_DIR}"
  [ "$(state_value INSTALL_MODE 2>/dev/null || printf native)" = "git" ] \
    || die "${INSTALL_DIR} is not a Git-based installation"
}

acquire_lock() {
  mkdir -p "${INSTALL_DIR}"
  exec 9>"${INSTALL_DIR}/.install-lock"
  flock --nonblock --exclusive 9 || die "another Parako installer operation is running"
}

safe_repository_for_state() {
  case "${REPOSITORY}" in
    https://*|ssh://*|git@*:*) printf '%s' "${REPOSITORY}" ;;
    *) printf '<local-test-repository>' ;;
  esac
}

write_state() {
  local release=$1 commit=$2 ref=$3 version=$4 previous_release=$5 previous_version=$6
  local state tmp binary_path
  binary_path=${PARAKO_BIN_PATH:-$(state_value PARAKO_BIN_PATH 2>/dev/null || true)}
  state=$(state_file)
  tmp="${state}.tmp.$$"
  {
    printf 'INSTALL_MODE=git\n'
    printf 'INSTALL_DIR=%s\n' "${INSTALL_DIR}"
    printf 'VERSION=%s\n' "${version}"
    printf 'CURRENT_RELEASE=%s\n' "${release}"
    printf 'PREVIOUS_RELEASE=%s\n' "${previous_release}"
    printf 'PREVIOUS_VERSION=%s\n' "${previous_version}"
    printf 'GIT_REPOSITORY=%s\n' "$(safe_repository_for_state)"
    printf 'GIT_REF=%s\n' "${ref}"
    printf 'GIT_COMMIT=%s\n' "${commit}"
    printf 'INSTALL_OWNER=%s\n' "${OWNER}"
    [ -z "${binary_path}" ] || printf 'PARAKO_BIN_PATH=%s\n' "${binary_path}"
    printf 'INSTALLER_VERSION=%s\n' "${INSTALLER_VERSION}"
    printf 'INSTALLED_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"${tmp}"
  chmod 0644 "${tmp}"
  mv -f "${tmp}" "${state}"
}

ensure_layout() {
  mkdir -p "${INSTALL_DIR}/releases" "${INSTALL_DIR}/runtime"
  chmod 0755 "${INSTALL_DIR}" "${INSTALL_DIR}/releases"
  chmod 0750 "${INSTALL_DIR}/runtime"
  if [ "$(id -u)" -eq 0 ]; then chown "${OWNER}" "${INSTALL_DIR}/runtime"; fi
  if [ "$(id -u)" -eq 0 ]; then
    chown "${OWNER}" "${INSTALL_DIR}/repository.git" 2>/dev/null || true
  fi
}

sync_mirror() {
  local mirror="${INSTALL_DIR}/repository.git"
  if [ ! -d "${mirror}" ]; then
    mkdir "${mirror}"
    if [ "$(id -u)" -eq 0 ]; then chown "${OWNER}" "${mirror}"; fi
    run_as_owner git init --bare "${mirror}"
    run_as_owner git --git-dir="${mirror}" remote add origin "${REPOSITORY}"
  else
    local configured
    configured=$(run_as_owner git --git-dir="${mirror}" remote get-url origin)
    [ "${configured}" = "${REPOSITORY}" ] \
      || die "repository differs from installed mirror; refusing implicit source change"
  fi
  run_as_owner git --git-dir="${mirror}" fetch --force --prune origin \
    '+refs/heads/*:refs/remotes/origin/*' \
    'refs/tags/*:refs/tags/*'
}

resolve_commit() {
  local mirror="${INSTALL_DIR}/repository.git" commit
  if [[ "${REF}" =~ ^v ]]; then
    run_as_owner git --git-dir="${mirror}" show-ref --verify --quiet "refs/tags/${REF}" \
      || die "tag not found: ${REF}"
    commit=$(run_as_owner git --git-dir="${mirror}" rev-list -n1 "refs/tags/${REF}")
  else
    commit=$(printf '%s' "${REF}" | tr 'A-F' 'a-f')
    run_as_owner git --git-dir="${mirror}" cat-file -e "${commit}^{commit}" 2>/dev/null \
      || die "commit is not available from the configured repository: ${commit}"
  fi
  run_as_owner git --git-dir="${mirror}" merge-base --is-ancestor "${commit}" origin/main \
    || die "ref is not reachable from origin/main: ${REF}"
  printf '%s' "${commit}"
}

build_release() {
  BUILT_VERSION=""
  local commit=$1 release=$2 version expected
  STAGING_DIR="${INSTALL_DIR}/.staging.git.${commit}.$$"
  mkdir -p "${STAGING_DIR}"
  if [ "$(id -u)" -eq 0 ]; then chown "${OWNER}" "${STAGING_DIR}"; fi
  run_as_owner bash -c 'set -Eeuo pipefail; git --git-dir="$1" archive "$2" | tar -x -C "$3"' \
    bash "${INSTALL_DIR}/repository.git" "${commit}" "${STAGING_DIR}"
  version=$(node -p 'require(process.argv[1]).version' "${STAGING_DIR}/package.json")
  if [[ "${REF}" =~ ^v ]]; then
    expected=${REF#v}
    [ "${version}" = "${expected}" ] \
      || die "tag ${REF} contains package version ${version}; expected ${expected}"
  fi
  (
    cd "${STAGING_DIR}"
    run_as_owner pnpm install --frozen-lockfile
    run_as_owner pnpm audit --prod --audit-level high
    run_as_owner pnpm run build
    run_as_owner pnpm prune --prod --ignore-scripts
  )
  [ -f "${STAGING_DIR}/dist/src/index.js" ] || die "build output is missing dist/src/index.js"
  mkdir -p "${STAGING_DIR}/contrib"
  cp "${STAGING_DIR}/installer/parako.sh" "${STAGING_DIR}/contrib/parako.sh"
  cp "${STAGING_DIR}/installer/install-git.sh" "${STAGING_DIR}/contrib/install-git.sh"
  cp "${STAGING_DIR}/.env.example" "${STAGING_DIR}/contrib/.env.sample"
  chmod 0755 "${STAGING_DIR}/contrib/parako.sh" "${STAGING_DIR}/contrib/install-git.sh"
  rm -rf -- "${STAGING_DIR}/runtime"
  ln -s ../../runtime "${STAGING_DIR}/runtime"
  printf '%s  %s\n' "${commit}" "${REF}" >"${STAGING_DIR}/.parako-source"
  mv "${STAGING_DIR}" "${INSTALL_DIR}/releases/${release}"
  STAGING_DIR=""
  chmod -R a-w "${INSTALL_DIR}/releases/${release}"
  find "${INSTALL_DIR}/releases/${release}" -type d -exec chmod a+rx {} +
  BUILT_VERSION="${version}"
}

activate_release() {
  local release=$1 previous tmp
  previous=""
  if [ -L "${INSTALL_DIR}/current" ]; then previous=$(basename "$(readlink -f "${INSTALL_DIR}/current")"); fi
  tmp="${INSTALL_DIR}/current.tmp.$$"
  ln -s "releases/${release}" "${tmp}"
  mv -Tf "${tmp}" "${INSTALL_DIR}/current"
  printf '%s' "${previous}"
}

install_operator_binary() {
  local source="${INSTALL_DIR}/current/contrib/parako.sh" bin_dir
  [ -r "${source}" ] || die "operator helper is missing: ${source}"
  if [ -n "${PARAKO_GIT_BIN_DIR:-}" ]; then
    bin_dir=${PARAKO_GIT_BIN_DIR}
  elif [ "$(id -u)" -eq 0 ]; then
    bin_dir=/usr/local/bin
  else
    bin_dir="${HOME}/.local/bin"
  fi
  case "${bin_dir}" in /*) ;; *) die "operator binary directory must be absolute" ;; esac
  mkdir -p "${bin_dir}"
  install -m 0755 "${source}" "${bin_dir}/parako"
  PARAKO_BIN_PATH="${bin_dir}/parako"
}

install_or_update() {
  validate_ref
  validate_repository
  if [ "${PLAN}" -eq 1 ]; then
    printf 'Mode: %s\nRepository: %s\nRef: %s\nInstall dir: %s\nOwner: %s\nNon-interactive: %s\n' \
      "${MODE}" "${REPOSITORY}" "${REF}" "${INSTALL_DIR}" "${OWNER}" \
      "${NON_INTERACTIVE}"
    printf 'No network calls or writes were made.\n'
    return
  fi
  preflight
  acquire_lock
  if [ "${MODE}" = "update" ]; then require_git_install; fi
  ensure_layout
  sync_mirror
  local commit release version previous previous_version
  commit=$(resolve_commit)
  release="git-${commit}"
  previous_version=$(state_value VERSION 2>/dev/null || true)
  if [ -d "${INSTALL_DIR}/releases/${release}" ]; then
    version=$(node -p 'require(process.argv[1]).version' "${INSTALL_DIR}/releases/${release}/package.json")
  else
    build_release "${commit}" "${release}"
    version="${BUILT_VERSION}"
  fi
  previous=$(activate_release "${release}")
  install_operator_binary
  write_state "${release}" "${commit}" "${REF}" "${version}" "${previous}" "${previous_version}"
  log OK "activated ${release} (Parako.ID ${version})"
}

rollback_main() {
  require_git_install
  [ "${PLAN}" -eq 0 ] || { printf 'Would roll back %s without modifying runtime data.\n' "${INSTALL_DIR}"; return; }
  acquire_lock
  local target current commit version previous_version
  current=$(basename "$(readlink -f "${INSTALL_DIR}/current")")
  target=${ROLLBACK_TO:-$(state_value PREVIOUS_RELEASE 2>/dev/null || true)}
  [ -n "${target}" ] || die "no previous release is recorded; pass --to"
  if [[ "${target}" =~ ^[0-9a-fA-F]{40}$ ]]; then target="git-$(printf '%s' "${target}" | tr A-F a-f)"; fi
  [[ "${target}" =~ ^git-[0-9a-f]{40}$ ]] || die "--to must be a git-<sha> release or full commit SHA"
  [ -d "${INSTALL_DIR}/releases/${target}" ] || die "release is not installed: ${target}"
  commit=${target#git-}
  version=$(node -p 'require(process.argv[1]).version' "${INSTALL_DIR}/releases/${target}/package.json")
  previous_version=$(state_value VERSION 2>/dev/null || true)
  activate_release "${target}" >/dev/null
  install_operator_binary
  write_state "${target}" "${commit}" "${commit}" "${version}" "${current}" "${previous_version}"
  log OK "activated previous release ${target}; runtime data was not changed"
}

gc_main() {
  require_git_install
  [ "${YES}" -eq 1 ] || die "gc requires --yes"
  [ "${PLAN}" -eq 0 ] || { printf 'Would retain current, previous, and %s newest Git releases.\n' "${KEEP}"; return; }
  acquire_lock
  local current previous release kept=0
  current=$(basename "$(readlink -f "${INSTALL_DIR}/current")")
  previous=$(state_value PREVIOUS_RELEASE 2>/dev/null || true)
  while IFS= read -r release; do
    [ -n "${release}" ] || continue
    if [ "${release}" = "${current}" ] || [ "${release}" = "${previous}" ] || [ "${kept}" -lt "${KEEP}" ]; then
      kept=$((kept + 1))
      continue
    fi
    case "${release}" in
      git-[0-9a-f]*)
        chmod -R u+w "${INSTALL_DIR}/releases/${release}"
        rm -rf -- "${INSTALL_DIR}/releases/${release}" ;;
    esac
  done < <(find "${INSTALL_DIR}/releases" -mindepth 1 -maxdepth 1 -type d -name 'git-*' -printf '%T@ %f\n' | sort -rn | awk '{print $2}')
  log OK "old Git releases pruned; runtime was preserved"
}

doctor_main() {
  local failures=0 mode current
  mode=$(state_value INSTALL_MODE 2>/dev/null || printf missing)
  current=""
  [ ! -L "${INSTALL_DIR}/current" ] || current=$(readlink -f "${INSTALL_DIR}/current")
  printf 'Install dir: %s\nMode: %s\nCurrent: %s\n' "${INSTALL_DIR}" "${mode}" "${current:-<missing>}"
  [ "${mode}" = "git" ] || { log FAIL "Git install state is missing" >&2; failures=$((failures + 1)); }
  [ -n "${current}" ] && [ -d "${current}" ] \
    || { log FAIL "current release pointer is invalid" >&2; failures=$((failures + 1)); }
  [ -d "${INSTALL_DIR}/runtime" ] \
    || { log FAIL "shared runtime directory is missing" >&2; failures=$((failures + 1)); }
  [ "${failures}" -eq 0 ] || return 2
  log OK "Git installation structure is healthy"
}

uninstall_main() {
  require_git_install
  [ "${YES}" -eq 1 ] || die "uninstall requires --yes"
  [ "${PLAN}" -eq 0 ] || { printf 'Would remove Git releases and source mirror; runtime purge: %s\n' "${PURGE}"; return; }
  acquire_lock
  local binary_path source
  binary_path=$(state_value PARAKO_BIN_PATH 2>/dev/null || true)
  source="${INSTALL_DIR}/current/contrib/parako.sh"
  if [ "${KEEP_BIN}" -eq 0 ] && [ -n "${binary_path}" ] \
      && [ -f "${binary_path}" ] && cmp -s "${binary_path}" "${source}"; then
    rm -f -- "${binary_path}"
  fi
  rm -f -- "${INSTALL_DIR}/current"
  chmod -R u+w "${INSTALL_DIR}/releases" 2>/dev/null || true
  rm -rf -- "${INSTALL_DIR}/releases" "${INSTALL_DIR}/repository.git"
  rm -f -- "${INSTALL_DIR}/.parako-state"
  if [ "${PURGE}" -eq 1 ]; then rm -rf -- "${INSTALL_DIR}/runtime"; fi
  log OK "Git installation removed; runtime purge=${PURGE}"
}

main() {
  parse_args "$@"
  validate_common
  case "${MODE}" in
    install|update) install_or_update ;;
    rollback) rollback_main ;;
    gc) gc_main ;;
    doctor) doctor_main ;;
    uninstall) uninstall_main ;;
    *) die "unsupported mode: ${MODE}" ;;
  esac
}

main "$@"
