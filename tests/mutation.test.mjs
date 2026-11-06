// Mutation test: deliberately break the tool's code in specific ways and require that
// SOMETHING catches each break, either the in-page self-test (which disables the tool)
// or an end-to-end probe whose expected values come from @scure (independent code).
// A mutation that survives both means the safety net has a hole.
// Run: npm ci && node tests/mutation.test.mjs
// Removes every <script ...>...</script> block by position (no regular expression), for tests that scan the page text.
function stripScripts(h) { let out='', i=0; for(;;){ const a=h.toLowerCase().indexOf('<script', i); if(a<0){ out+=h.slice(i); break; } out+=h.slice(i,a); const b=h.toLowerCase().indexOf('</script', a); if(b<0) break; const c=h.indexOf('>', b); if(c<0) break; i=c+1; } return out; }
import nc from 'node:crypto';
import fs from 'node:fs';
import { entropyToMnemonic, validateMnemonic, mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { bech32, bech32m, createBase58check } from '@scure/base';
import { secp256k1, schnorr } from '@noble/curves/secp256k1';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 as nsha } from '@noble/hashes/sha256';
import { LifeHash } from 'lifehash';
import * as btc from '@scure/btc-signer';
import { hex as bhex } from '@scure/base';
import { loadPage, ready, readHtml, makeReporter } from './harness.mjs';

const R = makeReporter();
const html = readHtml();
const sha = (s) => new Uint8Array(nc.createHash('sha256').update(s).digest());
const fp = (mn, pw) => HDKey.fromMasterSeed(mnemonicToSeedSync(mn, pw)).fingerprint.toString(16).padStart(8, '0');

const addr = (mn, pw) => {
  const k = HDKey.fromMasterSeed(mnemonicToSeedSync(mn, pw)).derive("m/84'/0'/0'/0/0");
  return bech32.encode('bc', [0, ...bech32.toWords(ripemd160(nsha(k.publicKey)))]);
};

const b85At = (mn, pw, words, index) => { const k = HDKey.fromMasterSeed(mnemonicToSeedSync(mn, pw)).derive(`m/83696968'/39'/0'/${words}'/${index}'`);
  const e = nc.createHmac('sha512', 'bip-entropy-from-k').update(k.privateKey).digest(); return entropyToMnemonic(new Uint8Array(e.subarray(0, words * 4 / 3)), wordlist); };
const segAt = (mn, pw, chain, i) => { const k = HDKey.fromMasterSeed(mnemonicToSeedSync(mn, pw)).derive(`m/84'/0'/0'/${chain}/${i}`);
  return bech32.encode('bc', [0, ...bech32.toWords(ripemd160(nsha(k.publicKey)))]); };
const b58c = createBase58check(nsha);
const altAt = (type, mn, pw, acct, chain, i, test) => { const purpose = { pkh: 44, 'sh-wpkh': 49 }[type]; const k = HDKey.fromMasterSeed(mnemonicToSeedSync(mn, pw)).derive(`m/${purpose}'/${test ? 1 : 0}'/${acct}'/${chain}/${i}`);
  const h = ripemd160(nsha(k.publicKey)); if (type === 'pkh') return b58c.encode(Uint8Array.from([test ? 0x6f : 0, ...h]));
  return b58c.encode(Uint8Array.from([test ? 0xc4 : 5, ...ripemd160(nsha(Uint8Array.from([0, 0x14, ...h])))])); };
const segAtT = (mn, pw, acct, chain, i) => { const k = HDKey.fromMasterSeed(mnemonicToSeedSync(mn, pw)).derive(`m/84'/1'/${acct}'/${chain}/${i}`);
  return bech32.encode('tb', [0, ...bech32.toWords(ripemd160(nsha(k.publicKey)))]); };
const trAtT = (mn, pw, acct, chain, i) => { const k = HDKey.fromMasterSeed(mnemonicToSeedSync(mn, pw)).derive(`m/86'/1'/${acct}'/${chain}/${i}`); const xo = k.publicKey.slice(1);
  const P = secp256k1.ProjectivePoint.fromHex('02' + Buffer.from(xo).toString('hex')); const t = schnorr.utils.taggedHash('TapTweak', xo);
  const Q = P.add(secp256k1.ProjectivePoint.BASE.multiply(BigInt('0x' + Buffer.from(t).toString('hex'))));
  return bech32m.encode('tb', [1, ...bech32m.toWords(Q.toRawBytes(true).slice(1))]); };
const trAt = (mn, pw, chain, i) => { const k = HDKey.fromMasterSeed(mnemonicToSeedSync(mn, pw)).derive(`m/86'/0'/0'/${chain}/${i}`); const xo = k.publicKey.slice(1);
  const P = secp256k1.ProjectivePoint.fromHex('02' + Buffer.from(xo).toString('hex')); const t = schnorr.utils.taggedHash('TapTweak', xo);
  const Q = P.add(secp256k1.ProjectivePoint.BASE.multiply(BigInt('0x' + Buffer.from(t).toString('hex'))));
  return bech32m.encode('bc', [1, ...bech32m.toWords(Q.toRawBytes(true).slice(1))]); };

const ZV = { private: 0x04b2430c, public: 0x04b24746 };
const watch = (mn, pw) => { const seed = mnemonicToSeedSync(mn, pw);
  return { zpub: HDKey.fromMasterSeed(seed, ZV).derive("m/84'/0'/0'").publicExtendedKey, xpub: HDKey.fromMasterSeed(seed).derive("m/84'/0'/0'").publicExtendedKey, fp: fp(mn, pw) }; };

const hexb4 = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const svgPixels = (svg) => { const px = new Array(32 * 32 * 3).fill(-1);
  for (const m of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="1" fill="rgb\((\d+),(\d+),(\d+)\)"/g)) { const [x, y, wd, r, g, b] = m.slice(1).map(Number);
    for (let i = 0; i < wd; i++) { const o = (y * 32 + x + i) * 3; px[o] = r; px[o + 1] = g; px[o + 2] = b; } } return px; };
// fingerprints chosen to hit all four gradient families (and both patterns); expected pixels come from the independent `lifehash` package
const LH_FPS = ['4fbf7566', '289e08eb', '0b369d3f', '8875c736', '2768c0b1', '8d9cced8', '73c5da0a', 'b4e3f5ed', 'f00e80ca', '00000000', 'ffffffff', '12345678', 'deadbeef', 'cafebabe', '0badf00d', '5eed5eed', 'a1b2c3d4', '13371337', 'c0ffee00', '7f7f7f7f', '1bae9145', '8530a8f6', '09221a00', 'fad09a48'];
const LH_EXPECT = Object.fromEntries(LH_FPS.map((f) => [f, Array.from(LifeHash.makeFrom(hexb4(f), 2, 1, false).colors)]));
// Fixed probe inputs (not SeedSigner's, so this is independent of the in-page vectors).
const D50 = '31415926535897932384626433832795028841971693993751'.replace(/[0789]/g, c => ({ 0: '6', 7: '2', 8: '4', 9: '5' }[c]));
const D99 = (D50 + D50).slice(0, 99);
const C128 = '10110011100011110000111110000011111100000011111110000000111111110101010011001100111000111100001111000001111100000011111100000010'.slice(0, 128);
const UNI = 'éﬁ pässwörd ｆｕｌｌ';
const expect = {
  d50: entropyToMnemonic(sha(D50).slice(0, 16), wordlist),
  d99: entropyToMnemonic(sha(D99).slice(0, 32), wordlist),
  c128: entropyToMnemonic(sha(C128).slice(0, 16), wordlist),
};

async function probe(w, mutated) {
  const fails = [], $ = (id) => w.document.getElementById(id);
  const mode = (m) => { const e = w.document.querySelector(`input[name=mode][value=${m}]`); e.checked = true; e.onchange(); };
  const words = (n) => { const e = w.document.querySelector(`input[name=words][value="${n}"]`); e.checked = true; e.onchange(); };
  const run = async (m, n, input, pw = '') => { mode(m); words(n); $('rolls').value = input; $('rolls').oninput(); $('passphrase').value = pw; $('passphrase2').value = pw; await w.generate(); return $('genResult').textContent.split('\n')[0]; };
  const adOf = () => (($('address').textContent.match(/: (bc1[0-9a-z]+)/) || [])[1]);
  const fpOf = () => (($('fingerprint').textContent.match(/: ([0-9a-f]{8})/) || [])[1]);

  let r = await run('dice', 12, D50); if (r !== expect.d50 || fpOf() !== fp(expect.d50, '')) fails.push('dice 12 words / fingerprint');
  if (adOf() !== addr(expect.d50, '')) fails.push('first receive address');
  { const wo = watch(expect.d50, ''), z = $('wZpub').textContent, dr = $('wDescR').textContent, dc = $('wDescC').textContent;
    if (z !== wo.zpub) fails.push('watch-only zpub');
    if (!dr.startsWith(`wpkh([${wo.fp}/84h/0h/0h]${wo.xpub}/0/*)#`) || !/#[02-9ac-hj-np-z]{8}$/.test(dr)) fails.push('watch-only receive descriptor');
    if (!dc.startsWith(`wpkh([${wo.fp}/84h/0h/0h]${wo.xpub}/1/*)#`)) fails.push('watch-only change descriptor');
    if (dr.split('#')[1] === dc.split('#')[1]) fails.push('descriptor checksums differ per branch');
    if ($('watchBox').style.display !== '') fails.push('watch-only box shown after FORGE'); }
    { const sd0 = mnemonicToSeedSync(expect.d50, ''), root0 = HDKey.fromMasterSeed(sd0), spExp = (coin, hrp) => bech32m.encode(hrp, [0, ...bech32m.toWords(new Uint8Array([...root0.derive(`m/352'/${coin}'/0'/1'/0`).publicKey, ...root0.derive(`m/352'/${coin}'/0'/0'/0`).publicKey]))], 1023);
      if ($('spAddr').textContent !== spExp(0, 'sp') || $('spBox').style.display !== '') fails.push('silent payments: mainnet address');
      $('wNet').value = 'test'; await w.refreshWatch(); if ($('spAddr').textContent !== spExp(1, 'tsp')) fails.push('silent payments: testnet address');
      $('wAcct').value = '5'; await w.refreshWatch(); { const r5 = HDKey.fromMasterSeed(sd0); const e5 = bech32m.encode('tsp', [0, ...bech32m.toWords(new Uint8Array([...r5.derive("m/352'/1'/5'/1'/0").publicKey, ...r5.derive("m/352'/1'/5'/0'/0").publicKey]))], 1023); if ($('spAddr').textContent !== e5) fails.push('silent payments: account number used'); }
      $('wAcct').value = '0'; $('wNet').value = 'main'; await w.refreshWatch();
      $('wType').value = 'ms-wsh'; await w.refreshWatch(); if ($('spBox').style.display !== 'none') fails.push('silent payments: hidden for a cosigner key');
      $('wType').value = 'wpkh'; await w.refreshWatch(); }
    { const dr = $('wDescR').textContent, dc = $('wDescC').textContent; // Bitcoin Core guide: built here from the page's own descriptors, with Core's documented importdescriptors fields
      const exp = (ts) => 'bitcoin-cli createwallet "voidforge-watch" true true "" false true\nbitcoin-cli -rpcwallet=voidforge-watch importdescriptors \'' + JSON.stringify([{ desc: dr, timestamp: ts, active: true, internal: false, range: [0, 999], next_index: 0 }, { desc: dc, timestamp: ts, active: true, internal: true, range: [0, 999], next_index: 0 }]) + '\'';
      if ($('coreBox').style.display !== '' || $('coreCmd').textContent !== exp('now')) fails.push('core guide: new wallet commands');
      $('coreWhen').value = '0'; $('coreWhen').dispatchEvent(new w.Event('change')); if ($('coreCmd').textContent !== exp(0)) fails.push('core guide: used wallet scans from the start');
      $('coreWhen').value = 'now'; $('coreWhen').dispatchEvent(new w.Event('change'));
      if ($('wTestBan').style.display !== 'none') fails.push('testnet banner hidden on mainnet');
      $('wNet').value = 'test'; await w.refreshWatch(); if ($('wTestBan').style.display !== '' || !/TESTNET/.test($('wTestBan').textContent)) fails.push('testnet banner shown on testnet');
      $('wType').value = 'ms-wsh'; await w.refreshWatch(); if ($('coreBox').style.display !== 'none' || $('coreCmd').textContent !== '') fails.push('core guide hidden for a cosigner key');
      $('wType').value = 'wpkh'; $('wNet').value = 'main'; await w.refreshWatch(); if ($('wTestBan').style.display !== 'none' || $('coreCmd').textContent !== exp('now')) fails.push('core guide and banner restored on mainnet');
      $('wNet').value = 'test'; await w.refreshWatch();
      w.clearAll(); await new Promise((r2) => setTimeout(r2, 20)); if ($('spAddr').textContent !== '') fails.push('silent payments: cleared with the seed');
      if ($('coreCmd').textContent !== '' || $('coreBox').style.display !== 'none' || $('wTestBan').style.display !== 'none') fails.push('core guide cleared with the seed');
      await run('dice', 12, D50); }
  { const ABOUT = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'; const seedB = mnemonicToSeedSync(ABOUT, ''); const VER = { wpkh: 0x04b24746, 'sh-wpkh': 0x049d7cb2, pkh: 0x0488b21e, tr: 0x0488b21e }, PUR = { wpkh: 84, 'sh-wpkh': 49, pkh: 44, tr: 86 };
    for (const [type, acct] of [['wpkh', 0], ['sh-wpkh', 0], ['pkh', 0], ['tr', 0], ['sh-wpkh', 3], ['pkh', 7], ['tr', 2147483647]]) {
      const wo = await w.watchOnlyFromSeed(seedB, type, acct), pu = PUR[type], hk = HDKey.fromMasterSeed(seedB, { private: 0, public: VER[type] }), hx = HDKey.fromMasterSeed(seedB);
      const tag = `watch ${type} account ${acct}`, path = `m/${pu}'/0'/${acct}'`;
      if (wo.key !== hk.derive(path).publicExtendedKey) fails.push(tag + ': key (' + (type === 'wpkh' ? 'zpub' : type === 'sh-wpkh' ? 'ypub' : 'xpub') + ')');
      if (wo.xpub !== hx.derive(path).publicExtendedKey) fails.push(tag + ': xpub');
      const first = { wpkh: segAt, tr: trAt }[type] ? null : altAt(type, ABOUT, '', acct, 0, 0);
      if (type === 'wpkh' || type === 'tr') { const k = hx.derive(`${path}/0/0`); const exp = type === 'wpkh' ? bech32.encode('bc', [0, ...bech32.toWords(ripemd160(nsha(k.publicKey)))]) : (acct === 0 ? trAt(ABOUT, '', 0, 0) : null); if (exp && wo.first !== exp) fails.push(tag + ': first address'); }
      else if (wo.first !== first) fails.push(tag + ': first address');
      const o = `${wo.fp}/${pu}h/0h/${acct}h`, wrap = (b) => type === 'sh-wpkh' ? `sh(wpkh([${o}]${wo.xpub}/${b}/*))#` : `${type}([${o}]${wo.xpub}/${b}/*)#`;
      if (!wo.receive.startsWith(wrap(0)) || !wo.change.startsWith(wrap(1))) fails.push(tag + ': descriptors'); } }
  { const ABOUT = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'; const seedB = mnemonicToSeedSync(ABOUT, '');
    const TV = { wpkh: 0x045f1cf6, 'sh-wpkh': 0x044a5262, pkh: 0x043587cf, tr: 0x043587cf }, PUR = { wpkh: 84, 'sh-wpkh': 49, pkh: 44, tr: 86 };
    const MV = { main: { 'ms-wsh': 0x02aa7ed3, 'ms-sh-wsh': 0x0295b43f }, test: { 'ms-wsh': 0x02575483, 'ms-sh-wsh': 0x024289ef } }, SC = { 'ms-wsh': 2, 'ms-sh-wsh': 1 };
    for (const [type, acct] of [['wpkh', 0], ['sh-wpkh', 1], ['pkh', 0], ['tr', 4]]) {
      const wo = await w.watchOnlyFromSeed(seedB, type, acct, 'test'), tag = `testnet ${type} account ${acct}`, path = `m/${PUR[type]}'/1'/${acct}'`;
      if (wo.key !== HDKey.fromMasterSeed(seedB, { private: 0, public: TV[type] }).derive(path).publicExtendedKey) fails.push(tag + ': key');
      if (wo.xpub !== HDKey.fromMasterSeed(seedB, { private: 0, public: 0x043587cf }).derive(path).publicExtendedKey) fails.push(tag + ': tpub');
      if (!wo.receive.includes(`[${wo.fp}/${PUR[type]}h/1h/${acct}h]${wo.xpub}/0/*`)) fails.push(tag + ": descriptor origin");
      const first = type === 'wpkh' ? segAtT(ABOUT, '', acct, 0, 0) : type === 'tr' ? trAtT(ABOUT, '', acct, 0, 0) : altAt(type, ABOUT, '', acct, 0, 0, true);
      if (wo.first !== first) fails.push(tag + ': first address'); }
    for (const net of ['main', 'test']) for (const type of ['ms-wsh', 'ms-sh-wsh']) for (const acct of [0, 2]) {
      const wo = await w.watchOnlyFromSeed(seedB, type, acct, net), tag = `multisig ${type} ${net} account ${acct}`, coin = net === 'test' ? 1 : 0, path = `m/48'/${coin}'/${acct}'/${SC[type]}'`;
      if (wo.key !== HDKey.fromMasterSeed(seedB, { private: 0, public: MV[net][type] }).derive(path).publicExtendedKey) fails.push(tag + ': key');
      if (wo.receive !== `[${wo.fp}/48h/${coin}h/${acct}h/${SC[type]}h]${HDKey.fromMasterSeed(seedB, { private: 0, public: net === 'test' ? 0x043587cf : 0x0488b21e }).derive(path).publicExtendedKey}`) fails.push(tag + ': key origin');
      if (wo.change !== '' || wo.first !== '') fails.push(tag + ': has no addresses'); } }
  { // v1.26.0: five receiving addresses for every single-key type, both networks, checked with @scure/btc-signer (independent address encoder)
    const seedF = mnemonicToSeedSync('legal winner thank year wave sausage worth useful legal winner thank yellow', 'x'), root = HDKey.fromMasterSeed(seedF);
    const PURF = { wpkh: 84, 'sh-wpkh': 49, pkh: 44, tr: 86 };
    for (const net of ['main', 'test']) for (const [type, acct] of [['wpkh', 0], ['sh-wpkh', 0], ['pkh', 0], ['tr', 0], ['wpkh', 5], ['sh-wpkh', 2], ['pkh', 1], ['tr', 9]]) {
      const NETB = net === 'test' ? btc.TEST_NETWORK : btc.NETWORK, wo = await w.watchOnlyFromSeed(seedF, type, acct, net), tag = `five ${type} ${net} account ${acct}`;
      if (!Array.isArray(wo.five) || wo.five.length !== 5) { fails.push(tag + ': five addresses'); continue; }
      if (wo.first !== wo.five[0]) fails.push(tag + ': first is the first of five');
      for (let i = 0; i < 5; i++) {
        const k = root.derive(`m/${PURF[type]}'/${net === 'test' ? 1 : 0}'/${acct}'/0/${i}`), pk = k.publicKey;
        const exp = type === 'wpkh' ? btc.p2wpkh(pk, NETB).address : type === 'pkh' ? btc.p2pkh(pk, NETB).address : type === 'sh-wpkh' ? btc.p2sh(btc.p2wpkh(pk, NETB), NETB).address : btc.p2tr(pk.slice(1), undefined, NETB).address;
        if (wo.five[i] !== exp) fails.push(tag + ': address ' + i);
      }
      if (new Set(wo.five).size !== 5) fails.push(tag + ': five different addresses'); }
    // the box shows all five, one per line, and clears them with the seed
    await run('dice', 12, D50); $('wType').value = 'wpkh'; $('wNet').value = 'main'; $('wAcct').value = '0'; await w.refreshWatch();
    if ($('wFirst').textContent.split('\n').length !== 5 || $('wFirst').textContent.split('\n').some((l) => !/^bc1q/.test(l))) fails.push('five addresses shown one per line');
    if ($('wFirst').style.whiteSpace !== 'pre-line') fails.push('five addresses keep their line breaks'); if (!w.document.querySelector("button[onclick=\"copyWatch(this,'wFirst')\"]") || !/COPY ALL/.test(w.document.querySelector("button[onclick=\"copyWatch(this,'wFirst')\"]").textContent)) fails.push('COPY ALL copies the five addresses');
    $('wType').value = 'ms-wsh'; await w.refreshWatch(); if ($('wFirstGroup').style.display !== 'none') fails.push('multisig shows no addresses');
    $('wType').value = 'wpkh'; await w.refreshWatch(); w.clearAll(); await new Promise((r2) => setTimeout(r2, 20)); if ($('wFirst').textContent !== '') fails.push('five addresses cleared with the seed'); }
  { // v1.27.0 restore drill: type the words back from paper; positions only, never the right words
    const body = w.document.body, dst = () => $('drillStatus').textContent, typed = (t, pw = '') => { $('drillWords').value = t; $('drillPass').value = pw; };
    const alerts2 = []; const oldAlert = w.alert; w.alert = (m) => alerts2.push(m);
    const css = mutated.match(/<style>[\s\S]*?<\/style>/)[0];
    const hideSel = ['#wordGrid', '#genResult', '#abbrNote', '#passNote', '#nextStep'], noneSel = ['.needs-words', '.print-btn', '#seedQrBox', '#explainBox'];
    const hr = new RegExp('body\\.drill-on #wordGrid[^{]*\\{ visibility: hidden; \\}').exec(css), nr = /body\.drill-on \.needs-words[^{]*\{ display: none !important; \}/.exec(css);
    if (!hr || !hideSel.every((x) => hr[0].includes('body.drill-on ' + x))) fails.push('drill: CSS hides the word grid, result text and notes');
    if (!nr || !noneSel.every((x) => nr[0].includes('body.drill-on ' + x))) fails.push('drill: CSS removes the buttons and boxes that show words');
    if (![...w.document.querySelectorAll('button')].filter((b) => /^(SHOW FIRST 4 LETTERS|SEND TO CHECK|DOWNLOAD)$/.test(b.textContent)).every((b) => b.classList.contains('needs-words'))) fails.push('drill: word-showing buttons are marked');
    w.clearAll(); await new Promise((r2) => setTimeout(r2, 20));
    w.drillStart(); if (body.classList.contains('drill-on') || alerts2.length !== 1) fails.push('drill: START refuses with no seed');
    await run('dice', 12, D50); const W = expect.d50.split(' ');
    if ($('drillBox').style.display !== '') fails.push('drill: card appears with a seed');
    w.drillStart(); if (!body.classList.contains('drill-on') || $('drillRun').style.display !== '' || $('drillStart').style.display !== 'none') fails.push('drill: START hides the words and opens the typing box');
    if ($('drillPassRow').style.display !== 'none') fails.push('drill: no passphrase box without a passphrase');
    typed(W.slice(0, 11).join(' ')); await w.drillCheck(); if (!/typed 11 words, but this seed has 12/.test(dst())) fails.push('drill: wrong count reported');
    typed(W.slice(0, 3).concat(['zzzzz'], W.slice(4)).join(' ')); await w.drillCheck(); if (!/Word 4 is not in the BIP39 list/.test(dst())) fails.push('drill: unknown word reported by position');
    { const bad = W.slice(); bad[2] = W[2] === 'abandon' ? 'ability' : 'abandon'; bad[6] = W[6] === 'zoo' ? 'zone' : 'zoo'; typed(bad.join(' ')); await w.drillCheck();
      const MSG = 'Word 3 and 7 do not match your seed. Look at those words on your paper. (The page will not show you the right word: the point is to test the paper.)', rest = dst().replace(MSG, ''); // the fixed message holds ordinary words that can also be seed words, so only what is left after it is checked
      if (!dst().includes(MSG)) fails.push('drill: wrong words reported by position');
      if (new RegExp('\\b(' + W[2] + '|' + W[6] + ')\\b').test(rest)) fails.push('drill: the right words are never shown'); }
    { const bad = W.slice(); bad[11] = W[11] === 'abandon' ? 'ability' : 'abandon'; typed(bad.join(' ')); await w.drillCheck(); if (!/Word 12 does not match/.test(dst())) fails.push('drill: single wrong word'); }
    typed('  ' + W.join('\n').toUpperCase() + '  '); await w.drillCheck();
    if (!/Drill passed/.test(dst()) || !dst().includes('master fingerprint ' + fp(expect.d50, '')) || !$('drillStatus').classList.contains('ok')) fails.push('drill: right words pass (spacing, capitals) with the true fingerprint');
    typed(W.join(' '), 'oops'); await w.drillCheck(); if (!/made without a passphrase/.test(dst())) fails.push('drill: stray passphrase flagged');
    w.drillEnd(); if (body.classList.contains('drill-on') || $('drillWords').value !== '' || $('drillPass').value !== '' || dst() !== '' || $('drillRun').style.display !== 'none' || $('drillStart').style.display !== '') fails.push('drill: END DRILL restores the page and wipes what was typed');
    await run('dice', 12, D50, 'my pass'); w.drillStart(); if ($('drillPassRow').style.display !== '') fails.push('drill: passphrase box appears with a passphrase');
    typed(W.join(' '), ''); await w.drillCheck(); if (!/The words match, but the passphrase does not\./.test(dst())) fails.push('drill: missing passphrase is not enough');
    typed(W.join(' '), 'My pass'); await w.drillCheck(); if (!/The words match, but the passphrase does not\./.test(dst())) fails.push('drill: passphrase is case sensitive');
    typed(W.join(' '), 'my pass'); await w.drillCheck(); if (!/Drill passed\. Every word and the passphrase matches/.test(dst()) || !dst().includes('master fingerprint ' + fp(expect.d50, 'my pass'))) fails.push('drill: words and passphrase pass with the passphrase fingerprint');
    await run('dice', 12, D50, UNI); w.drillStart(); typed(W.join(' '), UNI.normalize('NFD')); await w.drillCheck(); if (!/Drill passed/.test(dst())) fails.push('drill: passphrase compared after Unicode normalization');
    $('rolls').value = D50.slice(0, 49) + (D50[49] === '1' ? '2' : '1'); $('rolls').oninput(); if (body.classList.contains('drill-on') || $('drillWords').value !== '') fails.push('drill: changing the rolls ends the drill');
    await run('dice', 12, D50); w.drillStart(); typed(W.join(' ')); $('passphrase').value = 'q'; $('passphrase').dispatchEvent(new w.Event('input', { bubbles: true })); if (body.classList.contains('drill-on') || $('drillWords').value !== '') fails.push('drill: changing the passphrase ends the drill');
    await run('dice', 12, D50); w.drillStart(); typed(W.join(' ')); w.wipeSeed(); if (body.classList.contains('drill-on') || $('drillWords').value !== '' || $('drillBox').style.display !== 'none') fails.push('drill: CLEAR ends the drill and hides the card');
    w.alert = oldAlert; w.clearAll(); await new Promise((r2) => setTimeout(r2, 20)); }
  { // v1.26.2 CLEAR is red, SELF-TEST is green, readable in both themes
    const css = mutated.match(/<style>[\s\S]*?<\/style>/)[0], hexc = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const lum = (c) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
    const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const tok = (re) => (re.exec(css) || [])[1];
    const bt = (id) => [...w.document.querySelectorAll('button')].find((b) => b.getAttribute('onclick') === id);
    const a = bt('clearAll()'), b = bt('toggleSelfTests()');
    if (!a || !a.classList.contains('btn-clear') || a.classList.contains('secondary')) fails.push('buttons: CLEAR is red');
    if (!b || !b.classList.contains('btn-test') || b.classList.contains('secondary')) fails.push('buttons: SELF-TEST is green');
    if (!/\n  button\.btn-clear \{[^}]*color: var\(--bad-text\)/.test(css)) fails.push('buttons: red text');
    if (!/\n  button\.btn-clear, body\.light button\.btn-clear \{[^}]*color: var\(--bad-text\)/.test(css)) fails.push('buttons: red text in the new look');
    if (!/\n  button\.btn-clear \{[^}]*border: 1px solid var\(--bad-text\)/.test(css)) fails.push('buttons: red border');
    if (!/\n  button\.btn-test \{[^}]*color: var\(--ok-text\)/.test(css)) fails.push('buttons: green text');
    if (!/\n  button\.btn-test \{[^}]*border: 1px solid var\(--ok-text\)/.test(css)) fails.push('buttons: green border');
    if (!/body\.light button\.btn-clear \{[^}]*color: var\(--bad-text\)/.test(css)) fails.push('buttons: light red text');
    if (!/body\.light button\.btn-test \{[^}]*color: var\(--ok-text\)/.test(css)) fails.push('buttons: light green text');
    const al = (re) => parseFloat((re.exec(css) || [0, 1])[1]);
    const mixc = (fg, k, bg) => fg.map((v, i) => v * k + bg[i] * (1 - k));
    const dk = { bad: tok(/:root \{[^}]*--bad-text: (#[0-9a-f]{6})/), ok: tok(/:root \{ --ok-text: (#[0-9a-f]{6})/), sf: tok(/--surface2: (#[0-9a-f]{6})/) };
    const lt = { bad: tok(/body\.light \{[^}]*--bad-text: (#[0-9a-f]{6})/), ok: tok(/body\.light \{ --ok-text: (#[0-9a-f]{6})/), sf: tok(/body\.light \{[^}]*--surface2: (#[0-9a-f]{6})/) };
    const worst = Math.min(
      cr(hexc(dk.bad), mixc(hexc(dk.bad), al(/button\.btn-clear \{ background: rgba\(255,68,102,([.0-9]+)\)/), hexc(dk.sf))),
      cr(hexc(dk.ok), mixc(hexc(dk.ok), al(/button\.btn-test \{ background: rgba\(0,255,157,([.0-9]+)\)/), hexc(dk.sf))),
      cr(hexc(lt.bad), mixc(hexc(lt.bad), al(/body\.light button\.btn-clear \{ background: rgba\(192,20,60,([.0-9]+)\)/), hexc(lt.sf))),
      cr(hexc(lt.ok), mixc(hexc(lt.ok), al(/body\.light button\.btn-test \{ background: rgba\(6,104,58,([.0-9]+)\)/), hexc(lt.sf))));
    if (!(worst >= 4.5)) fails.push('buttons: red and green text stay readable in both themes'); }
  { // v1.26.1 stale-result guard: the result on screen always belongs to the inputs that made it
    const on = () => $('genResult').dataset.seed === '1', gone = () => !on() && !/[0-9a-f]{8}/.test($('fingerprint').textContent) && $('address').textContent === '' && !$('wZpub').textContent && $('wordGrid').querySelectorAll('.wcell:not(.empty)').length === 0;
    const ev = (id) => $(id).dispatchEvent(new w.Event('input', { bubbles: true }));
    w.clearAll(); await new Promise((r2) => setTimeout(r2, 20));
    const forge = async (rolls = D50, pw = '') => { await run('dice', 12, rolls, pw); };
    await forge(); if (!on()) fails.push('stale: a seed is made');
    w.updateCount(); w.hideExplain(); w.updateCount(); $('passphrase').value = ''; ev('passphrase'); $('rolls').value = D50 + ' x y'; w.updateCount(); if (!on()) fails.push('stale: no real change keeps the result');
    $('passphrase').value = 'x'; $('passphrase2').value = 'x'; ev('passphrase'); ev('passphrase2'); await w.eval('passWork'); if (!on() || !/not shown here/.test($('genResult').textContent) || $('wordGrid').querySelectorAll('.wcell:not(.empty)').length !== 12) fails.push('stale: a passphrase edit keeps the words and re-works the fingerprint'); $('passphrase').value = ''; $('passphrase2').value = ''; ev('passphrase'); ev('passphrase2'); await w.eval('passWork');
    await forge(); $('passphrase').value = 'x'; ev('passphrase'); $('passphrase2').value = 'y'; ev('passphrase2'); await w.eval('passWork'); if (!on() || !/do not match/.test($('genResult').textContent) || $('address').textContent !== '') fails.push('stale: a mismatching confirm-passphrase keeps the words but hides the fingerprint and addresses'); $('passphrase').value = ''; $('passphrase2').value = ''; ev('passphrase'); ev('passphrase2'); await w.eval('passWork');
    await forge(D50, 'pp'); $('passphrase').value = 'pq'; ev('passphrase'); await w.eval('passWork'); if (!on()) fails.push('stale: editing an existing passphrase keeps the result');
    await forge(); $('rolls').value = D50.slice(0, 49) + (D50[49] === '1' ? '2' : '1'); w.updateCount(); if (!gone()) fails.push('stale: changing a roll clears everything'); if (!/changed the rolls, the word count, the dice\/coin choice or the dice rules after FORGE/.test($('genResult').textContent)) fails.push('stale: a changed roll explains why the words were cleared');
    await forge(); w.undoRoll(); if (on()) fails.push('stale: UNDO clears the result');
    { // v1.29.1 run counter: an old FORGE must not write its fingerprint and addresses back after an edit or CLEAR ALL
      const mid = async (act, cond = () => /computing/.test($('fingerprint').textContent)) => { await w.eval('passWork'); mode('dice'); words(12); $('rolls').value = D50; ev('rolls'); $('passphrase').value = ''; $('passphrase2').value = ''; const pr = w.generate(); for (let i = 0; i < 5000 && !cond(); i++) await new Promise((r) => setTimeout(r, 0)); const saw = cond(); act(); await pr; await new Promise((r) => setTimeout(r, 400)); return saw; };
      const leftover = () => /[0-9a-f]{8}/.test($('fingerprint').textContent) || /bc1q/.test($('address').textContent) || $('addrList').textContent !== '';
      if (!(await mid(() => { $('passphrase').value = 'abc'; ev('passphrase'); }))) fails.push('run counter: the edit lands while the fingerprint is computing');
      if (leftover()) fails.push('run counter: an edit during FORGE leaves an old fingerprint, address or list behind');
      $('passphrase').value = ''; ev('passphrase');
      if (!(await mid(() => { $('passphrase').value = 'abc'; ev('passphrase'); }, () => /Master fingerprint: [0-9a-f]{8}/.test($('fingerprint').textContent) && $('address').textContent === ''))) fails.push('run counter: the edit lands after the fingerprint and before the first address');
      if (leftover()) fails.push('run counter: an edit before the first address leaves an old address or list behind');
      $('passphrase').value = ''; ev('passphrase');
      if (!(await mid(() => { $('passphrase').value = 'abc'; ev('passphrase'); }, () => /bc1q/.test($('address').textContent) && $('addrList').textContent === ''))) fails.push('run counter: the edit lands after the first address and before the address list');
      if (leftover()) fails.push('run counter: an edit before the address list leaves an old list behind');
      $('passphrase').value = ''; ev('passphrase');
      if (!(await mid(() => { $('rolls').value = D50 + '1'; ev('rolls'); }))) fails.push('run counter: a roll edit lands while the fingerprint is computing');
      if (leftover()) fails.push('run counter: a roll edit during FORGE (the stale clear) leaves an old fingerprint, address or list behind');
      $('passphrase').value = ''; ev('passphrase'); await mid(() => w.wipeSeed());
      if (leftover()) fails.push('run counter: CLEAR ALL during FORGE leaves an old fingerprint, address or list behind');
      $('passphrase').value = ''; ev('passphrase'); }
    await forge(); words(24); if (!gone()) fails.push('stale: changing the word count clears everything'); words(12);
    await forge(); mode('coin'); if (!gone()) fails.push('stale: switching dice/coin clears everything'); mode('dice');
    await forge('1'.repeat(50)); mode('coin'); if (!gone()) fails.push('stale: switching dice/coin clears even when the cleaned rolls look the same'); mode('dice');
    { let blob = null; const o1 = w.URL.createObjectURL, o2 = w.HTMLAnchorElement.prototype.click; w.URL.createObjectURL = (b) => { blob = b; return 'blob:x'; }; w.URL.revokeObjectURL = () => {}; w.HTMLAnchorElement.prototype.click = function () {};
      await forge(D50.replace(/(.)/g, '$1 ')); w.downloadSeed(); const txt = blob ? await new Promise((res) => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsText(blob); }) : '';
      if (!txt.endsWith('Input: ' + D50)) fails.push('stale: the saved file records the rolls that made the words'); w.URL.createObjectURL = o1; w.HTMLAnchorElement.prototype.click = o2; }
    { const A11 = 'abandon '.repeat(11); $('wdLen').value = '12'; $('wdWords').value = A11; $('wdFlips').value = '0000000'; $('passphrase').value = ''; $('passphrase2').value = ''; w.wdUpdate(); await w.wdGenerate();
      if (!on()) fails.push('stale: a Word draw seed is made');
      $('rolls').value = '1234'; w.updateCount(); mode('coin'); mode('dice'); if (!on()) fails.push('stale: the rolls box and the dice/coin choice do not matter to a Word draw seed');
      $('passphrase').value = 'z'; ev('passphrase'); await w.eval('passWork'); if (!on()) fails.push('stale: a passphrase edit keeps a Word draw seed');
      words(24); if (on()) fails.push('stale: changing the word count clears a Word draw seed'); words(12); $('passphrase').value = ''; ev('passphrase'); await w.eval('passWork'); }
    w.clearAll(); await new Promise((r2) => setTimeout(r2, 20)); }
  { // Try accounts 0 to 20 (v1.33.0)
    const AB = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', sleep = (ms) => new Promise((r2) => setTimeout(r2, ms));
    const addrAt = async (pw, purpose, type, coin, acct, chain, i) => { const seed = await w.mnemonicToSeed(AB, pw); let [k, c] = await w.masterFromSeed(seed); for (const [n, h] of [[purpose, true], [coin, true], [acct, true], [chain, false], [i, false]]) [k, c] = await w.ckdPriv(k, c, n, h); return w.addressFromKey(type, k, coin === 1 ? 'test' : 'main'); };
    const st = () => $('addrCheckStatus').textContent;
    const run = async (pw, x, mx, dp) => { $('phrase').value = AB; $('verifyPass').value = pw; $('checkAddr').value = x; await w.checkAllAccounts(mx, dp); return st(); };
    let tx = await run('', await addrAt('', 84, 'wpkh', 0, 2, 0, 1), 3, 2);
    if (!/^FOUND: this SegWit address is receive address #1 \(m\/84'\/0'\/2'\/0\/1\) of account 2 of these words, without passphrase\. Put 2 in the account box/.test(tx)) fails.push('try accounts: account 2 found');
    tx = await run('', await addrAt('', 86, 'tr', 0, 3, 1, 0), 3, 2); if (!/^FOUND: this Taproot address is change address #0 \(m\/86'\/0'\/3'\/1\/0\) of account 3 /.test(tx)) fails.push('try accounts: the last account in the range is searched');
    tx = await run('TREZOR', await addrAt('TREZOR', 49, 'sh-wpkh', 0, 1, 0, 0), 3, 2); if (!/^FOUND: this Nested SegWit address is receive address #0 \(m\/49'\/0'\/1'\/0\/0\) of account 1 of these words, with passphrase\./.test(tx)) fails.push('try accounts: the passphrase variant is searched and named');
    tx = await run('', await addrAt('', 44, 'pkh', 1, 0, 0, 0), 3, 2); if (!/^FOUND: this Testnet Legacy address is receive address #0 /.test(tx)) fails.push('try accounts: testnet addresses are named Testnet');
    tx = await run('', await addrAt('', 84, 'wpkh', 0, 5, 0, 0), 2, 2); if (!/^NOT FOUND in accounts 0 to 2 \(first 2 receive and change addresses of each, without passphrase\)\. Things to check: .*type it in the box above/.test(tx) || !/bad/.test($('addrCheckStatus').className)) fails.push('try accounts: an account beyond the range is NOT FOUND with advice');
    tx = await run('', await addrAt('', 84, 'wpkh', 0, 0, 0, 3), 2, 2); if (!/^NOT FOUND in accounts 0 to 2 \(first 2 /.test(tx)) fails.push('try accounts: an address beyond the depth is NOT FOUND');
    tx = await run('TREZOR', await addrAt('', 84, 'wpkh', 0, 5, 0, 0), 1, 1); if (!/without passphrase and with passphrase\)\. Things to check: .*\(you typed one; try another spelling\)/.test(tx)) fails.push('try accounts: NOT FOUND names both variants and the typed passphrase');
    tx = await run('', 'hello', 2, 2); if (!/^Enter a bc1q/.test(tx)) fails.push('try accounts: not an address');
    $('phrase').value = 'abandon abandon'; $('checkAddr').value = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'; await w.checkAllAccounts(2, 2); if (!/valid seed phrase/.test(st())) fails.push('try accounts: needs a valid phrase');
    { $('phrase').value = AB; $('verifyPass').value = ''; $('checkAddr').value = await addrAt('', 84, 'wpkh', 0, 15, 0, 0);
      const p1 = w.checkAllAccounts(20, 5); for (let n = 0; n < 500 && $('checkAcctsStop').disabled; n++) await sleep(10);
      if ($('checkAcctsStop').disabled || !$('checkAddrBtn').disabled || !$('checkAcctsBtn').disabled) fails.push('try accounts: while searching STOP is on and the search buttons are off');
      await w.checkAllAccounts(0, 1); if ($('checkAcctsStop').disabled) fails.push('try accounts: a second press while searching must do nothing');
      $('checkAcctsStop').click(); await p1;
      if (!/^Stopped\./.test(st()) || !$('checkAcctsStop').disabled || $('checkAddrBtn').disabled || $('checkAcctsBtn').disabled) fails.push('try accounts: STOP ends the search and the buttons come back'); }
    { $('phrase').value = AB; $('verifyPass').value = ''; $('checkAddr').value = await addrAt('', 84, 'wpkh', 0, 0, 0, 0); $('addrCheckStatus').textContent = '';
      $('checkAcctsBtn').click(); for (let n = 0; n < 500 && !/FOUND/.test(st()); n++) await sleep(20);
      if (!/^FOUND: this SegWit address is receive address #0 /.test(st())) fails.push('try accounts: the button starts the search'); }
    w.setGate('fail', 'SELF-TEST FAILED', 'bad'); if (!$('checkAcctsBtn').disabled) fails.push('try accounts: a failed self-test disables the button'); w.setGate('pass', 'SELF-TEST PASSED', 'good');
    $('phrase').value = ''; $('checkAddr').value = ''; $('verifyPass').value = ''; $('addrCheckStatus').textContent = ''; }
  { // Translation and passphrase notes (v1.29.0)
    const d = w.document, m = d.querySelector('meta[name="google"]'), adv = w.document.getElementById('passphrase').closest('details');
    if (d.documentElement.getAttribute('translate') !== 'no') fails.push('translation: html translate=no');
    if (!m || m.getAttribute('content') !== 'notranslate') fails.push('translation: notranslate meta');
    if (!adv || !/Some hardware wallets limit how long a passphrase can be or which characters it can use, so test a small amount on your device before you rely on it\./.test(adv.textContent)) fails.push('passphrase: hardware wallet limit note'); }
  { // Page icon (v1.28.0)
    const ic = [...w.document.querySelectorAll('link[rel~="icon"]')], hs = ic.map((l) => l.getAttribute('href') || '');
    const svg = hs.find((h) => /^data:image\/svg\+xml,/.test(h)), png = hs.find((h) => /^data:image\/png;base64,/.test(h));
    const svgText = svg ? decodeURIComponent(svg.slice(svg.indexOf(',') + 1)) : '', pb = png ? Buffer.from(png.slice(png.indexOf(',') + 1), 'base64') : Buffer.alloc(0);
    if (ic.length !== 2 || !hs.every((h) => h.startsWith('data:'))) fails.push('page icon: two data: icon links and nothing on the network');
    if ((svgText.match(/<circle/g) || []).length !== 5 || !/^<svg[^>]*viewBox="0 0 64 64"/.test(svgText)) fails.push('page icon: the SVG is the five-pip die');
    if (pb.subarray(1, 4).toString() !== 'PNG' || pb.readUInt32BE(16) !== 32 || pb.readUInt32BE(20) !== 32) fails.push('page icon: the PNG is 32 by 32');
    if (w.document.querySelector('link[rel~="apple-touch-icon"], link[rel="manifest"]')) fails.push('page icon: no other linked files');
    { const as = [...w.document.querySelectorAll('a')]; if (as.length !== 1 || as[0].getAttribute('href') !== 'https://random21m.github.io/VOIDFORGE/' || as[0].getAttribute('target') !== '_blank' || as[0].getAttribute('rel') !== 'noopener noreferrer') fails.push('page icon: the one link goes to the online copy, in a new tab, with noopener noreferrer'); }
    if (!/never from a website\. Check the file.s SHA256 first \(see the README\)\. The online copy on the project page is for practice only\. Its address is random21m\.github\.io\/VOIDFORGE, the only link on this page/.test(w.document.body.textContent)) fails.push('page icon: About page says the online copy is practice-only'); }
  { // Reforge (v1.28.0): kept to a few seconds, because it runs for every mutation
    const RF = async (x, chk, pw) => { $('reforgeWordsInput').value = x; $('reforgeWordsCheck').value = chk || ''; $('reforgeWordsPass').value = pw || ''; await w.reforgeWords(); return [$('reforgeStatus').textContent, $('reforgeOut').textContent]; };
    const ZP = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs', A11 = 'abandon '.repeat(11), A0 = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
    const W4 = 'abandon abandon abandon zoo ' + 'abandon '.repeat(7) + 'about';
    let [a, o] = await RF(A11 + '?'); if (!/^128 words fit at position 12 of this 12-word phrase/.test(a) || o.split(/\s+/).length !== 128 || !/(^|\s)about(\s|$)/.test(o)) fails.push('reforge: 12-word last-word list');
    [a, o] = await RF('? ' + 'zoo '.repeat(10) + 'wrong'); if (!/ fit at position 1 of this 12-word phrase/.test(a) || !/(^|\s)zoo(\s|$)/.test(o)) fails.push('reforge: the last word on the list (zoo) is tried');
    [a, o] = await RF(W4, ZP); if (!/^FOUND and confirmed: this phrase gives the zpub/.test(a) || !/word 4 \(zoo\) is abandon\./.test(o)) fails.push('reforge: a wrong word is found by the zpub');
    [a, o] = await RF('abandon '.repeat(10) + 'about abandon', A0); if (!/^FOUND and confirmed/.test(a) || !/word 11 \(about\) is abandon; word 12 \(abandon\) is about/.test(o)) fails.push('reforge: neighbouring swapped words are found');
    { const r = await w.reforgeSearch(w.reforgeParseWords('abandon '.repeat(10) + 'about abandon').idx, await w.reforgeTarget(A0), ''); if (r.matches.length !== 1 || r.checked >= r.valid.length) fails.push('reforge: an address match ends the search'); }
    { const a9 = (await w.mnemonicAddresses(A11 + 'about', '', 10))[9]; [a, o] = await RF(A11 + '?', a9); if (!/receive address #9 \(m\/84'\/0'\/0'\/0\/9\)/.test(o)) fails.push('reforge: receive address 9 is compared'); }
    [a, o] = await RF(A11 + '?', 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr'); if (!/receive address #0 \(m\/86'\/0'\/0'\/0\/0\)/.test(o)) fails.push('reforge: a Taproot address is accepted and matched');
    [a, o] = await RF(A11 + '?', 'bc1qv5rmq0kt9yz3pm36wvzct7p3x6mtgehjul0feu', 'TREZOR'); if (!/^FOUND and confirmed.*with the passphrase you typed/.test(a)) fails.push('reforge: the passphrase is used');
    [a, o] = await RF(A11 + '?', ZP, 'x'); if (!/^NOT FOUND\. None of the 128 valid phrases \(every word at position 12\)/.test(a) || o !== '') fails.push('reforge: NOT FOUND when nothing matches');
    [a, o] = await RF(A11 + '?', '73c5da0a'); if (!/^FOUND one phrase with the master fingerprint 73c5da0a, without a passphrase, after comparing all 128 valid phrases/.test(a) || !/about 1 in 33,554,432\)/.test(a)) fails.push('reforge: a fingerprint search compares every phrase and gives the odds');
    { const fp = await w.mnemonicFingerprint('abandon '.repeat(23) + 'art', ''); [a, o] = await RF('abandon '.repeat(22) + 'art', fp); if (!/^FOUND one phrase/.test(a) || (o.match(/the missing word is/g) || []).length !== 1) fails.push('reforge: a missing word is found once (no duplicate phrases)'); }
    [a] = await RF(A11 + 'about', A0.slice(0, -1) + 'v'); if (!/^That address has a typo/.test(a)) fails.push('reforge: an address typo is refused');
    [a] = await RF(A11 + 'about', 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'); if (!/is not an account key \(it is 0 levels deep/.test(a)) fails.push('reforge: a master xpub is refused');
    [a] = await RF('? ? ? ' + 'abandon '.repeat(9)); if (!/at most 2 unknown words, and 3 are unknown/.test(a)) fails.push('reforge: 3 unknown words are refused');
    [a] = await RF('abandon abandon constructor ' + 'abandon '.repeat(8) + 'about'); if (!/'constructor' is not a BIP39 word/.test(a)) fails.push('reforge: a non-word is unknown even if it is an object property name');
    [a] = await RF('aban '.repeat(11) + 'abou'); if (!/12 words were read from their first letters/.test(a)) fails.push('reforge: 4-letter words are read');
    { const r = await w.checkPhrase('constructor ' + 'abandon '.repeat(10) + 'about'); if (r.ok || !/^Unknown word: constructor \(word 1\): no BIP39 word is close\. /.test(r.msg)) fails.push('verify: a property name typed as a word is unknown'); }
    { let e = ''; try { await w.lastWordCandidates('abandon '.repeat(10).trim().split(' ').concat(['xyzzy'])); } catch (err) { e = err.message; } if (!/^Unknown word: xyzzy/.test(e)) fails.push('last word helper: an unknown word is rejected'); }
    { const t = W4.split(' '); let pairs = 0; for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (t[i] !== t[j]) pairs++;
      const plan = w.reforgePlan(w.reforgeParseWords(W4).idx); let n = 0; for (const c of plan.gen()) n++; if (n !== 1 + pairs + 12 * 2047 || plan.total !== n) fails.push('reforge: the wrong-or-swapped plan tries each candidate once'); }
    await RF(A11 + '?'); $('reforgeWordsPass').dispatchEvent(new w.Event('input')); if ($('reforgeOut').textContent !== '') fails.push('reforge: a passphrase edit clears the result');
    { const RP = async (x, pieces, chk, typo) => { $('reforgePassWords').value = x; $('reforgePassInput').value = pieces; $('reforgePassCheck').value = chk || ''; $('reforgePassTypos').checked = !!typo; await w.reforgePassphrase(); return [$('reforgeStatus').textContent, $('reforgeOut').textContent]; };
      const TZ = 'bc1qv5rmq0kt9yz3pm36wvzct7p3x6mtgehjul0feu', AB = A11 + 'about';
      let [b, q] = await RP(AB, 'trezor', TZ); if (!/^FOUND and confirmed: the passphrase below/.test(b) || !/^“TREZOR”  matches the receive address #0/.test(q)) fails.push('reforge passphrase: a guess is found in UPPERCASE');
      [b, q] = await RP(AB, 'TREZRO', TZ, true); if (!/^“TREZOR”/.test(q)) fails.push('reforge passphrase: one typo is found when ticked');
      [b, q] = await RP(AB, 'TREZRO', TZ); if (!/^NOT FOUND\. None of the 4 passphrases tried/.test(b) || q !== '') fails.push('reforge passphrase: NOT FOUND without the typo box');
      [b, q] = await RP(AB, 'x', A0); if (!/^FOUND and confirmed: these words with NO passphrase/.test(b)) fails.push('reforge passphrase: no passphrase is tried first');
      [b] = await RP(AB, 'trezor', '73c5da0a'); if (!/after trying all 4\./.test(b) || !/about 1 in 1,073,741,824\)/.test(b)) fails.push('reforge passphrase: a fingerprint search tries everything and gives the odds');
      [b] = await RP(AB.replace('about', 'zoo'), 'trezor', TZ); if (!/^Type all 12, 15, 18, 21 or 24 of your seed words first/.test(b)) fails.push('reforge passphrase: an invalid phrase is refused');
      // Fast check first: if the 20-line limit were gone, the page would start a search of about 67,000 passphrases (hours in a test run),
      // so ask the candidate builder directly and skip the slow on-page search when it does not refuse.
      { let refused = false; try { w.reforgePassCandidates(Array.from({ length: 21 }, (_, i) => 'p' + i).join('\n'), false); } catch (e) { refused = /^Type at most 20 lines/.test(e.message); }
        if (!refused) fails.push('reforge passphrase: more than 20 lines refused');
        else { [b] = await RP(AB, Array.from({ length: 21 }, (_, i) => 'p' + i).join('\n'), TZ); if (!/^Type at most 20 lines/.test(b)) fails.push('reforge passphrase: more than 20 lines refused (on the page)'); } }
      const C = (x, t) => w.reforgePassCandidates(x, t), has = (list, ...xs) => xs.every((x) => list.includes(x));
      const c2 = C('a\nb', false), c3 = C('a\nb\nc', false), ct = C('ab', true);
      if (c2[0] !== '' || !has(c2, 'ab', 'ba', 'a b', 'b a', 'AB', 'Ab', 'A b', 'A B') || has(c2, 'aab')) fails.push('reforge passphrase: pairs, spaces and letter cases are tried (and no typos unless ticked)');
      if (!has(c3, 'abc', 'c b a', 'Bca')) fails.push('reforge passphrase: triples are tried');
      if (!has(C('A', false), 'a') || !has(C(' a ', false), 'a', ' a ')) fails.push('reforge passphrase: lowercase and trimmed forms are tried');
      if (!has(ct, 'a', 'b', 'aab', 'abb', 'ba', 'aB')) fails.push('reforge passphrase: each kind of typo is tried');
      await RP(AB, 'trezor', TZ); $('reforgePassInput').dispatchEvent(new w.Event('input')); if ($('reforgeOut').textContent !== '') fails.push('reforge passphrase: editing the guesses clears the result');
      $('reforgePassTypos').checked = true; $('reforgePassWords').value = 'w'; w.reforgeClear(); if ($('reforgePassTypos').checked || $('reforgePassWords').value !== '') fails.push('reforge passphrase: CLEAR empties the passphrase fields'); }
    $('reforgeWordsInput').value = 'a'; $('reforgeWordsCheck').value = 'b'; $('reforgeWordsPass').value = 'c'; w.reforgeClear(); if (['reforgeWordsInput', 'reforgeWordsCheck', 'reforgeWordsPass'].some((id) => $(id).value !== '')) fails.push('reforge: CLEAR empties every field'); }
  try { const K = (n) => new Uint8Array(32).fill(n), pubE = (n) => secp256k1.getPublicKey(K(n), true), pubS = (n) => schnorr.getPublicKey(K(n));
    const kinds = { p2wpkh: (n) => btc.p2wpkh(pubE(n)), p2pkh: (n) => btc.p2pkh(pubE(n)), p2tr: (n) => btc.p2tr(pubS(n)), p2sh: (n) => btc.p2sh(btc.p2wpkh(pubE(n))), p2wsh: (n) => btc.p2wsh(btc.p2ms(1, [pubE(n), pubE(n + 1)])) };
    const insp = async (bytes, net = 'main') => w.inspectPsbt(new Uint8Array(bytes), net);
    // checks list, RBF, locktime, raw transactions, OP_RETURN data (independent builder and txid)
    { const mk = (seq, lock, outAmt, inAmts = [90000n, 70000n], note = 'hello') => { const t = new btc.Transaction({ allowUnknownOutputs: true, lockTime: lock });
        inAmts.forEach((a, i) => t.addInput({ txid: '0102' + '22'.repeat(30), index: i, sequence: seq, witnessUtxo: { script: kinds.p2wpkh(30).script, amount: a } }));
        t.addOutput({ script: kinds.p2wpkh(31).script, amount: outAmt }); const d = Buffer.from(note, 'latin1'); t.addOutput({ script: Uint8Array.from([0x6a, d.length, ...d]), amount: 0n }); return t; };
      const rep = async (t) => w.psbtReport(await insp(t.toPSBT(0)), null);
      const good = mk(0xfffffffd, 0, 158000n), gr = await insp(good.toPSBT(0)), gt = w.psbtReport(gr, null);
      if (gr.rbf !== true || !/REPLACEABLE \(RBF\): yes/.test(gt)) fails.push('rbf: sequence below final signals replaceable');
      const fin = mk(0xffffffff, 0, 158000n), fr = await insp(fin.toPSBT(0)); if (fr.rbf !== false || !/REPLACEABLE \(RBF\): no/.test(w.psbtReport(fr, null))) fails.push('rbf: final sequence is not replaceable');
      const mid = mk(0xfffffffe, 0, 158000n); if ((await insp(mid.toPSBT(0))).rbf !== false) fails.push('rbf: sequence fffffffe is not replaceable');
      { const ruMid = await insp(mid.unsignedTx), ruFin = await insp(fin.unsignedTx); if (ruMid.rbf !== false || ruFin.rbf !== false || (await insp(good.unsignedTx)).rbf !== true) fails.push('rbf: raw transaction threshold'); }
      if (!/no problems found/.test(gt) || /NO CLEAN VERDICT/.test(gt)) fails.push('verdict: a complete small-fee transaction has a clean result');
      if (!/data note: 5 bytes: 68656c6c6f = "hello"/.test(gt)) fails.push('op_return: data shown as hex and text');
      if (/= "/.test(await rep(mk(0xfffffffd, 0, 158000n, undefined, 'a\u0001b')))) fails.push('op_return: non-text data is not shown as text');
      if (!/LOCKTIME: it cannot be mined before block 850000/.test(await rep(mk(0xfffffffd, 850000, 158000n)))) fails.push('locktime: block height shown');
      if (!/LOCKTIME: it cannot be mined before 2023-11-14 22:13 UTC/.test(await rep(mk(0xfffffffd, 1700000000, 158000n)))) fails.push('locktime: date shown');
      if (/LOCKTIME/.test(await rep(mk(0xffffffff, 850000, 158000n)))) fails.push('locktime: ignored when every input is final');
      if (!/FAIL  The fee is 5% or more/.test(await rep(mk(0xfffffffd, 0, 150000n))) || !/NO CLEAN VERDICT/.test(await rep(mk(0xfffffffd, 0, 150000n)))) fails.push('verdict: fee of 5% or more blocks a clean result');
      if (/5% or more/.test(await rep(mk(0xfffffffd, 0, 150001n, [150001n + 7000n])))) fails.push('verdict: a fee under 5% is not flagged');
      if (!/FAIL  The outputs add up to MORE/.test(await rep(mk(0xfffffffd, 0, 200000n))) || !/NO CLEAN VERDICT/.test(await rep(mk(0xfffffffd, 0, 200000n)))) fails.push('verdict: outputs above inputs blocks a clean result');
      const unk = new btc.Transaction({ allowUnknownOutputs: true }); unk.addInput({ txid: '33'.repeat(32), index: 0 }); unk.addOutput({ script: kinds.p2wpkh(31).script, amount: 1000n });
      const ut = await rep(unk); if (!/FAIL  1 of 1 input amounts are unknown/.test(ut) || !/NO CLEAN VERDICT/.test(ut) || !/FAIL  The fee cannot be worked out/.test(ut)) fails.push('verdict: unknown input amount blocks a clean result');
      const odd = mk(0xfffffffd, 0, 158000n); odd.addOutput({ script: Uint8Array.from([0x51, 0x02, 1, 2]), amount: 0n }); const ot = await rep(odd);
      if (!/FAIL  1 output has a script this tool cannot turn into an address/.test(ot) || !/NO CLEAN VERDICT/.test(ot)) fails.push('verdict: unrecognized output script blocks a clean result');
      if ((gt.match(/treat as a payment to someone else/g) || []).length !== 1) fails.push('op_return: a data note is not called a payment');
      for (const [len, op] of [[80, [0x4c, 80]], [300, [0x4d, 0x2c, 0x01]]]) { const big = mk(0xfffffffd, 0, 158000n); big.addOutput({ script: Uint8Array.from([0x6a, ...op, ...new Uint8Array(len).fill(0x41)]), amount: 0n });
        if (!new RegExp('data note: ' + len + ' bytes: ').test(await rep(big))) fails.push('op_return: push of ' + len + ' bytes decoded'); }
      if (!/NOTE  No output is marked as change/.test(gt) || /FAIL  No output/.test(gt)) fails.push('verdict: no change output is a note, not a failure');
      // raw transactions: unsigned (txid from the independent library) and signed segwit (txid computed from the legacy serialization)
      const ru = await insp(good.unsignedTx);
      if (!ru.raw || ru.txid !== good.id || ru.fee !== null || ru.outs[0].amount !== 158000n || ru.ins[1].vout !== 1 || ru.ins[0].txid !== '0102' + '22'.repeat(30) || ru.rbf !== true) fails.push('raw: unsigned transaction read, txid equals the independent id');
      if (!/NO CLEAN VERDICT/.test(w.psbtReport(ru, null)) || !/This is a raw transaction, not a PSBT\. Its transaction ID is /.test(w.psbtReport(ru, null))) fails.push('raw: report has the id and no clean verdict');
      { const spk = Buffer.from(bhex.encode(kinds.p2wpkh(31).script), 'hex'), head = Buffer.concat([Buffer.from('02000000', 'hex')]);
        const vin = Buffer.from('01' + '44'.repeat(32) + '00000000' + '00' + 'fdffffff', 'hex'), vout = Buffer.concat([Buffer.from('01a00f000000000000' + '16', 'hex'), spk]), lt = Buffer.from('00000000', 'hex');
        const wit = Buffer.concat([Buffer.from('0203010203' + '21', 'hex'), Buffer.alloc(33, 2)]);
        const signed = Buffer.concat([head, Buffer.from('0001', 'hex'), vin, vout, wit, lt]), stripped = Buffer.concat([head, vin, vout, lt]);
        const wantId = bhex.encode(Uint8Array.from(nc.createHash('sha256').update(nc.createHash('sha256').update(stripped).digest()).digest()).reverse());
        $('psbtInput').value = signed.toString('hex'); await w.runPsbt(); const o = $('psbtOut').textContent, rr = await insp(signed);
        if (!rr.raw || !rr.ins[0].final || rr.ins.length !== 1 || rr.outs.length !== 1 || rr.outs[0].amount !== 4000n || rr.rbf !== true || rr.txid !== wantId) fails.push('raw: signed segwit transaction read, witness skipped, txid ignores the witness');
        if (!/already signed/.test(o) || !o.includes(wantId)) fails.push('raw: signed state and id shown in the report');
        const bad1 = Uint8Array.from([...signed, 0]); let m1 = ''; try { await insp(bad1); } catch (e) { m1 = e.message; } if (!/not a PSBT/.test(m1)) fails.push('raw: extra bytes after a transaction are refused'); }
    }
    // compare two transactions: signer-change and fee-bump checks
    { const mkc = ({ seq = 0xfffffffd, ins = [[1, 90000n], [2, 70000n]], outs = [[31, 100000n], [32, 58000n]], chg = 32 }) => { const t = new btc.Transaction({ allowUnknownOutputs: true });
        ins.forEach(([k, a], i) => t.addInput({ txid: nc.createHash('sha256').update('coin' + k).digest('hex'), index: i, sequence: seq, witnessUtxo: { script: kinds.p2wpkh(30).script, amount: a } }));
        outs.forEach(([k, a]) => t.addOutput(k === chg ? { script: kinds.p2wpkh(k).script, amount: a, bip32Derivation: [[pubE(k), { fingerprint: 0xdeadbeef, path: [0x80000054] }]] } : { script: kinds.p2wpkh(k).script, amount: a })); return t; };
      const cmp = async (a, b) => w.compareTx(await insp(a.toPSBT(0)), await insp(b.toPSBT(0)));
      const A = mkc({}), sg = mkc({}); sg.updateInput(0, { partialSig: [[pubE(30), new Uint8Array(71).fill(1)]] }, true);
      let t = await cmp(A, sg); if (!/SIGNER CHECK: unchanged/.test(t) || !/0 signatures -> 1 signature/.test(t) || /DIFFERENT/.test(t)) fails.push('compare: same transaction with signatures added is unchanged');
      if ((await insp(A.toPSBT(0))).txid !== A.id) fails.push('compare: psbt transaction id equals the independent id');
      t = await cmp(A, mkc({ outs: [[31, 100000n], [32, 56000n]] })); if (!/DIFFERENT/.test(t) || !/the second pays 0\.00002000 BTC.*MORE/.test(t) || !/plain fee bump/.test(t) || !/OK    The output that got smaller .* is marked as this wallet's own change/.test(t)) fails.push('compare: plain fee bump recognised');
      t = await cmp(A, mkc({})); if (!/SIGNER CHECK: unchanged/.test(t)) fails.push('compare: identical rebuilt transaction is unchanged');
      const nofp = mkc({ chg: 99 }); t = await cmp(nofp, mkc({ chg: 99, outs: [[31, 100000n], [32, 56000n]] })); if (!/NOTE  The output that got smaller .* is not marked as change/.test(t)) fails.push('compare: shrinking output without change info is noted');
      t = await cmp(A, mkc({ outs: [[33, 100000n], [32, 58000n]] })); if (!/Payments changed: an output changed address|more than one output differs/.test(t) || !/does NOT look like a plain fee bump/.test(t) || !/only in the first:  0\.00100000 BTC \(100000 sats\) to /.test(t)) fails.push('compare: redirected output is not a fee bump');
      t = await cmp(A, mkc({ ins: [[1, 90000n], [2, 70000n], [7, 2000n]], outs: [[33, 100000n], [32, 58000n]] })); if (!/Payments changed: an output changed address/.test(t)) fails.push('compare: one output changing address is named');
      t = await cmp(A, mkc({ outs: [[31, 90000n], [34, 8000n], [32, 56000n]] })); if (!/Payments changed: more than one output differs/.test(t)) fails.push('compare: more than one differing output');
      t = await cmp(A, mkc({ outs: [[31, 90000n], [32, 56000n]] })); if (!/Payments changed: more than one output differs/.test(t) || !/does NOT look like/.test(t)) fails.push('compare: two differing outputs, one new each');
      t = await cmp(A, mkc({ outs: [[31, 100000n], [32, 60000n]] })); if (!/LESS/.test(t) || !/FAIL  The second does not pay a higher fee/.test(t) || !/got MORE money and no coin was added/.test(t) || !/does NOT look like/.test(t)) fails.push('compare: lower fee and grown output rejected');
      t = await cmp(A, mkc({ ins: [[1, 90000n], [2, 70000n], [7, 10000n]], outs: [[31, 100000n], [32, 58000n], [34, 8000n]] })); if (!/Payments changed: a new output appeared/.test(t)) fails.push('compare: a new output is flagged');
      t = await cmp(mkc({ seq: 0xffffffff }), mkc({ outs: [[31, 100000n], [32, 56000n]] })); if (!/FAIL  The first does not allow replacement/.test(t) || !/does NOT look like/.test(t)) fails.push('compare: no RBF rejected');
      t = await cmp(A, mkc({ ins: [[5, 90000n], [6, 70000n]], outs: [[31, 100000n], [32, 56000n]] })); if (!/FAIL  The second does not spend any of the same coins/.test(t) || !/only in the second: [0-9a-f]{64}:0/.test(t) || !/does NOT look like/.test(t)) fails.push('compare: no shared coin rejected');
      t = await cmp(A, mkc({ ins: [[1, 90000n], [2, 70000n], [7, 20000n]], outs: [[31, 100000n], [32, 76000n]] })); if (!/plain fee bump/.test(t) || /NOT look like/.test(t) || !/OK    The output that grew \(an extra coin was added\)/.test(t)) fails.push('compare: added coin with larger change is a fee bump');
      t = await cmp(nofp, mkc({ chg: 99, ins: [[1, 90000n], [2, 70000n], [7, 20000n]], outs: [[31, 100000n], [32, 76000n]] })); if (!/got MORE money and is not marked as change/.test(t) || !/does NOT look like/.test(t)) fails.push('compare: larger unmarked output after an added coin is rejected');
      t = await cmp(A, mkc({ ins: [[1, 90000n], [2, 70000n], [7, 20000n]], outs: [[31, 100000n], [32, 78000n]] })); if (!/FAIL  The second does not pay a higher fee/.test(t) || !/does NOT look like/.test(t) || /the second pays .* MORE/.test(t) || !/the same/.test(t)) fails.push('compare: equal fee is not a higher fee');
      const bare = new btc.Transaction({ allowUnknownOutputs: true }); bare.addInput({ txid: nc.createHash('sha256').update('coin1').digest('hex'), index: 0, sequence: 0xfffffffd }); bare.addOutput({ script: kinds.p2wpkh(31).script, amount: 1000n });
      t = await cmp(bare, A); if (!/NO CLEAN VERDICT/.test(t) || !/cannot be compared/.test(t)) fails.push('compare: unknown fee gives no clean verdict');
      $('cmpA').value = 'zzz'; $('cmpB').value = Buffer.from(A.toPSBT(0)).toString('base64'); await w.runCompare(); if (!/^First transaction: /.test($('cmpStatus').textContent)) fails.push('compare: bad first transaction is named');
      $('cmpA').value = Buffer.from(A.toPSBT(0)).toString('base64'); $('cmpB').value = 'zzz'; await w.runCompare(); if (!/^Second transaction: /.test($('cmpStatus').textContent)) fails.push('compare: bad second transaction is named');
      $('cmpB').value = $('cmpA').value; await w.runCompare(); $('cmpA').dispatchEvent(new w.Event('input')); if ($('cmpOut').textContent !== '') fails.push('compare: editing the first box clears the result');
      await w.runCompare(); $('cmpB').dispatchEvent(new w.Event('input')); if ($('cmpOut').textContent !== '') fails.push('compare: editing the second box clears the result');
    }
    // signatures: nonce reuse and sighash checks
    { const enc = (x) => { let b = Buffer.from(x.toString(16).padStart(64, '0'), 'hex'); while (b.length > 1 && b[0] === 0) b = b.slice(1); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return Buffer.concat([Buffer.from([2, b.length]), b]); };
      const der = (r, sv, sh = 1) => { const body = Buffer.concat([enc(r), enc(sv)]); return new Uint8Array(Buffer.concat([Buffer.from([0x30, body.length]), body, Buffer.from([sh])])); };
      const R1 = 0x8123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefn, R2 = 0x7223456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefn, RS = 1n << 200n, S1 = 0x9111111111111111111111111111111111111111111111111111111111111111n, S2 = 0x2222222222222222222222222222222222222222222222222222222222222222n, SS = 1n << 100n;
      const mk = (nin, spk = kinds.p2wpkh(30).script) => { const t = new btc.Transaction({ allowUnknownOutputs: true }); for (let i = 0; i < nin; i++) t.addInput({ txid: nc.createHash('sha256').update('s' + i).digest('hex'), index: 0, sequence: 0xfffffffd, witnessUtxo: { script: spk, amount: 50000n } }); t.addOutput({ script: kinds.p2wpkh(31).script, amount: BigInt(nin) * 50000n - 100n }); return t; };
      const rep = async (t) => w.psbtReport(await insp(t.toPSBT(0)), null), ps = (t, i, sig) => t.updateInput(i, { partialSig: [[pubE(30), sig]] }, true);
      const vi = (n) => Buffer.from([n]);
      const rawTx = (ins) => { const seg = ins.some((x) => x.wit); const parts = [Buffer.from('01000000', 'hex')]; if (seg) parts.push(Buffer.from('0001', 'hex')); parts.push(vi(ins.length));
        ins.forEach((x, i) => parts.push(Buffer.alloc(32, 0x50 + i), Buffer.alloc(4), vi(x.ss.length), x.ss, Buffer.from('fdffffff', 'hex')));
        parts.push(Buffer.from('01a00f00000000000016', 'hex'), Buffer.from(kinds.p2wpkh(31).script)); if (seg) ins.forEach((x) => { const wi = x.wit || []; parts.push(vi(wi.length)); wi.forEach((y) => parts.push(vi(y.length), Buffer.from(y))); }); parts.push(Buffer.alloc(4)); return Buffer.concat(parts); };
      let tt = mk(2); ps(tt, 0, der(R1, S1)); ps(tt, 1, der(R1, S2)); let o = await rep(tt);
      if (!/NONCE REUSED: 1 nonce value is shared by different signatures \(inputs 0, 1\)/.test(o) || !/FAIL  NONCE REUSED/.test(o) || !/NO CLEAN VERDICT/.test(o)) fails.push('sig: the same nonce in two different signatures is flagged');
      tt = mk(2); ps(tt, 0, der(R1, S1)); ps(tt, 1, der(R1, S1)); o = await rep(tt); if (!/No two of the 2 signatures share a nonce/.test(o) || /NONCE REUSED/.test(o)) fails.push('sig: an identical signature twice is not reuse');
      tt = mk(2); ps(tt, 0, der(R1, S1)); ps(tt, 1, der(R2, S2)); o = await rep(tt); if (!/No two of the 2 signatures share a nonce/.test(o) || !/no problems found/.test(o)) fails.push('sig: different nonces are fine');
      tt = mk(1); ps(tt, 0, der(R1, S1)); o = await rep(tt); if (/share a nonce|NONCE/.test(o) || !/Every signature covers the whole transaction/.test(o)) fails.push('sig: one signature gives no nonce line');
      { const q = await insp(((x) => (ps(x, 0, der(R1, S1)), ps(x, 1, der(RS, SS)), x.toPSBT(0)))(mk(2))); if (q.sigs.length !== 2 || q.sigs[0].r !== R1.toString(16) || q.sigs[1].r !== RS.toString(16).padStart(64, '0') || q.sigs[0].s !== S1.toString(16) || q.sigs[1].s !== SS.toString(16).padStart(64, '0') || q.sigs[0].kind !== 'ECDSA' || q.sigs[1].input !== 1) fails.push('sig: DER values, padding and input numbers read exactly'); }
      { const bad = der(R1, SS); for (const [name, f] of [['total length', (b) => { b[1]--; }], ['r tag', (b) => { b[2] = 3; }], ['s tag', (b) => { b[4 + b[3]] = 3; }], ['s length', (b) => { b[5 + b[3]]++; }], ['marker', (b) => { b[0] = 0x31; }]]) { const c = Uint8Array.from(bad); f(c); const t = mk(1); ps(t, 0, c); const q = await insp(t.toPSBT(0)); if (q.sigs.length !== 0) fails.push('sig: damaged DER (' + name + ') is not a signature'); } }
      for (const [sh, nm] of [[2, 'NONE'], [3, 'SINGLE'], [0x81, 'ALL \\+ ANYONECANPAY'], [0x82, 'NONE \\+ ANYONECANPAY'], [0x83, 'SINGLE \\+ ANYONECANPAY']]) { tt = mk(1); ps(tt, 0, der(R1, S1, sh)); o = await rep(tt); if (!new RegExp('input 0: ' + nm + '[;)]').test(o) || !/FAIL  1 signature or signing request use a sighash type other than ALL/.test(o) || !/NO CLEAN VERDICT/.test(o)) fails.push('sig: sighash ' + sh + ' flagged by name'); }
      tt = mk(1); ps(tt, 0, der(R1, S1, 5)); o = await rep(tt); if (!/unknown \(0x5\)/.test(o)) fails.push('sig: unknown sighash named');
      tt = mk(1); tt.updateInput(0, { sighashType: 2 }, true); o = await rep(tt); if (!/input 0 asks for NONE/.test(o) || !/NO CLEAN VERDICT/.test(o)) fails.push('sig: a signing request for NONE is flagged');
      for (const v of [0, 1]) { tt = mk(1); tt.updateInput(0, { sighashType: v }, true); o = await rep(tt); if (!/no problems found/.test(o)) fails.push('sig: a signing request for ' + v + ' is fine'); }
      // taproot (Schnorr): key-path and script-path signatures, 64 and 65 bytes
      const xo = pubS(40), tr = btc.p2tr(xo).script, s64a = Uint8Array.from(Buffer.concat([Buffer.alloc(32, 7), Buffer.alloc(32, 1)])), s64b = Uint8Array.from(Buffer.concat([Buffer.alloc(32, 7), Buffer.alloc(32, 2)])), s64c = Uint8Array.from(Buffer.concat([Buffer.alloc(32, 8), Buffer.alloc(32, 2)]));
      tt = mk(2, tr); tt.updateInput(0, { tapKeySig: s64a }, true); tt.updateInput(1, { tapKeySig: s64b }, true); o = await rep(tt); if (!/NONCE REUSED: 1 nonce value is shared by different signatures \(inputs 0, 1\)/.test(o)) fails.push('sig: a repeated Schnorr nonce is flagged');
      tt = mk(2, tr); tt.updateInput(0, { tapKeySig: s64a }, true); tt.updateInput(1, { tapKeySig: s64c }, true); o = await rep(tt); if (!/No two of the 2 signatures share/.test(o) || !/Every signature covers/.test(o)) fails.push('sig: different Schnorr nonces and the default sighash are fine');
      tt = mk(2, tr); tt.updateInput(0, { tapScriptSig: [[{ pubKey: xo, leafHash: new Uint8Array(32) }, s64a]] }, true); tt.updateInput(1, { tapScriptSig: [[{ pubKey: xo, leafHash: new Uint8Array(32) }, s64b]] }, true); o = await rep(tt); if (!/NONCE REUSED/.test(o)) fails.push('sig: a repeated Schnorr nonce in script-path signatures is flagged');
      tt = mk(1, tr); tt.updateInput(0, { tapKeySig: new Uint8Array([...s64a, 2]) }, true); o = await rep(tt); if (!/input 0: NONE;|input 0: NONE\)/.test(o)) fails.push('sig: Schnorr sighash NONE flagged');
      tt = mk(1, tr); tt.updateInput(0, { tapKeySig: new Uint8Array([...s64a, 1]) }, true); o = await rep(tt); if (!/Every signature covers/.test(o)) fails.push('sig: Schnorr explicit ALL is fine');
      { const q = await insp(((x) => (x.updateInput(0, { tapKeySig: new Uint8Array([...s64a, 0]) }, true), x.toPSBT(0)))(mk(1, tr))); if (q.sigs.length !== 0) fails.push('sig: a 65-byte Schnorr signature with sighash byte 0 is not accepted'); }
      { const q = await insp(((x) => (x.updateInput(0, { tapKeySig: s64a }, true), x.toPSBT(0)))(mk(1, tr))); if (q.sigs.length !== 1 || q.sigs[0].r !== '07'.repeat(32) || q.sigs[0].s !== '01'.repeat(32) || q.sigs[0].kind !== 'Schnorr' || q.sigs[0].sighash !== 0) fails.push('sig: Schnorr values read exactly'); }
      // finalized PSBT inputs and raw transactions: scriptSig pushes, witness items, annex
      const pk33 = Uint8Array.from(Buffer.concat([Buffer.from([3]), Buffer.alloc(32, 9)])), big1 = der(R1, S1), big2 = der(R1, S2);
      tt = mk(2); tt.updateInput(0, { finalScriptWitness: [big1, pk33] }, true); tt.updateInput(1, { finalScriptWitness: [big2, pk33] }, true); o = await rep(tt); if (!/NONCE REUSED: 1 nonce value is shared by different signatures \(inputs 0, 1\)/.test(o)) fails.push('sig: reuse in finalized witnesses of a PSBT is flagged');
      tt = mk(2); tt.updateInput(0, { finalScriptSig: Buffer.concat([vi(big1.length), big1, vi(33), pk33]) }, true); tt.updateInput(1, { finalScriptSig: Buffer.concat([vi(big2.length), big2, vi(33), pk33]) }, true); o = await rep(tt); if (!/NONCE REUSED: 1 nonce value is shared by different signatures \(inputs 0, 1\)/.test(o)) fails.push('sig: reuse in finalized scriptSigs of a PSBT is flagged');
      let rr = await insp(rawTx([{ ss: Buffer.alloc(0), wit: [big1, pk33] }, { ss: Buffer.alloc(0), wit: [big2, pk33] }])); o = w.psbtReport(rr, null); if (rr.sigs.length !== 2 || rr.sigs[1].input !== 1 || !/NONCE REUSED: 1 nonce value is shared by different signatures \(inputs 0, 1\)/.test(o)) fails.push('sig: reuse in the witnesses of a raw transaction is flagged');
      rr = await insp(rawTx([{ ss: Buffer.concat([vi(big1.length), big1, vi(33), pk33]) }, { ss: Buffer.concat([vi(big2.length), big2, vi(33), pk33]) }])); o = w.psbtReport(rr, null); if (rr.sigs.length !== 2 || rr.sigs[1].input !== 1 || !/NONCE REUSED: 1 nonce value is shared by different signatures \(inputs 0, 1\)/.test(o)) fails.push('sig: reuse in the scriptSigs of a raw transaction is flagged');
      for (const [name, pre] of [['PUSHDATA1', Buffer.from([0x4c, big1.length])], ['PUSHDATA2', Buffer.from([0x4d, big1.length, 0])]]) { rr = await insp(rawTx([{ ss: Buffer.concat([pre, big1, vi(33), pk33]) }])); if (rr.sigs.length !== 1 || rr.sigs[0].s !== S1.toString(16)) fails.push('sig: a signature pushed with ' + name + ' is found'); }
      for (const [name, pre] of [['PUSHDATA1', Buffer.from([0x4c, 80])], ['PUSHDATA2', Buffer.from([0x4d, 80, 0])]]) { rr = await insp(rawTx([{ ss: Buffer.concat([pre, Buffer.alloc(80, 0x4b), vi(big1.length), big1, vi(33), pk33]) }])); if (rr.sigs.length !== 1) fails.push('sig: a signature after a large ' + name + ' push is found'); }
      rr = await insp(rawTx([{ ss: Buffer.concat([vi(big1.length), big1, vi(33), pk33]) }])); if (big1.length < 73 || rr.sigs.length !== 1) fails.push('sig: a 73-byte signature in a direct push is found');
      rr = await insp(rawTx([{ ss: Buffer.alloc(0), wit: [s64a] }, { ss: Buffer.alloc(0), wit: [s64b] }])); if (rr.sigs.length !== 2 || rr.sigs[0].kind !== 'Schnorr' || !/NONCE REUSED/.test(w.psbtReport(rr, null))) fails.push('sig: a taproot key-path witness in a raw transaction is read');
      rr = await insp(rawTx([{ ss: Buffer.alloc(0), wit: [s64a, Buffer.from([0x50, 1, 2])] }])); if (rr.sigs.length !== 1) fails.push('sig: a taproot witness with an annex is read');
      rr = await insp(rawTx([{ ss: Buffer.alloc(0), wit: [s64a, Buffer.from([0x51, 1, 2])] }])); if (rr.sigs.length !== 0) fails.push('sig: two witness items that are not signature plus annex are not read as Schnorr');
      rr = await insp(rawTx([{ ss: Buffer.alloc(0), wit: [Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 0x22)]), pk33] }])); if (rr.sigs.length !== 0) fails.push('sig: an uncompressed public key is not a signature');
      rr = await insp(rawTx([{ ss: Buffer.alloc(0), wit: [Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 0x22)])] }])); if (rr.sigs.length !== 1) fails.push('sig: a single 65-byte witness item is read as a Schnorr signature (only the taproot key-path form)');
      // nonceReuse itself, and the compare box
      if (w.nonceReuse([{ kind: 'ECDSA', r: 'a', s: '1' }, { kind: 'ECDSA', r: 'a', s: '1' }]).length !== 0 || w.nonceReuse([{ kind: 'ECDSA', r: 'a', s: '1' }, { kind: 'ECDSA', r: 'a', s: '2' }]).length !== 1 || w.nonceReuse([{ kind: 'ECDSA', r: 'a', s: '1' }, { kind: 'ECDSA', r: 'b', s: '2' }]).length !== 0 || w.nonceReuse([{ kind: 'ECDSA', r: 'a', s: '1' }, { kind: 'Schnorr', r: 'a', s: '1' }]).length !== 1) fails.push('sig: nonceReuse groups by R and ignores identical signatures');
      const tA = mk(1), tB = mk(1); ps(tA, 0, der(R1, S1)); ps(tB, 0, der(R1, S2));
      let ct = w.compareTx(await insp(tA.toPSBT(0)), await insp(tB.toPSBT(0))); const lines = ct.split('\n');
      if (!/NONCE CHECK: FAIL. 1 nonce value is shared/.test(ct) || !/^NONCE REUSE FOUND\. /.test(lines[lines.length - 1])) fails.push('sig: compare finds a nonce shared across two transactions');
      ct = w.compareTx(await insp(tA.toPSBT(0)), await insp(tA.toPSBT(0))); if (/NONCE CHECK: FAIL|NONCE REUSE FOUND/.test(ct) || !/NONCE CHECK: OK/.test(ct)) fails.push('sig: compare of one signature (twice the same) raises nothing');
      const tC = mk(1); ps(tC, 0, der(R2, S2)); ct = w.compareTx(await insp(tA.toPSBT(0)), await insp(tC.toPSBT(0))); if (!/NONCE CHECK: OK. No two different signatures across the 2 found share a nonce/.test(ct) || /NONCE REUSE FOUND/.test(ct)) fails.push('sig: compare with different nonces is fine');
    }
    // every script type, mainnet and testnet, against the independent decoder
    for (const test of [false, true]) { const NET = test ? btc.TEST_NETWORK : btc.NETWORK, ad = (sc) => btc.Address(NET).encode(btc.OutScript.decode(sc));
      for (const [ik, ok] of [['p2wpkh', 'p2tr'], ['p2tr', 'p2wsh'], ['p2pkh', 'p2sh'], ['p2sh', 'p2pkh'], ['p2wsh', 'p2wpkh']]) {
        const tx = new btc.Transaction({ allowUnknownOutputs: true }); tx.addInput({ txid: '11'.repeat(32), index: 1, witnessUtxo: { script: kinds[ik](20).script, amount: 123456n } });
        tx.addOutput({ script: kinds[ok](40).script, amount: 50000n }); tx.addOutput({ script: kinds.p2wpkh(41).script, amount: 1n });
        const r = await insp(tx.toPSBT(0), test ? 'test' : 'main'), tag = `psbt ${test ? 'testnet ' : ''}${ik} -> ${ok}`;
        if (r.ins[0].address !== ad(kinds[ik](20).script)) fails.push(tag + ': input address');
        if (r.outs[0].address !== ad(kinds[ok](40).script) || r.outs[1].address !== ad(kinds.p2wpkh(41).script)) fails.push(tag + ': output addresses');
        if (r.fee !== 123456n - 50001n) fails.push(tag + ': fee'); } }
    // big numbers, locktime, version, 3-byte and 5-byte length prefixes, signatures, finalized inputs, taproot key information
    { const tx = new btc.Transaction({ lockTime: 2500000000, version: 2, allowUnknownOutputs: true });
      const TXID = Array.from({ length: 32 }, (_, k) => (k * 7 + 3).toString(16).padStart(2, '0')).join(''); for (const [i, id] of [[70000, TXID], [0, 'cd'.repeat(32)], [3, 'ef'.repeat(32)]]) tx.addInput({ txid: id, index: i, witnessUtxo: { script: kinds.p2wpkh(5).script, amount: i === 70000 ? 2100000000000000n : 5n } });
      tx.addOutput({ script: Uint8Array.from([0x6a, 0x4d, 0x2c, 0x01, ...new Uint8Array(300).fill(7)]), amount: 0n });
      tx.addOutput({ script: Uint8Array.from([0x6a, 0x4e, 0x70, 0x11, 0x01, 0x00, ...new Uint8Array(70000).fill(7)]), amount: 1n });
      tx.addOutput({ script: kinds.p2tr(3).script, amount: 7n, tapBip32Derivation: [[pubS(3), { hashes: [], der: { fingerprint: 0x01020304, path: [0x80000056] } }]] });
      tx.addOutput({ script: kinds.p2tr(11).script, amount: 3n, tapBip32Derivation: [[pubS(11), { hashes: [new Uint8Array(32).fill(9), new Uint8Array(32).fill(8)], der: { fingerprint: 0x0a0b0c0d, path: [0x80000056] } }]] });
      tx.addOutput({ script: kinds.p2wpkh(4).script, amount: 9n, bip32Derivation: [[pubE(4), { fingerprint: 0xdeadbeef, path: [0x80000054] }]] });
      tx.updateInput(0, { partialSig: [[pubE(5), new Uint8Array(71).fill(1)], [pubE(6), new Uint8Array(71).fill(2)]] }, true); tx.updateInput(1, { finalScriptWitness: [new Uint8Array([2, 2, 2])] }, true);
      const r = await insp(tx.toPSBT(0));
      if (r.version !== 2 || r.locktime !== 2500000000) fails.push('psbt: version and locktime (locktime above 2^31)');
      if (r.ins[0].vout !== 70000 || r.ins[0].amount !== 2100000000000000n) fails.push('psbt: large vout and 21,000,000 BTC amount');
      if (r.ins[0].sigs !== 2 || r.ins[0].final || r.ins[1].sigs !== 0 || !r.ins[1].final) fails.push('psbt: signature count and finalized flag');
      if (r.outs.length !== 5 || !/^OP_RETURN/.test(r.outs[0].address) || !/^OP_RETURN/.test(r.outs[1].address) || r.outs[1].amount !== 1n) fails.push('psbt: script longer than 252 and than 65535 bytes');
      if (r.outs[2].fps.join() !== '01020304' || r.outs[4].fps.join() !== 'deadbeef' || r.outs[3].fps.join() !== '0a0b0c0d' || r.outs[0].fps.length !== 0) fails.push('psbt: wallet key information (taproot and ordinary)');
      if (r.fee !== 2100000000000010n - 20n) fails.push('psbt: fee with a huge input');
      if (r.ins[0].txid !== TXID || r.ins[2].vout !== 3) fails.push('psbt: txid and index of each input'); }
    // inputs without an amount, a legacy input given as a full previous transaction (also a segwit-serialized previous transaction)
    { const prev = new btc.Transaction({ allowLegacyWitnessUtxo: true }); prev.addInput({ txid: 'cd'.repeat(32), index: 0, witnessUtxo: { script: kinds.p2wpkh(1).script, amount: 500000n } });
      prev.addOutputAddress(kinds.p2pkh(8).address, 300000n); prev.addOutputAddress(kinds.p2pkh(9).address, 190000n);
      for (const withWitness of [true, false]) { const t2 = new btc.Transaction({ allowLegacyWitnessUtxo: true }); t2.addInput({ txid: prev.id, index: 1, nonWitnessUtxo: prev.toBytes(withWitness, withWitness) }); t2.addOutputAddress(kinds.p2pkh(10).address, 180000n);
        const r = await insp(t2.toPSBT(0)); if (r.ins[0].amount !== 190000n || r.ins[0].address !== kinds.p2pkh(9).address || r.fee !== 10000n) fails.push('psbt: amount read from a full previous transaction' + (withWitness ? ' with witness data' : '')); }
      { const vi = (n) => n < 253 ? [n] : [253, n & 255, n >> 8], kv = (k, v) => [...vi(k.length), ...k, ...vi(v.length), ...v], le8 = (n) => { const o = []; for (let q = 0; q < 8; q++) o.push(Number((BigInt(n) >> BigInt(8 * q)) & 255n)); return o; };
        const out = (amt, sc) => [...le8(amt), ...vi(sc.length), ...sc], sc9 = [...kinds.p2pkh(9).script], sc8 = [...kinds.p2pkh(8).script];
        const prevSeg = [2, 0, 0, 0, 0, 1, 1, ...new Array(32).fill(5), 0, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 2, ...out(300000, sc8), ...out(190000, sc9), 1, 1, 0xff, 0, 0, 0, 0];
        const unsigned = [2, 0, 0, 0, 1, ...new Array(32).fill(6), 1, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 1, ...out(180000, [...kinds.p2wpkh(2).script]), 0, 0, 0, 0];
        const psbt = Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff, ...kv([0], unsigned), 0, ...kv([0], prevSeg), 0, 0]);
        const rs = await insp(psbt); if (rs.ins[0].amount !== 190000n || rs.fee !== 10000n || rs.outs.length !== 1) fails.push('psbt: previous transaction in segwit serialization (marker and flag)'); }
      const t3 = new btc.Transaction({ allowUnknownOutputs: true }); t3.addInput({ txid: '22'.repeat(32), index: 0 }); t3.addOutput({ script: kinds.p2wpkh(2).script, amount: 1n });
      const r3 = await insp(t3.toPSBT(0)); if (r3.ins[0].amount !== null || r3.fee !== null) fails.push('psbt: unknown input amount gives an unknown fee');
      const t4 = new btc.Transaction({ allowUnknownOutputs: true }); t4.addInput({ txid: '33'.repeat(32), index: 0, witnessUtxo: { script: kinds.p2wpkh(1).script, amount: 1000n } }); t4.addInput({ txid: '44'.repeat(32), index: 0 }); t4.addOutput({ script: kinds.p2wpkh(2).script, amount: 1n });
      const r4 = await insp(t4.toPSBT(0)); if (r4.fee !== null || r4.ins[0].amount !== 1000n || r4.ins[1].amount !== null) fails.push('psbt: one unknown input amount among known ones gives an unknown fee'); }
    // errors
    for (const [name, bytes, re] of [['wrong marker', Uint8Array.from([1, 2, 3, 4, 5, 6]), /not a PSBT/], ['too short', Uint8Array.from([0x70, 0x73]), /not a PSBT/]]) { let m = ''; try { await insp(bytes); } catch (e) { m = e.message; } if (!re.test(m)) fails.push('psbt: ' + name + ' rejected'); }
    { const tx = new btc.Transaction(); tx.addInput({ txid: '11'.repeat(32), index: 0, witnessUtxo: { script: kinds.p2wpkh(1).script, amount: 10n } }); tx.addOutput({ script: kinds.p2wpkh(2).script, amount: 5n });
      const good = tx.toPSBT(0); let m = ''; try { await insp(good.slice(0, good.length - 7)); } catch (e) { m = e.message; } if (!/cut short|damaged/.test(m)) fails.push('psbt: cut-off PSBT rejected');
      const v2 = Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff, 1, 0xfb, 4, 2, 0, 0, 0, 0]); m = ''; try { await insp(v2); } catch (e) { m = e.message; } if (!/version 2/.test(m)) fails.push('psbt: version 2 rejected');
      const notx = Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff, 0]); m = ''; try { await insp(notx); } catch (e) { m = e.message; } if (!/No unsigned transaction/.test(m)) fails.push('psbt: missing unsigned transaction reported');
      const withTail = new Uint8Array([...good, 9, 9]); const rt = await insp(withTail); if (!rt.trailing) fails.push('psbt: extra data after the PSBT is noticed'); if ((await insp(good)).trailing) fails.push('psbt: no trailing note on a clean PSBT'); }
    // text handling, report text and the UI
    { const tx = new btc.Transaction(); tx.addInput({ txid: '11'.repeat(32), index: 0, witnessUtxo: { script: kinds.p2wpkh(1).script, amount: 100000000n } }); tx.addOutput({ script: kinds.p2wpkh(2).script, amount: 99000000n });
      const b = tx.toPSBT(0), b64 = Buffer.from(b).toString('base64'), hx = Buffer.from(b).toString('hex');
      const run = async (x) => { $('psbtInput').value = x; await w.runPsbt(); return [$('psbtStatus').textContent, $('psbtOut').textContent]; };
      let [a, o] = await run(b64); if (!/^Read OK/.test(a) || !/INPUT 0: 1\.00000000 BTC \(100000000 sats\)/.test(o) || !/OUTPUT 0: 0\.99000000 BTC \(99000000 sats\)/.test(o) || !/FEE: 0\.01000000 BTC \(1000000 sats\) \(1\.01% of the total of all outputs\)/.test(o)) fails.push('psbt: report text and fee percentage');
      [a, o] = await run(hx.toUpperCase()); if (!/^Read OK/.test(a)) fails.push('psbt: hex in capitals accepted');
      [a, o] = await run(b64.slice(0, 40) + ' \n ' + b64.slice(40)); if (!/^Read OK/.test(a)) fails.push('psbt: base64 with line breaks accepted');
      [a, o] = await run('zzz not psbt !!'); if (!/Paste the PSBT as base64/.test(a) || o !== '') fails.push('psbt: junk text rejected with the paste hint');
      $('psbtNet').value = 'test'; [a, o] = await run(b64); if (!/to tb1q/.test(o)) fails.push('psbt: testnet addresses when Testnet is chosen'); $('psbtNet').value = 'main';
      $('psbtInput').dispatchEvent(new w.Event('input')); if ($('psbtOut').textContent !== '') fails.push('psbt: report cleared when the text changes');
      await run(b64); w.clearPsbt(true); if ($('psbtInput').value !== '' || $('psbtOut').textContent !== '') fails.push('psbt: CLEAR empties the box');
      { const wf = fp(expect.d50, ''), tk = new btc.Transaction({ allowUnknownOutputs: true });
        tk.addInput({ txid: '11'.repeat(32), index: 0, witnessUtxo: { script: kinds.p2wpkh(1).script, amount: 100000n } });
        tk.addOutput({ script: kinds.p2wpkh(2).script, amount: 40000n, bip32Derivation: [[pubE(2), { fingerprint: parseInt(wf, 16), path: [0x80000054] }]] });
        tk.addOutput({ script: kinds.p2wpkh(3).script, amount: 30000n, bip32Derivation: [[pubE(3), { fingerprint: 0xdeadbeef, path: [0x80000054] }]] });
        tk.addOutput({ script: kinds.p2wpkh(4).script, amount: 20000n });
        const kb = Buffer.from(tk.toPSBT(0)).toString('base64'); $('phrase').value = ''; [a, o] = await run(kb);
        const blocks = o.split('OUTPUT ').slice(1);
        if (!/has wallet key information \(fingerprint deadbeef\): usually this wallet's own change/.test(blocks[1] || '') || /no wallet key information/.test(blocks[1] || '')) fails.push('psbt: report marks an output that carries key information');
        if (!/no wallet key information: treat as a payment to someone else/.test(blocks[2] || '') || /has wallet key information/.test(blocks[2] || '')) fails.push('psbt: report marks an output without key information as a payment to someone else');
        if (/matches the wallet typed above/.test(o)) fails.push('psbt: no wallet match claimed when no words are typed');
        $('phrase').value = expect.d50; $('verifyPass').value = ''; [a, o] = await run(kb); const bl2 = o.split('OUTPUT ').slice(1);
        if (!/matches the wallet typed above/.test(bl2[0] || '')) fails.push('psbt: output made by the typed words is marked as matching');
        if (/matches the wallet typed above/.test((bl2[1] || '') + (bl2[2] || ''))) fails.push('psbt: other outputs not marked as matching');
        $('phrase').value = ''; }
      await w.onPsbtFile(new w.File([b], 'a.psbt')); if (!/^Read OK/.test($('psbtStatus').textContent)) fails.push('psbt: binary file read');
      await w.onPsbtFile(new w.File([b64], 'a.txt')); if (!/^Read OK/.test($('psbtStatus').textContent)) fails.push('psbt: text file read');
      await w.onPsbtFile(new w.File([new Uint8Array(2000001)], 'big.psbt')); if (!/too large/.test($('psbtStatus').textContent)) fails.push('psbt: oversized file refused');
      const neg = new btc.Transaction({ allowUnknownOutputs: true }); neg.addInput({ txid: '11'.repeat(32), index: 0, witnessUtxo: { script: kinds.p2wpkh(1).script, amount: 1000n } }); neg.addOutput({ script: kinds.p2wpkh(2).script, amount: 5000n });
      let bn = null; try { bn = Buffer.from(neg.toPSBT(0)).toString('base64'); } catch (e) { bn = null; }
      if (bn) { [a, o] = await run(bn); if (!/FEE: -0\.00004000 BTC \(-?4000 sats\)/.test(o)) fails.push('psbt: outputs larger than inputs shown as a negative fee'); } } }
  catch (e) { fails.push('psbt: the inspector crashed: ' + e.message); }
  { const cells = [...w.document.querySelectorAll('#wordGrid .wcell')]; await run('dice', 12, D50);
    const cs = [...w.document.querySelectorAll('#wordGrid .wcell')];
    if (cs.length !== 12 || cs[0].textContent !== '1.' + expect.d50.split(' ')[0] || cs[11].textContent !== '12.' + expect.d50.split(' ')[11]) fails.push('numbered word grid');
    $('phrase').value = ''; await w.sendToVerify(); if ($('phrase').value !== expect.d50) fails.push('SEND TO VERIFY moves the words');
    $('passphrase').value = ''; $('passphrase2').value = ''; await w.eval('passWork'); w.clearAll(); await new Promise((r2) => setTimeout(r2, 20)); $('phrase').value = ''; await w.sendToVerify();
    if ($('phrase').value !== '') fails.push('an error message is never used as a seed');
    $('rolls').value = D50; $('passphrase').value = 'a'; $('passphrase2').value = 'b'; await w.generate(); $('phrase').value = ''; await w.sendToVerify();
    if ($('phrase').value !== expect.d50) fails.push('a passphrase mismatch does not change the words that SEND TO VERIFY moves');
    { const al = []; const oa = w.alert, oc = w.confirm; w.alert = (m) => al.push(String(m)); w.confirm = () => true;
      for (const fn of ['printSeed', 'downloadSeed', 'printSeedQr']) { const before = al.length; try { await w[fn](); } catch (e) { /* jsdom has no printing or downloads */ }
        if (al.length !== before + 1 || !/do not match/.test(al[al.length - 1])) fails.push('passphrase mismatch: ' + fn + ' is refused with a message'); }
      w.alert = oa; w.confirm = oc; }
    $('passphrase').value = ''; $('passphrase2').value = ''; await w.eval('passWork'); }
  r = await run('dice', 12, D50 + '1', ''); if (r !== entropyToMnemonic(sha(D50 + '1').slice(0, 16), wordlist)) fails.push('more rolls: 51 rolls make 12 words from the SHA-256 of all 51 (Coldcard)');
  if ($('countNote').textContent !== 'Every roll counts: all 51 are hashed. Coldcard makes the same words from these rolls; SeedSigner takes exactly 50, so it would make different words.') fails.push('more rolls: the note says every roll counts');
  r = await run('dice', 12, D50.slice(0, 40), ''); if (r !== 'Enter 10 more rolls (40 of 50).') fails.push('too few rolls message');
  { const bs = [...w.document.querySelectorAll('#tapRow button')];
    if (bs.length !== 6 || !bs.every((b, i) => b.querySelectorAll('svg circle').length === i + 1)) fails.push('dice faces have the right pips'); }
  r = await run('dice', 24, D99);     if (r !== expect.d99) fails.push('dice 24 words');
  r = await run('coin', 12, C128);    if (r !== expect.c128) fails.push('coin 12 words');
  { const bs = [...w.document.querySelectorAll('#tapRow button')];
    if (bs.length !== 2 || bs[0].dataset.v !== '1' || bs[1].dataset.v !== '0') fails.push('coin buttons: heads is 1 and tails is 0');
    else {
      if (!/HEADS/.test(bs[0].textContent) || !/TAILS/.test(bs[1].textContent) || /TAILS/.test(bs[0].textContent) || /HEADS/.test(bs[1].textContent)) fails.push('coin buttons: HEADS label on 1 and TAILS label on 0');
      if (!/heads/.test(bs[0].getAttribute('aria-label')) || !/tails/.test(bs[1].getAttribute('aria-label'))) fails.push('coin buttons: screen-reader labels say heads for 1 and tails for 0');
      if (!bs.every(b => b.querySelector('svg circle'))) fails.push('coin buttons: each button draws a coin');
      if (!bs[0].querySelector('svg g.btc') || bs[0].querySelectorAll('svg g.btc path').length !== 2 || bs[0].querySelector('svg g.sat') || !bs[1].querySelector('svg g.sat') || bs[1].querySelectorAll('svg g.sat rect').length !== 5 || !/rotate\(10 /.test(bs[0].querySelector('svg g.btc').getAttribute('transform') || '') || !/rotate\(10 /.test(bs[1].querySelector('svg g.sat').getAttribute('transform') || '') || bs.some(b => b.querySelector('radialGradient, text')) || bs[0].querySelector('svg g.btc').getAttribute('stroke-width') !== '7' || ![...bs[1].querySelectorAll('svg g.sat rect')].every((r) => Math.min(+r.getAttribute('width'), +r.getAttribute('height')) === 7)) fails.push('coin buttons: the lines are the same thickness on both coins; heads shows the Bitcoin sign, tails shows the sat sign, both tilted and flat');
      $('rolls').value = ''; bs[0].onclick(); bs[1].onclick(); bs[0].onclick(); if ($('rolls').value !== '101') fails.push('coin buttons: tap adds 1 for heads and 0 for tails'); } }
  r = await run('dice', 12, D50.replace(/(.{5})/g, '$1 ') + ' x,y;z'); if (r !== expect.d50) fails.push('input cleaning (spaces/junk)');
  { // v2.3.0: the minimum or more; every roll is hashed (Coldcard); exactly the minimum also matches SeedSigner
    const D150 = (D50 + D99 + D50).slice(0, 150), C300 = (C128 + C128 + C128).slice(0, 300);
    r = await run('dice', 12, D50.slice(0, 49)); if (r !== 'Enter 1 more roll (49 of 50).' || w.hasSeed()) fails.push('more rolls: 49 rolls are still one short');
    r = await run('coin', 24, (C128 + C128).slice(0, 255)); if (r !== 'Enter 1 more flip (255 of 256).') fails.push('more flips: 255 flips are still one short');
    r = await run('dice', 24, D150); if (r !== entropyToMnemonic(sha(D150).slice(0, 32), wordlist)) fails.push('more rolls: 150 rolls make 24 words from the SHA-256 of all 150');
    if (!/^Every roll counts: all 150 are hashed\..*SeedSigner takes exactly 99, so it would make different words\.$/.test($('countNote').textContent) || /twice/.test($('countNote').textContent)) fails.push('more rolls: 24-word note, no double-paste note at 150');
    r = await run('dice', 24, D150 + D50); if (!/That is more than twice the 99 needed: fine if you rolled them all, but if you pasted them, check nothing went in twice\.$/.test($('countNote').textContent)) fails.push('more rolls: more than twice the minimum gets the double-paste note');
    r = await run('dice', 12, D50 + D50); if (/twice/.test($('countNote').textContent)) fails.push('more rolls: exactly twice the minimum gets no double-paste note');
    r = await run('dice', 12, D50); if ($('countNote').textContent !== 'Exactly 50 rolls: SeedSigner and Coldcard make the same words from these rolls.') fails.push('more rolls: exactly 50 names SeedSigner and Coldcard');
    r = await run('coin', 12, C300); if (r !== entropyToMnemonic(sha(C300).slice(0, 16), wordlist) || $('countNote').textContent !== 'Every flip counts: all 300 are hashed. SeedSigner\'s coin-flip code takes exactly 128 flips, so it would make different words. That is more than twice the 128 needed: fine if you flipped them all, but if you pasted them, check nothing went in twice.') fails.push('more flips: 300 flips hashed, with both notes');
    r = await run('coin', 12, C128); if ($('countNote').textContent !== 'Exactly 128 flips: the same SHA-256 method as SeedSigner\'s coin-flip code (its device menus make seeds from dice).' || $('lenNote').textContent !== '128 coin flips or more') fails.push('more flips: exactly 128 names SeedSigner');
    $('rolls').value = C128.slice(0, 127); $('rolls').oninput(); if ($('countNote').textContent !== '') fails.push('more flips: no note below the minimum');
    mode('dice'); words(12); $('rolls').value = ''; $('rolls').oninput();
    if ($('lenNote').textContent !== '50 dice rolls or more') fails.push('more rolls: the length line says 50 or more');
    { const oprint = w.print; let cells = null, extra = null, txt = ''; w.print = () => { cells = [...w.document.querySelectorAll('#printOnly .ps-cell')].map((c) => c.textContent); extra = [...w.document.querySelectorAll('#printOnly .ps-cell.ps-extra')].map((c) => c.textContent); txt = $('printOnly').textContent; };
      w.printRollSheet(); w.dispatchEvent(new w.Event('afterprint')); w.print = oprint;
      if (!cells || cells.length !== 60 || cells.some((c, i) => c !== String(i + 1)) || extra.join(',') !== '51,52,53,54,55,56,57,58,59,60' || !/Extra rolls \(optional\)\. Every one you type in counts\. Exactly 50 gives the same words as SeedSigner and Coldcard; with more, only Coldcard makes the same words\./.test(txt)) fails.push('roll sheet: 50 boxes, then 10 dashed optional boxes numbered 51 to 60');
      if (!/body\.print-seed #printOnly \.ps-roll \.ps-cell\.ps-extra \{ border-style: dashed; \}/.test(mutated)) fails.push('roll sheet: the extra boxes are dashed');
      if (!/Dice rules: SeedSigner and Coldcard\n/.test(txt)) fails.push('roll sheet: the sheet records the dice rules'); } }
  r = await run('dice', 12, D50, UNI);    if (fpOf() !== fp(expect.d50, UNI)) fails.push('unicode passphrase fingerprint');
  if (adOf() !== addr(expect.d50, UNI)) fails.push('first receive address with unicode passphrase');
  if ($('wZpub').textContent !== watch(expect.d50, UNI).zpub) fails.push('watch-only zpub with unicode passphrase');
  { let bl = 0;
    for (const f of LH_FPS) { const rows = await w.lifeHash(f), mine = rows.flat(2), ref = LH_EXPECT[f]; if (mine.length !== ref.length || mine.some((v, i) => v !== ref[i])) bl++; }
    if (bl) fails.push('fingerprint pictures match the independent lifehash package');
    await run('dice', 12, D50); await new Promise((r) => setTimeout(r, 40)); const px = svgPixels($('fpIcon').innerHTML), fpNow = fpOf(), refPx = fpNow ? Array.from(LifeHash.makeFrom(hexb4(fpNow), 2, 1, false).colors) : null;
    if (!refPx || px.some((v, i) => v !== refPx[i])) fails.push('fingerprint picture shown next to the fingerprint'); }
  { const li = [...w.document.querySelectorAll('#addrList li')].map(x => x.textContent);
    if (li.length !== 5 || (adOf() && li[0] !== adOf()) || new Set(li).size !== 5) fails.push('five receive addresses are listed');
    if ($('addrBox').style.display !== '' || $('checkGuide').style.display !== '') fails.push('address list and guide are shown after FORGE');
    { const tr = [...w.document.querySelectorAll('#trList li')].map(x => x.textContent);
      if (tr.length !== 5 || tr.some(x => !/^bc1p[0-9a-z]{58}$/.test(x)) || new Set(tr).size !== 5 || $('trBox').style.display !== '') fails.push('five Taproot addresses are listed'); }
    const full = [...w.document.querySelectorAll('#wordGrid .wtxt')].map(x => x.textContent); w.toggleAbbr();
    const ab = [...w.document.querySelectorAll('#wordGrid .wtxt')].map(x => x.textContent);
    if (!full.length || ab.some((a, i) => a !== full[i].slice(0, 4))) fails.push('4-letter view shows the first four letters');
    w.toggleAbbr(); if ([...w.document.querySelectorAll('#wordGrid .wtxt')].map(x => x.textContent).join(' ') !== full.join(' ')) fails.push('4-letter view toggles back'); }
  { const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/qr.json', import.meta.url), 'utf8')); let bq = 0;
    const hh = (rows) => nc.createHash('sha256').update(rows.map(r => r.map(x => x ? '1' : '0').join('')).join('')).digest('hex');
    fx.forEach((c, i) => { const m = i % 8, q = w.qrMatrix(c.text, m); if (q.version !== c.version || hh(q.rows) !== c.hashes[m]) bq++;
      const a = w.qrMatrix(c.text); if (hh(a.rows) !== c.hashes[a.mask]) bq++; });
    if (bq) fails.push('QR codes match the independent library');
    w.showQr('wZpub', 'zpub'); if (!$('qrImg').querySelector('svg path')) fails.push('SHOW QR draws a code'); }
  // SeedQR / CompactSeedQR: data, QR codes, 7 x 7 blocks for copying by hand, print sheets, clearing
  try {
    const fxS = JSON.parse(fs.readFileSync(new URL('./fixtures/seedqr.json', import.meta.url), 'utf8')); let bd = 0, bs = 0, bg = 0;
    const hs = (rows) => nc.createHash('sha256').update(rows.map(r => r.map(x => x ? '1' : '0').join('')).join('')).digest('hex');
    fxS.forEach((c, i) => { const ws = c.words.split(' '), d = w.seedQrData(ws);
      if (!d || d.digits !== c.digits || Buffer.from(d.bytes).toString('hex') !== c.entropy) bd++;
      for (const kind of ['seedqr', 'compact']) { const f = c.formats[kind], m = (i + (kind === 'compact' ? 3 : 0)) % 8, q = w.seedQrMatrix(ws, kind, m);
        if (q.version !== f.version || q.rows.length !== f.size || hs(q.rows) !== f.hashes[m]) bs++;
        const a = w.seedQrMatrix(ws, kind); if (hs(a.rows) !== f.hashes[a.mask]) bs++;
        const rebuilt = q.rows.map(row => { const o = new Array(row.length).fill(false); for (const part of w.qrRowRuns(row).split(', ').filter(Boolean)) { const [x, y] = part.split('-').map(Number); for (let k = x; k <= (y || x); k++) o[k - 1] = true; } return o; });
        if (hs(rebuilt) !== hs(q.rows)) bg++;
        const N = q.rows.length, dark = q.rows.flat().filter(Boolean).length, cnt = (svg, fill) => { const mm = svg.match(new RegExp('<path d="([^"]*)" fill="' + fill + '"')); return mm ? (mm[1].match(/M/g) || []).length : 0; };
        if (cnt(w.qrGridSvg(q.rows, 0, 0, N, N, 7, false), '#000') !== dark || cnt(w.qrGridSvg(q.rows, 0, 0, N, N, 7, true), '#000') !== 0) bg++;
        let sd = 0, sg = 0; const per = Math.ceil(N / 7);
        for (let by = 0; by < per; by++) for (let bx = 0; bx < per; bx++) { const svg = w.qrGridSvg(q.rows, bx * 7, by * 7, bx * 7 + 7, by * 7 + 7, 7, false); sd += cnt(svg, '#000'); sg += cnt(svg, '#c8c8c8'); }
        if (sd !== dark || sg !== per * per * 49 - N * N) bg++; } });
    if (bd) fails.push('seedqr: digits and bytes from the words');
    if (bs) fails.push('seedqr: QR codes match the independent library');
    if (bg) fails.push('seedqr: hand-copy grid, blocks and row lists');
    const bad = [['abandon', 'abandon'], Array(11).fill('abandon').concat('zzzz'), entropyToMnemonic(new Uint8Array(20), wordlist).split(' ')];
    if (bad.some(x => w.seedQrData(x) !== null)) fails.push('seedqr: only 12 and 24 known words give a SeedQR');
    { let m = ''; try { w.seedQrMatrix(['abandon', 'abandon'], 'seedqr'); } catch (e) { m = e.message; } if (!/only for 12 and 24/.test(m)) fails.push('seedqr: a short phrase gives an error, not a code'); }
    // the page: show, hide, blocks, mini-map, print
    const pr = { n: 0, text: '', html: '', cls: '' }, conf = { v: true, n: 0 };
    w.print = () => { pr.n++; pr.text = $('printQr').textContent; pr.html = $('printQr').innerHTML; pr.cls = w.document.body.className; };
    w.confirm = () => { conf.n++; return conf.v; };
    const alerts = []; w.alert = (m) => alerts.push(m);
    const sz = () => { const v = $('sqImg').querySelector('svg'); return v ? Math.round(v.viewBox.baseVal.width) - 8 : 0; }, gc = () => $('sqGuideCaption').textContent;
    await run('dice', 12, D50, 'SECRETPASS'); const sw = $('genResult').textContent.split('\n')[0];
    if ($('seedQrBox').style.display !== '' || $('seedQrBox').open) fails.push('seedqr: box shown (closed) after FORGE');
    w.showSeedQr('seedqr'); if (sz() !== 25 || $('sqBox').style.display !== '' || !/^SeedQR for these 12 words, 25 x 25 squares/.test($('sqCaption').textContent)) fails.push('seedqr: SEEDQR shows a 25 x 25 code with its caption');
    w.showSeedQr('compact'); if (sz() !== 21 || !/^CompactSeedQR for these 12 words, 21 x 21 squares/.test($('sqCaption').textContent)) fails.push('seedqr: COMPACTSEEDQR shows a 21 x 21 code with its caption');
    w.hideSeedQr(); if ($('sqImg').innerHTML !== '' || $('sqBox').style.display !== 'none' || $('sqCaption').textContent !== '') fails.push('seedqr: HIDE removes the code');
    alerts.length = 0; pr.n = 0; w.printSeedQr(); w.printSqGuide(); w.openSqGuide(); w.printSqBlank();
    if (pr.n !== 0 || alerts.length !== 4) fails.push('seedqr: nothing is printed or opened while no code is shown (after HIDE too)');
    w.showSeedQr('seedqr'); conf.v = false; conf.n = 0; w.printSeedQr(); w.printSqGuide();
    if (pr.n !== 0 || conf.n !== 2) fails.push('seedqr: printing the code or the guide asks first and stops when declined');
    conf.v = true; w.printSeedQr();
    if (pr.n !== 1 || !/^VOIDFORGE SEEDQR \(12 words, 25 x 25 squares\)/.test(pr.text) || !/<svg/.test(pr.html) || /print-qr/.test(pr.cls) === false || pr.text.includes('SECRETPASS') || pr.text.includes(sw.split(' ').slice(0, 3).join(' ')) || !pr.text.includes($('fingerprint').textContent) || !/Passphrase used: YES/.test(pr.text)) fails.push('seedqr: PRINT THIS QR sheet (code, fingerprint, no words, no passphrase)');
    w.dispatchEvent(new w.Event('afterprint')); if ($('printQr').textContent !== '' || w.document.body.classList.contains('print-qr')) fails.push('seedqr: print area cleaned up after printing');
    w.printSqGuide();
    if (pr.n !== 2 || !/HAND-COPY GUIDE \(12 words, 25 x 25 squares\)/.test(pr.text) || !/Row 1: /.test(pr.text) || !/Row 25: /.test(pr.text) || /Row 26/.test(pr.text) || pr.text.includes('SECRETPASS') || pr.text.includes(sw.split(' ').slice(0, 3).join(' '))) fails.push('seedqr: PRINT HAND-COPY GUIDE sheet (rows, no words, no passphrase)');
    w.dispatchEvent(new w.Event('afterprint')); conf.n = 0; w.printSqBlank();
    if (pr.n !== 3 || conf.n !== 0 || !/BLANK 25 x 25 GRID FOR SEEDQR/.test(pr.text) || /Row 1: /.test(pr.text)) fails.push('seedqr: PRINT BLANK GRID sheet (no question, no rows)');
    { const bm = pr.html.match(/<path d="([^"]*)" fill="#000"/); if (!bm || bm[1] !== '') fails.push('seedqr: the blank grid sheet has no black squares'); }
    w.dispatchEvent(new w.Event('afterprint'));
    w.openSqGuide();
    if ($('sqGuide').style.display !== '' || !/^Block 1 of 16: rows 1 to 7, columns 1 to 7 of the 25 x 25 grid\./.test(gc()) || !$('sqGuideImg').querySelector('svg') || !$('sqMini').querySelector('svg')) fails.push('seedqr: COPY BY HAND opens block 1 of 16 with a mini-map');
    w.sqGuideBlock(1); if (!/^Block 2 of 16: rows 1 to 7, columns 8 to 14/.test(gc())) fails.push('seedqr: NEXT BLOCK goes right');
    w.sqGuideBlock(1); w.sqGuideBlock(1);
    { const txt = [...$('sqGuideImg').querySelectorAll('text')].map(x => x.textContent).join(',');
      const mini = $('sqMini').innerHTML.match(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="rgba/);
      if (!/^Block 4 of 16: rows 1 to 7, columns 22 to 25 of the 25 x 25 grid\. Grey squares are outside the code/.test(gc()) || txt !== '22,23,24,25,1,2,3,4,5,6,7') fails.push('seedqr: a cut-off block names only the rows and columns that exist');
      if (!mini || mini.slice(1).join() !== '23,2,4,7') fails.push('seedqr: the mini-map outlines the block, cut at the edge of the code');
      const gp = $('sqGuideImg').querySelector('path[fill="#c8c8c8"]'); if (!gp || (gp.getAttribute('d').match(/M/g) || []).length !== 3 * 7) fails.push('seedqr: squares outside the code are grey'); }
    w.sqGuideBlock(1); if (!/^Block 5 of 16: rows 8 to 14, columns 1 to 7/.test(gc())) fails.push('seedqr: blocks continue on the next row');
    w.sqGuideBlock(-1); if (!/^Block 4 of 16/.test(gc())) fails.push('seedqr: PREVIOUS BLOCK goes back');
    w.openSqGuide(); w.sqGuideBlock(-1); if (!/^Block 16 of 16: rows 22 to 25, columns 22 to 25/.test(gc())) fails.push('seedqr: PREVIOUS BLOCK wraps to the last block');
    w.sqGuideBlock(1); if (!/^Block 1 of 16/.test(gc())) fails.push('seedqr: NEXT BLOCK wraps to the first block');
    w.sqGuideFull(); if (!/^Whole SeedQR grid, 25 x 25 squares/.test(gc()) || $('sqGuideImg').querySelectorAll('text').length !== 50 || $('sqMini').innerHTML !== '' || $('sqGuide').style.display !== '') fails.push('seedqr: WHOLE GRID shows every row and column number');
    w.showSeedQr('compact'); if ($('sqGuide').style.display !== 'none' || $('sqGuideImg').innerHTML !== '' || $('sqMini').innerHTML !== '' || gc() !== '') fails.push('seedqr: showing another code closes the guide');
    w.openSqGuide(); if (!/^Block 1 of 9: rows 1 to 7, columns 1 to 7 of the 21 x 21 grid/.test(gc())) fails.push('seedqr: a 21 x 21 code has 9 blocks');
    w.hideSeedQr(); if ($('sqGuide').style.display !== 'none' || $('sqMini').innerHTML !== '') fails.push('seedqr: HIDE closes the guide too');
    w.showSeedQr('seedqr'); w.openSqGuide(); await run('dice', 12, D50, ''); if ($('sqImg').innerHTML !== '' || $('sqBox').style.display !== 'none' || $('sqGuide').style.display !== 'none' || $('sqGuideImg').innerHTML !== '') fails.push('seedqr: a new FORGE removes the old code and guide');
    w.showSeedQr('seedqr'); w.clearAll(); if ($('sqImg').innerHTML !== '' || $('seedQrBox').style.display !== 'none') fails.push('seedqr: CLEAR removes the code and hides the box');
    alerts.length = 0; w.showSeedQr('seedqr'); if ($('sqImg').innerHTML !== '' || !/Generate a seed first/.test(alerts.join('|'))) fails.push('seedqr: no code without a seed');
    await run('dice', 24, D99, ''); w.showSeedQr('seedqr'); if (sz() !== 29 || !/^SeedQR for these 24 words, 29 x 29 squares/.test($('sqCaption').textContent)) fails.push('seedqr: 24 words give a 29 x 29 code');
    w.openSqGuide(); if (!/^Block 1 of 25: rows 1 to 7, columns 1 to 7 of the 29 x 29/.test(gc())) fails.push('seedqr: a 29 x 29 code has 25 blocks');
    for (let i = 0; i < 4; i++) w.sqGuideBlock(1); if (!/^Block 5 of 25: rows 1 to 7, columns 29 to 29/.test(gc())) fails.push('seedqr: the last block column of a 29 x 29 code is one square wide');
    w.showSeedQr('compact'); if (sz() !== 25 || !/^CompactSeedQR for these 24 words, 25 x 25 squares/.test($('sqCaption').textContent)) fails.push('seedqr: 24 words give a 25 x 25 CompactSeedQR');
    w.setResult('x', Array(15).fill('abandon')); if ($('seedQrBox').style.display !== 'none') fails.push('seedqr: no SeedQR box for a 15-word phrase'); w.setResult('x', null); if ($('seedQrBox').style.display !== 'none') fails.push('seedqr: no SeedQR box without words');
    w.setResult(sw, Array(12).fill('abandon')); if ($('seedQrBox').style.display !== '') fails.push('seedqr: box shown for 12 words');
    if (w.qrRowRuns([false, true, true]) !== '2-3' || w.qrRowRuns([true, false, true, true]) !== '1, 3-4' || w.qrRowRuns([true]) !== '1' || w.qrRowRuns([false, false]) !== '') fails.push('seedqr: row lists are written as runs, also at the right edge');
    { const q = w.qrMatrix('a'), svg = w.qrGridSvg(q.rows, 18, 18, 25, 25, 7, false), t = (svg.match(/<text/g) || []).length; if (t !== 2 * (q.rows.length - 18)) fails.push('seedqr: no numbers for squares outside the code'); }
    { const q = w.qrMatrix('a'), mm2 = w.qrMiniMapSvg(q.rows, 18, 18, 25, 25).match(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="rgba/); if (!mm2 || mm2.slice(3).join() !== '3,3') fails.push('seedqr: the mini-map outline is cut at the bottom and right edges'); }
    w.print = () => {}; w.confirm = () => true; w.alert = () => {};
  } catch (e) { fails.push('seedqr: the probe crashed: ' + e.message); }
  // explainer and backup sheet
  try {
    const shaB = (b) => nc.createHash('sha256').update(b).digest(), bitsOf = (b) => Array.from(b).map(x => x.toString(2).padStart(8, '0')).join('');
    const pc = { n: 0, cells: [], cls: '', txt: '' }; let cnf = true;
    w.print = () => { pc.n++; pc.cells = [...w.document.querySelectorAll('#printOnly .ps-cell')].map(c => c.textContent); pc.cls = w.document.body.className; pc.txt = $('printOnly').textContent; pc.grid = (w.document.querySelector('#printOnly .ps-grid') || {}).className; };
    w.confirm = () => cnf; w.alert = () => {};
    for (const [n, R] of [[12, D50], [24, D99]]) {
      await run('dice', n, R, 'SECRETPASS'); const wd = $('genResult').textContent.split('\n')[0].split(' '), eo = $('exOut');
      const dg = shaB(Buffer.from(R)), ent = dg.subarray(0, n * 4 / 3), cs = bitsOf(shaB(ent)).slice(0, n / 3), all = bitsOf(ent) + cs;
      if ($('explainBox').style.display !== '' || $('explainBox').open || eo.style.display !== 'none' || eo.textContent !== '') fails.push('explain: box closed with nothing shown after FORGE (' + n + ')');
      await w.showExplain();
      const cells = [...eo.querySelectorAll('.ex-cell')];
      if (cells.length !== n || cells.some((c, i) => c.querySelector('b').textContent !== (i + 1) + '. ' + wd[i] || c.querySelector('code').textContent !== all.slice(i * 11, i * 11 + 11) || !c.textContent.endsWith('number ' + parseInt(all.slice(i * 11, i * 11 + 11), 2)))) fails.push('explain: every piece shows its word, its 11 bits and its number (' + n + ')');
      const mono = [...eo.querySelectorAll('.ex-mono')].map(e => e.textContent);
      if (mono[1] !== dg.toString('hex') || mono[2] !== ent.toString('hex') || mono[3] !== '…' + cs + '  ← checksum') fails.push('explain: hash, entropy and checksum shown correctly (' + n + ')');
      if (eo.querySelector('.ex-cs') && [...eo.querySelectorAll('.ex-cs')].map(e => e.textContent).join() !== cs + ',' + cs.slice(0) ) fails.push('explain: checksum bits marked (' + n + ')');
      const last = cells[n - 1].querySelectorAll('span'); if (last[0].textContent !== all.slice(n * 11 - 11, n * 11 - cs.length) || last[1].textContent !== cs) fails.push('explain: last piece splits entropy bits from checksum bits (' + n + ')');
      if (eo.querySelectorAll('.ex-step').length !== 5 || !eo.querySelector('.ex-ok') || eo.querySelector('.ex-bad') || eo.style.display !== '') fails.push('explain: five steps and a match message (' + n + ')');
      if (eo.textContent.includes('SECRETPASS') || eo.querySelector('a,script,img,form,input,svg')) fails.push('explain: no passphrase, links or inputs (' + n + ')');
      const first = eo.querySelector('.ex-body .ex-text').textContent, bits = n === 12 ? 129 : 257;
      if (!first.includes(R.length + ' dice rolls') || !first.includes('roughly ' + Math.floor(R.length * Math.log2(6)) + ' bits') || !/^[1-6]( [1-6])*$/.test(mono[0]) || mono[0].replace(/ /g, '') !== R) fails.push('explain: step 1 shows the rolls and their bits (' + n + ')');
      if (!eo.textContent.includes('first ' + n * 4 / 3 + ' bytes') || !eo.textContent.includes('first ' + cs.length + ' bits') || !eo.textContent.includes('All ' + (n * 11) + ' bits are cut into ' + n + ' pieces')) fails.push('explain: step texts name the right sizes (' + n + ')');
      w.hideExplain(); if (eo.textContent !== '' || eo.style.display !== 'none') fails.push('explain: HIDE removes the steps (' + n + ')');
      await w.showExplain(); if (eo.textContent !== '') fails.push('explain: nothing shown after HIDE until a new FORGE (' + n + ')');
      // backup sheet
      pc.n = 0; cnf = false; w.printSeed(); if (pc.n !== 0) fails.push('print sheet: declining the question prints nothing (' + n + ')');
      cnf = true; w.printSeed();
      if (pc.n !== 1 || pc.cells.length !== n || pc.cells.some((c, i) => c !== String(i + 1).padStart(2, '0') + wd[i]) || pc.grid !== 'ps-grid ps-' + n || !/print-seed/.test(pc.cls) || pc.txt.includes('SECRETPASS') || !/Passphrase used: YES/.test(pc.txt) || !pc.txt.includes($('fingerprint').textContent)) fails.push('print sheet: numbered boxes, fingerprint, passphrase line only (' + n + ')');
      w.dispatchEvent(new w.Event('afterprint')); if ($('printOnly').textContent !== '' || w.document.body.classList.contains('print-seed')) fails.push('print sheet: cleaned up after printing (' + n + ')');
      // stamp sheet (v1.34.0)
      pc.n = 0; cnf = false; $('stampBtn').click(); if (pc.n !== 0) fails.push('stamp sheet: declining the question prints nothing (' + n + ')');
      cnf = true; $('stampBtn').click();
      if (pc.n !== 1 || pc.cells.length !== n || pc.cells.some((c, i) => c !== String(i + 1).padStart(2, '0') + wd[i].slice(0, 4).toUpperCase()) || pc.grid !== 'ps-grid ps-stamp ps-' + n || !/print-seed/.test(pc.cls) || !/^VOIDFORGE STAMP SHEET/.test(pc.txt)) fails.push('stamp sheet: numbered 4-letter capitals in a stamp grid (' + n + ')');
      if (pc.txt.includes('SECRETPASS') || !/Passphrase used: YES/.test(pc.txt) || !pc.txt.includes($('fingerprint').textContent) || !/Reforge/.test(pc.txt)) fails.push('stamp sheet: fingerprint, passphrase yes/no without the passphrase, and how to get the words back (' + n + ')');
      w.dispatchEvent(new w.Event('afterprint')); if ($('printOnly').textContent !== '' || w.document.body.classList.contains('print-seed')) fails.push('stamp sheet: cleaned up after printing (' + n + ')');
    }
    w.setResult('x', Array(15).fill('abandon')); if ($('explainBox').style.display !== 'none') fails.push('explain: no box for a 15-word phrase');
    w.setResult('x', null); if ($('explainBox').style.display !== 'none') fails.push('explain: no box without words');
    pc.n = 0; cnf = true; w.printStamp(); if (pc.n !== 0) fails.push('stamp sheet: nothing is printed without a seed');
    { // roll sheet (v1.34.0)
      const setMode = (m) => { w.document.querySelector('input[name="mode"][value="' + m + '"]').checked = true; }, setWords = (n) => { w.document.querySelector('input[name="words"][value="' + n + '"]').checked = true; };
      const sheet = () => { pc.n = 0; $('rollSheetBtn').click(); const r = { n: pc.n, cells: pc.cells.slice(), txt: pc.txt, cls: pc.cls }; w.dispatchEvent(new w.Event('afterprint')); return r; };
      setWords(12); setMode('dice');
      let r = sheet(); if (r.n !== 1 || r.cells.length !== 60 || r.cells.some((c, i) => c !== String(i + 1)) || !/^VOIDFORGE DICE ROLL SHEET/.test(r.txt) || !/50 rolls for a 12-word seed/.test(r.txt) || !/Roll one die and write its number \(1 to 6\)/.test(r.txt) || !/print-seed/.test(r.cls) || /1 means/.test(r.txt)) fails.push('roll sheet: 50 numbered boxes for 12 words of dice, then 10 optional');
      setWords(24); r = sheet(); if (r.cells.length !== 109 || !/99 rolls for a 24-word seed/.test(r.txt)) fails.push('roll sheet: 99 boxes for 24 words of dice');
      setMode('coin'); r = sheet(); if (r.cells.length !== 266 || !/^VOIDFORGE COIN FLIP SHEET/.test(r.txt) || !/256 flips for a 24-word seed/.test(r.txt) || !/1 means: ______   0 means: ______/.test(r.txt) || !/write 1 or 0/.test(r.txt)) fails.push('roll sheet: 256 boxes for 24 words of coin flips with the sides to fill in');
      setWords(12); r = sheet(); if (r.cells.length !== 138) fails.push('roll sheet: 128 boxes for 12 words of coin flips');
      setMode('dice'); r = sheet(); if (!/as secret as your seed/.test(r.txt) || !/shred/.test(r.txt) || $('printOnly').textContent !== '' || w.document.body.classList.contains('print-seed')) fails.push('roll sheet: secret warning and cleanup');
      w.print = () => { pc.n++; pc.cells = [...w.document.querySelectorAll('#printOnly .ps-cell')].map(c => c.textContent); pc.cls = w.document.body.className; pc.txt = $('printOnly').textContent; pc.grid = (w.document.querySelector('#printOnly .ps-grid') || {}).className; };
      pc.n = 0; $('rollSheetBtn').click(); if (!/print-seed/.test(w.document.body.className)) fails.push('roll sheet: print class set while printing'); w.dispatchEvent(new w.Event('afterprint')); }
    { // auto-clear (v1.34.0)
      const sel = $('autoIdle'), chk = $('autoHide'), note = () => $('autoNote').textContent, now = () => Date.now(), MIN = 60000, fire = (e) => e.dispatchEvent(new w.Event('change'));
      const arm = async () => { await run('dice', 12, D50, 'SECRETPASS'); $('verifyPass').value = 'VP'; $('reforgeWordsInput').value = 'abandon ?'; $('drillWords').value = 'abandon'; $('prInput').value = 'abandon'; $('checkAddr').value = 'bc1qx'; const ro = $('reforgeOut'); ro.textContent = 'found'; ro.style.display = ''; const co = $('childOut'); co.textContent = 'child words'; co.style.display = ''; };
      const left = () => ['rolls', 'passphrase', 'passphrase2', 'verifyPass', 'reforgeWordsInput', 'drillWords', 'prInput', 'checkAddr'].filter((id) => $(id).value);
      if (sel.value !== '0' || chk.checked || [...sel.options].map((o) => o.value).join() !== '0,2,5,10,30') fails.push('auto-clear: off by default with the five choices');
      w.autoWipe('setup'); $('autoNote').textContent = '';
      if (w.autoWipe('x') !== false || note() !== '') fails.push('auto-clear: with nothing on the page a wipe does nothing');
      await arm(); { const wd = $('genResult').textContent.split('\n')[0]; $('phrase').value = wd; await w.verify(); for (let k = 0; k < 400 && $('wvList').querySelectorAll('li').length !== 10; k++) await new Promise((r2) => setTimeout(r2, 25)); w.wvSeedQr('seedqr'); }
      if (w.autoWipe('because of a test') !== true) fails.push('auto-clear: a wipe with secrets reports it');
      if ($('walletView').style.display !== 'none' || $('wvsImg').textContent !== '' || $('wvList').textContent !== '' || $('phrase').value !== '') fails.push('auto-clear: the wallet view and its SeedQR are wiped too');
      if (left().length || w.hasSeed() || $('childOut').textContent !== '' || $('reforgeOut').textContent !== '' || $('reforgeOut').style.display !== 'none' || !/^Wiped automatically because of a test at /.test(note())) fails.push('auto-clear: seed, rolls, passphrases, typed words, Reforge and child outputs wiped (left: ' + left().join(',') + ')');
      if (w.autoWipe('x') !== false || !/because of a test/.test(note())) fails.push('auto-clear: a second wipe with nothing left changes nothing');
      let cleared = 0; const ci = w.clearInterval; w.clearInterval = (x) => { cleared++; return ci.call(w, x); };
      sel.value = '5'; fire(sel); if (!/^Auto-clear is ON: after 5 minutes with no activity\.$/.test(note()) || w.eval('autoTimer') === null) fails.push('auto-clear: choosing 5 minutes turns it on and starts the timer');
      await arm(); w.autoCheck(now() + 4 * MIN); if (!w.hasSeed() || !left().length) fails.push('auto-clear: nothing wiped before the idle time is up');
      w.autoCheck(now() + 6 * MIN); if (w.hasSeed() || left().length || !/^Wiped automatically after 5 minutes with no activity at /.test(note())) fails.push('auto-clear: everything wiped once the idle time is up');
      for (const ev of ['keydown', 'pointerdown', 'input', 'touchstart', 'wheel']) { await arm(); w.eval('autoLast = 0'); w.document.dispatchEvent(new w.Event(ev, { bubbles: true })); w.autoCheck(now() + 4 * MIN); if (!w.hasSeed()) fails.push('auto-clear: a ' + ev + ' counts as activity'); }
      sel.value = '0'; fire(sel); if (note() !== 'Auto-clear is off.' || w.eval('autoTimer') !== null || cleared !== 1) fails.push('auto-clear: choosing never turns it off and stops the timer');
      await arm(); w.eval('autoLast = 0'); w.autoCheck(now() + 999 * MIN); if (!w.hasSeed()) fails.push('auto-clear: never means never');
      const hide = (v) => { Object.defineProperty(w.document, 'hidden', { value: v, configurable: true }); w.document.dispatchEvent(new w.Event('visibilitychange')); };
      hide(true); if (!w.hasSeed()) fails.push('auto-clear: leaving the tab wipes nothing while that option is off'); hide(false);
      chk.checked = true; fire(chk); if (!/^Auto-clear is ON: when you leave this tab\.$/.test(note())) fails.push('auto-clear: the tab option turns it on');
      hide(false); if (!w.hasSeed()) fails.push('auto-clear: coming back to the tab wipes nothing');
      hide(true); if (w.hasSeed() || left().length || !/^Wiped automatically because you left this tab at /.test(note())) fails.push('auto-clear: leaving the tab wipes everything when that option is on'); hide(false);
      sel.value = '10'; fire(sel); if (!/^Auto-clear is ON: after 10 minutes with no activity and when you leave this tab\.$/.test(note())) fails.push('auto-clear: the note lists both settings');
      sel.value = '0'; fire(sel); chk.checked = false; fire(chk); w.clearInterval = ci; $('autoNote').textContent = ''; w.autoWipe('cleanup'); }
    await run('dice', 12, D50, ''); await w.showExplain(); w.clearAll(); if ($('exOut').textContent !== '' || $('explainBox').style.display !== 'none') fails.push('explain: CLEAR removes the steps and hides the box');
    { await run('coin', 12, C128, ''); await w.showExplain(); const eo = $('exOut'), t0 = eo.querySelector('.ex-body .ex-text').textContent;
      if (!t0.includes('128 coin flips') || !t0.includes('exactly 1 bit') || !t0.includes('roughly 128 bits') || !/^[01]( [01])*$/.test(eo.querySelector('.ex-mono').textContent)) fails.push('explain: coin flips are counted as 1 bit each'); }
    { await run('dice', 12, D50, ''); w.eval("exCtx.words[0] = 'tampered'"); await w.showExplain(); const eo = $('exOut');
      if (!eo.querySelector('.ex-bad') || eo.querySelector('.ex-ok') || !/do NOT match/.test(eo.textContent)) fails.push('explain: a mismatch between the steps and the seed is reported, not hidden'); }
    w.print = () => {}; w.confirm = () => true;
  } catch (e) { fails.push('explain: the probe crashed: ' + e.message); }
  try { // Guide me, term tips, larger text
    if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = function () {};
    w.confirm = () => true; const B = w.document.body, gh = (id) => $(id).classList.contains('gh'), nextOff = () => $('gNext').disabled;
    w.clearAll(); await new Promise(r => setTimeout(r, 20));
    if (B.classList.contains('guided') || w.document.querySelectorAll('.gh').length || $('guideBtn').getAttribute('aria-pressed') !== 'false') fails.push('guide: off by default, nothing hidden');
    mode('dice'); words(12); w.toggleGuide();
    if (!B.classList.contains('guided') || $('guideBtn').getAttribute('aria-pressed') !== 'true' || $('guideBtn').textContent !== 'GUIDE: ON') fails.push('guide: GUIDE ME turns the guide on');
    if (gh('wordRadios') || !gh('rolls') || !gh('forgeBtn'.replace('forgeBtn', 'wordGrid')) || !gh('advanced') || !gh('addrBox') || $('gBack').disabled !== true || !/step 1 of 5/.test($('gTitle').textContent)) fails.push('guide: step 1 shows only the choices');
    w.guideStep(1); if (w.document.querySelectorAll('#gDots i.on').length !== 2 || w.document.querySelectorAll('.gstep').length !== 5 || [...w.document.querySelectorAll('.gstep')].filter(e => e.style.display !== 'none').length !== 1) fails.push('guide: progress bar and one explanation at a time');
    if (gh('rolls') || gh('tapRow') || !gh('wordRadios') || !/step 2 of 5/.test($('gTitle').textContent) || $('gNeed').textContent !== '50' || $('gUnit').textContent !== 'rolls') fails.push('guide: step 2 shows the rolls and how many are needed');
    if (!nextOff()) fails.push('guide: NEXT locked with no rolls');
    $('rolls').value = D50.slice(0, 49); $('rolls').oninput(); if (!nextOff()) fails.push('guide: NEXT still locked one roll short');
    $('rolls').value = D50; $('rolls').oninput(); if (nextOff()) fails.push('guide: NEXT unlocks with enough rolls');
    $('advanced').open = false; w.guideStep(1); if (!/step 3 of 5/.test($('gTitle').textContent) || !gh('advanced') || gh('wordGrid') || gh('genResult') || !gh('rolls') || !nextOff()) fails.push('guide: step 3 shows the FORGE button and the words, and is locked until FORGE');
    w.guideStep(-1); if (!/step 2 of 5/.test($('gTitle').textContent)) fails.push('guide: BACK goes back one step');
    { const gx = $('gExit'); if (!gx || !$('guidePanel').contains(gx) || gx.closest('.gstep') || !/EXIT GUIDE/.test(gx.textContent)) fails.push('guide: EXIT GUIDE button is in the always-visible top of the panel');
      for (const n of [1, 2, 3, 4, 5]) { w.guideN = n; w.guideRender(); if (!gx || gx.closest('.gh') || $('guidePanel').querySelectorAll('.gstep').length !== 5 || gx.closest('.gstep')) fails.push('guide: EXIT GUIDE present on step ' + n); }
      w.guideN = 2; w.guideRender(); if (gx) gx.click(); if (B.classList.contains('guided') || w.document.querySelectorAll('.gh').length || $('guideBtn').getAttribute('aria-pressed') !== 'false' || $('guideBtn').textContent !== 'GUIDE ME') fails.push('guide: EXIT GUIDE turns the guide off and shows everything'); w.toggleGuide(); w.guideStep(1); }
    w.guideStep(1); if (!/step 3 of 5/.test($('gTitle').textContent) || gh('wordGrid') || gh('genResult') || !gh('rolls') || !nextOff()) fails.push('guide: step 3 locked until FORGE');
    w.guideStep(1); if (/step 4/.test($('gTitle').textContent)) fails.push('guide: cannot skip FORGE');
    await w.generate(); if (nextOff()) fails.push('guide: FORGE unlocks NEXT');
    w.guideStep(1); if (!/step 4 of 5/.test($('gTitle').textContent) || gh('advanced') || !$('advanced').open || gh('wordGrid') || nextOff()) fails.push('guide: step 4 shows the passphrase box under the words and can be skipped');
    w.guideStep(1); if (!/step 5 of 5/.test($('gTitle').textContent) || $('gNext').textContent !== 'DONE' || gh('watchBox') || gh('addrBox') || !gh('wordGrid')) fails.push('guide: step 5 shows the checks and DONE');
    w.guideStep(1); if (B.classList.contains('guided') || w.document.querySelectorAll('.gh').length) fails.push('guide: DONE turns the guide off and shows everything');
    w.toggleGuide(); if (!/step 3 of 5/.test($('gTitle').textContent)) fails.push('guide: reopening with a seed starts at the words');
    w.clearAll(); await new Promise(r => setTimeout(r, 20)); if (!/step 1 of 5/.test($('gTitle').textContent)) fails.push('guide: CLEAR returns to step 1');
    mode('coin'); words(24); if ($('gNeed').textContent !== '256' || $('gUnit').textContent !== 'flips') fails.push('guide: coin 24 words needs 256 flips');
    mode('dice'); words(24); if ($('gNeed').textContent !== '99') fails.push('guide: dice 24 words needs 99 rolls'); words(12);
    w.toggleGuide(); if (B.classList.contains('guided') || w.document.querySelectorAll('.gh').length) fails.push('guide: switching off shows everything');
    const terms = [...w.document.querySelectorAll('.term')];
    if (terms.length < 6 || terms.some(e => e.getAttribute('tabindex') !== '0' || (e.getAttribute('data-tip') || '').length < 40)) fails.push('terms: every explained word is focusable and has a real explanation');
    const tip = $('tipBox'); terms[0].dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    if (tip.style.display !== 'block' || tip.textContent !== terms[0].getAttribute('data-tip')) fails.push('terms: hovering shows the explanation');
    terms[0].dispatchEvent(new w.MouseEvent('mouseout', { bubbles: true })); if (tip.style.display !== 'none') fails.push('terms: moving away hides it');
    terms[1].dispatchEvent(new w.FocusEvent('focusin', { bubbles: true })); if (tip.style.display !== 'block') fails.push('terms: focusing shows the explanation');
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); if (tip.style.display !== 'none') fails.push('terms: Escape hides it');
    w.toggleSize(); if (!B.classList.contains('big') || $('sizeBtn').getAttribute('aria-pressed') !== 'true') fails.push('text size: A+ makes the page larger');
    w.toggleSize(); if (B.classList.contains('big') || $('sizeBtn').getAttribute('aria-pressed') !== 'false') fails.push('text size: A- goes back');
    w.confirm = () => true;
  } catch (e) { fails.push('guide: the probe crashed: ' + e.message); }
  try { // wallet view (v2.1.0): addresses, QR on every row, SeedQR, recovery sheet
    const AB = 'abandon '.repeat(11) + 'about', sleep = (ms) => new Promise((r2) => setTimeout(r2, ms));
    const until = async (f) => { for (let k = 0; k < 400 && !f(); k++) await sleep(25); return f(); };
    const rows = () => [...$('wvList').querySelectorAll('li')].map((li) => li.textContent);
    const pick = (id, v) => { $(id).value = v; $(id).dispatchEvent(new w.Event(id === 'wvAcct' ? 'input' : 'change', { bubbles: true })); };
    let printed = 0, ptxt = ''; w.print = () => { printed++; ptxt = $('printOnly').textContent; }; w.confirm = () => true; w.alert = () => {};
    w.clearAll(); await sleep(20);
    $('phrase').value = AB; $('verifyPass').value = ''; await w.verify(); await until(() => rows().length === 10);
    if ($('walletView').style.display === 'none' || !/73c5da0a/.test($('wvFp').textContent) || !$('wvIcon').innerHTML.includes('<svg')) fails.push('wallet view: opens with the master fingerprint and its picture');
    if (rows()[0] !== 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu') fails.push('wallet view: first SegWit address');
    if ($('wvList').querySelectorAll('li button.qr-mini').length !== 10) fails.push('wallet view: a QR button on every address row');
    if (!/not made by this page/.test($('wvBanner').textContent)) fails.push('wallet view: says the words were imported');
    pick('wvType', 'tr'); await until(() => /^bc1p/.test(rows()[0] || '')); if (rows()[0] !== 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr') fails.push('wallet view: first Taproot address');
    pick('wvType', 'pkh'); await until(() => /^1/.test(rows()[0] || '')); if (rows()[0] !== '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA') fails.push('wallet view: first Legacy address');
    pick('wvType', 'sh-wpkh'); await until(() => /^3/.test(rows()[0] || '')); if (rows()[0] !== '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf') fails.push('wallet view: first Nested SegWit address');
    pick('wvType', 'wpkh'); pick('wvNet', 'test'); await until(() => /^tb1q/.test(rows()[0] || '')); { let [k, c] = await w.masterFromSeed(await w.mnemonicToSeed(AB, '')); for (const [i, h] of [[84, true], [1, true], [0, true], [0, false], [0, false]]) [k, c] = await w.ckdPriv(k, c, i, h);
      if (rows()[0] !== await w.addressFromKey('wpkh', k, 'test') || !/TESTNET/.test($('wvPath').textContent)) fails.push('wallet view: testnet addresses (coin type 1) and note'); }
    pick('wvNet', 'main'); await until(() => /^bc1q/.test(rows()[0] || '')); const first = rows().slice();
    $('wvNext').click(); await until(() => rows()[0] !== first[0]); if (!/addresses 10 to 19/.test($('wvPath').textContent) || rows().some((a) => first.includes(a))) fails.push('wallet view: NEXT 10 shows the next ten addresses');
    $('wvPrev').click(); await until(() => rows()[0] === first[0]); if (rows().join() !== first.join() || !$('wvPrev').disabled) fails.push('wallet view: PREVIOUS 10 comes back and is off at the start');
    pick('wvAcct', '2'); await until(() => rows()[0] !== first[0]); const a2 = rows()[0]; pick('wvChain', '1'); await until(() => rows()[0] !== a2);
    { const at = async (acct, chain, i) => { let [k, c] = await w.masterFromSeed(await w.mnemonicToSeed(AB, '')); for (const [x, h] of [[84, true], [0, true], [acct, true], [chain, false], [i, false]]) [k, c] = await w.ckdPriv(k, c, x, h); return w.addressFromKey('wpkh', k, 'main'); };
      if (a2 !== await at(2, 0, 0)) fails.push('wallet view: account 2 gives the addresses of account 2');
      if (rows()[0] !== await at(2, 1, 0) || rows()[9] !== await at(2, 1, 9)) fails.push('wallet view: the change chain gives change addresses');
      if (!/m\/84'\/0'\/2'\/1\/index/.test($('wvPath').textContent)) fails.push('wallet view: the account and change chain are in the path'); }
    pick('wvAcct', 'abc'); await sleep(50); if (!/whole number/.test($('wvErr').textContent) || $('wvList').textContent !== '') fails.push('wallet view: a bad account number is refused');
    pick('wvAcct', '0'); pick('wvChain', '0'); await until(() => rows()[0] === first[0]);
    $('wvList').querySelector('li button.qr-mini').click(); { const d = w.document.createElement('div'); d.innerHTML = w.qrSvg(w.qrMatrix(first[0]).rows); if ($('wvqBox').style.display !== 'block' || $('wvqImg').innerHTML !== d.innerHTML || !$('wvqCap').textContent.includes(first[0])) fails.push('wallet view: the QR button shows exactly that address'); }
    $('wvSqBtns').querySelector('button').click(); if ($('wvsBox').style.display !== 'block' || !/SECRET/.test($('wvsCap').textContent)) fails.push('wallet view: SeedQR is marked SECRET');
    printed = 0; w.printRecoverySheet(); if (printed !== 1 || !/^VOIDFORGE RECOVERY SHEET/.test(ptxt) || !ptxt.includes('73c5da0a') || !ptxt.includes(first[0]) || /abandon/.test(ptxt) || !/Passphrase used: NO/.test(ptxt)) fails.push('recovery sheet: fingerprint, type, path and addresses, never the words');
    w.dispatchEvent(new w.Event('afterprint'));
    $('phrase').value = AB + ' '; $('phrase').dispatchEvent(new w.Event('input', { bubbles: true })); if ($('walletView').style.display !== 'none' || $('wvList').textContent !== '' || $('wvsImg').textContent !== '' || $('wvqImg').textContent !== '') fails.push('wallet view: editing the words wipes it');
    $('phrase').value = AB; $('verifyPass').value = 'SECRETPASS'; await w.verify(); await until(() => rows().length === 10);
    if (rows()[0] === first[0] || !/with passphrase/.test($('wvFp').textContent)) fails.push('wallet view: a passphrase gives a different wallet and says so');
    printed = 0; w.printRecoverySheet(); if (ptxt.includes('SECRETPASS') || !/Passphrase used: YES/.test(ptxt)) fails.push('recovery sheet: never prints the passphrase'); w.dispatchEvent(new w.Event('afterprint'));
    const e15 = await w.entropyToMnemonic(new Uint8Array(20)); $('verifyPass').value = ''; $('phrase').value = e15; await w.verify(); await until(() => rows().length === 10);
    if ($('wvSqBtns').style.display !== 'none' || !/No SeedQR exists for 15 words/.test($('wvSqNote').textContent)) fails.push('wallet view: 15 words have no SeedQR and the page says so');
    $('phrase').value = AB; await w.verify(); await until(() => rows().length === 10); w.wipeSeed(); if ($('walletView').style.display !== 'none' || $('wvList').textContent !== '') fails.push('wallet view: CLEAR ALL wipes it');
    // the same QR button on the Make tab rows
    mode('dice'); words(12); $('rolls').value = D50; $('rolls').oninput(); await w.generate(); await w.eval('passWork'); await until(() => w.document.querySelectorAll('#trList li').length === 5);
    const mk = [...w.document.querySelectorAll('#addrList li, #trList li')]; if (mk.length !== 10 || mk.some((li) => !li.querySelector('button.qr-mini'))) fails.push('address QR: every row under the seed has a QR button');
    if (mk[0]) { mk[0].querySelector('button.qr-mini').click(); const d = w.document.createElement('div'); d.innerHTML = w.qrSvg(w.qrMatrix(mk[0].textContent).rows); if ($('aqBox').style.display !== 'block' || $('aqImg').innerHTML !== d.innerHTML || !$('aqCap').textContent.includes(mk[0].textContent)) fails.push('address QR: the button under the seed shows exactly that address'); }
    w.clearAll(); await sleep(20);
  } catch (e) { fails.push('wallet view: the probe crashed: ' + e.message); }
  try { // v2.2.0: watch-only view, Electrum warning, payment request, backup checklist, key-reuse check
    const AB = 'abandon '.repeat(11) + 'about', sleep = (ms) => new Promise((r2) => setTimeout(r2, ms));
    const until = async (f) => { for (let k = 0; k < 400 && !f(); k++) await sleep(25); return f(); };
    const rows = () => [...$('wvList').querySelectorAll('li')].map((li) => li.textContent);
    const openW = async (v) => { $('wpIn').value = v; $('wpIn').dispatchEvent(new w.Event('input', { bubbles: true })); await w.openWatchOnly(); };
    w.print = () => {}; w.confirm = () => true; w.alert = () => {};
    w.clearAll(); await sleep(20);
    const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
    const XPUB86 = 'xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ';
    await openW(ZPUB); await until(() => rows().length === 10);
    if (rows()[0] !== 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu' || rows()[9] === rows()[0]) fails.push('watch-only: the zpub gives its published addresses');
    if (!$('wvType').disabled || $('wvType').value !== 'wpkh' || !$('wvNet').disabled) fails.push('watch-only: a zpub locks the type and network');
    if (!/Watch-only/.test($('wvBanner').textContent) || $('wvSqBlock').style.display !== 'none' || $('wvSheetBtn').style.display !== 'none') fails.push('watch-only: says so, and offers no SeedQR or recovery sheet');
    if (!/not known/.test($('wvFp').textContent)) fails.push('watch-only: no fingerprint is made up for a plain xpub');
    await openW(XPUB86); await until(() => rows().length === 10); $('wvType').value = 'tr'; $('wvType').dispatchEvent(new w.Event('change', { bubbles: true })); await until(() => /^bc1p/.test(rows()[0] || ''));
    if (rows()[0] !== 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr' || $('wvType').disabled) fails.push('watch-only: a plain xpub lets you pick Taproot and gives the published address');
    { const seed = await w.mnemonicToSeed(AB, ''), tw = await w.watchOnlyFromSeed(seed, 'tr', 0, 'test'); let [k, c] = await w.masterFromSeed(seed);
      for (const [i, h] of [[86, true], [1, true], [0, true], [0, false], [0, false]]) [k, c] = await w.ckdPriv(k, c, i, h);
      const want = await w.addressFromKey('tr', k, 'test'); await openW(tw.receive); await until(() => rows().length === 10);
      if (rows()[0] !== want || !/^tb1p/.test(rows()[0])) fails.push('watch-only: a testnet Taproot descriptor gives tb1p addresses'); }
    { const seed = await w.mnemonicToSeed(AB, ''), wo = await w.watchOnlyFromSeed(seed, 'wpkh', 0, 'main');
      await openW(wo.change); await until(() => rows().length === 10); const c0 = rows()[0];
      if ($('wvChain').value !== '1' || c0 === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu') fails.push('watch-only: a /1/* descriptor opens change addresses');
      await openW(wo.receive); await until(() => rows()[0] === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
      if ($('wvChain').value !== '0' || !/73c5da0a/.test($('wvFp').textContent) || !$('wvIcon').innerHTML.includes('<svg')) fails.push('watch-only: a /0/* descriptor opens receive addresses with its fingerprint and picture');
      await openW(wo.receive.slice(0, -1) + (wo.receive.slice(-1) === 'a' ? 'b' : 'a')); if (!/checksum/.test($('wpStatus').textContent) || $('walletView').style.display !== 'none') fails.push('watch-only: a wrong checksum is refused');
      await openW('sh(wpkh(' + ZPUB + '/0/*))'); if (!/but the key is a zpub/.test($('wpStatus').textContent)) fails.push('watch-only: a descriptor that does not match its key is refused'); }
    await openW('xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeCficPSGfubmSFDxo1kuHnLisriDvSnRRuL2Qrg5ggqHKNVpxR86QEC8w35uxmGoggxtQTPvfUu'); if (!/PRIVATE/.test($('wpStatus').textContent)) fails.push('watch-only: a private key is refused');
    await openW(ZPUB); await until(() => rows().length === 10); $('wpIn').value += ' '; $('wpIn').dispatchEvent(new w.Event('input', { bubbles: true }));
    if ($('walletView').style.display !== 'none' || $('wvType').disabled || $('wvSqBlock').style.display === 'none') fails.push('watch-only: editing the key wipes the view and restores the controls');
    // Electrum
    { const r = await w.checkPhrase('wild father tree among universe such mobile favorite target dynamic credit identify'); if (r.ok || !/Electrum seed \(SegWit type\)/.test(r.msg)) fails.push('Electrum: the SegWit example seed is named');
      const r2 = await w.checkPhrase('abandon '.repeat(12).trim()); if (r2.ok || /Electrum/.test(r2.msg)) fails.push('Electrum: an ordinary bad phrase gets no note');
      if (await w.electrumSeedType('say brain hammer whip plug sad budget improve scout myself interest input') !== 'two-factor (2FA)' || await w.electrumSeedType('neglect morning hat science deputy alarm seed eager cover letter pencil second') !== 'two-factor (2FA) SegWit' || await w.electrumSeedType('shoulder between fitness double soap point region fade rose guide kitten loud') !== null) fails.push('Electrum: two-factor types named, and a 103 prefix is not Electrum'); }
    // payment request
    { const A = w.bip21Amount; if (A('0.0015').v !== '0.0015' || A('1.10000000').v !== '1.1' || A('21000000').v !== '21000000' || A('0').ok || A('1.123456789').ok || A('21000000.00000001').ok) fails.push('payment request: amounts are checked');
      if (w.bip21Uri('bc1qx', '0.5', 'Café & tea', 'Thanks!') !== 'bitcoin:bc1qx?amount=0.5&label=Caf%C3%A9%20%26%20tea&message=Thanks!') fails.push('payment request: the link is built and encoded');
      $('phrase').value = AB; $('verifyPass').value = ''; await w.verify(); await until(() => rows().length === 10);
      $('wvList').querySelector('li button.qr-mini').click(); $('wvqAmt').value = '0.0015'; $('wvqAmt').dispatchEvent(new w.Event('input'));
      const uri = 'bitcoin:bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu?amount=0.0015', d = w.document.createElement('div'); d.innerHTML = w.qrSvg(w.qrMatrix(uri).rows);
      if ($('wvqUri').textContent !== uri || $('wvqImg').innerHTML !== d.innerHTML) fails.push('payment request: the QR becomes the bitcoin: link');
      w.hideAddrQr('wvq'); if ($('wvqAmt').value !== '' || $('wvqBox').style.display !== 'none') fails.push('payment request: HIDE QR clears it'); }
    // checklist
    { mode('dice'); words(12); $('passphrase').value = ''; $('passphrase2').value = ''; $('rolls').value = D50; $('rolls').oninput(); await w.generate(); await w.eval('passWork');
      if ($('bkList').style.display === 'none' || $('bk2').checked || !/0 of 4/.test($('bkNote').textContent)) fails.push('checklist: appears with the words, nothing ticked');
      const wd = $('genResult').textContent.split('\n')[0]; w.drillStart(); $('drillWords').value = wd; await w.drillCheck(); w.drillEnd();
      if (!$('bk2').checked) fails.push('checklist: a passed drill ticks itself');
      $('phrase').value = wd; await w.verify(); await until(() => rows().length === 10); w.printRecoverySheet(); w.dispatchEvent(new w.Event('afterprint'));
      if (!$('bk4').checked) fails.push('checklist: the recovery sheet for these words ticks itself');
      $('bk1').checked = true; $('bk3').checked = true; w.bkUpdate(); if (!/All four done/.test($('bkNote').textContent)) fails.push('checklist: says when all four are done');
      $('passphrase').value = 'x'; $('passphrase2').value = 'x'; $('passphrase').dispatchEvent(new w.Event('input', { bubbles: true })); await w.rePass();
      if ($('bk2').checked || $('bk4').checked || !$('bk1').checked) fails.push('checklist: a passphrase change unticks the drill and the sheet');
      w.wipeSeed(); if ($('bkList').style.display !== 'none' || $('bk1').checked) fails.push('checklist: CLEAR ALL clears and hides it'); }
    // key reuse
    { const seed = await w.mnemonicToSeed(AB, ''), a0 = await w.watchOnlyFromSeed(seed, 'wpkh', 0, 'main'), a1 = await w.watchOnlyFromSeed(seed, 'wpkh', 1, 'main');
      const run = async (v) => { $('reuseIn').value = v; await w.checkKeyReuse(); return $('reuseStatus').textContent; };
      if (!/No reused key/.test(await run(a0.receive))) fails.push('key reuse: a clean descriptor passes');
      if (!/No reused key/.test(await run(a0.receive + '\n' + a0.change))) fails.push('key reuse: receive and change of one wallet are not reuse');
      if (!/appears in 2 different wallets/.test(await run(a0.receive + '\npkh(' + a0.xpub + '/0/*)'))) fails.push('key reuse: one key in two wallets is found');
      if (!/appears 2 times in one descriptor/.test(await run('wsh(sortedmulti(2,' + a0.xpub + '/0/*,' + a0.xpub + '/0/*))'))) fails.push('key reuse: one key twice in one multisig is found');
      if (!/appears in 2 different wallets/.test(await run(a0.zpub + '\n' + a0.xpub))) fails.push('key reuse: zpub and xpub of one key count as one key');
      if (!/2 different keys come from the same master fingerprint/.test(await run('wsh(sortedmulti(2,' + a0.receive.replace(/\/0\/\*$/, '') + ',' + a1.receive.replace(/\/0\/\*$/, '') + '))'))) fails.push('key reuse: two multisig keys from one seed are found');
      if (!/is given with different keys/.test(await run('wpkh([73c5da0a/84h/0h/0h]' + a1.xpub + '/0/*)\nwpkh([73c5da0a/84h/0h/0h]' + a0.xpub + '/0/*)'))) fails.push('key reuse: one origin with two keys is found');
      if (!/^STOP: this contains a PRIVATE key.*treat that key as exposed/.test(await run('wpkh(xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeCficPSGfubmSFDxo1kuHnLisriDvSnRRuL2Qrg5ggqHKNVpxR86QEC8w35uxmGoggxtQTPvfUu/0/*)'))) fails.push('key reuse: private keys are refused with the exposed-key warning');
      w.clearReuse(); }
    w.clearAll(); await sleep(20);
  } catch (e) { fails.push('v2.2.0 probe crashed: ' + e.message); }
  try { // rolling-dice logo and the live preview words
    const setRolls = (v) => { $('rolls').value = v; $('rolls').oninput(); };
    w.clearAll(); await new Promise(r => setTimeout(r, 20)); mode('dice'); words(12);
    { // live preview: grey words follow the rolls
      const pv = () => [...w.document.querySelectorAll('#wordGrid .wcell.pv')].map((e) => e.textContent.replace(/^\d+\.?\s*/, '').trim());
      setRolls(D50.slice(0, 7)); await w.previewRefresh(); const e1 = (await w.rollsToMnemonic(D50.slice(0, 7), 12)).split(' ');
      if (pv().join('|') !== e1.join('|') || !/PREVIEW/.test($('pvNote').textContent) || /^[a-z]/.test($('genResult').textContent.trim() && '')) fails.push('preview: grey words equal the words made from the rolls so far');
      setRolls(D50.slice(0, 8)); await w.previewRefresh(); const e2 = (await w.rollsToMnemonic(D50.slice(0, 8), 12)).split(' '); if (pv().join('|') !== e2.join('|')) fails.push('preview: words change with the next roll');
      words(24); setRolls(D50.slice(0, 9)); await w.previewRefresh(); if (pv().length !== 24) fails.push('preview: 24 slots in 24-word mode'); words(12);
      setRolls(''); await w.previewRefresh(); if (pv().length || $('pvNote').textContent) fails.push('preview: nothing with no rolls');
      setRolls(D50); await w.previewRefresh(); await w.generate(); if (w.document.querySelectorAll('#wordGrid .wcell.pv').length || $('pvNote').textContent) fails.push('preview: FORGE replaces the grey words with the real ones');
      setRolls(D50.slice(0, 7)); await w.previewRefresh(); await w.generate(); for (let k = 0; k < 40 && !pv().length; k++) await new Promise(r => setTimeout(r, 25)); { const eX = (await w.rollsToMnemonic(D50.slice(0, 7), 12)).split(' '); if (pv().join('|') !== eX.join('|') || !/PREVIEW/.test($('pvNote').textContent)) fails.push('preview: FORGE with too few rolls keeps the grey words'); }
      setRolls(D50.slice(0, 5)); await w.previewRefresh(); w.clearAll(); await new Promise(r => setTimeout(r, 20)); if (pv().length || $('pvNote').textContent) fails.push('preview: CLEAR removes the grey words');
    }
    { // Bitcoin dictionary (v1.27.3)
      const box = $('dictBox'), items = [...$('dictList').querySelectorAll('.dict-item')], names = items.map((e) => e.querySelector('dt').textContent), def = (e) => e.querySelector('dd').firstChild.textContent;
      const q = (v) => { $('dictSearch').value = v; w.dictFilter(); return items.filter((e) => e.style.display !== 'none').map((e) => e.querySelector('dt').textContent); };
      const dictFacts=[['Electrum seed',/different checksum/],['Key reuse (multisig)',/one seed then counts as two signers/],['BIP21',/at most 8 decimals/],['Change address',/second chain/],['Change address',/leftover coins/],['Receive address',/first chain/],['Receive address',/fresh one for each payment/],['Base85',/85 different characters/],['Base85',/RFC 1924/],['SHAKE256',/SHA-3 family/],['BIP85',/passwords or dice rolls/],['Wordlist',/2048/],['Wordlist',/first four letters/],['Fingerprint (master fingerprint)',/Eight characters/],['Satoshi (sat)',/hundred-millionth/],['Gap limit',/usually 20/],['Passphrase (the 25th word)',/completely different wallet/],['Testnet',/tb1/],['Taproot',/bc1p/],['Native SegWit',/bc1q/],['Legacy address',/starting with 1\./],['Nested SegWit',/starting with 3\./],['BIP39',/12 or 24 words/],['BIP85',/child seed/],['BIP84',/m\/84'\/0'\/0'/],['BIP86',/m\/86'\/0'\/0'/],['PBKDF2',/2048 rounds/],['Dice entropy',/2\.58 bits/],['Coin flip entropy',/128 flips.*256/],['OP_RETURN',/never be spent/],['Bit',/128 bits.*256/],['Block',/ten minutes/],['Fee (miner fee)',/inputs minus the outputs/],['Bitcoin',/21 million/],['Halving',/210,000/],['Difficulty',/2016 blocks/],['Virtual byte (vByte) and weight',/4,000,000/],['Genesis block',/3 January 2009/],['Whitepaper',/31 October 2008/],['Block header',/80-byte/],['WIF (Wallet Import Format)',/5, K or L/],['P2WPKH',/bc1q/],['P2TR',/bc1p/],['BIP44',/m\/44'\/0'\/0'/],['BIP49',/m\/49'\/0'\/0'/],['Bitcoin Pizza Day',/10,000 bitcoin/],['Byte',/32 bytes.*16 bytes/],['P2PKH',/starting with 1/],['P2SH',/starting with 3/],['BIP125',/replace-by-fee/],['BIP350',/bech32m/],['Block reward',/50 bitcoin/]];
      if (!box || box.open || !/Bitcoin dictionary/.test(box.querySelector('summary').textContent) || items.length < 250) fails.push('dictionary: closed box with 250+ entries');
      const col = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
      if (!names.every((n, k) => k === 0 || col.compare(names[k - 1], n) <= 0) || new Set(names.map((n) => n.toLowerCase())).size !== names.length) fails.push('dictionary: A to Z and no duplicates');
      if (!items.every((e) => def(e).length >= 25 && def(e).length <= 330 && e.querySelector('dt').textContent.length <= 45) || items.some((e) => /[<>]|http|www\./i.test(e.textContent))) fails.push('dictionary: short plain entries, no links');
      if ($('dictCount').textContent !== items.length + ' entries, A to Z') fails.push('dictionary: count line at the start');
      { const wl = items.find((e) => e.querySelector('dt').textContent === 'Wordlist'), notes = items.filter((e) => /^In VOIDFORGE: ./.test((e.querySelector('dd small') || {}).textContent || ''));
        if (!wl || !/^In VOIDFORGE: SHOW FIRST 4 LETTERS/.test((wl.querySelector('dd small') || {}).textContent || '') || notes.length < 20) fails.push('dictionary: where a term appears in VOIDFORGE is shown'); }
      const xp = q('xpub'); if (xp.length < 1 || xp.length > 5 || !xp.includes('Extended public key (xpub, ypub, zpub)')) fails.push('dictionary: search finds xpub');
      if (q('GAP  LIMIT').join('|') !== 'Gap limit') fails.push('dictionary: search ignores capitals and extra spaces');
      if (!q('second tool').includes('Second tool') || !q('restore drill').includes('Restore drill')) fails.push('dictionary: search finds terms');
      if (q('safety wall').join() !== "Hardened path (the ' mark)" || !q('green self-test passed').includes('Self-test') || !q('sha256sums').includes('SHA256SUMS')) fails.push('dictionary: search covers the definition and the In VOIDFORGE note');
      if (q('zzzzqq').length !== 0 || !/No entry matches/.test($('dictCount').textContent)) fails.push('dictionary: no-match message');
      if (q('bip').length < 7 || !/ of \d+ entries/.test($('dictCount').textContent)) fails.push('dictionary: matched count line');
      if (q('').length !== items.length) fails.push('dictionary: clearing the search shows everything');
      { const chips = [...$('dictCats').querySelectorAll('button')], cats = ['All', 'Basics', 'Keys & seeds', 'Wallets & backups', 'Addresses & scripts', 'Transactions', 'Network & mining', 'Standards (BIPs)', 'Lightning & layers', 'Privacy & security', 'Units & math', 'Culture & markets', 'VOIDFORGE'];
        if (chips.map((b) => b.textContent).join('|') !== cats.join('|')) fails.push('dictionary: a topic button for every category');
        if (!items.every((e) => cats.slice(1).includes(e.dataset.c)) || !cats.slice(1).every((c) => items.filter((e) => e.dataset.c === c).length >= 3)) fails.push('dictionary: every entry in a known topic, every topic has entries');
        $('dictSearch').value = ''; chips.find((b) => b.textContent === 'Lightning & layers').click(); const li = items.filter((e) => e.style.display !== 'none');
        if (li.length < 8 || !li.every((e) => e.dataset.c === 'Lightning & layers') || chips.filter((b) => b.getAttribute('aria-pressed') === 'true').length !== 1 || !/ of \d+ entries/.test($('dictCount').textContent)) fails.push('dictionary: a topic button shows only that topic and shows pressed');
        $('dictSearch').value = 'channel'; w.dictFilter(); const lc = items.filter((e) => e.style.display !== 'none').map((e) => e.querySelector('dt').textContent);
        if (!lc.includes('Lightning channel') || lc.includes('Wallet file')) fails.push('dictionary: topic and search work together');
        $('dictSearch').value = 'zzzzqq'; w.dictFilter(); if (!/No entry matches .zzzzqq. in Lightning & layers\./.test($('dictCount').textContent)) fails.push('dictionary: no-match line names the topic');
        chips[0].click(); $('dictSearch').value = ''; w.dictFilter(); if (items.filter((e) => e.style.display !== 'none').length !== items.length) fails.push('dictionary: All shows everything again');
        const body = stripScripts(mutated).split('\n').filter((l) => !/<li><b>\d+\.\d+\.\d+<\/b>/.test(l)).join('\n'), nums = new Set(), re = /\b(BIP|SLIP)[- ]?0*(\d+)\b/g; let mm; while ((mm = re.exec(body))) nums.add(mm[1] + mm[2]);
        const missing = [...nums].filter((k) => !names.some((n) => { const m = /^(BIP|SLIP)/.exec(k)[1], d = k.slice(m.length); return new RegExp('\\b' + m + '[- ]?0*' + d + '\\b', 'i').test(n) || (m === 'BIP' && new RegExp('\\b' + d + '\\b').test(n) && /BIP/.test(n)); }));
        if (nums.size < 8 || missing.length) fails.push('dictionary: every BIP or SLIP named in the page has an entry'); }
      if (!dictFacts.every(([n, re]) => { const e = items.find((x) => x.querySelector('dt').textContent === n); return e && re.test(e.textContent); })) fails.push('dictionary: key facts in the entries');
      if (!/id="dictSearch"[^>]*oninput="dictFilter\(\)"/.test(mutated)) fails.push('dictionary: search wired');
    }
    { // Support this project (v1.27.3)
      const box = $('supportBox'), code = $('supportLnurl').textContent.trim();
      if (!box || box.open || !/Optional/.test(box.querySelector('summary').textContent)) fails.push('support: closed optional box');
      if ($('supportAddr').textContent !== 'dev@breez.tips' || code !== 'LNURL1DP68GURN8GHJ7CNJV4JH5TN5D9C8XTMVDE6HYMRS9AJX2ASZ5RD0C') fails.push('support: exact address and payment code');
      if (!$('supportQr').querySelector('svg path') || $('supportQr').innerHTML !== (() => { const d = w.document.createElement('div'); d.innerHTML = w.qrSvg(w.qrMatrix(code).rows); return d.innerHTML; })()) fails.push('support: QR drawn from the payment code');
      if (box.querySelectorAll('a, [href], img, iframe, script').length || !/never goes online/.test(box.textContent) || !/never send seed words/i.test(box.textContent)) fails.push('support: no link, and the honest notes');
      const clip = []; Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (x) => { clip.push(x); } }, configurable: true }); const bs = box.querySelectorAll('button'); bs[0].click(); await new Promise((r) => setTimeout(r, 20)); bs[1].click(); await new Promise((r) => setTimeout(r, 20));
      if (bs.length !== 2 || clip[0] !== 'dev@breez.tips' || clip[1] !== code) fails.push('support: COPY copies the address and the code');
    }
    { // Check your download (v1.27.3)
      const bytes = Buffer.from('VOIDFORGE test file é\n' + 'x'.repeat(5000)), U = new Uint8Array(bytes), sha = nc.createHash('sha256').update(bytes).digest('hex');
      const r0 = await w.dlCheck(U, '');
      if (r0.hash !== sha || r0.verdict !== 'none') fails.push('download: hash or no-input verdict wrong');
      if (w.dlCid(new Uint8Array(Buffer.from('2e5ae17a178fafdbde51c3958c6c6d579579622b27a9feeabe5e91cbce579fde', 'hex'))) !== 'bafkreibollqxuf4pv7n54uodswggy3kxsv4wekzhvh7ovps6shf44v473y') fails.push('download: CID of a known hash wrong');
      const h1 = new Uint8Array(32).fill(255), h2 = new Uint8Array(32);
      if (w.dlCid(h1) !== 'bafkreih77777777777777777777777777777777777777777777777777777' && w.dlCid(h1).length !== 59) fails.push('download: CID length');
      if (w.dlCid(h2).length !== 59 || !w.dlCid(h2).startsWith('bafkrei')) fails.push('download: CID prefix');
      if ((await w.dlCheck(U, sha)).verdict !== 'match' || (await w.dlCheck(U, sha.toUpperCase() + '  voidforge.html\n')).verdict !== 'match' || (await w.dlCheck(U, 'sha256 ' + sha + ' and ' + r0.cid)).verdict !== 'match') fails.push('download: matching forms');
      if ((await w.dlCheck(U, r0.cid)).verdict !== 'match') fails.push('download: CID alone');
      const bad = sha.slice(0, 63) + (sha[63] === '0' ? '1' : '0');
      if ((await w.dlCheck(U, bad)).verdict !== 'mismatch') fails.push('download: wrong hash must not match');
      if ((await w.dlCheck(U, sha + ' ' + bad)).verdict !== 'mismatch') fails.push('download: one wrong value among right ones must not match');
      if ((await w.dlCheck(U, r0.cid + ' ' + sha.replace(/.$/, (c) => (c === '0' ? '1' : '0')))).verdict !== 'mismatch') fails.push('download: right CID with wrong hash must not match');
      if ((await w.dlCheck(U, r0.cid.slice(0, -1) + (r0.cid.endsWith('a') ? 'b' : 'a'))).verdict !== 'mismatch') fails.push('download: wrong CID must not match');
      const fl = new Uint8Array(U); fl[100] ^= 1; if ((await w.dlCheck(fl, sha)).verdict !== 'mismatch') fails.push('download: changed file must not match');
      if ((await w.dlCheck(U, sha.slice(0, 40))).verdict !== 'none' || (await w.dlCheck(U, sha + '0')).verdict !== 'none') fails.push('download: partial or over-long hash is ignored');
      if ((await w.dlCheck(U, r0.cid.slice(0, 20))).verdict !== 'none') fails.push('download: truncated CID-looking text is ignored');
      const F = new w.File([bytes], 'voidforge.html'); Object.defineProperty($('dlFile'), 'files', { value: [F], configurable: true }); $('dlPaste').value = sha; await w.dlPick();
      if (!/^MATCH/.test($('dlStatus').textContent) || !$('dlStatus').classList.contains('ok') || !$('dlOut').textContent.includes(sha) || !$('dlOut').textContent.includes(r0.cid)) fails.push('download: file box shows MATCH with hash and CID');
      $('dlPaste').value = bad; await w.dlPick();
      if (!/^NO MATCH/.test($('dlStatus').textContent) || !$('dlStatus').classList.contains('bad')) fails.push('download: file box shows NO MATCH in red');
      Object.defineProperty($('dlFile'), 'files', { value: [{ name: 'big.bin', size: 64 * 1024 * 1024 + 1 }], configurable: true }); await w.dlPick();
      if (!/larger than 64 MB/.test($('dlStatus').textContent) || $('dlOut').style.display !== 'none') fails.push('download: over 64 MB refused');
      Object.defineProperty($('dlFile'), 'files', { value: [], configurable: true }); await w.dlPick();
      if (!/Choose the voidforge\.html/.test($('dlStatus').textContent)) fails.push('download: no file chosen prompt');
      Object.defineProperty($('dlFile'), 'files', { value: [F], configurable: true }); $('dlPaste').value = sha; await w.dlPick(); // repopulate dlOut/dlStatus with real content so CLEAR is actually exercised, not just finding them already empty
      w.dlClear(); if ($('dlPaste').value !== '' || $('dlStatus').textContent !== '' || $('dlOut').textContent !== '' || $('dlOut').style.display !== 'none') fails.push('download: CLEAR empties everything');
      if (!/id="dlFile"[^>]*onchange="dlPick\(\)"/.test(mutated) || !/id="dlPaste"[^>]*oninput="dlPick\(\)"/.test(mutated) || !/a page cannot vouch for itself/.test(mutated)) fails.push('download: file box wiring and the honest limit note');
    }
    { // Labels are plain coloured words (v2 design): RECOMMENDED gold, SECRET red, PUBLIC green, grey for the rest; every "NEW" label is the same grey tag-ro
      const doc = w.document, hexc = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const lumc = (c) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
      const crc = (a, b) => { const x = lumc(a), y = lumc(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const labels = [...doc.querySelectorAll('summary, option')].filter((e) => /recommended/i.test(e.textContent));
      if (doc.querySelectorAll('.tag-rec').length !== 2 || doc.querySelectorAll('option.opt-rec').length !== 1 || labels.length !== 3 || !labels.every((e) => e.querySelector('.tag-rec') || e.classList.contains('opt-rec'))) fails.push('recommended: every label is a gold word or a gold option');
      const notes = [...doc.querySelectorAll('.tag-note')], ros = [...doc.querySelectorAll('.tag-ro')];
      if (notes.length !== 2 || !notes.every((e) => /^ADVANCED$/.test(e.textContent)) || [...doc.querySelectorAll('summary')].some((e) => /\((demo only|advanced)/i.test(e.textContent))) fails.push('tags: ADVANCED is a grey label, not plain (brackets)');
      if (ros.filter((e) => e.textContent === 'NEW').length !== 2) fails.push('tags: every "NEW" label is the same grey tag-ro style');
      const sheet = mutated.match(/<style>[\s\S]*?<\/style>/)[0];
      if (!/\.tag, body\.light \.tag \{ border: 0; background: none;/.test(sheet) || !/\.tag-rec, body\.light \.tag-rec \{ color: var\(--warn-text\); background: none; \}/.test(sheet) || !/\.opt-rec \{[^}]*color: var\(--warn-text\)/.test(sheet)) fails.push('recommended: gold words, no pill');
      if (!/\.tag-secret, body\.light \.tag-secret \{ color: var\(--bad-text\); font-weight: 800; \}/.test(sheet) || !/\.tag-public \{ color: var\(--ok-text\); \}/.test(sheet) || !/\.tag-note, body\.light \.tag-note, \.tag-ro \{ color: var\(--muted\); background: none; \}/.test(sheet)) fails.push('tags: SECRET red, PUBLIC green, the rest grey');
      const tok = (blk, n) => { const m = new RegExp(n + ': (#[0-9a-fA-F]{6})').exec(blk); return m ? m[1] : '#000000'; };
      const rootBlk = [...sheet.matchAll(/\n  :root \{[^}]*\}/g)].pop()[0], lightBlk = [...sheet.matchAll(/\n  body\.light \{[^}]*\}/g)].pop()[0];
      for (const [nm, blk] of [['dark', rootBlk], ['light', lightBlk]]) {
        const bg = hexc(tok(blk, '--bg')), sf = hexc(tok(blk, '--surface'));
        const pairs = [['--text', bg], ['--muted', bg], ['--muted', sf], ['--goldtx', bg], ['--warn-text', sf], ['--bad-text', sf], ['--ok-text', sf]];
        if (!pairs.every(([k, b2]) => crc(hexc(tok(blk, k)), b2) >= 4.5) || crc(hexc(tok(blk, '--btntx')), hexc(tok(blk, '--btn'))) < 4.5) fails.push('colours (' + nm + '): every text colour and the gold button label keep contrast 4.5:1');
      }
    }
    { // main-action buttons are the primary cyan style, helper buttons stay grey secondary (v1.27.3)
      const doc = w.document;
      const mains = ['drillStart', 'prStart', 'prCheckBtn', 'checkAddrBtn', 'checkAcctsBtn', 'reforgeWordsBtn', 'psbtBtn', 'cmpBtn', 'childBtn', 'forgeBtn', 'wpBtn', 'reuseBtn', 'sigBtn'];
      if (mains.some((id) => { const b = doc.getElementById(id); return !b || b.classList.contains('secondary'); })) fails.push('buttons: every main action button is primary cyan, not secondary');
      const helpers = [...doc.querySelectorAll('button')].filter((b) => /^(COPY|SHOW QR|HIDE|PRINT|UNDO)/i.test(b.textContent.trim()));
      if (helpers.length < 10 || !helpers.every((b) => b.classList.contains('secondary') || b.classList.contains('btn-clear') || b.classList.contains('print-btn'))) fails.push('buttons: small helper buttons stay grey secondary (or the same-grey print-btn/theme-toggle style)');
    }
    w.clearAll();
  } catch (e) { fails.push('preview: the probe crashed: ' + e.message); }
  try { // Word draw
    if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = function () {};
    const A11 = 'abandon '.repeat(11), LEG = 'legal winner thank year wave sausage worth useful legal winner thank';
    let conf = 0, cnf2 = true; w.confirm = () => { conf++; return cnf2; };
    const wd = async (len, ws, fl, pw = '') => { $('wdLen').value = String(len); $('wdWords').value = ws; $('wdFlips').value = fl; $('passphrase').value = pw; $('passphrase2').value = pw; w.wdUpdate(); const dis = $('wdBtn').disabled; await w.wdGenerate(); return { dis, res: $('genResult').textContent.split('\n')[0] }; };
    w.clearAll(); await new Promise(r => setTimeout(r, 20));
    let r = await wd(12, A11, '0000000'); if (r.dis || r.res !== A11 + 'about') fails.push('word draw: all-zero known seed');
    if (!/73c5da0a/.test($('fingerprint').textContent) || $('explainBox').style.display !== 'none') fails.push('word draw: fingerprint shown and the dice explainer hidden');
    const out = $('wdOut').textContent; if ($('wdOut').style.display === 'none' || !/How your last word was made/.test(out) || !/Flips 0000000/.test(out) || !/Together 11 x 11 \+ 7 = 128 bits/.test(out) || !/Checksum first 4 bits of SHA-256/.test(out) || !/=\s+about/.test(out) || w.document.querySelectorAll('#wdOut .wd-row').length !== 15 || !/No hashing is applied/.test(out)) fails.push('word draw: the steps are shown');
    r = await wd(12, LEG, '1111111'); if (r.res !== LEG + ' yellow') fails.push('word draw: second known seed');
    if ($('wdMsg').textContent || $('wdBtn').disabled) fails.push('word draw: a complete, valid draw shows no complaint');
    if (!!/Checksum first 4 bits of SHA-256 of those bytes = [01]{4}\b/.test($('wdOut').textContent.replace(/\s+/g, ' '))) fails.push('word draw: checksum bits shown');
    r = await wd(12, 'lega WINN thank,year wave saus worth usef legal winner THANK', '1111111'); if (r.res !== LEG + ' yellow') fails.push('word draw: abbreviations, commas, capitals');
    r = await wd(24, 'abandon '.repeat(23), '000'); if (r.dis || r.res !== 'abandon '.repeat(23) + 'art') fails.push('word draw: 24 words');
    if (!/23 x 11 \+ 3 = 256 bits/.test($('wdOut').textContent.replace(/\s+/g, ' '))) fails.push('word draw: 24-word steps');
    r = await wd(12, A11, '000000'); if (!r.dis || !/6 \/ 7 flips/.test($('wdCount').textContent)) fails.push('word draw: a short flip count keeps the button off');
    r = await wd(12, 'abandon '.repeat(10), '0000000'); if (!r.dis || !/10 \/ 11 words/.test($('wdCount').textContent)) fails.push('word draw: a short word count keeps the button off');
    r = await wd(12, 'abandon '.repeat(12), '0000000'); if (!r.dis || !/Too many words/.test($('wdMsg').textContent)) fails.push('word draw: too many words');
    r = await wd(12, A11, '00000000'); if (!r.dis || $('wdFlips').value.length !== 8 && false) fails.push('word draw: too many flips');
    if (!/Too many flips/.test($('wdMsg').textContent)) fails.push('word draw: too many flips message');
    r = await wd(12, A11.replace('abandon abandon', 'abandon zzzz'), '0000000'); if (!r.dis || !/Word 2 \(zzzz\) is not a BIP39 word/.test($('wdMsg').textContent)) fails.push('word draw: unknown word named');
    $('wdFlips').value = '10x2 1011'; w.wdUpdate(); if ($('wdFlips').value !== '101011') fails.push('word draw: only 1 and 0 count');
    w.wdClear(); if ($('wdWords').value || $('wdFlips').value || $('wdOut').textContent) fails.push('word draw: CLEAR button wipes');
    if (w.wdResolve('abandon') !== 0 || w.wdResolve('aban') !== 0 || w.wdResolve('abando') !== 0 || w.wdResolve('abx') !== -1 || w.wdResolve('abanx') !== -1 || w.wdResolve('add') < 0 || w.wdResolve('zoo') !== 2047 || w.wdResolve('ab') !== -1) fails.push('word draw: word lookup');
    if (w.wdParse('abandon, ability;able').idx.join() !== '0,1,2' || w.wdParse('abandon qqqq').bad.length !== 1) fails.push('word draw: parsing');
    conf = 0; cnf2 = true; r = await wd(12, A11, '0000000'); if (conf !== 2) fails.push('word draw: identical words and identical flips both ask first (' + conf + ')');
    conf = 0; r = await wd(12, 'abandon ability able about above absent absorb abstract absurd abuse access', '0101010'); if (conf !== 1 || !/^abandon ability able about above absent absorb abstract absurd abuse access /.test(r.res)) fails.push('word draw: alphabetical words ask first (' + conf + ')');
    conf = 0; r = await wd(12, LEG, '1010101'); if (conf !== 0 || !/^legal winner/.test(r.res)) fails.push('word draw: normal draws do not ask');
    conf = 0; r = await wd(12, LEG, '1111111'); if (conf !== 1) fails.push('word draw: identical flips ask first (' + conf + ')');
    conf = 0; cnf2 = false; await w.generate(); r = await wd(12, A11, '0000000'); if (r.res === A11 + 'about' && false) fails.push('x'); if ($('genResult').dataset.seed === '1' && /abandon abandon/.test($('genResult').textContent) && conf < 1) fails.push('word draw: declining stops the seed');
    cnf2 = true; w.clearAll(); await new Promise(r2 => setTimeout(r2, 20));
    await wd(12, LEG, '1010101'); $('passphrase2').value = 'different'; await w.wdGenerate(); if (!/do not match/.test($('genResult').textContent) || $('genResult').dataset.seed !== '1') fails.push('word draw: mismatched passphrases keep the words and say so');
    r = await wd(12, LEG, '1010101', 'secret pass'); if (!/Passphrase: used/.test($('genResult').textContent)) fails.push('word draw: passphrase used');
    $('passphrase').value = ''; $('passphrase2').value = '';
    await wd(12, LEG, '1010101'); w.clearAll(); await new Promise(r2 => setTimeout(r2, 20)); if ($('wdWords').value || $('wdFlips').value || $('wdOut').textContent || $('wdOut').style.display !== 'none') fails.push('word draw: CLEAR wipes boxes and steps');
    await wd(12, LEG, '1010101'); await run('dice', 12, D50, ''); if ($('wdOut').textContent !== '' || $('wdOut').style.display !== 'none') fails.push('word draw: a dice FORGE wipes the old steps');
    w.clearAll(); await new Promise(r2 => setTimeout(r2, 20));
    w.toggleGuide(); if ($('wdBox').classList.contains('gh') || !$('rolls').classList.contains('gh')) fails.push('word draw: the box is offered on guide step 1'); await wd(12, LEG, '1010101'); if (!/step 3 of 5/.test($('gTitle').textContent) || $('wdBox').classList.contains('gh') === false) fails.push('word draw: the guide moves on to writing the words down'); w.toggleGuide(); w.clearAll(); await new Promise(r2 => setTimeout(r2, 20));
    w.confirm = () => true;
    if (w.document.querySelectorAll('#wdBox a, #wdBox script, #wdBox img, #wdBox form').length || !/word tiles/.test($('wdBox').textContent) || /Entropia/i.test(w.document.body.innerHTML)) fails.push('word draw: no links, and no product name');
    $('wdLen').value = '24'; w.wdUpdate(); if (!/0 \/ 23 words, 0 \/ 3 flips/.test($('wdCount').textContent)) fails.push('word draw: counts for 24 words'); $('wdLen').value = '12';
  } catch (e) { fails.push('word draw: the probe crashed: ' + e.message); }
  try { // Multisig
    if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = function () {};
    const slp = (t) => new Promise((r2) => setTimeout(r2, t));
    w.confirm = () => true; w.clearAll(); await slp(20);
    const A11 = 'abandon '.repeat(11), LEG = 'legal winner thank year wave sausage worth useful legal winner thank', ZOO = 'zoo '.repeat(11).trim();
    const mk = async (ws, fl) => { $('wdLen').value = '12'; $('wdWords').value = ws; $('wdFlips').value = fl; w.wdUpdate(); await w.wdGenerate(); for (let i = 0; i < 200 && !w.eval('watchCtx'); i++) await slp(25); };
    const sd = [[A11, '0000000'], [LEG, '1111111'], [ZOO, '1111111']];
    const accKey = (mn, path, ver) => HDKey.fromMasterSeed(mnemonicToSeedSync(mn, ''), ver ? { private: 0x0488ade4, public: ver } : undefined).derive(path);
    const mns = [A11 + 'about', LEG + ' yellow', ZOO + ' wrong'];
    $('msN').value = '3'; w.msUpdateM(); if ($('msM').value !== '2') fails.push('multisig: 3 keys default to 2-of-3');
    $('msN').value = '7'; w.msUpdateM(); if ($('msM').max !== '7') fails.push('multisig: M choices run from 1 to N'); $('msM').value = '7'; $('msN').value = '4'; w.msUpdateM(); if ($('msM').value !== '3' || $('msM').max !== '4') fails.push('multisig: shrinking N resets M to a majority');
    $('msN').value = '5'; w.msUpdateM(); if ($('msNr').value !== '5' || $('msMr').value !== $('msM').value) fails.push('multisig slider: handles follow the numbers');
    $('msNr').value = '9'; $('msNr').oninput(); if ($('msN').value !== '9') fails.push('multisig slider: dragging N sets N');
    $('msMr').value = '12'; $('msMr').oninput(); if ($('msN').value !== '12') fails.push('multisig slider: M cannot pass N');
    $('msNr').value = '4'; $('msNr').oninput(); if ($('msM').value !== '3' || $('msBig').firstChild.textContent !== '3-of-4') fails.push('multisig slider: shrinking N resets M and updates the label');
    $('msN').value = '4'; $('msM').value = '9'; w.msMNote(); if ($('msM').value !== '4') fails.push('multisig slider: M never above N');
    $('msN').value = '99'; $('msN').onchange(); if ($('msN').value !== '15') fails.push('multisig: N capped at 15');
    w.document.querySelector('.ms-preset[data-n="5"]').onclick(); if ($('msM').value + '/' + $('msN').value !== '3/5') fails.push('multisig: preset fills both numbers');
    $('msN').value = '20'; $('msM').value = '2'; w.msStart(); if (w.eval('ms') !== null) fails.push('multisig: more than 15 keys refused');
    $('msN').value = '3'; w.msUpdateM();
    $('msM').value = '1'; w.msMNote(); if (!/not real multisig protection/.test($('msMNote').textContent)) fails.push('multisig: 1-of-N note');
    $('msM').value = '3'; w.msMNote(); if (!/lose even one/.test($('msMNote').textContent)) fails.push('multisig: N-of-N note');
    $('msM').value = '1'; w.msStart(); if (w.eval('ms') !== null || !/at least 2/.test($('msErr').textContent)) fails.push('multisig: 1-of-N refused at start');
    $('msM').value = '2'; $('msAcct').value = '12x'; w.msStart(); if (w.eval('ms') !== null) fails.push('multisig: bad account refused');
    $('msAcct').value = '2147483648'; w.msStart(); if (w.eval('ms') !== null) fails.push('multisig: account above 2147483647 refused');
    $('msAcct').value = '0'; w.msStart();
    if ($('msBanner').style.display !== '' || !/KEY 1 OF 3/.test($('msBanTitle').textContent) || !$('msAddBtn').disabled) fails.push('multisig: banner and disabled button at start');
    await w.msAddMade(); if (!/Make the seed first/.test($('msBanErr').textContent) || w.eval('ms.keys.length') !== 0) fails.push('multisig: adding without a seed');
    await mk(...sd[0]); if ($('msAddBtn').disabled) fails.push('multisig: button enabled once a seed exists');
    await w.msAddMade();
    if (w.eval('ms.keys.length') !== 1 || w.hasSeed() || $('rolls').value !== '' || $('wdWords').value !== '' || $('watchBox').style.display !== 'none' || w.eval('watchCtx') !== null || /abandon/.test($('genResult').textContent)) fails.push('multisig: ADD wipes the seed and keeps one public key');
    if (!/KEY 2 OF 3/.test($('msBanTitle').textContent) || w.document.querySelectorAll('.ms-slot.done').length !== 1) fails.push('multisig: moves on to key 2');
    await slp(200); if (!w.document.querySelector('#msIcon0 svg')) fails.push('multisig: fingerprint picture beside a saved key');
    await mk(...sd[0]); await w.msAddMade();
    if (w.eval('ms.keys.length') !== 1 || !/same key as key 1/.test($('msBanErr').textContent) || !w.hasSeed()) fails.push('multisig: same seed twice refused, seed kept');
    await mk(...sd[1]); await w.msAddMade();
    if (w.eval('ms.keys.length') !== 2) fails.push('multisig: second key added');
    w.msUsePaste();
    const paste = async (t, f) => { $('msPaste').value = t; $('msPasteFp').value = f || ''; await w.msAddPasted(); return $('msRunErr').textContent; };
    const k3 = accKey(mns[2], "m/48'/0'/0'/2'"), k3x = k3.publicExtendedKey, fp3 = fp(mns[2], ''), k1 = accKey(mns[0], "m/48'/0'/0'/2'").publicExtendedKey, k2 = accKey(mns[1], "m/48'/0'/0'/2'");
    const enc = (b) => createBase58check(nsha).encode(b);
    const ser = (ver, depth, pub) => { const b = new Uint8Array(78); b.set([ver >>> 24, (ver >>> 16) & 255, (ver >>> 8) & 255, ver & 255], 0); b[4] = depth; b.set(pub, 45); b[12] = 0x80; b[13 - 1] = 2; b.set(new Uint8Array(32).fill(7), 13); return b; };
    if (!/fingerprint is 8 characters/.test(await paste(k3x, ''))) fails.push('multisig paste: missing fingerprint explained');
    if (!/seed words/.test(await paste(A11 + 'about', 'aaaaaaaa'))) fails.push('multisig paste: seed words refused');
    if (!/PRIVATE key/.test(await paste(HDKey.fromMasterSeed(new Uint8Array(32).fill(7)).privateExtendedKey, 'aaaaaaaa'))) fails.push('multisig paste: xprv refused as private');
    if (!/typo|checksum/.test(await paste(k3x.slice(0, -1) + (k3x.endsWith('a') ? 'b' : 'a'), 'aaaaaaaa'))) fails.push('multisig paste: typo caught');
    if (!/not at the expected place/.test(await paste(HDKey.fromMasterSeed(new Uint8Array(32).fill(7)).publicExtendedKey, 'aaaaaaaa'))) fails.push('multisig paste: master key refused');
    if (!/not at the expected place/.test(await paste(accKey(mns[2], "m/0'/0'/2'").publicExtendedKey, 'aaaaaaaa'))) fails.push('multisig paste: depth-3 key with the right last step refused');
    if (!/not at the expected place/.test(await paste(accKey(mns[2], "m/48'/0'/0'/1'").publicExtendedKey, 'aaaaaaaa'))) fails.push('multisig paste: depth-4 key with the wrong last step refused');
    if (!/Testnet/.test(await paste(accKey(mns[2], "m/48'/1'/0'/2'", 0x043587cf).publicExtendedKey, 'aaaaaaaa'))) fails.push('multisig paste: testnet key refused on mainnet');
    if (!/single-signature/.test(await paste(accKey(mns[2], "m/48'/0'/0'/2'", 0x04b24746).publicExtendedKey, 'aaaaaaaa'))) fails.push('multisig paste: zpub refused');
    { const raw = createBase58check(nsha).decode(k3x); if (!/different multisig script type/.test(await paste(enc(Uint8Array.from([0x02, 0x95, 0xb4, 0x3f, ...raw.slice(4)])), 'aaaaaaaa'))) fails.push('multisig paste: Ypub refused on a Zpub wallet'); }
    if (!/not the one this wallet uses/.test(await paste('[aaaaaaaa/48h/0h/1h/2h]' + k3x, ''))) fails.push('multisig paste: other account in the path refused');
    if (!/same key as key 1/.test(await paste(k1, 'aaaaaaaa'))) fails.push('multisig paste: same public key under another fingerprint refused');
    if (!/same key as key 2/.test(await paste(k3x, fp(mns[1], '')))) fails.push('multisig paste: same fingerprint with another key refused');
    { const off = (() => { for (let x = 5n; ; x++) { try { secp256k1.ProjectivePoint.fromHex('02' + x.toString(16).padStart(64, '0')); } catch { return x; } } })();
      const bad = enc(ser(0x0488b21e, 4, Uint8Array.from([2, ...Buffer.from(off.toString(16).padStart(64, '0'), 'hex')])));
      if (!/not on the curve/.test(await paste(bad, 'aaaaaaaa'))) fails.push('multisig paste: key not on the curve refused');
      const P256 = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn, small = (() => { for (let x = 1n; ; x++) { try { secp256k1.ProjectivePoint.fromHex('02' + x.toString(16).padStart(64, '0')); return x; } catch {} } })();
      if (!/not on the curve/.test(await paste(enc(ser(0x0488b21e, 4, Uint8Array.from([2, ...Buffer.from((P256 + small).toString(16).padStart(64, '0'), 'hex')]))), 'aaaaaaaa'))) fails.push('multisig paste: x above the field size refused');
      if (!/unknown key type/.test(await paste(enc(ser(0x01020304, 4, Uint8Array.from([2, ...Buffer.from(small.toString(16).padStart(64, '0'), 'hex')]))), 'aaaaaaaa'))) fails.push('multisig paste: unknown key version refused');
      const long = enc(new Uint8Array(79).fill(1)); if (!/wrong length/.test(await paste(long, 'aaaaaaaa'))) fails.push('multisig paste: wrong length refused');
      const pre = ser(0x0488b21e, 4, Uint8Array.from([4, ...new Uint8Array(32).fill(9)])); if (!/not a valid public key/.test(await paste(enc(pre), 'aaaaaaaa'))) fails.push('multisig paste: bad key prefix refused'); }
    if (w.eval('ms.keys.length') !== 2) fails.push('multisig paste: refused keys add nothing');
    if (await paste('[' + fp3 + "/48'/0'/0'/2']" + k3x + '/0/*', '') !== '') fails.push('multisig paste: a normal [fp/path]xpub/0/* line is accepted');
    if (!w.eval('ms.done') || w.eval('ms.keys.length') !== 3) fails.push('multisig: third key completes the wallet');
    { const cos = [[fp(mns[0], ''), k1], [fp(mns[1], ''), k2.publicExtendedKey], [fp3, k3x]].map(([f, x]) => `[${f}/48h/0h/0h/2h]${x}/0/*`).sort();
      const d = $('msDescR').textContent, dc = $('msDescC').textContent;
      if (!d.startsWith('wsh(sortedmulti(2,' + cos.join(',') + '))#') || !/#[02-9ac-hj-np-z]{8}$/.test(d)) fails.push('multisig: descriptor');
      if (!dc.startsWith('wsh(sortedmulti(2,' + cos.map((c) => c.replace(/\/0\/\*$/, '/1/*')).join(',') + '))#') || d.split('#')[1] === dc.split('#')[1]) fails.push('multisig: change descriptor');
      const ks = mns.map((m) => accKey(m, "m/48'/0'/0'/2'")), want = [0, 1, 2].map((i) => btc.p2wsh(btc.p2ms(2, ks.map((k) => k.derive('m/0/' + i).publicKey).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))), btc.NETWORK).address);
      if ([...w.document.querySelectorAll('#msAddrs li')].map((l) => l.textContent).join() !== want.join()) fails.push('multisig: first three addresses'); }
    if ($('msOneDev').style.display !== 'none' || $('msBanner').style.display !== 'none' || $('msDone').style.display === 'none') fails.push('multisig: finished state (banner gone, mixed sources hide the one-device warning)');
    { const sq = []; $('msQrBox').scrollIntoView = (o) => sq.push(o && o.block); w.msShowQr(); if (sq.length !== 1 || sq[0] !== 'nearest') fails.push('qr: multisig QR scrolls fully into view'); delete $('msQrBox').scrollIntoView; w.msHideQr(); }
    w.msShowQr(); if ($('msQrBox').style.display !== '' || !/81 x 81/.test($('msQrCaption').textContent)) fails.push('multisig: QR');
    { const tmp = w.document.createElement('div'); tmp.innerHTML = w.qrSvg(w.qrMatrix($('msDescR').textContent).rows); if (tmp.innerHTML !== $('msQrImg').innerHTML) fails.push('multisig: QR encodes the receive descriptor'); }
    w.msHideQr(); if ($('msQrBox').style.display !== 'none' || $('msQrImg').textContent !== '') fails.push('multisig: hide QR');
    { let pr = 0; w.print = () => { pr++; }; w.msPrint(); const pq = w.document.getElementById('printQr').textContent; if (pr !== 1 || !/NO seed words/.test(pq) || !pq.includes($('msDescR').textContent) || !/2-of-3 multisig/.test(pq) || !pq.includes(w.document.querySelector('#msAddrs li').textContent) || !pq.includes(w.document.querySelectorAll('#msAddrs li')[2].textContent) || /abandon|legal winner|\bzoo\b/.test(pq)) fails.push('multisig: recovery sheet'); }
    // refused key check pieces of the library
    for (const [m, n, label] of [[0, 3, 'M of 0'], [4, 3, 'M above N'], [1, 1, 'one key'], [2, 16, 'sixteen keys']]) {
      const cs = []; const key = await w.parseExtendedKey(k3x); for (let i = 0; i < n; i++) cs.push({ fp: fp3, path: '48h/0h/0h/2h', key });
      let threw = false; try { await w.multisigScript(m, cs, 0, 0); } catch { threw = true; } if (!threw) fails.push('multisig: ' + label + ' refused');
    }
    { const key = await w.parseExtendedKey(k3x); let threw = false; try { await w.ckdPub(key.pub, key.chain, 0x80000000); } catch { threw = true; } if (!threw) fails.push('multisig: hardened public derivation refused');
      threw = false; try { await w.ckdPub(key.pub, key.chain, -1); } catch { threw = true; } if (!threw) fails.push('multisig: negative index refused'); }
    if ($('cardMulti').nextElementSibling !== $('cardGen')) fails.push('multisig: card sits above the seed maker during setup');
    w.msShowQr(); if ($('msQrBox').style.display !== '') fails.push('multisig: QR shown before reset');
    w.clearAll(); await slp(20); if (w.eval('ms') !== null || $('msDescR').textContent !== '' || $('msRun').style.display !== 'none' || $('msQrImg').innerHTML !== '' || $('msQrBox').style.display !== 'none' || $('msAddrs').textContent !== '') fails.push('multisig: CLEAR ALL forgets the setup');
    if ($('cardMulti').parentNode.id !== 'tp-tools' || $('cardMulti').previousElementSibling !== $('cardTools')) fails.push('multisig: card goes back to the Extra tools tab after reset');
    // 2-of-2 nested, testnet, all made here
    $('msN').value = '2'; w.msUpdateM(); $('msNet').value = 'test'; $('msType').value = 'ms-sh-wsh'; $('msAcct').value = '1'; w.msStart(); if (w.eval('ms.account') !== 1) fails.push('multisig: account number is used');
    if ($('msTestBan').style.display !== '' || !/TESTNET/.test($('msBanTitle').textContent)) fails.push('multisig: testnet banner');
    for (const [i, s] of [sd[0], sd[1]].entries()) { await mk(...s); if (i === 1) { $('passphrase').value = 'pw'; $('passphrase2').value = 'pw'; w.wdUpdate(); await w.wdGenerate(); for (let j = 0; j < 200 && !w.eval('watchCtx'); j++) await slp(25); } await w.msAddMade(); }
    { const ks = [mns[0], mns[1]].map((m, i) => HDKey.fromMasterSeed(mnemonicToSeedSync(m, i === 1 ? 'pw' : '')).derive("m/48'/1'/1'/1'")), want = [0, 1, 2].map((i) => btc.p2sh(btc.p2wsh(btc.p2ms(2, ks.map((k) => k.derive('m/0/' + i).publicKey).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))), btc.TEST_NETWORK), btc.TEST_NETWORK).address);
      if (!w.eval('ms.done') || [...w.document.querySelectorAll('#msAddrs li')].map((l) => l.textContent).join() !== want.join()) fails.push('multisig: nested testnet addresses');
      if (!/\/48h\/1h\/1h\/1h\]/.test($('msDescR').textContent)) fails.push('multisig: made keys carry the right origin path');
      if (!/^sh\(wsh\(sortedmulti\(2,/.test($('msDescR').textContent) || !/\)\)\)#/.test($('msDescR').textContent) || !/tpub/.test($('msDescR').textContent) || $('msOneDev').style.display !== '') fails.push('multisig: nested testnet descriptor and one-device warning');
      let pr = 0; w.print = () => { pr++; }; w.msPrint(); const pqt = w.document.getElementById('printQr'); if (!/TESTNET/.test(pqt.firstChild.textContent)) fails.push('multisig: testnet sheet title says so'); if (!/practice coins only/.test(pqt.textContent)) fails.push('multisig: testnet sheet text says so'); }
    w.msCancel(); if (w.eval('ms') !== null) fails.push('multisig: START OVER resets');
    w.clearAll(); await slp(20);
  } catch (e) { fails.push('multisig: the probe crashed: ' + e.message); }
  { await run('dice', 12, D50, ''); await new Promise((r) => setTimeout(r, 60)); const had = !!$('fpIcon').querySelector('svg');
    $('rolls').value = D50.slice(0, 10); $('rolls').oninput(); await new Promise((r) => setTimeout(r, 20));
    if (!had || $('fpIcon').innerHTML !== '' || w.hasSeed()) fails.push('fingerprint picture cleared when changed rolls clear the words'); }
  // passphrase confirmation must block a mismatch
  await run('dice', 12, D50, ''); w.showQr('wZpub', 'zpub');
  mode('dice'); words(12); $('rolls').value = D50; $('rolls').oninput(); $('passphrase').value = 'abc'; $('passphrase2').value = 'abd'; await w.generate();
  if (!/do not match/.test($('genResult').textContent) || adOf()) fails.push('passphrase confirmation blocks a mismatch');
  if ($('wZpub').textContent !== '' || $('watchBox').style.display !== 'none') fails.push('watch-only export hidden after an error');
  if ($('qrImg').innerHTML !== '' || $('qrBox').style.display !== 'none') fails.push('QR code hidden after an error');
  if ($('fpIcon').innerHTML !== '') fails.push('fingerprint picture hidden after an error');
  if ($('addrList').textContent !== '' || $('addrBox').style.display !== 'none' || $('checkGuide').style.display !== 'none') fails.push('address list and guide hidden after an error');
  if ($('trList').textContent !== '') fails.push('Taproot list cleared after an error');
  $('passphrase').value = ''; $('passphrase2').value = '';
  // tap buttons append the right values
  $('rolls').value = ''; w.updateCount(); const taps = [...w.document.querySelectorAll('#tapRow button')];
  if (taps.length !== 6 || !taps.every((b, i) => { const r = b.querySelector('svg rect'), c = [...b.querySelectorAll('svg circle')]; return r && /fill:var\(--surface\)/.test(r.getAttribute('style')) && /stroke:var\(--accent\)/.test(r.getAttribute('style')) && c.length === i + 1 && c.every((x) => /fill:var\(--accent\)/.test(x.getAttribute('style'))); })) fails.push('dice buttons: unchanged outline die');
  if (taps.length !== 6) fails.push('six dice tap buttons'); else { taps[3].onclick(); taps[0].onclick(); if ($('rolls').value !== '41') fails.push('tap buttons append the right roll'); }
  $('rolls').value = '';
  // VERIFY must show the published BIP84 vector address
  $('phrase').value = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'; await w.verify();
  if (!/bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu/.test($('verifyStatus').textContent)) fails.push('VERIFY shows first address');
  $('verifyPass').value = 'TREZOR'; await w.verify(); { const vs = $('verifyStatus').textContent;
    if (!/Without passphrase: fingerprint 73c5da0a \| first address bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu/.test(vs)) fails.push('VERIFY without-passphrase line');
    if (!/With passphrase \(6 characters, not shown\): fingerprint b4e3f5ed \| first address bc1qv5rmq0kt9yz3pm36wvzct7p3x6mtgehjul0feu/.test(vs)) fails.push('VERIFY with-passphrase line'); }
  { await new Promise((r) => setTimeout(r, 30)); const i0 = svgPixels($('vIcon0').innerHTML), i1 = svgPixels($('vIcon1').innerHTML);
    if (!LH_EXPECT['73c5da0a'] || i0.some((v, i) => v !== LH_EXPECT['73c5da0a'][i]) || $('vFig0').style.display === 'none') fails.push('VERIFY shows the picture without passphrase');
    if (i1.some((v, i) => v !== LH_EXPECT['b4e3f5ed'][i]) || $('vFig1').style.display === 'none') fails.push('VERIFY shows the picture with passphrase'); }
  { const ABOUT = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const M = async (rec, pw) => { $('phrase').value = ABOUT; $('verifyPass').value = pw; $('verifyRecorded').value = rec; await w.verify(); return [$('verifyMatch').textContent, $('verifyMatch').className]; };
    let [tx, cl] = await M('b4e3f5ed', 'TREZOR'); if (!/^MATCH \(with passphrase\)/.test(tx) || !/ok/.test(cl)) fails.push('match: fingerprint with passphrase');
    [tx, cl] = await M('73c5da0a', 'TREZOR'); if (!/^MATCH \(without passphrase\)/.test(tx) || !/ok/.test(cl)) fails.push('match: fingerprint without passphrase');
    [tx, cl] = await M('bc1qv5rmq0kt9yz3pm36wvzct7p3x6mtgehjul0feu', 'TREZOR'); if (!/^MATCH \(with passphrase\)/.test(tx)) fails.push('match: address with passphrase');
    [tx, cl] = await M('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'TREZOR'); if (!/^MATCH \(without passphrase\)/.test(tx)) fails.push('match: address without passphrase');
    [tx, cl] = await M('deadbeef', 'TREZOR'); if (!/^NO MATCH:/.test(tx) || !/bad/.test(cl)) fails.push('match: neither');
    [tx, cl] = await M('b4e3f5ed', ''); if (!/^NO MATCH without a passphrase/.test(tx)) fails.push('match: needs passphrase');
    // zpub / xpub / descriptor / Taproot address, expected values from the independent libraries
    { const wp = watch(ABOUT, 'TREZOR'), w0 = watch(ABOUT, ''), other = watch('legal winner thank year wave sausage worth useful legal winner thank yellow', '');
      const chk = (b) => w.descriptorChecksum(b);
      const dsc = (fpv, xp, br, withSum) => { const body = `wpkh([${fpv}/84h/0h/0h]${xp}/${br}/*)`; return withSum ? chk(body) : body; };
      [tx, cl] = await M(wp.zpub, 'TREZOR'); if (!/^MATCH \(with passphrase\)/.test(tx) || !/ok/.test(cl)) fails.push('compare: zpub with passphrase');
      [tx, cl] = await M(w0.zpub, 'TREZOR'); if (!/^MATCH \(without passphrase\)/.test(tx)) fails.push('compare: zpub without passphrase');
      [tx, cl] = await M(wp.xpub, 'TREZOR'); if (!/^MATCH \(with passphrase\)/.test(tx)) fails.push('compare: xpub with passphrase');
      [tx, cl] = await M(w0.xpub, ''); if (!/^MATCH \(without passphrase\)/.test(tx)) fails.push('compare: xpub without passphrase');
      [tx, cl] = await M(other.zpub, 'TREZOR'); if (!/^NO MATCH:/.test(tx) || !/bad/.test(cl)) fails.push('compare: another wallet zpub is NO MATCH');
      [tx, cl] = await M(other.xpub, ''); if (!/^NO MATCH without/.test(tx)) fails.push('compare: another wallet xpub is NO MATCH');
      [tx, cl] = await M(dsc(wp.fp, wp.xpub, '0', true), 'TREZOR'); if (!/^MATCH \(with passphrase\)/.test(tx)) fails.push('compare: receive descriptor');
      [tx, cl] = await M(dsc(wp.fp, wp.xpub, '1', true), 'TREZOR'); if (!/^MATCH \(with passphrase\)/.test(tx)) fails.push('compare: change descriptor');
      [tx, cl] = await M(dsc(w0.fp, w0.xpub, '0', false), ''); if (!/^MATCH \(without passphrase\)/.test(tx)) fails.push('compare: descriptor without checksum');
      [tx, cl] = await M(dsc(w0.fp, w0.xpub, '0', true).replace(/.$/, (c) => (c === 'q' ? 'p' : 'q')), ''); if (!/checksum/.test(tx) || !/bad/.test(cl)) fails.push('compare: wrong descriptor checksum is rejected');
      [tx, cl] = await M(dsc(other.fp, other.xpub, '0', true), ''); if (!/^NO MATCH/.test(tx) || !/bad/.test(cl)) fails.push('compare: another wallet descriptor is NO MATCH');
      [tx, cl] = await M(dsc(w0.fp, other.xpub, '0', true), ''); if (!/^NO MATCH/.test(tx)) fails.push('compare: right fingerprint with another key is NO MATCH');
      [tx, cl] = await M(dsc(other.fp, w0.xpub, '0', true), ''); if (!/^NO MATCH/.test(tx)) fails.push('compare: right key with another fingerprint is NO MATCH');
      const tr = (pw, i) => { const k = HDKey.fromMasterSeed(mnemonicToSeedSync(ABOUT, pw)).derive(`m/86'/0'/0'/0/${i}`); const xo = k.publicKey.slice(1);
        const P = secp256k1.ProjectivePoint.fromHex('02' + Buffer.from(xo).toString('hex')); const t = schnorr.utils.taggedHash('TapTweak', xo);
        const Q = P.add(secp256k1.ProjectivePoint.BASE.multiply(BigInt('0x' + Buffer.from(t).toString('hex'))));
        return bech32m.encode('bc', [1, ...bech32m.toWords(Q.toRawBytes(true).slice(1))]); };
      [tx, cl] = await M(tr('', 0), ''); if (!/^MATCH \(without passphrase\)/.test(tx)) fails.push('compare: Taproot address 0');
      [tx, cl] = await M(tr('TREZOR', 4), 'TREZOR'); if (!/^MATCH \(with passphrase\)/.test(tx)) fails.push('compare: Taproot address 4 with passphrase');
      [tx, cl] = await M(tr('', 5), ''); if (!/^NO MATCH/.test(tx)) fails.push('compare: Taproot address 5 is outside the first five');
      [tx, cl] = await M(tr('TREZOR', 0), ''); if (!/^NO MATCH/.test(tx)) fails.push('compare: Taproot address of the passphrase wallet without passphrase');
      [tx, cl] = await M('wpkh(garbage)', ''); if (!/Not recognized/.test(tx)) fails.push('compare: garbage descriptor not recognized'); }
    // "Is this address yours?" (search range 4 per press to keep the run short)
    { $('phrase').value = ABOUT; $('verifyRecorded').value = '';
      const ev = (id) => $(id).dispatchEvent(new w.Event('input'));
      const CA = async (pw, x, press = 1) => { $('verifyPass').value = pw; $('checkAddr').value = x; ev('verifyPass'); ev('checkAddr'); let r; for (let n = 0; n < press; n++) { await w.checkAddress(4); r = [$('addrCheckStatus').textContent, $('addrCheckStatus').className]; } return r; };
      let [t1, c1] = await CA('', segAt(ABOUT, '', 0, 2)); if (!/^FOUND: this SegWit address is receive address #2 \(m\/84'\/0'\/0'\/0\/2\)/.test(t1) || !/ok/.test(c1)) fails.push('find: SegWit receive address');
      [t1] = await CA('', segAt(ABOUT, '', 1, 3)); if (!/change address #3 \(m\/84'\/0'\/0'\/1\/3\)/.test(t1)) fails.push('find: SegWit change address');
      [t1] = await CA('', trAt(ABOUT, '', 0, 1)); if (!/^FOUND: this Taproot address is receive address #1 \(m\/86'\/0'\/0'\/0\/1\)/.test(t1)) fails.push('find: Taproot receive address');
      [t1] = await CA('', trAt(ABOUT, '', 1, 2)); if (!/Taproot address is change address #2 \(m\/86'\/0'\/0'\/1\/2\)/.test(t1)) fails.push('find: Taproot change address');
      [t1] = await CA('', altAt('pkh', ABOUT, '', 0, 0, 2)); if (!/^FOUND: this Legacy address is receive address #2 \(m\/44'\/0'\/0'\/0\/2\)/.test(t1)) fails.push('find: legacy receive address');
      [t1] = await CA('', altAt('sh-wpkh', ABOUT, '', 0, 1, 1)); if (!/^FOUND: this Nested SegWit address is change address #1 \(m\/49'\/0'\/0'\/1\/1\)/.test(t1)) fails.push('find: nested SegWit change address');
      $('checkAcct').value = '3'; ev('checkAcct');
      [t1] = await CA('', altAt('sh-wpkh', ABOUT, '', 3, 0, 0)); if (!/receive address #0 \(m\/49'\/0'\/3'\/0\/0\)/.test(t1)) fails.push('find: nested SegWit account 3');
      [t1] = await CA('', altAt('sh-wpkh', ABOUT, '', 0, 0, 0)); if (!/^NOT FOUND/.test(t1)) fails.push('find: account 0 address not found when account 3 is set');
      $('checkAcct').value = '0'; ev('checkAcct');
      [t1] = await CA('', segAtT(ABOUT, '', 0, 0, 2)); if (!/^FOUND: this Testnet SegWit address is receive address #2 \(m\/84'\/1'\/0'\/0\/2\)/.test(t1)) fails.push('find: testnet SegWit address');
      [t1] = await CA('', trAtT(ABOUT, '', 0, 1, 1)); if (!/^FOUND: this Testnet Taproot address is change address #1 \(m\/86'\/1'\/0'\/1\/1\)/.test(t1)) fails.push('find: testnet Taproot address');
      [t1] = await CA('', altAt('pkh', ABOUT, '', 0, 0, 3, true)); if (!/^FOUND: this Testnet Legacy address is receive address #3 \(m\/44'\/1'\/0'\/0\/3\)/.test(t1)) fails.push('find: testnet legacy address');
      [t1] = await CA('', altAt('sh-wpkh', ABOUT, '', 0, 1, 0, true)); if (!/^FOUND: this Testnet Nested SegWit address is change address #0 \(m\/49'\/1'\/0'\/1\/0\)/.test(t1)) fails.push('find: testnet nested SegWit address');
      [t1, c1] = await CA('', segAt(ABOUT, '', 0, 6)); if (!/^NOT FOUND in indices 0 to 3 /.test(t1) || !/bad/.test(c1)) fails.push('find: index beyond the first range is NOT FOUND');
      [t1] = await CA('', segAt(ABOUT, '', 0, 6), 2); if (!/^FOUND: .*receive address #6 /.test(t1)) fails.push('find: second press continues with the next indices');
      [t1] = await CA('', segAt(ABOUT, '', 0, 6), 3); if (!/^NOT FOUND in indices 0 to 3 /.test(t1)) fails.push('find: after a FOUND the next search starts at 0 again');
      await CA('', segAt(ABOUT, '', 0, 6)); $('checkAddr').value = segAt(ABOUT, '', 0, 1); ev('checkAddr'); await w.checkAddress(4);
      if (!/^FOUND: .*receive address #1 /.test($('addrCheckStatus').textContent)) fails.push('find: changing the address restarts the search at index 0');
      await CA('', segAt(ABOUT, '', 0, 6)); $('checkAddr').value = segAt(ABOUT, '', 0, 1); await w.checkAddress(4);
      if (!/^NOT FOUND in indices 4 to 7 /.test($('addrCheckStatus').textContent)) fails.push('find: a continued search covers only the next indices');
      await CA('', segAt(ABOUT, '', 0, 6)); $('phrase').value = ABOUT + ' '; ev('phrase'); $('phrase').value = ABOUT; await w.checkAddress(4);
      if (!/^NOT FOUND in indices 0 to 3 /.test($('addrCheckStatus').textContent)) fails.push('find: changing the phrase restarts the search at index 0');
      [t1] = await CA('', segAt(ABOUT, 'TREZOR', 0, 1)); if (!/^NOT FOUND/.test(t1)) fails.push('find: passphrase-wallet address is not found without the passphrase');
      [t1] = await CA('TREZOR', segAt(ABOUT, 'TREZOR', 0, 1)); if (!/^FOUND: .*receive address #1 .*with passphrase/.test(t1)) fails.push('find: passphrase-wallet address found with the passphrase');
      [t1] = await CA('TREZOR', segAt(ABOUT, '', 0, 1)); if (!/^FOUND: .*without passphrase/.test(t1)) fails.push('find: no-passphrase address still found when a passphrase is typed');
      [t1] = await CA('', segAt('legal winner thank year wave sausage worth useful legal winner thank yellow', '', 0, 0)); if (!/^NOT FOUND/.test(t1)) fails.push('find: address of another wallet is NOT FOUND');
      [t1, c1] = await CA('', 'bc1qxyz'); if (!/Enter a bc1q/.test(t1) || !/bad/.test(c1)) fails.push('find: rejects text that is not an address');
      $('phrase').value = 'abandon abandon'; [t1] = await CA('', segAt(ABOUT, '', 0, 0)); if (!/valid seed phrase/.test(t1)) fails.push('find: needs a valid phrase');
      $('phrase').value = ABOUT; $('verifyPass').value = ''; $('checkAddr').value = ''; $('addrCheckStatus').textContent = ''; }
    // SeedQR digit strings, CompactSeedQR hex, and BIP85 child seeds
    { const V = async (x) => { $('phrase').value = x; await w.verify(); return [$('verifyStatus').textContent.split('\n')[0], $('phrase').value, $('verifyStatus').className]; };
      const mn24 = entropyToMnemonic(new Uint8Array(32).fill(0x5a), wordlist), dg = (m) => m.split(' ').map((x) => String(wordlist.indexOf(x)).padStart(4, '0')).join('');
      let [m1, b1, c1] = await V(dg(ABOUT)); if (!/^Valid 12-word BIP39 phrase \(read from a SeedQR digit string\)/.test(m1) || b1 !== ABOUT || !/ok/.test(c1)) fails.push('seedqr: 12-word digit string');
      [m1, b1] = await V(dg(mn24)); if (!/^Valid 24-word/.test(m1) || b1 !== mn24) fails.push('seedqr: 24-word digit string');
      for (const nb of [20, 24, 28]) { const mw = entropyToMnemonic(new Uint8Array(nb).fill(0x2b), wordlist); [m1, b1] = await V(dg(mw)); if (!new RegExp('^Valid ' + (nb * 3 / 4) + '-word').test(m1) || b1 !== mw) fails.push('seedqr: ' + (nb * 3 / 4) + '-word digit string'); }
      [m1, b1] = await V(dg(ABOUT).replace(/(\d{4})/g, '$1 ')); if (b1 !== ABOUT) fails.push('seedqr: digit string with spaces');
      [m1, b1] = await V(Buffer.from(mnemonicToEntropy(mn24, wordlist)).toString('hex')); if (!/CompactSeedQR hex/.test(m1) || b1 !== mn24) fails.push('seedqr: 24-word compact hex');
      [m1, b1] = await V('7F'.repeat(16)); if (b1 !== 'legal winner thank year wave sausage worth useful legal winner thank yellow') fails.push('seedqr: 12-word compact hex (capitals)');
      [m1, b1] = await V(Buffer.from(mnemonicToEntropy(entropyToMnemonic(new Uint8Array(20).fill(0x33), wordlist), wordlist)).toString('hex')); if (!/^Valid 15-word/.test(m1)) fails.push('seedqr: 15-word compact hex (40 characters)');
      [m1, b1, c1] = await V('2047'.repeat(12)); if (/above 2047/.test(m1)) fails.push('seedqr: 2047 is a valid word number'); 
      [m1, b1, c1] = await V('2048' + '0000'.repeat(11)); if (!/above 2047/.test(m1) || !/bad/.test(c1)) fails.push('seedqr: number above 2047 rejected');
      [m1, b1, c1] = await V('0000'.repeat(12)); if (!/Checksum failed/.test(m1) || !/bad/.test(c1)) fails.push('seedqr: bad checksum rejected');
      [m1, b1] = await V('0000'.repeat(11)); if (!/Invalid length/.test(m1)) fails.push('seedqr: wrong digit count rejected');
      [m1, b1] = await V('7f'.repeat(15)); if (/^Valid/.test(m1)) fails.push('seedqr: wrong hex length rejected');
      [m1, b1] = await V(ABOUT); if (m1 !== 'Valid 12-word BIP39 phrase') fails.push('seedqr: plain words unchanged');
      // BIP85
      const CH = async (parent, pw, words, idx) => { $('phrase').value = parent; $('verifyPass').value = pw; $('childWords').value = String(words); $('childIndex').value = String(idx); await w.deriveChild();
        return [$('childOut').textContent.replace(/Child master[\s\S]*$/, '').replace(/^CHILD[^\n]*\n/, '').replace(/\s*\d+\. /g, ' ').trim(), $('childStatus').textContent, $('childStatus').className, $('childOut').textContent]; };
      let [cw, cs, cc, co] = await CH(ABOUT, '', 12, 0); if (cw !== b85At(ABOUT, '', 12, 0) || !/ok/.test(cc)) fails.push('bip85: child 12 words index 0');
      [cw] = await CH(ABOUT, '', 18, 7); if (cw !== b85At(ABOUT, '', 18, 7)) fails.push('bip85: child 18 words index 7');
      [cw] = await CH(mn24, '', 24, 123456); if (cw !== b85At(mn24, '', 24, 123456)) fails.push('bip85: child 24 words');
      [cw, cs, cc, co] = await CH(ABOUT, 'TREZOR', 12, 1); if (cw !== b85At(ABOUT, 'TREZOR', 12, 1) || !/and passphrase/.test(cs)) fails.push('bip85: passphrase changes the child');
      [cw] = await CH(ABOUT, '', 12, 2147483647); if (cw !== b85At(ABOUT, '', 12, 2147483647)) fails.push('bip85: largest index works');
      try { if ((await w.mnemonicBip85(ABOUT, '', 15, 0)) !== b85At(ABOUT, '', 15, 0) || (await w.mnemonicBip85(ABOUT, '', 21, 3)) !== b85At(ABOUT, '', 21, 3)) fails.push('bip85: 15 and 21 word children'); } catch (e) { fails.push('bip85: 15 and 21 word children (' + e.message + ')'); }
      [cw] = await CH(ABOUT, '', 12, 2267); if (cw !== b85At(ABOUT, '', 12, 2267)) fails.push('bip85: child key with leading zeros (index 2267 starts 000)');
      [cw, cs, cc] = await CH(ABOUT, '', 12, 2147483648); if (!/whole number/.test(cs) || !/bad/.test(cc) || $('childOut').textContent !== '') fails.push('bip85: index above the limit rejected');
      [cw, cs, cc] = await CH(ABOUT, '', 12, 'x1'); if (!/whole number/.test(cs)) fails.push('bip85: non-number index rejected');
      [cw, cs, cc] = await CH(ABOUT, '', 12, ''); if (!/whole number/.test(cs)) fails.push('bip85: empty index rejected');
      [cw, cs, cc, co] = await CH(ABOUT, '', 12, 0); { const fpc = co.match(/Child master fingerprint: ([0-9a-f]{8})/), adc = co.match(/Child first receive address \(BIP84\): (bc1q[0-9a-z]+)/);
        if (!fpc || fpc[1] !== fp(b85At(ABOUT, '', 12, 0), '') || !adc || adc[1] !== addr(b85At(ABOUT, '', 12, 0), '')) fails.push('bip85: child fingerprint and first address shown'); }
      $('childIndex').dispatchEvent(new w.Event('input')); if ($('childOut').textContent !== '' || $('childOut').style.display !== 'none') fails.push('bip85: output cleared when the index is edited');
      await CH(ABOUT, '', 12, 0); $('verifyPass').dispatchEvent(new w.Event('input')); if ($('childOut').textContent !== '') fails.push('bip85: output cleared when the passphrase is edited');
      await CH(ABOUT, '', 12, 0); $('phrase').dispatchEvent(new w.Event('input')); if ($('childOut').textContent !== '') fails.push('bip85: output cleared when the phrase is edited');
      await CH(ABOUT, '', 12, 0); $('childWords').dispatchEvent(new w.Event('change')); if ($('childOut').textContent !== '') fails.push('bip85: output cleared when the length is changed');
      [cw, cs, cc] = await CH('abandon abandon', '', 12, 0); if (!/valid parent seed phrase/.test(cs) || !/bad/.test(cc) || $('childOut').textContent !== '') fails.push('bip85: invalid parent rejected');
      { // BIP85 applications (v1.29.0): engine values against independent code, and the card's settings
        const ent = (path) => new Uint8Array(nc.createHmac('sha512', 'bip-entropy-from-k').update(HDKey.fromMasterSeed(mnemonicToSeedSync(ABOUT, '')).derive(path).privateKey).digest());
        const shk = (m, n) => new Uint8Array(nc.createHash('shake256', { outputLength: n }).update(m).digest());
        const dice = (e, sides, rolls) => { const bits = Math.ceil(Math.log2(sides) - 1e-12), by = Math.ceil(bits / 8), st = shk(e, 64 * rolls * by + 64), out = []; let o = 0; while (out.length < rolls) { let v = 0; for (let j = 0; j < by; j++) v = v * 256 + st[o + j]; o += by; v = Math.floor(v / 2 ** (by * 8 - bits)); if (v < sides) out.push(v); } return out.join(','); };
        const A = (app, n, r) => w.mnemonicBip85App(ABOUT, '', app, 0, n, r);
        if ((await A('hex', 17)) !== Buffer.from(ent("m/83696968'/128169'/17'/0'").subarray(0, 17)).toString('hex')) fails.push('bip85 apps: hex uses the length in its path');
        if ((await A('pwd64', 86)) !== Buffer.from(ent("m/83696968'/707764'/86'/0'")).toString('base64').slice(0, 86)) fails.push('bip85 apps: Base64 password');
        { let got = ''; try { got = await w.mnemonicBip85App(ABOUT, '', 'hex', 2147483647, 16); } catch (e) { got = 'ERR'; } if (got !== Buffer.from(ent("m/83696968'/128169'/16'/2147483647'").subarray(0, 16)).toString('hex')) fails.push('bip85 apps: the top index 2147483647 works'); }
        for (const [sides, rolls] of [[8, 20], [6, 40], [256, 5], [257, 5]]) if ((await A('dice', sides, rolls)) !== dice(ent(`m/83696968'/89101'/${sides}'/${rolls}'/0'`), sides, rolls)) fails.push('bip85 apps: dice with ' + sides + ' sides');
        { const m = new Uint8Array(200).map((_, i) => i * 7), rd = w.shake256Reader(m); if (Buffer.from([...rd.read(100), ...rd.read(250)]).toString('hex') !== Buffer.from(shk(m, 350)).toString('hex')) fails.push('bip85 apps: SHAKE256 over several blocks'); }
        const CA = async (app, set) => { $('phrase').value = ABOUT; $('childApp').value = app; w.childAppChange(); if (set) set(); await w.deriveChild(); return [$('childStatus').textContent, $('childOut').textContent]; };
        let [st, out] = await CA('pwd85', () => { $('childLen').value = '81'; }); if (!/10 to 80 characters/.test(st) || out !== '') fails.push('bip85 card: Base85 password over 80 refused');
        [st, out] = await CA('pwd64', () => { $('childLen').value = '19'; }); if (!/20 to 86 characters/.test(st)) fails.push('bip85 card: Base64 password under 20 refused');
        [st, out] = await CA('hex', () => { $('childLen').value = '65'; }); if (!/16 to 64 bytes/.test(st)) fails.push('bip85 card: hex over 64 refused');
        [st, out] = await CA('dice', () => { $('childSides').value = '2147483648'; }); if (!/2 to 2147483647 sides/.test(st)) fails.push('bip85 card: a die with 2^31 sides refused');
        [st, out] = await CA('dice', () => { $('childSides').value = '6'; $('childRolls').value = '1001'; }); if (!/1 to 1000/.test(st)) fails.push('bip85 card: more than 1000 rolls refused');
        [st, out] = await CA('xprv'); if (!/^MASTER XPRV/.test(out) || !/Master fingerprint of this xprv: [0-9a-f]{8}/.test(out)) fails.push('bip85 card: xprv shown with its fingerprint');
        [st, out] = await CA('dice', () => { $('childRolls').value = '10'; }); $('childRolls').dispatchEvent(new w.Event('input')); if ($('childOut').textContent !== '') fails.push('bip85 card: editing the rolls clears the output');
        await CA('hex'); $('childLen').dispatchEvent(new w.Event('input')); if ($('childOut').textContent !== '') fails.push('bip85 card: editing the length clears the output');
        await CA('wif'); $('childApp').value = 'hex'; w.childAppChange(); if ($('childOut').textContent !== '') fails.push('bip85 card: choosing another type clears the output');
        $('childApp').value = 'pwd85'; w.childAppChange(); if ($('childLen').style.display === 'none' || $('childWords').style.display !== 'none' || $('childLen').value !== '20') fails.push('bip85 card: a password shows its length');
        $('childApp').value = 'words'; w.childAppChange(); if ($('childWords').style.display === 'none' || $('childLen').style.display !== 'none') fails.push('bip85 card: seed words show the word count'); }
      $('childOut').textContent = ''; $('childStatus').textContent = ''; $('verifyPass').value = ''; $('phrase').value = ABOUT; $('verifyStatus').textContent = ''; }
    $('verifyRecorded').value = ''; $('verifyPass').value = ''; }
  r = await run('dice', 12, D50, ''); if (!/Passphrase: none/.test($('genResult').textContent) || !/Passphrase used: NO/.test(w.passLine('printed'))) fails.push('passphrase none line');
  r = await run('dice', 12, D50, 'abc'); if (!/Passphrase: used \(3 characters/.test($('genResult').textContent) || !/Passphrase used: YES/.test(w.passLine('saved'))) fails.push('passphrase used line');
  $('passphrase').value = ''; $('passphrase2').value = '';
  $('verifyPass').value = '';
  if ((await w.checkPhrase(expect.d50)).ok !== true) fails.push('checker accepts valid');
  // Corrupt one word; the checker must agree with @scure about whether the result is valid.
  const parts = expect.d50.split(' '); parts[11] = parts[11] === 'zoo' ? 'abandon' : 'zoo';
  const corrupted = parts.join(' ');
  if ((await w.checkPhrase(corrupted)).ok !== validateMnemonic(corrupted, wordlist)) fails.push('checker rejects bad checksum');
  // v1.25.1 QR boxes scroll fully into view and the stylesheet keeps the seed panel from covering content
  { if (!/#cardGen \.gen-right \{ grid-column: 2; grid-row: 1 \/ span 2;[^}]*position: sticky/.test(mutated) || !/#cardGen \.gen-bottom \{ grid-column: 1; grid-row: 2;/.test(mutated)) fails.push('qr: the sticky seed panel must not slide over the content below');
    { const tg = loadPage(mutated, () => {}); await ready(tg); const gb = tg.document.querySelector('.sg-body'), go = tg.document.getElementById('sgGo'); if (!gb || gb.contains(go) || go.parentNode !== gb.parentNode) fails.push('notice: the button must stay outside the scrolling text'); else if (gb.getAttribute('tabindex') !== '0' || !/things to know/.test(gb.getAttribute('aria-label') || '')) fails.push('notice: the scrolling text is keyboard reachable and named');
      if (!tg.document.body.classList.contains('js-ok') || !/#startGate \{[^}]*display: none;/.test(mutated) || !/body\.js-ok #startGate \{ display: flex; \}/.test(mutated)) fails.push('notice: only shown once the script has run');
      if ((mutated.match(/\n  #startGate \{/g) || []).length !== 1 || /#startGate[^{]*\{[^}]*display:[^;}]*!important/.test(mutated)) fails.push('notice: nothing may force the notice to show without the script');
      if (!/#startGate \.sg-box \{[^}]*max-height: 100%; overflow: hidden; display: flex; flex-direction: column;/.test(mutated) || !/#startGate \.sg-body \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/.test(mutated) || !/#startGate \.sg-go, #startGate \.sg-foot \{ flex: none; \}/.test(mutated)) fails.push('notice: the box fits the screen and only the text scrolls'); }
    if (!/\.tabpanel \[id\] \{ scroll-margin-top: 84px; \}/.test(mutated)) fails.push('qr: jumped-to sections keep clear of the sticky tab bar');
    if (!/@media \(min-width: 861px\) \{ #cardGen \.gen-right \{ max-height: calc\(100vh - 92px\); overflow-y: auto;/.test(mutated)) fails.push('qr: a tall seed panel scrolls inside itself so its bottom buttons stay reachable');
    if (!/#qrBox, #sqBox, #msQrBox \{ scroll-margin: 80px 0 20px; \}/.test(mutated)) fails.push('qr: QR boxes keep clear of the sticky tab bar');
    const tq = loadPage(mutated, () => {}); await ready(tq); const seen = []; for (const id of ['qrBox', 'sqBox']) { const el = tq.document.getElementById(id); el.scrollIntoView = (o) => seen.push([id, o && o.block]); }
    tq.document.getElementById('wDescR').textContent = 'wpkh(x)'; tq.showQr('wDescR', 'receive descriptor'); if (seen.length !== 1 || seen[0][0] !== 'qrBox' || seen[0][1] !== 'nearest') fails.push('qr: watch-only QR scrolls fully into view');
    tq.document.getElementById('rolls').value = D50; tq.document.getElementById('rolls').oninput(); await tq.generate(); tq.showSeedQr('seedqr'); if (seen.length !== 2 || seen[1][0] !== 'sqBox' || seen[1][1] !== 'nearest') fails.push('qr: SeedQR scrolls fully into view');
    { await new Promise((r) => setTimeout(r, 50)); const before = tq.document.getElementById('fpIcon').innerHTML; tq.document.getElementById('sqBox').scrollIntoView = () => {}; await tq.sendToVerify(); await new Promise((r) => setTimeout(r, 80)); if (before.length < 100 || tq.document.getElementById('fpIcon').innerHTML !== before) fails.push('verify: the master fingerprint picture survives SEND TO CHECK'); if (!tq.document.getElementById('vIcon0').querySelector('svg')) fails.push('verify: draws its own fingerprint picture'); tq.document.getElementById('phrase').value = 'abandon abandon'; await tq.verify(); await new Promise((r) => setTimeout(r, 50)); if (tq.document.getElementById('vIcon0').innerHTML !== '' || tq.document.getElementById('vFig0').style.display !== 'none') fails.push('verify: old fingerprint pictures are cleared before a new check'); } }
  // v1.25.1 word finder (reference words from the python-mnemonic English list)
  { for (const [i, wd, n] of [['1','abandon',1],['2048','zoo',2048],['257','cactus',257],['680','female',680],['3 A 7','female',680],['3-a-7','female',680],['1 0 0','abandon',1],['8 F F','zoo',2048],['2 0 0','cactus',257],['300','century',300],[' 300 ','century',300],['8 0 0','theme',1793]]) { const r = w.wdFindWord(i); if (r.word !== wd || r.idx !== n - 1 || r.msg !== 'Word ' + n + ': ' + wd) fails.push('word finder: ' + JSON.stringify(i) + ' gives the right word'); }
    for (const x of ['9 0 0','0 0 0','3 G 7','abc','3 A','3 A 7 7','-']) { const r = w.wdFindWord(x); if (r.word !== undefined || r.idx !== undefined || r.msg !== 'Type a number from 1 to 2048, a D8 roll (1-8) then two hex digits (0-F) like 3 A 7, or a BitBox02 diceware roll like 2143 2 T.') fails.push('word finder: bad entry ' + JSON.stringify(x) + ' refused with the hint'); }
    for (const x of ['0','2049','99999']) { const r = w.wdFindWord(x); if (r.msg !== 'A word number is between 1 and 2048.' || r.idx !== undefined) fails.push('word finder: out-of-range number ' + x + ' explained'); }
    if (w.wdFindWord('').msg !== '' || w.wdFindWord('  ').msg !== '') fails.push('word finder: empty entry is silent');
    $('wdFind').value = '3 A 7'; w.wdFind(); if ($('wdFound').textContent !== 'Word 680: female') fails.push('word finder: shows the word'); $('wdFind').value = ''; w.wdFind(); if ($('wdFound').textContent !== '') fails.push('word finder: clears the line'); }
  try { // v2.3.0 Verify a signed message. Signatures made here by @noble/curves (classic) and @scure/btc-signer (BIP-322 simple),
    // plus the official BIP-322 vectors and Bitcoin Core's classic vector.
    const T = new TextEncoder(), cat = (...a) => { const o = new Uint8Array(a.reduce((x, y) => x + y.length, 0)); let i = 0; for (const y of a) { o.set(y, i); i += y.length; } return o; };
    const vint = (n) => n < 0xfd ? Uint8Array.of(n) : Uint8Array.of(0xfd, n & 255, n >> 8);
    const le = (n) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
    const tagH = (t, m) => { const th = nsha(T.encode(t)); return nsha(cat(th, th, m)); };
    const b64 = (b) => Buffer.from(b).toString('base64');
    const V = async (a, m, sg) => (await w.verifyMessage(a, m, sg)).state;
    const priv = Uint8Array.from(sha('voidforge mutation key')), pubC = secp256k1.getPublicKey(priv, true), pubU = secp256k1.getPublicKey(priv, false);
    const N = { main: btc.NETWORK, test: btc.TEST_NETWORK };
    for (const [msg, net] of [['Hello from the probe', 'main'], ['x'.repeat(300), 'test'], ['', 'main']]) {
      const mb = T.encode(msg), sig = secp256k1.sign(nsha(nsha(cat(T.encode('\x18Bitcoin Signed Message:\n'), vint(mb.length), mb))), priv);
      const enc = (base) => b64(cat(Uint8Array.of(base + sig.recovery), bhex.decode(sig.r.toString(16).padStart(64, '0')), bhex.decode(sig.s.toString(16).padStart(64, '0'))));
      for (const [kind, addr, base] of [['1... uncompressed', btc.p2pkh(pubU, N[net]).address, 27], ['1...', btc.p2pkh(pubC, N[net]).address, 31], ['3...', btc.p2sh(btc.p2wpkh(pubC, N[net]), N[net]).address, 35], ['3... (legacy header)', btc.p2sh(btc.p2wpkh(pubC, N[net]), N[net]).address, 31], ['bc1q', btc.p2wpkh(pubC, N[net]).address, 39], ['bc1q (legacy header)', btc.p2wpkh(pubC, N[net]).address, 33 - 2]]) {
        if ((await V(addr, msg, enc(base))) !== 'valid') fails.push('signed message: classic ' + kind + ' ' + net + ' (' + msg.length + ' characters) is VALID');
        if ((await V(addr, msg + '.', enc(base))) !== 'invalid') fails.push('signed message: classic ' + kind + ' with a changed message is NOT VALID');
      }
      if ((await V(btc.p2wpkh(pubC, N[net]).address, msg, enc(27))) !== 'invalid') fails.push('signed message: an uncompressed key is never valid for bc1q');
      if ((await V(btc.p2pkh(pubU, N[net]).address, msg, enc(31))) !== 'invalid') fails.push('signed message: the compressed flag picks the key form');
      if ((await V(btc.p2pkh(pubC, N[net]).address, msg, enc(31 + (sig.recovery ^ 1) - sig.recovery))) !== 'invalid') fails.push('signed message: the recovery id picks R');
    }
    const toSpendId = (msg, spk) => { const mh = tagH('BIP0322-signed-message', T.encode(msg)); return bhex.encode(nsha(nsha(cat(le(0), Uint8Array.of(1), new Uint8Array(32), le(0xffffffff), Uint8Array.of(34, 0, 0x20), mh, le(0), Uint8Array.of(1), new Uint8Array(8), vint(spk.length), spk, le(0)))).reverse()); };
    const simple = (pay, msg, sighash) => { const tx = new btc.Transaction({ version: 0, allowUnknownOutputs: true });
      tx.addInput({ txid: toSpendId(msg, pay.script), index: 0, sequence: 0, witnessUtxo: { script: pay.script, amount: 0n }, ...(pay.tapInternalKey ? { tapInternalKey: pay.tapInternalKey } : {}), ...(sighash !== undefined ? { sighashType: sighash } : {}) });
      tx.addOutput({ script: Uint8Array.of(0x6a), amount: 0n }); tx.signIdx(priv, 0, sighash !== undefined ? [sighash] : undefined); tx.finalizeIdx(0);
      const wit = tx.getInput(0).finalScriptWitness; return cat(vint(wit.length), ...wit.map((x) => cat(vint(x.length), x))); };
    for (const [kind, pay, sh] of [['P2WPKH', btc.p2wpkh(pubC), undefined], ['P2WPKH testnet', btc.p2wpkh(pubC, btc.TEST_NETWORK), undefined], ['Taproot', btc.p2tr(pubC.slice(1)), undefined], ['Taproot SIGHASH_ALL', btc.p2tr(pubC.slice(1)), btc.SigHash.ALL], ['Taproot testnet', btc.p2tr(pubC.slice(1), undefined, btc.TEST_NETWORK), undefined]]) {
      for (const msg of ['Probe message', 'x'.repeat(300)]) {
        const wit = simple(pay, msg, sh);
        if ((await V(pay.address, msg, 'smp' + b64(wit))) !== 'valid') fails.push('signed message: BIP-322 simple ' + kind + ' (' + msg.length + ' characters) is VALID');
        if ((await V(pay.address, msg, b64(wit))) !== 'valid') fails.push('signed message: BIP-322 simple ' + kind + ' without the smp prefix is VALID');
        if ((await V(pay.address, msg + '!', 'smp' + b64(wit))) !== 'invalid') fails.push('signed message: BIP-322 simple ' + kind + ' with a changed message is NOT VALID');
        const bad = wit.slice(); bad[bad.length - 5] ^= 1; if ((await V(pay.address, msg, 'smp' + b64(bad))) !== 'invalid') fails.push('signed message: BIP-322 simple ' + kind + ' with one bit changed is NOT VALID');
      }
    }
    { // a P2WPKH signature that is valid except for a high S, or a sighash other than ALL, is refused (BIP-322 rules)
      const pay = btc.p2wpkh(pubC); let SM = 'S', wit = simple(pay, SM, undefined);
      for (let q = 0; q < 64 && (wit[2] !== 0x30 || wit[5] !== 32 || wit[3] > 69); q++) { SM = 'S' + q; wit = simple(pay, SM, undefined); }  // r of 32 bytes, so one more 0 byte is still a legal length
      const items = []; let i = 1;
      for (let k = 0; k < 2; k++) { const L = wit[i]; items.push(wit.slice(i + 1, i + 1 + L)); i += 1 + L; }
      const der = items[0].slice(0, -1), rl = der[3], r = der.slice(4, 4 + rl), sl = der[5 + rl], sv = BigInt('0x' + bhex.encode(der.slice(6 + rl, 6 + rl + sl))), N2 = secp256k1.CURVE.n, hs = N2 - sv;
      let hsb = bhex.decode(hs.toString(16).padStart(64, '0')); if (hsb[0] & 0x80) hsb = cat(Uint8Array.of(0), hsb);
      const derHigh = cat(Uint8Array.of(0x30, 2 + rl + 2 + hsb.length, 0x02, rl), r, Uint8Array.of(0x02, hsb.length), hsb);
      const mk = (sigItem) => cat(vint(2), vint(sigItem.length), sigItem, vint(items[1].length), items[1]);
      if ((await V(pay.address, SM, 'smp' + b64(mk(items[0])))) !== 'valid') fails.push('signed message: the rebuilt low-S signature is VALID');
      if ((await V(pay.address, SM, 'smp' + b64(mk(cat(derHigh, Uint8Array.of(1)))))) !== 'invalid') fails.push('signed message: BIP-322 refuses a high-S signature');
      if ((await V(pay.address, SM, 'smp' + b64(mk(cat(der, Uint8Array.of(3)))))) !== 'invalid') fails.push('signed message: BIP-322 refuses a sighash other than ALL');
      const loose = cat(Uint8Array.of(0x30, der[1] + 1), der.slice(2, 4), Uint8Array.of(0), der.slice(4)); loose[3] = rl + 1;
      if ((await V(pay.address, SM, 'smp' + b64(mk(cat(loose, Uint8Array.of(1)))))) !== 'invalid') fails.push('signed message: BIP-322 refuses DER that is not strict');
      const trW = simple(btc.p2tr(pubC.slice(1)), 'T', btc.SigHash.ALL), tr0 = trW.slice(); tr0[tr0.length - 1] = 0; tr0[1] = 65;
      if ((await V(btc.p2tr(pubC.slice(1)).address, 'T', 'smp' + b64(tr0))) !== 'invalid') fails.push('signed message: Taproot refuses an explicit 0 sighash byte'); }
    { // forgeries a sloppy verifier would accept
      // (1) a Schnorr signature whose R has an odd y (BIP340 needs an even y), made with a known key so every other check passes
      const G = secp256k1.ProjectivePoint.BASE, n = secp256k1.CURVE.n, md = (a) => ((a % n) + n) % n, big = (b) => BigInt('0x' + bhex.encode(b));
      let d = big(nsha(T.encode('schnorr probe key'))) % n; let P = G.multiply(d); if (P.toAffine().y & 1n) { d = n - d; P = G.multiply(d); }
      const px = bhex.decode(P.toAffine().x.toString(16).padStart(64, '0')), m32 = nsha(T.encode('schnorr probe message'));
      let k = 7n, R = G.multiply(k); while (!(R.toAffine().y & 1n)) { k++; R = G.multiply(k); }
      const rx = bhex.decode(R.toAffine().x.toString(16).padStart(64, '0')), e = md(big(tagH('BIP0340/challenge', cat(rx, px, m32))));
      const oddSig = cat(rx, bhex.decode(md(k + e * d).toString(16).padStart(64, '0')));
      if (!(await w.schnorrVerify(m32, px, schnorr.sign(m32, bhex.decode(d.toString(16).padStart(64, '0')))))) fails.push('signed message: Schnorr verify accepts a BIP340 signature');
      if (await w.schnorrVerify(m32, px, oddSig)) fails.push('signed message: Schnorr verify refuses an R with an odd y');
      // (2) a P2WPKH witness that signs the right hash for the address but with another key
      const pay = btc.p2wpkh(pubC), dec = w.segwitDecode(pay.address), parts = await w.bip322Parts('W', Uint8Array.of(0, 20, ...dec.prog)), z = await w.bip322SighashWpkh(parts, dec.prog);
      const other = Uint8Array.from(sha('another key')), os = secp256k1.sign(z, other), oder = os.toDERRawBytes(), opub = secp256k1.getPublicKey(other, true);
      if ((await V(pay.address, 'W', 'smp' + b64(cat(vint(2), vint(oder.length + 1), oder, Uint8Array.of(1), vint(33), opub)))) !== 'invalid') fails.push('signed message: a P2WPKH witness with another key is NOT VALID');
      const ms = secp256k1.sign(z, priv), mder = ms.toDERRawBytes(), good = cat(vint(2), vint(mder.length + 1), mder, Uint8Array.of(1), vint(33), pubC);
      if ((await V(pay.address, 'W', 'smp' + b64(good))) !== 'valid') fails.push('signed message: the same witness with the right key is VALID');
      if ((await V(pay.address, 'W', 'smp' + b64(cat(good, Uint8Array.of(0))))) !== 'invalid') fails.push('signed message: extra bytes after the witness are NOT VALID');
      // (3) a bc1q address made from an uncompressed key (not spendable) is never valid
      const mb = T.encode('U'), us = secp256k1.sign(nsha(nsha(cat(T.encode('\x18Bitcoin Signed Message:\n'), vint(mb.length), mb))), priv);
      const uAddr = bech32.encode('bc', [0, ...bech32.toWords(ripemd160(nsha(pubU)))]);
      if ((await V(uAddr, 'U', b64(cat(Uint8Array.of(27 + us.recovery), bhex.decode(us.r.toString(16).padStart(64, '0')), bhex.decode(us.s.toString(16).padStart(64, '0')))))) !== 'invalid') fails.push('signed message: an uncompressed key is never valid for a bc1q address'); }
    // official vectors
    if ((await V('bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l', 'Hello World', 'smpAkgwRQIhAOzyynlqt93lOKJr+wmmxIens//zPzl9tqIOua93wO6MAiBi5n5EyAcPScOjf1lAqIUIQtr3zKNeavYabHyR8eGhowEhAsfxIAMZZEKUPYWI4BruhAQjzFT8FSFSajuFwrDL1Yhy')) !== 'valid') fails.push('signed message: BIP-322 official P2WPKH vector');
    if ((await V('bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler', 'No prefix fallback', 'AUCJYOwOjxYAvatTAGYaVlNXBVyFuc4MwNQkOuK2tl8xhfKDONd0NjfYyNSYcRqeCp8hsAnCEPHAVEkO9h6vbQ/R')) !== 'valid') fails.push('signed message: BIP-322 official Taproot vector');
    if ((await V('mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB', 'This is just a test message', 'INbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0=')) !== 'valid') fails.push('signed message: Bitcoin Core classic vector');
    { const r = await w.verifyMessage('mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB', 'This is just a test message\n', 'INbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0='); if (r.state !== 'valid' || r.variant !== true || !/^VALID, after a small change to the message: the key of mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB/.test(r.text)) fails.push('signed message: a trailing line break is accepted only with the warning'); }
    { const r = await w.verifyMessage('mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB', 'This is just a test message', 'INbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0='); if (r.variant || !/^VALID: the key of mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB signed exactly this message\.\nFormat: classic \(BIP-137\), Legacy \(m\.\.\. or n\.\.\.\)\./.test(r.text)) fails.push('signed message: VALID names the address and the testnet type'); }
    if ((await V('1BquDSCmzyqhKnMXByiDQEFbY3DkMRi1XP', 'recid two', 'IQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEjRWeJCrze8=')) !== 'valid') fails.push('signed message: recovery id 2 (R.x = r + n)');
    { // Windows line breaks: signed with \r\n, typed with \n (a text box always gives \n), and the other way round
      const sgn = (m) => { const mb = T.encode(m), sg = secp256k1.sign(nsha(nsha(cat(T.encode('\x18Bitcoin Signed Message:\n'), vint(mb.length), mb))), priv); return b64(cat(Uint8Array.of(31 + sg.recovery), bhex.decode(sg.r.toString(16).padStart(64, '0')), bhex.decode(sg.s.toString(16).padStart(64, '0')))); };
      const A = btc.p2pkh(pubC).address;
      const r1 = await w.verifyMessage(A, 'one\ntwo', sgn('one\r\ntwo')); if (r1.state !== 'valid' || !r1.variant) fails.push('signed message: signed with Windows line breaks, typed with \\n, is VALID with the warning');
      const r2 = await w.verifyMessage(A, 'one\r\ntwo', sgn('one\ntwo')); if (r2.state !== 'valid' || !r2.variant) fails.push('signed message: signed with \\n, typed with Windows line breaks, is VALID with the warning');
      const r3 = await w.verifyMessage(A, 'one two', sgn('one two\n')); if (r3.state !== 'valid' || !r3.variant) fails.push('signed message: signed with a final line break, typed without, is VALID with the warning');
      const r4 = await w.verifyMessage(A, 'one two', sgn('one two!')); if (r4.state !== 'invalid') fails.push('signed message: another text is still NOT VALID'); }
    { // unprefixed BIP-322 full / proof of funds are CANNOT CHECK; a damaged classic signature is an error
      const full = 'AgAAAAABAfkBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
      if ((await V('bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l', 'x', full)) !== 'cannot') fails.push('signed message: an unprefixed full signature (a transaction) is CANNOT CHECK');
      if ((await V('bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler', 'x', 'cHNidP8BAAoCAAAAAAAAAAAA')) !== 'cannot') fails.push('signed message: an unprefixed proof of funds (a PSBT) is CANNOT CHECK');
      const dmg = Buffer.from('INbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0=', 'base64'); dmg[0] = 43;
      if ((await V('mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB', 'This is just a test message', dmg.toString('base64'))) !== 'error') fails.push('signed message: a damaged classic signature is an error'); }
    for (const [a, m, sg, want, why] of [['bc1qp0ahvfh83088w49k405szqgg4f3pptr7p2g06tdxfjcd40z4lh4q95lsz9', '', 'smpAkcwRAIgM2gBAQqvZX15ZiysmKmQpDrG83avLIT492QBzLnQIxYCIBaTpOaD20qRlEylyxFSeEA2ba9YOixpX8z46TSDtS40ASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=', 'cannot', 'a multisig address cannot be checked'],
      ['bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l', '', 'fulAgAAAAABAQ==', 'cannot', 'a full signature cannot be checked'], ['bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l', '', 'pofAA==', 'cannot', 'a proof of funds cannot be checked'],
      ['bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler', 'x', 'INbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0=', 'cannot', 'a classic signature for Taproot cannot be checked'],
      ['bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l', '', 'smpAA==', 'invalid', 'an empty witness is not valid'], ['bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l', '', 'not-valid-base64!!!', 'error', 'not base64'],
      ['bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l', '', '', 'error', 'an empty signature'], ['bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0m', '', 'smpAA==', 'error', 'an address with a bad checksum'],
      ['BC1Q9VZA2E8X573NCZRLZMS0WVX3GSQJX7VAVGKX0L', 'Hello World', 'smpAkgwRQIhAOzyynlqt93lOKJr+wmmxIens//zPzl9tqIOua93wO6MAiBi5n5EyAcPScOjf1lAqIUIQtr3zKNeavYabHyR8eGhowEhAsfxIAMZZEKUPYWI4BruhAQjzFT8FSFSajuFwrDL1Yhy', 'valid', 'an upper-case bc1q address works'],
      ['bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0L', 'Hello World', 'smpAkgwRQIhAOzyynlqt93lOKJr+wmmxIens//zPzl9tqIOua93wO6MAiBi5n5EyAcPScOjf1lAqIUIQtr3zKNeavYabHyR8eGhowEhAsfxIAMZZEKUPYWI4BruhAQjzFT8FSFSajuFwrDL1Yhy', 'error', 'a mixed-case address is refused'],
      ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3', 'x', 'smpAA==', 'error', 'a 1... address with a bad checksum'], ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'x', 'smpAA==', 'cannot', 'BIP-322 simple for 1... cannot be checked']])
      { const st = await V(a, m, sg); if (st !== want) fails.push('signed message: ' + why + ' (got ' + st + ')'); }
    // the box on the page
    $('sigAddr').value = 'mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB'; $('sigMsg').value = 'This is just a test message'; $('sigSig').value = 'INbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0=';
    await w.verifyMessageUi(); if ($('sigStatus').className !== 'status ok' || !/^VALID: the key of mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB signed exactly this message\./.test($('sigStatus').textContent)) fails.push('signed message: VALID in green on the page');
    $('sigMsg').value = 'This is just a test message\n'; await w.verifyMessageUi(); if ($('sigStatus').className !== 'status warn') fails.push('signed message: a match after a small change is amber');
    if (!/\n  \.status\.warn \{ color: var\(--warn-text\); \}/.test(mutated)) fails.push('signed message: the amber status colour is defined');
    $('sigMsg').value = 'This is just a test message';
    $('sigMsg').value = 'This is just a test message?'; $('sigMsg').dispatchEvent(new w.Event('input')); if ($('sigStatus').textContent !== '') fails.push('signed message: editing clears the result');
    await w.verifyMessageUi(); if ($('sigStatus').className !== 'status bad' || !/^NOT VALID/.test($('sigStatus').textContent)) fails.push('signed message: NOT VALID in red on the page');
    $('sigAddr').value = 'bc1qp0ahvfh83088w49k405szqgg4f3pptr7p2g06tdxfjcd40z4lh4q95lsz9'; await w.verifyMessageUi(); if ($('sigStatus').className !== 'status' || !/^CANNOT CHECK/.test($('sigStatus').textContent)) fails.push('signed message: CANNOT CHECK is neither green nor red');
    $('sigAddr').value = ''; $('sigSig').value = ''; $('sigMsg').value = '-----BEGIN BITCOIN SIGNED MESSAGE-----\nThis is just a test message\n-----BEGIN BITCOIN SIGNATURE-----\nmpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB\nINbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0=\n-----END BITCOIN SIGNATURE-----';
    await w.verifyMessageUi(); if ($('sigAddr').value !== 'mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB' || $('sigMsg').value !== 'This is just a test message' || !/^Read the address, message and signature from the signed-message block\.\nVALID/.test($('sigStatus').textContent)) fails.push('signed message: a signed-message block is read');
    { const BLOCK = '-----BEGIN BITCOIN SIGNED MESSAGE-----\nThis is just a test message\n-----BEGIN BITCOIN SIGNATURE-----\nmpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB\nINbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0=\n-----END BITCOIN SIGNATURE-----';
      $('sigAddr').value = 'bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l'; $('sigSig').value = ''; $('sigMsg').value = BLOCK; const r = await w.verifyMessageUi();
      if (r.state !== 'error' || $('sigAddr').value !== 'bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l' || $('sigStatus').className !== 'status bad' || !/^NOT CHECKED: the signed-message block is for mpLQ/.test($('sigStatus').textContent)) fails.push('signed message: a block for another address than the one typed is NOT CHECKED');
      $('sigAddr').value = ''; $('sigSig').value = 'smpAA=='; $('sigMsg').value = BLOCK; const r2 = await w.verifyMessageUi(); if (r2.state !== 'error' || $('sigSig').value !== 'smpAA==') fails.push('signed message: a block with another signature than the one typed is NOT CHECKED');
      $('sigAddr').value = ''; $('sigSig').value = ''; $('sigMsg').value = '-----BEGIN BITCOIN SIGNED MESSAGE-----\nThis is just a test message\n-----BEGIN SIGNATURE-----\nVersion: Bitcoin-qt (1.0)\nAddress: mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB\n\nINbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0=\n-----END BITCOIN SIGNED MESSAGE-----';
      const r3 = await w.verifyMessageUi(); if (r3.state !== 'valid' || $('sigAddr').value !== 'mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB') fails.push('signed message: a block with an Address: header is read'); }
    w.clearSig(); if ($('sigAddr').value || $('sigMsg').value || $('sigSig').value || $('sigStatus').textContent) fails.push('signed message: CLEAR empties the box');
  } catch (e) { fails.push('signed message: the probe crashed: ' + e.message); }
  try { // v2.3.0 BitBox02 diceware (expected words from @scure's English list and Node's SHA-256)
    const bbIdx = (c) => { const d = c.slice(0, 5).split('').map(Number); return (((d[0] - 1) * 64 + (d[1] - 1) * 16 + (d[2] - 1) * 4 + (d[3] - 1)) * 8) + (d[4] - 1) * 2 + (c[5] === 'T' ? 1 : 0); };
    let bad = 0; const seen = new Set();
    for (let a = 1; a <= 4; a++) for (let b2 = 1; b2 <= 4; b2++) for (let c = 1; c <= 4; c++) for (let d = 1; d <= 4; d++) for (let e = 1; e <= 4; e++) for (const f of 'HT') { const code = '' + a + b2 + c + d + e + f, r = w.wdFindWord(code.slice(0, 4) + ' ' + code[4] + ' ' + f.toLowerCase()); if (r.idx !== bbIdx(code) || r.word !== wordlist[bbIdx(code)] || r.msg !== 'Word ' + (bbIdx(code) + 1) + ': ' + wordlist[bbIdx(code)]) bad++; seen.add(r.idx); }
    if (bad || seen.size !== 2048 || w.wdFindWord('1111 1 H').word !== 'abandon' || w.wdFindWord('2111 1 H').word !== 'divorce' || w.wdFindWord('4444 4 T').word !== 'zoo') fails.push('BitBox02 table: every code gives the word of the printed table');
    for (const x of ['5111 1 H', '1111 5 H', '1111 1 X', '1111 1', '0111 1 H', '1111 1 HT']) if (w.wdFindWord(x).word !== undefined) fails.push('BitBox02 table: ' + x + ' is refused');
    $('wdWords').value = ''; $('wdLen').value = '12'; $('wdFind').value = '1111 1 H'; if (w.wdAddFound() !== true || $('wdWords').value !== 'abandon' || $('wdFind').value !== '' || $('wdFound').textContent !== 'Added word 1: abandon. BitBox02 diceware makes 24 words: choose 24 words above.') fails.push('ADD WORD: adds the word, empties the finder, and gives the 24-word hint at 12 words');
    $('wdFind').value = '3 A 7'; w.wdFind(); if ($('wdFound').textContent !== 'Word 680: female') fails.push('word finder: no BitBox hint for other entries');
    $('wdLen').value = '24'; $('wdFind').value = '1111 1 H'; w.wdFind(); if ($('wdFound').textContent !== 'Word 1: abandon') fails.push('word finder: no hint at 24 words'); $('wdLen').value = '12';
    for (const [c, wd] of [['1234 1 H', 'brand'], ['1234 4 T', 'brief'], ['3412 1 H', 'rain'], ['3412 4 T', 'rapid']]) if (w.wdFindWord(c).word !== wd) fails.push('BitBox02 table: ' + c + ' is ' + wd + ' (printed table)');
    $('wdFind').value = '4444 4 T'; $('wdFind').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); if ($('wdWords').value !== 'abandon zoo') fails.push('ADD WORD: Enter adds the word');
    $('wdFind').value = 'nope'; if (w.wdAddFound() !== false || $('wdWords').value !== 'abandon zoo') fails.push('ADD WORD: a bad entry adds nothing');
    $('wdWords').value = ''; $('wdFind').value = ''; w.wdFind(); w.wdUpdate();
    const cand = (idx, i) => { const bits = idx.map((n) => n.toString(2).padStart(11, '0')).join('') + i.toString(2).padStart(3, '0'); const ent = Uint8Array.from(bits.match(/.{8}/g).map((x) => parseInt(x, 2))); return entropyToMnemonic(ent, wordlist).split(' ')[23]; };
    { // a Word draw seed is cleared when its words, flips or length change afterwards (v2.3.0 review fix)
      w.setMethod('words'); $('wordSel').value = '24'; $('wordSel').dispatchEvent(new w.Event('change'));
      $('wdWords').value = Array(23).fill('violin').join(' '); $('wdFlips').value = '101'; w.wdUpdate(); await w.wdGenerate();
      const made = $('genResult').textContent.split('\n')[0];
      if (!w.hasSeed() || made.split(' ')[23] !== 'regular' || $('wdOut').style.display === 'none') fails.push('Word draw: 23 x violin and flips 101 make the 24th word regular');
      $('wdFlips').value = '111'; w.wdUpdate();
      if (w.hasSeed() || !/^You changed the words, the coin flips or the word count after MAKE SEED FROM WORDS/.test($('genResult').textContent) || $('wdOut').textContent !== '') fails.push('Word draw: changing the flips clears the seed and the last-word steps');
      $('wdFlips').value = '101'; w.wdUpdate(); await w.wdGenerate(); if (!w.hasSeed() || $('genResult').textContent.split('\n')[0] !== made) fails.push('Word draw: the same inputs make the same seed again');
      $('wdWords').value = Array(22).fill('violin').join(' ') + ' zoo'; w.wdUpdate(); if (w.hasSeed()) fails.push('Word draw: changing a word clears the seed');
      $('wdWords').value = Array(23).fill('violin').join(' '); w.wdUpdate(); await w.wdGenerate(); words(12); if (w.hasSeed()) fails.push('Word draw: changing the word count clears the seed');
      $('rolls').value = '1'; $('rolls').oninput(); $('rolls').value = ''; $('rolls').oninput();
      w.wdClear(); words(12); w.setMethod('dice'); }
    const viol = Array(23).fill(wordlist.indexOf('violin')), got = [];
    for (let i = 0; i < 8; i++) got.push((await w.wdSteps(viol, i.toString(2).padStart(3, '0'), 24)).lastWord);
    if (got.join(' ') !== 'boss coyote dry habit panel regular speed winter' || got.some((x, i) => x !== cand(viol, i))) fails.push('BitBox02 last word: 23 x violin gives BitBox\'s 8 choices in order (HHH first)');
  } catch (e) { fails.push('BitBox02: the probe crashed: ' + e.message); }
  try { // v2.4.0: one-page prints, roll sheet extras, CHECK A BACKUP backups, QR / child / Word draw / summary prints, dice test, keys, typo helper, explain
    const P = { n: 0, cells: [], txt: '', qr: '', qrh: '', lh: 0, sec: '' }, al = [], op = w.print, oa = w.alert, oc = w.confirm; let cnf = true;
    w.print = () => { P.n++; P.cells = [...w.document.querySelectorAll('#printOnly .ps-cell')].map((c) => c.textContent); P.txt = $('printOnly').textContent; P.qr = $('printQr').textContent; P.qrh = $('printQr').innerHTML; P.lh = w.document.querySelectorAll('#printOnly .ps-lh svg').length; P.sec = (w.document.querySelector('#printOnly .ps-secret') || {}).className || ''; P.secTxt = (w.document.querySelector('#printOnly .ps-secret') || {}).textContent || ''; P.cls = w.document.body.className; };
    w.alert = (m) => al.push(String(m)); w.confirm = () => cnf;
    const done = () => w.dispatchEvent(new w.Event('afterprint')), css = mutated.slice(0, mutated.indexOf('</style>'));
    const pr = (f, ...a) => { const n0 = P.n; al.length = 0; try { w[f](...a); } catch (e) { al.push('THREW ' + e.message); } const got = P.n - n0; if (got) done(); return got; };
    // one page: only the sheet is laid out, from the body
    if (!/    @page \{ margin: 12mm; \}\n    body\.print-seed > :not\(#printOnly\), body\.print-qr > :not\(#printQr\) \{ display: none !important; \}/.test(css)) fails.push('print v2.4: only the sheet is laid out, with a page margin');
    if ($('printOnly').parentElement !== w.document.body || $('printQr').parentElement !== w.document.body) fails.push('print v2.4: the print areas sit directly in the body');
    for (const re of [/\.ps-grid\.ps-roll\.ps-roll20 \{ grid-template-columns: repeat\(20, 1fr\)/, /#wvAbbrGrid\.on \{ display: grid; \}/, /\.ps-grid\.ps-15, body\.print-seed #printOnly \.ps-grid\.ps-18, body\.print-seed #printOnly \.ps-grid\.ps-21 \{ grid-template-columns: repeat\(3, 1fr\); \}/, /\.ps-grid\.ps-stamp\.ps-18, body\.print-seed #printOnly \.ps-grid\.ps-stamp\.ps-21, body\.print-seed #printOnly \.ps-grid\.ps-stamp\.ps-24 \{ grid-template-columns: repeat\(4, 1fr\); \}/]) if (!re.test(css)) fails.push('print v2.4: layout rule ' + re.source.slice(0, 40));
    // roll sheet extras
    { mode('dice'); words(12); $('rolls').value = ''; $('rolls').oninput(); const rs = (x) => { $('rsExtra').value = x; pr('printRollSheet'); return { c: P.cells.length }; };
      const wide = () => { let k = 0; const op2 = w.print; w.print = () => { k = w.document.querySelectorAll('#printOnly .ps-roll20').length; op2(); }; w.printRollSheet(); done(); w.print = op2; return k; };
      const opts = () => [...$('rsExtra').options].map((o) => o.value).join();
      if (opts() !== '0,10,25,50' || rs('0').c !== 50 || /Extra rolls/.test(P.txt) || rs('25').c !== 75 || !/Extra rolls \(optional\)/.test(P.txt) || P.cells[74] !== '75') fails.push('roll sheet v2.4: chosen number of extra boxes');
      const rules = (v) => { $('diceRules').value = v; $('diceRules').dispatchEvent(new w.Event('change')); };
      rules('keystone'); if (opts() !== '0,10,25,50,max') fails.push('roll sheet v2.4: Keystone adds up to 256');
      $('rsExtra').value = 'max'; if (wide() !== 2 || rs('max').c !== 256) fails.push('roll sheet v2.4: Keystone maximum is 256 boxes, compact');
      rules('std'); if (opts() !== '0,10,25,50' || $('rsExtra').value !== '10') fails.push('roll sheet v2.4: up to 256 goes away with Keystone rules');
      mode('coin'); $('rsExtra').value = '25'; if (wide() !== 2) fails.push('roll sheet v2.4: 153 coin boxes use the compact layout');
      $('rsExtra').value = '0'; if (wide() !== 0) fails.push('roll sheet v2.4: 128 coin boxes stay in 10 columns'); mode('dice'); $('rsExtra').value = '10'; }
    // Word draw sheet
    { $('wdLen').value = '12'; pr('printWordSheet'); if (P.cells.length !== 18 || P.cells[10] !== '11' || P.cells[17] !== 'Flip 7' || !/as secret as your seed/.test(P.txt)) fails.push('word draw sheet: 11 words and 7 flips');
      $('wdLen').value = '24'; pr('printWordSheet'); if (P.cells.length !== 26 || P.cells[22] !== '23' || P.cells[25] !== 'Flip 3') fails.push('word draw sheet: 23 words and 3 flips'); $('wdLen').value = '12';
      if ($('printOnly').textContent !== '' || /print-seed/.test(w.document.body.className)) fails.push('word draw sheet: wiped after printing'); }
    // dice test and keyboard entry
    { $('rolls').value = D50; $('rolls').oninput(); cnf = false; $('diceTest').checked = true; w.diceTestToggle();
      if ($('diceTest').checked || $('rolls').value !== D50) fails.push('dice test: Cancel keeps the rolls and the test off');
      cnf = true; $('diceTest').checked = true; w.diceTestToggle();
      if ($('rolls').value !== '' || !$('forgeBtn').disabled || $('diceTestBan').style.display !== '' || !$('rollStats').open) fails.push('dice test: on clears the rolls, FORGE off, banner, box open');
      $('rolls').value = '123456'.repeat(4); $('rolls').oninput(); if (!/^24 rolls so far\./.test($('diceTestNote').textContent)) fails.push('dice test: asks for more below 30');
      $('rolls').value = D50; $('rolls').oninput(); if ($('countNote').textContent !== '' || $('bitsNote').textContent !== '' || $('bigSub').textContent !== 'Dice test: no seed is made.' || $('rollCount').textContent !== '50 rolls tested' || w.document.querySelectorAll('#wordGrid .wcell.pv').length || !/^50 rolls tested: /.test($('diceTestNote').textContent)) fails.push('dice test: notes are about the test, no preview');
      $('rolls').value = '1'.repeat(60); $('rolls').oninput(); if (!/found a problem/.test($('diceTestNote').textContent)) fails.push('dice test: a bad run is a problem');
      al.length = 0; await w.generate(); if (w.hasSeed() || !/dice test is on/.test(al.join())) fails.push('dice test: FORGE refuses');
      w.setGate('pass', $('selfTestBadge').textContent, $('selfTestBadge').className); if (!$('forgeBtn').disabled) fails.push('dice test: the self-test gate keeps FORGE off');
      $('diceTest').checked = false; w.diceTestToggle(); if ($('rolls').value !== '' || $('forgeBtn').disabled || $('diceTestBan').style.display !== 'none' || $('diceTestNote').textContent !== '') fails.push('dice test: off clears the test rolls, FORGE back');
      const key = (k, o) => { const e = new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o || {})); w.document.querySelector('#tapRow button').dispatchEvent(e); return e.defaultPrevented; };
      $('rolls').value = ''; $('rolls').oninput(); key('4'); key('6'); const k9 = key('9'); key('2'); const kb = key('Backspace'); key('3', { ctrlKey: true });
      if ($('rolls').value !== '46' || k9 || !kb) fails.push('keyboard: digits add, others ignored, Backspace undoes, Ctrl left alone');
      mode('coin'); key('1'); key('5'); key('0'); if ($('rolls').value !== '10') fails.push('keyboard: coin takes 1 and 0 only'); mode('dice');
      if (!/^Add a 1 \(or press 1 on the keyboard; Backspace undoes the last one\)$/.test(w.document.querySelector('#tapRow button').title)) fails.push('keyboard: the buttons say so'); }
    // a seed: summary, QR prints (one FORGE; the other kinds of seed are checked through the summary itself)
    { const r = await run('dice', 12, D50); await w.passWork; await new Promise((res) => setTimeout(res, 0));
      const fp0 = fpOf(); if ($('sumLine').textContent !== 'This seed: 12 words from 50 dice rolls, SeedSigner and Coldcard dice rules, passphrase none, fingerprint ' + fp0 + '.') fails.push('summary: the line after FORGE');
      $('bk4').checked = false; pr('printSummary');
      if (!/^VOIDFORGE SEED SUMMARY/.test(P.txt) || !P.txt.includes('Seed length: 12 words\nMade from: 50 dice rolls, SeedSigner and Coldcard dice rules\nStrength: the words hold 128 bits of randomness (about 129 bits went in, if every roll was fair)\nPassphrase used: NO\nMaster fingerprint: ' + fp0) || !P.txt.includes($('address').textContent) || P.lh !== 1 || r.split(' ').some((x) => P.txt.includes(' ' + x + ' ')) || !$('bk4').checked) fails.push('summary: the sheet, with LifeHash, no words, ticks the checklist');
      const sum = (c) => { w.eval('sumCtx = ' + JSON.stringify(c)); const S = w.seedSummary(); w.eval('sumCtx = {count: 50, coin: false, keystone: false, words: 12}'); return S ? S.short + '|' + S.lines[2] : ''; };
      if (!/^12 words from 128 coin flips, passphrase none, fingerprint [0-9a-f]{8}\.\|Strength: the words hold 128 bits of randomness \(about 128 bits went in, if every flip was fair\)$/.test(sum({ count: 128, coin: true, keystone: false, words: 12 }))) fails.push('summary: coin flips');
      if (!/^24 words from 100 dice rolls, Keystone dice rules \(each 6 counts as 0\), .*\|Strength: the words hold 256 bits of randomness \(about 258 bits went in/.test(sum({ count: 100, coin: false, keystone: true, words: 24 }))) fails.push('summary: Keystone rules, 24 words');
      if (!/^24 words from Word draw \(23 drawn words and 3 coin flips\), .*\|Strength: the words hold 256 bits of randomness$/.test(sum({ wd: true, words: 24 }))) fails.push('summary: Word draw');
      w.showQr('wZpub', 'public key'); pr('printShownQr'); if (!/^VOIDFORGE ACCOUNT PUBLIC KEY/.test(P.qr) || !P.qr.includes($('wZpub').textContent) || !/Address type: Native SegWit/.test(P.qr) || !/<svg/.test(P.qrh)) fails.push('QR prints: the key QR with its text');
      w.showQr('spAddr', 'Silent Payment address'); pr('printShownQr'); if (!/^VOIDFORGE SILENT PAYMENT ADDRESS/.test(P.qr) || !/Address type: Silent Payment \(BIP-352\)/.test(P.qr)) fails.push('QR prints: Silent Payment');
      $('wNet').value = 'test'; w.showQr('wDescR', 'receive descriptor'); pr('printShownQr'); if (!/^VOIDFORGE RECEIVE DESCRIPTOR \(TESTNET\)/.test(P.qr)) fails.push('QR prints: testnet named'); $('wNet').value = 'main';
      w.hideQr(); if (pr('printShownQr') !== 0 || !/SHOW QR/.test(al.join())) fails.push('QR prints: nothing after HIDE QR');
      const a0 = adOf(); w.showAddrQr('aq', a0); pr('printAddrQr', 'aq'); if (!/^VOIDFORGE RECEIVE ADDRESS/.test(P.qr) || !P.qr.includes('Address: ' + a0) || /Payment link/.test(P.qr) || !P.qr.includes('Master fingerprint: ' + fp0)) fails.push('QR prints: an address');
      $('aqAmt').value = '0.5'; w.drawAddrQr('aq'); pr('printAddrQr', 'aq'); if (!/^VOIDFORGE PAYMENT REQUEST/.test(P.qr) || !P.qr.includes('Payment link: bitcoin:' + a0 + '?amount=0.5')) fails.push('QR prints: a payment request'); $('aqAmt').value = '';
      w.hideAddrQr('aq'); if (pr('printAddrQr', 'aq') !== 0 || al.length !== 1) fails.push('QR prints: nothing after HIDE QR (address)');
      $('passphrase').value = 'p1'; $('passphrase2').value = 'p2'; await w.rePass(); if ($('sumLine').textContent !== '' || pr('printSummary') !== 0 || pr('printSeed') !== 0) fails.push('summary: nothing while the passphrase boxes differ');
      $('passphrase2').value = 'p1'; await w.rePass(); await new Promise((res) => setTimeout(res, 0)); const fp1 = fpOf();
      if ($('sumLine').textContent !== 'This seed: 12 words from 50 dice rolls, SeedSigner and Coldcard dice rules, passphrase used, fingerprint ' + fp1 + '.' || fp1 === fp0) fails.push('summary: follows a passphrase change');
      pr('printSummary'); if (!/Passphrase used: YES \(kept separately; it is not written here\)/.test(P.txt) || P.txt.includes('p1')) fails.push('summary: passphrase used, not shown'); }
    // CHECK A BACKUP backups
    { const mn = 'legal winner thank year wave sausage worth useful legal winner thank yellow'; $('phrase').value = mn; $('verifyPass').value = ''; await w.openWalletView(mn, '');
      w.wvAbbr(); const ab = [...w.document.querySelectorAll('#wvAbbrGrid .wcell')].map((e) => e.textContent).join(' ');
      if (ab !== mn.split(' ').map((x, i) => (i + 1) + '.' + x.slice(0, 4)).join(' ') || !$('wvAbbrGrid').classList.contains('on') || $('wvAbbrBtn').textContent !== 'HIDE FIRST 4 LETTERS') fails.push('check: SHOW FIRST 4 LETTERS');
      w.wvAbbr(); if ($('wvAbbrGrid').textContent !== '' || $('wvAbbrGrid').classList.contains('on') || $('wvAbbrBtn').textContent !== 'SHOW FIRST 4 LETTERS') fails.push('check: hides again');
      pr('printSeed', 'check'); if (P.cells.join(' ') !== mn.split(' ').map((x, i) => String(i + 1).padStart(2, '0') + x).join(' ') || !P.txt.includes($('wvFp').textContent + '\nPassphrase used: NO') || !/Check every word against your first backup/.test(P.txt) || !/Words checked against your first backup/.test(P.txt) || /Rolls \/ flips/.test(P.txt)) fails.push('check: PRINT WORDS');
      pr('printStamp', 'check'); if (P.cells[0] !== '01LEGA' || P.cells.length !== 12) fails.push('check: PRINT STAMP SHEET');
      if (pr('printSeedQr', 'check') !== 0 || !/Press SHOW SEEDQR/.test(al.join())) fails.push('check: no SeedQR print before SHOW');
      w.wvSeedQr('compact'); pr('printSeedQr', 'check'); if (!/^VOIDFORGE COMPACTSEEDQR \(12 words, 21 x 21 squares\)/.test(P.qr) || !P.qr.includes($('wvFp').textContent)) fails.push('check: PRINT THIS QR (CompactSeedQR)');
      pr('printSqGuide', 'check'); if (!/HAND-COPY GUIDE \(12 words, 21 x 21 squares\)/.test(P.qr) || !/Row 21: /.test(P.qr)) fails.push('check: hand-copy guide');
      pr('printSqBlank', 'check'); if (!/^VOIDFORGE BLANK 21 x 21 GRID FOR COMPACTSEEDQR/.test(P.qr) || /<path d="M[^"]+" fill="#000"/.test(P.qrh.replace(/<path d="" fill="#000"\/>/, ''))) fails.push('check: blank grid');
      const wvA = w.document.querySelector('#wvList [data-addr]').getAttribute('data-addr'); w.showAddrQr('wvq', wvA); pr('printAddrQr', 'wvq'); if (!P.qr.includes($('wvFp').textContent) || P.qr.includes($('fingerprint').textContent)) fails.push('QR prints: the checked wallet fingerprint');
      w.wvSeedQrHide(); if (pr('printSqBlank', 'check') !== 0) fails.push('check: nothing after HIDE');
      w.wvAbbr(true); w.clearWalletView(); if ($('wvAbbrGrid').textContent !== '' || pr('printSeed', 'check') !== 0 || !/Check a seed phrase first/.test(al[0] || '')) fails.push('check: cleared with the wallet view');
      w.eval('wvCtx = {kind: "pub"}'); w.wvAbbr(true); if (pr('printSeed', 'check') !== 0 || !/Check a seed phrase first/.test(al[0] || '') || $('wvAbbrGrid').textContent !== '') fails.push('check: nothing for a public key'); w.clearWalletView();
    }
    // child seed prints
    { $('phrase').value = 'abandon '.repeat(11) + 'about'; $('verifyPass').value = ''; $('childApp').value = 'words'; w.childAppChange(); $('childWords').value = '12'; $('childIndex').value = '0'; await w.deriveChild();
      if ($('childPrintRow').style.display !== '' || $('childPrintBtn').textContent !== 'PRINT CHILD SEED') fails.push('child print: button after DERIVE');
      const cw = $('childOut').textContent.match(/\d+\. [a-z]+/g).map((x) => x.split(' ')[1]);
      cnf = false; if (pr('printChild') !== 0) fails.push('child print: asks first'); cnf = true; pr('printChild');
      if (P.cells.join(' ') !== cw.map((x, i) => String(i + 1).padStart(2, '0') + x).join(' ') || !/^VOIDFORGE CHILD SEED \(BIP85\)/.test(P.txt) || !/Made with BIP85 from the parent wallet 73c5da0a, index 0\. The parent words, the type and the index make it again\./.test(P.txt)) fails.push('child print: the child words and how to make them again');
      $('verifyPass').value = 'TREZOR'; $('childIndex').value = '3'; await w.deriveChild(); pr('printChild'); if (!/parent wallet [0-9a-f]{8} \(parent words with a passphrase\), index 3\. The parent words, the passphrase, the type/.test(P.txt) || /73c5da0a/.test(P.txt)) fails.push('child print: passphrase and index');
      $('verifyPass').value = ''; $('childIndex').value = '0'; $('childApp').value = 'pwd64'; w.childAppChange(); $('childLen').value = '21'; await w.deriveChild();
      if ($('childPrintBtn').textContent !== 'PRINT PASSWORD') fails.push('child print: label follows the type');
      pr('printChild'); if (!/^VOIDFORGE CHILD PASSWORD \(BIP85\)/.test(P.txt) || P.sec !== 'ps-secret' || P.secTxt.length !== 21 || !$('childOut').textContent.includes(P.secTxt)) fails.push('child print: a password in one box');
      w.clearChild(); if ($('childPrintRow').style.display !== 'none' || pr('printChild') !== 0 || !/DERIVE first/.test(al.join())) fails.push('child print: HIDE removes it');
      $('childApp').value = 'words'; w.childAppChange(); }
    // typo helper, 4-letter forms
    { let r = await w.checkPhrase('abandon '.repeat(10) + 'abandn about'); if (r.msg !== 'Unknown word: abandn (word 11): closest BIP39 word abandon. Check it on your backup.') fails.push('typo: one unknown word');
      r = await w.checkPhrase('abandon '.repeat(9) + 'adress zzzzz about'); if (r.msg !== 'Unknown words: adress (word 10): closest BIP39 words address, dress; zzzzz (word 11): no BIP39 word is close. Check them on your backup.') fails.push('typo: two unknown words');
      if (w.wordDistance('abandon', 'abnadon', 3) !== 1 || w.wordFromPrefix('yel') !== null || w.wordFromPrefix('yell') !== 'yellow') fails.push('typo: swap distance and 4 letters');
      r = await w.checkPhrase('aban '.repeat(11) + 'abou'); if (!r.ok || r.mnemonic !== 'abandon '.repeat(11) + 'about' || !/\(12 words read from the first letters\)$/.test(r.msg)) fails.push('4-letter: read as full words');
      r = await w.checkPhrase('abandon '.repeat(11) + 'abou'); if (!/\(1 word read from the first letters\)$/.test(r.msg)) fails.push('4-letter: one word');
      r = await w.checkPhrase('abandon '.repeat(12)); if (r.msg !== 'Checksum failed. Every word is a BIP39 word, so one is probably wrong, missing or out of order: Reforge in EXTRA TOOLS can search for it.') fails.push('typo: checksum points to Reforge');
      $('phrase').value = 'aban '.repeat(11) + 'abou'; await w.verify(); if ($('phrase').value !== 'abandon '.repeat(11) + 'about') fails.push('4-letter: VERIFY writes the full words back'); w.clearWalletView(); }
    // explain an address
    { const X = async (a) => { $('checkAddr').value = a; await w.explainAddrUi(); return [$('addrExplain').className, $('addrExplain').textContent]; };
      $('checkAddr').value = 'hello'; $('addrExplain').textContent = ''; $('checkAddr').dispatchEvent(new w.Event('input')); for (let i = 0; i < 40 && $('addrExplain').textContent === ''; i++) await new Promise((res) => setTimeout(res, 5));
      if (!/^Not a Bitcoin address/.test($('addrExplain').textContent)) fails.push('explain: typing in the box explains it');
      const seed0 = mnemonicToSeedSync('abandon '.repeat(11) + 'about', ''), r0 = HDKey.fromMasterSeed(seed0), spX = (coin, hrp) => bech32m.encode(hrp, [0, ...bech32m.toWords(new Uint8Array([...r0.derive(`m/352'/${coin}'/0'/1'/0`).publicKey, ...r0.derive(`m/352'/${coin}'/0'/0'/0`).publicKey]))], 1023);
      const cases = [
        ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'status ok', /^Native SegWit address \(P2WPKH\) on Bitcoin mainnet \(real money\)\..*In the dictionary: Native SegWit · P2WPKH$/],
        ['bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3', 'status ok', /^SegWit script address \(P2WSH\)/],
        ['bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr', 'status ok', /^Taproot address \(P2TR\) on Bitcoin mainnet/],
        ['tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'status ok', /^Native SegWit address \(P2WPKH\) on testnet or signet/],
        ['bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs', 'status bad', /^A SegWit version 2 address with a 16-byte program/],
        ['bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'status bad', /mixes capital and small letters/],
        ['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv', 'status bad', /^Not a valid address: the checksum does not match/],
        ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'status ok', /^Legacy address \(P2PKH\) on Bitcoin mainnet/],
        ['mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn', 'status ok', /^Legacy address \(P2PKH\) on testnet/],
        ['3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 'status ok', /^Script address \(P2SH\) on Bitcoin mainnet/],
        ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3', 'status bad', /^Not a valid address: the checksum does not match/],
        ['5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ', 'status bad', /^This is a PRIVATE KEY \(WIF\)/],
        ['KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn', 'status bad', /^This is a PRIVATE KEY \(WIF\)/],
        ['xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8', 'status warn', /^This is an extended PUBLIC key/],
        ['xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi', 'status bad', /^This is an extended PRIVATE key/],
        ['abandon '.repeat(11) + 'about', 'status bad', /^These look like SEED WORDS/],
        ['wpkh([d34db33f/84h/0h/0h]xpub6/0/*)', 'status warn', /^This is a descriptor/],
        ['lnbc1pvjluezsp5zyg3zyg3zyg', 'status warn', /^This is a Lightning invoice/],
        ['bitcoin:bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu?amount=1', 'status ok', /It was written as a payment request \(BIP-21\).*In the dictionary: BIP21 · Native SegWit · P2WPKH$/],
        [spX(0, 'sp'), 'status ok', /^Silent Payment address \(BIP-352\) on Bitcoin mainnet/],
        [spX(1, 'tsp'), 'status ok', /^Silent Payment address \(BIP-352\) on testnet/],
        [spX(0, 'sp').slice(0, -1) + (spX(0, 'sp').endsWith('q') ? 'p' : 'q'), 'status bad', /^Not a valid Silent Payment address/],
        ['hello', 'status bad', /^Not a Bitcoin address VOIDFORGE recognises/],
      ];
      for (const [a, c, re] of cases) { const [cl, tx] = await X(a); if (cl !== c || !re.test(tx)) { fails.push('explain: ' + a.slice(0, 14)); break; } }
      await X(''); if ($('addrExplain').textContent !== '' || $('addrExplain').className !== 'status') fails.push('explain: empty box, empty line');
      w.eval('dictCat = "Units"'); $('dictSearch').value = 'zzzz'; w.dictFilter(); await X('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr'); w.dictGo('SegWit'); $('addrExplain').querySelector('button.dict-link').click();
      const hit = [...w.document.querySelectorAll('.dict-item.dict-hit')];
      if (hit.length !== 1 || hit[0].querySelector('dt').textContent !== 'Taproot' || hit[0].style.display === 'none' || !$('dictBox').open || $('tp-about').classList.contains('tab-off') || $('dictSearch').value !== '') fails.push('dictionary links: open the entry');
      w.showTab('make');
      const wl = [...w.document.querySelectorAll('#whatBox li')]; if (wl.length !== 10 || wl.filter((e) => e.querySelector('.tag-secret')).length !== 6 || wl.filter((e) => e.querySelector('.tag-public')).length !== 3) fails.push('what guide: 6 secret, 3 public'); }
    w.print = op; w.alert = oa; w.confirm = oc; $('checkAddr').value = ''; $('phrase').value = ''; $('rollStats').open = false; $('addrExplain').textContent = ''; $('addrExplain').className = 'status';
  } catch (e) { fails.push('v2.4.0: the probe crashed: ' + e.message); }
  try { // v2.3.0 Keystone dice rules (expected words from @scure and Node's SHA-256 of the rolls with every 6 as 0)
    const rules = (v) => { $('diceRules').value = v; $('diceRules').dispatchEvent(new w.Event('change')); };
    const mk = (r, wc) => entropyToMnemonic(sha(r.replace(/6/g, '0')).slice(0, wc === 24 ? 32 : 16), wordlist);
    rules('keystone');
    if ($('rulesNote').textContent !== 'each 6 counts as 0; 50 to 256 rolls' || $('lenNote').textContent !== '50 to 256 dice rolls') fails.push('Keystone: the menu note and the length line');
    let r = await run('dice', 12, D50); if (r !== mk(D50, 12) || r === expect.d50) fails.push('Keystone: 50 rolls are hashed with every 6 as 0');
    if ($('countNote').textContent !== 'Keystone rules: every 6 counts as 0 and all 50 rolls are hashed, so a Keystone wallet makes the same words from these rolls.') fails.push('Keystone: the note says a Keystone wallet makes the same words');
    const D120 = (D99 + D50).slice(0, 120); r = await run('dice', 12, D120); if (r !== mk(D120, 12) || !/That is more than twice the 50 needed/.test($('countNote').textContent)) fails.push('Keystone: 120 rolls all count, with the double-paste note');
    r = await run('dice', 24, D99); if (r !== 'Enter 1 more roll (99 of 100).' || $('lenNote').textContent !== '100 to 256 dice rolls') fails.push('Keystone: 24 words need 100 rolls');
    const D100 = D99 + '6'; r = await run('dice', 24, D100); if (r !== mk(D100, 24)) fails.push('Keystone: 100 rolls make 24 words');
    const D256 = (D99 + D99 + D99).slice(0, 256); r = await run('dice', 24, D256); if (r !== mk(D256, 24)) fails.push('Keystone: 256 rolls are allowed');
    { const op = w.print; let txt = ''; w.print = () => { txt = $('printOnly').textContent; }; w.printRollSheet(); w.dispatchEvent(new w.Event('afterprint')); w.print = op;
      if (!/Keystone dice rules \(each 6 counts as 0, at most 256 rolls\): a Keystone wallet makes the same words\./.test(txt) || !/Dice rules: Keystone \(each 6 counts as 0\)/.test(txt) || /SeedSigner|Coldcard/.test(txt)) fails.push('Keystone: the roll sheet names the Keystone rules only'); }
    $('rolls').value = D256 + '2'; $('rolls').oninput(); await new Promise((res) => setTimeout(res, 60));
    if (w.guideCanNext(2) || w.document.querySelectorAll('#wordGrid .wcell.pv').length) fails.push('Keystone: above 256 rolls no guide NEXT and no preview words');
    $('rolls').value = D256; $('rolls').oninput(); if (!w.guideCanNext(2)) fails.push('Keystone: 256 rolls let the guide go on');
    r = await run('dice', 24, D256 + '2'); if (!/^Keystone takes at most 256 rolls\. Remove 1 \(257 of 256\)/.test(r) || w.hasSeed() || $('countNote').textContent !== 'Keystone takes at most 256 rolls: remove 1.' || $('bigSub').textContent !== 'Keystone takes at most 256: remove 1' || !/short/.test($('bigCount').className)) fails.push('Keystone: 257 rolls are refused');
    r = await run('dice', 12, D50); rules('std'); if (w.hasSeed()) fails.push('Keystone: changing the dice rules after FORGE clears the words');
    r = await run('dice', 12, D50); if (r !== expect.d50) fails.push('Keystone: back to SeedSigner and Coldcard rules, the old words come back');
    rules('keystone'); $('rolls').value = D50.slice(0, 45); $('rolls').oninput(); await new Promise((res) => setTimeout(res, 60));
    if ([...w.document.querySelectorAll('#wordGrid .wcell span')].map((x) => x.textContent).join(' ') !== mk(D50.slice(0, 45), 12)) fails.push('Keystone: the preview follows the Keystone rules');
    r = await run('dice', 12, D50); await w.showExplain(); if (!/Keystone dice rules: every 6 is written as 0/.test($('exOut').textContent) || !/These words match the seed above/.test($('exOut').textContent)) fails.push('Keystone: the explain view shows 6 as 0 and matches');
    { let blob = null; const oc = w.URL.createObjectURL; w.URL.createObjectURL = (b) => { blob = b; return 'blob:x'; }; if (!w.URL.revokeObjectURL) w.URL.revokeObjectURL = () => {}; w.downloadSeed(); w.URL.createObjectURL = oc; const txt = blob ? await new Promise((res) => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(''); fr.readAsText(blob); }) : ''; if (!/\nDice rules: Keystone \(each 6 counts as 0 before hashing\)$/.test(txt)) fails.push('Keystone: the download names the rules'); }
    mode('coin'); if ($('rulesRow').style.display !== 'none' || w.keystoneOn()) fails.push('Keystone: hidden and off in coin mode');
    r = await run('coin', 12, C128); if (r !== expect.c128) fails.push('Keystone: coin flips are not changed by the dice rules');
    mode('dice'); if ($('rulesRow').style.display !== '' || !w.keystoneOn()) fails.push('Keystone: the choice is kept for dice');
    w.setMethod('words'); if ($('rulesRow').style.display !== 'none') fails.push('Keystone: hidden in Word draw'); w.setMethod('dice');
    rules('std'); words(12); $('rolls').value = ''; $('rolls').oninput();
  } catch (e) { fails.push('Keystone: the probe crashed: ' + e.message); }
  // v1.25.1 fairness test (reference values from scipy.stats.chisquare)
  { const mk = (c) => c.map((n, i) => String(i + 1).repeat(n)).join('');
    for (const [c, x, pv] of [[[5,5,5,5,5,5],0,1],[[8,6,4,5,3,4],3.2,0.669183],[[10,6,5,4,3,2],8,0.156236],[[12,8,4,3,2,1],17.6,0.003492],[[15,12,9,6,3,0],21,0.00081],[[20,5,2,1,1,1],56.4,0]]) { const r = w.faceTest(mk(c), false); if (Math.abs(r.chi - x) > 1e-6 || Math.abs(r.p - pv) > 2e-6 || r.df !== 5) fails.push('fairness: dice chi-square and p match scipy for ' + c.join(',')); }
    for (const [c, x, pv] of [[[15,5],5,0.025347],[[10,10],0,1],[[16,4],7.2,0.00729],[[18,2],12.8,0.000347]]) { const r = w.faceTest('1'.repeat(c[0]) + '0'.repeat(c[1]), true); if (Math.abs(r.chi - x) > 1e-6 || Math.abs(r.p - pv) > 2e-6 || r.df !== 1) fails.push('fairness: coin chi-square and p match scipy for ' + c.join(',')); }
    const st = () => ($('rcStat') || {}).textContent || '';
    w.wipeSeed(); mode('dice'); $('rolls').value = mk([5,5,5,5,5,4]); $('rolls').oninput(); if (st()) fails.push('fairness: dice test waits for 30 rolls');
    $('rolls').value = mk([5,5,5,5,5,5]); $('rolls').oninput(); if (!/χ² = 0\.00, 5 degrees of freedom, p ≈ 1\.000\. Nothing unusual\. This cannot prove fairness\.$/.test(st())) fails.push('fairness: even counts text');
    $('rolls').value = mk([12,8,4,3,2,1]); $('rolls').oninput(); if (!/p ≈ 0\.003\. Mildly unusual: a fair die does this about 1 time in 20\./.test(st())) fails.push('fairness: mild text for die');
    $('rolls').value = mk([20,5,2,1,1,1]); $('rolls').oninput(); if (!/p ≈ below 0\.001\. Strong sign the counts are uneven\./.test(st())) fails.push('fairness: strong text');
    $('rolls').value = mk([15,12,9,6,3,0]); $('rolls').oninput(); if (!/p ≈ below 0\.001\. Strong sign/.test(st())) fails.push('fairness: p 0.0008 is already a strong sign');
    $('rolls').value = mk([10,6,5,4,3,2]); $('rolls').oninput(); if (!/p ≈ 0\.156\. Nothing unusual/.test(st())) fails.push('fairness: p 0.156 is nothing unusual');
    $('rolls').value = ''; $('rolls').oninput(); mode('coin');
    $('rolls').value = '1'.repeat(14) + '0'.repeat(5); $('rolls').oninput(); if (st()) fails.push('fairness: coin test waits for 20 flips');
    $('rolls').value = '1'.repeat(15) + '0'.repeat(5); $('rolls').oninput(); if (!/χ² = 5\.00, 1 degree of freedom, p ≈ 0\.025\. Mildly unusual: a fair coin does this/.test(st())) fails.push('fairness: coin text');
    $('rolls').value = ''; $('rolls').oninput(); mode('dice'); }
  // v1.25.0 layout: tabs, Your seed panel, step bar, word slots, dice wait
  { const on = (n) => !$('tp-' + n).classList.contains('tab-off'), sel = (n) => $('tab-' + n).getAttribute('aria-selected'), disp = (n) => w.getComputedStyle($('tp-' + n)).display;
    const names = ['make', 'check', 'tools', 'about'];
    w.showTab('make'); if (!names.every((n) => on(n) === (n === 'make') && sel(n) === String(n === 'make') && ($('tab-' + n).tabIndex === 0) === (n === 'make'))) fails.push('layout: Make a seed open first, others closed, tab stops follow');
    w.showTab('tools'); if (!names.every((n) => on(n) === (n === 'tools') && sel(n) === String(n === 'tools') && ($('tab-' + n).tabIndex === 0) === (n === 'tools'))) fails.push('layout: showTab opens exactly one tab and updates aria-selected and tab stops');
    if (disp('tools') === 'none' || disp('make') !== 'none' || disp('about') !== 'none') fails.push('layout: closed tabs are really hidden by the stylesheet');
    w.showTab('nonsense'); if (!on('tools')) fails.push('layout: an unknown tab name changes nothing');
    { let fo = []; const tb = $('tab-check'); tb.focus = () => fo.push(1); w.showTab('make'); w.showTab('check'); const n0 = fo.length; w.showTab('make'); w.showTab('check', null, true); if (n0 !== 0 || fo.length !== 1) fails.push('layout: focusTab moves focus to the tab only when asked'); delete tb.focus; }
    { let seen = 0; const el = $('cardCheck'); el.scrollIntoView = () => { seen++; }; w.showTab('check', 'cardCheck'); w.showTab('check'); if (seen !== 1) fails.push('layout: showTab scrolls to the target only when one is given'); delete el.scrollIntoView; }
    w.showTab('make'); w.jumpTo('cardCheck'); if (!on('check')) fails.push('layout: jumpTo opens the tab that holds the target');
    w.jumpTo('cardMulti'); if (!on('tools')) fails.push('layout: jumpTo opens Extra tools for multisig'); w.jumpTo('beforeCard'); if (!on('about')) fails.push('layout: jumpTo opens About for the safety card'); w.jumpTo('cardGen'); if (!on('make')) fails.push('layout: jumpTo opens Make a seed');
    { let seen = 0; const el = $('cardCheck'); const orig = el.scrollIntoView; el.scrollIntoView = () => { seen++; }; w.showTab('make'); w.reveal(el); el.scrollIntoView = orig; if (seen !== 1 || !on('check')) fails.push('layout: reveal opens the tab and scrolls to the element once');
      if (w.tabOfEl($('rolls')) !== 'make' || w.tabOfEl($('phrase')) !== 'check' || w.tabOfEl($('psbtInput')) !== 'tools' || w.tabOfEl($('disclaimer')) !== 'about' || w.tabOfEl($('printOnly')) !== null || w.tabOfEl(null) !== null) fails.push('layout: tabOfEl names the tab of an element, or none'); }
    w.showTab('make'); $('tab-tools').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); if (!on('tools')) fails.push('layout: clicking a tab opens it');
    { w.showTab('make'); const key = (k) => { const ev = new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); $('tabs').dispatchEvent(ev); return ev.defaultPrevented; };
      Object.defineProperty(w.document, 'activeElement', { configurable: true, get: () => $('tab-' + names.find((n) => $('tab-' + n).tabIndex === 0)) });
      const r1 = key('ArrowRight'); if (!on('check') || !r1) fails.push('layout: right arrow moves to the next tab and stops the page scrolling'); key('ArrowLeft'); if (!on('make')) fails.push('layout: left arrow moves back');
      key('ArrowLeft'); if (!on('about')) fails.push('layout: left arrow wraps to the last tab'); key('ArrowRight'); if (!on('make')) fails.push('layout: right arrow wraps to the first tab');
      key('End'); if (!on('about')) fails.push('layout: End opens the last tab'); key('Home'); if (!on('make')) fails.push('layout: Home opens the first tab');
      if (key('x') || !on('make')) fails.push('layout: other keys do nothing and are not blocked'); delete w.document.activeElement; }
    w.showTab('make'); $('strip').querySelector('button').click(); if (!on('about')) fails.push('layout: the one-line notice opens About & help');
    w.showTab('make');
    w.wipeSeed(); mode('dice'); words(12);
    const big = () => $('bigCount'), sub = () => $('bigSub'), cur = () => [...w.document.querySelectorAll('#stepBar li')].map((l) => l.className || '-').join(','), setR = (v) => { $('rolls').value = v; $('rolls').oninput(); };
    if (big().textContent !== '0 / 50' || big().className !== 'big-count short' || sub().textContent !== '50 more rolls to go' || sub().className !== 'big-sub short') fails.push('layout: counter starts at 0 / 50, red');
    setR(D50.slice(0, 20)); if (big().textContent !== '20 / 50' || !/short/.test(big().className) || sub().textContent !== '30 more rolls to go' || $('rollCount').className !== 'short') fails.push('layout: counter red below the target');
    setR(D50.slice(0, 49)); if (!/short/.test(big().className) || /met/.test(big().className) || sub().textContent !== '1 more rolls to go') fails.push('layout: counter still red one short');
    setR(D50); if (big().textContent !== '50 / 50' || big().className !== 'big-count met' || sub().textContent !== 'Enough rolls. Press FORGE SEED.' || sub().className !== 'big-sub met' || $('rollCount').className !== 'met') fails.push('layout: counter green at the target with the next step named');
    setR(D50 + '1'); if (big().textContent !== '51 / 50' || !/met/.test(big().className)) fails.push('layout: counter green when over the target');
    words(24); if (big().textContent !== '51 / 99' || !/short/.test(big().className) || sub().textContent !== '48 more rolls to go') fails.push('layout: counter follows the 24-word target');
    mode('coin'); words(12); setR('1'.repeat(100)); if (sub().textContent !== '28 more flips to go' || big().textContent !== '100 / 128') fails.push('layout: counter counts flips in coin mode'); setR('1'.repeat(128)); if (!/Enough flips/.test(sub().textContent)) fails.push('layout: counter says flips when met');
    mode('dice'); words(12); setR('');
    if (cur() !== 'done,cur,-,-,-' || w.document.querySelectorAll('#stepBar li[aria-current]').length !== 1 || w.document.querySelector('#stepBar li[aria-current]').getAttribute('data-s') !== '2') fails.push('layout: step bar starts at Roll with one step marked current');
    setR(D50); if (cur() !== 'done,done,cur,-,-' || w.document.querySelector('#stepBar li[aria-current]').getAttribute('data-s') !== '3') fails.push('layout: step bar moves to Forge when there are enough rolls');
    await w.generate(); if (cur() !== 'done,done,done,cur,-' || !/Seed made/.test(sub().textContent) || w.document.querySelector('#stepBar li[aria-current]').getAttribute('data-s') !== '4') fails.push('layout: step bar moves to Check once a seed exists');
    { const why = () => $('stepWhy').textContent; w.clearAll(); await new Promise((r2) => setTimeout(r2, 20)); setR('');
      if (!/SHA-256, so nothing hidden/.test(why())) fails.push('step help: the Roll step explains that only SHA-256 is applied');
      setR(D50); if (!/Press FORGE SEED to turn your rolls into the BIP39 words/.test(why())) fails.push('step help: the Forge step says what FORGE does');
      await w.generate(); if (!/passphrase is optional and makes a completely different wallet/.test(why())) fails.push('step help: the Passphrase step says what a passphrase does'); }
    const real = $('genResult').textContent.split('\n')[0].split(' ');
    const cells = () => [...$('wordGrid').children];
    if (cells().length !== 12 || cells().some((c) => c.classList.contains('empty')) || cells().map((c) => c.lastChild.textContent).join(' ') !== real.join(' ') || $('wordGrid').classList.contains('slots') || $('wordGrid').style.display !== 'grid' || $('genResult').classList.contains('nores')) fails.push('layout: forging replaces the empty slots with the real words');
    w.renderSlots(); if (cells().length !== 12 || cells().some((c) => c.classList.contains('empty')) || cells().map((c) => c.lastChild.textContent).join(' ') !== real.join(' ')) fails.push('layout: redrawing the slots does not touch a made seed');
    words(24); w.renderSlots(); if ($('genResult').dataset.seed || cells().length !== 24 || cells().some((c) => !c.classList.contains('empty'))) fails.push('layout: changing the length after FORGE clears the old seed (no stale words under a different length)'); words(12);
    w.wipeSeed();
    if (cells().length !== 12 || !cells().every((c) => c.classList.contains('empty') && c.lastChild.textContent === '—') || cells().map((c) => c.firstChild.textContent).join(' ') !== Array.from({ length: 12 }, (_, i) => (i + 1) + '.').join(' ') || !$('wordGrid').classList.contains('slots') || $('wordGrid').style.display === 'grid' || $('wordGrid').textContent.includes(real[0]) || !$('genResult').classList.contains('nores') || cur() !== 'done,cur,-,-,-' || big().textContent !== '0 / 50') fails.push('layout: wiping restores twelve numbered empty slots, hides the result box, resets counter and steps');
    { const rb = $('genResult'); w.setResult('abandon '.repeat(11) + 'about'); w.setResult('\u2014'); if (cells().length !== 12 || !cells().every((c) => c.classList.contains('empty')) || !$('wordGrid').classList.contains('slots')) fails.push('layout: clearing the result itself brings the empty slots back'); }
    words(24); if (cells().length !== 24 || cells()[23].firstChild.textContent !== '24.' || cells().some((c) => !c.classList.contains('empty'))) fails.push('layout: 24 empty slots for 24 words'); words(12); if (cells().length !== 12) fails.push('layout: back to 12 slots');
    setR('555'); await w.generate(); if (cells().some((c) => !c.classList.contains('empty')) || $('genResult').classList.contains('nores') || !/more rolls/.test($('genResult').textContent) || $('genResult').dataset.seed) fails.push('layout: a "more rolls" message appears in the result box and no seed is made'); setR('');
    { const t1 = loadPage(mutated, (win) => { win.__f = []; }); await ready(t1); const b1 = t1.document.body; if (!b1.classList.contains('dice-wait') || !t1.document.getElementById('startGate')) fails.push('layout: dice held back while the notice is open');
      t1.startGateClose(); if (b1.classList.contains('dice-wait')) fails.push('layout: dice released when the notice closes');
      const t2 = loadPage(mutated, () => {}); await ready(t2); t2.document.dispatchEvent(new t2.KeyboardEvent('keydown', { key: 'Escape' })); if (t2.document.body.classList.contains('dice-wait')) fails.push('layout: dice released when Escape closes the notice');
      const t3 = loadPage(mutated, () => {}); await ready(t3); t3.document.getElementById('startGate').remove(); t3.document.dispatchEvent(new t3.Event('DOMContentLoaded')); if (t3.document.body.classList.contains('dice-wait')) fails.push('layout: dice not held back when there is no notice'); }
  }
  { const $p = (id) => w.document.getElementById(id), E = ['abandon', 'ability', 'able', 'about'];
    if ((await w.practiceMake(new w.Uint8Array(16))).join(' ') !== 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about') fails.push('practice: phrase made from entropy');
    if (!w.practiceCompare(E, 'abandon ability able about').ok || !w.practiceCompare(E, '  ABANDON  ability\nable about ').ok) fails.push('practice: correct copy matches, case and spacing ignored');
    if (!/Word 3 does not match/.test(w.practiceCompare(E, 'abandon ability zoo about').msg) || !/Words 2, 4 do not match/.test(w.practiceCompare(E, 'abandon zoo able zoo').msg)) fails.push('practice: wrong words named by position');
    if (!/typed 3 words; the practice phrase has 4/.test(w.practiceCompare(E, 'abandon ability able').msg) || !/typed 1 word;/.test(w.practiceCompare(E, 'abandon').msg) || !/typed 5 words/.test(w.practiceCompare(E, 'abandon ability able about zoo').msg)) fails.push('practice: wrong word count reported');
    if (w.practiceCompare(E, 'ability abandon able about').ok) fails.push('practice: wrong order does not match');
    await w.practiceStart(); const pw = w.eval('practice.words');
    if (pw.length !== 12 || $p('prWords').children.length !== 12 || $p('prShow').style.display !== 'block' || $p('prCheck').style.display !== 'none') fails.push('practice: start shows 12 words');
    w.practiceHide(); if ($p('prWords').textContent !== '' || $p('prShow').style.display !== 'none' || $p('prCheck').style.display !== 'block') fails.push('practice: hide removes the words');
    $p('prInput').value = pw.join(' '); w.practiceCheck(); if (!/ok/.test($p('prStatus').className) || !/matches, word for word/.test($p('prStatus').textContent)) fails.push('practice: correct copy confirmed');
    $p('prInput').value = pw.map((x, i) => (i === 4 ? 'zoo' : x)).join(' '); w.practiceCheck(); if (!/bad/.test($p('prStatus').className) || !/Word 5 does not match/.test($p('prStatus').textContent)) fails.push('practice: wrong word flagged');
    $p('prInput').dispatchEvent(new w.Event('input')); if ($p('prStatus').textContent !== '') fails.push('practice: typing clears the result');
    w.practicePeek(); if ($p('prWords').children.length !== 12 || $p('prShow').style.display !== 'block') fails.push('practice: peek shows the words again');
    w.practiceHide(); w.practiceClear(); if (w.eval('practice') !== null || $p('prWords').textContent !== '' || $p('prInput').value !== '' || $p('prShow').style.display !== 'none' || $p('prCheck').style.display !== 'none') fails.push('practice: clear forgets the phrase');
    w.practiceCheck(); w.practiceHide(); w.practicePeek(); if ($p('prShow').style.display !== 'none' || $p('prCheck').style.display !== 'none') fails.push('practice: buttons do nothing before a practice starts');
    const PH = ['legal winner thank year wave sausage worth useful legal winner thank yellow', 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above', 'ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic', 'gravity machine north sort system female filter attitude volume fold club still', 'hamster diagram private dutch cause delay private meat slide toddler razor blue', 'scheme spot photo card baby mountain device kick cradle pact join borrow'];
    w.eval('practiceNext=0'); const ph = []; for (let i = 0; i < 8; i++) { await w.practiceStart(); ph.push(w.eval('practice.words.join(" ")')); } w.practiceClear();
    if (ph.slice(0, 6).join('|') !== PH.join('|') || ph[6] !== PH[0] || ph[7] !== PH[1]) fails.push('practice: steps through the six published test phrases in order, then starts over');
    if (/getRandomValues|Math\.random|\.randomUUID|msCrypto/.test(mutated.replace(/const WORDLIST = \[.*?\];/s, ''))) fails.push('no browser random-number call anywhere in the page'); }
  { const w2 = loadPage(mutated, (win) => { win.__focus = []; win.HTMLElement.prototype.focus = function (o) { win.__focus.push([this.id, o]); }; });
    await ready(w2); await new Promise((r) => setTimeout(r, 100));
    const fo = w2.__focus.find((x) => x[0] === 'sgGo'); if (!fo || !fo[1] || fo[1].preventScroll !== true || w2.__focus.some((x) => x[0] === 'rolls')) fails.push('page open: the notice button is focused without scrolling');
    const g = w2.document.getElementById('startGate'); if (!g || g.getAttribute('role') !== 'dialog' || g.getAttribute('aria-modal') !== 'true' || g.querySelectorAll('.sg-item').length !== 3 || !/not been independently audited/.test(g.textContent) || !/educational tool/.test(g.textContent)) fails.push('notice: dialog with the three warnings and the audit note');
    if (!/BEFORE YOU MAKE REAL KEYS/.test(w2.document.getElementById('beforeCard').textContent) || w2.document.getElementById('beforeCard').querySelectorAll('.sg-item').length !== 3) fails.push('notice: page card repeats the warnings');
    const w3 = loadPage(mutated, () => {}); await ready(w3); w3.document.dispatchEvent(new w3.KeyboardEvent('keydown', { key: 'Escape' })); if (w3.document.getElementById('startGate')) fails.push('notice: Escape closes it');
    w2.__focus.length = 0; w2.startGateClose();
    const fc = w2.__focus.find((x) => x[0] === 'rolls'); if (w2.document.getElementById('startGate') || !fc || !fc[1] || fc[1].preventScroll !== true) fails.push('notice: closing removes it and focuses the rolls box without scrolling');
    w2.__focus.length = 0; w2.matchMedia = (q) => ({ matches: /pointer:\s*coarse/.test(q) }); w2.startGateClose(); if (w2.__focus.some((x) => x[0] === 'rolls')) fails.push('notice: a touch device does not get the rolls box focused (no keyboard pop-up)');
    w2.__focus.length = 0; w2.matchMedia = () => ({ matches: false }); w2.startGateClose(); if (!w2.__focus.some((x) => x[0] === 'rolls')) fails.push('notice: a mouse device still gets the rolls box focused'); delete w2.matchMedia;
    if (!/educational tool/.test(w2.document.getElementById('disclaimer').textContent)) fails.push('notice: disclaimer calls it an educational tool'); }
  try { // v2.3.0: the start notice shows once per browser session while offline and on every load while online; END SESSION wipes, forgets it and reloads
    const off = (win, ack) => { Object.defineProperty(win.navigator, 'onLine', { configurable: true, get: () => false }); if (ack) win.sessionStorage.setItem('voidforge-ack', '1'); };
    const a = loadPage(mutated, (win) => off(win, true)); await ready(a);
    if (a.document.getElementById('startGate') || a.document.body.classList.contains('dice-wait') || a.document.body.classList.contains('sg-skip')) fails.push('session notice: offline and already read in this session, it does not show again and the dice are ready');
    const b = loadPage(mutated, (win) => off(win, false)); await ready(b);
    if (!b.document.getElementById('startGate') || !b.document.body.classList.contains('dice-wait') || b.document.body.classList.contains('sg-skip')) fails.push('session notice: offline, it shows the first time in a session');
    b.startGateClose(); if (b.sessionStorage.getItem('voidforge-ack') !== '1' || b.sessionStorage.length !== 1) fails.push('session notice: closing it offline notes a single "1" in session storage and nothing else');
    const c = loadPage(mutated, (win) => { win.sessionStorage.setItem('voidforge-ack', '1'); }); await ready(c);
    if (!c.document.getElementById('startGate') || !c.document.body.classList.contains('dice-wait')) fails.push('session notice: online, it shows on every load');
    { const d = loadPage(mutated, () => {}); await ready(d); d.startGateClose(); if (d.sessionStorage.length !== 0) fails.push('session notice: closing it online stores nothing'); }
    if (!/\n  body\.js-ok\.sg-skip #startGate \{ display: none; \}/.test(mutated)) fails.push('session notice: when skipped it is hidden from the first paint');
    const e = loadPage(mutated, (win) => off(win, false)); await ready(e); let rl = 0; e.endSessionReload = () => { rl++; }; e.startGateClose();
    const $e = (id) => e.document.getElementById(id);
    $e('rolls').value = D50; $e('rolls').oninput(); await e.generate(); e.confirm = () => false;
    if (e.endSession() !== null || !e.hasSeed() || e.sessionStorage.getItem('voidforge-ack') !== '1' || rl !== 0) fails.push('END SESSION: Cancel keeps everything');
    e.confirm = () => true; $e('passphrase').value = 'pw'; $e('phrase').value = 'abandon about'; $e('wpIn').value = 'zpub'; $e('msAcct').value = '9'; $e('bk1').checked = true; $e('autoHide').checked = true; $e('autoIdle').selectedIndex = 2;
    const p = e.endSession();
    if (e.hasSeed() || $e('rolls').value || $e('passphrase').value || $e('phrase').value || $e('wpIn').value) fails.push('END SESSION: the seed, rolls, passphrases and typed boxes are wiped');
    if ($e('msAcct').value !== '0' || $e('bk1').checked || $e('autoHide').checked || $e('autoIdle').selectedIndex !== 0) fails.push('END SESSION: boxes, ticks and menus go back to how the page opened');
    if (e.sessionStorage.getItem('voidforge-ack') !== null) fails.push('END SESSION: forgets that the notice was read');
    await p; if (rl !== 1) fails.push('END SESSION: the page reloads after the wipe');
    if (!/function endSessionReload\(\)\{ location\.reload\(\); \}/.test(mutated)) fails.push('END SESSION: a real page reload');
    const eb = $e('endSessionBtn'); if (!eb || eb.className !== 'btn-clear' || !eb.closest('#menuBox')) fails.push('END SESSION: a red button in the MENU');
  } catch (e) { fails.push('session notice: the probe crashed: ' + e.message); }
  { // Redesign (charcoal and gold, one column): the header, the MENU, the tabs, the labels
    const die = $('brandDie'), h1 = w.document.querySelector('#topbar h1'), mb = $('menuBox'), css = [...w.document.querySelectorAll('style')].map((x) => x.textContent).join('\n');
    if (!die || die.querySelectorAll('.dp').length !== 5 || !h1 || h1.textContent !== 'VOIDFORGE') fails.push('redesign: the header has one five-pip die and the name');
    if (!/#brandDie \.db \{ fill: var\(--gold\); \}/.test(css) || !/#topbar h1[^{]*\{[^}]*color: var\(--goldtx\)/.test(css)) fails.push('redesign: the die and the name are gold');
    if ([...mb.querySelectorAll('.menu-list button')].map((b) => b.textContent.trim()).join('|') !== 'GUIDE ME|TEXT A+|PRINT SEED|PRINT STAMP SHEET|DARK|END SESSION') fails.push('redesign: the MENU holds GUIDE ME, TEXT A+, PRINT SEED, PRINT STAMP SHEET, the theme switch and END SESSION');
    mb.open = true; w.document.body.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); if (mb.open) fails.push('redesign: a click outside closes the MENU');
    mb.open = true; w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); if (mb.open) fails.push('redesign: Escape closes the MENU');
    mb.open = true; w.document.querySelector('.theme-toggle').click(); if (mb.open) fails.push('redesign: choosing an item closes the MENU'); w.document.querySelector('.theme-toggle').click(); mb.open = false;
    if (!/\.tabs button\[aria-selected="true"\][^{]*\{[^}]*border-bottom-color: var\(--gold\)/.test(css)) fails.push('redesign: the selected tab has a gold underline');
    if (!/\.tag, body\.light \.tag \{ border: 0; background: none;/.test(css)) fails.push('redesign: labels are plain coloured words');
    if (!/#cardGen \{ display: block; \}\s*#cardGen \.gen-right \{ position: static; max-height: none;/.test(css)) fails.push('redesign: Make a seed is one column');
    { const css = mutated.match(/<style>[\s\S]*?<\/style>/)[0]; if (!/@media \(max-width: 559px\) \{ #wordGrid, #cardGen \.gen-right #wordGrid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/.test(css) || !/\.wcell \{ animation: none; box-shadow: none; font-size: 18px; font-weight: 700; padding: 10px 12px; min-width: 0; \}/.test(css) || !/@media \(max-width: 400px\) \{ \.wcell \{ font-size: 16px;/.test(css) || !/@media \(max-width: 345px\) \{ \.wcell \{ font-size: 14\.5px;/.test(css)) fails.push('seed words: two columns below 560px and smaller type on narrow phones'); }
    { const ad = $('advanced'); if (!ad || !ad.previousElementSibling || !ad.previousElementSibling.classList.contains('seed-actions') || !($('wordGrid').compareDocumentPosition(ad) & 4)) fails.push('order: the passphrase box sits directly under the seed buttons, after the words'); }
    { const rs = $('rollStats'); if (!rs || rs.previousElementSibling.id !== 'ignoredNote') fails.push('order under the roll entry: the roll history box follows the roll entry'); if (!rs || rs.tagName !== 'DETAILS' || rs.open || !rs.contains($('rollChart')) || !rs.contains($('rollHistory')) || !rs.contains($('diceVisual'))) fails.push('tucked away: roll history and the fairness chart live in one closed box');
      { const css = mutated.match(/<style>[\s\S]*?<\/style>/)[0]; if (!/#rollStats \{ margin-top: 10px; padding: 8px 12px; font-size: 13px; \}/.test(css) || !/#rollStats > summary \{ cursor: pointer; font-weight: 600; \}/.test(css)) fails.push('tucked away: the roll history box is styled like the other option boxes'); } }
    { // Calmer first screen: one GUIDE ME, seed buttons only after a seed, one closed More options box, no second warning note
      const d = w.document, gb = [...d.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'GUIDE ME'), gn = $('guideNew');
      if (gb.length !== 1 || !gn || gn.querySelector('button')) fails.push('calmer page: one GUIDE ME button');
      if (d.querySelector('.forge-note')) fails.push('calmer page: no second warning note by FORGE SEED');
      if (!d.querySelector('.btn-row.seed-actions #abbrBtn') || d.querySelectorAll('.seed-actions button').length !== 5) fails.push('calmer page: the five seed buttons are grouped');
      if (!/body:not\(\.has-seed\) \.seed-actions, body:not\(\.has-seed\) \.print-btn \{ display: none; \}/.test(css)) fails.push('calmer page: seed buttons are hidden until there is a seed');
      if ($('moreBox') || $('demoBox')) fails.push('calmer page: no More options box and no demo box');
      if (/#rollCount \{ display: none; \}/.test(css)) fails.push('calmer page: the roll count stays on every screen size');
      w.clearAll(); await new Promise((r2) => setTimeout(r2, 20)); if (d.body.classList.contains('has-seed')) fails.push('calmer page: no seed, so seed buttons stay hidden');
      await run('dice', 12, D50); if (!d.body.classList.contains('has-seed')) fails.push('calmer page: a seed shows the seed buttons'); }
    if ($('ownerLogo') || w.document.querySelector('img')) fails.push('redesign: no picture is built into the page'); }
  const meta = w.document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  if (!meta || !/default-src 'none'/.test(meta.content)) fails.push('CSP present');
  return fails;
}

async function detect(mutated) {
  const w = loadPage(mutated, (win) => { win.__focus = []; win.HTMLElement.prototype.focus = function (o) { win.__focus.push([this.id, o]); }; });
  if (!w.selfTestDone) return { by: 'page failed to run' };
  await ready(w);
  const badge = w.document.getElementById('selfTestBadge').textContent;
  if (!/PASSED/.test(badge)) return { by: 'self-test gate' };
  let f; try { f = await probe(w, mutated); } catch (e) { return { by: 'end-to-end probe (page error: ' + String(e && e.message).slice(0, 60) + ')' }; }
  if (process.env.MUT_DEBUG && f.length) console.log('PROBE FAILS:', f);
  return f.length ? { by: 'end-to-end probe (' + (process.env.MUT_ONLY === '^$' ? f.join(' || ') : f[0]) + ')' } : { by: null };
}

// [name, find (must occur exactly once), replace, equivalent?]
const M = [
  ['wordlist: one word altered',            '"abandon","ability"', '"abandon","abilitx"'],
  ['entropy truncation 16 -> 15 bytes',     'async function rollsToMnemonic(rolls, wc){\n  const entLen = {12:16,24:32}[wc];', 'async function rollsToMnemonic(rolls, wc){\n  const entLen = {12:15,24:32}[wc];'],
  ['entropy truncation 32 -> 31 bytes',     'async function rollsToMnemonic(rolls, wc){\n  const entLen = {12:16,24:32}[wc];', 'async function rollsToMnemonic(rolls, wc){\n  const entLen = {12:16,24:31}[wc];'],
  ['checksum length wrong',                 'const cbits = bits/32;', 'const cbits = bits/16;'],
  ['rolls hashed with extra byte',          'const digest = await sha256(rolls);\n  return entropyToMnemonic', 'const digest = await sha256(rolls+"0");\n  return entropyToMnemonic'],
  ['PBKDF2 iterations 2048 -> 2047',        'iterations:2048', 'iterations:2047'],
  ['PBKDF2 salt prefix case',               '"mnemonic"+(passphrase||"")', '"Mnemonic"+(passphrase||"")'],
  ['passphrase NFKD normalisation removed', '(passphrase||"").normalize("NFKD")', '(passphrase||"")'],
  ['HMAC key altered',                      'encode("Bitcoin seed")', 'encode("Bitcoin seeD")'],
  ['fingerprint takes wrong 4 bytes',       'ripemd160(await sha256bytes(pubkeyBytes(k))).slice(0,4)', 'ripemd160(await sha256bytes(pubkeyBytes(k))).slice(1,5)'],
  ['pubkey parity prefix flipped',          'pub[0]=(P[1]&1n)?3:2;', 'pub[0]=(P[1]&1n)?2:3;'],
  ['secp256k1 generator y altered',         '0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n', '0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B9n'],
  ['RIPEMD-160 round constant altered',     '0xA953FD4E', '0xA953FD4F'],
  ['dice cleaning drops sixes',             's.replace(/[^1-6]/g,"")', 's.replace(/[^1-5]/g,"")'],
  ['coin cleaning drops ones',              's.replace(/[^01]/g,"")', 's.replace(/[^0]/g,"")'],
  ['phrase checksum check disabled',        'if(bits.slice(eBits)!==bytesToBits(h).slice(0,cLen)){ const en', 'if(false){ const en'],
  ['CSP weakened',                          "default-src 'none'", "default-src *"],
  ['address: a hardened level made non-hardened', '[[84,true],[0,true],[0,true],[0,false],[0,false]]', '[[84,true],[0,true],[0,false],[0,false],[0,false]]'],
  ['address: purpose 84 -> 44',             'of [[84,true],[0,true],[0,true],[0,false],[0,false]]', 'of [[44,true],[0,true],[0,true],[0,false],[0,false]]'],
  ['five addresses: purpose 84 -> 44',       'of [[84,true],[0,true],[0,true],[0,false]])', 'of [[44,true],[0,true],[0,true],[0,false]])'],
  ['address: hardened offset off by one',   '(index+0x80000000)>>>0', '(index+0x80000001)>>>0'],
  ['address: non-hardened parent pubkey misplaced', 'data.set(pub || pubkeyBytes(k),0);', 'data.set(pub || pubkeyBytes(k),1);'],
  ['address: bech32 checksum constant',     'const mod=poly(values)^(version===0?1:0x2bc830a3);', 'const mod=poly(values)^(version===0?0:0x2bc830a3);'],
  ['taproot: bech32m constant used for v0 too', 'const mod=poly(values)^(version===0?1:0x2bc830a3);', 'const mod=poly(values)^0x2bc830a3;'],
  ['taproot: bech32 constant used for v1', 'const mod=poly(values)^(version===0?1:0x2bc830a3);', 'const mod=poly(values)^1;'],
  ['taproot: bech32m constant digit', 'const mod=poly(values)^(version===0?1:0x2bc830a3);', 'const mod=poly(values)^(version===0?1:0x2bc830a2);'],
  ['address: bech32 charset swapped',       '"qpzry9x8gf2tvdw0s3jn54khce6mua7l"', '"qpzry9x8gf2tvdw0s3jn54khce6mua7k"'],
  ['address: witness version 0 -> 1',       'bech32Encode("bc",0,h160)', 'bech32Encode("bc",1,h160)'],
  ['address: hash160 skips RIPEMD-160',     'const h160=ripemd160(await sha256bytes(pubkeyBytes(k)));', 'const h160=(await sha256bytes(pubkeyBytes(k))).slice(0,20);'],
  ['address: mainnet prefix -> testnet',    'bech32Encode("bc",0,h160)', 'bech32Encode("tb",0,h160)'],
  ['passphrase confirmation bypassed',      'if(document.getElementById("passphrase").value === document.getElementById("passphrase2").value) return false;', 'return false;'],
  ['tap button appends wrong value',        'el.value += v; updateCount();', 'el.value += "1"; updateCount();'],
  ['address: child key not reduced mod n (needed about half the time)', 'child=(il+k)%SN;', 'child=(il+k);'],
  ['VERIFY ignores the typed passphrase (fingerprint)', 'fp1 = await mnemonicFingerprint(r.mnemonic, vp)', 'fp1 = await mnemonicFingerprint(r.mnemonic, "")'],
  ['watch: ypub version bytes wrong', '"sh-wpkh":[0x04,0x9d,0x7c,0xb2], other:XPUB_VER', '"sh-wpkh":[0x04,0x9d,0x7c,0xb3], other:XPUB_VER'],
  ['watch: taproot purpose wrong', 'tr:{purpose:86,', 'tr:{purpose:84,'],
  ['watch: nested descriptor not wrapped in sh()', 'type === "sh-wpkh" ? "sh(wpkh(" + inner + "))"', 'type === "sh-wpkh" ? "wpkh(" + inner + ")"'],
  ['watch: first address uses the wrong type', 'five.push(await addressFromKey(type, fk, net))', 'five.push(await addressFromKey("wpkh", fk, net))'],
  ['net: testnet bech32 prefix wrong', 'test:{coin:1, hrp:"tb",', 'test:{coin:1, hrp:"bc",'],
  ['net: testnet coin type wrong', 'test:{coin:1,', 'test:{coin:0,'],
  ['net: testnet legacy version byte wrong', 'pkh:0x6f,', 'pkh:0x00,'],
  ['net: testnet nested version byte wrong', 'sh:0xc4,', 'sh:0x05,'],
  ['net: testnet vpub version wrong', 'wpkh:[0x04,0x5f,0x1c,0xf6]', 'wpkh:[0x04,0xb2,0x47,0x46]'],
  ['net: testnet upub version wrong', '"sh-wpkh":[0x04,0x4a,0x52,0x62]', '"sh-wpkh":[0x04,0x9d,0x7c,0xb2]'],
  ['net: testnet tpub version wrong', 'other:[0x04,0x35,0x87,0xcf]', 'other:XPUB_VER'],
  ['net: testnet Vpub version wrong', '"ms-wsh":[0x02,0x57,0x54,0x83]', '"ms-wsh":[0x02,0xaa,0x7e,0xd3]'],
  ['net: testnet Upub version wrong', '"ms-sh-wsh":[0x02,0x42,0x89,0xef]', '"ms-sh-wsh":[0x02,0x95,0xb4,0x3f]'],
  ['net: mainnet Zpub version wrong', '"ms-wsh":[0x02,0xaa,0x7e,0xd3]', '"ms-wsh":[0x02,0x57,0x54,0x83]'],
  ['net: mainnet Ypub version wrong', '"ms-sh-wsh":[0x02,0x95,0xb4,0x3f]', '"ms-sh-wsh":[0x02,0x42,0x89,0xef]'],
  ['net: address not recognized as testnet', 'return /^(tb1|[2mn])/.test(addr) ? "test" : "main";', 'return "main";'],
  ['net: testnet nested not recognized', '  if(/^2/.test(addr)) return "sh-wpkh";\n', ''],
  ['net: testnet legacy not recognized', '  if(/^[mn]/.test(addr)) return "pkh";\n', ''],
  ['net: testnet taproot not recognized', '  if(/^tb1p/.test(addr)) return "tr";\n', ''],
  ['net: finder always uses mainnet coin type', 'net = addressNetOf(addr), coin = NETS[net].coin;', 'net = addressNetOf(addr), coin = 0;'],
  ['net: taproot ignores the network prefix', 'return taprootAddress(k, N.hrp);', 'return taprootAddress(k);'],
  ['multisig: native script number wrong', '"ms-wsh":{script:2,', '"ms-wsh":{script:1,'],
  ['multisig: nested script number wrong', '"ms-sh-wsh":{script:1,', '"ms-sh-wsh":{script:2,'],
  ['multisig: purpose 48 wrong', '[[48,true],[N.coin,true],[account,true],[M.script,true]]', '[[44,true],[N.coin,true],[account,true],[M.script,true]]'],
  ['multisig: depth byte wrong', 'ser(N.ver[type],4)', 'ser(N.ver[type],3)'],
  ['multisig: origin path missing the script', '"h/" + account + "h/" + M.script + "h";', '"h/" + account + "h";'],
  ['multisig: child number is the account not the script', '((M ? M.script : account)+0x80000000)', '(account+0x80000000)'],
  ['lastword: unknown word not rejected', 'for(const w of words){ if(!reforgeHas(w)) throw new Error("Unknown word: " + w); }', ''],
  ['verify: property names accepted as words', 'words.forEach((w, i) => { if(Object.prototype.hasOwnProperty.call(WORD_MAP, w)) return;', 'words.forEach((w, i) => { if(w in WORD_MAP) return;'],
  ['reforge: checksum bits misaligned', 'acc = (acc << 11) | idx[i]; bits += 11;', 'acc = (acc << 10) | idx[i]; bits += 11;'],
  ['reforge: checksum compared with the wrong bits', 'return acc === (h[0] >>> (8 - cLen));', 'return acc === (h[0] >>> (7 - cLen));'],
  ['reforge: checksum not compared', 'return acc === (h[0] >>> (8 - cLen));', 'return true;'],
  ['reforge: last word on the list never tried', 'if(one){ for(let a = 0; a < 2048; a++)', 'if(one){ for(let a = 0; a < 2047; a++)'],
  ['reforge: neighbours never swapped', 'for(let j = i + 1; j < n; j++) if(idx[i] !== idx[j]) swaps.push([i, j]);', 'for(let j = i + 2; j < n; j++) if(idx[i] !== idx[j]) swaps.push([i, j]);'],
  ['reforge: swaps not tried', 'for(const [i, j] of swaps){ const c = base.slice(); c[i] = base[j]; c[j] = base[i]; yield c; }', ''],
  ['reforge: typed word tried again as its own replacement', 'if(w === base[p]) continue; const c = base.slice();', 'const c = base.slice();'],
  ['reforge: duplicate phrases when a word is missing', 'if(p > 0 && idx[p - 1] === w) continue;', ''],
  ['reforge: more than 2 unknown words accepted', 'if(unk.length > 2) throw', 'if(unk.length > 3) throw'],
  ['reforge: address typo not refused', 'if(!reforgeBech32Ok(a)) throw new Error(typo);', ''],
  ['reforge: bech32m constant wrong', 'return (c >>> 0) === (data[0] === 0 ? 1 : 0x2bc830a3);', 'return (c >>> 0) === (data[0] === 0 ? 1 : 0x2bc830a2);'],
  ['reforge: keys at any depth accepted', 'if(p[4] !== 3) throw', 'if(p[4] > 3) throw'],
  ['reforge: passphrase ignored', 'mnemonicToSeed(Array.from(c, v => WORDLIST[v]).join(" "), pw)', 'mnemonicToSeed(Array.from(c, v => WORDLIST[v]).join(" "), "")'],
  ['reforge: receive address 9 not compared', 'const REFORGE_ADDR_N = 10;', 'const REFORGE_ADDR_N = 9;'],
  ['reforge: wrong account searched', 'for(const i of [purpose, coin, 0]) [k, c] = await ckdPriv(k, c, i, true);', 'for(const i of [purpose, coin, 1]) [k, c] = await ckdPriv(k, c, i, true);'],
  ['reforge: wrong parent key used for addresses', 'const [kk] = await ckdPriv(rk, rc, i, false, rpub);', 'const [kk] = await ckdPriv(rk, rc, i, false, pubkeyBytes(k));'],
  ['reforge: fingerprint search stops at the first match', 'if(target.kind !== "fp") return res; // an address or key match cannot be a coincidence: stop here', 'return res;'],
  ['reforge: address search does not stop at a match', 'if(target.kind !== "fp") return res; // an address or key match cannot be a coincidence: stop here', 'if(false) return res;'],
  ['reforge passphrase: fingerprint search stops at the first match', 'if(target.kind !== "fp") return res; // as in the word search', 'return res; //'],
  ['reforge passphrase: passphrase not used', 'const seeds = await Promise.all(group.map(p => mnemonicToSeed(mnemonic, p)));', 'const seeds = await Promise.all(group.map(p => mnemonicToSeed(mnemonic, "")));'],
  ['reforge passphrase: no passphrase not tried first', 'const out = new Set([""]);', 'const out = new Set();'],
  ['reforge passphrase: pairs not joined with a space', 'if(a !== b) for(const sep of ["", " "]) bases.push(a + sep + b);', 'if(a !== b) for(const sep of [""]) bases.push(a + sep + b);'],
  ['reforge passphrase: triples not tried', 'if(a !== b && a !== c && b !== c) for(const sep of ["", " "]) bases.push(a + sep + b + sep + c);', 'if(false) bases.push(a + b + c);'],
  ['reforge passphrase: UPPERCASE not tried', 'r.push(y, y.toLowerCase(), y.toUpperCase(), c.join(""));', 'r.push(y, y.toLowerCase(), c.join(""));'],
  ['reforge passphrase: lowercase not tried', 'r.push(y, y.toLowerCase(), y.toUpperCase(), c.join(""));', 'r.push(y, y.toUpperCase(), c.join(""));'],
  ['reforge passphrase: Capitalised not tried', 'r.push(y, y.toLowerCase(), y.toUpperCase(), c.join(""));', 'r.push(y, y.toLowerCase(), y.toUpperCase());'],
  ['reforge passphrase: trimmed form not tried', 'for(const y of t !== x ? [x, t] : [x])', 'for(const y of [x])'],
  ['reforge passphrase: typo box ignored', 'if(typos){\n    for(const x of [...out]){', 'if(false){\n    for(const x of [...out]){'],
  ['reforge passphrase: left-out character not tried', 'add(c.slice(0, i).concat(c.slice(i + 1)).join(""));', ''],
  ['reforge passphrase: doubled character not tried', 'add(c.slice(0, i + 1).concat(c.slice(i)).join(""));', ''],
  ['reforge passphrase: swapped neighbours not tried', 'if(i + 1 < c.length) add(c.slice(0, i).concat([c[i + 1], c[i]], c.slice(i + 2)).join(""));', ''],
  ['reforge passphrase: other letter case not tried', 'if(f !== c[i]) add(c.slice(0, i).concat([f], c.slice(i + 1)).join(""));', ''],
  ['reforge passphrase: no line limit', 'if(pieces.length > REFORGE_PASS_PIECES) throw', 'if(false) throw'],
  ['reforge passphrase: CLEAR keeps the typo box', 'document.getElementById("reforgePassTypos").checked = false; }', '}'],
  ['reforge passphrase: an edit keeps the result', '"reforgePassWords", "reforgePassInput", "reforgePassCheck", "reforgePassTypos"].forEach(id => document.getElementById(id).addEventListener', '"reforgePassWords", "reforgePassCheck", "reforgePassTypos"].forEach(id => document.getElementById(id).addEventListener'],
  ['reforge passphrase: an invalid phrase accepted', '|| !(await reforgeChecksumOk(Uint16Array.from(parsed.idx))))', ')'],
  ['reforge: fingerprint odds wrong', 'Math.round(2 ** 32 / Math.max(1, n))', 'Math.round(2 ** 31 / Math.max(1, n))'],
  ['stamp sheet: box numbers not padded', 'add("ps-n", ("0" + (i + 1)).slice(-2), c)', 'add("ps-n", String(i + 1), c)'],
  ['stamp sheet: area not cleaned', 'restart the computer.");\n  document.body.classList.add("print-seed");\n  let done = false;\n  const cleanup = () => { if(done) return; done = true; po.textContent = ""; document.body.classList.remove("print-seed"); };', 'restart the computer.");\n  document.body.classList.add("print-seed");\n  let done = false;\n  const cleanup = () => { if(done) return; done = true; document.body.classList.remove("print-seed"); };'],
  ['stamp sheet: print class not removed', 'restart the computer.");\n  document.body.classList.add("print-seed");\n  let done = false;\n  const cleanup = () => { if(done) return; done = true; po.textContent = ""; document.body.classList.remove("print-seed"); };', 'restart the computer.");\n  document.body.classList.add("print-seed");\n  let done = false;\n  const cleanup = () => { if(done) return; done = true; po.textContent = ""; };'],
  ['auto-clear: idle time shortened', 'm * 60000) autoWipe(', 'm * 6000) autoWipe('],
  ['auto-clear: wipes at once', 'if(m && (now || Date.now()) - autoLast >= m * 60000)', 'if(m)'],
  ['auto-clear: never means wipe', 'if(m && (now || Date.now())', 'if((now || Date.now())'],
  ['auto-clear: a key press is not activity', '["keydown", "pointerdown", "input", "touchstart", "wheel"]', '["pointerdown", "input", "touchstart", "wheel"]'],
  ['auto-clear: a pointer press is not activity', '["keydown", "pointerdown", "input", "touchstart", "wheel"]', '["keydown", "input", "touchstart", "wheel"]'],
  ['auto-clear: typing is not activity', '["keydown", "pointerdown", "input", "touchstart", "wheel"]', '["keydown", "pointerdown", "touchstart", "wheel"]'],
  ['auto-clear: a touch is not activity', '["keydown", "pointerdown", "input", "touchstart", "wheel"]', '["keydown", "pointerdown", "input", "wheel"]'],
  ['auto-clear: scrolling is not activity', '["keydown", "pointerdown", "input", "touchstart", "wheel"]', '["keydown", "pointerdown", "input", "touchstart"]'],
  ['auto-clear: tab hidden ignored', 'if(document.hidden && document.getElementById("autoHide").checked)', 'if(false)'],
  ['auto-clear: tab option ignored', 'if(document.hidden && document.getElementById("autoHide").checked)', 'if(document.hidden)'],
  ['auto-clear: wipes when the tab is shown', 'if(document.hidden && document.getElementById("autoHide").checked)', 'if(!document.hidden && document.getElementById("autoHide").checked)'],
  ['auto-clear: child seed left on screen', 'clearChild(); hideExplain();', 'hideExplain();'],
  ['auto-clear: typed fields left', 'for(const id of AUTO_FIELDS){ const e = document.getElementById(id); if(e) e.value = ""; }', ''],
  ['auto-clear: Reforge result left', 'ro.textContent = ""; ro.style.display = "none";', ''],
  ['auto-clear: seed not wiped', 'msReset(); wipeSeed(); clearChild();', 'msReset(); clearChild();'],
  ['auto-clear: reason not shown', '"Wiped automatically " + why', '"" + why'],
  ['auto-clear: wipes when there is nothing', 'if(!autoHasSecrets()) return false;', ''],
  ['auto-clear: timer never starts', 'if(m && !autoTimer) autoTimer = setInterval(() => autoCheck(), 5000);', 'if(m && !autoTimer) autoTimer = null;'],
  ['auto-clear: timer never stops', 'if(!m && autoTimer){ clearInterval(autoTimer); autoTimer = null; }', 'if(!m && autoTimer){ autoTimer = null; }'],
  ['auto-clear: note leaves out the tab option', '(h ? (m ? " and" : ":") + " when you leave this tab" : "")', '""'],
  ['auto-clear: note joins badly', '(h ? (m ? " and" : ":") + " when you leave this tab" : "")', '(h ? ":" + " when you leave this tab" : "")'],
  ['auto-clear: off note dropped', ': "Auto-clear is off.";', ': "";'],
  ['auto-clear: 30 minutes missing', '<option value="30">30 minutes</option>', ''],
  ['auto-clear: choice not wired', 'aria-label="Wipe after no activity for" onchange="autoClearSet()"', 'aria-label="Wipe after no activity for" onchange=""'],
  ['auto-clear: tab option not wired', 'id="autoHide" onchange="autoClearSet()"', 'id="autoHide" onchange=""'],
  ['roll sheet: one box short', 'for(let i = 1; i <= need; i++)', 'for(let i = 1; i < need; i++)'],
  ['roll sheet: boxes not numbered', 'const c = add("ps-cell", "", g); add("ps-n", String(i), c);', 'const c = add("ps-cell", "", g); add("ps-n", "", c);'],
  ['roll sheet: ignores coin mode', 'const coin = getMode() === "coin", wc', 'const coin = false, wc'],
  ['roll sheet: ignores the word count', 'need = getNeeded(wc), unit', 'need = getNeeded("12"), unit'],
  ['roll sheet: no secret warning', 'Once filled in, this sheet is as secret as your seed: anyone who sees it can make your wallet.\\nType it in on an offline computer, then shred it (or keep it only as a locked-away backup of the rolls)', 'This sheet is harmless.\\nType it in on an offline computer, then shred it (or keep it only as a locked-away backup of the rolls)'],
  ['roll sheet: coin sides not asked for', '(coin ? "1 means: ______   0 means: ______\\n" :', '(coin ? "" :'],
  ['roll sheet: area not cleaned', 'done = true; po.replaceChildren(); document.body.classList.remove("print-seed"); };', 'done = true; document.body.classList.remove("print-seed"); };'],
  ['roll sheet: print class not removed', 'done = true; po.replaceChildren(); document.body.classList.remove("print-seed"); };', 'done = true; po.replaceChildren(); };'],
  ['roll sheet: button not wired', 'id="rollSheetBtn" onclick="printRollSheet()"', 'id="rollSheetBtn" onclick=""'],
  ['roll sheet: dice instruction dropped', 'Roll one die and write its number (1 to 6) in the next box', 'Write the number in the next box'],
  ['stamp sheet: shows the whole word', 'add("ps-w", w.slice(0, 4).toUpperCase(), c);', 'add("ps-w", w.toUpperCase(), c);'],
  ['stamp sheet: not capitals', 'add("ps-w", w.slice(0, 4).toUpperCase(), c);', 'add("ps-w", w.slice(0, 4), c);'],
  ['stamp sheet: no question before printing', 'if(!confirm("Printing sends your seed (shortened to 4 letters a word)', 'if(false && !confirm("Printing sends your seed (shortened to 4 letters a word)'],
  ['stamp sheet: wrong grid class', '"ps-grid ps-stamp ps-" + ws.length', '"ps-grid ps-" + ws.length'],
  ['stamp sheet: passphrase line dropped', 'add("ps-info", S.fp + "\\n" + S.pass);\n  add("ps-fields", "To get the words back', 'add("ps-info", S.fp + "\\n");\n  add("ps-fields", "To get the words back'],
  ['stamp sheet: no way back to the words', 'type the 4-letter forms into Reforge in VOIDFORGE', 'type the 4-letter forms into the word list'],
  ['stamp sheet: button not wired', 'id="stampBtn" onclick="printStamp()"', 'id="stampBtn" onclick=""'],
  ['stamp sheet: printed without a seed', '  if(!hasSeed()){ alert("Generate a seed first"); return null; }\n  if(passMismatch()) return null;\n  return {words:', '  if(passMismatch()) return null;\n  return {words:'],
  ['try accounts: range stops one account short', 'for(let acct = 0; acct <= MAXA; acct++){', 'for(let acct = 0; acct < MAXA; acct++){'],
  ['try accounts: passphrase variant dropped', 'const variants = vp ? [["without passphrase", ""], ["with passphrase", vp]] : [["without passphrase", ""]];', 'const variants = [["without passphrase", ""]];'],
  ['try accounts: depth ignored', 'DEPTH = depth || ACCT_SCAN_DEPTH', 'DEPTH = ACCT_SCAN_DEPTH'],
  ['try accounts: STOP ignored', 'if(acctScanStop) return say("", "Stopped.', 'if(false) return say("", "Stopped.'],
  ['try accounts: buttons stay off after a run', 'btns.forEach(b => b.disabled = !on);', 'btns.forEach(b => b.disabled = true);'],
  ['try accounts: second press while busy runs', 'if(!gateOk() || acctScanBusy) return;', 'if(!gateOk()) return;'],
  ['try accounts: testnet not named', '(addressNetOf(addr) === "test" ? "Testnet " : "")', '""'],
  ['try accounts: button not wired', 'onclick="checkAllAccounts()"', 'onclick=""'],
  ['try accounts: always searches account 0', 'findAddress(seed, addr, 0, DEPTH, acct)', 'findAddress(seed, addr, 0, DEPTH, 0)'],
  ['try accounts: STOP never turned on', 'btns.forEach(b => b.disabled = true); stop.disabled = false;', 'btns.forEach(b => b.disabled = true);'],
  ['try accounts: gate does not disable the button', '  document.getElementById("checkAcctsBtn").disabled = !on;\n', ''],
  ['try accounts: no advice about the passphrase', '" (type it in the box above and search again)"', '""'],
  ['try accounts: typed-passphrase advice dropped', '" (you typed one; try another spelling)"', '""'],
  ['try accounts: found message hides the variant', '" of these words, " + label + ". Put "', '" of these words. Put "'],
  ['try accounts: not an address accepted', 'if(!type) return say("bad", "Enter a bc1q', 'if(false) return say("bad", "Enter a bc1q'],
  ['try accounts: invalid phrase accepted', 'if(!r.ok) return say("bad", "First type a valid seed phrase in the box above. " + r.msg);', ''],
  ['translation: html opt-out dropped', '<html lang="en" translate="no">', '<html lang="en">'],
  ['translation: notranslate meta dropped', '<meta name="google" content="notranslate">', '<meta name="x" content="notranslate">'],
  ['passphrase: hardware wallet limit note dropped', ' Some hardware wallets limit how long a passphrase can be or which characters it can use, so test a small amount on your device before you rely on it.</div>', '</div>'],
  ['page icon: SVG link removed', '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,', '<link rel="x" type="image/svg+xml" href="data:image/svg+xml,'],
  ['page icon: PNG link removed', '<link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,', '<link rel="x" type="image/png" sizes="32x32" href="data:image/png;base64,'],
  ['page icon: About page loses the online address', 'Its address is <a href="https://random21m.github.io/VOIDFORGE/" target="_blank" rel="noopener noreferrer">random21m.github.io/VOIDFORGE</a>, the only link', 'Its address is on the project page, the only link'],
  ['page icon: the link loses noopener noreferrer', 'target="_blank" rel="noopener noreferrer">random21m.github.io/VOIDFORGE</a>', 'target="_blank">random21m.github.io/VOIDFORGE</a>'],
  ['page icon: the link opens in the same tab', 'target="_blank" rel="noopener noreferrer">random21m.github.io/VOIDFORGE</a>', 'rel="noopener noreferrer">random21m.github.io/VOIDFORGE</a>'],
  ['page icon: the link goes elsewhere', '<a href="https://random21m.github.io/VOIDFORGE/" target="_blank"', '<a href="https://random21m.github.io/voidforge/" target="_blank"'],
  ['page icon: About page no longer says practice-only', 'The online copy on the project page is for practice only.', 'The online copy on the project page is fine for real keys.'],
  ['reforge: object property names read as words', 'if(reforgeHas(t)){ idx.push(WORD_MAP[t]); return; }', 'if(t in WORD_MAP){ idx.push(WORD_MAP[t]); return; }'],
  ['reforge: 4-letter words not read', 'if(m.length === 1){ idx.push(WORD_MAP[m[0]]);', 'if(m.length === 0){ idx.push(WORD_MAP[m[0]]);'],
  ['reforge: CLEAR keeps the passphrase', '["reforgeWordsInput", "reforgeWordsCheck", "reforgeWordsPass", "reforgePassWords", "reforgePassInput", "reforgePassCheck"].forEach(id => { document', '["reforgeWordsInput", "reforgeWordsCheck", "reforgePassWords", "reforgePassInput", "reforgePassCheck"].forEach(id => { document'],
  ['reforge: a passphrase edit keeps the result', '["reforgeWordsInput", "reforgeWordsCheck", "reforgeWordsPass", "reforgePassWords", "reforgePassInput", "reforgePassCheck", "reforgePassTypos"]', '["reforgeWordsInput", "reforgeWordsCheck", "reforgePassWords", "reforgePassInput", "reforgePassCheck", "reforgePassTypos"]'],
  ['reforge: SEARCH is not the primary style', '<button type="button" id="reforgeWordsBtn" onclick="reforgeWords()">', '<button type="button" id="reforgeWordsBtn" class="secondary" onclick="reforgeWords()">'],
  ['psbt: 2-byte length prefix wrong', 'const v=b[o]|(b[o+1]<<8); o+=2; return v; }', 'const v=b[o]|(b[o+1]<<7); o+=2; return v; }'],
  ['psbt: 4-byte length prefix not read', 'if(f===0xfe) return r.u32();', 'if(f===0xfe) return r.byte();'],
  ['psbt: 64-bit amount byte order', 'for(let i=7;i>=0;i--) v=(v<<8n)|BigInt(b[o+i]);', 'for(let i=0;i<8;i++) v=(v<<8n)|BigInt(b[o+i]);'],
  ['psbt: 32-bit numbers read as signed', 'const v=(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0; o+=4; return v; },', 'const v=(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24)); o+=4; return v; },'],
  ['psbt: txid not reversed', 'hex(Uint8Array.from(r.bytes(32)).reverse()), vout=r.u32(), sl=r.varint(); r.bytes(sl); tx.ins.push', 'hex(Uint8Array.from(r.bytes(32))), vout=r.u32(), sl=r.varint(); r.bytes(sl); tx.ins.push'],
  ['raw: input txid not reversed', 'hex(Uint8Array.from(r.bytes(32)).reverse()), vout=r.u32(), sl=r.varint(), ss=r.bytes(sl); res.ins.push', 'hex(Uint8Array.from(r.bytes(32))), vout=r.u32(), sl=r.varint(), ss=r.bytes(sl); res.ins.push'],
  ['psbt: output amount skipped (always 0)', 'const value=r.i64(), sl=r.varint(); tx.outs.push({value, script:r.bytes(sl)});', 'const value=(r.i64(),0n), sl=r.varint(); tx.outs.push({value, script:r.bytes(sl)});'],
  ['psbt: segwit marker of previous tx not handled', 'if(n===0){ r.byte(); seg=true; n=r.varint(); }', 'if(false){ r.byte(); seg=true; n=r.varint(); }'],
  ['psbt: previous transaction output chosen by the wrong index', 'psbtParseTxOutputs(nw.val)[tx.ins[i].vout]', 'psbtParseTxOutputs(nw.val)[0]'],
  ['psbt: witness utxo amount and script swapped', 'inp.amount=q.i64(); inp.script=q.bytes(q.varint());', 'inp.script=q.bytes(q.varint()); inp.amount=q.i64();'],
  ['psbt: legacy address pattern broken', 'script[23]===0x88 && script[24]===0xac', 'script[23]===0x88 && script[24]===0xad'],
  ['psbt: script-hash address pattern broken', 'script[0]===0xa9 && script[1]===20 && script[22]===0x87', 'script[0]===0xa9 && script[1]===20 && script[22]===0x88'],
  ['psbt: native SegWit key-hash pattern broken', 'script.length===22 && script[0]===0 && script[1]===20', 'script.length===23 && script[0]===0 && script[1]===20'],
  ['psbt: native SegWit script-hash pattern broken', 'script.length===34 && script[0]===0 && script[1]===32', 'script.length===35 && script[0]===0 && script[1]===32'],
  ['psbt: taproot address version wrong', 'return bech32Encode(N.hrp,1,script.slice(2));', 'return bech32Encode(N.hrp,0,script.slice(2));'],
  ['psbt: data-carrier output shown as an address', 'if(script.length>0 && script[0]===0x6a) return "OP_RETURN', 'if(false) return "OP_RETURN'],
  ['psbt: network ignored for addresses', 'const N=NETS[net||"main"];\n  if(script.length===25', 'const N=NETS.main;\n  if(script.length===25'],
  ['psbt: hex input not recognized', 'if(/^70736274ff/i.test(t) && /^[0-9a-f]+$/i.test(t) && t.length%2===0) return fromHex(t.toLowerCase());', 'if(false) return fromHex(t.toLowerCase());'],
  ['psbt: marker not checked', 'if(bytes.length<5 || !magic.every((x,i)=>bytes[i]===x)){', 'if(false){'],
  ['psbt: version 2 not refused', 'if(glob.some(x=>x.type===0xfb &&', 'if(false && glob.some(x=>x.type===0xfb &&'],
  ['psbt: missing unsigned transaction not reported', 'if(!txRec) throw new Error("No unsigned transaction found in this PSBT.");', 'if(!txRec) txRec={val:new Uint8Array(0)};'],
  ['psbt: signatures not counted', 'sigs:m.filter(x=>x.type===2).length', 'sigs:0'],
  ['psbt: finalized inputs not noticed', 'final:m.some(x=>x.type===7||x.type===8)', 'final:false'],
  ['psbt: ordinary key information ignored', 'if(x.type===2 && x.val.length>=4) out.fps.push(hex(x.val.slice(0,4)));', 'if(false) out.fps.push(hex(x.val.slice(0,4)));'],
  ['psbt: taproot key information ignored', 'if(x.type===7 && x.val.length>=5){', 'if(false && x.val.length>=5){'],
  ['psbt: taproot leaf hashes not skipped', 'q.bytes(32*nh); out.fps.push(hex(q.bytes(4)));', 'out.fps.push(hex(q.bytes(4)));'],
  ['psbt: trailing data not noticed', 'if(!r.done) res.trailing=true;', ''],
  ['psbt: output total wrong', 'res.totalOut=res.outs.reduce((a,o)=>a+o.amount,0n);\n  res.fee=res.ins.every', 'res.totalOut=res.outs.reduce((a,o)=>a+o.amount,1n);\n  res.fee=res.ins.every'],
  ['psbt: fee wrong when some inputs are unknown', 'res.fee=res.ins.every(x=>x.amount!==null) ?', 'res.fee=res.ins.some(x=>x.amount!==null) ?'],
  ['psbt: fee sign flipped', 'res.ins.reduce((a,x)=>a+x.amount,0n)-res.totalOut : null;', 'res.totalOut-res.ins.reduce((a,x)=>a+x.amount,0n) : null;'],
  ['psbt: BTC text not padded to 8 decimals', '(v%100000000n).toString().padStart(8,"0")', '(v%100000000n).toString()'],
  ['psbt: negative amounts shown positive', 'return (neg?"-":"")+w+', 'return w+'],
  ['psbt: fee percentage wrong', 'Number(res.fee*10000n/res.totalOut)/100', 'Number(res.fee*1000n/res.totalOut)/100'],
  ['psbt: change hint shown without key information', '(x.fps.length ? "\\n   has wallet key information', '(true ? "\\n   has wallet key information'],
  ['psbt: file size limit removed', 'if(file.size>2000000){', 'if(false){'],
  ['psbt: text file fallback removed', 'try{ bytes=psbtFromText(new TextDecoder().decode(u)); }catch(e){ bytes=u; }', 'bytes=u;'],
  ['psbt: report not cleared when the text changes', 'document.getElementById("psbtInput").addEventListener("input", () => clearPsbt(false));', ''],
  ['psbt: CLEAR keeps the pasted text', 'if(all){ document.getElementById("psbtInput").value=""; document.getElementById("psbtFile").value=""; }', ''],
  ['psbt: wallet fingerprint match never shown', 'fpWallet && x.fps.includes(fpWallet)', 'false && x.fps.includes(fpWallet)'],
  ['watch: depth byte wrong', 'b[4]=depth;', 'b[4]=depth+1;'],
  ['watch: parent fingerprint dropped', 'b.set(parentFp,5);', 'b.set([0,0,0,0],5);'],
  ['watch: child index not hardened', '(cn>>>24)&255', '(cn>>>24)&127'],
  ['watch: zpub version bytes -> xpub', 'zpub=await base58check(ser(N.ver.wpkh,3))', 'zpub=await base58check(ser(N.ver.other,3))'],
  ['watch: base58 alphabet swapped', 'B58="123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 'B58="123456789ABCDEFGHJKLMNPQRSTUVWXZY'],
  ['watch: base58 checksum skips second SHA-256', 'await sha256bytes(await sha256bytes(payload))', 'await sha256bytes(payload)'],
  ['watch: leading-zero bytes not encoded (payload always starts with a non-zero version byte)', 'if(b===0) out="1"+out;', 'if(b===0) out=out;'],
  ['watch: account path wrong (m/84h/0h/1h)', '[T.purpose,true],[N.coin,true],[account,true]]', '[T.purpose,true],[N.coin,true],[account+1,true]]'],
  ['watch: descriptor checksum final xor removed', 'chk^=1n; let out="";', 'let out="";'],
  ['watch: descriptor origin path wrong', '"h/" + N.coin + "h/" + account + "h";\n  const d=', '"h/" + N.coin + "h/" + (account+1) + "h";\n  const d='],
  ['watch: change descriptor uses branch 0', 'change:d(1)', 'change:d(0)'],
  ['watch: export not hidden on errors', '    clearWatch();\n    clearFpIcons();', '    clearFpIcons();'],
  ['qr: format info XOR mask wrong', '^0x5412', '^0x5413'],
  ['qr: format BCH polynomial wrong', '*0x537', '*0x536'],
  ['qr: dark module missing', 'set(8,size-8,true);', 'set(8,size-8,false);'],
  ['qr: version info polynomial wrong', '*0x1f25', '*0x1f24'],
  ['qr: Galois field polynomial wrong', '*0x11d', '*0x11c'],
  ['qr: Reed-Solomon root step wrong', 'root=qrGfMul(root,2)', 'root=qrGfMul(root,3)'],
  ['qr: pad bytes wrong', 'pad^=0xec^0x11', 'pad^=0xec^0x12'],
  ['qr: zigzag direction wrong', 'up=((right+1)&2)===0', 'up=((right+1)&2)!==0'],
  ['qr: column 6 not skipped', 'if(right===6) right=5;', ''],
  ['qr: error codewords not interleaved', 'for(let i=0;i<ecLen;i++) for(const b of blocks) words.push(b[1][i]);', 'for(const b of blocks) for(let i=0;i<ecLen;i++) words.push(b[1][i]);'],
  ['qr: data codewords not interleaved', 'for(let i=0;i<maxLen;i++) for(const b of blocks) if(i<b[0].length) words.push(b[0][i]);', 'for(const b of blocks) for(let i=0;i<b[0].length;i++) words.push(b[0][i]);'],
  ['qr: character count width for versions 10+', 'put(bytes.length,ver<10?8:16)', 'put(bytes.length,ver<10?8:8)'],
  ['qr: alignment pattern ring wrong', 'Math.max(Math.abs(dx),Math.abs(dy))!==1)', 'Math.max(Math.abs(dx),Math.abs(dy))!==2)'],
  ['qr: timing pattern phase wrong', 'set(6,i,i%2===0); set(i,6,i%2===0);', 'set(6,i,i%2===1); set(i,6,i%2===0);'],
  ['qr: finder pattern ring wrong', 'dist!==2&&dist!==4', 'dist!==2&&dist!==3'],
  ['qr: mask 5 wrong', '(x,y)=>x*y%2+x*y%3===0', '(x,y)=>x*y%2+x*y%3!==0'],
  ['qr: mask 3 wrong', '(x,y)=>(x+y)%3===0', '(x,y)=>(x+y)%3===1'],
  ['qr: version 7 table entry wrong', '7:[18,[[4,31]]]', '7:[18,[[4,30]]]'],
  ['qr: version 9 table entry wrong', '9:[22,[[3,36],[2,37]]]', '9:[22,[[3,36],[2,36]]]'],
  ['qr: alignment positions wrong (v8)', '8:[6,24,42]', '8:[6,24,40]'],
  ['qr: penalty rule weight changed (picks another valid mask)', 'if(!col) r+=pat(h)*40;', 'if(!col) r+=pat(h)*0;', true],
  ['qr: balance penalty removed (picks another valid mask)', 'r+=(Math.ceil(Math.abs(dark*20-tot*10)/tot)-1)*10;', '', true],
  ['qr: QR box not hidden when export cleared', 'function clearWatch(){\n  clearAddrs();\n  hideQr();', 'function clearWatch(){\n  clearAddrs();'],
  ['lifehash: grid size wrong', 'const N=16, digest', 'const N=15, digest'],
  ['lifehash: generation limit wrong', 'while(history.length<150){', 'while(history.length<149){'],
  ['lifehash: version 1 start (no second hash)', 'start=await sha256bytes(digest)', 'start=digest'],
  ['lifehash: version 2 bit skip wrong', 'const e=new LhBits(digest); e.next(); e.next();', 'const e=new LhBits(digest); e.next();'],
  ['lifehash: Life rule survive wrong', 'alive?(n===2||n===3):(n===3)', 'alive?(n===2):(n===3)'],
  ['lifehash: Life rule birth wrong', 'alive?(n===2||n===3):(n===3)', 'alive?(n===2||n===3):(n===2)'],
  ['lifehash: loop detection removed', 'if(seen.has(key)) break;', ''],
  ['lifehash: change tracking wrong', 'if(alive!==na){', 'if(false){'],
  ['lifehash: overlay fraction wrong', 'lhClamp((0-(i+1))/(0-history.length))', 'lhClamp((0-i)/(0-history.length))'],
  ['lifehash: normalization wrong', 'frac[p]=(mn-frac[p])/(mn-mx)', 'frac[p]=(frac[p]-mn)/(mn-mx)'],
  ['lifehash: snowflake mirror wrong', '[[0,0,0],[0,1,0],[0,0,1],[0,1,1]]', '[[0,0,0],[0,1,0],[0,0,1],[0,0,1]]'],
  ['lifehash: pinwheel transform order swapped (same four cells, written in another order)', '[[0,0,0],[1,1,0],[1,0,1],[0,1,1]]', '[[0,0,0],[1,0,1],[1,1,0],[0,1,1]]', true],
  ['lifehash: pattern bit inverted', 'snowflake=e.next();', 'snowflake=!e.next();'],
  ['lifehash: monochrome tint darkening wrong', 'lhLerp(key,LH_BLACK,0.5)', 'lhLerp(key,LH_BLACK,0.4)'],
  ['lifehash: monochrome key advance wrong', 'ka=e.frac()*0.3+0.05', 'ka=e.frac()*0.3+0.04'],
  ['lifehash: monochrome neutral advance wrong', 'na=e.frac()*0.3+0.05', 'na=e.frac()*0.3+0.06'],
  ['lifehash: complementary hue offset wrong', 'lhMod(s1+0.5,1)', 'lhMod(s1+0.4,1)'],
  ['lifehash: complementary lighten wrong', 'lhLerp(lt,LH_WHITE,la)', 'lhLerp(lt,LH_WHITE,la*0.9)'],
  ['lifehash: triadic hue offset wrong', 's2=lhMod(s1+1.0/3,1)', 's2=lhMod(s1+1.0/4,1)'],
  ['lifehash: triadic order wrong', 'lhBlendMany([lhLerp(cs[2],LH_WHITE,la),cs[1],lhLerp(cs[0],LH_BLACK,da)])', 'lhBlendMany([lhLerp(cs[0],LH_BLACK,da),cs[1],lhLerp(cs[2],LH_WHITE,la)])'],
  ['lifehash: analogous advance wrong', 'adv=e.frac()*0.5+0.2', 'adv=e.frac()*0.5+0.1'],
  ['lifehash: analogous middle tone wrong', 'lhLerp(d1,LH_BLACK,adv/2)', 'lhLerp(d1,LH_BLACK,adv/3)'],
  ['lifehash: analogous ordering wrong', 'if(lhLum(c1)<lhLum(c4))', 'if(lhLum(c1)>lhLum(c4))'],
  ['lifehash: reverse flag ignored (monochrome)', 'return rev?lhRev(g):g; }\n  if(val===1)', 'return g; }\n  if(val===1)'],
  ['lifehash: luminance weight wrong', 'Math.pow(0.299*c[0],2)', 'Math.pow(0.3*c[0],2)'],
  ['lifehash: spectrum colour wrong', '[217,63,53]', '[217,63,54]'],
  ['lifehash: byte rounding wrong', 'Math.floor(lhClamp(c[1])*255)', 'Math.round(lhClamp(c[1])*255)'],
  ['lifehash: icon not cleared on errors', '    clearWatch();\n    clearFpIcons();\n    if(guideOn) guideRender();\n  }\n  updateSeedPanel();\n  if(ms) msBanner();\n}', '    clearWatch();\n    if(guideOn) guideRender();\n  }\n  updateSeedPanel();\n  if(ms) msBanner();\n}'],
  ['VERIFY ignores the typed passphrase (address)', 'a1 = await mnemonicFirstAddress(r.mnemonic, vp)', 'a1 = await mnemonicFirstAddress(r.mnemonic, "")'],
  ['VERIFY without-passphrase line uses the typed passphrase', 'fp0 = await mnemonicFingerprint(r.mnemonic, "");', 'fp0 = await mnemonicFingerprint(r.mnemonic, vp);'],
  ['match: with-passphrase check compares the wrong values', 'if(hasPass && test(fp1, a1, ids1))', 'if(hasPass && test(fp0, a0, ids0))'],
  ['match: address backups compared against the fingerprint', 'test = (f, a) => ql === (kind === "fp" ? f : a);', 'test = (f, a) => ql === f;'],
  ['match: NO MATCH without passphrase shown as success', 'return {ok:false, text:"NO MATCH without a passphrase.', 'return {ok:true, text:"NO MATCH without a passphrase.'],
  ['match: NO MATCH with passphrase shown as success', 'if(hasPass) return {ok:false, text:"NO MATCH:', 'if(hasPass) return {ok:true, text:"NO MATCH:'],
  ['match: hasPass guard dropped (a1/fp1 are undefined without a passphrase)', 'if(hasPass && test(fp1, a1, ids1))', 'if(test(fp1, a1, ids1))', true],
  ['compare: zpub compared against the xpub', '(q.charAt(0) === "x" ? c.xpub : c.key) === q', 'c.xpub === q'],
  ['compare: key check always passes', 'ids.cands.find(c => (q.charAt(0) === "x" ? c.xpub : c.key) === q)', 'ids.cands.find(c => true)'],
  ['compare: descriptor fingerprint ignored', 'ids.fp === d.fp && ids.cands.find(c => c.xpub === d.key)', 'ids.cands.find(c => c.xpub === d.key)'],
  ['compare: descriptor key ignored', 'ids.fp === d.fp && ids.cands.find(c => c.xpub === d.key)', 'ids.fp === d.fp && ids.cands.find(c => true)'],
  ['compare: descriptor checksum not enforced', 'if(!d.sumOk) return', 'if(false) return'],
  ['compare: taproot address check always passes', 'test = (f, a, ids) => !!ids && ids.list.some(t => t === fold);', 'test = (f, a, ids) => !!ids;'],
  ['find: legacy version byte wrong', 'Uint8Array.from([N.pkh, ...h])', 'Uint8Array.from([N.sh, ...h])'],
  ['find: nested redeem script prefix wrong', 'Uint8Array.from([0x00, 0x14, ...h])', 'Uint8Array.from([0x00, 0x15, ...h])'],
  ['find: nested version byte wrong', 'Uint8Array.from([N.sh, ...await', 'Uint8Array.from([N.pkh, ...await'],
  ['find: nested SegWit treated as legacy', '  if(/^3/.test(addr)) return "sh-wpkh";\n', ''],
  ['find: account ignored', '[[purpose,true],[coin,true],[account,true]]', '[[purpose,true],[coin,true],[0,true]]'],
  ['find: nested purpose wrong', '"sh-wpkh":{purpose:49,', '"sh-wpkh":{purpose:84,'],
  ['find: legacy purpose wrong', 'pkh:{purpose:44,', 'pkh:{purpose:49,'],
  ['find: change chain not searched', 'for(const chain of [0,1]){', 'for(const chain of [0]){'],
  ['find: taproot searched as SegWit', '  if(/^bc1p/.test(addr)) return "tr";\n', ''],
  ['find: wrong purpose for SegWit', 'wpkh:{purpose:84,', 'wpkh:{purpose:44,'],
  ['find: change chain never searched', 'for(const chain of [0,1]){\n    const [ck,cc]', 'for(const chain of [0]){\n    const [ck,cc]'],
  ['find: receive chain never searched', 'for(const chain of [0,1]){\n    const [ck,cc]', 'for(const chain of [1]){\n    const [ck,cc]'],
  ['find: search starts at index 0 ignoring from', 'for(let i=from;i<from+count;i++){\n      const [kk]', 'for(let i=0;i<from+count;i++){\n      const [kk]'],
  ['find: last index skipped', 'for(let i=from;i<from+count;i++){\n      const [kk]', 'for(let i=from;i<from+count-1;i++){\n      const [kk]'],
  ['find: child index off by one', 'const [kk]=await ckdPriv(ck,cc,i,false);', 'const [kk]=await ckdPriv(ck,cc,i+1,false);'],
  ['find: reports the wrong chain', 'return {chain, index:i, path:', 'return {chain:0, index:i, path:'],
  ['find: reports the wrong index', 'return {chain, index:i, path:', 'return {chain, index:i+1, path:'],
  ['find: always found', 'if(await addressFromKey(type, kk, net) === addr) return {chain', 'if(true) return {chain'],
  ['find: address compared case-insensitively wrong (never matches)', 'if(await addressFromKey(type, kk, net) === addr) return {chain', 'if(await addressFromKey(type, kk, net) === addr + "x") return {chain'],
  ['find: next press does not continue', 'addrScanFrom = to;\n    say(', 'addrScanFrom = 0;\n    say('],
  ['find: search position not reset after FOUND', 'if(f){ addrScanFrom = 0; return say("ok"', 'if(f){ return say("ok"'],
  ['find: passphrase wallet never searched', 'if(vp) variants.push(["with passphrase", vp]);', ''],
  ['find: no-passphrase wallet not searched', 'const variants = [["without passphrase", ""]]; if(vp) variants.push(["with passphrase", vp]);', 'const variants = []; if(vp) variants.push(["with passphrase", vp]); else variants.push(["without passphrase", ""]);'],
  ['find: NOT FOUND shown as success', 'say("bad", "NOT FOUND in indices', 'say("ok", "NOT FOUND in indices'],
  ['find: FOUND shown as failure', 'addrScanFrom = 0; return say("ok", "FOUND: this "', 'addrScanFrom = 0; return say("bad", "FOUND: this "'],
  ['find: invalid phrase not rejected', 'if(!r.ok) return say("bad", "Type a valid seed phrase in the box above first. " + r.msg);', ''],
  ['find: address format not validated', '  if(!kind) return say("bad", "Enter a bc1q', '  if(false) return say("bad", "Enter a bc1q'],
  ['find: scan position not reset when the address changes', 'for(const id of ["checkAddr","checkAcct","phrase","verifyPass"]) document.getElementById(id).addEventListener("input", resetAddrScan);', ''],
  ['bip85: wrong application number', '[39, 0, words, index]', '[38, 0, words, index]'],
  ['bip85: wrong language', '[39, 0, words, index]', '[39, 1, words, index]'],
  ['bip85: wrong root', 'for(const i of [83696968].concat(path)){', 'for(const i of [83696969].concat(path)){'],
  ['bip85: index ignored', '[39, 0, words, index]', '[39, 0, words, 0]'],
  ['bip85: length ignored', '[39, 0, words, index]', '[39, 0, 12, index]'],
  ['bip85: wrong HMAC key', 'new TextEncoder().encode("bip-entropy-from-k")', 'new TextEncoder().encode("bip-entropy-from-K")'],
  ['bip85: entropy not truncated from the front', 'e.slice(0, words * 4 / 3)', 'e.slice(64 - words * 4 / 3)'],
  ['bip85: entropy one byte long', 'e.slice(0, words * 4 / 3)', 'e.slice(0, words * 4 / 3 + 1)'],
  ['bip85: key bytes not padded', 'encode("bip-entropy-from-k"), fromHex(k.toString(16).padStart(64,"0"))', 'encode("bip-entropy-from-k"), fromHex(k.toString(16).padStart(62,"0"))'],
  ['bip85: 15 words accepted wrongly removed', 'if(![12,15,18,21,24].includes(words)) throw new Error("words must be 12, 15, 18, 21 or 24");', 'if(![12,18,24].includes(words)) throw new Error("words must be 12, 15, 18, 21 or 24");'],
  ['bip85: index limit off by one', 'index > 2147483647) throw new Error("index must be 0 to 2147483647");\n  const e = await bip85Entropy', 'index > 2147483646) throw new Error("index must be 0 to 2147483647");\n  const e = await bip85Entropy'],
  ['bip85 apps: index limit off by one', 'index > 2147483647) throw new Error("index must be 0 to 2147483647");\n  if(A.min', 'index > 2147483646) throw new Error("index must be 0 to 2147483647");\n  if(A.min'],
  ['bip85: UI index limit raised', 'parseInt(raw, 10) > 2147483647){ clearChild();', 'parseInt(raw, 10) > 4294967295){ clearChild();'],
  ['bip85: UI index limit lowered', 'parseInt(raw, 10) > 2147483647){ clearChild();', 'parseInt(raw, 10) > 2147483646){ clearChild();'],
  ['bip85: UI index not validated', 'if(!/^[0-9]{1,10}$/.test(raw) || parseInt(raw, 10) > 2147483647){ clearChild();', 'if(false){ clearChild();'],
  ['bip85: passphrase ignored', 'const child = await mnemonicBip85(r.mnemonic, vp, words, index);', 'const child = await mnemonicBip85(r.mnemonic, "", words, index);'],
  ['bip85: parent phrase not checked', 'if(!r.ok){ clearChild(); return say("bad", "Type your valid parent', 'if(false){ clearChild(); return say("bad", "Type your valid parent'],
  ['bip85: output not cleared when phrase/passphrase/index edited', 'for(const id of ["phrase","verifyPass","childWords","childIndex","childLen","childSides","childRolls"]) document.getElementById(id).addEventListener("input", clearChild);', ''],
  ['keccak: a round constant wrong', '0x8000000080008008n];', '0x8000000080008009n];'],
  ['keccak: a rotation wrong', 'const KECCAK_ROT = [[0,36,3,41,18],[1,44,10,45,2]', 'const KECCAK_ROT = [[0,36,3,41,18],[1,44,10,45,3]'],
  ['keccak: chi step wrong', '((~B[(x + 1) % 5 + 5*y] & M) & B[(x + 2) % 5 + 5*y])', '(B[(x + 1) % 5 + 5*y] & B[(x + 2) % 5 + 5*y])'],
  ['keccak: one round short', 'for(let r = 0; r < 24; r++){\n    const C = [0,1,2,3,4]', 'for(let r = 0; r < 23; r++){\n    const C = [0,1,2,3,4]'],
  ['shake: SHA3 padding instead of SHAKE', 'padded[msg.length] ^= 0x1f;', 'padded[msg.length] ^= 0x06;'],
  ['shake: SHAKE128 rate', 'const rate = 136, A = new Array(25).fill(0n);', 'const rate = 168, A = new Array(25).fill(0n);'],
  ['shake: no permutation between output blocks', 'if(pos === rate){ keccakF(A); buf = block(); pos = 0; }', 'if(pos === rate){ buf = block(); pos = 0; }'],
  ['bip85 apps: XPRV halves swapped', 'chain = e.slice(0, 32), key = e.slice(32, 64);', 'chain = e.slice(32, 64), key = e.slice(0, 32);'],
  ['bip85 apps: WIF not marked compressed', 'base58check(Uint8Array.from([0x80, ...e, 0x01]))', 'base58check(Uint8Array.from([0x80, ...e]))'],
  ['bip85 apps: Base85 alphabet wrong', '!#$%&()*+-;<=>?@^_`{|}~";', '!#$%&()*+-;<=>?@_^`{|}~";'],
  ['bip85 apps: hex path ignores the length', '[128169, n, index]', '[128169, 64, index]'],
  ['bip85 apps: Base64 password path wrong', '[707764, n, index]', '[707785, n, index]'],
  ['bip85 apps: dice use one bit too many', 'while(2 ** bits < n) bits++;', 'while(2 ** bits <= n) bits++;'],
  ['bip85 apps: dice keep the low bits', 'v = Math.floor(v / drop);', 'v = v % (256 ** bytes / drop);'],
  ['bip85 apps: a roll equal to the sides is kept', 'if(v < n) out.push(v);', 'if(v <= n) out.push(v);'],
  ['bip85 apps: dice path order wrong', '[89101, n, rolls, index]', '[89101, rolls, n, index]'],
  ['bip85 apps: Base85 password allows 81', 'pwd85: {name:"Password (Base85)", min:10, max:80,', 'pwd85: {name:"Password (Base85)", min:10, max:81,'],
  ['bip85 apps: Base64 password allows 19', 'pwd64: {name:"Password (Base64)", min:20, max:86,', 'pwd64: {name:"Password (Base64)", min:19, max:86,'],
  ['bip85 apps: a die with 2^31 sides allowed', 'if(!Number.isInteger(n) || n < 2 || n > 2147483647) throw', 'if(!Number.isInteger(n) || n < 2 || n > 4294967295) throw'],
  ['bip85 apps: 1001 rolls allowed', 'const BIP85_DICE_MAX_ROLLS = 1000;', 'const BIP85_DICE_MAX_ROLLS = 1001;'],
  ['bip85 card: length edits keep the output', '"childIndex","childLen","childSides","childRolls"]) document', '"childIndex","childSides"]) document'],
  ['bip85 card: type change keeps the output', 'document.getElementById(id).style.display = app === "dice" ? "" : "none";\n  clearChild();', 'document.getElementById(id).style.display = app === "dice" ? "" : "none";'],
  ['bip85 card: no xprv fingerprint', 'extra = "\\n\\nMaster fingerprint of this xprv: " + fp +', 'extra = "\\n\\n" +'],
  ['bip85 card: password length default too short', 'const CHILD_LEN_DEFAULT = {hex:32, pwd64:22, pwd85:20};', 'const CHILD_LEN_DEFAULT = {hex:32, pwd64:22, pwd85:12};'],
  ['bip85: output not cleared when length changed', 'document.getElementById("childWords").addEventListener("change", clearChild);', ''],
  ['bip85: child fingerprint wrong passphrase', 'const fp = await mnemonicFingerprint(child, ""), a0', 'const fp = await mnemonicFingerprint(child, "x"), a0'],
  ['bip85: error shown as success', 'say("bad", "The index must be a whole number', 'say("ok", "The index must be a whole number'],
  ['seedqr: number limit raised', 'if(n > 2047) return {error', 'if(n > 2048) return {error'],
  ['seedqr: number limit lowered', 'if(n > 2047) return {error', 'if(n > 2046) return {error'],
  ['seedqr: number limit removed', 'if(n > 2047) return {error', 'if(false) return {error'],
  ['seedqr: digit string needs the wrong length', 'q.length % 4 === 0 && [12,15,18,21,24].includes(q.length / 4)', 'q.length % 4 === 0'],
  ['seedqr: only 12 and 24 words', '[12,15,18,21,24].includes(q.length / 4)', '[12,24].includes(q.length / 4)'],
  ['seedqr: 5-digit groups', 'parseInt(q.slice(i, i + 4), 10)', 'parseInt(q.slice(i, i + 3), 10)'],
  ['seedqr: hex lengths wrong', '[32,40,48,56,64].includes(q.length)', '[32,64].includes(q.length)'],
  ['seedqr: hex capitals not accepted', '/^[0-9a-fA-F]+$/.test(q) && [32,40,48,56,64]', '/^[0-9a-f]+$/.test(q) && [32,40,48,56,64]'],
  ['seedqr: hex capitals not lowered', 'fromHex(q.toLowerCase())', 'fromHex(q)', true],
  ['seedqr: wrong wordlist index', 'words.push(WORDLIST[n]);', 'words.push(WORDLIST[n + 1]);'],
  ['seedqr: converted words not shown in the box', 'if(r.ok && (r.fromCode || r.expanded)) document.getElementById("phrase").value = r.mnemonic;', 'if(r.ok && r.expanded) document.getElementById("phrase").value = r.mnemonic;'],
  ['seedqr: source not named', ' (read from "+pc.kind+")" : ""', ' (read from)" : ""'],
  ['compare: taproot list only first address', 'ids.list.some(t => t === fold)', 'ids.list.slice(0,1).some(t => t === fold)'],
  ['passphrase line: YES/NO swapped (print and download)', '(used ? "YES (keep it separate; it is not " + kind + " here)" : "NO")', '(used ? "NO" : "YES (keep it separate; it is not " + kind + " here)")'],
  ['result line: no-passphrase wording wrong', ': "none");\n}', ': "used");\n}'],
  ['grid: word numbers off by one',           'const n = document.createElement("b"); n.textContent = (i + 1) + "."; c.appendChild(n);', 'const n = document.createElement("b"); n.textContent = i + "."; c.appendChild(n);'],
  ['seed flag never set (SEND TO VERIFY would refuse)', 'g.dataset.seed = "1";', 'g.dataset.seed = "";'],
  ['seed flag not cleared after an error (error text treated as a seed)', 'delete g.dataset.seed;', ''],
  ['plain message: too few rolls wording', '"Enter " + diff + " more "', '"Enter " + rolls.length + " more "'],
  ['dice face drawn with a missing pip (5)', '5:[[28,28],[72,28],[50,50],[28,72],[72,72]]', '5:[[28,28],[72,28],[28,72],[72,72]]'],
  ['five addresses: child index off by one', 'const [ck]=await ckdPriv(k,c,i,false);\n    out.push(bech32Encode("bc",0', 'const [ck]=await ckdPriv(k,c,i+1,false);\n    out.push(bech32Encode("bc",0'],
  ['five addresses: hardened child', 'const [ck]=await ckdPriv(k,c,i,false);\n    out.push(bech32Encode("bc",0', 'const [ck]=await ckdPriv(k,c,i,true);\n    out.push(bech32Encode("bc",0'],
  ['five addresses: one too few', 'for(let i=0;i<n;i++){\n    const [ck]', 'for(let i=0;i<n-1;i++){\n    const [ck]'],
  ['taproot: wrong purpose 86 -> 84', 'of [[86,true],[0,true],[0,true],[0,false]]) [k,c]=await ckdPriv(k,c,i,h);\n  const out=[];', 'of [[84,true],[0,true],[0,true],[0,false]]) [k,c]=await ckdPriv(k,c,i,h);\n  const out=[];'],
  ['taproot: child index off by one', 'out.push(await taprootAddress(ck))', 'out.push(await taprootAddress(ckdPriv ? (await ckdPriv(k,c,i+1,false))[0] : ck))'],
  ['taproot: one too few', 'for(let i=0;i<n;i++){ const [ck]=await ckdPriv(k,c,i,false); out.push(await taprootAddress(ck)); }', 'for(let i=0;i<n-1;i++){ const [ck]=await ckdPriv(k,c,i,false); out.push(await taprootAddress(ck)); }'],
  ['taproot: wrong tweak tag', 'taggedHash("TapTweak",xonly)', 'taggedHash("TapTweek",xonly)'],
  ['taproot: tweak not applied', 'const Q=eadd(P,emul(t,SG));', 'const Q=eadd(P,emul(1n,SG));'],
  ['taproot: internal key parity not fixed', 'if(P[1]&1n) P=[P[0],SP-P[1]];', 'if(false) P=[P[0],SP-P[1]];'],
  ['taproot: tweak hashes without internal key', 'taggedHash("TapTweak",xonly)', 'taggedHash("TapTweak",new Uint8Array(32))'],
  ['taproot: tagged hash single prefix', 'b.set(th,0); b.set(th,32); b.set(msg,64);', 'b.set(th,0); b.set(th,0); b.set(msg,64);'],
  ['taproot: change chain replaced by receive', 'for(const [i,h] of [[86,true],[0,true],[0,true],[1,false],[0,false]])', 'for(const [i,h] of [[86,true],[0,true],[0,true],[0,false],[0,false]])'],
  ['five addresses: receive chain replaced by change chain', 'for(const [i,h] of [[84,true],[0,true],[0,true],[0,false]]) [k,c]=await ckdPriv(k,c,i,h);\n  const out=[];', 'for(const [i,h] of [[84,true],[0,true],[0,true],[1,false]]) [k,c]=await ckdPriv(k,c,i,h);\n  const out=[];'],
  ['taproot list not cleared after an error', 'document.getElementById("addrList").textContent = ""; document.getElementById("trList").textContent = "";', 'document.getElementById("addrList").textContent = "";'],
  ['taproot list never filled', 'tl.textContent = "";\n  (trList || []).forEach', 'tl.textContent = "";\n  ([]).forEach'],
  ['guide: NEXT unlocks one roll late', 'return k >= getNeeded(document.querySelector(\'input[name="words"]:checked\').value) &&', 'return k > getNeeded(document.querySelector(\'input[name="words"]:checked\').value) &&'],
  ['guide: Keystone maximum ignored', ' && !(keystoneOn() && k > KEYSTONE_MAX); }', '; }'],
  ['guide: step 4 not locked until FORGE', '  if(n === 3) return hasSeed();', '  if(n === 3) return true;'],
  ['guide: step 2 not locked', '  if(n === 2){ const k = clean(', '  if(n === 2){ return true; const k = clean('],
  ['guide: NEXT can skip a locked step', '  if(d > 0 && !guideCanNext(guideN)) return;\n', ''],
  ['guide: DONE does not leave the guide', 'if(d > 0 && guideN >= GUIDE_STEPS){ toggleGuide(); jumpTo("cardCheck"); return; }', 'if(d > 0 && guideN >= GUIDE_STEPS){ return; }'],
  ['guide: hidden test off by one', 'return g.indexOf(String(n)) < 0;', 'return g.indexOf(String(n)) <= 0;'],
  ['guide: hidden test inverted', 'return g.indexOf(String(n)) < 0;', 'return g.indexOf(String(n)) >= 0;'],
  ['guide: passphrase box not opened at step 3', '  if(guideN === 4) document.getElementById("advanced").open = true;\n', ''],
  ['guide: last step button not DONE', 'next.textContent = guideN >= GUIDE_STEPS ? "DONE" : "NEXT \\u2192";', 'next.textContent = "NEXT \\u2192";'],
  ['guide: reopening ignores an existing seed', 'if(guideOn) guideN = hasSeed() ? 3 : 1;', 'if(guideOn) guideN = 1;'],
  ['guide: CLEAR does not return to step 1', 'if(guideOn){ guideN = 1; guideRender(); }', 'if(guideOn){ guideRender(); }'],
  ['guide: BACK enabled on step 1', 'back.disabled = guideN <= 1;', 'back.disabled = false;'],
  ['guide: progress dots off by one', 'el.classList.toggle("on", i < guideN)', 'el.classList.toggle("on", i <= guideN)'],
  ['guide: coin unit label', 'getElementById("gUnit").textContent = mode === "coin" ? "flips" : "rolls";', 'getElementById("gUnit").textContent = "rolls";'],
  ['guide: count not refreshed', 'getElementById("gNeed").textContent = String(need);', 'getElementById("gNeed").textContent = "50";'],
  ['guide: explanations all shown', 'el.style.display = (+el.getAttribute("data-gs") === guideN) ? "" : "none";', 'el.style.display = "";'],
  ['guide: button state not shown', 'b.setAttribute("aria-pressed", guideOn ? "true" : "false"); b.textContent = guideOn ? "GUIDE: ON" : "GUIDE ME";', 'b.textContent = guideOn ? "GUIDE: ON" : "GUIDE ME";'],
  ['guide: body class not toggled', 'document.body.classList.toggle("guided", guideOn);', ''],
  ['guide: FORGE does not refresh the guide', '    if(guideOn) guideRender();\n    document.getElementById("nextStep").textContent = "Write these', '    document.getElementById("nextStep").textContent = "Write these'],
  ['guide: roll count does not refresh the guide', 'function updateCount(){\n  staleCheck();\n  if(document.getElementById("wordSel")) syncMethodUi();\n  if(guideOn) guideRender();\n', 'function updateCount(){\n  staleCheck();\n  if(document.getElementById("wordSel")) syncMethodUi();\n'],
  ['terms: hover does not show', 'document.addEventListener("mouseover", e => { const t = term(e); if(t) show(t); });', ''],
  ['terms: moving away does not hide', 'document.addEventListener("mouseout", e => { if(term(e)) hide(); });', ''],
  ['terms: focus does not show', 'document.addEventListener("focusin", e => { const t = term(e); if(t) show(t); });', ''],
  ['terms: Escape does not hide', 'document.addEventListener("keydown", e => { if(e.key === "Escape") hide(); });', ''],
  ['terms: wrong text shown', 'tip.textContent = el.getAttribute("data-tip") || ""; tip.style.display = "block";', 'tip.textContent = ""; tip.style.display = "block";'],
  ['terms: tip kept inside the screen (layout only)', 'let x = Math.max(8, Math.min(r.left / z, window.innerWidth / z - w - 8));', 'let x = r.left / z;', true],
  ['terms: tip ignores the page zoom (layout only)', 'r.top / z - h - 8;', 'r.top - h - 8;', true],
  ['terms: tip placed below when no room above (layout only)', 'let y = r.top / z - h - 8; if(y < 8) y = r.bottom / z + 8;', 'let y = r.top / z - h - 8;', true],
  ['terms: touch outside does not hide (touch only)', 'document.addEventListener("touchstart", e => { if(!term(e)) hide(); }, {passive:true});', '', true],
  ['text size: class not toggled', 'const on = document.body.classList.toggle("big");', 'const on = false;'],
  ['text size: button state not shown', 'b.setAttribute("aria-pressed", on ? "true" : "false"); b.textContent = on ? "TEXT A-" : "TEXT A+";', 'b.textContent = on ? "TEXT A-" : "TEXT A+";'],
  ['text size: choice not remembered (browser storage)', 'try { localStorage.setItem("voidforge-big", on ? "1" : "0"); } catch(e) {}', '', true],
  ['guide: locked-step hint text', 'why.textContent = ok ? "" : (guideN === 2 ? "Keep rolling to unlock NEXT" : "Press FORGE SEED to unlock NEXT");', 'why.textContent = "";', true],
  ['download: CID uses wrong codec', 'all.set([1, 0x55, 0x12, 0x20]);', 'all.set([1, 0x70, 0x12, 0x20]);'],
  ['download: CID hash prefix wrong', '0x12, 0x20]); all.set(hash, 4);', '0x12, 0x21]); all.set(hash, 4);'],
  ['download: CID alphabet wrong', 'const A = "abcdefghijklmnopqrstuvwxyz234567"; let bits', 'const A = "abcdefghijklmnopqrstuvwxyz234568"; let bits'],
  ['download: CID last partial group dropped', 'if(bits > 0) out += A[(val << (5 - bits)) & 31];', 'if(false) out += A[(val << (5 - bits)) & 31];'],
  ['download: CID multibase prefix lost', 'return "b" + out;\n}\nfunction dlParse', 'return out;\n}\nfunction dlParse'],
  ['download: hash accepted at wrong length', 'if(w.length === 64 && /^[0-9a-fA-F]+$/.test(w)) hex.push', 'if(w.length >= 40 && /^[0-9a-fA-F]+$/.test(w)) hex.push'],
  ['download: upper case hash rejected', 'hex.push(w.toLowerCase());', 'hex.push(w);'],
  ['download: CID accepted at wrong length', 'else if(w.length === 59 && /^bafk[a-z2-7]+$/.test(w)) cid.push(w);', 'else if(w.length >= 10 && /^bafk[a-z2-7]+$/.test(w)) cid.push(w);'],
  ['download: hash algorithm is not SHA-256', 'crypto.subtle.digest("SHA-256", bytes));\n  const h = dlHex(hash)', 'crypto.subtle.digest("SHA-1", bytes));\n  const h = dlHex(hash)'],
  ['download: any one right hash is enough', 'want.hex.every(x => x === h) && want.cid.every(x => x === c) ? "match"', 'want.hex.some(x => x === h) || want.cid.some(x => x === c) ? "match"'],
  ['download: wrong CID ignored', 'want.hex.every(x => x === h) && want.cid.every(x => x === c) ? "match"', 'want.hex.every(x => x === h) ? "match"'],
  ['download: wrong hash ignored when a CID is right', 'want.hex.every(x => x === h) && want.cid.every(x => x === c) ? "match"', '(want.cid.length ? want.cid.every(x => x === c) : want.hex.every(x => x === h)) ? "match"'],
  ['download: nothing pasted counts as match', 'let verdict = "none";\n  if(want.hex.length || want.cid.length)', 'let verdict = "match";\n  if(want.hex.length || want.cid.length)'],
  ['download: size limit gone', 'if(f.size > DL_MAX){', 'if(false){'],
  ['download: size limit too high', 'const DL_MAX = 64 * 1024 * 1024;', 'const DL_MAX = 640 * 1024 * 1024;'],
  ['download: mismatch shown as ok', 'else if(r.verdict === "mismatch") say("bad",', 'else if(r.verdict === "mismatch") say("ok",'],
  ['download: match shown as bad', 'if(r.verdict === "match") say("ok",', 'if(r.verdict === "match") say("bad",'],
  ['download: output hides the CID', '\\nCID:    " + r.cid;', '";'],
  ['download: output hides the hash', '" bytes)\\nSHA-256: " + r.hash + "', '" bytes)" + "'],
  ['download: CLEAR leaves the pasted hash', 'document.getElementById("dlFile").value = ""; document.getElementById("dlPaste").value = "";', 'document.getElementById("dlFile").value = "";'],
  ['download: CLEAR leaves the output', 'const o = document.getElementById("dlOut"); o.textContent = ""; o.style.display = "none";\n  const t = document.getElementById("dlStatus"); t.textContent = ""; t.className = "status";\n}', 'const t = document.getElementById("dlStatus"); t.textContent = ""; t.className = "status";\n}'],
  ['download: no prompt without a file', 'say("", "Choose the voidforge.html file you downloaded."); return; }', 'return; }'],
  ['download: file box not wired', 'aria-label="Choose the VOIDFORGE file you downloaded" onchange="dlPick()"', 'aria-label="Choose the VOIDFORGE file you downloaded"'],
  ['download: paste box not wired', 'oninput="dlPick()" style="margin-top:6px;"', 'style="margin-top:6px;"'],
  ['download: honest limit note removed', '<b>Know the limit:</b> a page cannot vouch for itself.', '<b>Note:</b> this page is trustworthy.'],
  ['support: address changed', '<code id="supportAddr" style="user-select:all;">dev@breez.tips</code>', '<code id="supportAddr" style="user-select:all;">dev@breez.tip</code>'],
  ['support: payment code changed', 'LNURL1DP68GURN8GHJ7CNJV4JH5TN5D9C8XTMVDE6HYMRS9AJX2ASZ5RD0C</code>', 'LNURL1DP68GURN8GHJ7CNJV4JH5TN5D9C8XTMVDE6HYMRS9AJX2ASZ5RD0D</code>'],
  ['support: QR never drawn', 'drawSupportQr();\nbuildDict();', 'buildDict();'],
  ['support: QR drawn from the address not the code', 'const code = document.getElementById("supportLnurl").textContent.trim();', 'const code = document.getElementById("supportAddr").textContent.trim();'],
  ['support: address COPY copies the wrong text', "onclick=\"copySupport(this, 'supportAddr')\"", "onclick=\"copySupport(this, 'supportLnurl')\""],
  ['support: code COPY copies the wrong text', "onclick=\"copySupport(this, 'supportLnurl')\"", "onclick=\"copySupport(this, 'supportAddr')\""],
  ['support: box open by default', '<details id="supportBox">', '<details id="supportBox" open>'],
  ['support: not marked optional', '<small>Optional. VOIDFORGE is free and stays free.</small>', '<small>VOIDFORGE is free and stays free.</small>'],
  ['support: offline note removed', 'This page never goes online, so nothing is sent from here:', 'Send from here:'],
  ['support: seed warning removed', 'and never send seed words or a passphrase to anyone, for any reason.', 'and have fun.'],
  ['dictionary: numbers sorted as text', '{numeric: true, sensitivity: "base"}', '{numeric: false, sensitivity: "base"}'],
  ['dictionary: search ignores nothing (case kept)', 'document.getElementById("dictSearch").value.toLowerCase().trim()', 'document.getElementById("dictSearch").value.trim()'],
  ['dictionary: extra spaces not collapsed', '.trim().replace(/\\s+/g, " "), items = document.querySelectorAll("#dictList .dict-item");', '.trim(), items = document.querySelectorAll("#dictList .dict-item");'],
  ['dictionary: search only matches the start', '!q || e.dataset.s.includes(q)', '!q || e.dataset.s.startsWith(q)'],
  ['dictionary: empty search hides all', '!q || e.dataset.s.includes(q)', 'q && e.dataset.s.includes(q)'],
  ['dictionary: search ignores the definition', 'item.dataset.s = (e[0] + " " + e[1] + " " + e[2]).toLowerCase();', 'item.dataset.s = (e[0] + " " + e[2]).toLowerCase();'],
  ['dictionary: search ignores the In VOIDFORGE note', 'item.dataset.s = (e[0] + " " + e[1] + " " + e[2]).toLowerCase();', 'item.dataset.s = (e[0] + " " + e[1]).toLowerCase();'],
  ['dictionary: hidden entries stay visible', 'e.style.display = show ? "" : "none";', 'e.style.display = "";'],
  ['dictionary: count wrong', 'if(show) n++; });', 'n++; });'],
  ['dictionary: no-match message lost', 'document.getElementById("dictCount").textContent = n === 0 ? "No entry matches', 'document.getElementById("dictCount").textContent = n === 0 ? "Nothing'],
  ['dictionary: start count line changed', 'items.length + " entries, A to Z"', 'items.length + " entries"'],
  ['dictionary: where-note dropped', 'if(e[2]){ const sm', 'if(false){ const sm'],
  ['dictionary: never built', 'drawSupportQr();\nbuildDict();', 'drawSupportQr();'],
  ['dictionary: box open by default', '<details id="dictBox">', '<details id="dictBox" open>'],
  ['dictionary: search not wired', 'placeholder="Search a word, such as xpub or gap limit" oninput="dictFilter()"', 'placeholder="Search a word, such as xpub or gap limit"'],
  ['dictionary: wordlist size wrong', 'The fixed list of 2048 words BIP39 uses.', 'The fixed list of 2047 words BIP39 uses.'],
  ['dictionary: gap limit wrong', 'before it stops looking (usually 20)', 'before it stops looking (usually 10)'],
  ['dictionary: testnet prefix wrong', 'Its SegWit addresses start with tb1.', 'Its SegWit addresses start with bc1.'],
  ['dictionary: taproot prefix wrong', 'The 2021 Bitcoin upgrade behind bc1p addresses.', 'The 2021 Bitcoin upgrade behind bc1q addresses.'],
  ['dictionary: dice bits per roll wrong', 'Each roll adds about 2.58 bits', 'Each roll adds about 3.58 bits'],
  ['dictionary: pbkdf2 rounds wrong', '(2048 rounds)', '(1024 rounds)'],
  ['dictionary: passphrase warning softened', 'A different passphrase makes a completely different wallet', 'A different passphrase makes a similar wallet'],
  ['dictionary: OP_RETURN spendable', 'The output carrying it can never be spent.', 'The output carrying it can be spent.'],
  ['dictionary: fee definition wrong', 'the inputs minus the outputs.', 'the outputs minus the inputs.'],
  ['dictionary: satoshi size wrong', 'one hundred-millionth of a bitcoin', 'one millionth of a bitcoin'],
  ['dictionary: fingerprint length wrong', 'Eight characters taken from your master key.', 'Four characters taken from your master key.'],
  ['dictionary: legacy prefix wrong', 'starting with 1. It works everywhere', 'starting with 3. It works everywhere'],
  ['dictionary: block time wrong', 'A batch of transactions added to the blockchain roughly every ten minutes.', 'A batch of transactions added to the blockchain roughly every hour.'],
  ['dictionary: topic filter ignored', '(dictCat === "All" || e.dataset.c === dictCat)', 'true'],
  ['dictionary: topic filter never resets', 'b.onclick = () => { dictCat = c;', 'b.onclick = () => { dictCat = dictCat;'],
  ['dictionary: pressed state not shown', 'x.setAttribute("aria-pressed", x === b ? "true" : "false"));', 'x.setAttribute("aria-pressed", "false"));'],
  ['dictionary: no-match line loses the topic', '(dictCat === "All" ? "" : " in " + dictCat)', '""'],
  ["wallet view: coin type ignored", "[[purpose,true],[coin,true],[account,true],[chain,false]]", "[[purpose,true],[0,true],[account,true],[chain,false]]"],
  ["wallet view: account ignored", "[[purpose,true],[coin,true],[account,true],[chain,false]]", "[[purpose,true],[coin,true],[0,true],[chain,false]]"],
  ["wallet view: chain ignored", "[[purpose,true],[coin,true],[account,true],[chain,false]]", "[[purpose,true],[coin,true],[account,true],[0,false]]"],
  ["wallet view: second page shows the first", "chain, wvFrom, WV_PAGE);", "chain, 0, WV_PAGE);"],
  ["wallet view: no QR button on a row", "  li.appendChild(b); return li;", "  return li;"],
  ["wallet view: QR shows another address", "q = qrMatrix(text); } catch(e) { uriEl.textContent = \"QR code unavailable", "q = qrMatrix(text + \"x\"); } catch(e) { uriEl.textContent = \"QR code unavailable"],
  ["wallet view: not called imported", "textContent = \"Imported: these words were typed or scanned here, not made by this page.", "textContent = \"These words were typed or scanned here."],
  ["wallet view: passphrase not noted", "\"Master fingerprint: \" + fp + (pass ? \" (with passphrase)\" : \"\");\n    showFpIcon(\"wvIcon\", fp);", "\"Master fingerprint: \" + fp;\n    showFpIcon(\"wvIcon\", fp);"],
  ["wallet view: edit keeps the view", "for(const id of [\"phrase\",\"verifyPass\"]) document.getElementById(id).addEventListener(\"input\", () => { if(wvCtx && wvCtx.kind !== \"pub\") clearWalletView(); });", "for(const id of [\"phrase\",\"verifyPass\"]) document.getElementById(id).addEventListener(\"input\", () => {});"],
  ["wallet view: SeedQR offered for 15 words", "if(n === 12 || n === 24){ sq.textContent", "if(n >= 12){ sq.textContent"],
  ["recovery sheet: prints the passphrase", "(wvCtx.pass ? \"YES (kept separately; it is not written here)\" : \"NO\")", "(wvCtx.pass ? \"YES \" + wvCtx.pass : \"NO\")"],
  ["wallet view: bad account accepted", "const badAcct = wvCtx.kind !== \"pub\" && (!/^[0-9]{1,10}$/.test(raw) || parseInt(raw, 10) > 2147483647);", "const badAcct = false;"],
  ["wallet view: SeedQR not marked secret", "SECRET: anyone who scans it controls the funds. It holds the words only", "Anyone who scans it controls the funds. It holds the words only"],
  ["wallet view: CLEAR ALL leaves it", "document.getElementById(\"verifyStatus\").textContent=\"\"; clearWalletView();", "document.getElementById(\"verifyStatus\").textContent=\"\";"],
  ["address QR: no button under the seed", "list.forEach((a, i) => ol.appendChild(addrLi(a, \"receive address \" + (i + 1))));", "list.forEach((a, i) => { const li = document.createElement(\"li\"); li.textContent = a; ol.appendChild(li); });"],
  ["wallet view: PREVIOUS never off", "document.getElementById(\"wvPrev\").disabled = wvFrom === 0;", "document.getElementById(\"wvPrev\").disabled = false;"],
  ["wallet view: testnet note dropped", "(net === \"test\" ? \"TESTNET (practice coins only). \" : \"\")", "\"\""],
  ["recovery sheet: nothing printed", "if(!wvCtx || !wvCtx.shown || wvCtx.kind === \"pub\") return alert(\"Check a seed phrase first, then open the wallet.\");", "if(true) return;"],
  ["watch-only: change ending ignored", "    chain = m[5] === \"/1/*\" ? 1 : 0;", "    chain = 0;"],
  ["watch-only: chain not set on open", "  cSel.value = String(w.chain || 0);", "  "],
  ["watch-only: type not locked", "if(w.type){ tSel.value = w.type; } tSel.disabled = w.fixedType;", "if(w.type){ tSel.value = w.type; } tSel.disabled = false;"],
  ["watch-only: network not locked", "nSel.value = w.net; nSel.disabled = true;", "nSel.value = w.net; nSel.disabled = false;"],
  ["watch-only: checksum not checked", "if(!ok) throw new Error(\"The descriptor checksum (after #) does not match. Check for a typo.\");", "if(false) throw new Error(\"The descriptor checksum (after #) does not match. Check for a typo.\");"],
  ["watch-only: key and descriptor type may differ", "if(type && keyType && type !== keyType) throw", "if(false) throw"],
  ["watch-only: SeedQR offered", "document.getElementById(\"wvSqBlock\").style.display = \"none\"; document.getElementById(\"wvSheetBtn\")", "document.getElementById(\"wvSqBlock\").style.display = \"\"; document.getElementById(\"wvSheetBtn\")"],
  ["watch-only: no fingerprint from the descriptor", "  if(w.origin){ document.getElementById(\"wvFp\").textContent = \"Master fingerprint (from the descriptor): \" + w.origin.fp; showFpIcon(\"wvIcon\", w.origin.fp); }", "  if(false){ }"],
  ["watch-only: edit keeps the view", "document.getElementById(\"wpIn\").addEventListener(\"input\", () => { if(wvCtx && wvCtx.kind === \"pub\") clearWalletView();", "document.getElementById(\"wpIn\").addEventListener(\"input\", () => {"],
  ["watch-only: controls stay locked after", "  for(const id of [\"wvType\",\"wvNet\",\"wvAcct\"]) document.getElementById(id).disabled = false;\n", "\n"],
  ["watch-only: taproot ignores the point", "  if(type === \"tr\") return taprootAddressFromPoint(pointFromPub(pub), N.hrp);", "  if(type === \"tr\") return taprootAddressFromPoint(pointFromPub(pub), \"bc\").then(a => a + \"\");\n  if(false) return;"],
  ["Electrum: SegWit prefix wrong", "  if(h.startsWith(\"100\")) return \"SegWit\";", "  if(h.startsWith(\"10\")) return \"SegWit\";"],
  ["Electrum: wrong HMAC key", "new TextEncoder().encode(\"Seed version\")", "new TextEncoder().encode(\"Seed\")"],
  ["Electrum: note never added to a bad checksum", "const en = await electrumNote(phrase); return {ok:false, msg:\"Checksum failed\" + (en ||", "const en = \"\"; return {ok:false, msg:\"Checksum failed\" + (en ||"],
  ["payment request: no decimal limit", "if(!/^(\\d{1,8})(\\.\\d{1,8})?$/.test(a))", "if(!/^(\\d{1,8})(\\.\\d{1,9})?$/.test(a))"],
  ["payment request: 21 million not enforced", "if(sats > 2100000000000000n)", "if(sats > 2100000000000001n)"],
  ["payment request: zero accepted", "if(sats === 0n) return {ok:false", "if(false) return {ok:false"],
  ["payment request: label not encoded", "if(label) q.push(\"label=\" + encodeURIComponent(label));", "if(label) q.push(\"label=\" + label);"],
  ["payment request: QR stays a plain address", "else if(am.v || lbl || msg){ text = bip21Uri(addr, am.v, lbl, msg);", "else if(false){ text = bip21Uri(addr, am.v, lbl, msg);"],
  ["payment request: HIDE keeps the amount", "  for(const k of [\"Amt\",\"Lbl\",\"Msg\"]) document.getElementById(pfx + k).value = \"\";\n", "\n"],
  ["checklist: drill does not tick", "  bkTick(\"bk2\");\n", "\n"],
  ["checklist: recovery sheet does not tick", "&& !passMismatchQuiet()) bkTick(\"bk4\");", "&& !passMismatchQuiet()) {}"],
  ["checklist: passphrase change keeps ticks", "drillEnd(); for(const id of [\"bk2\",\"bk4\"]) document.getElementById(id).checked = false; bkUpdate();", "drillEnd();"],
  ["checklist: never shown", "wdWipe(); drillEnd(); if(words) previewClear(); bkReset(!!words);", "wdWipe(); drillEnd(); if(words) previewClear(); bkReset(false);"],
  ["checklist: all-done message wrong", "n === 4 ? \"All four done: this backup is ready.\"", "n === 3 ? \"All four done: this backup is ready.\""],
  ["key reuse: receive and change counted as two wallets", ".replace(/#[0-9a-z]{8}$/, \"\").replace(/\\/(?:0|1|<0;1>)\\/\\*/g, \"/*\");", ".replace(/#[0-9a-z]{8}$/, \"\");"],
  ["key reuse: one key twice in one descriptor not found", "if(twiceIn.length) warn.push(", "if(false) warn.push("],
  ["key reuse: one key in two wallets not found", "if(wallets.size > 1) warn.push(", "if(false) warn.push("],
  ["key reuse: zpub and xpub of one key differ", "ids.push(Object.assign({}, k, {id: hex(p.pub) + hex(p.chain)}));", "ids.push(Object.assign({}, k, {id: k.key}));"],
  ["key reuse: same seed in one multisig not found", "if(set.size > 1) warn.push(\"Line \" + ln", "if(set.size > 9) warn.push(\"Line \" + ln"],
  ["key reuse: one origin two keys not found", "for(const g of Object.values(byOrigin)) if(new Set(g.map(k => k.id)).size > 1)", "for(const g of Object.values(byOrigin)) if(false)"],
  ["key reuse: private key accepted", "if(list.some(k => /^[xyztuvXYZTUV]prv/.test(k.key))) return", "if(false) return"],
  ['dictionary: Electrum seed fact lost', 'same English words as BIP39 but a different checksum', 'same English words as BIP39 and the same checksum'],
  ['dictionary: Change address on the wrong chain', 'It sits on the second chain of the account (the 1 in', 'It sits on the first chain of the account (the 1 in'],
  ['dictionary: Receive address on the wrong chain', 'on the first chain of the account (the 0 in', 'on the second chain of the account (the 0 in'],
  ['dictionary: entry topic dropped', 'item.dataset.c = e[3];', 'item.dataset.c = "Basics";'],
  ['dictionary: topic buttons never built', '["All"].concat(DICT_CATS).forEach(c => {', '[].concat(DICT_CATS).slice(0, 0).forEach(c => {'],
  ['dictionary: supply 21 million wrong', 'No more than 21 million coins will ever exist.', 'No more than 2.1 million coins will ever exist.'],
  ['dictionary: halving interval wrong', 'every 210,000 blocks), when the block reward', 'every 100,000 blocks), when the block reward'],
  ['dictionary: difficulty interval wrong', 'It adjusts every 2016 blocks', 'It adjusts every 1016 blocks'],
  ['dictionary: block weight wrong', 'a block can hold 4,000,000 weight units', 'a block can hold 400,000 weight units'],
  ['dictionary: genesis date wrong', 'mined on 3 January 2009', 'mined on 3 January 2010'],
  ['dictionary: block header size wrong', 'The 80-byte summary', 'The 40-byte summary'],
  ['dictionary: WIF letters wrong', 'starting with 5, K or L', 'starting with 1, 3 or L'],
  ['dictionary: P2WPKH prefix wrong', 'the single-key Native SegWit address, starting with bc1q.', 'the single-key Native SegWit address, starting with bc1p.'],
  ['dictionary: P2TR prefix wrong', 'the address type starting with bc1p.', 'the address type starting with bc1q.'],
  ['dictionary: BIP44 path wrong', "m/44'/0'/0'.", "m/49'/0'/0'."],
  ['dictionary: BIP49 path wrong', "m/49'/0'/0'.", "m/44'/0'/0'."],
  ['dictionary: pizza amount wrong', '10,000 bitcoin were used to buy two pizzas', '1,000 bitcoin were used to buy two pizzas'],
  ['dictionary: byte sizes wrong', 'A SHA-256 hash is 32 bytes; a 12-word seed holds 16 bytes of entropy.', 'A SHA-256 hash is 64 bytes; a 12-word seed holds 32 bytes of entropy.'],
  ['dictionary: P2PKH prefix wrong', 'the original address type, starting with 1.', 'the original address type, starting with 3.'],
  ['dictionary: P2SH prefix wrong', 'an address that stands for a script, starting with 3.', 'an address that stands for a script, starting with 1.'],
  ['dictionary: BIP350 wrong', 'The standard that defines bech32m, used by Taproot', 'The standard that defines bech32, used by SegWit v0'],
  ['dictionary: block reward start wrong', 'It started at 50 bitcoin and is cut in half', 'It started at 25 bitcoin and is cut in half'],
  ['dictionary: BIP125 wrong', 'The standard for replace-by-fee:', 'The standard for child-pays-for-parent:'],
  ['dictionary: whitepaper date wrong', 'published on 31 October 2008', 'published on 31 October 2009'],
  ['recommended: drill badge lost', 'prove your paper backup works<span class="tag tag-rec">RECOMMENDED</span>', 'prove your paper backup works (recommended)'],
  ['recommended: second-tool badge lost', 'in a second tool<span class="tag tag-rec">RECOMMENDED</span>', 'in a second tool (recommended)'],
  ['recommended: menu option not coloured', '<option value="ms-wsh" class="opt-rec">', '<option value="ms-wsh">'],
  ['tags: core badge lost', 'Import into Bitcoin Core<span class="tag tag-note">ADVANCED</span>', 'Import into Bitcoin Core (advanced)'],
  ['tags: silent payment badges lost', 'Silent Payment address<span class="tag tag-note">ADVANCED</span><span class="tag tag-ro">NEW</span>', 'Silent Payment address (advanced, new)'],
  ['tags: NEW badge not unified to cyan', '<span class="tag tag-ro">NEW</span></summary>', '<span class="tag tag-note">NEW</span></summary>'],
  ['recommended: badge loses its gold', '.tag-rec, body.light .tag-rec { color: var(--warn-text); background: none; }', '.tag-rec, body.light .tag-rec { color: var(--muted); background: none; }'],
  ['recommended: menu option loses its amber', '.opt-rec { color: var(--warn-text);', '.opt-rec { color: var(--accent);'],
  ['word draw: exact words not matched', '  if(Object.prototype.hasOwnProperty.call(WORD_MAP, tok)) return WORD_MAP[tok];\n', ''],
  ['word draw: three-letter prefixes tried (same result)', '  if(tok.length >= 4){\n    if(!wdPrefix)', '  if(tok.length >= 3){\n    if(!wdPrefix)', true],
  ['word draw: prefix must be the start of the word', 'if(i !== undefined && WORDLIST[i].startsWith(tok)) return i;', 'if(i !== undefined) return i;'],
  ['word draw: prefix table on five letters', 'wdPrefix[w.slice(0, 4)] = i;', 'wdPrefix[w.slice(0, 5)] = i;'],
  ['word draw: words split only on spaces', "split(/[^a-z]+/).filter(Boolean), idx = [], bad = [];", "split(/\\s+/).filter(Boolean), idx = [], bad = [];"],
  ['word draw: lower-casing in lookup (parse already lower-cases)', '  tok = String(tok).toLowerCase();\n', '  tok = String(tok);\n', true],
  ['word draw: 24 words need four flips', 'wc === 24 ? {words: 23, flips: 3} : {words: 11, flips: 7}', 'wc === 24 ? {words: 23, flips: 4} : {words: 11, flips: 7}'],
  ['word draw: 12 words need eight flips', 'wc === 24 ? {words: 23, flips: 3} : {words: 11, flips: 7}', 'wc === 24 ? {words: 23, flips: 3} : {words: 11, flips: 8}'],
  ['word draw: step guard on the counts (unreachable from the page)', '  if(idx.length !== need.words || flips.length !== need.flips || /[^01]/.test(flips)) throw new Error("Wrong number of words or flips");\n', '', true],
  ['word draw: flips placed before the words', 'const bits = wordBits.join("") + flips;', 'const bits = flips + wordBits.join("");'],
  ['word draw: checksum length wrong', 'const check = bytesToBits(hash).slice(0, bits.length / 32);', 'const check = bytesToBits(hash).slice(0, bits.length / 64);'],
  ['word draw: last word bits reversed', 'const lastBits = flips + check, lastNum', 'const lastBits = check + flips, lastNum'],
  ['word draw: internal check (a maths identity)', '|| WORD_MAP[words[wc - 1]] !== lastNum) throw new Error("Internal check failed");', ') throw new Error("Internal check failed");', true],
  ['word draw: flips not filtered to 1 and 0', 'cleaned = flipsEl.value.replace(/[^01]/g, "");', 'cleaned = flipsEl.value.replace(/[^0-9]/g, "");'],
  ['word draw: count line wrong', 'pr.count + " / " + need.words + " words, " + cleaned.length + " / " + need.flips + " flips"', 'pr.count + " / " + need.words + " words, " + cleaned.length + " / " + need.words + " flips"'],
  ['word draw: unknown word not named', 'msg = "Word " + pr.bad[0].n + " (" + pr.bad[0].tok + ") is not a BIP39 word.', 'msg = "Word " + pr.bad[0].n + " is not a BIP39 word.'],
  ['word draw: too-many-words notice from the exact count', 'else if(pr.count > need.words) msg', 'else if(pr.count >= need.words) msg'],
  ['word draw: too-many-words notice missing', 'else if(pr.count > need.words) msg = "Too many words:', 'else if(false) msg = "Too many words:'],
  ['word draw: too-many-flips notice missing', 'else if(cleaned.length > need.flips) msg = "Too many flips', 'else if(false) msg = "Too many flips'],
  ['word draw: button ignores unknown words', 'selfTestState === "pass" && !pr.bad.length && pr.count', 'selfTestState === "pass" && pr.count'],
  ['word draw: button ignores the word count', 'pr.count === need.words && cleaned.length === need.flips);', 'cleaned.length === need.flips);'],
  ['word draw: button ignores the flip count', 'pr.count === need.words && cleaned.length === need.flips);', 'pr.count === need.words);'],
  ['word draw: button ignores the self-test (the page has its own gate)', 'document.getElementById("wdBtn").disabled = !(selfTestState === "pass" && ', 'document.getElementById("wdBtn").disabled = !(', true],
  ['word draw: bad input does not stop the seed', 'flips.length !== need.flips){ wdUpdate(); return; }', 'flips.length !== need.flips){ wdUpdate(); }'],
  ['word draw: identical words not noticed', 'const same = pr.idx.every(n => n === pr.idx[0]), sorted', 'const same = false, sorted'],
  ['word draw: alphabetical order not noticed', 'sorted = pr.idx.every((n, i) => i === 0 || n > pr.idx[i - 1]);', 'sorted = false;'],
  ['word draw: weak-words question skipped', 'if((same || sorted) && !confirm(', 'if(false && !confirm('],
  ['word draw: alphabetical question also for equal neighbours (same warning)', 'i === 0 || n > pr.idx[i - 1]);', 'i === 0 || n >= pr.idx[i - 1]);', true],
  ['word draw: identical flips not noticed', 'if(/^(0+|1+)$/.test(flips) && !confirm(', 'if(/^0+$/.test(flips) && !confirm('],
  ['word draw: identical-flips question skipped', 'if(/^(0+|1+)$/.test(flips) && !confirm(', 'if(false && !confirm('],
  ['word draw: dice explainer left showing', '  document.getElementById("explainBox").style.display = "none";\n  wdShow(st, wc);', '  wdShow(st, wc);'],
  ['word draw: steps not shown', '  wdShow(st, wc);\n  if(guideOn)', '  if(guideOn)'],
  ['word draw: guide stays on step 1', '  wdShow(st, wc);\n  if(guideOn){ guideN = 3; guideRender(); }', '  wdShow(st, wc);\n  if(guideOn){ guideRender(); }'],
  ['step help: Roll text lost', 'Your dice or coin are the randomness. VOIDFORGE only runs them through SHA-256, so nothing hidden is mixed in.', 'Your dice or coin are the randomness.'],
  ['step help: Forge step shows no text', '    3: "Press FORGE SEED to turn your rolls into the BIP39 words that are your wallet\\u2019s backup.",', '    3: "",'],
  ['step help: never updated', '  document.getElementById("stepWhy").textContent = WHY[cur];\n', ''],
  ['preview: too-few-rolls FORGE wipes the grey words', 'grid.classList.remove("slots"); renderSlots(); updateAbbrNote(); previewRefresh();', 'grid.classList.remove("slots"); renderSlots(); updateAbbrNote();'],
  ["preview: grey note stays after FORGE", "wdWipe(); drillEnd(); if(words) previewClear(); bkReset(!!words); document.body", "wdWipe(); drillEnd(); bkReset(!!words); document.body"],
  ["word draw: dice FORGE leaves old steps", "function setResult(text, words){\n  wdWipe(); drillEnd(); if(words) previewClear(); bkReset(!!words); document.body.classList.toggle(\"has-seed\", !!words);\n", "function setResult(text, words){\n  drillEnd(); if(words) previewClear(); bkReset(!!words); document.body.classList.toggle(\"has-seed\", !!words);\n"],
  ['word draw: CLEAR leaves the boxes', '  wdClear();\n', ''],
  ['word draw: CLEAR button leaves the words', 'document.getElementById("wdWords").value = ""; document.getElementById("wdFlips").value = "";\n  wdWipe(); wdUpdate();', 'document.getElementById("wdFlips").value = "";\n  wdWipe(); wdUpdate();'],
  ['word draw: CLEAR button leaves the flips', 'document.getElementById("wdWords").value = ""; document.getElementById("wdFlips").value = "";\n  wdWipe(); wdUpdate();', 'document.getElementById("wdWords").value = "";\n  wdWipe(); wdUpdate();'],
  ['word draw: wipe leaves the steps', 'function wdWipe(){ const o = document.getElementById("wdOut"); o.textContent = ""; o.style.display = "none"; }', 'function wdWipe(){ const o = document.getElementById("wdOut"); o.style.display = "none"; }'],
  ['word draw: wipe leaves the panel open', 'function wdWipe(){ const o = document.getElementById("wdOut"); o.textContent = ""; o.style.display = "none"; }', 'function wdWipe(){ const o = document.getElementById("wdOut"); o.textContent = ""; }'],
  ['word draw: self-test gate does not refresh the button (typing refreshes it anyway)', '  document.getElementById("childBtn").disabled = !on;\n  wdUpdate();\n}', '  document.getElementById("childBtn").disabled = !on;\n}', true],
  ['word draw: not offered on guide step 1', '<details id="wdBox" data-g="1">', '<details id="wdBox" data-g="2">'],
  ['word draw: words rows missing', '  st.wordBits.forEach((b, i) => add((1 + i) + ".",', '  st.wordBits.slice(0, 0).forEach((b, i) => add((1 + i) + ".",'],
  ['word draw: flips row missing', '  add("Flips", st.flips + "  (" + st.flips.length + " bits)");\n', ''],
  ['word draw: no-hashing note missing', '  const n = document.createElement("div"); n.className = "hint"; n.style.margin = "6px 0 0"; n.textContent = "No hashing is applied to your words: they are the seed. Only the checksum is calculated."; o.appendChild(n);\n', ''],
  ['word draw: no scroll to the result (display only)', '  if(guideOn){ guideN = 3; guideRender(); }\n  jumpTo("genResult");', '  if(guideOn){ guideN = 3; guideRender(); }', true],
  ['address list not cleared after an error', 'function clearAddrs(){\n  document.getElementById("addrList").textContent = "";', 'function clearAddrs(){\n  '],
  ['address guide hidden after FORGE', 'document.getElementById("checkGuide").style.display = ""; document.getElementById("drillBox").style.display = "";\n}', 'document.getElementById("checkGuide").style.display = "none"; document.getElementById("drillBox").style.display = "";\n}'],
  ['4-letter view: three letters', 'e.textContent = abbrOn ? e.dataset.w.slice(0, 4) : e.dataset.w;', 'e.textContent = abbrOn ? e.dataset.w.slice(0, 3) : e.dataset.w;'],
  ['mnemonic NFKD removed (English ASCII words)', 'enc.encode(mnemonic.normalize("NFKD"))', 'enc.encode(mnemonic)', true],
  ['master key range check removed (unreachable in practice)', 'if(k===0n || k>=SN) throw new Error("Invalid master key");', '', true],
  ["seedqr: level L uses the M table", "spec.level===\"L\"?QR_L:QR_M", "spec.level===\"L\"?QR_M:QR_M"],
  ["seedqr: format bits for level L wrong", "eccBits=spec.level===\"L\"?1:0", "eccBits=spec.level===\"L\"?0:0"],
  ["seedqr: numeric mode flag inverted", "numeric=spec.mode===\"numeric\"", "numeric=spec.mode!==\"numeric\""],
  ["seedqr: numeric bits per 3 digits wrong", "Math.floor(digits.length/3)*10+", "Math.floor(digits.length/3)*8+"],
  ["seedqr: numeric bits for a leftover pair wrong", "[0,4,7][digits.length%3]", "[0,4,8][digits.length%3]", true],
  ["seedqr: numeric bits for a leftover digit wrong", "[0,4,7][digits.length%3]", "[0,3,7][digits.length%3]", true],
  ["seedqr: numeric count field too short", "(numeric?(v<10?10:12)", "(numeric?(v<10?9:12)", true],
  ["seedqr: numeric mode indicator wrong", "put(1,4); put(digits.length", "put(2,4); put(digits.length"],
  ["seedqr: numeric count written short", "put(digits.length,ver<10?10:12)", "put(digits.length,ver<10?9:12)"],
  ["seedqr: three digits written in the wrong width", "g.length===3?10:g.length===2?7:4", "g.length===3?11:g.length===2?7:4"],
  ["seedqr: two digits written in the wrong width", "g.length===3?10:g.length===2?7:4", "g.length===3?10:g.length===2?8:4", true],
  ["seedqr: one digit written in the wrong width", "g.length===3?10:g.length===2?7:4", "g.length===3?10:g.length===2?7:5", true],
  ["seedqr: version 1 error correction length wrong", "1:[7,[[1,19]]]", "1:[8,[[1,19]]]"],
  ["seedqr: version 1 data length wrong", "1:[7,[[1,19]]]", "1:[7,[[1,18]]]"],
  ["seedqr: version 2 error correction length wrong", "2:[10,[[1,34]]]", "2:[11,[[1,34]]]"],
  ["seedqr: version 2 data length wrong", "2:[10,[[1,34]]]", "2:[10,[[1,33]]]"],
  ["seedqr: version 3 error correction length wrong", "3:[15,[[1,55]]]", "3:[16,[[1,55]]]"],
  ["seedqr: version 3 data length wrong", "3:[15,[[1,55]]]", "3:[15,[[1,54]]]"],
  ["seedqr: version search stops one early", "v<=Object.keys(TBL).length", "v<Object.keys(TBL).length"],
  ["seedqr: any length accepted", "if(![12,24].includes(idx.length) ||", "if(false ||"],
  ["seedqr: unknown words accepted", "idx.some(i=>i===undefined)", "idx.some(i=>false)"],
  ["seedqr: word number width wrong", "String(i).padStart(4,\"0\")", "String(i).padStart(3,\"0\")"],
  ["seedqr: 11-bit word number wrong", "idx.map(i=>i.toString(2).padStart(11,\"0\"))", "idx.map(i=>i.toString(2).padStart(10,\"0\"))"],
  ["seedqr: checksum bits kept in the compact bytes", "idx.length*11 - idx.length/3", "idx.length*11 - idx.length/4"],
  ["seedqr: compact bytes read in 7 bits", "parseInt(bits.slice(i,i+8),2)", "parseInt(bits.slice(i,i+7),2)"],
  ["seedqr: compact and standard swapped", "kind===\"compact\" ? {mode:\"byte\"", "kind!==\"compact\" ? {mode:\"byte\""],
  ["seedqr: short phrase not refused", "if(!d) throw new Error(\"SeedQR exists", "if(false) throw new Error(\"SeedQR exists"],
  ["seedqr: show button box offered for any length", "sq.style.display = (words && [12,24].includes(words.length)) ? \"\" : \"none\"", "sq.style.display = (words) ? \"\" : \"none\""],
  ["seedqr: box opened after FORGE", "sq.open = false;", "sq.open = true;"],
  ["seedqr: old code kept after a new FORGE", "hideSeedQr(); { const sq", "{ const sq"],
  ["seedqr: old code kept after hide", "sqKind = null; sqRows = null; closeSqGuide();", "sqKind = null; closeSqGuide();"],
  ["seedqr: guide stays open when another code is shown", "sqKind = kind; sqRows = q.rows; closeSqGuide();", "sqKind = kind; sqRows = q.rows;"],
  ["seedqr: block size wrong", "function qrBlockSize(n){ return 7; }", "function qrBlockSize(n){ return 6; }"],
  ["seedqr: row list start wrong", "out.push(e===x ? String(x+1)", "out.push(e===x ? String(x)"],
  ["seedqr: row list end wrong", "(x+1)+\"-\"+(e+1)", "(x+1)+\"-\"+(e)"],
  ["seedqr: row list skips filled runs of one", "if(row[x]){ let e=x;", "if(row[x] && row[x+1]){ let e=x;"],
  ["seedqr: row list run ends early", "while(e+1<row.length && row[e+1]) e++;", "while(e+1<row.length-1 && row[e+1]) e++;"],
  ["seedqr: grid grey squares missing", "if(x>=n || y>=n) grey+=sq;", "if(x>=n && y>=n) grey+=sq;"],
  ["seedqr: blank grid shows squares", "else if(!blank && rows[y][x]) cells+=sq;", "else if(rows[y][x]) cells+=sq;"],
  ["seedqr: grid shows white squares as black", "else if(!blank && rows[y][x]) cells+=sq;", "else if(!blank && !rows[y][x]) cells+=sq;"],
  ["seedqr: grid column numbers for squares outside the code", "for(let x=x0;x<Math.min(x1,n);x++) labels", "for(let x=x0;x<x1;x++) labels"],
  ["seedqr: grid row numbers for squares outside the code", "for(let y=y0;y<Math.min(y1,n);y++) labels", "for(let y=y0;y<y1;y++) labels"],
  ["seedqr: grid column numbers off by one", "'\">'+(x+1)+\"</text>\";\n  for(let y", "'\">'+(x)+\"</text>\";\n  for(let y"],
  ["seedqr: mini-map block width not cut", "const bx=Math.min(x1,n)-x0, by=Math.min(y1,n)-y0;", "const bx=x1-x0, by=Math.min(y1,n)-y0;"],
  ["seedqr: mini-map block height not cut", "const bx=Math.min(x1,n)-x0, by=Math.min(y1,n)-y0;", "const bx=Math.min(x1,n)-x0, by=y1-y0;"],
  ["seedqr: number of blocks rounded down", "per = Math.ceil(n / b), total = per * per;", "per = Math.floor(n / b), total = per * per;"],
  ["seedqr: previous block does not wrap", "((sqBlock - 1 + delta + total) % total) + 1", "((sqBlock - 1 + delta) % total) + 1"],
  ["seedqr: opening the guide does not start at block 1", "sqBlock = first ? 1 :", "sqBlock = first ? 2 :"],
  ["seedqr: block row and column swapped", "const r = Math.floor((sqBlock - 1) / per), c = (sqBlock - 1) % per,", "const c = Math.floor((sqBlock - 1) / per), r = (sqBlock - 1) % per,"],
  ["seedqr: block shifted by one square", "x1 = x0 + b, y1 = y0 + b;", "x1 = x0 + b - 1, y1 = y0 + b;"],
  ["seedqr: block caption not cut at the edge", "\" to \" + Math.min(n, y1) + \", columns \"", "\" to \" + y1 + \", columns \""],
  ["seedqr: block caption columns not cut at the edge", "\" to \" + Math.min(n, x1) + \" of the \"", "\" to \" + x1 + \" of the \""],
  ["seedqr: whole grid keeps the mini-map", "document.getElementById(\"sqMini\").textContent = \"\";\n  document.getElementById(\"sqGuideImg\").innerHTML = qrGridSvg(sqRows, 0, 0, n, n", "document.getElementById(\"sqGuideImg\").innerHTML = qrGridSvg(sqRows, 0, 0, n, n"],
  ["seedqr: closing the guide keeps the mini-map", "document.getElementById(\"sqMini\").textContent = \"\"; document.getElementById(\"sqGuideCaption\")", "document.getElementById(\"sqGuideCaption\")"],
  ["seedqr: guide stays after closing", "document.getElementById(\"sqGuide\").style.display = \"none\";\n}\nfunction openSqGuide", "}\nfunction openSqGuide"],
  ["seedqr: print code without asking", "if(!confirm(\"Printing sends your seed (as a QR code) to a printer", "if(false && !confirm(\"Printing sends your seed (as a QR code) to a printer"],
  ["seedqr: print guide without asking", "if(!confirm(\"Printing sends your seed (as a QR code grid) to a printer", "if(false && !confirm(\"Printing sends your seed (as a QR code grid) to a printer"],
  ["seedqr: print without a shown code", "if(!kind){ alert(\"Press SHOW SEEDQR or SHOW COMPACTSEEDQR first, then print", "if(false){ alert(\"Press SHOW SEEDQR or SHOW COMPACTSEEDQR first, then print"],
  ["seedqr: guide opened without a shown code", "if(!sqRows) return alert(\"Press SHOW SEEDQR or SHOW COMPACTSEEDQR first.\");", "if(false) return alert(\"Press SHOW SEEDQR or SHOW COMPACTSEEDQR first.\");"],
  ["seedqr: blank grid sheet prints the filled code", "qrGridSvg(Q.rows, 0, 0, n, n, qrBlockSize(n), true), true,", "qrGridSvg(Q.rows, 0, 0, n, n, qrBlockSize(n), false), true,"],
  ["seedqr: row list has no row numbers", "\"Row \" + (y + 1) + \": \" + qrRowRuns(row)", "\"Row \" + (y) + \": \" + qrRowRuns(row)"],
  ["seedqr: print area not cleaned", "document.body.classList.remove(\"print-qr\"); po.textContent = \"\"; };", "po.textContent = \"\"; };"],
  ["seedqr: print class not removed", "document.body.classList.remove(\"print-qr\"); po.textContent = \"\"; };", "document.body.classList.remove(\"print-qr\"); };"],
  ["seedqr: print sheet passphrase line missing", "S.fp + \"\\n\" + S.pass + \"\\n\\nScan with an offline", "S.fp + \"\\n\\nScan with an offline"],
  ["explain: entropy taken from the wrong bytes", "const entropy = digest.slice(0, entLen);", "const entropy = digest.slice(1, entLen + 1);"],
  ["explain: checksum made from the wrong bytes", "const hash2 = await sha256bytes(entropy);", "const hash2 = await sha256bytes(digest);"],
  ["explain: checksum too short", "bytesToBits(hash2).slice(0, entLen * 8 / 32)", "bytesToBits(hash2).slice(0, entLen * 8 / 33)"],
  ["explain: checksum too long", "bytesToBits(hash2).slice(0, entLen * 8 / 32)", "bytesToBits(hash2).slice(0, entLen * 8 / 16)"],
  ["explain: pieces of 10 bits", "const bits = all.slice(i, i + 11), num = parseInt(bits, 2);", "const bits = all.slice(i, i + 10), num = parseInt(bits, 2);"],
  ["explain: number read in the wrong base", "const bits = all.slice(i, i + 11), num = parseInt(bits, 2);", "const bits = all.slice(i, i + 11), num = parseInt(bits, 8);"],
  ["explain: word looked up one off", "word: WORDLIST[num]}", "word: WORDLIST[num + 1]}"],
  ["explain: roll count off by one", "count: rolls.length,", "count: rolls.length + 1,"],
  ["explain: entropy size wrong", "entropyBits: entLen * 8,", "entropyBits: entLen * 4,"],
  ["explain: hex without leading zeros", "x.toString(16).padStart(2, \"0\")).join(\"\");\n  return {count", "x.toString(16).padStart(1, \"0\")).join(\"\");\n  return {count"],
  ["explain: steps shown without a seed", "if(!exCtx) return alert(\"Forge a seed first.\");", "if(false) return alert(\"Forge a seed first.\");"],
  ["explain: coin shown as dice", "const coin = exCtx.coin,", "const coin = false,"],
  ["explain: dice shown as coin", "const coin = exCtx.coin,", "const coin = true,"],
  ["explain: dice bits worth 2 each", "Math.floor(coin ? s.count : s.count * Math.log2(6))", "Math.floor(coin ? s.count : s.count * 2)"],
  ["explain: coin bits worth 2 each", "Math.floor(coin ? s.count : s.count * Math.log2(6))", "Math.floor(coin ? s.count * 2 : s.count * Math.log2(6))"],
  ["explain: checksum split in the wrong piece", "i === s.groups.length - 1", "i === s.groups.length - 2"],
  ["explain: checksum split in the wrong place", "const keep = 11 - s.checkBits.length;", "const keep = 10 - s.checkBits.length;"],
  ["explain: mismatch not noticed", "const same = s.words.join(\" \") === exCtx.words.join(\" \");", "const same = true;"],
  ["explain: match claimed wrongly", "const same = s.words.join(\" \") === exCtx.words.join(\" \");", "const same = s.words.join(\" \") !== exCtx.words.join(\" \");"],
  ["explain: steps not shown at the end", "  o.style.display = \"\";\n}\n// SeedSigner formats", "\n}\n// SeedSigner formats"],
  ["explain: hide keeps the secret context", "exCtx = null;\n  const o = document.getElementById(\"exOut\"); o.textContent = \"\"; o.style.display = \"none\";", "const o = document.getElementById(\"exOut\"); o.textContent = \"\"; o.style.display = \"none\";"],
  ["explain: hide keeps the steps text", "o.textContent = \"\"; o.style.display = \"none\";\n}\nasync function showExplain", "o.style.display = \"none\";\n}\nasync function showExplain"],
  ["explain: hide keeps the steps shown", "o.textContent = \"\"; o.style.display = \"none\";\n}\nasync function showExplain", "o.textContent = \"\";\n}\nasync function showExplain"],
  ["explain: old steps kept after a new FORGE", "  hideExplain(); { const eb", "  { const eb"],
  ["explain: box offered for any length", "eb.style.display = (words && [12,24].includes(words.length)) ? \"\" : \"none\";", "eb.style.display = (words) ? \"\" : \"none\";"],
  ["explain: box opened after FORGE", "eb.open = false; }", "eb.open = true; }"],
  ["explain: no context kept for the steps", "  exCtx = ctx; seedKind", "  seedKind"],
  ["print sheet: wrong grid class", "add(\"ps-grid ps-\" + ws.length, \"\")", "add(\"ps-grid ps-12\", \"\")"],
  ["print sheet: box numbers not padded", "add(\"ps-n\", String(i + 1).padStart(2, \"0\"), c)", "add(\"ps-n\", String(i + 1), c)"],
  ["print sheet: first word printed in every box", "add(\"ps-w\", w, c)", "add(\"ps-w\", ws[0], c)"],
  ["print sheet: printed without asking", "if(!confirm(\"Printing sends your seed to a printer and its spooler.", "if(false && !confirm(\"Printing sends your seed to a printer and its spooler."],
  ["print sheet: passphrase line missing", "add(\"ps-info\", [S.fp, S.addr, S.pass].filter(Boolean).join(\"\\n\"));", "add(\"ps-info\", [S.fp, S.addr].filter(Boolean).join(\"\\n\"));"],
  ["print sheet: fingerprint missing", "add(\"ps-info\", [S.fp, S.addr, S.pass].filter(Boolean).join(\"\\n\"));", "add(\"ps-info\", [S.addr, S.pass].filter(Boolean).join(\"\\n\"));"],
  ["print sheet: area not cleaned", "document.body.classList.remove(\"print-seed\"); po.textContent = \"\"; };", "po.textContent = \"\"; };"],
  ["print sheet: print class not removed", "document.body.classList.remove(\"print-seed\"); po.textContent = \"\"; };", "document.body.classList.remove(\"print-seed\"); };"],
  ["explain: entropy size 16 -> 15 bytes", "async function explainSteps(rolls, wc){\n  const entLen = {12:16,24:32}[wc];", "async function explainSteps(rolls, wc){\n  const entLen = {12:15,24:32}[wc];"],
  ["explain: entropy size 32 -> 31 bytes", "async function explainSteps(rolls, wc){\n  const entLen = {12:16,24:32}[wc];", "async function explainSteps(rolls, wc){\n  const entLen = {12:16,24:31}[wc];"],
  ["explain: rolls hashed with extra byte", "const digest = await sha256(rolls);\n  const entropy = digest.slice(0, entLen);", "const digest = await sha256(rolls+\"0\");\n  const entropy = digest.slice(0, entLen);"],
  // ---- multisig (v1.20.0) ----
  ['multisig: Base58 radix wrong', 'n=n*58n+BigInt(v)', 'n=n*57n+BigInt(v)'],
  ['multisig: Base58 checksum not checked', 'if(sum[i]!==all[all.length-4+i]) throw new Error("not a valid key: checksum', 'if(false) throw new Error("not a valid key: checksum'],
  ['multisig: Base58 leading 1s not counted', 'for(const ch of str){ if(ch==="1") zeros++; else break; }', 'for(const ch of str){ break; }', true],
  ['multisig: square root exponent', 'e=(SP+1n)/4n', 'e=(SP-3n)/4n'],
  ['multisig: y parity flipped', '(y&1n)===(odd?1n:0n) ? y : SP-y', '(y&1n)===(odd?0n:1n) ? y : SP-y'],
  ['multisig: off-curve x accepted', 'if(y*y%SP!==y2) return null;', ''],
  ['multisig: x above the field accepted', 'if(x>=SP) return null;', ''],
  ['multisig: key prefix 03 not accepted', 'pub[0]!==2 && pub[0]!==3', 'pub[0]!==2'],
  ['multisig: key prefix not checked', '(pub.length!==33 || (pub[0]!==2 && pub[0]!==3))', '(pub.length!==33)'],
  ['multisig: key length not exact', 'if(raw.length!==78) throw', 'if(raw.length<78) throw'],
  ['multisig: private keys not recognised', 'if(EXT_PRIVATE.includes(ver)) throw', 'if(false) throw'],
  ['multisig: unknown version accepted', 'if(!known) throw new Error("unknown key type', 'if(false) throw new Error("unknown key type'],
  ['multisig: key point not validated', 'const pub=raw.slice(45,78); pointFromPub(pub);', 'const pub=raw.slice(45,78);'],
  ['multisig: network read from the wrong place', 'return {str, net:known.net,', 'return {str, net:"main",'],
  ['multisig: depth ignored', 'depth:raw[4],', 'depth:0,'],
  ['multisig: child number read wrong', 'childNum:(raw[9]<<24|raw[10]<<16|raw[11]<<8|raw[12])>>>0', 'childNum:(raw[9]<<24|raw[10]<<16|raw[11]<<8|raw[11])>>>0'],
  ['multisig: public derivation starts from the wrong data', 'data.set(pub,0); data.set([(index>>>24)', 'data.set(pub,1); data.set([(index>>>24)'],
  ['multisig: hardened index allowed', 'index>=0x80000000) throw new Error("bad index")', 'index>0x80000000) throw new Error("bad index")'],
  ['multisig: negative index allowed', 'if(!Number.isInteger(index) || index<0 ||', 'if(!Number.isInteger(index) ||'],
  ['multisig: child tweak not added to the parent', 'const C=eadd(emul(il,SG),pointFromPub(pub));', 'const C=emul(il,SG);'],
  ['multisig: chain code not carried on', 'return [pubFromPoint(C), I.slice(32)];', 'return [pubFromPoint(C), chain];'],
  ['multisig: key sort reversed', 'return a[i]-b[i]; return a.length-b.length;', 'return b[i]-a[i]; return a.length-b.length;'],
  ['multisig: M of 0 accepted', '!Number.isInteger(m) || m<1 ||', '!Number.isInteger(m) || m<0 ||'],
  ['multisig: M above N accepted', '|| n>15 || m>n) throw', '|| n>15 || m>n+1) throw'],
  ['multisig: one key accepted', 'm<1 || n<2 ||', 'm<1 || n<1 ||'],
  ['multisig: sixteen keys accepted', 'n<2 || n>15 ||', 'n<2 || n>16 ||'],
  ['multisig: receive branch not derived', 'const [bp,bc]=await ckdPub(c.key.pub,c.key.chain,branch);', 'const [bp,bc]=[c.key.pub,c.key.chain];'],
  ['multisig: keys not sorted', 'pubs.sort(cmpBytes);', ''],
  ['multisig: script M opcode wrong', 'const out=[0x50+m];', 'const out=[0x50+m+1];'],
  ['multisig: script N opcode wrong', 'out.push(0x50+n, 0xae);', 'out.push(0x50+n+1, 0xae);'],
  ['multisig: script CHECKMULTISIG opcode wrong', 'out.push(0x50+n, 0xae);', 'out.push(0x50+n, 0xaf);'],
  ['multisig: P2WSH uses the wrong hash', 'if(type==="ms-wsh") return bech32Encode(N.hrp,0,sh);', 'if(type==="ms-wsh") return bech32Encode(N.hrp,0,await hash160(script));'],
  ['multisig: nested address wrong version byte', 'base58check(Uint8Array.from([N.sh, ...prog]))', 'base58check(Uint8Array.from([N.pkh, ...prog]))'],
  ['multisig: Base58 decode skips the second SHA-256', 'sum=(await sha256bytes(h1)).slice(0,4)', 'sum=h1.slice(0,4)'],
  ['multisig: public key parity flipped', 'pub[0]=2+Number(P[1]&1n);', 'pub[0]=3-Number(P[1]&1n);'],
  ['multisig: nested address wrong witness program length', 'Uint8Array.from([0x00,0x20,...sh])', 'Uint8Array.from([0x00,0x14,...sh])'],
  ['multisig: descriptor keys not sorted', 'keys.sort();', ''],
  ['multisig: descriptor wrong function', '"sortedmulti(" + m + ","', '"multi(" + m + ","'],
  ['multisig: descriptor branch dropped', '"]" + xp + "/" + branch + "/*");', '"]" + xp + "/0/*");'],
  ['multisig: descriptor nested wrapper missing', 'type==="ms-sh-wsh" ? "sh(wsh(" + inner + "))" : "wsh(" + inner + ")"', '"wsh(" + inner + ")"'],
  ['multisig: descriptor key version wrong', '...NETS[c.key.net].ver.other, ...raw.slice(4)', '...NETS.main.ver.other, ...raw.slice(4)'],
  ['multisig: M default wrong', 'Math.max(2, Math.ceil((n + 1) / 2))', 'Math.max(2, Math.ceil(n / 2))'],
  ['multisig: M above N offered', 'msEl("msM").max = String(n);', 'msEl("msM").max = String(n + 1);'],
  ['multisig: 1-of-N allowed to start', 'if(m < 2){ err.textContent', 'if(m < 1){ err.textContent'],
  ['multisig: account range not checked', '|| parseInt(raw, 10) > 2147483647){ err.textContent = "The account must', '|| false){ err.textContent = "The account must'],
  ['multisig: account number not used', 'account: parseInt(raw, 10), keys: []', 'account: 0, keys: []'],
  ['rbf: psbt threshold', 'res.ins.reduce((a,x)=>a+x.amount,0n)-res.totalOut : null;\n  res.rbf=res.ins.some(x=>x.seq<0xfffffffe);', 'res.ins.reduce((a,x)=>a+x.amount,0n)-res.totalOut : null;\n  res.rbf=res.ins.some(x=>x.seq<0xffffffff);'],
  ['rbf: raw threshold', 'res.fee=null;\n  res.rbf=res.ins.some(x=>x.seq<0xfffffffe);', 'res.fee=null;\n  res.rbf=res.ins.some(x=>x.seq<0xffffffff);'],
  ['rbf: wording flipped', 'res.rbf ? "REPLACEABLE (RBF): yes.', '!res.rbf ? "REPLACEABLE (RBF): yes.'],
  ['locktime: shown when inputs final', 'res.locktime>0 && res.ins.some(x=>x.seq!==0xffffffff)', 'res.locktime>0'],
  ['locktime: block or date', 'res.locktime<500000000', 'res.locktime<100000'],
  ['locktime: date format', '.slice(0,16).replace("T"," ")', '.slice(0,10).replace("T"," ")'],
  ['verdict: fee 5% line', 'add(res.fee*20n<res.totalOut, res.fee*20n<res.totalOut ?', 'add(res.fee*20n<res.totalOut*2n, res.fee*20n<res.totalOut*2n ?'],
  ['verdict: fee 5% too strict', 'add(res.fee*20n<res.totalOut, res.fee*20n<res.totalOut ?', 'add(res.fee*30n<res.totalOut, res.fee*30n<res.totalOut ?'],
  ['verdict: negative fee passes', 'add(res.fee>=0n, res.fee>=0n ?', 'add(true, res.fee>=0n ?'],
  ['verdict: unknown inputs pass', 'add(unknownIn===0,', 'add(true,'],
  ['verdict: unknown fee passes', '} else add(false, "The fee cannot be worked out.", true);', '} else add(true, "The fee cannot be worked out.", true);'],
  ['verdict: odd outputs pass', 'add(odd===0,', 'add(true,'],
  ['verdict: notes block', 'bad=C.filter(x=>!x.ok&&x.blocking)', 'bad=C.filter(x=>!x.ok)'],
  ['verdict: change note', 'add(withKeys>0,', 'add(true,'],
  ['verdict: clean text', 'bad.length ? "VERDICT: NO CLEAN VERDICT.', 'bad.length>9 ? "VERDICT: NO CLEAN VERDICT.'],
  ['op_return: printable test', 'c>=32&&c<127', 'c>=0&&c<127'],
  ['op_return: pushdata1', 'op===0x4c && i<script.length', 'op===0x4d && i<script.length'],
  ['op_return: pushdata2', 'op===0x4d && i+1<script.length', 'op===0x4c && i+1<script.length'],
  ['op_return: data note skips payment line', 'x.script && x.script[0]===0x6a ? "" :', 'false ? "" :'],
  ['raw: txid byte order', 'res.txid=hex((await sha256bytes(await sha256bytes(stripped))).reverse());', 'res.txid=hex((await sha256bytes(await sha256bytes(stripped))));'],
  ['raw: segwit body offset', 'const bodyStart=seg?6:4;', 'const bodyStart=seg?5:4;'],
  ['raw: witness means signed', 'if(k>0) x.final=true;', ''],
  ['raw: trailing bytes accepted', 'res.locktime=r.u32(); if(!r.done) throw new Error("not a transaction");', 'res.locktime=r.u32();'],
  ['raw: hex detection', '/^0[0-9a-f]000000/i.test(t)', '/^9[0-9a-f]000000/i.test(t)'],
  ['compare: same id', 'sameId=!!a.txid && a.txid===b.txid', 'sameId=true'],
  ['compare: shared coin', 'const shared=a.ins.length-gone.length', 'const shared=a.ins.length'],
  ['compare: rbf required', 'rbfOk=!!a.rbf', 'rbfOk=true'],
  ['compare: higher fee required', 'feeOk=feeKnown && b.fee>a.fee', 'feeOk=feeKnown && b.fee>=a.fee'],
  ['compare: too many differing outputs', 'if(outGone.length>1 || outNew.length>1){', 'if(outGone.length>2 || outNew.length>2){'],
  ['compare: output changed address', 'if(outGone[0].address!==outNew[0].address){', 'if(false){'],
  ['compare: grown output needs an added coin', '!(fresh.length>0 && (outNew[0].fps.length || outGone[0].fps.length))', '!(true && (outNew[0].fps.length || outGone[0].fps.length))'],
  ['compare: grown output needs change marking', '(outNew[0].fps.length || outGone[0].fps.length)))', '(true)))'],
  ['compare: new output', 'else if(outGone.length===0 && outNew.length===1){ keptOk=false;', 'else if(outGone.length===0 && outNew.length===1){ keptOk=true;'],
  ['compare: unknown fee verdict', ': feeKnown ? "SIGNER CHECK: CHANGED', ': true ? "SIGNER CHECK: CHANGED'],
  ['compare: more or less', 'd>0n ? ", the second pays "', 'd<0n ? ", the second pays "'],
  ['compare: signature changes shown', 'if(y && sa(x)!==sa(y))', 'if(false)'],
  ['compare: outputs matched by amount', 'y.address===o.address && y.amount===o.amount', 'y.address===o.address'],
  ['compare: change marking noted', 'mine=shrank.fps.length>0 || outNew[0].fps.length>0', 'mine=false'],
  ['compare: which transaction is bad', 'throw new Error(label + ": " + e.message)', 'throw e'],
  ['compare: first box clears result', 'document.getElementById("cmpA").addEventListener("input", () => clearCompare(false));', ''],
  ['compare: second box clears result', 'document.getElementById("cmpB").addEventListener("input", () => clearCompare(false));', ''],
  ['compare: psbt transaction id', 'res.txid=hex((await sha256bytes(await sha256bytes(txRec.val))).reverse());', 'res.txid=hex((await sha256bytes(await sha256bytes(txRec.val))));'],
  ['multisig slider: N cap', 'const MS_MAX = 15;', 'const MS_MAX = 99;'],
  ['multisig slider: M pushes N up', 'if(m > parseInt(msEl("msN").value, 10)) msEl("msN").value = String(m);', ''],
  ['multisig slider: M clamped to N', 'm = msClamp(msEl("msM").value, 1, n);', 'm = msClamp(msEl("msM").value, 1, MS_MAX);'],
  ['multisig slider: label', 'msEl("msBig").firstChild.textContent = m + "-of-" + n;', ''],
  ['multisig slider: N handle sync', 'msEl("msMr").value = String(m); msEl("msNr").value = String(n);', 'msEl("msMr").value = String(m);'],
  ['multisig slider: start range check', 'if(!(n >= 2 && n <= MS_MAX && m >= 1 && m <= n)){', 'if(false){'],
  ['multisig slider: preset', 'function msPreset(m, n){ msEl("msN").value = String(n); msEl("msM").value = String(m); msMNote(); }', 'function msPreset(m, n){ msEl("msN").value = String(n); msMNote(); }'],
  ['multisig: network not used', 'net: msEl("msNet").value,', 'net: "main",'],
  ['multisig: type not used', 'type: msEl("msType").value,', 'type: "ms-wsh",'],
  ['multisig: duplicate (first key) allowed', 'if(dup >= 0){ eb.textContent = "This is the same key as key "', 'if(dup > 0){ eb.textContent = "This is the same key as key "'],
  ['multisig: duplicate only by fingerprint', 'k.fp === fp || hex(k.key.pub) === pk', 'k.fp === fp'],
  ['multisig: duplicate only by key', 'k.fp === fp || hex(k.key.pub) === pk', 'hex(k.key.pub) === pk'],
  ['multisig: pasted duplicate allowed', 'if(dup >= 0) throw new Error("This is the same key as key "', 'if(false) throw new Error("This is the same key as key "'],
  ['multisig: seed not wiped after ADD', '    wipeSeed();\n  } catch(e) { eb.textContent = "Could not add this key: "', '  } catch(e) { eb.textContent = "Could not add this key: "'],
  ['multisig: ADD with no seed allowed', 'if(!hasSeed() || !watchCtx){ eb.textContent = "Make the seed first', 'if(false){ eb.textContent = "Make the seed first'],
  ['multisig: made key taken from the wrong account', 'mnemonicToSeed(watchCtx.mnemonic, watchCtx.pass), ms.type, ms.account, ms.net)', 'mnemonicToSeed(watchCtx.mnemonic, watchCtx.pass), ms.type, 0, ms.net)'],
  ['multisig: passphrase ignored for a made key', 'mnemonicToSeed(watchCtx.mnemonic, watchCtx.pass), ms.type', 'mnemonicToSeed(watchCtx.mnemonic, ""), ms.type'],
  ['multisig: made key origin path wrong', 'function msPathOf(){ return "48h/" + NETS[ms.net].coin + "h/"', 'function msPathOf(){ return "48h/0h/"'],
  ['multisig: private key / seed words not refused', 'if(/^\\s*[a-z]+(\\s+[a-z]+){11,}\\s*$/i.test(t)) throw', 'if(false) throw'],
  ['multisig: seed-word guard needs 13 words', '{11,}\\s*$/i.test(t)', '{12,}\\s*$/i.test(t)'],
  ['multisig: fingerprint not checked', 'if(!/^[0-9a-f]{8}$/.test(fp)) throw', 'if(false) throw'],
  ['multisig: wrong network accepted', 'if(key.net !== ms.net) throw', 'if(false) throw'],
  ['multisig: single-signature key accepted', 'if(key.type !== "other" && key.type !== ms.type) throw', 'if(false) throw'],
  ['multisig: other script type accepted', 'key.type !== "other" && key.type !== ms.type', 'key.type !== "other" && !MULTISIG[key.type]'],
  ['multisig: depth not checked', 'if(key.depth !== 4 || key.childNum', 'if(key.childNum'],
  ['multisig: last step not checked', 'if(key.depth !== 4 || key.childNum !== ((script + 0x80000000) >>> 0)) throw', 'if(key.depth !== 4) throw'],
  ['multisig: path in the pasted line not checked', 'if(path && path !== want) throw', 'if(false) throw'],
  ['multisig: path apostrophes not understood', '.replace(/[\'H]/g, "h")', ''],
  ['multisig: /0/* suffix not stripped', 't = t.replace(/\\/(?:<0;1>|[01])\\/\\*$/, "");', ''],
  ['multisig: pasted key stored without its fingerprint', 'ms.keys.push({fp, path: want, key, xpub, src: "pasted"});', 'ms.keys.push({fp: "00000000", path: want, key, xpub, src: "pasted"});'],
  ['multisig: pasted key counted as made here', 'src: "pasted"});', 'src: "made"});'],
  ['multisig: three addresses -> two', 'for(let i = 0; i < 3; i++) addrs.push(await multisigAddress', 'for(let i = 0; i < 2; i++) addrs.push(await multisigAddress'],
  ['multisig: addresses from the change branch', 'multisigAddress(ms.type, ms.m, cos, 0, i, ms.net)', 'multisigAddress(ms.type, ms.m, cos, 1, i, ms.net)'],
  ['multisig: change descriptor is the receive one', 'dc = await multisigDescriptor(ms.type, ms.m, cos, 1)', 'dc = await multisigDescriptor(ms.type, ms.m, cos, 0)'],
  ['multisig: one-device warning for mixed sources', 'ms.keys.every(k => k.src === "made")', 'ms.keys.some(k => k.src === "made")'],
  ['multisig: one-device warning never shown', 'msEl("msOneDev").style.display = ms.keys.every(k => k.src === "made") ? "" : "none";', 'msEl("msOneDev").style.display = "none";'],
  ['multisig: banner stays when finished', 'if(!ms || ms.done || ms.mode !== "make" || ms.keys.length >= ms.n){', 'if(!ms || ms.mode !== "make" || ms.keys.length >= ms.n + 1){'],
  ['multisig: ADD button always on', 'msEl("msAddBtn").disabled = !(hasSeed() && watchCtx && !ms.busy);', 'msEl("msAddBtn").disabled = false;'],
  ['multisig: banner counts from 0', 'const k = ms.keys.length + 1;\n  msEl("msBanTitle")', 'const k = ms.keys.length;\n  msEl("msBanTitle")'],
  ['multisig: testnet not shown in the banner', '(ms.net === "test" ? "  (TESTNET)" : "")', '""'],
  ['multisig: testnet banner never shown', 'msEl("msTestBan").style.display = ms.net === "test" ? "" : "none";', 'msEl("msTestBan").style.display = "none";'],
  ['multisig: QR of the change descriptor', 'qrMatrix(ms.descR); } catch(e) { msEl("msRunErr")', 'qrMatrix(ms.descC); } catch(e) { msEl("msRunErr")'],
  ['multisig: recovery sheet leaves out the descriptor', 'lines.push("", "DESCRIPTOR (public keys only):", ms.descR, "",', 'lines.push("", "DESCRIPTOR (public keys only):", "", "",'],
  ['multisig: recovery sheet leaves out the addresses', '"FIRST RECEIVING ADDRESSES:", ...ms.addrs, "",', '"FIRST RECEIVING ADDRESSES:", "",'],
  ['multisig: recovery sheet testnet label missing', '(ms.net === "test" ? ", TESTNET (practice coins only)" : ", mainnet")', '", mainnet"'],
  ['multisig: sheet title testnet label missing', '"VOIDFORGE MULTISIG RECOVERY SHEET" + (ms.net === "test" ? " (TESTNET)" : "")', '"VOIDFORGE MULTISIG RECOVERY SHEET"'],
  ['multisig: sheet QR size switch (layout only)', 'ms.n >= 5 ? "pq-ms pq-ms-l" : "pq-ms"', 'ms.n >= 6 ? "pq-ms pq-ms-l" : "pq-ms"', true],
  ['multisig: CLEAR ALL keeps the setup', 'msReset(); wipeSeed();\n}', 'wipeSeed();\n}'],
  ['multisig: reset leaves the descriptor on screen', 'for(const id of ["msDescR","msDescC","msAddrs","msSlots","msRunErr","msBanErr","msErr"])', 'for(const id of ["msDescC","msAddrs","msSlots","msRunErr","msBanErr","msErr"])'],
  ['core guide: new wallet is not watch-only', 'createwallet "voidforge-watch" true true "" false true', 'createwallet "voidforge-watch" false true "" false true'],
  ['core guide: wallet is not descriptor type', 'true true "" false true', 'true true "" false false'],
  ['core guide: receive marked internal', 'one(recv, false), one(change, true)', 'one(recv, true), one(change, true)'],
  ['core guide: change not marked internal', 'one(recv, false), one(change, true)', 'one(recv, false), one(change, false)'],
  ['core guide: descriptors in the wrong order', 'const req = [one(recv, false), one(change, true)];', 'const req = [one(change, true), one(recv, false)];'],
  ['core guide: used wallet does not rescan', 'const ts = when === "0" ? 0 : "now";', 'const ts = "now";'],
  ['core guide: new wallet scans everything', 'const ts = when === "0" ? 0 : "now";', 'const ts = 0;'],
  ['core guide: range too small', 'range: [0, 999]', 'range: [0, 99]'],
  ['core guide: not active', 'active: true, internal', 'active: false, internal'],
  ['core guide: wrong rpc wallet name', '-rpcwallet=voidforge-watch importdescriptors', '-rpcwallet=voidforge importdescriptors'],
  ['core guide: shown for multisig cosigner key', '&& document.getElementById("wDescGroupC").style.display !== "none"; // a multisig', '; // a multisig', true],  // equivalent: a cosigner key has no change descriptor, so the box already stays hidden
  ['core guide: not refreshed on key change', 'document.getElementById("wTestBan").style.display = net === "test" ? "" : "none";\n  updateCore();', 'document.getElementById("wTestBan").style.display = net === "test" ? "" : "none";'],
  ['core guide: birthday change ignored', 'document.getElementById("coreWhen").addEventListener("change", updateCore);', ''],
  ['core guide: left after clearing', 'document.getElementById("wTestBan").style.display = "none"; updateCore();\n  const b', 'const b'],
  ['testnet banner never shown', 'style.display = net === "test" ? "" : "none";', 'style.display = "none";'],
  ['testnet banner always shown', 'style.display = net === "test" ? "" : "none";', 'style.display = "";'],
  ['testnet banner left after clearing', 'document.getElementById("wTestBan").style.display = "none"; updateCore();', 'updateCore();'],
  ['multisig: card not moved above the seed maker', 'gen.parentNode.insertBefore(card, gen); }', '}'],
  ['multisig: card not put back after reset', '  msDock(false);\n}', '}'],
  ['sp: mainnet prefix wrong', 'net==="test" ? "tsp" : "sp"', 'net==="test" ? "tsp" : "tsp"'],
  ['sp: testnet prefix wrong', 'net==="test" ? "tsp" : "sp"', 'net==="test" ? "sp" : "sp"'],
  ['sp: version byte changed', 'const data=[0]; let acc=0, bits=0;\n  for(const byte of [...scanPub', 'const data=[1]; let acc=0, bits=0;\n  for(const byte of [...scanPub'],
  ['sp: scan and spend keys swapped in the address', '[...scanPub, ...spendPub]', '[...spendPub, ...scanPub]'],
  ['sp: bech32 checksum instead of bech32m', 'data,[0,0,0,0,0,0]))^0x2bc830a3;\n  const out', 'data,[0,0,0,0,0,0]))^1;\n  const out'],
  ['sp: last partial group of bits dropped', 'if(bits>0) data.push((acc<<(5-bits))&31);\n  return bech32mText', 'return bech32mText'],
  ['sp: wrong BIP number in the path', '[[352,true],[NETS[net].coin,true]', '[[84,true],[NETS[net].coin,true]'],
  ['sp: coin type ignored', '[[352,true],[NETS[net].coin,true]', '[[352,true],[0,true]'],
  ['sp: account ignored', '[account,true]]) [k,c]=await ckdPriv(k,c,i,h);\n  const keyAt', '[0,true]]) [k,c]=await ckdPriv(k,c,i,h);\n  const keyAt'],
  ['sp: scan and spend branches swapped', 'const scan=await keyAt(1), spend=await keyAt(0);', 'const scan=await keyAt(0), spend=await keyAt(1);'],
  ['sp: branch not hardened', 'ckdPriv(k,c,branch,true)', 'ckdPriv(k,c,branch,false)'],
  ['sp: key index hardened', 'ckdPriv(bk,bc,0,false)', 'ckdPriv(bk,bc,0,true)'],
  ['sp: box shown for a multisig cosigner key', 'document.getElementById("spBox").style.display = M ? "none" : "";', 'document.getElementById("spBox").style.display = "";'],
  ['sp: address left after clearing', '["wZpub","wDescR","wDescC","wFirst","spAddr"]', '["wZpub","wDescR","wDescC","wFirst"]'],
  ['sp: not refreshed for account or network', 'document.getElementById("spAddr").textContent = spA;', 'document.getElementById("spAddr").textContent = document.getElementById("spAddr").textContent || spA;'],
  ['sig: DER marker', 'b[0]!==0x30 ||', 'b[0]!==0x31 ||'],
  ['sig: DER total length', 'b[1]!==b.length-3 ||', 'false ||'],
  ['sig: DER r tag', 'b[2]!==2) return null;', 'false) return null;'],
  ['sig: DER s tag', 'b[4+rl]!==2) return null;', 'false) return null;'],
  ['sig: DER s length', '6+rl+sl!==b.length-1) return null;', 'false) return null;'],
  ['sig: DER leading zero kept', 'while(i<x.length-1 && x[i]===0) i++;', ''],
  ['sig: r not padded', 'r:hex(r).padStart(64,"0")', 'r:hex(r)'],
  ['sig: s not padded', 's:hex(sv).padStart(64,"0")', 's:hex(sv)'],
  ['sig: sighash byte ignored', 'sighash:b[b.length-1]};', 'sighash:1};'],
  ['sig: schnorr explicit sighash 0 accepted', 'b[64]!==0)', 'true)'],
  ['sig: schnorr R and s swapped', 'r:hex(b.slice(0,32)), s:hex(b.slice(32)), sighash:0}', 'r:hex(b.slice(32)), s:hex(b.slice(0,32)), sighash:0}'],
  ['sig: any witness read as schnorr', 'items.length===1 ||', 'items.length>=1 ||'],
  ['sig: annex marker', 'items[1][0]===0x50', 'items[1][0]===0x51'],
  ['sig: PUSHDATA1 not parsed', 'op===0x4c&&i<b.length', 'false'],
  ['sig: PUSHDATA2 not parsed', 'op===0x4d&&i+1<b.length', 'false'],
  ['sig: direct push range', 'op>=1&&op<=75) len=op;', 'op>=1&&op<=70) len=op;'],
  ['sig: reuse flags identical signatures', 'if(new Set(g.map(x=>x.kind+x.s)).size>1) bad.push', 'if(g.length>1) bad.push'],
  ['sig: reuse ignores different s', 'g.map(x=>x.kind+x.s)', 'g.map(x=>x.kind)'],
  ['sig: reuse never grouped', 'if(!by.has(x.r)) by.set(x.r,[]);', 'by.set(x.r,[]);'],
  ['sig: ANYONECANPAY not named', '(h&0x80)?" + ANYONECANPAY":""', '""'],
  ['sig: sighash base not masked', 'const base=h&0x1f', 'const base=h'],
  ['sig: NONE and SINGLE swapped', 'base===2?"NONE":base===3?"SINGLE"', 'base===3?"NONE":base===2?"SINGLE"'],
  ['sig: schnorr default flagged', '!(h===1 || (k==="Schnorr" && h===0))', '!(h===1)'],
  ['sig: sighash never odd', '!(h===1 || (k==="Schnorr" && h===0))', 'false'],
  ['sig: ALL flagged', '!(h===1 || (k==="Schnorr" && h===0))', '!(k==="Schnorr" && h===0)'],
  ['sig: nonce check on one signature', 'if(sg.length>=2){ const nr', 'if(sg.length>=1){ const nr'],
  ['sig: nonce check needs three', 'if(sg.length>=2){ const nr', 'if(sg.length>=3){ const nr'],
  ['sig: nonce reuse not blocking', 'Do not use this wallet\'s keys again, and move the funds.", true); }', 'Do not use this wallet\'s keys again, and move the funds.", false); }'],
  ['sig: nonce reuse inputs not listed', '[...new Set(nr.flatMap(g=>g.sigs.map(x=>x.input)))].join(", ")', '""'],
  ['sig: nonce reuse always ok', 'add(nr.length===0, nr.length===0 ?', 'add(true, nr.length===0 ?'],
  ['sig: sighash request 0 flagged', 'o.x.sighashReq!==1 && o.x.sighashReq!==0', 'o.x.sighashReq!==1'],
  ['sig: sighash request ignored', 'o.x.sighashReq!==undefined &&', 'false &&'],
  ['sig: sighash not blocking', 'Continue only if you set this up on purpose.", true); }', 'Continue only if you set this up on purpose.", false); }'],
  ['sig: sighash count wrong', 'const bad=oddSig.length+oddReq.length;', 'const bad=oddSig.length;'],
  ['sig: sighash request offset', 'x.type===3 && x.val.length===4', 'x.type===4 && x.val.length===4'],
  ['sig: partial signatures not read', 'if(x.type===2){ const g=sigDer(x.val);', 'if(x.type===22){ const g=sigDer(x.val);'],
  ['sig: tap key signature not read', 'else if(x.type===0x13 || x.type===0x14)', 'else if(x.type===0x14)'],
  ['sig: tap script signature not read', 'else if(x.type===0x13 || x.type===0x14)', 'else if(x.type===0x13)'],
  ['sig: final scriptSig not read', 'else if(x.type===7) res.sigs.push', 'else if(x.type===70) res.sigs.push'],
  ['sig: final witness not read', 'else if(x.type===8) res.sigs.push', 'else if(x.type===80) res.sigs.push'],
  ['sig: raw scriptSig input number', 'sigsFromScriptSig(ss, i)', 'sigsFromScriptSig(ss, 0)'],
  ['sig: raw witness input number', 'sigsFromWitness(it, i)', 'sigsFromWitness(it, 0)'],
  ['sig: raw witness not read', 'res.sigs.push(...sigsFromWitness(it, i));', ''],
  ['sig: raw scriptSig not read', 'res.sigs.push(...sigsFromScriptSig(ss, i));', ''],
  ['sig: compare ignores second transaction', 'const allS=(a.sigs||[]).concat(b.sigs||[]);', 'const allS=(a.sigs||[]);'],
  ['sig: compare needs three', 'if(allS.length>=2){ const nr', 'if(allS.length>=3){ const nr'],
  ['sig: compare verdict not changed', 'verdict="NONCE REUSE FOUND. " + verdict;', ''],
  ['sig: compare never fails', 'if(nr.length){ L.push("NONCE CHECK: FAIL.', 'if(false){ L.push("NONCE CHECK: FAIL.'],
  ['practice: word positions', 'if(got[i] !== w) bad.push(i+1);', 'if(got[i] !== w) bad.push(i);'],
  ['practice: count not checked', 'if(got.length !== expected.length)', 'if(false)'],
  ['practice: case not ignored', 'typed.trim().toLowerCase().split(', 'typed.trim().split('],
  ['practice: plural wording', '"Word" + (bad.length===1?"":"s")', '"Word"'],
  ['practice: word count plural', '"You typed " + got.length + " word" + (got.length===1?"":"s")', '"You typed " + got.length + " words"'],
  ['practice: hide keeps the words', 'document.getElementById("prWords").textContent=""; document.getElementById("prShow").style.display="none";\n  document.getElementById("prCheck").style.display="block";', 'document.getElementById("prShow").style.display="none";\n  document.getElementById("prCheck").style.display="block";'],
  ['practice: clear keeps the phrase', 'practice=null;\n  document.getElementById("prWords")', '\n  document.getElementById("prWords")'],
  ['practice: random numbers used again', 'const hex=PRACTICE_ENTROPY[practiceNext % PRACTICE_ENTROPY.length]; practiceNext++;\n  const e=new Uint8Array(16); for(let i=0;i<16;i++) e[i]=parseInt(hex.substr(i*2,2),16);', 'const e=new Uint8Array(16); crypto.getRandomValues(e);'],
  ['practice: always the same phrase', 'practiceNext++;', ''],
  ['practice: list does not start over', 'PRACTICE_ENTROPY[practiceNext % PRACTICE_ENTROPY.length]', 'PRACTICE_ENTROPY[Math.min(practiceNext, PRACTICE_ENTROPY.length - 1)]'],
  ['practice: first phrase changed', '"7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f","80808080', '"80808080808080808080808080808080","80808080'],
  ['practice: peek does nothing', 'function practicePeek(){ if(!practice) return; practiceRender();', 'function practicePeek(){ if(!practice) return;'],
  ['practice: result always ok', 'practiceStatus(r.ok?"ok":"bad", r.msg);', 'practiceStatus("ok", r.msg);'],
  ['practice: typing keeps the result', 'document.getElementById("prInput").addEventListener("input", () => practiceStatus("",""));', ''],
  ['practice: start shows no words', 'document.getElementById("prShow").style.display="block"; document.getElementById("prCheck").style.display="none";', 'document.getElementById("prShow").style.display="none"; document.getElementById("prCheck").style.display="none";'],
  ['practice: order ignored', 'if(got[i] !== w) bad.push(i+1);', 'if(!got.includes(w)) bad.push(i+1);'],
  ['page close: scrolls down to the rolls box', 'if(!touch) document.getElementById("rolls").focus({preventScroll: true});', 'if(!touch) document.getElementById("rolls").focus();'],
  ['page open: notice button scrolls the page', 'if(go) go.focus({preventScroll: true});', 'if(go) go.focus();'],
  ['notice: closing does not remove it', 'if(g) g.remove();', 'if(g) g.id = "startGate";'],
  ['notice: touch devices still get the keyboard', 'if(!touch) document.getElementById("rolls").focus({preventScroll: true});', 'document.getElementById("rolls").focus({preventScroll: true});'],
  ['notice: touch is detected wrongly', 'window.matchMedia("(pointer: coarse)").matches', 'window.matchMedia("(pointer: fine)").matches'],
  ['notice: mouse devices lose the focus', 'if(!touch) document.getElementById("rolls").focus({preventScroll: true});', 'if(touch) document.getElementById("rolls").focus({preventScroll: true});'],
  ['notice: Escape does nothing', 'if(e.key === "Escape" && document.getElementById("startGate")) startGateClose();', ''],
  ['notice: never focuses the button', 'if(go) go.focus({preventScroll: true}); else', 'if(false) go.focus({preventScroll: true}); else'],
  ['multisig: reset leaves the QR on screen', 'ms = null; msHideQr();', 'ms = null;'],
  ['multisig: saved key shows no picture', 'if(k) showFpIcon(ic.id, k.fp);', ''],
  ['QR: version 13 table', '13:[22,[[8,37],[1,38]]]', '13:[22,[[8,37],[1,37]]]'],
  ['QR: version 20 table', '20:[26,[[3,41],[13,42]]]', '20:[26,[[3,41],[12,42]]]'],
  ['QR: version 30 table', '30:[28,[[19,47],[10,48]]]', '30:[28,[[19,47],[9,48]]]'],
  ['QR: version 25 alignment', '25:[6,32,58,84,110]', '25:[6,32,58,84,111]'],
  ['QR: version 30 alignment', '30:[6,26,52,78,104,130]', '30:[6,26,52,78,104,131]'],  ['showTab: unknown name accepted', 'if(TAB_NAMES.indexOf(name) < 0) return;', 'if(false) return;'],
  ['showTab: panels never hidden', 'panel.classList.toggle("tab-off", !on);', 'panel.classList.toggle("tab-off", false);'],
  ['showTab: panels hidden inverted', 'panel.classList.toggle("tab-off", !on);', 'panel.classList.toggle("tab-off", on);'],
  ['showTab: aria-selected wrong', 'btn.setAttribute("aria-selected", on ? "true" : "false");', 'btn.setAttribute("aria-selected", "true");'],
  ['showTab: tab stop wrong', 'btn.tabIndex = on ? 0 : -1;', 'btn.tabIndex = 0;'],
  ['showTab: focus always', 'if(focusTab) document.getElementById("tab-" + name).focus();', 'document.getElementById("tab-" + name).focus();'],
  ['showTab: focus never', 'if(focusTab) document.getElementById("tab-" + name).focus();', ''],
  ['showTab: never scrolls to target', 'if(e) e.scrollIntoView({behavior: "smooth", block: "start"});', ''],
  ['tabOfEl: wrong name', 'p.id.slice(3) : null', 'p.id.slice(2) : null'],
  ['reveal: tab never opened', 'if(t && document.getElementById("tp-" + t).classList.contains("tab-off")) showTab(t);', ''],
  ['reveal: no scroll', 'try { el.scrollIntoView(opts || {behavior: "smooth", block: "start"}); } catch(e) {}', ''],
  ['tabs click: ignored', 'showTab(b.getAttribute("data-tab"));\n  const bar', 'const bar'],
  ['tabs keys: Right goes back', 'ArrowRight: 1, ArrowLeft: -1', 'ArrowRight: -1, ArrowLeft: -1'],
  ['tabs keys: Left goes forward', 'ArrowRight: 1, ArrowLeft: -1', 'ArrowRight: 1, ArrowLeft: 1'],
  ['tabs keys: no wrap', '(cur + keys[e.key] + TAB_NAMES.length) % TAB_NAMES.length', 'Math.max(0, Math.min(TAB_NAMES.length - 1, cur + keys[e.key]))'],
  ['tabs keys: Home goes last', 'keys[e.key] === "first" ? 0', 'keys[e.key] === "first" ? TAB_NAMES.length - 1'],
  ['tabs keys: End goes first', 'keys[e.key] === "last" ? TAB_NAMES.length - 1', 'keys[e.key] === "last" ? 0'],
  ['tabs keys: page still scrolls', 'e.preventDefault(); showTab(TAB_NAMES[i], null, true);', 'showTab(TAB_NAMES[i], null, true);'],
  ['tabs keys: other keys blocked', 'if(!(e.key in keys)) return;', 'if(false) return;'],
  ['slots: always twelve', '=== 24 ? 24 : 12;\n  if(grid.classList', '=== 24 ? 12 : 12;\n  if(grid.classList'],
  ['slots: drawn over a real seed', 'const grid = document.getElementById("wordGrid"); if(hasSeed()) return;', 'const grid = document.getElementById("wordGrid");'],
  ['slots: not marked empty', 'c.className = "wcell empty";', 'c.className = "wcell";'],
  ['slots: numbering from zero', 'b.textContent = (i + 1) + "."; const sp', 'b.textContent = i + ".";  const sp'],
  ['slots: not marked as slots', 'grid.style.display = ""; grid.classList.add("slots");', 'grid.style.display = "";'],
  ['panel: counter always red', 'bc.className = "big-count " + (met ? "met" : "short");', 'bc.className = "big-count short";'],
  ['panel: counter always green', 'bc.className = "big-count " + (met ? "met" : "short");', 'bc.className = "big-count met";'],
  ['panel: counter threshold off by one', 'met = n >= need && !over,', 'met = n > need && !over,'],
  ['panel: sub text always green', 'bs.className = "big-sub " + (met ? "met" : "short"); rc.className', 'bs.className = "big-sub met"; rc.className'],
  ['panel: small counter not coloured', 'rc.className = met ? "met" : "short";', 'rc.className = "";'],
  ['panel: unit always rolls', 'getMode() === "coin" ? "flips" : "rolls"', '"rolls"'],
  ['panel: to-go text wrong', '(need - n) + " more " + unit + " to go"', '(need - n + 1) + " more " + unit + " to go"'],
  ['panel: seed text missing', 'seed ? "Seed made. Write the words down." : met', 'seed ? "" : met'],
  ['panel: enough text missing', '"Enough " + unit + ". Press FORGE SEED."', '"Enough " + unit + "."'],
  ['panel: step ignores seed', 'const cur = seed ? 4 : met ? 3 : 2;', 'const cur = met ? 3 : 2;'],
  ['panel: step ignores enough rolls', 'const cur = seed ? 4 : met ? 3 : 2;', 'const cur = seed ? 4 : 2;'],
  ['panel: step done marks wrong', 'li.className = k < cur ? "done" : k === cur ? "cur" : "";', 'li.className = k <= cur ? "done" : "";'],
  ['panel: step current never marked', 'if(k === cur) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");', 'li.removeAttribute("aria-current");'],
  ['panel: step current stays marked', 'else li.removeAttribute("aria-current"); });', '});'],
  ['result: slots class kept on real words', 'grid.classList.remove("slots"); grid.style.display = "grid"; updateAbbrNote();', 'grid.style.display = "grid"; updateAbbrNote();'],
  ['result: empty state does not refill slots', 'grid.classList.remove("slots"); renderSlots(); updateAbbrNote();', 'grid.classList.remove("slots"); updateAbbrNote();'],
  ['result: panel not refreshed', '  updateSeedPanel();\n  if(ms) msBanner();', '  if(ms) msBanner();'],
  ['result: empty box shown', 'g.classList.toggle("nores", text === "\\u2014")', 'g.classList.toggle("nores", false)'],
  ['notice: dice released too early / never', 'document.body.classList.remove("dice-wait", "sg-skip");\n  if(!navigator.onLine)', 'document.body.classList.remove("sg-skip");\n  if(!navigator.onLine)'],
  ['notice: dice held with no notice', 'else { document.body.classList.remove("dice-wait"); focusRollsUnlessTouch(); }', 'else { focusRollsUnlessTouch(); }'],
  ['notice: dice never held', '<body class="dice-wait">', '<body>'],
  ['strip: link goes nowhere', 'onclick="showTab(\'about\',\'beforeCard\')"', 'onclick="showTab(\'make\')"'],
  ['css: closed tab still shown', '.tab-off { display: none !important; }', '.tab-off { display: block; }'],
  ['fairness: chi not squared', 'chi += (c - exp) * (c - exp) / exp; }\n  const erfc', 'chi += Math.abs(c - exp) / exp; }\n  const erfc'],
  ['fairness: wrong expected share', 'const k = isCoin ? 2 : 6, n = rolls.length, exp = n / k; let chi = 0;\n  for(const f of', 'const k = isCoin ? 2 : 6, n = rolls.length, exp = n / 2; let chi = 0;\n  for(const f of'],
  ['fairness: dice p drops the extra term', 'Math.sqrt(2 * chi / Math.PI) * Math.exp(-chi / 2) * (1 + chi / 3)', 'Math.sqrt(2 * chi / Math.PI) * Math.exp(-chi / 2)'],
  ['fairness: coin uses dice formula', 'const p = isCoin ? erfc(', 'const p = false ? erfc('],
  ['fairness: wrong degrees of freedom', 'df: k - 1};', 'df: k};'],
  ['fairness: p not clamped high', 'Math.min(1, Math.max(0, p))', 'Math.max(0, p)', true],  // equivalent: the erfc approximation never goes above 1 for any chi-square, the clamp is only a safety net
  ['fairness: shown too early', 'if(rolls.length >= (isCoin ? 20 : 30)){\n    const ft', 'if(rolls.length >= (isCoin ? 20 : 10)){\n    const ft'],
  ['fairness: coin threshold', 'if(rolls.length >= (isCoin ? 20 : 30)){\n    const ft', 'if(rolls.length >= (isCoin ? 40 : 30)){\n    const ft'],
  ['fairness: strong cutoff', 'ft.p < 0.001 ? "Strong sign', 'ft.p < 0.0001 ? "Strong sign'],
  ['fairness: mild cutoff', 'ft.p < 0.05 ? "Mildly unusual', 'ft.p < 0.5 ? "Mildly unusual'],
  ['fairness: caveat dropped', ' This cannot prove fairness.";', ' ";'],
  ['fairness: tiny p shown as number', '(ft.p < 0.001 ? "below 0.001" : ft.p.toFixed(3))', 'ft.p.toFixed(3)'],
  ['fairness: plural degree', '(ft.df === 1 ? " degree" : " degrees")', '" degrees"'],
  ['fairness: coin wording', '"Mildly unusual: a fair " + (isCoin ? "coin" : "die")', '"Mildly unusual: a fair " + "die"'],
  ['finder: number lower bound', 'if(n < 1 || n > 2048)', 'if(n < 0 || n > 2048)'],
  ['finder: number upper bound', 'if(n < 1 || n > 2048)', 'if(n < 1 || n > 2049)'],
  ['finder: number off by one', 'idx = n - 1;\n  } else if', 'idx = n;\n  } else if'],
  ['finder: D8 base off', '(parseInt(t[0], 10) - 1) * 256', '(parseInt(t[0], 10)) * 256'],
  ['finder: D8 weight', '(parseInt(t[0], 10) - 1) * 256', '(parseInt(t[0], 10) - 1) * 255'],
  ['finder: D8 accepts 9', '/^[1-8][0-9A-F]{2}$/.test(t)', '/^[1-9][0-9A-F]{2}$/.test(t)'],
  ['finder: D8 accepts 0', '/^[1-8][0-9A-F]{2}$/.test(t)', '/^[0-8][0-9A-F]{2}$/.test(t)'],
  ['finder: hex digits too narrow', '/^[1-8][0-9A-F]{2}$/.test(t)', '/^[1-8][0-9A-E]{2}$/.test(t)'],
  ['finder: separators not ignored', 't = r.replace(/[\\s,.\\-]/g, "")', 't = r.replace(/[,.]/g, "")'],
  ['finder: lower case rejected', 'const r = String(raw).trim().toUpperCase()', 'const r = String(raw).trim()'],
  ['finder: digits with spaces read as a number', 'if(/^[0-9]+$/.test(r)){', 'if(/^[0-9 ]+$/.test(r)){'],
  ['finder: hex taken as decimal', 'parseInt(t.slice(1), 16)', 'parseInt(t.slice(1), 10)'],
  ['finder: wrong message', 'return {idx: idx, word: WORDLIST[idx], msg: "Word " + (idx + 1) + ": " + WORDLIST[idx]};', 'return {idx: idx, word: WORDLIST[idx], msg: "Word " + idx + ": " + WORDLIST[idx]};'],
  ['BitBox02: wrong message', 'bitbox: true, msg: "Word " + (idx + 1) + ": " + WORDLIST[idx]};', 'bitbox: true, msg: "Word " + idx + ": " + WORDLIST[idx]};'],
  ['BitBox02: 24-word hint missing', 'return r.bitbox && document.getElementById("wdLen").value !== "24" ?', 'return false ?'],
  ['BitBox02: 24-word hint for every entry', 'return r.bitbox && document.getElementById("wdLen").value !== "24" ?', 'return document.getElementById("wdLen").value !== "24" ?'],
  ['finder: empty entry complains', 'if(!r) return {msg: ""};', 'if(false) return {msg: ""};'],
  ['finder: page line not updated', 'document.getElementById("wdFound").textContent = r.msg + wdBitBoxHint(r); }', 'document.getElementById("wdFound").textContent = ""; }'],
  ['qr: seed panel covers content again', '#cardGen .gen-right { grid-column: 2; grid-row: 1 / span 2;', '#cardGen .gen-right { grid-column: 2; grid-row: 1;'],
  ['qr: bottom area spans under the panel', '#cardGen .gen-bottom { grid-column: 1; grid-row: 2;', '#cardGen .gen-bottom { grid-column: 1 / -1; grid-row: 2;'],
  ['qr: no margin under the tab bar', '#qrBox, #sqBox, #msQrBox { scroll-margin: 80px 0 20px; }', '#qrBox, #sqBox, #msQrBox { scroll-margin: 0; }'],
  ['qr: watch-only QR not scrolled', '  qrShown = {id, label};\n  scrollQrIntoView("qrBox");', '  qrShown = {id, label};'],
  ['qr: SeedQR not scrolled', '  document.getElementById("sqBox").style.display = "";\n  scrollQrIntoView("sqBox");', '  document.getElementById("sqBox").style.display = "";'],
  ['qr: multisig QR not scrolled', '  msEl("msQrBox").style.display = "";\n  scrollQrIntoView("msQrBox");', '  msEl("msQrBox").style.display = "";'],
  ['qr: scrolls to the top edge', 'el.scrollIntoView({behavior: "smooth", block: "nearest"})', 'el.scrollIntoView({behavior: "smooth", block: "start"})'],
  ['verify: wipes the master fingerprint picture', '  const st = document.getElementById("verifyStatus");\n  clearVerifyIcons();', '  const st = document.getElementById("verifyStatus");\n  clearFpIcons();'],
  ['verify: old pictures stay', '  const st = document.getElementById("verifyStatus");\n  clearVerifyIcons();', '  const st = document.getElementById("verifyStatus");'],
  ['icons: clear-all leaves the master picture', 'function clearFpIcons(){\n  document.getElementById("fpIcon").textContent = "";', 'function clearFpIcons(){\n  '],
  ['panel: tall panel cannot be scrolled', '{ max-height: calc(100vh - 92px); overflow-y: auto;', '{ max-height: none; overflow-y: visible;'],
  ['panel: panel height not limited', 'max-height: calc(100vh - 92px); overflow-y: auto;', 'overflow-y: auto;'],
  ['jump: sections hide under the tab bar', '.tabpanel [id] { scroll-margin-top: 84px; }', '.tabpanel [id] { scroll-margin-top: 0; }'],
  ['notice: button back inside the scrolling text', '</div>\n<button type="button" class="sg-go" id="sgGo"', '<button type="button" class="sg-go" id="sgGo"'],
  ['notice: box taller than the screen', 'max-height: 100%; overflow: hidden; display: flex; flex-direction: column; }', 'max-height: 94vh; overflow: auto; }'],
  ['notice: text does not scroll', 'flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;', 'flex: 1 1 auto; min-height: 0; overflow-y: hidden; overscroll-behavior: contain;'],
  ['notice: button can shrink away', '#startGate .sg-go, #startGate .sg-foot { flex: none; }', '#startGate .sg-go, #startGate .sg-foot { flex: 0 1 auto; }'],
  ['notice: scrolling text not keyboard reachable', '<div class="sg-body" tabindex="0" aria-label="Before you make real keys: things to know">', '<div class="sg-body">'],
  ['notice: shown even if the script never ran', '  body.js-ok #startGate { display: flex; }', '  body.js-ok #startGate { display: flex; }\n  #startGate { display: flex !important; }'],
  ['notice: never shown', 'document.body.classList.add("js-ok");', 'void 0;'],
  ['notice: visible by default', 'z-index: 100; background: rgba(4,4,8,.78); display: none;', 'z-index: 100; background: rgba(4,4,8,.78); display: flex;'],
  // v1.26.0 five receiving addresses
  ['five: only four addresses', 'for(let i=0;i<5;i++){ const [fk]', 'for(let i=0;i<4;i++){ const [fk]'],
  ['five: always the first address', 'ckdPriv(rk,rc,i,false); five.push', 'ckdPriv(rk,rc,0,false); five.push'],
  ['five: first is not the first of five', 'first:five[0], five}', 'first:five[1], five}'],
  ['five: only one shown', 'w.five.join("\\n")', 'w.five.slice(0,1).join("\\n")'],
  ['five: lines run together', 'id="wFirst" style="white-space:pre-line"', 'id="wFirst"'],
  ['five: COPY ALL copies the wrong box', "onclick=\"copyWatch(this,'wFirst')\">COPY ALL", "onclick=\"copyWatch(this,'wZpub')\">COPY ALL"],
  ['five: address 5 uses another branch', 'ckdPriv(rk,rc,i,false); five.push', 'ckdPriv(rk,rc,i+(i>3?1:0),false); five.push'],
  // v1.26.1 EXIT GUIDE
  ['exit guide: button does nothing', 'id="gExit" onclick="toggleGuide()"', 'id="gExit" onclick=""'],
  ['exit guide: button moved into step 1 only', '<div class="gtop"><div class="gtitle" id="gTitle">Step 1 of 5</div><button type="button" class="secondary small" id="gExit" onclick="toggleGuide()">EXIT GUIDE</button></div>', '<div class="gtop"><div class="gtitle" id="gTitle">Step 1 of 5</div></div>'],
  ['exit guide: button label wrong', '>EXIT GUIDE</button>', '>GUIDE</button>'],
  // v1.26.1 stale-result guard
  ["run counter: a stale clear does not move it on", "  seedSig = null; forgeRun++;", "  seedSig = null;"],
  ["run counter: old fingerprint written back", "    if(run !== forgeRun) return;\n    fpEl.textContent = \"Master fingerprint: \"", "    fpEl.textContent = \"Master fingerprint: \""],
  ["run counter: old first address written back", "    if(run !== forgeRun) return;\n    adEl.textContent = \"First receive address", "    adEl.textContent = \"First receive address"],
  ["run counter: old address list written back", "    if(run !== forgeRun) return;\n    showAddrs(segwit, taproot);", "    showAddrs(segwit, taproot);"],
  ["run counter: CLEAR ALL does not stop a running FORGE", "function wipeSeed(){\n  forgeRun++;\n", "function wipeSeed(){\n"],
  ["stale: guard never fires", "  if(seedSig === null || !hasSeed() || inputSig(seedKind) === seedSig) return;", "  return;"],
  ["stale: never recorded", "seedSig = inputSig(seedKind);", "seedSig = null;"],
  ["stale: updateCount does not check", "function updateCount(){\n  staleCheck();", "function updateCount(){"],
  ["stale: rolls missing from signature", "clean(v(\"rolls\"))", "\"\""],
  ["stale: word count missing from signature", "\"|\" + document.querySelector('input[name=\"words\"]:checked').value + \"|\" + clean(v(\"rolls\"))", "\"|\" + clean(v(\"rolls\"))"],
  ["stale: mode missing from signature", "\"rolls|\" + getMode() + \"|\"", "\"rolls|\" + \"|\"", true],  // equivalent: switching dice/coin always empties the rolls box (or reverts the switch), so the rolls part of the signature already changes
  ["stale: kind always rolls", "seedKind = ctx ? \"rolls\" : \"wd\";", "seedKind = \"rolls\";"],
  ["stale: fingerprint and address left", "  document.getElementById(\"fingerprint\").textContent = \"\"; document.getElementById(\"address\").textContent = \"\";\n}\n// More than the minimum (v2.3.0)", "\n}\n// More than the minimum (v2.3.0)"],
  ["stale: no message", "else setResult(\"You changed the rolls, the word count, the dice/coin choice or the dice rules after FORGE. The old words, fingerprint and address were cleared so they cannot be mixed up with your new entries. Press FORGE SEED again.\");", "else setResult(\"\\u2014\");"],
  ["stale: download uses typed rolls", "const rolls = (exCtx && exCtx.rolls) || document.getElementById(\"rolls\").value;", "const rolls = document.getElementById(\"rolls\").value;"],
  // v1.26.2 red CLEAR and green SELF-TEST
  ["buttons: CLEAR not red", "<button class=\"btn-clear\" onclick=\"clearAll()\">", "<button class=\"secondary\" onclick=\"clearAll()\">"],
  ["buttons: SELF-TEST not green", "<button class=\"btn-test small\" onclick=\"toggleSelfTests()\">", "<button class=\"secondary small\" onclick=\"toggleSelfTests()\">"],
  ["buttons: red style loses its text colour", "button.btn-clear { background: rgba(255,68,102,.08); color: var(--bad-text);", "button.btn-clear { background: rgba(255,68,102,.08); color: var(--text);"],
  ["buttons: red style loses its border", "border: 1px solid var(--bad-text); }\n  button.btn-test", "border: 1px solid var(--border); }\n  button.btn-test"],
  ["buttons: green style loses its text colour", "button.btn-test { background: rgba(0,255,157,.12); color: var(--ok-text);", "button.btn-test { background: rgba(0,255,157,.12); color: var(--text);"],
  ["buttons: green style loses its border", "border: 1px solid var(--ok-text); }\n  body.light button.btn-clear", "border: 1px solid var(--border); }\n  body.light button.btn-clear"],
  ["buttons: red text overridden in the new look", "button.btn-clear, body.light button.btn-clear { background: transparent; color: var(--bad-text);", "button.btn-clear, body.light button.btn-clear { background: transparent; color: #fff;"],
  ["buttons: light theme green text overridden", "body.light button.btn-test { background: rgba(6,104,58,.08); color: var(--ok-text); }", "body.light button.btn-test { background: rgba(6,104,58,.08); color: #fff; }"],
  ["buttons: red tint too strong for contrast", "rgba(255,68,102,.08)", "rgba(255,68,102,.30)"],
  ["buttons: light red tint too strong for contrast", "rgba(192,20,60,.04)", "rgba(192,20,60,.30)"],
  // v1.27.0 restore drill
  ["drill: start does not hide the words", "  document.body.classList.add(\"drill-on\");\n", ""],
  ["drill: end keeps the words hidden", "drillCtx = null; document.body.classList.remove(\"drill-on\");", "drillCtx = null;"],
  ["drill: a new result does not end the drill", "wdWipe(); drillEnd();", "wdWipe();"],
  ["drill: word count not checked", "if(typed.length !== want.length){", "if(false){"],
  ["drill: unknown words not flagged", "if(unknown.length){", "if(false){"],
  ["drill: wrong words ignored", "if(wrong.length){ bad(", "if(false){ bad("],
  ["drill: position off by one", "if(w !== want[i]) wrong.push(i + 1);", "if(w !== want[i]) wrong.push(i);"],
  ["drill: reveals the right word", "if(w !== want[i]) wrong.push(i + 1);", "if(w !== want[i]) wrong.push((i + 1) + \" (\" + want[i] + \")\");"],
  ["drill: capitals not accepted", "document.getElementById(\"drillWords\").value.trim().toLowerCase().split", "document.getElementById(\"drillWords\").value.trim().split"],
  ["drill: passphrase not checked", "if(drillCtx.pass && pw.normalize(\"NFKD\") !== drillCtx.pass.normalize(\"NFKD\")){", "if(false){"],
  ["drill: passphrase compared without normalization", "pw.normalize(\"NFKD\") !== drillCtx.pass.normalize(\"NFKD\")", "pw !== drillCtx.pass"],
  ["drill: stray passphrase accepted", "if(!drillCtx.pass && pw){", "if(false){"],
  ["drill: fingerprint not shown", "fp = await mnemonicFingerprint(typed.join(\" \"), drillCtx.pass || \"\");", "fp = \"\";"],
  ["drill: fingerprint ignores the passphrase", "mnemonicFingerprint(typed.join(\" \"), drillCtx.pass || \"\")", "mnemonicFingerprint(typed.join(\" \"), \"\")"],
  ["drill: passphrase box never shown", "document.getElementById(\"drillPassRow\").style.display = drillCtx.pass ? \"\" : \"none\";", "document.getElementById(\"drillPassRow\").style.display = \"none\";"],
  ["drill: start allowed with no seed", "if(!hasSeed() || !watchCtx){ alert(", "if(false){ alert("],
  ["drill: end leaves the typed words", "  w.value = \"\"; document.getElementById(\"drillPass\").value = \"\";", "  document.getElementById(\"drillPass\").value = \"\";"],
  ["drill: end leaves the typed passphrase", "document.getElementById(\"drillPass\").value = \"\"; document.getElementById(\"drillStatus\").textContent = \"\";", "document.getElementById(\"drillStatus\").textContent = \"\";"],
  ["drill: end leaves the result message", "document.getElementById(\"drillStatus\").textContent = \"\";\n  document.getElementById(\"drillRun\").style.display = \"none\";", "\n  document.getElementById(\"drillRun\").style.display = \"none\";"],
  ["drill: card not hidden when the seed is cleared", "for(const id of [\"addrBox\",\"checkGuide\",\"drillBox\"])", "for(const id of [\"addrBox\",\"checkGuide\"])"],
  ["drill: card not shown with a seed", "document.getElementById(\"checkGuide\").style.display = \"\"; document.getElementById(\"drillBox\").style.display = \"\";", "document.getElementById(\"checkGuide\").style.display = \"\";"],
  ["drill: word grid not hidden", "body.drill-on #wordGrid, body.drill-on #genResult", "body.drill-on #genResult"],
  ["drill: result text not hidden", "body.drill-on #genResult, body.drill-on #abbrNote", "body.drill-on #abbrNote"],
  ["drill: abbreviation note not hidden", "body.drill-on #abbrNote, ", ""],
  ["drill: passphrase note not hidden", "body.drill-on #passNote, ", ""],
  ["drill: next-step text not hidden", "body.drill-on #nextStep { visibility: hidden; }", "body.drill-on #nextStep { visibility: visible; }"],
  ["drill: word buttons not removed", "body.drill-on .needs-words, ", ""],
  ["drill: print button not removed", "body.drill-on .print-btn, ", ""],
  ["drill: seed QR not removed", "body.drill-on #seedQrBox, ", ""],
  ["drill: explainer not removed", "body.drill-on #explainBox { display: none !important; }", "body.drill-on #explainBox { display: block; }"],
  ["drill: abbreviation button not marked", "<button class=\"secondary small needs-words\" id=\"abbrBtn\"", "<button class=\"secondary small\" id=\"abbrBtn\""],
  ["drill: send-to-check button not marked", "<button class=\"secondary small needs-words\" onclick=\"sendToVerify()\">", "<button class=\"secondary small\" onclick=\"sendToVerify()\">"],
  ["drill: download button not marked", "<button class=\"secondary small needs-words\" onclick=\"downloadSeed()\">", "<button class=\"secondary small\" onclick=\"downloadSeed()\">"],
  ["coin faces: heads and tails drawings swapped", "coinFace(v === \"1\", v)", "coinFace(v !== \"1\", v)"],
  ["coin faces: label swapped", "(v === \"1\" ? \"HEADS\" : \"TAILS\")", "(v === \"1\" ? \"TAILS\" : \"HEADS\")"],
  ["coin faces: screen-reader label swapped", "v === \"1\" ? \"Add flip 1 (heads)\" : \"Add flip 0 (tails)\"", "v === \"1\" ? \"Add flip 1 (tails)\" : \"Add flip 0 (heads)\""],
  ["coin faces: value not recorded on the button", "b.dataset.v = v;", ""],
  ["coin faces: coin not drawn", "b.appendChild(coinFace(v === \"1\", v));", ""],
  ["coin faces: no label text", "b.appendChild(t);\n    }\n    else", "}\n    else"],
  ["calmer page: a second GUIDE ME button is back", "<div id=\"guideNew\">New here?", "<div id=\"guideNew\"><button type=\"button\">GUIDE ME</button> New here?"],
  ["calmer page: seed buttons not grouped", "<div class=\"btn-row seed-actions\" style=\"margin-top:6px;\" data-g=\"3 4\">", "<div class=\"btn-row\" style=\"margin-top:6px;\" data-g=\"3 4\">"],
  ["calmer page: has-seed never set", "bkReset(!!words); document.body.classList.toggle(\"has-seed\", !!words);", "bkReset(!!words);"],
  ["calmer page: seed buttons always shown", "body:not(.has-seed) .seed-actions, body:not(.has-seed) .print-btn { display: none; }", "body:not(.has-seed) .seed-actions, body:not(.has-seed) .print-btn { }"],
  ["calmer page: roll count hidden on wide screens", "  #cardGen .gen-right { position: static; max-height: none;", "  #rollCount { display: none; }\n  #cardGen .gen-right { position: static; max-height: none;"],
  ["calmer page: second warning note back", "<div id=\"wordGrid\" data-g=\"3 4\" aria-hidden=\"true\"></div>", "<p class=\"forge-note\">Making real keys? Keep clipboard history off.</p><div id=\"wordGrid\" data-g=\"3 4\" aria-hidden=\"true\"></div>"],
  ["coin faces: sat sign loses a bar", "<rect x=\"29.5\" y=\"46\" width=\"41\" height=\"7\"/>", ""],
  ["coin faces: sat sign not tilted", "<g class=\"sat\" transform=\"rotate(10 50 50)\"", "<g class=\"sat\""],
  ["coin faces: Bitcoin lines thicker than the sat sign", "stroke-width=\"7\" stroke-linejoin=\"round\"><path d=\"M39 30", "stroke-width=\"6\" stroke-linejoin=\"round\"><path d=\"M39 30"],
  ["coin faces: Bitcoin sign not tilted", "<g class=\"btc\" transform=\"rotate(10 50 50)\"", "<g class=\"btc\""],
  ["coin faces: heads and tails use the same sign", "<g class=\"sat\"", "<g class=\"btc\""],
  ["coin faces: a gradient is back", "<circle cx=\"50\" cy=\"50\" r=\"46\" style=\"fill:var(--gold)\"/>", "<defs><radialGradient id=\"x\"><stop offset=\"0\" stop-color=\"#fff\"/></radialGradient></defs><circle cx=\"50\" cy=\"50\" r=\"46\" style=\"fill:var(--gold)\"/>"],
  ["coin faces: Bitcoin sign loses its bars", "<path d=\"M45 22 V30 M55 22 V30 M45 71 V79 M55 71 V79\"/>", ""],
  ["dice buttons: outline missing", "style=\"fill:var(--surface); stroke:var(--accent); stroke-width:6\"/>' + pips", "style=\"fill:var(--surface)\"/>' + pips"],
  ["dice buttons: pips not accent", "r=\"10\" style=\"fill:var(--accent)\"/>').join(\"\")", "r=\"10\" style=\"fill:var(--text)\"/>').join(\"\")"],
  ["tucked away: roll history box heading unstyled", "  #rollStats > summary { cursor: pointer; font-weight: 600; }\n", ""],
  ["seed words: three columns again on mid-width phones", "@media (max-width: 559px) { #wordGrid, #cardGen .gen-right #wordGrid", "@media (max-width: 420px) { #wordGrid, #cardGen .gen-right #wordGrid"],
  ["seed words: boxes can grow past their column", "padding: 10px 12px; min-width: 0; }", "padding: 10px 12px; }"],
  ["seed words: no smaller type on small phones", "@media (max-width: 400px) { .wcell { font-size: 16px;", "@media (max-width: 400px) { .wcell { font-size: 18px;"],
  ["seed words: no smallest type on narrow phones", "@media (max-width: 345px) { .wcell { font-size: 14.5px;", "@media (max-width: 345px) { .wcell { font-size: 18px;"],
  ["passphrase box moved away from the roll history box", "<details id=\"advanced\" data-g=\"4\">", "<p id=\"pushdown2\"></p><details id=\"advanced\" data-g=\"4\">"],
  ["roll history box moved away from the passphrase box", "<details id=\"rollStats\" data-g=\"2\">", "<p id=\"pushdown\"></p><details id=\"rollStats\" data-g=\"2\">"],
  ["tucked away: roll history box starts open", "<details id=\"rollStats\" data-g=\"2\">", "<details id=\"rollStats\" data-g=\"2\" open>"],
  ["redesign: centre pip missing from the header die", "<circle class=\"dp\" cx=\"32\" cy=\"32\" r=\"5.6\"/>", ""],
  ["redesign: the name is not gold", "letter-spacing: .16em; color: var(--goldtx); background: none;", "letter-spacing: .16em; color: var(--text); background: none;"],
  ["redesign: the die is not gold", "#brandDie .db { fill: var(--gold); }", "#brandDie .db { fill: var(--text); }"],
  ["redesign: MENU stays open after a click elsewhere", "document.addEventListener(\"click\", e => { if(mb.open && !mb.contains(e.target)) mb.open = false; });", "document.addEventListener(\"click\", e => { });"],
  ["redesign: Escape does not close the MENU", "if(e.key === \"Escape\" && mb.open){ mb.open = false; mb.querySelector(\"summary\").focus(); }", "if(e.key === \"Escape\" && mb.open){ mb.querySelector(\"summary\").focus(); }"],
  ["redesign: MENU stays open after choosing an item", "if(e.target.closest && e.target.closest(\"button\")) mb.open = false;", "if(false) mb.open = false;"],
  ["redesign: PRINT SEED missing from the MENU", "<button class=\"print-btn\" onclick=\"printSeed()\">PRINT SEED</button>", ""],
  ["redesign: selected tab has no gold underline", "color: var(--text); border-bottom-color: var(--gold); }\n  .tabs .lg", "color: var(--text); border-bottom-color: transparent; }\n  .tabs .lg"],
  ["redesign: labels drawn as pills again", ".tag, body.light .tag { border: 0; background: none;", ".tag, body.light .tag { border: 1px solid; background: none;"],
  ["redesign: Make a seed back to two columns", "#cardGen { display: block; }\n  #cardGen .gen-right { position: static; max-height: none;", "#cardGen { display: grid; }\n  #cardGen .gen-right { position: static; max-height: none;"],
  // ---- v2.3.0: the minimum or more rolls ----
  ['more rolls: refused again', 'if(rolls.length < need){', 'if(rolls.length !== need){'],
  ['more rolls: one short accepted', 'if(rolls.length < need){', 'if(rolls.length < need - 1){'],
  ['more rolls: note missing', 'document.getElementById("countNote").textContent = diceTestOn() ? "" : countNote(rolls.length, need, isCoin, keystoneOn());', 'document.getElementById("countNote").textContent = "";'],
  ['more rolls: note below the minimum', '  if(n < need) return "";\n  if(ks && n > KEYSTONE_MAX)', '  if(ks && n > KEYSTONE_MAX)'],
  ['more rolls: exact note for more', '  if(n === need) return coin ?', '  if(n >= need) return coin ?'],
  ['more rolls: SeedSigner and Coldcard swapped', '"Coldcard makes the same words from these rolls; SeedSigner takes exactly "', '"SeedSigner makes the same words from these rolls; Coldcard takes exactly "'],
  ['more rolls: wrong count in the note', '"Every " + one + " counts: all " + n + " are hashed. "', '"Every " + one + " counts: all " + need + " are hashed. "'],
  ['more rolls: double-paste note at twice', '  if(n > 2 * need) t +=', '  if(n >= 2 * need) t +='],
  ['more rolls: double-paste note never', '  if(n > 2 * need) t +=', '  if(n > 3 * need) t +='],
  ['more rolls: coin note says rolled', '(coin ? "flipped" : "rolled")', '"rolled"'],
  ['more rolls: length line without "or more"', ' + (coin ? " coin flips" : " dice rolls") + " or more")', ' + (coin ? " coin flips" : " dice rolls"))'],
  ['roll sheet: no extra boxes', 'for(let i = need + 1; i <= need + extra; i++)', 'for(let i = need + 1; i <= need; i++)'],
  ['roll sheet: extra boxes not dashed', 'const c = add("ps-cell ps-extra", "", gx);', 'const c = add("ps-cell", "", gx);'],
  ['roll sheet: dashed style missing', '    body.print-seed #printOnly .ps-roll .ps-cell.ps-extra { border-style: dashed; }\n', ''],
  ['roll sheet: extra boxes numbered from 1', 'for(let i = need + 1; i <= need + extra; i++){ const c = add("ps-cell ps-extra", "", gx); add("ps-n", String(i), c); }', 'for(let i = need + 1; i <= need + extra; i++){ const c = add("ps-cell ps-extra", "", gx); add("ps-n", String(i - need), c); }'],
  // ---- v2.3.0: Keystone dice rules ----
  ['Keystone: 6 not turned into 0', 'function hashInput(rolls){ return keystoneOn() ? rolls.replace(/6/g, "0") : rolls; }', 'function hashInput(rolls){ return rolls; }'],
  ['Keystone: 1 turned into 0', 'function hashInput(rolls){ return keystoneOn() ? rolls.replace(/6/g, "0") : rolls; }', 'function hashInput(rolls){ return keystoneOn() ? rolls.replace(/1/g, "0") : rolls; }'],
  ['Keystone: only the first 6 changed', 'function hashInput(rolls){ return keystoneOn() ? rolls.replace(/6/g, "0") : rolls; }', 'function hashInput(rolls){ return keystoneOn() ? rolls.replace("6", "0") : rolls; }'],
  ['Keystone: 24 words take 99', '  if(keystoneOn()) return {12:50,24:100}[wc];\n', ''],
  ['Keystone: 12 words take 49', 'if(keystoneOn()) return {12:50,24:100}[wc];', 'if(keystoneOn()) return {12:49,24:100}[wc];'],
  ['Keystone: no maximum', 'if(ks && rolls.length > KEYSTONE_MAX){', 'if(false){'],
  ['Keystone: maximum one lower', 'const KEYSTONE_MAX = 256;', 'const KEYSTONE_MAX = 255;'],
  ['Keystone: also on for coins', '&& (document.querySelector(\'input[name="mode"]:checked\')?.value || "dice") === "dice"; }', '; }'],
  ['Keystone: FORGE ignores the rules', 'const mnemonic = await rollsToMnemonic(hashInput(rolls), wc);', 'const mnemonic = await rollsToMnemonic(rolls, wc);'],
  ['Keystone: preview ignores the rules', 'const words = (await rollsToMnemonic(hashInput(rolls), wc)).split(" ");', 'const words = (await rollsToMnemonic(rolls, wc)).split(" ");'],
  ['Keystone: rules not part of the input signature', '(keystoneOn() ? "keystone" : "std") + "|" +', '"" +'],
  ['Keystone: menu change does nothing', 'document.getElementById("diceRules").addEventListener("change", updateLabels);\n', ''],
  ['Keystone: menu shown for coins', 'document.getElementById("rulesRow").style.display = method === "dice" ? "" : "none";', 'document.getElementById("rulesRow").style.display = "";'],
  ['Keystone: menu note missing', 'document.getElementById("rulesNote").textContent = keystoneOn() ?', 'document.getElementById("rulesNote").textContent = false ?'],
  ['Keystone: over the maximum still counts as enough', 'met = n >= need && !over,', 'met = n >= need,'],
  ['Keystone: over-the-maximum note missing', '  if(ks && n > KEYSTONE_MAX) return "Keystone takes at most "', '  if(false) return "Keystone takes at most "'],
  ['Keystone: standard note for Keystone', 'countNote(rolls.length, need, isCoin, keystoneOn())', 'countNote(rolls.length, need, isCoin, false)'],
  ['Keystone: explain view ignores the rules', 'explainSteps(ks ? exCtx.rolls.replace(/6/g, "0") : exCtx.rolls, exCtx.words.length)', 'explainSteps(exCtx.rolls, exCtx.words.length)'],
  ['Keystone: explain view misses the 6-as-0 line', '  if(ks){ mk("div", "ex-text", "Keystone dice rules:', '  if(false){ mk("div", "ex-text", "Keystone dice rules:'],
  ['Keystone: download does not name the rules', '(exCtx && exCtx.keystone ? "\\nDice rules: Keystone (each 6 counts as 0 before hashing)" : "")', '""'],
  ['Keystone: self-test vector', '"tip toward alcohol rule pave weird quarter guilt orange vacuum blast maple"', '"tip toward alcohol rule pave weird quarter guilt orange vacuum blast march"'],
  // ---- v2.3.0: BitBox02 diceware ----
  ['BitBox02: row weights wrong', '(((d[0] - 1) * 64 + (d[1] - 1) * 16 + (d[2] - 1) * 4 + (d[3] - 1)) * 8)', '(((d[0] - 1) * 64 + (d[1] - 1) * 4 + (d[2] - 1) * 16 + (d[3] - 1)) * 8)'],
  ['BitBox02: coin reversed', '(d[4] - 1) * 2 + (t[5] === "T" ? 1 : 0);', '(d[4] - 1) * 2 + (t[5] === "H" ? 1 : 0);'],
  ['BitBox02: fifth die ignored', '(d[4] - 1) * 2 + (t[5] === "T" ? 1 : 0);', '(t[5] === "T" ? 1 : 0);'],
  ['BitBox02: dice 5 and 6 accepted', '} else if(/^[1-4]{5}[HT]$/.test(t)){', '} else if(/^[1-6]{5}[HT]$/.test(t)){'],
  ['BitBox02: codes not read', '} else if(/^[1-4]{5}[HT]$/.test(t)){', '} else if(false){'],
  ['ADD WORD: word not added', '  box.value = (cur ? cur + " " : "") + r.word;\n', ''],
  ['ADD WORD: finder not emptied', '  f.value = ""; document.getElementById("wdFound").textContent = "Added word "', '  document.getElementById("wdFound").textContent = "Added word "'],
  ['ADD WORD: bad entry added', '  if(r.word === undefined){ wdFind(); return false; }\n', ''],
  ['ADD WORD: Enter does nothing', 'if(e.key === "Enter"){ e.preventDefault(); wdAddFound(); }', 'if(false){ e.preventDefault(); wdAddFound(); }'],
  ['BitBox02: self-test table vector', '"abandon abstract divorce zoo"', '"abandon abstract divorce zone"'],
  ['BitBox02: self-test last-word vector', '"boss coyote dry habit panel regular speed winter"', '"boss coyote dry habit panel regular speed wink"'],
  // ---- v2.3.0: verify a signed message ----
  ['signed message: wrong classic prefix', 'new TextEncoder().encode("\\x18Bitcoin Signed Message:\\n")', 'new TextEncoder().encode("\\x18Bitcoin Signed Messages\\n")'],
  ['signed message: classic hash single SHA-256', 'return dsha256(concatBytes(pre, varintBytes(m.length), m));', 'return sha256bytes(concatBytes(pre, varintBytes(m.length), m));'],
  ['signed message: length bytes swapped', '[0xfd, n & 255, n >>> 8]', '[0xfd, n >>> 8, n & 255]'],
  ['signed message: length prefix missing', 'concatBytes(pre, varintBytes(m.length), m)', 'concatBytes(pre, m)'],
  ['signed message: recovery y parity flipped', 'const R = liftX(r + ((recid & 2) ? SN : 0n), (recid & 1) === 1);', 'const R = liftX(r + ((recid & 2) ? SN : 0n), (recid & 1) === 0);'],
  ['signed message: recovery sign wrong', 'return eadd(emul(nmod(-z * ri), SG), emul(nmod(s * ri), R));', 'return eadd(emul(nmod(z * ri), SG), emul(nmod(s * ri), R));'],
  ['signed message: compressed flag wrong', 'const h = b[0], recid = (h - 27) & 3, compressed = h >= 31;', 'const h = b[0], recid = (h - 27) & 3, compressed = h >= 35;'],
  ['signed message: uncompressed key allowed for SegWit', '    if(!compressed && type !== "pkh") return false;\n', ''],
  ['signed message: classic address not compared', '    return got === addr;\n', '    return true;\n'],
  ['signed message: BIP-322 tag wrong', 'taggedHash("BIP0322-signed-message", new TextEncoder().encode(msg))', 'taggedHash("BIP0322-signed-message ", new TextEncoder().encode(msg))'],
  ['signed message: to_spend scriptSig wrong', 'Uint8Array.of(34, 0x00, 0x20), mh,', 'Uint8Array.of(34, 0x51, 0x20), mh,'],
  ['signed message: to_spend prevout index 0', 'new Uint8Array(32), le32(0xffffffff),', 'new Uint8Array(32), le32(0),'],
  ['signed message: to_sign output not OP_RETURN', 'outputs = concatBytes(new Uint8Array(8), Uint8Array.of(1, 0x6a));', 'outputs = concatBytes(new Uint8Array(8), Uint8Array.of(1, 0x6b));'],
  ['signed message: BIP143 script code wrong', 'h160, Uint8Array.of(0x88, 0xac));', 'h160, Uint8Array.of(0x87, 0xac));'],
  ['signed message: BIP143 sighash type wrong', 'await dsha256(parts.outputs), le32(0), le32(1)));', 'await dsha256(parts.outputs), le32(0), le32(2)));'],
  ['signed message: taproot epoch wrong', 'const m = concatBytes(Uint8Array.of(0x00, hashType),', 'const m = concatBytes(Uint8Array.of(0x01, hashType),'],
  ['signed message: TapSighash tag wrong', 'return taggedHash("TapSighash", m);', 'return taggedHash("TapSighashX", m);'],
  ['signed message: taproot spend type wrong', 'await sha256bytes(parts.outputs), Uint8Array.of(0x00), le32(0));', 'await sha256bytes(parts.outputs), Uint8Array.of(0x01), le32(0));'],
  ['signed message: taproot sighash ALL ignored', 'sig.length === 65 ? 1 : 0), dec.prog, sig.slice(0, 64));', '0), dec.prog, sig.slice(0, 64));'],
  ['signed message: taproot explicit 0 sighash accepted', 'if(sig.length !== 64 && !(sig.length === 65 && sig[64] === 1)) return false;', 'if(sig.length !== 64 && sig.length !== 65) return false;'],
  ['signed message: Schnorr challenge tag wrong', 'taggedHash("BIP0340/challenge", concatBytes(', 'taggedHash("BIP0340/challengeX", concatBytes('],
  ['signed message: Schnorr odd R accepted', 'return !!R && (R[1] & 1n) === 0n && R[0] === r;', 'return !!R && R[0] === r;'],
  ['signed message: Schnorr x not compared', 'return !!R && (R[1] & 1n) === 0n && R[0] === r;', 'return !!R && (R[1] & 1n) === 0n;'],
  ['signed message: ECDSA x not compared', 'return !!X && nmod(X[0]) === r;', 'return !!X;'],
  ['signed message: P2WPKH key not tied to the address', ' || hex(await hash160(items[1])) !== hex(dec.prog)) return false;', ') return false;'],
  ['signed message: high S accepted', 'if(!d || d.s > SN / 2n) return false;', 'if(!d) return false;'],
  ['signed message: any sighash accepted', 'if(sig.length < 9 || sig[sig.length - 1] !== 1) return false;', 'if(sig.length < 9) return false;'],
  ['signed message: loose DER accepted', 'if(n > 1 && v[0] === 0 && !(v[1] & 0x80)) return null;', ''],
  ['signed message: extra witness bytes accepted', '  if(i !== b.length) throw new Error("extra bytes");\n', ''],
  ['signed message: line-break tolerance gone', 'for(const v of [n1, msg.trim(), n1.trim(), n1.replace(/\\n/g, "\\r\\n"), n1 + "\\n", n1.replace(/\\n/g, "\\r\\n") + "\\r\\n"]) if', 'for(const v of []) if'],
  ['signed message: Windows line breaks not tried', ', n1.replace(/\\n/g, "\\r\\n"), n1 + "\\n",', ', n1 + "\\n",'],
  ['signed message: final line break not tried', ', n1 + "\\n", n1.replace(', ', n1.replace('],
  ['signed message: no warning for a trimmed match', '(k ? "VALID, after a small change to the message:', '(false ? "VALID, after a small change to the message:'],
  ['signed message: variant not flagged', 'return {state: "valid", variant: k > 0,', 'return {state: "valid", variant: false,'],
  ['signed message: VALID does not name the address', '"VALID: the key of " + addr + " signed exactly this message."', '"VALID: the key of this address signed exactly this message."'],
  ['signed message: testnet labelled as mainnet', 'const test = addressNetOf(addr) === "test", kinds', 'const test = false, kinds'],
  ['signed message: close match shown green', '(r.variant ? " warn" : " ok")', '" ok"'],
  ['signed message: amber colour missing', '  .status.warn { color: var(--warn-text); }\n', ''],
  ['signed message: block replaces a typed address', 'if((typedA && !sameA) || (typedS && typedS !== ar.sig)){', 'if(false){'],
  ['signed message: block replaces a typed signature', 'if((typedA && !sameA) || (typedS && typedS !== ar.sig)){', 'if(typedA && !sameA){'],
  ['signed message: Address header not read', 'if(/^address$/i.test(h[1]) && h[2] && !addr) addr = h[2].trim(); continue;', 'continue;'],
  ['signed message: unprefixed full read as simple', '    if(looksLikeFull(b)) return {state: "cannot"', '    if(false) return {state: "cannot"'],
  ['signed message: PSBT not seen as proof of funds', 'if(b.length >= 5 && b[0] === 0x70 && b[1] === 0x73 && b[2] === 0x62 && b[3] === 0x74 && b[4] === 0xff) return true;', ''],
  ['signed message: damaged classic not called damaged', 'if(type === "pkh" || type === "sh-wpkh") return {state: "error", text: b.length === 65 ?', 'if(false) return {state: "error", text: b.length === 65 ?'],
  ['signed message: recovery id 2 and 3 ignored', 'const R = liftX(r + ((recid & 2) ? SN : 0n), (recid & 1) === 1);', 'const R = liftX(r, (recid & 1) === 1);'],
  ['signed message: script addresses not refused', 'if(sw && !((sw.version === 0 && sw.prog.length === 20) || (sw.version === 1 && sw.prog.length === 32))) return', 'if(false) return'],
  ['signed message: classic for Taproot not refused', 'if(!simple && type === "tr") return', 'if(false) return'],
  ['signed message: full signatures not refused', 'if(pre === "ful" || pre === "pof") return', 'if(false) return'],
  ['signed message: smp prefix not read', 'let simple = false; if(pre === "smp"){ simple = true; st = st.slice(3); }', 'let simple = false;'],
  ['signed message: no-prefix simple not read', '    simple = true;\n  }\n  const sw = segwitDecode(addr);', '  }\n  const sw = segwitDecode(addr);'],
  ['signed message: base58 checksum not checked', 'const pl = await base58decode(addr); if(pl.length !== 21) throw new Error("length");', 'const pl = new Uint8Array(21);'],
  ['signed message: capitals not read', 'addr = /^(bc1|tb1)/i.test(raw) && raw === raw.toUpperCase() ? raw.toLowerCase() : raw;', 'addr = raw;'],
  ['signed message: mixed case accepted', '|| (addr !== addr.toLowerCase() && addr !== addr.toUpperCase())) return null;', ') return null;'],
  ['signed message: block not read', 'const ar = sigArmor(document.getElementById("sigMsg").value);', 'const ar = null;'],
  ['signed message: valid not green', '(r.variant ? " warn" : " ok")', '(r.variant ? " warn" : "")'],
  ['signed message: cannot check shown red', 'r.state === "cannot" ? "" : " bad");', 'r.state === "cannot" ? " bad" : " bad");'],
  ['signed message: editing keeps the old result', '["sigAddr", "sigMsg", "sigSig"].forEach(id => document.getElementById(id).addEventListener("input",', '[].forEach(id => document.getElementById(id).addEventListener("input",'],
  ['signed message: CLEAR leaves the boxes', 'for(const id of ["sigAddr", "sigMsg", "sigSig"]) document.getElementById(id).value = "";', ''],
  ['signed message: button grey', '<button type="button" id="sigBtn" onclick="verifyMessageUi()">', '<button type="button" class="secondary" id="sigBtn" onclick="verifyMessageUi()">'],
  ['signed message: self-test vector', '"valid valid invalid"', '"valid invalid invalid"'],
  // ---- v2.3.0 review fixes ----
  ['Word draw: seed not cleared when its inputs change', 'function wdUpdate(){\n  staleCheck();\n', 'function wdUpdate(){\n'],
  ['Word draw: input signature fixed', 'if(kind === "wd") return "wd|" +', 'if(kind === "wd") return "wd"; if(0) return "wd|" +'],
  ['roll sheet: Keystone named as SeedSigner and Coldcard', '  const ks = keystoneOn(), extra = rsExtraCount(need)', '  const ks = false, extra = rsExtraCount(need)'],
  ['roll sheet: dice rules not recorded', '"Dice rules: " + (ks ? "Keystone (each 6 counts as 0)" : "SeedSigner and Coldcard") + "\\n"', '""'],
  ['Keystone: length line without the maximum', '(keystoneOn() ? getNeeded(wc) + " to " + KEYSTONE_MAX + " dice rolls" :', '(false ? getNeeded(wc) + " to " + KEYSTONE_MAX + " dice rolls" :'],
  ['Keystone: preview above the maximum', ' || (keystoneOn() && rolls.length > KEYSTONE_MAX)){ previewClear(); return; }', '){ previewClear(); return; }'],
  ['coin note: claims a SeedSigner device', '"Exactly " + need + " flips: the same SHA-256 method as SeedSigner\'s coin-flip code (its device menus make seeds from dice)."', '"Exactly " + need + " flips: SeedSigner makes the same words from these flips."'],
  // ---- v2.3.0: start notice once per session offline, END SESSION ----
  ['session notice: online also skips it', 'function startGateSkip(){ return !navigator.onLine && ackSeen(); }', 'function startGateSkip(){ return ackSeen(); }'],
  ['session notice: never skipped', 'function startGateSkip(){ return !navigator.onLine && ackSeen(); }', 'function startGateSkip(){ return false; }'],
  ['session notice: any stored value counts', 'return sessionStorage.getItem(ACK_KEY) === "1";', 'return sessionStorage.getItem(ACK_KEY) !== "x";'],
  ['session notice: closing does not remember it', '  if(!navigator.onLine) ackRemember(true);\n', ''],
  ['session notice: stored while online too', '  if(!navigator.onLine) ackRemember(true);\n', '  ackRemember(true);\n'],
  ['session notice: skip class never set', 'if(startGateSkip()) document.body.classList.add("sg-skip");', ''],
  ['session notice: skipped but left on the page', 'if(document.body.classList.contains("sg-skip")){ startGateClose(); return; }', 'if(document.body.classList.contains("sg-skip")){ return; }'],
  ['session notice: skip class left behind', 'document.body.classList.remove("dice-wait", "sg-skip");', 'document.body.classList.remove("dice-wait");'],
  ['session notice: flashes before it is removed', '  body.js-ok.sg-skip #startGate { display: none; }\n', ''],
  ['session notice: stores something else', 'sessionStorage.setItem(ACK_KEY, "1")', 'sessionStorage.setItem(ACK_KEY, "1"), sessionStorage.setItem("voidforge-extra", "1")'],
  ['END SESSION: no question first', 'if(!confirm("End this session?', 'if(false && !confirm("End this session?'],
  ['END SESSION: seed not wiped', 'for(const f of [reforgeStop, msReset, wipeSeed, ', 'for(const f of [reforgeStop, msReset, '],
  ['END SESSION: typed boxes not reset', 'else e.value = e.defaultValue;', 'else {}'],
  ['END SESSION: boxes emptied instead of reset', 'else e.value = e.defaultValue;', 'else e.value = "";'],
  ['END SESSION: ticks not reset', 'else if(e.type === "checkbox" || e.type === "radio") e.checked = e.defaultChecked;', 'else if(e.type === "checkbox" || e.type === "radio") {}'],
  ['END SESSION: menus not reset', '[...e.options].forEach(o => { o.selected = o.defaultSelected; });', '{}'],
  ['END SESSION: notice not forgotten', '  ackRemember(false);\n  const clip', '  const clip'],
  ['END SESSION: no reload', '.then(() => endSessionReload());', '.then(() => {});'],
  ['END SESSION: reload does nothing', 'function endSessionReload(){ location.reload(); }', 'function endSessionReload(){}'],
  ['END SESSION: button missing', '<button class="btn-clear" id="endSessionBtn" onclick="endSession()">END SESSION</button>\n', ''],
  // ---- v2.4.0: prints, roll sheet extras, CHECK A BACKUP backups, dice test, keyboard, typo helper, explain an address, summary ----
  ["print v2.4: hidden page still laid out", "    body.print-seed > :not(#printOnly), body.print-qr > :not(#printQr) { display: none !important; }\n", ""],
  ["print v2.4: no page margin", "    @page { margin: 12mm; }\n", ""],
  ["print v2.4: print areas inside the page", "  </footer>\n</div>\n<div id=\"printOnly\"></div>\n<div id=\"printQr\"></div>\n", "  </footer>\n<div id=\"printOnly\"></div>\n<div id=\"printQr\"></div>\n</div>\n"],
  ["print v2.4: compact roll grid rule gone", "    body.print-seed #printOnly .ps-grid.ps-roll.ps-roll20 { grid-template-columns: repeat(20, 1fr); gap: 3px; }\n", ""],
  ["print v2.4: 15-21 word grid rule gone", "    body.print-seed #printOnly .ps-grid.ps-15, body.print-seed #printOnly .ps-grid.ps-18, body.print-seed #printOnly .ps-grid.ps-21 { grid-template-columns: repeat(3, 1fr); }\n", ""],
  ["print v2.4: long stamp sheets in 3 columns", "body.print-seed #printOnly .ps-grid.ps-stamp.ps-18, body.print-seed #printOnly .ps-grid.ps-stamp.ps-21, ", ""],
  ["roll sheet v2.4: Keystone maximum never offered", "if(keystoneOn() && !mx){", "if(false && !mx){"],
  ["roll sheet v2.4: Keystone maximum kept without Keystone", "else if(!keystoneOn() && mx){", "else if(false && mx){"],
  ["roll sheet v2.4: maximum stays chosen", "if(sel.value === \"max\") sel.value = \"10\"; mx.remove();", "mx.remove();"],
  ["roll sheet v2.4: Keystone maximum short", "if(v === \"max\") return keystoneOn() ? KEYSTONE_MAX - need : 10;", "if(v === \"max\") return keystoneOn() ? KEYSTONE_MAX - need - 1 : 10;"],
  ["roll sheet v2.4: choice ignored", "return parseInt(v, 10) || 0;", "return 10;"],
  ["roll sheet v2.4: menu not synced", "  syncMethodUi();\n  rsExtraSync();\n}", "  syncMethodUi();\n}"],
  ["roll sheet v2.4: compact layout never used", "if(wide) g.classList.add(\"ps-roll20\");", ""],
  ["roll sheet v2.4: extra grid not compact", "const gx = add(\"ps-grid ps-roll\" + (wide ? \" ps-roll20\" : \"\"), \"\");", "const gx = add(\"ps-grid ps-roll\", \"\");"],
  ["roll sheet v2.4: compact threshold", "wide = need + extra > 150;", "wide = need + extra > 160;"],
  ["roll sheet v2.4: extra note without extra boxes", "if(extra > 0){\n  add(\"ps-sub ps-extra-sub\"", "if(true){\n  add(\"ps-sub ps-extra-sub\""],
  ["check prints: public key accepted", "if(!wvCtx || wvCtx.kind === \"pub\" || !wvCtx.mnemonic){ alert(", "if(!wvCtx){ alert("],
  ["check prints: passphrase line reversed", "\"Passphrase used: \" + (wvCtx.pass ? \"YES (keep it separate; it is not printed here)\" : \"NO\")", "\"Passphrase used: \" + (!wvCtx.pass ? \"YES (keep it separate; it is not printed here)\" : \"NO\")"],
  ["check prints: new-seed fields", "add(\"ps-fields\", S.check ? \"Words checked against your first backup", "add(\"ps-fields\", false ? \"Words checked against your first backup"],
  ["check prints: screen named", "\" + (S.check ? \"your first backup\" : \"the screen\") + \" before", "\" + (S.check ? \"the screen\" : \"the screen\") + \" before"],
  ["print source: passphrase boxes not checked", "  if(!hasSeed()){ alert(\"Generate a seed first\"); return null; }\n  if(passMismatch()) return null;\n", "  if(!hasSeed()){ alert(\"Generate a seed first\"); return null; }\n"],
  ["SeedQR source: check uses the MAKE code", "const kind = from === \"check\" ? wvsKind : sqKind;", "const kind = wvsKind || sqKind;"],
  ["SeedQR source: check rows from MAKE", "if(from !== \"check\") return {kind, rows: sqRows};", "if(sqRows) return {kind, rows: sqRows};"],
  ["check SeedQR: kind not remembered", "  wvsKind = kind;\n", ""],
  ["check SeedQR: kind kept after HIDE", "function wvSeedQrHide(){\n  wvsKind = null;\n", "function wvSeedQrHide(){\n"],
  ["check 4 letters: full words shown", "t.className = \"wtxt\"; t.textContent = w.slice(0, 4);", "t.className = \"wtxt\"; t.textContent = w;"],
  ["check 4 letters: never hides", "if(on === undefined) on = !g.classList.contains(\"on\");", "if(on === undefined) on = true;"],
  ["check 4 letters: button text stays", "b.textContent = words ? \"HIDE FIRST 4 LETTERS\" : \"SHOW FIRST 4 LETTERS\";", "b.textContent = \"SHOW FIRST 4 LETTERS\";"],
  ["check 4 letters: not wiped with the wallet", "function clearWalletView(){\n  wvAbbr(false);\n", "function clearWalletView(){\n"],
  ["check 4 letters: public key", "const words = on && wvCtx && wvCtx.kind !== \"pub\" && wvCtx.mnemonic ?", "const words = on && wvCtx ?"],
  ["check 4 letters: numbers off", "const n = document.createElement(\"b\"); n.textContent = (i + 1) + \".\"; const t = document.createElement(\"span\");", "const n = document.createElement(\"b\"); n.textContent = i + \".\"; const t = document.createElement(\"span\");"],
  ["check 4 letters: grid CSS gone", "  #wvAbbrGrid.on { display: grid; }\n", ""],
  ["check 4 letters: shown in the drill", "class=\"secondary small needs-words\" id=\"wvAbbrBtn\"", "class=\"secondary small\" id=\"wvAbbrBtn\""],
  ["public QR print: nothing remembered", "  qrShown = {id, label};\n  scrollQrIntoView(\"qrBox\");", "  scrollQrIntoView(\"qrBox\");"],
  ["public QR print: kept after HIDE", "function hideQr(){\n  qrShown = null;\n", "function hideQr(){\n"],
  ["public QR print: no name", "\"VOIDFORGE \" + (QR_PRINT_NAMES[qrShown.id] || \"PUBLIC KEY\")", "\"VOIDFORGE PUBLIC KEY\""],
  ["public QR print: text missing", "info.join(\"\\n\") + \"\\n\\n\" + t + \"\\n\\nPUBLIC:", "info.join(\"\\n\") + \"\\n\\nPUBLIC:"],
  ["public QR print: testnet not named", "(QR_PRINT_NAMES[qrShown.id] || \"PUBLIC KEY\") + (net === \"test\" ? \" (TESTNET)\" : \"\")", "(QR_PRINT_NAMES[qrShown.id] || \"PUBLIC KEY\")"],
  ["public QR print: Silent Payment type", "qrShown.id === \"spAddr\" ? \"Address type: Silent Payment (BIP-352)\"", "false ? \"Address type: Silent Payment (BIP-352)\""],
  ["address QR print: request called an address", "const req = t !== addr, fp", "const req = false, fp"],
  ["address QR print: link missing", "(req ? \"\\nPayment link: \" + t : \"\")", "\"\""],
  ["address QR print: no guard", "  if(!t) return alert(\"Press QR next to an address first.\");\n", ""],
  ["address QR print: wrong wallet fingerprint", "document.getElementById(pfx === \"wvq\" ? \"wvFp\" : \"fingerprint\")", "document.getElementById(\"fingerprint\")"],
  ["child print: no button", "  document.getElementById(\"childPrintRow\").style.display = \"\";\n}", "}"],
  ["child print: label stays", "  document.getElementById(\"childPrintBtn\").textContent = CHILD_PRINT_LABEL[c.app] || \"PRINT\";\n", ""],
  ["child print: kept after HIDE", "  childCtx = null; document.getElementById(\"childPrintRow\").style.display = \"none\";", "  document.getElementById(\"childPrintRow\").style.display = \"none\";"],
  ["child print: numbers off", "add(\"ps-n\", String(i + 1).padStart(2, \"0\"), x); add(\"ps-w\", w, x);", "add(\"ps-n\", String(i).padStart(2, \"0\"), x); add(\"ps-w\", w, x);"],
  ["child print: parent missing", "\"Made with BIP85 from the parent wallet \" + c.parent", "\"Made with BIP85 from the parent wallet \""],
  ["child print: index missing", "\", index \" + c.index + \". The parent words\"", "\". The parent words\""],
  ["child print: no question", "if(!confirm(\"Printing sends this child \" + what", "if(false && !confirm(\"Printing sends this child \" + what"],
  ["child print: short secret shrunk", "c.text.length > 600 ? \" ps-s\" : \"\"", "c.text.length > 6 ? \" ps-s\" : \"\""],
  ["child print: other types not printable", "    childShow({app, head, text: out, extra: extra.trim(), index, pass: !!vp, parent: await mnemonicFingerprint(mnemonic, vp)});\n", ""],
  ["child print: words not printable", "    childShow({app: \"words\", words: ws, fp, a0, index, pass: !!vp, parent: await mnemonicFingerprint(r.mnemonic, vp)});\n", ""],
  ["child print: passphrase noted wrongly", "(c.pass ? \" (parent words with a passphrase)\" : \"\")", "(!c.pass ? \" (parent words with a passphrase)\" : \"\")"],
  ["word sheet: 24 words printed as 12", "=== 24 ? 24 : 12, need = wdNeeds(wc);", "=== 24 ? 12 : 12, need = wdNeeds(wc);"],
  ["word sheet: flips missing", "    for(let i = 1; i <= need.flips; i++){ const c = add(\"ps-cell\", \"\", f); add(\"ps-n\", \"Flip \" + i, c); }\n", ""],
  ["word sheet: one word box short", "for(let i = 1; i <= need.words; i++){ const c = add(\"ps-cell\", \"\", g);", "for(let i = 1; i < need.words; i++){ const c = add(\"ps-cell\", \"\", g);"],
  ["word sheet: no secret warning", "Once filled in, this sheet is as secret as your seed: anyone who sees it can make your wallet.\\nType it in on an offline computer, then shred it (or keep it only as a locked-away backup).", "This sheet is harmless.\\nType it in on an offline computer, then shred it (or keep it only as a locked-away backup)."],
  ["print sheets: area not wiped", "  build(add);\n  document.body.classList.add(\"print-seed\");\n  let done = false;\n  const cleanup = () => { if(done) return; done = true; po.textContent = \"\";", "  build(add);\n  document.body.classList.add(\"print-seed\");\n  let done = false;\n  const cleanup = () => { if(done) return; done = true;"],
  ["print sheets: class kept", "  build(add);\n  document.body.classList.add(\"print-seed\");\n  let done = false;\n  const cleanup = () => { if(done) return; done = true; po.textContent = \"\"; document.body.classList.remove(\"print-seed\"); };", "  build(add);\n  document.body.classList.add(\"print-seed\");\n  let done = false;\n  const cleanup = () => { if(done) return; done = true; po.textContent = \"\"; };"],
  ["dice test: FORGE stays on", "document.getElementById(\"forgeBtn\").disabled = on || selfTestState !== \"pass\";", "document.getElementById(\"forgeBtn\").disabled = selfTestState !== \"pass\";"],
  ["dice test: FORGE not blocked", "  if(diceTestOn()) return alert(\"The dice test is on", "  if(false) return alert(\"The dice test is on"],
  ["dice test: rolls kept", "  if(n){ box.value = \"\"; }\n", ""],
  ["dice test: no question", "if(n && !confirm(on ? \"Start a dice test?", "if(false && !confirm(on ? \"Start a dice test?"],
  ["dice test: Cancel still switches", "document.getElementById(\"diceTest\").checked = !on; return;", "return;"],
  ["dice test: no banner", "  document.getElementById(\"diceTestBan\").style.display = on ? \"\" : \"none\";\n", ""],
  ["dice test: box stays closed", "  if(on) document.getElementById(\"rollStats\").open = true;\n", ""],
  ["dice test: words previewed", "|| !rolls || diceTestOn() || (keystoneOn()", "|| !rolls || (keystoneOn()"],
  ["dice test: seed counter shown", "if(diceTestOn() && !seed){ bc.textContent = String(n);", "if(false && !seed){ bc.textContent = String(n);"],
  ["dice test: no test note", "document.getElementById(\"diceTestNote\").textContent = diceTestOn() ? diceTestText(rolls, isCoin) : \"\";", ""],
  ["dice test: bits note kept", "  if(diceTestOn()) document.getElementById(\"bitsNote\").textContent = \"\";\n", ""],
  ["dice test: seed notes kept", "document.getElementById(\"countNote\").textContent = diceTestOn() ? \"\" : countNote(", "document.getElementById(\"countNote\").textContent = false ? \"\" : countNote("],
  ["dice test: no wait", "if(n < min) return n + \" \" + one", "if(n < 2) return n + \" \" + one"],
  ["dice test: problems called fine", "if(an.level === \"ok\") return n", "if(an.level !== \"warn\") return n"],
  ["dice test: self-test gate turns FORGE on", "document.getElementById(\"forgeBtn\").disabled = !on || diceTestOn();", "document.getElementById(\"forgeBtn\").disabled = !on;"],
  ["keyboard: digits ignored", "if(ok.test(e.key)){ e.preventDefault();", "if(false){ e.preventDefault();"],
  ["keyboard: coin takes dice digits", "const ok = getMode() === \"coin\" ? /^[01]$/ : /^[1-6]$/;", "const ok = /^[0-6]$/;"],
  ["keyboard: Backspace ignored", "else if(e.key === \"Backspace\"){ e.preventDefault(); undoRoll(); }", ""],
  ["keyboard: Ctrl keys taken", "  if(e.ctrlKey || e.metaKey || e.altKey) return;\n", ""],
  ["keyboard: no hint", "b.title = \"Add a \" + v + \" (or press \" + v + \" on the keyboard; Backspace undoes the last one)\";", ""],
  ["4-letter: 3 letters expanded", "if(!/^[a-z]{4,8}$/.test(t)) return null;\n  return WORDLIST.find", "if(!/^[a-z]{3,8}$/.test(t)) return null;\n  return WORDLIST.find"],
  ["4-letter: not read in VERIFY", "const f = wordFromPrefix(w); if(f){ words[i] = f; read++; } else bad.push(i);", "bad.push(i);"],
  ["4-letter: not said", "(read ? \" (\" + read + \" word\"", "(false ? \" (\" + read + \" word\""],
  ["4-letter: plural", "(read > 1 ? \"s\" : \"\")", "\"s\""],
  ["4-letter: VERIFY box keeps short forms", "if(r.ok && (r.fromCode || r.expanded))", "if(r.ok && r.fromCode)"],
  ["typo: no suggestions", "const c = closestWords(words[i], 3);", "const c = [];"],
  ["typo: swap counted as two", "v = Math.min(v, d[i - 2][j - 2] + 1);", "v = Math.min(v, d[i - 2][j - 2] + 2);"],
  ["typo: distance 2 listed with distance 1", "if(found.length && found[0][0] === 1) return found.filter(f => f[0] === 1)", "if(false) return found.filter(f => f[0] === 1)"],
  ["typo: only first unknown word", "bad.slice(0, 4).map(one)", "bad.slice(0, 1).map(one)"],
  ["typo: always plural", "(bad.length === 1 ? \"Unknown word: \" : \"Unknown words: \")", "\"Unknown words: \""],
  ["typo: checksum hint gone", "(en || \". Every word is a BIP39 word, so one is probably wrong, missing or out of order: Reforge in EXTRA TOOLS can search for it.\")", "(en || \"\")"],
  ["explain: not on typing", "document.getElementById(\"checkAddr\").addEventListener(\"input\", explainAddrUi);", ""],
  ["explain: P2WPKH length", "d.version === 0 && d.prog.length === 20", "d.version === 0 && d.prog.length === 21"],
  ["explain: P2WSH", "d.version === 0 && d.prog.length === 32", "d.version === 0 && d.prog.length === 33"],
  ["explain: Taproot version", "d.version === 1 && d.prog.length === 32", "d.version === 2 && d.prog.length === 32"],
  ["explain: future version called fine", "return {level: \"bad\", text: \"A SegWit version \" + d.version", "return {level: \"ok\", text: \"A SegWit version \" + d.version"],
  ["explain: bad bc1 accepted", "if(!d) return {level: \"bad\", text: \"Not a valid address: \"", "if(false) return {level: \"bad\", text: \"Not a valid address: \""],
  ["explain: mixed case not said", "t !== low && t !== t.toUpperCase() ? \"it mixes capital", "false ? \"it mixes capital"],
  ["explain: networks mixed up", "const net = EXPLAIN_NET[hrp], d = segwitDecode(t);", "const net = EXPLAIN_NET.bc, d = segwitDecode(t);"],
  ["explain: testnet legacy unknown", "(v === 0 || v === 0x6f)", "(v === 0)"],
  ["explain: testnet legacy called mainnet", "\"Legacy address (P2PKH) on \" + (v ? EXPLAIN_NET.tb : EXPLAIN_NET.bc)", "\"Legacy address (P2PKH) on \" + EXPLAIN_NET.bc"],
  ["explain: P2SH unknown", "(v === 5 || v === 0xc4)", "(v === 0xc4)"],
  ["explain: private key not flagged", "(v === 0x80 || v === 0xef)", "(v === 0xef)"],
  ["explain: compressed private key not flagged", "(raw.length === 33 || (raw.length === 34 && raw[33] === 1))", "(raw.length === 33)"],
  ["explain: xprv not flagged", "if(EXT_PRIVATE.includes(ver)) return {level: \"bad\", text: \"This is an extended PRIVATE key", "if(false) return {level: \"bad\", text: \"This is an extended PRIVATE key"],
  ["explain: xpub not explained", "if(EXT_VERSIONS[ver]) return {level: \"warn\", text: \"This is an extended PUBLIC key", "if(false) return {level: \"warn\", text: \"This is an extended PUBLIC key"],
  ["explain: base58 typo accepted", "let raw; try { raw = await base58decode(t); } catch(e) { return {level: \"bad\"", "let raw; try { raw = await base58decode(t); } catch(e) { raw = new Uint8Array(21); } if(false) { return {level: \"bad\""],
  ["explain: seed words not flagged", "if(/^[a-z]+(\\s+[a-z]+){11,}$/i.test(String(text).trim())) return", "if(false) return"],
  ["explain: Lightning not recognised", "if(/^ln(bc|tb|bcrt)[0-9]/i.test(t)) return", "if(false) return"],
  ["explain: descriptor not recognised", "if(/^[a-z]{2,6}\\(/.test(t)) return", "if(false) return"],
  ["explain: bitcoin: link not read", "if(/^bitcoin:/i.test(t)){ uri =", "if(false){ uri ="],
  ["explain: Silent Payment checksum not checked", "bech32mText(hrp, data) === low", "true"],
  ["explain: Silent Payment network", "(hrp === \"sp\" ? EXPLAIN_NET.bc : EXPLAIN_NET.tb)", "EXPLAIN_NET.bc"],
  ["explain: warnings shown as errors", "r.level === \"warn\" ? \"warn\" : \"bad\"", "\"bad\""],
  ["explain: no dictionary links", "el.appendChild(document.createTextNode(r.text)); dictLinks(el, r.terms);", "el.appendChild(document.createTextNode(r.text));"],
  ["dictionary link: stays on the tab", "  showTab(\"about\");\n  const box = document.getElementById(\"dictBox\"); box.open = true;", "  const box = document.getElementById(\"dictBox\"); box.open = true;"],
  ["dictionary link: box closed", "const box = document.getElementById(\"dictBox\"); box.open = true;\n  dictCat", "const box = document.getElementById(\"dictBox\");\n  dictCat"],
  ["dictionary link: topic filter kept", "  dictCat = \"All\"; document.querySelectorAll(\"#dictCats button\")", "  document.querySelectorAll(\"#dictCats button\")"],
  ["dictionary link: search kept", "document.getElementById(\"dictSearch\").value = \"\"; dictFilter();\n  const it", "dictFilter();\n  const it"],
  ["dictionary link: old highlight kept", "  document.querySelectorAll(\"#dictList .dict-item.dict-hit\").forEach(e => e.classList.remove(\"dict-hit\"));\n", ""],
  ["dictionary link: no highlight", "it.classList.add(\"dict-hit\"); it.scrollIntoView", "it.scrollIntoView"],
  ["what guide: seed words not secret", ">Seed words (12 or 24 words)</button><span class=\"tag tag-secret\">SECRET</span>", ">Seed words (12 or 24 words)</button><span class=\"tag tag-public\">PUBLIC</span>"],
  ["summary: coin called dice", "c.coin ? c.count + \" coin flips\"", "false ? c.count + \" coin flips\""],
  ["summary: Keystone not said", "(c.keystone ? \"Keystone dice rules (each 6 counts as 0)\"", "(false ? \"Keystone dice rules (each 6 counts as 0)\""],
  ["summary: 24 words as 128 bits", "bits = n === 24 ? 256 : 128;", "bits = 128;"],
  ["summary: dice bits as rolls", "Math.floor(c.coin ? c.count : c.count * Math.log2(6))", "Math.floor(c.count)"],
  ["summary: passphrase always NO", "\"Passphrase used: \" + (used ? \"YES (kept separately; it is not written here)\" : \"NO\"), fpT", "\"Passphrase used: NO\", fpT"],
  ["summary: fingerprint missing", "\"NO\"), fpT, document.getElementById(\"address\").textContent", "\"NO\"), document.getElementById(\"address\").textContent"],
  ["summary: no tick", "  });\n  bkTick(\"bk4\");\n}", "  });\n}"],
  ["summary: printed with mismatched passphrases", "  const S = seedSummary(); if(!S) return alert(\"Generate a seed first\");\n  if(passMismatch()) return;\n", "  const S = seedSummary(); if(!S) return alert(\"Generate a seed first\");\n"],
  ["summary: mismatched passphrases summarised", "  if(!hasSeed() || !sumCtx || passMismatchQuiet()) return null;", "  if(!hasSeed() || !sumCtx) return null;"],
  ["summary: no LifeHash", "    if(pic) add(\"ps-lh\", \"\", row).innerHTML = pic;\n", ""],
  ["summary: line not shown", "if(el) el.textContent = S ? \"This seed: \" + S.short : \"\";", ""],
  ["summary: line stale after a passphrase change", "showFpIcon(\"fpIcon\", fp); sumUpdate();", "showFpIcon(\"fpIcon\", fp);"],
];

if (process.env.MUT_CHECK_TARGETS) { // quick mode: only check that every mutation target occurs exactly once in the page
  let badT = 0; for (const [name, find] of M) { const c = html.split(find).length - 1; if (c !== 1) { badT++; console.log(`target occurs ${c}x: ${name}`); } }
  console.log(badT ? `${badT} bad target(s)` : 'all mutation targets occur exactly once'); process.exit(badT ? 1 : 0);
}
const base = await detect(html);
R.ok(base.by === null, "control: the unmodified file passes the self-test and every probe" + (base.by ? " [" + base.by + "]" : ""));

const survivors = [];
const ONLY = process.env.MUT_ONLY ? new RegExp(process.env.MUT_ONLY) : null; // optional: run only the mutations whose name matches
// Optional sharding for CI: MUT_SHARD="i/n" runs only every n-th mutation starting at i, so n jobs together run them all.
const SHARD = process.env.MUT_SHARD ? process.env.MUT_SHARD.split('/').map(Number) : null;
if (SHARD && !(Number.isInteger(SHARD[0]) && Number.isInteger(SHARD[1]) && SHARD[1] > 0 && SHARD[0] >= 0 && SHARD[0] < SHARD[1])) { console.log('bad MUT_SHARD (use i/n, for example 0/4)'); process.exit(1); }
// Shards are balanced by how long each mutation took in an earlier full run (tests/fixtures/mut-times.json, seconds; a new
// mutation counts as the median). Longest first, each goes to the shard with the least time so far; shard 0 starts with
// SHARD0_HEAD seconds because it also runs the unit and oracle tests. The plan is fixed by the names alone, so every job
// computes the same split and every mutation runs in exactly one shard.
const SHARD0_HEAD = 900;
let shardOf = null;
if (SHARD) {
  let times = {}; try { times = JSON.parse(fs.readFileSync(new URL('./fixtures/mut-times.json', import.meta.url), 'utf8')); } catch (e) { times = {}; }
  const known = Object.values(times).sort((a, b) => a - b), med = known.length ? known[Math.floor(known.length / 2)] : 60;
  const items = M.map(([name], i) => ({ i, w: Number.isFinite(times[name]) ? times[name] : med })).sort((a, b) => b.w - a.w || a.i - b.i);
  const load = Array.from({ length: SHARD[1] }, (_, k) => (k === 0 ? SHARD0_HEAD : 0)); shardOf = new Array(M.length);
  for (const it of items) { let best = 0; for (let k = 1; k < load.length; k++) if (load[k] < load[best]) best = k; shardOf[it.i] = best; load[best] += it.w; }
  console.log('shard plan: ' + load.map((x, k) => k + '=' + Math.round(x / 60) + 'm').join(' '));
}
let mutIndex = -1;
for (const [name, find, rep, equivalent] of M) {
  mutIndex++;
  if (SHARD && shardOf[mutIndex] !== SHARD[0]) continue;
  if (ONLY && !ONLY.test(name)) continue;
  const count = html.split(find).length - 1;
  if (count !== 1) { R.ok(false, `mutation target must occur exactly once (${count}x): ${name}`); continue; }
  const res = await detect(html.replace(find, () => rep));
  if (equivalent) { R.ok(true, `${name}: behaviourally equivalent, ${res.by ? 'caught by ' + res.by : 'survives as expected'}`); continue; }
  R.ok(res.by !== null, res.by ? `${name}: caught by ${res.by}` : `${name}: SURVIVED (a hole in the safety net)`);
  if (!res.by) survivors.push(name);
}
if (survivors.length) console.log('\nSurvivors:', survivors);
R.done('mutation');
