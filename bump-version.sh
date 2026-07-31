#!/usr/bin/env bash
# Rewrites the ?v= cache-busting stamp across every file that carries one.
# Run this after changing any .js or .css, before committing.
set -euo pipefail
cd "$(dirname "$0")"
V="${1:-$(date +%Y%m%d)$(printf '%s' "$(git rev-parse --short HEAD 2>/dev/null || echo x)")}"
perl -pi -e "s/\?v=[A-Za-z0-9._-]+/?v=$V/g" index.html big.html app.js big.js
echo "version stamp is now: $V"
grep -h -o '?v=[A-Za-z0-9._-]*' index.html big.html app.js big.js | sort -u
