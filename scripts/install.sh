#!/usr/bin/env bash
#
# DataLex installer — installs the `datalex` CLI via pipx into an isolated
# environment so it lands on your PATH without being shadowed by a stale
# copy in conda/system Python.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/duckcode-ai/DataLex/main/scripts/install.sh | bash
#
# Options (environment variables):
#   DATALEX_EXTRAS   pip extras to install (default: "serve")
#                    e.g. DATALEX_EXTRAS="serve,snowflake" bash install.sh
#
set -euo pipefail

EXTRAS="${DATALEX_EXTRAS:-serve}"
PKG="datalex-cli[${EXTRAS}]"

info()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()   { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# --- locate a usable Python 3.9+ -------------------------------------------
PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] >= (3, 9) else 1)' 2>/dev/null; then
      PY="$candidate"
      break
    fi
  fi
done
[ -n "$PY" ] || die "Python 3.9+ is required but was not found on PATH."
ok "Using $("$PY" --version 2>&1) at $(command -v "$PY")"

# --- ensure pipx ------------------------------------------------------------
if ! command -v pipx >/dev/null 2>&1; then
  info "pipx not found — installing it for the current user…"
  "$PY" -m pip install --user --upgrade pipx >/dev/null
  "$PY" -m pipx ensurepath >/dev/null 2>&1 || true
  PIPX=("$PY" -m pipx)
else
  PIPX=(pipx)
fi

# --- install / upgrade ------------------------------------------------------
if "${PIPX[@]}" list 2>/dev/null | grep -q "datalex-cli"; then
  info "Existing install found — upgrading…"
  "${PIPX[@]}" install --force "$PKG"
else
  info "Installing ${PKG}…"
  "${PIPX[@]}" install "$PKG"
fi

# --- verify -----------------------------------------------------------------
if command -v datalex >/dev/null 2>&1; then
  ok "Installed: $(datalex --version 2>&1)"
  echo
  echo "Get started:"
  echo "    datalex serve            # launch the web UI + API on :3030"
  echo "    datalex doctor           # diagnose your environment"
  echo "    datalex upgrade          # update to the latest release"
else
  warn "datalex is installed but not yet on PATH."
  warn "Open a new terminal (or run: $PY -m pipx ensurepath) and try: datalex --version"
fi
