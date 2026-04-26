# Contributing to Parako.ID

## Quick Start

### Prerequisites

- **Node.js** 24+ and **Yarn**
- **MongoDB** (local or remote)
- **Redis** (local or remote)\*\*\*\*

### Local Development Setup

```bash
# Clone and setup
git clone https://github.com/Dahkenangnon/Parako.ID.git
cd id
yarn install
yarn parako setup
yarn dev
```

## 🛠️ Development Tools

This project uses these development tools for quality assurance:

### Code Quality & Formatting

- **ESLint** - Code linting and style enforcement
- **Prettier** - Automatic code formatting
- **Husky** - Git hooks for quality gates

### Testing & Coverage

- **Vitest** - Modern testing framework
- **V8 Coverage** - Code coverage reporting

### Build & Release

- **Semantic Release** - Automated versioning and releases
- **Conventional Changelog** - Automated changelog generation
- **Commitizen** - Interactive commit creation
- **Commitlint** - Commit message validation

### Automation

- **GitHub Actions** - CI/CD automation
- **Dependabot** - Automated dependency updates

### GitHub Actions Security Maintenance

All workflow actions under `.github/workflows/` should be pinned to immutable commit SHAs.

- Do not use floating tags alone (for example `@v4` or `@main`) in production workflows.
- Update action SHAs regularly to the latest stable tag for each action.
- Keep an inline comment with the corresponding tag for readability.

Example:

```yaml
uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
```

Suggested update flow:

```bash
# Resolve latest tags and SHAs
git ls-remote https://github.com/actions/checkout refs/tags/v6 refs/tags/v6.*
git ls-remote https://github.com/actions/setup-node refs/tags/v6 refs/tags/v6.*

# Update .github/workflows/*.yml references
# Then validate files and run CI
```

Quick checks:

```bash
# Ensure no floating tag refs remain
rg "uses:\s*[^\s]+@v[0-9]" .github/workflows

# Optional: ensure no branch refs are used
rg "uses:\s*[^\s]+@(main|master)$" .github/workflows
```

## 📝 Commit Standards

We follow [Conventional Commits](https://www.conventionalcommits.org/) for consistent commit messages:

```bash
# Format: type(scope): description
feat(auth): add WebAuthn support
fix(ui): resolve login form validation
docs(readme): update installation guide
chore(deps): update dependencies
```

### Available Types

- `feat`: New features
- `fix`: Bug fixes
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test additions/changes
- `chore`: Maintenance tasks
- `ci`: CI/CD changes

## 🚀 Automated Release Process

### Branch Structure

| Branch       | Purpose                    | Release Type                |
| ------------ | -------------------------- | --------------------------- |
| **`main`**   | Production releases        | Stable releases (v1.0.0)    |
| **`master`** | Production releases        | Stable releases (v1.0.0)    |
| **`dev`**    | Development & pre-releases | Pre-releases (v1.0.1-dev.0) |

### How Releases Work

Our release process is **fully automated** using Semantic Release:

#### Pre-Releases (Dev Branch)

```bash
git checkout dev
git commit -m "feat: add new authentication method"
git push origin dev
# → Automatically creates: v1.0.1-dev.0 (pre-release)
# → Updates CHANGELOG.md
# → Creates GitHub release
```

#### Stable Releases (Main/Master Branch)

```bash
git checkout main
git merge dev
git push origin main
# → Automatically creates: v1.0.1 (stable release)
# → Updates CHANGELOG.md
# → Creates GitHub release with artifacts
```

### Release Triggers

- **Pre-releases**: Any commit to `dev` branch
- **Stable releases**: Any commit to `main`/`master` branch
- **Version bumping**: Automatic based on commit types
- **Changelog**: Auto-generated from commit messages
- **Artifacts**: Auto-built and attached to releases

### Commit Types for Version Bumping

- `feat:` → Minor version bump (1.0.0 → 1.1.0)
- `fix:` → Patch version bump (1.0.0 → 1.0.1)
- `BREAKING CHANGE:` → Major version bump (1.0.0 → 2.0.0)

## 🔄 Pull Request Process

### Create Feature Branch

```bash
git checkout dev
git pull origin dev
git checkout -b feature/your-feature-name
```

### Before Submitting

- [ ] **Run quality checks**: `yarn test:run && yarn lint:check && yarn format:check`
- [ ] **Build validation**: `yarn build:scripts && yarn validate:build`
- [ ] **Self-review completed**
- [ ] **Conventional commit messages**
- [ ] **PR focused on single feature/fix**

### Quality Gates

Our automated CI/CD pipeline includes:

- ✅ **ESLint** - Code linting and style checks
- ✅ **Prettier** - Code formatting validation
- ✅ **Vitest** - Test suite execution
- ✅ **TypeScript** - Type checking
- ✅ **Build validation** - Ensures code compiles correctly
- ✅ **Commitlint** - Commit message format validation

### PR Guidelines

- **Title**: Clear, descriptive (follows conventional commits)
- **Description**: Explain what and why
- **Link Issues**: Reference related issues using `closes #123`
- **Keep it small**: Focused changes are easier to review
- **Screenshots**: Include UI changes when applicable

### Review Process

1. **Automated CI checks** must pass (ESLint, Prettier, Tests, Build)
2. **Code review** by maintainer
3. **Manual testing** for significant changes
4. **Approval** required before merge

### Development Commands

```bash
# Quality checks
yarn lint:check          # Check linting
yarn format:check        # Check formatting
yarn test:run           # Run tests
yarn test:coverage      # Run tests with coverage

# Formatting
yarn format             # Format all code
yarn format:src         # Format source code only

# Building
yarn build:scripts      # Build scripts
yarn validate:build     # Validate build output
```
