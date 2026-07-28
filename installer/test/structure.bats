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

@test "parako.sh delegates update/rollback/gc to install.sh" {
  grep -q 'run_installer --update'   "${PARAKO_SH}"
  grep -q 'run_installer --rollback' "${PARAKO_SH}"
  grep -q 'run_installer --gc'       "${PARAKO_SH}"
}

@test "parako.sh keeps SQLite data outside immutable releases" {
  grep -Fq 'STORAGE_SQLITE_PATH "${install_dir}/runtime/data/parako.db"' "${PARAKO_SH}"
}

@test "parako.sh INSTALLER_URL is HTTPS get.parako.id (default)" {
  grep -q 'INSTALLER_URL.*https://get.parako.id' "${PARAKO_SH}"
}
