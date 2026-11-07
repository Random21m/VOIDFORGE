// VOIDFORGE print test (v2.4.0): every printed sheet must come out as exactly ONE page, on US Letter and on A4,
// with only the sheet on it. It drives the real page in a real browser (Chromium through Playwright) and counts the
// pages of the PDF the browser's own print engine makes, which is what a printer would get.
//
// Run: node tests/print.test.mjs           (uses Playwright's own Chromium, or set PW_CHANNEL=chrome to use an installed
//                                           Google Chrome)
import { createRequire } from 'module';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { HDKey } = require('@scure/bip32');
const { generateMnemonic } = require('@scure/bip39');
const { wordlist } = require('@scure/bip39/wordlists/english');

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + (process.env.VF_FILE || path.join(here, '..', 'voidforge.html'));
const pages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else { fails.push(m); console.log('FAIL ' + m); } };

// With PW_CHANNEL=chrome set, a missing browser is a failure. PW_EXECUTABLE can name a Chromium or Chrome binary.
// Otherwise the test uses Playwright's Chromium or an installed Chrome, and if there is neither it says so and is skipped
// (install one with: npx playwright-core install chromium).
let browser;
if (process.env.PW_CHANNEL) browser = await chromium.launch({ channel: process.env.PW_CHANNEL });
else if (process.env.PW_EXECUTABLE) browser = await chromium.launch({ executablePath: process.env.PW_EXECUTABLE });
else {
  for (const launch of [() => chromium.launch(), () => chromium.launch({ channel: 'chrome' })]) {
    try { browser = await launch(); break; } catch { /* try the next one */ }
  }
  if (!browser) { console.log('PRINT: SKIPPED (no Chromium or Chrome found; run "npx playwright-core install chromium" to enable this test)'); process.exit(0); }
}
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.setOffline(true);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('dialog', (d) => d.accept());
await p.goto(FILE);
await p.waitForFunction(() => document.body.classList.contains('js-ok'));
await p.click('#sgGo');
await p.evaluate(() => { window.print = () => {}; });

// Prints the sheet `fn` makes on each paper size. Making a PDF fires the browser's afterprint event, which wipes the
// sheet, so the sheet is made again for each size. Checks: one page, the sheet has text, and nothing else is laid out.
async function sheet(label, fn, arg) {
  for (const format of ['Letter', 'A4']) {
    await p.evaluate(fn, arg);
    const st = await p.evaluate(() => {
      const kind = document.body.classList.contains('print-qr') ? 'printQr' : document.body.classList.contains('print-seed') ? 'printOnly' : '';
      return { kind, text: kind ? document.getElementById(kind).textContent.length : 0 };
    });
    if (!st.kind || st.text < 20) { ok(false, label + ' (' + format + '): no sheet was made'); continue; }
    await p.emulateMedia({ media: 'print' });
    const shown = await p.evaluate((kind) => [...document.body.children].filter((e) => e.id !== kind && getComputedStyle(e).display !== 'none').map((e) => e.id || e.className || e.tagName), st.kind);
    await p.emulateMedia({ media: null });
    ok(shown.length === 0, label + ' (' + format + '): only the sheet is laid out when printing (also shown: ' + shown.join(', ') + ')');
    const n = pages(await p.pdf({ format }));
    ok(n === 1, label + ' (' + format + '): prints on exactly one page (got ' + n + ')');
    await p.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    ok(await p.evaluate(() => !document.body.classList.contains('print-seed') && !document.body.classList.contains('print-qr') && !document.getElementById('printOnly').textContent && !document.getElementById('printQr').textContent), label + ': sheet wiped after printing');
  }
}
const forge = async (rolls) => {
  await p.fill('#rolls', rolls); await p.dispatchEvent('#rolls', 'input');
  await p.click('#forgeBtn'); await p.waitForFunction(() => document.body.classList.contains('has-seed'));
};

// 1. Roll sheets: dice, coin and Keystone dice, 12 and 24 words, every extra-box choice.
await p.selectOption('#wordSel', '12');
for (const mode of ['dice', 'coin', 'keystone']) {
  if (mode === 'coin') await p.click('#mt-coin');
  if (mode === 'keystone') { await p.click('#mt-dice'); await p.selectOption('#diceRules', 'keystone'); }
  for (const n of ['12', '24']) {
    await p.selectOption('#wordSel', n);
    const opts = await p.$$eval('#rsExtra option', (os) => os.map((o) => o.value));
    ok(opts.join() === (mode === 'keystone' ? '0,10,25,50,max' : '0,10,25,50'), 'roll sheet: extra-box choices for ' + mode + ' (' + opts.join() + ')');
    for (const x of opts) { await p.selectOption('#rsExtra', x); await sheet('roll sheet ' + mode + ' ' + n + ' +' + x, () => printRollSheet()); }
  }
}
await p.selectOption('#diceRules', 'std'); await p.selectOption('#wordSel', '12');

// 2. Word draw sheets.
for (const n of ['12', '24']) { await p.selectOption('#wordSel', n); await sheet('word draw sheet ' + n, () => printWordSheet()); }

// 3. A made seed: backup sheet, stamp sheet, SeedQR prints, public QR prints, address QR prints.
for (const [n, rolls] of [['12', '1'.repeat(25) + '2'.repeat(25)], ['24', '3'.repeat(50) + '4'.repeat(49)]]) {
  await p.selectOption('#wordSel', n); await forge(rolls);
  await sheet('backup sheet ' + n, () => printSeed());
  await sheet('stamp sheet ' + n, () => printStamp());
  for (const k of ['seedqr', 'compact']) {
    await p.evaluate((k) => showSeedQr(k), k);
    await sheet(k + ' ' + n, () => printSeedQr());
    await sheet(k + ' hand-copy guide ' + n, () => printSqGuide());
    await sheet(k + ' blank grid ' + n, () => printSqBlank());
  }
}
await p.evaluate(() => { document.getElementById('watchBox').open = true; document.getElementById('spBox').open = true; document.getElementById('addrBox').open = true; });
for (const type of ['wpkh', 'tr', 'sh-wpkh', 'pkh']) {
  for (const net of ['main', 'test']) {
    await p.selectOption('#wType', type); await p.selectOption('#wNet', net); await p.evaluate(() => refreshWatch());   // wait for the refresh to finish
    const pre = { wpkh: ['zpub', 'vpub'], tr: ['xpub', 'tpub'], 'sh-wpkh': ['ypub', 'upub'], pkh: ['xpub', 'tpub'] }[type][net === 'test' ? 1 : 0];
    await p.waitForFunction(([pre, ban]) => document.getElementById('wZpub').textContent.startsWith(pre) && document.getElementById('wTestBan').style.display === ban && document.getElementById('wKeyLabel').textContent.includes(pre), [pre, net === 'test' ? '' : 'none']);
    for (const [id, lbl] of [['wZpub', 'public key'], ['wDescR', 'receive descriptor'], ['wDescC', 'change descriptor']]) {
      await p.evaluate(([id, lbl]) => showQr(id, lbl), [id, lbl]);
      await sheet('public QR ' + type + ' ' + net + ' ' + id, () => printShownQr());
    }
  }
}
await p.selectOption('#wType', 'ms-wsh'); await p.selectOption('#wNet', 'main'); await p.evaluate(() => refreshWatch());
await p.waitForFunction(() => document.getElementById('wZpub').textContent.startsWith('Zpub'));
for (const id of ['wZpub', 'wDescR']) { await p.evaluate((id) => showQr(id, 'cosigner'), id); await sheet('cosigner QR ' + id, () => printShownQr()); }
ok(await p.evaluate(() => { showQr('wDescR', 'x'); return qrShown.title; }) === 'VOIDFORGE COSIGNER KEY WITH ORIGIN', 'cosigner QR: named as a cosigner key, not a descriptor');
await p.selectOption('#wType', 'wpkh'); await p.selectOption('#wNet', 'main'); await p.evaluate(() => refreshWatch());
await p.waitForFunction(() => document.getElementById('spAddr').textContent.startsWith('sp1') && document.getElementById('wZpub').textContent.startsWith('zpub'));
await p.evaluate(() => showQr('spAddr', 'Silent Payment address'));
await sheet('Silent Payment QR', () => printShownQr());
const a0 = await p.$eval('#addrList [data-addr]', (e) => e.getAttribute('data-addr'));
await p.evaluate((a) => showAddrQr('aq', a), a0);
await sheet('address QR', () => printAddrQr('aq'));
await p.evaluate(() => { document.getElementById('aqAmt').value = '0.0123'; document.getElementById('aqLbl').value = 'Invoice 42'; document.getElementById('aqMsg').value = 'A long message that makes the payment request much bigger. '.repeat(4); drawAddrQr('aq'); });
await sheet('payment request QR (long message)', () => printAddrQr('aq'));
for (const len of [600, 1000, 1600]) {
  await p.evaluate((len) => { document.getElementById('aqMsg').value = 'x'.repeat(len); drawAddrQr('aq'); }, len);
  if (await p.evaluate(() => !!document.getElementById('aqBox').dataset.text)) await sheet('payment request QR (' + len + '-character message)', () => printAddrQr('aq'));
}
await p.evaluate(() => { document.getElementById('aqMsg').value = 'x'.repeat(3000); drawAddrQr('aq'); });
ok(await p.evaluate(() => !document.getElementById('aqBox').dataset.text && document.getElementById('aqImg').textContent === ''), 'payment request too long for a QR code: the old code is removed, so nothing stale can print');

// 4. CHECK A BACKUP: every word count, with the 4-letter view, the words, the stamp sheet, the recovery sheet and SeedQR.
await p.click('#tab-check');
for (const bits of [128, 160, 192, 224, 256]) {
  const m = generateMnemonic(wordlist, bits), n = m.split(' ').length;
  await p.fill('#phrase', m); await p.dispatchEvent('#phrase', 'input');
  await p.click('#verifyBtn');
  await p.waitForFunction(() => /^Master fingerprint: [0-9a-f]{8}/.test(document.getElementById('wvFp').textContent) && document.getElementById('wvList').children.length === 10);
  await p.evaluate(() => wvAbbr(true));
  const ab = await p.$$eval('#wvAbbrGrid .wtxt', (es) => es.map((e) => e.textContent));
  ok(ab.join(' ') === m.split(' ').map((w) => w.slice(0, 4)).join(' '), 'check: 4-letter view shows the first 4 letters of all ' + n + ' words');
  await sheet('check: words ' + n, () => printSeed('check'));
  await sheet('check: stamp sheet ' + n, () => printStamp('check'));
  await sheet('check: recovery sheet ' + n, () => printRecoverySheet());
  if (n === 12 || n === 24) {
    for (const k of ['seedqr', 'compact']) {
      await p.evaluate((k) => wvSeedQr(k), k);
      await sheet('check: ' + k + ' ' + n, () => printSeedQr('check'));
      await sheet('check: ' + k + ' guide ' + n, () => printSqGuide('check'));
      await sheet('check: ' + k + ' blank ' + n, () => printSqBlank('check'));
    }
  }
}

// 5. Child seeds and keys (BIP85), including the longest outputs.
await p.fill('#phrase', 'abandon '.repeat(11) + 'about'); await p.dispatchEvent('#phrase', 'input');
await p.click('#tab-tools');
const child = async (label, setup) => {
  await p.evaluate((s) => { for (const [k, v] of Object.entries(s)) document.getElementById(k).value = v; childAppChange(); for (const [k, v] of Object.entries(s)) document.getElementById(k).value = v; }, setup);
  await p.evaluate(() => deriveChild());
  await p.waitForFunction(() => document.getElementById('childPrintRow').style.display === '');
  await sheet('child ' + label, () => printChild());
};
for (const w of ['12', '18', '24']) await child('seed ' + w + ' words', { childApp: 'words', childWords: w });
await child('WIF', { childApp: 'wif' });
await child('xprv', { childApp: 'xprv' });
await child('hex 64 bytes', { childApp: 'hex', childLen: '64' });
await child('password base64 86', { childApp: 'pwd64', childLen: '86' });
await child('password base85 80', { childApp: 'pwd85', childLen: '80' });
await child('1000 rolls of a 6-sided die', { childApp: 'dice', childSides: '6', childRolls: '1000' });
await child('1000 rolls of the largest die', { childApp: 'dice', childSides: '2147483647', childRolls: '1000' });

// 6. Multisig recovery sheets, from 2-of-2 up to the largest QR code (6-of-9) and past it (15 keys, no QR code).
const cos = Array.from({ length: 15 }, () => { const m = HDKey.fromMasterSeed(randomBytes(32)); return { fp: m.fingerprint.toString(16).padStart(8, '0'), xpub: m.derive("m/48'/0'/0'/2'").publicExtendedKey }; });
for (const [m, n] of [[2, 2], [2, 3], [3, 5], [5, 7], [6, 9], [7, 10], [15, 15]]) {
  await p.evaluate(async ([m, n, cos]) => {
    ms = { m, n, type: 'ms-wsh', net: 'main', account: 0, keys: [], mode: 'paste', busy: false, done: false };
    for (const c of cos.slice(0, n)) ms.keys.push({ fp: c.fp, path: '48h/0h/0h/2h', key: await parseExtendedKey(c.xpub), xpub: c.xpub, src: 'pasted' });
    await msFinish();
  }, [m, n, cos]);
  await sheet('multisig ' + m + '-of-' + n, () => msPrint());
}
await p.evaluate(() => msReset());   // practice mode (8b) can only change with no multisig wallet open

// 7. Light theme, and the CHECK A BACKUP sheets with a passphrase.
await p.evaluate(() => toggleTheme());
await sheet('light theme: backup sheet 24', () => printSeed());
await sheet('light theme: summary sheet 24', () => printSummary());
await p.click('#tab-check');
await p.fill('#phrase', 'legal winner thank year wave sausage worth useful legal winner thank yellow'); await p.fill('#verifyPass', 'a passphrase');
await p.click('#verifyBtn');
await p.waitForFunction(() => /\(with passphrase\)/.test(document.getElementById('wvFp').textContent) && document.getElementById('wvList').children.length === 10);
await sheet('light theme: check words with a passphrase', () => printSeed('check'));
await sheet('light theme: check recovery sheet with a passphrase', () => printRecoverySheet());
ok(await p.evaluate(() => { printSeed('check'); const t = document.getElementById('printOnly').textContent; window.dispatchEvent(new Event('afterprint')); return !t.includes('a passphrase') && /Passphrase used: YES/.test(t); }), 'check words with a passphrase: says one was used, never prints it');
await p.fill('#verifyPass', ''); await p.evaluate(() => toggleTheme());

// 8. TEXT A+ (large text on screen) must not change the printed sheets.
await p.evaluate(() => toggleSize());
await p.click('#tab-make');
await p.selectOption('#wordSel', '24'); await p.selectOption('#rsExtra', '50');
await sheet('TEXT A+: dice roll sheet 24 +50', () => printRollSheet());
ok(await p.evaluate(() => hasSeed() && document.body.classList.contains('big')), 'TEXT A+: on, with the 24-word seed still made');
await sheet('TEXT A+: backup sheet 24', () => printSeed());
await sheet('TEXT A+: stamp sheet 24', () => printStamp());
await sheet('TEXT A+: summary sheet 24', () => printSummary());
await p.evaluate(() => toggleSize());

// 8b. v2.5.0: the backup plan with every box at its longest, the recovery sheet with a birthday, and practice mode's PRACTICE line.
await p.click('#tab-check');
await p.evaluate(() => {
  const set = (id, v) => { document.getElementById(id).value = v; };
  const fill = (n) => ('Qwz plk dvn tyx ').repeat(40).slice(0, n);   // no BIP39 words, so the secret check lets it print
  document.getElementById('planBox').open = true;
  set('plFp', '73c5da0a'); set('plBorn', '2026-11-06'); set('plApp', fill(60)); set('plPass', 'away'); set('plKnow', 'yes');
  for (const i of [1, 2, 3]) { set('plM' + i, i === 2 ? 'metal' : 'paper'); set('plW' + i, fill(80)); set('plL' + i, i === 1 ? 'home' : 'away'); }
  set('plHelp', fill(120)); set('plNote', fill(400)); planRender();
});
await sheet('backup plan, every box at its longest', () => printPlan());
await p.evaluate(() => { for (const id of ['plM2', 'plM3']) document.getElementById(id).value = ''; for (const id of ['plApp', 'plHelp', 'plNote', 'plFp', 'plBorn']) document.getElementById(id).value = ''; document.getElementById('plPass').value = 'none'; planRender(); });
await sheet('backup plan, short (one copy, worst case)', () => printPlan());
ok(await p.evaluate(() => /backup plan/i.test(document.getElementById('planBox').textContent) && document.getElementById('plTest').children.length >= 5), 'backup plan: the stress test is on the page');
await p.click('#tab-make');
await p.evaluate(() => practiceMode(true));
await p.waitForFunction(() => /TEST NETWORK for practice/.test(document.getElementById('address').textContent) && /^tb1q/.test(document.getElementById('wFirst').textContent) && /^tb1q/.test(document.getElementById('addrList').textContent));
for (const [label, fn] of [['summary sheet (test-network first address)', () => printSummary()], ['backup sheet (prints as usual)', () => printSeed()]])
  await sheet('practice mode: ' + label, fn);
ok(await p.evaluate(() => { printSummary(); const t = document.getElementById('printOnly').textContent; window.dispatchEvent(new Event('afterprint')); return /First receive address, TEST NETWORK for practice \(BIP84, m\/84'\/1'\/0'\/0\/0\): tb1q/.test(t); }), 'practice mode: the summary sheet gives the test-network first address, and says so');
await p.evaluate(() => document.querySelector('#addrList button.qr-mini').click());
await sheet('practice mode: address QR', () => printAddrQr('aq'));
ok(await p.evaluate(() => { printAddrQr('aq'); const t = document.getElementById('printQr').textContent; window.dispatchEvent(new Event('afterprint')); hideAddrQr('aq'); return /^VOIDFORGE RECEIVE ADDRESS \(TESTNET\)/.test(t) && /Path: m\/84'\/1'\/0'\/0\/0/.test(t); }), 'practice mode: a printed address sheet says TESTNET');
await p.evaluate(() => showQr('wDescR', 'receive descriptor'));
await sheet('practice mode: descriptor QR', () => printShownQr());
await p.evaluate(() => { window.dispatchEvent(new Event('afterprint')); hideQr(); practiceMode(false); });
await p.waitForFunction(() => /^bc1q/.test(document.getElementById('addrList').textContent));
// Secrets not selectable (v2.5.0): in a real browser, select-all and copy leave out the seed words and the 4-letter grid.
ok(await p.evaluate(() => {
  // (checked by hand: with the user-select rule removed, all 12 words of the grid are in the selection)
  const words = [...document.querySelectorAll('#wordGrid .wcell span')].map((e) => e.textContent.trim()), sel = getSelection();
  sel.selectAllChildren(document.body); const s = String(sel); sel.removeAllRanges();
  const lines = new Set(s.split('\n').map((x) => x.trim()));
  return hasSeed() && words.length >= 12 && words.every((w) => /^[a-z]{3,8}$/.test(w)) && getComputedStyle(document.getElementById('wordGrid')).display !== 'none' && s.length > 1000 && words.filter((w) => lines.has(w)).length === 0;
}), 'secrets: select-all in Chromium leaves out every seed word in the word grid');

// 9. First paint (v2.4.0): while the main script is still loading (a slow phone takes a second or two), nothing red may
// flash: the script-not-running notice and the half-built page stay hidden, and the start notice is already in the page.
// The main script is swapped for one that records what the browser would paint at that moment.
{
  const fs = require('fs'), src = fs.readFileSync(FILE.slice('file://'.length), 'utf8');
  const main = src.indexOf('<script>', src.indexOf('</style>')), end = src.indexOf('</script>', main);
  const variant = async (script) => {
    const c2 = await browser.newContext({ viewport: { width: 393, height: 851 } }); const q = await c2.newPage();
    await q.setContent(src.slice(0, main) + '<script>\n' + script + '\n' + src.slice(end), { waitUntil: 'load' });
    const r = await q.evaluate(() => window.__fp || null);
    const after = await q.evaluate(() => ({ nojs: getComputedStyle(document.getElementById('noJs')).display, page: getComputedStyle(document.querySelector('.container')).visibility, gate: getComputedStyle(document.getElementById('startGate')).display }));
    await c2.close(); return { r, after };
  };
  const rec = 'window.__fp = { nojs: getComputedStyle(document.getElementById("noJs")).display, page: getComputedStyle(document.querySelector(".container")).visibility, gate: !!document.getElementById("startGate") };';
  const { r } = await variant(rec);
  ok(!!r && r.nojs === 'none' && r.page === 'hidden' && r.gate === true, 'first paint: while the main script loads, no red notice and no half-built page, and the start notice is ready (' + JSON.stringify(r) + ')');
  const { after } = await variant('');
  ok(after.nojs === 'block' && after.page === 'visible' && after.gate === 'none', 'first paint: if the main script does not run, the notice and the page come back (' + JSON.stringify(after) + ')');
  const c4 = await browser.newContext({ viewport: { width: 393, height: 851 } }); const q4 = await c4.newPage(); await q4.goto(FILE); await q4.waitForFunction(() => document.body.classList.contains('js-ok'));
  const nor = await q4.evaluate(() => ({ nojs: getComputedStyle(document.getElementById('noJs')).display, page: getComputedStyle(document.querySelector('.container')).visibility, gate: getComputedStyle(document.getElementById('startGate')).display }));
  await c4.close();
  ok(nor.nojs === 'none' && nor.page === 'visible' && nor.gate === 'flex', 'first paint: after a normal load the page and the start notice show, the notice does not (' + JSON.stringify(nor) + ')');
}

ok(errors.length === 0, 'no page errors (' + errors.join(' | ') + ')');
await browser.close();
console.log('PRINT: ' + pass + ' pass, ' + fails.length + ' fail');
process.exit(fails.length ? 1 : 0);
