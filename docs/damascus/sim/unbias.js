// Unbiasedness: exact enumeration + Monte Carlo (>= 1e6 trials) for every extraction step.
// Usage: node sim/unbias.js [trials]
'use strict';
const vf = require('../ref/vf.js');
const { chi2, chi2p } = require('./stats.js');
const R = require('./prng.js').make();
const T = +process.argv[2] || 1e6;
const out = [];
const log = s => { out.push(s); console.log(s); };

// ---------- 1. mirror table, exact
log('# 1. Mirror 6x6 dice table');
const seen = new Map(); let rejected = 0;
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
  const c = vf.mirrorCode(a, b);
  if (c === null) { rejected++; continue; }
  seen.set(c, (seen.get(c) || 0) + 1);
  if (a !== b) { const m = vf.mirrorCode(b, a); if ((m >> 1) !== (c >> 1) || (m & 1) === (c & 1)) throw new Error('mirror property broken'); }
}
log(`exact: ${36 - rejected} kept cells, ${rejected} rejected; codes used: ${seen.size} distinct, each exactly ${[...new Set(seen.values())]} time(s)`);
log('=> for a fair die every kept cell has probability 1/36, so each 5-bit code has probability exactly 1/32 given acceptance (bijection).');
log('mirror property verified: (a,b) and (b,a) share the first 4 bits and differ in the 5th bit, for all 15 unordered pairs.');

// ---------- 2. mirror bit under bias, exact
log('\n# 2. Biased dice, exact (iid throws of ONE die with face probabilities p)');
const dies = {
  'fair': [1, 1, 1, 1, 1, 1],
  '6 at +50%': [1, 1, 1, 1, 1, 1.5],
  'one face double weight (6)': [1, 1, 1, 1, 1, 2],
  '5 at double weight': [1, 1, 1, 1, 2, 1],
  'precision die, 6 at +2%': [1, 1, 1, 1, 1, 1.02],
  'drilled-pip style (1:+10%, 6:-10%)': [1.1, 1, 1, 1, 1, 0.9],
  'dead face (6 never)': [1, 1, 1, 1, 1, 0],
  'casino-cheat loaded 6 (p6=0.25)': [0.15, 0.15, 0.15, 0.15, 0.15, 0.25],
};
for (const [name, w] of Object.entries(dies)) {
  const s = w.reduce((x, y) => x + y, 0), p = w.map(x => x / s);
  const pr = Array(32).fill(0); let acc = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) { const c = vf.mirrorCode(a, b); if (c === null) continue; pr[c] += p[a - 1] * p[b - 1]; acc += p[a - 1] * p[b - 1]; }
  for (let i = 0; i < 32; i++) pr[i] /= acc;
  const H = -pr.reduce((t, x) => t + (x > 0 ? x * Math.log2(x) : 0), 0), Hmin = -Math.log2(Math.max(...pr));
  let worst = 0; // max |P(bit5=1 | prefix k) - 1/2| over classes 0..14
  for (let k = 0; k < 15; k++) { const q = pr[2 * k] + pr[2 * k + 1]; if (q > 0) worst = Math.max(worst, Math.abs(pr[2 * k + 1] / q - 0.5)); }
  const q15 = pr[30] + pr[31], c15 = q15 > 0 ? pr[31] / q15 : NaN;
  log(`${name.padEnd(36)} H=${H.toFixed(4)} bits/symbol  Hmin=${Hmin.toFixed(4)}  26 symbols: H=${(26 * H).toFixed(1)} Hmin=${(26 * Hmin).toFixed(1)} bits | mirror bit: max bias over classes 0-14 = ${worst.toExponential(1)}; class 15 (5-5/6-6) P(1)=${c15.toFixed(3)}`);
}
log('=> The mirror (5th) bit is exactly fair for ANY bias in classes 0-14 (P(a,b)=p_a p_b = P(b,a)); only class 15 leaks bias.');
log('   This needs exchangeable throws: the same die thrown twice, or two dice whose left/right order is random.');
// two different dice (not exchangeable)
{
  const p = [1, 1, 1, 1, 1, 2].map(x => x / 7), q = [1, 1, 1, 1, 1, 1].map(x => x / 6);
  const pr = Array(32).fill(0); let acc = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) { const c = vf.mirrorCode(a, b); if (c === null) continue; pr[c] += p[a - 1] * q[b - 1]; acc += p[a - 1] * q[b - 1]; }
  let worst = 0; for (let k = 0; k < 15; k++) { const s = pr[2 * k] + pr[2 * k + 1]; worst = Math.max(worst, Math.abs(pr[2 * k + 1] / s - 0.5)); }
  log(`counter-example, first throw by a die with 6 at double weight, second by a fair die: mirror bit bias up to ${worst.toFixed(3)} (guarantee lost).`);
}

// ---------- 3. dice Monte Carlo
log(`\n# 3. Dice Monte Carlo: ${T.toLocaleString()} complete 12-word D sheets (fair die)`);
{
  const codeCount = Array(32).fill(0), bitOnes = Array(128).fill(0); let pairsUsed = 0, pairsMax = 0;
  const pairHist = new Map();
  for (let t = 0; t < T; t++) {
    let bits = 0, pos = 0, np = 0;
    while (pos < 128) {
      const a = 1 + R.int(6), b = 1 + R.int(6); np++;
      const c = vf.mirrorCode(a, b); if (c === null) continue;
      codeCount[c]++;
      for (let i = 4; i >= 0 && pos < 128; i--) { if ((c >> i) & 1) bitOnes[pos]++; pos++; }
    }
    pairsUsed += np; pairsMax = Math.max(pairsMax, np); pairHist.set(np, (pairHist.get(np) || 0) + 1);
  }
  const tot = codeCount.reduce((a, b) => a + b, 0), x = chi2(codeCount, tot / 32);
  log(`codes: ${tot.toLocaleString()} symbols, chi2(31 df)=${x.toFixed(2)}, p=${chi2p(x, 31).toFixed(3)}`);
  const dev = bitOnes.map(o => Math.abs(o / T - 0.5)), z = Math.max(...dev) / (0.5 / Math.sqrt(T));
  log(`per-position bit frequency over 128 positions: max |freq-0.5| = ${Math.max(...dev).toExponential(2)} (max z=${z.toFixed(2)}; |z|<4 expected for 128 positions)`);
  const xs = [...pairHist.entries()].sort((a, b) => a[0] - b[0]); let cum = 0, p95 = 0, p99 = 0;
  for (const [k, n] of xs) { cum += n; if (!p95 && cum >= 0.95 * T) p95 = k; if (!p99 && cum >= 0.99 * T) p99 = k; }
  log(`pairs thrown per 12-word sheet: mean ${(pairsUsed / T).toFixed(2)}, 95th pct ${p95}, 99th pct ${p99}, max ${pairsMax} (theory: 26 x 36/32 = 29.25)`);
}

// ---------- 4. card knockout, exact
log('\n# 4. Card knockout');
function perms(n) { const res = []; const a = [...Array(n).keys()]; (function rec(k) { if (k === n) { res.push(a.slice()); return; } for (let i = k; i < n; i++) { [a[k], a[i]] = [a[i], a[k]]; rec(k + 1); [a[k], a[i]] = [a[i], a[k]]; } })(0); return res; }
for (const n of [4, 8]) {
  const cnt = new Map();
  for (const p of perms(n)) { const k = vf.knockout(p).join(''); cnt.set(k, (cnt.get(k) || 0) + 1); }
  const vals = [...new Set(cnt.values())];
  log(`exact: all ${n}! orders of ${n} distinct cards -> ${cnt.size} patterns of ${n - 1} bits, each exactly ${vals} times`);
}
log('=> each group gives exactly uniform bits; disjoint groups of a uniformly shuffled deck have independent uniform relative orders,');
log('   so all 45 bits of a deck (6 octets + 1 quad) are independent and fair. (Proof in design-notes.md; Monte Carlo below.)');

// ---------- 5. card Monte Carlo
log(`\n# 5. Card Monte Carlo: ${T.toLocaleString()} uniformly shuffled decks, 45 bits each`);
{
  const ones = Array(45).fill(0), oct = Array.from({ length: 6 }, () => Array(128).fill(0)), quad = Array(8).fill(0);
  const joint = Array(128 * 128).fill(0), jointOQ = Array(128 * 8).fill(0);
  const pair = Array(45 * 45).fill(0);
  const deck = [...Array(52).keys()];
  for (let t = 0; t < T; t++) {
    R.shuffle(deck);
    const bits = []; const pats = [];
    for (let g = 0; g < 6; g++) { const b = vf.knockout(deck.slice(8 * g, 8 * g + 8)); bits.push(...b); pats.push(parseInt(b.join(''), 2)); }
    const qb = vf.knockout(deck.slice(48, 52)); bits.push(...qb); const qp = parseInt(qb.join(''), 2);
    for (let i = 0; i < 45; i++) if (bits[i]) { ones[i]++; for (let j = i + 1; j < 45; j++) if (bits[j]) pair[i * 45 + j]++; }
    for (let g = 0; g < 6; g++) oct[g][pats[g]]++;
    quad[qp]++; joint[pats[0] * 128 + pats[1]]++; jointOQ[pats[5] * 8 + qp]++;
  }
  const dev = ones.map(o => Math.abs(o / T - 0.5));
  log(`per-bit frequency: max |freq-0.5| = ${Math.max(...dev).toExponential(2)} (max z=${(Math.max(...dev) / (0.5 / Math.sqrt(T))).toFixed(2)})`);
  const xo = oct.map(c => chi2(c, T / 128)); log(`octet patterns, chi2(127 df) per octet: ${xo.map(x => x.toFixed(1)).join(', ')}; p-values ${xo.map(x => chi2p(x, 127).toFixed(2)).join(', ')}`);
  const xq = chi2(quad, T / 8); log(`quad patterns chi2(7 df)=${xq.toFixed(2)}, p=${chi2p(xq, 7).toFixed(2)}`);
  const xj = chi2(joint, T / 16384); log(`joint (octet 1, octet 2) patterns chi2(16383 df)=${xj.toFixed(0)}, p=${chi2p(xj, 16383).toFixed(2)}`);
  const xjq = chi2(jointOQ, T / 1024); log(`joint (octet 6, quad) chi2(1023 df)=${xjq.toFixed(1)}, p=${chi2p(xjq, 1023).toFixed(2)}`);
  let maxc = 0; for (let i = 0; i < 45; i++) for (let j = i + 1; j < 45; j++) { const c = pair[i * 45 + j] / T - (ones[i] / T) * (ones[j] / T); maxc = Math.max(maxc, Math.abs(c)); }
  log(`max |covariance| over all 990 bit pairs: ${maxc.toExponential(2)} (1/sqrt(T) scale for 990 pairs: ~${(4 * 0.25 / Math.sqrt(T)).toExponential(1)})`);
}

// ---------- 6. XOR with an attacker-controlled source
log(`\n# 6. XOR: fair D xor adversarial C (${T.toLocaleString()} trials, 12-word sheets)`);
{
  const advs = { 'C all zeros': () => Array(128).fill(0), 'C = fixed pattern 1010..': () => Array.from({ length: 128 }, (_, i) => i & 1), 'C biased 90% ones, iid': () => Array.from({ length: 128 }, () => +(R.float() < 0.9)) };
  for (const [name, gen] of Object.entries(advs)) {
    const ones = Array(128).fill(0); const first11 = Array(2048).fill(0);
    for (let t = 0; t < T; t++) {
      const D = []; while (D.length < 128) { const c = vf.mirrorCode(1 + R.int(6), 1 + R.int(6)); if (c !== null) for (let i = 4; i >= 0; i--) D.push((c >> i) & 1); }
      const E = vf.xorBits(D.slice(0, 128), gen());
      E.forEach((x, i) => { ones[i] += x; }); first11[parseInt(E.slice(0, 11).join(''), 2)]++;
    }
    const dev = Math.max(...ones.map(o => Math.abs(o / T - 0.5)));
    const x = chi2(first11, T / 2048);
    log(`${name.padEnd(28)} max per-bit |freq-0.5| ${dev.toExponential(2)}; word-1 index chi2(2047 df)=${x.toFixed(0)} p=${chi2p(x, 2047).toFixed(2)}`);
  }
  log('=> E is exactly uniform whenever one source is uniform and independent of the other (one-time-pad argument).');
}
require('fs').writeFileSync(__dirname + '/results-unbias.txt', out.join('\n') + '\n');
