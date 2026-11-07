// VOIDFORGE vendor test (Test upgrade): "Check your device's dice" against the device makers' own dice rules.
// tests/vendor/fetch.sh downloads the dice files of SeedSigner, Coldcard and Keystone at pinned commits; tests/vendor/oracle.py
// finds the exact lines that make the words in that source (it stops if one is gone) and works out the words they give.
// This test then types the same rolls into the page's check and compares the words, and the refusals.
// Needs git, python3 and the Python package embit (pip install embit==0.8.0). Without them it says SKIPPED.
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
R.done('vendor');
