#!/usr/bin/env bats
# Hermetic lifecycle acceptance for the Git source distribution.

load helpers

setup() {
  export TEST_ROOT="${BATS_TEST_TMPDIR}/parako-git-${BATS_TEST_NUMBER}"
  export FIXTURE_REPOSITORY="${TEST_ROOT}/source"
  export INSTALL_DIR="${TEST_ROOT}/install"
  export FAKE_BIN="${TEST_ROOT}/bin"
  export PARAKO_GIT_BIN_DIR="${TEST_ROOT}/managed-bin"
  mkdir -p "${FIXTURE_REPOSITORY}/installer" "${FIXTURE_REPOSITORY}/runtime" "${FAKE_BIN}"

  cp "${PARAKO_SH}" "${FIXTURE_REPOSITORY}/installer/parako.sh"
  cp "${GIT_INSTALLER_SH}" "${FIXTURE_REPOSITORY}/installer/install-git.sh"
  chmod 0755 "${FIXTURE_REPOSITORY}/installer/"*.sh
  printf '{"name":"parako-fixture","version":"0.3.0"}\n' >"${FIXTURE_REPOSITORY}/package.json"
  printf 'fixture=true\n' >"${FIXTURE_REPOSITORY}/.env.example"

  cat >"${FAKE_BIN}/pnpm" <<'SH'
#!/usr/bin/env bash
set -Eeuo pipefail
if [ "${1:-}" = "--version" ]; then printf '11.4.0\n'; exit 0; fi
if [ "${1:-}" = "run" ] && [ "${2:-}" = "build" ]; then
  [ "${PARAKO_FIXTURE_BUILD_FAIL:-0}" = "0" ] || exit 42
  mkdir -p dist/src
  printf 'export {};\n' >dist/src/index.js
  printf 'fixture build log\n'
fi
if [ "${1:-}" = "prune" ]; then
  [[ " $* " == *" --ignore-scripts "* ]] || exit 43
fi
SH
  cat >"${FAKE_BIN}/age" <<'SH'
#!/usr/bin/env bash
exit 0
SH
  cp "${FAKE_BIN}/age" "${FAKE_BIN}/age-keygen"
  chmod 0755 "${FAKE_BIN}/pnpm" "${FAKE_BIN}/age" "${FAKE_BIN}/age-keygen"

  git -C "${FIXTURE_REPOSITORY}" init -b main
  git -C "${FIXTURE_REPOSITORY}" config user.name "Parako CI"
  git -C "${FIXTURE_REPOSITORY}" config user.email "ci@parako.invalid"
  git -C "${FIXTURE_REPOSITORY}" add .
  git -C "${FIXTURE_REPOSITORY}" commit -m "fixture: initial"
  export FIRST_COMMIT
  FIRST_COMMIT=$(git -C "${FIXTURE_REPOSITORY}" rev-parse HEAD)
}

@test "Git installer lifecycle is commit-pinned, atomic, stateful, and runtime-preserving" {
  run env PATH="${FAKE_BIN}:${PATH}" PARAKO_GIT_ALLOW_LOCAL=1 \
    bash "${GIT_INSTALLER_SH}" \
      --repository "${FIXTURE_REPOSITORY}" --ref "${FIRST_COMMIT}" \
      --dir "${INSTALL_DIR}" --owner "$(id -un)" --non-interactive
  if [ "${status}" -ne 0 ]; then
    echo "${output}"
    return 1
  fi
  [ -L "${INSTALL_DIR}/current" ]
  [ "$(readlink "${INSTALL_DIR}/current")" = "releases/git-${FIRST_COMMIT}" ]
  [ "$(readlink "${INSTALL_DIR}/current/runtime")" = "../../runtime" ]
  grep -q '^INSTALL_MODE=git$' "${INSTALL_DIR}/.parako-state"
  grep -q '^VERSION=0.3.0$' "${INSTALL_DIR}/.parako-state"
  grep -q "^GIT_COMMIT=${FIRST_COMMIT}$" "${INSTALL_DIR}/.parako-state"
  grep -q '^GIT_REPOSITORY=<local-test-repository>$' "${INSTALL_DIR}/.parako-state"
  grep -q "^PARAKO_BIN_PATH=${PARAKO_GIT_BIN_DIR}/parako$" "${INSTALL_DIR}/.parako-state"
  [ -x "${PARAKO_GIT_BIN_DIR}/parako" ]
  [ ! -w "${INSTALL_DIR}/current/package.json" ]

  printf '{"name":"parako-fixture","version":"0.3.1"}\n' >"${FIXTURE_REPOSITORY}/package.json"
  git -C "${FIXTURE_REPOSITORY}" add package.json
  git -C "${FIXTURE_REPOSITORY}" commit -m "fixture: update"
  local second_commit
  second_commit=$(git -C "${FIXTURE_REPOSITORY}" rev-parse HEAD)

  run env PATH="${FAKE_BIN}:${PATH}" PARAKO_GIT_ALLOW_LOCAL=1 PARAKO_FIXTURE_BUILD_FAIL=1 \
    bash "${GIT_INSTALLER_SH}" --update \
      --repository "${FIXTURE_REPOSITORY}" --ref "${second_commit}" \
      --dir "${INSTALL_DIR}" --owner "$(id -un)" --non-interactive
  [ "${status}" -ne 0 ]
  [ "$(readlink "${INSTALL_DIR}/current")" = "releases/git-${FIRST_COMMIT}" ]
  ! find "${INSTALL_DIR}" -maxdepth 1 -name '.staging.git.*' | grep -q .

  run env PATH="${FAKE_BIN}:${PATH}" PARAKO_GIT_ALLOW_LOCAL=1 \
    bash "${GIT_INSTALLER_SH}" --update \
      --repository "${FIXTURE_REPOSITORY}" --ref "${second_commit}" \
      --dir "${INSTALL_DIR}" --owner "$(id -un)" --non-interactive
  [ "${status}" -eq 0 ]
  [ "$(readlink "${INSTALL_DIR}/current")" = "releases/git-${second_commit}" ]
  grep -q "^PREVIOUS_RELEASE=git-${FIRST_COMMIT}$" "${INSTALL_DIR}/.parako-state"

  run env PATH="${FAKE_BIN}:${PATH}" PARAKO_GIT_ALLOW_LOCAL=1 \
    bash "${GIT_INSTALLER_SH}" --rollback \
      --dir "${INSTALL_DIR}" --owner "$(id -un)" --non-interactive
  [ "${status}" -eq 0 ]
  [ "$(readlink "${INSTALL_DIR}/current")" = "releases/git-${FIRST_COMMIT}" ]

  printf 'preserve me\n' >"${INSTALL_DIR}/runtime/operator-data"
  run env PATH="${FAKE_BIN}:${PATH}" PARAKO_GIT_ALLOW_LOCAL=1 \
    bash "${GIT_INSTALLER_SH}" --uninstall --yes \
      --dir "${INSTALL_DIR}" --owner "$(id -un)" --non-interactive
  [ "${status}" -eq 0 ]
  [ ! -e "${INSTALL_DIR}/current" ]
  [ ! -e "${PARAKO_GIT_BIN_DIR}/parako" ]
  [ -f "${INSTALL_DIR}/runtime/operator-data" ]
}
