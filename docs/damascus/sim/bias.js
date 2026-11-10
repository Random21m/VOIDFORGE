// Bias-box detection power (dice and cards) and the entropy lost to a short shuffle.
// Usage: node sim/bias.js [trials]
'use strict';
const vf = require('../ref/vf.js');
const R = require('./prng.js').make();
const T = +process.argv[2] || 1e6;
const out = []; const log = s => { out.push(s); console.log(s); };
const pct = x => (100 * x).toFixed(2).padStart(6) + '%';

// ------------------------------------------------ dice
function diceSeq(n, model) { // returns n throws (1..6)
  const s = [];
  for (let i = 0; i < n; i++) s.push(model(s));
  return s;
}
const face = w => () => 1 + R.weighted(w);
const MODELS = {
  'fair die': face([1, 1, 1, 1, 1, 1]),
  'one face +50%': face([1, 1, 1, 1, 1, 1.5]),
  'one face double weight': face([1, 1, 1, 1, 1, 2]),
  'loaded die, p6 = 0.25': face([0.15, 0.15, 0.15, 0.15, 0.15, 0.25]),
  'one face never shows (dead face)': face([1, 1, 1, 1, 1, 0]),
  'two faces never show (e.g. a d4 used by mistake)': face([1, 1, 1, 1, 0, 0]),
  'invented numbers, never repeats': s => { let x; do x = 1 + R.int(6); while (s.length && x === s[s.length - 1]); return x; },
  'invented numbers, repeats half as often': s => { let x = 1 + R.int(6); if (s.length && x === s[s.length - 1] && R.float() < 0.5) { do x = 1 + R.int(6); while (x === s[s.length - 1]); } return x; },
  'lazy throw (die often just tips over: 40% same top face kept)': s => (s.length && R.float() < 0.4 ? s[s.length - 1] : 1 + R.int(6)),
};
function diceTest(throws, th) {
  const c = [0, 0, 0, 0, 0, 0]; let rep = 0;
  throws.forEach((x, i) => { c[x - 1]++; if (i && x === throws[i - 1]) rep++; });
  const face = Math.max(...c) >= th.diceHigh || Math.min(...c) <= th.diceLow;
  const repeat = rep <= th.repeatsLow;
  return { face, repeat, any: face || repeat };
}
for (const words of [12, 24]) {
  const n = vf.PLAN[words].dicePairsTally * 2;
  log(`\n# Dice bias box, ${words} words: tally the first ${n} throws (${n / 2} pairs, including "roll again" pairs)`);
  // threshold table for the fair die
  if (words === 12 || words === 24) {
    const hiFA = {}, loFA = {}, repFA = {};
    const N = Math.min(T, 1e6);
    for (let t = 0; t < N; t++) {
      const s = diceSeq(n, MODELS['fair die']); const c = [0, 0, 0, 0, 0, 0]; let rep = 0;
      s.forEach((x, i) => { c[x - 1]++; if (i && x === s[i - 1]) rep++; });
      const mx = Math.max(...c), mn = Math.min(...c);
      hiFA[mx] = (hiFA[mx] || 0) + 1; loFA[mn] = (loFA[mn] || 0) + 1; repFA[rep] = (repFA[rep] || 0) + 1;
    }
    const tail = (h, k, up) => Object.entries(h).filter(([v]) => (up ? +v >= k : +v <= k)).reduce((a, [, x]) => a + x, 0) / N;
    const th = vf.BIAS[words];
    log(`false alarm for a fair die: P(max face >= H): ` + [th.diceHigh - 1, th.diceHigh, th.diceHigh + 1].map(k => `H=${k}: ${pct(tail(hiFA, k, true))}`).join(', '));
    log(`                             P(min face <= L): ` + [th.diceLow - 1, th.diceLow, th.diceLow + 1].map(k => `L=${k}: ${pct(tail(loFA, k, false))}`).join(', '));
    log(`                             P(repeats <= Q): ` + [th.repeatsLow - 1, th.repeatsLow, th.repeatsLow + 1].map(k => `Q=${k}: ${pct(tail(repFA, k, false))}`).join(', ') + `  (expected repeats ${((n - 1) / 6).toFixed(1)})`);
  }
  const th = vf.BIAS[words];
  log(`chosen: fail if a face count >= ${th.diceHigh} or <= ${th.diceLow}, or repeats <= ${th.repeatsLow}`);
  log(`${'model'.padEnd(64)} face test   repeat test   either (= sheet fails)`);
  for (const [name, m] of Object.entries(MODELS)) {
    let f = 0, r = 0, a = 0; const N = Math.min(T, 200000);
    for (let t = 0; t < N; t++) { const x = diceTest(diceSeq(n, m), th); f += x.face; r += x.repeat; a += x.any; }
    log(`${name.padEnd(64)} ${pct(f / N)}    ${pct(r / N)}      ${pct(a / N)}`);
  }
}

// ------------------------------------------------ cards
// Bicycle new-deck order: A-K spades, A-K diamonds, K-A clubs, K-A hearts (value = rank*4+suit, suits C0 D1 H2 S3)
const V = (r, s) => r * 4 + s;
const NEW_DECK = [];
for (let r = 0; r < 13; r++) NEW_DECK.push(V(r, 3));
for (let r = 0; r < 13; r++) NEW_DECK.push(V(r, 1));
for (let r = 12; r >= 0; r--) NEW_DECK.push(V(r, 0));
for (let r = 12; r >= 0; r--) NEW_DECK.push(V(r, 2));
function riffle(d) { // Gilbert-Shannon-Reeds
  let k = 0; for (let i = 0; i < d.length; i++) k += R.next() & 1;
  const a = d.slice(0, k), b = d.slice(k), o = []; let i = 0, j = 0;
  while (i < a.length || j < b.length) { const la = a.length - i, lb = b.length - j; if (R.float() * (la + lb) < la) o.push(a[i++]); else o.push(b[j++]); }
  return o;
}
function overhand(d) { // packets of random size (geometric, mean ~5) moved from top to the other hand
  const o = []; let i = 0; const packets = [];
  while (i < d.length) { let n = 1; while (R.float() < 0.8 && i + n < d.length) n++; packets.push(d.slice(i, i + n)); i += n; }
  for (let p = packets.length - 1; p >= 0; p--) o.push(...packets[p]);
  return o;
}
function cut(d) { const k = 10 + R.int(33); return d.slice(k).concat(d.slice(0, k)); }
const SHUF = {
  'uniform shuffle (ideal)': () => R.shuffle(NEW_DECK.slice()),
  'new deck, cut only': () => cut(NEW_DECK.slice()),
  '1 riffle + cut': () => cut(riffle(NEW_DECK)),
  '2 riffles + cut': () => { let d = NEW_DECK; for (let i = 0; i < 2; i++) d = riffle(d); return cut(d); },
  '3 riffles + cut': () => { let d = NEW_DECK; for (let i = 0; i < 3; i++) d = riffle(d); return cut(d); },
  '4 riffles + cut': () => { let d = NEW_DECK; for (let i = 0; i < 4; i++) d = riffle(d); return cut(d); },
  '5 riffles + cut': () => { let d = NEW_DECK; for (let i = 0; i < 5; i++) d = riffle(d); return cut(d); },
  '7 riffles + cut': () => { let d = NEW_DECK; for (let i = 0; i < 7; i++) d = riffle(d); return cut(d); },
  '10 overhand shuffles': () => { let d = NEW_DECK; for (let i = 0; i < 10; i++) d = overhand(d); return d; },
  '30 overhand shuffles': () => { let d = NEW_DECK; for (let i = 0; i < 30; i++) d = overhand(d); return d; },
};
function cardStats(deck) {
  const groups = vf.deckGroups(45); let p = 0, ones = 0, nb = 0; const pats = [];
  for (const n of groups) {
    const v = deck.slice(p, p + n); p += n; const b = vf.knockout(v);
    ones += b.reduce((a, x) => a + x, 0); pats.push(parseInt(b.join(''), 2));
    for (let i = 1; i < v.length; i++) if (vf.isNeighbour(v[i - 1], v[i])) nb++;
  }
  return { ones, nb, pats };
}
log(`\n# Card bias box, per deck (45 bits from 6 octets + 1 quad; ${45} neighbour checks inside the groups)`);
{
  const th = vf.BIAS[12]; const N = Math.min(T, 1e6);
  const onesH = {}, nbH = {};
  for (let t = 0; t < N; t++) { const s = cardStats(SHUF['uniform shuffle (ideal)']()); onesH[s.ones] = (onesH[s.ones] || 0) + 1; nbH[s.nb] = (nbH[s.nb] || 0) + 1; }
  const tl = (h, f) => Object.entries(h).filter(([v]) => f(+v)).reduce((a, [, x]) => a + x, 0) / N;
  const { binomTail } = require('./stats.js');
  log(`false alarm, ideal shuffle: ones <= ${th.cardOnesLow} or >= ${th.cardOnesHigh}: ${pct(tl(onesH, v => v <= th.cardOnesLow || v >= th.cardOnesHigh))} (exact binomial ${pct(binomTail(45, 0.5, th.cardOnesLow, th.cardOnesHigh))})`);
  log(`                             neighbours >= ${th.cardNeighboursHigh - 1}: ${pct(tl(nbH, v => v >= th.cardNeighboursHigh - 1))}, >= ${th.cardNeighboursHigh}: ${pct(tl(nbH, v => v >= th.cardNeighboursHigh))}, >= ${th.cardNeighboursHigh + 1}: ${pct(tl(nbH, v => v >= th.cardNeighboursHigh + 1))}; mean ${(Object.entries(nbH).reduce((a, [v, x]) => a + v * x, 0) / N).toFixed(2)}`);
  log(`${'shuffle (starting from a new Bicycle-order deck)'.padEnd(44)} ones test  neighbour test  either   entropy of 6 octets (max 42 bits)`);
  for (const [name, f] of Object.entries(SHUF)) {
    const M = name.startsWith('uniform') ? Math.min(T, 1e6) : Math.min(T, 300000);
    let o = 0, nbF = 0, a = 0; const pc = Array.from({ length: 6 }, () => Array(128).fill(0));
    for (let t = 0; t < M; t++) {
      const s = cardStats(f()); const fo = s.ones <= th.cardOnesLow || s.ones >= th.cardOnesHigh, fn = s.nb >= th.cardNeighboursHigh;
      o += fo; nbF += fn; a += fo || fn; s.pats.slice(0, 6).forEach((p, g) => pc[g][p]++);
    }
    // plug-in entropy of each octet's 7-bit pattern; the sum is an UPPER bound on the joint entropy of the 42 octet bits
    const H = pc.reduce((acc, c) => acc - c.reduce((h, x) => h + (x ? (x / M) * Math.log2(x / M) : 0), 0), 0);
    log(`${name.padEnd(44)} ${pct(o / M)}    ${pct(nbF / M)}     ${pct(a / M)}   <= ${H.toFixed(2)} bits`);
  }
  log('(The entropy column is an upper bound from per-octet marginals only; it shows that marginal tests cannot certify a shuffle: even 2 riffles look almost uniform octet by octet.)');
  // Whole-deck view for GSR riffles from a known order (Bayer-Diaconis): P(pi) = C(2^k + n - r, n) / 2^(nk), r = rising sequences.
  const lf = [0]; for (let i = 1; i <= 20000; i++) lf[i] = lf[i - 1] + Math.log2(i);
  const lC = (a, b) => (b < 0 || b > a ? -Infinity : lf[a] - lf[b] - lf[a - b]);
  log('\nWhole deck after k GSR riffles from a KNOWN order (exact formula, no cut): Shannon entropy <= 52k bits; min-entropy = -log2 P(identity)');
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
    const A = 2 ** k; const hmin = 52 * k - lC(A + 51, 52);
    const deficit = lf[52] - Math.max(0, hmin);
    // every 45-bit (or 38-bit) output has exactly 52!/2^b preimages, so Hmin(output) >= b - deficit (rigorous, GSR model, known start)
    const c12 = Math.max(0, 45 - deficit) * 2 + Math.max(0, 38 - deficit), c24 = Math.max(0, 45 - deficit) * 5 + Math.max(0, 31 - deficit);
    log(`  k=${String(k).padStart(2)}: entropy <= ${Math.min(52 * k, lf[52]).toFixed(1).padStart(6)}, min-entropy = ${Math.max(0, hmin).toFixed(1).padStart(6)} bits (uniform ${lf[52].toFixed(1)}); proven min-entropy of card sheet: 12 words >= ${c12.toFixed(1)} of 128, 24 words >= ${c24.toFixed(1)} of 256`);
  }
}
require('fs').writeFileSync(__dirname + '/results-bias.txt', out.join('\n') + '\n');
