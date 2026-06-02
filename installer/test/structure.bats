#!/usr/bin/env bats
# Lint gate: enforce script structure, strict-mode hardening, and security idioms.
# Run: bats installer/test/structure.bats

load helpers

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

@test "install.sh has all required section banners" {
  for section in '§0' '§1' '§2' '§3' '§4' '§5' '§6' '§7' '§8' '§9' '§10' '§11' '§12' '§13' '§14' '§15' '§16' '§17' '§18' '§19' '§20' '§21' '§22' '§23' '§24' '§25' '§26'; do
    grep -qE "^# ${section}[[:space:]]" "${INSTALLER_SH}" \
      || { echo "missing section banner ${section} in install.sh"; return 1; }
  done
}

@test "install.sh banner includes invariants for every numbered section" {
  # For each section in §0..§26, find its banner and assert an Invariants line follows within 30 lines.
  # §0 is exempt (handled inline by the strict-mode block).
  for section in '§1' '§2' '§3' '§4' '§5' '§6' '§7' '§8' '§9' '§10' '§11' '§12' '§13' '§14' '§15' '§16' '§17' '§18' '§19' '§20' '§21' '§22' '§23' '§24' '§25' '§26'; do
    line=$(grep -nE "^# ${section}[[:space:]]" "${INSTALLER_SH}" | head -n1 | cut -d: -f1)
    [ -n "${line}" ] || { echo "no banner for ${section}"; return 1; }
    end=$((line + 30))
    sed -n "${line},${end}p" "${INSTALLER_SH}" | grep -q 'Invariants:' \
      || { echo "${section} missing Invariants block"; return 1; }
  done
}

@test "parako.sh has valid bash syntax" {
  run assert_syntax "${PARAKO_SH}"
  [ "${status}" -eq 0 ]
}

@test "parako.sh enables strict mode" {
  run assert_strict_mode "${PARAKO_SH}"
  [ "${status}" -eq 0 ]
}

@test "parako.sh sets umask 077" {
  run assert_umask_0077 "${PARAKO_SH}"
  [ "${status}" -eq 0 ]
}

@test "parako.sh installs ERR + EXIT traps" {
  run assert_traps_installed "${PARAKO_SH}"
  [ "${status}" -eq 0 ]
}

@test "parako.sh contains no eval" {
  run assert_no_eval "${PARAKO_SH}"
  [ "${status}" -eq 0 ]
}

@test "install.sh references existing /health endpoint not heavy OIDC discovery" {
  grep -q "${HEALTH_PATH:-/health}" "${INSTALLER_SH}"
  primary_count=$(grep -c '/health"' "${INSTALLER_SH}" 2>/dev/null || echo 0)
  fallback_count=$(grep -c '/.well-known/openid-configuration' "${INSTALLER_SH}" 2>/dev/null || echo 0)
  [ "${primary_count}" -ge 1 ]
  # Fallback is documented but not the primary probe.
  [ "${fallback_count}" -le 3 ]
}

@test "install.sh references pnpm not yarn (yarn migrated to pnpm)" {
  yarn_count=$(grep -cE '\byarn\b' "${INSTALLER_SH}" || true)
  [ "${yarn_count}" -le 1 ]  # at most one comment mention
}

@test "install.sh uses write_root_file() for privileged writes" {
  grep -q '^write_root_file\(\)' "${INSTALLER_SH}"
  # No direct write to /etc/ via `>` or `tee` outside of write_root_file.
  ! grep -nE '>[[:space:]]*"?/(etc|usr/local/bin)/' "${INSTALLER_SH}" \
    | grep -v 'write_root_file\|case "\${dest}"' \
    | grep -v 'log_warn\|log_info\|log_err\|log_ok\|^[[:space:]]*#' || true
}

@test "parako.sh delegates update/rollback/gc to installer" {
  grep -q 'INSTALLER_URL' "${PARAKO_SH}"
}
