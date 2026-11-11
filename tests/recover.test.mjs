// v2.16.0 "Recover old wallets", part A: Open an Electrum wallet file, and any path with more addresses in Open this wallet.
// 1. Electrum wallet files made by Electrum 4.8.4 itself (tests/fixtures/electrum/make.py, public test seeds only) are read, and
//    every answer is compared with what Electrum said about the same file (expected-electrum.json): addresses, fingerprints,
//    paths, keys, seeds, labels. Older formats (1.x Python literal, 2.0 JSON) were written as the old code wrote them and opened
//    by Electrum 4.8.4 to get the answers.
// 2. Files encrypted here with Node's own crypto (an independent implementation of Electrum's storage.py and crypto.py: PBKDF2,
//    ECDH on secp256k1, SHA-512, AES-128-CBC, HMAC-SHA256, zlib; and sha256d with AES-256-CBC for the keys) open on the page,
//    wrong passwords never do, and broken, cut-off or unknown files are refused with a reason.
// 3. Any path in Open this wallet: every address is compared with @scure/bip32 (receive and change, START AT, SHOW 20 MORE, paths
//    ending in /*, paths below an open xpub or xprv, hardened steps).
// 4. The same in Chromium (the file chosen in the file box and dropped on the box), with no network request and no page error.
// Run: node tests/recover.test.mjs      (RECOVER_SHOTS=dir also saves screenshots of both tools, desktop 1280 and phone 390)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import nc from 'node:crypto';
import zlib from 'node:zlib';
import { loadPage, ready, readHtml, makeReporter } from './harness.mjs';
const require = createRequire(import.meta.url);
const { HDKey } = require('@scure/bip32');
const { mnemonicToSeedSync } = require('@scure/bip39');
const { bech32, createBase58check } = require('@scure/base');
const { ripemd160 } = require('@noble/hashes/ripemd160');
const { sha256 } = require('@noble/hashes/sha256');
const here = path.dirname(fileURLToPath(import.meta.url)), FX = path.join(here, 'fixtures', 'electrum');
const R = makeReporter(), ok = R.ok;
const E = JSON.parse(fs.readFileSync(path.join(FX, 'expected-electrum.json'), 'utf8'));
const html = readHtml();
const b58 = createBase58check(sha256);
const h160 = (b) => ripemd160(sha256(b));
const AB = 'abandon '.repeat(11) + 'about';
const ref = (mn, p, type) => { const k = HDKey.fromMasterSeed(mnemonicToSeedSync(mn, '')).derive(p), h = h160(k.publicKey);
  if (type === 'pkh') return b58.encode(Uint8Array.from([0, ...h]));
  if (type === 'sh-wpkh') return b58.encode(Uint8Array.from([5, ...h160(Uint8Array.from([0, 20, ...h]))]));
  return bech32.encode('bc', [0, ...bech32.toWords(h)]); };

// ---- Node's own Electrum encryption (independent of the page), from storage.py and crypto.py
const sha256d = (b) => nc.createHash('sha256').update(nc.createHash('sha256').update(b).digest()).digest();
function pwEncode(text, pw) { const iv = nc.randomBytes(16), c = nc.createCipheriv('aes-256-cbc', sha256d(Buffer.from(pw, 'utf8')), iv); return Buffer.concat([iv, c.update(Buffer.from(text, 'utf8')), c.final()]).toString('base64'); }
const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
const mpow = (b, e, m) => { let r = 1n; b %= m; while (e) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; };
const md = (a) => ((a % P) + P) % P, inv = (a) => mpow(md(a), P - 2n, P);
const eadd = (p, q) => { if (!p) return q; if (!q) return p; let l; if (p[0] === q[0]) { if (md(p[1] + q[1]) === 0n) return null; l = md(3n * p[0] * p[0] * inv(2n * p[1])); } else l = md((q[1] - p[1]) * inv(q[0] - p[0])); const x3 = md(l * l - p[0] - q[0]); return [x3, md(l * (p[0] - x3) - p[1])]; };
const emul = (kk, pt) => { let r = null, a = pt; while (kk > 0n) { if (kk & 1n) r = eadd(r, a); a = eadd(a, a); kk >>= 1n; } return r; };
const big = (b) => BigInt('0x' + Buffer.from(b).toString('hex'));
// storage.py encrypt_before_writing: zlib (level 1) of the text, then ecies_encrypt_message to the key made from the password.
// Node's ECDH makes the ephemeral key and the shared x; the shared point's y (for the compressed form) comes from a plain BigInt
// multiplication, which must give the same x as Node's ECDH.
function storageEncrypt(text, pw, magic = 'BIE1', squeeze = (t) => zlib.deflateSync(t, { level: 1 })) {
  const k = big(nc.pbkdf2Sync(Buffer.from(pw, 'utf8'), Buffer.alloc(0), 1024, 64, 'sha512')) % N, priv = Buffer.from(k.toString(16).padStart(64, '0'), 'hex');
  const me = nc.createECDH('secp256k1'); me.setPrivateKey(priv);
  const eph = nc.createECDH('secp256k1'); eph.generateKeys();
  const x = eph.computeSecret(me.getPublicKey()), full = eph.getPublicKey(null, 'uncompressed'), S = emul(k, [big(full.subarray(1, 33)), big(full.subarray(33))]);
  if (S[0] !== big(x)) throw new Error('test ECDH mismatch');
  const key = nc.createHash('sha512').update(Buffer.concat([Buffer.from([S[1] & 1n ? 3 : 2]), x])).digest();
  const c = nc.createCipheriv('aes-128-cbc', key.subarray(16, 32), key.subarray(0, 16)), ct = Buffer.concat([c.update(squeeze(Buffer.from(text, 'utf8'))), c.final()]);
  const body = Buffer.concat([Buffer.from(magic), eph.getPublicKey(null, 'compressed'), ct]);
  return Buffer.concat([body, nc.createHmac('sha256', key.subarray(32)).update(body).digest()]).toString('base64');
}

const w = loadPage(html); const errors = []; w.addEventListener('error', (e) => errors.push(e.message));
await ready(w);
const $ = (id) => w.document.getElementById(id), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ok(/^SELF-TEST PASSED \(155\/155\)$/.test($('selfTestBadge').textContent), 'the page self-test passes 155/155 (147, 5 for part A and 3 for wallet.dat files): ' + $('selfTestBadge').textContent);
const open = async (text, pw = '') => { w.ewClear(); $('ewIn').value = text; $('ewPass').value = pw; await w.ewOpenUi(); const g = w.eval('ewGot'); return { st: $('ewStatus').textContent, cls: $('ewStatus').className, out: $('ewOut').textContent, secret: g ? g.secret : '', words: g ? g.words : null }; };
const fx = (n) => fs.readFileSync(path.join(FX, n), 'utf8');

// ===== 1. Electrum's own files
for (const [name, c] of Object.entries(E.cases)) {
  const r = await open(fx(name), c.password || '');
  ok(r.cls === 'status ok' && /^Opened read only: /.test(r.st), name + ': opens (' + r.st.slice(0, 90) + ')');
  if (c.wallet_type !== 'imported') {
    const lines = r.out.split('\n'), recv = lines.filter((l) => /^0\/\d /.test(l)).map((l) => l.split(/\s+/)[1]), chg = lines.filter((l) => /^1\/\d /.test(l)).map((l) => l.split(/\s+/)[1]);
    ok(recv.join() === c.recv.join() && chg.join() === c.change.join(), name + ': the first 10 receive and 10 change addresses are the ones Electrum gives');
  }
  for (const [i, k] of c.keystores.entries()) {
    if (k.fp) ok(r.out.includes(k.fp), name + ': keystore ' + (i + 1) + ' fingerprint ' + k.fp);
    if (k.xpub) ok(r.out.includes(k.xpub), name + ': keystore ' + (i + 1) + ' xpub as in the file');
    if (k.derivation && k.type !== 'old') ok(r.out.includes('Derivation: ' + k.derivation.replace(/h/g, "'")), name + ': keystore ' + (i + 1) + ' derivation ' + k.derivation);
  }
  ok(new RegExp('Labels: ' + (c.labels_in_file ?? c.labels) + '\\b').test(r.out), name + ': the number of labels (' + (c.labels_in_file ?? c.labels) + ')');
  if (c.seed) ok(r.secret.replace(/\s*\d+\.\s+/g, ' ').replace(/\s+/g, ' ').includes(c.seed), name + ': the seed words are behind SHOW THE SECRET, exactly as Electrum gives them');
  if (c.passphrase) ok(r.secret.includes('SEED EXTENSION (Electrum’s name for a passphrase): ' + c.passphrase), name + ': the seed extension');
  if (c.xprv) ok(r.secret.includes(c.xprv), name + ': the xprv is behind SHOW THE SECRET');
  if (c.keys) ok(c.keys.every((k) => r.secret.includes(k)), name + ': every imported key, in Electrum’s own export form');
  if (c.addresses) ok(c.addresses.every((a) => r.out.includes(a)), name + ': every imported address');
  if (c.imported_keys) ok(Object.entries(c.imported_keys).every(([a, k]) => r.secret.includes(a + '\n  ' + k)) && /Electrum 1\.x imported keys: 1/.test(r.out), name + ': the Electrum 1.x imported key, which today’s Electrum does not read');
  if (c.hex_seed) ok(r.secret.includes('As hex: ' + c.hex_seed), name + ': the old seed as hex too');
  ok(!r.out.includes(c.seed || '~none~') && !(c.xprv && r.out.includes(c.xprv)), name + ': the public part shows no seed and no private key');
  if (c.password) {
    const bad = await open(fx(name), c.password + 'x');
    ok(bad.cls === 'status bad' && /^WRONG PASSWORD/.test(bad.st) && bad.out === '' && !w.eval('ewGot'), name + ': a wrong password opens nothing');
    const none = await open(fx(name), '');
    if (c.encrypted_file) ok(none.cls === 'status bad' && /The whole file is encrypted with the wallet password/.test(none.st) && none.out === '', name + ': no password: asks for it');
    else ok(none.cls === 'status ok' && /Type the password to see the seed or keys/.test(none.st) && none.secret === '' && $('ewSecretRow').style.display === 'none' && /type the wallet password and press OPEN WALLET FILE again/.test(none.out), name + ': no password: the public part, and the keys stay locked');
  }
}
{ const r = await open(fx('el-segwit-patched.json'));
  ok(/The file has 2 changes saved at its end/.test(r.out) && /Labels: 2/.test(r.out), 'partial writes: the 2 label changes Electrum appended are applied');
  const t = fx('el-segwit-patched.json'), cut = t.slice(0, t.length - 30), r2 = await open(cut);
  ok(r2.cls === 'status ok' && /The end of the file is cut off \(\d+ characters\)/.test(r2.out) && /Labels: 1\b/.test(r2.out), 'a file cut off in its last change: the complete part is read, as Electrum does');
  const r3 = await open(fx('el-2fa-pw.json'), 'test password');
  ok(/Key 3 \(TrustedCoin’s\)/.test(r3.out) && /only Electrum restores a two-factor wallet/.test(r3.out) && /This file holds the first key only/.test(r3.out), '2FA: TrustedCoin’s key named, and how to restore it');
  const r4 = await open(fx('zpub-watch.json'));
  ok(/watch-only wallet/.test(r4.out) && r4.secret === '' && $('ewSecretRow').style.display === 'none', 'watch-only: no secret and no SHOW THE SECRET');
  const r5 = await open(fx('bip39-84-pw.json'), 'test password');
  ok(/from a BIP39 seed or a master key \(Electrum keeps only the account key\)/.test(r5.out) && /EXTENDED PRIVATE KEY \(zprv, the key at m\/84'\/0'\/0'\)/.test(r5.secret) && r5.words === null, 'BIP39 in Electrum: the account zprv, no words (Electrum does not keep them)');
  ok(/Checked: the seed in the file makes this key/.test((await open(fx('el-segwit-pw.json'), 'test password')).out), 'the seed in the file is checked against the xpub');
}

// ===== 2. Node's own encryption, other formats and refusals
{
  const doc = JSON.parse(fx('el-segwit-plain.json')), c = E.cases['el-segwit-plain.json'];
  for (const pw of ['correct horse', 'pässwörd ﬁ 日本', ' leading space', 'x']) {
    const d = JSON.parse(JSON.stringify(doc)); d.use_encryption = true;
    d.keystore.seed = pwEncode(d.keystore.seed, pw); d.keystore.xprv = pwEncode(d.keystore.xprv, pw);
    const enc = storageEncrypt(JSON.stringify(d), pw), r = await open(enc, pw);
    ok(r.cls === 'status ok' && r.out.includes(c.recv[9]) && r.secret.includes('bitter') && /whole file is encrypted/.test(r.out), 'Node-encrypted file and keys (password ' + JSON.stringify(pw) + '): opens, the 10th address and the seed are right');
    ok(/^WRONG PASSWORD/.test((await open(enc, pw.normalize('NFKD') === pw ? pw + ' ' : pw.normalize('NFKD'))).st), 'Node-encrypted file: the password is used as typed (a changed one fails)');
  }
  ok(/encrypted with a hardware wallet/.test((await open(storageEncrypt('{}', 'p', 'BIE2'), 'p')).st), 'BIE2 (encrypted with a hardware wallet): refused with the reason');
  const t = storageEncrypt(JSON.stringify(doc), 'pw'), b = Buffer.from(t, 'base64'); b[60] ^= 1;
  ok(/^WRONG PASSWORD/.test((await open(b.toString('base64'), 'pw')).st), 'a changed byte in an encrypted file: the MAC catches it');
  ok(/not an Electrum wallet file/.test((await open('hello wallet')).st), 'text that is no wallet file: refused');
  ok(/not compressed as Electrum compresses them/.test((await open(storageEncrypt('{}', 'p', 'BIE1', (t) => zlib.deflateRawSync(t)), 'p')).st), 'an encrypted file whose contents are not zlib (raw DEFLATE): refused');
  { const z = (t) => { const b = zlib.deflateSync(t, { level: 1 }); b[b.length - 1] ^= 1; return b; };
    ok(/Adler-32 check fails/.test((await open(storageEncrypt(JSON.stringify(doc), 'p', 'BIE1', z), 'p')).st), 'an encrypted file with a wrong zlib check: refused'); }
  const v2 = JSON.parse(fx('el-segwit-pw.json')); v2.keystore.pw_hash_version = 2;
  ok(/password version 2, which Electrum itself does not support/.test((await open(JSON.stringify(v2), 'test password')).st), 'pw_hash_version 2: refused, as Electrum refuses it');
  ok(/storage version 6, which Electrum itself does not open \(Electrum 1\.9\.8/.test((await open(JSON.stringify({ seed_version: 6 }))).st), 'storage version 6: refused with Electrum’s reason');
  const ms = JSON.parse(fx('multisig-2of2-pw.json')); ms.x2.xpub = E.cases['zpub-watch.json'].keystores[0].xpub;
  ok(/different types/.test((await open(JSON.stringify(ms), 'test password')).st), 'multisig with mixed key types: refused, as Electrum refuses it');
  // Python literal: every form Python 2 repr writes, and __proto__ never reaches the prototype
  const lit = w.ewPyLiteral("{u'a': [1, -2, 3.5, 4L, True, False, None], 'b': (u'x\\xe9\\u2615', b'\\x41', r'\\n'), 0: {}, '__proto__': {'polluted': 1}}");
  ok(JSON.stringify(lit) === JSON.stringify({ a: [1, -2, 3.5, 4, true, false, null], b: ['xé☕', 'A', '\\n'], 0: {}, ['__proto__']: { polluted: 1 } }) && ({}).polluted === undefined && w.eval('({}).polluted') === undefined, 'Python literal: u, b and r strings, escapes, longs, True/False/None, tuples, int keys; no prototype change');
  let threw = 0; for (const bad of ["{'a': }", "{'a' 1}", "'''x'''", "{'a': 'b'} extra", "{'a': os.system('x')}"]) { try { w.ewPyLiteral(bad); } catch (e) { threw++; } }
  ok(threw === 5, 'Python literal: broken text and anything but a literal is refused');
}
{
  let msg = ''; try { w.ewLoadText('{"a": {}},\n{"op": "add", "path": "/__proto__/x", "value": 1}'); } catch (e) { msg = e.message; }
  ok(/points to a place that is not there/.test(msg) && w.eval('({}).x') === undefined, 'JSON patch into __proto__: refused, the prototype is untouched');
  try { w.ewLoadText('{"a": 1},\n{"op": "move", "from": "/a", "path": "/b"}'); msg = ''; } catch (e) { msg = e.message; }
  ok(/is not one Electrum writes/.test(msg), 'JSON patch with an op Electrum never writes: refused');
  const old = fx('electrum-1x-default_wallet');
  ok((await open(old.replace("'use_encryption': True", "'use_encryption': False"), '')).cls === 'status bad', '1.x file that says it has no password but holds encrypted keys: not shown as if it were plain');
  // the file box and a drop: a File object, and a file that is not UTF-8 text
  w.ewClear(); w.eval('ewDropped = new File([' + JSON.stringify(fx('el-segwit-plain.json')) + '], "default_wallet")'); await w.ewOpenUi();
  ok($('ewStatus').className === 'status ok' && $('ewOut').textContent.includes(E.cases['el-segwit-plain.json'].recv[0]), 'a dropped file (File object) opens');
  w.ewClear(); w.eval('ewDropped = new File([new Uint8Array([0xff, 0xfe, 0x00, 0x81])], "wallet.dat")'); await w.ewOpenUi();
  ok(/not text, so it is not an Electrum wallet file/.test($('ewStatus').textContent) && /Bitcoin Core wallet\.dat is a different kind of file/.test($('ewStatus').textContent), 'a binary file: refused, and a wallet.dat is named as a different kind');
  w.ewClear(); $('ewIn').value = '{}'; w.eval('ewDropped = new File(["{}"], "x")'); await w.ewOpenUi();
  ok(/use one of them/.test($('ewStatus').textContent), 'a file and pasted text at once: asks to use one');
}

// ===== secrets: SHOW, re-hide, auto-clear, CLEAR ALL, the words box, PRINT SUMMARY, the gate, the house style
{
  const c = E.cases['el-standard-ext-pw.json']; await open(fx('el-standard-ext-pw.json'), 'test password');
  ok($('ewSecret').style.display === 'none' && $('ewSecret').textContent === '', 'the secret is not on screen until SHOW THE SECRET');
  w.ewReveal(); ok($('ewSecret').textContent.includes('cycle') && $('ewShowBtn').textContent === 'HIDE THE SECRET', 'SHOW THE SECRET shows the seed and the extension');
  const ids = w.eval('rhIds()'); ok(['ewSecret', 'ewIn', 'ewPass'].every((id) => ids.includes(id)) && w.eval('AUTO_FIELDS').includes('ewIn') && w.eval('AUTO_FIELDS').includes('ewPass'), 're-hide covers the shown secret, the pasted file and the password; auto-clear and CLEAR ALL know the boxes');
  ok(w.eval('rhHolds(document.getElementById("ewSecret"))') && w.eval('rhAny()'), 're-hide: the shown secret counts as a secret');
  w.rhHide('tab'); ok($('ewSecret').classList.contains('rh-cov') && $('ewPass').type === 'password', 're-hide: leaving the tab covers the secret and the password box'); w.rhShow();
  $('ewPass').value = ''; ok(w.eval('autoHasSecrets()'), 'auto-clear knows the page holds an opened wallet file');
  let printed = ''; w.print = () => { printed = $('printOnly').textContent; };
  await open(fx('el-standard-ext-pw.json'), 'test password'); w.ewPrint(); w.dispatchEvent(new w.Event('afterprint'));
  ok(/ELECTRUM WALLET FILE SUMMARY/.test(printed) && printed.includes(c.recv[0]) && !printed.includes('cycle rocket') && !printed.includes('xprv9') && !printed.includes('Satoshi Nakamoto') && $('printOnly').textContent === '', 'PRINT SUMMARY: the public part only, never the seed, the extension or the key; the sheet is removed after');
  $('phrase').value = ''; w.ewUseWords(); ok($('phrase').value === c.seed, 'PUT THE WORDS IN THE BOX ABOVE puts the Electrum seed in the words box');
  w.wipeSeed(); ok(!w.eval('ewGot') && $('ewIn').value === '' && $('ewOut').textContent === '' && $('ewSecret').textContent === '' && $('ewPass').value === '' && !w.eval('autoHasSecrets()'), 'CLEAR ALL (and auto-clear, END SESSION) wipe the file, the text, the password, the result and the secret');
  await open(fx('el-segwit-plain.json')); $('ewPass').value = 'a'; $('ewPass').dispatchEvent(new w.Event('input'));
  ok(!w.eval('ewGot') && $('ewOut').textContent === '', 'changing the password (or the text, or the file) wipes the old result');
  w.setGate('fail', 'SELF-TEST FAILED', 'bad'); ok($('ewBtn').disabled, 'gate: a failed self-test disables OPEN WALLET FILE'); w.setGate('pass', 'SELF-TEST PASSED', 'ok'); ok(!$('ewBtn').disabled, 'gate: a passed self-test enables it');
  const box = $('ewBox'), gold = [...box.querySelectorAll('button')].filter((b) => !b.classList.contains('secondary'));
  ok(gold.length === 1 && gold[0].id === 'ewBtn' && box.querySelector('summary > small') && box.querySelector('summary .tag').textContent === 'SECRET', 'house style: one gold main action, the hint in the summary, one tag');
  const names = w.eval('DICT').map((e) => e[0]); ok(['Electrum wallet file', 'Seed extension (Electrum)', 'Two-factor wallet (Electrum 2FA)', 'AES', 'ECIES', 'Custom derivation path'].every((n) => names.includes(n)), 'dictionary: Electrum wallet file, Seed extension, Two-factor wallet, AES, ECIES');
  w.ewClear();
}

// ===== 3. Any path, more addresses (Open this wallet)
{
  const rows = () => [...$('wvList').children].map((li) => li.firstChild.textContent), tags = () => [...$('wvList').children].map((li) => li.getAttribute('data-n'));
  const set = async (id, v) => { $(id).value = v; $(id).dispatchEvent(new w.Event(id === 'wvPathIn' || id === 'wvStart' || id === 'wvAcct' ? 'input' : 'change')); await w.wvRefresh(); };
  $('phrase').value = AB; await w.openWalletView(AB, ''); await w.wvRefresh();
  ok(rows().length === 10 && rows()[0] === ref(AB, "m/84'/0'/0'/0/0") && $('wvChain').value === '0', 'the wallet view still opens on 10 receive addresses');
  await set('wvChain', 'both');
  ok(rows().length === 20 && rows().slice(0, 10).join() === [...Array(10).keys()].map((i) => ref(AB, "m/84'/0'/0'/0/" + i)).join() && rows().slice(10).join() === [...Array(10).keys()].map((i) => ref(AB, "m/84'/0'/0'/1/" + i)).join(), 'Receive and change: the first 10 receive and the first 10 change (from @scure)');
  ok(tags()[0] === '0/0' && tags()[10] === '1/0' && $('wvCopy').textContent === 'COPY THESE 20' && /^Receive and change addresses 0 to 9/.test($('wvPath').textContent), 'Receive and change: each row is marked receive or change, COPY THESE 20, the path line');
  ok(w.addrMeta('wvList', $('wvList').children[12].querySelector('button')).change === true && w.addrMeta('wvList', $('wvList').children[2].querySelector('button')).change === false, 'Receive and change: a change row’s QR is printed as a change address');
  await set('wvStart', '5'); ok(rows()[0] === ref(AB, "m/84'/0'/0'/0/5") && rows()[10] === ref(AB, "m/84'/0'/0'/1/5") && /addresses 5 to 14/.test($('wvPath').textContent), 'START AT 5: addresses 5 to 14 of each');
  w.apMore(); await sleep(10); await w.wvRefresh(); ok(rows().length === 60 && rows()[29] === ref(AB, "m/84'/0'/0'/0/34") && rows()[59] === ref(AB, "m/84'/0'/0'/1/34"), 'SHOW 20 MORE: 30 of each, 5 to 34');
  w.wvPage(1); await sleep(10); await w.wvRefresh(); ok($('wvStart').value === '15' && rows().length === 20 && rows()[0] === ref(AB, "m/84'/0'/0'/0/15"), 'NEXT 10 moves the start by 10 and goes back to 10 of each');
  await set('wvStart', 'x'); ok(/The start must be a whole number/.test($('wvErr').textContent) && rows().length === 0, 'a bad start is refused, no old addresses stay');
  await set('wvStart', '0'); await set('wvChain', '0');
  for (let i = 0; i < 10; i++) w.apMore(); await sleep(10); await w.wvRefresh();
  ok(rows().length === 200 && $('wvMore').disabled && rows()[199] === ref(AB, "m/84'/0'/0'/0/199"), 'SHOW 20 MORE stops at 200 addresses');
  await set('wvType', 'pkh'); await set('wvPathIn', "m/44h/0h/0h/0/*");
  ok(rows().length === 10 && rows()[3] === ref(AB, "m/44'/0'/0'/0/3", 'pkh') && $('wvChain').disabled && tags()[3] === '3' && /^Addresses 0 to 9, Legacy/.test($('wvPath').textContent), "a path ending in /* (m/44h/0h/0h/0/*): the addresses right under it, written with h, receive or change does not apply");
  let al = ''; w.alert = (m) => { al = m; }; w.printRecoverySheet(); ok(/Type the account path instead of a path ending in \/\*/.test(al), 'the recovery sheet asks for an account path, not a /* path');
  await set('wvPathIn', 'm/0/*'); ok(rows()[1] === ref(AB, 'm/0/1', 'pkh'), 'm/0/*: unhardened steps from the master key');
  await set('wvPathIn', "m/0'/5"); await set('wvChain', '1'); ok(rows()[2] === ref(AB, "m/0'/5/1/2", 'pkh') && !$('wvChain').disabled, "an account path (m/0'/5): change addresses under it");
  for (const bad of ['m/x', 'm' + '/1'.repeat(11) + '/*', 'm/2147483648/*', '0/*', 'm/*/1']) { await set('wvPathIn', bad); ok(/^The path must look like/.test($('wvErr').textContent) && rows().length === 0, 'a bad path is refused: ' + bad); }
  await set('wvPathIn', ''); await set('wvChain', '0'); await set('wvType', 'wpkh'); ok(!$('wvAcct').disabled && rows()[0] === ref(AB, "m/84'/0'/0'/0/0"), 'an empty path box goes back to the account number');
  // an xpub (watch-only) and an xprv below the master
  const acct = HDKey.fromMasterSeed(mnemonicToSeedSync(AB, '')).derive("m/84'/0'/0'");
  $('wpIn').value = acct.publicExtendedKey; await w.openWatchOnly(); await w.wvRefresh();
  ok(!$('wvPathIn').closest('.wv-path') || w.getComputedStyle($('wvPathIn')).display !== 'none', 'watch-only: the path box shows');
  await set('wvPathIn', '0/*'); ok(rows()[4] === ref(AB, "m/84'/0'/0'/0/4"), 'watch-only: 0/* below the key gives its receive addresses');
  await set('wvPathIn', '1/*'); ok(rows()[4] === ref(AB, "m/84'/0'/0'/1/4"), 'watch-only: 1/* gives its change addresses');
  await set('wvPathIn', '7'); ok(rows()[0] === ref(AB, "m/84'/0'/0'/7/0/0") && $('wvList').children[0].querySelector('button').getAttribute('data-addr') === rows()[0], 'watch-only: a path without /* (7) puts receive and change under it');
  await set('wvPathIn', "0'/*"); ok(/A public key cannot make a hardened step/.test($('wvErr').textContent) && rows().length === 0, 'watch-only: a hardened step is refused with the reason');
  await set('wvPathIn', 'm/0/*'); ok(/without m/.test($('wvErr').textContent), 'watch-only: m/ is refused (the key is not the master key)');
  $('pkIn').value = acct.privateExtendedKey; $('pkIn').dispatchEvent(new w.Event('input')); await w.openPrivateKey(); await w.wvRefresh();
  await set('wvPathIn', "0h/*"); ok(rows()[2] === ref(AB, "m/84'/0'/0'/0'/2"), 'xprv below the master: a hardened step below it works');
  w.clearWalletView(); ok($('wvStart').value === '0' && !$('wvChain').disabled && $('wvPathIn').value === '', 'clearing the wallet view resets START AT, the chain and the path');
  w.wipeSeed();
}
ok(errors.length === 0, 'no page error (' + errors.join(' | ') + ')');

// ===== 4. Chromium: the file box, a drop, no network, no page error; screenshots on request
let pw = null; try { pw = require('playwright-core'); } catch (e) { try { pw = require('playwright'); } catch (e2) { pw = null; } }
let browser = null; if (pw) { try { browser = await pw.chromium.launch(); } catch (e) { browser = null; } }
if (!browser) console.log('SKIPPED Chromium (not installed here)');
else {
  const FILE = 'file://' + (process.env.VF_FILE || path.join(here, '..', 'voidforge.html'));
  const page = async (viewport) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: 'dark' });
    const reqs = []; ctx.on('request', (q) => { if (!/^(file|data|blob):/.test(q.url())) reqs.push(q.url()); });
    await ctx.setOffline(true);
    const p = await ctx.newPage(), perr = []; p.on('pageerror', (e) => perr.push(e.message)); p.on('dialog', (d) => d.accept());
    await p.goto(FILE); await p.waitForFunction(() => document.body.classList.contains('js-ok'));
    await p.waitForFunction(() => /PASSED/.test(document.getElementById('selfTestBadge').textContent), null, { timeout: 180000 });
    await p.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; } #watchWarn { display: none !important; }' + (process.env.RECOVER_SHOTS ? ' .tabs { position: static !important; }' : '') });
    await p.evaluate(() => { const g = document.getElementById('sgGo'); if (g) g.click(); window.print = () => {}; showTab('check'); document.getElementById('ewBox').open = true; });
    return { p, reqs, perr, ctx };
  };
  const { p, reqs, perr, ctx } = await page({ width: 1280, height: 900 });
  ok(/^SELF-TEST PASSED \(155\/155\)$/.test(await p.textContent('#selfTestBadge')), 'Chromium: the self-test passes 155/155');
  await p.setInputFiles('#ewFile', path.join(FX, 'el-segwit-encrypted')); await p.fill('#ewPass', 'test password'); await p.click('#ewBtn');
  await p.waitForFunction(() => /ok|bad/.test(document.getElementById('ewStatus').className), null, { timeout: 60000 });
  const out = await p.textContent('#ewOut');
  ok((await p.getAttribute('#ewStatus', 'class')) === 'status ok' && out.includes(E.cases['el-segwit-encrypted'].recv[0]) && /whole file is encrypted/.test(out), 'Chromium: a whole-file encrypted wallet chosen in the file box opens with its password (WebCrypto PBKDF2 with an empty salt works)');
  await p.click('#ewShowBtn'); ok((await p.textContent('#ewSecret')).includes('bitter') && (await p.evaluate(() => getComputedStyle(document.getElementById('ewSecret')).userSelect)) === 'none', 'Chromium: SHOW THE SECRET shows the seed, which cannot be selected');
  await p.evaluate(async (t) => { ewClear(); const dt = new DataTransfer(); dt.items.add(new File([t], 'default_wallet')); document.getElementById('ewBox').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, fx('el-old-pw.json'));
  ok(/File ready: default_wallet/.test(await p.textContent('#ewDrop')), 'Chromium: a file dropped on the box is ready');
  await p.fill('#ewPass', 'test password'); await p.click('#ewBtn'); await p.waitForFunction(() => /ok|bad/.test(document.getElementById('ewStatus').className), null, { timeout: 60000 });
  ok((await p.textContent('#ewOut')).includes('1FJEEB8ihPMbzs2SkLmr37dHyRFzakqUmo'), 'Chromium: the dropped old Electrum wallet opens');
  await p.evaluate(async (m) => { document.getElementById('phrase').value = m; await verify(); }, AB); await p.waitForTimeout(800);
  await p.evaluate(async () => { const c = document.getElementById('wvChain'); c.value = 'both'; c.dispatchEvent(new Event('change')); await wvRefresh(); apMore(); await wvRefresh(); });
  ok((await p.$$eval('#wvList li', (l) => l.length)) === 60, 'Chromium: Receive and change with SHOW 20 MORE lists 30 of each');
  // memory: after CLEAR ALL, the seed, the xprv and the password of an opened wallet file are no longer held by the page (a heap
  // snapshot holds only live objects; the same method as tests/memory.test.mjs)
  { const cdp = await ctx.newCDPSession(p); await cdp.send('HeapProfiler.enable');
    const heap = async () => { for (let i = 0; i < 2; i++) await cdp.send('HeapProfiler.collectGarbage'); let j = ''; const on = (c) => { j += c.chunk; }; cdp.on('HeapProfiler.addHeapSnapshotChunk', on); await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false }); cdp.off('HeapProfiler.addHeapSnapshotChunk', on); return JSON.parse(j).strings; };
    const seed = 'mem' + nc.randomBytes(6).toString('hex') + ' ' + Array.from({ length: 11 }, () => nc.randomBytes(3).toString('hex')).join(' '), pass = 'Pw' + nc.randomBytes(8).toString('hex');
    const d = JSON.parse(fx('el-segwit-plain.json')); d.use_encryption = true; d.keystore.seed = pwEncode(seed, pass); d.keystore.xprv = pwEncode(d.keystore.xprv, pass);
    const xprv = E.cases['el-segwit-plain.json'].seed ? JSON.parse(fx('el-segwit-plain.json')).keystore.xprv : '';
    await p.setInputFiles('#ewFile', { name: 'default_wallet', mimeType: 'application/octet-stream', buffer: Buffer.from(storageEncrypt(JSON.stringify(d), pass)) });
    await p.fill('#ewPass', pass); await p.click('#ewBtn'); await p.waitForFunction(() => /ok|bad/.test(document.getElementById('ewStatus').className), null, { timeout: 60000 }); await p.click('#ewShowBtn');
    const secrets = [['the seed', seed.split(' ').slice(0, 3).join(' ')], ['the xprv', xprv.slice(10, 60)], ['the password', pass]], find = (S) => secrets.filter(([, v]) => S.some((x) => x.includes(v))).map(([n]) => n);
    const before = find(await heap()); ok(before.includes('the seed') && before.includes('the xprv'), 'Chromium memory: control: while the wallet file is open, its seed and xprv are in the heap (' + before.join(', ') + ')');
    await p.evaluate(() => clearAll()); await p.waitForTimeout(1200);
    const after = find(await heap()); ok(after.length === 0, 'Chromium memory: after CLEAR ALL, the seed, the xprv and the password are no longer held by the page' + (after.length ? ' (still held: ' + after.join(', ') + ')' : '')); }
  ok(perr.length === 0 && reqs.length === 0, 'Chromium: no page error and no network request (' + perr.concat(reqs).join(' | ') + ')');
  await ctx.close();
  if (process.env.RECOVER_SHOTS) {
    const dir = process.env.RECOVER_SHOTS; fs.mkdirSync(dir, { recursive: true });
    for (const [vp, tag] of [[{ width: 1280, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
      const s = await page(vp);
      await s.p.setInputFiles('#ewFile', path.join(FX, 'el-standard-ext-pw.json')); await s.p.fill('#ewPass', 'test password'); await s.p.click('#ewBtn');
      await s.p.waitForFunction(() => /ok|bad/.test(document.getElementById('ewStatus').className), null, { timeout: 60000 }); await s.p.click('#ewShowBtn');
      await (await s.p.$('#ewBox')).screenshot({ path: path.join(dir, tag + '-electrum-file.png') });
      await s.p.evaluate(() => { ewClear(); }); await (await s.p.$('#ewBox')).screenshot({ path: path.join(dir, tag + '-electrum-file-empty.png') });
      await s.p.evaluate(async (m) => { document.getElementById('phrase').value = m; await verify(); }, AB); await s.p.waitForTimeout(800);
      await s.p.evaluate(async () => { const c = document.getElementById('wvChain'); document.getElementById('walletView').open = true; c.value = 'both'; c.dispatchEvent(new Event('change')); const st = document.getElementById('wvStart'); st.value = '5'; st.dispatchEvent(new Event('input')); await wvRefresh(); });
      await (await s.p.$('#walletView')).screenshot({ path: path.join(dir, tag + '-any-path-receive-and-change.png') });
      await s.p.evaluate(async () => { const t = document.getElementById('wvType'); t.value = 'pkh'; t.dispatchEvent(new Event('change')); const q = document.getElementById('wvPathIn'); q.value = "m/44'/0'/0'/0/*"; q.dispatchEvent(new Event('input')); await wvRefresh(); });
      await (await s.p.$('#walletView')).screenshot({ path: path.join(dir, tag + '-any-path-star.png') });
      await s.ctx.close();
    }
    console.log('screenshots saved in ' + dir);
  }
  await browser.close();
}
R.done('recover');
