
> **Travail en cours : Ce projet est en développement actif. Les fonctionnalités et la documentation peuvent évoluer.**

<div align="center">

<img src="./public/images/logo-light.svg" alt="Parako.ID" width="280" />

# Parako.ID

**Votre serveur d'auth. Auto-hébergé. Gratuit.**

Serveur d'identité auto-hébergé avec SSO, MFA, passkeys et OAuth2 — zéro frais par utilisateur.

<a href="https://parako.id">Site web</a> · <a href="https://docs.parako.id">Documentation</a> · <a href="./README.md">English</a>

</div>

---

Parako.ID vous donne le contrôle total sur l'authentification. Déployez sur n'importe quel VPS en quelques minutes avec SSO, authentification multifacteur, passkeys, connexion sociale et multi-tenancy intégrés. Construit sur la bibliothèque [OpenID Certified node-oidc-provider](https://github.com/panva/node-oidc-provider).

> Parako.ID utilise la bibliothèque certifiée mais n'a pas lui-même subi la certification OpenID Foundation.

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

**Prérequis :** Node.js >= 22, Yarn

## Développer depuis les sources

```bash
git clone https://github.com/Dahkenangnon/Parako.ID.git && cd Parako.ID
yarn install && cp .env.example .env
yarn db:push && yarn keys generate && yarn dev
```

Rendez-vous sur `http://localhost:9007/auth/register` pour créer votre premier compte.

## Ce que vous obtenez

- **SSO & OAuth2/OIDC** — conformité complète, enregistrement dynamique de clients
- **MFA** — TOTP, codes par email, WebAuthn/passkeys
- **Connexion sociale** — GitHub, Google, Facebook, LinkedIn, Microsoft
- **Multi-tenancy** — isolation des tenants avec bases partagées ou séparées
- **Sessions multi-comptes** — basculez entre les identités facilement
- **Panel d'administration** — gérez utilisateurs, clients et paramètres depuis le navigateur
- **Outils CLI** — `yarn client add`, `yarn client list`, `yarn keys generate`
- **Support systemd** — `yarn systemd install` comme alternative à PM2

## Production

SQLite fonctionne pour les petits déploiements. En production, utilisez MongoDB ou PostgreSQL avec Redis :

```bash
# Configurez dans .env
DATABASE_URI=mongodb://localhost:27017/parako-id
REDIS_HOST=localhost
REDIS_PORT=6379
```

Déployez avec systemd (`yarn systemd install`) ou PM2 (`pm2 start ecosystem.config.cjs`).

## Mise à jour

Si vous avez installé via la commande en une ligne (`curl -sSL https://get.parako.id | bash`), la mise à jour se fait en place — sauvegarde, bascule, migrations, health-check et retour arrière automatique sur échec :

```bash
curl -sSL https://get.parako.id | bash -s -- --update
```

Épinglez une version précise avec `--update --version 0.1.1`. Pour une installation depuis les sources :

```bash
git pull
yarn install
yarn db:migrate:deploy   # PostgreSQL uniquement
yarn build
yarn restart
```

## Sécurité

Signalez les vulnérabilités à [dah.kenangnon@gmail.com](mailto:dah.kenangnon@gmail.com). Voir [SECURITY.md](./SECURITY.md).

## Licence

[MIT](./LICENSE)
