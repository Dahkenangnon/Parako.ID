#!/usr/bin/env bash
# =============================================================================
# parako — Parako.ID production lifecycle operator
# License: MIT  https://github.com/Dahkenangnon/Parako.ID/blob/main/LICENSE
#
# Application and OIDC settings remain managed in the admin panel. This CLI
# owns release files, bootstrap environment, migrations, and systemd lifecycle.
# =============================================================================

set -Eeuo pipefail
IFS=$'\n\t'
shopt -s inherit_errexit 2>/dev/null || true

PARAKO_VERSION="0.3.0"
INSTALLER_URL="${PARAKO_INSTALLER_URL:-https://get.parako.id}"
DEFAULT_INSTALL_DIR_ROOT="/opt/parako-id"
DEFAULT_INSTALL_DIR_USER="${HOME:-/tmp}/parako-id"
TEMP_WORKDIR=""

cleanup_temp_workdir() {
  if [ -n "${TEMP_WORKDIR}" ] && [ -d "${TEMP_WORKDIR}" ]; then
    rm -rf "${TEMP_WORKDIR}" 2>/dev/null || true
  fi
}
trap cleanup_temp_workdir EXIT INT TERM HUP

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

require_install_dir() {
  local install_dir
  install_dir=$(find_install_dir 2>/dev/null) \
    || die "no Parako.ID install dir found; set PARAKO_INSTALL_DIR or install first"
  [ -L "${install_dir}/current" ] || die "${install_dir}/current is not installed"
  printf '%s' "${install_dir}"
}

operator_node() {
  local install_dir=$1 bundled="$1/current/node/bin/node"
  if [ -x "${bundled}" ]; then
    printf '%s' "${bundled}"
  elif command -v node >/dev/null 2>&1; then
    command -v node
  else
    die "this release has no bundled Node.js runtime and node is not on PATH"
  fi
}

run_bundled_cli() {
  local cli=$1; shift
  local install_dir node_bin script
  install_dir=$(require_install_dir)
  node_bin=$(operator_node "${install_dir}")
  script="${install_dir}/current/dist/scripts/manage/${cli}.js"
  [ -f "${script}" ] || die "management command is missing: ${script}"
  (
    cd "${install_dir}/current"
    PARAKO_ROOT="${install_dir}/current" \
    PARAKO_ENV_FILE="${install_dir}/runtime/.env" \
      "${node_bin}" "${script}" "$@"
  )
}

env_value() {
  local file=$1 key=$2
  grep -E "^${key}=" "${file}" 2>/dev/null | tail -n1 | cut -d= -f2-
}

set_env_value() {
  local file=$1 key=$2 value=$3 install_dir node_bin
  install_dir=$(require_install_dir)
  node_bin=$(operator_node "${install_dir}")
  PARAKO_ENV_TARGET="${file}" PARAKO_ENV_KEY="${key}" PARAKO_ENV_VALUE="${value}" \
    "${node_bin}" -e '
      const fs = require("node:fs");
      const file = process.env.PARAKO_ENV_TARGET;
      const key = process.env.PARAKO_ENV_KEY;
      const value = process.env.PARAKO_ENV_VALUE;
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      const prefix = key + "=";
      const index = lines.findIndex(line => line.startsWith(prefix));
      if (index >= 0) lines[index] = prefix + value;
      else lines.push(prefix + value);
      fs.writeFileSync(file, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
    '
}

require_root() {
  [ "$(id -u)" -eq 0 ] || die "this command requires root; rerun with sudo"
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
  printf '\n  Native systemd units execute the immutable release at %s/current.\n\n' "${install_dir}"
}

cmd_doctor() {
  run_installer --doctor "$@"
}

cmd_config_init() {
  local install_dir env_file sample url="" adapter="sqlite" database_url=""
  local redis_host="127.0.0.1" redis_port="6379"
  local backup_recipient=""
  install_dir=$(require_install_dir)
  env_file="${install_dir}/runtime/.env"
  sample="${install_dir}/current/contrib/.env.sample"

  while [ $# -gt 0 ]; do
    case "$1" in
      --url) [ $# -ge 2 ] || die "--url requires https://..."; url=$2; shift 2 ;;
      --adapter) [ $# -ge 2 ] || die "--adapter requires sqlite, postgresql, or mongodb"; adapter=$2; shift 2 ;;
      --database-url) [ $# -ge 2 ] || die "--database-url requires a value"; database_url=$2; shift 2 ;;
      --redis-host) [ $# -ge 2 ] || die "--redis-host requires a value"; redis_host=$2; shift 2 ;;
      --redis-port) [ $# -ge 2 ] || die "--redis-port requires a value"; redis_port=$2; shift 2 ;;
      --backup-recipient) [ $# -ge 2 ] || die "--backup-recipient requires an age recipient"; backup_recipient=$2; shift 2 ;;
      *) die "unknown config init option: $1" ;;
    esac
  done

  for value in "${url}" "${database_url}" "${redis_host}" "${redis_port}" "${backup_recipient}"; do
    case "${value}" in *$'\n'*|*$'\r'*) die "configuration values must not contain line breaks" ;; esac
  done
  case "${url}" in https://*) ;; *) die "--url must be the public HTTPS deployment URL" ;; esac
  case "${adapter}" in sqlite|postgresql|mongodb) ;; *) die "unsupported adapter: ${adapter}" ;; esac
  if [ "${adapter}" != "sqlite" ] && [ -z "${database_url}" ]; then
    die "--database-url is required for ${adapter}"
  fi
  case "${adapter}:${database_url}" in
    postgresql:postgresql://*|postgresql:postgres://*|mongodb:mongodb://*|mongodb:mongodb+srv://*|sqlite:) ;;
    *) die "--database-url scheme does not match ${adapter}" ;;
  esac
  case "${redis_host}" in ''|*[!a-zA-Z0-9._:-]*) die "--redis-host contains unsupported characters" ;; esac
  case "${redis_port}" in ''|*[!0-9]*) die "--redis-port must be an integer" ;; esac
  [ "${redis_port}" -ge 1 ] && [ "${redis_port}" -le 65535 ] \
    || die "--redis-port must be between 1 and 65535"
  case "${backup_recipient}" in ''|age1*) ;; *) die "--backup-recipient must be an age recipient beginning with age1" ;; esac
  [ -r "${sample}" ] || die "bootstrap environment sample missing: ${sample}"
  [ ! -e "${env_file}" ] || die "${env_file} already exists; refusing to overwrite it"

  mkdir -p "${install_dir}/runtime/data" "${install_dir}/runtime/logs" \
    "${install_dir}/runtime/uploads" "${install_dir}/runtime/backups"
  cp "${sample}" "${env_file}"
  chmod 0600 "${env_file}"

  set_env_value "${env_file}" DEPLOYMENT_ENVIRONMENT production
  set_env_value "${env_file}" DEPLOYMENT_URL "${url%/}"
  set_env_value "${env_file}" STORAGE_ADAPTER "${adapter}"
  # Services and management CLIs execute from the immutable `current`
  # release. Use an absolute path so database state always remains in the
  # operator-owned runtime tree across updates and rollbacks.
  set_env_value "${env_file}" STORAGE_SQLITE_PATH "${install_dir}/runtime/data/parako.db"
  set_env_value "${env_file}" REDIS_HOST "${redis_host}"
  set_env_value "${env_file}" REDIS_PORT "${redis_port}"
  set_env_value "${env_file}" USE_FILE_CONFIG false
  [ -z "${backup_recipient}" ] \
    || set_env_value "${env_file}" PARAKO_BACKUP_RECIPIENT "${backup_recipient}"
  case "${adapter}" in
    postgresql)
      set_env_value "${env_file}" STORAGE_POSTGRESQL_URL "${database_url}"
      set_env_value "${env_file}" DATABASE_URL "${database_url}" ;;
    mongodb)
      set_env_value "${env_file}" STORAGE_MONGODB_URI "${database_url}" ;;
  esac

  local key
  for key in ENCRYPTION_KEY JWT_SECRET COOKIE_SECRET_1 COOKIE_SECRET_2 HMAC_SECRET PAIRWISE_SALT; do
    set_env_value "${env_file}" "${key}" "$(openssl rand -hex 32)"
  done
  log_ok "created production bootstrap environment at ${env_file}"
  log_warn "Back up runtime/.env securely; losing ENCRYPTION_KEY can make encrypted data unrecoverable."
  cmd_config_check
}

cmd_config_check() {
  local install_dir env_file failed=0 adapter value mode group
  install_dir=$(require_install_dir)
  env_file="${install_dir}/runtime/.env"
  [ -r "${env_file}" ] || die "missing ${env_file}; run parako config init first"

  mode=$(stat -c '%a' "${env_file}" 2>/dev/null || printf unknown)
  group=$(stat -c '%G' "${env_file}" 2>/dev/null || printf unknown)
  case "${mode}" in
    600) ;;
    640)
      [ "${group}" = "$(service_user)" ] \
        || { log_err "${env_file} mode 640 requires the service group (found ${group})"; failed=1; } ;;
    *) log_err "${env_file} must have mode 600 or root/service-group mode 640 (found ${mode})"; failed=1 ;;
  esac
  [ "$(env_value "${env_file}" DEPLOYMENT_ENVIRONMENT)" = "production" ] \
    || { log_err "DEPLOYMENT_ENVIRONMENT must be production"; failed=1; }
  case "$(env_value "${env_file}" DEPLOYMENT_URL)" in
    https://*) ;;
    *) log_err "DEPLOYMENT_URL must use HTTPS"; failed=1 ;;
  esac
  for key in ENCRYPTION_KEY JWT_SECRET COOKIE_SECRET_1 COOKIE_SECRET_2 HMAC_SECRET PAIRWISE_SALT REDIS_HOST REDIS_PORT; do
    value=$(env_value "${env_file}" "${key}" || true)
    if [ -z "${value}" ] || [[ "${value}" == *replace-me* ]]; then
      log_err "${key} is required"; failed=1
    fi
  done
  adapter=$(env_value "${env_file}" STORAGE_ADAPTER)
  case "${adapter}" in
    sqlite)
      [ -n "$(env_value "${env_file}" STORAGE_SQLITE_PATH)" ] \
        || { log_err "STORAGE_SQLITE_PATH is required"; failed=1; } ;;
    postgresql)
      [ -n "$(env_value "${env_file}" STORAGE_POSTGRESQL_URL)" ] \
        || { log_err "STORAGE_POSTGRESQL_URL is required"; failed=1; } ;;
    mongodb)
      [ -n "$(env_value "${env_file}" STORAGE_MONGODB_URI)" ] \
        || { log_err "STORAGE_MONGODB_URI is required"; failed=1; } ;;
    *) log_err "unsupported STORAGE_ADAPTER: ${adapter:-<empty>}"; failed=1 ;;
  esac
  [ "${failed}" -eq 0 ] || return 1
  log_ok "bootstrap configuration is production-ready"
  log_info "Application and OIDC settings remain managed in the admin panel."
}

age_binary() {
  local install_dir=$1 binary="$1/current/tools/age/age"
  [ -x "${binary}" ] || die "bundled age binary is missing: ${binary}"
  printf '%s' "${binary}"
}

age_keygen_binary() {
  local install_dir=$1 binary="$1/current/tools/age/age-keygen"
  [ -x "${binary}" ] || die "bundled age-keygen binary is missing: ${binary}"
  printf '%s' "${binary}"
}

cmd_backup_keygen() {
  local install_dir output=${1:-}
  install_dir=$(require_install_dir)
  [ -n "${output}" ] || die "usage: parako backup-keygen <identity-file>"
  [ ! -e "${output}" ] || die "refusing to overwrite ${output}"
  mkdir -p "$(dirname "${output}")"
  "$(age_keygen_binary "${install_dir}")" -o "${output}"
  chmod 0600 "${output}"
  log_ok "age backup identity created at ${output}"
  printf 'Recipient: '
  "$(age_keygen_binary "${install_dir}")" -y "${output}"
}

write_mongodb_tool_config() {
  local file=$1 uri=$2 install_dir node_bin
  install_dir=$(require_install_dir)
  node_bin=$(operator_node "${install_dir}")
  PARAKO_MONGO_CONFIG="${file}" PARAKO_MONGO_URI="${uri}" \
    "${node_bin}" -e '
      const fs = require("node:fs");
      fs.writeFileSync(
        process.env.PARAKO_MONGO_CONFIG,
        "uri: " + JSON.stringify(process.env.PARAKO_MONGO_URI) + "\n",
        { mode: 0o600 }
      );
    '
}

cmd_backup() {
  local install_dir env_file adapter recipient="" output="" timestamp staging
  local node_bin age_bin db_path database_url mongo_uri
  install_dir=$(require_install_dir)
  env_file="${install_dir}/runtime/.env"
  cmd_config_check
  while [ $# -gt 0 ]; do
    case "$1" in
      --recipient) [ $# -ge 2 ] || die "--recipient requires an age recipient"; recipient=$2; shift 2 ;;
      --output) [ $# -ge 2 ] || die "--output requires a path"; output=$2; shift 2 ;;
      *) die "unknown backup option: $1" ;;
    esac
  done
  recipient=${recipient:-$(env_value "${env_file}" PARAKO_BACKUP_RECIPIENT || true)}
  [ -n "${recipient}" ] || die "set PARAKO_BACKUP_RECIPIENT or pass --recipient"
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  output=${output:-${install_dir}/runtime/backups/parako-${timestamp}.tar.gz.age}
  mkdir -p "$(dirname "${output}")"
  [ ! -e "${output}" ] || die "refusing to overwrite backup: ${output}"

  TEMP_WORKDIR=$(mktemp -d -t parako-backup-XXXXXXXX)
  chmod 0700 "${TEMP_WORKDIR}"
  staging="${TEMP_WORKDIR}/payload"
  mkdir -p "${staging}/runtime"
  adapter=$(env_value "${env_file}" STORAGE_ADAPTER)
  printf 'FORMAT=parako-backup-v1\nCREATED_AT=%s\nVERSION=%s\nADAPTER=%s\n' \
    "${timestamp}" "$(read_pkg_version "${install_dir}")" "${adapter}" \
    > "${staging}/metadata"
  cp "${env_file}" "${staging}/runtime/.env"
  [ ! -d "${install_dir}/runtime/jwks" ] \
    || cp -a "${install_dir}/runtime/jwks" "${staging}/runtime/"
  [ ! -d "${install_dir}/runtime/uploads" ] \
    || cp -a "${install_dir}/runtime/uploads" "${staging}/runtime/"

  node_bin=$(operator_node "${install_dir}")
  case "${adapter}" in
    sqlite)
      db_path=$(env_value "${env_file}" STORAGE_SQLITE_PATH)
      db_path=$(
        cd "${install_dir}/current"
        "${node_bin}" -p 'require("node:path").resolve(process.argv[1])' "${db_path}"
      )
      (
        cd "${install_dir}/current"
        PARAKO_SQLITE_SOURCE="${db_path}" PARAKO_SQLITE_BACKUP="${staging}/database.sqlite" \
          "${node_bin}" --input-type=module -e '
            import Database from "better-sqlite3";
            const db = new Database(process.env.PARAKO_SQLITE_SOURCE, { readonly: true });
            try { await db.backup(process.env.PARAKO_SQLITE_BACKUP); }
            finally { db.close(); }
          '
      ) ;;
    postgresql)
      command -v pg_dump >/dev/null 2>&1 || die "pg_dump is required for PostgreSQL backups"
      database_url=$(env_value "${env_file}" STORAGE_POSTGRESQL_URL)
      PGDATABASE="${database_url}" pg_dump --format=custom --file="${staging}/database.pgcustom" ;;
    mongodb)
      command -v mongodump >/dev/null 2>&1 || die "mongodump is required for MongoDB backups"
      mongo_uri=$(env_value "${env_file}" STORAGE_MONGODB_URI)
      write_mongodb_tool_config "${TEMP_WORKDIR}/mongodb.yml" "${mongo_uri}"
      mongodump --config="${TEMP_WORKDIR}/mongodb.yml" \
        --archive="${staging}/database.mongodb.gz" --gzip ;;
    *) die "unsupported backup adapter: ${adapter}" ;;
  esac

  # Runtime uploads are untrusted input. Do not preserve symlinks in the
  # privileged restore archive.
  find "${staging}" -type l -delete
  age_bin=$(age_binary "${install_dir}")
  tar -C "${staging}" -czf - . | "${age_bin}" -r "${recipient}" -o "${output}"
  chmod 0600 "${output}"
  sha256sum "${output}" > "${output}.sha256"
  chmod 0600 "${output}.sha256"
  cleanup_temp_workdir
  TEMP_WORKDIR=""
  log_ok "encrypted backup created: ${output}"
  printf '%s\n' "${output}"
}

cmd_restore() {
  local archive="" identity="" restore_secrets=0 confirmed=0 install_dir env_file
  local adapter backup_adapter age_bin staging node_bin db_path database_url mongo_uri user
  while [ $# -gt 0 ]; do
    case "$1" in
      --identity) [ $# -ge 2 ] || die "--identity requires a file"; identity=$2; shift 2 ;;
      --restore-secrets) restore_secrets=1; shift ;;
      --yes) confirmed=1; shift ;;
      -*) die "unknown restore option: $1" ;;
      *) [ -z "${archive}" ] || die "only one backup archive may be restored"; archive=$1; shift ;;
    esac
  done
  [ -n "${archive}" ] && [ -f "${archive}" ] || die "usage: parako restore <backup.age> --identity <file> --yes"
  [ -n "${identity}" ] && [ -r "${identity}" ] || die "--identity must name a readable age identity"
  [ "${confirmed}" -eq 1 ] || die "restore is destructive; pass --yes after verifying the backup"
  require_root
  install_dir=$(require_install_dir)
  env_file="${install_dir}/runtime/.env"
  cmd_config_check
  TEMP_WORKDIR=$(mktemp -d -t parako-restore-XXXXXXXX)
  chmod 0700 "${TEMP_WORKDIR}"
  staging="${TEMP_WORKDIR}/payload"
  mkdir -p "${staging}"
  age_bin=$(age_binary "${install_dir}")
  "${age_bin}" -d -i "${identity}" -o "${TEMP_WORKDIR}/backup.tar.gz" "${archive}"
  if tar -tzf "${TEMP_WORKDIR}/backup.tar.gz" \
      | grep -E '(^/|(^|/)\.\.(/|$))' >/dev/null; then
    die "backup contains an unsafe archive path"
  fi
  if tar -tvzf "${TEMP_WORKDIR}/backup.tar.gz" | grep -Ev '^[-d]' >/dev/null; then
    die "backup contains a link or special file; refusing privileged extraction"
  fi
  tar --no-same-owner --no-same-permissions -xzf "${TEMP_WORKDIR}/backup.tar.gz" -C "${staging}"
  [ "$(sed -n 's/^FORMAT=//p' "${staging}/metadata")" = "parako-backup-v1" ] \
    || die "unsupported or corrupt backup format"
  adapter=$(env_value "${env_file}" STORAGE_ADAPTER)
  backup_adapter=$(sed -n 's/^ADAPTER=//p' "${staging}/metadata")
  [ "${adapter}" = "${backup_adapter}" ] \
    || die "backup adapter ${backup_adapter} does not match configured adapter ${adapter}"

  systemctl stop parako-id-worker.service parako-id.service 2>/dev/null || true
  user=$(service_user)
  node_bin=$(operator_node "${install_dir}")
  case "${adapter}" in
    sqlite)
      [ -f "${staging}/database.sqlite" ] || die "SQLite database missing from backup"
      db_path=$(env_value "${env_file}" STORAGE_SQLITE_PATH)
      db_path=$(
        cd "${install_dir}/current"
        "${node_bin}" -p 'require("node:path").resolve(process.argv[1])' "${db_path}"
      )
      mkdir -p "$(dirname "${db_path}")"
      [ ! -f "${db_path}" ] || cp "${db_path}" "${db_path}.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
      install -m 0600 -o "${user}" -g "${user}" "${staging}/database.sqlite" "${db_path}" ;;
    postgresql)
      command -v pg_restore >/dev/null 2>&1 || die "pg_restore is required"
      database_url=$(env_value "${env_file}" STORAGE_POSTGRESQL_URL)
      PGDATABASE="${database_url}" pg_restore --clean --if-exists --no-owner "${staging}/database.pgcustom" ;;
    mongodb)
      command -v mongorestore >/dev/null 2>&1 || die "mongorestore is required"
      mongo_uri=$(env_value "${env_file}" STORAGE_MONGODB_URI)
      write_mongodb_tool_config "${TEMP_WORKDIR}/mongodb.yml" "${mongo_uri}"
      mongorestore --config="${TEMP_WORKDIR}/mongodb.yml" --drop \
        --archive="${staging}/database.mongodb.gz" --gzip ;;
  esac
  if [ -d "${staging}/runtime/uploads" ]; then
    rm -rf "${install_dir}/runtime/uploads"
    install -d -m 0700 -o "${user}" -g "${user}" "${install_dir}/runtime/uploads"
    cp -a "${staging}/runtime/uploads/." "${install_dir}/runtime/uploads/"
    chown -R "${user}:${user}" "${install_dir}/runtime/uploads"
  fi
  if [ "${restore_secrets}" -eq 1 ]; then
    [ ! -f "${staging}/runtime/.env" ] \
      || install -m 0640 -o root -g "${user}" "${staging}/runtime/.env" "${env_file}"
    if [ -d "${staging}/runtime/jwks" ]; then
      rm -rf "${install_dir}/runtime/jwks"
      install -d -m 0700 -o "${user}" -g "${user}" "${install_dir}/runtime/jwks"
      cp -a "${staging}/runtime/jwks/." "${install_dir}/runtime/jwks/"
      chown -R "${user}:${user}" "${install_dir}/runtime/jwks"
    fi
  fi
  cleanup_temp_workdir
  TEMP_WORKDIR=""
  cmd_db status
  systemctl start parako-id.service parako-id-worker.service
  log_ok "restore completed; run parako health and application smoke tests"
}

cmd_config() {
  local sub=${1:-check}; [ $# -gt 0 ] && shift
  case "${sub}" in
    init) cmd_config_init "$@" ;;
    check) cmd_config_check "$@" ;;
    path) local install_dir; install_dir=$(require_install_dir); printf '%s\n' "${install_dir}/runtime/.env" ;;
    *) die "usage: parako config <init|check|path>" ;;
  esac
}

cmd_db() {
  local sub=${1:-status}; [ $# -gt 0 ] && shift
  case "${sub}" in
    status) run_bundled_cli database status "$@" ;;
    migrate) cmd_config_check; run_bundled_cli database migrate "$@" ;;
    baseline) cmd_config_check; run_bundled_cli database baseline "$@" ;;
    *) die "usage: parako db <status|migrate|baseline>" ;;
  esac
}

cmd_admin() {
  local sub=${1:-}; [ $# -gt 0 ] && shift
  case "${sub}" in
    bootstrap)
      cmd_config_check
      run_bundled_cli admin bootstrap "$@" ;;
    *) die "usage: parako admin bootstrap --email admin@example.com" ;;
  esac
}

service_user() {
  local configured=""
  if command -v systemctl >/dev/null 2>&1 \
      && systemctl cat parako-id.service >/dev/null 2>&1; then
    configured=$(systemctl show parako-id.service --property=User --value 2>/dev/null || true)
  fi
  printf '%s' "${configured:-parako}"
}

prepare_service_permissions() {
  local install_dir=$1 user=$2 target
  require_root
  if ! id -u "${user}" >/dev/null 2>&1; then
    useradd --system --home-dir "${install_dir}" --shell /usr/sbin/nologin "${user}" \
      || die "could not create service user ${user}"
  fi
  target=$(readlink -f "${install_dir}/current")
  chown -R "${user}:${user}" "${install_dir}/runtime"
  if [ -f "${install_dir}/runtime/.env" ]; then
    chown "root:${user}" "${install_dir}/runtime/.env"
    chmod 0640 "${install_dir}/runtime/.env"
  fi
  chown "root:${user}" "${install_dir}" "${install_dir}/releases"
  chown -R "root:${user}" "${target}"
  find "${target}" -type d -exec chmod 0750 {} +
  find "${target}" -type f -exec chmod 0640 {} +
  chmod 0750 "${target}/node/bin/node"
  chmod 0750 "${target}/tools/age/age" "${target}/tools/age/age-keygen"
  chmod 0750 "${install_dir}" "${install_dir}/releases" "${install_dir}/runtime"
}

cmd_service() {
  local sub=${1:-status}; [ $# -gt 0 ] && shift
  local install_dir user="parako"
  install_dir=$(require_install_dir)
  case "${sub}" in
    install)
      while [ $# -gt 0 ]; do
        case "$1" in --user) [ $# -ge 2 ] || die "--user requires a value"; user=$2; shift 2 ;; --force) shift ;; *) die "unknown service install option: $1" ;; esac
      done
      require_root
      cmd_config_check
      prepare_service_permissions "${install_dir}" "${user}"
      run_bundled_cli systemd install --user "${user}" \
        --dir "${install_dir}/current" --runtime-dir "${install_dir}/runtime" \
        --env-file "${install_dir}/runtime/.env" \
        --node-path "${install_dir}/current/node/bin/node" --force ;;
    start)
      require_root
      systemctl enable --now parako-id.service parako-id-worker.service ;;
    stop)
      require_root
      systemctl stop parako-id-worker.service parako-id.service ;;
    restart)
      require_root
      run_bundled_cli systemd restart ;;
    status) run_bundled_cli systemd status ;;
    logs) run_bundled_cli systemd logs "$@" ;;
    *) die "usage: parako service <install|start|stop|restart|status|logs>" ;;
  esac
}

cmd_health() {
  local install_dir env_file port url
  install_dir=$(require_install_dir)
  env_file="${install_dir}/runtime/.env"
  port=$(env_value "${env_file}" DEPLOYMENT_SERVER_PORT || true)
  port=${port:-9007}
  url="http://127.0.0.1:${port}/readyz"
  command -v curl >/dev/null 2>&1 || die "curl is required for health checks"
  check_health "${url}" && printf '\n' \
    || die "readiness check failed: ${url}"
}

cmd_diag() {
  cmd_config_check
  run_bundled_cli database status
  run_bundled_cli diagnostics redis
  if command -v systemctl >/dev/null 2>&1 \
      && systemctl cat parako-id.service >/dev/null 2>&1; then
    run_bundled_cli systemd status
    cmd_health
  else
    log_warn "systemd service is not installed; service and HTTP checks were skipped"
  fi
}

check_health() {
  local url=${1:-}
  if [ -z "${url}" ]; then
    local install_dir env_file port
    install_dir=$(require_install_dir)
    env_file="${install_dir}/runtime/.env"
    port=$(env_value "${env_file}" DEPLOYMENT_SERVER_PORT || true)
    url="http://127.0.0.1:${port:-9007}/readyz"
  fi
  curl --silent --show-error --fail --max-time 5 "${url}"
}

cmd_deploy() {
  require_root
  cmd_config_check
  command -v curl >/dev/null 2>&1 || die "curl is required for deployment health checks"
  run_bundled_cli diagnostics redis
  cmd_db migrate
  cmd_service install "$@"
  cmd_service start
  local attempt
  for attempt in 1 2 3 4 5; do
    if check_health; then
      printf '\n'
      if ! systemctl is-active --quiet parako-id.service \
          || ! systemctl is-active --quiet parako-id-worker.service; then
        systemctl stop parako-id-worker.service parako-id.service 2>/dev/null || true
        die "application or worker service is not active after deployment; both services were stopped"
      fi
      log_ok "Parako.ID is deployed and ready"
      return 0
    fi
    sleep 2
  done
  cmd_service status || true
  systemctl stop parako-id-worker.service parako-id.service 2>/dev/null || true
  die "deployment readiness did not pass; both services were stopped; inspect parako service logs"
}

cmd_update() {
  local pass=() install_dir was_active=0 preview=""
  require_root
  install_dir=$(require_install_dir)
  while [ $# -gt 0 ]; do
    case "$1" in
      --version)
        [ $# -lt 2 ] && die "--version requires vX.Y.Z"
        pass+=(--version "$2"); shift 2 ;;
      --plan) preview="plan"; pass+=("$1"); shift ;;
      --dry-run) preview="dry-run"; pass+=("$1"); shift ;;
      *) pass+=("$1"); shift ;;
    esac
  done
  if [ "${preview}" = "plan" ]; then
    print_header "Update plan"
    print_kv "Install dir" "${install_dir}"
    print_kv "Current release" "$(read_current_target "${install_dir}")"
    print_kv "Target" "${pass[*]:-latest stable}"
    printf '\nNo network calls or writes were made. A real update will validate Redis,\n'
    printf 'create an encrypted backup, verify and activate the release, migrate,\n'
    printf 'restart both services, and require readiness.\n'
    return 0
  fi
  if [ "${preview}" = "dry-run" ]; then
    run_installer --update "${pass[@]}"
    return
  fi
  cmd_config_check
  run_bundled_cli diagnostics redis
  log_info "creating the required encrypted pre-update backup"
  cmd_backup
  if systemctl is-active --quiet parako-id.service 2>/dev/null; then
    was_active=1
    systemctl stop parako-id-worker.service parako-id.service
  fi
  if ! run_installer --update "${pass[@]}"; then
    log_err "release update failed before migration"
    [ "${was_active}" -eq 0 ] || systemctl start parako-id.service parako-id-worker.service
    return 1
  fi
  local user
  user=$(service_user)
  if id -u "${user}" >/dev/null 2>&1; then
    prepare_service_permissions "${install_dir}" "${user}"
  fi
  if ! cmd_db migrate; then
    log_err "database migration failed; services remain stopped"
    log_err "Inspect the migration error, then either retry 'parako db migrate' or explicitly restore the encrypted pre-update backup."
    log_err "Do not start the old release against a partially migrated database."
    return 1
  fi
  if [ "${was_active}" -eq 1 ]; then
    systemctl start parako-id.service parako-id-worker.service
    local attempt
    for attempt in 1 2 3 4 5; do
      if check_health >/dev/null; then
        if ! systemctl is-active --quiet parako-id-worker.service; then
          systemctl stop parako-id-worker.service parako-id.service
          log_err "updated worker service is not active; both services were stopped"
          log_err "Use 'parako service logs'; restore is always explicit."
          return 1
        fi
        log_ok "update completed and readiness passed"
        return 0
      fi
      log_info "waiting for updated service readiness (${attempt}/5)"
      sleep 2
    done
    systemctl stop parako-id-worker.service parako-id.service
    log_err "updated service failed readiness and was stopped"
    log_err "Use 'parako service logs'; restore is always explicit."
    return 1
  fi
  log_ok "update and migrations completed; services were not running"
}

cmd_rollback() {
  local pass=() install_dir was_active=0
  require_root
  install_dir=$(require_install_dir)
  while [ $# -gt 0 ]; do
    case "$1" in
      --to)
        [ $# -lt 2 ] && die "--to requires vX.Y.Z"
        pass+=(--to "$2"); shift 2 ;;
      *) pass+=("$1"); shift ;;
    esac
  done
  if systemctl is-active --quiet parako-id.service 2>/dev/null; then
    was_active=1
    systemctl stop parako-id-worker.service parako-id.service
  fi
  run_installer --rollback "${pass[@]}"
  local user
  user=$(service_user)
  if id -u "${user}" >/dev/null 2>&1; then
    prepare_service_permissions "${install_dir}" "${user}"
  fi
  if ! cmd_db status; then
    log_err "rolled-back application is not compatible with the current database; services remain stopped"
    log_err "Restore the matching encrypted backup explicitly before starting the older release."
    return 1
  fi
  if [ "${was_active}" -eq 1 ]; then
    systemctl start parako-id.service parako-id-worker.service
  fi
  log_ok "application rollback completed; database was not modified"
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

  TEMP_WORKDIR=$(mktemp -d -t parako-self-update-XXXXXXXX) \
    || die "could not create temporary directory"
  chmod 0700 "${TEMP_WORKDIR}"
  local tmp="${TEMP_WORKDIR}/parako.sh"

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
  cleanup_temp_workdir
  TEMP_WORKDIR=""
}

cmd_help() {
  cat <<HELPEOF
parako — Parako.ID operator binary v${PARAKO_VERSION}

Usage:
  parako <command> [options]

Commands:
  version                       Show parako, installer, and app versions
  paths                         Print resolved Parako.ID paths
  config init --url URL [options]
                                Create bootstrap-only production environment
  config check|path             Validate or locate runtime/.env
  db status|migrate             Inspect or apply database migrations
  db baseline --confirm-existing-schema
                                Adopt a schema previously created with db push
  admin bootstrap --email EMAIL Create a one-time first-admin activation URL
  backup [--recipient AGE]      Create an encrypted database/runtime backup
  backup-keygen FILE            Create an age identity and print its recipient
  restore FILE --identity FILE --yes
                                Restore an encrypted backup (services stop first)
  service install|start|stop|restart|status|logs
                                Manage the native systemd app and worker
  deploy [--user USER]          Migrate, install services, start, and verify
  health                        Query the local readiness endpoint
  diag                          Check DB, Redis, systemd, and HTTP readiness
  doctor                        File/config sanity report
  update [--version vX.Y.Z]     Verified in-place release update
  rollback [--to vX.Y.Z]        Switch the application release pointer back
  gc [--keep N] [--yes]         Prune old releases/; never touches runtime/
  clean-stale                   Remove stale current.tmp.* symlinks from a crashed run
  self-update [--force]         Refresh this parako helper to the latest version
  uninstall [--purge] [--keep-bin]
                                Remove this install (preserves runtime/ unless --purge)
  help, --help, -h              Show this message

Scope:
  The CLI manages releases, bootstrap environment, migrations, and systemd.
  Application and OIDC configuration stays in the admin panel. Reverse proxy
  and TLS termination remain external and are never modified by this command.

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
    config)               cmd_config "$@" ;;
    db)                   cmd_db "$@" ;;
    admin)                cmd_admin "$@" ;;
    migrate)              cmd_db migrate "$@" ;;
    backup)               cmd_backup "$@" ;;
    backup-keygen)        cmd_backup_keygen "$@" ;;
    restore)              cmd_restore "$@" ;;
    service)              cmd_service "$@" ;;
    deploy)               cmd_deploy "$@" ;;
    health)               cmd_health "$@" ;;
    diag)                 cmd_diag "$@" ;;
    update)               cmd_update "$@" ;;
    rollback)             cmd_rollback "$@" ;;
    gc)                   cmd_gc "$@" ;;
    help|--help|-h)       cmd_help "$@" ;;
    *) log_err "unknown command: ${cmd}"; cmd_help; exit 2 ;;
  esac
}

main "$@"
