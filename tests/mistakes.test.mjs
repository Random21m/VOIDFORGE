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
  ok(E('rhMinutes()') === 5 && $('rhBlur').checked, 're-hide: the default is 5 minutes (v2.15.0 review M3), and the window blur is on');

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
  w.toggleVerifyPassphrase($('verifyPass').nextElementSibling); w.pwShowToggle($('dbShowKey')); $('wdatPass').value = 'x'; w.pwShowToggle($('wdatShowPass'));
  ok($('passphrase').type === 'text' && tb.textContent === 'HIDE', 'setup: the passphrase is shown');
  hideTab();
  ok($('passphrase').type === 'password' && $('passphrase2').type === 'password' && tb.textContent === 'SHOW' && $('verifyPass').type === 'password' && $('verifyPass').nextElementSibling.textContent === 'SHOW' && $('dbKey').type === 'password' && $('dbShowKey').textContent === 'SHOW' && $('wdatPass').type === 'password' && $('wdatShowPass').textContent === 'SHOW' && /back to dots/.test($('rhMsg').textContent), 're-hide: passphrase and key boxes go back to dots, their buttons say SHOW, and the notice says so');
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
  w.rhTick(t0 + 299000); ok(!bar(), 're-hide: 4:59 with no activity covers nothing (5 minutes, the default)');
  w.rhTick(t0 + 301000); ok(bar() && /nothing happened for 5 minutes/.test($('rhMsg').textContent), 're-hide: 5 minutes with no activity covers the secrets');
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
  { const t = box('verifyPass').textContent; ok(/NFKD form/.test(t) && /ﬁ becomes f \+ i/.test(t) && /é becomes e \+ a separate accent mark/.test(t) && /fine␣cafe\u0301/.test(t), 'passphrase check: NFKD changes are named, with what each character becomes'); }
  ok(/outside plain ASCII/.test(box('verifyPass').textContent) && /Coldcard accepts only ASCII 32 to 126/.test(box('verifyPass').textContent) && /SeedSigner’s passphrase keyboard/.test(box('verifyPass').textContent), 'passphrase check: characters outside ASCII bring the Coldcard and SeedSigner note');
  ok(box('verifyPass').querySelector('.ppk-x') && box('verifyPass').querySelector('.ppk-x').textContent === 'e\u0301', 'passphrase check: the character outside ASCII is underlined, its accent kept on the letter');
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
  typeIn('ppA', 'café'); typeIn('ppB', 'cafe\u0301'); await w.ppCheck(); ok(/^MATCH/.test($('ppStatus').textContent), 'practice: the two ways to type é match, as in a wallet (NFKD)');
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
    ['0'.repeat(96), /SeedQR digits/], ['MS12NAMEA320ZYXWVUTSRQPNMLKJHGFEDCAXRPP870HKKQRM', /codex32/], ['0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d', /64 hex characters/],
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

  // ---- review fixes (v2.15.0 review, findings H1 to L14) ----
  // H1: a covered picture is taken off the screen (not blurred), with a gray box in its place; the guide's caption is covered and
  // its buttons do nothing while covered
  await forge(); w.showSeedQr('seedqr'); w.openSqGuide(); w.sqGuideBlock(1);
  { const img0 = $('sqGuideImg').innerHTML, cap0 = $('sqGuideCaption').textContent; hideTab();
    ok(['sqImg', 'sqGuideImg', 'sqMini', 'wvsImg', 'pnView', 'pnRdGrid', 'cdGrid', 'dmCardGrid'].every((id) => $(id).classList.contains('rh-cov') && $(id).classList.contains('rh-solid')) && covered('sqGuideCaption'), 'H1: the SeedQR, the hand-copy guide, the plate and the card pickers are taken off the screen when covered, and the guide caption is covered');
    const css = [...d.querySelectorAll('style')].map((x) => x.textContent).join('\n');
    ok(/\.rh-cov svg, \.rh-cov canvas, \.rh-cov img, \.rh-solid > \* \{ visibility: hidden !important; \}/.test(css) && /\.rh-solid \{ background: var\(--surface2\) !important; outline: 2px dashed/.test(css), 'H1: the style sheet hides any covered picture (svg, canvas, img) and the solid places, and draws a gray outline instead');
    w.sqGuideBlock(1); w.sqGuideBlock(-1); w.sqGuideFull(); w.openSqGuide();
    ok($('sqGuideImg').innerHTML === img0 && $('sqGuideCaption').textContent === cap0, 'H1: NEXT BLOCK, PREVIOUS BLOCK, WHOLE GRID and COPY BY HAND do nothing while covered');
    w.rhShow(); ok(!$('sqImg').classList.contains('rh-cov') && !$('sqImg').classList.contains('rh-solid'), 'H1: SHOW puts the pictures back');
    w.sqGuideBlock(1); ok($('sqGuideImg').innerHTML !== img0, 'H1: uncovered, NEXT BLOCK works again'); }
  ok(E('RH_STYLE').includes('-webkit-user-select') && /e\.style\.setProperty\("-webkit-user-select", "none"\)/.test(html), 'L9: covering also sets -webkit-user-select (Safari), and SHOW gives back its old value');
  // L8: every place carries data-rh, and a static print rule keeps them off paper even without beforeprint
  ok(E('rhIds()').every((id) => $(id).hasAttribute('data-rh')) && /@media print \{ body:not\(\.print-seed\):not\(\.print-qr\) \[data-rh\] \{ visibility: hidden !important; \} \}/.test([...d.querySelectorAll('style')].map((x) => x.textContent).join('\n')), 'L8: every covered place is marked data-rh, and the print style sheet hides them unless VOIDFORGE prints its own sheet');
  // M1: a wipe while covered leaves no "Secrets hidden" notice and no locked boxes
  hideTab(); ok(bar(), 'setup: covered'); w.clearAll(); await sleep(20);
  ok(!bar() && !E('rhOn') && $('rolls').inert === false && !$('rolls').style.filter, 'M1: CLEAR ALL while covered: the notice goes and the boxes open again');
  await forge(); $('autoHide').checked = true; w.autoClearSet();
  { Object.defineProperty(d, 'hidden', { configurable: true, get: () => true }); d.dispatchEvent(new w.Event('visibilitychange')); Object.defineProperty(d, 'hidden', { configurable: true, get: () => false }); }
  await sleep(20);
  ok(!E('hasSeed()') && /Wiped automatically/.test($('autoNote').textContent) && !bar() && $('rolls').inert === false, 'M1: auto-clear on leaving the tab: wiped, and not left "Secrets hidden" with locked boxes');
  $('autoHide').checked = false; w.autoClearSet();
  // M2: CLEAR ALL and auto-clear put the practice box back to dots, its button to SHOW
  { const btn = $('ppA').nextElementSibling; $('ppA').value = 'x'; w.ppToggle(btn); ok($('ppA').type === 'text' && btn.textContent === 'HIDE', 'setup: practice box shown');
    w.clearAll(); await sleep(20); ok($('ppA').type === 'password' && btn.textContent === 'SHOW', 'M2: CLEAR ALL puts the practice box back to dots and its button to SHOW');
    $('ppA').value = 'y'; w.ppToggle(btn); w.autoWipe('test'); await sleep(20); ok($('ppA').type === 'password' && btn.textContent === 'SHOW' && !$('ppA').value, 'M2: auto-clear does too'); }
  // L14: CLEAR ALL leaves the HIDE buttons that close a panel alone; only the passphrase and key boxes' buttons go back to SHOW
  { const hides = [...d.querySelectorAll('button')].filter((b) => b.textContent === 'HIDE'); w.clearAll(); await sleep(20);
    ok(hides.length >= 5 && hides.every((b) => b.textContent === 'HIDE'), 'L14: after CLEAR ALL the permanent HIDE buttons (How your seed was made, the SeedQR, the child seed, the wallet SeedQR) still read HIDE (' + hides.length + ')'); }
  // M3: the page's own dialogs do not count as looking away; public practice content is not a reason to cover
  await forge();
  w.confirm('test'); w.dispatchEvent(new w.Event('blur')); ok(!bar(), 'M3: a window blur right after one of the page’s own questions (confirm) covers nothing');
  E('rhDlgEnd = 0'); w.dispatchEvent(new w.Event('blur')); ok(bar(), 'M3: a window blur later still covers'); w.rhShow();
  w.clearAll(); await sleep(20);
  w.setMethod('damascus'); w.dmLoadExample(1); await sleep(20);
  ok(E('dmPractice') && E('rhAny()') === false, 'M3: a worked example in the Damascus boxes (public) is not a secret');
  hideTab(); ok(!bar(), 'M3: leaving the tab with only public practice content covers nothing');
  $('rolls').value = '123'; hideTab(); ok(bar() && covered('dmDice'), 'M3: with a real secret elsewhere, the practice boxes are covered with the rest'); w.rhShow(); $('rolls').value = '';
  w.dmClear(); w.setMethod('dice'); await sleep(20);
  // M4: status lines that can echo a typed word are covered; the address box counts when it holds a secret
  ok(['verifyStatus', 'xorStatus', 's39Status', 'c32Status', 'cmxStatus', 'reforgeStatus', 'drillStatus', 'pkStatus', 'passWarn', 'verifyPassWarn', 'sqGuideCaption', 'checkAddr'].every((id) => E('rhIds()').includes(id)), 'M4: the status lines of the secret tools, the passphrase notes and the address box are on the re-hide list');
  $('checkAddr').value = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'; await w.explainAddrUi(); ok(E('rhAny()') === false, 'M4: an address in Explain an address is not a secret');
  $('checkAddr').value = AB; await w.explainAddrUi(); ok(E('rhAny()') === true, 'M4: seed words pasted into Explain an address count as a secret');
  hideTab(); ok(covered('checkAddr') && covered('verifyStatus'), 'M4: and are covered'); w.rhShow(); $('checkAddr').value = ''; await w.explainAddrUi();
  ok(/body\.drill-on #dmWords, body\.drill-on #dmLwWords, body\.drill-on #dmLwBits, body\.drill-on #dmLwOut/.test(d.querySelector('style').textContent), 'M4: the restore drill hides the Damascus word boxes and the last word');
  // M5: the passphrase check reads out only a change in its warnings; the notice gets its class before its text
  { const box = $('ppk-verifyPass'); ok(!box.hasAttribute('aria-live') && box.querySelector('.ppk-w') && box.querySelector('.ppk-w').getAttribute('aria-live') === 'polite' && !box.querySelector('.ppk-use').hasAttribute('aria-live'), 'M5: only the warnings of the passphrase check are a live region, not the line that changes with every key');
    const typeIn = (v) => { $('verifyPass').value = v; $('verifyPass').dispatchEvent(new w.Event('input', { bubbles: true })); };
    typeIn('ab'); const none = box.querySelector('.ppk-w ul'); typeIn('caf\u00e9'); const ul = box.querySelector('.ppk-w ul'); typeIn('caf\u00e9s'); const ul2 = box.querySelector('.ppk-w ul');
    typeIn('x'.repeat(61)); const ul3 = box.querySelector('.ppk-w ul');
    ok(!none && ul && ul2 === ul && ul3 && ul3 !== ul, 'M5: the warnings are rebuilt (and read out) only when they change, not on every key');
    typeIn(''); }
  { let order = ''; const mo = new w.MutationObserver((recs) => { for (const r of recs) order += r.type === 'attributes' ? 'C' : 'T'; });
    mo.observe($('rhBar'), { attributes: true, attributeFilter: ['class'] }); mo.observe($('rhMsg'), { childList: true });
    $('rolls').value = '1'; hideTab(); await sleep(5); mo.disconnect(); ok(/^C/.test(order), 'M5: the notice is shown first, then its text is set (so a screen reader announces it)'); w.rhShow(); $('rolls').value = ''; }
  { $('rolls').value = '12'; $('rolls').focus(); E('rhHide("tab")'); ok(d.activeElement !== $('rolls') && E('rhFocus') === $('rolls'), 'M5: covering takes the focus out of a covered box and remembers it');
    $('rhShowBtn').focus(); w.rhShow(); ok(d.activeElement === $('rolls') && E('rhFocus') === null, 'M5: SHOW (pressed from the keyboard) gives the focus back to that box'); $('rolls').value = ''; $('rolls').blur(); }
  { w.setMethod('damascus'); w.eval('dmPracticeNext = 3'); await w.dmTourStart(); const nx = $('dmTourNext'), bk = $('dmTourBack');
    for (let i = 0; i < 10; i++) w.dmTourGo(1);
    nx.focus(); w.dmTourGo(1); ok(nx.disabled && d.activeElement === bk, 'M5: guided practice: NEXT turns off at the last part and hands the focus to BACK');
    for (let i = 0; i < 10; i++) w.dmTourGo(-1);
    bk.focus(); w.dmTourGo(-1); ok(bk.disabled && d.activeElement === nx, 'M5: BACK turns off at the first part and hands the focus to NEXT');
    w.dmTourEnd(); w.dmClear(); w.setMethod('dice'); }
  // M3 / L12: the defaults are set by the script at every load (a browser that refills form boxes cannot carry them over)
  ok(['rhIdle', 'rhBlur', 'autoIdle', 'autoHide'].every((id) => $(id).getAttribute('autocomplete') === 'off') && /document\.getElementById\("rhIdle"\)\.value = RH_IDLE_DEFAULT; document\.getElementById\("rhBlur"\)\.checked = true;\s*document\.getElementById\("autoIdle"\)\.value = "0"; document\.getElementById\("autoHide"\)\.checked = false;/.test(html), 'L12: the re-hide and auto-clear settings have autocomplete off and are set by the script at load');
  { const w2 = await ready(loadPage(html.replace('<option value="5" selected>5 minutes</option>', '<option value="5">5 minutes</option>').replace('<option value="1">1 minute</option>', '<option value="1" selected>1 minute</option>').replace('id="rhBlur" autocomplete="off" checked', 'id="rhBlur" autocomplete="off"').replace('<option value="30">30 minutes</option></select>', '<option value="30" selected>30 minutes</option></select>')));
    ok(w2.document.getElementById('rhIdle').value === '5' && w2.document.getElementById('rhBlur').checked && w2.document.getElementById('autoIdle').value === '0', 'L12: a page whose boxes came back with other values still starts at 5 minutes, window blur on, auto-clear off');
    w2.document.getElementById('rolls').value = '12'; w2.alert('test'); w2.dispatchEvent(new w2.Event('blur')); ok(!w2.document.getElementById('rhBar').classList.contains('on'), 'M3: a window blur right after one of the page\u2019s own notices (alert) covers nothing');
    w2.eval('rhDlgEnd = 0'); w2.dispatchEvent(new w2.Event('blur')); ok(w2.document.getElementById('rhBar').classList.contains('on'), 'M3: later it covers again'); w2.close(); }
  // L1: the passphrase check, details
  { const L = (p, m = false) => w.ppkLines(p, 'drillPass', m).join(' | '), C = (p) => w.ppkCheck(p);
    ok(/a no-break space becomes a plain space/.test(L('my\u00a0pass')), 'L1: a no-break space is named (not shown as an unreadable blank)');
    ok(/has a tab or a line break/.test(L('a\tb')) && /a tab, a line break, a special space or an invisible character, shown as a mark above/.test(L('a\tb')) && !/underlined/.test(L('a\tb')) && !/accented letters/.test(L('a\tb')), 'L1: a tab is called a mark, not underlined, and not an accented letter');
    ok(/has a control character/.test(L('a\x7fb')) && /shown as a mark above/.test(L('a\x7fb')), 'L1: DEL is named as a control character');
    ok(C('ﬁ'.repeat(60)).len === 120 && C('ﬁ'.repeat(60)).overCc && /120 characters long, as the wallet uses it\. A Coldcard accepts at most 100/.test(L('ﬁ'.repeat(60))), 'L1: 60 ligatures count as the 120 characters the wallet uses (over the Coldcard limit)');
    ok((L('ﬁﬁﬁ').match(/ﬁ becomes/g) || []).length === 1 && /3 characters here change/.test(L('ﬁﬁﬁ')), 'L1: a repeated character is listed once (and counted each time)');
    ok(/accent marks in another order/.test(L('a\u0301\u0323')), 'L1: a change only in the order of accent marks is reported');
    ok(/spaces still show/.test((() => { $('drillPass').value = 'a b'; w.ppkRender('drillPass'); const t = $('ppk-drillPass').textContent; $('drillPass').value = ''; w.ppkRender('drillPass'); return t; })()), 'L1: masked, the box says the spaces still show');
    $('ppA').value = 'café'; $('ppB').value = 'cafe\u0301'; await w.ppCheck(); ok(/MATCH: both are exactly the same, 5 characters, as a wallet uses them/.test($('ppStatus').textContent), 'L1: MATCH counts the characters the wallet uses (é typed as one is 2 after NFKD)'); }
  // L2, L3: practice wording; a drop is refused like a paste
  $('ppA').value = 'a'; $('ppB').value = 'b'; await w.ppCheck(); ok(/Look at the first with SHOW, then type the second again/.test($('ppStatus').textContent), 'L2: NO MATCH says to look at the first with SHOW and type the second again');
  { const ev = new w.Event('drop', { cancelable: true }); $('ppB').dispatchEvent(ev); ok(ev.defaultPrevented && /Pasting is turned off/.test($('ppStatus').textContent), 'L3: dropping text into the from-memory box is refused too'); }
  w.ppClear();
  // L7: Link as QR waits for the self-test, and CLEAR ALL empties it
  { $('lqIn').value = 'https://example.org/'; await w.lqMake(); ok(/<svg/.test($('lqImg').innerHTML), 'setup: a link QR'); w.clearAll(); await sleep(20);
    ok(!$('lqIn').value && !$('lqImg').innerHTML && !$('lqStatus').textContent, 'L7: CLEAR ALL empties Link as QR');
    const al = []; w.alert = (m) => al.push(m); E('selfTestState = "fail"'); $('lqIn').value = 'https://example.org/'; await w.lqMake(); E('selfTestState = "pass"');
    ok(!$('lqImg').innerHTML && /self-test FAILED/.test(al.join()), 'L7: MAKE QR does nothing when the self-test failed'); $('lqIn').value = ''; }
  // L11: the passphrase notes are covered (facts about the passphrase)
  $('passphrase').value = ' x'; $('passphrase').dispatchEvent(new w.Event('input', { bubbles: true })); hideTab(); ok(covered('passWarn'), 'L11: the passphrase note (it starts with a space ...) is covered'); w.rhShow(); w.clearAll(); await sleep(20);

  // H2: Link as QR, every example of the review, both ways (and more). R = refused, A = a QR code is made.
  { const cases = await w.eval(`(async () => {
      const M = "legal winner thank year wave sausage worth useful legal winner thank yellow", w = M.split(" ");
      const M24 = "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless";
      const seed = await mnemonicToSeed(M, ""), root = await masterFromSeed(seed);
      const xprv = await xprvText(root, "main"), tprv = await xprvText(root, "test"), raw = await base58decode(xprv);
      const ver = async (v) => { const b = new Uint8Array(raw); b.set(fromHex(v), 0); return await base58check(b); };
      const key = fromHex("0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d");
      const wif = async (v, comp) => { const b = new Uint8Array(33 + (comp ? 1 : 0)); b[0] = v; b.set(key, 1); if (comp) b[33] = 1; return await base58check(b); };
      const wifU = await wif(0x80, false), wifC = await wif(0x80, true), wifT = await wif(0xef, true), wifTU = await wif(0xef, false);
      const typo = (s) => s.slice(0, 20) + (s[20] === "a" ? "b" : "a") + s.slice(21);
      const s39 = await slip39Make("1234561234561234561234561234561234561234561234561234561234561234", {bits: 128, groupThreshold: 1, groups: [[2, 3]], passphrase: ""});
      const s39share = (function f(x){ if (typeof x === "string") return x; if (Array.isArray(x)) return f(x[0]); if (x && typeof x === "object") return f(x.shares || x.members || x.mnemonics || Object.values(x)[0]); return null; })(s39.groups);
      const c32 = await c32Make("1234561234561234561234561234561234561234561234561234561234561234", {bits: 128, k: 2, n: 3});
      const c32share = typeof c32.shares[0] === "string" ? c32.shares[0] : (c32.shares[0].s || c32.shares[0].string);
      const H64 = "0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d", TX = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b", SHA = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      return [
        ["R", "12 words with spaces", M], ["R", "12 words with commas", w.join(",")], ["R", "12 words, comma and space", w.join(", ")], ["R", "12 words on lines", w.join("\\n")],
        ["R", "12 words numbered", w.map((x, i) => (i + 1) + ". " + x).join("\\n")], ["R", "12 words in capitals", M.toUpperCase()],
        ["R", "12 words, 1 typo", M.replace("sausage", "sausege")], ["R", "12 words, 2 typos", M.replace("sausage", "sausege").replace("useful", "usefull")],
        ["R", "12 words, 3 typos", M.replace("sausage", "sausege").replace("useful", "usefull").replace("yellow", "yelow")],
        ["R", "24 words, 5 typos", M24.replace("letter", "leter").replace("absurd", "absrud").replace("doctor", "docter").replace("acoustic", "accoustic").replace("bless", "bles")],
        ["R", "12 words, first 4 letters", w.map((x) => x.slice(0, 4)).join(" ")],
        ["R", "12 words in a link (+)", "https://mysite.io/restore?mnemonic=" + w.join("+")], ["R", "12 words in a link (%20)", "https://mysite.io/restore?mnemonic=" + w.join("%20")],
        ["R", "12 words in a link, no label", "https://mysite.io/r?q=" + w.join("+")], ["R", "12 words in a link, %20, no label", "https://mysite.io/r/" + w.join("%20")],
        ["R", "12 words after a label", "Backup of the hardware wallet in the kitchen drawer, written 2026: " + M],
        ["R", "12 words joined with -", w.join("-")], ["R", "12 words run together", w.join("")], ["R", "12 words run together, capitals", w.map((x) => x[0].toUpperCase() + x.slice(1)).join("")],
        ["R", "11 words (one missing)", w.slice(0, 11).join(" ")], ["R", "half a seed: 6 words", w.slice(0, 6).join(" ")], ["R", "8 words after a label", "my seed words: " + w.slice(0, 8).join(" ")],
        ["R", "xprv", xprv], ["R", "tprv", tprv], ["R", "zprv", await ver("04b2430c")], ["R", "yprv", await ver("049d7878")], ["R", "vprv", await ver("045f18bc")], ["R", "Zprv", await ver("02aa7a99")],
        ["R", "xprv, one wrong character", typo(xprv)], ["R", "xprv and a period", "My key: " + xprv + "."], ["R", "xprv over two lines", xprv.slice(0, 60) + "\\n" + xprv.slice(60)],
        ["R", "xprv in a link (k=)", "https://x.org/?k=" + xprv], ["R", "xprv in a link (key-)", "https://x.org/key-" + xprv], ["R", "xprv URL-encoded (%3D)", "https://x.org/?next=k%3D" + xprv],
        ["R", "descriptor with an xprv", "wpkh(" + xprv + "/84h/0h/0h/0/*)#abcdefgh"], ["R", "descriptor [fp/path]xprv", "wpkh([d34db33f/84h/0h/0h]" + xprv + "/0/*)"], ["R", "descriptor with a WIF", "wpkh(" + wifC + ")"],
        ["R", "WIF uncompressed (5)", wifU], ["R", "WIF compressed (K or L)", wifC], ["R", "WIF testnet (c)", wifT], ["R", "WIF testnet (9)", wifTU], ["R", "WIF, one wrong character", typo(wifC)],
        ["R", "WIF, one wrong character, after a label", "key " + typo(wifU) + " (old)"], ["R", "WIF and a period", wifC + "."], ["R", "WIF joined with -", "key-" + wifC], ["R", "WIF in a bitcoin: link", "bitcoin:" + wifC],
        ["R", "WIF over two lines", wifC.slice(0, 26) + "\\n" + wifC.slice(26)], ["R", "WIF in groups of 4", wifC.match(/.{1,4}/g).join(" ")], ["R", "WIF URL-encoded", "https://x.org/?k%3D" + wifC],
        ["R", "hex 64", H64], ["R", "hex 64 with 0x", "0x" + H64], ["R", "hex 64 in groups", H64.match(/.{8}/g).join(" ")], ["R", "hex 64 with colons", H64.match(/.{2}/g).join(":")],
        ["R", "hex 64 labeled key", "key: " + H64], ["R", "hex 64 labeled private key, txid-like", "private key 0x" + TX], ["R", "hex 128 (a BIP39 seed)", hex(seed)], ["R", "hex 128 labeled", "BIP39 seed: " + hex(seed)],
        ["R", "hex 32 (old Electrum seed)", "0c28fca386c7a227600b2fe50b7cae11"], ["R", "hex 64 bare txid (says to write txid in front)", TX], ["R", "hex 64 bare SHA-256 (says to write sha256 in front)", SHA],
        ["R", "SeedQR 48 digits", "0".repeat(44) + "2047"], ["R", "SeedQR digits in groups of 4", ("0001 ").repeat(12).trim()], ["R", "SeedQR digits with commas", ("0001,").repeat(12).slice(0, -1)],
        ["R", "SeedQR 96 digits", "1234".repeat(24)], ["R", "SeedQR digits after a year", "written 2026: " + ("0001 ").repeat(12).trim()], ["R", "SeedQR digits with dashes", ("1999-").repeat(12).slice(0, -1)],
        ["R", "dice, 50 rolls", "31415926535897932384626433832795028841971693993751".replace(/[0789]/g, "3")], ["R", "dice, 99 rolls", "123456".repeat(16) + "123"], ["R", "dice, 100 rolls", "123456".repeat(16) + "1234"],
        ["R", "dice in groups of 5", ("12345 ").repeat(10).trim()], ["R", "coin flips, 128", "01".repeat(64)],
        ["R", "codex32 share", c32share], ["R", "codex32 in capitals", c32share.toUpperCase()], ["R", "codex32 in groups of 4", c32share.match(/.{1,4}/g).join(" ")], ["R", "codex32 as the page shows it", c32Show(c32share)],
        ["R", "SLIP39 share", s39share], ["R", "SLIP39 share after a label", "Share 1 of 3: " + s39share],
        ["R", "BIP38 key (6P)", "6PRVWUbkzzsbcVac2qwfssoUJAN1Xhrg6bNk8J7Nzm5H7kxEbn2Nh2ZoGg"], ["R", "BIP38 key, one wrong character", typo("6PRVWUbkzzsbcVac2qwfssoUJAN1Xhrg6bNk8J7Nzm5H7kxEbn2Nh2ZoGg")],
        ["R", "Nostr nsec", "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5"], ["R", "mini key", "S6c56bnXQiBjk9mqSYE7ykVQ7NzrRy"],
        ["R", "passphrase: label", "passphrase: correct horse battery staple"], ["R", "password= label", "wallet password=hunter2!"], ["R", "25th word label", "25th word: Tr0ub4dor&3"],
        ["R", "old Electrum seed words", "like just love know never want time out there make look eye down only think heart back then into about more away still them take thing"],
        ["A", "link: Sparrow", "https://sparrowwallet.com/download/"], ["A", "link: GitHub release", "https://github.com/SeedSigner/seedsigner/releases/tag/0.8.6"],
        ["A", "link: bitcoin.org", "https://bitcoin.org/en/choose-your-wallet?step=5&platform=hardware"], ["A", "link: BIP21", "bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.001&label=test"],
        ["A", "link: mempool tx", "https://mempool.space/tx/" + TX], ["A", "link: a blog post", "https://example.org/blog/how-to-make-a-good-paper-backup-of-your-seed-words"],
        ["A", "link: wiki", "https://en.bitcoin.it/wiki/Seed_phrase#Word_Lists"], ["A", "link: a commit", "https://github.com/Coldcard/firmware/commit/09766a1473246f0abe7d853b3635c0a03be125a7"],
        ["A", "link: a file by its SHA-256", "https://example.org/files/" + SHA], ["A", "link: with a UUID", "https://example.org/doc/550e8400-e29b-41d4-a716-446655440000"],
        ["A", "link: search", "https://duckduckgo.com/?q=what+is+a+seed+phrase+and+how+do+i+keep+it+safe"],
        ["A", "xpub", "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8"],
        ["A", "public descriptor", "wpkh([73c5da0a/84h/0h/0h]xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8/0/*)#abcdefgh"],
        ["A", "txid labeled", "txid " + TX], ["A", "txid labeled (TXID:)", "TXID: " + TX], ["A", "SHA-256 labeled", "sha256: " + SHA], ["A", "SHA-256 labeled (SHA-256)", "SHA-256 " + SHA],
        ["A", "SHA-256 of a download, sentence", "The hash of the download is " + SHA], ["A", "PGP fingerprint", "E777 299F C265 DD04 7930 70EB 944D 35F9 AC3D B76A"],
        ["A", "PGP key fingerprint (gpg output)", "Key fingerprint = E777 299F C265 DD04 7930  70EB 944D 35F9 AC3D B76A"], ["A", "git commit", "09766a1473246f0abe7d853b3635c0a03be125a7"],
        ["A", "git commit labeled", "commit 09766a1473246f0abe7d853b3635c0a03be125a7"], ["A", "Taproot public key labeled", "x-only public key: " + H64],
        ["A", "address", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"], ["A", "Taproot address", "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297"],
        ["A", "fingerprint", "73c5da0a"], ["A", "5 BIP39 words", w.slice(0, 5).join(" ")],
        ["A", "sentence: meet", "Meet me at the usual place at noon and bring the blue folder"],
        ["A", "sentence: family dinner", "Family dinner Sunday: bring salad, bread, cake, juice, coffee and sugar"],
        ["A", "sentence: garden party", "Garden party ticket: table seven, guest of the artist, enter by the east gate"],
        ["A", "sentence: open the app", "Open the wallet app, scan this code, then check the first address"],
        ["A", "shopping list", "Milk, butter, cheese, rice, potato, tomato, onion, carrot, apple, banana, lemon, orange"],
        ["A", "a paragraph", "Write the words on paper, keep the paper in a safe place, and never type them into a phone or a website."],
        ["A", "Wi-Fi code", "WIFI:T:WPA;S:HomeNet;P:correct horse battery staple;;"], ["A", "phone number", "+1 555 0100 0199 2233 4455 6677 8899 0011 2233 4455 6677 8899"],
        ["A", "long number", "123456789012345678901234567890123456789012345678"], ["A", "a date and an amount", "Paid 0.0015 BTC on 2026-11-11 at 14:05, invoice 20261111-0042"],
      ];
    })()`);
    const res = [];
    for (const [want, name, t] of cases) res.push([want, name, await w.lqSecret(t)]);
    const wrong = res.filter(([want, , why]) => (want === 'R') !== !!why);
    const nR = res.filter((r) => r[0] === 'R').length, nA = res.length - nR;
    ok(wrong.length === 0, 'H2: Link as QR refuses all ' + nR + ' secrets of the table and makes a QR code of all ' + nA + ' public texts' + (wrong.length ? ': WRONG ' + wrong.map(([want, name, why]) => name + (want === 'R' ? ' (allowed)' : ' (refused: ' + why + ')')).join('; ') : ''));
    const hint = res.find((r) => r[1].startsWith('hex 64 bare txid'))[2];
    ok(/write txid or sha256 in front of it and press MAKE QR again/.test(hint), 'H2: a bare 64-hex text is refused with how to go on if it is a txid or a hash');
    ok(res.every(([want, , why]) => want === 'A' || why.length > 10), 'H2: every refusal says what it found');
    if (process.env.LQ_TABLE) for (const r of res) console.log('   ' + (r[2] ? 'REFUSED ' : 'ALLOWED ') + r[1] + (r[2] ? '  [' + r[2] + ']' : '')); }

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
  await p.evaluate(() => rhTick(Date.now() + 299000)); ok(!(await st()).bar, 'browser: 4:59 idle covers nothing');
  await p.evaluate(() => rhTick(Date.now() + 301000)); s = await st(); ok(s.bar && /5 minutes/.test(s.msg), 'browser: 5 minutes idle (the default) covers the words');
  await p.click('#rhShowBtn');
  // the passphrase check, in the browser
  await p.evaluate(() => { document.getElementById('advanced').open = true; const e = document.getElementById('passphrase'); e.value = 'x'.repeat(101); e.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(/Coldcard accepts at most 100/.test(await p.textContent('#ppk-passphrase')), 'browser: the passphrase check shows under the passphrase');
  // Link as QR, read back from the screen by jsQR
  await p.evaluate(async () => { showTab('tools'); document.getElementById('lqBox').open = true; document.getElementById('lqIn').value = 'https://sparrowwallet.com/download/'; await lqMake(); document.getElementById('lqBox').scrollIntoView(); });
  { const { PNG } = require('pngjs'), jsQR = require('jsqr'); const img = PNG.sync.read(await p.locator('#lqImg').screenshot()); const q = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
    ok(q && q.data === 'https://sparrowwallet.com/download/', 'browser: the Link QR on screen reads back as the link (jsQR)'); }
  // H1: a covered SeedQR, CompactSeedQR and hand-copy guide cannot be read back from a screenshot by jsQR, not even after
  // sharpening it (unsharp masks up to a 9-pixel radius, as for a 9-pixel blur, and three thresholds); uncovered they can
  { const { PNG } = require('pngjs'), jsQR = require('jsqr');
    const grab = async (id) => { await p.locator('#' + id).scrollIntoViewIfNeeded(); await sleep(150); return PNG.sync.read(await p.locator('#' + id).screenshot()); };
    const boxBlur = (src, W, H, r) => { const t = new Float32Array(W * H), o = new Float32Array(W * H);
      for (let y = 0; y < H; y++) { let s = 0, n = 0; for (let x = -r; x < W + r; x++) { if (x + r < W && x + r >= 0) { s += src[y * W + x + r]; n++; } if (x - r - 1 >= 0) { s -= src[y * W + x - r - 1]; n--; } if (x >= 0 && x < W) t[y * W + x] = s / n; } }
      for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let y = -r; y < H + r; y++) { if (y + r < H && y + r >= 0) { s += t[(y + r) * W + x]; n++; } if (y - r - 1 >= 0) { s -= t[(y - r - 1) * W + x]; n--; } if (y >= 0 && y < H) o[y * W + x] = s / n; } }
      return o; };
    const reads = (img) => { const W = img.width, H = img.height, g = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) g[i] = (img.data[4 * i] + img.data[4 * i + 1] + img.data[4 * i + 2]) / 3;
      const vs = [g]; for (const [r, a] of [[3, 2], [5, 4], [9, 6], [9, 12]]) { const b = boxBlur(boxBlur(g, W, H, r), W, H, r); vs.push(g.map((v, i) => v + a * (v - b[i]))); }
      for (const v of vs) { const srt = Float32Array.from(v).sort(), lo = srt[Math.floor(srt.length * 0.02)], hi = srt[Math.floor(srt.length * 0.98)];
        for (const th of [null, 0.35, 0.5, 0.65]) { const px = new Uint8ClampedArray(W * H * 4);
          for (let i = 0; i < W * H; i++) { let n = hi > lo ? (v[i] - lo) / (hi - lo) : 0.5; n = Math.min(1, Math.max(0, n)); const c = th === null ? n * 255 : n > th ? 255 : 0; px[4 * i] = px[4 * i + 1] = px[4 * i + 2] = c; px[4 * i + 3] = 255; }
          const q = jsQR(px, W, H); if (q) return q; } }
      return null; };
    const spread = (img) => { let lo = 255, hi = 0; const W = img.width, H = img.height; for (let y = Math.floor(H * 0.2); y < H * 0.8; y++) for (let x = Math.floor(W * 0.2); x < W * 0.8; x++) { const v = img.data[4 * (y * W + x)]; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };
    await p.click('#rhShowBtn').catch(() => {}); await p.evaluate(() => rhShow());
    for (const kind of ['seedqr', 'compact']) {
      await p.evaluate((k) => { showTab('make'); showSeedQr(k); const b = document.getElementById('seedQrBox'); b.style.display = ''; for (let e = document.getElementById('sqImg'); e; e = e.parentElement) if (e.tagName === 'DETAILS') e.open = true; }, kind);
      const open = reads(await grab('sqImg'));
      await p.evaluate(() => rhHide('blur')); const shut = await grab('sqImg');
      ok(!!open && !reads(shut) && spread(shut) < 8, 'H1 browser: the ' + (kind === 'compact' ? 'CompactSeedQR' : 'SeedQR') + ' reads back from a screenshot uncovered (jsQR), and covered it does not, not even sharpened (the covered picture is one flat gray, spread ' + spread(shut) + ')');
      await p.evaluate(() => rhShow()); }
    await p.evaluate(() => { openSqGuide(); sqGuideFull(); }); const gOpen = await grab('sqGuideImg');
    await p.evaluate(() => rhHide('blur')); const gShut = await grab('sqGuideImg');
    ok(spread(gOpen) > 100 && !reads(gShut) && spread(gShut) < 8, 'H1 browser: the hand-copy guide (WHOLE GRID) covered is one flat gray in a screenshot and no sharpening reads it');
    await p.evaluate(() => { sqGuideBlock(1); }); const gShut2 = await grab('sqGuideImg');
    ok(Buffer.compare(gShut.data, gShut2.data) === 0 && await p.evaluate(() => getComputedStyle(document.querySelector('#sqGuideImg svg')).visibility === 'hidden' && getComputedStyle(document.getElementById('sqGuideCaption')).filter.includes('blur')), 'H1 browser: NEXT BLOCK does nothing while covered, the grid is hidden and its caption covered');
    await p.evaluate(() => { rhShow(); closeSqGuide(); hideSeedQr(); }); }
  // M5: covering after no activity moves the focus to SHOW; SHOW gives it back
  { await p.bringToFront(); await p.evaluate(() => { showTab('make'); }); await p.focus('#rolls');
    await p.evaluate(() => rhHide('idle')); const f1 = await p.evaluate(() => document.activeElement.id);
    await p.keyboard.press('Enter'); await sleep(100); const f2 = await p.evaluate(() => [document.activeElement.id, rhOn]);
    ok(f1 === 'rhShowBtn' && f2[0] === 'rolls' && f2[1] === false, 'M5 browser: covered after no activity, the focus is on SHOW (Enter uncovers), then back in the box it was in (' + f1 + ', ' + f2[0] + ')'); }
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
  // L8: without any beforeprint event (a browser that does not send it), the print style sheet alone keeps the words off paper
  await p.emulateMedia({ media: 'print' });
  ok(await p.evaluate(() => !rhOn && getComputedStyle(document.getElementById('wordGrid')).visibility === 'hidden' && getComputedStyle(document.getElementById('rolls')).visibility === 'hidden'), 'L8 browser: in print, with no beforeprint event, the words and the rolls are still not on the page (data-rh)');
  await p.emulateMedia({ media: 'screen' });
  ok(await p.evaluate(() => getComputedStyle(document.getElementById('wordGrid')).visibility === 'visible'), 'L8 browser: on screen they show as before');
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
