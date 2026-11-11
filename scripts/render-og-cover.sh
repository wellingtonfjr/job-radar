#!/usr/bin/env bash
# Renders scripts/og-cover.svg to og-cover.png (1200x630) with headless Chrome.
# Usage: scripts/render-og-cover.sh   (set CHROME=/path/to/chrome to override)
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --screenshot="$PWD/frontend/public/og-cover.png" \
  "file://$PWD/scripts/og-cover.svg"
