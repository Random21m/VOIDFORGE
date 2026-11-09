// VOIDFORGE vendor test (Test upgrade): "Check your device's dice" against the device makers' own dice rules.
// tests/vendor/fetch.sh downloads the dice files of SeedSigner, Coldcard and Keystone at pinned commits; tests/vendor/oracle.py
// finds the exact lines that make the words in that source (it stops if one is gone) and works out the words they give.
// This test then types the same rolls into the page's check and compares the words, and the refusals.
// Needs git, python3 and the Python package embit (pip install embit==0.8.0). Without them it says SKIPPED.
//
// v2.10.0: also Check a Coldcard seed mix, against Coinkite's own checker (tests/vendor/mix_oracle.py).
//
// Run: sh tests/vendor/fetch.sh && node tests/vendor.test.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import nc from 'node:crypto';
import { loadPage, ready, readHtml, makeReporter } from './harness.mjs';

const R = makeReporter();
const here = new URL('./vendor/', import.meta.url);
if (!fs.existsSync(new URL('src/coldcard/shared/seed.py', here))) { console.log('VENDOR: SKIPPED (run sh tests/vendor/fetch.sh first)'); process.exit(0); }
try { execFileSync('python3', ['-c', 'import embit'], { stdio: 'ignore' }); } catch (e) { console.log('VENDOR: SKIPPED (needs python3 with embit: pip install embit==0.8.0)'); process.exit(0); }

const w = await ready(loadPage(readHtml()));
const $ = (id) => w.document.getElementById(id);
const card = w.eval('DC_CARD_ROLLS');
const roll = (n, faces = '123456') => Array.from({ length: n }, () => faces[nc.randomInt(faces.length)]).join('');
const balanced = (n) => { let s; do { s = roll(n); } while ([...'123456'].some((f) => s.split(f).length - 1 > 0.3 * n)); return s; };
const cases = [];
for (const [n, wc] of [[50, 12], [99, 24], [100, 24]]) cases.push({ rolls: card.slice(0, n), words: wc });   // the printed test card
for (const [n, wc] of [[50, 12], [51, 12], [80, 12], [99, 24], [100, 24], [150, 24], [256, 24], [256, 12]]) for (let k = 0; k < 3; k++) cases.push({ rolls: balanced(n), words: wc });
cases.push({ rolls: '1'.repeat(20) + balanced(40), words: 12 });     // one face over 30%: Coldcard refuses
cases.push({ rolls: roll(49), words: 12 }, { rolls: roll(98), words: 24 }, { rolls: balanced(99), words: 24 }, { rolls: balanced(257), words: 24 });
const out = JSON.parse(execFileSync('python3', [new URL('oracle.py', here).pathname], { input: JSON.stringify(cases) }).toString());
console.log('vendor rules found in the pinned sources; Keystone: ' + JSON.stringify(out.keystone_rules));

// The page's own check, as a person uses it.
async function page(dev, wc, rolls) {
  $('dcDev').value = dev; $('dcLen').value = String(wc); $('dcRolls').value = rolls; await w.dcCheck();
  const st = $('dcStatus'), words = [...$('dcOut').textContent.matchAll(/\d+\. ([a-z]+)/g)].map((m) => m[1]).join(' ');
  return { bad: /\bbad\b/.test(st.className), st: st.textContent, words };
}
let same = 0;
for (const c of out.cases) for (const dev of ['seedsigner', 'coldcard', 'keystone']) {
  const v = c[dev], p = await page(dev, c.words, c.rolls), what = dev + ', ' + c.words + ' words, ' + c.rolls.length + ' rolls';
  if (v.words) { if (p.words === v.words && !p.bad) same++; else R.ok(false, what + ': the page shows other words than the device rules give' + (p.bad ? ' (it refused: ' + p.st.slice(0, 120) + ')' : '')); }
  else R.ok(p.bad, what + ': the device refuses (' + v.refused + '), and so must the page' + (p.bad ? '' : ' (the page showed words)'));
}
R.ok(same > 40, 'the page shows the same words as the device rules in every accepted case (' + same + ' checks, including the printed test card)');

// v2.10.0: Check a Coldcard seed mix, against Coinkite's own checker (docs/verify_seed_mix.py, its pure functions taken out and run by
// tests/vendor/mix_oracle.py) and the formula in the firmware (shared/seed.py), both at the commit of release 1.5.3Q.
if (fs.existsSync(new URL('src/coldcard-mix/shared/seed.py', here))) {
  const bits = (n) => Array.from({ length: n }, () => '10'[nc.randomInt(2)]).join('');
  const fair = (s, lim) => [...new Set(s)].every((f) => s.split(f).length - 1 <= lim * s.length);
  const mixCases = [];
  for (const [kind, n] of [['d', 50], ['d', 51], ['d', 99], ['d', 160], ['c', 128], ['c', 129], ['c', 200]]) for (const words of [12, 24]) for (const tmp of [false, true]) {
    let s; do { s = kind === 'd' ? roll(n) : bits(n); } while (!fair(s, kind === 'd' ? 0.3 : 0.65));
    mixCases.push({ trng: nc.randomBytes(32).toString('hex'), symbols: s, method: kind, words, tmp });
  }
  mixCases.push({ trng: '00'.repeat(32), symbols: '123456'.repeat(8) + '12', method: 'd', words: 12, tmp: false });   // Coinkite's test vector
  mixCases.push({ trng: nc.randomBytes(32).toString('hex'), symbols: '1'.repeat(16) + roll(34, '23456'), method: 'd', words: 12, tmp: false });   // one face over 30%
  mixCases.push({ trng: nc.randomBytes(32).toString('hex'), symbols: '1'.repeat(90) + '0'.repeat(40), method: 'c', words: 24, tmp: false });   // one side over 65%
  mixCases.push({ trng: nc.randomBytes(32).toString('hex'), symbols: roll(49), method: 'd', words: 24, tmp: true }, { trng: nc.randomBytes(32).toString('hex'), symbols: bits(127), method: 'c', words: 12, tmp: false });
  const mo = JSON.parse(execFileSync('python3', ['-I', new URL('mix_oracle.py', here).pathname], { input: JSON.stringify(mixCases) }).toString());
  R.ok(mo.coinkite_vectors.vectors === 4, 'Coldcard mix: the extracted checker gives Coinkite\'s 4 test vectors (testing/test_rolls.py), and the firmware lines are where the oracle expects them');
  let agree = 0;
  for (const c of mo.cases) {
    $('cmxTrng').value = c.trng_words || (await w.entropyToMnemonic(Uint8Array.from(Buffer.from(c.trng, 'hex'))));
    $('cmxMethod').value = c.method.toUpperCase(); $('cmxLen').value = String(c.words); $('cmxPurpose').value = c.tmp ? 'T' : 'M'; $('cmxRolls').value = c.symbols;
    await w.cmxCheck();
    const st = $('cmxStatus'), got = [...$('cmxOut').textContent.matchAll(/\d+\. ([a-z]+)/g)].map((m) => m[1]).join(' ');
    const what = 'Coldcard mix, ' + (c.method === 'd' ? 'dice' : 'coin') + ', ' + c.symbols.length + ', ' + c.words + ' words' + (c.tmp ? ', temporary' : '');
    if (c.mnemonic) { if (got === c.mnemonic && !/\bbad\b/.test(st.className)) agree++; else R.ok(false, what + ': the page shows other words than Coinkite\'s checker (' + st.textContent.slice(0, 100) + ')'); }
    else R.ok(/\bbad\b/.test(st.className) && !got, what + ': the Coldcard refuses (' + c.refused + '), and so must the page');
  }
  R.ok(agree >= 29, 'Coldcard mix: the page shows the same words as Coinkite\'s checker in every accepted case (' + agree + ' checks, both lengths, New Seed Words and Temporary Seed)');
} else console.log('Coldcard mix: SKIPPED (run sh tests/vendor/fetch.sh for the coldcard-mix files)');
R.done('vendor');
