#!/bin/sh
set -eu

REPO="timescale/timecalc-mcp"
BINARY="timecalc"
MAX_RETRIES=3
TMPDIR_PATH=""
TEMPORARY_DESTINATION=""

if [ -t 1 ]; then
  BOLD='\033[1m'
  GREEN='\033[32m'
  RED='\033[31m'
  YELLOW='\033[33m'
  CYAN='\033[36m'
  RESET='\033[0m'
else
  BOLD='' GREEN='' RED='' YELLOW='' CYAN='' RESET=''
fi

main() {
  check_dependencies

  os="$(detect_os)"
  arch="$(detect_arch)"
  check_extractor "$os"
  if [ "$os" = "darwin" ] && [ "$arch" = "amd64" ]; then
    err "macOS Intel (AMD64) is not supported; use an Apple Silicon Mac."
  fi

  target="${os}-${arch}"
  case "$os" in
    windows) archive_extension="zip" ;;
    *) archive_extension="tar.gz" ;;
  esac

  if [ -n "${TIMECALC_VERSION:-}" ]; then
    version="$(normalize_version "$TIMECALC_VERSION")"
  else
    version="$(fetch_latest_version)"
  fi

  archive_name="${BINARY}-${version}-${target}.${archive_extension}"
  release_url="https://github.com/${REPO}/releases/download/${version}"
  archive_url="${release_url}/${archive_name}"
  checksums_url="${release_url}/SHA256SUMS"
  install_dir="$(resolve_install_dir)"

  TMPDIR_PATH="$(mktemp -d "${TMPDIR:-/tmp}/timecalc-install.XXXXXX")"
  trap cleanup 0
  trap 'exit 1' 1 2 15
  archive_path="${TMPDIR_PATH}/${archive_name}"
  checksums_path="${TMPDIR_PATH}/SHA256SUMS"
  extract_dir="${TMPDIR_PATH}/extract"
  mkdir -p "$extract_dir"

  info "Installing ${BOLD}${BINARY} ${version#v}${RESET} (${target})"
  info "Downloading ${CYAN}${archive_url}${RESET}"
  download_with_retry "$archive_url" "$archive_path"
  download_with_retry "$checksums_url" "$checksums_path"

  info "Verifying SHA-256 checksum"
  verify_checksum "$archive_path" "$archive_name" "$checksums_path"

  case "$archive_extension" in
    zip) unzip -q "$archive_path" -d "$extract_dir" ;;
    tar.gz) tar -xzf "$archive_path" -C "$extract_dir" ;;
  esac

  if [ "$os" = "windows" ]; then
    source_binary="${extract_dir}/${BINARY}.exe"
    destination="${install_dir}/${BINARY}.exe"
  else
    source_binary="${extract_dir}/${BINARY}"
    destination="${install_dir}/${BINARY}"
  fi
  [ -f "$source_binary" ] || err "Release archive does not contain the expected ${BINARY} executable"

  if [ "$os" = "darwin" ]; then
    prepare_macos_binary "$source_binary"
  fi

  mkdir -p "$install_dir"
  TEMPORARY_DESTINATION="${destination}.tmp.$$"
  cp "$source_binary" "$TEMPORARY_DESTINATION"
  chmod 0755 "$TEMPORARY_DESTINATION"
  mv -f "$TEMPORARY_DESTINATION" "$destination"
  TEMPORARY_DESTINATION=""

  success "Installed ${BOLD}${BINARY}${RESET} to ${BOLD}${destination}${RESET}"

  case ":${PATH}:" in
    *":${install_dir}:"*) ;;
    *)
      warn "${install_dir} is not on PATH. Add it to your shell configuration:"
      printf '    export PATH="%s:$PATH"\n\n' "$install_dir" >&2
      ;;
  esac

  printf "  Run '${BOLD}%s --help${RESET}' to get started.\n\n" "$destination"
}

check_dependencies() {
  [ -n "${HOME:-}" ] || err "HOME must be set"
  command -v curl >/dev/null 2>&1 || err "curl is required"
  command -v mktemp >/dev/null 2>&1 || err "mktemp is required"

  if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1; then
    err "sha256sum or shasum is required for checksum verification"
  fi
}

check_extractor() {
  case "$1" in
    windows) command -v unzip >/dev/null 2>&1 || err "unzip is required on Windows" ;;
    darwin)
      command -v tar >/dev/null 2>&1 || err "tar is required"
      command -v codesign >/dev/null 2>&1 || err "codesign is required on macOS"
      ;;
    *) command -v tar >/dev/null 2>&1 || err "tar is required" ;;
  esac
}

detect_os() {
  case "$(uname -s)" in
    Linux*) echo "linux" ;;
    Darwin*) echo "darwin" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) err "Unsupported operating system: $(uname -s)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64|AMD64) echo "amd64" ;;
    arm64|aarch64|ARM64) echo "arm64" ;;
    *) err "Unsupported architecture: $(uname -m)" ;;
  esac
}

resolve_install_dir() {
  if [ -n "${TIMECALC_INSTALL_DIR:-}" ]; then
    printf '%s\n' "$TIMECALC_INSTALL_DIR"
  elif [ -d "$HOME/.local/bin" ] || [ -d "$HOME/.local" ]; then
    printf '%s\n' "$HOME/.local/bin"
  else
    printf '%s\n' "$HOME/bin"
  fi
}

fetch_latest_version() {
  effective_url="$(curl -sSfL -o /dev/null -w '%{url_effective}' \
    "https://github.com/${REPO}/releases/latest")" || err "Failed to determine the latest release"
  version="${effective_url##*/}"
  normalize_version "$version"
}

normalize_version() {
  version="$1"
  case "$version" in
    v*) ;;
    *) version="v${version}" ;;
  esac
  if ! printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
    err "Invalid version '${1}'; expected X.Y.Z or vX.Y.Z"
  fi
  printf '%s\n' "$version"
}

download_with_retry() {
  url="$1"
  output="$2"
  attempt=1

  while [ "$attempt" -le "$MAX_RETRIES" ]; do
    if curl -sSfL "$url" -o "$output"; then
      return 0
    fi
    if [ "$attempt" -lt "$MAX_RETRIES" ]; then
      delay=$((attempt * attempt))
      warn "Download failed (attempt ${attempt}/${MAX_RETRIES}); retrying in ${delay}s"
      sleep "$delay"
    fi
    attempt=$((attempt + 1))
  done

  err "Download failed after ${MAX_RETRIES} attempts: ${url}"
}

prepare_macos_binary() {
  binary="$1"
  entitlements="${TMPDIR_PATH}/timecalc-entitlements.plist"
  cat > "$entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-executable-page-protection</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
PLIST

  info "Applying the macOS ad-hoc signature and JIT entitlements"
  codesign --remove-signature "$binary" 2>/dev/null || true
  codesign --entitlements "$entitlements" --force --deep --sign - "$binary"
  codesign --verify --deep --strict "$binary"
  if command -v xattr >/dev/null 2>&1; then
    xattr -d com.apple.quarantine "$binary" 2>/dev/null || true
  fi
}

verify_checksum() {
  file="$1"
  filename="$2"
  checksums="$3"
  expected="$(awk -v name="$filename" '$2 == name || $2 == ("*" name) { print $1; exit }' "$checksums")"
  [ -n "$expected" ] || err "No checksum found for ${filename}"

  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{ print $1 }')"
  else
    actual="$(shasum -a 256 "$file" | awk '{ print $1 }')"
  fi

  [ "$expected" = "$actual" ] || err "Checksum mismatch for ${filename}\n  expected: ${expected}\n  actual:   ${actual}"
  success "Checksum verified"
}

cleanup() {
  if [ -n "$TMPDIR_PATH" ] && [ -d "$TMPDIR_PATH" ]; then
    rm -rf "$TMPDIR_PATH"
  fi
  if [ -n "$TEMPORARY_DESTINATION" ]; then
    rm -f "$TEMPORARY_DESTINATION"
  fi
}

info() { printf "${CYAN}=>${RESET} %b\n" "$*"; }
success() { printf "${GREEN}=>${RESET} %b\n" "$*"; }
warn() { printf "${YELLOW}warning:${RESET} %b\n" "$*" >&2; }
err() { printf "${RED}error:${RESET} %b\n" "$*" >&2; exit 1; }

main "$@"
