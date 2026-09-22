#!/bin/sh
# Live Git transport checks against a deployed or local forgit.
# FORGIT_ORIGIN=https://git.thecomputerplumbers.com FORGIT_TOKEN=fgp_... FORGIT_OWNER=acme FORGIT_REPO=widget sh tests/git/transport.sh
set -eu
: "${FORGIT_ORIGIN:?}"
: "${FORGIT_TOKEN:?}"
: "${FORGIT_OWNER:?}"
: "${FORGIT_REPO:?}"
url="${FORGIT_ORIGIN}/${FORGIT_OWNER}/${FORGIT_REPO}.git"
auth="Authorization: Bearer ${FORGIT_TOKEN}"
git -c http.extraHeader="$auth" ls-remote "$url"
workdir=$(mktemp -d)
git -c http.extraHeader="$auth" clone "$url" "$workdir/repo"
cd "$workdir/repo"
git checkout -b "transport-$(date +%s)"
echo "transport $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> TRANSPORT.txt
git add TRANSPORT.txt
git -c user.email=transport@forgit.local -c user.name=transport commit -m "transport check"
git -c http.extraHeader="$auth" push origin HEAD
echo "clone, commit, and push succeeded"
