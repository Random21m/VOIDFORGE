#!/bin/sh
# Pushes the mutation results so far (mutres/) to the GitLab branch mutres-NAME. Usage: sh tests/mut-push.sh NAME
cd "$(dirname "$0")/.."
git add -f mutres > /dev/null 2>&1
git -c user.name="VOIDFORGE mutation runner" -c user.email="runner@invalid" commit -q -m "mutation results $(date -u +%H:%M) ($(cat mutres/res*.jsonl | wc -l) lines)" > /dev/null 2>&1 || true
git push -q -f -o ci.skip origin "HEAD:refs/heads/mutres-$1"
