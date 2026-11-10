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
// Stage 2 (PSBTs, descriptors, address verification, sign message). The PSBTs are built here with @scure/btc-signer; the stand-in
// camera hands the scanner the QR text (SSDecodeQR.extract_qr_data is replaced), the signed PSBTs and messages are read off the screen:
//   psbt_p2wpkh / psbt_p2sh / psbt_p2tr
//               review (overview, math, recipient, change, OP_RETURN), sign, read the signed UR crypto-psbt from the screen QR(s) and
//               check it with btc-signer + noble (BIP-143 / BIP-341 sighash, signatures, btc-signer's own lowR signature, finalize);
//               the P2TR PSBT is fed as an animated UR with part 1 missed (finished from fountain-mixed parts)
//   psbt_msig   2-of-3 P2WSH: change unverified, scan the wallet descriptor, change verified, sign, a cosigner signs with btc-signer, finalize
//   psbt_msig_bad  a descriptor of other cosigners: "Address Verification Failed", the transaction is discarded
//   addr_single / addr_taproot / addr_multi
//               address verification: native receive #3, nested change #2, taproot receive #12, multisig receive #7 (descriptor scan)
//   signmsg     message signing off, then on in Settings; P2WPKH, P2PKH (two pages) and P2SH-P2WPKH messages checked as
//               "Bitcoin Signed Message" signatures by public key recovery (noble)
//   psbt_wipe   CLEAR ALL in the middle of a PSBT flow overwrites the PSBT, signatures, signing key and descriptor keys
//   review      two quick taps count twice and a held key repeats; regtest bcrt1 addresses in the Address Explorer (from an
//               xpub); a "bitcoin:" QR with no address goes Home; tr() with a script tree is "Not Yet Implemented"
// v2.14.0, Learn on the practice signer (lessons and a practice transaction next to the device; nothing on its screen):
//   lessons_dice / lessons_seed / lessons_tx (sign, then multisig)
//               the six lessons, driven only with the device keys (and the page buttons a lesson asks for): every step moves on
//               when the device reaches the expected screen; BACK, NEXT and RESTART LESSON; the dice words, the verified address,
//               the signed message (noble) and the multisig signature checked here
//   practice_tx PRACTICE TRANSACTION on Testnet: made-up coins (null outpoint, marked as practice), keys, payee and change from
//               @scure/bip32; signed on the device, read from its screen (jsqr) and verified with btc-signer + noble; CLEAR ALL wipes it
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

// ================================================================ stage 2: PSBTs, descriptors, address verification, sign message
// The test PSBTs are built here with @scure/btc-signer (mainnet; nothing is committed as a binary). Every expected value comes from
// btc-signer / @scure/bip32 / @noble/curves, never from the page. The stand-in for the camera's QR reading is a replacement of
// SSDecodeQR.extract_qr_data (the camera is Chromium's fake one, which plays one SeedQR only): it hands the scanner the QR text of
// each frame, as a read QR would. What the device shows is read back from its screen (the QR with jsqr, the amounts from its screens).
const { secp256k1, schnorr } = require('@noble/curves/secp256k1');
const { UREncoder, URDecoder } = require('@ngraveio/bc-ur');
const { CryptoPSBT } = require('@keystonehq/bc-ur-registry');
const HARD = 0x80000000;
const pathIdx = (s) => s.split('/').slice(1).map((x) => x.endsWith("'") ? parseInt(x) + HARD : parseInt(x));
const hx = (b) => Buffer.from(b).toString('hex');
const b64b = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
const MN2 = {
  A: ABANDON, B: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
  C: 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above', D: 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
};
const R2 = Object.fromEntries(Object.entries(MN2).map(([k, m]) => [k, rootOf(m)]));
const FPA = fpOf(R2.A);
const EXT1 = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', EXT2 = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';   // outside addresses (BIP-173 / BIP-13 examples)
const txid2 = (n) => Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + n * 13) & 255);
const deriv = (root, p) => ({ fingerprint: root.fingerprint, path: pathIdx(p) });
function buildStage2() {
  const A = R2.A, out = {};
  // 1. P2WPKH: two inputs (150,000 + 200,000), a recipient (120,000), change (228,000), an OP_RETURN "hello world"; fee 2,000
  {
    const tx = new btc.Transaction({ allowUnknownOutputs: true });
    for (const [i, p] of [[0, "m/84'/0'/0'/0/0"], [1, "m/84'/0'/0'/0/1"]]) {
      const k = A.derive(p);
      tx.addInput({ txid: txid2(i + 1), index: i, witnessUtxo: { script: btc.p2wpkh(k.publicKey).script, amount: 150000n + BigInt(i) * 50000n }, bip32Derivation: [[k.publicKey, deriv(A, p)]] });
    }
    tx.addOutputAddress(EXT1, 120000n);
    const ck = A.derive("m/84'/0'/0'/1/0");
    tx.addOutput({ script: btc.p2wpkh(ck.publicKey).script, amount: 228000n, bip32Derivation: [[ck.publicKey, deriv(A, "m/84'/0'/0'/1/0")]] });
    tx.addOutput({ script: Uint8Array.from([0x6a, 0x4c, 11, ...Buffer.from('hello world')]), amount: 0n });
    out.p2wpkh = { b64: Buffer.from(tx.toPSBT(0)).toString('base64'), keys: ["m/84'/0'/0'/0/0", "m/84'/0'/0'/0/1"], inputs: 2, inSum: 350000, dests: [[EXT1, 120000]], change: [btc.p2wpkh(ck.publicKey).address, 228000, 0, true], fee: 2000, opReturn: 'hello world' };
  }
  // 2. P2SH-P2WPKH: one input (2,500,000), a recipient (1,000,000), change at /1/3 (1,499,000); fee 1,000
  {
    const tx = new btc.Transaction(), p = "m/49'/0'/0'/0/0", k = A.derive(p), pay = btc.p2sh(btc.p2wpkh(k.publicKey));
    tx.addInput({ txid: txid2(3), index: 0, witnessUtxo: { script: pay.script, amount: 2500000n }, redeemScript: pay.redeemScript, bip32Derivation: [[k.publicKey, deriv(A, p)]] });
    tx.addOutputAddress(EXT2, 1000000n);
    const cp = "m/49'/0'/0'/1/3", ck = A.derive(cp), cpay = btc.p2sh(btc.p2wpkh(ck.publicKey));
    tx.addOutput({ script: cpay.script, amount: 1499000n, redeemScript: cpay.redeemScript, bip32Derivation: [[ck.publicKey, deriv(A, cp)]] });
    out.p2sh_p2wpkh = { b64: Buffer.from(tx.toPSBT(0)).toString('base64'), keys: [p], inputs: 1, inSum: 2500000, dests: [[EXT2, 1000000]], change: [cpay.address, 1499000, 3, true], fee: 1000, opReturn: null };
  }
  // 3. P2TR key path: one input (300,000), a recipient (100,000), change (199,000); fee 1,000
  {
    const tx = new btc.Transaction(), p = "m/86'/0'/0'/0/0", k = A.derive(p), x = k.publicKey.slice(1);
    tx.addInput({ txid: txid2(4), index: 1, witnessUtxo: { script: btc.p2tr(x).script, amount: 300000n }, tapInternalKey: x, tapBip32Derivation: [[x, { hashes: [], der: deriv(A, p) }]] });
    tx.addOutputAddress(EXT1, 100000n);
    const cp = "m/86'/0'/0'/1/0", ck = A.derive(cp), cx = ck.publicKey.slice(1);
    tx.addOutput({ script: btc.p2tr(cx).script, amount: 199000n, tapInternalKey: cx, tapBip32Derivation: [[cx, { hashes: [], der: deriv(A, cp) }]] });
    out.p2tr = { b64: Buffer.from(tx.toPSBT(0)).toString('base64'), keys: [p], inputs: 1, inSum: 300000, dests: [[EXT1, 100000]], change: [btc.p2tr(cx).address, 199000, 0, true], fee: 1000, opReturn: null };
  }
  // 4. 2-of-3 P2WSH sortedmulti (A, B, C at m/48'/0'/0'/2'): one input (5,000,000) at /0/5, a recipient (3,000,000), change at /1/2 (1,998,000); fee 2,000
  {
    const acct = "m/48'/0'/0'/2'", names = ['A', 'B', 'C'], accts = Object.fromEntries(names.map((n) => [n, R2[n].derive(acct)]));
    const ms = (branch, idx, set = names, hd = accts) => {
      const ks = set.map((n) => ({ n, pub: hd[n].deriveChild(branch).deriveChild(idx).publicKey }));
      const sorted = ks.slice().sort((a, b) => Buffer.compare(Buffer.from(a.pub), Buffer.from(b.pub)));
      return { pay: btc.p2wsh(btc.p2ms(2, sorted.map((x) => x.pub))), ders: ks.map((x) => [x.pub, deriv(R2[x.n], acct + '/' + branch + '/' + idx)]) };
    };
    const tx = new btc.Transaction(), i0 = ms(0, 5);
    tx.addInput({ txid: txid2(5), index: 0, witnessUtxo: { script: i0.pay.script, amount: 5000000n }, witnessScript: i0.pay.witnessScript, bip32Derivation: i0.ders });
    tx.addOutputAddress(EXT1, 3000000n);
    const c0 = ms(1, 2);
    tx.addOutput({ script: c0.pay.script, amount: 1998000n, witnessScript: c0.pay.witnessScript, bip32Derivation: c0.ders });
    tx.global.xpub = names.map((n) => { const a = accts[n]; return [{ version: 0x0488b21e, depth: a.depth, parentFingerprint: a.parentFingerprint, childNumber: a.index, chainCode: a.chainCode, publicKey: a.publicKey }, { fingerprint: R2[n].fingerprint, path: pathIdx(acct) }]; });
    const desc = (set, hd) => 'wsh(sortedmulti(2,' + set.map((n) => '[' + fpOf(R2[n]) + '/48h/0h/0h/2h]' + hd[n].publicExtendedKey + '/0/*').join(',') + '))';
    const accD = { ...accts, D: R2.D.derive(acct) };
    out.p2wsh_2of3 = { b64: Buffer.from(tx.toPSBT(0)).toString('base64'), keys: [acct + '/0/5'], inputs: 1, inSum: 5000000, dests: [[EXT1, 3000000]], change: [c0.pay.address, 1998000, 2, true], fee: 2000, opReturn: null,
      descriptor: desc(names, accts), badDescriptor: desc(['A', 'B', 'D'], accD), fps: names.map((n) => fpOf(R2[n])), receive7: ms(0, 7).pay.address, receive0: ms(0, 0).pay.address };
  }
  return out;
}
const S2 = buildStage2();

// What the device is fed (a base64 PSBT as one QR, or an animated UR crypto-psbt) and how a QR it shows is read back
const urParts = (rawBytes, maxFrag) => { const e = new UREncoder(new CryptoPSBT(Buffer.from(rawBytes)).toUR(), maxFrag, 0, 10), p = []; for (let i = 0; i < e.fragmentsLength; i++) p.push(e.nextPart().toUpperCase()); return p; };
async function feedQR(page, frames) {
  await page.evaluate((frames) => {
    window.__ssQ = frames.slice();
    SSDecodeQR.extract_qr_data = function (image, is_binary) { const s = window.__ssQ.shift(); if (s === undefined) return null; return is_binary ? new TextEncoder().encode(s) : s; };
  }, frames);
}
async function scanFrames(d, page, frames, from = /^Scan$/) { await feedQR(page, frames); if (from) await d.pick(from, { wait: 600 }); }
async function startCapture(page) {   // keeps every different picture the screen shows, so an animated QR can be read part by part
  await page.evaluate(() => {
    window.__frames = []; let last = -1; clearInterval(window.__capTimer);
    window.__capTimer = setInterval(() => {
      const c = document.getElementById('ssScreen'), g = c.getContext('2d'), im = g.getImageData(0, 0, c.width, c.height), a = im.data; let h = 2166136261;
      for (let i = 0; i < a.length; i += 11) h = Math.imul(h ^ a[i], 16777619) >>> 0;
      if (h === last) return; last = h;
      let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192));
      window.__frames.push({ w: c.width, h: c.height, b64: btoa(s) });
    }, 25);
  });
}
async function readUR(page, ms = 60000) {   // the animated UR on the screen -> the bytes of the crypto-psbt, and the number of parts
  await startCapture(page);
  const dec = new URDecoder(), seen = new Set(); let from = 0; const t0 = Date.now();
  while (Date.now() - t0 < ms && !dec.isComplete()) {
    const fr = await page.evaluate((f) => window.__frames.slice(f), from); from += fr.length;
    for (const f of fr) { const q = jsQR(new Uint8ClampedArray(Buffer.from(f.b64, 'base64')), f.w, f.h); if (q && /^ur:/i.test(q.data)) { seen.add(q.data.toLowerCase()); try { dec.receivePart(q.data.toLowerCase()); } catch (e) { /* a part of another UR */ } } }
    if (!dec.isComplete()) await sleep(150);
  }
  await page.evaluate(() => clearInterval(window.__capTimer));
  if (!dec.isComplete() || !dec.isSuccess()) return null;
  return { bytes: new Uint8Array(CryptoPSBT.fromCBOR(dec.resultUR().cbor).getPSBT()), parts: seen.size, type: dec.resultUR().type };
}

// The signatures the device made, checked with btc-signer (signature hashes, own signatures) and @noble/curves, as in tests/sigcheck.test.mjs
function checkSigned(t, tag, name, signedBytes) {
  const P = S2[name], orig = btc.Transaction.fromPSBT(b64b(P.b64), { allowUnknownOutputs: true }), ref = btc.Transaction.fromPSBT(b64b(P.b64), { lowR: true, allowUnknownOutputs: true });
  const signed = btc.Transaction.fromPSBT(signedBytes, { allowUnknownOutputs: true });
  const verdict = { sigs: 0, ecdsa: true, same: true, hash: true, low: true, key: true, schnorr: true, one: true };
  for (let i = 0; i < orig.inputsLength; i++) {
    const inp = orig.getInput(i), s = signed.getInput(i), spk = inp.witnessUtxo.script, amount = inp.witnessUtxo.amount, type = btc.OutScript.decode(spk).type;
    if (type === 'tr') {
      const w = s.finalScriptWitness; verdict.one = verdict.one && !!w && w.length === 1 && w[0].length === 64; if (!verdict.one) continue;
      const amounts = [], scripts = [];
      for (let j = 0; j < orig.inputsLength; j++) { amounts.push(orig.getInput(j).witnessUtxo.amount); scripts.push(orig.getInput(j).witnessUtxo.script); }
      const h = orig.preimageWitnessV1(i, scripts, btc.SigHash.DEFAULT, amounts);
      verdict.schnorr = verdict.schnorr && schnorr.verify(w[0], h, spk.slice(2)); verdict.sigs++;   // BIP-340 against the output key (tweaked), SIGHASH_DEFAULT
    } else {
      const ps = s.partialSig || []; verdict.one = verdict.one && ps.length === 1; if (!verdict.one) continue;
      const [pub, sig] = ps[0]; verdict.hash = verdict.hash && sig[sig.length - 1] === btc.SigHash.ALL;
      let scriptCode;
      if (type === 'wpkh') scriptCode = btc.OutScript.encode({ type: 'pkh', hash: spk.slice(2) });
      else if (type === 'sh') scriptCode = btc.OutScript.encode({ type: 'pkh', hash: inp.redeemScript.slice(2) });
      else scriptCode = inp.witnessScript;
      const h = orig.preimageWitnessV0(i, scriptCode, btc.SigHash.ALL, amount), der = sig.slice(0, -1);
      verdict.ecdsa = verdict.ecdsa && secp256k1.verify(der, h, pub, { prehash: false, format: 'der', lowS: true }); verdict.low = verdict.low && der.length <= 70;
      const k = R2.A.derive(P.keys[i]); verdict.key = verdict.key && hx(k.publicKey) === hx(pub);
      ref.signIdx(k.privateKey, i); const rs = ref.getInput(i).partialSig.find((x) => hx(x[0]) === hx(pub));
      verdict.same = verdict.same && !!rs && hx(rs[1]) === hx(sig); verdict.sigs++;
    }
  }
  const type = name === 'p2tr' ? 'tr' : 'ecdsa';
  t(verdict.one && verdict.sigs === orig.inputsLength, tag + ': the signed PSBT holds one signature for each of its ' + orig.inputsLength + ' input(s)');
  if (type === 'tr') t(verdict.schnorr, tag + ': the BIP-340 signature verifies against the output key (sighash from btc-signer, SIGHASH_DEFAULT, noble verify)');
  else {
    t(verdict.hash && verdict.ecdsa, tag + ': each ECDSA signature verifies for its input with the BIP-143 sighash from btc-signer (SIGHASH_ALL, noble verify, low S)');
    t(verdict.low && verdict.key && verdict.same, tag + ': each is low R, made with the key at ' + P.keys[0] + (P.keys.length > 1 ? ' ...' : '') + ', and equals btc-signer\'s own signature byte for byte');
  }
  // merge into the original PSBT (a Taproot input comes back final: its witness goes in as the key-path signature), finalize, extract
  const fin = btc.Transaction.fromPSBT(b64b(P.b64), { allowUnknownOutputs: true });
  if (type === 'tr') fin.updateInput(0, { tapKeySig: signed.getInput(0).finalScriptWitness[0] }); else fin.combine(signed);
  if (name === 'p2wsh_2of3') fin.signIdx(R2.B.derive("m/48'/0'/0'/2'/0/5").privateKey, 0);   // the second cosigner, signed with btc-signer
  let raw = null, err = '';
  try { fin.finalize(); raw = fin.extract(); } catch (e) { err = ' (' + e.message + ')'; }
  const back = raw && btc.Transaction.fromRaw(raw, { allowUnknownOutputs: true });
  t(!!raw && back.outputsLength === orig.outputsLength && back.getOutput(0).amount === orig.getOutput(0).amount, tag + ': btc-signer finalizes' + (name === 'p2wsh_2of3' ? ' (with a second signature it made for cosigner B)' : '') + ' and extracts the transaction' + (raw ? ' (' + raw.length + ' bytes)' : err));
}

// The screens of a PSBT review, read from the device
const amountOf = (s) => { s = String(s).replace(/[,\s]/g, ''); return s.includes('.') ? Math.round(parseFloat(s) * 1e8) : +s; };
const screenFields = (d, names) => d.ev((names) => { const s = SSController._instance.current_destination.view.screen, o = {}; for (const n of names) { const v = s[n]; o[n] = v instanceof Uint8Array ? Array.from(v) : v; } return o; }, names);
async function toHome(d) { await d.back('SSMainMenuView'); }
async function psbtToOverview(t, d, page, tag, name, frames) {
  await toHome(d);
  await scanFrames(d, page, frames);
  let s = await d.waitView('SSPSBTSelectSeedView', 40000);
  t(/Select Signer/.test(s.title) && s.labels.includes(FPA), tag + ': the scan is read as a PSBT and the device asks which seed signs (' + s.labels[0] + ')');
  await d.pick(new RegExp(FPA), { wait: 1500 });
  return d.waitView('SSPSBTOverviewScreen', 60000);
}
async function psbtReview(t, d, page, tag, name, o = {}) {
  const P = S2[name], spend = P.dests.reduce((a, x) => a + x[1], 0);
  await sleep(500);
  let f = await screenFields(d, ['spend_amount', 'change_amount', 'fee_amount', 'num_inputs', 'num_change_outputs', 'num_self_transfer_outputs', 'destination_addresses', 'has_op_return']);
  t(f.spend_amount === spend && f.change_amount === P.change[1] && f.fee_amount === P.fee && f.num_inputs === P.inputs && f.num_change_outputs === 1 && f.num_self_transfer_outputs === 0 && f.has_op_return === !!P.opReturn && JSON.stringify(f.destination_addresses) === JSON.stringify(P.dests.map((x) => x[0])),
    tag + ': overview shows ' + P.inputs + ' input(s), sending ' + spend + ' sats to ' + P.dests[0][0].slice(0, 10) + '..., change ' + P.change[1] + ', fee ' + P.fee + (P.opReturn ? ', an OP_RETURN' : '') + (f.spend_amount === spend && f.change_amount === P.change[1] && f.fee_amount === P.fee ? '' : ' (shows ' + JSON.stringify(f) + ')'));
  await d.press('PRESS', 900);
  let s = await d.waitView('SSPSBTMathScreen'); f = await screenFields(d, ['input_amount', 'spend_amount', 'fee_amount', 'change_amount']);
  const m = [f.input_amount, f.spend_amount, f.fee_amount, f.change_amount].map(amountOf);
  t(m[0] === P.inSum && m[1] === spend && m[2] === P.fee && m[3] === P.change[1] && m[0] - m[1] - m[2] === m[3], tag + ': the transaction math reads ' + P.inSum + ' - ' + spend + ' - ' + P.fee + ' = ' + P.change[1] + ' (shows ' + m.join(', ') + ')');
  await d.press('PRESS', 900);
  for (let i = 0; i < P.dests.length; i++) {
    s = await d.waitView('SSPSBTAddressDetailsScreen'); f = await screenFields(d, ['address', 'amount']);
    t(f.address === P.dests[i][0] && f.amount === P.dests[i][1], tag + ': "Will Send" shows ' + P.dests[i][1] + ' sats to ' + P.dests[i][0] + (f.address === P.dests[i][0] ? '' : ' (shows ' + f.address + ' ' + f.amount + ')'));
    await d.press('PRESS', 1500);
  }
  s = await d.waitView('SSPSBTChangeDetailsScreen', 40000);
  return { P, s };
}
async function changeChecks(t, d, tag, name, verified) {
  const P = S2[name], f = await screenFields(d, ['amount', 'address', 'is_multisig', 'derivation_path_addr_index', 'is_change_derivation_path', 'is_change_addr_verified']), s = await d.state();
  t(f.amount === P.change[1] && f.address === P.change[0] && f.derivation_path_addr_index === P.change[2] && f.is_change_derivation_path === P.change[3] && f.is_multisig === (name === 'p2wsh_2of3'),
    tag + ': "Your Change" shows ' + P.change[1] + ' sats to ' + P.change[0].slice(0, 12) + '... as change address #' + P.change[2] + (f.address === P.change[0] ? '' : ' (shows ' + JSON.stringify(f) + ')'));
  t(f.is_change_addr_verified === verified && (verified ? /^Next$/.test((s.labels || [])[0]) && (s.labels || []).length === 1 : /Verify multisig change/.test((s.labels || [])[0])),
    tag + ': the change is ' + (verified ? 'shown as verified' : 'unverified, the device offers "Verify multisig change" and "Skip verification"') + ' (' + (s.labels || []).join(' | ') + ')');
}
async function psbtSign(t, d, page, tag, name) {
  await d.waitView('SSPSBTFinalizeView'); await d.press('PRESS', 2500);
  await d.waitView('SSPSBTSignedQRDisplayView', 60000); await sleep(600);
  const r = await readUR(page);
  t(!!r && r.type === 'crypto-psbt', tag + ': the device shows the signed PSBT as a UR crypto-psbt QR (' + (r ? r.parts + ' part(s)' : 'none read') + ', read with jsqr)');
  if (r) checkSigned(t, tag, name, r.bytes); else t(false, tag + ': no signed PSBT to check');
  return r;
}
async function psbtFlow(t, d, page, name, frames, o = {}) {
  const tag = name + (o.label ? ' ' + o.label : '');
  await d.loadByScan();
  await psbtToOverview(t, d, page, tag, name, frames);
  const { s } = await psbtReview(t, d, page, tag, name);
  const P = S2[name];
  await changeChecks(t, d, tag, name, true);
  await d.press('PRESS', 900);
  if (P.opReturn) {
    await d.waitView('SSPSBTOpReturnScreen'); const f = await screenFields(d, ['op_return_data']);
    t(Buffer.from(f.op_return_data).toString() === P.opReturn, tag + ': the OP_RETURN screen shows the data "' + P.opReturn + '"');
    await d.press('PRESS', 900);
  }
  await psbtSign(t, d, page, tag, name);
  await d.press('PRESS', 1200); const e = await d.waitView('SSMainMenuView');
  t(await d.ev(() => SSController._instance.psbt === null && SSController._instance.psbt_parser === null), tag + ': after the signed QR the PSBT and its parser are cleared from the device');
}
SCEN.psbt_p2wpkh = (t, d, ctx, page) => psbtFlow(t, d, page, 'p2wpkh', [S2.p2wpkh.b64]);
SCEN.psbt_p2sh = (t, d, ctx, page) => psbtFlow(t, d, page, 'p2sh_p2wpkh', [S2.p2sh_p2wpkh.b64]);
// The P2TR PSBT comes as a real wallet's animation does when the camera starts late: part 1 and every other pure part are
// missed, so the scan can only finish by solving the fountain-mixed parts that follow (bc-ur's encoder makes them)
const urFountainParts = (rawBytes, maxFrag) => {
  const e = new UREncoder(new CryptoPSBT(Buffer.from(rawBytes)).toUR(), maxFrag, 0, 10), n = e.fragmentsLength, p = [];
  for (let i = 0; i < 4 * n + 10; i++) { const x = e.nextPart().toUpperCase(); if (i >= n || i % 2 === 1) p.push(x); }
  return p;
};
SCEN.psbt_p2tr = (t, d, ctx, page) => psbtFlow(t, d, page, 'p2tr', urFountainParts(b64b(S2.p2tr.b64), 60), { label: '(animated UR in, part 1 missed: read from fountain-mixed parts)' });

// ---- 2-of-3 P2WSH: the change is unverified until the wallet descriptor is scanned; then it is checked against the descriptor
async function loadDescriptor(t, d, page, tag, text, o = {}) {
  await d.waitView('SSLoadMultisigWalletDescriptorView'); let s = await d.state();
  t(/Multisig Verification/.test(s.title) && /Scan descriptor/.test(s.labels[0]), tag + ': "Verify multisig change" asks to scan the wallet descriptor (' + s.title + ': ' + s.labels.join(' | ') + ')');
  await scanFrames(d, page, [text], /Scan descriptor/);
  s = await d.waitView('SSMultisigWalletDescriptorView', 40000); await sleep(500);
  const f = await screenFields(d, ['policy', 'fingerprints']), want = o.fps || S2.p2wsh_2of3.fps;
  t(f.policy === '2 of 3' && JSON.stringify(f.fingerprints) === JSON.stringify(want), tag + ': the scanned descriptor loads as policy "2 of 3" with the cosigner fingerprints ' + want.join(', ') + ' (shows ' + f.policy + ' ' + (f.fingerprints || []).join(', ') + ')');
  return s;
}
SCEN.psbt_msig = async (t, d, ctx, page) => {
  const name = 'p2wsh_2of3', P = S2[name], tag = '2-of-3 P2WSH';
  await d.loadByScan(); await psbtToOverview(t, d, page, tag, name, [P.b64]);
  await psbtReview(t, d, page, tag, name);
  await changeChecks(t, d, tag, name, false);
  await d.pick(/Verify multisig change/, { wait: 1000 });
  const s = await loadDescriptor(t, d, page, tag, P.descriptor);
  t(/Return to transaction/.test(s.labels[0]), tag + ': the descriptor screen offers "Return to transaction"');
  await d.press('PRESS', 1500);
  await d.waitView('SSPSBTChangeDetailsScreen', 40000); await sleep(400);
  await changeChecks(t, d, tag + ' with the descriptor', name, true);
  await d.press('PRESS', 900);
  await psbtSign(t, d, page, tag, name);
  await d.press('PRESS', 1200); await d.waitView('SSMainMenuView');
};
SCEN.psbt_msig_bad = async (t, d, ctx, page) => {   // a descriptor of other cosigners (A, B, D) does not own the change: the transaction is flagged and discarded
  const name = 'p2wsh_2of3', P = S2[name], tag = '2-of-3 P2WSH, wrong descriptor';
  await d.loadByScan(); await psbtToOverview(t, d, page, tag, name, [P.b64]);
  await psbtReview(t, d, page, tag, name);
  await d.pick(/Verify multisig change/, { wait: 1000 });
  await loadDescriptor(t, d, page, tag, P.badDescriptor, { fps: [FPA, fpOf(R2.B), fpOf(R2.D)] });
  await d.press('PRESS', 1500);
  const s = await d.waitView('SSPSBTAddressVerificationFailedView', 40000); await sleep(500);
  const st = await d.state();
  t(/Suspicious Transaction/.test(st.title) && /Address Verification Failed/.test(st.headline) && /change address could not be verified from wallet descriptor/.test(st.text) && /Discard transaction/.test(st.labels[0]), tag + ': "Address Verification Failed" warns that the change could not be verified from the wallet descriptor (' + st.headline + ')');
  await d.press('PRESS', 1200); await d.waitView('SSMainMenuView');
  t(await d.ev(() => SSController._instance.psbt === null && SSController._instance.multisig_wallet_descriptor === null), tag + ': discarding clears the PSBT and the descriptor');
};

// ---- address verification: an address scanned from a QR code is found among the seed's (or the descriptor's) addresses
async function verifyDone(d, ms = 90000) {   // waits for the success screen of the address verification
  const t0 = Date.now(); let s;
  while (Date.now() - t0 < ms) { s = await d.state(); if (s && s.view === 'SSSeedAddressVerificationSuccessView') { await sleep(500); return screenFields(d, ['address', 'verified_index', 'verified_index_is_change']); } await sleep(300); }
  throw new Error('address verification did not finish, at ' + JSON.stringify(s));
}
async function verifySingle(t, d, page, tag, addr, idx, change, o = {}) {
  await toHome(d);
  await scanFrames(d, page, [(o.uri || '') + addr]);
  let s = await d.state();
  if (o.sigType) {   // a 3... address is a nested segwit or a multisig one: the device cannot tell and asks
    s = await d.waitView('SSAddressVerificationSigTypeView', 40000);
    t(/can't be auto-detected/.test(s.text) && s.labels.join('|') === 'Single Sig|Multisig', tag + ': the device cannot tell the signature type of a 3... address and asks (' + s.labels.join(' | ') + ')');
    await d.pick(/Single Sig/, { wait: 900 });
  }
  s = await d.waitView('SSSeedSelectSeedView', 40000);
  t(/Verify Address/.test(s.title) && s.labels[0] === FPA, tag + ': the scanned address asks which seed to verify it with');
  await d.pick(new RegExp(FPA), { wait: 800 });
  const f = await verifyDone(d);
  t(f.address === addr && f.verified_index === idx && f.verified_index_is_change === change, tag + ': "Address Verified": ' + addr.slice(0, 12) + '... is ' + (change ? 'change' : 'receive') + ' address #' + idx + ' of the seed (device says #' + f.verified_index + (f.verified_index_is_change ? ' change' : ' receive') + ')');
  await d.press('PRESS', 1000); await d.waitView('SSMainMenuView');
}
SCEN.addr_single = async (t, d, ctx, page) => {   // single sig: addresses made here by @scure/btc-signer from the seed
  await d.loadByScan();
  await verifySingle(t, d, page, 'native receive #3', addrOf(ABANDON, '', 'native', 0, 3), 3, false, { uri: 'bitcoin:' });
  await verifySingle(t, d, page, 'nested change #2', addrOf(ABANDON, '', 'nested', 1, 2), 2, true, { sigType: true });
};
SCEN.addr_taproot = async (t, d, ctx, page) => {
  await d.loadByScan();
  await verifySingle(t, d, page, 'taproot receive #12', addrOf(ABANDON, '', 'taproot', 0, 12), 12, false);
};
SCEN.addr_multi = async (t, d, ctx, page) => {   // multisig: the address is #7 of the 2-of-3 descriptor
  const P = S2.p2wsh_2of3, tag = 'multisig address #7';
  await d.loadByScan(); await toHome(d);
  await scanFrames(d, page, [P.receive7]);
  await loadDescriptor(t, d, page, tag, P.descriptor);
  const st = await d.state();
  t(st.labels[0] === 'Verify addr ' + P.receive7.slice(0, 7), tag + ': the descriptor screen offers "Verify addr ' + P.receive7.slice(0, 7) + '" (' + st.labels[0] + ')');
  await d.press('PRESS', 800);
  const f = await verifyDone(d);
  t(f.address === P.receive7 && f.verified_index === 7 && f.verified_index_is_change === false, tag + ': "Address Verified": ' + P.receive7.slice(0, 12) + '... is receive address #7 of the 2-of-3 wallet, made by btc-signer (device says #' + f.verified_index + ')');
  await d.press('PRESS', 1000); await d.waitView('SSMainMenuView');
};

// ---- sign message: a scanned "signmessage" request; the signature is checked as a "Bitcoin Signed Message" (noble secp256k1, independent of the page)
const varStr = (b) => { const n = b.length, h = n < 253 ? Buffer.from([n]) : Buffer.from([253, n & 255, n >> 8]); return Buffer.concat([h, b]); };
const msgHash = (msg) => sha256(sha256(Buffer.concat([varStr(Buffer.from('Bitcoin Signed Message:\n')), varStr(Buffer.from(msg, 'utf8'))])));
function checkMessageSig(sigB64, msg, wantPub, kind) {   // the classic format: base64 of header + r + s, header = 27 + recovery id (+ 4 for a compressed key)
  const sig = Buffer.from(sigB64, 'base64'); if (sig.length !== 65 || sig[0] < 27 || sig[0] > 34) return { ok: false, why: 'not a 65-byte signature with a header 27..34' };
  const rec = (sig[0] - 27) & 3, comp = sig[0] >= 31, rs = sig.subarray(1), h = msgHash(msg);
  const pub = secp256k1.Signature.fromCompact(rs).addRecoveryBit(rec).recoverPublicKey(h).toRawBytes(comp);
  const good = secp256k1.verify(rs, h, pub, { prehash: false }) && hx(pub) === hx(wantPub);
  const addr = kind === 'p2pkh' ? btc.p2pkh(pub).address : kind === 'p2sh' ? btc.p2sh(btc.p2wpkh(pub)).address : btc.p2wpkh(pub).address;
  return { ok: good && comp, pub, addr, header: sig[0] };
}
SCEN.signmsg = async (t, d, ctx, page) => {
  await d.loadByScan(); await toHome(d);
  const cases = [
    { path: "m/84'/0'/0'/0/0", kind: 'p2wpkh', msg: 'hello world' },
    { path: "m/44'/0'/0'/0/3", kind: 'p2pkh', msg: 'The quick brown fox jumps over the lazy dog. '.repeat(6).trim() },
    { path: "m/49'/0'/0'/1/1", kind: 'p2sh', msg: 'Signed with SeedSigner+ practice simulator: 0123456789' },
  ];
  // Message signing is off until Settings > Advanced > Message signing is set to Enabled: the request is refused first
  await scanFrames(d, page, ['signmessage ' + cases[0].path.replace(/'/g, 'h') + ' ascii:' + cases[0].msg]);
  let s = await sleepUntil(d, (x) => x.view !== 'SSMainMenuView', 20000);
  t(s && s.view === 'SSOptionDisabledView', 'message signing disabled: a signmessage request is refused, no seed is asked for (' + (s && s.view) + ')');
  await toHome(d);
  await d.pick(/^Settings$/, { wait: 700 }); await d.pick(/^Advanced$/, { wait: 700 }); await d.pick(/^Message signing$/, { wait: 700 }); await d.pick(/^Enabled$/, { wait: 900 });
  await toHome(d);
  t(await d.ev(() => SSSettings.get_instance().get_value('message_signing')) === 'E', 'Settings > Advanced > Message signing > Enabled turns it on');
  for (const c of cases) {
    const tag = 'sign message ' + c.kind + ' ' + c.path, k = R2.A.derive(c.path), addr = c.kind === 'p2pkh' ? btc.p2pkh(k.publicKey).address : c.kind === 'p2sh' ? btc.p2sh(btc.p2wpkh(k.publicKey)).address : btc.p2wpkh(k.publicKey).address;
    await toHome(d);
    await scanFrames(d, page, ['signmessage ' + c.path.replace(/'/g, 'h') + ' ascii:' + c.msg]);
    s = await d.waitView('SSSeedSelectSeedView', 30000);
    t(/Sign Message/.test(s.title), tag + ': the request asks which seed signs');
    await d.pick(new RegExp(FPA), { wait: 1000 });
    let pages = 0;
    for (let n = 0; n < 12; n++) { s = await d.state(); if (s.view === 'SSSeedSignMessageConfirmMessageView') { pages++; await d.press('PRESS', 900); } else break; }
    t(pages >= 1 && (c.msg.length < 60 || pages > 1) && await d.ev(() => SSController._instance.sign_message_data.message) === c.msg, tag + ': the device shows the message in ' + pages + ' page(s) (' + c.msg.length + ' characters)');
    s = await d.waitView('SSSeedSignMessageConfirmAddressView', 20000); await sleep(800);
    const f = await screenFields(d, ['derivation_path', 'address']);
    t(f.address === addr && f.derivation_path.replace(/h/g, "'") === c.path, tag + ': "Confirm Address" shows ' + addr + ' (' + c.path + ')' + (f.address === addr ? '' : ' (shows ' + f.address + ')'));
    await d.press('PRESS', 2000);
    await d.waitView('SSSeedSignMessageSignedMessageQRView', 30000); await sleep(1000);
    const q = await d.readQR();
    const r = q ? checkMessageSig(q.text, c.msg, k.publicKey, c.kind) : { ok: false, why: 'no QR' };
    t(r.ok, tag + ': the QR is a valid "Bitcoin Signed Message" signature (noble: recovers the key at ' + c.path + ', verifies, compressed header ' + r.header + ')' + (r.ok ? '' : ' ' + (r.why || '')));
    t(r.addr === addr, tag + ': the key recovered from the signature is the key of ' + addr);
    await d.press('PRESS', 1200); await d.waitView('SSMainMenuView');
  }
};
async function sleepUntil(d, f, ms) { const t0 = Date.now(); let s; while (Date.now() - t0 < ms) { s = await d.state(); if (s && f(s)) { await sleep(300); return d.state(); } await sleep(250); } return s; }

// ---- wipe in the middle of a PSBT flow: after signing (signatures held), with the descriptor loaded
SCEN.psbt_wipe = async (t, d, ctx, page) => {
  const name = 'p2wsh_2of3', P = S2[name], tag = 'wipe in a PSBT flow';
  await d.loadByScan(); await psbtToOverview(t, d, page, tag, name, [P.b64]);
  await psbtReview(t, d, page, tag, name);
  await d.pick(/Verify multisig change/, { wait: 1000 });
  await loadDescriptor(t, d, page, tag, P.descriptor);
  await d.press('PRESS', 1500); await d.waitView('SSPSBTChangeDetailsScreen', 40000);
  await d.press('PRESS', 900); await d.waitView('SSPSBTFinalizeView'); await d.press('PRESS', 2500);
  await d.waitView('SSPSBTSignedQRDisplayView', 60000); await sleep(800);
  const held = await d.ev(() => {
    const c = SSController._instance, p = c.psbt, parser = c.psbt_parser, desc = c.multisig_wallet_descriptor, o = parser.psbt.inputs[0];
    const keys = desc.miniscript.keys, zero = (b) => b.every((x) => x === 0);
    window.__keep = { sig: p.inputs[0].partial_sigs[0].sig, sig2: o.partial_sigs[0].sig, ws: o.witness_script, spk: o.witness_utxo.script_pubkey, chain: parser.root.chain_code, k: parser.root, dpub: keys[0].key.pub, dchain: keys[0].key.chain };
    const k = window.__keep;
    return { sig: !zero(k.sig), ws: !zero(k.ws), spk: !zero(k.spk), chain: !zero(k.chain), dpub: !zero(k.dpub), dchain: !zero(k.dchain), has: !!c.psbt && !!c.psbt_parser && !!desc };
  });
  t(held.has && held.sig && held.ws && held.spk && held.chain && held.dpub && held.dchain, tag + ': before the wipe the device holds the PSBT, a signature, the signing key and the descriptor (' + JSON.stringify(held) + ')');
  await d.ev(() => clearAll());   // CLEAR ALL
  await sleep(500);
  const w = await d.ev(() => {
    const k = window.__keep, zero = (b) => b.every((x) => x === 0), c = document.getElementById('ssScreen'), g = c.getContext('2d'), px = g.getImageData(0, 0, c.width, c.height).data; let lit = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] || px[i + 1] || px[i + 2]) lit++;
    return { ctl: !SSController._instance, sig: zero(k.sig), sig2: zero(k.sig2), ws: zero(k.ws), spk: zero(k.spk), chain: zero(k.chain), key: k.k.k === 0n, dpub: zero(k.dpub), dchain: zero(k.dchain), box: document.getElementById('ssBox').open, lit, cam: document.body.classList.contains('cam-on') };
  });
  t(w.ctl && !w.box && w.lit === 0 && !w.cam, tag + ': CLEAR ALL drops the controller, closes the section, blanks the screen and turns the camera off (' + JSON.stringify({ ctl: w.ctl, box: w.box, lit: w.lit, cam: w.cam }) + ')');
  t(w.sig && w.sig2 && w.ws && w.spk, tag + ': the PSBT bytes and the signature are overwritten with zeros');
  t(w.chain && w.key, tag + ': the signing root key (private key and chain code) is overwritten');
  t(w.dpub && w.dchain, tag + ': the scanned descriptor\'s keys are overwritten');
};

// ---- review fixes: two quick taps, key repeat only while held, regtest addresses in the Address Explorer (from an xpub),
// a "bitcoin:" QR with no address, a taproot descriptor with a script tree
SCEN.review = async (t, d, ctx, page) => {
  await d.waitView('SSMainMenuView'); await d.pick(/^Tools$/, { wait: 900 });
  await d.press('DOWN', 300); await d.press('PRESS', 900); await d.pick(/12 words/, { wait: 1000 });
  await d.waitView('SSToolsDiceEntropyEntryScreen'); await sleep(500);
  const taps = (plan) => d.ev((plan) => new Promise((res) => {   // [[at ms, hold ms], ...] on the joystick press (the dice key "1" is selected)
    const h = SSHardwareButtons.get_instance(), sc = () => SSController._instance.current_destination.view.screen, n0 = sc().user_input.length;
    for (const [at, hold] of plan) { setTimeout(() => h.key_down('KEY_PRESS'), at); setTimeout(() => h.key_up('KEY_PRESS'), at + hold); }
    setTimeout(() => res(sc().user_input.length - n0), Math.max(...plan.map(([a, b]) => a + b)) + 600);
  }), plan);
  const counts = [];
  for (const gap of [150, 180, 200, 240, 300]) counts.push(await taps([[0, 70], [gap, 70]]));
  t(counts.every((c) => c === 2), 'keys: two quick taps (70 ms each, 150 to 300 ms apart) count as two rolls, never three (' + counts.join(', ') + ')');
  const held = await taps([[0, 700]]);
  t(held >= 3, 'keys: a key held for 700 ms repeats after 225 ms, as on the device (' + held + ' rolls)');
  await page.click('#ssBox > summary'); await sleep(400); await page.click('#ssBox > summary');   // switch it off and on
  // regtest: the Address Explorer shows bcrt1 addresses (BIP84 path m/84'/1'/0'), made from the account xpub
  await d.waitView('SSMainMenuView');
  await d.ev(() => { const S = SSSettings.get_instance(), C = SSSettingsConstants; S.set_value(C.SETTING__NETWORK, C.REGTEST); });
  const { fp } = await d.loadByScan();
  await d.pick(/Address explorer/, { wait: 900 }); await d.pick(/^Native Segwit$/, { wait: 900 });
  await d.waitView('SSToolsAddressExplorerAddressTypeView'); await d.pick(/Receive/, { wait: 3000 }); await d.waitView('SSToolsAddressExplorerAddressListView'); await sleep(1500);
  const REG = { bech32: 'bcrt', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
  const want = Array.from({ length: 10 }, (_, i) => shortAddr(btc.p2wpkh(rootOf(ABANDON).derive(`m/84'/1'/0'/0/${i}`).publicKey, REG).address, i));
  const got = ((await d.state()).labels || []).slice(0, 10);
  t(JSON.stringify(got) === JSON.stringify(want), 'regtest: the Address Explorer shows bcrt1 addresses, as SeedSigner does (' + got[0] + ', wanted ' + want[0] + ')');
  const xp = await d.ev(() => { const x = SSController._instance.address_explorer_data.xpub; return { keys: Object.keys(x).sort().join(','), key: x.key && x.key.length, chain: x.chain_code && x.chain_code.length }; });
  t(xp.key === 33 && xp.chain === 32 && !/\b(k|root|steps)\b/.test(xp.keys), 'Address Explorer: it holds the account xpub (33-byte public key, chain code), not the master private key (' + xp.keys + ')');
  // "bitcoin:" with no address: the scan stops and goes Home (SeedSigner: "Invalid address", DecodeQRStatus.INVALID)
  await toHome(d);
  await scanFrames(d, page, ['bitcoin:', 'bitcoin:', 'hello']); await sleep(2500);
  let st = await d.state();
  t(st.view === 'SSMainMenuView', '"bitcoin:" with no address: the scan stops and the device goes Home (' + st.view + ')');
  // tr(key, {script tree}): read as a descriptor, then "Not Yet Implemented" as on SeedSigner
  const xpubOf = (m, path) => rootOf(m).derive(path).publicExtendedKey;
  const trDesc = `tr([${FPA}/86'/0'/0']${xpubOf(MN2.A, "m/86'/0'/0'")}/0/*,{sortedmulti_a(1,${xpubOf(MN2.B, "m/86'/0'/0'")}/0/*,${xpubOf(MN2.C, "m/86'/0'/0'")}/0/*)})`;
  await scanFrames(d, page, [trDesc]);
  st = await d.waitView('SSNotYetImplementedView', 30000);
  t(st.view === 'SSNotYetImplementedView', 'tr() with a script tree: "Not Yet Implemented", as SeedSigner shows (' + st.view + ')');
};

// ================================================================ v2.14.0: Learn on the practice signer (page text and controls next to the device)
// The lessons are driven only with the device's own keys (and the page buttons a lesson asks for); a step counts as passed only when the
// panel moves on by itself. The practice transaction is built by the page; here it is taken apart and its signatures are checked with
// @scure/btc-signer + @noble/curves against keys made here by @scure/bip32 from the public test seeds (never with the page's code).
const MN_PAY = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const panel = (d) => d.ev(() => ({ id: ssLearn.lesson && ssLearn.lesson.id, step: ssLearn.step, done: ssLearn.done, n: ssLearn.lesson ? ssLearn.lesson.steps.length : 0,
  count: document.getElementById('ssLearnCount').textContent, do: document.getElementById('ssLearnDo').textContent, see: document.getElementById('ssLearnSee').textContent,
  cam: ssLearnCam.frames ? ssLearnCam.key : '', tx: ssLearn.tx ? { kind: ssLearn.tx.kind, ok: !!(ssLearn.tx.result && ssLearn.tx.result.ok) } : null,
  status: document.getElementById('ssTxStatus').textContent, net: !document.getElementById('ssTxNet').hidden }));
const waitCam = async (d, key, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await panel(d)).cam === key) return; await sleep(150); } throw new Error('the practice wallet never showed ' + key); };
const toHomeAny = async (d) => { const s = await d.state(); if (s.screen === 'SSQRDisplayScreen') await d.press('PRESS', 1000); await d.back('SSMainMenuView'); };
// acts[i]: what a person does at step i. Returns the steps the panel showed, in order.
async function runLesson(d, page, id, acts) {
  await page.evaluate(() => {   // every step the panel shows, in order (also the ones it passes at once)
    window.__lsteps = []; const c = document.getElementById('ssLearnCount');
    if (window.__lobs) window.__lobs.disconnect();
    window.__lobs = new MutationObserver(() => { const i = ssLearn.done ? -1 : ssLearn.step; if (window.__lsteps[window.__lsteps.length - 1] !== i) window.__lsteps.push(i); });
    window.__lobs.observe(c, { childList: true, characterData: true, subtree: true });
  });
  await page.selectOption('#ssLearnPick', id); await page.click('#ssLearnGo'); await sleep(500);
  const seen = []; let p = await panel(d);
  for (let guard = 0; guard < 80 && !p.done; guard++) {
    const i = p.step; seen.push(i);
    if (!acts[i]) throw new Error('lesson ' + id + ': nothing to do at step ' + i + ' (' + p.do + ')');
    await acts[i](d, page);
    const t0 = Date.now(); while (Date.now() - t0 < 60000) { p = await panel(d); if (p.done || p.step !== i) break; await sleep(150); }
    if (!p.done && p.step === i) throw new Error('lesson ' + id + ' stuck at step ' + i + ' (' + p.do + '), device at ' + JSON.stringify(await d.state()));
  }
  const shown = await page.evaluate(() => window.__lsteps.filter((x) => x >= 0));
  return { seen: shown, p };
}
const lessonOk = (t, id, r, n, skipped = []) => {
  const want = Array.from({ length: n }, (_, i) => i).filter((i) => !skipped.includes(i));
  const inOrder = r.seen.every((x, i) => i === 0 || x > r.seen[i - 1]);
  const all = want.every((i) => r.seen.includes(i));
  t(r.p.done && r.p.id === id && inOrder && all && /Lesson done/.test(r.p.count + 'Lesson done'),
    'lesson "' + id + '": driven with the device keys, each of its ' + n + ' steps moves on when the device shows the expected screen (' + r.seen.length + ' steps shown' + (skipped.length ? ', ' + skipped.length + ' load steps passed over: the test seed was loaded' : '') + '), then "Lesson done"' + (r.p.done ? '' : ' ' + JSON.stringify(r)));
};
const P = (k, w) => async (d) => d.press(k, w || 900);
const many = (...a) => async (d) => { for (const [k, w] of a) await d.press(k, w || 900); };
const LOAD = [async () => {}, async (d) => { await waitCam(d, 'seedqr'); await d.pick(/^Scan$/, { wait: 2500 }); }, P('PRESS', 1500)];
// The practice PSBT and its signed copy, checked here: made-up coins, the keys of the test seed, the payee, the change, every signature
function checkPractice(t, tag, origB, signedB, o) {
  const NET = o.net === 'M' ? btc.NETWORK : btc.TEST_NETWORK, coin = o.net === 'M' ? 0 : 1;
  const orig = btc.Transaction.fromPSBT(origB), signed = btc.Transaction.fromPSBT(signedB), ref = btc.Transaction.fromPSBT(origB, { lowR: true });
  // the coins: one made-up previous transaction whose only input is a null outpoint marked as practice
  let made = true, mark = '';
  for (let i = 0; i < orig.inputsLength; i++) {
    const inp = orig.getInput(i), prev = btc.Transaction.fromRaw(btc.RawTx.encode(inp.nonWitnessUtxo), { allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
    const pin = prev.getInput(0); mark = Buffer.from(pin.finalScriptSig || []).toString('latin1');
    made = made && prev.id === hx(inp.txid) && prev.inputsLength === 1 && hx(pin.txid) === '00'.repeat(32) && pin.index === 0xffffffff && /VOIDFORGE practice coins: made up, not real/.test(mark)
      && hx(prev.getOutput(inp.index).script) === hx(inp.witnessUtxo.script) && prev.getOutput(inp.index).amount === inp.witnessUtxo.amount;
  }
  t(made, tag + ': every input spends a made-up previous transaction (null outpoint, its script says "' + mark.replace(/[^ -~]/g, '').slice(0, 40) + '..."), so the PSBT can never be broadcast');
  // keys, payee and change from the test seeds
  const A = rootOf(ABANDON), pay = btc.p2wpkh(rootOf(MN_PAY).derive(`m/84'/${coin}'/0'/0/0`).publicKey, NET).address;
  let keys = true;
  const paths = [];
  for (let i = 0; i < orig.inputsLength; i++) {
    const inp = orig.getInput(i), mine = (inp.bip32Derivation || []).find(([, v]) => v.fingerprint === A.fingerprint);
    const path = 'm/' + mine[1].path.map((x) => x >= HARD ? (x - HARD) + "'" : String(x)).join('/'); paths.push(path);
    keys = keys && hx(A.derive(path).publicKey) === hx(mine[0]) && (o.multi ? path === `m/48'/${coin}'/0'/2'/0/${i}` : path === `m/84'/${coin}'/0'/0/${i}`)
      && (o.multi ? true : hx(inp.witnessUtxo.script) === hx(btc.p2wpkh(mine[0]).script));
  }
  const out0 = btc.Address(NET).encode(btc.OutScript.decode(orig.getOutput(0).script)), ch = orig.getOutput(1), chd = (ch.bip32Derivation || []).find(([, v]) => v.fingerprint === A.fingerprint);
  const chPath = chd && 'm/' + chd[1].path.map((x) => x >= HARD ? (x - HARD) + "'" : String(x)).join('/');
  keys = keys && out0 === pay && !!chd && hx(A.derive(chPath).publicKey) === hx(chd[0]) && chPath === (o.multi ? `m/48'/${coin}'/0'/2'/1/0` : `m/84'/${coin}'/0'/1/0`);
  t(keys, tag + ': it spends ' + orig.inputsLength + ' coin(s) of the test seed at ' + paths.join(', ') + ', pays ' + pay.slice(0, 12) + '... (receive #0 of the "zoo ... wrong" test seed) and sends change to ' + chPath + ' (keys made here with @scure/bip32)');
  // the signatures the device made, read from its screen: BIP-143 sighash from btc-signer, noble verify, and equal to btc-signer's own
  const ok = { n: 0, ecdsa: true, same: true };
  for (let i = 0; i < orig.inputsLength; i++) {
    const inp = orig.getInput(i), ps = signed.getInput(i).partialSig || [];
    if (ps.length !== 1) { ok.ecdsa = false; continue; }
    const [pub, sig] = ps[0], k = A.derive(paths[i]);
    const scriptCode = o.multi ? inp.witnessScript : btc.OutScript.encode({ type: 'pkh', hash: inp.witnessUtxo.script.slice(2) });
    const h = orig.preimageWitnessV0(i, scriptCode, btc.SigHash.ALL, inp.witnessUtxo.amount);
    ok.ecdsa = ok.ecdsa && hx(pub) === hx(k.publicKey) && sig[sig.length - 1] === btc.SigHash.ALL && secp256k1.verify(sig.slice(0, -1), h, pub, { prehash: false, format: 'der', lowS: true });
    ref.signIdx(k.privateKey, i); const rs = ref.getInput(i).partialSig.find((x) => hx(x[0]) === hx(pub)); ok.same = ok.same && !!rs && hx(rs[1]) === hx(sig); ok.n++;
  }
  t(ok.ecdsa && ok.n === orig.inputsLength, tag + ': the signed PSBT read from the device\'s screen holds one valid signature per input (' + ok.n + '), checked with btc-signer\'s BIP-143 sighash and noble');
  t(ok.same, tag + ': each signature equals btc-signer\'s own (RFC 6979, low R) byte for byte');
  const fin = btc.Transaction.fromPSBT(origB); fin.combine(signed);
  if (o.multi) fin.signIdx(rootOf(MN2.B).derive(`m/48'/${coin}'/0'/2'/0/0`).privateKey, 0);
  let raw = null; try { fin.finalize(); raw = fin.extract(); } catch (e) { raw = null; }
  t(!!raw, tag + ': btc-signer finalizes it' + (o.multi ? ' with a second signature it made for cosigner B' : '') + ' (a complete transaction that still spends coins that do not exist)');
}
async function practiceRun(t, d, page, tag, o) {
  // Home > Scan reads the practice PSBT from the practice wallet; review, sign; the page reads the signed QR back
  await waitCam(d, 'tx');
  const origB = Uint8Array.from(await d.ev(() => Array.from(ssLearn.tx.psbt)));
  await toHomeAny(d); await d.pick(/^Scan$/, { wait: 800 });
  let s = await d.waitView('SSPSBTSelectSeedView', 40000);
  t(s.labels[0] === FPA && (await panel(d)).cam === '', tag + ': the device reads the practice PSBT from the practice wallet and asks which seed signs (' + s.labels[0] + '); the practice wallet is put away');
  await d.pick(new RegExp(FPA), { wait: 1500 }); await d.waitView('SSPSBTOverviewScreen', 60000); await sleep(500);
  const f = await screenFields(d, ['spend_amount', 'change_amount', 'fee_amount', 'num_inputs']);
  const want = o.multi ? [200000, 298500, 1500, 1] : [120000, 99000, 1000, 2];
  t(JSON.stringify([f.spend_amount, f.change_amount, f.fee_amount, f.num_inputs]) === JSON.stringify(want), tag + ': the device\'s overview shows ' + want[0] + ' sats sent, ' + want[1] + ' change, ' + want[2] + ' fee, ' + want[3] + ' input(s) (' + JSON.stringify(f) + ')');
  for (let n = 0; n < 12; n++) {
    s = await d.state(); if (s.view === 'SSPSBTSignedQRDisplayView') break;
    if (s.view === 'SSPSBTChangeDetailsView' && /Verify multisig/.test(s.labels[0])) { await d.press('PRESS', 1200); await d.ev(() => ssLearnArm('descriptor')); await waitCam(d, 'descriptor'); await d.press('PRESS', 1500); await d.waitView('SSMultisigWalletDescriptorView', 40000); await sleep(400); }
    await d.press('PRESS', s.view === 'SSPSBTFinalizeView' ? 2500 : 1500);
  }
  await d.waitView('SSPSBTSignedQRDisplayView', 60000); await sleep(500);
  const r = await readUR(page);
  t(!!r && r.type === 'crypto-psbt', tag + ': the device shows the signed PSBT as a UR crypto-psbt QR (' + (r ? r.parts + ' part(s), read with jsqr' : 'none read') + ')');
  const t0 = Date.now(); let p; while (Date.now() - t0 < 60000) { p = await panel(d); if (p.tx && p.tx.ok) break; await sleep(300); }
  t(p.tx && p.tx.ok && /^Signed correctly: /.test(p.status) && /checked by this page's own code/.test(p.status), tag + ': the page reads the signed QR from the device\'s screen and says "' + p.status.split('(')[0].trim() + '"');
  if (r) checkPractice(t, tag, origB, r.bytes, o);
  return origB;
}
SCEN.practice_tx = async (t, d, ctx, page) => {   // Testnet, no lesson: the PRACTICE TRANSACTION button by itself
  const tag = 'practice transaction (single key, Testnet)';
  await d.waitView('SSMainMenuView');
  await d.ev(() => { const S = SSSettings.get_instance(), C = SSSettingsConstants; S.set_value(C.SETTING__NETWORK, C.TESTNET); });
  await d.ev(() => ssLearnArm('seedqr')); await waitCam(d, 'seedqr');
  await d.pick(/^Scan$/, { wait: 2500 }); await d.pick(/^Done$/, { wait: 1500 });
  await page.selectOption('#ssTxKind', 'single'); await page.click('#ssTxGo');
  await waitCam(d, 'tx'); let p = await panel(d);
  t(!p.net && /Spends 2 made-up coins of seed 73c5da0a/.test(p.status) && /made-up transaction [0-9a-f]{16}\.\.\., marked "VOIDFORGE practice coins/.test(await page.textContent('#ssTxCoins')),
    tag + ': PRACTICE TRANSACTION spends made-up coins of the seed on the device, names the made-up transaction, and shows no Mainnet warning on Testnet');
  const origB = await practiceRun(t, d, page, tag, { net: 'T' });
  // the device itself: its menus are SeedSigner's own, nothing of the lessons is on its screen or in its menus
  await toHomeAny(d); const s = await d.state();
  t(JSON.stringify(s.labels) === '["Scan","Seeds","Tools","Settings"]' && s.title === 'Home', 'the device keeps SeedSigner\'s own Home menu (Scan, Seeds, Tools, Settings): nothing is added to it');
  // CLEAR ALL wipes the practice PSBT, the practice wallet and the lesson panel
  await d.ev(() => { window.__keepTx = ssLearn.tx; }); await page.selectOption('#ssLearnPick', 'sign'); await page.click('#ssLearnGo'); await sleep(300);
  await d.ev(() => clearAll()); await sleep(400);
  const w = await d.ev(() => ({ tx: ssLearn.tx, lesson: ssLearn.lesson, cam: ssLearnCam.frames, zero: window.__keepTx.psbt.every((x) => x === 0) && window.__keepTx.utx.every((x) => x === 0), run: document.getElementById('ssLearnRun').hidden, st: document.getElementById('ssTxStatus').textContent, timer: ssLearn.timer }));
  t(w.tx === null && w.lesson === null && w.cam === null && w.zero && w.run && w.st === '' && w.timer === null, 'CLEAR ALL drops the lesson, the practice wallet\'s QR codes and the practice transaction, and overwrites the PSBT bytes (' + JSON.stringify({ zero: w.zero, run: w.run }) + ')');
};
SCEN.lessons_dice = async (t, d, ctx, page) => {
  const rolls = '1'.repeat(50), exp = diceWords(rolls, 12).split(' ');
  t(await d.ev(() => SS_LEARN_LESSONS.length === 6 && SS_LEARN_LESSONS.every((l) => l.name && l.note && l.end && l.steps.every((s) => s.do && s.see && typeof s.at === 'function')) && /public test seeds only/.test(document.getElementById('ssLearn').textContent)),
    'lessons: six lessons next to the device, each step with plain text and a "what you should see" line; the panel says they use public test seeds only');
  let words = [];
  const answer = async (d) => {
    for (let n = 0; n < 14; n++) {
      const s = await d.state(); if (s.view !== 'SSSeedWordsBackupTestView') break;
      const k = +s.title.replace(/\D+/g, '') - 1; await d.pick(new RegExp('^' + exp[k] + '$'), { wait: 700 });
    }
  };
  const readWords = async (d) => { words.push(...await d.scr(() => SSController._instance.current_destination.view.screen.words)); await d.press('PRESS', 900); };
  const acts = [async () => {}, many(['DOWN', 300], ['PRESS', 900]), many(['DOWN', 300], ['PRESS', 900]), P('PRESS', 1000),
    async (d) => { for (let i = 0; i < 50; i++) await d.press('PRESS', 230); }, P('PRESS', 900), readWords, readWords, readWords, P('PRESS', 900), answer, P('PRESS', 1200), P('PRESS', 1500)];
  // the panel's controls first: BACK, NEXT and RESTART LESSON
  await d.waitView('SSMainMenuView'); await page.selectOption('#ssLearnPick', 'dice'); await page.click('#ssLearnGo'); await sleep(800);
  const c0 = (await panel(d)).step; await page.click('#ssLearnNext'); const c1 = (await panel(d)).step; await page.click('#ssLearnBack'); const c2 = (await panel(d)).step;
  await page.click('#ssLearnNext'); await page.click('#ssLearnNext'); await page.click('#ssLearnRestart'); await sleep(600); const c3 = await panel(d);
  t(c0 === 1 && c1 === 2 && c2 === 1 && c3.step === 1 && /^Step 2 of 13$/.test(c3.count), 'lesson controls: NEXT and BACK move one step, RESTART LESSON goes back to the start (step 1, Home, passes at once: the device shows Home) (' + [c0, c1, c2, c3.step].join(', ') + ')');
  const r = await runLesson(d, page, 'dice', acts);
  lessonOk(t, 'dice', r, 13);
  t(words.join(' ') === exp.join(' '), 'lesson "dice": fifty 1s give the 12 words SeedSigner makes (SHA-256 of the rolls, @scure/bip39): ' + exp.slice(0, 3).join(' ') + ' ...');
  t((await d.state()).view === 'SSSeedOptionsView' && (await d.state()).title === fpOf(rootOf(exp.join(' '))), 'lesson "dice": it ends on the seed\'s menu, under the fingerprint of those words (' + fpOf(rootOf(exp.join(' '))) + ')');
};
SCEN.lessons_seed = async (t, d, ctx, page) => {   // xpub, then address and message with the test seed already loaded (their load steps are passed over)
  let r = await runLesson(d, page, 'xpub', [...LOAD, async () => {}, many(['DOWN', 300], ['PRESS', 900]), P('PRESS'), P('PRESS'), P('PRESS'), P('PRESS', 2500), P('PRESS', 1500)]);
  lessonOk(t, 'xpub', r, 10);
  const q = await readUR(page, 20000).catch(() => null), qr = q ? null : await d.readQR();
  t((await d.state()).view === 'SSSeedExportXpubQRDisplayView', 'lesson "xpub": it ends on the xpub QR code');
  r = await runLesson(d, page, 'address', [null, null, null, toHomeAny, async (d) => { await waitCam(d, 'address'); await d.pick(/^Scan$/, { wait: 1500 }); }, P('PRESS', 2000)]);
  lessonOk(t, 'address', r, 6, [0, 1, 2]);
  const f = await screenFields(d, ['address', 'verified_index', 'verified_index_is_change']);
  t(f.address === addrOf(ABANDON, '', 'native', 0, 3) && f.verified_index === 3 && f.verified_index_is_change === false, 'lesson "address": the device verified receive address #3 of the test seed (' + String(f.address).slice(0, 14) + '..., the address @scure/btc-signer makes)');
  r = await runLesson(d, page, 'message', [null, null, null, toHomeAny, async (d) => d.pick(/^Settings$/, { wait: 900 }), async (d) => d.pick(/^Advanced$/, { wait: 900 }), async (d) => d.pick(/^Message signing$/, { wait: 900 }), async (d) => d.pick(/^Enabled$/, { wait: 1200 }),
    toHomeAny, async (d) => { await waitCam(d, 'signmsg'); await d.pick(/^Scan$/, { wait: 1500 }); }, P('PRESS', 1500), P('PRESS', 1500), P('PRESS', 2500)]);
  lessonOk(t, 'message', r, 13, [0, 1, 2]);
  await sleep(800); const mq = await d.readQR(), k = rootOf(ABANDON).derive("m/84'/0'/0'/0/0");
  const ms = mq ? checkMessageSig(mq.text, 'Practice message from VOIDFORGE', k.publicKey, 'p2wpkh') : { ok: false };
  t(ms.ok, 'lesson "message": the QR on the device is a valid signature of "Practice message from VOIDFORGE" by m/84\'/0\'/0\'/0/0 of the test seed (noble)');
};
const lessonSign = async (t, d, ctx, page) => {   // Mainnet (the device's default): the practice wallet warns that the coins do not exist
  const tag = 'lesson "sign" (single key, Mainnet)';
  const r0 = runLesson(d, page, 'sign', [...LOAD, toHomeAny, async (d, page) => page.click('#ssTxGo'), async (d) => { await waitCam(d, 'tx'); await d.pick(/^Scan$/, { wait: 1500 }); },
    P('PRESS', 1500), P('PRESS', 1200), P('PRESS', 1200), P('PRESS', 1500), P('PRESS', 1200), P('PRESS', 2500), async () => {}]);
  const r = await r0;
  lessonOk(t, 'sign', r, 13);
  const p = await panel(d);
  t(p.net && await page.textContent('#ssTxNet') === "Mainnet: these coins don't exist; this PSBT can never be broadcast." && p.tx.ok && /^Signed correctly/.test(p.status), tag + ': the device is on Mainnet, so the page warns "these coins don\'t exist; this PSBT can never be broadcast", and the lesson ends with "Signed correctly"');
};
SCEN.lessons_tx = async (t, d, ctx, page) => {   // "sign", then "multisig" with the test seed already loaded
  await lessonSign(t, d, ctx, page);
  const tag = 'lesson "multisig" (2-of-3, Mainnet)';
  let origB = null, signedB = null;
  const acts = [null, null, null, toHomeAny, async (d, page) => { await page.click('#ssTxGo'); await waitCam(d, 'tx'); origB = Uint8Array.from(await d.ev(() => Array.from(ssLearn.tx.psbt))); },
    async (d) => d.pick(/^Scan$/, { wait: 1500 }), P('PRESS', 1500), P('PRESS', 1200), P('PRESS', 1200), P('PRESS', 1500), P('PRESS', 1200),
    async (d) => { await waitCam(d, 'descriptor'); await d.press('PRESS', 2500); }, P('PRESS', 1500), P('PRESS', 1200), P('PRESS', 2500),
    async (d, page) => { const u = await readUR(page); signedB = u && u.bytes; }];
  const r = await runLesson(d, page, 'multisig', acts);
  lessonOk(t, 'multisig', r, 16, [0, 1, 2]);
  const desc = await d.ev(() => SSController._instance.multisig_wallet_descriptor && SSController._instance.multisig_wallet_descriptor.miniscript ? true : !!SSController._instance.multisig_wallet_descriptor);
  t(desc, tag + ': the device holds the 2-of-3 wallet descriptor it scanned from the practice wallet');
  t((await panel(d)).tx.ok && /second cosigner/.test((await panel(d)).status), tag + ': the page says "Signed correctly" and that a second cosigner must sign too');
  if (origB && signedB) checkPractice(t, tag, origB, signedB, { net: 'M', multi: true }); else t(false, tag + ': no signed PSBT read from the screen');
};

// ================================================================ run
SCEN.tools.clock = true; SCEN.offline.online = true;
const order = ['lessons_dice', 'lessons_tx', 'lessons_seed', 'practice_tx', 'review', 'psbt_msig', 'psbt_wipe', 'psbt_p2wpkh', 'psbt_p2sh', 'psbt_p2tr', 'psbt_msig_bad', 'signmsg', 'addr_single', 'addr_taproot', 'addr_multi', 'dice12', 'dice24', 'words', 'settings', 'seedqr', 'tools', 'native', 'nested', 'taproot', 'wipe', 'offline'];
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
