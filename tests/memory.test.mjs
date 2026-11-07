// VOIDFORGE memory test (Test upgrade): after CLEAR ALL, and after END SESSION, are the secrets still held by the page?
// It drives the real page in Chromium, enters secrets that occur nowhere else (made-up rolls, a seed from them, unique
// passphrases), wipes, lets the browser collect garbage, takes a heap snapshot through the DevTools protocol and searches
// every string in it. A secret found there is still reachable from the page's JavaScript (a snapshot only holds live
// objects), so the wipe missed it. This cannot see copies outside the JavaScript heap (the browser's own text-box
// buffers, the GPU, swap), which is why the page says that wiping is a precaution, not a guarantee.
//
// Run: node tests/memory.test.mjs        (MEM_DEBUG=1 prints where a found string is held)
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import nc from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + (process.env.VF_FILE || path.join(here, '..', 'voidforge.html'));
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fails.push(m); console.log('FAIL ' + m); } };

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log('MEMORY: SKIPPED (no Chromium: ' + e.message.split('\n')[0] + ')'); process.exit(0); }
const ctx = await browser.newContext(); await ctx.setOffline(true);
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (d) => d.accept());
const cdp = await ctx.newCDPSession(p);
await cdp.send('HeapProfiler.enable');

// All strings in a fresh heap snapshot (after two forced garbage collections).
async function heapStrings() {
  for (let i = 0; i < 2; i++) await cdp.send('HeapProfiler.collectGarbage');
  let json = ''; const onChunk = (c) => { json += c.chunk; };
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  return JSON.parse(json).strings;
}
const findIn = (strings, needles) => needles.filter(([, s]) => strings.some((x) => x.includes(s))).map(([n]) => n);

await p.goto(FILE);
await p.waitForFunction(() => document.body.classList.contains('js-ok'));
await p.waitForFunction(() => /PASSED/.test(document.getElementById('selfTestBadge').textContent), null, { timeout: 120000 });
await p.evaluate(() => { const g = document.getElementById('sgGo'); if (g) g.click(); window.print = () => {}; });

// Secrets that appear nowhere else: random rolls, the seed they make, and two random passphrases.
const rolls = Array.from({ length: 99 }, () => 1 + nc.randomInt(6)).join('');
const pass1 = 'Mem' + nc.randomBytes(8).toString('hex'), pass2 = 'Vrf' + nc.randomBytes(8).toString('hex');
await p.evaluate(async ([rolls, pw]) => {
  const words = document.querySelector('input[name=words][value="24"]'); if (words) { words.checked = true; words.onchange && words.onchange(); }
  document.getElementById('rolls').value = rolls; document.getElementById('rolls').oninput && document.getElementById('rolls').oninput();
  document.getElementById('passphrase').value = pw; document.getElementById('passphrase2').value = pw;
  await generate();
}, [rolls, pass1]);
const mnemonic = await p.evaluate(() => document.getElementById('genResult').textContent.split('\n')[0].trim());
ok(mnemonic.split(' ').length === 24, 'setup: a 24-word seed was made from random rolls');
// Use it the way people do: check it, open the wallet, the Detective, a dice passphrase, a child seed.
await p.evaluate(async ([m, pw]) => {
  showTab('check');
  document.getElementById('phrase').value = m; document.getElementById('verifyPass').value = pw;
  await verify();
  document.getElementById('detAddr').value = ''; await detList();
  document.getElementById('dpRolls').value = '1234561234561234561234561234'; await dpMake();
}, [mnemonic, pass2]);
await p.waitForTimeout(1500);
const secrets = [['the seed words', mnemonic], ['the first eight seed words', mnemonic.split(' ').slice(0, 8).join(' ')], ['the rolls', rolls], ['the passphrase of the made seed', pass1], ['the passphrase in CHECK A BACKUP', pass2]];
{ const s = await heapStrings(); const there = findIn(s, secrets); ok(there.length >= 3, 'control: before wiping, the secrets are in the heap (' + there.join(', ') + '), so the search works'); }

// CLEAR ALL
await p.evaluate(() => clearAll());
await p.waitForTimeout(1500);
{ const s = await heapStrings(); const there = findIn(s, secrets);
  ok(there.length === 0, 'CLEAR ALL: no secret is still held by the page' + (there.length ? ' (still held: ' + there.join(', ') + ')' : ''));
  if (process.env.MEM_DEBUG && there.length) for (const [n, v] of secrets) for (const x of s) if (x.includes(v)) console.log('  ' + n + ' inside: ' + JSON.stringify(x.slice(0, 160))); }

// Auto-clear (the idle timer or a hidden tab calls the same wipe)
await p.evaluate(async ([rolls, pw, m, pw2]) => {
  showTab('make'); document.getElementById('rolls').value = rolls; document.getElementById('passphrase').value = pw; document.getElementById('passphrase2').value = pw; await generate();
  showTab('check'); document.getElementById('phrase').value = m; document.getElementById('verifyPass').value = pw2; await verify();
  autoWipe('in the memory test');
}, [rolls, pass1, mnemonic, pass2]);
await p.waitForTimeout(1500);
{ const s = await heapStrings(); const there = findIn(s, secrets); ok(there.length === 0, 'auto-clear: no secret is still held by the page' + (there.length ? ' (still held: ' + there.join(', ') + ')' : '')); }

// END SESSION (it reloads the page)
await p.evaluate(async ([rolls, pw]) => {
  document.getElementById('rolls').value = rolls; document.getElementById('passphrase').value = pw; document.getElementById('passphrase2').value = pw; await generate();
}, [rolls, pass1]);
await Promise.all([p.waitForEvent('load'), p.evaluate(() => endSession())]);
await p.waitForFunction(() => document.body.classList.contains('js-ok'));
await p.waitForTimeout(1500);
{ const s = await heapStrings(); const there = findIn(s, secrets); ok(there.length === 0, 'END SESSION: after the reload no secret is in the page\'s heap' + (there.length ? ' (still held: ' + there.join(', ') + ')' : '')); }

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log('MEMORY: ' + pass + ' pass, ' + fails.length + ' fail');
process.exit(fails.length ? 1 : 0);
