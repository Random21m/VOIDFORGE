#!/bin/sh
# Release mutation run on a helper machine (not part of the release): runs shards FIRST..FIRST+COUNT-1 of the suite split
# N ways, side by side, with the two-step method (tests/fixtures/mut-plan.json must have been made for this exact page).
# It refuses to start unless voidforge.html is the frozen file named in SHA256SUMS. It pushes nothing anywhere: when all
# shards are done it prints a short report for the helper to send back to the release session: per shard the control line, the summary and the number of results, plus every SURVIVED, TIMED OUT or
# FAIL control line (a few hundred bytes, small enough for a message). Rerunning it skips the shards that already finished.
# Usage: sh tests/mut-shards.sh FIRST COUNT N
set -e
FIRST=$1; COUNT=$2; N=$3
cd "$(dirname "$0")/.."
sha256sum -c SHA256SUMS
[ -d node_modules ] || npm ci --ignore-scripts --no-audit --no-fund > /dev/null
mkdir -p mutres
i=$FIRST
while [ $i -lt $((FIRST + COUNT)) ]; do
  if ! grep -q "^mutation:" "mutres/log$i.txt" 2>/dev/null; then
    MUT_SHARD=$i/$N MUT_RESULTS=mutres/res$i.jsonl setsid nohup node tests/mutation.test.mjs >> mutres/log$i.txt 2>&1 < /dev/null &
  fi
  i=$((i + 1))
done
sleep 5
while [ "$(pgrep -fc 'node tests/mutation.test.mjs')" -gt 0 ]; do sleep 60; done
echo "ALL SHARDS FINISHED"
echo "=== REPORT shards $FIRST-$((FIRST + COUNT - 1)) of $N, page $(cut -c1-16 SHA256SUMS) ==="
i=$FIRST
while [ $i -lt $((FIRST + COUNT)) ]; do
  echo "shard $i: $(grep -c . mutres/res$i.jsonl 2>/dev/null || echo 0) results; $(grep -h '^mutation:' mutres/log$i.txt | tail -1); $(grep -ho 'PASS control\|FAIL control' mutres/log$i.txt | tail -1)"
  i=$((i + 1))
done
grep -h "FAIL control\|every mutation runs the full probe\|TIMED OUT\|SURVIVED" mutres/log*.txt || true
echo "=== END REPORT ==="
