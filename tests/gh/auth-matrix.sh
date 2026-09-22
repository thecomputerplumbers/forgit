#!/bin/sh
# gh auth status for each supported release. Does not need Git storage.
# GH_HOST=git.thecomputerplumbers.com GH_ENTERPRISE_TOKEN=fgp_... GH_BIN_DIR=/path sh tests/gh/auth-matrix.sh
# GH_BIN_DIR may contain gh-2.100.0 and gh-2.87.0, or <version>/gh.
set -eu
: "${GH_HOST:?set GH_HOST}"
: "${GH_ENTERPRISE_TOKEN:?set GH_ENTERPRISE_TOKEN}"
export GH_HOST GH_ENTERPRISE_TOKEN
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-$(mktemp -d)}"
dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
found=0
while IFS= read -r version || [ -n "$version" ]; do
  case "$version" in
    "" | \#*) continue ;;
  esac
  bin=""
  if [ -n "${GH_BIN_DIR:-}" ] && [ -x "$GH_BIN_DIR/gh-$version" ]; then
    bin="$GH_BIN_DIR/gh-$version"
  elif [ -n "${GH_BIN_DIR:-}" ] && [ -x "$GH_BIN_DIR/$version/gh" ]; then
    bin="$GH_BIN_DIR/$version/gh"
  else
    candidate=$(command -v gh || true)
    if [ -n "$candidate" ]; then
      got=$("$candidate" version | awk 'NR==1 { print $3 }')
      if [ "$got" = "$version" ]; then
        bin=$candidate
      fi
    fi
  fi
  if [ -z "$bin" ]; then
    echo "skip $version" >&2
    continue
  fi
  found=$((found + 1))
  echo "== $($bin version | awk 'NR==1 { print $3 }') =="
  status=$("$bin" auth status --hostname "$GH_HOST" --json hosts --jq '.hosts[][0] | {state,login,scopes}')
  echo "$status"
  printf '%s\n' "$status" | grep -q '"state":"success"'
done < "$dir/versions.txt"
if [ "$found" -lt 2 ]; then
  echo "need both supported gh releases; found $found" >&2
  exit 1
fi
