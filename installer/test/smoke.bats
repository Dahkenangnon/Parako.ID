#!/usr/bin/env bats
# Smoke tests for install.sh: argparse, --help, --plan, mutually-exclusive modes.
# Run: bats installer/test/smoke.bats
# CI: .github/workflows/installer-ci.yml exercises the full fixture-tarball flow.

load helpers

setup() {
  export INSTALL_DIR="/tmp/parako-smoke-$$-${BATS_TEST_NUMBER}"
  rm -rf "${INSTALL_DIR}" 2>/dev/null || true
}

teardown() {
  rm -rf "${INSTALL_DIR}" 2>/dev/null || true
}

@test "install.sh --help exits 0 and includes the version line" {
  run bash "${INSTALLER_SH}" --help
  [ "${status}" -eq 0 ]
  echo "${output}" | grep -q "Parako.ID installer v0.3.0"
}

@test "install.sh --help advertises only the surviving flags" {
  run bash "${INSTALLER_SH}" --help
  [ "${status}" -eq 0 ]
  for flag in --version --dir --update --rollback --doctor --gc --plan --dry-run --offline --insecure-no-signature --no-bin --force --json; do
    echo "${output}" | grep -q -- "${flag}" \
      || { echo "expected flag ${flag} missing from --help"; return 1; }
  done
}

@test "install.sh --help carries the responsibility statement (operator-owned scope)" {
  run bash "${INSTALLER_SH}" --help
  [ "${status}" -eq 0 ]
  echo "${output}" | grep -q "OPERATOR"
  echo "${output}" | grep -q "service lifecycle"
  echo "${output}" | grep -q "reverse proxy"
}

@test "install.sh --plan does NOT create INSTALL_DIR" {
  run bash "${INSTALLER_SH}" --dir "${INSTALL_DIR}" --plan --no-color
  [ "${status}" -eq 0 ]
  test ! -d "${INSTALL_DIR}"
}

@test "install.sh --plan does NOT make network calls (offline machines pass)" {
  # Run with all network commands shadowed to false; --plan must still succeed.
  run env PATH="/tmp/no-net-$$:${PATH}" bash "${INSTALLER_SH}" --dir "${INSTALL_DIR}" --plan --no-color
  [ "${status}" -eq 0 ]
}

@test "install.sh rejects --insecure-no-signature without --reason" {
  run bash "${INSTALLER_SH}" --insecure-no-signature
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q -- "--insecure-no-signature requires --reason"
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

@test "install.sh validates --keep as integer" {
  run bash "${INSTALLER_SH}" --keep notanumber
  [ "${status}" -ne 0 ]
}

@test "install.sh validates --dir against shell metacharacters" {
  run bash "${INSTALLER_SH}" --dir "/tmp/evil; rm -rf /"
  [ "${status}" -ne 0 ]
}

@test "install.sh --doctor on missing install dir surfaces the gap" {
  run bash "${INSTALLER_SH}" --doctor --dir "${INSTALL_DIR}" --no-color
  [ "${status}" -eq 0 ] || [ "${status}" -eq 2 ]
  # Doctor should mention the install dir was not present.
  echo "${output}" | grep -q "Install dir"
}

@test "install.sh --gc on missing releases/ exits non-zero" {
  mkdir -p "${INSTALL_DIR}"
  run bash "${INSTALLER_SH}" --gc --dir "${INSTALL_DIR}" --no-color
  [ "${status}" -ne 0 ]
}

@test "install.sh --help has no Unicode box-drawing characters" {
  run bash "${INSTALLER_SH}" --help
  [ "${status}" -eq 0 ]
  if echo "${output}" | grep -P '[\x{2500}-\x{257F}]' >/dev/null 2>&1; then
    echo "found box-drawing characters in --help output" >&2
    return 1
  fi
}

# -----------------------------------------------------------------------------
# parako.sh
# -----------------------------------------------------------------------------

@test "parako.sh --help exits 0 and lists the surviving verbs" {
  run bash "${PARAKO_SH}" --help
  [ "${status}" -eq 0 ]
  for verb in version paths config db admin backup restore service deploy health diag doctor update rollback gc; do
    echo "${output}" | grep -q -E "^[[:space:]]+${verb}\\b" \
      || { echo "parako.sh --help missing verb: ${verb}"; return 1; }
  done
}

@test "parako.sh unknown verb exits 2 and prints help" {
  run bash "${PARAKO_SH}" nonsense-verb
  [ "${status}" -eq 2 ]
  echo "${output}" | grep -q "Usage:"
}

@test "parako.sh version runs without an install" {
  run env PARAKO_INSTALL_DIR=/nonexistent bash "${PARAKO_SH}" version
  [ "${status}" -eq 0 ]
  echo "${output}" | grep -q "parako helper"
}
