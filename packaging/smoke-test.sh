#!/usr/bin/env bash
# Install a built Shufler wheel into a fresh venv under a throwaway HOME and check that it runs:
# version, setup, the daemon on a spare port, the web app and the health check. Touches nothing outside the temp dir.
#
#   packaging/smoke-test.sh dist/shufler-X.Y.Z-py3-none-any.whl [port]
#
# PYTHON picks the interpreter for the venv (default python3, which must be 3.11 or newer).
set -euo pipefail

WHEEL="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
PORT="${2:-4781}"
PY="${PYTHON:-python3}"
TMP="$(mktemp -d)"
export HOME="$TMP/home" SHUFLER_PORT="$PORT" SHUFLER_LAUNCHD_LABEL="dev.shufler.smoke-$PORT"
unset SHUFLER_CONFIG
mkdir -p "$HOME"
BIN="$TMP/venv/bin"

cleanup() {
  if [[ -x "$BIN/shufler" ]]; then "$BIN/shufler" stop >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
  echo "smoke: FAIL: $*" >&2
  local log
  for log in "$HOME/Library/Logs/shufler.log" "$HOME/.cache/shufler/shufler.log"; do
    if [[ -f "$log" ]]; then tail -20 "$log" >&2; fi
  done
  exit 1
}

if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then fail "port $PORT is already in use"; fi

"$PY" -m venv "$TMP/venv"
"$BIN/python" -m pip install --quiet --disable-pip-version-check "$WHEEL"
cd "$TMP"  # away from any checkout, so only the installed package can be imported

"$BIN/shufler" version | grep -Eq '^shufler [0-9]' || fail "shufler version"
"$BIN/shufler" setup --help | grep -- '--terminal' >/dev/null || fail "shufler setup --help"
"$BIN/shufler" setup --yes >/dev/null || fail "shufler setup --yes"
[[ -f "$HOME/.config/shufler/config.toml" ]] || fail "setup wrote no config"
"$BIN/shufler" mcp --print-config | grep -F 'args = ["mcp"]' >/dev/null || fail "shufler mcp --print-config"
"$BIN/shufler" start || fail "shufler start"

page="$(curl -fsS "http://127.0.0.1:$PORT/")" || fail "GET /"
grep -q 'id="root"' <<<"$page" || fail "the web app is not served"
asset="$(grep -Eo '/assets/[^"]+\.js' <<<"$page" | head -1 || true)"
[[ -n "$asset" ]] || fail "no script in the served page"
curl -fsS -o /dev/null "http://127.0.0.1:$PORT$asset" || fail "the web app's script $asset"
curl -fsS "http://127.0.0.1:$PORT/api/health" | "$BIN/python" -c 'import json,sys; json.load(sys.stdin)' \
  || fail "/api/health"
"$BIN/shufler" status >/dev/null || fail "shufler status"
init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
printf '%s\n' "$init" | "$BIN/shufler" mcp 2>/dev/null | grep -F '"serverInfo"' >/dev/null || fail "shufler mcp initialize"
"$BIN/shufler" stop
if curl -fsS --max-time 1 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then fail "still answering after stop"; fi

echo "smoke: ok ($("$BIN/shufler" version), port $PORT, web app served)"
