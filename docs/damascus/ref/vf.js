// VOIDFORGE method — reference implementation (library).
// Everything a person does on paper is mirrored here, step by step, so a paper
// transcript can be checked line by line. Only the last word (SHA-256) and the
// fingerprint/address use cryptographic code.
'use strict';
const crypto = require('crypto');

// ---------------------------------------------------------------- constants
const PLAN = {
  12: { bits: 128, rows: 12, dicePairsTally: 26, symbols: 26, finalBits: 7, checksumBits: 4 },
  24: { bits: 256, rows: 24, dicePairsTally: 52, symbols: 52, finalBits: 3, checksumBits: 8 },
};
// Bias-box thresholds (chosen in design-notes.md from sim/bias.js)
const BIAS = {
  12: { diceHigh: 18, diceLow: 1, repeatsLow: 2, cardOnesLow: 11, cardOnesHigh: 34, cardNeighboursHigh: 6 },
  24: { diceHigh: 29, diceLow: 6, repeatsLow: 7, cardOnesLow: 11, cardOnesHigh: 34, cardNeighboursHigh: 6 },
};

// ---------------------------------------------------------------- source D: mirror 6x6 dice table
// 16 classes of 4-bit prefixes. Class k (0..14) = the unordered pair {a,b}, a<b, in reading order
// (1,2),(1,3),(1,4),(1,5),(1,6),(2,3),...,(5,6). Class 15 = the kept doubles 5-5 and 6-6.
// Fifth bit ("mirror bit") = 1 if the second throw is HIGHER than the first; for 5-5 it is 0, for 6-6 it is 1.
// Doubles 1-1, 2-2, 3-3, 4-4 = roll that pair again.
const PAIRS = [];
for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) PAIRS.push([a, b]);
function mirrorCode(a, b) {
  if (a === b) return a <= 4 ? null : (15 << 1) | (a === 6 ? 1 : 0);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const k = PAIRS.findIndex(([x, y]) => x === lo && y === hi);
  return (k << 1) | (b > a ? 1 : 0);
}
const MIRROR_TABLE = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => mirrorCode(i + 1, j + 1)));
const bin = (v, n) => v.toString(2).padStart(n, '0');

function diceToBits(pairs, nBits) {
  // pairs: array of [first, second] throws (1..6), in the order thrown, including "roll again" pairs.
  const log = [], bits = [];
  for (const [a, b] of pairs) {
    if (![a, b].every(x => Number.isInteger(x) && x >= 1 && x <= 6)) throw new Error('bad die value ' + a + ',' + b);
    const code = mirrorCode(a, b);
    log.push({ a, b, code, bits: code === null ? null : bin(code, 5) });
    if (code !== null && bits.length < nBits) for (const ch of bin(code, 5)) if (bits.length < nBits) bits.push(+ch);
  }
  if (bits.length < nBits) throw new Error(`not enough accepted dice pairs: ${bits.length}/${nBits} bits`);
  return { bits, log };
}

// ---------------------------------------------------------------- source C: card knockout
// Card order: rank A(low) 2 3 4 5 6 7 8 9 T J Q K(high); ties broken by suit C < D < H < S (alphabetical).
const RANKS = 'A23456789TJQK', SUITS = 'CDHS';
function cardValue(s) {
  const t = String(s).trim().toUpperCase().replace(/^10/, 'T');
  const r = RANKS.indexOf(t[0]), u = SUITS.indexOf(t[1]);
  if (t.length !== 2 || r < 0 || u < 0) throw new Error('bad card ' + s);
  return r * 4 + u;
}
const cardName = v => RANKS[v >> 2] + SUITS[v & 3];
// One match: 1 if the RIGHT card is higher.
// Octet (8 cards, positions 1..8): round 1: 1v2, 3v4, 5v6, 7v8; round 2: winners (1,2)v(3,4), (5,6)v(7,8); final.
function knockout(vals) {
  const bits = [];
  let round = vals.slice();
  while (round.length > 1) {
    const next = [];
    for (let i = 0; i < round.length; i += 2) { bits.push(round[i + 1] > round[i] ? 1 : 0); next.push(Math.max(round[i], round[i + 1])); }
    round = next;
  }
  return bits; // 8 cards -> 7 bits, 4 cards -> 3 bits
}
// Plan of groups for one deck given the number of bits still needed.
function deckGroups(need) {
  const g = []; let cards = 52;
  while (need > 0 && cards >= 4) {
    if (cards >= 8 && need > 3) { g.push(8); need -= 7; cards -= 8; }
    else { g.push(4); need -= 3; cards -= 4; }
  }
  return g;
}
function cardPlan(nBits) {
  const decks = []; let need = nBits;
  while (need > 0) { const g = deckGroups(need); decks.push(g); need -= g.reduce((s, n) => s + n - 1, 0); }
  return decks;
}
function cardsToBits(decks, nBits) {
  // decks: array of arrays of card strings, in dealt order.
  const plan = cardPlan(nBits), bits = [], log = [];
  if (decks.length < plan.length) throw new Error(`need ${plan.length} decks, got ${decks.length}`);
  plan.forEach((groups, d) => {
    const vals = decks[d].map(cardValue);
    const need = groups.reduce((s, n) => s + n, 0);
    if (vals.length < need) throw new Error(`deck ${d + 1}: need ${need} cards, got ${vals.length}`);
    if (new Set(vals.slice(0, need)).size !== need) throw new Error(`deck ${d + 1}: a card appears twice`);
    let p = 0; const dl = { deck: d + 1, groups: [] };
    for (const n of groups) {
      const v = vals.slice(p, p + n); p += n;
      const b = knockout(v);
      dl.groups.push({ cards: v.map(cardName), bits: b.join('') });
      for (const x of b) if (bits.length < nBits) bits.push(x);
    }
    log.push(dl);
  });
  return { bits, log };
}

// ---------------------------------------------------------------- grids and forge marks
const toRows = bits => { const r = []; for (let i = 0; i < bits.length; i += 11) r.push(bits.slice(i, i + 11)); return r; };
const xorBits = (a, b) => a.map((x, i) => x ^ b[i]);
// Column mark M: parity of each of the 11 columns. Row mark R: parity of each row.
// Skew mark K (optional, for the backup card): cell (row r, column c), 1-based, carries letter
// 'abcdefghijk'[(r + c - 2) mod 11]; K = parity of the 1s under each letter.
function marks(bits) {
  const M = Array(11).fill(0), K = Array(11).fill(0), R = [];
  toRows(bits).forEach((row, r) => {
    let p = 0;
    row.forEach((x, c) => { M[c] ^= x; K[(r + c) % 11] ^= x; p ^= x; });
    R.push(p);
  });
  return { M: M.join(''), R: R.join(''), K: K.join('') };
}
const xorStr = (a, b) => [...a].map((x, i) => String(+x ^ +b[i])).join('');
const skewLetter = (r, c) => 'abcdefghijk'[(r + c) % 11]; // 0-based r,c

// ---------------------------------------------------------------- words and checksum (own code, checked against @scure/bip39 in tests)
const WORDS = require('@scure/bip39/wordlists/english').wordlist;
function bitsToBytes(bits) { const out = new Uint8Array(bits.length / 8); bits.forEach((x, i) => { out[i >> 3] |= x << (7 - (i & 7)); }); return out; }
function phraseFromBits(bits) {
  const h = crypto.createHash('sha256').update(bitsToBytes(bits)).digest();
  const cs = bits.length / 32, all = bits.slice();
  for (let i = 0; i < cs; i++) all.push((h[i >> 3] >> (7 - (i & 7))) & 1);
  return toRows(all).map(r => WORDS[parseInt(r.join(''), 2)]);
}
function handWords(bits) {
  // what the person writes by hand: full rows -> word number (1-based on a numbered list) and word.
  const rows = toRows(bits), out = [];
  rows.forEach((row, r) => {
    if (row.length === 11) { const i = parseInt(row.join(''), 2); out.push({ row: r + 1, bits: row.join(''), index: i, number: i + 1, word: WORDS[i] }); }
    else {
      const p = parseInt(row.join(''), 2), k = 11 - row.length, lo = p << k, hi = lo + (1 << k) - 1;
      out.push({ row: r + 1, bits: row.join(''), partial: true, firstNumber: lo + 1, lastNumber: hi + 1, firstWord: WORDS[lo], lastWord: WORDS[hi] });
    }
  });
  return out;
}

// ---------------------------------------------------------------- bias boxes
function diceBias(pairs, words) {
  const n = PLAN[words].dicePairsTally, th = BIAS[words];
  const throws = pairs.slice(0, n).flat();
  const counts = [1, 2, 3, 4, 5, 6].map(f => throws.filter(x => x === f).length);
  let repeats = 0; for (let i = 1; i < throws.length; i++) if (throws[i] === throws[i - 1]) repeats++;
  const fail = [];
  if (Math.max(...counts) >= th.diceHigh) fail.push(`a face came up ${Math.max(...counts)} times (fail at ${th.diceHigh} or more)`);
  if (Math.min(...counts) <= th.diceLow) fail.push(`a face came up only ${Math.min(...counts)} times (fail at ${th.diceLow} or fewer)`);
  if (repeats <= th.repeatsLow) fail.push(`only ${repeats} repeats (fail at ${th.repeatsLow} or fewer)`);
  return { throws: throws.length, counts, repeats, pass: fail.length === 0, fail };
}
function isNeighbour(x, y) { return (x & 3) === (y & 3) && Math.abs((x >> 2) - (y >> 2)) === 1; }
function cardBias(cardLog, words) {
  const th = BIAS[words];
  return cardLog.map(d => {
    const bits = d.groups.map(g => g.bits).join('');
    const ones = [...bits].filter(x => x === '1').length;
    let neighbours = 0;
    for (const g of d.groups) { const v = g.cards.map(cardValue); for (let i = 1; i < v.length; i++) if (isNeighbour(v[i - 1], v[i])) neighbours++; }
    const full = bits.length === 45, fail = [];
    if (full && (ones <= th.cardOnesLow || ones >= th.cardOnesHigh)) fail.push(`${ones} ones of 45 (fail at ${th.cardOnesLow} or fewer, ${th.cardOnesHigh} or more)`);
    if (neighbours >= th.cardNeighboursHigh) fail.push(`${neighbours} neighbour pairs (fail at ${th.cardNeighboursHigh} or more)`);
    return { deck: d.deck, bits: bits.length, ones, neighbours, pass: fail.length === 0, fail };
  });
}

// ---------------------------------------------------------------- wallet identity (fingerprint, first address)
function walletInfo(mnemonic) {
  const { mnemonicToSeedSync } = require('@scure/bip39');
  const { HDKey } = require('@scure/bip32');
  const btc = require('@scure/btc-signer');
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic));
  const fp = root.fingerprint.toString(16).padStart(8, '0');
  const k = root.derive("m/84'/0'/0'/0/0");
  return { fingerprint: fp, firstAddressBIP84: btc.p2wpkh(k.publicKey).address };
}

// ---------------------------------------------------------------- the whole forge
function forge({ words = 12, dice, cards }) {
  const P = PLAN[words];
  if (!P) throw new Error('words must be 12 or 24');
  const D = diceToBits(dice, P.bits), C = cardsToBits(cards, P.bits);
  const E = xorBits(D.bits, C.bits);
  const mD = marks(D.bits), mC = marks(C.bits), mE = marks(E);
  const seal = { M: xorStr(mD.M, mC.M) === mE.M, R: xorStr(mD.R, mC.R) === mE.R, K: xorStr(mD.K, mC.K) === mE.K };
  const hw = handWords(E);
  const phrase = phraseFromBits(E);
  const last = hw[hw.length - 1];
  const finalIdx = WORDS.indexOf(phrase[phrase.length - 1]);
  return {
    words, D: { bits: D.bits.join(''), log: D.log, marks: mD, phrase: phraseFromBits(D.bits) },
    C: { bits: C.bits.join(''), log: C.log, marks: mC, phrase: phraseFromBits(C.bits) },
    E: { bits: E.join(''), marks: mE, seal, handWords: hw, phrase,
      finalWordInBlock: finalIdx + 1 >= last.firstNumber && finalIdx + 1 <= last.lastNumber },
    bias: { dice: diceBias(dice, words), cards: cardBias(C.log, words) },
    wallet: walletInfo(phrase.join(' ')),
  };
}

module.exports = { PLAN, BIAS, PAIRS, mirrorCode, MIRROR_TABLE, diceToBits, cardValue, cardName, knockout, deckGroups, cardPlan, cardsToBits,
  toRows, xorBits, marks, xorStr, skewLetter, WORDS, bitsToBytes, phraseFromBits, handWords, diceBias, cardBias, isNeighbour, walletInfo, forge, bin, RANKS, SUITS };
