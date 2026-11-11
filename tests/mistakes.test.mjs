// v2.15.0 "Stop costly mistakes": re-hide, the passphrase check, passphrase practice and Link as QR.
// Part 1 drives the page in jsdom (fast, every branch). Part 2 drives it in Chromium (Playwright): a real window blur (another
// page takes the focus), real print events from window.print() (the browser's Print and VOIDFORGE's own PRINT sheets), real
// mouse activity for the idle timer, the covered words really unreadable on screen (pixels), and the Link QR read back from
// a screenshot by jsQR. Expected fingerprints come from @scure/bip39 and @scure/bip32 (independent code).
// Run: node tests/mistakes.test.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { loadPage, ready, readHtml, makeReporter } from './harness.mjs';
const require = createRequire(import.meta.url);
const R = makeReporter(), ok = R.ok;
const AB = 'abandon '.repeat(11) + 'about';
const fpOf = (m, pw) => HDKey.fromMasterSeed(mnemonicToSeedSync(m, pw)).fingerprint.toString(16).padStart(8, '0');
const D50 = '31415926535897932384626433832795028841971693993751'.replace(/[0789]/g, '3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const html = readHtml();

// ---------------- Part 1: jsdom ----------------
{
  const w = await ready(loadPage(html)), d = w.document, $ = (id) => d.getElementById(id), E = (s) => w.eval(s);
  ok(/PASSED/.test($('selfTestBadge').textContent), 'jsdom: the self-test passes (with the v2.15.0 entries)');
  const forge = async () => { $('rolls').value = D50; $('rolls').oninput && $('rolls').oninput(); await w.generate(); };
  const covered = (id) => $(id).style.filter === 'blur(9px)' && $(id).style.pointerEvents === 'none' && $(id).inert === true;
  const bar = () => $('rhBar').classList.contains('on');
  const hideTab = () => { Object.defineProperty(d, 'hidden', { configurable: true, get: () => true }); d.dispatchEvent(new w.Event('visibilitychange')); Object.defineProperty(d, 'hidden', { configurable: true, get: () => false }); };

  // nothing secret on a fresh page: no event covers anything
  ok(E('rhAny()') === false, 're-hide: a fresh page holds no secret');
  hideTab(); w.dispatchEvent(new w.Event('blur')); w.dispatchEvent(new w.Event('beforeprint')); w.dispatchEvent(new w.Event('afterprint'));
  ok(!bar() && !covered('wordGrid') && !covered('rolls'), 're-hide: with no secret, leaving the tab, the window or printing covers nothing');
  ok(E('rhIds()').every((id) => !!$(id)) && E('RH_PLACES').length >= 40, 're-hide: every place on the list is on the page (' + E('rhIds()').length + ' places)');
  ok(E('rhMinutes()') === 2 && $('rhBlur').checked, 're-hide: the default is 2 minutes, and the window blur is on');

  // rolls typed: the page holds a secret
  $('rolls').value = '123'; ok(E('rhAny()') === true, 're-hide: typed rolls count as a secret'); $('rolls').value = '';
  await forge();
  ok(E('hasSeed()') && E('rhAny()') === true, 're-hide: forged words count as a secret');
  // tab hidden
  hideTab();
  ok(bar() && covered('wordGrid') && covered('rolls') && covered('genResult') && /switched to another tab/.test($('rhMsg').textContent) && /Tap SHOW/.test($('rhMsg').textContent), 're-hide: leaving the tab covers the words and the rolls, and the notice says why and to tap SHOW');
  ok(E('rhIds()').every((id) => covered(id)), 're-hide: every place on the list is covered at once, also those still empty');
  w.rhShow(); ok(!bar() && !covered('wordGrid') && !$('wordGrid').style.filter && $('wordGrid').inert === false, 'SHOW uncovers everything');
  ok(['c32mOut', 's39mOut', 'dbSecret'].every((id) => /user-select:\s*none/.test($(id).getAttribute('style'))), 'SHOW gives back the boxes\u2019 own styles (secret shares stay unselectable)');
  // window blur, with the setting on and off
  $('rhBlur').checked = false; w.dispatchEvent(new w.Event('blur')); ok(!bar(), 're-hide: with "click another window" off, a window blur covers nothing');
  $('rhBlur').checked = true; w.dispatchEvent(new w.Event('blur')); ok(bar() && covered('wordGrid') && /lost focus/.test($('rhMsg').textContent), 're-hide: a window blur covers the secrets');
  w.rhShow();
  // passphrase boxes go back to dots
  $('passphrase').value = 'pw'; $('passphrase2').value = 'pw'; const tb = $('passphrase').nextElementSibling; w.togglePassphrase(tb);
  w.toggleVerifyPassphrase($('verifyPass').nextElementSibling); $('dbShowKey').checked = true; $('dbKey').type = 'text';
  ok($('passphrase').type === 'text' && tb.textContent === 'HIDE', 'setup: the passphrase is shown');
  hideTab();
  ok($('passphrase').type === 'password' && $('passphrase2').type === 'password' && tb.textContent === 'SHOW' && $('verifyPass').type === 'password' && $('verifyPass').nextElementSibling.textContent === 'SHOW' && $('dbKey').type === 'password' && !$('dbShowKey').checked && /back to dots/.test($('rhMsg').textContent), 're-hide: passphrase and key boxes go back to dots, their buttons say SHOW, and the notice says so');
  w.rhShow(); ok($('passphrase').type === 'password', 'SHOW leaves the passphrase as dots');
  // the browser's Print covers (hidden on paper), VOIDFORGE's own PRINT sheets do not
  w.dispatchEvent(new w.Event('beforeprint'));
  ok(bar() && covered('wordGrid') && $('wordGrid').style.visibility === 'hidden' && /printed/.test($('rhMsg').textContent), "re-hide: the browser's Print covers the secrets and keeps them off the paper");
  w.dispatchEvent(new w.Event('afterprint')); ok(covered('wordGrid') && !$('wordGrid').style.visibility, 'after printing they stay covered on screen');
  w.rhShow();
  for (const cls of ['print-seed', 'print-qr']) {
    d.body.classList.add(cls); w.dispatchEvent(new w.Event('beforeprint'));
    ok(!bar() && !covered('wordGrid') && !$('wordGrid').style.visibility, 're-hide: printing one of VOIDFORGE’s own sheets (' + cls + ') covers nothing');
    w.dispatchEvent(new w.Event('afterprint')); d.body.classList.remove(cls);
    d.body.classList.add(cls); w.dispatchEvent(new w.Event('blur')); ok(bar() && covered('wordGrid'), 're-hide: leaving the window while a sheet prints still covers the screen (' + cls + ')'); w.rhShow(); d.body.classList.remove(cls);
  }
  // idle
  const t0 = Date.now(); E('rhTouch()');
  w.rhTick(t0 + 119000); ok(!bar(), 're-hide: 1:59 with no activity covers nothing (2 minutes set)');
  w.rhTick(t0 + 121000); ok(bar() && /nothing happened for 2 minutes/.test($('rhMsg').textContent), 're-hide: 2 minutes with no activity covers the secrets');
  w.rhShow(); $('rhIdle').value = '1'; w.rhSet(); E('rhTouch()');
  w.rhTick(Date.now() + 61000); ok(bar() && /1 minute\./.test($('rhMsg').textContent), 're-hide: 1 minute when set to 1');
  w.rhShow(); $('rhIdle').value = '0'; w.rhSet(); w.rhTick(Date.now() + 3600000); ok(!bar() && /Not after a time/.test($('rhNote').textContent), 're-hide: never, when set to never');
  $('rhIdle').value = '2'; w.rhSet(); E('rhTouch()');
  d.dispatchEvent(new w.Event('keydown')); ok(Date.now() - E('rhLast') < 1000, 're-hide: a key press counts as activity');
  // a result arriving while covered is covered too; a new passphrase check box too
  hideTab(); $('reforgeOut').style.filter = ''; $('reforgeOut').inert = false; E('rhCovered.delete(document.getElementById("reforgeOut"))'); w.rhTick(Date.now()); ok(covered('reforgeOut'), 're-hide: the 5-second check covers a place again if it was uncovered while hidden');
  w.rhShow();
  // the practice signer, the practice phrase and public data are not on the list
  ok(!E('rhIds()').some((id) => /^ss|^pr(Words|Input)$|^fingerprint$|^address$|^addrList$|^wvList$/.test(id)), 're-hide: the practice signer, the practice phrase and public data are not on the list');
  // a secret in each kind of place triggers it: a box from AUTO_FIELDS, a box only on the re-hide list, an output, a QR picture
  w.clearAll(); await sleep(20);
  ok(E('rhAny()') === false, 'after CLEAR ALL the page holds no secret');
  for (const [id, set] of [['s39In', 'v'], ['xorIn', 'v'], ['wpbRolls', 'v'], ['childOut', 't'], ['dbSecret', 't'], ['oeSeed', 't']]) {
    const e = $(id); if (set === 'v') e.value = 'secret'; else { e.textContent = 'secret words'; e.style.display = ''; }
    ok(E('rhAny()') === true, 're-hide: something in ' + id + ' counts as a secret'); if (set === 'v') e.value = ''; else { e.textContent = ''; e.style.display = 'none'; }
  }
  ok(E('rhAny()') === false && (() => { $('dcOut').textContent = '— 1. 2.'; const r = E('rhAny()'); $('dcOut').textContent = ''; return r === false; })(), 're-hide: slot numbers and dashes alone are not a secret');
  w.showSeedQr && await forge(); w.showSeedQr('seedqr'); w.rhShow(); ok(/<svg/.test($('sqImg').innerHTML) && E('rhAny()'), 're-hide: a SeedQR on screen counts');
  hideTab(); ok(covered('sqImg'), 're-hide: the SeedQR is covered'); w.rhShow();
  w.clearAll(); await sleep(20);

  // ---- the passphrase check ----
  const box = (id) => $('ppk-' + id);
  ok(['passphrase', 'verifyPass', 'drillPass', 'reforgeWordsPass', 'ppA'].every((id) => box(id) && box(id).className === 'ppk'), 'passphrase check: a box under every BIP39 passphrase field (Make, Check, Restore drill, Reforge, Practice)');
  ok($('passWarn').nextElementSibling === box('passphrase') && $('verifyPassWarn').nextElementSibling === box('verifyPass'), 'passphrase check: it sits under the existing passphrase note');
  const typeIn = (id, v) => { $(id).value = v; $(id).dispatchEvent(new w.Event('input', { bubbles: true })); };
  typeIn('passphrase', ' My  pass'); await sleep(5);
  ok(/␣••␣␣••••/.test(box('passphrase').textContent) && /9 characters/.test(box('passphrase').textContent) && !/My/.test(box('passphrase').textContent), 'passphrase check: masked, it shows spaces as marks and every other character as a dot, never the text');
  ok(!/starts with a space/.test(box('passphrase').textContent) && /starts with a space/.test($('passWarn').textContent), 'passphrase check: under Make it does not repeat the space note already there');
  w.togglePassphrase($('passphrase').nextElementSibling); await sleep(5);
  ok(box('passphrase').querySelector('.ppk-v').textContent === '␣My␣␣pass', 'passphrase check: SHOW shows exactly what is used, with ␣ for each space');
  w.togglePassphrase($('passphrase').nextElementSibling); await sleep(5);
  typeIn('drillPass', ' a  b\t'); ok(/starts with a space, ends with a space, has two spaces in a row and has a tab or a line break/.test(box('drillPass').textContent), 'passphrase check: under the drill it names the spaces and the tab itself');
  typeIn('reforgeWordsPass', 'x​y'); ok(/has an invisible character/.test(box('reforgeWordsPass').textContent) && /U\+200B/.test(box('reforgeWordsPass').textContent), 'passphrase check: an invisible character is named and marked');
  typeIn('verifyPass', 'ﬁne café'); $('verifyPass').type = 'text'; await sleep(5);
  { const t = box('verifyPass').textContent; ok(/NFKD form/.test(t) && /ﬁ becomes f \+ i/.test(t) && /é becomes e \+ a separate accent mark/.test(t) && /fine␣café/.test(t), 'passphrase check: NFKD changes are named, with what each character becomes'); }
  ok(/outside plain ASCII/.test(box('verifyPass').textContent) && /Coldcard accepts only ASCII 32 to 126/.test(box('verifyPass').textContent) && /SeedSigner’s passphrase keyboard/.test(box('verifyPass').textContent), 'passphrase check: characters outside ASCII bring the Coldcard and SeedSigner note');
  ok(box('verifyPass').querySelector('.ppk-x') && box('verifyPass').querySelector('.ppk-x').textContent === 'é', 'passphrase check: the character outside ASCII is underlined, its accent kept on the letter');
  $('verifyPass').type = 'password';
  typeIn('verifyPass', 'x'.repeat(61)); ok(/61 characters long/.test(box('verifyPass').textContent) && !/Coldcard accepts at most/.test(box('verifyPass').textContent), 'passphrase check: over 60 characters it says long');
  typeIn('verifyPass', 'x'.repeat(101)); ok(/Coldcard accepts at most 100/.test(box('verifyPass').textContent), 'passphrase check: over 100 characters it says a Coldcard cannot take it');
  typeIn('verifyPass', 'x'.repeat(100)); ok(!/Coldcard accepts at most/.test(box('verifyPass').textContent), 'passphrase check: exactly 100 is fine for a Coldcard');
  typeIn('verifyPass', 'Plain ASCII words'); ok(box('verifyPass').querySelectorAll('li').length === 0, 'passphrase check: a plain passphrase gets no warning');
  ok($('verifyPass').value === 'Plain ASCII words', 'passphrase check: it never changes what was typed');
  w.clearAll(); await sleep(20);
  ok(['passphrase', 'verifyPass', 'drillPass', 'reforgeWordsPass', 'ppA'].every((id) => box(id).textContent === ''), 'passphrase check: CLEAR ALL empties every check box');
  typeIn('passphrase', 'abc'); w.autoWipe('test'); await sleep(20); ok(box('passphrase').textContent === '' && $('passphrase').value === '', 'passphrase check: auto-clear empties it too');

  // ---- Practice your passphrase ----
  ok(E('AUTO_FIELDS').includes('ppA') && E('AUTO_FIELDS').includes('ppB'), 'practice: auto-clear and CLEAR ALL know both boxes');
  ok(!$('ppBtn').classList.contains('secondary') && [...$('ppBox').querySelectorAll('button')].filter((b) => !b.classList.contains('secondary')).length === 1, 'practice: one gold main action (CHECK MY PASSPHRASE), the rest gray');
  ok(/Practice your passphrase/.test($('ppBox').querySelector('summary').textContent) && $('ppBox').querySelector('summary small'), 'practice: title and a one-line hint');
  const pw = 'Correct horse ' + Date.now().toString(36);
  typeIn('ppA', pw); typeIn('ppB', pw); await w.ppCheck();
  ok(/^MATCH/.test($('ppStatus').textContent) && $('ppStatus').classList.contains('ok') && $('ppFp').querySelector('b').textContent === fpOf(AB, pw), 'practice: two equal entries MATCH, with the test-seed fingerprint @scure gives for this passphrase');
  typeIn('ppB', pw + ' '); await w.ppCheck();
  ok(new RegExp('^NO MATCH: they differ at character ' + (pw.length + 1) + ' \\(the first has ' + pw.length + ' characters, the second ' + (pw.length + 1) + '\\)').test($('ppStatus').textContent) && $('ppStatus').classList.contains('bad') && $('ppFp').textContent === '', 'practice: a trailing space is NO MATCH, where it differs, and no fingerprint');
  typeIn('ppA', 'café'); typeIn('ppB', 'café'); await w.ppCheck(); ok(/^MATCH/.test($('ppStatus').textContent), 'practice: the two ways to type é match, as in a wallet (NFKD)');
  typeIn('ppA', 'ab'); typeIn('ppB', 'aB'); await w.ppCheck(); ok(/differ at character 2/.test($('ppStatus').textContent), 'practice: capitals count');
  { const ev = new w.Event('paste', { cancelable: true }); $('ppB').dispatchEvent(ev); ok(ev.defaultPrevented && /Pasting is turned off/.test($('ppStatus').textContent), 'practice: pasting into the from-memory box is refused'); }
  typeIn('ppA', 'x'); typeIn('ppB', ''); await w.ppCheck(); ok(/Type your passphrase in the first box/.test($('ppStatus').textContent), 'practice: an empty box is asked for');
  typeIn('ppB', 'x'); await w.ppCheck(); hideTab(); ok(covered('ppB') && covered('ppA') && covered('ppFp') && covered('ppk-ppA'), 'practice: re-hide covers both boxes, the fingerprint and the check'); w.rhShow();
  w.ppClear(); ok($('ppA').value === '' && $('ppB').value === '' && $('ppStatus').textContent === '' && $('ppFp').textContent === '', 'practice: CLEAR empties it');
  typeIn('ppA', 'y'); typeIn('ppB', 'y'); await w.ppCheck(); w.clearAll(); await sleep(20);
  ok($('ppA').value === '' && $('ppB').value === '' && $('ppStatus').textContent === '' && $('ppFp').textContent === '', 'practice: CLEAR ALL empties it');
  typeIn('ppA', 'z'); typeIn('ppB', 'z'); await w.ppCheck(); w.autoWipe('test'); await sleep(20);
  ok($('ppA').value === '' && $('ppFp').textContent === '' && $('ppStatus').textContent === '', 'practice: auto-clear empties it');

  // ---- Link as QR ----
  ok(!$('lqBtn').classList.contains('secondary') && [...$('lqBox').querySelectorAll('button')].filter((b) => !b.classList.contains('secondary')).length === 1 && /PRINT/.test([...$('lqBox').querySelectorAll('button.secondary')].map((b) => b.textContent).join()), 'Link as QR: one gold MAKE QR, gray PRINT and CLEAR');
  const lq = async (t) => { $('lqIn').value = t; await w.lqMake(); return $('lqStatus').textContent; };
  const refused = [[AB, /SEED WORDS/], ['aban aban aban aban aban aban aban aban aban aban aban abou', /SEED WORDS/], ['1. abandon 2. abandon 3. ability 4. able 5. about 6. above 7. absent', /SEED WORDS/],
    ['0'.repeat(96), /SeedQR digits/], ['MS12NAMEA320ZYXWVUTSRQPNMLKJHGFEDCAXRPP870HKKQRM', /codex32/], ['00'.repeat(32), /64 hex characters/],
    ['5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ', /PRIVATE KEY \(WIF\)/], ['KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617', /PRIVATE KEY \(WIF\)/],
    ['https://example.org/import?key=L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ', /PRIVATE KEY \(WIF\)/],
    ['xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi', /extended PRIVATE key/],
    ['wpkh(xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi/84h/0h/0h/0/*)', /extended PRIVATE key/],
    ['SzavMBLoXU6kDrqtUVmffv', /mini PRIVATE KEY/]];
  for (const [t, re] of refused) { const s = await lq(t); ok(/^NOT MADE/.test(s) && re.test(s) && $('lqImg').innerHTML === '' && $('lqIn').value === '' && $('lqStatus').classList.contains('bad'), 'Link as QR refuses ' + t.slice(0, 24) + '... and empties the box'); }
  for (const t of ['https://sparrowwallet.com/download/', 'bitcoin:bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu?amount=0.001', 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8', 'Meet at the cafe at noon', 'mempool.space/tx/' + 'ab'.repeat(32)]) {
    const s = await lq(t); ok(/^QR code for this/.test(s) && $('lqImg').innerHTML === (() => { const x = d.createElement('div'); x.innerHTML = w.qrSvg(w.qrMatrix(t).rows); return x.innerHTML; })() && $('lqIn').value === t, 'Link as QR draws ' + t.slice(0, 30) + '... with the page’s QR code maker');
  }
  ok(/too long/.test(await lq('https://example.org/' + 'a'.repeat(3000))), 'Link as QR: a text too long for one QR code is refused plainly');
  { $('lqIn').value = 'https://example.org/'; await w.lqMake(); let sheet = '', cls = ''; w.print = () => { sheet = $('printQr').innerHTML; cls = d.body.className; }; w.lqPrint();
    ok(/print-qr/.test(cls) && /<svg/.test(sheet) && /https:\/\/example\.org\//.test(sheet) && /LINK AS QR/.test(sheet), 'Link as QR: PRINT prints the code and its text on one of VOIDFORGE’s own QR sheets');
    w.dispatchEvent(new w.Event('afterprint')); }
  { const al = []; w.alert = (m) => al.push(m); w.lqClear(); w.lqPrint(); ok($('lqIn').value === '' && $('lqImg').innerHTML === '' && /MAKE QR first/.test(al.join()), 'Link as QR: CLEAR empties it, and PRINT then asks for MAKE QR first'); }

  // ---- dictionary, layout, nothing stored ----
  const dict = [...$('dictList').querySelectorAll('dt')].map((e) => e.textContent);
  ok(['NFKD normalization', 'Printable ASCII', 'Re-hide'].every((n) => dict.includes(n)), 'dictionary: NFKD normalization, Printable ASCII and Re-hide are explained');
  const blk = html.slice(html.indexOf('// ===== v2.15.0 "Stop costly mistakes"'), html.indexOf('function mkSelfTests(eq){'));
  ok(blk.length > 5000 && !/localStorage|sessionStorage|indexedDB|Math\.random|getRandomValues|fetch\(|XMLHttpRequest/.test(blk), 'the new code stores nothing and makes no random numbers or network calls');
  ok(!/[‘']s\b/.test([...['rhBox', 'ppBox', 'lqBox'].map((id) => $(id).textContent), $('rhBar').textContent].join(' ').replace(/[’]/g, '')), 'new visible text uses curly apostrophes');
  w.close();
}

// ---------------- Part 2: Chromium ----------------
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { chromium = null; }
if (!chromium) { console.log('CHROMIUM PART SKIPPED (no playwright-core)'); R.done('mistakes'); }
const FILE = 'file://' + path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'voidforge.html');
// The print events: the headless shell fires beforeprint and afterprint for window.print() (the full browser waits on a print
// preview that never closes in a test), so printing is checked there. "chromium" is the full browser in headless mode: it moves
// the focus between pages for real (the headless shell does not), so focus is checked there.
async function openPage(browser, ctx){
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (dg) => dg.accept());
  const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });   // real focus, not Playwright's "always focused"
  await p.goto(FILE);
  await p.waitForFunction(() => /PASSED/.test(document.getElementById('selfTestBadge').textContent), null, { timeout: 120000 });
  await p.evaluate(() => { const g = document.getElementById('sgGo'); if (g) g.click(); });
  const st = () => p.evaluate(() => ({ bar: document.getElementById('rhBar').classList.contains('on'), barShown: getComputedStyle(document.getElementById('rhBar')).display !== 'none', msg: document.getElementById('rhMsg').textContent, filter: getComputedStyle(document.getElementById('wordGrid')).filter, vis: getComputedStyle(document.getElementById('wordGrid')).visibility }));
  await p.evaluate(async (r) => { document.getElementById('rolls').value = r; document.getElementById('rolls').oninput && document.getElementById('rolls').oninput(); await generate(); }, D50);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });   // again: it is set anew for the loaded page
  await p.bringToFront(); await p.click('#tab-make'); await sleep(200);
  return { p, st, errs, cdp };
}
for (const kind of ['focus', 'print']) {
const browser = kind === 'focus' ? await chromium.launch({ channel: 'chromium' }).catch(() => chromium.launch()) : await chromium.launch();
const errsAll = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.setOffline(true);
  // Chromium ignores a page's print() that comes soon after its last one, so each print below has a page of its own.
  const pages = kind === 'focus' ? 1 : 3;
  for (let n = 0; n < pages; n++) {
  const { p, st, errs } = await openPage(browser, ctx); errsAll.push(errs);
  if (n === 0) ok(!(await st()).bar, 'browser: the words show after FORGE SEED');
  let s;
  if (kind === 'focus') {
  // real window blur: another page takes the focus
  const other = await ctx.newPage(); await other.bringToFront(); await sleep(600);
  s = await st();
  ok(await p.evaluate(() => !document.hasFocus()) && s.bar && s.barShown && /blur\(9px\)/.test(s.filter) && /lost focus|another tab/.test(s.msg), 'browser: when another window takes the focus (a real blur event), the words are covered and the notice shows');
  await p.bringToFront(); await sleep(300);
  ok((await st()).bar, 'browser: coming back does not uncover them by itself');
  // pixels: covered words are unreadable (the grid has no sharp edges left), uncovered they are sharp
  const sharp = async () => { const b = await p.locator('#wordGrid').screenshot(); const { PNG } = require('pngjs'); const img = PNG.sync.read(b); let e = 0;
    for (let y = 0; y < img.height; y++) for (let x = 1; x < img.width; x++) { const i = (y * img.width + x) * 4, j = i - 4; if (Math.abs(img.data[i] - img.data[j]) + Math.abs(img.data[i + 1] - img.data[j + 1]) + Math.abs(img.data[i + 2] - img.data[j + 2]) > 120) e++; } return e; };
  const blurredEdges = await sharp();
  await p.click('#rhShowBtn'); await sleep(200);
  const plainEdges = await sharp();
  ok(!(await st()).bar && /none/.test((await st()).filter) && plainEdges > 200 && blurredEdges < plainEdges / 20, 'browser: SHOW uncovers; covered, the word grid has ' + blurredEdges + ' sharp edges, uncovered ' + plainEdges);
  // the covered textarea cannot be clicked into or typed in
  await p.evaluate(() => rhHide('blur'));
  const before = await p.inputValue('#rolls'); await p.mouse.click(...(await p.locator('#rolls').boundingBox().then((b) => [b.x + 20, b.y + 10]))); await p.keyboard.type('6666');
  ok((await p.inputValue('#rolls')) === before, 'browser: a covered box cannot be clicked into or typed in');
  await p.click('#rhShowBtn');
  // tab hidden: Chromium in a test cannot really hide a tab, so the browser's own event is sent with document.hidden true
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; });
  s = await st(); ok(s.bar && /another tab or app/.test(s.msg), 'browser: a hidden tab (visibilitychange) covers them');
  await p.click('#rhShowBtn');
  // idle: real mouse movement is activity; 2 minutes without it covers
  await p.evaluate(() => { rhLast = Date.now() - 100000; }); await p.mouse.move(300, 300); await p.mouse.move(320, 330);
  ok(await p.evaluate(() => Date.now() - rhLast < 2000), 'browser: moving the mouse counts as activity');
  await p.evaluate(() => rhTick(Date.now() + 119000)); ok(!(await st()).bar, 'browser: 1:59 idle covers nothing');
  await p.evaluate(() => rhTick(Date.now() + 121000)); s = await st(); ok(s.bar && /2 minutes/.test(s.msg), 'browser: 2 minutes idle covers the words');
  await p.click('#rhShowBtn');
  // the passphrase check, in the browser
  await p.evaluate(() => { document.getElementById('advanced').open = true; const e = document.getElementById('passphrase'); e.value = 'x'.repeat(101); e.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(/Coldcard accepts at most 100/.test(await p.textContent('#ppk-passphrase')), 'browser: the passphrase check shows under the passphrase');
  // Link as QR, read back from the screen by jsQR
  await p.evaluate(async () => { showTab('tools'); document.getElementById('lqBox').open = true; document.getElementById('lqIn').value = 'https://sparrowwallet.com/download/'; await lqMake(); document.getElementById('lqBox').scrollIntoView(); });
  { const { PNG } = require('pngjs'), jsQR = require('jsqr'); const img = PNG.sync.read(await p.locator('#lqImg').screenshot()); const q = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
    ok(q && q.data === 'https://sparrowwallet.com/download/', 'browser: the Link QR on screen reads back as the link (jsQR)'); }
  } else if (n === 0) {
  // the browser's Print (window.print fires the real beforeprint and afterprint events)
  await p.evaluate(() => { window.__pr = []; window.addEventListener('beforeprint', () => window.__pr.push(getComputedStyle(document.getElementById('wordGrid')).visibility + '|' + getComputedStyle(document.getElementById('rhBar')).display), { once: true }); });
  await p.evaluate(() => window.print()); await sleep(500);
  s = await st();
  ok(await p.evaluate(() => window.__pr.length === 1) && s.bar && /printed/.test(s.msg) && s.vis === 'visible' && /blur/.test(s.filter), "browser: the browser's Print covers the words, and after printing they stay covered on screen");
  ok(await p.evaluate(() => { const g = document.getElementById('wordGrid'); return g.style.visibility === ''; }), 'browser: afterprint puts the covered words back on screen (still blurred)');
  await p.click('#rhShowBtn');
  // print media while covered: the words are not on the printed page
  await p.evaluate(() => rhHide('print')); await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await p.emulateMedia({ media: 'print' });
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('wordGrid')).visibility === 'hidden' && getComputedStyle(document.getElementById('rhBar')).display === 'none'), 'browser: in print, covered words and the notice are not on the page');
  await p.emulateMedia({ media: 'screen' }); await p.evaluate(() => window.dispatchEvent(new Event('afterprint'))); await p.click('#rhShowBtn');
  } else if (n === 1) {
  // VOIDFORGE's own PRINT SEED: the sheet holds the words, and nothing is covered
  await p.evaluate(() => { window.__sheet = ''; window.addEventListener('beforeprint', () => { window.__sheet = document.getElementById('printOnly').textContent; }, { once: true }); });
  await p.evaluate(() => printSeed()); await p.waitForFunction(() => window.__sheet && !document.body.classList.contains('print-seed'), null, { timeout: 15000 }).catch(() => {});
  const words = await p.evaluate(() => document.getElementById('genResult').textContent.split('\n')[0].trim().split(' '));
  s = await st(); if (process.env.MK_DEBUG) console.log(JSON.stringify(s), words.length, await p.evaluate(() => [window.__sheet.slice(0, 80), document.body.className]));
  ok(!s.bar && !/blur/.test(s.filter) && words.length === 12 && await p.evaluate((ws) => ws.every((x) => window.__sheet.includes(x)), words), 'browser: VOIDFORGE’s own PRINT SEED prints the words and covers nothing');
  } else {
  // own QR print (Link as QR PRINT) covers nothing either
  await p.evaluate(async () => { document.getElementById('lqIn').value = 'https://sparrowwallet.com/download/'; await lqMake(); });
  await p.evaluate(() => { window.__q = ''; window.addEventListener('beforeprint', () => { window.__q = document.getElementById('printQr').textContent; }, { once: true }); lqPrint(); }); await p.waitForFunction(() => window.__q && !document.body.classList.contains('print-qr'), null, { timeout: 15000 }).catch(() => {});
  ok(!(await st()).bar && /sparrowwallet\.com/.test(await p.evaluate(() => window.__q)), 'browser: Link as QR PRINT prints its sheet and covers nothing');
  }
  }
  ok(errsAll.every((e) => e.length === 0), 'browser (' + kind + '): no page errors' + (errsAll.flat().length ? ' (' + errsAll.flat().join(' | ') + ')' : ''));
} finally { await browser.close(); }
}
R.done('mistakes');
