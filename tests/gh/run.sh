#!/bin/sh
# Black-box gh checks. Requires a running forgit, a token, and an unmodified gh.
# GH_HOST=git.thecomputerplumbers.com GH_ENTERPRISE_TOKEN=fgp_... sh tests/gh/run.sh
set -eu
: "${GH_HOST:?set GH_HOST}"
: "${GH_ENTERPRISE_TOKEN:?set GH_ENTERPRISE_TOKEN}"
owner="${FORGIT_OWNER:-acme}"
repo="gh-smoke-$(date +%s)"
gh auth status --hostname "$GH_HOST"
gh repo create "$owner/$repo" --private --description "compatibility smoke"
gh repo view "$owner/$repo"
workdir=$(mktemp -d)
git clone "https://${GH_HOST}/${owner}/${repo}.git" "$workdir/repo"
cd "$workdir/repo"
git checkout -b feature
echo smoke > NOTE.md
git add NOTE.md && git commit -m "smoke"
git push -u origin feature
gh pr create --title "Smoke" --body "compatibility" --base main --head feature
number=$(gh pr list --json number --jq '.[0].number')
gh pr view "$number"
gh pr diff "$number"
echo "gh smoke created ${owner}/${repo}#${number}"
echo "Approve with a second user, then: gh pr merge ${number} --squash"
