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
  for flag in --version --dir --update --rollback --doctor --gc --plan --dry-run --offline --insecure-no-signature --no-bin --force --json --docker; do
    echo "${output}" | grep -q -- "${flag}" \
      || { echo "expected flag ${flag} missing from --help"; return 1; }
  done
}

@test "install.sh --help carries the responsibility statement (operator-owned scope)" {
  run bash "${INSTALLER_SH}" --help
  [ "${status}" -eq 0 ]
  echo "${output}" | grep -q "OPERATOR"
  echo "${output}" | grep -q "native systemd services"
  echo "${output}" | grep -q "Reverse proxy"
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

@test "install.sh --docker --plan is mutation-free and describes image verification" {
  run bash "${INSTALLER_SH}" --docker --dir "${INSTALL_DIR}" --plan --no-color
  [ "${status}" -eq 0 ]
  test ! -d "${INSTALL_DIR}"
  echo "${output}" | grep -q 'immutable GHCR image digest'
}

@test "install.sh rejects unsupported Docker mode combinations" {
  run bash "${INSTALLER_SH}" --docker --offline --version v0.3.5 \
    --tarball /tmp/release.tar.gz --checksum /tmp/SHA256SUMS
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q 'Docker installation does not yet support --offline image verification'

  run bash "${INSTALLER_SH}" --docker --update
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q 'parako docker update'
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

@test "piped interactive installation fails immediately with actionable guidance" {
  run timeout 2s setsid bash -c '
    source "$1"
    prompt_yn_timeout "Proceed?" no 60
  ' _ "${INSTALLER_SH}" </dev/null

  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q -- '--non-interactive --force'
}

@test "explicit non-interactive confirmation does not sleep" {
  run timeout 2s bash -c '
    source "$1"
    FLAG_NON_INTERACTIVE=1
    FLAG_FORCE=1
    RESOLVED_INSTALL_DIR="$2"
    TAG=v0.3.8
    beginning_ritual install
  ' _ "${INSTALLER_SH}" "${INSTALL_DIR}"

  [ "${status}" -eq 0 ]
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
# install-git.sh
# -----------------------------------------------------------------------------

@test "install-git.sh --help exposes the stable source-install contract" {
  run bash "${GIT_INSTALLER_SH}" --help
  [ "${status}" -eq 0 ]
  for flag in --ref --repository --dir --owner --plan --non-interactive; do
    echo "${output}" | grep -q -- "${flag}" \
      || { echo "install-git.sh --help missing flag: ${flag}"; return 1; }
  done
}

@test "install-git.sh rejects moving branch refs before any network call" {
  run bash "${GIT_INSTALLER_SH}" --ref main --owner nobody --plan
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q "stable vX.Y.Z tag or full commit SHA"
  test ! -d "${INSTALL_DIR}"
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

@test "parako.sh rejects an explicit missing install path" {
  run env PARAKO_INSTALL_DIR=/nonexistent bash "${PARAKO_SH}" version
  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q "missing install directory"
}

@test "parako.sh discovers a custom install from the user registry" {
  local state_home="${BATS_TEST_TMPDIR}/state-home"
  local custom_dir="${BATS_TEST_TMPDIR}/custom-parako"
  mkdir -p "${state_home}/parako" "${custom_dir}/releases/v0.3.8"
  printf 'INSTALL_MODE=native\nINSTALL_DIR=%s\nVERSION=v0.3.8\n' "${custom_dir}" \
    >"${custom_dir}/.parako-state"
  ln -s releases/v0.3.8 "${custom_dir}/current"
  printf '%s\n' "${custom_dir}" >"${state_home}/parako/install-dir"
  chmod 0600 "${state_home}/parako/install-dir"

  run env -u PARAKO_INSTALL_DIR XDG_STATE_HOME="${state_home}" \
    bash "${PARAKO_SH}" paths

  [ "${status}" -eq 0 ]
  echo "${output}" | grep -Fq "${custom_dir}"
}

@test "parako.sh rejects a registered path whose state disagrees" {
  local state_home="${BATS_TEST_TMPDIR}/state-home-invalid"
  local custom_dir="${BATS_TEST_TMPDIR}/custom-parako-invalid"
  mkdir -p "${state_home}/parako" "${custom_dir}"
  printf 'INSTALL_MODE=docker\nINSTALL_DIR=/different/path\nVERSION=0.3.8\n' \
    >"${custom_dir}/.parako-state"
  printf '%s\n' "${custom_dir}" >"${state_home}/parako/install-dir"
  chmod 0600 "${state_home}/parako/install-dir"

  run env -u PARAKO_INSTALL_DIR XDG_STATE_HOME="${state_home}" \
    bash "${PARAKO_SH}" paths

  [ "${status}" -ne 0 ]
  echo "${output}" | grep -q 'does not match its installer state'
}
