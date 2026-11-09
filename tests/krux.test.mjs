// VOIDFORGE Krux test (v2.10.0): the punch plate layouts (binary grid, Stackbit 1248, word numbers) and reading them back,
// against Krux's own code. tests/vendor/fetch.sh downloads four Krux files at a pinned commit; tests/vendor/krux_oracle.py
// checks their SHA-256, takes only the functions that number, punch and read back the words out of them, and runs those on
// their own (Krux itself is never run). This test then compares the page with them for every one of the 2048 words, for
// random phrases of every length, and for numbers typed back in, both ways.
// Needs git, python3 and the Python package embit (pip install embit==0.8.0). Without them it says SKIPPED.
//
// Run: sh tests/vendor/fetch.sh && node tests/krux.test.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import nc from 'node:crypto';
import { createRequire } from 'node:module';
import { loadPage, ready, readHtml, makeReporter } from './harness.mjs';
const require = createRequire(import.meta.url);
const { generateMnemonic } = require('@scure/bip39');
const { wordlist } = require('@scure/bip39/wordlists/english');

const R = makeReporter();
const here = new URL('./vendor/', import.meta.url);
if (!fs.existsSync(new URL('src/krux/src/krux/pages/tiny_seed.py', here))) { console.log('KRUX: SKIPPED (run sh tests/vendor/fetch.sh first)'); process.exit(0); }
try { execFileSync('python3', ['-c', 'import embit'], { stdio: 'ignore' }); } catch (e) { console.log('KRUX: SKIPPED (needs python3 with embit: pip install embit==0.8.0)'); process.exit(0); }

const chunks = []; for (let i = 0; i < 2048; i += 12) chunks.push(Array.from({ length: 12 }, (_, k) => wordlist[(i + k) % 2048]));
const mnemonics = [128, 160, 192, 224, 256].flatMap((b) => Array.from({ length: 4 }, () => generateMnemonic(wordlist, b)));
const tok = { 10: (n) => String(n), 16: (n) => n.toString(16).toUpperCase(), 8: (n) => n.toString(8) };
const reads = [];
for (const base of [10, 16, 8]) {
  for (const n of [1, 2, 7, 8, 9, 10, 15, 16, 63, 64, 255, 256, 511, 512, 1000, 1023, 1024, 2047, 2048]) reads.push([tok[base](n), base]);
  for (const n of [0, 2049, 4095]) reads.push([tok[base](n), base]);
  for (let k = 0; k < 20; k++) reads.push([tok[base](1 + nc.randomInt(2048)), base]);
}
reads.push(['7e0', 16], ['0800', 16], ['0001', 10], ['04000', 8]);   // lower-case hex and leading zeros
const K = JSON.parse(execFileSync('python3', ['-I', new URL('krux_oracle.py', here).pathname], { input: JSON.stringify({ chunks, mnemonics, reads }), maxBuffer: 1 << 26 }).toString());
R.ok(JSON.stringify(K.labels) === JSON.stringify({ upper: [1, 1, 2, 1, 2, 1, 2], lower: [2, 4, 8, 4, 8, 4, 8] }), 'Krux Stackbit boxes are labelled 1 2 over 2 4 8 4 8 4 8 (the thousands digit has only 1 and 2)');

const w = await ready(loadPage(readHtml()));
const $ = (id) => w.document.getElementById(id);
R.ok(/PASSED/.test($('selfTestBadge').textContent), 'the page passes its self-test');

// 1. Every word: the binary grid, the Stackbit boxes and digits, from Krux's own drawing code.
let gridOk = 0, stackOk = 0, digOk = 0; const bad = [];
for (const word of wordlist) {
  const k = K.words[word], n = w.pnNum(word);
  const grid = w.pnBits(n).map((b, i) => (b ? 2048 >> i : 0)).filter(Boolean);
  if (JSON.stringify(grid) === JSON.stringify(k.tiny)) gridOk++; else bad.push('grid ' + word);
  if (JSON.stringify(Array.from(w.pnStack(n), (d) => Array.from(d).sort((a, b) => a - b))) === JSON.stringify(k.stack)) stackOk++; else bad.push('stack ' + word);
  if (String(n).padStart(4, '0') === k.digits) digOk++; else bad.push('digits ' + word);
}
R.ok(gridOk === 2048, 'binary grid: all 2048 words punch the same cells as Krux TinySeed (' + gridOk + ')' + (bad.length ? ' ' + bad.slice(0, 5).join(', ') : ''));
R.ok(stackOk === 2048 && digOk === 2048, 'Stackbit 1248: all 2048 words punch the same boxes as Krux, as the same 4 digits (' + stackOk + ', ' + digOk + ')');

// 2. Word numbers of whole phrases of every length, in the three bases, as Krux writes them.
let numOk = 0;
mnemonics.forEach((m, i) => { const ns = m.split(' ').map((x) => w.pnBases(w.pnNum(x))); if (['dec', 'hex', 'oct'].every((b) => ns.map((x) => x[b]).join(' ') === K.mnemonics[i][b])) numOk++; });
R.ok(numOk === mnemonics.length, 'word numbers: decimal, hexadecimal and octal of ' + mnemonics.length + ' random phrases of 12 to 24 words equal Krux get_mnemonic_numbers (' + numOk + ')');

// 3. Reading back: what Krux reads for a typed number, the page reads too, and both refuse the same numbers.
let readOk = 0; const rbad = [];
reads.forEach(([t, base], i) => { const p = w.pnParse(t, base), want = K.reads[i]; if (want ? p.words && p.words.join() === want : !!p.error) readOk++; else rbad.push(base + ':' + t); });
R.ok(readOk === reads.length, 'read back: ' + reads.length + ' typed numbers in the three bases give the word Krux gives, or are refused where Krux refuses them (' + readOk + ')' + (rbad.length ? ' ' + rbad.join(', ') : ''));
let rtOk = 0;
mnemonics.forEach((m, i) => { if (['dec', 'hex', 'oct'].every((b) => (w.pnParse(K.mnemonics[i][b], { dec: 10, hex: 16, oct: 8 }[b]).words || []).join(' ') === m)) rtOk++; });
R.ok(rtOk === mnemonics.length, 'read back: Krux\'s own numbers for each phrase, in each base, give the phrase again (' + rtOk + ')');
let tickOk = 0;
for (const ch of chunks) {
  const g = w.pnReadRows('grid', ch.map((x) => w.eval('PN_COLS').map((c) => (K.words[x].tiny.includes(c) ? 1 : 0))));
  const s = w.pnReadRows('stack', ch.map((x) => w.eval('PN_SCOLS').map(([d, b]) => (K.words[x].stack[d].includes(b) ? 1 : 0))));
  if (g.words && g.words.join() === ch.join() && s.words && s.words.join() === ch.join()) tickOk++;
}
R.ok(tickOk === chunks.length, 'read back: the holes Krux punches for all 2048 words, ticked on the page\'s binary grid and Stackbit plate, give the words again (' + tickOk + ' plates)');

// 4. On the screen: VERIFY a 24-word phrase, then the plate shown has its dots where Krux punches.
const m24 = mnemonics.find((m) => m.split(' ').length === 24), K24 = JSON.parse(execFileSync('python3', ['-I', new URL('krux_oracle.py', here).pathname], { input: JSON.stringify({ chunks: [m24.split(' ').slice(0, 12), m24.split(' ').slice(12)], mnemonics: [], reads: [] }) }).toString());
$('phrase').value = m24; $('verifyPass').value = ''; await w.verify();
for (let i = 0; i < 200 && !(w.eval('wvCtx') && w.eval('wvCtx.mnemonic')); i++) await new Promise((r) => setTimeout(r, 25));
$('pnFmt').value = 'grid'; w.pnShow(true);
const rows = [...$('pnView').querySelectorAll('tr')].slice(1).map((tr) => [...tr.children].slice(1, 13).map((td) => (td.textContent ? 1 : 0)));
R.ok(rows.length === 24 && rows.every((r, i) => JSON.stringify(w.eval('PN_COLS').filter((c, k) => r[k])) === JSON.stringify(K24.words[m24.split(' ')[i]].tiny)), 'on screen: the binary grid of a 24-word phrase has its dots where Krux punches');
$('pnFmt').value = 'stack'; w.pnRender();
const srows = [...$('pnView').querySelectorAll('tr')].slice(2).map((tr) => [...tr.children].slice(1, 15).map((td) => (td.textContent ? 1 : 0)));
R.ok(srows.length === 24 && srows.every((r, i) => { const st = [[], [], [], []]; w.eval('PN_SCOLS').forEach(([d, b], c) => { if (r[c]) st[d].push(b); }); return JSON.stringify(st) === JSON.stringify(K24.words[m24.split(' ')[i]].stack); }), 'on screen: the Stackbit 1248 plate of a 24-word phrase has its dots where Krux punches');
w.pnShow(false);
R.done('krux');
