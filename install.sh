#!/bin/sh
# Shufler one-line install:
#
#   curl -fsSL https://raw.githubusercontent.com/jgrichardson/shufler/main/install.sh | sh
#
# What it does, in order (safe to run again; a second run upgrades in place):
#   1. checks for Python 3.11 or newer, and for uv or pipx (uv is preferred);
#   2. installs the `shufler` command with `uv tool install` or `pipx install`, from the wheel attached to the
#      latest GitHub release (the web app is inside it, so no Bun or Node is needed);
#   3. runs `shufler setup`, which picks your terminal and writes ~/.config/shufler/config.toml.
# It never uses sudo and never starts the daemon; `shufler start` does that.
#
# Settings (environment variables):
#   SHUFLER_PACKAGE   what to install instead of the latest release wheel: a version tag (v0.3.0), a wheel URL or
#                     path, or any pip requirement
#   SHUFLER_INSTALLER uv or pipx, to choose when both are present
#   SHUFLER_NO_SETUP  set to 1 to skip `shufler setup`
set -eu

REPO="jgrichardson/shufler"
say() { printf 'shufler-install: %s\n' "$*"; }
die() { printf 'shufler-install: %s\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

case "$(uname -s)" in
  Darwin) ;;
  Linux) say "Linux is not supported yet (tmux works, autostart does not); continuing" ;;
  *) die "unsupported system $(uname -s); Shufler runs on macOS" ;;
esac

# 1. Python and an installer. uv can fetch its own Python, so Python is only required for pipx.
INSTALLER="${SHUFLER_INSTALLER:-}"
if [ -z "$INSTALLER" ]; then
  if has uv; then INSTALLER=uv; elif has pipx; then INSTALLER=pipx; fi
fi
case "$INSTALLER" in
  uv) has uv || die "SHUFLER_INSTALLER=uv but uv is not on PATH" ;;
  pipx) has pipx || die "SHUFLER_INSTALLER=pipx but pipx is not on PATH" ;;
  "")
    say "neither uv nor pipx is installed. Install one, then run this again:"
    if has brew; then say "  brew install uv"; else say "  curl -LsSf https://astral.sh/uv/install.sh | sh"; fi
    say "  (or: brew install pipx && pipx ensurepath)"
    exit 1 ;;
  *) die "SHUFLER_INSTALLER must be uv or pipx, not $INSTALLER" ;;
esac

PYTHON=""
for p in python3.13 python3.12 python3.11 python3; do
  if has "$p" && "$p" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then PYTHON="$(command -v "$p")"; break; fi
done
if [ -z "$PYTHON" ]; then
  [ "$INSTALLER" = uv ] || die "pipx needs Python 3.11 or newer (brew install python@3.13), or install uv instead"
  say "no Python 3.11+ on PATH; uv will download one"
fi

# 2. What to install: the wheel on the latest (or a named) GitHub release, unless SHUFLER_PACKAGE says otherwise.
release_wheel() {
  if [ "$1" = latest ]; then api="https://api.github.com/repos/$REPO/releases/latest"
  else api="https://api.github.com/repos/$REPO/releases/tags/$1"; fi
  curl -fsSL "$api" | grep -Eo '"browser_download_url": *"[^"]+\.whl"' | head -n 1 | sed 's/.*"\(https[^"]*\)"/\1/'
}
SPEC="${SHUFLER_PACKAGE:-latest}"
case "$SPEC" in
  latest|v[0-9]*)
    WHEEL="$(release_wheel "$SPEC" || true)"
    [ -n "$WHEEL" ] || die "no wheel found on the $SPEC release of $REPO; set SHUFLER_PACKAGE, or install from source (see the README)"
    SPEC="$WHEEL" ;;
esac

say "installing $SPEC with $INSTALLER"
if [ "$INSTALLER" = uv ]; then
  if [ -n "$PYTHON" ]; then uv tool install --force --python "$PYTHON" "$SPEC"
  else uv tool install --force --python 3.13 "$SPEC"; fi
  BIN_DIR="$(uv tool dir --bin 2>/dev/null || echo "$HOME/.local/bin")"
else
  pipx install --force --python "$PYTHON" "$SPEC"
  BIN_DIR="$(pipx environment --value PIPX_BIN_DIR 2>/dev/null || echo "$HOME/.local/bin")"
fi

SHUFLER="$BIN_DIR/shufler"
[ -x "$SHUFLER" ] || SHUFLER="$(command -v shufler || true)"
[ -n "$SHUFLER" ] && [ -x "$SHUFLER" ] || die "installed, but no shufler command found in $BIN_DIR"
say "installed $("$SHUFLER" version) at $SHUFLER"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "$BIN_DIR is not on your PATH; add it (uv tool update-shell, or pipx ensurepath) and open a new shell" ;;
esac

# 3. Setup. Under `curl | sh` stdin is the script, so the questions read the terminal; with no terminal at all
# (CI, a script) setup accepts the detected terminal.
if [ "${SHUFLER_NO_SETUP:-0}" = 1 ]; then
  say "skipping setup (SHUFLER_NO_SETUP=1); run: shufler setup"
elif [ -t 0 ]; then
  "$SHUFLER" setup
elif (exec </dev/tty) 2>/dev/null; then
  "$SHUFLER" setup </dev/tty
else
  "$SHUFLER" setup --yes
fi

say "done. Next: shufler start, then open http://127.0.0.1:4700 (shufler status checks it)"
