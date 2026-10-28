#!/usr/bin/env bash
# Build a Shufler release locally and print what to publish. It publishes nothing: no tag, no upload, no push.
#
#   packaging/release.sh            build web/dist, the sdist and the wheel into dist/, smoke-test the wheel
#   packaging/release.sh --no-smoke skip the install test (it needs a free port, 4781 or SHUFLER_SMOKE_PORT)
#
# SHUFLER_RELEASE_OUT puts the outputs somewhere else (a temp dir for a trial build).
#
# Outputs, all under dist/ at the repo root unless SHUFLER_RELEASE_OUT is set:
#   shufler-X.Y.Z.tar.gz               sdist with the web app inside; the Homebrew formula installs from this
#   shufler-X.Y.Z-py3-none-any.whl    wheel with the web app inside; pipx, uv tool and install.sh install this
#   shufler.rb                         packaging/homebrew/shufler.rb with this version's URL and sha256 filled in
#   SHA256SUMS
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${SHUFLER_RELEASE_OUT:-$ROOT/dist}"
SMOKE=1
[[ "${1:-}" == "--no-smoke" ]] && SMOKE=0

VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' "$ROOT/daemon/pyproject.toml" | head -n 1)"
WEB_VERSION="$(sed -n 's/^  "version": "\(.*\)",/\1/p' "$ROOT/web/package.json" | head -n 1)"
[[ "$VERSION" == "$WEB_VERSION" ]] || { echo "version mismatch: daemon $VERSION, web $WEB_VERSION" >&2; exit 1; }
cmp -s "$ROOT/LICENSE" "$ROOT/daemon/LICENSE" || { echo "daemon/LICENSE differs from LICENSE; copy it over" >&2; exit 1; }

echo "== web app"
# --force: a no-op re-install with Bun 1.2 on macOS can leave esbuild's binary unsigned (killed on launch)
(cd "$ROOT/web" && bun install --force --frozen-lockfile && bun run build)

echo "== sdist and wheel"
mkdir -p "$OUT"
rm -f "$OUT/shufler-$VERSION.tar.gz" "$OUT/shufler-$VERSION-py3-none-any.whl"
(cd "$ROOT/daemon" && SHUFLER_REQUIRE_WEB=1 uv build --out-dir "$OUT")
SDIST="$OUT/shufler-$VERSION.tar.gz"
WHEEL="$OUT/shufler-$VERSION-py3-none-any.whl"
unzip -l "$WHEEL" | grep 'shufler/web/index.html' >/dev/null || { echo "the wheel has no web app" >&2; exit 1; }
tar tzf "$SDIST" | grep 'shufler/web/index.html' >/dev/null || { echo "the sdist has no web app" >&2; exit 1; }

if [[ "$SMOKE" == 1 ]]; then
  echo "== smoke test"
  "$ROOT/packaging/smoke-test.sh" "$WHEEL" "${SHUFLER_SMOKE_PORT:-4781}"
fi

SHA="$(shasum -a 256 "$SDIST" | cut -d' ' -f1)"
(cd "$OUT" && shasum -a 256 "$(basename "$SDIST")" "$(basename "$WHEEL")" >SHA256SUMS)
sed -e "s|/v[0-9][0-9.]*/shufler-[0-9][0-9.]*\.tar\.gz|/v$VERSION/shufler-$VERSION.tar.gz|" \
    -e "s|sha256 \"[0-9a-fA-FX]*\"|sha256 \"$SHA\"|" \
    "$ROOT/packaging/homebrew/shufler.rb" >"$OUT/shufler.rb"

cat <<EOF

Built Shufler $VERSION in $OUT:
$(cd "$OUT" && cat SHA256SUMS)

To publish (by hand; this script did none of it):
  1. Tag and push:        git tag v$VERSION && git push origin v$VERSION
  2. GitHub release:      gh release create v$VERSION $SDIST $WHEEL $OUT/SHA256SUMS --notes-from-tag
                          (install.sh finds the wheel on the latest release)
  3. PyPI (optional):     uv publish $SDIST $WHEEL   (needs a PyPI token for the 'shufler' project)
  4. Homebrew tap:        copy $OUT/shufler.rb to Formula/shufler.rb in github.com/jgrichardson/homebrew-shufler
                          and push; then: brew tap jgrichardson/shufler && brew install shufler
EOF
