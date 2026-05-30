#!/bin/bash

# Parako.ID Build and Release Script
# This script handles the complete build and release process for production deployment
# Usage: ./scripts/release.sh <version> [options]

set -euo pipefail

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

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
        "dist/scripts/manage/update.js"
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
    cp ecosystem.config.cjs "$release_dir/"
    cp README.md "$release_dir/"
    cp THIRD_PARTY_LICENSES.txt "$release_dir/" 2>/dev/null || log_warning "THIRD_PARTY_LICENSES.txt not found"
    
    # Copy runtime directory (locales, views, assets, config-backups)
    if [[ -d "runtime" ]]; then
        cp -r runtime "$release_dir/"
        # Remove any existing key material (security: keys must be generated fresh)
        rm -f "$release_dir/runtime/jwks/"*.json 2>/dev/null || true
        rm -f "$release_dir/runtime/jwks/"*.pem 2>/dev/null || true
        log_info "Copied runtime/ (locales, views, assets)"
    else
        log_error "runtime/ directory not found — artifact will be broken"
        exit 1
    fi

    # Copy .env.example for first-run configuration
    cp .env.example "$release_dir/"

    # Copy sample config files (reference for users)
    cp parako.sample.jsonc "$release_dir/" 2>/dev/null || log_warning "parako.sample.jsonc not found"

    # Create empty runtime directories (security: no existing data copied)
    mkdir -p "$release_dir/logs"

    # Create empty upload directories at the new runtime/ location
    mkdir -p "$release_dir/runtime/uploads" "$release_dir/runtime/.tmp-uploads"
    # Note: Upload directories are created empty for security
    
    # Copy essential documentation
    mkdir -p "$release_dir/docs"
    cp docs/DEPLOYMENT.md "$release_dir/docs/" 2>/dev/null || log_warning "DEPLOYMENT.md not found"
    cp docs/QUICK-START.md "$release_dir/docs/" 2>/dev/null || log_warning "QUICK-START.md not found"
    
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
                'start': 'node --experimental-specifier-resolution=node dist/src/index.js',
                'restart': 'pm2 startOrRestart ecosystem.config.cjs --env production && pm2 save',
                'client': 'node dist/scripts/manage/client.js',
                'keys': 'node dist/scripts/manage/keys.js',
                'systemd': 'node dist/scripts/manage/systemd.js',
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
        log_info "Would run: pnpm install --prod --frozen-lockfile --silent"
        return
    fi

    # Install production dependencies. pnpm uses --prod (not --production)
    # and prunes devDependencies in the same step.
    pnpm install --prod --frozen-lockfile --silent || {
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
    if [[ ! -d "parako-id-release/dist/src" ]] || [[ ! -d "parako-id-release/dist/scripts" ]] || [[ ! -d "parako-id-release/dist/src/views" ]] || [[ ! -d "parako-id-release/node_modules" ]] || [[ ! -f "parako-id-release/pnpm-lock.yaml" ]] || [[ ! -d "parako-id-release/runtime/locales" ]]; then
        log_error "Production package validation failed"
        log_error "Missing:"
        [[ ! -d "parako-id-release/dist/src" ]] && log_error "  - dist/src directory"
        [[ ! -d "parako-id-release/dist/scripts" ]] && log_error "  - dist/scripts directory"
        [[ ! -d "parako-id-release/dist/src/views" ]] && log_error "  - dist/src/views directory"
        [[ ! -d "parako-id-release/node_modules" ]] && log_error "  - node_modules directory"
        [[ ! -f "parako-id-release/pnpm-lock.yaml" ]] && log_error "  - pnpm-lock.yaml file"
        [[ ! -d "parako-id-release/runtime/locales" ]] && log_error "  - runtime/locales directory"
        exit 1
    fi
    
    # Security validation
    log_info "Running security validation..."
    
    # Check for sensitive files in production package
    local sensitive_patterns=(".env" ".env.local" ".env.production" ".env.staging" "*.key" "*.pem" "*.p12" "*.pfx" "*.map" "parako.jsonc" "parako-rp.jsonc")
    for pattern in "${sensitive_patterns[@]}"; do
        if find "parako-id-release" -name "$pattern" -type f 2>/dev/null | grep -q .; then
            log_error "SECURITY VIOLATION: Found sensitive file in production package: $pattern"
            find "parako-id-release" -name "$pattern" -type f 2>/dev/null | while read -r file; do
                log_error "  - $file"
            done
            exit 1
        fi
    done
    
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
