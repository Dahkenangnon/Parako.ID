#!/bin/bash

# Parako.ID Build and Release Script
# This script handles the complete build and release process for production deployment
# Usage: ./scripts/release.sh <version> [options]

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION=""
DRY_RUN="false"
VERBOSE="false"
RELEASE_ARCH=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_step() {
    echo -e "\n${BLUE}=== $1 ===${NC}"
}

# Error handling
handle_error() {
    local exit_code=$?
    local line_number=$1
    log_error "Build failed at line $line_number with exit code $exit_code"
    exit $exit_code
}

trap 'handle_error $LINENO' ERR

# Help function
show_help() {
    cat << EOF
Parako.ID Build and Release Script

Usage: $0 <version> [options]

Arguments:
  version     Version to build (required)

Options:
  --dry-run   Show what would be done without executing
  --verbose   Enable verbose output
  --help      Show this help message

Examples:
  $0 1.0.0
  $0 1.0.0 --dry-run
  $0 1.0.0 --verbose

EOF
}

# Parse command line arguments
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run)
                DRY_RUN="true"
                shift
                ;;
            --verbose)
                VERBOSE="true"
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            -*)
                log_error "Unknown option: $1"
                show_help
                exit 2
                ;;
            *)
                if [[ -n "$VERSION" ]]; then
                    log_error "Unexpected argument: $1"
                    show_help
                    exit 2
                fi
                VERSION="$1"
                shift
                ;;
        esac
    done

    if [[ -z "$VERSION" ]]; then
        log_error "Version is required"
        show_help
        exit 2
    fi
}

# Validation functions
validate_environment() {
    log_step "Environment Validation"
    
    # Check required tools
    local required_tools=("node" "pnpm" "tar" "zip" "curl" "sha256sum")
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            log_error "$tool is required but not installed"
            exit 1
        fi
    done

    # Check Node.js version
    local node_version node_major
    node_version=$(node --version | sed 's/v//')
    node_major=$(echo "$node_version" | cut -d. -f1)
    if [[ $node_major -lt 24 ]]; then
        log_error "Node.js version $node_version detected. Minimum required version is 24.x"
        exit 1
    fi

    case "$(node -p 'process.arch')" in
        x64) RELEASE_ARCH="x64" ;;
        arm64) RELEASE_ARCH="arm64" ;;
        *) log_error "Unsupported release architecture: $(node -p 'process.arch')"; exit 1 ;;
    esac

    local package_version
    package_version=$(node -p "require('./package.json').version")
    if [[ "$package_version" != "$VERSION" ]]; then
        log_error "Release version $VERSION does not match package.json $package_version"
        exit 1
    fi
    export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$PROJECT_ROOT" log -1 --pretty=%ct)}"

    # Check pnpm version (project requires pnpm 11+)
    local pnpm_version pnpm_major
    pnpm_version=$(pnpm --version)
    pnpm_major=$(echo "$pnpm_version" | cut -d. -f1)
    if [[ $pnpm_major -lt 11 ]]; then
        log_error "pnpm version $pnpm_version detected. Minimum required version is 11.x"
        exit 1
    fi

    # Security checks
    log_info "Running security checks..."
    
    # Check for sensitive files that should not be in production
    local sensitive_files=(".env" ".env.local" ".env.production" "parako.jsonc" "parako-rp.jsonc" "*.key" "*.pem" "*.p12" "*.pfx")
    for pattern in "${sensitive_files[@]}"; do
        if find "$PROJECT_ROOT" -name "$pattern" -type f 2>/dev/null | grep -q .; then
            log_warning "Found sensitive file matching pattern: $pattern"
            log_warning "These files will be excluded from the production build"
        fi
    done

    # Check for source maps (security risk)
    if find "$PROJECT_ROOT" -name "*.map" -type f 2>/dev/null | grep -q .; then
        log_warning "Found source map files. These will be removed for security."
    fi

    # Display environment info
    log_info "Node.js version: $(node --version)"
    log_info "pnpm version: $(pnpm --version)"
    log_info "OS: $(uname -s)"
    log_info "Architecture: $(uname -m)"
    log_info "Working directory: $(pwd)"
    log_info "Project root: $PROJECT_ROOT"
    log_info "Version: $VERSION"
    log_info "Dry run: $DRY_RUN"
    log_info "Verbose: $VERBOSE"
    
    log_success "Environment validation completed"
}

validate_project_structure() {
    log_step "Project Structure Validation"
    
    local required_files=("package.json" "pnpm-lock.yaml" "pnpm-workspace.yaml" "tsconfig.json" "scripts/build.js")
    for file in "${required_files[@]}"; do
        if [[ ! -f "$PROJECT_ROOT/$file" ]]; then
            log_error "Required file missing: $file"
            exit 1
        fi
        log_success "Found: $file"
    done
    
    # Note: TypeScript version will be checked after dependencies are installed
}

# Build functions
clean_artifacts() {
    log_step "Cleaning Artifacts"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would remove: node_modules, dist directories"
        return
    fi

    cd "$PROJECT_ROOT"
    rm -rf node_modules
    # Clean dist directory directly (rimraf might not be available yet)
    rm -rf dist
    log_success "Artifacts cleaned"
}

install_dependencies() {
    log_step "Installing Dependencies"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would run: pnpm install --frozen-lockfile"
        return
    fi

    cd "$PROJECT_ROOT"

    # Install dependencies with error handling. pnpm 11 enables --frozen-lockfile
    # automatically in CI but the explicit flag documents intent.
    pnpm install --frozen-lockfile
    
    log_success "Dependencies installed successfully"
}

build_project() {
    log_step "Building Project"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would run build commands:"
        log_info "  - pnpm run build (includes all build steps from package.json)"
        return
    fi

    cd "$PROJECT_ROOT"

    # Set production environment
    export NODE_ENV=production
    export CI=true

    # Verify required build tools from the local dependency tree. Tailwind v4
    # treats `--version` as a build invocation, so read package metadata rather
    # than emitting a full stylesheet into release logs.
    log_info "Verifying build tools..."

    local typescript_version tailwind_version
    typescript_version=$(node -p "require('./node_modules/typescript/package.json').version") \
        || { log_error "TypeScript not found"; exit 1; }
    tailwind_version=$(node -p "require('./node_modules/tailwindcss/package.json').version") \
        || { log_error "TailwindCSS not found"; exit 1; }
    log_info "TypeScript version: $typescript_version"
    log_info "TailwindCSS version: $tailwind_version"

    # Build with error handling and validation using package.json build script.
    log_info "Running complete build process..."
    pnpm run build || { log_error "Build process failed"; exit 1; }
    
    log_success "Build completed successfully"
}

validate_build_output() {
    log_step "Build Output Validation"
    
    cd "$PROJECT_ROOT"
    
    # Critical path validation (must match scripts/build.js output)
    local critical_paths=(
        "dist/src/index.js"
        "dist/scripts/manage/admin.js"
        "dist/scripts/manage/client.js"
        "dist/scripts/manage/database.js"
        "dist/scripts/manage/diagnostics.js"
        "dist/scripts/manage/keys.js"
        "dist/scripts/manage/systemd.js"
    )
    
    for path in "${critical_paths[@]}"; do
        if [[ ! -f "$path" ]]; then
            log_error "Critical file missing: $path"
            exit 1
        fi
        log_success "Found: $path"
    done
    
    # Test CLI functionality
    log_info "Testing CLI scripts..."
    node dist/scripts/manage/client.js --help > /dev/null || { log_error "Client CLI failed"; exit 1; }
    node dist/scripts/manage/admin.js --help > /dev/null || { log_error "Admin CLI failed"; exit 1; }
    node dist/scripts/manage/database.js --help > /dev/null || { log_error "Database CLI failed"; exit 1; }
    node dist/scripts/manage/diagnostics.js --help > /dev/null || { log_error "Diagnostics CLI failed"; exit 1; }
    node dist/scripts/manage/keys.js --help > /dev/null || { log_error "Keys CLI failed"; exit 1; }
    
    log_success "Build validation completed"
}

create_production_package() {
    log_step "Creating Production Package"
    
    cd "$PROJECT_ROOT"
    
    local release_dir="parako-id-release"
    local artifact_name="parako-id-v$VERSION"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would create production package in: $release_dir"
        log_info "Would copy essential files and directories"
        return
    fi

    # Create release directory
    rm -rf "$release_dir"
    mkdir -p "$release_dir"
    
    # Copy built application
    cp -r dist "$release_dir/"
    
    # Copy src/views folder to dist/src/views (essential for template rendering)
    if [[ -d "src/views" ]]; then
        mkdir -p "$release_dir/dist/src"
        cp -r src/views "$release_dir/dist/src/"
        log_info "Copied src/views to dist/src/views"
    else
        log_warning "src/views directory not found"
    fi
    
    # Copy public assets (excluding source maps for security)
    if [[ -d "public" ]]; then
        cp -r public "$release_dir/"
        # Remove source maps for security
        find "$release_dir/public" -name "*.map" -type f -delete 2>/dev/null || true
        # Remove any other sensitive files
        find "$release_dir/public" -name "*.env*" -type f -delete 2>/dev/null || true
        find "$release_dir/public" -name "*.key" -type f -delete 2>/dev/null || true
        find "$release_dir/public" -name "*.pem" -type f -delete 2>/dev/null || true
        find "$release_dir/public" -name "*.p12" -type f -delete 2>/dev/null || true
        find "$release_dir/public" -name "*.pfx" -type f -delete 2>/dev/null || true
        log_info "Security: Removed source maps and sensitive files from public assets"
    fi
    
    # Copy essential files
    cp package.json "$release_dir/"
    cp pnpm-lock.yaml "$release_dir/" || { log_error "Failed to copy pnpm-lock.yaml"; exit 1; }
    cp pnpm-workspace.yaml "$release_dir/" || { log_error "Failed to copy pnpm-workspace.yaml"; exit 1; }
    cp -r prisma "$release_dir/"
    cp prisma.config.ts prisma.config.pg.ts "$release_dir/"
    cp release-manifest.schema.json "$release_dir/"
    cp README.md "$release_dir/"
    
    # Copy runtime directory and sanitize it. The installer's minimal-deployer
    # model (docs/installer.md) preserves operator-owned runtime/ wholesale and
    # only populates {locales, views} on FIRST install. Strip anything
    # operator-owned out of the shipped tarball so:
    #   - the installer's first-install allowlist matches what's on disk;
    #   - operators cannot accidentally pick up a stale .env, JWKS, DB file,
    #     uploads, logs, or PM2 ecosystem from someone else's checkout.
    if [[ -d "runtime" ]]; then
        cp -r runtime "$release_dir/"
        # Strict allowlist of what stays under release_dir/runtime/.
        find "$release_dir/runtime" -maxdepth 1 -mindepth 1 \
             ! -name 'locales' ! -name 'views' \
             -exec rm -rf {} + 2>/dev/null || true
        # Ensure the first-install dirs exist even when .gitignore excluded
        # their contents from the source checkout.
        mkdir -p "$release_dir/runtime/locales" \
                 "$release_dir/runtime/views"
        # .merged is a generated runtime cache. Shipping it makes source-tree
        # state part of the release and can leave stale translations in place.
        rm -rf "$release_dir/runtime/locales/.merged"
        log_info "Sanitized release_dir/runtime/ (kept: locales, views)"
    else
        log_error "runtime/ directory not found — artifact will be broken"
        exit 1
    fi

    # Ship the parako operator binary AND sample configuration files inside
    # the tarball under contrib/. Samples are NOT placed at the tarball root
    # so they cannot be mistaken for operator-owned files; the installer's
    # next-steps card points operators to contrib/ for the copy-edit step.
    # NOTE: this is the deliberate exception to "no installer/ files inside
    # the tarball" — only the runtime operator and its Docker module ship;
    # network-facing installer entrypoints never enter the application archive.
    mkdir -p "$release_dir/contrib"
    if [[ -f "installer/parako.sh" ]]; then
        cp installer/parako.sh "$release_dir/contrib/parako.sh"
        chmod 0755 "$release_dir/contrib/parako.sh"
        log_info "Shipped installer/parako.sh at contrib/parako.sh"
    else
        log_error "installer/parako.sh not found — tarball would not include the parako operator binary"
        exit 1
    fi
    if [[ -f "installer/parako-docker.sh" && -d "deployment/docker" ]]; then
        cp installer/parako-docker.sh "$release_dir/contrib/parako-docker.sh"
        chmod 0755 "$release_dir/contrib/parako-docker.sh"
        mkdir -p "$release_dir/contrib/docker"
        cp deployment/docker/compose*.yaml "$release_dir/contrib/docker/"
        log_info "Shipped Docker operator module and Compose definitions under contrib/"
    else
        log_error "Docker operator module or deployment/docker definitions are missing"
        exit 1
    fi
    if [[ -f ".env.example" ]]; then
        cp .env.example "$release_dir/contrib/.env.sample"
        log_info "Shipped .env.example at contrib/.env.sample"
    else
        log_error ".env.example not found — tarball would not include the env sample"
        exit 1
    fi
    if [[ -f "parako-rp.example.json" ]]; then
        cp parako-rp.example.json "$release_dir/contrib/parako-rp.sample.jsonc"
        log_info "Shipped parako-rp.example.json at contrib/parako-rp.sample.jsonc"
    else
        log_error "parako-rp.example.json not found — refusing to substitute the unrelated server configuration sample"
        exit 1
    fi
    # Copy essential documentation. Repo paths are canonical lowercase.
    mkdir -p "$release_dir/docs"
    cp docs/deployment.md "$release_dir/docs/" 2>/dev/null || log_warning "docs/deployment.md not found"
    cp docs/docker.md "$release_dir/docs/" 2>/dev/null || log_warning "docs/docker.md not found"
    cp docs/quickstart.md "$release_dir/docs/" 2>/dev/null || log_warning "docs/quickstart.md not found"
    
    # Create production package.json with ONLY production dependencies
    node -e "
        const pkg = require('./package.json');
        const prodPkg = {
            name: pkg.name,
            version: pkg.version,
            private: true,
            description: pkg.description,
            author: pkg.author,
            license: pkg.license,
            homepage: pkg.homepage,
            repository: pkg.repository,
            bugs: pkg.bugs,
            funding: pkg.funding,
            // Keep Corepack on the same verified pnpm release after this
            // manifest is moved into the isolated staging directory.
            packageManager: pkg.packageManager,
            main: 'dist/src/index.js',
            bin: {
                admin: './dist/scripts/manage/admin.js',
                client: './dist/scripts/manage/client.js',
                database: './dist/scripts/manage/database.js',
                diagnostics: './dist/scripts/manage/diagnostics.js',
                keys: './dist/scripts/manage/keys.js',
                systemd: './dist/scripts/manage/systemd.js'
            },
            engines: pkg.engines,
            type: pkg.type,
            keywords: pkg.keywords,
            scripts: {
                // 'start' runs node directly; operators wire their own
                // supervisor (systemd / pm2 / docker) and call this if they
                // want, but the installer never invokes it.
                'start': './node/bin/node --experimental-specifier-resolution=node dist/src/index.js',
                // 'client', 'keys', 'systemd' remain for operator ad-hoc use.
                // The installer does NOT call any of them.
                'client': './node/bin/node dist/scripts/manage/client.js',
                'admin': './node/bin/node dist/scripts/manage/admin.js',
                'database': './node/bin/node dist/scripts/manage/database.js',
                'diagnostics': './node/bin/node dist/scripts/manage/diagnostics.js',
                'keys': './node/bin/node dist/scripts/manage/keys.js',
                'systemd': './node/bin/node dist/scripts/manage/systemd.js',
                // DB management scripts remain for operator ad-hoc use. The
                // installer does NOT call them; release notes tell operators
                // when and how to run migrations.
                'db:migrate': './node/bin/node dist/scripts/manage/database.js migrate',
                'db:migrate:status': './node/bin/node dist/scripts/manage/database.js status'
            },
            dependencies: pkg.dependencies || {},
            devDependencies: {},
            browserslist: pkg.browserslist
        };
        require('fs').writeFileSync('./$release_dir/package.json', JSON.stringify(prodPkg, null, 2));
        console.log('Production package.json created with', Object.keys(prodPkg.dependencies).length, 'production dependencies');
    "
    
    log_success "Production package structure created"
}

bundle_node_runtime() {
    log_step "Bundling Node.js Runtime"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would download and verify Node.js $(node --version) for linux-$RELEASE_ARCH"
        return
    fi

    local node_version node_dist_arch archive_name base_url temp_dir expected
    node_version=$(node -p 'process.versions.node')
    case "$RELEASE_ARCH" in
        x64) node_dist_arch="x64" ;;
        arm64) node_dist_arch="arm64" ;;
        *) log_error "Unsupported Node.js architecture: $RELEASE_ARCH"; exit 1 ;;
    esac
    archive_name="node-v${node_version}-linux-${node_dist_arch}.tar.xz"
    base_url="https://nodejs.org/dist/v${node_version}"
    temp_dir=$(mktemp -d -t parako-node-XXXXXXXX)

    curl --proto '=https' --tlsv1.2 -fsSLo "$temp_dir/$archive_name" "$base_url/$archive_name"
    curl --proto '=https' --tlsv1.2 -fsSLo "$temp_dir/SHASUMS256.txt" "$base_url/SHASUMS256.txt"
    expected=$(awk -v name="$archive_name" '$2 == name { print $1 }' "$temp_dir/SHASUMS256.txt")
    [[ -n "$expected" ]] || { log_error "Node.js checksum entry missing for $archive_name"; exit 1; }
    [[ "$(sha256sum "$temp_dir/$archive_name" | awk '{print $1}')" == "$expected" ]] \
        || { log_error "Node.js runtime checksum mismatch"; exit 1; }

    mkdir -p "$PROJECT_ROOT/parako-id-release/node"
    tar -xJf "$temp_dir/$archive_name" -C "$PROJECT_ROOT/parako-id-release/node" --strip-components=1
    "$PROJECT_ROOT/parako-id-release/node/bin/node" --version \
        | grep -qx "v${node_version}" \
        || { log_error "Bundled Node.js runtime smoke check failed"; exit 1; }
    rm -rf "$temp_dir"
    log_success "Bundled verified Node.js v${node_version} for linux-${RELEASE_ARCH}"
}

bundle_age_runtime() {
    log_step "Bundling age Encryption"
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would download and verify age v1.3.1 for linux-$RELEASE_ARCH"
        return
    fi

    local age_arch checksum archive_name temp_dir
    case "$RELEASE_ARCH" in
        x64)
            age_arch="amd64"
            checksum="bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377" ;;
        arm64)
            age_arch="arm64"
            checksum="c6878a324421b69e3e20b00ba17c04bc5c6dab0030cfe55bf8f68fa8d9e9093a" ;;
        *) log_error "Unsupported age architecture: $RELEASE_ARCH"; exit 1 ;;
    esac
    archive_name="age-v1.3.1-linux-${age_arch}.tar.gz"
    temp_dir=$(mktemp -d -t parako-age-XXXXXXXX)
    curl --proto '=https' --tlsv1.2 -fsSLo "$temp_dir/$archive_name" \
        "https://github.com/FiloSottile/age/releases/download/v1.3.1/$archive_name"
    [[ "$(sha256sum "$temp_dir/$archive_name" | awk '{print $1}')" == "$checksum" ]] \
        || { log_error "age checksum mismatch"; exit 1; }
    mkdir -p "$PROJECT_ROOT/parako-id-release/tools/age"
    tar -xzf "$temp_dir/$archive_name" \
        -C "$PROJECT_ROOT/parako-id-release/tools/age" --strip-components=1
    "$PROJECT_ROOT/parako-id-release/tools/age/age" --version \
        | grep -q '1.3.1' || { log_error "age smoke check failed"; exit 1; }
    rm -rf "$temp_dir"
    log_success "Bundled verified age v1.3.1 for linux-$RELEASE_ARCH"
}

create_release_manifest() {
    log_step "Creating Release Manifest"
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would create release-manifest.json for linux-$RELEASE_ARCH"
        return
    fi
    node "$PROJECT_ROOT/scripts/create-release-manifest-cli.mjs" \
        "$PROJECT_ROOT/parako-id-release" "$VERSION" "$RELEASE_ARCH"
    log_success "Release compatibility manifest created"
}

create_release_sbom() {
    log_step "Creating SPDX SBOM"
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would create SBOM.spdx.json"
        return
    fi
    node "$PROJECT_ROOT/scripts/create-sbom.mjs" "$PROJECT_ROOT/parako-id-release"
    log_success "SPDX dependency SBOM created"
}

install_production_dependencies() {
    log_step "Installing Production Dependencies"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would run: pnpm install --prod --no-frozen-lockfile"
        return
    fi

    cd "$PROJECT_ROOT/parako-id-release"

    # Install production dependencies. The release package.json is a
    # stripped-down version of the source one (devDependencies removed),
    # so --frozen-lockfile cannot be used here — the lockfile still
    # references the full source package.json's dependency graph.
    # pnpm in CI defaults --frozen-lockfile=true, so we override it
    # explicitly with --no-frozen-lockfile.
    pnpm install --prod --no-frozen-lockfile || {
        log_error "Production dependencies installation failed";
        exit 1;
    }

    # The source checkout's generated SQLite client lives under node_modules
    # and is intentionally not copied into the staging tree. Generate both
    # supported clients against the production dependency graph so a release
    # can never ship Prisma's ungenerated placeholder package.
    pnpm exec prisma generate --config=prisma.config.ts || {
        log_error "SQLite Prisma client generation failed";
        exit 1;
    }
    pnpm exec prisma generate --config=prisma.config.pg.ts || {
        log_error "PostgreSQL Prisma client generation failed";
        exit 1;
    }

    # Verify production dependencies
    if [[ ! -d "node_modules" ]] \
        || [[ ! -f "pnpm-lock.yaml" ]] \
        || [[ ! -f "node_modules/@prisma/client/index.js" ]] \
        || [[ ! -f "prisma/generated/postgresql/index.js" ]]; then
        log_error "Production dependencies validation failed"
        exit 1
    fi
    log_success "Production dependencies installed successfully"

    node "$PROJECT_ROOT/scripts/check-production-licenses.mjs" "$PROJECT_ROOT/parako-id-release" || {
        log_error "Production dependency license policy failed"
        exit 1
    }

    # The artifact must carry its complete third-party attribution record.
    pnpm licenses list --prod > THIRD_PARTY_LICENSES.txt 2>/dev/null \
        || { log_error "Could not generate third-party licenses summary"; exit 1; }
    
    cd "$PROJECT_ROOT"
}

optimize_package() {
    log_step "Optimizing Package Size"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would optimize package by removing unnecessary files"
        return
    fi

    cd "$PROJECT_ROOT/parako-id-release"

    # Optimize package size
    log_info "Removing unnecessary files..."
    # Keep LICENSE, NOTICE, COPYRIGHT, and attribution files. They are part of
    # the distributable's legal and supply-chain record.
    find node_modules -name "*.md" -type f \
        ! -iname "license*" ! -iname "notice*" ! -iname "copyright*" \
        -delete 2>/dev/null || true
    find node_modules -name "CHANGELOG*" -type f -delete 2>/dev/null || true
    find node_modules -name "HISTORY*" -type f -delete 2>/dev/null || true
    find node_modules -name "*.d.ts" -type f -delete 2>/dev/null || true
    find node_modules -name "test" -type d -exec rm -rf {} + 2>/dev/null || true
    find node_modules -name "tests" -type d -exec rm -rf {} + 2>/dev/null || true
    find node_modules -name "__tests__" -type d -exec rm -rf {} + 2>/dev/null || true
    find node_modules -name "example" -type d -exec rm -rf {} + 2>/dev/null || true
    find node_modules -name "examples" -type d -exec rm -rf {} + 2>/dev/null || true
    find node_modules -name "docs" -type d -exec rm -rf {} + 2>/dev/null || true
    find node_modules -name ".github" -type d -exec rm -rf {} + 2>/dev/null || true
    find node_modules -name "coverage" -type d -exec rm -rf {} + 2>/dev/null || true
    
    cd "$PROJECT_ROOT"
    log_success "Package optimization completed"
}

validate_production_package() {
    log_step "Validating Production Package"
    
    cd "$PROJECT_ROOT"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would validate production package structure"
        return
    fi

    # Final validation
    local missing=0
    [[ ! -d "parako-id-release/dist/src" ]]                       && missing=1
    [[ ! -d "parako-id-release/dist/scripts" ]]                   && missing=1
    [[ ! -d "parako-id-release/dist/src/views" ]]                 && missing=1
    [[ ! -d "parako-id-release/node_modules" ]]                   && missing=1
    [[ ! -f "parako-id-release/pnpm-lock.yaml" ]]                 && missing=1
    [[ ! -d "parako-id-release/runtime/locales" ]]                && missing=1
    [[ ! -d "parako-id-release/runtime/views" ]]                  && missing=1
    [[ ! -f "parako-id-release/contrib/parako.sh" ]]              && missing=1
    [[ ! -f "parako-id-release/contrib/parako-docker.sh" ]]       && missing=1
    [[ ! -f "parako-id-release/contrib/docker/compose.yaml" ]]    && missing=1
    [[ ! -f "parako-id-release/contrib/docker/compose.tools.yaml" ]] && missing=1
    [[ ! -f "parako-id-release/contrib/docker/compose.redis.yaml" ]] && missing=1
    [[ ! -f "parako-id-release/contrib/docker/compose.postgresql.yaml" ]] && missing=1
    [[ ! -f "parako-id-release/contrib/docker/compose.mongodb.yaml" ]] && missing=1
    [[ ! -f "parako-id-release/contrib/.env.sample" ]]            && missing=1
    [[ ! -f "parako-id-release/contrib/parako-rp.sample.jsonc" ]] && missing=1
    [[ ! -f "parako-id-release/prisma.config.ts" ]]               && missing=1
    [[ ! -d "parako-id-release/prisma/migrations/sqlite" ]]       && missing=1
    [[ ! -d "parako-id-release/prisma/migrations/postgresql" ]]   && missing=1
    [[ ! -f "parako-id-release/node_modules/@prisma/client/index.js" ]] && missing=1
    [[ ! -f "parako-id-release/prisma/generated/postgresql/index.js" ]] && missing=1
    [[ ! -x "parako-id-release/node/bin/node" ]]                   && missing=1
    [[ ! -x "parako-id-release/tools/age/age" ]]                   && missing=1
    [[ ! -x "parako-id-release/tools/age/age-keygen" ]]            && missing=1
    [[ ! -f "parako-id-release/release-manifest.json" ]]          && missing=1
    [[ ! -f "parako-id-release/SBOM.spdx.json" ]]                 && missing=1
    [[ ! -f "parako-id-release/THIRD_PARTY_LICENSES.txt" ]]       && missing=1
    if [[ "$missing" -eq 1 ]]; then
        log_error "Production package validation failed"
        log_error "Missing:"
        [[ ! -d "parako-id-release/dist/src" ]]                       && log_error "  - dist/src directory"
        [[ ! -d "parako-id-release/dist/scripts" ]]                   && log_error "  - dist/scripts directory"
        [[ ! -d "parako-id-release/dist/src/views" ]]                 && log_error "  - dist/src/views directory"
        [[ ! -d "parako-id-release/node_modules" ]]                   && log_error "  - node_modules directory"
        [[ ! -f "parako-id-release/pnpm-lock.yaml" ]]                 && log_error "  - pnpm-lock.yaml file"
        [[ ! -d "parako-id-release/runtime/locales" ]]                && log_error "  - runtime/locales directory"
        [[ ! -d "parako-id-release/runtime/views" ]]                  && log_error "  - runtime/views directory"
        [[ ! -f "parako-id-release/contrib/parako.sh" ]]              && log_error "  - contrib/parako.sh (parako operator binary)"
        [[ ! -f "parako-id-release/contrib/parako-docker.sh" ]]       && log_error "  - contrib/parako-docker.sh (Docker operator module)"
        [[ ! -f "parako-id-release/contrib/docker/compose.yaml" ]]    && log_error "  - contrib/docker/compose.yaml"
        [[ ! -f "parako-id-release/contrib/docker/compose.tools.yaml" ]] && log_error "  - contrib/docker/compose.tools.yaml"
        [[ ! -f "parako-id-release/contrib/docker/compose.redis.yaml" ]] && log_error "  - contrib/docker/compose.redis.yaml"
        [[ ! -f "parako-id-release/contrib/docker/compose.postgresql.yaml" ]] && log_error "  - contrib/docker/compose.postgresql.yaml"
        [[ ! -f "parako-id-release/contrib/docker/compose.mongodb.yaml" ]] && log_error "  - contrib/docker/compose.mongodb.yaml"
        [[ ! -f "parako-id-release/contrib/.env.sample" ]]            && log_error "  - contrib/.env.sample (operator env sample)"
        [[ ! -f "parako-id-release/contrib/parako-rp.sample.jsonc" ]] && log_error "  - contrib/parako-rp.sample.jsonc (operator RP sample)"
        [[ ! -f "parako-id-release/prisma.config.ts" ]]               && log_error "  - prisma.config.ts"
        [[ ! -d "parako-id-release/prisma/migrations/sqlite" ]]       && log_error "  - SQLite migrations"
        [[ ! -d "parako-id-release/prisma/migrations/postgresql" ]]   && log_error "  - PostgreSQL migrations"
        [[ ! -f "parako-id-release/node_modules/@prisma/client/index.js" ]] && log_error "  - SQLite Prisma client"
        [[ ! -f "parako-id-release/prisma/generated/postgresql/index.js" ]] && log_error "  - PostgreSQL Prisma client"
        [[ ! -x "parako-id-release/node/bin/node" ]]                   && log_error "  - bundled Node.js runtime"
        [[ ! -x "parako-id-release/tools/age/age" ]]                   && log_error "  - bundled age runtime"
        [[ ! -x "parako-id-release/tools/age/age-keygen" ]]            && log_error "  - bundled age-keygen runtime"
        [[ ! -f "parako-id-release/release-manifest.json" ]]          && log_error "  - release-manifest.json"
        [[ ! -f "parako-id-release/SBOM.spdx.json" ]]                 && log_error "  - SBOM.spdx.json"
        [[ ! -f "parako-id-release/THIRD_PARTY_LICENSES.txt" ]]       && log_error "  - THIRD_PARTY_LICENSES.txt"
        exit 1
    fi

    # Refuse to ship operator-owned subtrees inside runtime/. The first-install
    # populate path in installer/install.sh trusts an allowlist; this enforces
    # the same posture at packaging time.
    local forbidden=(runtime/jwks runtime/uploads runtime/.tmp-uploads runtime/logs runtime/backups runtime/config-backups runtime/ecosystem.config.cjs runtime/parako.jsonc runtime/parako-rp.jsonc)
    local entry
    for entry in "${forbidden[@]}"; do
        if [[ -e "parako-id-release/${entry}" ]]; then
            log_error "SECURITY VIOLATION: runtime/ sanitization missed: ${entry}"
            exit 1
        fi
    done

    # Security validation
    log_info "Running security validation..."

    # Check for sensitive files in production package
    # NOTE: install.sh is the installer published to get.parako.id; installer/
    # is its source tree. Neither must ever ship inside a release tarball —
    # they live in source for audit transparency and deploy independently.
    local sensitive_patterns=(".env" ".env.local" ".env.production" ".env.staging" ".env.example" "*.key" "*.pem" "*.p12" "*.pfx" "*.map" "*.db" "parako.jsonc" "parako-rp.jsonc" "parako.sample.jsonc" "install.sh" "jwks*.json" "jwks*.pem")
    for pattern in "${sensitive_patterns[@]}"; do
        if find "parako-id-release" -name "$pattern" -type f 2>/dev/null | grep -q .; then
            log_error "SECURITY VIOLATION: Found sensitive file in production package: $pattern"
            find "parako-id-release" -name "$pattern" -type f 2>/dev/null | while read -r file; do
                log_error "  - $file"
            done
            exit 1
        fi
    done

    # Defense in depth: explicit directory check for installer/ (file pattern
    # check above catches install.sh, this catches the whole tree).
    if [[ -d "parako-id-release/installer" ]]; then
        log_error "SECURITY VIOLATION: installer/ directory found in production package"
        log_error "  - parako-id-release/installer"
        exit 1
    fi
    
    # Verify only production dependencies are installed
    cd parako-id-release
    local prod_deps installed_deps
    prod_deps=$(node -e "const pkg=require('./package.json'); console.log(Object.keys(pkg.dependencies||{}).length);")
    installed_deps=$(find node_modules -maxdepth 1 -type d | wc -l)
    log_info "Production dependencies: $prod_deps"
    log_info "Installed dependencies: $((installed_deps - 1))" # -1 for node_modules itself
    
    # Test CLI with bundled dependencies. The installed operator invokes these
    # through the atomic `current` symlink, so reproduce that path and assert
    # actual help output (a skipped entrypoint otherwise exits successfully).
    ./node/bin/node dist/scripts/manage/client.js --help > /dev/null || { log_error "Client CLI test failed with bundled dependencies"; exit 1; }
    ./node/bin/node dist/scripts/manage/keys.js --help > /dev/null || { log_error "Keys CLI test failed"; exit 1; }
    local cli_smoke_failed=0
    ln -s . .current-smoke
    ./.current-smoke/node/bin/node .current-smoke/dist/scripts/manage/admin.js --help \
        | grep -q 'Usage: parako-admin' || { log_error "Admin CLI symlink test failed"; cli_smoke_failed=1; }
    ./.current-smoke/node/bin/node .current-smoke/dist/scripts/manage/database.js --help \
        | grep -q 'Usage: parako-database' || { log_error "Database CLI symlink test failed"; cli_smoke_failed=1; }
    ./.current-smoke/node/bin/node .current-smoke/dist/scripts/manage/diagnostics.js --help \
        | grep -q 'Usage: parako-diagnostics' || { log_error "Diagnostics CLI symlink test failed"; cli_smoke_failed=1; }
    rm .current-smoke
    [[ "$cli_smoke_failed" -eq 1 ]] && exit 1
    cd ..
    
    log_success "Production package validation completed"
    log_success "Security validation passed - no sensitive files found"
}

smoke_test_read_only_database() {
    log_step "Testing Read-Only Release Database Runtime"

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would migrate and inspect SQLite with the release tree read-only"
        return
    fi

    cd "$PROJECT_ROOT"

    local release_dir="$PROJECT_ROOT/parako-id-release"
    local runtime_dir schema_engine smoke_failed=0
    runtime_dir=$(mktemp -d -t parako-release-runtime-XXXXXXXX)

    schema_engine=$(find "$release_dir/node_modules" -type f \
        -name 'schema-engine-*' -perm /0111 -print -quit)
    if [[ -z "$schema_engine" ]]; then
        rm -rf "$runtime_dir"
        log_error "Executable Prisma schema engine is missing from the production package"
        exit 1
    fi

    # Apply the exact permission normalization used before systemd starts the
    # service. This caught the v0.3.1 regression where a blanket chmod removed
    # the bundled Prisma schema engine's executable bit.
    bash -c 'source "$1"; normalize_release_permissions "$2"' \
        _ "$release_dir/contrib/parako.sh" "$release_dir"

    if ! env \
        PARAKO_ROOT="$release_dir" \
        PARAKO_ENV_FILE="$runtime_dir/missing.env" \
        STORAGE_ADAPTER=sqlite \
        STORAGE_SQLITE_PATH="$runtime_dir/parako.db" \
        DATABASE_URL="file:$runtime_dir/parako.db" \
        "$release_dir/node/bin/node" \
        "$release_dir/dist/scripts/manage/database.js" migrate; then
        rm -rf "$runtime_dir"
        log_error "Bundled Prisma migration smoke test failed"
        exit 1
    fi

    # ProtectSystem=strict only grants runtime/ as writable. Removing write
    # permission here proves that migration status does not attempt to repair,
    # download, or rewrite a native engine inside the signed release tree.
    chmod -R a-w "$release_dir"
    if ! env \
        PARAKO_ROOT="$release_dir" \
        PARAKO_ENV_FILE="$runtime_dir/missing.env" \
        STORAGE_ADAPTER=sqlite \
        STORAGE_SQLITE_PATH="$runtime_dir/parako.db" \
        DATABASE_URL="file:$runtime_dir/parako.db" \
        "$release_dir/node/bin/node" \
        "$release_dir/dist/scripts/manage/database.js" status; then
        smoke_failed=1
    fi

    # Restore deterministic artifact modes even when the read-only check fails.
    chmod -R u+w "$release_dir"
    bash -c 'source "$1"; normalize_release_permissions "$2"' \
        _ "$release_dir/contrib/parako.sh" "$release_dir"
    rm -rf "$runtime_dir"

    if [[ "$smoke_failed" -eq 1 ]]; then
        log_error "Prisma status attempted to mutate or could not execute from the read-only release"
        exit 1
    fi

    log_success "Bundled Prisma works with the release tree read-only"
}

create_release_archives() {
    log_step "Creating Release Archives"
    
    cd "$PROJECT_ROOT"
    
    local artifact_name="parako-id-v$VERSION-linux-$RELEASE_ARCH"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would create archives:"
        log_info "  - $artifact_name.tar.gz"
        log_info "  - $artifact_name.zip"
        log_info "  - SHA256SUMS"
        return
    fi

    # Create compressed archives
    find parako-id-release -exec touch -h -d "@$SOURCE_DATE_EPOCH" {} +
    tar --sort=name --mtime="@$SOURCE_DATE_EPOCH" --owner=0 --group=0 --numeric-owner \
        -cf - parako-id-release/ | gzip -n > "$artifact_name.tar.gz"
    (
        cd parako-id-release
        find . -print | LC_ALL=C sort | zip -q -X "../$artifact_name.zip" -@
    )

    # Verify archive integrity
    tar -tzf "$artifact_name.tar.gz" > /dev/null || { log_error "Tar archive corrupted"; exit 1; }
    unzip -t "$artifact_name.zip" > /dev/null || { log_error "Zip archive corrupted"; exit 1; }

    # Generate checksum manifest for the installer to verify integrity
    sha256sum "$artifact_name.tar.gz" "$artifact_name.zip" > SHA256SUMS \
        || { log_error "Failed to generate SHA256SUMS"; exit 1; }

    log_success "Release archives created successfully"
    log_info "Archives:"
    log_info "  - $artifact_name.tar.gz"
    log_info "  - $artifact_name.zip"
    log_info "  - SHA256SUMS"
}

cleanup() {
    log_step "Cleanup"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would clean up temporary files"
        return
    fi

    # Optional: Remove the release directory after creating archives
    # Uncomment the next line if you want to clean up the release directory
    # rm -rf parako-id-release/
    
    log_success "Cleanup completed"
}

# Main execution function
main() {
    log_info "Starting Parako.ID build and release process for version $VERSION"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_warning "DRY RUN MODE - No actual changes will be made"
    fi
    
    # Execute build steps
    validate_environment
    validate_project_structure
    clean_artifacts
    install_dependencies
    build_project
    validate_build_output
    create_production_package
    install_production_dependencies
    bundle_node_runtime
    bundle_age_runtime
    create_release_sbom
    create_release_manifest
    optimize_package
    validate_production_package
    smoke_test_read_only_database
    create_release_archives
    cleanup
    
    log_success "Build and release process completed successfully!"
    log_info "Version: $VERSION"
    log_info "Artifacts: parako-id-v$VERSION-linux-$RELEASE_ARCH.tar.gz, parako-id-v$VERSION-linux-$RELEASE_ARCH.zip"
}

# Script entry point
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    parse_arguments "$@"
    main
fi
