# Contributing to Parako.ID

Thank you for helping improve Parako.ID. Changes should be focused,
production-ready, covered by behavior-oriented tests, and safe for operators
who already have local runtime configuration.

## Development setup

Requirements:

- Node.js 24 or newer.
- pnpm 11 or newer.
- Git.

SQLite is the default development database and requires no database server.
MongoDB and PostgreSQL are needed only when working on those adapters or the
full test matrix. Redis is needed for workers, queues, distributed cache and
pub/sub, or Redis-backed sessions/OIDC storage.

```bash
git clone https://github.com/Dahkenangnon/Parako.ID.git
cd Parako.ID
pnpm install --frozen-lockfile
pnpm setup:dev
pnpm dev
```

`pnpm setup:dev` creates the runtime directories, generates fresh local
secrets in `runtime/.env`, copies `parako.sample.jsonc` to
`runtime/parako.jsonc`, generates the SQLite Prisma client, and applies
migrations. It never overwrites an existing environment or JSONC file.

The app listens on `http://localhost:9007`. Runtime files are local state and
must not be committed.

## Test suites

Use the narrowest relevant command while developing:

```bash
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:integration:postgresql
pnpm test:coverage
```

The default integration suite uses SQLite and ephemeral MongoDB fixtures. The
first MongoDB-backed run may download a matching `mongod` binary into the
tool's user cache. PostgreSQL RLS tests are intentionally separate and fail
when their database is unavailable.

Browser tests use Playwright with Chrome:

```bash
pnpm exec playwright install chrome
pnpm test:e2e
```

`pnpm test:e2e` runs the default SQLite/single-tenant browser profile. Select
another supported cell or feature profile with environment variables:

```bash
PARAKO_E2E_CELL=mongodb-multi \
PARAKO_E2E_PROFILE=webauthn \
pnpm test:e2e
```

Supported cells are `sqlite-single`, `mongodb-single`, `mongodb-multi`,
`postgresql-single`, and `postgresql-multi`. SQLite does not support
multi-tenancy. The feature profiles are `default`, `notification-policy`,
`phone-verification`, `security-questions`, `sms-recovery`, `social`,
`social-policy-max`, `social-policy-restricted`, and `webauthn`.

The complete local matrix requires a PostgreSQL URL whose disposable test role
can create and drop isolated databases. Never point it at production:

```bash
export PARAKO_E2E_POSTGRESQL_URL='postgresql://parako:password@127.0.0.1:5432/parako_e2e'
pnpm test:prerequisites:full
pnpm test:e2e:matrix
```

Missing prerequisites are failures, not skipped coverage.

## Quality gates

Run the normal public-repository gate before every pull request:

```bash
pnpm verify
```

It checks ESLint, Prettier, production and test TypeScript projects, the strict
production build, and all Vitest suites. When the change affects storage,
tenancy, identity flows, or browser-visible behavior, also run:

```bash
pnpm verify:all
```

`verify:all` adds prerequisite checks, PostgreSQL RLS integration tests, and
the full five-cell browser matrix. Report any gate that could not be run and
why; a focused pass is not a substitute for a required full gate.

Useful individual checks:

```bash
pnpm lint:check
pnpm format:check
pnpm typecheck
pnpm typecheck:scripts
pnpm typecheck:test
pnpm typecheck:e2e
pnpm build
```

## Test quality

- Test observable behavior through public or documented interfaces.
- Keep one clear behavior per test and use descriptive names.
- Mock external boundaries, not the code under test.
- Do not commit `.skip`, `.todo`, `.only`, generated coverage ledgers, browser
  reports, or local backup artifacts.
- Prefer deterministic fixture state and observable readiness checks over raw
  sleeps.
- Add brief comments only when a fixture, cache-busting import, protocol edge,
  or test-only seam would otherwise be surprising.

## Pull requests and commits

Create feature branches from `dev`; pull requests may target `dev` or `main`
as appropriate for the maintainer's release plan. Keep changes reviewable and
preserve unrelated work.

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(auth): add WebAuthn support
fix(oidc): preserve the interaction redirect
test(storage): cover PostgreSQL tenant isolation
docs: update local setup
```

Pull requests should explain the user-visible or operator-visible outcome,
the important design decisions, the validation performed, and remaining
risks. Include screenshots for visual changes.

## CI and releases

GitHub Actions run quality checks, storage-adapter integration coverage, and
the browser matrix on pull requests to `dev` or `main` and pushes to `main`.
Workflow actions must be pinned to immutable commit SHAs with a readable
version comment.

Releases are not created from ordinary branch pushes. Maintainers update the
version and changelog, create a matching immutable `vX.Y.Z` tag, and let the
tag workflow build, sign, and publish architecture-specific artifacts. Do not
create or move release tags as part of a normal contribution.
