// Tests for the VOIDFORGE method reference implementation.
// Usage: node ref/test.js [randomTrialsPerLength]   (default 2000)
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const vf = require('./vf.js');
const bip39 = require('@scure/bip39');
const { wordlist } = require('@scure/bip39/wordlists/english');
const { HDKey } = require('@scure/bip32');
const { secp256k1 } = require('@noble/curves/secp256k1');
const N = +process.argv[2] || 2000;
const lines = []; let fails = 0, checks = 0;
const log = s => { lines.push(s); console.log(s); };
function ok(cond, msg) { checks++; if (!cond) { fails++; log('FAIL: ' + msg); } }
const bytesOf = bits => vf.bitsToBytes([...bits].map(Number));
const hex = u => Buffer.from(u).toString('hex');

// ---- independent fingerprint (node crypto PBKDF2/HMAC/SHA-256/RIPEMD-160 + noble secp256k1)
function fingerprintIndependent(mnemonic) {
  const seed = crypto.pbkdf2Sync(Buffer.from(mnemonic.normalize('NFKD')), Buffer.from('mnemonic'), 2048, 64, 'sha512');
  const I = crypto.createHmac('sha512', 'Bitcoin seed').update(seed).digest();
  const pub = secp256k1.getPublicKey(I.subarray(0, 32), true);
  const h = crypto.createHash('ripemd160').update(crypto.createHash('sha256').update(pub).digest()).digest();
  return h.subarray(0, 4).toString('hex');
}

// ---- 1. official BIP39 vectors (Trezor python-mnemonic vectors, no passphrase needed for words)
log('# 1. BIP39 test vectors (words from entropy)');
const VEC = [
  ['00000000000000000000000000000000', 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'],
  ['7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f', 'legal winner thank year wave sausage worth useful legal winner thank yellow'],
  ['80808080808080808080808080808080', 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'],
  ['ffffffffffffffffffffffffffffffff', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'],
  ['0'.repeat(64), 'abandon '.repeat(23) + 'art'],
  ['7f'.repeat(32), 'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title'],
  ['80'.repeat(32), 'letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless'],
  ['f'.repeat(64), 'zoo '.repeat(23) + 'vote'],
];
for (const [h, m] of VEC) {
  const bits = [...Buffer.from(h, 'hex')].flatMap(b => vf.bin(b, 8).split('').map(Number));
  ok(vf.phraseFromBits(bits).join(' ') === m, 'own checksum code vs vector ' + h);
  ok(bip39.entropyToMnemonic(Buffer.from(h, 'hex'), wordlist) === m, '@scure/bip39 vs vector ' + h);
}
log(`vectors: ${VEC.length} x 2 checks done`);

// ---- 2. BIP84 vector for fingerprint/address code
log('# 2. BIP84 vector (abandon x11 about)');
{
  const m = VEC[0][1], w = vf.walletInfo(m);
  ok(w.fingerprint === '73c5da0a', 'fingerprint of BIP84 vector: ' + w.fingerprint);
  ok(fingerprintIndependent(m) === '73c5da0a', 'independent fingerprint path');
  ok(w.firstAddressBIP84 === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'first BIP84 address: ' + w.firstAddressBIP84);
  log(`fingerprint ${w.fingerprint}, address ${w.firstAddressBIP84}`);
}

// ---- 3. Coldcard Seed XOR documentation examples (docs/seed-xor.md, fetched 2026-11-10)
log('# 3. Coldcard Seed XOR documented examples');
function seedXor(parts) {
  const ents = parts.map(p => bip39.mnemonicToEntropy(p, wordlist)); // throws if a part's checksum is wrong
  const x = ents[0].map((b, i) => ents.reduce((acc, e) => acc ^ e[i], 0));
  return bip39.entropyToMnemonic(x, wordlist);
}
{
  const A12 = 'romance wink lottery autumn shop bring dawn tongue range crater truth ability';
  const B12 = 'boat unfair shell violin tree robust open ride visual forest vintage approve';
  const C12 = 'lion misery divide hurry latin fluid camp advance illegal lab pyramid unhappy';
  const r12 = seedXor([A12, B12, C12]);
  ok(r12 === 'cannon opinion leader nephew found yard metal galaxy crouch between real trade', '12-word Seed XOR example: ' + r12);
  const A24 = 'romance wink lottery autumn shop bring dawn tongue range crater truth ability miss spice fitness easy legal release recall obey exchange recycle dragon room';
  const B24 = 'lion misery divide hurry latin fluid camp advance illegal lab pyramid unaware eager fringe sick camera series noodle toy crowd jeans select depth lounge';
  const C24 = 'vault nominee cradle silk own frown throw leg cactus recall talent worry gadget surface shy planet purpose coffee drip few seven term squeeze educate';
  const r24 = seedXor([A24, B24, C24]);
  ok(r24 === 'silent toe meat possible chair blossom wait occur this worth option bag nurse find fish scene bench asthma bike wage world quit primary indoor', '24-word Seed XOR example: ' + r24);
  log(`12-word: ${r12}\n24-word: ${r24}`);
}

// ---- 4. extraction code vs independent re-implementations
log('# 4. Extraction code vs independent re-implementations');
{
  // mirror table: rebuilt from its verbal rule
  const rule = (a, b) => { if (a === b) return a < 5 ? null : 30 + (a === 6 ? 1 : 0); const lo = Math.min(a, b), hi = Math.max(a, b); let k = 0; for (let x = 1; x <= 6; x++) for (let y = x + 1; y <= 6; y++) { if (x === lo && y === hi) return 2 * k + (b > a ? 1 : 0); k++; } };
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) ok(vf.mirrorCode(a, b) === rule(a, b), `mirror ${a},${b}`);
  // knockout: "which half holds the maximum", computed on index ranges
  const alt = v => { const n = v.length, out = []; for (let size = 1; size < n; size *= 2) for (let s = 0; s < n; s += 2 * size) out.push(Math.max(...v.slice(s + size, s + 2 * size)) > Math.max(...v.slice(s, s + size)) ? 1 : 0); return out; };
  const R = crypto.randomBytes(4).readUInt32LE(0); let x = R | 1;
  for (let t = 0; t < 20000; t++) { const v = Array.from({ length: 52 }, (_, i) => i); for (let i = 51; i > 0; i--) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; const j = x % (i + 1); [v[i], v[j]] = [v[j], v[i]]; }
    ok(vf.knockout(v.slice(0, 8)).join('') === alt(v.slice(0, 8)).join(''), 'knockout octet');
    ok(vf.knockout(v.slice(0, 4)).join('') === alt(v.slice(0, 4)).join(''), 'knockout quad'); }
  ok(JSON.stringify(vf.cardPlan(128)) === JSON.stringify([[8, 8, 8, 8, 8, 8, 4], [8, 8, 8, 8, 8, 8, 4], [8, 8, 8, 8, 8, 4]]), '12-word card plan');
  ok(JSON.stringify(vf.cardPlan(256)) === JSON.stringify([...Array(5).fill([8, 8, 8, 8, 8, 8, 4]), [8, 8, 8, 8, 4]]), '24-word card plan');
  log('mirror table 36 cells, 20000 octet + 20000 quad knockouts, card plans: checked');
}

// ---- 5. random end-to-end trials
function randomInput(words) {
  const dice = []; let acc = 0; const need = vf.PLAN[words].symbols;
  while (acc < need + 2) { const a = 1 + crypto.randomInt(6), b = 1 + crypto.randomInt(6); dice.push([a, b]); if (vf.mirrorCode(a, b) !== null) acc++; }
  const cards = vf.cardPlan(vf.PLAN[words].bits).map(() => { const d = Array.from({ length: 52 }, (_, i) => i); for (let i = 51; i > 0; i--) { const j = crypto.randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; } return d.map(vf.cardName); });
  return { words, dice, cards };
}
for (const words of [12, 24]) {
  log(`# 5. ${N} random end-to-end trials, ${words} words`);
  let diceFail = 0, cardFail = 0, mutCaught = { cell: 0, word: 0, swapMR: 0, swapMRK: 0, swapN: 0 }, mutN = 0;
  const t0 = Date.now();
  for (let t = 0; t < N; t++) {
    const inp = randomInput(words), r = vf.forge(inp), P = vf.PLAN[words];
    const D = bytesOf(r.D.bits), C = bytesOf(r.C.bits), E = bytesOf(r.E.bits);
    ok(hex(E) === hex(D.map((b, i) => b ^ C[i])), 'E = D xor C');
    const m = bip39.entropyToMnemonic(E, wordlist);
    ok(r.E.phrase.join(' ') === m, 'E phrase vs @scure/bip39');
    ok(bip39.validateMnemonic(m, wordlist), 'E phrase valid');
    const mD = bip39.entropyToMnemonic(D, wordlist), mC = bip39.entropyToMnemonic(C, wordlist);
    ok(r.D.phrase.join(' ') === mD && r.C.phrase.join(' ') === mC, 'D and C phrases vs @scure/bip39');
    ok(seedXor([mD, mC]) === m, 'Seed XOR of the two sheets = final seed');
    ok(r.E.seal.M && r.E.seal.R && r.E.seal.K, 'forge seal M(E)=M(D)^M(C), R, K');
    for (const k of ['M', 'R', 'K']) ok(vf.xorStr(r.D.marks[k], r.C.marks[k]) === r.E.marks[k], 'marks linear ' + k);
    // the hand words equal the first words of the phrase
    r.E.handWords.filter(h => !h.partial).forEach((h, i) => ok(h.word === r.E.phrase[i], 'hand word ' + (i + 1)));
    ok(r.E.finalWordInBlock, 'final word inside the hand range');
    // final word as SeedSigner computes it: 7 (3) bits + zeros, then checksum fixed up
    const last = r.E.handWords[r.E.handWords.length - 1];
    const fwIdx = wordlist.indexOf(r.E.phrase[words - 1]);
    ok(vf.bin(fwIdx, 11).slice(0, P.finalBits) === last.bits, 'final word starts with the sheet bits');
    // fingerprint vs independent path (every 10th trial: PBKDF2 is slow)
    if (t % 10 === 0) { ok(r.wallet.fingerprint === fingerprintIndependent(m), 'fingerprint vs independent path');
      const k = HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(m)); ok(k.fingerprint.toString(16).padStart(8, '0') === r.wallet.fingerprint, 'fingerprint vs bip32'); }
    if (!r.bias.dice.pass) diceFail++; cardFail += r.bias.cards.filter(c => !c.pass).length;
    // mutation tests on E (what the seal and the heir check see)
    if (t < 1000) {
      mutN++;
      const e = [...r.E.bits].map(Number);
      const cell = e.slice(); cell[crypto.randomInt(P.bits)] ^= 1; const mc = vf.marks(cell);
      if (mc.M !== r.E.marks.M || mc.R !== r.E.marks.R) mutCaught.cell++;
      const fr = P.bits >> 0, full = Math.floor(P.bits / 11);
      const w = e.slice(); const row = crypto.randomInt(full); let nv; do nv = crypto.randomInt(2048); while (nv === parseInt(e.slice(row * 11, row * 11 + 11).join(''), 2));
      vf.bin(nv, 11).split('').forEach((c, i) => { w[row * 11 + i] = +c; }); const mw = vf.marks(w);
      if (mw.M !== r.E.marks.M) mutCaught.word++;
      const a = crypto.randomInt(full); let b; do b = crypto.randomInt(full); while (b === a);
      const s = e.slice(); for (let i = 0; i < 11; i++) { s[a * 11 + i] = e[b * 11 + i]; s[b * 11 + i] = e[a * 11 + i]; }
      if (s.join('') !== e.join('')) { mutCaught.swapN++; const ms = vf.marks(s); if (ms.M !== r.E.marks.M || ms.R !== r.E.marks.R) mutCaught.swapMR++; if (ms.M !== r.E.marks.M || ms.R !== r.E.marks.R || ms.K !== r.E.marks.K) mutCaught.swapMRK++; }
    }
  }
  log(`${N} trials in ${((Date.now() - t0) / 1000).toFixed(1)} s; dice bias box false alarms ${diceFail} (${(100 * diceFail / N).toFixed(2)}%), card decks failing ${cardFail} of ${N * vf.cardPlan(vf.PLAN[words].bits).length}`);
  log(`mutations on E (${mutN}): one cell flipped caught by M+R ${mutCaught.cell}/${mutN}; one word replaced caught by M ${mutCaught.word}/${mutN}; two words swapped caught by M+R ${mutCaught.swapMR}/${mutCaught.swapN}, by M+R+K ${mutCaught.swapMRK}/${mutCaught.swapN}`);
}

// ---- 6. the printed sheet carries the same mirror table as the code
const sheet = path.join(__dirname, '..', 'forge-sheet.html');
if (fs.existsSync(sheet)) {
  log('# 6. Printed sheet consistency');
  const html = fs.readFileSync(sheet, 'utf8');
  const cells = [...html.matchAll(/data-a="(\d)" data-b="(\d)" data-code="([01]{5}|again)"/g)];
  ok(cells.length >= 36, 'sheet has the 36 mirror cells, found ' + cells.length);
  for (const [, a, b, c] of cells) { const code = vf.mirrorCode(+a, +b); ok((code === null ? 'again' : vf.bin(code, 5)) === c, `sheet mirror cell ${a},${b}`); }
  const sk = [...html.matchAll(/data-r="(\d+)" data-c="(\d+)" data-k="([a-k])"/g)];
  for (const [, r, c, k] of sk) ok(vf.skewLetter(+r - 1, +c - 1) === k, `sheet skew letter ${r},${c}`);
  log(`sheet: ${cells.length} mirror cells and ${sk.length} skew letters checked`);
}
const tbl = path.join(__dirname, '..', 'bip39-binary-table.html');
if (fs.existsSync(tbl)) {
  const html = fs.readFileSync(tbl, 'utf8');
  const cells = [...html.matchAll(/data-i="(\d+)"(?: class="l")?>([a-z]+)</g)];
  ok(cells.length === 2048, 'binary table has 2048 words: ' + cells.length);
  for (const [, i, w] of cells) ok(wordlist[+i] === w, 'binary table word ' + i);
  log(`binary word table: ${cells.length} words checked against @scure/bip39 english list`);
}

log(`\nTOTAL: ${checks} checks, ${fails} failures`);
fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'results', 'test-results.txt'), `node ref/test.js ${N}  (${new Date().toISOString()})\n` + lines.join('\n') + '\n');
process.exit(fails ? 1 : 0);
