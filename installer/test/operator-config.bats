#!/usr/bin/env bats
# Distribution-independent bootstrap configuration defaults and URI contract.

load helpers

setup() {
  export INSTALL_DIR="${BATS_TEST_TMPDIR}/parako-config-${BATS_TEST_NUMBER}"
  mkdir -p "${INSTALL_DIR}/releases/git-fixture/contrib" "${INSTALL_DIR}/runtime"
  cp "${INSTALLER_DIR}/../.env.example" "${INSTALL_DIR}/releases/git-fixture/contrib/.env.sample"
  printf '{"version":"0.3.0"}\n' >"${INSTALL_DIR}/releases/git-fixture/package.json"
  ln -s releases/git-fixture "${INSTALL_DIR}/current"
  printf 'INSTALL_MODE=git\nINSTALL_DIR=%s\nVERSION=0.3.0\n' "${INSTALL_DIR}" \
    >"${INSTALL_DIR}/.parako-state"
}

@test "config init defaults to SQLite and operator-managed local Redis" {
  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" config init --url https://auth.example.com
  [ "${status}" -eq 0 ]
  grep -q '^STORAGE_ADAPTER=sqlite$' "${INSTALL_DIR}/runtime/.env"
  grep -q "^STORAGE_SQLITE_PATH=${INSTALL_DIR}/runtime/data/parako.db$" \
    "${INSTALL_DIR}/runtime/.env"
  grep -q '^REDIS_HOST=127.0.0.1$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^REDIS_PORT=6379$' "${INSTALL_DIR}/runtime/.env"
}

@test "config init requires an explicit URI for external database adapters" {
  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" config init \
      --url https://auth.example.com --adapter postgresql
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q -- '--database-url is required for postgresql'
  [ ! -e "${INSTALL_DIR}/runtime/.env" ]

  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" config init \
      --url https://auth.example.com --adapter mongodb
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q -- '--database-url is required for mongodb'
  [ ! -e "${INSTALL_DIR}/runtime/.env" ]
}

@test "config init rejects incomplete external database URIs" {
  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" config init \
      --url https://auth.example.com --adapter postgresql \
      --database-url 'postgresql://'
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q -- "complete postgresql URI"
  [ ! -e "${INSTALL_DIR}/runtime/.env" ]

  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" config init \
      --url https://auth.example.com --adapter mongodb \
      --database-url 'mongodb://db.example.com'
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q -- "complete mongodb URI"
  [ ! -e "${INSTALL_DIR}/runtime/.env" ]
}

@test "config init accepts complete PostgreSQL and MongoDB URIs" {
  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" config init \
      --url https://auth.example.com --adapter postgresql \
      --database-url 'postgresql://parako:secret@db.example.com:5432/parako?sslmode=require'
  [ "${status}" -eq 0 ]
  grep -q '^STORAGE_ADAPTER=postgresql$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^STORAGE_POSTGRESQL_URL=postgresql://' "${INSTALL_DIR}/runtime/.env"

  rm "${INSTALL_DIR}/runtime/.env"
  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" config init \
      --url https://auth.example.com --adapter mongodb \
      --database-url 'mongodb://parako:secret@db.example.com:27017/parako?authSource=admin'
  [ "${status}" -eq 0 ]
  grep -q '^STORAGE_ADAPTER=mongodb$' "${INSTALL_DIR}/runtime/.env"
  grep -q '^STORAGE_MONGODB_URI=mongodb://' "${INSTALL_DIR}/runtime/.env"
}

@test "config set-url atomically corrects only the public deployment URL" {
  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" config init --url https://wrong.example.com
  [ "${status}" -eq 0 ]
  local before_secret
  before_secret=$(grep '^ENCRYPTION_KEY=' "${INSTALL_DIR}/runtime/.env")

  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" config set-url \
      --url https://correct.example.com --yes

  [ "${status}" -eq 0 ]
  grep -q '^DEPLOYMENT_URL=https://correct.example.com$' \
    "${INSTALL_DIR}/runtime/.env"
  [ "$(grep '^ENCRYPTION_KEY=' "${INSTALL_DIR}/runtime/.env")" = "${before_secret}" ]
  [ "$(stat -c '%a' "${INSTALL_DIR}/runtime/.env")" = 600 ]
  ! find "${INSTALL_DIR}/runtime" -maxdepth 1 -name '.env.tmp.*' | grep -q .
}

@test "config set-url requires explicit confirmation and preserves the old value" {
  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" config init --url https://original.example.com
  [ "${status}" -eq 0 ]

  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" config set-url --url https://replacement.example.com

  [ "${status}" -ne 0 ]
  grep -q '^DEPLOYMENT_URL=https://original.example.com$' \
    "${INSTALL_DIR}/runtime/.env"
}

@test "config set-url rejects malformed hosts and out-of-range ports" {
  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" config init --url https://original.example.com
  [ "${status}" -eq 0 ]

  for invalid_url in \
    'https://example.com:bad' \
    'https://example..com' \
    'https://example.com:70000'; do
    run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
      bash "${PARAKO_SH}" config set-url --url "${invalid_url}" --yes
    [ "${status}" -ne 0 ]
  done

  grep -q '^DEPLOYMENT_URL=https://original.example.com$' \
    "${INSTALL_DIR}/runtime/.env"
}

@test "docker config set-url shares the validated correction workflow" {
  sed -i 's/^INSTALL_MODE=.*/INSTALL_MODE=docker/' "${INSTALL_DIR}/.parako-state"
  mkdir -p "${INSTALL_DIR}/docker"
  cp "${INSTALLER_DIR}/../.env.example" "${INSTALL_DIR}/docker/.env.sample"

  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" docker config init \
      --url https://old.example.com --adapter sqlite --redis managed --tenancy single
  [ "${status}" -eq 0 ]

  run env PARAKO_INSTALL_DIR="${INSTALL_DIR}" \
    bash "${PARAKO_SH}" docker config set-url \
      --url https://new.example.com --yes

  [ "${status}" -eq 0 ]
  grep -q '^DEPLOYMENT_URL=https://new.example.com$' "${INSTALL_DIR}/runtime/.env"
}

@test "release permission normalization preserves packaged executables" {
  local release_dir="${BATS_TEST_TMPDIR}/release-permissions"
  mkdir -p "${release_dir}/node_modules/@prisma/engines"
  printf '#!/bin/sh\nexit 0\n' \
    >"${release_dir}/node_modules/@prisma/engines/schema-engine-linux"
  printf 'module.exports = {}\n' >"${release_dir}/app.js"
  chmod 0755 "${release_dir}/node_modules/@prisma/engines/schema-engine-linux"
  chmod 0664 "${release_dir}/app.js"

  run bash -c '
    source "$1"
    normalize_release_permissions "$2"
    stat -c "%a" "$2/node_modules/@prisma/engines/schema-engine-linux"
    stat -c "%a" "$2/app.js"
  ' _ "${PARAKO_SH}" "${release_dir}"

  [ "${status}" -eq 0 ]
  [ "${lines[0]}" = "750" ]
  [ "${lines[1]}" = "640" ]
}
