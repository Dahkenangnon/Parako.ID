> [!WARNING]
> **Accès anticipé — en développement actif.** Les API et la configuration peuvent évoluer avant la v1.0.

<div align="center">

<img src="./public/images/logo-light.svg" alt="Parako.ID" width="280" />

# Parako.ID

**Votre serveur d'identité. Auto-hébergé. Gratuit.**

Serveur d'identité auto-hébergé avec SSO, MFA, passkeys et OAuth2 — zéro frais par utilisateur.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org)
[![Releases](https://img.shields.io/github/v/release/Dahkenangnon/Parako.ID?include_prereleases)](https://github.com/Dahkenangnon/Parako.ID/releases)

[Site web](https://parako.id) · [Documentation](https://docs.parako.id) · [Changelog](https://github.com/Dahkenangnon/Parako.ID/releases) · [English](./README.md)

</div>

---

Parako.ID vous donne le contrôle total sur l'authentification. Déployez sur n'importe quel VPS en quelques minutes avec SSO, authentification multifacteur, passkeys, connexion sociale et multi-tenancy intégrés. Propulsé par la bibliothèque [OpenID Certified™ node-oidc-provider](https://github.com/panva/node-oidc-provider).

> Parako.ID utilise la bibliothèque certifiée mais n'a pas lui-même subi la certification OpenID Foundation.

## Fonctionnalités

- **SSO & OAuth2/OIDC** — conformité complète aux spécifications, enregistrement dynamique de clients
- **MFA** — TOTP, codes par e-mail, WebAuthn/passkeys
- **Connexion sociale** — GitHub, Google, Facebook, LinkedIn, Microsoft
- **Multi-tenancy** — isolation des tenants avec bases partagées ou séparées
- **Sessions multi-comptes** — basculez entre les identités en toute fluidité
- **Tableau de bord d'administration** — gérez utilisateurs, clients et paramètres depuis le navigateur
- **Outils CLI** — `yarn client add`, `yarn client list`, `yarn keys generate`
- **Support systemd** — `yarn systemd install` comme alternative à PM2

## Installation

```bash
curl -sSL https://get.parako.id | sh
```

Ou manuellement :

```bash
wget https://github.com/Dahkenangnon/Parako.ID/releases/latest/download/parako-id-v*.tar.gz
tar -xzf parako-id-v*.tar.gz && cd parako-id-release
cp .env.example .env   # modifiez selon vos besoins
yarn start
```

**Prérequis :** Node.js ≥ 24, Yarn

## Développement

```bash
git clone https://github.com/Dahkenangnon/Parako.ID.git && cd Parako.ID
yarn install && cp .env.example .env
yarn db:push && yarn keys generate && yarn dev
```

Rendez-vous sur `http://localhost:9007/auth/register` pour créer votre premier compte.

## Production

SQLite convient aux petits déploiements. En production, utilisez MongoDB ou PostgreSQL avec Redis :

```bash
# .env
DATABASE_URI=mongodb://localhost:27017/parako-id
REDIS_HOST=localhost
REDIS_PORT=6379
```

Déployez avec systemd (`yarn systemd install`) ou PM2 (`pm2 start ecosystem.config.cjs`).

## Mise à jour

Pour les installations via la commande en une ligne, la mise à jour se fait en place — sauvegarde, bascule, migrations, health-check et retour arrière automatique sont tous pris en charge :

```bash
curl -sSL https://get.parako.id | bash -s -- --update
```

Épinglez une version précise : `--update --version 0.1.1`

Pour les installations depuis les sources :

```bash
git pull
yarn install
yarn db:migrate:deploy   # PostgreSQL uniquement
yarn build
yarn restart
```

## Documentation

La documentation complète est disponible sur [docs.parako.id](https://docs.parako.id) : configuration, multi-tenancy, connexion sociale, outils CLI et déploiement.

## Contribution

Les contributions sont les bienvenues. Consultez [CONTRIBUTING.md](./CONTRIBUTING.md) pour les instructions de configuration et les directives.

## Sécurité

Signalez les vulnérabilités en privé à [dah.kenangnon@gmail.com](mailto:dah.kenangnon@gmail.com). Voir [SECURITY.md](./SECURITY.md) pour notre politique de divulgation.

## Licence

[MIT](./LICENSE) © [Justin Dah-kenangnon](https://github.com/Dahkenangnon)
