#!/usr/bin/env sh
# Deploys the last commit to the Raspberry Pi (Git Bash / Linux / macOS).
#   scripts/deploy.sh
# Needs the "billsplit-pi" host in ~/.ssh/config (see README, section "Αυτόματο deploy").
set -eu
cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain)" ] || echo "WARNING: uncommitted changes are not deployed, only the last commit" >&2
git archive --format=tar.gz HEAD | ssh billsplit-pi deploy
