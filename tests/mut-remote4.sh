#!/bin/sh
# Release mutation run on another machine (not part of the release): runs shards FIRST..FIRST+COUNT-1 of the suite split N ways,
# side by side, with the two-step method (tests/fixtures/mut-plan.json must have been made for this exact page). It refuses to
# start unless voidforge.html is the frozen file named in SHA256SUMS. Results go to the GitLab branch mutres-NAME every 10
# minutes and at the end. Usage: sh tests/mut-remote4.sh FIRST COUNT N NAME
set -e
FIRST=$1; COUNT=$2; N=$3; NAME=$4
cd "$(dirname "$0")/.."
sha256sum -c SHA256SUMS
[ -d node_modules ] || npm ci --ignore-scripts --no-audit --no-fund > /dev/null
mkdir -p mutres
i=$FIRST
while [ $i -lt $((FIRST + COUNT)) ]; do
  MUT_SHARD=$i/$N MUT_RESULTS=mutres/res$i.jsonl setsid nohup node tests/mutation.test.mjs >> mutres/log$i.txt 2>&1 < /dev/null &
  i=$((i + 1))
done
sleep 5
grep -h "step A map\|step A1 hints\|every mutation runs the full probe" mutres/log*.txt | sort | uniq -c || true
while [ "$(pgrep -fc 'node tests/mutation.test.mjs')" -gt 0 ]; do
  sh tests/mut-push.sh "$NAME" || true
  sleep 600
done
sh tests/mut-push.sh "$NAME"
echo "ALL SHARDS FINISHED"; grep -h "mutation:\|SURVIVED\|FAIL control" mutres/log*.txt | tail -20
