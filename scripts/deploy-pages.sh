#!/bin/sh
# Build and publish dist/ to the gh-pages branch (GitHub Pages serves that branch).
# Use this while GitHub Actions is unavailable; otherwise .github/workflows/pages.yml
# deploys on every push to main.
set -e
cd "$(dirname "$0")/.."
npm test
npm run build
rev=$(git rev-parse --short HEAD)
remote=$(git remote get-url origin)
tmp=$(mktemp -d)
cp -R dist/. "$tmp"/
touch "$tmp/.nojekyll"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -qm "Deploy Hat Trick $rev"
git push -q -f "$remote" gh-pages
rm -rf "$tmp"
echo "Deployed $rev to gh-pages."
