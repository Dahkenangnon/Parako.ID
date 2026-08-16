#!/usr/bin/env bash
# Docker-mode lifecycle implementation loaded by the public parako operator.

docker_topology_value() {
  local file=$1 key=$2
  grep -E "^${key}=" "${file}" 2>/dev/null | tail -n1 | cut -d= -f2-
}

read_protected_value_file() {
  local file=${1:-} label=${2:-credential} mode value extra
  [ -n "${file}" ] && [ -f "${file}" ] && [ ! -L "${file}" ] \
    || die "${label} file must be a regular, non-symlink file"
  mode=$(stat -c '%a' "${file}" 2>/dev/null || printf unknown)
  case "${mode}" in 400|600) ;; *) die "${label} file must have mode 0400 or 0600" ;; esac
  IFS= read -r value <"${file}" || [ -n "${value}" ]
  [ -n "${value}" ] || die "${label} file must not be empty"
  if IFS= read -r extra < <(tail -n +2 "${file}"); then
    [ -z "${extra}" ] || die "${label} file must contain exactly one line"
  fi
  if LC_ALL=C grep -q "$(printf '\r')" "${file}"; then
    die "${label} contains an invalid carriage return"
  fi
  printf '%s' "${value}"
}

write_docker_topology() {
  local file=$1 adapter=$2 database_mode=$3 redis_mode=$4 tenancy_mode=$5 temporary
  temporary=$(mktemp "${file}.tmp.XXXXXXXX") \
    || die "could not create temporary Docker topology file"
  chmod 0600 "${temporary}"
  {
    printf 'DOCKER_ADAPTER=%s\n' "${adapter}"
    printf 'DOCKER_DATABASE_MODE=%s\n' "${database_mode}"
    printf 'DOCKER_REDIS_MODE=%s\n' "${redis_mode}"
    printf 'DOCKER_TENANCY_MODE=%s\n' "${tenancy_mode}"
  } >"${temporary}"
  mv -f "${temporary}" "${file}"
  chmod 0600 "${file}"
}

cmd_docker_config_init() {
  local install_dir sample env_file topology_file
  local url="" adapter="" database_mode="managed" redis_mode="managed"
  local tenancy_mode="single" backup_recipient=""
  local database_url_file="" redis_host="" redis_port="6379"
  local redis_password_file=""

  install_dir=$(require_docker_install_dir)
  sample="${install_dir}/docker/.env.sample"
  env_file="${install_dir}/runtime/.env"
  topology_file="${install_dir}/docker/topology.env"

  while [ $# -gt 0 ]; do
    case "$1" in
      --url) [ $# -ge 2 ] || die "--url requires https://..."; url=$2; shift 2 ;;
      --adapter) [ $# -ge 2 ] || die "--adapter requires sqlite, postgresql, or mongodb"; adapter=$2; shift 2 ;;
      --database) [ $# -ge 2 ] || die "--database requires managed or external"; database_mode=$2; shift 2 ;;
      --database-url-file) [ $# -ge 2 ] || die "--database-url-file requires a path"; database_url_file=$2; shift 2 ;;
      --redis) [ $# -ge 2 ] || die "--redis requires managed or external"; redis_mode=$2; shift 2 ;;
      --redis-host) [ $# -ge 2 ] || die "--redis-host requires a value"; redis_host=$2; shift 2 ;;
      --redis-port) [ $# -ge 2 ] || die "--redis-port requires a value"; redis_port=$2; shift 2 ;;
      --redis-password-file) [ $# -ge 2 ] || die "--redis-password-file requires a path"; redis_password_file=$2; shift 2 ;;
      --tenancy) [ $# -ge 2 ] || die "--tenancy requires single or multi"; tenancy_mode=$2; shift 2 ;;
      --backup-recipient) [ $# -ge 2 ] || die "--backup-recipient requires an age recipient"; backup_recipient=$2; shift 2 ;;
      *) die "unknown docker config init option: $1" ;;
    esac
  done

  case "${url}" in https://*) ;; *) die "--url must be the public HTTPS deployment URL" ;; esac
  [ -n "${adapter}" ] || die "--adapter is required for Docker installations"
  case "${adapter}" in
    sqlite|postgresql|mongodb) ;;
    *) die "unsupported adapter: ${adapter}" ;;
  esac
  case "${database_mode}" in
    managed)
      [ -z "${database_url_file}" ] \
        || die "--database-url-file is only valid with --database external" ;;
    external)
      [ "${adapter}" != "sqlite" ] || die "SQLite requires --database managed"
      [ -n "${database_url_file}" ] \
        || die "--database-url-file is required with --database external" ;;
    *) die "--database requires managed or external" ;;
  esac
  case "${redis_mode}" in
    managed)
      [ -z "${redis_host}${redis_password_file}" ] \
        || die "external Redis options require --redis external"
      redis_host=redis ;;
    external)
      [ -n "${redis_host}" ] || die "--redis-host is required with --redis external" ;;
    *) die "--redis requires managed or external" ;;
  esac
  case "${redis_host}" in ''|*[!a-zA-Z0-9._:-]*) die "--redis-host contains unsupported characters" ;; esac
  case "${redis_port}" in ''|*[!0-9]*) die "--redis-port must be an integer" ;; esac
  [ "${redis_port}" -ge 1 ] && [ "${redis_port}" -le 65535 ] \
    || die "--redis-port must be between 1 and 65535"
  case "${tenancy_mode}" in
    single) ;;
    multi)
      [ "${adapter}" != "sqlite" ] \
        || die "SQLite does not support multi-tenancy; use PostgreSQL or MongoDB" ;;
    *) die "--tenancy requires single or multi" ;;
  esac
  case "${backup_recipient}" in ''|age1*) ;; *) die "--backup-recipient must begin with age1" ;; esac
  [ -r "${sample}" ] || die "Docker bootstrap environment sample missing: ${sample}"
  [ ! -e "${env_file}" ] || die "${env_file} already exists; refusing to overwrite it"
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate bootstrap secrets"

  mkdir -p "${install_dir}/runtime/data" "${install_dir}/runtime/logs" \
    "${install_dir}/runtime/uploads" "${install_dir}/runtime/backups"
  local database_password="" database_url="" redis_password=""
  if [ "${database_mode}" = "managed" ]; then
    case "${adapter}" in
      postgresql|mongodb)
        mkdir -p "${install_dir}/docker/secrets"
        database_password=$(openssl rand -hex 32)
        printf '%s\n' "${database_password}" \
          >"${install_dir}/docker/secrets/${adapter}-password"
        chmod 0600 "${install_dir}/docker/secrets/${adapter}-password" ;;
    esac
  else
    database_url=$(read_protected_value_file "${database_url_file}" "database URL")
    validate_database_uri "${adapter}" "${database_url}"
  fi
  if [ "${redis_mode}" = "managed" ]; then
    mkdir -p "${install_dir}/docker/secrets"
    redis_password=$(openssl rand -hex 32)
    printf '%s\n' "${redis_password}" \
      >"${install_dir}/docker/secrets/redis-password"
    chmod 0600 "${install_dir}/docker/secrets/redis-password"
  elif [ -n "${redis_password_file}" ]; then
    redis_password=$(read_protected_value_file "${redis_password_file}" "Redis password")
  fi
  cp "${sample}" "${env_file}"
  chmod 0600 "${env_file}"

  set_env_value_portable "${env_file}" DEPLOYMENT_ENVIRONMENT production
  set_env_value_portable "${env_file}" DEPLOYMENT_URL "${url%/}"
  set_env_value_portable "${env_file}" STORAGE_ADAPTER "${adapter}"
  case "${adapter}" in
    sqlite)
      set_env_value_portable "${env_file}" STORAGE_SQLITE_PATH /app/runtime/data/parako.db ;;
    postgresql)
      if [ "${database_mode}" = "managed" ]; then
        database_url="postgresql://parako:${database_password}@postgresql:5432/parako"
        set_env_value_portable "${env_file}" PG_SSL_ENABLED false
      fi
      set_env_value_portable "${env_file}" STORAGE_POSTGRESQL_URL "${database_url}"
      set_env_value_portable "${env_file}" DATABASE_URL "${database_url}" ;;
    mongodb)
      if [ "${database_mode}" = "managed" ]; then
        database_url="mongodb://parako:${database_password}@mongodb:27017/parako?authSource=admin"
      fi
      set_env_value_portable "${env_file}" STORAGE_MONGODB_URI "${database_url}" ;;
  esac
  set_env_value_portable "${env_file}" REDIS_HOST "${redis_host}"
  set_env_value_portable "${env_file}" REDIS_PORT "${redis_port}"
  [ -z "${redis_password}" ] \
    || set_env_value_portable "${env_file}" REDIS_PASSWORD "${redis_password}"
  if [ "${tenancy_mode}" = "multi" ]; then
    set_env_value_portable "${env_file}" MULTI_TENANCY_ENABLED true
  else
    set_env_value_portable "${env_file}" MULTI_TENANCY_ENABLED false
  fi
  set_env_value_portable "${env_file}" USE_FILE_CONFIG false
  [ -z "${backup_recipient}" ] \
    || set_env_value_portable "${env_file}" PARAKO_BACKUP_RECIPIENT "${backup_recipient}"

  local key
  for key in ENCRYPTION_KEY JWT_SECRET COOKIE_SECRET_1 COOKIE_SECRET_2 HMAC_SECRET PAIRWISE_SALT; do
    set_env_value_portable "${env_file}" "${key}" "$(openssl rand -hex 32)"
  done

  write_docker_topology "${topology_file}" "${adapter}" "${database_mode}" \
    "${redis_mode}" "${tenancy_mode}"
  log_ok "created Docker bootstrap environment at ${env_file}"
  log_ok "recorded non-secret Docker topology at ${topology_file}"
}

cmd_docker_config_check() {
  local install_dir topology_file
  install_dir=$(require_docker_install_dir)
  topology_file="${install_dir}/docker/topology.env"
  [ -r "${topology_file}" ] || die "missing ${topology_file}; run parako docker config init first"
  case "$(docker_topology_value "${topology_file}" DOCKER_ADAPTER)" in
    sqlite|postgresql|mongodb) ;;
    *) die "unsupported or missing Docker adapter" ;;
  esac
  cmd_config_check
}

cmd_docker_config() {
  local sub=${1:-check}
  [ $# -gt 0 ] && shift
  case "${sub}" in
    init) cmd_docker_config_init "$@" ;;
    check) cmd_docker_config_check "$@" ;;
    path)
      local install_dir
      install_dir=$(require_docker_install_dir)
      printf '%s\n' "${install_dir}/runtime/.env" ;;
    *) die "usage: parako docker config <init|check|path>" ;;
  esac
}


docker_compose() {
  local install_dir topology_file adapter database_mode redis_mode version image
  local -a arguments

  install_dir=$(require_docker_install_dir)
  topology_file="${install_dir}/docker/topology.env"
  [ -r "${topology_file}" ] \
    || die "missing ${topology_file}; run parako docker config init first"

  adapter=$(docker_topology_value "${topology_file}" DOCKER_ADAPTER)
  database_mode=$(docker_topology_value "${topology_file}" DOCKER_DATABASE_MODE)
  redis_mode=$(docker_topology_value "${topology_file}" DOCKER_REDIS_MODE)
  version=$(read_state_field "${install_dir}" VERSION 2>/dev/null || printf '%s' "${PARAKO_VERSION}")
  image=${PARAKO_DOCKER_IMAGE:-$(read_state_field "${install_dir}" DOCKER_IMAGE 2>/dev/null || true)}
  image=${image:-ghcr.io/dahkenangnon/parako-id:${version}}

  arguments=(
    compose
    --project-directory "${install_dir}"
    --env-file "${install_dir}/runtime/.env"
    -f "${install_dir}/docker/compose.yaml"
    -f "${install_dir}/docker/compose.tools.yaml"
  )
  if [ "${database_mode}" = "managed" ]; then
    case "${adapter}" in
      postgresql|mongodb)
        arguments+=(-f "${install_dir}/docker/compose.${adapter}.yaml") ;;
      sqlite) ;;
      *) die "unsupported Docker adapter in topology: ${adapter}" ;;
    esac
  fi
  if [ "${redis_mode}" = "managed" ]; then
    arguments+=(-f "${install_dir}/docker/compose.redis.yaml")
  fi

  PARAKO_DOCKER_IMAGE="${image}" docker "${arguments[@]}" "$@"
}

require_docker_runtime() {
  command -v docker >/dev/null 2>&1 \
    || die "Docker Engine is required for Docker-mode operations"
  docker info >/dev/null 2>&1 \
    || die "Docker Engine is not reachable by the current user"
  docker compose version >/dev/null 2>&1 \
    || die "Docker Compose v2 is required"
}

cmd_docker_deploy() {
  local install_dir topology_file adapter database_mode redis_mode
  local -a dependencies=()

  install_dir=$(require_docker_install_dir)
  topology_file="${install_dir}/docker/topology.env"
  require_docker_runtime
  cmd_docker_config_check

  adapter=$(docker_topology_value "${topology_file}" DOCKER_ADAPTER)
  database_mode=$(docker_topology_value "${topology_file}" DOCKER_DATABASE_MODE)
  redis_mode=$(docker_topology_value "${topology_file}" DOCKER_REDIS_MODE)

  [ -r "${install_dir}/docker/compose.yaml" ] \
    || die "Docker Compose bundle is missing: ${install_dir}/docker/compose.yaml"
  [ -r "${install_dir}/docker/compose.tools.yaml" ] \
    || die "Docker operator tools definition is missing"
  if [ "${database_mode}" = "managed" ] && [ "${adapter}" != "sqlite" ]; then
    [ -r "${install_dir}/docker/compose.${adapter}.yaml" ] \
      || die "managed ${adapter} Compose definition is missing"
    dependencies+=("${adapter}")
  fi
  if [ "${redis_mode}" = "managed" ]; then
    [ -r "${install_dir}/docker/compose.redis.yaml" ] \
      || die "managed Redis Compose definition is missing"
    dependencies+=(redis)
  fi

  docker_compose config --quiet
  if [ "${#dependencies[@]}" -gt 0 ]; then
    docker_compose up -d --wait "${dependencies[@]}"
  fi
  docker_compose run --rm migrate
  docker_compose up -d --wait app
  docker_compose up -d worker
  log_ok "Docker deployment is ready"
}
docker_require_running_app() {
  docker_compose ps --status running --services | grep -qx app \
    || die "the Docker application must be running for this operation"
}

cmd_docker_backup() {
  local install_dir env_file topology_file adapter recipient="" output=""
  local timestamp staging age_bin version
  install_dir=$(require_docker_install_dir)
  env_file="${install_dir}/runtime/.env"
  topology_file="${install_dir}/docker/topology.env"
  require_docker_runtime
  cmd_docker_config_check
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --recipient) [ "$#" -ge 2 ] || die "--recipient requires an age recipient"; recipient=$2; shift 2 ;;
      --output) [ "$#" -ge 2 ] || die "--output requires a path"; output=$2; shift 2 ;;
      *) die "unknown Docker backup option: $1" ;;
    esac
  done
  recipient=${recipient:-$(env_value "${env_file}" PARAKO_BACKUP_RECIPIENT || true)}
  case "${recipient}" in age1*) ;; *) die "set PARAKO_BACKUP_RECIPIENT or pass a valid --recipient" ;; esac
  docker_require_running_app
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  output=${output:-${install_dir}/runtime/backups/parako-${timestamp}.tar.gz.age}
  mkdir -p "$(dirname "${output}")"
  [ ! -e "${output}" ] || die "refusing to overwrite backup: ${output}"

  TEMP_WORKDIR=$(mktemp -d -t parako-docker-backup-XXXXXXXX)
  chmod 0700 "${TEMP_WORKDIR}"
  staging="${TEMP_WORKDIR}/payload"
  mkdir -p "${staging}/runtime"
  adapter=$(docker_topology_value "${topology_file}" DOCKER_ADAPTER)
  version=$(read_state_field "${install_dir}" VERSION 2>/dev/null || printf unknown)
  printf 'FORMAT=parako-backup-v1\nCREATED_AT=%s\nVERSION=%s\nADAPTER=%s\n' \
    "${timestamp}" "${version}" "${adapter}" >"${staging}/metadata"
  cp "${env_file}" "${staging}/runtime/.env"

  docker_compose exec -T app sh -ec '
    cd /app/runtime
    for path in uploads jwks; do
      [ ! -e "$path" ] || find -P "$path" \( -type f -o -type d \) -print0
    done | tar --null --no-recursion -czf - --files-from -
  ' >"${staging}/runtime-files.tar.gz"

  case "${adapter}" in
    sqlite)
      local sqlite_snapshot="/app/runtime/backups/.operator-backup-${timestamp}-$$.sqlite"
      docker_compose exec -T -e PARAKO_SQLITE_SNAPSHOT="${sqlite_snapshot}" app \
        node --input-type=module -e '
          import { mkdirSync } from "node:fs";
          import { dirname } from "node:path";
          import Database from "better-sqlite3";
          const source = process.env.STORAGE_SQLITE_PATH;
          const target = process.env.PARAKO_SQLITE_SNAPSHOT;
          if (!source || !target) throw new Error("SQLite backup paths are required");
          mkdirSync(dirname(target), { recursive: true });
          const db = new Database(source, { readonly: true });
          try { await db.backup(target); }
          finally { db.close(); }
        '
      docker_compose cp "app:${sqlite_snapshot}" "${staging}/database.sqlite"
      docker_compose exec -T app rm -f "${sqlite_snapshot}" ;;
    postgresql)
      docker_compose run --rm -T postgresql-tool \
        'PGDATABASE="$STORAGE_POSTGRESQL_URL" exec pg_dump --format=custom' \
        >"${staging}/database.pgcustom" ;;
    mongodb)
      docker_compose run --rm -T mongodb-tool \
        'exec mongodump --uri="$STORAGE_MONGODB_URI" --archive --gzip' \
        >"${staging}/database.mongodb.gz" ;;
    *) die "unsupported Docker backup adapter: ${adapter}" ;;
  esac

  age_bin=$(age_binary "${install_dir}")
  tar -C "${staging}" -czf - . | "${age_bin}" -r "${recipient}" -o "${output}"
  chmod 0600 "${output}"
  sha256sum "${output}" >"${output}.sha256"
  chmod 0600 "${output}.sha256"
  cleanup_temp_workdir
  TEMP_WORKDIR=""
  log_ok "encrypted Docker backup created: ${output}"
  printf '%s\n' "${output}"
}

validate_restore_tar() {
  local archive=$1 label=$2
  if tar -tzf "${archive}" | grep -E '(^/|(^|/)\.\.(/|$))' >/dev/null; then
    die "${label} contains an unsafe archive path"
  fi
  if tar -tvzf "${archive}" | grep -Ev '^[-d]' >/dev/null; then
    die "${label} contains a link or special file"
  fi
}

cmd_docker_restore() {
  local archive="" identity="" restore_secrets=0 confirmed=0
  local install_dir env_file topology_file adapter backup_adapter age_bin staging
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --identity) [ "$#" -ge 2 ] || die "--identity requires a file"; identity=$2; shift 2 ;;
      --restore-secrets) restore_secrets=1; shift ;;
      --yes) confirmed=1; shift ;;
      -*) die "unknown Docker restore option: $1" ;;
      *) [ -z "${archive}" ] || die "only one backup archive may be restored"; archive=$1; shift ;;
    esac
  done
  [ -n "${archive}" ] && [ -f "${archive}" ] \
    || die "usage: parako docker restore <backup.age> --identity <file> --yes"
  [ -n "${identity}" ] && [ -r "${identity}" ] \
    || die "--identity must name a readable age identity"
  [ "${confirmed}" -eq 1 ] \
    || die "restore is destructive; pass --yes after verifying the backup"

  install_dir=$(require_docker_install_dir)
  env_file="${install_dir}/runtime/.env"
  topology_file="${install_dir}/docker/topology.env"
  require_docker_runtime
  cmd_docker_config_check
  TEMP_WORKDIR=$(mktemp -d -t parako-docker-restore-XXXXXXXX)
  chmod 0700 "${TEMP_WORKDIR}"
  staging="${TEMP_WORKDIR}/payload"
  mkdir -p "${staging}"
  age_bin=$(age_binary "${install_dir}")
  "${age_bin}" -d -i "${identity}" -o "${TEMP_WORKDIR}/backup.tar.gz" "${archive}"
  validate_restore_tar "${TEMP_WORKDIR}/backup.tar.gz" "backup"
  tar --no-same-owner --no-same-permissions -xzf "${TEMP_WORKDIR}/backup.tar.gz" -C "${staging}"
  [ "$(sed -n 's/^FORMAT=//p' "${staging}/metadata")" = "parako-backup-v1" ] \
    || die "unsupported or corrupt backup format"
  adapter=$(docker_topology_value "${topology_file}" DOCKER_ADAPTER)
  backup_adapter=$(sed -n 's/^ADAPTER=//p' "${staging}/metadata")
  [ "${adapter}" = "${backup_adapter}" ] \
    || die "backup adapter ${backup_adapter} does not match configured adapter ${adapter}"
  [ -f "${staging}/runtime-files.tar.gz" ] \
    || die "runtime files are missing from backup"
  validate_restore_tar "${staging}/runtime-files.tar.gz" "runtime backup"

  cmd_docker_stop
  case "${adapter}" in
    sqlite)
      [ -f "${staging}/database.sqlite" ] || die "SQLite database missing from backup"
      docker_compose run --rm -T app sh -ec '
        path=$STORAGE_SQLITE_PATH
        [ -n "$path" ] || { echo "STORAGE_SQLITE_PATH is required" >&2; exit 1; }
        mkdir -p "$(dirname "$path")"
        [ ! -f "$path" ] || cp "$path" "$path.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
        cat >"$path"
      ' <"${staging}/database.sqlite" ;;
    postgresql)
      [ -f "${staging}/database.pgcustom" ] || die "PostgreSQL database missing from backup"
      docker_compose run --rm -T postgresql-tool \
        'PGDATABASE="$STORAGE_POSTGRESQL_URL" exec pg_restore --clean --if-exists --no-owner' \
        <"${staging}/database.pgcustom" ;;
    mongodb)
      [ -f "${staging}/database.mongodb.gz" ] || die "MongoDB database missing from backup"
      docker_compose run --rm -T mongodb-tool \
        'exec mongorestore --uri="$STORAGE_MONGODB_URI" --drop --archive --gzip' \
        <"${staging}/database.mongodb.gz" ;;
    *) die "unsupported Docker restore adapter: ${adapter}" ;;
  esac

  docker_compose run --rm -T app sh -ec '
    rm -rf /app/runtime/uploads /app/runtime/jwks
    tar -xzf - -C /app/runtime
  ' <"${staging}/runtime-files.tar.gz"
  if [ "${restore_secrets}" -eq 1 ]; then
    [ ! -f "${staging}/runtime/.env" ] \
      || install -m 0600 "${staging}/runtime/.env" "${env_file}"
  fi
  cleanup_temp_workdir
  TEMP_WORKDIR=""
  cmd_docker_start
  cmd_docker_db status
  log_ok "Docker restore completed and readiness passed"
}

readonly PARAKO_DOCKER_REPOSITORY='ghcr.io/dahkenangnon/parako-id'
readonly PARAKO_COSIGN_IDENTITY_REGEXP='^https://github\.com/Dahkenangnon/Parako\.ID/\.github/workflows/release\.yml@refs/tags/v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
readonly PARAKO_COSIGN_OIDC_ISSUER='https://token.actions.githubusercontent.com'

docker_normalize_version() {
  local version=${1#v}
  [[ "${version}" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
    || die "version must be a stable semantic version such as v1.2.3"
  printf '%s' "${version}"
}

docker_resolve_verified_image() {
  local version=$1 tag digest
  tag="${PARAKO_DOCKER_REPOSITORY}:${version}"
  command -v cosign >/dev/null 2>&1 \
    || die "cosign is required to verify Parako Docker images"
  docker pull "${tag}" >&2
  digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "${tag}")
  case "${digest}" in
    "${PARAKO_DOCKER_REPOSITORY}"@sha256:*) ;;
    *) die "pulled image did not resolve to an expected repository digest" ;;
  esac
  cosign verify \
    --certificate-identity-regexp "${PARAKO_COSIGN_IDENTITY_REGEXP}" \
    --certificate-oidc-issuer "${PARAKO_COSIGN_OIDC_ISSUER}" \
    "${digest}" >/dev/null
  printf '%s' "${digest}"
}

docker_write_release_state() {
  local install_dir=$1 version=$2 previous=$3 image=$4 state_file
  state_file="${install_dir}/.parako-state"
  set_env_value_portable "${state_file}" VERSION "${version}"
  set_env_value_portable "${state_file}" PREVIOUS_VERSION "${previous}"
  set_env_value_portable "${state_file}" DOCKER_IMAGE "${image}"
  chmod 0644 "${state_file}"
}

docker_migrate_with_dependencies() {
  local install_dir topology_file adapter database_mode redis_mode
  local -a dependencies=()
  install_dir=$(require_docker_install_dir)
  topology_file="${install_dir}/docker/topology.env"
  adapter=$(docker_topology_value "${topology_file}" DOCKER_ADAPTER)
  database_mode=$(docker_topology_value "${topology_file}" DOCKER_DATABASE_MODE)
  redis_mode=$(docker_topology_value "${topology_file}" DOCKER_REDIS_MODE)
  if [ "${database_mode}" = managed ] && [ "${adapter}" != sqlite ]; then
    dependencies+=("${adapter}")
  fi
  [ "${redis_mode}" != managed ] || dependencies+=(redis)
  [ "${#dependencies[@]}" -eq 0 ] || docker_compose up -d --wait "${dependencies[@]}"
  docker_compose run --rm migrate
}

cmd_docker_update() {
  local install_dir target="" preview=0 current image was_active=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version) [ "$#" -ge 2 ] || die "--version requires vX.Y.Z"; target=$2; shift 2 ;;
      --plan) preview=1; shift ;;
      *) die "unknown Docker update option: $1" ;;
    esac
  done
  [ -n "${target}" ] || die "usage: parako docker update --version vX.Y.Z [--plan]"
  target=$(docker_normalize_version "${target}")
  install_dir=$(require_docker_install_dir)
  current=$(read_state_field "${install_dir}" VERSION 2>/dev/null || true)
  if [ "${preview}" -eq 1 ]; then
    print_header "Docker update plan"
    print_kv "Current version" "${current:-unknown}"
    print_kv "Target version" "${target}"
    printf '\nThe real update verifies an immutable image digest, creates an encrypted\n'
    printf 'backup, stops app/worker, migrates, and requires readiness.\n'
    return
  fi
  [ "${target}" != "${current}" ] || die "Docker installation is already at ${target}"
  require_docker_runtime
  cmd_docker_config_check
  docker_require_running_app
  image=$(docker_resolve_verified_image "${target}")
  log_info "creating the required encrypted pre-update backup"
  cmd_docker_backup
  docker_compose ps --status running --services | grep -qx app && was_active=1
  [ "${was_active}" -eq 0 ] || cmd_docker_stop
  docker_write_release_state "${install_dir}" "${target}" "${current}" "${image}"
  if ! docker_migrate_with_dependencies; then
    log_err "database migration failed; application services remain stopped"
    log_err "Restore the matching encrypted backup before any application rollback."
    return 1
  fi
  if [ "${was_active}" -eq 1 ]; then
    if ! cmd_docker_start; then
      docker_compose stop worker app 2>/dev/null || true
      log_err "updated application failed readiness and was stopped"
      log_err "Inspect 'parako docker logs'; restore is always explicit."
      return 1
    fi
  fi
  log_ok "Docker update completed at verified digest ${image#*@}"
}

cmd_docker_rollback() {
  local install_dir target="" current image was_active=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --to) [ "$#" -ge 2 ] || die "--to requires vX.Y.Z"; target=$2; shift 2 ;;
      *) die "unknown Docker rollback option: $1" ;;
    esac
  done
  install_dir=$(require_docker_install_dir)
  current=$(read_state_field "${install_dir}" VERSION 2>/dev/null || true)
  target=${target:-$(read_state_field "${install_dir}" PREVIOUS_VERSION 2>/dev/null || true)}
  [ -n "${target}" ] || die "no previous Docker version is recorded; pass --to vX.Y.Z"
  target=$(docker_normalize_version "${target}")
  [ "${target}" != "${current}" ] || die "Docker installation is already at ${target}"
  require_docker_runtime
  cmd_docker_config_check
  image=$(docker_resolve_verified_image "${target}")
  docker_compose ps --status running --services | grep -qx app && was_active=1
  [ "${was_active}" -eq 0 ] || cmd_docker_stop
  docker_write_release_state "${install_dir}" "${target}" "${current}" "${image}"
  if ! cmd_docker_db status; then
    log_err "rolled-back image is not compatible with the current database"
    log_err "Application services remain stopped; restore the matching backup explicitly."
    return 1
  fi
  [ "${was_active}" -eq 0 ] || cmd_docker_start
  log_ok "Docker application rollback completed; database was not modified"
}

cmd_docker_start() {
  require_docker_runtime
  cmd_docker_config_check
  docker_compose up -d --wait app
  docker_compose up -d worker
  log_ok "Docker services are running"
}

cmd_docker_stop() {
  require_docker_runtime
  docker_compose stop worker app
  log_ok "Docker application services are stopped"
}

cmd_docker_restart() {
  require_docker_runtime
  cmd_docker_config_check
  docker_compose restart app worker
  docker_compose up -d --wait app
  docker_compose up -d worker
  log_ok "Docker application services restarted and readiness passed"
}

cmd_docker_down() {
  require_docker_runtime
  docker_compose down --remove-orphans
  log_ok "Docker deployment stopped; persistent volumes were preserved"
}

cmd_docker_status() {
  require_docker_runtime
  docker_compose ps
}

cmd_docker_logs() {
  require_docker_runtime
  if [ "$#" -eq 0 ]; then
    docker_compose logs --tail=200 app worker
  else
    docker_compose logs "$@"
  fi
}

cmd_docker_health() {
  require_docker_runtime
  docker_compose exec -T app node -e '
    fetch("http://127.0.0.1:9007/readyz", {
      headers: { "x-forwarded-proto": "https" },
    }).then(async response => {
      process.stdout.write(await response.text());
      if (!response.ok) process.exitCode = 1;
    }).catch(error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  '
  printf '\n'
}

cmd_docker_db() {
  local sub=${1:-status}
  [ "$#" -eq 0 ] || shift
  require_docker_runtime
  cmd_docker_config_check
  case "${sub}" in
    status)
      docker_compose run --rm app node dist/scripts/manage/database.js status "$@" ;;
    migrate)
      docker_compose run --rm migrate "$@" ;;
    baseline)
      docker_compose run --rm app node dist/scripts/manage/database.js baseline "$@" ;;
    *) die "usage: parako docker db <status|migrate|baseline>" ;;
  esac
}

cmd_docker_admin() {
  local sub=${1:-}
  [ "$#" -eq 0 ] || shift
  require_docker_runtime
  cmd_docker_config_check
  case "${sub}" in
    bootstrap)
      docker_compose run --rm app node dist/scripts/manage/admin.js bootstrap "$@" ;;
    *) die "usage: parako docker admin bootstrap --email admin@example.com" ;;
  esac
}

cmd_docker_diag() {
  require_docker_runtime
  cmd_docker_config_check
  docker_compose config --quiet
  docker_compose ps
  docker_compose run --rm app node dist/scripts/manage/database.js status
  docker_compose run --rm app node dist/scripts/manage/diagnostics.js redis
  cmd_docker_health
  log_ok "Docker diagnostics passed"
}

cmd_docker_help() {
  cat <<'HELPEOF'
Usage:
  parako docker <command> [options]

Commands:
  config init|check|path    Create or validate Docker bootstrap configuration
  deploy                    Validate, migrate, and start the Docker deployment
  start|stop|restart|down    Manage Docker application services
  status|logs [options]     Inspect Docker services and logs
  health|diag                Check readiness or all Docker dependencies
  db status|migrate|baseline Manage the configured database schema
  admin bootstrap --email E  Create a first-admin activation URL
  backup [options]           Create an encrypted database and runtime backup
  restore FILE [options]     Restore a compatible encrypted backup explicitly
  update --version vX.Y.Z    Verify, back up, migrate, and deploy an image
  rollback [--to vX.Y.Z]     Switch images without modifying the database
  help                      Show this message
HELPEOF
}

docker_operator_main() {
  local command_name=${1:-help}
  [ $# -gt 0 ] && shift
  case "${command_name}" in
    config) cmd_docker_config "$@" ;;
    deploy) cmd_docker_deploy "$@" ;;
    start) cmd_docker_start "$@" ;;
    stop) cmd_docker_stop "$@" ;;
    restart) cmd_docker_restart "$@" ;;
    down) cmd_docker_down "$@" ;;
    status) cmd_docker_status "$@" ;;
    logs) cmd_docker_logs "$@" ;;
    health) cmd_docker_health "$@" ;;
    diag) cmd_docker_diag "$@" ;;
    db) cmd_docker_db "$@" ;;
    admin) cmd_docker_admin "$@" ;;
    backup) cmd_docker_backup "$@" ;;
    restore) cmd_docker_restore "$@" ;;
    update) cmd_docker_update "$@" ;;
    rollback) cmd_docker_rollback "$@" ;;
    help|--help|-h) cmd_docker_help ;;
    *) die "unknown Docker command: ${command_name}" ;;
  esac
}
