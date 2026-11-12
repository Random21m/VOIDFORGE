// VOIDFORGE in three browser engines (Test upgrade): Chromium (Chrome, Edge, Brave), Firefox (Gecko) and WebKit (Safari).
// The same short check runs in each: the self-test passes, known rolls give the published words, fingerprint and address
// (from @scure), VERIFY and Open this wallet agree, the Wallet Detective finds an address, a dice passphrase is made, the
// watch check finds nothing but the test browser's own automation flag, and no page error happens on the way.
// An engine that is not installed is reported as SKIPPED. The CI image (mcr.microsoft.com/playwright, in .github/workflows/tests.yml) has all three.
//
// Run: node tests/browsers.test.mjs           (BROWSERS=chromium,firefox,webkit to choose)
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const pw = require('playwright-core');
const { HDKey } = require('@scure/bip32');
const { mnemonicToSeedSync } = require('@scure/bip39');
const { bech32 } = require('@scure/base');
const { ripemd160 } = require('@noble/hashes/ripemd160');
const { sha256 } = require('@noble/hashes/sha256');
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + (process.env.VF_FILE || path.join(here, '..', 'voidforge.html'));
const ENGINES = (process.env.BROWSERS || 'chromium,firefox,webkit').split(',');
let pass = 0, ran = 0; const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fails.push(m); console.log('FAIL ' + m); } };

// Expected values from @scure, for 50 rolls "1111...2222" (as SeedSigner and the page hash them).
const ROLLS = '1'.repeat(25) + '2'.repeat(25), AB = 'abandon '.repeat(11) + 'about';
const addr84 = (m, p, c, i) => { const k = HDKey.fromMasterSeed(mnemonicToSeedSync(m, p)).derive(`m/84'/0'/0'/${c}/${i}`); return bech32.encode('bc', [0, ...bech32.toWords(ripemd160(sha256(k.publicKey)))]); };
const fpOf = (m, p) => HDKey.fromMasterSeed(mnemonicToSeedSync(m, p)).fingerprint.toString(16).padStart(8, '0');

// Opening the page. The normal way: the file itself, with the browser context offline. WebKit's Linux test build can fail
// to open a file:// page while offline ("WebKit encountered an internal error"); for WebKit only, two more ways are then
// tried, each still with no outside network: the file with every http(s) request aborted, then offline; or the same bytes
// served from 127.0.0.1 with every other request aborted, then offline. The way that worked is printed as a NOTE.
const WAY_FIRST = 'file, offline';
let server, serverUrl;
async function serve() {
  if (serverUrl) return serverUrl;
  const http = await import('node:http'), fs = await import('node:fs');
  const body = fs.readFileSync(fileURLToPath(FILE));
  server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(body); });
  await new Promise((ok2) => server.listen(0, '127.0.0.1', ok2)); server.unref();
  return (serverUrl = 'http://127.0.0.1:' + server.address().port + '/voidforge.html');
}
async function openPage(browser, name) {
  const ways = [[WAY_FIRST, async (ctx, p) => { await ctx.setOffline(true); await p.goto(FILE); }]];
  if (name === 'webkit') ways.push(
    ['file, web requests aborted, then offline', async (ctx, p) => { await ctx.route(/^https?:/, (r) => r.abort()); await p.goto(FILE); await ctx.setOffline(true); }],
    ['127.0.0.1, other requests aborted, then offline', async (ctx, p) => { const url = await serve(); await ctx.route((u) => !String(u).startsWith(url), (r) => r.abort()); await p.goto(url); await ctx.setOffline(true); }]);
  let last;
  for (const [how, go] of ways) {
    const ctx = await browser.newContext(), p = await ctx.newPage(), errors = [];
    p.on('pageerror', (e) => errors.push(e.message)); p.on('dialog', (d) => d.accept());
    try { await go(ctx, p); await p.waitForFunction(() => document.body.classList.contains('js-ok')); return { p, how, errors }; }
    catch (e) { last = e; console.log('NOTE ' + name + ': could not open the page as ' + how + ': ' + String(e.message).split('\n')[0]); await ctx.close().catch(() => {}); }
  }
  throw last;
}

for (const name of ENGINES) {
  let browser;
  try { browser = await pw[name].launch(); } catch (e) { console.log('SKIPPED ' + name + ' (not installed here: ' + String(e.message).split('\n')[0].slice(0, 80) + ')'); continue; }
  ran++;
  const L = (m) => name + ': ' + m;
  try {
    const t0 = Date.now();
    const { p, how, errors } = await openPage(browser, name);
    if (how !== WAY_FIRST) console.log('NOTE ' + L('opened as: ' + how + ' (the first way, ' + WAY_FIRST + ', failed in this engine build)'));
    await p.waitForFunction(() => /PASSED|FAILED/.test(document.getElementById('selfTestBadge').textContent), null, { timeout: 180000 });
    ok(/PASSED/.test(await p.textContent('#selfTestBadge')), L('the self-test passes (' + Math.round((Date.now() - t0) / 1000) + ' s)'));
    await p.evaluate(() => { const g = document.getElementById('sgGo'); if (g) g.click(); window.print = () => {}; });
    // known rolls -> words, fingerprint, first address
    const r = await p.evaluate(async (rolls) => {
      const e = document.querySelector('input[name=words][value="12"]'); if (e) { e.checked = true; e.onchange && e.onchange(); }
      document.getElementById('rolls').value = rolls; document.getElementById('rolls').oninput && document.getElementById('rolls').oninput(); await generate();
      return { words: document.getElementById('genResult').textContent.split('\n')[0].trim(), fp: document.getElementById('fingerprint').textContent, addr: document.getElementById('address').textContent };
    }, ROLLS);
    const want = await import('@scure/bip39').then((b) => import('@scure/bip39/wordlists/english').then((wl) => b.entropyToMnemonic(sha256(new TextEncoder().encode(ROLLS)).subarray(0, 16), wl.wordlist)));
    ok(r.words === want, L('50 rolls give the same 12 words as @scure'));
    ok(r.fp.includes(fpOf(want, '')) && r.addr.includes(addr84(want, '', 0, 0)), L('the fingerprint and first address are the ones @scure gives'));
    // VERIFY + Open this wallet with the published BIP84 test words
    const v = await p.evaluate(async (m) => { showTab('check'); document.getElementById('phrase').value = m; document.getElementById('verifyPass').value = ''; await verify(); await new Promise((x) => setTimeout(x, 800)); return { st: document.getElementById('verifyStatus').textContent, list: [...document.getElementById('wvList').children].map((li) => li.firstChild.textContent).slice(0, 3) }; }, AB);
    ok(/fingerprint/i.test(v.st) && v.st.includes(fpOf(AB, '')), L('VERIFY accepts the BIP84 test words and shows their fingerprint'));
    ok(v.list.length === 3 && v.list.every((a, i) => a === addr84(AB, '', 0, i)), L('Open this wallet lists the BIP84 test addresses'));
    // Wallet Detective: an address on the old m/0' path
    const d = await p.evaluate(async () => { document.getElementById('detAddr').value = 'bc1q2rs5z7px202schemlcs8xg0nanckrvx8zr0479'; await detFind(); return document.getElementById('detOut').textContent; });
    ok(/change address #7 \(m\/0'\/1\/7\)/.test(d), L('the Wallet Detective finds a change address on the m/0\' path'));
    // dice passphrase
    const dp = await p.evaluate(async () => { showTab('make'); document.getElementById('dpRolls').value = '25163452616341525364152634'; await dpMake(); return document.getElementById('dpOut').textContent; });
    ok(/broom beyond perfect dwarf learn fruit/.test(dp), L('the dice passphrase matches the self-test vector'));
    // watch check: only the automation flag of the test browser itself
    const signs = await p.evaluate(() => watchSigns());
    ok(signs.every((s) => /automation software/.test(s)), L('the watch check finds no sign other than the test browser\'s automation flag' + (signs.length ? ' (' + signs.length + ')' : '')));
    await p.evaluate(() => clearAll()); await p.waitForTimeout(300);
    ok(await p.evaluate(() => !document.getElementById('phrase').value && !document.getElementById('detOut').textContent), L('CLEAR ALL empties the boxes'));
    ok(errors.length === 0, L('no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : '')));
  } catch (e) { ok(false, L('the test stopped: ' + String(e.message).split('\n')[0])); }
  await browser.close();
}
if (!ran) { console.log('BROWSERS: SKIPPED (no browser engine installed)'); process.exit(0); }
console.log('BROWSERS: ' + pass + ' pass, ' + fails.length + ' fail (' + ran + ' of ' + ENGINES.length + ' engines ran)');
process.exit(fails.length ? 1 : 0);
