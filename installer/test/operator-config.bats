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
