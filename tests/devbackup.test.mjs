// VOIDFORGE device backup test (v2.12.0): "Open a signing device's backup" (TAPSIGNER .aes / .sh, Krux KEF and seeds.json, Coldcard .7z).
// 1. Every official vector found in the makers' repositories (tests/fixtures/device-backups, README.txt names each source): Krux
//    selfcustody/krux v26.09.0 (QR text in base43 and hex, seeds.json KEF and older entries), Coldcard 1.5.3Q (two real .7z files), and the
//    one TAPSIGNER vector there is, which is MADE (synthetic; Coinkite publishes none), also in its .sh form and with a spaced key.
// 2. Cross-checks written here with node:crypto (none of the page's code): new TAPSIGNER backups of random master keys (AES-128-CTR) in
//    four paths and a tprv; new Krux KEF envelopes of EVERY version of the spec (0 1 5 6 7 10 11 12 15 16 20 21) from random entropy,
//    ids and iteration counts, and older seeds.json entries; new Coldcard-style 7z files (layout of Coldcard's compat7z.py) for 12 and 24
//    words, an xprv-only record, a raw seed, testnet and a custom password. Expected words, fingerprints and addresses come from
//    @scure/bip39, @scure/bip32 and @scure/btc-signer.
// 3. Refusals: each with a clear message.
// 4. The page's own boxes (kind, file or text, key, OPEN BACKUP, SHOW THE SECRET, USE THESE WORDS, CLEAR, CLEAR ALL).
// 5. When tests/vendor/fetch.sh has fetched Krux's kef.py (and python3 with `cryptography` is there): the maker's own code, run through
//    tests/vendor/kef_oracle.py, opens what the page makes and makes what the page opens.
// Run: node tests/devbackup.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createCipheriv, createHash, randomBytes, randomInt, pbkdf2Sync } from 'node:crypto';
import { deflateRawSync, crc32 } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadPage, ready, readHtml, makeReporter } from './harness.mjs';

const require = createRequire(import.meta.url);
const { HDKey } = require('@scure/bip32');
const { entropyToMnemonic, mnemonicToSeedSync } = require('@scure/bip39');
const { wordlist } = require('@scure/bip39/wordlists/english');
const btc = require('@scure/btc-signer');
const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures', 'device-backups');
const R = makeReporter();
const w = await ready(loadPage(readHtml()));
const $ = (id) => w.document.getElementById(id);
const hex = (b) => Buffer.from(b).toString('hex');
const u8 = (b) => new Uint8Array(b);
const enc = (t) => new TextEncoder().encode(t);
const sha = (...p) => createHash('sha256').update(Buffer.concat(p.map((x) => Buffer.from(x)))).digest();
const rb = (n) => randomBytes(n);
const pick = (a) => a[randomInt(a.length)];
const fail = (m, e) => R.ok(false, m + ' -- ' + (e && e.message || e));
R.ok(/PASSED/.test($('selfTestBadge').textContent), 'the page passes its self-test');
async function throws(promise, re, name) {
  try { await promise; R.ok(false, name + ' (nothing was refused)'); } catch (e) { R.ok(re.test(e.message), name + ': “' + e.message.slice(0, 110) + '”'); }
}

// ---------------------------------------------------------------- expected values, from the independent libraries
const NETS = { main: btc.NETWORK, test: btc.TEST_NETWORK };
function addrOf(pub, type, net) {
  const n = NETS[net];
  if (type === 'wpkh') return btc.p2wpkh(pub, n).address;
  if (type === 'sh-wpkh') return btc.p2sh(btc.p2wpkh(pub, n), n).address;
  if (type === 'pkh') return btc.p2pkh(pub, n).address;
  if (type === 'tr') return btc.p2tr(pub.slice(1), undefined, n).address;   // BIP86: key path only, no script tree
  throw new Error('type');
}
const TYPE = { 44: 'pkh', 49: 'sh-wpkh', 84: 'wpkh', 86: 'tr' };
const fpOf = (root) => root.fingerprint.toString(16).padStart(8, '0');
function expected(root, steps, net) {   // steps "m/84'/0'/0'": the first 10 receive and first 10 change addresses
  const type = TYPE[parseInt(steps.split('/')[1], 10)], out = [];
  for (const chain of [0, 1]) for (let i = 0; i < 10; i++) out.push([chain + '/' + i, addrOf(root.derive(steps + '/' + chain + '/' + i).publicKey, type, net)]);
  return out;
}
// the page's text: "Master fingerprint: ..." and rows "0/3  address"
function shows(text, root, steps, net, label) {
  const rows = new Map([...text.matchAll(/^(\d\/\d)\s+(\S+)\s*$/gm)].map((m) => [m[1], m[2]]));
  const exp = expected(root, steps, net), bad = exp.filter(([k, a]) => rows.get(k) !== a);
  R.ok(text.includes('Master fingerprint: ' + fpOf(root)), label + ': fingerprint ' + fpOf(root));
  R.ok(rows.size === 20 && bad.length === 0, label + ': the 10 receive and 10 change addresses (' + exp[0][1] + ' first)' + (bad.length ? ' MISMATCH ' + bad[0] + ' got ' + rows.get(bad[0][0]) : ''));
}
const wordsOf = (secret) => secret.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').replace(/\d+\. /g, '').trim();   // the numbered words under the heading line
const rootOfWords = (m, net = 'main') => HDKey.fromMasterSeed(mnemonicToSeedSync(m), net === 'test' ? { private: 0x04358394, public: 0x043587cf } : undefined);
const rndRoot = (net = 'main') => HDKey.fromMasterSeed(rb(32), net === 'test' ? { private: 0x04358394, public: 0x043587cf } : undefined);
const fileOf = (name, bytes) => { const f = new w.File([bytes], name); Object.defineProperty(f, 'arrayBuffer', { value: async () => u8(bytes).buffer.slice(0) }); return f; };   // jsdom's File has no arrayBuffer(); a browser's has

// ================================================================ 0. The fixtures
const KX = JSON.parse(readFileSync(path.join(FX, 'krux', 'vectors.json'), 'utf8'));
const CC = JSON.parse(readFileSync(path.join(FX, 'coldcard', 'vectors.json'), 'utf8'));
const TS = JSON.parse(readFileSync(path.join(FX, 'tapsigner', 'vectors.json'), 'utf8'));
R.ok(KX.source.commit === '2b20e3370169731a0d89839a4113ad9a1b732078' && KX.source.tag === 'v26.09.0', 'fixture: Krux vectors are from selfcustody/krux v26.09.0 (2b20e33)');
R.ok(TS.commit === '6ea18e9e94b5cc877885a9dd92518c28e814e251' && /NOT_OFFICIAL/.test(Object.keys(TS).join()), 'fixture: the TAPSIGNER vector is the synthetic one, labelled as made');
for (const v of CC) {
  const f = readFileSync(path.join(FX, 'coldcard', path.basename(v.file)));
  R.ok(hex(sha(f)) === v.sha256 && Buffer.compare(f, Buffer.from(v.base64, 'base64')) === 0, 'fixture: ' + path.basename(v.file).slice(0, 30) + ' is the file of Coldcard/firmware (SHA-256 ' + v.sha256.slice(0, 12) + ')');
}

// ================================================================ 1. Official vectors
const PW = KX.password;   // "test key"
const mnOf = (v) => v.expected_mnemonic;
for (const v of KX.kef_qr_vectors) {
  for (const [form, t] of [['base43', v.qr_text_base43], ['hex', v.envelope_hex], ['HEX capitals', v.envelope_hex.toUpperCase()], ['hex with spaces', v.envelope_hex.replace(/(.{8})/g, '$1 ')]]) {
    try { const x = await w.kruxOpen(enc(t), t, PW, false); R.ok(x.list.length === 1 && x.list[0].mnemonic === mnOf(v) && x.list[0].iters === v.iterations && x.list[0].version === 'KEF version ' + v.version, 'Krux ' + v.name + ' (KEF v' + v.version + ', ' + v.iterations + ' iterations) as ' + form + ' opens: ' + mnOf(v).split(' ').slice(0, 3).join(' ') + '...'); } catch (e) { fail('Krux ' + v.name + ' as ' + form, e); }
  }
  const bin = await w.kruxOpen(Buffer.from(v.envelope_hex, 'hex'), null, PW, true).catch((e) => e);   // the envelope as a file of raw bytes
  R.ok(bin.list && bin.list[0].mnemonic === mnOf(v), 'Krux ' + v.name + ' as a file of raw bytes');
  const wrong = await w.kruxOpen(enc(v.qr_text_base43), v.qr_text_base43, 'Test Key', false);
  R.ok(wrong.list[0].mnemonic === null, 'Krux ' + v.name + ': “Test Key” (wrong capitals) does not open it');
}
for (const v of KX.kef_in_seeds_json.concat(KX.legacy_seeds_json)) {
  const x = await w.kruxOpen(enc(v.seeds_json), v.seeds_json, PW, true);
  R.ok(x.list.length === 1 && x.list[0].mnemonic === v.expected_mnemonic && x.list[0].id === (v.id || v.salt_is_entry_key), 'Krux seeds.json ' + v.name + ' (' + x.list[0].version + ') opens: ' + v.expected_mnemonic.split(' ').slice(0, 3).join(' ') + '...');
  const wr = await w.kruxOpen(enc(v.seeds_json), v.seeds_json, 'wrong', true);
  R.ok(wr.list[0].mnemonic === null, 'Krux seeds.json ' + v.name + ': a wrong key gives no words');
}
for (const v of KX.extra) {
  const e = w.kefUnwrap(Buffer.from(v.envelope_hex, 'hex'));
  R.ok(!!e && e.v === v.version && e.iters === v.iterations, 'Krux ' + v.name + ': the envelope is read (v' + v.version + ', ' + (e && e.iters) + ' iterations)');
  if (v.note && /STRUCTURE-ONLY|structure-only/i.test(v.note)) {
    for (const k of ['test key', 'key', 'abc', 'test ID', '']) R.ok((await w.kefDecrypt(e, k)) === null, 'Krux ' + v.name + ' is structure-only: the key “' + k + '” does not open it');
    continue;
  }
  const pw = v.password.split(' (')[0], p = await w.kefDecrypt(e, pw);
  const want = v.plaintext_hex || v.plaintext_entropy_hex;
  R.ok(!!p && hex(p) === want, 'Krux ' + v.name + ' (v' + v.version + ', key “' + pw + '”, ' + v.iterations + ' iterations) decrypts to ' + want.slice(0, 16) + '...');
  R.ok((await w.kefDecrypt(e, pw + ' ')) === null, 'Krux ' + v.name + ': the key plus a space does not open it');
}
{ const x = await w.kruxOpen(enc(KX.kef_qr_vectors[5].envelope_hex), KX.kef_qr_vectors[5].envelope_hex, 'x', false); R.ok(x.list[0].mnemonic === null, 'Krux GCM with a wrong key gives no words (GCM check)'); }

// Coldcard: the two real files, their 12 words typed in the ways people type them
for (const v of CC) {
  const bytes = u8(Buffer.from(v.base64, 'base64')), name = path.basename(v.file), plain = v.plaintext;
  const mn = /^mnemonic = "(.*)"$/m.exec(plain)[1], chain = /^chain = "(.*)"$/m.exec(plain);
  const short = name.slice(0, 12), xl = /^xprv = "(.*)"$/m.exec(plain);
  // Coldcard's older docs/backup.7z has an xprv line that is not its seed's: the firmware asserts 'xprv mismatch' (backups.py), so the page refuses it too
  if (xl && rootOfWords(mn).privateExtendedKey !== xl[1]) { await throws(w.ccOpen(bytes, v.password, name), /disagree, so a Coldcard would refuse/, 'Coldcard ' + short + ': its xprv line is not its seed\'s, so it is refused as a Coldcard refuses it'); continue; }
  try {
    const x = await w.ccOpen(bytes, v.password, name);
    R.ok(x.mnemonic === mn && x.net === 'main', 'Coldcard ' + short + ': opens with its 12 words: ' + mn.split(' ').slice(0, 3).join(' ') + '... (' + mn.split(' ').length + ' words)');
    const fwWant = [/^hardware = "(.*)"$/m.exec(plain)?.[1], /^fw_version = "(.*)"$/m.exec(plain)?.[1]].filter(Boolean).join(' ');
    R.ok(x.fw === fwWant, 'Coldcard ' + short + ': the firmware line is read (“' + x.fw + '”)');
  } catch (e) { fail('Coldcard ' + short, e); }
  const pwds = [['capitals and extra spaces', '  ' + v.password.toUpperCase().replace(/ /g, '   ') + '\n'], ['4-letter starts in capitals', v.password.split(' ').map((s) => s.slice(0, 4)).join(' ').toUpperCase()]];
  for (const [what, pw] of pwds) { try { R.ok((await w.ccOpen(bytes, pw, 'backup.7z')).mnemonic === mn, 'Coldcard ' + short + ': the words typed with ' + what + ' open it'); } catch (e) { fail('Coldcard ' + short + ' ' + what, e); } }
  await throws(w.ccOpen(bytes, v.password.replace(/^\S+/, 'abandon'), name), /do not open/, 'Coldcard ' + short + ': a wrong first word');
  await throws(w.ccOpen(bytes, v.password.split(' ').reverse().join(' '), name), /do not open/, 'Coldcard ' + short + ': the words in the wrong order');
  await throws(w.ccOpen(bytes, '', name), /Type the 12 backup words/, 'Coldcard ' + short + ': no words typed');
  // the same words through the page's boxes, with the independent fingerprint and addresses
  $('dbKind').value = 'cc'; $('dbIn').value = ''; $('dbKey').value = v.password;
  Object.defineProperty($('dbFile'), 'files', { value: [fileOf(name, bytes)], configurable: true });
  await w.dbOpenUi();
  R.ok($('dbStatus').className === 'status ok' && /Coldcard backup opened/.test($('dbStatus').textContent), 'Coldcard ' + short + ' in the page: “' + $('dbStatus').textContent + '”');
  shows($('dbOut').textContent, rootOfWords(mn), "m/84'/0'/0'", 'main', 'Coldcard ' + short + ' in the page');
  w.dbClear(); delete $('dbFile').files;
}

// TAPSIGNER: the one vector there is (MADE, not Coinkite's) in every form
const TSV = TS.synthetic_NOT_OFFICIAL, tsCt = Buffer.from(TSV.ciphertext_hex, 'hex');
const tsSh = (ct, extra = '') => '#!/bin/sh\n#\n# TAPSIGNER backup: ' + 'ABCDE-FGHIJ-KLMNO-PQRST' + '\n#\nread -p "Key from back of card (32 hex digits): " KEY\necho\nbase64 -d <<END-OF-DATA | openssl aes-128-ctr -d -iv 0 -K $KEY\n' + Buffer.from(ct).toString('base64').match(/.{1,70}/g).join('\n') + '\nEND-OF-DATA' + extra;
{
  const r = await w.tsOpen(u8(tsCt), TSV.key_hex), want = HDKey.fromExtendedKey(TSV.plaintext_utf8.split('\n')[0]);
  R.ok(r.xprv + '\n' + r.path + '\n' === TSV.plaintext_utf8 && r.fp === fpOf(want) && r.fp === '3442193e' && r.net === 'main' && r.depth === 0, 'TAPSIGNER (synthetic, MADE): the xprv, the path ' + r.path + ' and the fingerprint ' + r.fp + ' (BIP32 test vector 1)');
  R.ok((await w.tsOpen(u8(tsCt), TSV.key_hex.toUpperCase())).fp === '3442193e', 'TAPSIGNER synthetic: the key in capitals');
  R.ok((await w.tsOpen(enc(tsSh(tsCt)), TSV.key_hex)).fp === '3442193e', 'TAPSIGNER synthetic: the .sh form cktap writes (Base64 between the END-OF-DATA lines)');
  R.ok((await w.tsOpen(enc(tsSh(tsCt) + '\n'), TSV.key_hex)).fp === '3442193e', 'TAPSIGNER synthetic: the .sh form with a final newline');
  R.ok((await w.tsOpen(enc(tsSh(tsCt).replace(/\n/g, '\r\n')), TSV.key_hex)).fp === '3442193e', 'TAPSIGNER synthetic: the .sh form with Windows line ends');
  for (const k of ['4141 4141-4141 4141 4141 4141 4141 4141', '  41414141 41414141 41414141 41414141  ', '41-41-41-41-41-41-41-41-41-41-41-41-41-41-41-41']) R.ok((await w.tsOpen(enc(tsSh(tsCt)), k)).fp === '3442193e', 'TAPSIGNER synthetic: the key typed as “' + k.trim() + '”');
  const rows = await w.dbWalletText(r.root, r.fp, r.net, r.steps);
  shows(rows, want, "m/84'/0'/0'", 'main', 'TAPSIGNER synthetic');
}

// ================================================================ 2a. TAPSIGNER: new backups made here
const tsMake = (root, pathText, keyBytes, tail = '') => createCipheriv('aes-128-ctr', keyBytes, Buffer.alloc(16)).update(Buffer.from(root.privateExtendedKey + '\n' + pathText + '\n' + tail));
const TS_CASES = [['m/84h/0h/0h', "m/84'/0'/0'", 'main'], ['m/49h/0h/0h', "m/49'/0'/0'", 'main'], ['m/44h/0h/0h', "m/44'/0'/0'", 'main'], ['m/86h/0h/0h', "m/86'/0'/0'", 'main'], ['m/84h/1h/0h', "m/84'/1'/0'", 'test'],
  ['m/84h/0h/0x2ah', "m/84'/0'/42'", 'main'], ['m/86h/0h/7h', "m/86'/0'/7'", 'main']];
for (const [shown, deriv, net] of TS_CASES) {
  const root = rndRoot(net), key = rb(16), ct = tsMake(root, shown, key);
  R.ok(root.privateExtendedKey.startsWith(net === 'test' ? 'tprv' : 'xprv'), 'TAPSIGNER ' + shown + ': made here with node:crypto AES-128-CTR, zero IV (' + root.privateExtendedKey.slice(0, 4) + ')');
  try {
    for (const [form, bytes] of [['raw file', u8(ct)], ['.sh', enc(tsSh(ct))]]) {
      const r = await w.tsOpen(bytes, hex(key));
      R.ok(r.fp === fpOf(root) && r.xprv === root.privateExtendedKey && r.net === net && r.path === shown.replace(/0x2a/, '42') && r.extra === 0, 'TAPSIGNER ' + shown + ' (' + form + '): fingerprint ' + r.fp + ', path ' + r.path + ', ' + r.net + 'net');
      if (form === 'raw file') shows(await w.dbWalletText(r.root, r.fp, r.net, r.steps), root, deriv, net, 'TAPSIGNER ' + shown);
    }
  } catch (e) { fail('TAPSIGNER ' + shown, e); }
  const other = Buffer.from(key); other[randomInt(16)] ^= 1 << randomInt(8);
  await throws(w.tsOpen(u8(ct), hex(other)), /does not open this file/, 'TAPSIGNER ' + shown + ': the key with one bit changed');
}
{
  const root = rndRoot(), key = rb(16), r = await w.tsOpen(u8(tsMake(root, 'm/84h/0h/0h', key, 'future line\nanother\n')), hex(key));
  R.ok(r.fp === fpOf(root) && r.extra === 2, 'TAPSIGNER: further lines (the protocol allows them) are counted, not used (' + r.extra + ')');
}

// ================================================================ 2b. Krux: KEF of every version, made here
const KEF = {   // from the spec (docs .../kef-specifications; src/krux/kef.py): mode, padding, check (+ outside the data, - inside it), compress
  0: ['ecb', 'nul', -16, 0], 1: ['cbc', 'nul', -16, 0], 5: ['ecb', 'nul', 3, 0], 6: ['ecb', 'pkcs', -4, 0], 7: ['ecb', 'pkcs', -4, 1],
  10: ['cbc', 'nul', 4, 0], 11: ['cbc', 'pkcs', -4, 0], 12: ['cbc', 'pkcs', -4, 1], 15: ['ctr', null, -4, 0], 16: ['ctr', null, -4, 1], 20: ['gcm', null, 4, 0], 21: ['gcm', null, 4, 1],
};
const iterOf = (field) => (field <= 10000 ? field * 10000 : field);
function kefMake(version, id, field, password, plain, iv) {
  const [mode, pad, auth, z] = KEF[version], iters = iterOf(field), key = pbkdf2Sync(Buffer.from(password, 'utf8'), id, iters, 32, 'sha256');
  const ivLen = mode === 'cbc' ? 16 : mode === 'ctr' || mode === 'gcm' ? 12 : 0;
  iv = iv || rb(ivLen);
  let p = Buffer.from(z ? deflateRawSync(plain, { windowBits: 10 }) : plain), tail = Buffer.alloc(0), body;
  if (mode !== 'gcm') {
    if (auth > 0) tail = sha(Buffer.of(version), iv, p, key).subarray(0, auth);       // outside: SHA-256(version + IV + data + key)
    else p = Buffer.concat([p, sha(p).subarray(0, -auth)]);                         // inside: SHA-256(data)
  }
  if (pad === 'pkcs') { const n = 16 - (p.length % 16); p = Buffer.concat([p, Buffer.alloc(n, n)]); }
  else if (pad === 'nul') p = Buffer.concat([p, Buffer.alloc((16 - (p.length % 16)) % 16)]);
  if (mode === 'ecb') { const c = createCipheriv('aes-256-ecb', key, null); c.setAutoPadding(false); body = Buffer.concat([c.update(p), c.final()]); }
  else if (mode === 'cbc') { const c = createCipheriv('aes-256-cbc', key, iv); c.setAutoPadding(false); body = Buffer.concat([iv, c.update(p), c.final()]); }
  else if (mode === 'ctr') { const c = createCipheriv('aes-256-ctr', key, Buffer.concat([iv, Buffer.alloc(4)])); body = Buffer.concat([iv, c.update(p), c.final()]); }
  else { const c = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 4 }); body = Buffer.concat([iv, c.update(p), c.final(), c.getAuthTag()]); }   // the tag cut to 4 bytes
  const f = field.toString(16).padStart(6, '0');
  return Buffer.concat([Buffer.of(id.length), id, Buffer.of(version), Buffer.from(f, 'hex'), body, tail]);
}
const B43 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:';
function b43enc(b) {   // Electrum's base43, as Krux's baseconv.py: each leading zero byte becomes a leading "0"
  let n = BigInt('0x0' + Buffer.from(b).toString('hex')), s = ''; while (n > 0n) { s = B43[Number(n % 43n)] + s; n /= 43n; }
  let z = 0; while (z < b.length && b[z] === 0) z++; return '0'.repeat(z) + s;
}
function b32enc(b) { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '', s = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) s += A[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return s + '='.repeat((8 - (s.length % 8)) % 8); }
const asText = (env, form) => form === 'base43' ? b43enc(env) : form === 'hex' ? env.toString('hex') : form === 'base64' ? env.toString('base64') : form === 'base32' ? b32enc(env) : env.toString('hex').toUpperCase();
const rndId = () => pick([() => rb(8).toString('hex'), () => 'seed ' + rb(randomInt(1, 9)).toString('hex'), () => 'Wallet-' + randomInt(1000), () => rb(randomInt(1, 12)), () => 'é ' + randomInt(99)])();
const rndKey = () => pick(['test key', 'correct horse', 'Zq9!x', 'abc', 'with space  and  two', 'ünïcode', rb(6).toString('hex')]);
const noNulTail = (n) => { for (;;) { const e = rb(n); if (e[n - 1] !== 0) return e; } };   // Krux refuses to encrypt data ending in a zero byte with these versions
const FIELDS = [1, 2, 3, 10001, 12345, 104321, 99999];   // 10000s (10 000, 20 000, 30 000 iterations) and raw counts
let made = 0;
for (const version of Object.keys(KEF).map(Number)) {
  for (const len of [16, 32]) {
    const ent = noNulTail(len), words = entropyToMnemonic(ent, wordlist), idRaw = rndId(), id = Buffer.isBuffer(idRaw) ? idRaw : Buffer.from(idRaw), pw = rndKey(), field = pick(FIELDS);
    const env = kefMake(version, id, field, pw, ent), label = 'KEF v' + version + ' (' + KEF[version][0].toUpperCase() + (KEF[version][3] ? ' +compress' : '') + '), ' + len * 8 + '-bit entropy, ' + iterOf(field) + ' iterations, ' + id.length + '-byte ID';
    made++;
    try {
      const form = pick(['base43', 'hex', 'base64', 'HEX']), t = asText(env, form);
      const x = await w.kruxOpen(enc(t), t, pw, false);
      R.ok(x.list[0].mnemonic === words && x.list[0].iters === iterOf(field) && x.list[0].version === 'KEF version ' + version, label + ' as ' + form + ' opens with the right words');
      const f = await w.kruxOpen(u8(env), null, pw, true);
      R.ok(f.list[0].mnemonic === words, label + ' as a raw file opens');
      const wi = Buffer.isBuffer(idRaw) ? null : idRaw;
      if (wi !== null) R.ok(x.list[0].id === wi, label + ': the ID “' + wi.slice(0, 20) + '” is shown');
      else R.ok(x.list[0].id === (() => { try { return new TextDecoder('utf-8', { fatal: true }).decode(id); } catch (e) { return id.toString('hex'); } })(), label + ': the ID is shown (as text, or in hex when it is not text)');
      for (const bad of [pw + 'x', pw.slice(0, -1), pw.toUpperCase() === pw ? pw.toLowerCase() : pw.toUpperCase(), '']) {
        if (bad === pw || !bad) continue;
        const y = await w.kruxOpen(enc(t), t, bad, false);
        if (y.list[0].mnemonic !== null) { R.ok(false, label + ': the wrong key “' + bad + '” gave words'); break; }
      }
      R.ok(true, label + ': wrong keys (one letter more, one less, other capitals) give no words');
      const dam = Buffer.from(env), at = 1 + id.length + 4 + randomInt(env.length - (1 + id.length + 4)); dam[at] ^= 1 << randomInt(8);
      const d = await w.kruxOpen(u8(dam), null, pw, true).catch((e) => e);
      R.ok(d.list && d.list[0].mnemonic === null, label + ': one damaged bit (byte ' + at + ') gives no words');
    } catch (e) { fail(label, e); }
  }
}
R.ok(made === 24, 'Krux: all 12 versions of the spec made here with 16 and 32 bytes of entropy (' + made + ' envelopes)');
// the corner cases of the spec
{
  const ent = rb(16), words = entropyToMnemonic(ent, wordlist);
  const cases = [['an empty ID (len_id 0: Krux wrap() allows it, test_kef.py valid_ids)', Buffer.alloc(0)], ['the longest ID (252 bytes, any bytes)', Buffer.from(Array.from({ length: 252 }, (_, i) => i))], ['an ID of 8 hex characters (a fingerprint, as Krux names them)', Buffer.from(rb(4).toString('hex'))]];
  for (const [what, id] of cases) {
    for (const version of [20, 11, 5]) {
      const e2 = version === 5 ? noNulTail(16) : ent, wd = entropyToMnemonic(e2, wordlist), env = kefMake(version, id, 1, 'k', e2), t = b43enc(env);
      try { const x = await w.kruxOpen(enc(t), t, 'k', false); R.ok(x.list[0].mnemonic === wd, 'Krux KEF v' + version + ' with ' + what + ' opens'); } catch (e) { R.ok(false, 'Krux KEF v' + version + ' with ' + what + ' opens -- “' + e.message.slice(0, 90) + '”'); }
    }
  }
  void words;
  // data that ends in zero bytes (Krux's encrypt refuses these with fail_unsafe, but its decrypt handles them: test_grind_alternate_decryption_key)
  for (const version of [5, 10]) {
    for (const nul of [1, 2]) {
      const e2 = Buffer.concat([rb(16 - nul), Buffer.alloc(nul)]), env = kefMake(version, Buffer.from('nul'), 1, 'k', e2);
      const x = await w.kruxOpen(u8(env), null, 'k', true);
      R.ok(x.list[0].mnemonic === entropyToMnemonic(e2, wordlist), 'Krux KEF v' + version + ': 16 bytes of entropy ending in ' + nul + ' zero byte(s) still opens (the page gives the zeros back one by one)');
    }
  }
  for (const version of [0, 1]) {   // the 16-byte check ends in a zero byte
    let e2, k = 0; do { e2 = rb(16); k++; } while (sha(e2)[15] !== 0 && k < 20000);
    const env = kefMake(version, Buffer.from('nul'), 1, 'k', e2), x = await w.kruxOpen(u8(env), null, 'k', true);
    R.ok(sha(e2)[15] === 0 && x.list[0].mnemonic === entropyToMnemonic(e2, wordlist), 'Krux KEF v' + version + ': a check that ends in a zero byte (found after ' + k + ' tries) still opens');
  }
  // the plaintext Krux itself writes is entropy; the page also reads words as text and SeedQR digits (a larger plaintext, compressed)
  const wd12 = entropyToMnemonic(rb(16), wordlist), digits = wd12.split(' ').map((x) => String(wordlist.indexOf(x)).padStart(4, '0')).join('');
  for (const [what, plain, want] of [['the words as text', Buffer.from(wd12), wd12], ['SeedQR digits', Buffer.from(digits), wd12], ['the words as text, 24 of them', Buffer.from(entropyToMnemonic(rb(32), wordlist)), null]]) {
    for (const version of [11, 12, 21]) {
      const env = kefMake(version, Buffer.from('x'), 1, 'k', plain), x = await w.kruxOpen(u8(env), null, 'k', true);
      R.ok(x.list[0].mnemonic === (want || plain.toString()), 'Krux KEF v' + version + ' holding ' + what + ' opens');
    }
  }
  // the ways to write the same envelope: Krux reads hex, base32, base43 and Base64. A fixed envelope (ID b4ce462263f618, KEF v20, key "k",
  // entropy 00..0f) whose base32 text is ALSO a valid-looking base43 text: about 1 base32 text in 75 is, and the page tries base43 first.
  const envHex = '07b4ce462263f61814000001000000000000000000000068b4d7d01355b231608f483b941417ecec93965c53', b32 = 'A62M4RRCMP3BQFAAAAAQAAAAAAAAAAAAAAAAA2FU27IBGVNSGFQI6SB3SQKBP3HMSOLFYUY=';
  const fixedWords = entropyToMnemonic(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'), wordlist);
  R.ok(b32enc(Buffer.from(envHex, 'hex')) === b32, 'the fixed envelope is that base32 text');
  for (const [form, t] of [['hex', envHex], ['base43', b43enc(Buffer.from(envHex, 'hex'))], ['base64', Buffer.from(envHex, 'hex').toString('base64')], ['base32', b32], ['base32 with spaces', b32.replace(/(.{8})/g, '$1 ')]]) {
    try { const x = await w.kruxOpen(enc(t), t, 'k', false); R.ok(x.list[0].mnemonic === fixedWords, 'Krux envelope as ' + form + ' opens'); } catch (e) { R.ok(false, 'Krux envelope as ' + form + ' opens -- “' + e.message.slice(0, 80) + '”'); }
  }
}
// the older seeds.json entries and mixed files, made here
function legacyEntry(id, version, iters, words, pw) {
  const key = pbkdf2Sync(Buffer.from(pw), Buffer.from(id), iters, 32, 'sha256'), t = Buffer.from(words), p = Buffer.concat([t, Buffer.alloc((16 - (t.length % 16)) % 16)]);
  const iv = rb(16), c = version === 1 ? createCipheriv('aes-256-cbc', key, iv) : createCipheriv('aes-256-ecb', key, null); c.setAutoPadding(false);
  const body = Buffer.concat([c.update(p), c.final()]);
  return { version, key_iterations: iters, data: (version === 1 ? Buffer.concat([iv, body]) : body).toString('base64') };
}
{
  const m1 = entropyToMnemonic(rb(16), wordlist), m2 = entropyToMnemonic(rb(32), wordlist), e3 = rb(16), m3 = entropyToMnemonic(e3, wordlist);
  const j = { 'old ecb': legacyEntry('old ecb', 0, 12000, m1, 'k1'), 'old cbc': legacyEntry('old cbc', 1, 15000, m2, 'k1'), 'kef one': { b64_kef: kefMake(20, Buffer.from('kef one'), 2, 'k1', e3).toString('base64') }, 'other key': legacyEntry('other key', 1, 11000, m1, 'k2'), 'junk': 5, 'half': { version: 1 } };
  const text = JSON.stringify(j) + ' '.repeat(40);   // Krux pads the file with spaces when it writes a shorter one over a longer
  const x = await w.kruxOpen(enc(text), text, 'k1', true);
  const by = Object.fromEntries(x.list.map((y) => [y.id, y.mnemonic]));
  R.ok(x.list.filter((y) => !y.bad).length === 4 && by['old ecb'] === m1 && by['old cbc'] === m2 && by['kef one'] === m3 && by['other key'] === null, 'Krux seeds.json made here: an older ECB entry, an older CBC entry and a KEF entry open with one key; the entry of another key and the junk ones do not (' + x.list.length + ' entries listed)');
  const y = await w.kruxOpen(enc(text), text, 'k2', true);
  R.ok(y.list.filter((z) => z.mnemonic).length === 1 && y.list.find((z) => z.id === 'other key').mnemonic === m1, 'Krux seeds.json: the other key opens only its own entry');
  const iters = Object.fromEntries(x.list.map((z) => [z.id, z.iters])); R.ok(iters['old ecb'] === 12000 && iters['kef one'] === 20000, 'Krux seeds.json: the iteration counts are shown (' + JSON.stringify(iters) + ')');
}

// ================================================================ 2c. Coldcard: 7z files made here (layout of Coldcard's shared/compat7z.py)
const var64 = (n) => { if (n < 127) return Buffer.of(n); if (n < 65536) { const b = Buffer.alloc(3); b[0] = 0xc0; b.writeUInt16LE(n, 1); return b; } if (n < 2 ** 32) { const b = Buffer.alloc(5); b[0] = 0xf0; b.writeUInt32LE(n, 1); return b; } const b = Buffer.alloc(9); b[0] = 0xff; b.writeBigUInt64LE(BigInt(n), 1); return b; };
const utf16 = (s) => Buffer.from(s, 'utf16le');
function cc7zKey(salt, password, pow) {
  const h = createHash('sha256'), pw = utf16(password), ctr = Buffer.alloc(8);
  for (let i = 0; i < 2 ** pow; i++) { ctr.writeBigUInt64LE(BigInt(i)); h.update(salt); h.update(pw); h.update(ctr); }   // 7zAes.cpp CalculateDigest, as compat7z.py calculate_key
  return h.digest();
}
// o: {pow, coders: 'aes'|'lzma'|'two', header: 'plain'|'encoded', fname, props (to override)}
function cc7z(text, password, o = {}) {
  const pow = o.pow ?? 13, salt = rb(16), iv = rb(16), pt = Buffer.from(text), padded = Buffer.concat([pt, Buffer.alloc((16 - (pt.length % 16)) % 16)]);
  const key = o.pow === undefined || pow <= 19 ? cc7zKey(salt, password, pow) : rb(32);
  const c = createCipheriv('aes-256-cbc', key, iv); c.setAutoPadding(false); const body = Buffer.concat([c.update(padded), c.final()]);
  const props = o.props || Buffer.concat([Buffer.of((pow & 0x3f) | 0xc0, 0xff), salt, iv]);
  const B = (s) => Buffer.from(s.replace(/ /g, ''), 'hex'), fname = utf16((o.fname || 'backup.txt') + '\0');
  let coder = Buffer.concat([B('24 06 f1 07 01'), var64(props.length), props]);
  if (o.coders === 'lzma') coder = Buffer.concat([B('23 03 01 01'), var64(5), B('5d 00 00 10 00')]);   // LZMA: a compressed 7z
  let head = Buffer.concat([B('01 04 06 00 01 09'), var64(body.length), B('00'), B('07 0b 01 00'), o.coders === 'two' ? Buffer.concat([B('02'), coder, B('24 06 f1 07 01'), var64(props.length), props]) : B('01 ' ) , o.coders === 'two' ? B('') : coder,
    B('01 00 0c'), var64(pt.length), B('00'), B('08 0a 01'), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(crc32(pt)); return b; })(), B('00 00'), B('05 01 11'), var64(fname.length + 1), B('00'), fname, B('00 00')]);
  if (o.header === 'encoded') head = Buffer.concat([B('17'), rb(40)]);   // an "encoded header" (a compressed header): a Coldcard never writes it
  const sect = Buffer.alloc(20); sect.writeBigUInt64LE(BigInt(body.length), 0); sect.writeBigUInt64LE(BigInt(head.length), 8); sect.writeUInt32LE(crc32(head), 16);
  const start = Buffer.alloc(12); Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 3]).copy(start); start.writeUInt32LE(crc32(sect), 8);
  return Buffer.concat([start, sect, body, head]);
}
const ccText = (o) => ['# Coldcard backup file! DO NOT CHANGE.', '', '# Private key details' + (o.chain === 'XTN' ? ': Testnet' : ''),
  o.mnemonic ? 'mnemonic = ' + JSON.stringify(o.mnemonic) : '', o.chain ? 'chain = ' + JSON.stringify(o.chain) : '', o.xprv ? 'xprv = ' + JSON.stringify(o.xprv) : '', 'raw_secret = ' + JSON.stringify(o.raw), '',
  '# Firmware version (informational)', 'fw_date = "2026-09-30"', 'fw_version = "' + (o.fw || '5.6.3') + '"', 'hardware = "' + (o.hw || 'mk4') + '"', 'serial = "F1F1F1F1F1F1"', '', '# User preferences', 'setting.terms_ok = 1',
  ...(o.extra || []), '', '# EOF', ''].filter((x, i, a) => x !== '' || a[i - 1] !== '' || i === 0).join('\n');
const cc12 = () => entropyToMnemonic(rb(16), wordlist).split(' ').join(' ');
const ccPw = () => Array.from({ length: 12 }, () => wordlist[randomInt(2048)]).join(' ');
const ccUi = async (bytes, name, pw, kind = 'cc') => {   // through the page's boxes
  $('dbKind').value = kind; $('dbIn').value = ''; $('dbKey').value = pw; Object.defineProperty($('dbFile'), 'files', { value: [fileOf(name, bytes)], configurable: true });
  await w.dbOpenUi(); const r = { cls: $('dbStatus').className, st: $('dbStatus').textContent, out: $('dbOut').textContent };
  w.dbReveal(); r.secret = $('dbSecret').textContent; w.dbClear(); delete $('dbFile').files; return r;
};
const CCCASES = [
  { name: '12 words', mk: () => { const e = rb(16), mn = entropyToMnemonic(e, wordlist); return { mn, raw: '80' + hex(e), root: rootOfWords(mn), words: mn }; } },
  { name: '24 words, a raw_secret padded to 72 bytes', mk: () => { const e = rb(32), mn = entropyToMnemonic(e, wordlist); return { mn, raw: ('82' + hex(e)).padEnd(144, '0'), root: rootOfWords(mn), words: mn }; } },
  { name: '18 words', mk: () => { const e = rb(24), mn = entropyToMnemonic(e, wordlist); return { mn, raw: '81' + hex(e), root: rootOfWords(mn), words: mn }; } },
  { name: '12 words on testnet (chain XTN)', chain: 'XTN', net: 'test', mk: () => { const e = rb(16), mn = entropyToMnemonic(e, wordlist); return { mn, raw: '80' + hex(e), root: rootOfWords(mn, 'test'), words: mn }; } },
  { name: 'a seed vault and duress wallets (also holds)', extra: ['setting.seeds = [1]', 'duress_xprv_1 = "x"', 'setting.multisig = [1]', 'setting.notes = "n"'], mk: () => { const e = rb(16), mn = entropyToMnemonic(e, wordlist); return { mn, raw: '80' + hex(e), root: rootOfWords(mn), words: mn }; } },
];
for (const cs of CCCASES) {
  const s = cs.mk(), net = cs.net || 'main', pw = ccPw(), coin = net === 'test' ? 1 : 0, text = ccText({ mnemonic: s.mn, raw: s.raw, chain: cs.chain || 'BTC', xprv: s.root.privateExtendedKey, extra: cs.extra }), file = cc7z(text, pw);
  const label = 'Coldcard ' + cs.name;
  try {
    const x = await w.ccOpen(u8(file), pw, 'backup-2026.7z');
    R.ok(x.mnemonic === s.words && x.net === net && /mk4 5\.6\.3/.test(x.fw), label + ': words, network and firmware read (' + x.mnemonic.split(' ').length + ' words, ' + x.net + ', ' + x.fw + ')');
    if (cs.extra) R.ok(['multisig wallet setups', 'a seed vault', 'duress (decoy) wallets', 'secure notes'].every((k) => x.also.includes(k)), label + ': it says what else the backup holds (' + x.also.join(', ') + ')');
    const r = await ccUi(u8(file), 'backup-2026.7z', pw);
    R.ok(r.cls === 'status ok', label + ' in the page: ' + r.st);
    shows(r.out, s.root, "m/84'/" + coin + "'/0'", net, label + ' in the page');
    R.ok(net === 'test' ? /TESTNET/.test(r.out) && /tb1q/.test(r.out) : /bc1q/.test(r.out) && !/TESTNET/.test(r.out), label + ': the page says which network');
    R.ok(r.secret.includes('SEED WORDS') && wordsOf(r.secret) === s.words, label + ': SHOW THE SECRET gives the words');
    if (cs.extra) R.ok(/It also holds .*seed vault.*duress.*notes|It also holds/.test(r.out), label + ': the page lists what else it holds');
  } catch (e) { fail(label, e); }
  await throws(w.ccOpen(u8(file), ccPw(), 'b.7z'), /do not open/, label + ': another 12 words');
}
{   // xprv only (0x01), raw seeds, a custom password, other numbers of key rounds
  const root = rndRoot(), raw = '01' + hex(root.chainCode) + hex(root.privateKey), pw = ccPw();
  const file = cc7z(ccText({ raw, xprv: root.privateExtendedKey, chain: 'BTC' }), pw), x = await w.ccOpen(u8(file), pw, 'x.7z');
  R.ok(x.xprvOnly === true && !x.mnemonic && hex(x.root[1]) === hex(root.chainCode), 'Coldcard: an xprv-only record (0x01) is read as a key, not as words');
  const r = await ccUi(u8(file), 'x.7z', pw);
  shows(r.out, root, "m/84'/0'/0'", 'main', 'Coldcard xprv-only in the page');
  R.ok(r.secret.includes(root.privateExtendedKey) && /MASTER PRIVATE KEY/.test(r.secret) && /passphrase wallet or an imported xprv/.test(r.out), 'Coldcard xprv-only: SHOW THE SECRET gives the xprv (' + root.privateExtendedKey.slice(0, 8) + '...) and the page explains it is not words');
  const rootT = rndRoot('test'), fileT = cc7z(ccText({ raw: '01' + hex(rootT.chainCode) + hex(rootT.privateKey), chain: 'XTN' }), pw), rt = await ccUi(u8(fileT), 't.7z', pw);
  shows(rt.out, rootT, "m/84'/1'/0'", 'test', 'Coldcard xprv-only on testnet in the page');
  R.ok(rt.secret.includes(rootT.privateExtendedKey) && rootT.privateExtendedKey.startsWith('tprv'), 'Coldcard xprv-only on testnet: the secret is the tprv');
  for (const n of [16, 32, 64]) {
    const seed = rb(n), rs = hex(Buffer.of(n)) + hex(seed), f2 = cc7z(ccText({ raw: rs, chain: 'BTC' }), pw), ro = HDKey.fromMasterSeed(seed), rr = await ccUi(u8(f2), 'seed.7z', pw);
    shows(rr.out, ro, "m/84'/0'/0'", 'main', 'Coldcard raw ' + n * 8 + '-bit seed in the page');
    R.ok(rr.secret.includes(hex(seed)) && new RegExp('raw ' + n * 8 + '-bit master seed').test(rr.out), 'Coldcard raw ' + n * 8 + '-bit seed: the secret is the seed in hex, and the page says it is not words');
  }
  const custom = rb(30).toString('base64').slice(0, 40).replace(/=/g, 'x') + '!', e = rb(32), mn = entropyToMnemonic(e, wordlist);
  const cf = cc7z(ccText({ mnemonic: mn, raw: '82' + hex(e), chain: 'BTC' }), custom);
  R.ok(custom.length === 41 && (await w.ccOpen(u8(cf), custom, 'c.7z')).mnemonic === mn, 'Coldcard: a custom 41-character backup password opens it, used exactly as typed');
  await throws(w.ccOpen(u8(cf), custom.toLowerCase().replace(/[^a-z0-9]/g, '') + '!', 'c.7z'), /do not open/, 'Coldcard: the custom password in other capitals');
  R.ok((await w.ccOpen(u8(cc7z(ccText({ mnemonic: mn, raw: '82' + hex(e) }), 'Пароль-é-💥-' + 'x'.repeat(20))), 'Пароль-é-💥-' + 'x'.repeat(20), 'c.7z')).mnemonic === mn, 'Coldcard: a custom password with non-ASCII characters (UTF-16LE) opens it');
  for (const pow of [0, 10, 16]) { const e4 = rb(16), m4 = entropyToMnemonic(e4, wordlist), f4 = cc7z(ccText({ mnemonic: m4, raw: '80' + hex(e4) }), pw, { pow }); R.ok((await w.ccOpen(u8(f4), pw, 'p.7z')).mnemonic === m4, 'Coldcard: 2^' + pow + ' key rounds (Coldcard writes 13; the page reads up to 19)'); }
  { const e4 = rb(16), m4 = entropyToMnemonic(e4, wordlist), t0 = Date.now(), f4 = cc7z(ccText({ mnemonic: m4, raw: '80' + hex(e4) }), pw, { pow: 19 }); R.ok((await w.ccOpen(u8(f4), pw, 'p.7z')).mnemonic === m4, 'Coldcard: 2^19 key rounds, the most the Coldcard reads (' + (Date.now() - t0) + ' ms)'); }
  const dec = ccText({ mnemonic: mn, raw: '82' + hex(e), chain: 'BTC' });
  R.ok((await w.ccOpen(enc(dec), '', 'backup.txt')).mnemonic === mn, 'Coldcard: a backup already opened by 7-Zip (the plain text file) is read without a password');
  R.ok((await w.ccOpen(u8(cc7z(dec, pw, { fname: 'ñandú backup.txt' })), pw, 'a.7z')).mnemonic === mn, 'Coldcard: a file name inside that is not plain ASCII does not matter');
}

// ================================================================ 3. Refusals
{
  const e = rb(16), mn = entropyToMnemonic(e, wordlist), pw = ccPw(), good = ccText({ mnemonic: mn, raw: '80' + hex(e), chain: 'BTC' }), file = cc7z(good, pw);
  // wrong key, each format (more are above: each KEF version, each file)
  await throws(w.tsOpen(u8(tsMake(rndRoot(), 'm/84h/0h/0h', rb(16))), rb(16).toString('hex')), /does not open this file/, 'TAPSIGNER: a wrong key');
  await throws(w.tsOpen(u8(tsCt), '4141414141414141414141414141414'), /32 characters/, 'TAPSIGNER: a key of 31 characters');
  await throws(w.tsOpen(u8(tsCt), '4141414141414141414141414141414g'), /32 characters/, 'TAPSIGNER: a key with a letter that is not hex');
  await throws(w.tsOpen(u8(tsCt), ''), /32 characters/, 'TAPSIGNER: no key');
  await throws(w.kruxOpen(enc(b43enc(kefMake(20, Buffer.from('a'), 1, 'k', rb(16)))), b43enc(kefMake(20, Buffer.from('a'), 1, 'k', rb(16))), '', false), /Type the key/, 'Krux: no key typed');
  await throws(w.ccOpen(u8(file), ccPw(), 'x.7z'), /These words \(or this custom backup password\) do not open this backup/, 'Coldcard: wrong words');
  // not a backup
  await throws(w.tsOpen(rb(50), '41'.repeat(16)), /not a TAPSIGNER backup: it is 50 bytes/, 'TAPSIGNER: a file of 50 bytes');
  await throws(w.tsOpen(rb(5000), '41'.repeat(16)), /not a TAPSIGNER backup: it is 5000 bytes/, 'TAPSIGNER: a file of 5000 bytes');
  await throws(w.tsOpen(rb(130), '41'.repeat(16)), /does not open this file.*not a TAPSIGNER backup/, 'TAPSIGNER: 130 random bytes');
  await throws(w.tsOpen(enc('#!/bin/sh\nbase64 -d <<END-OF-DATA | openssl\nEND-OF-DATA'), '41'.repeat(16)), /no data between its END-OF-DATA lines/, 'TAPSIGNER: a .sh file with no data');
  await throws(w.tsOpen(enc('echo END-OF-DATA\n!!notbase64!!\n'), '41'.repeat(16)), /no data|Base64/, 'TAPSIGNER: a .sh file with text that is not Base64');
  await throws(w.tsOpen(u8(createCipheriv('aes-128-ctr', Buffer.alloc(16, 0x41), Buffer.alloc(16)).update(Buffer.from('hello '.repeat(30)))), '41'.repeat(16)), /does not open this file/, 'TAPSIGNER: the right key but text that is no xprv');
  { const root = rndRoot(); await throws(w.tsOpen(u8(tsMake(root, 'not a path', Buffer.alloc(16, 0x41))), '41'.repeat(16)), /path line.*is not a path/, 'TAPSIGNER: the xprv is fine but the path line is not a path'); }
  for (const t of ['hello world', 'W:3VXG.PEBY2QI2S5JAQML', 'not an envelope at all, with words', '{}', '00', '']) {
    try { await w.kruxOpen(enc(t), t, 'k', false); R.ok(false, 'Krux: “' + t + '” is refused'); } catch (x) { R.ok(/not a Krux encrypted seed|No encrypted seed|Type the key/.test(x.message), 'Krux: the text “' + t.slice(0, 30) + '” is refused: “' + x.message.slice(0, 70) + '”'); }
  }
  await throws(w.kruxOpen(enc('{"a": 1,'), '{"a": 1,', 'k', true), /not valid JSON/, 'Krux: a seeds.json that is cut off');
  await throws(w.kruxOpen(enc('{"a": {"version": 3, "key_iterations": 5, "data": "AAAA"}}'), '{"a": {"version": 3, "key_iterations": 5, "data": "AAAA"}}', 'k', true), /No encrypted seed was found/, 'Krux: a seeds.json with no entry the page can read');
  await throws(w.kruxOpen(rb(60), null, 'k', true), /not a Krux encrypted seed/, 'Krux: a file of random bytes');
  { const t = b43enc(Buffer.concat([Buffer.of(3), Buffer.from('abc'), Buffer.of(99), Buffer.from('000001', 'hex'), rb(40)])); await throws(w.kruxOpen(enc(t), t, 'k', false), /not a Krux encrypted seed/, 'Krux: an envelope with an unknown version (99)'); }
  { const env = kefMake(20, Buffer.from('abc'), 1, 'k', rb(16)); env.writeUIntBE(0, 5, 3); const t = b43enc(env); await throws(w.kruxOpen(enc(t), t, 'k', false), /not a Krux encrypted seed/, 'Krux: an envelope that asks for 0 iterations (Krux refuses it too: a trivial work factor)'); }
  { const env = kefMake(11, Buffer.from('abc'), 1, 'k', rb(16)), cut = env.subarray(0, env.length - 3), t = b43enc(cut); await throws(w.kruxOpen(enc(t), t, 'k', false), /not a Krux encrypted seed/, 'Krux: a CBC envelope cut by 3 bytes (not whole blocks)'); }
  // Coldcard
  const clone = '03' + rb(32).toString('hex') + '-ccbk.7z';
  await throws(w.ccOpen(u8(file), pw, clone), /Coldcard clone file/, 'Coldcard: a clone file name (66 hex characters and -ccbk.7z)');
  await throws(w.ccOpen(u8(file), pw, clone.toUpperCase().replace('-CCBK.7Z', '-ccbk.7z')), /Coldcard clone file/, 'Coldcard: a clone file name in capitals');
  R.ok((await w.ccOpen(u8(file), pw, '03' + rb(31).toString('hex') + '-ccbk.7z')).mnemonic === mn, 'Coldcard: a name that is not 66 hex characters + -ccbk.7z is not taken for a clone file');
  await throws(w.ccOpen(rb(300), pw, 'x.7z'), /not a Coldcard backup: Coldcard backups are \.7z files/, 'Coldcard: a file that is not a 7z');
  await throws(w.ccOpen(enc('hello'), pw, 'x.7z'), /not a Coldcard backup/, 'Coldcard: a text file');
  await throws(w.ccOpen(Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]), rb(60)]), pw, 'x.7z'), /not a Coldcard backup: .*damaged|not a Coldcard backup/, '7z signature then random bytes');
  await throws(w.ccOpen(cc7z(good, pw, { coders: 'lzma' }), pw, 'x.7z'), /not a Coldcard backup: it is not encrypted with 7-Zip's AES \(coder 030101\)/, 'Coldcard: a 7z with an LZMA coder (compressed)');
  await throws(w.ccOpen(cc7z(good, pw, { coders: 'two' }), pw, 'x.7z'), /not a Coldcard backup: it uses more than one coder, so it is compressed/, 'Coldcard: a 7z with two coders (compression plus AES)');
  await throws(w.ccOpen(cc7z(good, pw, { header: 'encoded' }), pw, 'x.7z'), /not a Coldcard backup: its header is compressed or encrypted, which a Coldcard never writes/, 'Coldcard: a 7z with an encoded header (0x17)');
  await throws(w.ccOpen(cc7z(good, pw, { pow: 20 }), pw, 'x.7z'), /asks for 2\^20 key rounds; a Coldcard writes 2\^13 and reads at most 2\^19/, 'Coldcard: 2^20 key rounds');
  await throws(w.ccOpen(cc7z(good, pw, { pow: 63, props: Buffer.concat([Buffer.of(0x3f | 0xc0, 0xff), rb(32)]) }), pw, 'x.7z'), /no-hash key mode/, 'Coldcard: 7-Zip\'s no-hash mode (2^63)');
  await throws(w.ccOpen(cc7z(good, pw, { pow: 40, props: Buffer.concat([Buffer.of(40 | 0xc0, 0xff), rb(32)]) }), pw, 'x.7z'), /2\^40 key rounds/, 'Coldcard: 2^40 key rounds');
  await throws(w.ccOpen(file.subarray(0, file.length - 12), pw, 'x.7z'), /not a Coldcard backup: the file is cut short/, 'Coldcard: a file with its last 12 bytes cut off');
  await throws(w.ccOpen(file.subarray(0, 200), pw, 'x.7z'), /cut short/, 'Coldcard: a file cut to 200 bytes');
  await throws(w.ccOpen(file.subarray(0, 31), pw, 'x.7z'), /not a Coldcard backup/, 'Coldcard: a file cut inside its start header (31 bytes)');
  { const f = Buffer.from(file); f[13] ^= 1; await throws(w.ccOpen(f, pw, 'x.7z'), /start header is damaged/, 'Coldcard: a damaged start header'); }
  { const f = Buffer.from(file); f[f.length - 5] ^= 1; await throws(w.ccOpen(f, pw, 'x.7z'), /header is damaged \(CRC does not match\)/, 'Coldcard: a damaged trailing header'); }
  { const f = Buffer.from(file); f[40] ^= 1; await throws(w.ccOpen(f, pw, 'x.7z'), /do not open this backup, or the file is damaged/, 'Coldcard: a damaged byte in the encrypted data'); }
  // the words in the text and the seed record must agree
  const other = entropyToMnemonic(rb(16), wordlist), lie = cc7z(ccText({ mnemonic: other, raw: '80' + hex(e), chain: 'BTC' }), pw);
  await throws(w.ccOpen(u8(lie), pw, 'x.7z'), /its words and its seed record disagree: the backup is damaged/, 'Coldcard: a backup whose mnemonic line disagrees with raw_secret');
  { const r = await ccUi(u8(lie), 'x.7z', pw); R.ok(r.cls === 'status bad' && /disagree/.test(r.st) && r.out === '' && r.secret === '', 'Coldcard disagreeing words: in the page, an error and nothing else shown'); }
  await throws(w.ccOpen(u8(cc7z(ccText({ raw: '00' }), pw)), pw, 'x.7z'), /seed record is of a kind this page does not know \(0\)/, 'Coldcard: a seed record of a kind the page does not know');
  await throws(w.ccOpen(u8(cc7z(ccText({ raw: '01' + 'ff'.repeat(64) }), pw)), pw, 'x.7z'), /Its key is not valid/, 'Coldcard: an xprv-only record whose key is above the curve order');
  await throws(w.ccOpen(u8(cc7z('hello, this is not a backup', pw)), pw, 'x.7z'), /not a Coldcard backup text/, 'Coldcard: a 7z that opens but holds some other text');
  await throws(w.ccOpen(u8(cc7z('# Coldcard backup file! DO NOT CHANGE.\n# nothing\n', pw)), pw, 'x.7z'), /no seed record \(raw_secret\)/, 'Coldcard: a backup text with no raw_secret');
}

// ================================================================ 4. The page's boxes
const open = async ({ kind, text = '', file = null, key = '' }) => {
  $('dbKind').value = kind; $('dbIn').value = text; $('dbKey').value = key;
  if (file) Object.defineProperty($('dbFile'), 'files', { value: [file], configurable: true }); else delete $('dbFile').files;
  const before = $('dbStatus').textContent = 'before', p = w.dbOpenUi();
  await p; R.ok($('dbStatus').textContent !== before, 'dbStatus changed from its old text to “' + $('dbStatus').textContent.slice(0, 60).replace(/\n/g, ' / ') + '”');
  return { cls: $('dbStatus').className, st: $('dbStatus').textContent, out: $('dbOut').textContent, outShown: $('dbOut').style.display !== 'none', secret: $('dbSecret').textContent, secretShown: $('dbSecret').style.display !== 'none', row: $('dbSecretRow').style.display !== 'none', useBtn: $('dbUseBtn').style.display !== 'none' };
};
{
  const root = rndRoot(), key = rb(16), ct = tsMake(root, 'm/86h/0h/0h', key), sh = tsSh(ct);
  // TAPSIGNER .sh typed into the text box, the key typed with dashes and capitals
  const keyTyped = hex(key).toUpperCase().match(/.{4}/g).join('-');
  let r = await open({ kind: 'ts', text: sh, key: keyTyped });
  R.ok(r.cls === 'status ok' && /^TAPSIGNER backup opened/.test(r.st), 'UI TAPSIGNER (.sh text, key “' + keyTyped.slice(0, 14) + '...”): opened');
  shows(r.out, root, "m/86'/0'/0'", 'main', 'UI TAPSIGNER');
  R.ok(/Taproot/.test(r.out) && /m\/86h\/0h\/0h/.test(r.out) && /bc1p/.test(r.out) && /emergencies only/.test(r.out), 'UI TAPSIGNER: it names the Taproot path m/86h/0h/0h and warns the card key is for emergencies');
  R.ok(r.outShown && r.row && r.secret === '' && !r.secretShown, 'UI TAPSIGNER: the secret is not shown before SHOW THE SECRET (dbSecret is empty)');
  R.ok(r.useBtn === false, 'UI TAPSIGNER: no USE THESE WORDS button (a TAPSIGNER backup holds a key, not words)');
  w.dbReveal(); R.ok($('dbSecret').textContent.includes(root.privateExtendedKey) && $('dbShowBtn').textContent === 'HIDE THE SECRET', 'UI TAPSIGNER: dbReveal() shows the xprv');
  w.dbReveal(); R.ok($('dbSecret').textContent === '' && $('dbSecret').style.display === 'none' && $('dbShowBtn').textContent === 'SHOW THE SECRET', 'UI TAPSIGNER: dbReveal() again hides it and empties dbSecret');
  $('phrase').value = 'untouched'; w.dbUseWords(); R.ok($('phrase').value === 'untouched', 'UI TAPSIGNER: dbUseWords() does nothing (no words)'); $('phrase').value = '';
  w.dbClear();
  R.ok($('dbIn').value === '' && $('dbKey').value === '' && $('dbOut').textContent === '' && $('dbSecret').textContent === '' && $('dbStatus').textContent === '' && $('dbOut').style.display === 'none' && $('dbSecretRow').style.display === 'none', 'UI: CLEAR (dbClear) empties dbIn, dbKey, dbOut, dbSecret and the status');
  // TAPSIGNER from a file; wrong key
  r = await open({ kind: 'ts', file: fileOf('backup.aes', ct), key: '00'.repeat(16) });
  R.ok(r.cls === 'status bad' && /does not open this file/.test(r.st) && r.out === '' && !r.outShown && !r.row, 'UI TAPSIGNER: a wrong key says so and shows nothing');
  r = await open({ kind: 'ts', file: fileOf('backup.aes', ct), key: hex(key) });
  R.ok(r.cls === 'status ok', 'UI TAPSIGNER: a .aes file opens'); shows(r.out, root, "m/86'/0'/0'", 'main', 'UI TAPSIGNER file'); w.dbClear(); delete $('dbFile').files;
  // Krux QR text in the text box, then USE THESE WORDS
  const v = KX.kef_qr_vectors[5];
  r = await open({ kind: 'krux', text: v.qr_text_base43, key: 'test key' });
  R.ok(r.cls === 'status ok' && /KEF version 20/.test(r.st) && /ID “test ID”/.test(r.st) && /100000 iterations: opened/.test(r.st), 'UI Krux (base43 text): ' + r.st);
  shows(r.out, rootOfWords(v.expected_mnemonic), "m/84'/0'/0'", 'main', 'UI Krux');
  R.ok(r.secret === '' && r.useBtn && r.row, 'UI Krux: dbSecret empty until SHOW THE SECRET; USE THESE WORDS offered');
  R.ok(/no passphrase/.test(r.out), 'UI Krux: it says the words are shown with no passphrase');
  w.dbReveal(); R.ok(wordsOf($('dbSecret').textContent) === v.expected_mnemonic, 'UI Krux: dbReveal() shows the 12 words');
  $('phrase').value = ''; w.dbUseWords();
  R.ok($('phrase').value === v.expected_mnemonic, 'UI Krux: dbUseWords() puts the words in the main phrase box (#phrase)');
  $('phrase').value = ''; w.dbClear(); R.ok($('dbSecret').textContent === '' && $('dbOut').textContent === '', 'UI Krux: CLEAR');
  w.dbUseWords(); R.ok($('phrase').value === '', 'UI Krux: after CLEAR, dbUseWords() puts nothing in #phrase');
  r = await open({ kind: 'krux', text: v.qr_text_base43, key: 'Test key' });
  R.ok(r.cls === 'status bad' && /does not open it|does not open this seed/.test(r.st) && /Check the key \(capitals, spaces\)/.test(r.st) && r.out === '', 'UI Krux: a wrong key: “' + r.st.replace(/\n+/g, ' / ').slice(0, 120) + '”');
  // Krux seeds.json as a file with two entries; the ID is the fingerprint, as Krux sets it by default
  const e1 = rb(16), m1 = entropyToMnemonic(e1, wordlist), fp1 = fpOf(rootOfWords(m1)), e2 = rb(32), m2 = entropyToMnemonic(e2, wordlist);
  const sj = JSON.stringify({ [fp1]: { b64_kef: kefMake(20, Buffer.from(fp1), 5, 'pass phrase', e1).toString('base64') }, 'second': legacyEntry('second', 1, 10001, m2, 'pass phrase') });
  r = await open({ kind: 'krux', file: fileOf('seeds.json', enc(sj)), key: 'pass phrase' });
  R.ok(r.cls === 'status ok' && r.st.split('\n').length === 2 && /50000 iterations: opened/.test(r.st) && /seeds.json version 1 \(older\)/.test(r.st), 'UI Krux seeds.json: both entries are listed: ' + r.st.replace(/\n/g, ' / ').slice(0, 130));
  shows(r.out, rootOfWords(m1), "m/84'/0'/0'", 'main', 'UI Krux seeds.json');
  R.ok(/The ID is these words' fingerprint, as Krux sets by default: the right seed/.test(r.out) && /holds 2 seeds this key opens; the first is shown/.test(r.out), 'UI Krux seeds.json: the ID matches the fingerprint, and it says 2 seeds open');
  w.dbClear(); delete $('dbFile').files;
  const sj2 = JSON.stringify({ '00000000': { b64_kef: kefMake(20, Buffer.from('00000000'), 1, 'k', e1).toString('base64') } });
  r = await open({ kind: 'krux', text: sj2, key: 'k' });
  R.ok(r.cls === 'status ok' && /is not these words' fingerprint/.test(r.out) && r.out.includes(fp1), 'UI Krux: an 8-hex-digit ID that is not the fingerprint is pointed out'); w.dbClear();
  // Coldcard official file: words typed as people type them
  const c0 = CC[1], c0b = u8(Buffer.from(c0.base64, 'base64')), c0m = /^mnemonic = "(.*)"$/m.exec(c0.plaintext)[1];
  r = await open({ kind: 'cc', file: fileOf('backup.7z', c0b), key: c0.password.toUpperCase() });
  R.ok(r.cls === 'status ok' && /Coldcard backup opened/.test(r.st), 'UI Coldcard (testing/data, a real backup): ' + r.st);
  shows(r.out, rootOfWords(c0m), "m/84'/0'/0'", 'main', 'UI Coldcard testing/data backup');
  R.ok(r.secret === '' && r.useBtn, 'UI Coldcard: dbSecret empty until SHOW THE SECRET; USE THESE WORDS offered');
  w.dbReveal(); R.ok(wordsOf($('dbSecret').textContent) === c0m, 'UI Coldcard: dbReveal() shows the 24 words');
  $('phrase').value = ''; w.dbUseWords(); R.ok($('phrase').value === c0m && c0m.split(' ').length === 24, 'UI Coldcard: dbUseWords() fills #phrase with the 24 words');
  // a clone file name through the page
  r = await open({ kind: 'cc', file: fileOf('03' + rb(32).toString('hex') + '-ccbk.7z', c0b), key: c0.password });
  R.ok(r.cls === 'status bad' && /Coldcard clone file/.test(r.st) && r.out === '' && !r.row, 'UI Coldcard: a clone file (66 hex + -ccbk.7z) is refused with the reason');
  // a file that is no backup, a file that is too big, nothing given, the kind changed
  r = await open({ kind: 'cc', file: fileOf('photo.7z', rb(500)), key: 'x' });
  R.ok(r.cls === 'status bad' && /not a Coldcard backup/.test(r.st), 'UI Coldcard: a file that is not a backup: “' + r.st.slice(0, 80) + '”');
  r = await open({ kind: 'ts', file: fileOf('big.aes', new Uint8Array(1048577)), key: '41'.repeat(16) });
  R.ok(r.cls === 'status bad' && /too big to be a device backup/.test(r.st), 'UI: a file over 1 MB is refused');
  r = await open({ kind: 'ts', key: '41'.repeat(16) });
  R.ok(/Choose the backup file, or paste it as text/.test(r.st), 'UI: nothing chosen or pasted says so');
  r = await open({ kind: 'krux', text: v.qr_text_base43, key: 'test key' });
  $('dbKind').value = 'cc'; $('dbKind').dispatchEvent(new w.Event('change'));
  R.ok($('dbOut').textContent === '' && $('dbSecret').textContent === '' && $('dbStatus').textContent === '', 'UI: changing the kind wipes the old result');
  r = await open({ kind: 'cc', text: 'text that is not a backup', key: 'x' });
  R.ok(r.cls === 'status bad' && /not a Coldcard backup/.test(r.st), 'UI Coldcard: pasted text that is not a backup is refused');
  w.dbClear();
  // CLEAR during the opening: the late result must not appear
  $('dbKind').value = 'krux'; $('dbIn').value = KX.kef_qr_vectors[0].qr_text_base43; $('dbKey').value = 'test key';
  const pending = w.dbOpenUi(); w.dbClear(); await pending;
  R.ok($('dbOut').textContent === '' && $('dbSecret').textContent === '' && $('dbStatus').textContent === '' && $('dbSecretRow').style.display === 'none', 'UI: pressing CLEAR while a backup is still opening: the late result is dropped');
  // CLEAR ALL
  r = await open({ kind: 'krux', text: v.qr_text_base43, key: 'test key' }); w.dbReveal();
  R.ok($('dbIn').value !== '' && $('dbKey').value !== '' && $('dbOut').textContent !== '' && $('dbSecret').textContent !== '', 'UI: before CLEAR ALL the boxes, the result and the revealed secret are there');
  w.confirm = () => true; w.clearAll();
  R.ok($('dbIn').value === '' && $('dbKey').value === '' && $('dbOut').textContent === '' && $('dbSecret').textContent === '' && $('dbStatus').textContent === '' && $('dbSecretRow').style.display === 'none' && $('dbSecret').style.display === 'none', 'UI: CLEAR ALL (clearAll) wipes dbIn, dbKey, dbOut, dbSecret and the status');
  w.dbUseWords(); R.ok($('phrase').value === '', 'UI: after CLEAR ALL, dbUseWords() gives nothing (the words are gone from the page)');
  // the secret is held only in the page's variable: not in the DOM until asked, and not left in a text node after HIDE
  r = await open({ kind: 'cc', file: fileOf('backup.7z', c0b), key: c0.password }); w.dbReveal(); w.dbReveal();
  { const body = w.document.body.cloneNode(true); body.querySelectorAll('script,style').forEach((x) => x.remove()); R.ok(!body.textContent.includes(c0m.split(' ').slice(0, 5).join(' ')), 'UI: after HIDE THE SECRET the words are nowhere in the page text (outside the script)'); }
  w.dbClear(); delete $('dbFile').files;
  // the OPEN button is disabled until the self-test passed, and the page holds the gate
  R.ok($('dbBtn').disabled === false, 'UI: OPEN BACKUP is enabled after the self-test');
}

// ================================================================ 5. Krux's own code (optional)
// kef.py of selfcustody/krux at the pinned commit, through tests/vendor/kef_oracle.py (the AES and hash modules it imports are supplied
// there from Python's `cryptography`; Krux's own test vectors are run first to show those stand-ins are faithful).
const ORACLE = path.join(here, 'vendor', 'kef_oracle.py');
let haveOracle = existsSync(path.join(here, 'vendor', 'src', 'krux', 'src', 'krux', 'kef.py')) && existsSync(ORACLE);
if (haveOracle) { try { execFileSync('python3', ['-I', '-c', 'import cryptography'], { stdio: 'ignore' }); } catch (e) { haveOracle = false; } }
if (!haveOracle) console.log("KRUX OWN CODE: SKIPPED (run sh tests/vendor/fetch.sh; needs python3 with the cryptography package)");
else {
  const mine = [], mk = [];
  for (const version of Object.keys(KEF).map(Number)) for (const len of [16, 32]) for (let k = 0; k < 2; k++) {
    const ent = noNulTail(len), id = Buffer.from(rb(randomInt(1, 9)).toString('hex')), field = pick(FIELDS), pw = rndKey();
    mine.push({ version, id: id.toString('hex'), field, password: pw, entropy: ent.toString('hex'), envelope: kefMake(version, id, field, pw, ent).toString('hex') });
    mk.push({ version, id: rb(randomInt(1, 9)).toString('hex'), field: pick(FIELDS), password: rndKey(), entropy: noNulTail(len).toString('hex') });
  }
  const official = KX.kef_qr_vectors.map((v) => ({ envelope: v.envelope_hex, password: PW })).concat(KX.extra.filter((v) => v.plaintext_hex || v.plaintext_entropy_hex).map((v) => ({ envelope: v.envelope_hex, password: v.password.split(' (')[0] })));
  let O = null;
  try { O = JSON.parse(execFileSync('python3', ['-I', ORACLE], { input: JSON.stringify({ official, open: mine, make: mk }), maxBuffer: 1 << 26 }).toString()); } catch (e) { R.ok(false, 'Krux kef.py oracle ran -- ' + String(e.stderr || e.message).slice(0, 300)); }
  if (O) {
    R.ok(O.krux_commit === '28d14c216006e278fd263afead3357becb83aa43' && O.kef_sha256 === O.kef_sha256_pinned, 'Krux kef.py is the pinned file (commit 28d14c2, the same file as in v26.09.0), by SHA-256');
    const want = KX.kef_qr_vectors.map((v) => v.plaintext_entropy_hex).concat(KX.extra.filter((v) => v.plaintext_hex || v.plaintext_entropy_hex).map((v) => v.plaintext_hex || v.plaintext_entropy_hex));
    R.ok(O.official.length === want.length && O.official.every((o, i) => o === want[i]), 'Krux kef.py (with the stand-in AES) opens Krux\'s own ' + want.length + ' test vectors: the stand-ins are faithful');
    const bad = []; O.opened.forEach((o, i) => { if (o !== mine[i].entropy) bad.push('v' + mine[i].version + ' got ' + o); });
    R.ok(bad.length === 0, 'Krux\'s own kef.py opens all ' + mine.length + ' envelopes made here (every version, 16 and 32 bytes, random IDs, keys and iteration counts)' + (bad.length ? ' -- failed: ' + bad.slice(0, 3).join('; ') : ''));
    let m = 0, skipped = 0; const mb = [];
    for (let i = 0; i < mk.length; i++) {
      if (!O.made[i]) { skipped++; continue; }   // Krux itself refused (fail_unsafe: a check or data that ends in a zero byte)
      const t = b43enc(Buffer.from(O.made[i], 'hex'));
      try { const x = await w.kruxOpen(enc(t), t, mk[i].password, false); if (x.list[0].mnemonic === entropyToMnemonic(Buffer.from(mk[i].entropy, 'hex'), wordlist) && x.list[0].iters === iterOf(mk[i].field)) m++; else mb.push('v' + mk[i].version); } catch (e) { mb.push('v' + mk[i].version + ' ' + e.message.slice(0, 40)); }
    }
    R.ok(m + skipped === mk.length && m > 0 && skipped < 4, 'the page opens all ' + m + ' envelopes made by Krux\'s own kef.py (' + skipped + ' not made: Krux refused that data)' + (mb.length ? ' -- failed: ' + mb.slice(0, 4).join('; ') : ''));
    const vs = new Set(mk.filter((_, i) => O.made[i]).map((x) => x.version)); R.ok(vs.size === 12, 'those envelopes cover all 12 KEF versions (' + [...vs].sort((a, b) => a - b).join(' ') + ')');
  }
}

R.done('device backups');
