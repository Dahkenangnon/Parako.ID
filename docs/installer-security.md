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
- A compromised release pipeline that bypasses cosign (the operator's `install.sh` refuses the unsigned tarball; the escape hatch `--insecure-no-signature` requires explicit reason text logged to the structured install log).

The installer does **not** protect against:

- A compromised GitHub account that has CI write permissions and can modify `release.yml` itself (the cosign identity is bound to the workflow path — if that path is rewritten, future signatures are bound to the rewritten path). Mitigation: pin the workflow file with branch protection + required reviews.
- A compromise of Sigstore or GitHub OIDC (out of scope; same trust anchor as the rest of the OSS ecosystem).
- An attacker who is already root on the target machine before the installer runs (no installer can defend against this).

## Verifying the installer itself

Each release of Parako.ID publishes the SHA256 of `install.sh` in the release notes. To verify what you're about to pipe to bash:

```bash
# Download without executing
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id -o /tmp/install.sh

# Get the expected SHA256 from the release notes
# (look for: "Native installer SHA256: <value>" in the release you selected)
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

For each Parako.ID release, the CI workflow `release.yml` signs every executable
or trust-root asset via Cosign keyless:

- each architecture-specific `parako-id-v${V}-linux-${ARCH}.tar.gz` and `.zip`
  archive → a matching `.sig` + `.pem`
- `SHA256SUMS` → `SHA256SUMS.sig` + `.pem`
- `install.sh` and `install-git.sh` → a matching `.sig` + `.pem`

The standalone per-architecture SBOM and release manifest are authenticated by
their entries in the signed `SHA256SUMS` file.

The cosign certificate identity is bound to the workflow path:

```
--certificate-identity-regexp '^https://github\.com/Dahkenangnon/Parako\.ID/\.github/workflows/release\.yml@refs/tags/v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
--certificate-oidc-issuer 'https://token.actions.githubusercontent.com'
```

This regex accepts only signatures produced by this repository's `release.yml`
workflow on a stable semantic-version tag. Branch and pull-request identities are rejected.

You can verify a Parako.ID release independently:

```bash
PARAKO_VERSION=vX.Y.Z # replace with the stable release tag you verified
PARAKO_ARTIFACT="parako-id-${PARAKO_VERSION}-linux-x64.tar.gz"
gh release download "$PARAKO_VERSION" \
  -p "$PARAKO_ARTIFACT" \
  -p "$PARAKO_ARTIFACT.sig" \
  -p "$PARAKO_ARTIFACT.pem"

cosign verify-blob \
  --signature "$PARAKO_ARTIFACT.sig" \
  --certificate "$PARAKO_ARTIFACT.pem" \
  --certificate-identity "https://github.com/Dahkenangnon/Parako.ID/.github/workflows/release.yml@refs/tags/${PARAKO_VERSION}" \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  "$PARAKO_ARTIFACT"
```

Expected output: `Verified OK`.

## The `--insecure-no-signature` escape

In the rare case where Sigstore is unreachable (network partition, Sigstore outage, regulated network), the installer offers an explicit escape:

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://get.parako.id | sudo bash -s -- \
  --update --insecure-no-signature \
  --reason "Sigstore outage on 2026-06-15; verified SHA256 manually from release notes"
```

The escape requires:

1. The exact word `--insecure-no-signature`
2. A non-empty `--reason "<text>"`
3. In interactive mode, the operator typing `yes` in full when prompted

The reason is logged verbatim to the structured install log at `/var/log/parako-install-<ts>.log` (or `${XDG_STATE_HOME}/parako/parako-install-<ts>.log` for non-root installs). Use this escape only when you have manually verified the tarball SHA256 against the release notes.

## Sensitive-value redaction

The installer writes a structured JSON-lines log at `/var/log/parako-install-${ts}.log` (or `${XDG_STATE_HOME}/parako/...` for non-root installs). Every line passes through a redactor that masks:

- URI authentication (`scheme://user:pass@host` → `scheme://***@host`)
- Any value following a key named `password`, `secret`, `token`, `credential`, `api_key`, `hmac_secret`, `jwt_secret`, `cookie_secret_N`, `encryption_key`, `pairwise_salt`

You can safely share the install log when reporting bugs.

## File permissions

Files the installer writes (mode is enforced regardless of the operator's umask):

| File                            | Mode | Owner            | Notes                                             |
| ------------------------------- | ---- | ---------------- | ------------------------------------------------- |
| `/var/log/parako-install-*.log` | 0600 | install operator | Installer's own structured log                    |
| `/usr/local/bin/parako`         | 0755 | `root:root`      | Operator helper; install is non-fatal             |
| `/usr/local/bin/cosign`         | 0755 | `root:root`      | Only if cosign bootstrap was needed               |
| `${INSTALL_DIR}/.parako-state`  | 0644 | install operator | No secrets; readable by non-root operators        |
| `${INSTALL_DIR}/.install-lock`  | 0644 | install operator | flock target for install / update / rollback / gc |

Files the installer does **not** create or modify:

| File                                              | Why                            |
| ------------------------------------------------- | ------------------------------ |
| `runtime/.env`                                    | Operator-owned secrets         |
| `runtime/jwks/jwks.json`                          | Operator-owned signing keys    |
| `runtime/parako.jsonc`, `runtime/parako-rp.jsonc` | Operator-owned config          |
| `runtime/data/parako.db`                          | Operator-owned database        |
| `/etc/systemd/system/*.service`                   | Operator-managed supervisor    |
| `/etc/nginx/sites-available/*`                    | Operator-managed reverse proxy |
| `/etc/letsencrypt/*`                              | Operator-managed TLS           |

## Network egress points

During install and update, the installer makes outbound HTTPS connections only to:

| Host                                           | Purpose                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `api.github.com`                               | Resolve latest release tag (skipped under `--offline` and when `--version` is set) |
| `github.com` / `objects.githubusercontent.com` | Release tarball + signature + certificate download                                 |
| `rekor.sigstore.dev` / `fulcio.sigstore.dev`   | Cosign transparency log + certificate authority                                    |

Under `--offline`, the installer makes no network calls and requires `--version`, `--tarball`, `--checksum`, `--signature`, `--certificate`, and a preinstalled `cosign` binary on `PATH`.

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
- [Security](security.md) — defense-in-depth at the application layer
- [parako CLI](parako-cli.md)
- [Sigstore documentation](https://docs.sigstore.dev/)
- [Aaron Maxwell — Unofficial Bash Strict Mode](http://redsymbol.net/articles/unofficial-bash-strict-mode/)
