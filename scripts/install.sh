#!/bin/sh
set -e

# OhMyGoat Coding Agent Installer
# Usage: curl -fSLO https://github.com/edumdp-dev/oh-my-goat/releases/download/ohmg-v0.0.3/install.sh
#        (verify first with: gh attestation verify install.sh --repo edumdp-dev/oh-my-goat --signer-workflow edumdp-dev/oh-my-goat/.github/workflows/release-ohmg.yml --source-ref refs/tags/ohmg-v0.0.3 --deny-self-hosted-runners)
#        then: sh install.sh
#        or quick: curl -fsSL https://ohmygoat.vercel.app/install | sh
#
# Options:
#   --source       Install via bun (installs bun if needed)
#   --binary       Install prebuilt binary (default)
#   --ref <ref>    Install specific release tag (default: ohmg-v0.0.3)
#   -r <ref>       Shorthand for --ref

REPO="edumdp-dev/oh-my-goat"
DEFAULT_TAG="ohmg-v0.0.3"
BIN_NAME="ohmg"
INSTALL_DIR="${PI_INSTALL_DIR:-$HOME/.local/bin}"
MIN_BUN_VERSION="1.3.14"

# Parse arguments
MODE=""
REF=""
while [ $# -gt 0 ]; do
    case "$1" in
        --source)
            MODE="source"
            shift
            ;;
        --binary)
            MODE="binary"
            shift
            ;;
        --ref)
            shift
            if [ -z "$1" ]; then
                echo "Missing value for --ref"
                exit 1
            fi
            REF="$1"
            shift
            ;;
        --ref=*)
            REF="${1#*=}"
            if [ -z "$REF" ]; then
                echo "Missing value for --ref"
                exit 1
            fi
            shift
            ;;
        -r)
            shift
            if [ -z "$1" ]; then
                echo "Missing value for -r"
                exit 1
            fi
            REF="$1"
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done


# Check if bun is available
has_bun() {
    command -v bun >/dev/null 2>&1
}

# Normalized host architecture (x64|arm64). On macOS this uses
# `sysctl hw.optional.arm64` so it stays correct inside a Rosetta session,
# where `uname -m` reports the translated x86_64.
host_arch() {
    if [ "$(uname -s)" = "Darwin" ]; then
        if [ "$(sysctl -in hw.optional.arm64 2>/dev/null || /usr/sbin/sysctl -in hw.optional.arm64 2>/dev/null)" = "1" ]; then
            echo "arm64"
        else
            echo "x64"
        fi
        return
    fi
    case "$(uname -m)" in
        x86_64|amd64)  echo "x64" ;;
        arm64|aarch64) echo "arm64" ;;
        *)             uname -m ;;
    esac
}

# Bun's own architecture (x64|arm64), or empty when it can't be determined.
bun_arch() {
    bun -e 'process.stdout.write(process.arch)' 2>/dev/null
}

# True when Bun's architecture matches the host. If Bun's arch can't be read,
# assume a match rather than block the install.
bun_arch_matches_host() {
    ba="$(bun_arch)"
    [ -z "$ba" ] && return 0
    [ "$ba" = "$(host_arch)" ]
}

version_ge() {
    current="$1"
    minimum="$2"

    current_major="${current%%.*}"
    current_rest="${current#*.}"
    current_minor="${current_rest%%.*}"
    current_patch="${current_rest#*.}"
    current_patch="${current_patch%%.*}"

    minimum_major="${minimum%%.*}"
    minimum_rest="${minimum#*.}"
    minimum_minor="${minimum_rest%%.*}"
    minimum_patch="${minimum_rest#*.}"
    minimum_patch="${minimum_patch%%.*}"

    if [ "$current_major" -ne "$minimum_major" ]; then
        [ "$current_major" -gt "$minimum_major" ]
        return $?
    fi

    if [ "$current_minor" -ne "$minimum_minor" ]; then
        [ "$current_minor" -gt "$minimum_minor" ]
        return $?
    fi

    [ "$current_patch" -ge "$minimum_patch" ]
}

require_bun_version() {
    version_raw=$(bun --version 2>/dev/null || true)
    if [ -z "$version_raw" ]; then
        echo "Failed to read bun version"
        exit 1
    fi

    version_clean=${version_raw%%-*}
    if ! version_ge "$version_clean" "$MIN_BUN_VERSION"; then
        echo "Bun ${MIN_BUN_VERSION} or newer is required. Current version: ${version_clean}"
        echo "Upgrade Bun at https://bun.sh/docs/installation"
        exit 1
    fi
}

# Check if git is available
has_git() {
    command -v git >/dev/null 2>&1
}

# Install bun
install_bun() {
    echo "Installing bun..."
    if command -v bash >/dev/null 2>&1; then
        curl -fsSL https://bun.sh/install | bash
    else
        echo "bash not found; attempting install with sh..."
        curl -fsSL https://bun.sh/install | sh
    fi
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    require_bun_version
}

# Check if git-lfs is available
has_git_lfs() {
    command -v git-lfs >/dev/null 2>&1
}

# Install via bun
install_via_bun() {
    echo "Installing via bun..."
    if ! has_git; then
        echo "git is required when installing from source"
        exit 1
    fi

    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT

    if [ -n "$REF" ]; then
        if git clone --depth 1 --branch "$REF" "https://github.com/${REPO}.git" "$TMP_DIR" >/dev/null 2>&1; then
            :
        else
            git clone "https://github.com/${REPO}.git" "$TMP_DIR"
            (cd "$TMP_DIR" && git checkout "$REF")
        fi
    else
        git clone --depth 1 "https://github.com/${REPO}.git" "$TMP_DIR" || {
            echo "Failed to clone ${REPO}"
            exit 1
        }
    fi

    # Pull LFS files
    if has_git_lfs; then
        (cd "$TMP_DIR" && git lfs pull)
    fi

    if [ ! -d "$TMP_DIR/packages/coding-agent" ]; then
        echo "Expected package at ${TMP_DIR}/packages/coding-agent"
        exit 1
    fi

    bun install -g "$TMP_DIR/packages/coding-agent" || {
        echo "Failed to install from source"
        exit 1
    }
    echo ""
    echo "✓ Installed ${BIN_NAME} via bun"
    echo "Run '${BIN_NAME}' to get started!"
}

# Print the SHA-256 hex digest of a file using whatever tool the host has.
hash_file() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        echo "No SHA-256 tool found (need sha256sum or shasum)" >&2
        return 1
    fi
}

# Download a release asset to a destination that must not already exist.
# Never overwrites: re-installs keep the user's own files untouched.
seed_preset() {
    SEED_TAG="$1"; SEED_ASSET="$2"; SEED_DEST="$3"
    if [ -e "$SEED_DEST" ]; then
        echo "Keeping existing $(basename "$SEED_DEST")"
        return 0
    fi
    echo "Seeding $(basename "$SEED_DEST") from release ${SEED_TAG}..."
    SEED_TMP="${SEED_DEST}.part"
    if ! curl -fsSL --connect-timeout 10 --max-time 60 "https://github.com/${REPO}/releases/download/${SEED_TAG}/${SEED_ASSET}" -o "$SEED_TMP"; then
        echo "Warning: could not seed $(basename "$SEED_DEST"); ${BIN_NAME} will create defaults on first run."
        rm -f "$SEED_TMP"
        return 0
    fi
    # Presets are attested release assets too: never seed an unverified file.
    SEED_EXPECTED="$(grep -F "  ${SEED_ASSET}" "$SUMS_FILE" | awk '{print $1}' || true)"
    if [ -n "$SEED_EXPECTED" ]; then
        SEED_ACTUAL="$(hash_file "$SEED_TMP" || true)"
        if [ "$SEED_ACTUAL" != "$SEED_EXPECTED" ]; then
            echo "Warning: checksum mismatch for ${SEED_ASSET}; not seeding." >&2
            rm -f "$SEED_TMP"
            return 0
        fi
    fi
    mv -f "$SEED_TMP" "$SEED_DEST"
}

# Install binary from GitHub releases
install_binary() {
    # Detect platform
    OS="$(uname -s)"
    ARCH="$(host_arch)"

    case "$OS" in
        Linux)  PLATFORM="linux" ;;
        Darwin) PLATFORM="darwin" ;;
        *)      echo "Unsupported OS: $OS"; exit 1 ;;
    esac

    case "$ARCH" in
        x64|arm64) ;;
        *)         echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac

    if [ "$PLATFORM" = "linux" ]; then
        if [ -f /etc/alpine-release ] || { command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; }; then
            PLATFORM="linux-musl"
        fi
    fi

    BINARY="${BIN_NAME}-${PLATFORM}-${ARCH}"
    OUT="${INSTALL_DIR}/${BIN_NAME}"
    AGENT_DIR="$HOME/.ohmg/agent"

    TAG="${REF:-$DEFAULT_TAG}"
    echo "Using version: $TAG"

    if ! command -v curl >/dev/null 2>&1; then
        echo "curl is required to download the ${BIN_NAME} release"
        exit 1
    fi

    mkdir -p "$INSTALL_DIR"
    TMP_BIN="${OUT}.new-$$"
    SUMS_FILE="$(mktemp)"
    cleanup() { rm -f "$SUMS_FILE" "$TMP_BIN"; }
    trap cleanup EXIT

    # Resolve the release's checksum manifest first: the asset must be listed
    # there, otherwise there is nothing safe to install (e.g. this release
    # ships no musl asset, so a musl host stops here instead of fetching a
    # binary that could never run).
    SUMS_URL="https://github.com/${REPO}/releases/download/${TAG}/SHA256SUMS.txt"
    echo "Fetching SHA256SUMS.txt for ${TAG}..."
    if ! curl -fsSL --connect-timeout 10 --max-time 60 "$SUMS_URL" -o "$SUMS_FILE"; then
        echo "Failed to download SHA256SUMS.txt for release $TAG"
        echo "Check that the release exists: https://github.com/${REPO}/releases/tag/${TAG}"
        exit 1
    fi

    EXPECTED="$(grep -F "  ${BINARY}" "$SUMS_FILE" | awk '{print $1}' || true)"
    if [ -z "$EXPECTED" ]; then
        echo "Release $TAG has no asset named $BINARY"
        exit 1
    fi

    # Download to a temp path in the install dir and verify before anything
    # is replaced, so a failed download can never break a working install.
    BINARY_URL="https://github.com/${REPO}/releases/download/${TAG}/${BINARY}"
    echo "Downloading ${BINARY}..."
    curl -fsSL --connect-timeout 10 --speed-limit 1024 --speed-time 30 "$BINARY_URL" -o "$TMP_BIN"
    chmod +x "$TMP_BIN"

    ACTUAL="$(hash_file "$TMP_BIN" || true)"
    if [ "$ACTUAL" != "$EXPECTED" ]; then
        echo "Checksum mismatch for ${BINARY}:"
        echo "  expected: $EXPECTED"
        echo "  actual:   ${ACTUAL:-<unavailable>}"
        echo "Aborting without touching the installed ${BIN_NAME}."
        exit 1
    fi
    echo "Checksum OK"

    # Smoke-test the download before it replaces anything: a binary that
    # cannot start must never replace a working install.
    if ! SMOKE_OUTPUT="$("$TMP_BIN" --version 2>&1)"; then
        echo ""
        echo "✗ ${BINARY} was downloaded but cannot start:"
        echo "$SMOKE_OUTPUT" | sed 's/^/    /'
        if [ "$PLATFORM" = "linux-musl" ]; then
            echo ""
            echo "This release ships glibc Linux binaries only; musl hosts are not covered."
        fi
        exit 1
    fi

    # Atomic replacement, then a post-install smoke test on the final launcher.
    mv -f "$TMP_BIN" "$OUT"
    if ! SMOKE_OUTPUT="$("$OUT" --version 2>&1)"; then
        echo ""
        echo "✗ Installed ${OUT} but it cannot start:"
        echo "$SMOKE_OUTPUT" | sed 's/^/    /'
        exit 1
    fi

    echo ""
    echo "✓ Installed ${BIN_NAME} (${SMOKE_OUTPUT}) to ${OUT}"

    # Seed the portable preset and model catalog, but never overwrite the
    # user's own files. Sources are the release assets pinned to this tag —
    # never the main branch, never ~/.omp.
    mkdir -p "$AGENT_DIR"
    if [ ! -e "$AGENT_DIR/config.yml" ] && [ ! -e "$AGENT_DIR/config.yaml" ]; then
        seed_preset "$TAG" "ohmygoat.config.yml" "$AGENT_DIR/config.yml"
    else
        echo "Keeping existing agent config"
    fi
    seed_preset "$TAG" "ohmygoat.models.yml" "$AGENT_DIR/models.yml"

    trap - EXIT
    cleanup

    # Check if in PATH
    case ":$PATH:" in
        *":$INSTALL_DIR:"*) echo "Run '${BIN_NAME}' to get started!" ;;
        *) echo "Add ${INSTALL_DIR} to your PATH, then run '${BIN_NAME}'" ;;
    esac
}

# Main logic
case "$MODE" in
    source)
        if ! has_bun; then
            install_bun
        fi
        require_bun_version
        if ! bun_arch_matches_host; then
            echo "Error: bun reports architecture '$(bun_arch)' but this host is '$(host_arch)'."
            echo "Installing from source with this bun would produce a mismatched binary"
            echo "(e.g. x86_64 under Rosetta on Apple Silicon), causing slow startup and AVX warnings."
            echo "Install a native bun for your architecture, or re-run without --source to fetch the prebuilt $(host_arch) binary."
            exit 1
        fi
        install_via_bun
        ;;
    binary)
        install_binary
        ;;
    *)
        # Default: install the prebuilt binary.
        install_binary
        ;;
esac
