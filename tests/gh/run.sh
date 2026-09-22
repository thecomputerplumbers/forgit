#!/bin/sh
# Black-box gh checks. Requires a running forgit, a token, and an unmodified gh.
# GH_HOST=git.thecomputerplumbers.com GH_ENTERPRISE_TOKEN=fgp_... FORGIT_OWNER=verify sh tests/gh/run.sh
set -eu
: "${GH_HOST:?set GH_HOST}"
: "${GH_ENTERPRISE_TOKEN:?set GH_ENTERPRISE_TOKEN}"
owner="${FORGIT_OWNER:-acme}"
repo="gh-smoke-$(date +%s)"
gh="${GH_BIN:-gh}"
export GH_HOST GH_ENTERPRISE_TOKEN
"$gh" --version
"$gh" auth status --hostname "$GH_HOST"
"$gh" repo create "$owner/$repo" --private --description "compatibility smoke"
"$gh" repo view "$owner/$repo"
workdir=$(mktemp -d)
git -C "$workdir" init --initial-branch=main repo
cd "$workdir/repo"
git config user.email "gh-smoke@forgit.local"
git config user.name "gh-smoke"
echo smoke > NOTE.md
git add NOTE.md
git commit -m "initial"
url="https://${GH_HOST}/${owner}/${repo}.git"
auth="Authorization: Bearer ${GH_ENTERPRISE_TOKEN}"
git -c "http.extraHeader=${auth}" push "$url" main
git checkout -b feature
echo more >> NOTE.md
git add NOTE.md
git commit -m "smoke"
git -c "http.extraHeader=${auth}" push "$url" feature
git -c "http.extraHeader=${auth}" remote add origin "$url"
"$gh" pr create --title "Smoke" --body "compatibility" --base main --head feature
number=$("$gh" pr list --json number --jq '.[0].number')
"$gh" pr view "$number"
"$gh" pr diff "$number"
echo "gh smoke created ${owner}/${repo}#${number}"
echo "Approve with a second user, then: gh pr merge ${number} --squash"
