// v2.10.0 signature checks (Inspect a transaction, Compare two transactions) against outside sources. Nothing here comes from the
// code under test: the official BIP143 examples and BIP341 wallet test vectors (bitcoin/bips), Bitcoin Core's sighash.json and
// tx_valid.json (src/test/data), all pinned by commit and SHA-256 in tests/fixtures/sigcheck/sources.json, and PSBTs built, signed,
// finalized and hashed by @scure/btc-signer (an independent library), for every address type and sighash type the page reads.
// Run: node tests/sigcheck.test.mjs
import fs from 'node:fs';
import nc from 'node:crypto';
import * as btc from '@scure/btc-signer';
import { secp256k1, schnorr } from '@noble/curves/secp256k1';
import { loadPage, ready, readHtml, makeReporter } from './harness.mjs';

const R = makeReporter();
const w = await ready(loadPage(readHtml()));
const FX = (f) => new URL('./fixtures/sigcheck/' + f, import.meta.url);
const hx = (b) => Buffer.from(b).toString('hex'), hb = (h) => Uint8Array.from(Buffer.from(h, 'hex'));
const U = (b) => w.Uint8Array.from(b);   // bytes made in the page's own realm
R.ok(w.document.getElementById('selfTestBadge').textContent.includes('PASSED'), 'page self-test passes');

// 0. The fixtures are exactly the pinned files.
const SRC = JSON.parse(fs.readFileSync(FX('sources.json'), 'utf8'));
for (const f of SRC.files) R.ok(nc.createHash('sha256').update(fs.readFileSync(FX(f.file))).digest('hex') === f.sha256, 'fixture ' + f.file + ' is ' + f.url + ' (sha256 ' + f.sha256.slice(0, 12) + '...)');

const model = (h) => w.svTxModel(U(hb(h)));
const ctxOf = (tx, coins) => w.svCtx(tx, coins.map((c) => c && { amount: BigInt(c.amount), script: U(c.script) }));
const states = (rs) => rs.map((r) => r.state).join(',');

// 1. Bitcoin Core sighash.json: the legacy signature hash of 500 random transactions, scripts and hash types (OP_CODESEPARATOR,
// SIGHASH_SINGLE without a matching output, ANYONECANPAY, odd hash types), shown reversed as Core prints a uint256.
{ const V = JSON.parse(fs.readFileSync(FX('core-sighash.json'), 'utf8')).filter((v) => v.length === 5);
  let bad = 0, first = '';
  for (const [tx, script, i, ht, want] of V) { const got = hx((await w.svSighashLegacy(ctxOf(model(tx), []), i, U(hb(script)), ht)).slice().reverse()); if (got !== want) { bad++; first = first || tx.slice(0, 16) + ' ' + i + ' ' + ht; } }
  R.ok(V.length >= 500 && bad === 0, 'Bitcoin Core sighash.json: all ' + V.length + ' legacy signature hashes match' + (bad ? ' (' + bad + ' differ, first ' + first + ')' : '')); }

// 2. BIP143 examples (bip-0143.mediawiki): every sigHash from its unsigned transaction, script code, amount and hash type,
// then the signed transactions checked against their coins.
{ const T = fs.readFileSync(FX('bip-0143.mediawiki'), 'utf8').split('\n');
  let tx = null, outpoint = null, sc = null, amount = null, ht = null, n = 0, bad = 0;
  for (let k = 0; k < T.length; k++) {
    const L = T[k], m = (re) => (L.match(re) || [])[1];
    if (/The following is an unsigned transaction:/.test(L)) tx = m(/transaction:\s*([0-9a-f]+)/) || T[k + 1].trim();
    if (m(/^\s+outpoint:\s+([0-9a-f]{72})$/)) outpoint = m(/outpoint:\s+([0-9a-f]{72})$/);
    if (m(/scriptCode:\s+([0-9a-f]+)$/)) sc = m(/scriptCode:\s+([0-9a-f]+)$/);
    if (m(/^\s+amount:\s+([0-9a-f]{16})$/)) amount = m(/amount:\s+([0-9a-f]{16})$/);
    if (m(/^\s+nHashType:\s+([0-9a-f]{8})$/)) ht = m(/nHashType:\s+([0-9a-f]{8})$/);
    const want = m(/^\s+sigHash:\s+([0-9a-f]{64})$/);
    if (!want) continue;
    const t = model(tx), i = t.ins.findIndex((x) => hx(x.prev) + hx(Uint8Array.of(x.vout & 255, (x.vout >> 8) & 255, (x.vout >> 16) & 255, x.vout >>> 24)) === outpoint);
    const scb = hb(sc), off = scb[0] < 0xfd ? 1 : 3, amt = Buffer.from(hb(amount)).readBigUInt64LE(0), h = Buffer.from(hb(ht)).readUInt32LE(0);
    const got = hx(await w.svSighashV0(ctxOf(t, []), i, U(scb.slice(off)), amt, h)); n++; if (got !== want) { bad++; console.log('  differs: ' + want + ' got ' + got); }
  }
  R.ok(n === 13 && bad === 0, 'BIP143: all ' + n + ' sigHash values of the official examples match (P2WPKH, P2SH-P2WPKH, P2WSH with OP_CODESEPARATOR, P2SH-P2WSH with all six sighash types, No FindAndDelete)');
  const all = [...fs.readFileSync(FX('bip-0143.mediawiki'), 'utf8').matchAll(/The serialized signed transaction is: ([0-9a-f]+)/g)].map((x) => x[1]);
  const signed = ['01000000000102fff7f7', '01000000000101db6b1b', '01000000000102fe3dc9', '01000000000101366418'].map((p) => all.find((x) => x.startsWith(p)));
  const p2pk = hb('2103c9f4836b9a4f77fc0d81f7bcb01b7f1b35916864b9476c241ce9fc198bd25432ac'), wpkh = hb('00141d0f172a0ecb48aee1be1f2687d2963ae33f71a1');
  const shw = hb('a9144733f37cf4db86fbc2efed2500b4f4e49f31202387'), shwsh = hb('a9149993a429037b5d912407a71c252019287b8d27a587');
  const raw = async (txh, coins) => states(await w.svCheckRaw(U(hb(txh)), coins.map((c) => c && { amount: BigInt(c[0]), script: U(c[1]) })));
  R.ok(await raw(signed[0], [[625000000, p2pk], [600000000, wpkh]]) === 'valid,valid', 'BIP143 native P2WPKH example: the P2PK (legacy) and the P2WPKH signature are VALID');
  R.ok(await raw(signed[1], [[1000000000, shw]]) === 'valid', 'BIP143 P2SH-P2WPKH example: VALID');
  R.ok(await raw(signed[3], [[987654321, shwsh]]) === 'valid', 'BIP143 P2SH-P2WSH 6-of-6 multisig, signed with ALL, NONE, SINGLE and the three ANYONECANPAY types: VALID');
  R.ok(await raw(signed[0], [[625000001, p2pk], [600000001, wpkh]]) === 'valid,invalid', 'BIP143: a wrong amount makes the SegWit signature INVALID (the legacy one does not cover amounts)');
  const cs = await w.svCheckRaw(U(hb(signed[2])), [{ amount: 156250000n, script: U(hb('21036d5c20fa14fb2f635474c1dc4ef5909d4568e5569b79fc94d3448486e14685f8ac')) }, { amount: 4900000000n, script: U(hb('00205d1b56b63d714eebe542309525f484b7e9d6f686b3781b6f61ef925d66d6f6a0')) }]);
  R.ok(cs[0].state === 'valid' && cs[1].state === 'unchecked' && /does not read/.test(cs[1].why), 'BIP143 native P2WSH with OP_CODESEPARATOR: the P2PK input is VALID, the unusual script is NOT CHECKED (never called valid)');
  const sh2 = hb(signed[3]); const k = Buffer.from(sh2).indexOf(Buffer.from('3044022059ebf56d', 'hex')); sh2[k + 10] ^= 1;
  R.ok(await raw(hx(sh2), [[987654321, shwsh]]) === 'invalid', 'BIP143 6-of-6: one changed signature byte makes it INVALID'); }

// 3. BIP341 wallet test vectors: the key-path signature hash of every input (all hash types), the published signature checked,
// and every script-path control block shown to belong to its output key.
{ const V = JSON.parse(fs.readFileSync(FX('bip341-wallet-test-vectors.json'), 'utf8'));
  let n = 0, bad = 0, nv = 0, badv = 0;
  for (const kp of V.keyPathSpending) {
    const coins = kp.given.utxosSpent.map((u) => ({ amount: u.amountSats, script: hb(u.scriptPubKey) }));
    for (const s of kp.inputSpending) {
      const t = model(kp.given.rawUnsignedTx), ctx = ctxOf(t, coins), i = s.given.txinIndex;
      const got = hx(await w.svSighashTr(ctx, i, s.given.hashType, {})); n++; if (got !== s.intermediary.sigHash) bad++;
      t.ins[i].wit = s.expected.witness.map((x) => U(hb(x))); const r = await w.svFinal(ctx, i); nv++; if (r.state !== 'valid') badv++;
    }
  }
  R.ok(n >= 7 && bad === 0, 'BIP341: all ' + n + ' key-path signature hashes match the wallet test vectors (DEFAULT, ALL, NONE, SINGLE, ANYONECANPAY)');
  R.ok(badv === 0, 'BIP341: all ' + nv + ' published key-path signatures are VALID');
  let nc2 = 0, badc = 0;
  for (const sp of V.scriptPubKey) {
    if (!sp.given.scriptTree) continue;
    const leaves = []; const walk = (x) => Array.isArray(x) ? x.forEach(walk) : leaves.push(x); walk(sp.given.scriptTree);
    const out = hb(sp.expected.scriptPubKey).slice(2);
    for (let j = 0; j < leaves.length; j++) {
      const c = await w.svTapCommit(U(hb(sp.expected.scriptPathControlBlocks[j])), U(hb(leaves[j].script)), U(out)); nc2++;
      if (!c.ok || hx(c.leaf) !== sp.intermediary.leafHashes[j]) badc++;
      const wrong = hb(sp.expected.scriptPathControlBlocks[j]); wrong[0] ^= 1; if ((await w.svTapCommit(U(wrong), U(hb(leaves[j].script)), U(out))).ok) badc++;
    }
  }
  R.ok(nc2 >= 10 && badc === 0, 'BIP341: all ' + nc2 + ' script-path control blocks belong to their output key (leaf hashes match), and a wrong parity bit is refused'); }

// 4. Bitcoin Core tx_valid.json: transactions valid under every consensus rule. An input this page reads must never be called
// INVALID (a test may skip only relay rules, never DERSIG or NULLDUMMY); and one changed locktime, which every hash type covers,
// must make every VALID one INVALID.
{ const OPS = Object.fromEntries(Object.entries(btc.OP).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k.replace(/^OP_/, ''), v]));
  Object.assign(OPS, { NOP2: 0xb1, NOP3: 0xb2, FALSE: 0, TRUE: 0x51, '0': 0 });
  const num = (n) => { if (n === 0) return [0]; if (n === -1) return [0x4f]; if (n >= 1 && n <= 16) return [0x50 + n]; const neg = n < 0; let a = Math.abs(n); const b = []; while (a) { b.push(a & 255); a = Math.floor(a / 256); } if (b[b.length - 1] & 0x80) b.push(neg ? 0x80 : 0); else if (neg) b[b.length - 1] |= 0x80; return [b.length, ...b]; };
  const asm = (s) => { const o = []; for (const t of s.trim().split(/\s+/).filter(Boolean)) {
    if (/^-?\d+$/.test(t)) o.push(...num(+t)); else if (/^0x[0-9a-f]*$/i.test(t)) o.push(...hb(t.slice(2))); else if (/^'.*'$/.test(t)) { const d = Buffer.from(t.slice(1, -1)); o.push(...(d.length < 76 ? [d.length] : [0x4c, d.length]), ...d); }
    else { const k = t.replace(/^OP_/, ''); if (!(k in OPS)) throw new Error('opcode ' + t); o.push(OPS[k]); } } return Uint8Array.from(o); };
  const POLICY = new Set(['NONE', 'LOW_S', 'STRICTENC', 'NULLFAIL', 'CLEANSTACK', 'MINIMALDATA', 'SIGPUSHONLY', 'CONST_SCRIPTCODE', 'DISCOURAGE_UPGRADABLE_WITNESS_PROGRAM']);
  const V = JSON.parse(fs.readFileSync(FX('core-tx_valid.json'), 'utf8')).filter((v) => v.length === 3 && Array.isArray(v[0]) && v[2].split(',').every((f) => POLICY.has(f)));
  let n = 0, nValid = 0, nNa = 0, wrong = [], kept = 0, types = new Set();
  for (const [prev, txh] of V) {
    const t = model(txh), coins = t.ins.map((x) => { const p = prev.find((q) => q[0] === hx(x.prev.slice().reverse()) && (q[1] >>> 0) === x.vout); return p ? { amount: BigInt(p[3] || 0), script: asm(p[2]) } : null; });
    const rs = await w.svCheckRaw(U(hb(txh)), coins.map((c) => c && { amount: c.amount, script: U(c.script) }));
    rs.forEach((r, i) => { n++; if (r.state === 'valid') { nValid++; types.add(coins[i].script.length + ':' + coins[i].script[0]); } else if (r.state === 'unchecked') nNa++; else if (r.state === 'invalid') wrong.push(txh.slice(0, 20) + ' input ' + i + ': ' + r.why); });
    if (rs.some((r) => r.state === 'valid')) { const b = hb(txh); b[b.length - 1] ^= 1; const rs2 = await w.svCheckRaw(U(b), coins.map((c) => c && { amount: c.amount, script: U(c.script) }));
      rs.forEach((r, i) => { if (r.state === 'valid' && rs2[i].state === 'valid') kept++; }); }
  }
  R.ok(wrong.length === 0, 'Bitcoin Core tx_valid.json: none of the ' + n + ' inputs of ' + V.length + ' valid transactions is called INVALID (' + nValid + ' VALID, ' + nNa + ' NOT CHECKED)' + (wrong.length ? ': ' + wrong.slice(0, 3).join(' | ') : ''));
  R.ok(nValid >= 40 && types.size >= 4, 'Bitcoin Core tx_valid.json: at least 40 inputs of at least 4 coin types are checked as VALID (' + nValid + ', ' + types.size + ' types)');
  R.ok(kept <= 2, 'Bitcoin Core tx_valid.json: a changed locktime makes the VALID signatures INVALID (' + kept + ' stay valid: only the SIGHASH_SINGLE quirk, whose hash is the number 1, may)'); }

// 5. PSBTs built and signed by @scure/btc-signer: every address type the page reads, every sighash type. Each input must be VALID
// as a partly signed PSBT, as a finalized PSBT and as a raw transaction with its coins; the page's signature hashes must equal the
// library's; and a changed output amount must make every signature that covers it INVALID.
const key = (s) => nc.createHash('sha256').update('voidforge sigcheck ' + s).digest();
const pub = (k) => secp256k1.getPublicKey(k, true), xo = (k) => schnorr.getPublicKey(k);
const K = [0, 1, 2].map((j) => key('k' + j));
const TYPES = {
  pkh: { pay: () => btc.p2pkh(pub(K[0])), keys: [K[0]], legacy: true },
  pk: { pay: () => btc.p2pk(pub(K[0])), keys: [K[0]], legacy: true },
  ms: { pay: () => btc.p2ms(2, K.map(pub)), keys: [K[0], K[2]], legacy: true },
  'sh-ms': { pay: () => btc.p2sh(btc.p2ms(2, K.map(pub))), keys: [K[1], K[2]], legacy: true },
  wpkh: { pay: () => btc.p2wpkh(pub(K[0])), keys: [K[0]] },
  'sh-wpkh': { pay: () => btc.p2sh(btc.p2wpkh(pub(K[0]))), keys: [K[0]] },
  'wsh-ms': { pay: () => btc.p2wsh(btc.p2ms(2, K.map(pub))), keys: [K[0], K[1]] },
  'sh-wsh-ms': { pay: () => btc.p2sh(btc.p2wsh(btc.p2ms(2, K.map(pub)))), keys: [K[0], K[2]] },
  tr: { pay: () => btc.p2tr(xo(K[0])), keys: [K[0]], tr: true },
  'tr-pk': { pay: () => btc.p2tr(xo(key('internal')), [btc.p2tr_pk(xo(K[1]))], undefined, true), keys: [K[1]], tr: true },
  'tr-ms': { pay: () => btc.p2tr(xo(key('internal')), [btc.p2tr_ms(2, K.map(xo))], undefined, true), keys: [K[0], K[2]], tr: true },
};
const SH = { DEFAULT: 0, ALL: 1, NONE: 2, SINGLE: 3, ALL_ACP: 0x81, NONE_ACP: 0x82, SINGLE_ACP: 0x83 };
function build(type, ht) {
  const T = TYPES[type], p = T.pay(), other = btc.p2wpkh(pub(key('other')));
  const fund = btc.RawTx.encode({ version: 2, segwitFlag: false, inputs: [{ txid: new Uint8Array(32).fill(7), index: 0, finalScriptSig: new Uint8Array(0), sequence: 0xffffffff }], outputs: [{ amount: 50000n, script: other.script }, { amount: 70000n + BigInt(ht), script: p.script }], witnesses: [], lockTime: 0 });
  const fid = nc.createHash('sha256').update(nc.createHash('sha256').update(fund).digest()).digest().reverse();
  const tx = new btc.Transaction({ allowUnknownOutputs: true, allowLegacyWitnessUtxo: true, disableScriptCheck: true, version: 2, lockTime: 800000 });
  tx.addInput({ txid: fid, index: 0, witnessUtxo: { script: other.script, amount: 50000n }, nonWitnessUtxo: fund, sequence: 0xfffffffd });
  const inp = { ...p, txid: fid, index: 1, sighashType: ht, sequence: 0xfffffffe, nonWitnessUtxo: fund }; delete inp.script; delete inp.type; delete inp.address; delete inp.tapInternalKey_; if (!T.legacy) inp.witnessUtxo = { script: p.script, amount: 70000n + BigInt(ht) };
  if (T.tr) { delete inp.nonWitnessUtxo; delete inp.redeemScript; delete inp.witnessScript; }
  tx.addInput(inp);
  for (const [j, a] of [[0, 30000n], [1, 40000n], [2, 20000n]]) tx.addOutput({ script: btc.p2wpkh(pub(key('out' + j))).script, amount: a });
  tx.signIdx(key('other'), 0);
  for (const k of T.keys) tx.signIdx(k, 1, [ht]);
  return { tx, coins: [{ amount: 50000n, script: other.script }, { amount: 70000n + BigInt(ht), script: p.script }], p };
}
async function inspect(bytes) { const res = await w.inspectPsbt(U(bytes), 'main'); await w.psbtSigCheck(res); return res; }
{ let n = 0; const fails = [];
  for (const type of Object.keys(TYPES)) for (const [hn, ht] of Object.entries(SH)) {
    if (ht === 0 && !TYPES[type].tr) continue;
    const tag = type + ' ' + hn;
    let b; try { b = build(type, ht); } catch (e) { fails.push(tag + ': btc-signer could not build it (' + e.message + ')'); continue; }
    n++;
    const part = await inspect(b.tx.toPSBT(0));
    if (states(part.ins.map((x) => x.sv)) !== 'valid,valid') fails.push(tag + ': partly signed PSBT ' + states(part.ins.map((x) => x.sv)) + ' ' + part.ins.map((x) => x.sv.why).join('|'));
    // the signature hash of input 1, against the library's own
    { const t = { version: 2, locktime: 800000, ins: part.ins.map((x) => ({ prev: U(hb(x.txid).reverse()), vout: x.vout, seq: x.seq, ss: U([]), wit: [] })), outs: part.outs.map((o) => ({ amount: o.amount, script: o.script })) };
      const ctx = ctxOf(t, b.coins), T = TYPES[type], inner = b.p.witnessScript || (b.p.redeemScript && !TYPES[type].legacy ? null : b.p.redeemScript) || b.p.script;
      let mine, lib;
      if (T.tr && type === 'tr') { mine = await w.svSighashTr(ctx, 1, ht, {}); lib = b.tx.preimageWitnessV1(1, b.coins.map((c) => c.script), ht, b.coins.map((c) => c.amount)); }
      else if (T.tr) { const [, ls] = b.p.tapLeafScript[0], sc = ls.slice(0, -1); mine = await w.svSighashTr(ctx, 1, ht, { leaf: await w.svTapLeafHash(0xc0, U(sc)) }); lib = b.tx.preimageWitnessV1(1, b.coins.map((c) => c.script), ht, b.coins.map((c) => c.amount), undefined, sc, 0xc0); }
      else if (T.legacy) { mine = await w.svSighashLegacy(ctx, 1, U(inner), ht); lib = b.tx.preimageLegacy(1, inner, ht); }
      else { const sc = b.p.witnessScript || btc.OutScript.encode({ type: 'pkh', hash: (b.p.redeemScript ? btc.OutScript.decode(b.p.redeemScript) : btc.OutScript.decode(b.p.script)).hash }); mine = await w.svSighashV0(ctx, 1, U(sc), b.coins[1].amount, ht); lib = b.tx.preimageWitnessV0(1, sc, ht, b.coins[1].amount); }
      if (hx(mine) !== hx(lib)) fails.push(tag + ': signature hash differs from btc-signer'); }
    b.tx.finalize();
    const fin = await inspect(b.tx.toPSBT(0));
    if (states(fin.ins.map((x) => x.sv)) !== 'valid,valid') fails.push(tag + ': finalized PSBT ' + states(fin.ins.map((x) => x.sv)) + ' ' + fin.ins.map((x) => x.sv.why).join('|'));
    const raw = b.tx.extract(), rs = await w.svCheckRaw(U(raw), b.coins.map((c) => ({ amount: c.amount, script: U(c.script) })));
    if (states(rs) !== 'valid,valid') fails.push(tag + ': raw transaction ' + states(rs) + ' ' + rs.map((x) => x.why).join('|'));
    const ri = (await w.inspectPsbt(U(raw), 'main')); await w.psbtSigCheck(ri);
    if (!ri.ins.every((x) => x.sv.state === 'unchecked' && /cannot check without the coins it spends/.test(x.sv.why))) fails.push(tag + ': a raw transaction alone is not NOT CHECKED');
    // output 1 paid 1 sat more: every signature that covers output 1 fails (ALL, and SINGLE for input 1; not NONE)
    const t2 = btc.Transaction.fromRaw(raw, { allowUnknownOutputs: true, disableScriptCheck: true }), o1 = t2.getOutput(1); t2.updateOutput(1, { amount: o1.amount + 1n }, true);
    const rs2 = await w.svCheckRaw(U(t2.extract ? t2.toBytes(true, true) : t2.hex), b.coins.map((c) => ({ amount: c.amount, script: U(c.script) })));
    const want = 'invalid,' + ((ht & 3) === 2 ? 'valid' : 'invalid');
    if (states(rs2) !== want) fails.push(tag + ': with output 1 changed ' + states(rs2) + ', want ' + want);
  }
  R.ok(n === 69 && fails.length === 0, 'btc-signer: ' + n + ' PSBTs (P2PKH, P2PK, bare multisig, P2SH multisig, P2WPKH, P2SH-P2WPKH, P2WSH and P2SH-P2WSH multisig, Taproot key path, <key> OP_CHECKSIG and multi_a leaves; every sighash type) are VALID partly signed, finalized and raw, hashes equal the library\'s, and a changed output is caught' + (fails.length ? ': ' + fails.slice(0, 4).join(' | ') : '')); }

// 6. Rules beyond the signature itself (each consensus rule INVALID, each relay rule a note, unsupported NOT CHECKED).
{ const b = build('wsh-ms', 1); b.tx.finalize(); const raw = b.tx.extract(), coins = b.coins.map((c) => ({ amount: c.amount, script: U(c.script) }));
  const t = w.svTxModel(U(raw)), run = async (f) => { const t2 = w.svTxModel(U(raw)); f(t2); const ctx = w.svCtx(t2, coins); return w.svFinal(ctx, 1); };
  const r1 = await run((t2) => { t2.ins[1].wit[0] = U([1]); });
  R.ok(r1.state === 'invalid' && /NULLDUMMY/.test(r1.why), 'rules: a multisig dummy item that is not empty is INVALID (NULLDUMMY)');
  const r2 = await run((t2) => { const a = t2.ins[1].wit[1]; t2.ins[1].wit[1] = t2.ins[1].wit[2]; t2.ins[1].wit[2] = a; });
  R.ok(r2.state === 'invalid' && /order of the keys/.test(r2.why), 'rules: multisig signatures out of key order are INVALID, and the page says why');
  const r3 = await run((t2) => { t2.ins[1].wit.splice(1, 0, U(new Uint8Array(521))); });
  R.ok(r3.state === 'invalid' && /520 bytes/.test(r3.why), 'rules: a witness item over 520 bytes is INVALID');
  const r4 = await run((t2) => { const s = t2.ins[1].wit[1], d = s.slice(0, -1), sig = secp256k1.Signature.fromDER(d), hi = new secp256k1.Signature(sig.r, secp256k1.CURVE.n - sig.s); t2.ins[1].wit[1] = U([...hi.toDERRawBytes(), s[s.length - 1]]); });
  R.ok(r4.state === 'valid' && [...r4.policy].some((x) => /low-S/.test(x)) && /relay rule, not a consensus rule/.test(w.svText(r4)), 'rules: a high-S signature is VALID by consensus, with a note that nodes will not relay it (policy)');
  const r5 = await run((t2) => { const s = t2.ins[1].wit[1]; t2.ins[1].wit[1] = U([0x30, s[1] + 1, ...s.slice(2, -1), 0, s[s.length - 1]]); });
  R.ok(r5.state === 'invalid' && /strict DER/.test(r5.why), 'rules: a signature that is not strict DER is INVALID (BIP66, consensus)');
  // wrapped SegWit: the unlocking script must be exactly one plain push
  { const b2 = build('sh-wpkh', 1); b2.tx.finalize(); const raw2 = b2.tx.extract(), c2 = b2.coins.map((c) => ({ amount: c.amount, script: U(c.script) }));
    const t2 = w.svTxModel(U(raw2)), rs = t2.ins[1].ss; t2.ins[1].ss = U([0x4c, ...rs]); const r = await w.svFinal(w.svCtx(t2, c2), 1);
    R.ok(r.state === 'invalid' && /exactly one plain push/.test(r.why), 'rules: wrapped SegWit with a PUSHDATA1 push (not the plain one) is INVALID');
    const t3 = w.svTxModel(U(raw2)); t3.ins[1].wit[1] = U(pub(K[1])); const r6 = await w.svFinal(w.svCtx(t3, c2), 1);
    R.ok(r6.state === 'invalid' && /hash this coin names/.test(r6.why), 'rules: a public key that is not the one of the key hash is INVALID'); }
  // P2PKH with an uncompressed key and a signature from @noble, checked against the legacy hash from btc-signer
  { const k = key('u'), pu = secp256k1.getPublicKey(k, false), spk = btc.OutScript.encode({ type: 'pkh', hash: btc.utils ? (await import('@noble/hashes/ripemd160')).ripemd160(nc.createHash('sha256').update(pu).digest()) : null });
    const fund = btc.RawTx.encode({ version: 1, segwitFlag: false, inputs: [{ txid: new Uint8Array(32).fill(3), index: 0, finalScriptSig: new Uint8Array(0), sequence: 0xffffffff }], outputs: [{ amount: 9000n, script: spk }], witnesses: [], lockTime: 0 });
    const tx = new btc.Transaction({ allowUnknownOutputs: true, disableScriptCheck: true, version: 1 });
    tx.addInput({ txid: nc.createHash('sha256').update(nc.createHash('sha256').update(fund).digest()).digest().reverse(), index: 0, nonWitnessUtxo: fund });
    tx.addOutput({ script: spk, amount: 8000n });
    const h = tx.preimageLegacy(0, spk, 1), sig = secp256k1.sign(h, k).toDERRawBytes();
    const ss = Uint8Array.from([sig.length + 1, ...sig, 1, 65, ...pu]);
    const t4 = w.svTxModel(U(tx.unsignedTx)); t4.ins[0].ss = U(ss); const r = await w.svFinal(w.svCtx(t4, [{ amount: 9000n, script: U(spk) }]), 0);
    R.ok(r.state === 'valid' && r.policy.size === 0, 'rules: P2PKH with an uncompressed key (legacy allows it) is VALID with no relay note'); }
  // Taproot: an undefined sighash byte, and SIGHASH_SINGLE without an output of the same number
  { const b3 = build('tr', 1); b3.tx.finalize(); const raw3 = b3.tx.extract(), c3 = b3.coins.map((c) => ({ amount: c.amount, script: U(c.script) }));
    const t5 = w.svTxModel(U(raw3)); t5.ins[1].wit[0] = U([...t5.ins[1].wit[0].slice(0, 64), 0x04]); const r = await w.svFinal(w.svCtx(t5, c3), 1);
    R.ok(r.state === 'invalid' && /undefined sighash type/.test(r.why), 'rules: a Taproot signature with sighash byte 0x04 is INVALID');
    const t6 = w.svTxModel(U(raw3)); const r7 = await w.svFinal(w.svCtx(t6, [c3[0], null]), 1);
    R.ok(r7.state === 'unchecked', 'rules: a Taproot signature (not ANYONECANPAY) with a coin missing is NOT CHECKED'); }
}

// 7. Work budget: a transaction with more signatures than the budget is checked up to the budget, then NOT CHECKED (never hangs).
{ const many = new btc.Transaction({ allowUnknownOutputs: true, disableScriptCheck: true }), coins = [], k = key('many');
  for (let i = 0; i < 130; i++) { const p = btc.p2wpkh(pub(k)); many.addInput({ txid: new Uint8Array(32).fill(i + 1), index: 0, witnessUtxo: { script: p.script, amount: 1000n } }); coins.push({ amount: 1000n, script: U(p.script) }); }
  many.addOutput({ script: btc.p2wpkh(pub(k)).script, amount: 1000n }); for (let i = 0; i < 130; i++) many.signIdx(k, i); many.finalize();
  const t0 = Date.now(), rs = await w.svCheckRaw(U(many.extract()), coins), sec = (Date.now() - t0) / 1000;
  const nv = rs.filter((r) => r.state === 'valid').length, nn = rs.filter((r) => r.state === 'unchecked').length;
  R.ok(nv === w.eval('SV_MAX_CHECKS') && nn === 130 - nv, 'budget: 130 signatures: the first ' + nv + ' are VALID, the rest NOT CHECKED (' + sec.toFixed(1) + ' s)'); }

R.done('sigcheck');
