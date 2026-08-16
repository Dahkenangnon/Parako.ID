#!/usr/bin/env bats
# Lint gate: enforce script structure, strict-mode hardening, and security idioms.
# Run: bats installer/test/structure.bats

load helpers

# -----------------------------------------------------------------------------
# install.sh — strict-mode + safety
# -----------------------------------------------------------------------------

@test "install.sh has valid bash syntax" {
  run assert_syntax "${INSTALLER_SH}"
  [ "${status}" -eq 0 ]
}

@test "install.sh enables strict mode" {
  run assert_strict_mode "${INSTALLER_SH}"
  [ "${status}" -eq 0 ]
}

@test "install.sh sets inherit_errexit" {
  run assert_inherit_errexit "${INSTALLER_SH}"
  [ "${status}" -eq 0 ]
}

@test "install.sh sets umask 077" {
  run assert_umask_0077 "${INSTALLER_SH}"
  [ "${status}" -eq 0 ]
}

@test "install.sh installs ERR + EXIT traps" {
  run assert_traps_installed "${INSTALLER_SH}"
  [ "${status}" -eq 0 ]
}

@test "install.sh contains no eval" {
  run assert_no_eval "${INSTALLER_SH}"
  [ "${status}" -eq 0 ]
}

@test "install.sh contains no insecure curl flags" {
  run assert_no_insecure_curl "${INSTALLER_SH}"
  [ "${status}" -eq 0 ]
}

@test "install.sh uses rustup curl pattern (--proto '=https' --tlsv1.2)" {
  run assert_rustup_curl_flags "${INSTALLER_SH}"
  [ "${status}" -eq 0 ]
}

@test "install.sh has cosign bootstrap chain-of-trust" {
  run assert_cosign_bootstrap "${INSTALLER_SH}"
  [ "${status}" -eq 0 ]
}

# -----------------------------------------------------------------------------
# install.sh — verified release deployer (functions that MUST exist)
# -----------------------------------------------------------------------------

@test "install.sh defines install_main" {
  grep -qE '^install_main\(\)' "${INSTALLER_SH}"
}

@test "install.sh defines the verified Docker installer path" {
  for fn in docker_install_main resolve_verified_docker_image write_docker_install_state; do
    grep -qE "^${fn}\(\)" "${INSTALLER_SH}" \
      || { echo "missing ${fn} in install.sh"; return 1; }
  done
  grep -q -- '--docker' "${INSTALLER_SH}"
}

@test "install.sh defines update_main" {
  grep -qE '^update_main\(\)' "${INSTALLER_SH}"
}

@test "install.sh defines rollback_main" {
  grep -qE '^rollback_main\(\)' "${INSTALLER_SH}"
}

@test "install.sh defines doctor_main" {
  grep -qE '^doctor_main\(\)' "${INSTALLER_SH}"
}

@test "install.sh defines gc_main" {
  grep -qE '^gc_main\(\)' "${INSTALLER_SH}"
}

@test "install.sh defines plan_main" {
  grep -qE '^plan_main\(\)' "${INSTALLER_SH}"
}

@test "install.sh defines verify_release_signature" {
  grep -qE '^verify_release_signature\(\)' "${INSTALLER_SH}"
}

@test "install.sh defines write_root_file for privileged writes" {
  grep -qE '^write_root_file\(\)' "${INSTALLER_SH}"
}

@test "install.sh defines write_parako_state" {
  grep -qE '^write_parako_state\(\)' "${INSTALLER_SH}"
}

@test "install.sh validates architecture-bound release manifests" {
  grep -qE '^release_architecture\(\)' "${INSTALLER_SH}"
  grep -qE '^validate_staged_release\(\)' "${INSTALLER_SH}"
  grep -q 'release-manifest.json' "${INSTALLER_SH}"
}

# -----------------------------------------------------------------------------
# install.sh — minimal-deployer scope (functions that MUST NOT exist)
# -----------------------------------------------------------------------------

@test "install.sh does NOT define setup_nginx" {
  ! grep -qE '^setup_nginx\(\)' "${INSTALLER_SH}"
}

@test "install.sh does NOT define setup_tls" {
  ! grep -qE '^setup_tls\(\)' "${INSTALLER_SH}"
}

@test "install.sh does NOT define setup_systemd" {
  ! grep -qE '^setup_systemd\(\)' "${INSTALLER_SH}"
}

@test "install.sh does NOT define run_db_migrations" {
  ! grep -qE '^run_db_migrations\(\)' "${INSTALLER_SH}"
}

@test "install.sh does NOT define backup_db_before_update" {
  ! grep -qE '^backup_db_before_update\(\)' "${INSTALLER_SH}"
}

@test "install.sh does NOT define start_application" {
  ! grep -qE '^start_application\(\)' "${INSTALLER_SH}"
}

@test "install.sh does NOT define install_dependencies" {
  ! grep -qE '^install_dependencies\(\)' "${INSTALLER_SH}"
}

@test "install.sh does NOT define generate_env_file" {
  ! grep -qE '^generate_env_file\(\)' "${INSTALLER_SH}"
}

@test "install.sh does NOT define validate_mongodb / validate_postgresql / validate_redis" {
  ! grep -qE '^validate_(mongodb|postgresql|redis)\(\)' "${INSTALLER_SH}"
}

@test "install.sh does NOT define demo_main" {
  ! grep -qE '^demo_main\(\)' "${INSTALLER_SH}"
}

@test "install.sh does NOT define maybe_generate_bootstrap_password" {
  ! grep -qE '^maybe_generate_bootstrap_password\(\)' "${INSTALLER_SH}"
}

# -----------------------------------------------------------------------------
# install.sh — minimal-deployer scope (flags that MUST NOT exist)
# -----------------------------------------------------------------------------

@test "install.sh does not advertise --with-nginx / --with-tls / --tls-email" {
  ! grep -qE -- '--with-nginx|--with-tls|--tls-email' "${INSTALLER_SH}"
}

@test "install.sh does not advertise --bootstrap-admin" {
  ! grep -qE -- '--bootstrap-admin' "${INSTALLER_SH}"
}

@test "install.sh does not advertise --multi-tenant" {
  ! grep -qE -- '--multi-tenant' "${INSTALLER_SH}"
}

@test "install.sh does not advertise --migrate-back" {
  ! grep -qE -- '--migrate-back' "${INSTALLER_SH}"
}

# -----------------------------------------------------------------------------
# install.sh — mode + atomic-swap requirements
# -----------------------------------------------------------------------------

@test "install.sh enforces preflight OS/arch check" {
  grep -qE '^check_os_arch\(\)' "${INSTALLER_SH}"
  grep -qF 'debian:12|debian:13|ubuntu:24.04|ubuntu:26.04' "${INSTALLER_SH}"
}

@test "install.sh checks for GNU mv -T support" {
  grep -qE '^check_coreutils\(\)' "${INSTALLER_SH}"
}

@test "install.sh checks for util-linux flock" {
  grep -qE '^check_flock\(\)' "${INSTALLER_SH}"
}

@test "install.sh uses mv -T for atomic pointer swap" {
  grep -q 'mv -Tf' "${INSTALLER_SH}"
}

@test "install.sh stages extraction into .staging.\$\$ before promotion" {
  grep -qF '.staging.${TAG}.$$' "${INSTALLER_SH}"
}

@test "install.sh uses unique temp symlinks (current.tmp.\$\$)" {
  grep -qF 'current.tmp.$$' "${INSTALLER_SH}"
}

@test "install.sh acquires flock around mutating modes" {
  grep -qE '^acquire_lock\(\)' "${INSTALLER_SH}"
  grep -q 'flock --nonblock --exclusive 9' "${INSTALLER_SH}"
}

@test "Docker operator module has valid syntax and a fixed signing trust policy" {
  run assert_syntax "${PARAKO_DOCKER_SH}"
  [ "${status}" -eq 0 ]
  run assert_no_eval "${PARAKO_DOCKER_SH}"
  [ "${status}" -eq 0 ]
  grep -q "^readonly PARAKO_DOCKER_REPOSITORY='ghcr.io/dahkenangnon/parako-id'" \
    "${PARAKO_DOCKER_SH}"
  grep -q "^readonly PARAKO_COSIGN_OIDC_ISSUER='https://token.actions.githubusercontent.com'" \
    "${PARAKO_DOCKER_SH}"
  ! grep -Fq 'PARAKO_DOCKER_REPOSITORY=${' "${PARAKO_DOCKER_SH}"
}

# -----------------------------------------------------------------------------
# parako.sh — strict mode + production lifecycle surface
# -----------------------------------------------------------------------------

@test "parako.sh has valid bash syntax" {
  run assert_syntax "${PARAKO_SH}"
  [ "${status}" -eq 0 ]
}

@test "parako.sh enables strict mode" {
  run assert_strict_mode "${PARAKO_SH}"
  [ "${status}" -eq 0 ]
}

@test "parako.sh contains no eval" {
  run assert_no_eval "${PARAKO_SH}"
  [ "${status}" -eq 0 ]
}

@test "parako.sh defines release, config, DB, backup, service, and health commands" {
  for verb in cmd_version cmd_paths cmd_doctor cmd_update cmd_rollback cmd_gc cmd_config cmd_db cmd_backup cmd_restore cmd_service cmd_health cmd_diag cmd_deploy cmd_admin; do
    grep -qE "^${verb}\\(\\)" "${PARAKO_SH}" \
      || { echo "missing ${verb} in parako.sh"; return 1; }
  done
}

@test "parako.sh keeps reverse proxy and TLS out of scope" {
  ! grep -qE '^cmd_(nginx|proxy|tls|certbot)\(\)' "${PARAKO_SH}"
}

@test "parako.sh requires encrypted backups before updates" {
  sed -n '/^cmd_update() {/,/^}/p' "${PARAKO_SH}" | grep -q 'cmd_backup'
}

@test "parako.sh exposes one-time administrator activation" {
  grep -q 'run_bundled_cli admin bootstrap' "${PARAKO_SH}"
}

@test "parako.sh delegates update/rollback/gc through the recorded distribution mode" {
  grep -q 'run_distribution_installer --update'   "${PARAKO_SH}"
  grep -q 'run_distribution_installer --rollback' "${PARAKO_SH}"
  grep -q 'run_distribution_installer --gc'       "${PARAKO_SH}"
}

@test "parako.sh keeps SQLite data outside immutable releases" {
  grep -Fq 'STORAGE_SQLITE_PATH "${install_dir}/runtime/data/parako.db"' "${PARAKO_SH}"
}

@test "parako.sh INSTALLER_URL is HTTPS get.parako.id (default)" {
  grep -q 'INSTALLER_URL.*https://get.parako.id' "${PARAKO_SH}"
}

@test "install-git.sh has strict shell safety" {
  run assert_syntax "${GIT_INSTALLER_SH}"
  [ "${status}" -eq 0 ]
  run assert_strict_mode "${GIT_INSTALLER_SH}"
  [ "${status}" -eq 0 ]
  run assert_inherit_errexit "${GIT_INSTALLER_SH}"
  [ "${status}" -eq 0 ]
  run assert_umask_0077 "${GIT_INSTALLER_SH}"
  [ "${status}" -eq 0 ]
  run assert_no_eval "${GIT_INSTALLER_SH}"
  [ "${status}" -eq 0 ]
}

@test "install-git.sh permits only stable tags or full commit SHAs" {
  grep -q 'stable vX.Y.Z tag or full commit SHA' "${GIT_INSTALLER_SH}"
  grep -q '\[0-9a-fA-F\]{40}' "${GIT_INSTALLER_SH}"
  ! grep -q 'git checkout' "${GIT_INSTALLER_SH}"
}

@test "install-git.sh uses pinned immutable build and activation gates" {
  for fn in sync_mirror resolve_commit build_release activate_release write_state; do
    grep -qE "^${fn}\\(\\)" "${GIT_INSTALLER_SH}" \
      || { echo "missing ${fn}"; return 1; }
  done
  grep -q 'git --git-dir=.* archive' "${GIT_INSTALLER_SH}"
  grep -q 'pnpm install --frozen-lockfile' "${GIT_INSTALLER_SH}"
  grep -q 'pnpm audit --prod --audit-level high' "${GIT_INSTALLER_SH}"
  grep -q 'pnpm run build' "${GIT_INSTALLER_SH}"
  grep -q 'pnpm prune --prod' "${GIT_INSTALLER_SH}"
  grep -q 'mv -Tf' "${GIT_INSTALLER_SH}"
}

@test "install-git.sh keeps mirror access unprivileged and rejects tag rewrites" {
  local mirror_functions
  mirror_functions=$(sed -n "/^sync_mirror() {/,/^}/p; /^resolve_commit() {/,/^}/p" "${GIT_INSTALLER_SH}")
  ! grep -qE "^[[:space:]]+git --git-dir" <<<"${mirror_functions}"
  grep -q "chown.*INSTALL_DIR}/runtime" "${GIT_INSTALLER_SH}"
  grep -Fq "refs/tags/*:refs/tags/*" "${GIT_INSTALLER_SH}"
  ! grep -Fq "+refs/tags/*:refs/tags/*" "${GIT_INSTALLER_SH}"
}

@test "both installers persist an explicit distribution mode" {
  grep -q "INSTALL_MODE=native" "${INSTALLER_SH}"
  grep -q "INSTALL_MODE=git" "${GIT_INSTALLER_SH}"
}
