#!/bin/sh
# Deploy worker only — run from a temp dir to avoid wrangler picking up index.html as static assets
tmp=$(mktemp -d)
cp worker.js wrangler.toml package.json "$tmp/"
cd "$tmp" && npm install --omit=dev --silent && wrangler deploy
rm -rf "$tmp"
