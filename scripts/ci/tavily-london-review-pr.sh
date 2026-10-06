#!/usr/bin/env bash
# Open one review PR for tonight's London Tavily pass, or do nothing.
#
# The pass (npm run enrich:city -- --city=london) writes listed first-party
# prices to public/data/drink_price_updates and a run report to
# data/enrichment/tavily/london. A human reviews that change; this script never
# pushes to a protected branch and never merges.
#
# Run it through scripts/ci/with-git-token.sh so git can push the review branch
# without the token being saved into .git/config.
set -euo pipefail

stamp="$(date -u +%Y%m%d)"
# One branch per run: a manual rerun on the same UTC day must not collide with the
# scheduled run's branch or PR.
branch="tavily-london/${stamp}-$(date -u +%H%M%S)"
paths=(public/data/drink_price_updates data/enrichment/tavily/london)

if [ -z "$(git status --porcelain -- "${paths[@]}")" ]; then
  echo "tavily-london: the pass wrote nothing to review."
  exit 0
fi

git checkout -b "$branch"
git add -- "${paths[@]}"
git commit -m "chore(drink-prices): London Tavily pass ${stamp}"
git push -u origin "$branch"
gh pr create \
  --title "London Tavily pass ${stamp}" \
  --body "Nightly bounded London pass: at most 200 Tavily searches and 400 credits (\$3.20), official pub sites only. Every price carries its first-party source, licence and read time. Review before merge. To reject every row this PR adds, close it and run: npm run tavily:reject -- --city=london --ref=origin/${branch} on a branch from main, then merge data/enrichment/tavily/london/rejected.json. To correct a price, edit it in public/data/drink_price_updates/latest.json on this branch, run: npm run tavily:correct -- --city=london, and commit data/enrichment/tavily/london/corrected.json with it, so no later night overwrites the correction. See docs/TAVILY_LONDON_NIGHTLY.md."
