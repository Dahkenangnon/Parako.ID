#!/bin/bash

# Parako.ID Build and Release Script
# This script handles the complete build and release process for production deployment
# Usage: ./scripts/release.sh <version> [options]

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse command line arguments
VERSION=""
DRY_RUN="false"
VERBOSE="false"

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
            exit 1
            ;;
        *)
            if [[ -z "$VERSION" ]]; then
                VERSION="$1"
            else
                log_error "Unexpected argument: $1"
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$VERSION" ]]; then
    log_error "Version is required"
    show_help
    exit 1
fi

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
    if [[ $# -eq 0 ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
        show_help
        exit 0
    fi

    VERSION="$1"
    shift

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
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    if [[ -z "$VERSION" ]]; then
        log_error "Version is required"
        show_help
        exit 1
    fi
}

# Validation functions
validate_environment() {
    log_step "Environment Validation"
    
    # Check required tools
    local required_tools=("node" "pnpm" "tar" "zip")
    for tool in "${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            log_error "$tool is required but not installed"
            exit 1
        fi
    done

    # Check Node.js version
    local node_version=$(node --version | sed 's/v//')
    local node_major=$(echo "$node_version" | cut -d. -f1)
    if [[ $node_major -lt 22 ]]; then
        log_error "Node.js version $node_version detected. Minimum required version is 22.x"
        exit 1
    fi

    # Check pnpm version (project requires pnpm 11+)
    local pnpm_version=$(pnpm --version)
    local pnpm_major=$(echo "$pnpm_version" | cut -d. -f1)
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

    # Verify required build tools are available by checking versions.
    # pnpm exec runs the locally-installed binary whether it lives in
    # dependencies or devDependencies.
    log_info "Verifying build tools..."

    # Check TypeScript (in devDependencies)
    pnpm exec tsc --version || { log_error "TypeScript not found"; exit 1; }
    log_info "TypeScript version: $(pnpm exec tsc --version)"

    # Check TailwindCSS (in devDependencies)
    pnpm exec tailwindcss --version || { log_error "TailwindCSS not found"; exit 1; }
    log_info "TailwindCSS version: $(pnpm exec tailwindcss --version)"

    # Build with error handling and validation using package.json build script.
    # Note: This includes lint:check and test:run which require dev dependencies.
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
        "dist/scripts/manage/client.js"
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
    # ecosystem.config.cjs now lives under runtime/ and is copied along with the
    # rest of the runtime tree below (no separate cp needed).
    cp README.md "$release_dir/"
    cp THIRD_PARTY_LICENSES.txt "$release_dir/" 2>/dev/null || log_warning "THIRD_PARTY_LICENSES.txt not found"
    
    # Copy runtime directory and sanitize it. The installer's minimal-deployer
    # model (docs/installer.md) preserves operator-owned runtime/ wholesale and
    # only populates {locales, views, assets} on FIRST install. Strip anything
    # operator-owned out of the shipped tarball so:
    #   - the installer's first-install allowlist matches what's on disk;
    #   - operators cannot accidentally pick up a stale .env, JWKS, DB file,
    #     uploads, logs, or PM2 ecosystem from someone else's checkout.
    if [[ -d "runtime" ]]; then
        cp -r runtime "$release_dir/"
        # Strict allowlist of what stays under release_dir/runtime/.
        find "$release_dir/runtime" -maxdepth 1 -mindepth 1 \
             ! -name 'locales' ! -name 'views' ! -name 'assets' \
             -exec rm -rf {} + 2>/dev/null || true
        log_info "Sanitized release_dir/runtime/ (kept: locales, views, assets)"
    else
        log_error "runtime/ directory not found — artifact will be broken"
        exit 1
    fi

    # Ship the parako operator binary AND sample configuration files inside
    # the tarball under contrib/. Samples are NOT placed at the tarball root
    # so they cannot be mistaken for operator-owned files; the installer's
    # next-steps card points operators to contrib/ for the copy-edit step.
    # NOTE: this is the deliberate exception to "no installer/ files inside
    # the tarball" — only parako.sh ships, never install.sh.
    mkdir -p "$release_dir/contrib"
    if [[ -f "installer/parako.sh" ]]; then
        cp installer/parako.sh "$release_dir/contrib/parako.sh"
        chmod 0755 "$release_dir/contrib/parako.sh"
        log_info "Shipped installer/parako.sh at contrib/parako.sh"
    else
        log_error "installer/parako.sh not found — tarball would not include the parako operator binary"
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
    elif [[ -f "parako.sample.jsonc" ]]; then
        cp parako.sample.jsonc "$release_dir/contrib/parako-rp.sample.jsonc"
        log_info "Shipped parako.sample.jsonc at contrib/parako-rp.sample.jsonc"
    else
        log_warning "no parako-rp.example.json or parako.sample.jsonc found; operators will have to assemble parako-rp.jsonc by hand"
    fi
    if [[ -f "runtime/ecosystem.config.cjs" ]]; then
        cp runtime/ecosystem.config.cjs "$release_dir/contrib/ecosystem.config.cjs.sample"
        log_info "Shipped runtime/ecosystem.config.cjs at contrib/ecosystem.config.cjs.sample"
    else
        log_warning "no runtime/ecosystem.config.cjs found; operators must write their own process-manager config"
    fi

    # Copy essential documentation. Repo paths are canonical lowercase.
    mkdir -p "$release_dir/docs"
    cp docs/deployment.md "$release_dir/docs/" 2>/dev/null || log_warning "docs/deployment.md not found"
    cp docs/quickstart.md "$release_dir/docs/" 2>/dev/null || log_warning "docs/quickstart.md not found"
    
    # Create production package.json with ONLY production dependencies
    node -e "
        const pkg = require('./package.json');
        const prodPkg = {
            name: pkg.name,
            version: pkg.version,
            description: pkg.description,
            author: pkg.author,
            license: pkg.license,
            homepage: pkg.homepage,
            repository: pkg.repository,
            bugs: pkg.bugs,
            funding: pkg.funding,
            main: pkg.main,
            bin: pkg.bin,
            engines: pkg.engines,
            type: pkg.type,
            files: pkg.files,
            keywords: pkg.keywords,
            scripts: {
                // 'start' runs node directly; operators wire their own
                // supervisor (systemd / pm2 / docker) and call this if they
                // want, but the installer never invokes it.
                'start': 'node --experimental-specifier-resolution=node dist/src/index.js',
                // 'client', 'keys', 'systemd' remain for operator ad-hoc use.
                // The installer does NOT call any of them.
                'client': 'node dist/scripts/manage/client.js',
                'keys': 'node dist/scripts/manage/keys.js',
                'systemd': 'node dist/scripts/manage/systemd.js',
                // DB management scripts remain for operator ad-hoc use. The
                // installer does NOT call them; release notes tell operators
                // when and how to run migrations.
                'db:push': 'prisma db push --config=prisma.config.ts --accept-data-loss',
                'db:migrate:deploy': 'prisma migrate deploy --config=prisma.config.pg.ts'
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

install_production_dependencies() {
    log_step "Installing Production Dependencies"
    
    cd "$PROJECT_ROOT/parako-id-release"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would run: pnpm install --prod --no-frozen-lockfile"
        return
    fi

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

    # Verify production dependencies
    if [[ ! -d "node_modules" ]] || [[ ! -f "pnpm-lock.yaml" ]]; then
        log_error "Production dependencies validation failed"
        exit 1
    fi
    log_success "Production dependencies installed successfully"

    # Generate third-party licenses summary (best-effort; not release-blocking).
    pnpm licenses list --prod > THIRD_PARTY_LICENSES.txt 2>/dev/null \
        || log_warning "Could not generate third-party licenses summary"
    
    cd "$PROJECT_ROOT"
}

optimize_package() {
    log_step "Optimizing Package Size"
    
    cd "$PROJECT_ROOT/parako-id-release"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would optimize package by removing unnecessary files"
        return
    fi

    # Optimize package size
    log_info "Removing unnecessary files..."
    find node_modules -name "*.md" -type f -delete 2>/dev/null || true
    find node_modules -name "*.txt" -type f -delete 2>/dev/null || true
    find node_modules -name "LICENSE*" -type f -delete 2>/dev/null || true
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
    [[ ! -d "parako-id-release/runtime/assets" ]]                 && missing=1
    [[ ! -f "parako-id-release/contrib/parako.sh" ]]              && missing=1
    [[ ! -f "parako-id-release/contrib/.env.sample" ]]            && missing=1
    [[ ! -f "parako-id-release/contrib/parako-rp.sample.jsonc" ]] && missing=1
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
        [[ ! -d "parako-id-release/runtime/assets" ]]                 && log_error "  - runtime/assets directory"
        [[ ! -f "parako-id-release/contrib/parako.sh" ]]              && log_error "  - contrib/parako.sh (parako operator binary)"
        [[ ! -f "parako-id-release/contrib/.env.sample" ]]            && log_error "  - contrib/.env.sample (operator env sample)"
        [[ ! -f "parako-id-release/contrib/parako-rp.sample.jsonc" ]] && log_error "  - contrib/parako-rp.sample.jsonc (operator RP sample)"
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
    local prod_deps=$(node -e "const pkg=require('./package.json'); console.log(Object.keys(pkg.dependencies||{}).length);")
    local installed_deps=$(find node_modules -maxdepth 1 -type d | wc -l)
    log_info "Production dependencies: $prod_deps"
    log_info "Installed dependencies: $((installed_deps - 1))" # -1 for node_modules itself
    
    # Test CLI with bundled dependencies
    node dist/scripts/manage/client.js --help > /dev/null || { log_error "Client CLI test failed with bundled dependencies"; exit 1; }
    node dist/scripts/manage/keys.js --help > /dev/null || { log_error "Keys CLI test failed"; exit 1; }
    cd ..
    
    log_success "Production package validation completed"
    log_success "Security validation passed - no sensitive files found"
}

create_release_archives() {
    log_step "Creating Release Archives"
    
    cd "$PROJECT_ROOT"
    
    local artifact_name="parako-id-v$VERSION"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "Would create archives:"
        log_info "  - $artifact_name.tar.gz"
        log_info "  - $artifact_name.zip"
        log_info "  - SHA256SUMS"
        return
    fi

    # Create compressed archives
    tar -czf "$artifact_name.tar.gz" parako-id-release/
    zip -r "$artifact_name.zip" parako-id-release/

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
    optimize_package
    validate_production_package
    create_release_archives
    cleanup
    
    log_success "Build and release process completed successfully!"
    log_info "Version: $VERSION"
    log_info "Artifacts: parako-id-v$VERSION.tar.gz, parako-id-v$VERSION.zip"
}

# Script entry point
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main
fi
