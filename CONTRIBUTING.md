# Contributing to Parako.ID

Thank you for helping improve Parako.ID. Changes should be focused,
production-ready, covered by behavior-oriented tests, and safe for operators
who already have local runtime configuration.

## Development setup

Requirements:

- Node.js 24 or newer.
- pnpm 11 or newer.
- Git.
- GNU util-linux `script` for real-terminal CLI integration tests.
- PostgreSQL server tools (`pg_config`, `initdb`, and `pg_ctl`) for the full
  adapter matrix, unless a reachable test URL is explicitly configured.
- `redis-server` for the full test suite, unless a reachable Redis service is
  explicitly configured.

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

`pnpm setup:dev` creates the runtime directories, renders the canonical root
`.env.example` to `runtime/.env` with fresh local secrets, copies
`parako.sample.jsonc` to `runtime/parako.jsonc`, installs Chrome for
Playwright, generates the SQLite Prisma client, applies migrations, and
prepares private loopback PostgreSQL and Redis services for the test suites.
It never overwrites an existing environment, JSONC file, or explicit service
setting. If no service is configured, reusable local state is kept beneath
the ignored `runtime/data` directory. Rerunning setup restarts managed services
when needed.

Generate only `runtime/.env` without installing or starting prerequisites:

```bash
pnpm setup:env
```

The app listens on `http://localhost:9007`. Runtime files are local state and
must not be committed. Setup exits with an actionable failure when a required
executable, browser download, or configured service is unavailable.

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
when their database is unavailable. Interactive CLI process tests use GNU
util-linux `script` to provide a real pseudo-terminal; on Debian or Ubuntu it
is provided by the `util-linux` package.

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
multi-tenancy. The feature profiles are `default`, `database-configuration`,
`notification-policy`, `phone-verification`, `security-questions`,
`sms-recovery`, `social`, `social-policy-max`, `social-policy-restricted`,
`background-jobs`, `worker-drain`, `operations`, and `webauthn`.

`setup:dev` records reusable local test settings, so the complete local matrix
requires no manual exports. Never point the suite at production:

```bash
pnpm test:prerequisites:full
pnpm test:e2e:matrix
```

CI and custom environments may explicitly set `PARAKO_E2E_POSTGRESQL_URL` and
the `PARAKO_E2E_REDIS_*` variables. Shell values take precedence over
`runtime/.env`. The PostgreSQL role must be allowed to create and drop isolated
test databases.

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
bash -n installer/parako-docker.sh
bash installer/test/docker-topology-smoke.sh sqlite parako-id:test
```

The Docker topology smoke command requires a locally built image and a
reachable Docker Engine. CI runs it independently for SQLite, PostgreSQL, and
MongoDB; local runs should use a non-production Docker context.

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
