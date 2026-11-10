// VOIDFORGE memory test (Test upgrade): after CLEAR ALL, and after END SESSION, are the secrets still held by the page?
// It drives the real page in Chromium, enters secrets that occur nowhere else (made-up rolls, a seed from them, unique
// passphrases), wipes, lets the browser collect garbage, takes a heap snapshot through the DevTools protocol and searches
// every string in it. A secret found there is still reachable from the page's JavaScript (a snapshot only holds live
// objects), so the wipe missed it. This cannot see copies outside the JavaScript heap (the browser's own text-box
// buffers, the GPU, swap), which is why the page says that wiping is a precaution, not a guarantee.
//
// The practice signer (v2.13.0) is checked the same way after CLEAR ALL, auto-clear and closing its box.
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

// The Damascus method (v2.14.0): dice pairs and a card record that occur nowhere else, Check my sheets (grids, words, the Seed
// XOR phrases of the assay), FORGE SEED, and Recheck a Damascus backup; then CLEAR ALL, and again with auto-clear.
await p.waitForFunction(() => /PASSED/.test(document.getElementById('selfTestBadge').textContent), null, { timeout: 120000 });
await p.evaluate(() => { const g = document.getElementById('sgGo'); if (g && g.offsetParent) g.click(); window.print = () => {}; });
{
  const pairs = []; let good = 0; while (good < 26) { const a = 1 + nc.randomInt(6), b = 1 + nc.randomInt(6); pairs.push(a + '' + b); if (a !== b || a > 4) good++; }
  const deck = () => { const d = []; for (const su of 'CDHS') for (const r of 'A23456789TJQK') d.push(r + su); for (let i = 51; i > 0; i--) { const j = nc.randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; } return d.join(' '); };
  const dice = pairs.join(' '), cards = [deck(), deck(), deck()].join('\n');
  const fill = async (assay) => p.evaluate(async ([dice, cards, assay]) => {
    showTab('make'); setMethod('damascus'); const s = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); };
    document.getElementById('wordSel').value = '12'; document.getElementById('wordSel').dispatchEvent(new Event('change'));
    const w = document.getElementById('dmWho'), out = {}, both = () => { w.value = 'both'; w.dispatchEvent(new Event('change')); s('dmDice', dice); s('dmCards', cards); };
    const cf = window.confirm; window.confirm = () => true;   // an assay clears the other sheet's box after a yes (v2.14.0 review L1), so both boxes are filled again each time
    for (const k of ['h', 'a']) { both(); w.value = k; w.dispatchEvent(new Event('change')); await dmCheck(); out[k] = [...document.getElementById('dmOut').querySelectorAll('pre')].pop().textContent.split('\n').map((l) => l.replace(/^\s*\d+\.\s/, '')).join(' '); }
    both(); await dmCheck(); await dmGenerate(); window.confirm = cf;
    out.f = document.getElementById('genResult').textContent.split('\n')[0].trim();
    showTab('check'); document.getElementById('dmrWords').value = out.f; document.getElementById('dmrM').value = '00000000000'; document.getElementById('dmrR').value = '000000000000'; await dmRecheck();
    return out;
  }, [dice, cards, assay]);
  const got = await fill();
  ok(got.f.split(' ').length === 12 && got.h.split(' ').length === 12 && got.a.split(' ').length === 12, 'Damascus: a seed and both Seed XOR phrases were made from unique dice and cards');
  const dmSecrets = [['the Damascus dice pairs', dice.slice(0, 60)], ['the Damascus card record', cards.split('\n')[1].slice(0, 60)], ['the Damascus seed words', got.f], ['the Hammer sheet Seed XOR phrase', got.h], ['the Anvil sheet Seed XOR phrase', got.a]];
  await p.waitForTimeout(1000);
  { const s = await heapStrings(); const there = findIn(s, dmSecrets); ok(there.length >= 2, 'Damascus control: before wiping, its secrets are in the heap (' + there.join(', ') + ')'); }
  await p.evaluate(() => clearAll()); await p.waitForTimeout(1500);
  { const s = await heapStrings(); const there = findIn(s, dmSecrets); ok(there.length === 0, 'Damascus, CLEAR ALL: no secret is still held by the page' + (there.length ? ' (still held: ' + there.join(', ') + ')' : ''));
    if (process.env.MEM_DEBUG && there.length) for (const [n, v] of dmSecrets) for (const x of s) if (x.includes(v)) console.log('  ' + n + ' inside: ' + JSON.stringify(x.slice(0, 160))); }
  await fill(); await p.evaluate(() => autoWipe('in the memory test')); await p.waitForTimeout(1500);
  { const s = await heapStrings(); const there = findIn(s, dmSecrets); ok(there.length === 0, 'Damascus, auto-clear: no secret is still held by the page' + (there.length ? ' (still held: ' + there.join(', ') + ')' : '')); }
}

// The practice signer (v2.13.0): a 12-word seed from made-up dice rolls, a passphrase typed on its keyboard, the words
// viewed on its screen, then each wipe. Besides the string search, the heap graph is searched for any one object that
// holds six or more of the seed words (single words are in the word list, so they cannot be searched for as text): the
// device's text caches held them that way in seed order. CLEAR ALL, auto-clear and closing the box are each checked, and
// after closing the box, that a later auto-clear still runs.
const ssKey = { UP: 'ssKUp', DOWN: 'ssKDown', LEFT: 'ssKLeft', RIGHT: 'ssKRight', PRESS: 'ssKPress', K1: 'ssK1', K2: 'ssK2', K3: 'ssK3' };
const ssState = () => p.evaluate(() => {
  const c = SSController._instance; if (!c) return null;
  const x = c.current_destination, v = x && x.view, s = v && v.screen, kb = s && (s.keyboard_abc || s.keyboard);
  return { view: x && x.View_cls && x.View_cls.name, screen: s && s.constructor.name, sel: s && s.selected_button, kb: kb && kb.selected_key ? [kb.selected_key.x, kb.selected_key.y] : null,
    input: s && (s.user_input !== undefined ? s.user_input : s.passphrase), labels: s && s.button_data ? s.button_data.map((b) => typeof b === 'string' ? b : b && b.button_label) : null };
});
// presses a key on the case and waits until the screen has taken it (or a fixed time when nothing visible changes)
async function ssPress(k, settle = 0) {
  const before = JSON.stringify(await ssState());
  await p.click('#' + ssKey[k]);
  const t = Date.now();
  while (Date.now() - t < (settle || 2000)) { await p.waitForTimeout(25); if (!settle && JSON.stringify(await ssState()) !== before) break; }
}
async function ssWait(name, ms = 20000) {
  const t = Date.now(); let s;
  while (Date.now() - t < ms) { s = await ssState(); if (s && (s.view === name || s.screen === name)) { await p.waitForTimeout(150); return s; } await p.waitForTimeout(50); }
  throw new Error('practice signer: no ' + name + ' (at ' + JSON.stringify(s) + ')');
}
async function ssPick(re) {
  for (let n = 0; n < 30; n++) {
    const s = await ssState(), i = (s.labels || []).findIndex((l) => re.test(l || ''));
    if (i < 0) throw new Error('practice signer: no button ' + re + ' in ' + JSON.stringify(s));
    if (s.sel === i) return ssPress('PRESS');
    if (s.screen === 'SSMainMenuScreen') { const [cx, cy, tx, ty] = [s.sel % 2, Math.floor(s.sel / 2), i % 2, Math.floor(i / 2)]; await ssPress(cy < ty || s.sel === null ? 'DOWN' : cy > ty ? 'UP' : cx < tx ? 'RIGHT' : 'LEFT'); }
    else await ssPress(s.sel > i ? 'UP' : 'DOWN');
  }
  throw new Error('practice signer: stuck at ' + re);
}
async function ssKb(name, target) {   // target: a letter, or {x, y}
  for (let n = 0; n < 40; n++) {
    const kb = await p.evaluate((name) => { const k = SSController._instance.current_destination.view.screen[name]; return { sel: [k.selected_key.x, k.selected_key.y], keys: k.keys.map((r) => r.map((x) => x.letter)) }; }, name);
    let tx = -1, ty = -1;
    if (typeof target === 'object') { tx = target.x; ty = target.y; } else kb.keys.forEach((r, y) => r.forEach((l, x) => { if (l === target) { tx = x; ty = y; } }));
    if (ty < 0) throw new Error('practice signer: no key ' + target);
    // sideways first while the target column exists in this row of letters (rows differ in length), else up or down
    const row = kb.keys[kb.sel[1]] || [], side = kb.sel[0] !== tx && row.length > tx && row.every((l) => l);
    if (side) await ssPress(kb.sel[0] < tx ? 'RIGHT' : 'LEFT');
    else if (kb.sel[1] !== ty) await ssPress(kb.sel[1] < ty ? 'DOWN' : 'UP');
    else if (kb.sel[0] !== tx) await ssPress(kb.sel[0] < tx ? 'RIGHT' : 'LEFT');
    else return ssPress('PRESS');
  }
  throw new Error('practice signer: keyboard stuck at ' + target + ' ' + JSON.stringify(await ssState()) + ' ' + JSON.stringify(await p.evaluate((name) => { const k = SSController._instance.current_destination.view.screen[name]; return [k.selected_key.x, k.selected_key.y, k.keys.map((r) => r.map((x) => x.letter).join('')).join('|')]; }, name)));
}
async function ssMakeSeed(rolls, pw) {
  await p.evaluate(() => { showTab('check'); const b = document.getElementById('ssBox'); b.open = true; b.scrollIntoView(); });
  await ssWait('SSMainMenuView');
  await ssPick(/^Tools$/); await ssWait('SSToolsMenuView');
  for (let n = 0; n < 5 && (await ssState()).sel !== 1; n++) await ssPress('DOWN');   // the second "New seed" is the dice one
  await ssPress('PRESS');
  await ssPick(/12 words/);
  await ssWait('SSToolsDiceEntropyEntryScreen');
  for (const r of rolls) { const k = +r - 1; await ssKb('keyboard', { x: k % 3, y: Math.floor(k / 3) }); }
  await ssWait('SSSeedWordsWarningView'); await ssPress('PRESS');
  const words = [];
  for (let page = 0; page < 3; page++) { await ssWait('SSSeedWordsScreen'); words.push(...await p.evaluate(() => SSController._instance.current_destination.view.screen.words)); await ssPress('PRESS'); }
  await ssWait('SSSeedWordsBackupTestPromptView'); await ssPick(/Skip/);
  await ssWait('SSSeedFinalizeView'); await ssPick(/Passphrase/);
  await ssWait('SSSeedAddPassphraseScreen');
  for (const ch of pw) await ssKb('keyboard_abc', ch);
  const typed = await p.evaluate(() => SSController._instance.current_destination.view.screen.passphrase);
  await ssPress('K3'); await ssWait('SSSeedReviewPassphraseView'); await ssPick(/^Done$/);
  let s = await ssState(); if (s.view === 'SSSeedFinalizeView') await ssPick(/^Done$/);
  await ssWait('SSSeedOptionsView');
  // view the words again from the seed's menu
  await ssPick(/Backup/i); await ssPick(/View seed words/i); await ssWait('SSSeedWordsWarningView'); await ssPress('PRESS'); await ssWait('SSSeedWordsScreen');
  return { words: words.join(' '), typed };
}
// how many objects in the heap graph hold `min` or more of the given words (word lists left out)
async function heapHolders(words, min = 6) {
  for (let i = 0; i < 2; i++) await cdp.send('HeapProfiler.collectGarbage');
  let json = ''; const onChunk = (c) => { json += c.chunk; };
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  const snap = JSON.parse(json); json = '';
  const m = snap.snapshot.meta, NF = m.node_fields.length, EF = m.edge_fields.length, N = snap.nodes, E = snap.edges, S = snap.strings;
  const fType = m.node_fields.indexOf('type'), fName = m.node_fields.indexOf('name'), fEdges = m.node_fields.indexOf('edge_count'), eTo = m.edge_fields.indexOf('to_node');
  const strType = m.node_types[0].indexOf('string'), synType = m.node_types[0].indexOf('synthetic'), seed = new Set(words);
  let e = 0, found = 0;
  for (let n = 0; n < N.length; n += NF) {
    const ec = N[n + fEdges]; let hit = new Set(), all = 0;
    for (let j = 0; j < ec; j++, e += EF) {
      const t = E[e + eTo]; if (N[t + fType] !== strType) continue;
      const v = S[N[t + fName]]; if (seed.has(v)) hit.add(v); all++;
    }
    // (word lists are left out: the BIP39 list, the old Electrum list of 1626 words, the strings of the page source)
    if (hit.size >= min && all < 1000 && N[n + fType] !== synType) {
      found++;
      if (process.env.MEM_DEBUG) console.log('  held by a ' + m.node_types[0][N[n + fType]] + ' "' + String(S[N[n + fName]]).slice(0, 60) + '" with ' + ec + ' edges: ' + [...hit].join(' '));
    }
  }
  return found;
}
await p.evaluate(() => { const g = document.getElementById('sgGo'); if (g) g.click(); window.print = () => {}; });   // (END SESSION showed the start notice again)
const ssWipes = {
  'CLEAR ALL': () => p.evaluate(() => clearAll()),
  'auto-clear': () => p.evaluate(() => autoWipe('in the memory test')),
  'closing the box': () => p.click('#ssBox > summary'),
};
for (const [how, wipe] of Object.entries(ssWipes)) {
  const rolls = Array.from({ length: 50 }, () => 1 + nc.randomInt(6)).join('');
  const pw = Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz'[nc.randomInt(26)]).join('');
  const { words, typed } = await ssMakeSeed(rolls, pw);
  const wl = words.split(' ');
  const needles = [['its seed words', words], ['its first four seed words', wl.slice(0, 4).join(' ')], ['its dice rolls', rolls], ['its first 20 rolls', rolls.slice(0, 20)],
    ['its last 20 rolls', rolls.slice(-20)], ['its passphrase', pw], ['the start of its passphrase', pw.slice(0, 5)]];
  if (how === 'CLEAR ALL') {
    const s = await heapStrings(), there = findIn(s, needles), held = await heapHolders(wl);
    ok(wl.length === 12 && typed === pw && there.some((x) => /rolls/.test(x)) && there.includes('its passphrase') && held > 0,
      'practice signer control: a dice seed with a passphrase is made on its own keys, and before a wipe the search finds its rolls and passphrase as text and ' + held + ' object(s) holding its words (' + there.join(', ') + ')');
  }
  await wipe();
  await p.waitForTimeout(1500);
  const s = await heapStrings(), there = findIn(s, needles), held = await heapHolders(wl);
  ok(there.length === 0 && held === 0, 'practice signer, ' + how + ': no seed word, roll or passphrase is still held' + (there.length || held ? ' (still held: ' + there.concat(held ? [held + ' object(s) with its words'] : []).join(', ') + ')' : ''));
  if (process.env.MEM_DEBUG && there.length) for (const [n, v] of needles) for (const x of s) if (x.includes(v)) console.log('  ' + n + ' inside: ' + JSON.stringify(x.slice(0, 160)));
  if (how === 'closing the box') {
    const ran = await p.evaluate(() => { document.getElementById('autoNote').textContent = ''; const r = autoWipe('in the memory test'); return { r, active: ssPageActive() }; });
    ok(!ran.active, 'practice signer: after closing the box nothing of it is left for a later auto-clear to wipe (ssPageActive ' + ran.active + ')');
  }
}

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log('MEMORY: ' + pass + ' pass, ' + fails.length + ' fail');
process.exit(fails.length ? 1 : 0);
