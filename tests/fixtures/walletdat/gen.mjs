// Test wallet.dat files for tests/walletdat.test.mjs and the page's self-test (v2.16.0, Read a Bitcoin Core wallet file).
// Bitcoin Core is not run here: each record is written exactly as Bitcoin Core's source writes it (bitcoin/bitcoin at tag
// v29.0 unless named: src/wallet/walletdb.cpp WriteKey, WriteCryptedKey, WriteMasterKey, WriteDescriptor, WriteDescriptorKey,
// WriteCryptedDescriptorKey, WriteDescriptorParentCache / LastHardenedCache / DerivedCache, WriteActiveScriptPubKeyMan,
// WriteName, WritePurpose; walletdb.h CHDChain and CKeyMetadata; crypter.cpp BytesToKeySHA512AES and EncryptSecret; key.cpp
// ec_seckey_export_der; walletutil.cpp GenerateWalletDescriptor; walletutil.h WalletDescriptor; descriptor.cpp DescriptorID;
// v0.18.0 src/wallet/wallet.h CWalletKey), and the files are written by the real libraries Bitcoin Core uses:
// Berkeley DB (libdb 5.3, through bdbwrite.c: one btree subdatabase named "main", as src/wallet/bdb.cpp opens it) and
// SQLite (Python's sqlite3: CREATE TABLE main(key BLOB PRIMARY KEY NOT NULL, value BLOB NOT NULL), application_id = the
// network's message start, user_version 0, as src/wallet/sqlite.cpp does).
// Every secret here is public test data: keys are SHA-256 of published text, BIP39 "abandon ... about" and BIP32 test vector 1.
// NEVER put money on any of them.
// Berkeley DB puts a random file ID in each file, so a new run gives new bytes: then put kat-legacy.dat and kat-descriptor.sqlite,
// in Base64, into the page as WDAT_KAT_BDB and WDAT_KAT_SQL (tests/walletdat.test.mjs checks they match).
// Run (needs gcc and libdb-dev): gcc -O1 -o /tmp/bdbwrite tests/fixtures/walletdat/bdbwrite.c -ldb &&
//   BDBWRITE=/tmp/bdbwrite node tests/fixtures/walletdat/gen.mjs
import nc from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { secp256k1 } from '@noble/curves/secp256k1';

const here = path.dirname(fileURLToPath(import.meta.url));
const B = (x) => Buffer.from(x);
const sha = (b) => nc.createHash('sha256').update(b).digest();
const dsha = (b) => sha(sha(b));
const T = (s) => sha(B('VOIDFORGE wallet.dat test: ' + s));   // a public test secret

// --- Bitcoin Core serialization (src/serialize.h): compact size, little-endian integers, strings and vectors
const cs = (n) => n < 253 ? B([n]) : n <= 0xffff ? Buffer.concat([B([253]), u16(n)]) : Buffer.concat([B([254]), u32(n)]);
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const vec = (b) => Buffer.concat([cs(b.length), B(b)]);
const str = (s) => vec(B(s));
const cat = (...p) => Buffer.concat(p.map(B));

// --- keys
const pubOf = (k, compressed = true) => B(secp256k1.getPublicKey(k, compressed));
// key.cpp ec_seckey_export_der: the 214-byte (compressed) or 279-byte DER form Bitcoin Core stores in "key" records
const DER_C = ['3081d30201010420', 'a08185308182020101302c06072a8648ce3d0101022100fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f300604010004010704210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798022100fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141020101a124032200'];
const DER_U = ['308201130201010420', 'a081a53081a2020101302c06072a8648ce3d0101022100fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f300604010004010704410479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8022100fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141020101a144034200'];
const der = (k, compressed = true) => { const [a, m] = compressed ? DER_C : DER_U; const d = cat(Buffer.from(a, 'hex'), k, Buffer.from(m, 'hex'), pubOf(k, compressed)); if (d.length !== (compressed ? 214 : 279)) throw new Error('DER length'); return d; };
const h160 = (b) => nc.createHash('ripemd160').update(sha(b)).digest();

// --- encryption (crypter.cpp): BytesToKeySHA512AES, then AES-256-CBC with PKCS#7 padding
function stretch(pass, salt, rounds) {
  let buf = nc.createHash('sha512').update(cat(B(pass), salt)).digest();
  for (let i = 0; i < rounds - 1; i++) buf = nc.createHash('sha512').update(buf).digest();
  return [buf.subarray(0, 32), buf.subarray(32, 48)];
}
const aes = (key, iv, data) => { const c = nc.createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([c.update(data), c.final()]); };
function mkey(pass, master, salt, rounds) {   // CMasterKey: vchCryptedKey, vchSalt, nDerivationMethod (0), nDeriveIterations, vchOtherDerivationParameters
  const [k, iv] = stretch(pass, salt, rounds);
  return cat(vec(aes(k, iv, master)), vec(salt), u32(0), u32(rounds), vec(Buffer.alloc(0)));
}
const encSecret = (master, pub, secret) => aes(master, dsha(pub).subarray(0, 16), secret);   // EncryptSecret with IV = pubkey.GetHash()

// --- records (walletdb.cpp)
const R = () => { const list = []; const put = (k, v) => list.push([B(k), B(v)]); return { list, put }; };
const keymeta = (time, keypath, seedId, fp, pathArr) => cat(i32(12), i64(time), str(keypath), seedId, B(fp), cs(pathArr.length), ...pathArr.map(u32), B([1]));
const locator = (hashes) => cat(i32(70016), cs(hashes.length), ...hashes.map((h) => Buffer.from(h, 'hex').reverse()));
const H = 0x80000000;

// BIP380 descriptor checksum
const INC = "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ", CHK = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function descsum(s) {
  const G = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn];
  const pm = (c, v) => { const c0 = c >> 35n; c = ((c & 0x7ffffffffn) << 5n) ^ BigInt(v); for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= G[i]; return c; };
  let c = 1n, cls = 0, cc = 0;
  for (const ch of s) { const p = INC.indexOf(ch); if (p < 0) throw new Error('bad char'); c = pm(c, p & 31); cls = cls * 3 + (p >> 5); if (++cc === 3) { c = pm(c, cls); cls = 0; cc = 0; } }
  if (cc) c = pm(c, cls);
  for (let i = 0; i < 8; i++) c = pm(c, 0);
  c ^= 1n; let o = ''; for (let i = 0; i < 8; i++) o += CHK[Number((c >> BigInt(5 * (7 - i))) & 31n)]; return o;
}
const withSum = (s) => s + '#' + descsum(s);
// DescriptorID: SHA-256 of the descriptor in the compatible form (apostrophes for hardened steps) with its checksum
const descId = (s) => { const compat = s.replace(/\/(\d+)h/g, "/$1'").replace(/\*h/g, "*'"); return sha(B(withSum(compat))); };
// CExtPubKey::Encode (src/pubkey.cpp): depth, parent fingerprint, child number (big-endian), chain code, public key: 74 bytes
const ext74 = (k) => { const b = Buffer.alloc(74); b[0] = k.depth; b.writeUInt32BE(k.parentFingerprint >>> 0, 1); b.writeUInt32BE(k.index >>> 0, 5); B(k.chainCode).copy(b, 9); B(k.publicKey).copy(b, 41); return b; };
// WalletDescriptor: descriptor string, creation time, next index, range start, range end
const wdesc = (s, time, next, start, end) => cat(str(withSum(s)), u64(time), i32(next), i32(start), i32(end));

const MAIN = 'f9beb4d9', TEST3 = '0b110907';
const out = {};

// ===== A: legacy HD wallet, encrypted (Bitcoin Core 0.17.1 style), Berkeley DB, little-endian, 4096-byte pages
function legacyHd({ pass, rounds, ext, int, labels = true, bigTx = true, version = 170100 }) {
  const r = R(), seedKey = T('HD seed'), master = T('master key 1'), salt = T('salt 1').subarray(0, 8);
  const root = HDKey.fromMasterSeed(seedKey), seedPub = pubOf(seedKey), seedId = h160(seedPub), fp = B(root.identifier.subarray(0, 4));
  r.put(str('version'), i32(version)); r.put(str('minversion'), i32(169900));
  r.put(cat(str('mkey'), u32(1)), mkey(pass, master, salt, rounds));
  r.put(str('hdchain'), cat(i32(2), u32(ext), seedId, u32(int)));
  const ck = (pub, secret, meta) => { const e = encSecret(master, pub, secret); r.put(cat(str('ckey'), vec(pub)), cat(vec(e), dsha(e))); r.put(cat(str('keymeta'), vec(pub)), meta); };
  ck(seedPub, seedKey, keymeta(1500000000, 's', seedId, Buffer.alloc(4), []));
  const keys = [];
  for (const [chain, n] of [[0, ext], [1, int]]) for (let i = 0; i < n; i++) {
    const k = root.derive(`m/0'/${chain}'/${i}'`), pub = B(k.publicKey);
    ck(pub, B(k.privateKey), keymeta(1500000000 + i, `m/0'/${chain}'/${i}'`, seedId, fp, [H, H + chain, H + i]));
    keys.push({ chain, i, pub }); if (i >= 2) r.put(cat(str('pool'), i64(keys.length)), cat(i32(version), i64(1500000000), vec(pub), B([chain]), B([0])));
  }
  if (labels) {
    // name and purpose (walletdb.cpp WriteName / WritePurpose): the receive address of key m/0'/0'/0' (P2SH-P2WPKH, 0.17's default) and of m/0'/0'/1' (bech32)
    r.put(cat(str('name'), str(addrP2shWpkh(keys[0].pub))), str('Savings')); r.put(cat(str('purpose'), str(addrP2shWpkh(keys[0].pub))), str('receive'));
    r.put(cat(str('name'), str(addrWpkh(keys[1].pub))), str('Rent, March')); r.put(cat(str('purpose'), str(addrWpkh(keys[1].pub))), str('receive'));
    r.put(cat(str('name'), str('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH')), str('Exchange deposit')); r.put(cat(str('purpose'), str('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH')), str('send'));
  }
  r.put(str('bestblock'), locator([])); r.put(str('bestblock_nomerkle'), locator(['000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f']));
  r.put(str('orderposnext'), i64(2));
  if (bigTx) r.put(cat(str('tx'), sha(B('tx 1'))), Buffer.concat(Array.from({ length: 200 }, (_, i) => sha(B('tx body ' + i)))));   // 6400 bytes: overflow pages
  return { r, info: { seedKey: seedKey.toString('hex'), master: master.toString('hex') } };
}

// bech32 / base58 addresses for the labels (independent of the page: @scure/btc-signer)
import * as btc from '@scure/btc-signer';
function addrWpkh(pub, net) { return btc.p2wpkh(pub, net).address; }
function addrP2shWpkh(pub, net) { return btc.p2sh(btc.p2wpkh(pub, net), net).address; }

// ===== B: an old legacy wallet (Bitcoin Core 0.8.6 style), not encrypted, big-endian Berkeley DB, 1024-byte pages
function legacyOld() {
  const r = R(), keys = [];
  r.put(str('version'), i32(80600)); r.put(str('minversion'), i32(60000));
  for (let n = 0; n < 3; n++) { const k = T('old key ' + n), pub = pubOf(k, false); r.put(cat(str('key'), vec(pub)), vec(der(k, false))); keys.push({ k, pub, c: false }); }   // the oldest form: no hash after the key
  for (let n = 3; n < 5; n++) { const k = T('old key ' + n), pub = pubOf(k, true), d = der(k, true); r.put(cat(str('key'), vec(pub)), cat(vec(d), dsha(cat(pub, d)))); keys.push({ k, pub, c: true }); }
  { const k = T('old key wkey'), pub = pubOf(k, false); r.put(cat(str('wkey'), vec(pub)), cat(i32(80600), vec(der(k, false)), i64(1300000000), i64(0), str('old wallet key'))); keys.push({ k, pub, c: false, w: true }); }
  r.put(str('defaultkey'), vec(keys[0].pub));
  r.put(cat(str('name'), str(btc.p2pkh(keys[0].pub).address)), str('Mining 2011'));
  r.put(cat(str('name'), str(btc.p2pkh(keys[3].pub).address)), str('Donations ✓ “quoted”'));
  r.put(cat(str('pool'), i64(1)), cat(i32(80600), i64(1300000000), vec(keys[4].pub)));
  return { r, keys: keys.map((x) => ({ k: x.k.toString('hex'), c: x.c, w: !!x.w })) };
}

// ===== C and D: descriptor wallets (GenerateWalletDescriptor: pkh/44h, sh(wpkh)/49h, wpkh/84h, tr/86h; coin 0h on mainnet, 1h on test networks)
// A label so long that its SQLite row overflows with only the minimum M bytes on the page (sqlite.org/fileformat2.html: on a
// table leaf page, K = M + ((P - M) % (U - 4)), and when K > X = U - 35 just M bytes stay on the page), for 1024-byte pages.
function longLabelFor(U) {
  const X = U - 35, M = Math.floor((U - 12) * 32 / 255) - 23, vl = (n) => n < 128 ? 1 : n < 16384 ? 2 : 3;
  return (keyLen) => { for (let L = 9000; ; L++) { const v = cs(L).length + L, P = 1 + vl(2 * keyLen + 12) + vl(2 * v + 12) + keyLen + v; if (P > X && M + ((P - M) % (U - 4)) > X) return 'Long label: ' + 'x'.repeat(L - 12); } };
}
function descriptorWallet({ root, test, pass, rounds, labels, bigTx, extra, longLabel }) {
  const r = R(), coin = test ? 1 : 0, xpub = root.publicExtendedKey, rootPub = B(root.publicKey), master = T('master key 2'), salt = T('salt 2').subarray(0, 8);
  r.put(str('version'), i32(test ? 280100 : 270000)); r.put(str('minversion'), i32(169900));
  r.put(str('flags'), u64((1n << 34n) | (1n << 2n) | (1n << 1n)));   // descriptors, last hardened xpub cached, key origin metadata
  if (pass) r.put(cat(str('mkey'), u32(1)), mkey(pass, master, salt, rounds));
  const types = [['pkh(', 44, ')'], ['sh(wpkh(', 49, '))'], ['wpkh(', 84, ')'], ['tr(', 86, ')']];
  const descs = [];
  const putKey = (id, pub, secret) => {
    if (pass) r.put(cat(str('walletdescriptorckey'), id, vec(pub)), vec(encSecret(master, pub, secret)));
    else { const d = der(secret, pub.length === 33); r.put(cat(str('walletdescriptorkey'), id, vec(pub)), cat(vec(d), dsha(cat(pub, d)))); }
  };
  types.forEach(([pre, purpose, post], t) => {
    for (const internal of [0, 1]) {
      const s = pre + xpub + '/' + purpose + 'h/' + coin + 'h/0h/' + internal + '/*' + post, id = descId(s);
      r.put(cat(str('walletdescriptor'), id), wdesc(s, 1700000000, internal ? 1 : 3, 0, 20));
      const acct = root.derive(`m/${purpose}'/${coin}'/0'`), parent = acct.deriveChild(internal);
      r.put(cat(str('walletdescriptorcache'), id, u32(0)), vec(ext74(parent)));        // parent cache: key 0, the xpub before the wildcard
      r.put(cat(str('walletdescriptorlhcache'), id, u32(0)), vec(ext74(acct)));         // last hardened cache: key 0, the account xpub
      putKey(id, rootPub, B(root.privateKey));
      r.put(cat(str(internal ? 'activeinternalspk' : 'activeexternalspk'), B([t])), id);   // OutputType: LEGACY 0, P2SH_SEGWIT 1, BECH32 2, BECH32M 3
      descs.push({ s, purpose, internal, id: id.toString('hex') });
    }
  });
  if (extra) {
    // an inactive descriptor as Bitcoin Core's legacy migration writes it (combo(xpub/0h/0h/*h)), with its derived cache entries
    const m2 = HDKey.fromMasterSeed(T('migrated HD seed')), s = 'combo(' + m2.publicExtendedKey + '/0h/0h/*h)', id = descId(s);
    r.put(cat(str('walletdescriptor'), id), wdesc(s, 0, 0, 0, 3));
    for (let i = 0; i < 3; i++) r.put(cat(str('walletdescriptorcache'), id, u32(0), u32(i)), vec(ext74(m2.derive(`m/0'/0'/${i}'`))));
    putKey(id, B(m2.publicKey), B(m2.privateKey));
    // an imported single key (a plain public key in the descriptor, the private key as a descriptor key)
    const k = T('imported key'), pub = pubOf(k), s2 = 'wpkh(' + pub.toString('hex') + ')', id2 = descId(s2);
    r.put(cat(str('walletdescriptor'), id2), wdesc(s2, 0, 0, 0, 0)); putKey(id2, pub, k);
    descs.push({ s, combo: true, seed: T('migrated HD seed').toString('hex') }, { s: s2, key: k.toString('hex') });
  }
  if (labels) for (let i = 0; i < labels; i++) {
    const a = btc.p2wpkh(root.derive(`m/84'/${coin}'/0'/0/${i}`).publicKey, test ? btc.TEST_NETWORK : undefined).address;
    r.put(cat(str('name'), str(a)), str(i === 0 ? 'First payment' : i === 150 && longLabel ? longLabel(cat(str('name'), str(a)).length) : 'Label ' + i)); r.put(cat(str('purpose'), str(a)), str('receive'));
  }
  r.put(str('bestblock'), locator([])); r.put(str('bestblock_nomerkle'), locator([test ? '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943' : '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f']));
  if (bigTx) r.put(cat(str('tx'), sha(B('tx 2'))), Buffer.concat(Array.from({ length: 300 }, (_, i) => sha(B('tx body ' + i)))));   // 9600 bytes: an overflow chain
  return { r, descs };
}

function writeBdb(file, list, pagesize, lorder) {
  const p = path.join(here, file); if (fs.existsSync(p)) fs.unlinkSync(p);
  execFileSync(process.env.BDBWRITE || '/tmp/bdbwrite', [p, String(pagesize), String(lorder)], { input: list.map(([k, v]) => k.toString('hex') + ' ' + v.toString('hex')).join('\n') + '\n' });
}
function writeSqlite(file, list, pagesize, appId) {
  const p = path.join(here, file); if (fs.existsSync(p)) fs.unlinkSync(p);
  const job = path.join(here, '.job.json'); fs.writeFileSync(job, JSON.stringify({ path: p, page_size: pagesize, app_id: appId, records: list.map(([k, v]) => [k.toString('hex'), v.toString('hex')]) }));
  try { execFileSync('python3', ['-I', path.join(here, 'mksqlite.py'), job]); } finally { fs.unlinkSync(job); }
}

const PASS_A = 'Test passphrase: grüße 🔑', PASS_D = 'correct horse battery staple', PASS_K = 'voidforge';
{ const { r, info } = legacyHd({ pass: PASS_A, rounds: 61234, ext: 150, int: 150 }); writeBdb('legacy-hd-encrypted.dat', r.list, 4096, 1234); out.legacyHd = { file: 'legacy-hd-encrypted.dat', pass: PASS_A, rounds: 61234, ext: 150, int: 150, ...info }; }
{ const { r, keys } = legacyOld(); writeBdb('legacy-old-be.dat', r.list, 1024, 4321); out.legacyOld = { file: 'legacy-old-be.dat', keys }; }
const ABOUT = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
{ const root = HDKey.fromMasterSeed(mnemonicToSeedSync(ABOUT)); const { r, descs } = descriptorWallet({ root, test: false, labels: 3, extra: true }); writeSqlite('descriptor.sqlite', r.list, 4096, MAIN); out.descriptor = { file: 'descriptor.sqlite', mnemonic: ABOUT, descs }; }
{ const root = HDKey.fromMasterSeed(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'), { private: 0x04358394, public: 0x043587cf }); const { r, descs } = descriptorWallet({ root, test: true, pass: PASS_D, rounds: 50000, labels: 300, bigTx: true, longLabel: longLabelFor(1024) });
  writeSqlite('descriptor-encrypted.sqlite', r.list, 1024, TEST3); out.descriptorEncrypted = { file: 'descriptor-encrypted.sqlite', seed: '000102030405060708090a0b0c0d0e0f', pass: PASS_D, rounds: 50000, descs }; }
// The self-test files (small: 512-byte pages, so records overflow; 25,000 rounds, Bitcoin Core's starting count, crypter.h)
{ const { r, info } = legacyHd({ pass: PASS_K, rounds: 25000, ext: 1, int: 1, labels: false, bigTx: false }); writeBdb('kat-legacy.dat', r.list, 512, 1234); out.katLegacy = { file: 'kat-legacy.dat', pass: PASS_K, ...info }; }
{ const root = HDKey.fromMasterSeed(mnemonicToSeedSync(ABOUT)), r = R(), master = T('master key 2'), salt = T('salt 2').subarray(0, 8), s = 'wpkh(' + root.publicExtendedKey + '/84h/0h/0h/0/*)', id = descId(s);
  r.put(str('version'), i32(290000)); r.put(str('flags'), u64(1n << 34n)); r.put(cat(str('mkey'), u32(1)), mkey(PASS_K, master, salt, 25000));
  r.put(cat(str('walletdescriptor'), id), wdesc(s, 1700000000, 0, 0, 1)); r.put(cat(str('walletdescriptorcache'), id, u32(0)), vec(ext74(root.derive("m/84'/0'/0'/0"))));
  r.put(cat(str('walletdescriptorckey'), id, vec(B(root.publicKey))), vec(encSecret(master, B(root.publicKey), B(root.privateKey)))); r.put(cat(str('activeexternalspk'), B([2])), id);
  writeSqlite('kat-descriptor.sqlite', r.list, 512, MAIN); out.katDescriptor = { file: 'kat-descriptor.sqlite', pass: PASS_K, mnemonic: ABOUT }; }
fs.writeFileSync(path.join(here, 'manifest.json'), JSON.stringify(out, null, 1) + '\n');
for (const f of fs.readdirSync(here).filter((x) => /\.(dat|sqlite)$/.test(x))) console.log(f, fs.statSync(path.join(here, f)).size, 'bytes, SHA-256', sha(fs.readFileSync(path.join(here, f))).toString('hex'));
