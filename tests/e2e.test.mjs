// VOIDFORGE end-to-end test (v2.16.1): what a person SEES and DOES, in a real Chromium, offline, at desktop size (1280 x 900) and
// phone size (390 x 844, touch), device scale 1. Written after the owner's report that after FORGE SEED in the Damascus tab the page
// scrolled so the 12 words sat hidden above the screen, which the jsdom tests could not see.
// Everything is done the way a person does it: clicks and taps on visible controls, typing in the boxes, the start notice closed
// with its own button. The page's functions are never called to make anything happen; the page's state is only read, to check.
// Expected values come from independent code: @scure/bip39, @scure/bip32, @scure/btc-signer, jsqr and node:crypto, and for the
// Damascus method the published method itself (the mirror table, the knockout and the fold), worked out here.
// Groups, each run at both sizes in a fresh page:
//   make:dice, make:dice24, make:coin, make:words, make:cards, make:hex, make:damascus
//       enter valid input (tap pads where the method has them, and type), FORGE SEED; the words show under YOUR SEED, as the
//       independent code makes them from the input; once the scroll settles the whole word grid is on screen and below the sticky
//       tab bar; fingerprint and first address as @scure gives them; PRINT SEED prints these words on the backup sheet; no
//       page error, console error or sideways scroll
//   followups      after a dice seed, by clicking: PRINT SEED (only the sheet prints, with the words; nothing is covered),
//                  SeedQR and CompactSeedQR (read back from the screen with jsqr), Restore drill, COPY FINGERPRINT, COPY ADDRESS,
//                  DOWNLOAD, re-hide on a real window blur (another page takes the focus) and SHOW, CLEAR ALL back to a clean page
//   check          CHECK A BACKUP: Check your words with the fingerprint -> MATCH; Open this wallet: 10 receive + 10 change
//   signer         the practice signer: OPEN PRACTICE SIGNER, make a seed from dice with the device's own keys, FORGE SEED
//                  below it: the words in view under YOUR SEED, fingerprint as @scure gives it
//   NEW in v2.16.1 (expected to fail before the v2.16.1 practice changes are merged):
//     new:damascus-practice-sheet, new:damascus-guided-practice, new:damascus-worked-example
//                  FORGE SEED works for practice: the seed shows under YOUR SEED, in view, with a red PRACTICE banner naming the
//                  sheet; PRINT SEED prints it with a PRACTICE line
//     new:load-own-seed, new:load-practice-seed
//                  LOAD INTO THE PRACTICE SIGNER under YOUR SEED loads any seed into the signer by itself, in one click, and
//                  the signer's fingerprint is the page's
//     new:practice-backup-own-words, new:practice-passphrase-own-words, new:practice-wallet-own-words
//                  Practice making a backup, Practice your passphrase and OPEN A PRACTICE WALLET take the person's own words
//   v2.17.0 (E2E_GROUPS=new217): new217:load-online, new217:own-psbt, new217:fixes (see their notes below)
// Every wait polls the page's state with a generous limit (no fixed sleeps), so a busy machine makes the run slower, not flaky.
// Run: node tests/e2e.test.mjs     (E2E_VIEWS=phone or desktop; E2E_GROUPS=make:dice,check to run some, E2E_GROUPS=new for the
// NEW in v2.16.1 groups only, E2E_GROUPS=make for every method; E2E_SKIP_NEW=1 leaves the NEW groups out)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash, randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const pw = require('playwright-core');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const bip39 = require('@scure/bip39');
const { wordlist } = require('@scure/bip39/wordlists/english');
const { HDKey } = require('@scure/bip32');
const btc = require('@scure/btc-signer');
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = 'file://' + (process.env.VF_FILE || path.join(here, '..', 'voidforge.html'));
const T0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ================================================================ expected values (independent code only)
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest();
const mnemonicOf = (entropy) => bip39.entropyToMnemonic(Uint8Array.from(entropy), wordlist);
const rootOf = (m, pass = '') => HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(m, pass));
const fpOf = (m, pass = '') => rootOf(m, pass).fingerprint.toString(16).padStart(8, '0');
const addrOf = (m, chain, i, pass = '', coin = 0) => btc.p2wpkh(rootOf(m, pass).derive(`m/84'/${coin}'/0'/${chain}/${i}`).publicKey, coin ? btc.TEST_NETWORK : btc.NETWORK).address;
const seedQrDigits = (m) => m.split(' ').map((w) => String(wordlist.indexOf(w)).padStart(4, '0')).join('');
const entropyHex = (m) => Buffer.from(bip39.mnemonicToEntropy(m, wordlist)).toString('hex');
const rolls = (n, k = 6) => Array.from({ length: n }, () => String(k === 2 ? randomInt(2) : 1 + randomInt(6))).join('');
// Dice and coin (SeedSigner and Coldcard rules): SHA-256 of the typed string, first 16 or 32 bytes.
const hashWords = (s, wc) => mnemonicOf(sha256(s).subarray(0, wc === 24 ? 32 : 16));
// Cards (Ian Coleman, hashed): the cards as rank (A 2..9 T J Q K) and suit symbol, one space between, hashed with SHA-256.
const SUIT = { C: '♣', D: '♦', H: '♥', S: '♠' };
const deck = () => { const d = []; for (const s of 'CDHS') for (const r of 'A23456789TJQK') d.push(r + s); for (let i = d.length - 1; i > 0; i--) { const j = randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; } return d; };
const cardText = (c) => (c[0] === 'T' ? '10' : c[0]) + c[1];
const cardSym = (c) => c[0] + SUIT[c[1]];
// Word draw: 11 drawn words (11 bits each) and 7 coin flips are the 128 bits of entropy; the last word follows from the checksum.
function drawWords(idx, flips) {
  const bits = idx.map((n) => n.toString(2).padStart(11, '0')).join('') + flips, b = [];
  for (let i = 0; i < bits.length; i += 8) b.push(parseInt(bits.slice(i, i + 8), 2));
  return mnemonicOf(b);
}
// The Damascus method (docs/damascus-method.md), 12 words: the Hammer sheet (dice pairs through the mirror table, 5 bits a good
// pair; 1-1 to 4-4 thrown again), the Anvil sheet (cards dealt in groups of 8 and 4, a knockout: 1 when the second card of a match
// is higher), and the Forge sheet: the two grids folded (XOR). Card values: rank A..K times 4 plus suit (clubs, diamonds, hearts, spades).
const DM = {
  mirror(a, b) {   // the mirror table: 30 ordered pairs of different faces, 5-5 and 6-6; 1-1 to 4-4 are thrown again
    if (a === b) return a <= 4 ? null : 30 + (a === 6 ? 1 : 0);
    const lo = Math.min(a, b), hi = Math.max(a, b); let k = hi - lo - 1;
    for (let x = 1; x < lo; x++) k += 6 - x;
    return (k << 1) | (b > a ? 1 : 0);
  },
  diceBits(pairs) { const bits = []; for (const [a, b] of pairs) { const c = DM.mirror(a, b); if (c === null) continue; for (const ch of c.toString(2).padStart(5, '0')) if (bits.length < 128) bits.push(+ch); } return bits; },
  value: (c) => 'A23456789TJQK'.indexOf(c[0]) * 4 + 'CDHS'.indexOf(c[1]),
  knockout(v) { const bits = []; let r = v.slice(); while (r.length > 1) { const n = []; for (let i = 0; i < r.length; i += 2) { bits.push(r[i + 1] > r[i] ? 1 : 0); n.push(Math.max(r[i], r[i + 1])); } r = n; } return bits; },
  plan: [[8, 8, 8, 8, 8, 8, 4], [8, 8, 8, 8, 8, 8, 4], [8, 8, 8, 8, 8, 4]],   // 128 bits: 45 + 45 + 38, decks of 52, 52 and 44 cards
  cardBits(decks) { const bits = [], per = []; DM.plan.forEach((g, d) => { let p = 0; const mine = []; let nb = 0; for (const n of g) { const v = decks[d].slice(p, p + n).map(DM.value); p += n; for (let i = 1; i < v.length; i++) if ((v[i] & 3) === (v[i - 1] & 3) && Math.abs((v[i] >> 2) - (v[i - 1] >> 2)) === 1) nb++; for (const x of DM.knockout(v)) { mine.push(x); if (bits.length < 128) bits.push(x); } } per.push({ ones: mine.filter(Boolean).length, n: mine.length, nb }); }); return { bits, per }; },
  words(H, A) { const F = H.map((x, i) => x ^ A[i]), b = []; for (let i = 0; i < 128; i += 8) b.push(parseInt(F.slice(i, i + 8).join(''), 2)); return mnemonicOf(b); },
  // a random sheet that passes its own bias boxes (as the sheets say: throw or shuffle again when one fails)
  sheet() {
    for (;;) {
      const pairs = []; let good = 0;
      while (good < 26) { const p = [1 + randomInt(6), 1 + randomInt(6)]; pairs.push(p); if (DM.mirror(p[0], p[1]) !== null) good++; }
      const th = pairs.slice(0, 26).flat(), cnt = [1, 2, 3, 4, 5, 6].map((f) => th.filter((x) => x === f).length); let rep = 0; for (let i = 1; i < th.length; i++) if (th[i] === th[i - 1]) rep++;
      if (Math.max(...cnt) >= 18 || Math.min(...cnt) <= 1 || rep <= 2) continue;
      const decks = [deck(), deck(), deck().slice(0, 44)], A = DM.cardBits(decks);
      if (A.per.some((d) => (d.n === 45 && (d.ones <= 11 || d.ones >= 34)) || d.nb >= 6)) continue;
      return { pairs, decks, words: DM.words(DM.diceBits(pairs), A.bits) };
    }
  },
  parsePairs: (s) => s.trim().split(/[\s,;]+/).filter(Boolean).map((t) => [+t[0], +t[1]]),
  parseDecks: (s) => s.trim().split(/\n/).map((l) => l.trim().toUpperCase().split(/\s+/).map((c) => (c.startsWith('10') ? 'T' + c[2] : c))),
};
const EX1 = 'kick confirm home few coin pencil praise burst business fix credit sword';   // Damascus worked example 1 (fingerprint 70b5da37)

// ================================================================ reporting
const results = [];   // {view, group, ok, msg}
const NEW = (g) => g.startsWith('new:');   // (the v2.17.0 groups, new217:*, are ordinary groups: expected to pass)
function reporter(view, group) {
  return (c, m) => { const r = { view, group, ok: !!c, msg: m }; results.push(r); console.log((c ? 'PASS ' : 'FAIL ') + '[' + view + '][' + group + '] ' + m); return !!c; };
}
// polls f() until it gives a truthy value or ms have passed; returns the last value
async function until(f, ms = 60000, every = 100) { const t0 = Date.now(); let v; for (;;) { try { v = await f(); } catch (e) { v = null; } if (v || Date.now() - t0 > ms) return v; await sleep(every); } }

// ================================================================ the page
const VIEWS = {
  desktop: { width: 1280, height: 900, mobile: false },
  phone: { width: 390, height: 844, mobile: true },
};
// Copies go to a stand-in clipboard (the real one needs a permission a file:// page cannot get); every copy is kept to check.
const CLIP = () => { const c = { writeText: async (t) => { (window.__copies = window.__copies || []).push(String(t)); }, readText: async () => '' }; try { Object.defineProperty(navigator, 'clipboard', { value: c, configurable: true }); } catch (e) { /* kept */ } };
async function openPage(V, view) {
  const p = await V.ctx.newPage(); p.setDefaultTimeout(60000);
  const h = { p, view, mobile: VIEWS[view].mobile, errors: [], dialogs: [] };
  p.on('pageerror', (e) => h.errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') h.errors.push('console.error: ' + m.text().slice(0, 200)); });
  p.on('dialog', (d) => { h.dialogs.push(d.type() + ': ' + d.message().slice(0, 160)); (h.no && h.no.test(d.message()) ? d.dismiss() : d.accept()).catch(() => {}); });   // h.no: a question the person answers No (Cancel)
  await p.goto(FILE);
  await p.waitForFunction(() => /PASSED/.test((document.getElementById('selfTestBadge') || {}).textContent || ''), null, { timeout: 180000 });
  const go = p.locator('#sgGo');
  if (await go.isVisible()) await go.click();
  await p.waitForFunction(() => !document.getElementById('startGate'), null, { timeout: 30000 });
  await settle(p);
  return h;
}
// a click on desktop, a tap on the phone
const press = (h, loc) => (h.mobile ? loc.tap() : loc.click());
// FORGE SEED, noting where the button was on screen when pressed (Playwright scrolls it into view only if it is not)
async function forge(h, sel) {
  const loc = h.p.locator(sel); await loc.scrollIntoViewIfNeeded();
  h.forgeAt = await loc.evaluate((b) => Math.round(b.getBoundingClientRect().top) + '..' + Math.round(b.getBoundingClientRect().bottom));
  await press(h, loc);
}
// The page is still: no scroll in progress (the same scroll position and word grid position for 6 reads in a row) and the words'
// entrance animation done.
async function settle(p, ms = 30000) {
  let last = '', same = 0;
  return until(async () => {
    const s = await p.evaluate(() => { const g = document.getElementById('wordGrid'), r = g.getBoundingClientRect(); return [scrollX, scrollY, Math.round(r.top), Math.round(r.bottom), g.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length].join(','); });
    same = s === last && /,0$/.test(s) ? same + 1 : 0; last = s; return same >= 6;
  }, ms, 80);
}
// What the person sees of YOUR SEED: the words in the grid, where the grid is against the screen and the sticky bars on top
async function seedView(p) {
  return p.evaluate(() => {
    const g = document.getElementById('wordGrid'), r = g.getBoundingClientRect(), cells = [...g.querySelectorAll('.wcell')];
    let bar = 0;
    for (const id of ['tabs', 'topbar']) { const e = document.getElementById(id); if (!e) continue; const cs = getComputedStyle(e), b = e.getBoundingClientRect(); if ((cs.position === 'sticky' || cs.position === 'fixed') && b.top <= 1 && b.bottom > bar && cs.display !== 'none') bar = b.bottom; }
    const head = document.getElementById('seedHead').getBoundingClientRect();
    return { words: cells.filter((c) => !c.classList.contains('empty') && !c.classList.contains('pv')).map((c) => (c.querySelector('.wtxt') || c.lastElementChild).textContent.trim()).join(' '),
      cells: cells.length, top: r.top, bottom: r.bottom, bar, ih: innerHeight, headTop: head.top, filter: getComputedStyle(g).filter, vis: getComputedStyle(g).visibility,
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bsw: document.body.scrollWidth,
      tab: document.getElementById('tab-make').getAttribute('aria-selected') === 'true',
      fp: document.getElementById('fingerprint').textContent, addr: document.getElementById('address').textContent };
  });
}
const inView = (s) => s.top >= s.bar - 1 && s.bottom <= s.ih + 1 && s.bottom > s.top;
const where = (s, h) => 'grid ' + Math.round(s.top) + '..' + Math.round(s.bottom) + ', bar bottom ' + Math.round(s.bar) + ', screen ' + s.ih + (h && h.forgeAt ? '; FORGE SEED was at ' + h.forgeAt + ' when pressed' : '');
// The words shown under YOUR SEED, once FORGE SEED has finished (fingerprint and first address shown)
async function waitSeed(p, n = 12, ms = 90000) {
  return until(async () => { const s = await seedView(p); return s.words.split(' ').filter(Boolean).length === n && /[0-9a-f]{8}/.test(s.fp) && /(bc1|tb1)q/.test(s.addr) ? s : null; }, ms, 150);
}
// The standard checks after FORGE SEED: the words (as expected, when known), in view below the bar, fingerprint and first address
// from @scure, no sideways scroll, no error.
async function afterForge(t, h, label, expected, n = 12) {
  const { p } = h;
  let s = await waitSeed(p, n);
  if (!t(!!s, label + ': FORGE SEED shows ' + n + ' words under YOUR SEED, with the fingerprint and first address')) return null;
  await settle(p); s = await seedView(p);
  if (expected) t(s.words === expected, label + ': the words are the ones the input makes (independent code): ' + expected.split(' ').slice(0, 3).join(' ') + ' ... (shown: ' + s.words.split(' ').slice(0, 3).join(' ') + ' ...)');
  t(s.tab && inView(s) && s.filter === 'none' && s.vis === 'visible', label + ': after the scroll settles, the whole word grid is on screen and below the sticky tab bar (' + where(s, h) + ')');
  const m = s.words, fp = fpOf(m), a0 = addrOf(m, 0, 0);
  t(s.fp.includes(fp) && s.addr.includes(a0), label + ': fingerprint ' + fp + ' and first address ' + a0.slice(0, 14) + '... as @scure/bip32 and @scure/btc-signer give them (shown: ' + s.fp + ' / ' + s.addr.slice(-42) + ')');
  t(s.sw <= s.cw && s.bsw <= s.cw, label + ': no sideways scroll (page ' + s.sw + ' wide, screen ' + s.cw + ')');
  return { words: m, fp, a0, s };
}
function noErrors(t, h, label) {
  t(h.errors.length === 0, label + ': no page error and no console error' + (h.errors.length ? ': ' + h.errors.slice(0, 3).join(' || ') : ''));
}
// PRINT SEED from the MENU, with the browser's print dialog stood in for: what is on the print area when window.print() is called
async function stubPrint(p) {
  await p.evaluate(() => {
    window.__prints = [];
    window.print = () => {
      dispatchEvent(new Event('beforeprint'));
      const po = document.getElementById('printOnly'), g = document.getElementById('wordGrid');
      window.__prints.push({ body: document.body.className, title: (po.querySelector('.ps-title') || {}).textContent || '', words: [...po.querySelectorAll('.ps-w')].map((e) => e.textContent).join(' '),
        warn: [...po.querySelectorAll('.ps-warn')].map((e) => e.textContent).join('\n'), text: po.textContent, covered: getComputedStyle(g).filter !== 'none' || document.getElementById('rhBar').classList.contains('on') });
    };
  });
}
async function printSeed(h) {
  const { p } = h;
  await stubPrint(p);
  await press(h, p.locator('#menuBox > summary'));
  await press(h, p.locator('#menuBox .menu-list').getByRole('button', { name: 'PRINT SEED', exact: true }));
  const pr = await until(() => p.evaluate(() => window.__prints.length ? window.__prints[0] : null), 30000);
  return pr;
}
async function printChecks(t, h, label, words, o = {}) {
  const { p } = h;
  const pr = await printSeed(h);
  if (!t(!!pr, label + ': PRINT SEED (MENU) prints')) return null;
  t(/print-seed/.test(pr.body) && /^VOIDFORGE BACKUP SHEET/.test(pr.title) && pr.words === words && !pr.covered, label + ': PRINT SEED puts the backup sheet with these ' + words.split(' ').length + ' words on the print area (' + pr.title + '), and nothing on screen is covered by VOIDFORGE\'s own print');
  if (o.media) {   // in print media only the sheet shows
    await p.emulateMedia({ media: 'print' });
    const m = await p.evaluate(() => { const po = document.getElementById('printOnly'); return { po: getComputedStyle(po).display !== 'none' && po.getBoundingClientRect().height > 100, others: [...document.body.children].filter((e) => e.id !== 'printOnly' && getComputedStyle(e).display !== 'none').map((e) => e.id || e.tagName) }; });
    await p.emulateMedia({ media: null });
    t(m.po && m.others.length === 0, label + ': on paper only the backup sheet shows (other parts showing: ' + JSON.stringify(m.others) + ')');
  }
  await p.evaluate(() => dispatchEvent(new Event('afterprint')));   // the print dialog closes
  const after = await until(() => p.evaluate(() => !document.body.classList.contains('print-seed') && document.getElementById('printOnly').textContent === ''), 15000);
  t(after, label + ': after printing the print area is wiped');
  return pr;
}
async function toMethod(h, id) { await press(h, h.p.locator('#' + id)); await until(() => h.p.evaluate((id) => document.getElementById(id).getAttribute('aria-selected') === 'true', id), 10000); }
// A tab, pressed as a person does, once its panel shows. Right after FORGE SEED (o.forge) it also waits for FORGE SEED to finish
// (its last step shows the watch-only box) and checks the tab stayed open: v2.16.1 found the page pulling the person back to MAKE A
// SEED a moment after the words and first address showed (the late jump to YOUR SEED), which left the next step of the test
// scrolling to a hidden box until it timed out.
const TAB_LABEL = { make: 'MAKE A SEED', check: 'CHECK A BACKUP', tools: 'EXTRA TOOLS', about: 'ABOUT & HELP' };
const openTab = (p) => p.evaluate(() => ['make', 'check', 'tools', 'about'].filter((n) => !document.getElementById('tp-' + n).classList.contains('tab-off') && document.getElementById('tab-' + n).getAttribute('aria-selected') === 'true').join(','));
async function toTab(t, h, name, label, o = {}) {
  const { p } = h;
  await press(h, p.locator('#tab-' + name));
  const shown = await until(async () => (await openTab(p)) === name, 15000);
  if (!t(shown, label + ': pressing ' + TAB_LABEL[name] + ' opens it (open: ' + (await openTab(p)) + ')')) return false;
  if (!o.forge) return true;
  const done = await until(() => p.evaluate(() => document.getElementById('watchBox').style.display !== 'none'), 120000);
  const now = await openTab(p);
  return t(done && now === name, label + ': ' + TAB_LABEL[name] + ', pressed as soon as the seed showed, stays open once FORGE SEED has finished (open: ' + now + (done ? '' : '; FORGE SEED did not finish') + ')');
}
async function typeAtEnd(loc, text) { await loc.click(); await loc.press('ControlOrMeta+End'); await loc.pressSequentially(text); }

// ================================================================ the methods (MAKE A SEED)
const G = {};
G['make:dice'] = async (t, h) => {
  const { p } = h, R = rolls(50);
  await toMethod(h, 'mt-dice');
  for (const d of R.slice(0, 8)) await press(h, p.locator(`#tapRow button[data-v="${d}"]`));   // the first rolls on the die faces
  await typeAtEnd(p.locator('#rolls'), R.slice(8));   // the rest typed
  t((await p.inputValue('#rolls')).replace(/\D/g, '') === R && /50 \/ 50/.test(await p.textContent('#rollCount')), 'dice: 8 taps on the die faces and 42 typed rolls are in the box (50 / 50)');
  await forge(h, '#forgeBtn');
  const r = await afterForge(t, h, 'dice', hashWords(R, 12));
  if (r) await printChecks(t, h, 'dice', r.words);
  noErrors(t, h, 'dice');
};
G['make:dice24'] = async (t, h) => {
  const { p } = h, R = rolls(99);
  await toMethod(h, 'mt-dice');
  await p.selectOption('#wordSel', '24');
  for (const d of R.slice(0, 4)) await press(h, p.locator(`#tapRow button[data-v="${d}"]`));
  await typeAtEnd(p.locator('#rolls'), R.slice(4));
  await forge(h, '#forgeBtn');
  const r = await afterForge(t, h, 'dice, 24 words', hashWords(R, 24), 24);
  if (r) await printChecks(t, h, 'dice, 24 words', r.words);
  noErrors(t, h, 'dice, 24 words');
};
G['make:coin'] = async (t, h) => {
  const { p } = h, R = rolls(128, 2);
  await toMethod(h, 'mt-coin');
  await until(() => p.locator('#tapRow button[data-v="0"]').isVisible(), 10000);
  for (const d of R.slice(0, 8)) await press(h, p.locator(`#tapRow button[data-v="${d}"]`));   // HEADS = 1 / TAILS = 0
  await typeAtEnd(p.locator('#rolls'), R.slice(8));
  await forge(h, '#forgeBtn');
  const r = await afterForge(t, h, 'coin', hashWords(R, 12));
  if (r) await printChecks(t, h, 'coin', r.words);
  noErrors(t, h, 'coin');
};
G['make:words'] = async (t, h) => {
  const { p } = h, idx = Array.from({ length: 11 }, () => randomInt(2048)), flips = rolls(7, 2);
  await toMethod(h, 'mt-words');
  // the first word with the word finder (its number, 1 to 2048) and ADD WORD; the rest typed, a few by their first 4 letters
  await p.locator('#wdFind').pressSequentially(String(idx[0] + 1));
  await until(async () => (await p.textContent('#wdFound')).includes(wordlist[idx[0]]), 10000);
  await press(h, p.locator('#wdAddBtn'));
  t((await p.inputValue('#wdWords')).trim() === wordlist[idx[0]], 'word draw: the word finder finds word ' + (idx[0] + 1) + ' (' + wordlist[idx[0]] + ') and ADD WORD puts it in the box');
  await typeAtEnd(p.locator('#wdWords'), ' ' + idx.slice(1).map((n, i) => (i % 3 === 0 && wordlist[n].length > 4 ? wordlist[n].slice(0, 4) : wordlist[n])).join(' '));
  await p.locator('#wdFlips').pressSequentially(flips);
  await until(() => p.isEnabled('#wdBtn'), 15000);
  await forge(h, '#wdBtn');
  const r = await afterForge(t, h, 'word draw', drawWords(idx, flips));
  if (r) await printChecks(t, h, 'word draw', r.words);
  noErrors(t, h, 'word draw');
};
G['make:cards'] = async (t, h) => {
  const { p } = h, cards = deck().slice(0, 30);
  await toMethod(h, 'mt-cards');
  for (const c of cards.slice(0, 5)) await press(h, p.locator(`#cdGrid button[data-c="${cardSym(c)}"]`));   // the first cards on the card picker
  await typeAtEnd(p.locator('#cdCards'), ' ' + cards.slice(5).map(cardText).join(' '));
  await until(() => p.isEnabled('#cdBtn'), 15000);
  t(/Enough cards: 30/.test(await p.textContent('#cdCount')), 'cards: 5 cards tapped on the card picker and 25 typed: "' + (await p.textContent('#cdCount')).slice(0, 60) + '"');
  await forge(h, '#cdBtn');
  const r = await afterForge(t, h, 'cards', hashWords(cards.map(cardSym).join(' '), 12));
  if (r) await printChecks(t, h, 'cards', r.words);
  noErrors(t, h, 'cards');
};
G['make:hex'] = async (t, h) => {
  const { p } = h, hex = Buffer.from(Array.from({ length: 16 }, () => randomInt(256))).toString('hex');
  await toMethod(h, 'mt-cards');
  await press(h, p.locator('#cdHexBox > summary'));
  await p.locator('#cdHex').pressSequentially(hex);
  await until(() => p.isEnabled('#cdHexBtn'), 15000);
  await forge(h, '#cdHexBtn');
  const r = await afterForge(t, h, 'hex', mnemonicOf(Buffer.from(hex, 'hex')));
  if (r) await printChecks(t, h, 'hex', r.words);
  noErrors(t, h, 'hex');
};
// Damascus with the person's own dice and cards: the first throws on the die faces, the first cards on the card picker, the rest
// typed (pairs, and one deck a line), then FORGE SEED under the steps. This is where the owner saw the words land above the screen.
async function dmOwn(t, h) {
  const { p } = h, S = DM.sheet(), toks = S.pairs.map(([a, b]) => '' + a + b);
  await toMethod(h, 'mt-damascus');
  await until(() => p.locator('#dmDicePad button').first().isVisible(), 10000);
  for (const tk of toks.slice(0, 3)) for (const d of tk) await press(h, p.locator('#dmDicePad button').nth(+d - 1));   // two taps a pair
  await typeAtEnd(p.locator('#dmDice'), ' ' + toks.slice(3).join(' '));
  t((await p.inputValue('#dmDice')).trim().split(/\s+/).join(' ') === toks.join(' '), 'Damascus: 3 pairs tapped on the die faces and ' + (toks.length - 3) + ' typed are in the Hammer box');
  await press(h, p.locator('#dmFBar button[data-ds="2"]'));   // step 2, the Anvil
  await until(() => p.locator('#dmCardGrid button').first().isVisible(), 10000);
  for (const c of S.decks[0].slice(0, 4)) await press(h, p.locator(`#dmCardGrid button[data-c="${cardSym(c)}"]`));
  await typeAtEnd(p.locator('#dmCards'), ' ' + S.decks[0].slice(4).map(cardText).join(' ') + '\n' + S.decks[1].map(cardText).join(' ') + '\n' + S.decks[2].map(cardText).join(' '));
  const ready = await until(() => p.isEnabled('#dmBtn'), 30000);
  t(ready && /Ready/.test(await p.textContent('#dmReady')), 'Damascus: with the dice and 3 decks of cards in, FORGE SEED is on and the Ready line shows ("' + (await p.textContent('#dmReady')).slice(0, 70) + '")');
  await forge(h, '#dmBtn');
  return S;
}
G['make:damascus'] = async (t, h) => {
  const S = await dmOwn(t, h);
  const r = await afterForge(t, h, 'Damascus (own dice and cards)', S.words);
  if (r) {
    const banner = await h.p.evaluate(() => { const b = document.getElementById('ssfBan'); return b.style.display !== 'none' && b.textContent; });
    t(!banner, 'Damascus (own dice and cards): no PRACTICE banner on a seed of one\'s own');
    await printChecks(t, h, 'Damascus (own dice and cards)', r.words);
  }
  noErrors(t, h, 'Damascus');
};

// ================================================================ the follow-ups, on a dice seed
G.followups = async (t, h, V) => {
  const { p } = h;
  const clean = () => p.evaluate(() => ({ words: [...document.querySelectorAll('#wordGrid .wcell')].filter((c) => !c.classList.contains('empty')).length, fp: document.getElementById('fingerprint').textContent, addr: document.getElementById('address').textContent,
    res: document.getElementById('genResult').textContent, rolls: document.getElementById('rolls').value, count: document.getElementById('rollCount').textContent,
    boxes: ['drillBox', 'addrBox', 'seedQrBox', 'watchBox', 'bkList', 'checkGuide', 'explainBox'].map((id) => document.getElementById(id).style.display).join(','), forge: document.getElementById('forgeBtn').disabled,
    bar: document.getElementById('rhBar').classList.contains('on'), printOnly: document.getElementById('printOnly').textContent }));
  const fresh = await clean();
  const R = rolls(50);
  await toMethod(h, 'mt-dice');
  for (const d of R.slice(0, 3)) await press(h, p.locator(`#tapRow button[data-v="${d}"]`));
  await typeAtEnd(p.locator('#rolls'), R.slice(3));
  await forge(h, '#forgeBtn');
  const r = await afterForge(t, h, 'follow-ups', hashWords(R, 12));
  if (!r) return;
  const m = r.words;
  // PRINT SEED, with the paper view
  await printChecks(t, h, 'PRINT SEED', m, { media: true });
  // SeedQR and CompactSeedQR, read back from the screen
  await press(h, p.locator('#seedQrBox > summary'));
  for (const [kind, btn] of [['SeedQR', 'SHOW SEEDQR'], ['CompactSeedQR', 'SHOW COMPACTSEEDQR']]) {
    await press(h, p.locator('#seedQrBox').getByRole('button', { name: btn, exact: true }));
    const q = await until(async () => {
      if (!(await p.locator('#sqImg svg, #sqImg img, #sqImg canvas').first().isVisible())) return null;
      await p.locator('#sqImg').scrollIntoViewIfNeeded(); await settle(p, 10000);
      const img = PNG.sync.read(await p.locator('#sqImg').screenshot()); return jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
    }, 30000, 300);
    const want = kind === 'SeedQR' ? seedQrDigits(m) : entropyHex(m);
    const got = q ? (kind === 'SeedQR' ? q.data : Buffer.from(q.binaryData).toString('hex')) : '';
    t(got === want, kind + ': shown on screen and read back with jsqr: ' + (kind === 'SeedQR' ? 'the 48 digits of the words\' numbers' : 'the 16 bytes of the entropy') + ' (' + (got ? got.slice(0, 16) + '...' : 'nothing read') + ')');
  }
  // Restore drill: the words are hidden, typed back from paper, CHECK MY PAPER passes and ticks the checklist
  await press(h, p.locator('#drillBox > summary'));
  await press(h, p.locator('#drillBox').getByRole('button', { name: 'START DRILL' }));
  const hidden = await until(() => p.evaluate(() => document.body.classList.contains('drill-on') && (() => { const g = document.getElementById('wordGrid'), cs = getComputedStyle(g), r = g.getBoundingClientRect(); return cs.display === 'none' || cs.visibility === 'hidden' || cs.filter !== 'none' || r.height === 0 || [...g.querySelectorAll('.wtxt')].every((e) => getComputedStyle(e).visibility === 'hidden' || getComputedStyle(e).color === getComputedStyle(e).backgroundColor || /blur/.test(getComputedStyle(e).filter)); })()), 10000);
  t(hidden, 'Restore drill: START DRILL hides the words on the screen');
  await p.locator('#drillWords').pressSequentially(m);
  await press(h, p.locator('#drillRun').getByRole('button', { name: 'CHECK MY PAPER' }));
  const dr = await until(() => p.evaluate(() => { const s = document.getElementById('drillStatus'); return s.classList.contains('ok') ? { text: s.textContent, bk2: document.getElementById('bk2').checked } : null; }), 30000);
  t(dr && dr.bk2 && dr.text.includes(r.fp), 'Restore drill: the words typed back pass, with the fingerprint ' + r.fp + ', and the checklist ticks "Restore drill passed" (' + (dr ? dr.text.slice(0, 80) : 'no pass') + ')');
  const endBtn = p.locator('#drillRun').getByRole('button', { name: 'END DRILL, SHOW WORDS' });
  if (await endBtn.isVisible()) await press(h, endBtn);
  await until(() => p.evaluate(() => !document.body.classList.contains('drill-on')), 10000);
  // COPY FINGERPRINT, COPY ADDRESS and DOWNLOAD
  const d0 = h.dialogs.length;
  await press(h, p.locator('#genRight').getByRole('button', { name: 'COPY FINGERPRINT' }));
  await press(h, p.locator('#genRight').getByRole('button', { name: 'COPY ADDRESS' }));
  const copies = await until(() => p.evaluate(() => (window.__copies || []).length >= 2 ? window.__copies.slice() : null), 10000);
  t(copies && copies[0] === r.fp && copies[1] === r.a0 && h.dialogs.length === d0, 'COPY FINGERPRINT and COPY ADDRESS copy ' + r.fp + ' and ' + r.a0.slice(0, 14) + '..., with no error (' + JSON.stringify(copies) + ')');
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), press(h, p.locator('#genRight').getByRole('button', { name: 'DOWNLOAD', exact: true }))]);
  const file = fs.readFileSync(await dl.path(), 'utf8');
  t(dl.suggestedFilename() === 'voidforge-seed.txt' && file.startsWith(m) && file.includes(r.fp) && file.includes(r.a0) && file.includes(R), 'DOWNLOAD saves voidforge-seed.txt with the words, fingerprint, first address and the rolls');
  // re-hide on a real window blur: another page takes the focus
  await p.locator('#seedHead').scrollIntoViewIfNeeded(); await p.evaluate(() => document.getElementById('seedHead').scrollIntoView({ block: 'start' })); await settle(p);
  const before = await seedView(p);
  const cdp = await V.ctx.newCDPSession(p);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });   // real focus, not Playwright's "always focused"
  await p.bringToFront();
  const focused = await until(() => p.evaluate(() => document.hasFocus()), 15000);
  const other = await V.ctx.newPage(); await other.bringToFront();
  const rh = () => p.evaluate(() => ({ on: document.getElementById('rhBar').classList.contains('on'), shown: getComputedStyle(document.getElementById('rhBar')).display !== 'none', msg: document.getElementById('rhMsg').textContent, filter: getComputedStyle(document.getElementById('wordGrid')).filter, focus: document.hasFocus() }));
  const cov = await until(async () => { const x = await rh(); return x.on && /blur/.test(x.filter) ? x : null; }, 20000) || await rh();
  t(focused && cov.on && cov.shown && /blur/.test(cov.filter) && /lost focus|another/.test(cov.msg), 're-hide: when another window takes the focus (a real blur), the words are covered and the notice says why (' + JSON.stringify({ focused, ...cov }) + ')');
  await other.close();
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); await p.bringToFront();
  t((await rh()).on, 're-hide: coming back to the page does not uncover the words by itself');
  await press(h, p.locator('#rhShowBtn'));
  await until(async () => { const x = await rh(); return !x.on && x.filter === 'none'; }, 15000); await settle(p);
  const shown = await seedView(p);
  t(shown.words === m && shown.filter === 'none' && inView(shown) && Math.abs(shown.top - before.top) < 2, 'SHOW uncovers the words, and they are in view where they were (' + where(shown) + ')');
  await cdp.detach().catch(() => {});
  // CLEAR ALL: back to a clean page
  await press(h, p.locator('#genRight').getByRole('button', { name: 'CLEAR ALL' }));
  const wiped = await until(async () => { const c = await clean(); return c.words === 0 && c.fp === '' ? c : null; }, 20000) || await clean();
  const diff = Object.keys(fresh).filter((k) => fresh[k] !== wiped[k]);
  t(diff.length === 0, 'CLEAR ALL wipes the words, fingerprint, address, rolls and every result box: the page is as when it opened' + (diff.length ? ' (differs: ' + diff.map((k) => k + ' ' + JSON.stringify(fresh[k]) + ' -> ' + JSON.stringify(wiped[k])).join('; ') + ')' : ''));
  t(await p.evaluate(() => (window.__copies || []).slice(-1)[0] === ''), 'CLEAR ALL also empties the (stand-in) clipboard');
  noErrors(t, h, 'follow-ups');
};

// ================================================================ CHECK A BACKUP
async function checkWords(t, h, m, label) {
  const { p } = h, fp = fpOf(m);
  if (!await toTab(t, h, 'check', label)) return null;
  await p.locator('#phrase').pressSequentially(m);
  await p.locator('#verifyRecorded').pressSequentially(fp);
  await until(() => p.isEnabled('#verifyBtn'), 15000);
  await press(h, p.locator('#verifyBtn'));
  const v = await until(() => p.evaluate(() => { const t = document.getElementById('verifyMatch').textContent; return /MATCH/.test(t) ? { match: t, st: document.getElementById('verifyStatus').textContent } : null; }), 60000);
  t(v && /^MATCH/.test(v.match) && v.st.includes(fp) && v.st.includes(addrOf(m, 0, 0)), label + ': VERIFY says MATCH for the fingerprint ' + fp + ', and shows it with the first address (' + (v ? v.match.slice(0, 60) : 'nothing') + ')');
  await until(() => p.locator('#walletView > summary').isVisible(), 20000);
  await press(h, p.locator('#walletView > summary'));
  const w = await until(() => p.evaluate(() => { const li = [...document.querySelectorAll('#wvList li')]; return li.length >= 20 ? { fp: document.getElementById('wvFp').textContent, li: li.map((l) => (l.textContent.match(/(bc1|tb1)[0-9a-z]+/) || [''])[0]) } : null; }), 60000);
  const recv = Array.from({ length: 10 }, (_, i) => addrOf(m, 0, i)), chg = Array.from({ length: 10 }, (_, i) => addrOf(m, 1, i));
  t(w && w.li.length === 20 && w.fp.includes(fp) && recv.every((a) => w.li.includes(a)) && chg.every((a) => w.li.includes(a)), label + ': Open this wallet shows fingerprint ' + fp + ' and the 10 receive and 10 change addresses @scure gives (m/84\'/0\'/0\'/0/0-9 and 1/0-9)' + (w ? '' : ': nothing shown'));
  t(w && w.li.slice(0, 10).join() === recv.join() && w.li.slice(10).join() === chg.join(), label + ': in order, receive 0 to 9 first, then change 0 to 9');
  return w;
}
G.check = async (t, h) => {
  const m = hashWords(rolls(50), 12);   // words of one's own, as written on paper
  await checkWords(t, h, m, 'CHECK A BACKUP');
  const s = await h.p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  t(s.sw <= s.cw, 'CHECK A BACKUP: no sideways scroll (' + s.sw + ' / ' + s.cw + ')');
  noErrors(t, h, 'CHECK A BACKUP');
};

// ================================================================ the practice signer (as tests/simulator.test.mjs drives it)
// A probe (observation only) notes when the device waits for a key; a key tap is pointerdown + pointerup on the device's own
// button, and after each tap the helper waits until the device took it and waits for the next key (a tap a busy device dropped
// is tapped again). The same waiting approach as tests/simulator.test.mjs, so no fixed waits.
function pageProbe() {
  if (window.__ssw) return;
  const w = window.__ssw = { tick: 0, in: false, enter: 0, keys: [], ret: null, low: null, hb: null };
  const P = SSHardwareButtons.prototype, wf = P.wait_for;
  P.wait_for = async function (keys) {
    const me = ++w.tick; w.in = true; w.enter = me; w.keys = keys || [];
    try { const r = await wf.call(this, keys); if (r !== SSHardwareButtonsConstants.OVERRIDE && w.ret === null) w.ret = ++w.tick; return r; }
    finally { if (w.enter === me) w.in = false; }
  };
  for (const f of ['check_for_low', 'has_any_input']) { const o = P[f]; P[f] = function (...a) { const r = o.apply(this, a); if (r && w.low === null) w.low = ++w.tick; return r; }; }
  window.__ssIdle = () => {
    const hb = SSHardwareButtons._instance; if (!w.in || !hb) return false;
    const now = Date.now();
    for (const k of SSHardwareButtonsConstants.ALL_KEYS) if (hb._held[k] || (hb._pending[k] && now - hb._pend_at[k] < SS_KEY_LATCH_MS)) return false;
    return true;
  };
  window.__ssMark = (key) => { w.ret = null; w.low = null; w.hb = SSHardwareButtons._instance; return w.hb ? (w.hb._down_at[key] ?? -1) : null; };
  window.__ssClick = (id) => {
    const b = document.getElementById(id), r = b.getBoundingClientRect();
    if (!r.width || !r.height) throw new Error('the device key ' + id + ' is not on screen');
    const o = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    b.dispatchEvent(new PointerEvent('pointerdown', o)); b.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
  };
  window.__ssTapState = (key, before) => {
    const hb = w.hb, c = SSController._instance, now = Date.now(), down = hb ? hb._down_at[key] : undefined;
    if (!hb || down === undefined || down === before) return 'lost';
    if (hb.cur_input === key && hb.cur_input_started >= down) return w.ret !== null && w.in && w.enter > w.ret && window.__ssIdle() ? 'settled' : 'busy';
    if (w.low !== null) return w.in && !(c && c.is_screensaver_running) && window.__ssIdle() ? 'settled' : 'busy';
    if (hb._held[key] || now - down < SS_KEY_LATCH_MS || (hb._pending[key] && now - hb._pend_at[key] < SS_KEY_LATCH_MS)) return 'waiting';
    return w.in && SSHardwareButtons._instance === hb && !w.keys.includes(key) ? 'ignored' : 'lost';
  };
}
const KEYID = { UP: 'ssKUp', DOWN: 'ssKDown', LEFT: 'ssKLeft', RIGHT: 'ssKRight', PRESS: 'ssKPress', K1: 'ssK1', K2: 'ssK2', K3: 'ssK3' };
const HWKEY = { UP: 'KEY_UP', DOWN: 'KEY_DOWN', LEFT: 'KEY_LEFT', RIGHT: 'KEY_RIGHT', PRESS: 'KEY_PRESS', K1: 'KEY1', K2: 'KEY2', K3: 'KEY3' };
function device(page) {
  const d = {
    idle: (ms = 60000) => until(() => page.evaluate(() => !!(window.__ssIdle && window.__ssIdle())), ms, 25),
    async press(k) {
      const key = HWKEY[k];
      for (let n = 0; n < 6; n++) {
        await d.idle(60000);
        const before = await page.evaluate((key) => window.__ssMark(key), key);
        if (before === null) return 'off';
        await page.evaluate((id) => window.__ssClick(id), KEYID[k]);
        const t0 = Date.now(); let r;
        for (;;) { r = await page.evaluate(([key, before]) => window.__ssTapState(key, before), [key, before]); if (r === 'settled' || r === 'ignored' || r === 'lost' || Date.now() - t0 > 90000) break; await sleep(20); }
        if (r === 'lost') continue;
        return r;
      }
      throw new Error('the device never took ' + k + ' (6 taps), at ' + JSON.stringify(await d.state()));
    },
    state: () => page.evaluate(() => {
      const c = SSController._instance; if (!c) return null;
      const x = c.current_destination, v = x && x.view, s = v && v.screen;
      return { view: x && x.View_cls && x.View_cls.name, screen: s && s.constructor.name, title: s && s.title, sel: s && s.selected_button,
        labels: s && s.button_data ? s.button_data.map((b) => typeof b === 'string' ? b : (b && (b.button_label || b.label))) : null };
    }),
    async waitView(name, ms = 120000) {
      const t = Date.now(); let s;
      while (Date.now() - t < ms) { s = await d.state(); if (s && (s.view === name || s.screen === name)) { await d.idle(30000); const s2 = await d.state(); return s2 && (s2.view === name || s2.screen === name) ? s2 : s; } await sleep(100); }
      throw new Error('timeout waiting for ' + name + ', at ' + JSON.stringify(s));
    },
    kbInfo: () => page.evaluate(() => { const kb = SSController._instance.current_destination.view.screen.keyboard; return { sel: [kb.selected_key.x, kb.selected_key.y] }; }),
    async kbGo(tx, ty) {
      for (let n = 0; n < 40; n++) {
        const { sel } = await d.kbInfo();
        if (sel[1] < ty) await d.press('DOWN'); else if (sel[1] > ty) await d.press('UP');
        else if (sel[0] < tx) await d.press('RIGHT'); else if (sel[0] > tx) await d.press('LEFT');
        else { await d.press('PRESS'); return; }
      }
      throw new Error('keyboard stuck');
    },
    async pick(re) {
      for (let n = 0; n < 30; n++) {
        const s = await d.state(); const i = (s.labels || []).findIndex((l) => re.test(l || ''));
        if (i < 0) throw new Error('no button ' + re + ' in ' + JSON.stringify(s));
        if (s.sel === i) { await d.press('PRESS'); return; }
        if (s.screen === 'SSMainMenuScreen' || s.screen === 'SSLargeButtonScreen') {
          const [cx, cy] = [s.sel % 2, Math.floor(s.sel / 2)], [tx, ty] = [i % 2, Math.floor(i / 2)];
          if (s.sel === 1000 || s.sel === null) await d.press('DOWN'); else if (cy < ty) await d.press('DOWN'); else if (cy > ty) await d.press('UP'); else if (cx < tx) await d.press('RIGHT'); else await d.press('LEFT');
        } else await d.press(s.sel > i ? 'UP' : 'DOWN');
      }
      throw new Error('stuck at ' + re);
    },
  };
  return d;
}
// Tools > New seed (dice) > 12 words, the rolls on the device's dice keyboard; returns the words the device shows
async function deviceDice(d, R) {
  await d.waitView('SSMainMenuView'); await d.pick(/^Tools$/);
  await d.press('DOWN'); await d.press('PRESS');   // the second "New seed" is the dice one
  await d.pick(/12 words/);
  await d.waitView('SSToolsDiceEntropyEntryScreen');
  for (const r of R) { const k = +r - 1; await d.kbGo(k % 3, Math.floor(k / 3)); }
  await d.waitView('SSSeedWordsWarningView'); await d.press('PRESS');
  const words = [];
  for (let n = 0; n < 3; n++) { await d.waitView('SSSeedWordsScreen'); words.push(...await d.page.evaluate(() => SSController._instance.current_destination.view.screen.words)); await d.press('PRESS'); }
  await d.waitView('SSSeedWordsBackupTestPromptView'); await d.pick(/Skip/);
  await d.waitView('SSSeedFinalizeView'); await d.pick(/^Done$/); await d.waitView('SSSeedOptionsView');
  return words.join(' ');
}
async function openSigner(h) {
  const { p } = h;
  await p.evaluate(pageProbe);
  await press(h, p.locator('#ssPromoBtn'));   // OPEN PRACTICE SIGNER, in the start row under the header
  const d = device(p); d.page = p;
  await d.waitView('SSMainMenuView');
  return d;
}
G.signer = async (t, h) => {
  const { p } = h;
  const d = await openSigner(h);
  const o = await p.evaluate(() => ({ tab: document.getElementById('tab-check').getAttribute('aria-selected') === 'true', open: document.getElementById('ssBox').open }));
  t(o.tab && o.open, 'practice signer: OPEN PRACTICE SIGNER opens CHECK A BACKUP and the signer, and the device starts on Home');
  const R = '615243'.repeat(9).slice(0, 50);   // no roll repeats the one before (two quick taps of one key could read as a hold)
  const m = await deviceDice(d, R);
  t(m === hashWords(R, 12), 'practice signer: 50 rolls on the device\'s keys make the 12 words SeedSigner makes (SHA-256 of the rolls): ' + m.split(' ').slice(0, 3).join(' ') + ' ...');
  await p.locator('#ssForgeBtn').scrollIntoViewIfNeeded();
  await press(h, p.locator('#ssForgeBtn'));   // FORGE SEED below the device
  const r = await afterForge(t, h, 'practice signer FORGE SEED', m);
  if (r) {
    const c = await p.evaluate(() => document.getElementById('ssfCheck').textContent);
    t(c.includes(r.fp) && /the same/.test(c), 'practice signer FORGE SEED: the device\'s fingerprint and the page\'s are the same ' + r.fp + ' ("' + c.slice(0, 90) + '...")');
  }
  noErrors(t, h, 'practice signer');
};

// ================================================================ NEW in v2.16.1 (written for the behavior the owner asked for)
// Damascus practice goes the way a real seed goes: FORGE SEED on, the seed under YOUR SEED in view, a red PRACTICE banner naming
// the sheet, and the printed sheet says PRACTICE.
async function practiceForge(t, h, label, nameRe, expected) {
  const { p } = h;
  const on = await until(() => p.isEnabled('#dmBtn'), 20000);
  if (!t(on, label + ': FORGE SEED is on for the practice sheet (' + (await p.textContent('#dmReady')).slice(0, 90) + ')')) return null;
  await forge(h, '#dmBtn');
  const r = await afterForge(t, h, label, expected);
  if (!r) return null;
  const b = await p.evaluate(() => { const e = document.getElementById('ssfBan'), cs = getComputedStyle(e), r = e.getBoundingClientRect(); const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).map(Number);
    const bg = rgb(cs.backgroundColor), fg = rgb(cs.color), bc = rgb(cs.borderTopColor), red = (c) => c.length >= 3 && c[0] > 150 && c[0] > 1.6 * c[1] && c[0] > 1.6 * c[2] && (c[3] === undefined || c[3] > 0);
    return { shown: cs.display !== 'none' && r.height > 0, text: e.textContent, red: red(bg) || red(fg) || red(bc), inView: r.top >= 0 && r.bottom <= innerHeight }; });
  t(b.shown && b.red && /PRACTICE/.test(b.text) && nameRe.test(b.text) && b.inView, label + ': a red PRACTICE banner names the sheet, in view with the words ("' + b.text.slice(0, 110) + '")');
  const pr = await printChecks(t, h, label, r.words);
  if (pr) t(/PRACTICE/.test(pr.title + '\n' + pr.warn) && nameRe.test(pr.warn + pr.text), label + ': the printed sheet carries a PRACTICE line naming the sheet (' + pr.title + ' / ' + pr.warn.slice(0, 80) + ')');
  return r;
}
async function toDamascus(h) { await toMethod(h, 'mt-damascus'); await until(() => h.p.locator('#dmPracticeBtn').isVisible(), 10000); }
const boxesWords = async (p) => { const dice = await p.inputValue('#dmDice'), cards = await p.inputValue('#dmCards'); try { return DM.words(DM.diceBits(DM.parsePairs(dice)), DM.cardBits(DM.parseDecks(cards)).bits); } catch (e) { return null; } };
G['new:damascus-practice-sheet'] = async (t, h) => {
  await toDamascus(h);
  await press(h, h.p.locator('#dmPracticeBtn'));   // FILL IN A PRACTICE SHEET
  await until(async () => (await h.p.inputValue('#dmCards')).length > 100, 20000);
  const n = await h.p.textContent('#dmPracticeBan'), sheet = (n.match(/practice (\d+)/) || [])[1];
  await practiceForge(t, h, 'practice sheet ' + sheet, new RegExp('practice sheet ' + sheet + '\\b', 'i'), await boxesWords(h.p));
  noErrors(t, h, 'practice sheet');
};
G['new:damascus-guided-practice'] = async (t, h) => {
  const { p } = h;
  await toDamascus(h);
  await press(h, p.locator('#dmTourBtn'));   // GUIDED PRACTICE: NEXT through every part
  await until(() => p.locator('#dmTourNext').isVisible(), 15000);
  let parts = 1, last = '';
  for (let i = 0; i < 20; i++) {
    const txt = await p.textContent('#dmTourText'); if (txt === last) break; last = txt;
    if (!(await p.locator('#dmTourNext').isVisible()) || !(await p.isEnabled('#dmTourNext'))) break;
    await press(h, p.locator('#dmTourNext')); parts++;
    await until(async () => (await p.textContent('#dmTourText')) !== txt, 3000, 50);
  }
  const sheet = ((await p.textContent('#dmPracticeBan')).match(/practice (\d+)/) || [])[1];
  t(parts >= 12 && !!sheet, 'guided practice: NEXT walks through the ' + parts + ' parts of practice sheet ' + sheet);
  await practiceForge(t, h, 'guided practice (sheet ' + sheet + ')', new RegExp('practice sheet ' + sheet + '\\b', 'i'), await boxesWords(p));
  noErrors(t, h, 'guided practice');
};
G['new:damascus-worked-example'] = async (t, h) => {
  const { p } = h;
  await toDamascus(h);
  await press(h, p.locator('#dmExBox > summary'));
  await press(h, p.locator('#dmEx1'));   // LOAD EXAMPLE 1
  const r = await practiceForge(t, h, 'worked example 1', /worked example 1\b/i, EX1);
  if (r) t(r.fp === '70b5da37', 'worked example 1: fingerprint 70b5da37, as published');
  noErrors(t, h, 'worked example');
};
// LOAD INTO THE PRACTICE SIGNER, under YOUR SEED: one click, and the device loads the seed by itself
async function loadIntoSigner(t, h, label, m) {
  const { p } = h, fp = fpOf(m);
  await p.evaluate(pageProbe);
  const btn = p.locator('#genRight').getByRole('button', { name: 'LOAD INTO THE PRACTICE SIGNER' });
  const there = await until(() => btn.isVisible(), 15000);
  if (!t(there, label + ': LOAD INTO THE PRACTICE SIGNER is under YOUR SEED')) return;
  await press(h, btn);
  const d = device(p);
  const s = await until(async () => { const x = await d.state(); return x && x.view === 'SSSeedOptionsView' && x.title ? x : null; }, 240000, 250);
  const st = await p.evaluate(() => ({ tab: document.getElementById('tab-check').getAttribute('aria-selected') === 'true', open: document.getElementById('ssBox').open, say: (document.getElementById('ssLoadStatus') || {}).textContent || '', pageFp: (document.getElementById('fingerprint').textContent.match(/[0-9a-f]{8}/) || [''])[0] }));
  t(st.tab && st.open && s && s.title === fp && st.pageFp === fp, label + ': one click opens the practice signer and it loads the seed by itself: the device shows fingerprint ' + (s ? s.title : 'none') + ', the page shows ' + st.pageFp + ', @scure gives ' + fp + (st.say ? ' ("' + st.say.slice(0, 80) + '")' : ''));
  const seeds = await p.evaluate((m) => { const c = SSController._instance, sd = c && c._storage && c._storage.seeds; return sd ? sd.filter((x) => x && x.mnemonic_str === m).length : 0; }, m);
  t(seeds === 1, label + ': the device holds the seed once, as after a person\'s own scan');
}
G['new:load-own-seed'] = async (t, h) => {
  const { p } = h, R = rolls(50);
  await toMethod(h, 'mt-dice');
  await typeAtEnd(p.locator('#rolls'), R);
  await forge(h, '#forgeBtn');
  const r = await afterForge(t, h, 'own dice seed', hashWords(R, 12));
  if (r) await loadIntoSigner(t, h, 'own dice seed', r.words);
  noErrors(t, h, 'load own seed');
};
G['new:load-practice-seed'] = async (t, h) => {
  const { p } = h;
  await toDamascus(h);
  await press(h, p.locator('#dmPracticeBtn'));
  await until(async () => (await p.inputValue('#dmCards')).length > 100, 20000);
  const on = await until(() => p.isEnabled('#dmBtn'), 20000);
  if (!t(on, 'practice seed: FORGE SEED is on for a practice sheet')) return;
  await forge(h, '#dmBtn');
  const r = await afterForge(t, h, 'practice seed', await boxesWords(p));
  if (r) await loadIntoSigner(t, h, 'practice seed', r.words);
  noErrors(t, h, 'load practice seed');
};
// The practice tools take the person's own words. These look for the way the page offers it (a choice or box for "my own words"),
// then check what a person would: their own words pass, and the fingerprints are their own.
async function ownSeed(h) {
  const { p } = h, R = rolls(50);
  await toMethod(h, 'mt-dice'); await typeAtEnd(p.locator('#rolls'), R); await forge(h, '#forgeBtn');
  // wait for the seed itself (on a busy machine FORGE SEED can take longer than 90 s); the next tab is pressed as soon as the words
  // and first address show, as a person would, and toTab checks the page leaves it open while FORGE SEED finishes (v2.16.1)
  const s = await waitSeed(p, 12, 600000); return s ? s.words : hashWords(R, 12);
}
async function chooseOwn(h, box) {   // a visible control in the box that says it uses my own words / my seed, if there is one
  const { p } = h;
  const c = p.locator(`#${box} :is(button, label, option)`).filter({ hasText: /\bown (words|seed)\b|\b(my|your) (own )?(words|seed)\b/i });
  const n = await c.count();
  for (let i = 0; i < n; i++) { const e = c.nth(i); if (await e.isVisible()) { const tag = await e.evaluate((x) => x.tagName); if (tag === 'OPTION') { const sel = e.locator('xpath=..'); await sel.selectOption({ label: (await e.textContent()).trim() }); } else await press(h, e); return true; } }
  return false;
}
async function ownWordsBox(h, box, skip) {   // a visible words box in the section, other than the ones it always had
  const { p } = h; const all = p.locator(`#${box} textarea, #${box} input[type="text"]`); const n = await all.count();
  for (let i = 0; i < n; i++) { const e = all.nth(i); const id = await e.getAttribute('id'); if (!skip.includes(id) && await e.isVisible()) return e; }
  return null;
}
G['new:practice-backup-own-words'] = async (t, h) => {
  const { p } = h, m = await ownSeed(h);
  if (!await toTab(t, h, 'check', 'Practice making a backup', { forge: true })) return;
  await p.locator('#practiceBox > summary').scrollIntoViewIfNeeded(); await press(h, p.locator('#practiceBox > summary'));
  const chose = await chooseOwn(h, 'practiceBox');
  const box = await ownWordsBox(h, 'practiceBox', ['prInput']);
  if (box) await box.pressSequentially(m);
  await press(h, p.locator('#prStart'));
  await until(() => p.locator('#prHide').isVisible(), 15000);
  const shown = (await p.locator('#prWords li').allTextContents()).map((x) => x.trim()).join(' ');
  t(shown === m, 'Practice making a backup: with my own seed made, START PRACTICE ' + (chose ? '(after choosing my own words) ' : '') + 'has me write my own words (shown: ' + shown.split(' ').slice(0, 3).join(' ') + ' ...)');
  await press(h, p.locator('#prHide'));
  await p.locator('#prInput').pressSequentially(m);
  await press(h, p.locator('#prCheckBtn'));
  const st = await until(() => p.evaluate(() => { const s = document.getElementById('prStatus'); return s.textContent ? { ok: /\bok\b/.test(s.className), text: s.textContent } : null; }), 15000);
  t(st && st.ok, 'Practice making a backup: my own words typed back from paper pass (' + (st ? st.text.slice(0, 80) : 'no answer') + ')');
  noErrors(t, h, 'practice backup');
};
G['new:practice-passphrase-own-words'] = async (t, h) => {
  const { p } = h, m = await ownSeed(h), pass = 'Tr0ubad0r & 3';
  if (!await toTab(t, h, 'tools', 'Practice your passphrase', { forge: true })) return;
  await p.locator('#ppBox > summary').scrollIntoViewIfNeeded(); await press(h, p.locator('#ppBox > summary'));
  const chose = await chooseOwn(h, 'ppBox');
  const box = await ownWordsBox(h, 'ppBox', ['ppA', 'ppB']);
  if (box) await box.pressSequentially(m);
  await p.locator('#ppA').pressSequentially(pass); await p.locator('#ppB').pressSequentially(pass);
  await press(h, p.locator('#ppBtn'));
  const fp = await until(() => p.evaluate(() => (document.getElementById('ppFp').textContent.match(/[0-9a-f]{8}/) || [null])[0]), 30000);
  const want = fpOf(m, pass);
  t(fp === want, 'Practice your passphrase: with my own words' + (box ? ' typed in' : chose ? ' chosen' : '') + ', MATCH shows the fingerprint of my words with this passphrase, ' + want + ' (shown: ' + fp + '; the public test seed would give ' + fpOf('abandon '.repeat(11) + 'about', pass) + ')');
  noErrors(t, h, 'practice passphrase');
};
G['new:practice-wallet-own-words'] = async (t, h) => {
  const { p } = h, m = await ownSeed(h);
  if (!await toTab(t, h, 'check', 'OPEN A PRACTICE WALLET', { forge: true })) return;
  await p.locator('#phrase').pressSequentially(m);   // my own words in Check your words
  t((await p.inputValue('#phrase')).trim() === m, 'my own words are in the CHECK A BACKUP box, as typed');
  await p.locator('#practiceBox > summary').scrollIntoViewIfNeeded(); await press(h, p.locator('#practiceBox > summary'));
  await chooseOwn(h, 'practiceBox');
  await press(h, p.locator('#prWalletBtn'));   // OPEN A PRACTICE WALLET
  // v2.16.1 review (tester T3): it says where it opened and that practice mode is on for the whole page, and scrolls to the wallet
  const said = await until(() => p.evaluate(() => { const s = document.getElementById('prWalletStatus').textContent, wv = document.getElementById('walletView'), r = wv.getBoundingClientRect(), n = document.getElementById('prWalletPr');
    const x = { s, inView: wv.style.display !== 'none' && r.top < innerHeight && r.bottom > 0, note: getComputedStyle(n).display !== 'none' && /Turn practice mode off/.test(n.textContent) }; window.__prw = x; return s && x.inView ? x : null; }), 120000) || await p.evaluate(() => window.__prw);   // the scroll is smooth: wait for it
  t(said && /^Opened on the test network in CHECK A BACKUP, Open this wallet/.test(said.s) && /Practice mode is now on for the whole page/.test(said.s) && said.inView && said.note, 'OPEN A PRACTICE WALLET says where it opened and that practice mode is on for the whole page (with a link to turn it off), and shows the wallet (' + JSON.stringify(said) + ')');
  await until(() => p.locator('#walletView > summary').isVisible(), 30000);
  const open = await p.evaluate(() => document.getElementById('walletView').open);
  if (!open) await press(h, p.locator('#walletView > summary'));
  const w = await until(() => p.evaluate(() => { const li = [...document.querySelectorAll('#wvList li')]; return li.length >= 20 ? { phrase: document.getElementById('phrase').value.trim(), fp: document.getElementById('wvFp').textContent, li: li.map((l) => (l.textContent.match(/(bc1|tb1)[0-9a-z]+/) || [''])[0]) } : null; }), 60000);
  const fp = fpOf(m), t0 = addrOf(m, 0, 0, '', 1);
  t(w && w.phrase === m && w.fp.includes(fp) && w.li.includes(t0), 'OPEN A PRACTICE WALLET opens my own words on the test network: fingerprint ' + fp + ', first address ' + t0.slice(0, 14) + '... (@scure, m/84\'/1\'/0\'/0/0)' + (w ? ' (shown: ' + w.fp + ', ' + w.li[0].slice(0, 14) + '..., words ' + (w.phrase === m ? 'mine' : 'not mine: ' + w.phrase.split(' ').slice(0, 2).join(' ') + ' ...') + ')' : ''));
  noErrors(t, h, 'practice wallet');
};

// ================================================================ NEW in v2.17.0: the practice signer works for real
// new217:load-online  online (as the GitHub Pages copy): LOAD INTO THE PRACTICE SIGNER loads a Damascus practice seed with no question;
//                     a real seed (dice) asks first: Cancel loads nothing and says so in a red banner under YOUR SEED, OK loads it, and
//                     the result is a gold banner next to the device, on screen; the computer's camera is never opened
// new217:own-psbt     offline: a real seed loaded with one click; a PSBT for it (built here with @scure/btc-signer) typed into Use it
//                     for real, HOLD UP TO THE DEVICE, then the device's own keys: Scan, the seed, the review, Approve (the page's
//                     question, OK); the signed PSBT shows on the page, its signature verifies (noble), btc-signer finalizes it, COPY
//                     copies it
const { secp256k1 } = require('@noble/curves/secp256k1');
const bannerOn = (p, id) => p.evaluate((id) => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return { text: e.textContent, cls: e.className, shown: r.height > 0 && r.top >= 0 && r.bottom <= innerHeight + 1 }; }, id);
async function countCamera(p) { await p.evaluate(() => { window.__gum = 0; const md = navigator.mediaDevices; if (md && md.getUserMedia) { const g = md.getUserMedia.bind(md); md.getUserMedia = (c) => { window.__gum++; return g(c); }; } }); }
G['new217:load-online'] = async (t, h, V) => {
  const { p } = h;
  await V.ctx.setOffline(false);
  try {
    t(await p.evaluate(() => navigator.onLine) === true, 'online: this page is online');
    await countCamera(p);
    // a Damascus practice seed: no question
    await toDamascus(h); await press(h, p.locator('#dmPracticeBtn'));
    await until(async () => (await p.inputValue('#dmCards')).length > 100, 20000); await until(() => p.isEnabled('#dmBtn'), 20000);
    await forge(h, '#dmBtn'); const pr = await afterForge(t, h, 'online practice seed', await boxesWords(p));
    if (!pr) return;
    const n0 = h.dialogs.length;
    await press(h, p.locator('#genRight').getByRole('button', { name: 'LOAD INTO THE PRACTICE SIGNER' }));
    const L = await until(async () => { const b = await bannerOn(p, 'ssLoadStatus'); return /^Loaded: /.test(b.text) ? b : null; }, 240000, 250);
    t(!!L && /ss-banner ok/.test(L.cls) && L.shown && !h.dialogs.slice(n0).some((x) => /This computer is online/.test(x)), 'online: a practice seed loads with no question; the gold banner "' + (L ? L.text.slice(0, 60) : 'none') + '" is on screen next to the device');
    // a real seed from dice: the question; Cancel loads nothing (red banner under YOUR SEED, on screen), OK loads it
    await press(h, p.locator('#tab-make')); const R = rolls(50);
    await toMethod(h, 'mt-dice'); await typeAtEnd(p.locator('#rolls'), R); await forge(h, '#forgeBtn');
    const r = await afterForge(t, h, 'online real seed', hashWords(R, 12)); if (!r) return;
    h.no = /This computer is online/; const n1 = h.dialogs.length;
    await press(h, p.locator('#genRight').getByRole('button', { name: 'LOAD INTO THE PRACTICE SIGNER' }));
    const no = await until(async () => { const b = await bannerOn(p, 'seedSignerNote'); return /^Not loaded: you chose not to load your real seed/.test(b.text) ? b : null; }, 30000);
    t(!!no && /ss-banner/.test(no.cls) && /\bbad\b/.test(no.cls) && no.shown && h.dialogs.slice(n1).some((x) => /^confirm: This computer is online\. Loading your real seed into the practice signer shows it as a SeedQR/.test(x)), 'online: a real seed asks first; Cancel loads nothing, and a red banner under YOUR SEED says so, on screen (' + (no ? no.text.slice(0, 60) : 'none') + ')');
    h.no = null;
    await press(h, p.locator('#genRight').getByRole('button', { name: 'LOAD INTO THE PRACTICE SIGNER' }));
    // the device still shows the practice seed: as the banner says, the person goes back to Home with its keys, and the load goes on
    const home = await until(async () => /^Go back to Home/.test((await bannerOn(p, 'ssLoadStatus')).text), 60000);
    t(home, 'online: with the device on another screen, the page says to go back to Home');
    await p.evaluate(pageProbe); const dv = device(p);
    for (let n = 0; n < 8; n++) { const st = await dv.state(); if (!st || st.view === 'SSMainMenuView' || st.view === 'SSScanView' || /^Loaded/.test((await bannerOn(p, 'ssLoadStatus')).text)) break; await dv.press('LEFT'); await dv.press('PRESS'); }
    const ok2 = await until(async () => { const b = await bannerOn(p, 'ssLoadStatus'); return /^Loaded: the device shows the seed with fingerprint /.test(b.text) && b.text.includes(r.fp) ? b : null; }, 240000, 250);
    const last = ok2 || await bannerOn(p, 'ssLoadStatus');
    t(!!ok2 && /ss-banner ok/.test(ok2.cls) && ok2.shown, 'online: OK loads the real seed: the gold banner names fingerprint ' + r.fp + ' (@scure/bip32), on screen (' + JSON.stringify(last).slice(0, 200) + ')');
    t(await p.evaluate(() => window.__gum) === 0, 'online: the computer\'s camera is never opened by these loads');
  } finally { await V.ctx.setOffline(true); }
  noErrors(t, h, 'load online');
};
G['new217:own-psbt'] = async (t, h) => {
  const { p } = h, R = rolls(50);
  await toMethod(h, 'mt-dice'); await typeAtEnd(p.locator('#rolls'), R); await forge(h, '#forgeBtn');
  const r = await afterForge(t, h, 'own PSBT seed', hashWords(R, 12)); if (!r) return;
  await loadIntoSigner(t, h, 'own PSBT seed', r.words);
  const root = rootOf(r.words), path0 = "m/84'/0'/0'/0/1", k = root.derive(path0), H = 0x80000000, tx = new btc.Transaction();
  const pay = btc.p2wpkh(rootOf('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong').derive("m/84'/0'/0'/0/0").publicKey);
  tx.addInput({ txid: new Uint8Array(32).fill(0x2a), index: 1, witnessUtxo: { script: btc.p2wpkh(k.publicKey).script, amount: 250000n }, bip32Derivation: [[k.publicKey, { fingerprint: root.fingerprint, path: [84 + H, H, H, 0, 1] }]] });
  tx.addOutput({ script: pay.script, amount: 120000n });
  const ck = root.derive("m/84'/0'/0'/1/0"); tx.addOutput({ script: btc.p2wpkh(ck.publicKey).script, amount: 129000n, bip32Derivation: [[ck.publicKey, { fingerprint: root.fingerprint, path: [84 + H, H, H, 1, 0] }]] });
  const b64 = Buffer.from(tx.toPSBT(0)).toString('base64');
  const box = p.locator('#ssOwnIn'); await box.scrollIntoViewIfNeeded(); await box.fill(b64);
  await press(h, p.locator('#ssOwnGo'));
  const held = await until(async () => { const b = await bannerOn(p, 'ssOwnStatus'); return /^Held up to the device’s camera: your PSBT/.test(b.text) ? b : null; }, 30000);
  const warns = await p.evaluate(() => [...document.querySelectorAll('#ssOwnWarns li')].map((x) => x.textContent));
  t(!!held && warns.some((x) => x.startsWith('Seed ' + r.fp + ' can sign. The device will show 250,000 sats in from 1 input, 120,000 sats to 1 address, 129,000 sats back as change, and a fee of 1,000 sats')), 'own PSBT: HOLD UP TO THE DEVICE holds it up and the page says what the device will show (' + (warns[0] || '').slice(0, 90) + ')');
  const d = device(p);
  await p.evaluate(pageProbe);
  const s0 = await d.state(); await d.waitView(s0.view);   // the seed's own menu, after the load: Scan transaction (or Home > Scan)
  if (s0.view === 'SSSeedOptionsView') await d.pick(/^Scan transaction$/); else { await d.waitView('SSMainMenuView'); await d.pick(/^Scan$/); }
  const s1 = await until(async () => { const x = await d.state(); return x && /^SSPSBT(SelectSeed|Overview)View$/.test(x.view) ? x : null; }, 120000);
  if (s1 && s1.view === 'SSPSBTSelectSeedView') { await d.waitView('SSPSBTSelectSeedView'); await d.pick(new RegExp('^' + r.fp + '$')); }
  for (let n = 0; n < 12; n++) { const s = await d.state(); if (s && s.view === 'SSPSBTFinalizeView') break; await d.waitView(s.view); await d.press('PRESS'); }
  const n0 = h.dialogs.length; await d.waitView('SSPSBTFinalizeView'); await d.press('PRESS');
  await d.waitView('SSPSBTSignedQRDisplayView');
  t(h.dialogs.slice(n0).some((x) => /^confirm: Sign this transaction with your real seed /.test(x)), 'own PSBT: before it signs, the page asks to confirm (OK)');
  const out = await until(async () => { const x = await p.evaluate(() => { const o = document.getElementById('ssOwnOut'); return o.hidden ? null : { say: document.getElementById('ssOwnOutSay').textContent, text: document.getElementById('ssOwnOutText').value }; }); return x; }, 30000);
  let ok = false, fin = false;
  if (out) {
    const sg = btc.Transaction.fromPSBT(Buffer.from(out.text, 'base64')), ps = sg.getInput(0).partialSig || [];
    const h0 = tx.preimageWitnessV0(0, btc.OutScript.encode({ type: 'pkh', hash: btc.p2wpkh(k.publicKey).script.slice(2) }), btc.SigHash.ALL, 250000n);
    ok = ps.length === 1 && secp256k1.verify(ps[0][1].slice(0, -1), h0, k.publicKey, { prehash: false, format: 'der', lowS: true });
    try { const f = btc.Transaction.fromPSBT(tx.toPSBT(0)); f.combine(sg); f.finalize(); fin = f.extract().length > 0; } catch (e) { fin = false; }
  }
  t(!!out && /^Signed by seed /.test(out.say) && ok && fin, 'own PSBT: the signed PSBT shows on the page; its signature verifies (noble, BIP-143) and btc-signer finalizes the transaction');
  await p.evaluate(() => { window.__copies = []; }); await press(h, p.locator('#ssOwnCopy'));
  const cp = await until(() => p.evaluate(() => (window.__copies || [])[0] || null), 10000);
  t(!!out && cp === out.text, 'own PSBT: COPY copies the signed PSBT (base64)');
  noErrors(t, h, 'own PSBT');
};

// new217:fixes      (v2.17.0 review and hands-on test) offline: a real seed loaded with one click, the "Loaded" banner wholly on
//                     screen; a PSBT typed into Use it for real and HOLD UP TO THE DEVICE brings the device on screen; on a phone,
//                     the buttons under the device and LOAD INTO THE PRACTICE SIGNER are at least 40 px tall; seed words typed into
//                     the box are refused in red and the box is cleared; the note under YOUR SEED no longer says the signer loads
//                     the seed once its box is closed
G['new217:fixes'] = async (t, h) => {
  const { p } = h, R = rolls(50);
  await toMethod(h, 'mt-dice'); await typeAtEnd(p.locator('#rolls'), R); await forge(h, '#forgeBtn');
  const r = await afterForge(t, h, 'review fixes seed', hashWords(R, 12)); if (!r) return;
  if (h.mobile) {
    const hb = await p.evaluate(() => Math.round(document.getElementById('seedSignerBtn').getBoundingClientRect().height));
    t(hb >= 40, 'phone: LOAD INTO THE PRACTICE SIGNER is at least 40 px tall (' + hb + ' px)');
  }
  await loadIntoSigner(t, h, 'review fixes seed', r.words);
  const L = await until(async () => { const b = await bannerOn(p, 'ssLoadStatus'); return /^Loaded: /.test(b.text) ? b : null; }, 60000, 250);
  t(!!L && L.shown, 'the "Loaded" banner is wholly on screen (' + JSON.stringify(L).slice(0, 120) + ')');
  // a PSBT for this seed, held up: the device comes on screen
  const root = rootOf(r.words), k = root.derive("m/84'/0'/0'/0/1"), tx = new btc.Transaction();
  tx.addInput({ txid: new Uint8Array(32).fill(0x2b), index: 0, witnessUtxo: { script: btc.p2wpkh(k.publicKey).script, amount: 250000n }, bip32Derivation: [[k.publicKey, { fingerprint: root.fingerprint, path: [84 + 0x80000000, 0x80000000, 0x80000000, 0, 1] }]] });
  tx.addOutput({ script: btc.p2wpkh(rootOf('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong').derive("m/84'/0'/0'/0/0").publicKey).script, amount: 249000n });
  const box = p.locator('#ssOwnIn'); await box.scrollIntoViewIfNeeded(); await box.fill(Buffer.from(tx.toPSBT(0)).toString('base64'));
  await press(h, p.locator('#ssOwnGo'));
  const held = await until(() => p.evaluate(() => /^Held up to the device’s camera: your PSBT/.test(document.getElementById('ssOwnStatus').textContent)), 30000);
  await sleep(800);   // the scroll settles
  const dv = await p.evaluate(() => { const r2 = document.getElementById('ssDevice').getBoundingClientRect(); return { top: Math.round(r2.top), bottom: Math.round(r2.bottom), vh: innerHeight }; });
  t(held && dv.top >= 0 && dv.bottom <= dv.vh + 1, 'HOLD UP TO THE DEVICE brings the device on screen (' + JSON.stringify(dv) + ')');
  if (h.mobile) {
    const hs = await p.evaluate(() => ['ssOwnFileBtn', 'ssOwnClear', 'cam-ssOwnIn', 'ssMsgGo', 'ssLearnGo', 'ssLearnCamOff', 'ssTxGo', 'ssForgeBtn'].map((id) => { const e = document.getElementById(id); return [id, e && e.offsetParent ? Math.round(e.getBoundingClientRect().height) : -1]; }));
    t(hs.every(([, x]) => x >= 40), 'phone: the buttons under the device are at least 40 px tall (' + hs.map((x) => x.join(' ')).join(', ') + ')');
  }
  // seed words typed into the box: refused in red, the box cleared
  await box.scrollIntoViewIfNeeded(); await box.fill(r.words.split(' ').map((x, i) => (i + 1) + ') ' + x).join(', ')); await press(h, p.locator('#ssOwnGo'));
  const no = await until(async () => { const b = await bannerOn(p, 'ssOwnStatus'); return /^Not held up/.test(b.text) ? b : null; }, 15000);
  t(!!no && /\bbad\b/.test(no.cls) && await p.inputValue('#ssOwnIn') === '' && !r.words.split(' ').slice(0, 3).some((x) => no.text.includes(' ' + x + ',')), 'seed words typed into the box are refused in red and the box is cleared (' + (no ? no.text.slice(0, 70) : 'none') + ')');
  // the box closed: the note under YOUR SEED no longer says the signer loads this seed
  await p.evaluate(() => { document.getElementById('ssBox').open = false; });
  await press(h, p.locator('#tab-make'));
  const note = await until(() => p.evaluate(() => !/loads this seed by itself/.test(document.getElementById('seedSignerNote').textContent)), 10000);
  t(note, 'with the practice signer switched off, the note under YOUR SEED no longer says it loads the seed');
  noErrors(t, h, 'review fixes');
};
// ================================================================ run
const ORDER = ['make:dice', 'make:coin', 'make:words', 'make:cards', 'make:hex', 'make:damascus', 'make:dice24', 'followups', 'check', 'signer',
  'new:damascus-practice-sheet', 'new:damascus-guided-practice', 'new:damascus-worked-example', 'new:load-own-seed', 'new:load-practice-seed',
  'new:practice-backup-own-words', 'new:practice-passphrase-own-words', 'new:practice-wallet-own-words', 'new217:load-online', 'new217:own-psbt', 'new217:fixes'];
const pick = process.env.E2E_GROUPS ? process.env.E2E_GROUPS.split(',') : null;   // a group's name, or the part before its colon (new, make)
const wantGroups = ORDER.filter((g) => (!pick || pick.some((e) => g === e || g.startsWith(e + ':'))) && !(process.env.E2E_SKIP_NEW && NEW(g)));
const wantViews = process.env.E2E_VIEWS ? process.env.E2E_VIEWS.split(',') : Object.keys(VIEWS);
const times = {};
async function runView(view) {
  // "chromium" is the full browser in headless mode: it moves the focus between pages for real (the headless shell does not),
  // which the re-hide check needs. One browser per size, one context each.
  let browser;
  try { browser = await pw.chromium.launch({ channel: 'chromium' }); } catch (e) { browser = await pw.chromium.launch(); console.log('(' + view + ': the full Chromium did not start, so the headless shell is used; a real window blur may not happen there)'); }
  const v = VIEWS[view];
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: 1, isMobile: v.mobile, hasTouch: v.mobile });
  await ctx.setOffline(true);   // VOIDFORGE is used offline (and the practice signer reads a SeedQR only offline)
  await ctx.addInitScript(CLIP);
  const V = { ctx, view };
  for (const g of wantGroups) {
    const t = reporter(view, g), t1 = Date.now(); let h = null;
    try {
      h = await openPage(V, view);
      await Promise.race([G[g](t, h, V), new Promise((_, rej) => setTimeout(() => rej(new Error('the group took over 8 minutes')), 480000))]);
    } catch (e) { t(false, 'the group stopped: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' | ').slice(0, 400)); }
    try { if (h) await h.p.close(); } catch (e) { /* closed */ }
    for (const pg of ctx.pages()) await pg.close().catch(() => {});
    times[view + ' ' + g] = Math.round((Date.now() - t1) / 1000);
  }
  await browser.close();
}
try { await pw.chromium.executablePath(); } catch (e) { console.log('E2E: SKIPPED (no Chromium)'); process.exit(0); }
await Promise.all(wantViews.filter((v) => VIEWS[v]).map(runView));

// summary: each group, each size
console.log('\n---- by group (desktop / phone) ----');
for (const g of wantGroups) {
  const line = wantViews.map((v) => { const rs = results.filter((r) => r.group === g && r.view === v); const f = rs.filter((r) => !r.ok).length; return v + ' ' + (f ? 'FAIL ' + f + '/' + rs.length : 'pass ' + rs.length); }).join(', ');
  console.log((NEW(g) ? 'NEW in v2.16.1: ' : '') + g + ': ' + line + ' (' + wantViews.map((v) => times[v + ' ' + g] + 's').join(' / ') + ')');
}
const fails = results.filter((r) => !r.ok), pass = results.length - fails.length;
const newFails = fails.filter((r) => NEW(r.group)), oldFails = fails.filter((r) => !NEW(r.group));
if (fails.length) {
  console.log('\nFAILED:');
  for (const f of oldFails) console.log(' - [' + f.view + '][' + f.group + '] ' + f.msg);
  if (newFails.length) { console.log(' NEW in v2.16.1 (expected to fail until the v2.16.1 practice changes are in):'); for (const f of newFails) console.log(' - [' + f.view + '][' + f.group + '] ' + f.msg); }
}
console.log('(total ' + Math.round((Date.now() - T0) / 1000) + 's)');
console.log('E2E: ' + pass + ' pass, ' + fails.length + ' fail');
process.exit(fails.length ? 1 : 0);
