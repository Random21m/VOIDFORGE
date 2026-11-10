// Builds the three published worked examples (inputs + transcripts).
// Dice come from the decimal digits of pi, e and sqrt(2) (digits 1-6 kept, 0 and 7-9 skipped, read in pairs).
// Cards come from a published deterministic shuffle: Fisher-Yates driven by SHA-256("<label>" || counter).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const vf = require('./vf.js');
const { transcript } = require('./transcript.js');
const { parseInput } = require('./forge.js');
const OUT = path.join(__dirname, 'examples');

// ---- digits (BigInt)
function piDigits(n) { // Machin: pi = 16 atan(1/5) - 4 atan(1/239)
  const S = 10n ** BigInt(n + 20);
  const atanInv = x => { let sum = 0n, term = S / x, k = 1n, sign = 1n; const x2 = x * x; while (term) { sum += sign * term / k; term /= x2; k += 2n; sign = -sign; } return sum; };
  return (16n * atanInv(5n) - 4n * atanInv(239n)).toString().slice(1, n + 1); // digits after "3"
}
function eDigits(n) { const S = 10n ** BigInt(n + 20); let sum = 0n, t = S, k = 1n; while (t) { sum += t; t /= k; k++; } return sum.toString().slice(1, n + 1); }
function sqrt2Digits(n) { const S = 10n ** BigInt(2 * (n + 20)); let x = 2n * S, y = 1n << BigInt(Math.ceil((2 * (n + 20)) * 3.33) + 2); while (true) { const z = (y + x / y) >> 1n; if (z >= y) break; y = z; } return y.toString().slice(1, n + 1); }
const dicePairs = digits => { const k = [...digits].filter(c => c >= '1' && c <= '6'); const p = []; for (let i = 0; i + 1 < k.length; i += 2) p.push(k[i] + k[i + 1]); return p; };

// ---- published deterministic shuffle
function publicDeck(label) {
  let ctr = 0, buf = Buffer.alloc(0);
  const u32 = () => { if (buf.length < 4) { buf = Buffer.concat([buf, crypto.createHash('sha256').update(label + '|' + ctr++).digest()]); } const v = buf.readUInt32BE(0); buf = buf.subarray(4); return v; };
  const int = n => { const lim = Math.floor(4294967296 / n) * n; let x; do x = u32(); while (x >= lim); return x % n; };
  const d = []; for (let r = 0; r < 13; r++) for (let s = 0; s < 4; s++) d.push(vf.RANKS[r] + vf.SUITS[s]);
  for (let i = d.length - 1; i > 0; i--) { const j = int(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function perms(a) { if (a.length <= 1) return [a]; const out = []; a.forEach((x, i) => { for (const p of perms(a.slice(0, i).concat(a.slice(i + 1)))) out.push([x, ...p]); }); return out; }
// arrange each group of a public deck so the knockout gives the wanted bits (an "attacker" choosing his sheet)
function forcedDecks(targetBits, labelBase) {
  const plan = vf.cardPlan(targetBits.length); let p = 0;
  return plan.map((groups, d) => {
    const base = publicDeck(`${labelBase} deck ${d + 1}`); const out = []; let c = 0;
    for (const n of groups) {
      const cards = base.slice(c, c + n); c += n; const want = targetBits.slice(p, p + n - 1).join(''); p += n - 1;
      const hit = perms(cards).find(q => vf.knockout(q.map(vf.cardValue)).join('').startsWith(want));
      out.push(...hit);
    }
    return out.concat(base.slice(c)).join(' ');
  });
}
const hexBits = (hex) => [...Buffer.from(hex, 'hex')].flatMap(b => vf.bin(b, 8).split('').map(Number));

const examples = [];
{ // Example 1: 12 words, pi dice, public shuffle
  const dice = dicePairs(piDigits(400));
  const plan = vf.cardPlan(128);
  examples.push({ id: 1, title: 'Worked example 1: 12 words (dice = digits of pi, cards = public shuffle)', words: 12,
    note: 'Dice: the decimal digits of pi after "3.", keeping only 1-6, read in pairs (1415926535 -> 1 4 1 5 2 6 5 3 5 ... -> pairs 14 15 26 53 ...). Cards: decks shuffled by the published rule in ref/make-examples.js (SHA-256 of "VOIDFORGE method example 1 deck N").',
    dice: dice.slice(0, 40).join(' '), cards: plan.map((_, d) => publicDeck(`VOIDFORGE method example 1 deck ${d + 1}`).join(' ')) });
}
{ // Example 2: 12 words, e dice, cards CHOSEN after seeing the dice -> lands on the BIP39 test vector 7f..7f
  const dice = dicePairs(eDigits(400)).slice(0, 40);
  const D = vf.diceToBits(dice.map(t => [+t[0], +t[1]]), 128).bits;
  const target = hexBits('7f'.repeat(16));
  const C = vf.xorBits(D, target);
  examples.push({ id: 2, title: 'Worked example 2: 12 words, a cheating card sheet (lands on the official BIP39 test vector)', words: 12,
    note: 'Dice: the decimal digits of e after "2.", keeping only 1-6, in pairs. Cards: here the card person SAW the dice sheet first and arranged each group of a published deck so that C = D xor 7f7f...7f. The result is the official BIP39 test vector "legal winner thank year wave sausage worth useful legal winner thank yellow". Lesson: the sheet that is filled in second must not see the first one. Fold and hand over (commit) each sheet before the other is revealed. Every check in this example still passes, because the forge marks catch mistakes, not cheating.',
    dice: dice.join(' '), cards: forcedDecks(C, 'VOIDFORGE method example 2') });
}
{ // Example 3: 24 words, sqrt(2) dice, public shuffle
  const dice = dicePairs(sqrt2Digits(800));
  const plan = vf.cardPlan(256);
  examples.push({ id: 3, title: 'Worked example 3: 24 words (dice = digits of the square root of 2, cards = public shuffle)', words: 24,
    note: 'Dice: the decimal digits of sqrt(2) after "1.", keeping only 1-6, in pairs. Cards: six decks shuffled by the published rule (SHA-256 of "VOIDFORGE method example 3 deck N").',
    dice: dice.slice(0, 75).join(' '), cards: plan.map((_, d) => publicDeck(`VOIDFORGE method example 3 deck ${d + 1}`).join(' ')) });
}
fs.mkdirSync(OUT, { recursive: true });
const summary = [];
for (const ex of examples) {
  const res = vf.forge(parseInput(ex));
  fs.writeFileSync(path.join(OUT, `example-${ex.id}.json`), JSON.stringify(ex, null, 1));
  fs.writeFileSync(path.join(OUT, `example-${ex.id}.md`), transcript(res, ex, ex.title));
  summary.push(`example ${ex.id}: ${res.E.phrase.join(' ')} | fp ${res.wallet.fingerprint} | seal ${JSON.stringify(res.E.seal)} | dice bias ${res.bias.dice.pass ? 'pass' : 'FAIL'} | cards ${res.bias.cards.map(c => (c.pass ? 'pass' : 'FAIL')).join(',')}`);
}
console.log(summary.join('\n'));
console.log('pi check:', piDigits(20), ' e check:', eDigits(20), ' sqrt2 check:', sqrt2Digits(20));
