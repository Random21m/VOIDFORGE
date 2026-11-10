// Forge-mark error-detection simulation.
// Every candidate check is GF(2)-linear, so an error is missed exactly when the
// error pattern (delta grid) has a zero syndrome. We simulate delta patterns only.
// Usage: node sim/marks.js [trials]   (default 1,000,000 per error class)
'use strict';
const TRIALS = +process.argv[2] || 1e6;
let seed = 0x9e3779b9;
function rnd() { // xorshift32, deterministic, adequate for Monte Carlo
  seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
}
const ri = n => Math.floor(rnd() * n);

function geometry(words) {
  const bits = words === 12 ? 128 : 256;
  const rows = words, cells = [];
  for (let i = 0; i < bits; i++) cells.push([Math.floor(i / 11), i % 11]);
  return { bits, rows, cells, fullRows: Math.floor(bits / 11) };
}

// Syndromes. delta is a Set of cell indices (bit positions 0..bits-1) that are flipped.
const CHECKS = {
  COL: (r, c) => ['c' + c],
  ROW: (r, c) => ['r' + r],
  ODD: (r, c) => (r % 2 === 0 ? ['o' + c] : []), // rows 1,3,5.. (1-based) = r even 0-based
  DIAG: (r, c) => ['d' + ((r + c) % 11)],
};
const COMBOS = {
  'M (column parity, 11 bits)': ['COL'],
  'M + row parity R (2D parity)': ['COL', 'ROW'],
  'M + odd-row column parity': ['COL', 'ODD'],
  'M + skew mark K (wrapped diagonal)': ['COL', 'DIAG'],
  'M + R + K': ['COL', 'ROW', 'DIAG'],
};
function missed(geo, combo, flipped) {
  const syn = new Map();
  for (const i of flipped) {
    const [r, c] = geo.cells[i];
    for (const k of combo) for (const key of CHECKS[k](r, c)) syn.set(key, (syn.get(key) || 0) ^ 1);
  }
  for (const v of syn.values()) if (v) return false;
  return true;
}
// row helpers: an 11-bit value v written in row r -> set of flipped cells for delta v
function rowDelta(geo, r, v) {
  const out = [];
  for (let c = 0; c < 11; c++) if ((v >> (10 - c)) & 1) { const i = r * 11 + c; if (i < geo.bits) out.push(i); }
  return out;
}
function xorSets(a, b) { const s = new Set(a); for (const x of b) s.has(x) ? s.delete(x) : s.add(x); return s; }

const MODELS = {
  'single bit (miscopy / wrong XOR cell)': geo => [ri(geo.bits)],
  'two random bits': geo => { const a = ri(geo.bits); let b; do b = ri(geo.bits); while (b === a); return [a, b]; },
  'three random bits': geo => { const s = new Set(); while (s.size < 3) s.add(ri(geo.bits)); return [...s]; },
  'four random bits': geo => { const s = new Set(); while (s.size < 4) s.add(ri(geo.bits)); return [...s]; },
  'word left out, later words move up one': geo => { // rows r..end-1 take the next row's word; last full row gets a random word
    const n = geo.fullRows, w = Array.from({ length: n + 1 }, () => ri(2048)); const r = ri(n); let d = new Set();
    for (let k = r; k < n; k++) d = xorSets(d, rowDelta(geo, k, w[k] ^ w[k + 1]));
    return [...d]; },
  'two bits in the same word (row)': geo => { const r = ri(geo.fullRows); const a = ri(11); let b; do b = ri(11); while (b === a); return [r * 11 + a, r * 11 + b]; },
  'wrong word (random other word)': geo => { const r = ri(geo.fullRows); const v = 1 + ri(2047); return rowDelta(geo, r, v); },
  'neighbour line in list (index +-1)': geo => { const r = ri(geo.fullRows); const n = ri(2048); const m = n === 0 ? 1 : n === 2047 ? 2046 : n + (rnd() < 0.5 ? 1 : -1); return rowDelta(geo, r, n ^ m); },
  'adjacent words swapped': geo => { const r = ri(geo.fullRows - 1); const a = ri(2048), b = ri(2048); return [...xorSets(rowDelta(geo, r, a ^ b), rowDelta(geo, r + 1, a ^ b))]; },
  'any two words swapped': geo => { const r = ri(geo.fullRows); let s; do s = ri(geo.fullRows); while (s === r); const a = ri(2048), b = ri(2048); return [...xorSets(rowDelta(geo, r, a ^ b), rowDelta(geo, s, a ^ b))]; },
  'XOR row slip (E row i made with C row i+1)': geo => { const r = ri(geo.fullRows - 1); const ci = ri(2048), cj = ri(2048); return rowDelta(geo, r, ci ^ cj); },
  'two adjacent bits transposed in a word': geo => { const r = ri(geo.fullRows); const c = ri(10); return rnd() < 0.5 ? [] : [r * 11 + c, r * 11 + c + 1]; }, // equal bits -> no error
};

const out = [];
for (const words of [12, 24]) {
  const geo = geometry(words);
  out.push(`\n=== ${words} words (${geo.bits} grid cells, ${geo.fullRows} full 11-bit rows) — miss rate per error class, ${TRIALS.toLocaleString()} trials ===`);
  for (const [mname, gen] of Object.entries(MODELS)) {
    const counts = Object.fromEntries(Object.keys(COMBOS).map(k => [k, 0]));
    let real = 0;
    for (let t = 0; t < TRIALS; t++) {
      const d = gen(geo);
      if (d.length === 0) continue; // no actual change (e.g. swapped equal words)
      real++;
      for (const [cname, combo] of Object.entries(COMBOS)) if (missed(geo, combo, d)) counts[cname]++;
    }
    out.push(`\n${mname}  (non-null errors: ${real})`);
    for (const [cname, n] of Object.entries(counts)) out.push(`   ${cname.padEnd(38)} caught ${(100 * (1 - n / real)).toFixed(3).padStart(8)} %   missed ${(100 * n / real).toFixed(3)} %`);
  }
}
// Exact two-bit miss rates by enumeration (12 and 24 words)
for (const words of [12, 24]) {
  const geo = geometry(words);
  out.push(`\nExact enumeration, all pairs of distinct cells, ${words} words:`);
  for (const [cname, combo] of Object.entries(COMBOS)) {
    let miss = 0, tot = 0;
    for (let a = 0; a < geo.bits; a++) for (let b = a + 1; b < geo.bits; b++) { tot++; if (missed(geo, combo, [a, b])) miss++; }
    out.push(`   ${cname.padEnd(38)} missed ${miss}/${tot} = ${(100 * miss / tot).toFixed(3)} %`);
  }
  // swaps exact: for each pair of rows, fraction of 11-bit deltas (nonzero) missed
  out.push(`Exact swap analysis (${words} words): pairs of rows where a swap of DIFFERENT words can go undetected:`);
  for (const [cname, combo] of Object.entries(COMBOS)) {
    let miss = 0, tot = 0;
    for (let r = 0; r < geo.fullRows; r++) for (let s = r + 1; s < geo.fullRows; s++) for (let v = 1; v < 2048; v++) {
      tot++; if (missed(geo, combo, [...xorSets(rowDelta(geo, r, v), rowDelta(geo, s, v))])) miss++;
    }
    out.push(`   ${cname.padEnd(38)} missed ${(100 * miss / tot).toFixed(3)} % of (row pair, nonzero difference) cases`);
  }
}
console.log(out.join('\n'));
