#!/usr/bin/env bash
# Builds www/ — the Capacitor webDir — from the single source-of-truth files
# at the project root. There is still no bundler: this is a plain copy step,
# plus one small text substitution (the Capacitor bridge script tag) and one
# safety check (no secrets end up in what gets copied).
#
# Run via `npm run build:web`. Safe to re-run any time; always wipes and
# recreates www/ from the current source files.
set -euo pipefail
cd "$(dirname "$0")/.."

WWW_DIR="www"
rm -rf "$WWW_DIR"
mkdir -p "$WWW_DIR"

# Root-level app files: every .js/.html/.css/.json/.png/.svg/.ttf at the
# project root EXCEPT tests, config examples and dev files (2026-10-13 — the
# old hand-kept list had silently fallen weeks behind the web app, so the
# iPhone build would have shipped without Community, Studio, Sketch, Fidget…).
shopt -s nullglob
for f in *.js *.html *.css *.json *.png *.svg *.ttf *.webmanifest; do
  case "$f" in
    *.test.js|*.test.mjs|config.example.js|package.json|package-lock.json|capacitor.config.json|tsconfig*.json) continue ;;
  esac
  cp "$f" "$WWW_DIR/$f"
done
# Static asset folders the pages reference.
for dir in assets; do
  [ -d "$dir" ] && cp -R "$dir" "$WWW_DIR/$dir"
done

# shared/, web/, native/ — the Capacitor-aware logic layer added on top of
# the existing engines above. Mirrors the source directory structure.
for dir in shared web native; do
  if [ -d "$dir" ]; then
    mkdir -p "$WWW_DIR/$dir"
    cp "$dir"/*.js "$WWW_DIR/$dir/" 2>/dev/null || true
  fi
done

# Swap the build-time anchor for the real Capacitor bridge script tag. Only
# www/index.html is touched — the source index.html at the project root
# (what Cloudflare Pages actually deploys) is never modified by this script.
# All the shared/web/native script tags are already IN the source index.html
# (the web deployment needs them too, since app.js unconditionally references
# NavBridge) — nothing else needs injecting here.
perl -0pi -e 's/<!-- CAPACITOR_BRIDGE -->.*?-->/<script src="capacitor.js"><\/script>/s' "$WWW_DIR/index.html"

# Safety net: fail loudly if anything resembling a secret leaked in.
if grep -RIl "GRAPHHOPPER_API_KEY\s*=\s*['\"][A-Za-z0-9_-]\{10,\}" "$WWW_DIR" 2>/dev/null | grep -v config.example.js; then
  echo "REFUSING TO BUILD: something in $WWW_DIR looks like a real API key. Aborting." >&2
  exit 1
fi

echo "Built $WWW_DIR/ ($(find "$WWW_DIR" -type f | wc -l | tr -d ' ') files)."
