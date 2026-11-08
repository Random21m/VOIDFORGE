// VOIDFORGE signed-release check (v2.9.0): "Check a signed release" verifies SHA256SUMS.asc with the VOIDFORGE key built into the page.
// The page's own OpenPGP and Ed25519 code is checked here against two independent implementations:
// - @noble/curves ed25519: random keys and messages; every good signature verifies, every changed one fails;
// - GnuPG itself: a throwaway key made for this run in a temporary GNUPGHOME signs test files the way a release is signed
//   (gpg --armor --detach-sign), also with other digests, binary output, text mode and a second key; the page must agree with
//   gpg --verify on every one, and refuse damaged armor, wrong files and the wrong key.
// Needs gpg (GnuPG 2.2 or later). Without it, the GnuPG part says SKIPPED; the @noble part always runs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nc from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { loadPage, ready, readHtml, makeReporter } from './harness.mjs';

const R = makeReporter();
const w = await ready(loadPage(readHtml()));
const hex = (b) => Buffer.from(b).toString('hex');

// 1. Ed25519 against @noble/curves
{ let bad = 0, n = 0;
  for (let i = 0; i < 40; i++) {
    const sk = nc.randomBytes(32), pk = ed25519.getPublicKey(sk), msg = nc.randomBytes(nc.randomInt(0, 200)), sig = ed25519.sign(msg, sk);
    n++; if (!(await w.ed25519Verify(new Uint8Array(sig), new Uint8Array(msg), new Uint8Array(pk)))) bad++;
    const m2 = Buffer.concat([msg, Buffer.from([1])]); n++; if (await w.ed25519Verify(new Uint8Array(sig), new Uint8Array(m2), new Uint8Array(pk))) bad++;
    const s2 = Uint8Array.from(sig); s2[nc.randomInt(64)] ^= 1 << nc.randomInt(8); n++; if ((await w.ed25519Verify(s2, new Uint8Array(msg), new Uint8Array(pk))) !== ed25519.verify(s2, msg, pk)) bad++;
  }
  R.ok(bad === 0, `Ed25519: the page agrees with @noble/curves on ${n} good, changed-message and changed-signature cases (${bad} disagree)`);
  // S at or above the group order must be refused (malleability), as RFC 8032 requires
  const sk = nc.randomBytes(32), pk = ed25519.getPublicKey(sk), msg = Buffer.from('x'), sig = Uint8Array.from(ed25519.sign(msg, sk));
  const L = (1n << 252n) + 27742317777372353535851937790883648493n; let S = 0n; for (let i = 63; i >= 32; i--) S = (S << 8n) | BigInt(sig[i]); S += L;
  const s2 = Uint8Array.from(sig); for (let i = 32; i < 64; i++) { s2[i] = Number(S & 255n); S >>= 8n; }
  R.ok(!(await w.ed25519Verify(s2, new Uint8Array(msg), new Uint8Array(pk))), 'Ed25519: a signature with S + L (same point, non-canonical) is refused');
}

// 2. OpenPGP against GnuPG
let gpgOk = false; try { execFileSync('gpg', ['--version'], { stdio: 'ignore' }); gpgOk = true; } catch (e) { /* no gpg */ }
if (!gpgOk) console.log('SIGNED: GnuPG part SKIPPED (gpg not installed)');
else {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-gpg-')); process.on('exit', () => { try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) { /* leave it */ } });
  const gpg = (args, input) => execFileSync('gpg', ['--homedir', home, '--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase', '', ...args], { input, stdio: ['pipe', 'pipe', 'pipe'] });
  gpg(['--quick-gen-key', 'VOIDFORGE test key A', 'ed25519', 'sign', 'never']);
  gpg(['--quick-gen-key', 'VOIDFORGE test key B', 'ed25519', 'sign', 'never']);
  const fprOf = (uid) => /fpr:+([0-9A-F]{40}):/.exec(gpg(['--with-colons', '--fingerprint', uid]).toString())[1].toLowerCase();
  const fA = fprOf('VOIDFORGE test key A'), fB = fprOf('VOIDFORGE test key B');
  // the public key packet (tag 6), as the page stores VF_KEY_PACKET
  const keyPacket = (fpr) => { const b = gpg(['--export', fpr]); const h = b[0]; let len, off; if ((h & 0x40) === 0) { const lt = h & 3; len = lt === 0 ? b[1] : (b[1] << 8) | b[2]; off = lt === 0 ? 2 : 3; } else { len = b[1]; off = 2; } return new Uint8Array(b.subarray(off, off + len)); };
  const kA = keyPacket(fA);
  const kAfpr = hex(nc.createHash('sha1').update(Buffer.concat([Buffer.from([0x99, kA.length >> 8, kA.length & 255]), kA])).digest());
  R.ok(kAfpr === fA, 'OpenPGP: the v4 fingerprint of a GnuPG key packet is worked out the way the page does it (SHA-1 over 0x99 | length | packet)');
  const sums = Buffer.from(nc.randomBytes(32).toString('hex') + '  voidforge.html\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-sums-')); const f = path.join(dir, 'SHA256SUMS'); fs.writeFileSync(f, sums);
  const sign = (extra, who = fA) => { gpg(['--local-user', who, '--detach-sign', ...extra, '--output', f + '.sig', f]); return new Uint8Array(fs.readFileSync(f + '.sig')); };
  const V = async (sig, data = sums, key = kA) => { try { return await w.pgpVerifyDetached(sig, new Uint8Array(data), key); } catch (e) { return { ok: false, why: 'THREW ' + e.message }; } };
  const gpgSays = (sig, data) => { fs.writeFileSync(f + '.chk', sig); fs.writeFileSync(f + '.dat', data); try { gpg(['--verify', f + '.chk', f + '.dat']); return true; } catch (e) { return false; } };
  // as a release is signed: gpg --armor --detach-sign (default digest), and each digest the page reads; binary output too
  for (const [label, extra] of [['armored, default digest', ['--armor']], ['armored, SHA-256', ['--armor', '--digest-algo', 'SHA256']], ['armored, SHA-384', ['--armor', '--digest-algo', 'SHA384']], ['armored, SHA-512', ['--armor', '--digest-algo', 'SHA512']], ['binary .sig', []]]) {
    const sig = sign(extra), r = await V(sig);
    R.ok(r.ok && gpgSays(sig, sums) && r.fpr === fA, 'OpenPGP: a GnuPG signature (' + label + ') is valid, as gpg --verify also says' + (r.ok ? '' : ' [' + r.why + ']'));
    const changed = Buffer.from(sums); changed[3] ^= 1; const r2 = await V(sig, changed);
    R.ok(!r2.ok && !gpgSays(sig, changed), 'OpenPGP: ' + label + ': a changed SHA256SUMS is refused, as by gpg');
  }
  { const sig = sign(['--armor']), r = await V(sig, sums, keyPacket(fB));
    R.ok(!r.ok && /another key/.test(r.why), 'OpenPGP: a signature by another key is refused and named as such [' + r.why + ']'); }
  { const sig = sign(['--armor'], fB), r = await V(sig);
    R.ok(!r.ok && /another key/.test(r.why) && r.why.includes(fB.toUpperCase().slice(0, 4)), 'OpenPGP: key B signing, checked with key A: refused, with B\'s fingerprint'); }
  { const sig = sign(['--armor', '--textmode']), r = await V(sig);
    R.ok(!r.ok && /text mode/.test(r.why), 'OpenPGP: a text-mode signature is refused with a plain reason [' + r.why + ']'); }
  { const t = Buffer.from(sign(['--armor'])).toString('utf8'), lines = t.split('\n'); const i = lines.findIndex((l) => /^[A-Za-z0-9+/]{20,}/.test(l));
    const flip = lines.slice(); flip[i] = (flip[i][5] === 'A' ? flip[i].slice(0, 5) + 'B' : flip[i].slice(0, 5) + 'A') + flip[i].slice(6);
    const r = await V(new Uint8Array(Buffer.from(flip.join('\n'))));
    R.ok(!r.ok && /damaged/.test(r.why), 'OpenPGP: armor with one changed character fails its checksum line [' + r.why + ']');
    const r2 = await V(new Uint8Array(Buffer.from('hello, not a signature'))); R.ok(!r2.ok && /not an OpenPGP signature/.test(r2.why), 'OpenPGP: plain text is not taken for a signature');
    const withComment = t.replace('-----BEGIN PGP SIGNATURE-----\n', '-----BEGIN PGP SIGNATURE-----\nComment: made for a test\n\n'), r3 = await V(new Uint8Array(Buffer.from(withComment)));
    R.ok(r3.ok, 'OpenPGP: armor with a Comment header still reads'); }
  // the release check end to end, with the test key standing in for the built-in one
  { const html = Buffer.from('<!doctype html>\n<html><body>test</body></html>\n'), h = nc.createHash('sha256').update(html).digest('hex');
    const sm = Buffer.from(h + '  voidforge.html\n'); fs.writeFileSync(f, sm); const sig = sign(['--armor']);
    const K = { packet: hex(kA), fpr: fA, created: 0, expires: 4102444800 };
    const run = (files, k = K) => w.dlSignedCheck(files.map(([name, b]) => ({ name, bytes: new Uint8Array(b) })), k);
    let r = await run([['SHA256SUMS.asc', sig], ['voidforge.html', html], ['SHA256SUMS', sm]]);
    R.ok(r.state === 'ok' && /^SIGNED AND MATCHING/.test(r.verdict), 'release check: the three files in any order give SIGNED AND MATCHING [' + r.verdict + ']');
    const other = Buffer.from(html.toString().replace('test', 'tampered')); r = await run([['voidforge.html', other], ['SHA256SUMS', sm], ['SHA256SUMS.asc', sig]]);
    R.ok(r.state === 'bad' && /is not the file the signed SHA256SUMS lists/.test(r.verdict), 'release check: a changed voidforge.html is NOT VERIFIED');
    const sm2 = Buffer.from(sm); sm2[0] = sm2[0] === 0x61 ? 0x62 : 0x61; r = await run([['voidforge.html', html], ['SHA256SUMS', sm2], ['SHA256SUMS.asc', sig]]);
    R.ok(r.state === 'bad' && /^NOT VERIFIED/.test(r.verdict), 'release check: a changed SHA256SUMS is NOT VERIFIED');
    r = await run([['SHA256SUMS', sm], ['SHA256SUMS.asc', sig]]); R.ok(r.state === '' && /Pick voidforge.html too/.test(r.verdict), 'release check: without voidforge.html it says SHA256SUMS is genuine and asks for the file');
    r = await run([['voidforge.html', html], ['SHA256SUMS', sm]]); R.ok(r.state === '' && /missing: SHA256SUMS.asc/.test(r.verdict), 'release check: a missing signature is named');
    r = await run([['a.txt', Buffer.from('hello')]]); R.ok(r.state === 'bad' && /none of the three files/.test(r.verdict), 'release check: an unrelated file is refused');
    r = await run([['voidforge.html', html], ['SHA256SUMS', sm], ['SHA256SUMS.asc', sig]], { ...K, fpr: '0'.repeat(40) });
    R.ok(r.state === 'bad' && /published VOIDFORGE fingerprint/.test(r.verdict), 'release check: a built-in key without the published fingerprint is not trusted');
    r = await run([['voidforge.html', html], ['SHA256SUMS', sm], ['SHA256SUMS.asc', sig]], w.eval('VF_KEY'));
    R.ok(r.state === 'bad' && /another key/.test(r.verdict), 'release check: with the real built-in key, a test-key signature is refused as another key'); }
}
R.done('signed');
