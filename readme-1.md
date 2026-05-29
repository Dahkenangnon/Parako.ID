> [!WARNING]
> **Early access — actively developed.** APIs and configuration format may change before v1.0.

<div align="center">

<img src="./public/images/logo-light.svg" alt="Parako.ID" width="200" />

# Parako.ID

Self-hosted OIDC/OAuth2 identity provider. SSO, MFA, passkeys, federation.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org)
[![Releases](https://img.shields.io/github/v/release/Dahkenangnon/Parako.ID?include_prereleases)](https://github.com/Dahkenangnon/Parako.ID/releases)

</div>

```bash
curl -sSL https://get.parako.id | sh
```

## Install

```bash
wget https://github.com/Dahkenangnon/Parako.ID/releases/latest/download/parako-id-v*.tar.gz
tar -xzf parako-id-v*.tar.gz && cd parako-id-release
cp .env.example .env && pnpm start
```

Requires Node.js ≥ 24 and pnpm ≥ 11.

## Usage

Visit `http://localhost:9007/auth/register` to create the first account, then `/admin` to manage clients and users. Integrate apps via the standard OIDC discovery URL: `http://<host>/.well-known/openid-configuration`.

## Documentation

[docs.parako.id](https://docs.parako.id)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

Report vulnerabilities privately to <dah.kenangnon@gmail.com>. See [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © [Justin Dah-kenangnon](https://github.com/Dahkenangnon)
