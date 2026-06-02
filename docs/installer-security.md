---
title: 'Installer security'
subtitle: 'Threat model, cosign chain-of-trust, and how to verify the installer itself'
category: 'DevOps'
order: 5
---

The Parako.ID installer is a 3000-line bash script that runs with root privileges (for system-wide installs). Identity providers are crown-jewel systems — compromise means full identity compromise of every relying party. This page documents the installer's threat model and the trust chain that lets you verify, byte for byte, that the script you piped to `bash` is the one the maintainer published.

## Trust chain summary

| Artifact                       | Verified against                       | Mechanism                                                                |
| ------------------------------ | -------------------------------------- | ------------------------------------------------------------------------ |
| `install.sh` itself            | Maintainer-published SHA256            | `sha256sum install.sh` compared to the value in the GitHub Release notes |
| Release tarball                | SHA256SUMS                             | `sha256sum`                                                              |
| Release tarball                | Sigstore transparency log              | `cosign verify-blob` with identity bound to `release.yml`                |
| Cosign binary (auto-installed) | Inline SHA256 constant in `install.sh` | First-time chain-of-trust bootstrap                                      |

## Threat model

The installer assumes:

1. **TLS is intact** between the operator and `get.parako.id` and between the operator and GitHub.
2. **The Sigstore transparency log is intact** at `https://rekor.sigstore.dev`.
3. **GitHub's OIDC identity service is intact** at `https://token.actions.githubusercontent.com`.

Under these assumptions, the installer protects against:

- A compromised release tarball published to GitHub Releases (cosign + Sigstore catches a tarball that wasn't built by the `release.yml` workflow on `main`).
- An MITM attack on the tarball download path (TLS 1.2+ enforced; HTTP downloads refused).
- An MITM attack on the mirror download path (TLS 1.2+ enforced; non-HTTPS mirror URLs are refused).
- A maintainer who tries to push a release outside CI (cosign-binding to `release.yml` means manually-built tarballs cannot pass verification).
- A compromised release pipeline that bypasses cosign (the operator's `install.sh` would refuse the unsigned tarball; the escape hatch `--insecure-no-signature` requires explicit reason text logged to `INSTALL_NOTES.md`).

The installer does **not** protect against:

- A compromised GitHub account that has CI write permissions and can modify `release.yml` itself (the cosign identity is bound to the workflow path — if that path is rewritten, future signatures are bound to the rewritten path). Mitigation: pin the workflow file with branch protection + required reviews.
- A compromise of Sigstore or GitHub OIDC (out of scope; same trust anchor as the rest of the OSS ecosystem).
- An attacker who is already root on the target machine before the installer runs (no installer can defend against this).

## Verifying the installer itself

Each release of Parako.ID publishes the SHA256 of `install.sh` in the release notes. To verify what you're about to pipe to bash:

```bash
# Download without executing
curl -sSL https://get.parako.id -o /tmp/install.sh

# Get the expected SHA256 from the release notes
# (look for: "Installer SHA256: <value>" in the v0.2.0 release on GitHub)
EXPECTED="<value from release notes>"

# Compare
ACTUAL=$(sha256sum /tmp/install.sh | awk '{print $1}')
[ "$ACTUAL" = "$EXPECTED" ] && echo "verified" || echo "MISMATCH — DO NOT RUN"

# If verified, run from disk
bash /tmp/install.sh --help
```

This single check pins the entire installer to a known-good byte sequence. If it matches, the rest of the trust chain (cosign for the release tarball) is bootstrapped from that.

## Cosign chain-of-trust bootstrap

The installer must verify a cosign-signed release tarball, but cosign itself may not be installed on a fresh box. The chain-of-trust pattern is:

1. **Inline constants in `install.sh`**:
   ```bash
   COSIGN_VERSION=2.4.1
   COSIGN_SHA256_LINUX_AMD64=<sha256 of the official cosign-linux-amd64 binary>
   COSIGN_SHA256_LINUX_ARM64=<sha256 of the official cosign-linux-arm64 binary>
   ```
2. **Bootstrap fetch**: if `cosign` isn't in `PATH`, the installer downloads `https://github.com/sigstore/cosign/releases/download/v${COSIGN_VERSION}/cosign-linux-${arch}` and computes its SHA256.
3. **Verify**: the SHA256 must match the inlined constant exactly. Mismatch → hard fail.
4. **Install**: the verified cosign binary is installed to `/usr/local/bin/cosign` (or `~/.local/bin/cosign` for user installs).
5. **Use**: the verified cosign is then used to verify the Parako.ID release tarball against Sigstore.

The trust root of this chain is the inlined SHA256 constant. **When the maintainer bumps `COSIGN_VERSION`, the constants must be updated in lockstep** — see [Maintainer procedure](#maintainer-procedure) below.

## Release verification

For each Parako.ID release v0.2.0+, the CI workflow `release.yml` signs three artifacts via cosign keyless:

- `parako-id-v${V}.tar.gz` → `parako-id-v${V}.tar.gz.sig` + `.pem`
- `parako-id-v${V}.zip` → `parako-id-v${V}.zip.sig` + `.pem`
- `SHA256SUMS` → `SHA256SUMS.sig` + `.pem`

The cosign certificate identity is bound to the workflow path:

```
--certificate-identity-regexp 'https://github\.com/Dahkenangnon/Parako\.ID/\.github/workflows/release\.yml@.*'
--certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
```

This regex means: only signatures produced by the `release.yml` workflow in the Parako.ID repo (on any branch/tag) verify. A signature from any other workflow, or any other repo, is rejected.

You can verify a Parako.ID release independently:

```bash
gh release download v0.2.0 \
  -p 'parako-id-v0.2.0.tar.gz' \
  -p 'parako-id-v0.2.0.tar.gz.sig' \
  -p 'parako-id-v0.2.0.tar.gz.pem'

cosign verify-blob \
  --signature parako-id-v0.2.0.tar.gz.sig \
  --certificate parako-id-v0.2.0.tar.gz.pem \
  --certificate-identity-regexp 'https://github\.com/Dahkenangnon/Parako\.ID/\.github/workflows/release\.yml@.*' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  parako-id-v0.2.0.tar.gz
```

Expected output: `Verified OK`.

## The `--insecure-no-signature` escape

In the rare case where Sigstore is unreachable (network partition, Sigstore outage, regulated network), the installer offers an explicit escape:

```bash
curl -sSL https://get.parako.id | sudo bash -s -- \
  --update --insecure-no-signature \
  --reason "Sigstore outage on 2026-06-15; verified SHA256 manually from release notes"
```

The escape requires:

1. The exact word `--insecure-no-signature`
2. A non-empty `--reason "<text>"`
3. In interactive mode, the operator typing `yes` in full when prompted

The reason is logged verbatim to `INSTALL_NOTES.md` and to the structured install log. Use this only when you've manually verified the tarball SHA256 by another means.

## Sensitive-value redaction

Three places persist data about the install:

1. `INSTALL_NOTES.md` — every wizard answer + selected flags + version
2. `/var/log/parako-install-${ts}.log` — JSON-lines structured log of every step
3. `parako diag` archive — bug-report bundle

All three pass every line through a redactor that masks:

- URI authentication (`scheme://user:pass@host` → `scheme://***@host`)
- Any value following a key named `password`, `secret`, `token`, `credential`, `api_key`, `hmac_secret`, `jwt_secret`, `cookie_secret_N`, `encryption_key`, `pairwise_salt`

You can safely share `INSTALL_NOTES.md` and the install log when reporting bugs.

## File permissions

| File                                     | Mode | Owner            |
| ---------------------------------------- | ---- | ---------------- |
| `runtime/.env`                           | 0600 | `parako:parako`  |
| `runtime/INSTALL_NOTES.md`               | 0600 | `parako:parako`  |
| `runtime/jwks/jwks.json`                 | 0600 | `parako:parako`  |
| `runtime/data/parako.db`                 | 0600 | `parako:parako`  |
| `/var/log/parako-install-*.log`          | 0600 | install operator |
| `/etc/systemd/system/parako-id*.service` | 0644 | `root:root`      |
| `/etc/nginx/sites-available/parako-id`   | 0644 | `root:root`      |
| `/usr/local/bin/parako`                  | 0755 | `root:root`      |
| `/usr/local/bin/cosign`                  | 0755 | `root:root`      |
| `${INSTALL_DIR}/.parako-state`           | 0600 | `parako:parako`  |
| `${INSTALL_DIR}/.supervisor`             | 0644 | `parako:parako`  |

The installer enforces these regardless of the operator's umask.

## systemd hardening

The installed systemd units (generated by [`scripts/manage/systemd/generate.ts`](https://github.com/Dahkenangnon/Parako.ID/tree/main/scripts/manage/systemd/generate.ts)) include:

```ini
NoNewPrivileges=yes
ProtectSystem=strict
PrivateTmp=yes
ReadWritePaths=${INSTALL_DIR}
```

The `parako` system user runs all Parako.ID processes. Never root.

Additional hardening directives (`ProtectHome=yes`, `LockPersonality=yes`, `RestrictRealtime=yes`, `RestrictSUIDSGID=yes`, `SystemCallFilter=@system-service`, `CapabilityBoundingSet=`) are tracked for a future release; they require validation against Node.js's JIT and native-module footprint before being enabled by default. `MemoryDenyWriteExecute=yes` is intentionally excluded — it is incompatible with the V8 JIT.

## Network egress points

During install and update, the installer makes outbound HTTPS connections only to:

| Host                            | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `api.github.com`                | Resolve latest release tag                         |
| `github.com`                    | Download release tarball + signature + certificate |
| `objects.githubusercontent.com` | Release artifact CDN                               |
| `rekor.sigstore.dev`            | Cosign transparency log verification               |
| `fulcio.sigstore.dev`           | Cosign certificate authority                       |
| `time.cloudflare.com`           | NTP-style time skew check (Date: header only)      |

When `PARAKO_RELEASE_MIRROR` is set, the mirror URL is added to this list (and validated against an allowlist or explicit operator confirmation).

No telemetry. The installer does not phone home.

## Maintainer procedure

### Updating cosign bootstrap constants

When the cosign release version is bumped:

1. Download the new `cosign-linux-amd64` and `cosign-linux-arm64` binaries from `https://github.com/sigstore/cosign/releases/tag/v${NEW_VERSION}`.
2. Compute their SHA256 sums.
3. Update `COSIGN_VERSION`, `COSIGN_SHA256_LINUX_AMD64`, `COSIGN_SHA256_LINUX_ARM64` in `installer/install.sh:§1`.
4. Update the cosign-installer step in `.github/workflows/release.yml` to the matching version.
5. Test against the test VPS (fresh install + `--update`).

### Publishing the installer SHA256

After each release, publish the SHA256 of `installer/install.sh` in the GitHub release notes so operators can verify the installer before piping to bash:

```bash
sha256sum installer/install.sh
```

### Rotating cosign keys

Sigstore keyless signing does not use long-lived keys, so there's no key rotation per se. The trust anchor is the workflow path. To revoke trust:

1. Update `COSIGN_CERT_IDENTITY_REGEX` in `installer/install.sh` to a regex that excludes the bad commit range.
2. Publish a security advisory.

## See also

- [Installer](installer.md)
- [parako CLI](parako-cli.md)
- [Sigstore documentation](https://docs.sigstore.dev/)
- [Aaron Maxwell — Unofficial Bash Strict Mode](http://redsymbol.net/articles/unofficial-bash-strict-mode/)
