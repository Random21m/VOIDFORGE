// v2.16.0 Read a Bitcoin Core wallet file (wallet.dat). The test files in tests/fixtures/walletdat were written by the real
// libraries Bitcoin Core uses (Berkeley DB 5.3 and SQLite), with every record laid out as Bitcoin Core's source writes it
// (tests/fixtures/walletdat/gen.mjs names each source). Here every expected key, address, xpub, xprv and WIF is worked out
// again from the public test secrets with independent code (@scure/bip32, @scure/btc-signer, @noble/curves, node:crypto).
// Also: the encryption against node:crypto, damaged and cut-short files (they must fail cleanly and quickly), a large
// wallet made here with node:sqlite, and the box itself (gate, re-hide, auto-clear, CLEAR, CLEAR ALL, PRINT, paging).
// Run: node tests/walletdat.test.mjs
import nc from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { createBase58check } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { secp256k1 } from '@noble/curves/secp256k1';
import { loadPage, ready, readHtml, makeReporter } from './harness.mjs';

const R = makeReporter(), ok0 = R.ok, T0 = Date.now(); let TL = T0;
const ok = (c, m) => { const n = Date.now(); ok0(c, m + (process.env.WD_TIME ? ' [' + (n - TL) + ' ms]' : '')); TL = n; };
const here = path.dirname(fileURLToPath(import.meta.url)), FX = path.join(here, 'fixtures', 'walletdat');
const MF = JSON.parse(fs.readFileSync(path.join(FX, 'manifest.json'), 'utf8'));
const file = (f) => new Uint8Array(fs.readFileSync(path.join(FX, f)));
const sha = (b) => nc.createHash('sha256').update(b).digest();
const h160 = (b) => nc.createHash('ripemd160').update(sha(b)).digest();
const b58 = createBase58check((x) => sha(x));
const T = (s) => sha(Buffer.from('VOIDFORGE wallet.dat test: ' + s));
const hx = (b) => Buffer.from(b).toString('hex');
const wif = (k, compressed, test) => b58.encode(Buffer.concat([Buffer.from([test ? 0xef : 0x80]), Buffer.from(k), compressed ? Buffer.from([1]) : Buffer.alloc(0)]));
const p2pkh = (pub, test) => b58.encode(Buffer.concat([Buffer.from([test ? 0x6f : 0]), h160(pub)]));
const addrs3 = (pub, net) => [btc.p2pkh(pub, net).address, btc.p2sh(btc.p2wpkh(pub, net), net).address, btc.p2wpkh(pub, net).address];
const TN = btc.TEST_NETWORK;
// BIP380 checksum, written again here from the BIP (not the page's)
const INC = "0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ", CHK = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function sum(s) { const G = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn];
  const pm = (c, v) => { const c0 = c >> 35n; c = ((c & 0x7ffffffffn) << 5n) ^ BigInt(v); for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= G[i]; return c; };
  let c = 1n, cls = 0, cc = 0; for (const ch of s) { const p = INC.indexOf(ch); c = pm(c, p & 31); cls = cls * 3 + (p >> 5); if (++cc === 3) { c = pm(c, cls); cls = 0; cc = 0; } }
  if (cc) c = pm(c, cls); for (let i = 0; i < 8; i++) c = pm(c, 0); c ^= 1n; let o = ''; for (let i = 0; i < 8; i++) o += CHK[Number((c >> BigInt(5 * (7 - i))) & 31n)]; return s + '#' + o; }
const addrOf = (purpose, pub, net) => purpose === 44 ? btc.p2pkh(pub, net).address : purpose === 49 ? btc.p2sh(btc.p2wpkh(pub, net), net).address : purpose === 84 ? btc.p2wpkh(pub, net).address : btc.p2tr(pub.slice(1), undefined, net).address;
const TYPE = { 44: 'pkh', 49: 'sh-wpkh', 84: 'wpkh', 86: 'tr' }, OT = { 44: 0, 49: 1, 84: 2, 86: 3 };

const w = loadPage(readHtml());
ok(w.document.getElementById('wdatBtn').disabled, 'gate: READ WALLET FILE is off until the self-test passes');
await ready(w);
const $ = (id) => w.document.getElementById(id), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ok(/SELF-TEST PASSED \(155\/155\)/.test($('selfTestBadge').textContent) && !$('wdatBtn').disabled, 'self-test: passes 155/155, and READ WALLET FILE is on after it');
const unlock = (wl, pw, stop) => w.wdatUnlock(wl, pw, async () => {}, stop || (() => false));
const fail = async (b) => { try { await w.wdatRead(b); return null; } catch (e) { return e; } };

// ===== the box, as the house style asks
{
  const box = $('wdatBox'), s = box.querySelector(':scope > summary'), btns = [...box.querySelectorAll('button')], gold = btns.filter((b) => !b.classList.contains('secondary'));
  ok(!!box.closest('#tp-check') && s.querySelector('.tag').textContent === 'SECRET' && s.querySelectorAll('small').length === 1 && /wallet\.dat/.test(s.textContent), 'the box: in CHECK A BACKUP, a title, the SECRET tag (it shows private keys) and a one-line hint');
  ok(gold.length === 1 && gold[0].id === 'wdatBtn' && gold[0].textContent === 'READ WALLET FILE', 'the box: one gold main action, READ WALLET FILE');
  ok(btns.filter((b) => /^(PRINT|CLEAR)/.test(b.textContent)).every((b) => b.classList.contains('secondary')) && $('wdatPrintBtn').disabled, 'the box: PRINT SUMMARY and CLEAR are gray (PRINT off until a file is read)');
  ok($('wdatPass').type === 'password' && /user-select:\s*none/.test($('wdatSecret').getAttribute('style')), 'the box: the passphrase box shows dots, and the private keys cannot be selected');
  ok(w.rhIds().includes('wdatSecret') && w.rhIds().includes('wdatPass') && w.eval('AUTO_FIELDS').includes('wdatPass'), 're-hide: the private keys and the passphrase box are on its list; auto-clear wipes the passphrase box');
  const d = [...w.document.querySelectorAll('#dictList dt')].map((x) => x.textContent);
  ok(['wallet.dat', 'Berkeley DB', 'Descriptor wallet', 'Legacy wallet (Bitcoin Core)', 'Wallet encryption (Bitcoin Core)'].every((t) => d.includes(t)), 'dictionary: wallet.dat, Berkeley DB, Descriptor wallet, Legacy wallet and Wallet encryption are in it');
}

// ===== encryption against node:crypto
{
  let bad = 0;
  for (let t = 0; t < 40; t++) {
    const x = nc.randomBytes(64), n = 1 + nc.randomInt(4), H = new Int32Array(8), L = new Int32Array(8);
    for (let i = 0; i < 8; i++) { H[i] = x.readInt32BE(8 * i); L[i] = x.readInt32BE(8 * i + 4); }
    w.wdatSha512Rounds(H, L, n); let want = x; for (let i = 0; i < n; i++) want = nc.createHash('sha512').update(want).digest();
    const got = Buffer.alloc(64); for (let i = 0; i < 8; i++) { got.writeInt32BE(H[i], 8 * i); got.writeInt32BE(L[i], 8 * i + 4); }
    if (!got.equals(want)) bad++;
  }
  ok(bad === 0, 'SHA-512: 40 random 64-byte inputs, hashed 1 to 4 times, as node:crypto');
  bad = 0;
  for (const [pw, rounds] of [['a', 1], ['', 2], ['grüße 🔑 \u0000x', 3], ['correct horse', 1000], ['x'.repeat(300), 25000]]) {
    const salt = nc.randomBytes(8), [k, iv] = await w.wdatStretch(new TextEncoder().encode(pw), salt, rounds);
    let buf = nc.createHash('sha512').update(Buffer.concat([Buffer.from(pw), salt])).digest(); for (let i = 0; i < rounds - 1; i++) buf = nc.createHash('sha512').update(buf).digest();
    if (hx(k) !== buf.subarray(0, 32).toString('hex') || hx(iv) !== buf.subarray(32, 48).toString('hex')) bad++;
  }
  ok(bad === 0, 'key stretch (BytesToKeySHA512AES): key and IV as node:crypto, for 1, 2, 3, 1,000 and 25,000 rounds, empty, Unicode and long passphrases');
  // a stop between slices of a huge round count
  let calls = 0; const t0 = Date.now(), r = await w.wdatStretch(new Uint8Array(1), new Uint8Array(8), 4000000000, async () => { calls++; }, () => calls >= 1);
  ok(r === null && Date.now() - t0 < 2000, 'key stretch: 4 billion rounds stop at once when CLEAR is pressed (null, under 2 s)');
  // DER (key.cpp): both lengths Bitcoin Core writes, and what it refuses
  const k = T('der'), DERC = '3081d30201010420';
  const tail = (n) => Buffer.alloc(n, 7), d = Buffer.concat([Buffer.from(DERC, 'hex'), k, tail(174)]);
  ok(hx(w.wdatDer(d)) === hx(k) && hx(w.wdatDer(Buffer.concat([Buffer.from('308201130201010420', 'hex'), k, tail(238)]))) === hx(k), 'DER private key: the 214 and 279-byte forms give the key');
  ok([Buffer.from('3181d30201010420', 'hex'), Buffer.from('3001d30201010420', 'hex'), Buffer.from('3081d30201020420', 'hex'), Buffer.from('3081d30201010421', 'hex')].every((p) => w.wdatDer(Buffer.concat([p, k, tail(174)])) === null)
    && w.wdatDer(Buffer.concat([Buffer.from(DERC, 'hex'), k])) === null && w.wdatDer(Buffer.concat([Buffer.from(DERC, 'hex'), Buffer.alloc(32), tail(174)])) === null && w.wdatDer(Buffer.concat([Buffer.from(DERC, 'hex'), Buffer.alloc(32, 255), tail(174)])) === null, 'DER private key: a wrong header, version or length, a cut-short one, a zero key or one over the curve order is refused');
  const cs = (b) => { try { const r2 = w.wdatRd(Uint8Array.from(b)); return r2.cs(); } catch (e) { return 'X'; } };
  ok(cs([252]) === 252 && cs([253, 253, 0]) === 253 && cs([253, 252, 0]) === 'X' && cs([254, 0, 0, 1, 0]) === 65536 && cs([254, 255, 255, 0, 0]) === 'X' && cs([254, 1, 0, 0, 2]) === 'X' && cs([255, 0, 0, 0, 0, 1, 0, 0, 0]) === 'X' && cs([253]) === 'X',
    'compact sizes (serialize.h): only the shortest form, at most 32 MB, and a cut-short one fails');
}

// ===== A: encrypted legacy HD wallet (Berkeley DB, little-endian, 4096-byte pages)
{
  const A = MF.legacyHd, seed = Buffer.from(A.seedKey, 'hex'), root = HDKey.fromMasterSeed(seed), seedPub = secp256k1.getPublicKey(seed, true);
  const wl = await w.wdatRead(file(A.file));
  ok(wl.fmt === 'bdb' && !wl.db.big && wl.db.ps === 4096 && !wl.descriptor && wl.encrypted, 'legacy HD: a Berkeley DB file, little-endian, 4,096-byte pages, a legacy wallet, encrypted');
  ok(wl.counts.ckey === 301 && wl.counts.keymeta === 301 && wl.counts.pool === 296 && wl.counts.tx === 1 && wl.counts.name === 3 && wl.counts.mkey === 1 && wl.version === 170100 && wl.minversion === 169900, 'legacy HD: every record is found (301 encrypted keys and their metadata, key pool 296, 1 transaction, 3 names)');
  ok(wl.hdchain.ver === 2 && wl.hdchain.ext === 150 && wl.hdchain.int === 150 && wl.hdchain.seed === hx(h160(seedPub)) && wl.mkeys[0].rounds === A.rounds, 'legacy HD: hdchain (seed ID = HASH160 of the seed key, 150 and 150 keys) and the master key record');
  await w.wdatHash160s(wl);
  let bad = 0;
  for (const { x, m } of wl.lines) {
    const p = /^m\/0'\/([01])'\/(\d+)'$/.exec(m.path || ''); const k = p ? root.derive(m.path) : null;
    const want = p ? addrs3(k.publicKey) : addrs3(seedPub);
    if ((await w.wdatKeyAddrs(wl, x.pub)).join() !== want.join()) bad++;
  }
  ok(bad === 0 && wl.lines.length === 301 && wl.lines[0].m.path === "m/0'/0'/0'" && wl.lines[150].m.path === "m/0'/1'/0'", 'legacy HD: all 301 keys, in path order, with their legacy, nested and native SegWit addresses (@scure)');
  ok((await unlock(wl, 'Test passphrase: grüße 🔑'.normalize('NFD'))).wrong && (await unlock(wl, 'test passphrase: grüße 🔑')).wrong, 'legacy HD: the passphrase is used exactly as typed (another Unicode form or a capital is wrong)');
  const u = await unlock(wl, A.pass);
  ok(u.ok && u.bad === 0 && u.checked, 'legacy HD: the right passphrase opens it, and every key decrypts');
  bad = 0;
  for (const { x, m } of wl.lines) { const want = /^m\//.test(m.path) ? root.derive(m.path).privateKey : seed; if (hx(x.secret) !== hx(want)) bad++; }
  ok(bad === 0, 'legacy HD: each decrypted key is the key at its path (@scure/bip32), the seed key is the HD seed');
  const head = await w.wdatSecretHead(wl), xprv = root.privateExtendedKey;
  ok(head.includes('HD master private key (made from the HD seed, as Bitcoin Core does): ' + xprv) && head.includes(sum('combo(' + xprv + '/0h/0h/*h)')) && head.includes(sum('combo(' + xprv + '/0h/1h/*h)')), 'legacy HD: the master xprv and the two combo() descriptors Bitcoin Core\'s migration writes');
  const items = []; for (let i = 0; i < 3; i++) items.push(await w.wdatSecretItem(wl, i));
  ok(items[0].includes("m/0'/0'/0'  " + wif(root.derive("m/0'/0'/0'").privateKey, true)) && !items.join().includes('DOES NOT MATCH'), 'legacy HD: the WIF of each key (compressed, mainnet)');
  ok((await unlock(await w.wdatRead(file(A.file)), 'wrong')).wrong, 'legacy HD: a wrong passphrase is called wrong');
  const sm = await w.wdatSummary(wl);
  ok(/Berkeley DB \(btree, little-endian, 4,096-byte pages\), a legacy wallet/.test(sm) && /Bitcoin Core 0\.17\.1 \(version 170100\)/.test(sm) && /61,234 rounds of SHA-512/.test(sm) && /master fingerprint [0-9a-f]{8}/.test(sm) && sm.includes(hx(root.identifier.subarray(0, 4))) && /Transactions: 1 /.test(sm), 'legacy HD: the summary (format, version, rounds, master fingerprint from the key metadata, transactions)');
}

// ===== B: an old wallet, not encrypted, big-endian Berkeley DB with 1024-byte pages (overflow pages)
{
  const B = MF.legacyOld, raw = file(B.file), ps = 1024;
  const ovf = [...Array(raw.length / ps).keys()].filter((p) => raw[p * ps + 25] === 7).length;
  const wl = await w.wdatRead(raw);
  ok(wl.fmt === 'bdb' && wl.db.big && wl.db.ps === 1024 && ovf > 0, 'old wallet: a big-endian Berkeley DB file with 1,024-byte pages and ' + ovf + ' overflow pages');
  ok(wl.keys.size === 6 && wl.counts.key === 5 && wl.counts.wkey === 1 && wl.version === 80600 && !wl.encrypted && !wl.hdchain, 'old wallet: 5 key records (3 without a hash, the oldest form) and 1 wkey record, version 80600');
  let bad = 0;
  for (const k of B.keys) { const s = Buffer.from(k.k, 'hex'), pub = secp256k1.getPublicKey(s, k.c), x = wl.keys.get(hx(pub)); if (!x || hx(x.secret) !== k.k || (await w.wdatKeyAddrs(wl, x.pub))[0] !== p2pkh(pub)) bad++; }
  ok(bad === 0, 'old wallet: every private key, compressed and uncompressed, read from its DER form, with its address');
  const items = []; for (let i = 0; i < 6; i++) items.push(await w.wdatSecretItem(wl, i));
  ok(B.keys.every((k) => items.join('\n').includes(wif(Buffer.from(k.k, 'hex'), k.c))) && items.filter((t) => / 5[HJK]/.test(t)).length === 4, 'old wallet: WIFs (uncompressed ones start with 5)');
  ok([...wl.book.values()].map((x) => x.label).sort().join('|') === 'Donations ✓ “quoted”|Mining 2011', 'old wallet: labels read as UTF-8');
  ok(/wkey/.test(await w.wdatSummary(wl)) && /HD seed: none/.test(await w.wdatSummary(wl)), 'old wallet: the summary names the wkey record and says there is no HD seed');
}

// ===== C: descriptor wallet, not encrypted (SQLite, mainnet)
{
  const C = MF.descriptor, root = HDKey.fromMasterSeed(mnemonicToSeedSync(C.mnemonic));
  const wl = await w.wdatRead(file(C.file));
  ok(wl.fmt === 'sqlite' && wl.net === 'main' && wl.netName === 'mainnet' && wl.db.app === 'f9beb4d9' && wl.descriptor && !wl.encrypted && wl.descs.size === 10 && wl.active.length === 8, 'descriptor: an SQLite file, mainnet by its application ID, 10 descriptors, 8 active');
  ok([...wl.descs.values()].every((D) => D.idOk), 'descriptor: every descriptor matches its record ID (DescriptorID)');
  const rows = await w.wdatActiveRows(wl); let bad = 0;
  for (const D of wl.descs.values()) {
    const m = /^(?:sh\()?[a-z]+\(xpub[^/]+\/(\d+)h\/0h\/0h\/([01])\/\*/.exec(D.str); if (!m) continue;
    const p = +m[1], c = +m[2], acct = root.derive(`m/${p}'/0'/0'`);
    for (let i = 0; i < 10; i++) if (await w.wdatAddrAt(wl, D, i) !== addrOf(p, acct.deriveChild(c).deriveChild(i).publicKey)) bad++;
    const pre = TYPE[p] === 'sh-wpkh' ? 'sh(wpkh(' : TYPE[p] + '(', post = TYPE[p] === 'sh-wpkh' ? '))' : ')';
    if (await w.wdatWatchForm(wl, D) !== sum(pre + '[73c5da0a/' + p + 'h/0h/0h]' + acct.publicExtendedKey + '/' + c + '/*' + post)) bad++;
    if ((await w.wdatPrivDesc(wl, D)).text !== sum(pre + root.privateExtendedKey + '/' + p + 'h/0h/0h/' + c + '/*' + post)) bad++;
    if (D.activeAs.type !== OT[p] || D.activeAs.internal !== !!c) bad++;
  }
  ok(bad === 0 && rows.length === 8, 'descriptor: the first 10 addresses of all 8 active descriptors, their watch-only forms and private descriptors (@scure)');
  ok(rows[0].startsWith('Legacy (pkh), receive') && rows[7].startsWith('Taproot (tr), change'), 'descriptor: the active descriptors in order, receive then change');
  const combo = [...wl.descs.values()].find((D) => /^combo/.test(D.str)), m2 = HDKey.fromMasterSeed(T('migrated HD seed'));
  bad = 0; for (let i = 0; i < 5; i++) { const pub = m2.derive(`m/0'/0'/${i}'`).publicKey, a = [btc.p2pkh(pub).address, btc.p2wpkh(pub).address, btc.p2sh(btc.p2wpkh(pub)).address].join('  '); if (await w.wdatAddrAt(wl, combo, i) !== a) bad++; }
  ok(bad === 0 && combo.derived.size === 3, 'descriptor: combo(xpub/0h/0h/*h) gives P2PKH, P2WPKH and P2SH-P2WPKH, from the derived cache (0 to 2) and the private key (3, 4)');
  const imp = [...wl.descs.values()].find((D) => /^wpkh\(0[23]/.test(D.str)), ik = T('imported key'), ipub = secp256k1.getPublicKey(ik, true);
  ok(await w.wdatAddrAt(wl, imp, 0) === btc.p2wpkh(ipub).address && (await w.wdatPrivDesc(wl, imp)).text === sum('wpkh(' + wif(ik, true) + ')'), 'descriptor: an imported single key: its address, and its WIF in the private descriptor');
  ok(wl.book.size === 3 && wl.book.get(btc.p2wpkh(root.derive("m/84'/0'/0'/0/0").publicKey).address).label === 'First payment', 'descriptor: the address book (names and purposes)');
  // the same file, the descriptor caches taken away: the addresses then come from the private keys (or say why not)
  const strip = await w.wdatRead(file(C.file)); for (const D of strip.descs.values()) { D.parent.clear(); D.derived.clear(); }
  const wpkhD = [...strip.descs.values()].find((D) => /^wpkh\(xpub/.test(D.str) && /\/0\/\*\)/.test(D.str));
  ok(await w.wdatAddrAt(strip, wpkhD, 0) === 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', 'descriptor: with no cache, an address is worked out from the private key (BIP84 test vector)');
}

// ===== D: descriptor wallet, encrypted (SQLite, testnet3, 1024-byte pages, 300 labels, an overflow chain)
{
  const D0 = MF.descriptorEncrypted, root = HDKey.fromMasterSeed(Buffer.from(D0.seed, 'hex'), { private: 0x04358394, public: 0x043587cf });
  const wl = await w.wdatRead(file(D0.file));
  ok(wl.net === 'test' && wl.netName === 'testnet3' && wl.encrypted && wl.book.size === 300 && wl.counts.tx === 1 && wl.db.ps === 1024, 'encrypted descriptor: testnet3, encrypted, 300 labels, 1,024-byte pages');
  { const ll = [...wl.book.values()].find((x) => /^Long label: /.test(x.label || '')), raw = file(D0.file); ok(!!ll && ll.label.length > 9000 && !/[^x]/.test(ll.label.slice(12)), 'encrypted descriptor: a label over 9,000 bytes, of which only the minimum (M) stays on its page, read whole from its overflow pages'); }
  const check = async () => { let bad = 0; for (const D of wl.descs.values()) { const m = /\/(\d+)h\/1h\/0h\/([01])\/\*/.exec(D.str); const p = +m[1], c = +m[2]; for (const i of [0, 9]) if (await w.wdatAddrAt(wl, D, i) !== addrOf(p, root.derive(`m/${p}'/1'/0'/${c}/${i}`).publicKey, TN)) bad++; } return bad; };
  ok(await check() === 0, 'encrypted descriptor: before the passphrase, the addresses come from the public key cache (testnet, @scure)');
  ok((await unlock(wl, 'Correct horse battery staple')).wrong, 'encrypted descriptor: a wrong passphrase is called wrong');
  const u = await unlock(wl, D0.pass);
  let bad = 0; for (const D of wl.descs.values()) { const p = await w.wdatPrivDesc(wl, D); if (p.missing || !p.text.includes(root.privateExtendedKey) || p.text !== sum(D.str.replace(/#.*$/, '').replace(root.publicExtendedKey, root.privateExtendedKey))) bad++; }
  ok(u.ok && bad === 0 && await check() === 0, 'encrypted descriptor: the passphrase opens it; private descriptors with the tprv; the same addresses');
}

// ===== the self-test files
{
  const K = await w.wdatRead(file(MF.katLegacy.file)), S = await w.wdatRead(file(MF.katDescriptor.file));
  ok(K.db.ps === 512 && S.db.ps === 512 && w.eval('WDAT_KAT_BDB') === fs.readFileSync(path.join(FX, MF.katLegacy.file)).toString('base64') && w.eval('WDAT_KAT_SQL') === fs.readFileSync(path.join(FX, MF.katDescriptor.file)).toString('base64'), 'self-test: its two files are the fixtures kat-legacy.dat and kat-descriptor.sqlite, byte for byte');
}

// ===== damaged, cut short and hostile files: a clean, plain refusal, never a script error, and quickly
const OURS = /^This (Berkeley DB file|SQLite file) cannot be read: |^This is not a Bitcoin Core wallet file/;
{
  let bad = []; const t0 = Date.now();
  for (const f of ['legacy-hd-encrypted.dat', 'legacy-old-be.dat', 'descriptor.sqlite', 'descriptor-encrypted.sqlite', 'kat-legacy.dat', 'kat-descriptor.sqlite']) {
    const b = file(f), ps = /sqlite/.test(f) ? (b[16] << 8 | b[17]) : MF && (f === 'legacy-old-be.dat' ? 1024 : f === 'kat-legacy.dat' ? 512 : 4096);
    for (const n of [0, 1, 15, 16, 100, 511, 512, ps, b.length >> 1, b.length - ps, b.length - 1]) {
      const e = await fail(b.slice(0, Math.max(0, n))); if (!e || !OURS.test(e.message)) bad.push(f + ' cut at ' + n + ': ' + (e ? e.message : 'read'));
    }
  }
  ok(bad.length === 0, 'cut short: every file cut anywhere is refused with a plain reason (' + (bad.slice(0, 3).join(' | ') || 'none read') + ')');
  ok(Date.now() - t0 < 20000, 'cut short: all refused quickly');
}
{
  // random damage (a fixed pseudo-random sequence, so a failure can be repeated)
  let s = 20261111; const rnd = (n) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n; };
  const odd = [], slow = []; let runs = 0, refused = 0;
  for (const f of ['kat-legacy.dat', 'kat-descriptor.sqlite', 'legacy-old-be.dat', 'descriptor.sqlite']) {
    const b0 = file(f);
    for (let t = 0; t < 60; t++) {
      const b = b0.slice(), k = 1 + rnd(6); for (let j = 0; j < k; j++) b[rnd(b.length)] ^= 1 << rnd(8);
      const t0 = Date.now(); runs++;
      try { const wl = await w.wdatRead(b); await w.wdatSummary(wl); await w.wdatHash160s(wl); for (const D of [...wl.descs.values()].slice(0, 3)) await w.wdatAddrAt(wl, D, 0).catch((e) => { if (/^Cannot|undefined|null|is not a function/.test(e.message)) throw e; }); for (const v of w.wdatViews(wl)) for (let i = 0; i < Math.min(v.count, 3); i++) await v.item(i); if (wl.encrypted) await unlock(wl, 'voidforge'); }
      catch (e) { refused++; if (!OURS.test(e.message)) odd.push(f + ' #' + t + ': ' + e.message); }
      if (Date.now() - t0 > 4000) slow.push(f + ' #' + t);
    }
  }
  ok(odd.length === 0, 'damaged files: ' + runs + ' randomly damaged copies are read or refused with a plain reason, never a script error (' + refused + ' refused' + (odd.length ? '; ' + odd.slice(0, 3).join(' | ') : '') + ')');
  ok(slow.length === 0, 'damaged files: none takes over 4 s (' + slow.slice(0, 3).join(', ') + ')');
}
{
  const B = file('legacy-hd-encrypted.dat'), ps = 4096, le32 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = v >>> 24; };
  const msg = async (b) => { const e = await fail(b); return e ? e.message : 'read'; };
  let b = B.slice(); b[24] = 1; ok(/Berkeley DB’s own encryption/.test(await msg(b)), 'hostile: Berkeley DB’s own encryption is refused (Bitcoin Core never uses it)');
  b = B.slice(); le32(b, 16, 8); ok(/version 8/.test(await msg(b)), 'hostile: a btree of another version is refused');
  b = B.slice(); le32(b, 48, 0x21); ok(/flags/.test(await msg(b)), 'hostile: other database flags are refused');
  b = B.slice(); le32(b, 20, 3000); ok(/page size \(3000\)/.test(await msg(b)), 'hostile: a page size that is not a power of 2 is refused');
  // find an overflow page and point it at itself
  const ov = [...Array(B.length / ps).keys()].find((p) => B[p * ps + 25] === 7 && B[p * ps + 16]);
  b = B.slice(); if (ov !== undefined) le32(b, ov * ps + 16, ov);
  const wl0 = ov !== undefined ? await w.wdatRead(b).catch((e) => e) : null;
  ok(ov !== undefined && (wl0 instanceof Error ? /loop/.test(wl0.message) : true), 'hostile: an overflow chain that loops is stopped');
  // an internal or leaf page linked twice
  b = B.slice(); le32(b, 8, 9); ok(/meta page 0 has the wrong page number/.test(await msg(b)), 'hostile: a meta page with the wrong number is refused');
  b = B.slice(); le32(b, 0, 5); const wlL = await w.wdatRead(b); ok(wlL.notes.some((n) => /log sequence numbers/.test(n)) && wlL.keys.size === 301, 'hostile: a file that was not fully written out is read, with a note (Bitcoin Core’s own reader would refuse it)');
  const S = file('descriptor.sqlite'), page1 = Buffer.from(S.subarray(0, 4096)), at = page1.indexOf(Buffer.from('tablemainmain'));
  b = S.slice(); b.set(Buffer.from('tablemaimmaim'), at); ok(at > 0 && /no table named main/.test(await msg(b)), 'hostile: an SQLite file without the table main is refused');
  b = S.slice(); b[68] = 1; const wn = await w.wdatRead(b); ok(wn.notes.some((n) => /application ID/.test(n)) && wn.net === 'main' && wn.netGuess, 'hostile: an unknown application ID is named (signet, or not a Bitcoin Core wallet)');
  b = S.slice(); b[63] = 1; ok((await w.wdatRead(b)).notes.some((n) => /schema version is 1/.test(n)), 'hostile: another SQLite schema version is named');
  b = S.slice(); b[18] = 2; b[19] = 2; ok((await w.wdatRead(b)).notes.some((n) => /WAL/.test(n)), 'hostile: a file in WAL mode gets a note about the -wal file');
  ok(OURS.test((await fail(new TextEncoder().encode('{"wallet_type": "standard", "keystore": {}}'.padEnd(600)))).message) && /Electrum/.test((await fail(new Uint8Array(4096))).message), 'hostile: a file that is neither format is refused (it names an Electrum file as an example)');
  // a damaged record: bad check hash on a ckey, a master key with another derivation method
  const KL = file('kat-legacy.dat'), wk = await w.wdatRead(KL); wk.mkeys[0].method = 1;
  ok(/method 1/.test((await unlock(wk, 'voidforge')).error || ''), 'hostile: a master key with derivation method 1 is refused, as Bitcoin Core does');
  const wk2 = await w.wdatRead(KL); wk2.mkeys[0].rounds = 0;
  ok(/not valid/.test((await unlock(wk2, 'voidforge')).error || ''), 'hostile: a master key with 0 rounds is refused');
  const at2 = Buffer.from(KL).indexOf(Buffer.from([0x30])); void at2;
}

// ===== every decrypted key is checked against its public key (v2.16.0 review M3)
{
  const A = MF.legacyHd, raw = file(A.file), wl0 = await w.wdatRead(raw), all = w.wdatCrypted(wl0), victims = [all[5], all[200]];
  const b = raw.slice(); let found = 0;
  for (const x of victims) { const B = Buffer.from(b), c = Buffer.from(x.crypted); let n = 0; for (let at = B.indexOf(c); at >= 0; at = B.indexOf(c, at + 1)) { b[at + 3] ^= 0x40; b.set(sha(sha(b.subarray(at, at + 48))), at + 48); n++; } if (n) found++; }   // every copy (Berkeley DB keeps old copies in free space); the first cipher block: the padding still checks, the key comes out wrong; the record's checksum is made again, as a damaged block in an older wallet without one
  const wl = await w.wdatRead(b), u = await unlock(wl, A.pass);
  ok(found === 2 && u.ok && u.bad === 2 && u.total === 301, 'damaged keys: two keys damaged in their first cipher block decrypt with good padding, and are caught by the public key check (2 of 301)');
  const bad = w.wdatCrypted(wl).filter((x) => x.damaged);
  ok(bad.length === 2 && bad.every((x) => !x.secret) && w.wdatCrypted(wl).filter((x) => x.secret).length === 299, 'damaged keys: their wrong private keys are not kept; the other 299 are');
  const items = []; for (let i = 0; i < wl.lines.length; i++) items.push(await w.wdatSecretItem(wl, i));
  ok(items.filter((t) => /DAMAGED: this key does not decrypt to its own public key, so it is not shown/.test(t)).length === 2, 'damaged keys: marked DAMAGED in the list of private keys, with no key shown');
  await w.wdatShow(b, A.pass);
  ok($('wdatStatus').className === 'status bad' && /Passphrase right: .* 299 of 301 keys decrypted and checked against their public keys\. 2 keys do not decrypt to their own public key: the file is damaged/.test($('wdatStatus').textContent) && /marked DAMAGED/.test($('wdatStatus').textContent), 'damaged keys: the status says 299 of 301 decrypted and checked, and that the file is damaged (status bad)');
  await w.wdatShow(raw, A.pass); ok($('wdatStatus').className === 'status ok' && /301 of 301 keys decrypted and checked against their public keys\./.test($('wdatStatus').textContent), 'every key decrypted: 301 of 301 decrypted and checked');
  w.wdatClear();
  // the faster k times G (a table of multiples of G) gives the same public keys as @noble/curves
  let diff = 0; for (let i = 0; i < 40; i++) { const k = i < 3 ? Buffer.from((['01', 'fe'.repeat(16) + 'ff'.repeat(16), 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140'])[i].padStart(64, '0'), 'hex') : T('gmul ' + i); for (const c of [true, false]) if (hx(w.wdatPubOf(k, new Uint8Array(c ? 33 : 65).fill(4, 0, 1))) !== hx(secp256k1.getPublicKey(k, c))) diff++; }
  ok(diff === 0, 'the public key check: 40 keys (1, n - 1 and random ones), compressed and uncompressed, as @noble/curves');
}

// ===== hostile files that would make the reader do far more than the file holds (v2.16.0 review H2): refused quickly, with
// little memory. Each page may be used once in the whole file, a cell or record once on its page, and all the rows together
// may not put together more bytes than the file has.
{
  const vs = (x) => Buffer.concat([Buffer.from([x.length]), Buffer.from(x)]), nameKey = (i) => Buffer.concat([vs('name'), vs('bc1q' + String(i).padStart(38, '0'))]);
  const hostile = async (what, b, re) => {
    if (global.gc) global.gc(); const m0 = process.memoryUsage().rss, t0 = Date.now(); let peak = m0;
    const iv = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 5);
    const e = await fail(b); clearInterval(iv); peak = Math.max(peak, process.memoryUsage().rss);
    const ms = Date.now() - t0, mb = Math.round((peak - m0) / 1048576);
    ok(!!e && OURS.test(e.message) && re.test(e.message) && ms < 3000 && mb < 200, 'hostile: ' + what + ': refused in ' + ms + ' ms, ' + mb + ' MB more memory (' + (e ? e.message : 'it was read') + ')');
  };
  let DatabaseSync = null; try { ({ DatabaseSync } = await import('node:sqlite')); } catch (e) { DatabaseSync = null; }
  if (!DatabaseSync) ok(true, 'hostile SQLite files: SKIPPED (this Node has no node:sqlite)');
  else {
    const mk = (ps, rows) => {
      const p = path.join(FX, '.hostile-test.sqlite'); try { fs.unlinkSync(p); } catch (e) { /* none */ }
      const db = new DatabaseSync(p); db.exec('PRAGMA page_size = ' + ps); db.exec('PRAGMA auto_vacuum = 0'); db.exec('CREATE TABLE main(key BLOB PRIMARY KEY NOT NULL, value BLOB NOT NULL)'); db.exec('PRAGMA application_id = ' + (0xf9beb4d9 | 0));
      const ins = db.prepare('INSERT INTO main VALUES (?, ?)'); for (const [k, v] of rows) ins.run(k, v);
      const root = db.prepare("SELECT rootpage FROM sqlite_schema WHERE name = 'main'").get().rootpage; db.close();
      const b = new Uint8Array(fs.readFileSync(p)); fs.unlinkSync(p); return { b, root, leaf: (root - 1) * ps };
    };
    const be16 = (b, o) => b[o] << 8 | b[o + 1], put16 = (b, o, v) => { b[o] = v >> 8; b[o + 1] = v & 255; };
    // 1. the reviewer's file: 65,536-byte pages, one row with a 2 MB value, its cell pointer repeated as often as fits
    { const { b, leaf } = mk(65536, [[nameKey(1), Buffer.alloc(2 * 1048576, 7)]]);
      const cp = be16(b, leaf + 8), n = (cp - 8) >> 1; put16(b, leaf + 3, n); for (let i = 0; i < n; i++) put16(b, leaf + 8 + 2 * i, cp);
      ok(b.length < 2.3 * 1048576 && n > 15000, 'hostile SQLite: a ' + (b.length / 1048576).toFixed(1) + ' MB file with 65,536-byte pages and one cell pointer repeated ' + n + ' times');
      await hostile('a cell pointer repeated ' + n + ' times', b, /lists one cell twice/); }
    // 2. two cells at different places that share one overflow chain
    { const { b, leaf } = mk(4096, [[nameKey(1), Buffer.alloc(300000, 1)], [nameKey(2), Buffer.alloc(300000, 2)]]);
      const U = 4096, cell = (i) => { const c = leaf + be16(b, leaf + 8 + 2 * i); let o = c, P = 0; for (;;) { const x = b[o++]; P = P * 128 + (x & 127); if (!(x & 128)) break; } while (b[o++] & 128); const M = Math.floor((U - 12) * 32 / 255) - 23, K = M + ((P - M) % (U - 4)); return o + (K <= U - 35 ? K : M); };
      const a1 = cell(0), a2 = cell(1); b.set(b.subarray(a1, a1 + 4), a2);
      await hostile('two rows that share one overflow chain', b, /page \d+ is used twice/); }
    // control: a file of the same kind, not changed
    { const { b } = mk(4096, Array.from({ length: 40 }, (_, i) => [nameKey(i), Buffer.alloc(100, i)]));
      const r = await w.wdatRead(b); ok(r.book.size === 40, 'control: the same kind of file, not changed, is read (40 labels)'); }
  }
  // Berkeley DB, built here byte by byte (little-endian, as src/wallet/migrate.cpp reads it): a meta page, the list of
  // subdatabases (main), the subdatabase's meta page, one leaf page and one long overflow chain.
  const bdb = (ps, chain, leafItems) => {
    const pages = 4 + chain, b = new Uint8Array(pages * ps), le32 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = v >>> 24; }, le16 = (o, v) => { b[o] = v & 255; b[o + 1] = v >> 8; };
    const head = (pg, type, level, entries, next, hf) => { const o = pg * ps; le32(o, 0); le32(o + 4, 1); le32(o + 8, pg); le32(o + 16, next || 0); le16(o + 20, entries || 0); le16(o + 22, hf || 0); b[o + 24] = level; b[o + 25] = type; };
    const meta = (pg, root) => { head(pg, 9, 0); const o = pg * ps; le32(o + 12, 0x00053162); le32(o + 16, 9); le32(o + 20, ps); b[o + 24] = 0; b[o + 25] = 9; le32(o + 32, pages - 1); le32(o + 48, 0x20); le32(o + 88, root); };
    const leaf = (pg, items) => { head(pg, 5, 1, items.length); let end = ps; const o = pg * ps, offs = new Map();
      items.forEach((it, i) => { if (it.raw !== undefined) { le16(o + 26 + 2 * i, it.raw); le16(o + it.raw, it.len); b[o + it.raw + 2] = 1; return; } if (it.same !== undefined) { le16(o + 26 + 2 * i, offs.get(it.same)); return; } const body = it.ovf !== undefined ? 12 : 3 + it.data.length; end -= body; end &= ~3; le16(o + 26 + 2 * i, end); offs.set(i, end);
        if (it.ovf !== undefined) { le16(o + end, 0); b[o + end + 2] = 3; le32(o + end + 4, it.ovf); le32(o + end + 8, it.tlen); } else { le16(o + end, it.data.length); b[o + end + 2] = 1; b.set(it.data, o + end + 3); } }); };
    meta(0, 1); leaf(1, [{ data: Buffer.from('main') }, { data: Buffer.from([0, 0, 0, 2]) }]); meta(2, 3); leaf(3, leafItems);
    for (let i = 0; i < chain; i++) { head(4 + i, 7, 0, 0, i + 1 < chain ? 5 + i : 0, ps - 26); b.fill(9, (4 + i) * ps + 26, (5 + i) * ps); }
    return b;
  };
  { const ok1 = bdb(4096, 3, [{ data: nameKey(1) }, { ovf: 4, tlen: 3 * 4070 }]); const r = await w.wdatRead(ok1);
    ok(r.fmt === 'bdb' && r.counts.name === 1, 'control: the Berkeley DB file built here is read (one record whose value is a 3-page overflow chain)'); }
  { const ps = 65536, chain = 32, pairs = [], n = 900; for (let i = 0; i < n; i++) pairs.push({ data: nameKey(i) }, { ovf: 4, tlen: chain * (ps - 26) });
    const b = bdb(ps, chain, pairs); ok(b.length > 2 * 1048576 && b.length < 2.5 * 1048576, 'hostile Berkeley DB: a ' + (b.length / 1048576).toFixed(1) + ' MB file with ' + n + ' records whose values all point to one 2 MB overflow chain');
    await hostile(n + ' records sharing one long overflow chain', b, /page 4 is used twice/); }
  { const ps = 65536, chain = 32, items = []; for (let i = 0; i < 1000; i++) items.push({ ovf: 4, tlen: chain * (ps - 26) }, { data: Buffer.from([1]) });
    await hostile('1,000 keys sharing one long overflow chain (keys are read before the page knows whether it wants the value)', bdb(ps, chain, items), /page 4 is used twice/); }
  { const items = [{ data: nameKey(1) }, { data: Buffer.from('x') }]; for (let i = 0; i < 2000; i++) items.push({ same: 0 }, { same: 1 });
    await hostile('one record listed 2,000 times on its page', bdb(65536, 1, items), /lists one record twice/); }
  { const items = []; for (let i = 0; i < 2000; i++) items.push({ raw: 8100 + 4 * i, len: 40000 });   // each a different place, all overlapping: 80 MB of records in a 0.3 MB file
    await hostile('2,000 records that overlap on one page (80 MB of records in a 0.3 MB file)', bdb(65536, 1, items), /hold more data than the file itself/); }
}

// ===== a large wallet, made here with node:sqlite: read in slices (the page stays responsive), shown a page at a time
{
  let DatabaseSync = null; try { ({ DatabaseSync } = await import('node:sqlite')); } catch (e) { DatabaseSync = null; }
  if (!DatabaseSync) ok(true, 'large wallet: SKIPPED (this Node has no node:sqlite)');
  else {
    const p = path.join(FX, '.big-test.sqlite'); try { fs.unlinkSync(p); } catch (e) { /* none */ }
    const db = new DatabaseSync(p); db.exec('PRAGMA page_size = 4096'); db.exec('CREATE TABLE main(key BLOB PRIMARY KEY NOT NULL, value BLOB NOT NULL)'); db.exec('PRAGMA application_id = ' + (0xf9beb4d9 | 0)); db.exec('PRAGMA user_version = 0');
    const ins = db.prepare('INSERT INTO main VALUES (?, ?)'), vs = (s) => Buffer.concat([Buffer.from([s.length]), Buffer.from(s)]);
    db.exec('BEGIN'); ins.run(Buffer.concat([vs('version')]), Buffer.from([0x50, 0x6c, 0x04, 0x00]));
    for (let i = 0; i < 20000; i++) { const a = 'bc1q' + sha(Buffer.from('a' + i)).toString('hex').slice(0, 38); ins.run(Buffer.concat([vs('name'), vs(a)]), vs('Label ' + i)); ins.run(Buffer.concat([vs('tx'), sha(Buffer.from('t' + i))]), Buffer.alloc(200 + (i % 5) * 600, i & 255)); }
    db.exec('COMMIT'); db.close();
    const big = new Uint8Array(fs.readFileSync(p)); fs.unlinkSync(p);
    let ticks = 0, longest = 0, last = Date.now(); const t0 = Date.now();
    const wl = await w.wdatRead(big, async () => { const n = Date.now(); longest = Math.max(longest, n - last); last = n; ticks++; });
    ok(wl.book.size === 20000 && wl.counts.tx === 20000 && ticks > 10, 'large wallet: a ' + Math.round(big.length / 1048576) + ' MB file with 20,000 labels and 20,000 transactions is read (' + ticks + ' progress steps, ' + (Date.now() - t0) + ' ms)');
    ok(longest < 1500, 'large wallet: no slice of the work holds the page for long (longest ' + longest + ' ms)');
    const v = w.wdatViews(wl).find((x) => x.id === 'labels'); ok(v.count === 20000 && v.per === 25, 'large wallet: the address book is shown 25 at a time (800 pages)');
  }
}

// ===== the box: read, passphrase, show, page, print, CLEAR, CLEAR ALL, auto-clear, re-hide
{
  const A = MF.legacyHd;
  await w.wdatShow(file(A.file), '');
  ok($('wdatStatus').className === 'status ok' && /encrypted\. To check the passphrase/.test($('wdatStatus').textContent) && $('wdatSecretRow').style.display === 'none' && !w.wdatHasSecret() && !w.autoHasSecrets(), 'box: without the passphrase it shows the public details only, and holds no secret');
  ok(/Page 1 of 13: 1 to 25 of 301\./.test($('wdatPageNote').textContent) && $('wdatPrev').disabled && !$('wdatNext').disabled && $('wdatList').textContent.includes(addrs3(HDKey.fromMasterSeed(Buffer.from(A.seedKey, 'hex')).derive("m/0'/0'/0'").publicKey)[2]), 'box: the keys, 25 a page, with their addresses');
  await w.wdatPage(1); ok(/Page 2 of 13: 26 to 50/.test($('wdatPageNote').textContent) && !$('wdatPrev').disabled, 'box: NEXT shows the next 25');
  await w.wdatShow(file(A.file), 'wrong');
  ok($('wdatStatus').className === 'status bad' && /^Wrong passphrase/.test($('wdatStatus').textContent) && $('wdatOut').textContent.length > 100 && !w.wdatHasSecret(), 'box: a wrong passphrase is said plainly (status bad), and the public details still show');
  $('wdatPass').value = A.pass; await w.wdatShow(file(A.file), A.pass);
  ok(/^Passphrase right/.test($('wdatStatus').textContent) && $('wdatSecretRow').style.display === '' && $('wdatSecret').style.display === 'none' && w.wdatHasSecret() && w.autoHasSecrets(), 'box: the right passphrase: SHOW THE PRIVATE KEYS appears; nothing secret on screen yet; auto-clear knows the page holds secrets');
  await w.wdatReveal();
  const k0 = wif(HDKey.fromMasterSeed(Buffer.from(A.seedKey, 'hex')).derive("m/0'/0'/0'").privateKey, true);
  ok($('wdatSecret').textContent.includes(k0) && $('wdatShowBtn').textContent === 'HIDE THE PRIVATE KEYS' && w.rhAny(), 'box: SHOW THE PRIVATE KEYS shows the keys (re-hide sees a secret on screen)');
  await w.wdatSPage(1); ok(/Private keys \(WIF\), 26 to 50 of 301/.test($('wdatSecret').textContent) && !$('wdatSecret').textContent.includes(k0), 'box: NEXT KEYS shows the next 25 keys');
  w.rhHide('tab'); ok($('wdatSecret').style.filter === 'blur(9px)' && $('wdatPass').type === 'password', 're-hide: covers the private keys and puts the passphrase box back to dots'); w.rhShow();
  let printed = ''; const op = w.print; w.print = () => { printed = $('printOnly').textContent; }; w.wdatPrint(); w.print = op; w.dispatchEvent(new w.Event('afterprint'));
  ok(/VOIDFORGE WALLET FILE SUMMARY/.test(printed) && /Berkeley DB/.test(printed) && !printed.includes(k0) && !/xprv|Next steps/.test(printed), 'PRINT SUMMARY: the public summary and list, never a private key');
  w.wdatClear();
  ok(!w.wdatHasSecret() && $('wdatSecret').textContent === '' && $('wdatOut').textContent === '' && $('wdatList').textContent === '' && $('wdatPass').value === '' && $('wdatStatus').textContent === '' && $('wdatPrintBtn').disabled, 'CLEAR: wipes the keys, the lists, the status and the passphrase');
  await w.wdatShow(file(A.file), A.pass); await w.wdatReveal(); $('wdatPass').value = A.pass; w.clearAll();
  ok(!w.wdatHasSecret() && $('wdatSecret').textContent === '' && $('wdatPass').value === '', 'CLEAR ALL: wipes the wallet file reader too');
  await w.wdatShow(file(A.file), A.pass); ok(w.autoWipe('test') && !w.wdatHasSecret() && $('wdatOut').textContent === '', 'auto-clear: wipes the keys read from a wallet file');
  // CLEAR while the passphrase is being checked stops the check
  const run = w.wdatShow(file(MF.descriptorEncrypted.file), MF.descriptorEncrypted.pass); await sleep(30); w.wdatClear(); await run;
  ok(!w.wdatHasSecret() && $('wdatStatus').textContent === '' && $('wdatOut').textContent === '', 'CLEAR during a read stops it: nothing is shown afterwards');
  w.eval('selfTestState = "fail"'); let alerted = 0; const oa = w.alert; w.alert = () => { alerted++; }; await w.wdatOpenUi(); w.alert = oa; w.eval('selfTestState = "pass"');
  ok(alerted === 1 && $('wdatStatus').textContent === '', 'gate: with a failed self-test, READ WALLET FILE refuses');
  await w.wdatOpenUi(); ok(/Choose the wallet\.dat file first/.test($('wdatStatus').textContent) && $('wdatStatus').className === 'status bad', 'box: READ WALLET FILE with no file asks for one (status bad, as the Electrum box)');
  // auto-clear counts a chosen wallet.dat that is not read yet (it may hold keys that are not encrypted)
  w.clearAll(); ok(!w.autoHasSecrets(), 'auto-clear: control: nothing held after CLEAR ALL');
  Object.defineProperty($('wdatFile'), 'files', { value: [new w.File([file(MF.legacyOld.file)], 'wallet.dat')], configurable: true });
  ok(w.wdatHolds() && w.autoHasSecrets(), 'auto-clear: a chosen wallet.dat that is not read yet counts as a secret');
  delete $('wdatFile').files; ok(!w.autoHasSecrets(), 'auto-clear: and no longer once the file box is empty');
}
R.done('walletdat');
