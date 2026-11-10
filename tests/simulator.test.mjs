// SeedSigner+ practice simulator test (v2.13.0): the simulator in CHECK A BACKUP (section #ssBox), driven with the device's own
// buttons (UP DOWN LEFT RIGHT PRESS KEY1 KEY2 KEY3) in a real Chromium, offline, like a person would. Sources: tools/simulator/.
// Every expected value comes from an independent library (@scure/bip39, @scure/bip32, @scure/btc-signer, jsqr, node:crypto), never
// from the page's own code. The QR codes the device shows are read back from its screen with jsqr.
// Scenarios (each in its own browser context, several at a time; a stand-in camera plays one SeedQR, made here with `qrcode`):
//   dice12      dice rolls -> 12 words as SeedSigner makes them (SHA-256 of the roll string), backup verify, finalize fingerprint,
//               and the xpub export (zpub QR)
//   seedqr      load a seed by scanning its SeedQR, then Export as SeedQR: standard and compact (QR read by jsqr), the zoomed view
//   dice24      99 rolls -> 24 words
//   words       load 12 words by the on-screen keyboard (KEY2 accepts, impossible letters dimmed), passphrase -> new fingerprint,
//               Tools > Address explorer (native segwit) for that seed
//   native / nested / taproot
//               load a seed by scanning its SeedQR (camera), finalize fingerprint, xpub export QR for the script type,
//               address explorer: receive and change addresses (list, next page, full address QR) against @scure/btc-signer
//   settings    every Settings menu at every level: each entry opens, with the right options
//   tools       Tools > Calc 12th word, Power > Restart, the screensaver
//   offline     the offline rule: seed QR scanning is refused while the browser is online, works while it is offline
//   wipe        CLEAR ALL, closing the section, the auto-clear and END SESSION clear the simulator; keyboard only with focus
// And: the page self-test passes (140/140) in every page opened, and no page error or console error happens in any of them.
// Run: node tests/simulator.test.mjs        (SCEN=dice12,wipe to run some; SIM_CONC=4 to run fewer at a time)
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const pw = require('playwright-core');
const QR = require('qrcode');
const jsQR = require('jsqr');
const bip39 = require('@scure/bip39');
const { wordlist } = require('@scure/bip39/wordlists/english');
const { HDKey } = require('@scure/bip32');
const btc = require('@scure/btc-signer');
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + (process.env.VF_FILE || path.join(here, '..', 'voidforge.html'));
const T0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fails.push(m); };
let pass = 0; const fails = []; const pageProblems = []; const badges = new Set();

// ================================================================ expected values (independent libraries only)
const sha256 = (b) => createHash('sha256').update(b).digest();
const diceWords = (rolls, n) => bip39.entropyToMnemonic(new Uint8Array(sha256(rolls).subarray(0, n === 12 ? 16 : 32)), wordlist);   // SeedSigner: SHA-256 of the dice string, first 16 or 32 bytes
const ABANDON = 'abandon '.repeat(11) + 'about';
const rootOf = (m, pass = '', versions) => HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(m, pass), versions);
const fpOf = (root) => root.fingerprint.toString(16).padStart(8, '0');
const VERS = {   // single-sig mainnet extended key versions: xpub, ypub (nested), zpub (native)
  xpub: { private: 0x0488ade4, public: 0x0488b21e }, ypub: { private: 0x049d7878, public: 0x049d7cb2 }, zpub: { private: 0x04b2430c, public: 0x04b24746 },
};
const SCRIPTS = {   // what the simulator calls them -> purpose, key version, address maker
  native: { label: /^Native Segwit$/, purpose: 84, ver: 'zpub', addr: (pub) => btc.p2wpkh(pub).address },
  nested: { label: /^Nested Segwit$/, purpose: 49, ver: 'ypub', addr: (pub) => btc.p2sh(btc.p2wpkh(pub)).address },
  taproot: { label: /^Taproot$/, purpose: 86, ver: 'xpub', addr: (pub) => btc.p2tr(pub.slice(1)).address },   // BIP86: x-only key, no script tree
};
const addrOf = (m, pass, kind, chain, i) => SCRIPTS[kind].addr(rootOf(m, pass).derive(`m/${SCRIPTS[kind].purpose}'/0'/0'/${chain}/${i}`).publicKey);
const shortAddr = (a, i) => i + ':' + a.slice(0, 10) + '...' + a.slice(-10);   // how the address list shows one
const seedQrDigits = (m) => m.split(' ').map((w) => String(wordlist.indexOf(w)).padStart(4, '0')).join('');   // Standard SeedQR: 4 digits per word

// The stand-in camera: Chromium plays a video of one QR code, the Standard SeedQR of "abandon x11 about" (made by the `qrcode` package).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-sim-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* leave it */ } });
function y4m(text, file) {
  const W = 640, H = 480, m = QR.create(text, { errorCorrectionLevel: 'L', mode: 'numeric' }).modules, n = m.size, px = 8, x0 = (W - n * px) >> 1, y0 = (H - n * px) >> 1;
  const Y = Buffer.alloc(W * H, 235);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const mx = Math.floor((x - x0) / px), my = Math.floor((y - y0) / px); if (mx >= 0 && my >= 0 && mx < n && my < n && m.get(my, mx)) Y[y * W + x] = 16; }
  const uv = Buffer.alloc((W / 2) * (H / 2), 128), frame = Buffer.concat([Buffer.from('FRAME\n'), Y, uv, uv]);
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), frame, frame]));
}
const VIDEO = path.join(tmp, 'seedqr.y4m'); y4m(seedQrDigits(ABANDON), VIDEO);

// ================================================================ driving the device
async function openPage(browser, tag, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  if (o.offline !== false) await ctx.setOffline(true);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageProblems.push(tag + ' pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/willReadFrequently/.test(m.text())) pageProblems.push(tag + ' console.error: ' + m.text().slice(0, 200)); });
  page.on('dialog', (d) => d.accept());
  if (o.clock) await page.clock.install();
  await page.goto(FILE);
  await page.waitForFunction(() => window.selfTestDone !== undefined, null, { timeout: 90000 });
  await page.evaluate(() => window.selfTestDone);
  const go = await page.$('#sgGo'); if (go && await go.isVisible()) await go.click();
  badges.add((await page.textContent('#selfTestBadge')).trim());
  await page.evaluate(() => showTab('check'));
  await page.evaluate(() => { const b = document.getElementById('ssBox'); b.open = true; b.scrollIntoView(); });
  return { ctx, page, d: device(page) };
}
const KEYID = { UP: 'ssKUp', DOWN: 'ssKDown', LEFT: 'ssKLeft', RIGHT: 'ssKRight', PRESS: 'ssKPress', K1: 'ssK1', K2: 'ssK2', K3: 'ssK3' };
function device(page) {
  const d = {
    ev: (f, a) => page.evaluate(f, a),
    async press(k, wait = 320) { await page.click('#' + KEYID[k]); await sleep(wait); },
    async state() {
      return page.evaluate(() => {
        const c = SSController._instance; if (!c) return null;
        const x = c.current_destination, v = x && x.view, s = v && v.screen;
        return { view: x && x.View_cls && x.View_cls.name, screen: s && s.constructor.name, title: s && s.title, sel: s && s.selected_button,
          labels: s && s.button_data ? s.button_data.map((b) => typeof b === 'string' ? b : (b && (b.button_label || b.label))) : null,
          text: s && s.text, headline: s && s.status_headline };
      });
    },
    async waitView(name, ms = 20000) {
      const t = Date.now(); let s;
      while (Date.now() - t < ms) { s = await d.state(); if (s && (s.view === name || s.screen === name)) { await sleep(200); return s; } await sleep(100); }
      throw new Error('timeout waiting for ' + name + ', at ' + JSON.stringify(s));
    },
    kbInfo: (name) => page.evaluate((name) => { const kb = SSController._instance.current_destination.view.screen[name || 'keyboard']; return { sel: [kb.selected_key.x, kb.selected_key.y], keys: kb.keys.map((r) => r.map((k) => ({ l: k.letter, c: k.code, a: k.is_active }))) }; }, name),
    async kbGo(ch, o = {}) {   // moves the keyboard selection to the key (a letter, or {x, y}) and presses it
      const wait = o.wait || 190;
      for (let n = 0; n < 40; n++) {
        const { sel, keys } = await d.kbInfo(o.kb); let ty = -1, tx = -1;
        if (typeof ch === 'object') { tx = ch.x; ty = ch.y; } else keys.forEach((r, y) => r.forEach((k, x) => { if (k.l === ch || k.c === ch) { ty = y; tx = x; } }));
        if (ty < 0) throw new Error('no key ' + ch);
        if (sel[1] < ty) await d.press('DOWN', wait); else if (sel[1] > ty) await d.press('UP', wait);
        else if (sel[0] < tx) await d.press('RIGHT', wait); else if (sel[0] > tx) await d.press('LEFT', wait);
        else { await d.press('PRESS', wait); return; }
      }
      throw new Error('keyboard stuck at ' + ch);
    },
    async type(word, wait) {   // types letters (the keyboard may already sit on the next one)
      for (const ch of word) { const kb = await d.kbInfo(); const [x, y] = kb.sel; if (kb.keys[y][x].l !== ch) await d.kbGo(ch, { wait }); else await d.press('PRESS', 220); }
    },
    async pick(re, o = {}) {   // selects the button whose label matches and presses it
      for (let n = 0; n < 30; n++) {
        const s = await d.state(); const i = (s.labels || []).findIndex((l) => re.test(l || ''));
        if (i < 0) throw new Error('no button ' + re + ' in ' + JSON.stringify(s));
        if (s.sel === i) { await d.press('PRESS', o.wait || 400); return; }
        if (s.screen === 'SSMainMenuScreen' || s.screen === 'SSLargeButtonScreen') {   // 2 x 2 grid
          const [cx, cy] = [s.sel % 2, Math.floor(s.sel / 2)], [tx, ty] = [i % 2, Math.floor(i / 2)];
          if (s.sel === 1000 || s.sel === null) await d.press('DOWN', 300); else if (cy < ty) await d.press('DOWN', 300); else if (cy > ty) await d.press('UP', 300); else if (cx < tx) await d.press('RIGHT', 300); else await d.press('LEFT', 300);
        } else await d.press(s.sel > i ? 'UP' : 'DOWN', 300);
      }
      throw new Error('stuck at ' + re);
    },
    async back(to, wait = 900) {   // LEFT (the Back button) and PRESS until the wanted view shows
      for (let n = 0; n < 10; n++) { const s = await d.state(); if (s.view === to) return s; await d.press('LEFT', 300); await d.press('PRESS', wait); }
      throw new Error('could not go back to ' + to + ', at ' + JSON.stringify(await d.state()));
    },
    async readQR() {   // the QR code on the screen, read with jsqr
      const px = await page.evaluate(() => { const c = document.getElementById('ssScreen'), g = c.getContext('2d'), i = g.getImageData(0, 0, c.width, c.height); return { w: c.width, h: c.height, d: Array.from(i.data) }; });
      const r = jsQR(Uint8ClampedArray.from(px.d), px.w, px.h);
      return r ? { text: r.data, bytes: Buffer.from(r.binaryData || []).toString('hex') } : null;
    },
    scr: (f) => page.evaluate(f),
    async loadByScan() {   // Home > Scan reads the SeedQR (abandon x11 about) from the stand-in camera, then Finalize > Done
      await d.waitView('SSMainMenuView'); await d.pick(/^Scan$/, { wait: 600 });
      const s = await d.waitView('SSSeedFinalizeView', 30000);
      const fp = await d.scr(() => SSController._instance.current_destination.view.screen.fingerprint);
      await d.pick(/^Done$/, { wait: 1500 }); return { fp, s };
    },
  };
  return d;
}

// ================================================================ scenarios
const SCEN = {};

// ---- dice rolls -> words, as SeedSigner does it; backup verify; finalize; xpub export; SeedQR
async function diceRun(d, n, rolls) {
  await d.waitView('SSMainMenuView'); await d.pick(/^Tools$/, { wait: 900 });
  await d.press('DOWN', 300); await d.press('PRESS', 900);   // the second "New seed" is the dice one
  await d.pick(new RegExp(n + ' words'), { wait: 1000 });
  await d.waitView('SSToolsDiceEntropyEntryScreen');
  for (let i = 0; i < rolls.length; i++) { const k = +rolls[i] - 1; await d.kbGo({ x: k % 3, y: Math.floor(k / 3) }, { wait: 160 }); }
  await d.waitView('SSSeedWordsWarningView'); await d.press('PRESS', 800);
  const words = [];
  for (let p = 0; p < n / 4; p++) { await d.waitView('SSSeedWordsScreen'); words.push(...await d.scr(() => SSController._instance.current_destination.view.screen.words)); await d.press('PRESS', 900); }
  return words;
}
SCEN.dice12 = async (t, d, ctx) => {
  const rolls = '123456'.repeat(9).slice(0, 50), exp = diceWords(rolls, 12), root = rootOf(exp), fp = fpOf(root);
  const words = await diceRun(d, 12, rolls);
  t(words.join(' ') === exp, 'dice: 50 rolls give the 12 words SeedSigner makes (' + exp.split(' ').slice(0, 3).join(' ') + ' ...)');
  // backup verify: the right word every time, then the success screen
  await d.waitView('SSSeedWordsBackupTestPromptView'); await d.pick(/Verify/);
  const asked = [];
  for (let n = 0; n < 14; n++) {
    const s = await d.state(); if (s.view !== 'SSSeedWordsBackupTestView') break;
    const cur = await d.scr(() => SSController._instance.current_destination.view.cur_index);
    asked.push(cur); await d.pick(new RegExp('^' + words[cur] + '$'), { wait: 700 });
  }
  let s = await d.state();
  t(new Set(asked).size === 12 && s.view === 'SSSeedWordsBackupTestSuccessView' && /Backup Verified/.test(s.title), 'backup verify: every one of the 12 words is asked once, the right answers give "Backup Verified" (asked ' + asked.length + ', ' + new Set(asked).size + ' different)');
  await d.press('PRESS', 800);
  s = await d.waitView('SSSeedFinalizeView');
  const shown = await d.scr(() => SSController._instance.current_destination.view.screen.fingerprint);
  t(shown === fp, 'finalize: shows the fingerprint ' + fp + ' (shows ' + shown + ')');
  await d.pick(/^Done$/, { wait: 1500 }); s = await d.state();
  t(s.view === 'SSSeedOptionsView' && s.title === fp, 'the seed is stored under its fingerprint ' + fp);
  // xpub export (native segwit, static QR): the QR holds [fingerprint/path]zpub
  await xpubExport(t, d, 'native', exp, fp);
};
SCEN.seedqr = async (t, d) => {   // Seeds > fingerprint > Backup seed > Export as SeedQR, standard and compact, and the zoomed view
  const { fp } = await d.loadByScan();
  await seedQrChecks(t, d, ABANDON, fp);
};
async function xpubExport(t, d, kind, mnemonic, fp) {
  const S = SCRIPTS[kind], path = `m/${S.purpose}'/0'/0'`, want = rootOf(mnemonic, '', VERS[S.ver]).derive(path).publicExtendedKey;   // zpub / ypub / xpub as the script type needs
  await d.pick(/Export xpub/, { wait: 800 });
  for (let n = 0; n < 8; n++) {
    const s = await d.state();
    if (s.screen === 'SSQRDisplayScreen') break;
    if (s.view === 'SSSeedExportXpubSigTypeView') await d.pick(/Single Sig/, { wait: 800 });
    else if (s.view === 'SSSeedExportXpubScriptTypeView') await d.pick(S.label, { wait: 800 });
    else if (s.view === 'SSSeedExportXpubQRFormatView') await d.pick(/Static/, { wait: 800 });
    else if (s.view === 'SSSeedExportXpubWarningView') await d.press('PRESS', 2500);
    else if (s.view === 'SSSeedExportXpubDetailsView') {
      await sleep(1200);
      const det = await d.scr(() => { const sc = SSController._instance.current_destination.view.screen; return { fp: sc.fingerprint, path: sc.derivation_path, xpub: sc.xpub }; });
      t(det.fp === fp && det.path === path && det.xpub === want, 'xpub details (' + kind + '): ' + fp + ' ' + path + ' ' + want.slice(0, 12) + '... (shows ' + det.path + ' ' + String(det.xpub).slice(0, 12) + '...)');
      await d.press('PRESS', 2500);
    } else await d.press('PRESS', 1200);
  }
  await sleep(1500);
  const q = await d.readQR();
  t(q && q.text === `[${fp}/${path.slice(2)}]${want}`, 'xpub QR (' + kind + ', static): [' + fp + '/' + path.slice(2) + ']' + want.slice(0, 12) + '... read with jsqr' + (q && q.text !== `[${fp}/${path.slice(2)}]${want}` ? ' (got ' + q.text.slice(0, 40) + ')' : ''));
  await d.press('RIGHT', 1200);   // leaves the QR screen
}
async function seedQrChecks(t, d, mnemonic, fp) {
  const entropy = Buffer.from(bip39.mnemonicToEntropy(mnemonic, wordlist)).toString('hex'), n = mnemonic.split(' ').length;
  for (const [fmt, re, modules, zone] of [['standard', /^Standard/, n === 12 ? 25 : 29, 5], ['compact', /^Compact/, n === 12 ? 21 : 25, n === 12 ? 7 : 5]]) {
    await d.back('SSMainMenuView');   // Seeds > fingerprint > Backup seed > Export as SeedQR
    await d.pick(/^Seeds$/, { wait: 800 }); await d.pick(new RegExp(fp), { wait: 800 }); await d.pick(/Backup seed/, { wait: 800 }); await d.pick(/SeedQR/, { wait: 800 });
    await d.waitView('SSSeedTranscribeSeedQRFormatView'); await d.pick(re, { wait: 800 });
    for (let k = 0; k < 6; k++) { const s = await d.state(); if (s.view !== 'SSSeedTranscribeSeedQRWarningView') break; await d.press('PRESS', 1500); }
    await d.waitView('SSSeedTranscribeSeedQRWholeQRView'); await sleep(800);
    const q = await d.readQR();
    if (fmt === 'standard') t(q && q.text === seedQrDigits(mnemonic), 'SeedQR standard (' + modules + 'x' + modules + '): digits ' + seedQrDigits(mnemonic).slice(0, 12) + '... read with jsqr' + (q ? '' : ' (no QR found)'));
    else t(q && q.bytes === entropy, 'SeedQR compact (' + modules + 'x' + modules + '): the ' + entropy.length / 2 + ' entropy bytes ' + entropy.slice(0, 8) + '... read with jsqr' + (q ? '' : ' (no QR found)'));
    await d.press('PRESS', 2500);   // Begin: the zoomed view
    await d.waitView('SSSeedTranscribeSeedQRZoomedInScreen'); await sleep(1200);
    const info = () => d.scr(() => { const s = SSController._instance.current_destination.view.screen; return { m: s.num_modules, z: s.modules_per_zone, x: s.cur_zone_x, y: s.cur_zone_y }; });
    let z = await info(); const zones = Math.ceil(modules / zone);
    t(z.m === modules && z.z === zone && z.x === 0 && z.y === 0, 'SeedQR zoomed view (' + fmt + '): ' + modules + ' modules in zones of ' + zone + ', starts at A-1');
    for (let i = 0; i < zones + 1; i++) await d.press('RIGHT', 700);
    await d.press('DOWN', 700); z = await info();
    t(z.x === zones - 1 && z.y === 1, 'SeedQR zoomed view (' + fmt + '): the arrow keys move zone by zone and stop at the edge (zone ' + 'ABCDEF'[z.y] + '-' + (z.x + 1) + ' of ' + zones + ' wide)');
    await d.press('PRESS', 1500);   // exits the zoomed view; the device offers to confirm the SeedQR by scanning it back, or Done
    await d.waitView('SSSeedTranscribeSeedQRConfirmQRPromptView'); await d.pick(/^Done$/, { wait: 1200 });
  }
}
SCEN.dice24 = async (t, d) => {
  const rolls = '123456'.repeat(17).slice(0, 99), exp = diceWords(rolls, 24);
  const words = await diceRun(d, 24, rolls);
  t(words.length === 24 && words.join(' ') === exp, 'dice: 99 rolls give the 24 words SeedSigner makes (' + exp.split(' ').slice(0, 3).join(' ') + ' ...)');
  t(bip39.validateMnemonic(words.join(' '), wordlist), 'the 24 words are a valid BIP-39 phrase');
};

// ---- the word keyboard, a passphrase, Tools > Address explorer
SCEN.words = async (t, d) => {
  await d.waitView('SSMainMenuView'); await d.pick(/^Seeds$/, { wait: 800 });
  let s = await d.state(); if (s.view !== 'SSLoadSeedView') await d.pick(/Load a seed/, { wait: 800 });
  await d.pick(/12.word/, { wait: 1000 });
  const ws = ABANDON.split(' '); let accepted = 0, dim = null, poss = null;
  for (let i = 0; i < 12; i++) {
    const w = ws[i], typed = w === 'abandon' ? 'aba' : 'abo';
    for (let j = 0; j < typed.length; j++) {
      await d.type(typed[j]);
      if (i === 11 && j === 1) dim = await d.scr(() => { const sc = SSController._instance.current_destination.view.screen; return { alpha: sc.possible_alphabet, words: sc.possible_words, off: sc.keyboard.keys.flat().filter((k) => !k.is_active).map((k) => k.letter).join('') }; });
    }
    if (i === 11) poss = await d.scr(() => SSController._instance.current_destination.view.screen.possible_words);
    await d.press('K2', 700);
    if (i < 11) { s = await d.state(); if (s.screen === 'SSSeedMnemonicEntryScreen') accepted++; }
  }
  const wl = (p) => wordlist.filter((x) => x.startsWith(p)), next = new Set(wl('ab').map((x) => x[2]));
  t(dim && dim.alpha.slice().sort().join('') === [...next].sort().join('') && dim.off === 'abcdefghijklmnopqrstuvwxyz'.split('').filter((c) => !next.has(c)).join(''),
    'word keyboard: after "ab" only ' + [...next].sort().join('') + ' stay lit (BIP-39 list), the other 20 letters are dimmed');
  t(dim && JSON.stringify(dim.words) === JSON.stringify(wl('ab')), 'word keyboard: after "ab" the candidates are the ' + wl('ab').length + ' words that start with ab');
  t(JSON.stringify(poss) === JSON.stringify(wl('abo')) && wl('abo').join() === 'about,above', 'word keyboard: after "abo" the candidates are ' + wl('abo').join(' and '));
  t(accepted === 11, 'word keyboard: KEY2 accepts the first candidate and moves to the next word (11 of 11 moved on)');
  await sleep(2500); s = await d.waitView('SSSeedFinalizeView');
  const fp = fpOf(rootOf(ABANDON)), shown = await d.scr(() => SSController._instance.current_destination.view.screen.fingerprint);
  t(shown === fp, 'the 12 typed words give the fingerprint ' + fp + ' (shows ' + shown + ')');
  // the passphrase: A (capitals, K1 switches) b (lower case) 1 (digits)
  await d.pick(/Passphrase/, { wait: 1000 });
  await d.press('K1', 400); await d.kbGo('A', { kb: 'keyboard_ABC' }); await d.press('K1', 400); await d.kbGo('b', { kb: 'keyboard_abc' }); await d.press('K2', 400); await d.kbGo('1', { kb: 'keyboard_digits' });
  const typed = await d.scr(() => SSController._instance.current_destination.view.screen.passphrase);
  t(typed === 'Ab1', 'passphrase: capitals, lower case and digits keyboards type "Ab1" (' + typed + ')');
  await d.press('K3', 1200); await d.pick(/^Done$/, { wait: 2500 }); s = await d.state();
  if (s.view === 'SSSeedFinalizeView') { await d.pick(/^Done$/, { wait: 1500 }); s = await d.state(); }
  const fp2 = fpOf(rootOf(ABANDON, 'Ab1'));
  t(fp2 !== fp && s.view === 'SSSeedOptionsView' && s.title === fp2, 'the passphrase "Ab1" changes the fingerprint from ' + fp + ' to ' + fp2 + ' (the device says ' + s.title + ')');
  // Tools > Address explorer for this seed (native segwit)
  await d.back('SSMainMenuView');
  await d.pick(/^Tools$/, { wait: 800 }); await d.pick(/Address explorer/, { wait: 900 }); await d.pick(new RegExp(fp2), { wait: 900 });
  await d.pick(/Native Segwit/, { wait: 900 });
  await explorer(t, d, 'native', ABANDON, 'Ab1', 'Tools > Address explorer, passphrase seed');
};

// ---- the address explorer: receive and change addresses against @scure/btc-signer
async function explorer(t, d, kind, mnemonic, pass, label) {
  const lab = (a) => label + ' (' + kind + ')';
  let s = await d.state();
  if (s.view !== 'SSToolsAddressExplorerAddressTypeView') s = await d.waitView('SSToolsAddressExplorerAddressTypeView');
  for (const [chain, re, name] of [[0, /Receive/, 'receive'], [1, /Change/, 'change']]) {
    await d.pick(re, { wait: 3000 }); await d.waitView('SSToolsAddressExplorerAddressListView'); await sleep(1500);
    s = await d.state();
    const want = Array.from({ length: 10 }, (_, i) => shortAddr(addrOf(mnemonic, pass, kind, chain, i), i));
    const got = (s.labels || []).slice(0, 10);
    t(JSON.stringify(got) === JSON.stringify(want), lab() + ' first 10 ' + name + ' addresses match @scure/btc-signer (' + addrOf(mnemonic, pass, kind, chain, 0).slice(0, 14) + '... first)' + (JSON.stringify(got) === JSON.stringify(want) ? '' : ' got ' + got[0] + ' wanted ' + want[0]));
    await d.press('PRESS', 1500);   // the first address in full, as a QR code
    const full = addrOf(mnemonic, pass, kind, chain, 0), q = await d.readQR();
    const shownAddr = await d.scr(() => SSController._instance.current_destination.view.address);
    t(shownAddr === full && q && q.text === full, lab() + ' ' + name + ' address 0 in full, and its QR, is ' + full);
    await d.press('PRESS', 1500); await d.waitView('SSToolsAddressExplorerAddressListView');
    if (chain === 0) {   // the Next button shows addresses 10 to 19
      await d.pick(/^Next 10$/, { wait: 3000 }); await sleep(1500); s = await d.state();
      const want2 = Array.from({ length: 10 }, (_, i) => shortAddr(addrOf(mnemonic, pass, kind, 0, 10 + i), 10 + i));
      t(JSON.stringify((s.labels || []).slice(0, 10)) === JSON.stringify(want2), lab() + ' next page: receive addresses 10 to 19 match');
      await d.back('SSToolsAddressExplorerAddressTypeView');
    } else await d.back('SSToolsAddressExplorerAddressTypeView');
  }
}
for (const kind of ['native', 'nested', 'taproot']) {
  SCEN[kind] = async (t, d) => {
    const { fp, s } = await d.loadByScan();
    const root = rootOf(ABANDON);
    const st = await d.state();
    t(fp === fpOf(root) && st.view === 'SSSeedOptionsView' && st.title === fpOf(root), 'scanning the SeedQR loads abandon x11 about: finalize and the seed list show ' + fpOf(root));
    await xpubExport(t, d, kind, ABANDON, fpOf(root));
    await d.pick(/^Seeds$/, { wait: 800 }); await d.pick(new RegExp(fpOf(root)), { wait: 800 });
    await d.pick(/Address explorer/, { wait: 900 });
    await d.pick(SCRIPTS[kind].label, { wait: 900 });
    await explorer(t, d, kind, ABANDON, '', 'Seed > Address explorer');
  };
}

// ---- Settings, every level
const SET_ADV = {
  'Bitcoin network': ['Mainnet', 'Testnet', 'Regtest'], 'QR code density': ['Low', 'Medium', 'High'], 'Sig types': ['Single Sig', 'Multisig'],
  'Script types': ['Native Segwit', 'Nested Segwit', 'Legacy', 'Taproot', 'Custom Derivation'], 'Xpub QR format': ['Animated (default)', 'Static', 'Specter legacy'],
  'Show xpub details': ['Enabled', 'Disabled'], 'BIP-39 passphrase': ['Enabled', 'Disabled', 'Required'], 'Camera rotation': ['0°', '90°', '180°', '270°'],
  'Compact SeedQR': ['Enabled', 'Disabled'], 'BIP-85 child seeds': ['Enabled', 'Disabled'], 'Electrum seeds': ['Enabled', 'Disabled'],
  'MicroSD notification duration': ['Disabled', '5 seconds', 'Until SD removed'], 'Message signing': ['Enabled', 'Disabled'], 'Show privacy warnings': ['Enabled', 'Disabled'],
  'Show dire warnings': ['Enabled', 'Disabled'], 'Show QR brightness tips': ['Enabled', 'Disabled'], 'Show partner logos': ['Enabled', 'Disabled'],
};
SCEN.settings = async (t, d) => {
  await d.waitView('SSMainMenuView'); await d.pick(/^Settings$/, { wait: 700 });
  const seen = {}, entries = {}; const back = async (w = 600) => { await d.press('LEFT', 250); await d.press('PRESS', w); };
  const walk = async (path) => {
    let s = await d.state(); const title = s.title, labels = s.labels.slice(), here = path || 'Settings';
    entries[here] = labels;
    for (const l of labels) {
      for (let n = 0; n < 4 && (await d.state()).title !== title; n++) await back();
      await d.pick(new RegExp('^' + l.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '$'), { wait: 650 });
      s = await d.state();
      if (s.view === 'SSSettingsMenuView' && s.title !== title) { seen[here + ' > ' + l] = 'menu'; await walk(here + ' > ' + l); continue; }
      seen[here + ' > ' + l] = s.view + (s.labels ? ' ' + s.labels.join('|') : '');
      if (s.view === 'SSIOTestView') { await d.press('UP', 300); await d.press('K2', 300); await d.press('K3', 800); }
      else if (s.view === 'SSDonateView') await d.press('PRESS', 800);
      else await back(650);
    }
    await back();
  };
  await walk('');
  t(JSON.stringify(entries.Settings) === JSON.stringify(['Language', 'Persistent settings', 'Denomination display', 'Advanced', 'I/O test', 'Donate']), 'Settings menu lists Language, Persistent settings, Denomination display, Advanced, I/O test, Donate');
  const advLabels = entries['Settings > Advanced'] || [];
  t(Object.keys(SET_ADV).every((k) => advLabels.includes(k)) && advLabels.includes('Hardware'), 'Settings > Advanced lists its ' + (advLabels.length) + ' entries, with Hardware as a submenu');
  t(JSON.stringify(entries['Settings > Advanced > Hardware']) === JSON.stringify(['Display type', 'Invert colors']), 'Settings > Advanced > Hardware lists Display type and Invert colors');
  const bad = [];
  const want = { 'Settings > Language': ['English'], 'Settings > Persistent settings': ['Enabled', 'Disabled'], 'Settings > Denomination display': ['BTC', 'sats', 'Threshold at 0.01', 'BTC | sats hybrid'],
    'Settings > Advanced > Display type': null };
  for (const [k, v] of Object.entries(SET_ADV)) want['Settings > Advanced > ' + k] = v;
  want['Settings > Advanced > Hardware > Display type'] = ['st7789 240x240', 'st7789 320x240', 'ili9341 320x240 (beta)']; want['Settings > Advanced > Hardware > Invert colors'] = ['Enabled', 'Disabled'];
  delete want['Settings > Advanced > Display type'];
  for (const [k, v] of Object.entries(want)) { const g = seen[k]; if (!g || !/^SSSettingsEntryUpdateSelectionView|^SSLocaleSelectionView/.test(g) || g.split(' ').slice(1).join(' ') !== v.join('|')) bad.push(k + ' -> ' + g); }
  t(bad.length === 0, 'every Settings entry opens its selection screen with the right options (' + Object.keys(want).length + ' entries)' + (bad.length ? ' BAD: ' + bad.slice(0, 3).join('; ') : ''));
  t(/SSIOTestView/.test(seen['Settings > I/O test']) && /SSDonateView/.test(seen['Settings > Donate']), 'I/O test and Donate screens open and close');
  let s = await d.state(); const seenViews = [s.view]; for (let n = 0; n < 4 && s.view !== 'SSMainMenuView'; n++) { await back(900); s = await d.state(); seenViews.push(s.view); }
  t(s.view === 'SSMainMenuView', 'after the walk, Back leads to Home (' + seenViews.join(' > ') + ')');
};

// ---- Calc 12th word, Power > Restart, the screensaver
SCEN.tools = async (t, d) => {
  await d.waitView('SSMainMenuView'); await d.pick(/^Tools$/, { wait: 900 }); await d.pick(/Calc 12th/, { wait: 900 }); await d.pick(/12 words/, { wait: 1000 });
  for (let i = 0; i < 11; i++) { await d.type('aba'); await d.press('K2', 700); }
  await sleep(800); let got = null, fin = [];
  for (let n = 0; n < 6; n++) {
    const s = await d.state();
    if (s.view === 'SSToolsCalcFinalWordFinalizePromptView') await d.pick(/zero|0|Finalize/i, { wait: 1200 });
    else if (s.view === 'SSToolsCalcFinalWordShowFinalWordView') {
      await sleep(500); got = await d.scr(() => { const sc = SSController._instance.current_destination.view.screen; return { w: sc.actual_final_word, bits: sc.selected_final_bits, cs: sc.checksum_bits }; });
      await d.press('PRESS', 1200);
    } else if (s.view === 'SSToolsCalcFinalWordDoneView') await d.press('PRESS', 2000);
    else break;
  }
  const ent = new Uint8Array(16), mn = bip39.entropyToMnemonic(ent, wordlist), cs = (sha256(Buffer.from(ent))[0] >> 4).toString(2).padStart(4, '0');
  t(got && got.w === mn.split(' ')[11] && got.w === 'about', 'Calc 12th word: abandon x11 with zero bits gives "' + mn.split(' ')[11] + '" (' + (got && got.w) + ')');
  t(got && got.cs === cs, 'Calc 12th word: the checksum bits are ' + cs + ' (SHA-256 of 16 zero bytes), the device says ' + (got && got.cs));
  for (let n = 0; n < 6 && (await d.state()).view !== 'SSMainMenuView'; n++) { await d.press('LEFT', 300); await d.press('PRESS', 1200); }
  const before = await d.ev(() => SSController._instance.storage.seeds.length);
  await d.press('LEFT', 400); await d.press('UP', 400); await d.press('PRESS', 1000);
  let s = await d.state(); t(s.view === 'SSPowerOptionsView' || /Power/i.test(String(s.view) + s.title), 'the Power button opens the power menu (' + s.view + ')');
  await d.pick(/Restart/, { wait: 150 }); await sleep(1100);
  await d.waitView('SSMainMenuView', 30000);
  const after = await d.ev(() => SSController._instance.storage.seeds.length);
  t(after === 0 && before >= after, 'Restart: the device starts again with no seeds in memory (' + before + ' before, ' + after + ' after)');
  // the screensaver starts after 2 minutes without a key (the page's clock is fast-forwarded) and a key ends it
  await d.ev(() => 0);
  await d.page_clock();
  await sleep(1500);
  t(await d.ev(() => SSController._instance.is_screensaver_running) === true, 'screensaver: runs after 2 minutes idle');
  await d.press('DOWN', 800);
  t(await d.ev(() => SSController._instance.is_screensaver_running) === false, 'screensaver: a key press ends it');
};

// ---- the offline rule
SCEN.offline = async (t, d, ctx, page) => {
  t(await d.ev(() => navigator.onLine) === true, 'this browser context is online (navigator.onLine)');
  await d.waitView('SSMainMenuView');
  await d.pick(/^Seeds$/, { wait: 800 }); await d.pick(/Scan a SeedQR/, { wait: 1200 });
  let s = await d.state(); const cam = await d.ev(() => document.body.classList.contains('cam-on'));
  t(s.view === 'SSErrorView' && /Offline only/.test(s.headline) && /only while this computer is offline/.test(s.text) && cam === false, 'online: "Scan a SeedQR" is refused with "Offline only" and the camera stays off');
  await d.press('PRESS', 1200);
  for (let n = 0; n < 4 && (await d.state()).view !== 'SSMainMenuView'; n++) { await d.press('LEFT', 300); await d.press('PRESS', 1000); }
  await d.pick(/^Scan$/, { wait: 600 }); await sleep(3500); s = await d.state();
  const seeds = await d.ev(() => SSController._instance.storage.seeds.length), pend = await d.ev(() => !!SSController._instance.storage.pending_seed);
  t(s.view === 'SSErrorView' && /Offline only/.test(s.headline) && seeds === 0 && !pend, 'online: the Scan on Home refuses the SeedQR too, and no seed is loaded');
};

// ---- wipe: CLEAR ALL, closing the section, the auto-clear, END SESSION; the keyboard only with focus
SCEN.wipe = async (t, d, ctx, page) => {
  const keep = () => d.ev(() => { const st = SSController._instance.storage; window.__ssStore = st; st.__seed = st.seeds[0]; st.__bytes = st.seeds[0] && st.seeds[0].seed_bytes; });
  const wiped = async () => {
    await sleep(400);
    return d.ev(() => {
      const c = document.getElementById('ssScreen'), g = c.getContext('2d'), px = g.getImageData(0, 0, c.width, c.height).data; let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] || px[i + 1] || px[i + 2]) lit++;
      const st = window.__ssStore;
      return { open: document.getElementById('ssBox').open, active: ssPageActive(), ctl: !!SSController._instance, lit, seeds: st ? st.seeds.length : -1, pending: st ? st.pending_seed : 'n/a',
        words: st && st.__seed ? st.__seed._mnemonic.length : -1, bytes: st && st.__bytes ? Array.from(st.__bytes).some((x) => x) : 'n/a', cam: document.body.classList.contains('cam-on') };
    });
  };
  const isWiped = (r) => r.open === false && r.active === false && r.ctl === false && r.lit === 0 && r.seeds === 0 && r.pending === null && r.words === 0 && r.bytes === false && r.cam === false;
  // keyboard: only while the device has focus
  await d.waitView('SSMainMenuView');
  await d.ev(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('ArrowRight'); await sleep(400);
  const a = (await d.state()).sel;
  await page.focus('#ssDevice'); await page.keyboard.press('ArrowRight'); await sleep(400);
  const b = (await d.state()).sel;
  t(a === 0 && b === 1, 'keyboard: the arrow keys do nothing without focus on the device, move the selection with focus (' + a + ' then ' + b + ')');
  await page.keyboard.press('Enter'); await sleep(1000);
  t(/^SS(SeedsMenu|LoadSeed)View$/.test((await d.state()).view), 'keyboard: Enter presses the joystick, Seeds opens (' + (await d.state()).view + ')');
  await page.keyboard.press('ArrowLeft'); await sleep(350); await page.keyboard.press(' '); await sleep(1000);
  t((await d.state()).view === 'SSMainMenuView', 'keyboard: Left then Space goes back to Home');
  const open = async () => { await page.evaluate(() => { showTab('check'); const b = document.getElementById('ssBox'); b.open = true; b.scrollIntoView(); }); await sleep(500); };
  const how = {
    'CLEAR ALL': () => d.ev(() => clearAll()),
    'closing the section': () => page.click('#ssBox > summary'),
    'the auto-clear': async () => { t(await d.ev(() => autoHasSecrets()) === true, 'auto-clear: the page knows the simulator holds a secret'); await d.ev(() => autoWipe('test')); },
    'END SESSION': () => d.ev(() => { window.endSessionReload = () => { window.__reloaded = true; }; return endSession(); }),
  };
  let first = true;
  for (const [name, act] of Object.entries(how)) {
    if (!first) await open(); first = false;
    const r0 = await d.loadByScan(); await keep();
    const before = await d.ev(() => SSController._instance.storage.seeds.length);
    t(before === 1 && r0.fp === fpOf(rootOf(ABANDON)), name + ': a seed is loaded first (' + r0.fp + ')');
    await act(); const r = await wiped();
    t(isWiped(r), name + ' clears the simulator: section closed, controller gone, screen black, no seeds, no words, seed bytes zeroed, camera off' + (isWiped(r) ? '' : ' ' + JSON.stringify(r)));
    if (name === 'END SESSION') t(await d.ev(() => window.__reloaded) === true, 'END SESSION reloads the page');
  }
};

// ================================================================ run
SCEN.tools.clock = true; SCEN.offline.online = true;
const order = ['dice12', 'dice24', 'words', 'settings', 'seedqr', 'tools', 'native', 'nested', 'taproot', 'wipe', 'offline'];
const want = process.env.SCEN ? process.env.SCEN.split(',') : order;
const results = [];
async function runScenario(browser, name) {
  const buf = []; const t = (c, m) => { buf.push([!!c, m]); };
  const t1 = Date.now(); let h;
  try {
    h = await openPage(browser, name, { offline: !SCEN[name].online, clock: !!SCEN[name].clock });
    if (name === 'tools') h.d.page_clock = async () => { await h.page.clock.fastForward(121000); };
    await SCEN[name](t, h.d, h.ctx, h.page);
  } catch (e) { buf.push([false, name + ': the scenario stopped: ' + String(e.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 400)]); }
  try { if (h) await h.ctx.close(); } catch (e) { /* closed */ }
  results.push({ name, buf, secs: Math.round((Date.now() - t1) / 1000) });
  for (const [c, m] of buf) ok(c, '[' + name + '] ' + m);
}
let browser;
try {
  browser = await pw.chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-video-capture=' + VIDEO] });
} catch (e) { console.log('SKIPPED chromium (not installed here: ' + String(e.message).split('\n')[0].slice(0, 80) + ')'); console.log('SIMULATOR: SKIPPED'); process.exit(0); }
const queue = want.filter((n) => SCEN[n]); const CONC = +(process.env.SIM_CONC || 8);
await Promise.all(Array.from({ length: Math.min(CONC, queue.length) }, async () => { while (queue.length) await runScenario(browser, queue.shift()); }));
await browser.close();
if (!process.env.SCEN) {
  ok(badges.size === 1 && [...badges][0] === 'SELF-TEST PASSED (140/140)', 'the page self-test passes 140/140 in every page opened (' + [...badges].join(' / ') + ')');
}
ok(pageProblems.length === 0, 'no page error and no console error in any page during the whole run' + (pageProblems.length ? ': ' + pageProblems.slice(0, 4).join(' || ') : ''));
console.log('(scenario times: ' + results.map((r) => r.name + ' ' + r.secs + 's').join(', ') + '; total ' + Math.round((Date.now() - T0) / 1000) + 's)');
console.log('SIMULATOR: ' + pass + ' pass, ' + fails.length + ' fail');
if (fails.length) { console.log('FAILED:'); for (const f of fails) console.log(' - ' + f); }
process.exit(fails.length ? 1 : 0);
