#!/usr/bin/env bats
# End-to-end smoke test for install.sh in --demo mode.
# Run in CI inside a clean Docker container (Ubuntu 22/24, Debian 12, Alpine 3.19).
# Locally: only run if you have a disposable environment — this writes to /tmp.

load helpers

setup() {
  # Each test gets a fresh ephemeral install dir.
  export INSTALL_DIR="/tmp/parako-smoke-$$-${BATS_TEST_NUMBER}"
  rm -rf "${INSTALL_DIR}" 2>/dev/null || true
}

teardown() {
  # Stop any backgrounded server.
  if [ -f "${INSTALL_DIR}/.parako-state" ]; then
    pkill -f "node.*${INSTALL_DIR}/dist/src/index.js" 2>/dev/null || true
  fi
  rm -rf "${INSTALL_DIR}" 2>/dev/null || true
}

@test "install.sh --help exits 0 and includes the version line" {
  run bash "${INSTALLER_SH}" --help
  [ "${status}" -eq 0 ]
  echo "${output}" | grep -q "Parako.ID installer v0.2.0"
}

@test "install.sh --doctor without an install reports preflight-only mode" {
  # No install at INSTALL_DIR; doctor should run preflight and warn about absence.
  run bash "${INSTALLER_SH}" --doctor --dir "${INSTALL_DIR}" --non-interactive --force --no-color
  # Preflight may FAIL on the CI runner depending on prerequisites; we accept 0 or 2.
  [ "${status}" -eq 0 ] || [ "${status}" -eq 2 ]
}

@test "install.sh --rollback without snapshots exits cleanly" {
  mkdir -p "${INSTALL_DIR}"
  # No .backup.* directories beside install dir.
  run bash "${INSTALLER_SH}" --rollback --dir "${INSTALL_DIR}" --non-interactive --force --no-color
  # Should warn and return without crashing.
  [ "${status}" -eq 0 ] || [ "${status}" -eq 2 ]
}

@test "install.sh --gc --dry-run with no snapshots is a no-op" {
  mkdir -p "${INSTALL_DIR}"
  run bash "${INSTALLER_SH}" --gc --dir "${INSTALL_DIR}" --no-color
  # Default is dry-run; no actual deletes.
  [ "${status}" -eq 0 ] || [ "${status}" -eq 2 ]
}

@test "install.sh rejects unknown --insecure-no-signature without --reason" {
  run bash "${INSTALLER_SH}" --insecure-no-signature
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q -- "--insecure-no-signature requires --reason"
}

@test "install.sh rejects --with-tls without --with-nginx" {
  run bash "${INSTALLER_SH}" --with-tls
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q -- "--with-tls requires --with-nginx"
}

@test "install.sh rejects --non-interactive without --force" {
  run bash "${INSTALLER_SH}" --non-interactive
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q -- "--non-interactive also requires --force"
}

@test "install.sh rejects mutually exclusive mode flags" {
  run bash "${INSTALLER_SH}" --update --rollback
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q "mutually exclusive"
}

@test "install.sh validates --port" {
  run bash "${INSTALLER_SH}" --port abc
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q -- "--port"
}

@test "install.sh validates --domain" {
  run bash "${INSTALLER_SH}" --domain "evil; rm -rf /"
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q -- "--domain"
}

@test "install.sh validates --bootstrap-admin email" {
  run bash "${INSTALLER_SH}" --bootstrap-admin "not-an-email"
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q -- "--bootstrap-admin"
}

@test "install.sh refuses non-HTTPS PARAKO_RELEASE_MIRROR" {
  PARAKO_RELEASE_MIRROR="http://insecure.example.com" \
    run bash "${INSTALLER_SH}" --version 99.99.99 --non-interactive --force \
      --dir "${INSTALL_DIR}" --no-color
  [ "${status}" -ne 0 ]
}

@test "install.sh --help has no Unicode box-drawing characters" {
  run bash "${INSTALLER_SH}" --help
  # Box-drawing range U+2500..U+257F.
  if echo "${output}" | grep -P '[\x{2500}-\x{257F}]' >/dev/null 2>&1; then
    echo "found box-drawing characters in --help output" >&2
    return 1
  fi
}

@test "parako.sh --help exits 0" {
  run bash "${PARAKO_SH}" --help
  [ "${status}" -eq 0 ]
}

@test "parako.sh unknown verb exits 64" {
  run bash "${PARAKO_SH}" nonsense-verb
  [ "${status}" -eq 64 ]
}
