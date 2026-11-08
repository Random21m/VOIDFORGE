#!/bin/sh
# (Reverse order: the second machine on these shards.) Runs shards FIRST..FIRST+COUNT-1 of the v2.8.1 mutation suite split 16 ways, on another machine, and pushes the results to the
# GitLab branch mutres-NAME every 15 minutes and at the end. Usage: sh tests/mut-remote.sh FIRST COUNT NAME
set -e
FIRST=$1; COUNT=$2; NAME=$3; N=16
cd "$(dirname "$0")/.."
echo "aa4f4890416b65e3177ee772335297cdf06bced939e75038cbcb25ca7f2a8973  voidforge.html" | sha256sum -c
[ -d node_modules ] || npm ci --ignore-scripts --no-audit --no-fund > /dev/null
mkdir -p mutres
i=$FIRST
while [ $i -lt $((FIRST + COUNT)) ]; do
  [ -f mutres/res$i.jsonl ] || cp tests/fixtures/mut-seed-281b.jsonl mutres/res$i.jsonl
  MUT_REVERSE=1 MUT_SHARD=$i/$N MUT_RESULTS=mutres/res$i.jsonl setsid nohup node tests/mutation.test.mjs >> mutres/log$i.txt 2>&1 < /dev/null &
  i=$((i + 1))
done
sleep 5
while [ "$(pgrep -fc 'node tests/mutation.test.mjs')" -gt 0 ]; do
  sh tests/mut-push.sh "$NAME" || true
  sleep 900
done
sh tests/mut-push.sh "$NAME"
echo "ALL SHARDS FINISHED"; grep -h 'mutation:' mutres/log*.txt | tail -8
