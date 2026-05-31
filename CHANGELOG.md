# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with sections derived from Conventional Commit types (`feat` → Features, `fix` → Bug Fixes, `perf` → Performance, `refactor` → Refactor). Maintenance-only commits (`chore`, `ci`, `style`, `test`, `docs`, `build`, `revert`) are intentionally omitted from release notes — see the GitHub commit history for the full record.

Releases are cut by the maintainer with `pnpm release <patch|minor|major>` on `main`, which regenerates the section below from the git log and commits `chore(release): vX.Y.Z` locally. Pushing that commit triggers an auto-tag workflow and a CI build that attaches signed artifacts to the [GitHub Releases page](https://github.com/Dahkenangnon/Parako.ID/releases).

## [Unreleased]

## [0.1.1] - 2026-05-31

### Features

- add dual-metric brute-force protection on login ([b982fa0](https://github.com/Dahkenangnon/Parako.ID/commit/b982fa02ecafbf650bb9d096dc0f0a83dbd3d3ec))
- add /readyz probe that reports 503 during shutdown ([eb971a5](https://github.com/Dahkenangnon/Parako.ID/commit/eb971a507dbd4fd7f1178d2254e43fc42b826335))
- vendor lucide and alpine, switch bundles to iife format ([e7e7303](https://github.com/Dahkenangnon/Parako.ID/commit/e7e7303ca2b8a4085455c7e750bc64ee705cdb6e))
- add image() Nunjucks helper with lazy loading and decoding defaults ([01a04dc](https://github.com/Dahkenangnon/Parako.ID/commit/01a04dc9ecd9ed283485fd62594b873874a13ab6))
- support S3-compatible providers (R2, MinIO, B2, DO Spaces, Wasabi) ([7ab4726](https://github.com/Dahkenangnon/Parako.ID/commit/7ab47262c7e07e7da32416a83c26c2374ab24849))
- lazy-load storage adapter family at container bootstrap ([0b32b97](https://github.com/Dahkenangnon/Parako.ID/commit/0b32b9735687cc51187755c942fbf9796e0c926f))
- minimal service worker for hashed static assets ([cc8888b](https://github.com/Dahkenangnon/Parako.ID/commit/cc8888b4ea2df6385ede1a9e4f0a62f1493e1441))
- content-hashed static assets with manifest and asset() helper ([d445578](https://github.com/Dahkenangnon/Parako.ID/commit/d4455784665d712d3ba45638852ffa0060008d83))
- generate WebP, AVIF, and JPEG image variants on upload ([6ed694e](https://github.com/Dahkenangnon/Parako.ID/commit/6ed694e2ae7c3744c643bff65a5cac00ab6ff891))
- cacheable JWKS and discovery with ETag, 304, and bounded TTL ([5216acf](https://github.com/Dahkenangnon/Parako.ID/commit/5216acf372b88d5d380763a80b52e243dd3887ee))
- configurable HTTP timeouts and 1-instance PM2 defaults ([a0a8617](https://github.com/Dahkenangnon/Parako.ID/commit/a0a8617309eb260e354763315a854253a91adc24))
- realign deployment.server schema to fix CORS and trust-proxy gaps ([7fa2cf9](https://github.com/Dahkenangnon/Parako.ID/commit/7fa2cf9b5fafbd65dcaf00abecfd81697222f3f6))

### Bug Fixes

- centre sidebar avatar when collapsed by removing gap ([7c372df](https://github.com/Dahkenangnon/Parako.ID/commit/7c372df5e1e21a53fd897f2e4f8c13324cb5672c))
- enable strict CSP with helmet defaults (CodeQL #81) ([3b09bc6](https://github.com/Dahkenangnon/Parako.ID/commit/3b09bc63b8c84f452aec1d6aebf990f1fc09c0e2))
- skip rate limiter for static asset and PWA paths ([ddd2295](https://github.com/Dahkenangnon/Parako.ID/commit/ddd2295a265abc18b5b8248c06a484bbed904f90))
- replace ts-ignore in oidc ttl with typed override helper ([5dd732a](https://github.com/Dahkenangnon/Parako.ID/commit/5dd732abb58f009e8be547948749b471570443d8))
- replace weak random with crypto.randomBytes, drop shell:true, guard tty ([6d8afa1](https://github.com/Dahkenangnon/Parako.ID/commit/6d8afa1d0fd3931ed5e94b35559fe60c119f7400))
- unref background timers and route rate-limiter logs through structured logger ([eacd846](https://github.com/Dahkenangnon/Parako.ID/commit/eacd846fc24dff34f554274886bff2aaca03dcce))
- use node: protocol for built-in module imports ([3d7a69e](https://github.com/Dahkenangnon/Parako.ID/commit/3d7a69e23a4d669b25cef66bec55d7a4cbe68d62))
- log instead of swallow errors in background and best-effort paths ([bf9e53d](https://github.com/Dahkenangnon/Parako.ID/commit/bf9e53d8bbcd91269b8a417a15e9b2a10826c066))
- validate Management API v1 request bodies at the route boundary ([575028f](https://github.com/Dahkenangnon/Parako.ID/commit/575028f349844faf1fafb1d10546bbb115b41051))
- validate admin pagination, sort and search at controller boundary ([ed02aeb](https://github.com/Dahkenangnon/Parako.ID/commit/ed02aebb9e025428fa61a20b90ea8f9d3e8c95e6))
- harden HTTP transport with helmet, scoped CORS, hop-count trust proxy ([c07ced7](https://github.com/Dahkenangnon/Parako.ID/commit/c07ced7a25925d7ff46ad3a90cdce030096e919a))
- chain causes via Error { cause } in encryption and file key store ([2058da3](https://github.com/Dahkenangnon/Parako.ID/commit/2058da3a8f4aea16314ff0716a6f5e1ef043c832))
- await shutdown handlers and propagate failures through logger ([683068b](https://github.com/Dahkenangnon/Parako.ID/commit/683068b1ef20564d74b64846ed801dbc88099477))
- close residual CodeQL prototype-pollution and dispatch alerts ([8b0b4e5](https://github.com/Dahkenangnon/Parako.ID/commit/8b0b4e5b8319738e3604808b46afae537b6262a7))
- cast req.tn inline so typecheck does not rely on type hoisting ([38aa2ac](https://github.com/Dahkenangnon/Parako.ID/commit/38aa2accfe2fb35acc81b8dbfb26508281eb7821))
- restrict sort field charset in admin adapter pagination ([fd6a773](https://github.com/Dahkenangnon/Parako.ID/commit/fd6a7731e42aff59141db3f484486e57c2667b87))
- allowlist sort fields in admin activity and user list ([c9c3361](https://github.com/Dahkenangnon/Parako.ID/commit/c9c33613bcc098615dc9289fba71d2f6d87efe26))
- harden admin view rendering and entity dispatch against unsafe keys ([283bbb5](https://github.com/Dahkenangnon/Parako.ID/commit/283bbb5c1a0d0aac85f279bd75d7acf509603933))
- loop comment-stripping until stable to close incomplete sanitization ([5a7fe7a](https://github.com/Dahkenangnon/Parako.ID/commit/5a7fe7a15f4a225ea97e046c2105488ab1525d15))
- set webauthn status text via textContent; encode locale switch ([5b10e82](https://github.com/Dahkenangnon/Parako.ID/commit/5b10e82f7ebda36e5b6a821e01be65ec52816f57))
- collapse template-file checks into single fs.readFileSync ([ff75d35](https://github.com/Dahkenangnon/Parako.ID/commit/ff75d359cf81ab7c5fc95ef349ef30c94edc7386))
- route logout/validation redirects through redirect authority ([cd82a93](https://github.com/Dahkenangnon/Parako.ID/commit/cd82a939bfe9f8405c9989ecee25707d09d3af61))
- block prototype pollution in mergeConfig ([1fdd71b](https://github.com/Dahkenangnon/Parako.ID/commit/1fdd71bc58846e332e2d899d8b0cda0cb3d423d2))
- type-guard adapter inputs against NoSQL injection ([eb60da9](https://github.com/Dahkenangnon/Parako.ID/commit/eb60da98589e7be82f3475db963e16305decb4f6))
- reject array params in signed-url and recovery-disable handlers ([e440c05](https://github.com/Dahkenangnon/Parako.ID/commit/e440c05bc8626f528a734e3270abc34d209907ea))
- narrow tenant status filter to TenantStatus ([1e025fd](https://github.com/Dahkenangnon/Parako.ID/commit/1e025fdf18cdbbc1384090494bc7eca3025b7684))

### Performance

- switch local storage provider to async fs ([14ac98c](https://github.com/Dahkenangnon/Parako.ID/commit/14ac98cd094da38112532cfeb15b3cbe3c6fd729))
- lazy-load storage provider module at container bootstrap ([f79ccc7](https://github.com/Dahkenangnon/Parako.ID/commit/f79ccc7958dadf3cd55d9d4639be8711c8f84651))
- defer twilio SDK import to first SMS send ([a49c255](https://github.com/Dahkenangnon/Parako.ID/commit/a49c255f7d572c761a031d2466259765b09041c6))
- serve precompressed .br and .gz static assets ([3984801](https://github.com/Dahkenangnon/Parako.ID/commit/39848010e776626e87297d305b27225051e20540))
- negotiate Brotli, skip HTML compression for BREACH, scope Vary header ([d6948b4](https://github.com/Dahkenangnon/Parako.ID/commit/d6948b406999ab9ecece80e821beb6714b5c7ff5))

### Refactor

- replace semantic-release with hand-rolled scripts and auto-tag workflow ([cd46b3c](https://github.com/Dahkenangnon/Parako.ID/commit/cd46b3c857a9b23e7df9c3b0d976d1d616e1ca65))
- extract shared route helpers, migrate validation to Zod, and unify runtime layout ([77d885f](https://github.com/Dahkenangnon/Parako.ID/commit/77d885fa638b5af1c45da94cfdf96a0bf0311504))
- consolidate file config to JSONC and relocate uploads under runtime/ ([d99728d](https://github.com/Dahkenangnon/Parako.ID/commit/d99728d3aabff8bdb01e2a9f67c78c6760ed1207))
- route non-DI loggers through a shared pino instance ([1319847](https://github.com/Dahkenangnon/Parako.ID/commit/131984765449eea5bc4ca3c5c4b53b3e4e79dda1))
- extract inline admin scripts to external modules ([aa955e7](https://github.com/Dahkenangnon/Parako.ID/commit/aa955e790418a6e111b50826e3dc687f7790e85f))
