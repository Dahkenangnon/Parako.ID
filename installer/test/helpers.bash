#!/usr/bin/env bash
# Shared Bats helpers for installer tests.
# Loaded by every *.bats file via: load helpers

INSTALLER_DIR=${INSTALLER_DIR:-$(cd "$(dirname "${BATS_TEST_FILENAME}")/.." && pwd)}
INSTALLER_SH="${INSTALLER_DIR}/install.sh"
PARAKO_SH="${INSTALLER_DIR}/parako.sh"

assert_syntax() {
  local file=$1
  bash -n "${file}"
}

assert_strict_mode() {
  local file=$1
  grep -q '^set -Eeuo pipefail$' "${file}" || {
    echo "missing 'set -Eeuo pipefail' in ${file}" >&2
    return 1
  }
}

assert_inherit_errexit() {
  local file=$1
  grep -q 'shopt -s inherit_errexit' "${file}" || {
    echo "missing 'shopt -s inherit_errexit' in ${file}" >&2
    return 1
  }
}

assert_umask_0077() {
  local file=$1
  grep -q '^umask 077$' "${file}" || {
    echo "missing 'umask 077' in ${file}" >&2
    return 1
  }
}

assert_no_eval() {
  local file=$1
  if grep -nE '\beval\b' "${file}" | grep -v '^[^:]*:[^:]*:[[:space:]]*#'; then
    echo "found 'eval' usage in ${file}" >&2
    return 1
  fi
  return 0
}

assert_no_insecure_curl() {
  local file=$1
  if grep -nE 'curl[^|]*(-k\b|--insecure\b)' "${file}"; then
    echo "found insecure curl flag in ${file}" >&2
    return 1
  fi
  return 0
}

assert_rustup_curl_flags() {
  local file=$1
  grep -q "proto.*=https" "${file}" || {
    echo "missing curl --proto '=https' in ${file}" >&2
    return 1
  }
  grep -q "tlsv1\\.2" "${file}" || {
    echo "missing curl --tlsv1.2 in ${file}" >&2
    return 1
  }
}

assert_cosign_bootstrap() {
  local file=$1
  grep -q 'COSIGN_SHA256_LINUX_AMD64' "${file}" || {
    echo "missing COSIGN_SHA256_LINUX_AMD64 constant in ${file}" >&2
    return 1
  }
  grep -q 'COSIGN_CERT_IDENTITY_REGEX' "${file}" || {
    echo "missing COSIGN_CERT_IDENTITY_REGEX in ${file}" >&2
    return 1
  }
}

assert_traps_installed() {
  local file=$1
  grep -q 'trap on_error ERR' "${file}" || {
    echo "missing 'trap on_error ERR' in ${file}" >&2
    return 1
  }
  grep -q 'trap cleanup EXIT' "${file}" || {
    echo "missing 'trap cleanup EXIT' in ${file}" >&2
    return 1
  }
}
