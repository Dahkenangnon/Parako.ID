#!/usr/bin/env bats

load helpers

setup() {
  export INSTALL_DIR="${BATS_TEST_TMPDIR}/parako-docker-${BATS_TEST_NUMBER}"
  mkdir -p "${INSTALL_DIR}/docker" "${INSTALL_DIR}/runtime"
  cp "${INSTALLER_DIR}/../deployment/docker/compose.tools.yaml" "${INSTALL_DIR}/docker/compose.tools.yaml"
  cp "${INSTALLER_DIR}/../.env.example" "${INSTALL_DIR}/docker/.env.sample"
  printf 'INSTALL_MODE=docker\nINSTALL_DIR=%s\nVERSION=0.3.5\n' "${INSTALL_DIR}" \
    >"${INSTALL_DIR}/.parako-state"
}

@test "docker config init records a non-secret SQLite topology and protected bootstrap environment" {
  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" docker config init \
      --url https://auth.example.com \
      --adapter sqlite \
      --redis managed \
      --tenancy single

  [ "${status}" -eq 0 ]
  [ "$(stat -c '%a' "${INSTALL_DIR}/runtime/.env")" = "600" ]
  [ "$(stat -c '%a' "${INSTALL_DIR}/docker/secrets/redis-password")" = "600" ]
  grep -q '^STORAGE_ADAPTER=sqlite$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^MULTI_TENANCY_ENABLED=false$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^REDIS_HOST=redis$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^REDIS_PASSWORD=' "${INSTALL_DIR}/runtime/.env"
  grep -q '^DOCKER_ADAPTER=sqlite$' "${INSTALL_DIR}/docker/topology.env"
  grep -q '^DOCKER_DATABASE_MODE=managed$' "${INSTALL_DIR}/docker/topology.env"
  grep -q '^DOCKER_REDIS_MODE=managed$' "${INSTALL_DIR}/docker/topology.env"
  grep -q '^DOCKER_TENANCY_MODE=single$' "${INSTALL_DIR}/docker/topology.env"
  ! grep -Eq 'SECRET|PASSWORD|ENCRYPTION_KEY|DATABASE_URL' \
    "${INSTALL_DIR}/docker/topology.env"
}

@test "docker config init prepares managed PostgreSQL multi-tenancy without topology secrets" {
  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" docker config init \
      --url https://auth.example.com \
      --adapter postgresql \
      --database managed \
      --redis managed \
      --tenancy multi

  [ "${status}" -eq 0 ]
  [ "$(stat -c '%a' "${INSTALL_DIR}/docker/secrets/postgresql-password")" = "600" ]
  grep -q '^STORAGE_ADAPTER=postgresql$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^STORAGE_POSTGRESQL_URL=postgresql://parako:' "${INSTALL_DIR}/runtime/.env"
  grep -q '@postgresql:5432/parako$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^PG_SSL_ENABLED=false$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^MULTI_TENANCY_ENABLED=true$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^DOCKER_ADAPTER=postgresql$' "${INSTALL_DIR}/docker/topology.env"
  ! grep -Eq 'SECRET|PASSWORD|DATABASE_URL|postgresql://' \
    "${INSTALL_DIR}/docker/topology.env"
}

@test "docker config init prepares managed MongoDB without exposing credentials" {
  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" docker config init \
      --url https://auth.example.com \
      --adapter mongodb \
      --database managed \
      --redis managed \
      --tenancy multi

  [ "${status}" -eq 0 ]
  [ "$(stat -c '%a' "${INSTALL_DIR}/docker/secrets/mongodb-password")" = "600" ]
  grep -q '^STORAGE_ADAPTER=mongodb$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^STORAGE_MONGODB_URI=mongodb://parako:' "${INSTALL_DIR}/runtime/.env"
  grep -q '@mongodb:27017/parako?authSource=admin$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^MULTI_TENANCY_ENABLED=true$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^DOCKER_ADAPTER=mongodb$' "${INSTALL_DIR}/docker/topology.env"
  ! grep -Eq 'SECRET|PASSWORD|DATABASE_URL|mongodb://' \
    "${INSTALL_DIR}/docker/topology.env"
}

@test "docker config init reads external PostgreSQL and Redis credentials from protected files" {
  local database_url_file="${INSTALL_DIR}/database-url"
  local redis_password_file="${INSTALL_DIR}/redis-password"
  local database_secret redis_secret
  database_secret=$(openssl rand -hex 16)
  redis_secret=$(openssl rand -hex 16)
  printf 'postgresql://parako:%s@db.example.com:5432/parako?sslmode=require\n' \
    "${database_secret}" >"${database_url_file}"
  printf '%s\n' "${redis_secret}" >"${redis_password_file}"
  chmod 0600 "${database_url_file}" "${redis_password_file}"

  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" docker config init \
      --url https://auth.example.com \
      --adapter postgresql \
      --database external \
      --database-url-file "${database_url_file}" \
      --redis external \
      --redis-host redis.example.com \
      --redis-port 6380 \
      --redis-password-file "${redis_password_file}" \
      --tenancy single

  [ "${status}" -eq 0 ]
  grep -Fqx "STORAGE_POSTGRESQL_URL=postgresql://parako:${database_secret}@db.example.com:5432/parako?sslmode=require" \
    "${INSTALL_DIR}/runtime/.env"
  grep -q '^REDIS_HOST=redis.example.com$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^REDIS_PORT=6380$' "${INSTALL_DIR}/runtime/.env"
  grep -Fqx "REDIS_PASSWORD=${redis_secret}" "${INSTALL_DIR}/runtime/.env"
  grep -q '^DOCKER_DATABASE_MODE=external$' "${INSTALL_DIR}/docker/topology.env"
  grep -q '^DOCKER_REDIS_MODE=external$' "${INSTALL_DIR}/docker/topology.env"
  [ ! -e "${INSTALL_DIR}/docker/secrets/postgresql-password" ]
  ! grep -Fq "${database_secret}" "${INSTALL_DIR}/docker/topology.env"
  ! grep -Fq "${redis_secret}" "${INSTALL_DIR}/docker/topology.env"
  ! grep -q 'postgresql://' "${INSTALL_DIR}/docker/topology.env"
}

@test "docker deploy validates Compose, migrates, then starts the application" {
  local fake_bin="${INSTALL_DIR}/fake-bin"
  local docker_log="${INSTALL_DIR}/docker.log"
  mkdir -p "${fake_bin}"
  cp "${INSTALLER_DIR}/../deployment/docker/compose.yaml" "${INSTALL_DIR}/docker/compose.yaml"
  cp "${INSTALLER_DIR}/../deployment/docker/compose.redis.yaml" \
    "${INSTALL_DIR}/docker/compose.redis.yaml"
  cat >"${fake_bin}/docker" <<'EOF'
#!/usr/bin/env bash
printf 'docker' >>"${DOCKER_LOG}"
printf ' %q' "$@" >>"${DOCKER_LOG}"
printf '\n' >>"${DOCKER_LOG}"
exit 0
EOF
  chmod 0700 "${fake_bin}/docker"

  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" docker config init \
      --url https://auth.example.com \
      --adapter sqlite \
      --redis managed \
      --tenancy single
  [ "${status}" -eq 0 ]

  run env \
    PATH="${fake_bin}:${PATH}" \
    DOCKER_LOG="${docker_log}" \
    PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    PARAKO_DOCKER_IMAGE="parako-id:test" \
    bash "${PARAKO_SH}" docker deploy

  [ "${status}" -eq 0 ]
  grep -q 'compose version' "${docker_log}"
  grep -q -- '-f .*compose.yaml.*-f .*compose.redis.yaml.* config --quiet' \
    "${docker_log}"
  grep -q -- 'up -d --wait redis' "${docker_log}"
  grep -q -- 'run --rm migrate' "${docker_log}"
  grep -q -- 'up -d --wait app' "${docker_log}"
  grep -q -- 'up -d worker' "${docker_log}"

  local dependency_line migration_line app_line worker_line
  dependency_line=$(grep -n -- 'up -d --wait redis' "${docker_log}" | cut -d: -f1)
  migration_line=$(grep -n -- 'run --rm migrate' "${docker_log}" | cut -d: -f1)
  app_line=$(grep -n -- 'up -d --wait app' "${docker_log}" | cut -d: -f1)
  worker_line=$(grep -n -- 'up -d worker' "${docker_log}" | cut -d: -f1)
  [ "${dependency_line}" -lt "${migration_line}" ]
  [ "${migration_line}" -lt "${app_line}" ]
  [ "${app_line}" -lt "${worker_line}" ]
}

@test "docker lifecycle and management commands delegate to the selected Compose topology" {
  local fake_bin="${INSTALL_DIR}/fake-bin"
  local docker_log="${INSTALL_DIR}/docker.log"
  mkdir -p "${fake_bin}"
  cp "${INSTALLER_DIR}/../deployment/docker/compose.yaml" "${INSTALL_DIR}/docker/compose.yaml"
  cp "${INSTALLER_DIR}/../deployment/docker/compose.redis.yaml" \
    "${INSTALL_DIR}/docker/compose.redis.yaml"
  cat >"${fake_bin}/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
printf 'docker' >>"${DOCKER_LOG}"
printf ' %q' "$@" >>"${DOCKER_LOG}"
printf '\n' >>"${DOCKER_LOG}"
exit 0
FAKE_DOCKER
  chmod 0700 "${fake_bin}/docker"

  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" docker config init \
      --url https://auth.example.com \
      --adapter sqlite \
      --redis managed \
      --tenancy single
  [ "${status}" -eq 0 ]

  local command
  for command in status logs stop start restart down health diag; do
    run env PATH="${fake_bin}:${PATH}" DOCKER_LOG="${docker_log}" \
      PARAKO_INSTALL_DIR="${INSTALL_DIR}" PARAKO_DOCKER_IMAGE="parako-id:test" \
      bash "${PARAKO_SH}" docker "${command}"
    [ "${status}" -eq 0 ]
  done
  run env PATH="${fake_bin}:${PATH}" DOCKER_LOG="${docker_log}" \
    PARAKO_INSTALL_DIR="${INSTALL_DIR}" PARAKO_DOCKER_IMAGE="parako-id:test" \
    bash "${PARAKO_SH}" docker db status
  [ "${status}" -eq 0 ]
  run env PATH="${fake_bin}:${PATH}" DOCKER_LOG="${docker_log}" \
    PARAKO_INSTALL_DIR="${INSTALL_DIR}" PARAKO_DOCKER_IMAGE="parako-id:test" \
    bash "${PARAKO_SH}" docker admin bootstrap --email admin@example.com
  [ "${status}" -eq 0 ]

  grep -q -- ' ps$' "${docker_log}"
  grep -q -- 'logs --tail=200 app worker' "${docker_log}"
  grep -q -- 'stop worker app' "${docker_log}"
  grep -q -- 'restart app worker' "${docker_log}"
  grep -q -- 'down --remove-orphans' "${docker_log}"
  grep -q -- 'exec -T app node -e' "${docker_log}"
  grep -q -- 'run --rm app node dist/scripts/manage/database.js status' "${docker_log}"
  grep -q -- 'run --rm app node dist/scripts/manage/diagnostics.js redis' "${docker_log}"
  grep -q -- 'run --rm app node dist/scripts/manage/admin.js bootstrap --email admin@example.com' \
    "${docker_log}"
}


@test "docker update and rollback verify immutable images and require an encrypted backup" {
  local fake_bin="${INSTALL_DIR}/fake-bin"
  local docker_log="${INSTALL_DIR}/docker.log"
  local cosign_log="${INSTALL_DIR}/cosign.log"
  local backup_file="${INSTALL_DIR}/runtime/backups/pre-update.tar.gz.age"
  mkdir -p "${fake_bin}" "${INSTALL_DIR}/docker/tools/age"
  cp "${INSTALLER_DIR}/../deployment/docker/compose.yaml" \
    "${INSTALL_DIR}/docker/compose.yaml"
  cp "${INSTALLER_DIR}/../deployment/docker/compose.redis.yaml" \
    "${INSTALL_DIR}/docker/compose.redis.yaml"

  cat >"${fake_bin}/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker' >>"${DOCKER_LOG}"
printf ' %q' "$@" >>"${DOCKER_LOG}"
printf '\n' >>"${DOCKER_LOG}"
arguments=" $* "
case "${arguments}" in
  *' image inspect '*)
    printf '%s\n' 'ghcr.io/dahkenangnon/parako-id@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    ;;
  *' ps --status running --services '*) printf '%s\n' app ;;
  *' exec -T app sh -ec '*) tar -czf - --files-from /dev/null ;;
  *' cp app:'*)
    target=${!#}
    printf 'sqlite-fixture\n' >"${target}"
    ;;
esac
FAKE_DOCKER
  chmod 0700 "${fake_bin}/docker"

  cat >"${fake_bin}/cosign" <<'FAKE_COSIGN'
#!/usr/bin/env bash
set -euo pipefail
printf 'cosign' >>"${COSIGN_LOG}"
printf ' %q' "$@" >>"${COSIGN_LOG}"
printf '\n' >>"${COSIGN_LOG}"
FAKE_COSIGN
  chmod 0700 "${fake_bin}/cosign"

  cat >"${INSTALL_DIR}/docker/tools/age/age" <<'FAKE_AGE'
#!/usr/bin/env bash
set -euo pipefail
output=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output=$2; shift 2 ;;
    *) shift ;;
  esac
done
[ -n "${output}" ]
cat >"${output}"
FAKE_AGE
  chmod 0700 "${INSTALL_DIR}/docker/tools/age/age"

  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" docker config init \
      --url https://auth.example.com \
      --adapter sqlite \
      --redis managed \
      --tenancy single \
      --backup-recipient age1testrecipient
  [ "${status}" -eq 0 ]

  run env PATH="${fake_bin}:${PATH}" \
    DOCKER_LOG="${docker_log}" \
    COSIGN_LOG="${cosign_log}" \
    PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" docker backup --output "${backup_file}"
  [ "${status}" -eq 0 ]
  [ -s "${backup_file}" ]
  [ -s "${backup_file}.sha256" ]

  run env PATH="${fake_bin}:${PATH}" \
    DOCKER_LOG="${docker_log}" \
    COSIGN_LOG="${cosign_log}" \
    PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" docker update --version v0.3.6
  [ "${status}" -eq 0 ]
  grep -q '^VERSION=0.3.6$' "${INSTALL_DIR}/.parako-state"
  grep -q '^PREVIOUS_VERSION=0.3.5$' "${INSTALL_DIR}/.parako-state"
  grep -q '^DOCKER_IMAGE=ghcr.io/dahkenangnon/parako-id@sha256:a\{64\}$' \
    "${INSTALL_DIR}/.parako-state"
  grep -q -- '--certificate-identity-regexp' "${cosign_log}"
  grep -Fq -- 'release\\.yml@refs/tags/v' "${cosign_log}"

  run env PATH="${fake_bin}:${PATH}" \
    DOCKER_LOG="${docker_log}" \
    COSIGN_LOG="${cosign_log}" \
    PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" docker rollback --to v0.3.5
  [ "${status}" -eq 0 ]
  grep -q '^VERSION=0.3.5$' "${INSTALL_DIR}/.parako-state"
  grep -q '^PREVIOUS_VERSION=0.3.6$' "${INSTALL_DIR}/.parako-state"
  grep -q -- 'run --rm app node dist/scripts/manage/database.js status' \
    "${docker_log}"
}
