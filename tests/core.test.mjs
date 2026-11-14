// VOIDFORGE against Bitcoin Core (Test upgrade). It starts Bitcoin Core on a private test network (regtest), then hands it
// what the page makes and checks that Core agrees, with real coins on that network:
// - the watch-only descriptors of every address type (checksum, the addresses they give, the page's "Import into Bitcoin
//   Core" commands run as written, and a payment to the page's first address shows up in that watch-only wallet);
// - a multisig descriptor (checksum and addresses), native and nested SegWit and (v2.11.0) Taproot, which is also imported and paid;
// - a transaction (PSBT) made by Core: the page's inspector shows the same outputs and fee;
// - a message signed by Core: the page says the signature is valid, and not valid for a changed message;
// - (v2.17.0) real regtest coins on every address type the practice signer signs (P2PKH, P2SH-P2WPKH, P2WPKH, P2TR key path, 2-of-3
//   P2WSH and P2SH-P2WSH), each spent by a PSBT the practice signer's own Approve transaction signs: Core combines its trimmed PSBT
//   with the original (and a second cosigner's for multisig), finalizes it, and testmempoolaccept accepts the transaction (Core's
//   script verification); a message the practice signer signs is valid for Core's verifymessage;
// - (v2.18.0) an Extra Life heir wallet made by the page: Core gives the same checksum and addresses, the heir's key alone (in a Core
//   descriptor wallet, and again with @scure/btc-signer) spends a coin only once it has waited N blocks, and the owner's key at once.
// Regtest uses the testnet address versions; its SegWit addresses start with bcrt1 where testnet's start with tb1, so those are
// compared by their witness program.
//
// Needs Bitcoin Core: BITCOIN_BIN=/path/to/bitcoin-x.y/bin node tests/core.test.mjs. Download it from bitcoincore.org and check
// SHA256SUMS and its signatures first (see RELEASING.md). Without BITCOIN_BIN it says SKIPPED.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nc from 'node:crypto';
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { bech32, bech32m } from '@scure/base';
import * as btc from '@scure/btc-signer';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 as nsha } from '@noble/hashes/sha256';
import { loadPage, ready, readHtml, makeReporter } from './harness.mjs';

const BIN = process.env.BITCOIN_BIN;
if (!BIN || !fs.existsSync(path.join(BIN, 'bitcoind'))) { console.log('CORE: SKIPPED (set BITCOIN_BIN to the bin folder of a checked Bitcoin Core download)'); process.exit(0); }
const R = makeReporter();
console.log('Bitcoin Core: ' + execFileSync(path.join(BIN, 'bitcoind'), ['-version']).toString().split('\n')[0]);

// ---- a private regtest node ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-core-')), port = 20000 + nc.randomInt(20000);
const node = spawn(path.join(BIN, 'bitcoind'), ['-regtest', '-datadir=' + dir, '-server', '-listen=0', '-rpcport=' + port, '-rpcuser=vf', '-rpcpassword=vf', '-fallbackfee=0.0001', '-printtoconsole=0'], { stdio: 'ignore' });
const stop = () => { try { node.kill('SIGTERM'); } catch (e) { /* gone */ } };
process.on('exit', () => { stop(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* leave it */ } });
async function rpc(method, params = [], wallet) {
  for (let k = 0; ; k++) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + (wallet ? '/wallet/' + encodeURIComponent(wallet) : '/'), { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('vf:vf').toString('base64') }, body: JSON.stringify({ jsonrpc: '1.0', id: 1, method, params }) });
      const j = await r.json(); if (j.error) { if (j.error.code === -28 && k < 100) { await new Promise((x) => setTimeout(x, 300)); continue; } throw new Error(method + ': ' + j.error.message); }
      return j.result;
    } catch (e) { if (k < 100 && /fetch failed|ECONNREFUSED/.test(String(e.cause || e))) { await new Promise((x) => setTimeout(x, 300)); continue; } throw e; }
  }
}
// tb1... (page, testnet) and bcrt1... (Core, regtest) name the same witness program.
const prog = (a) => { if (!/^(tb1|bcrt1)/.test(a)) return a; const lib = /^(tb1p|bcrt1p)/.test(a) ? bech32m : bech32; const d = lib.decode(a, 120); return d.words[0] + ':' + Buffer.from(lib.fromWords(d.words.slice(1))).toString('hex'); };
const same = (a, b) => prog(a) === prog(b);

try {
  await rpc('getblockchaininfo');
  await rpc('createwallet', ['miner']);
  const mine = async (n) => rpc('generatetoaddress', [n, await rpc('getnewaddress', [], 'miner')]);
  await mine(101);

  const w = await ready(loadPage(readHtml())), $ = (id) => w.document.getElementById(id);
  const words = entropyToMnemonic(nc.randomBytes(16), wordlist), pass = 'core-' + nc.randomBytes(4).toString('hex');
  const seed = await w.mnemonicToSeed(words, pass);

  // ---- 1. watch-only descriptors and the Import into Bitcoin Core commands, every address type ----
  const coreType = { wpkh: 'bech32', tr: 'bech32m', 'sh-wpkh': 'p2sh-segwit', pkh: 'legacy' };
  for (const type of ['wpkh', 'tr', 'sh-wpkh', 'pkh']) for (const acct of [0, 3]) {
    const wx = await w.watchOnlyFromSeed(seed, type, acct, 'test');
    const label = type + ' account ' + acct;
    const infoR = await rpc('getdescriptorinfo', [wx.receive]), infoC = await rpc('getdescriptorinfo', [wx.change]);
    R.ok(wx.receive.endsWith('#' + infoR.checksum) && wx.change.endsWith('#' + infoC.checksum), label + ': Core gives the same descriptor checksums');
    const coreAddrs = await rpc('deriveaddresses', [wx.receive, [0, 9]]), pageAddrs = (await w.walletAddresses(seed, type, 'test', acct, 0, 0, 10)).map((x) => x.address);
    R.ok(coreAddrs.length === 10 && coreAddrs.every((a, i) => same(a, pageAddrs[i])), label + ': Core derives the same first 10 receive addresses');
    const coreChange = await rpc('deriveaddresses', [wx.change, [0, 4]]), pageChange = (await w.walletAddresses(seed, type, 'test', acct, 1, 0, 5)).map((x) => x.address);
    R.ok(coreChange.every((a, i) => same(a, pageChange[i])), label + ': Core derives the same first 5 change addresses');
    // the page's own command text, run as written (only the wallet name is made unique)
    const cmd = w.coreImportText(wx.receive, wx.change, '0'), name = 'watch-' + type + '-' + acct;
    const lines = cmd.split('\n'), cw = lines[0].match(/^bitcoin-cli createwallet "voidforge-watch" (.*)$/), im = lines[1].match(/^bitcoin-cli -rpcwallet=voidforge-watch importdescriptors '(.*)'$/);
    R.ok(!!cw && !!im, label + ': the page gives a createwallet and an importdescriptors command');
    const cargs = cw[1].split(' ').map((x) => x === 'true' ? true : x === 'false' ? false : x === '""' ? '' : x);
    await rpc('createwallet', [name, ...cargs]);
    const res = await rpc('importdescriptors', [JSON.parse(im[1])], name);
    R.ok(res.length === 2 && res.every((x) => x.success), label + ': Core imports the descriptors from the page\'s command');
    const first = await rpc('getnewaddress', ['', coreType[type]], name);
    R.ok(same(first, pageAddrs[0]), label + ': the watch-only wallet\'s first new address is the page\'s first address');
    if (acct === 0) {
      const amt = (100 + nc.randomInt(90)) / 100;
      await rpc('sendtoaddress', [first, amt], 'miner'); await mine(1);
      const b = await rpc('getbalances', [], name);
      R.ok(Math.abs(b.mine.trusted - amt) < 1e-8, label + ': a payment to the page\'s first address shows in the watch-only wallet (' + amt + ' regtest BTC)');
    }
  }

  // ---- 2. a transaction (PSBT) from Core, read by the page's inspector ----
  { const to = await rpc('getnewaddress', ['', 'bech32'], 'miner');
    // psbt_version 0: Bitcoin Core 32 makes version 2 by default, which the page does not read yet (it says so; see below)
    const p = await rpc('walletcreatefundedpsbt', [[], [{ [to]: 0.4 }], 0, { includeWatching: true, changeAddress: await rpc('getrawchangeaddress', ['bech32'], 'watch-wpkh-0') }, true, 2, 0], 'watch-wpkh-0');
    const dec = await rpc('decodepsbt', [p.psbt]);
    $('psbtInput').value = p.psbt; $('psbtNet').value = 'test'; await w.runPsbt();
    const out = $('psbtOut').textContent, st = $('psbtStatus').textContent;
    const outs = dec.tx.vout.map((o) => ({ a: o.scriptPubKey.address, v: o.value }));
    const tbOf = (a) => { const d = bech32.decode(a); return bech32.encode('tb', d.words); };
    R.ok(outs.every((o) => out.includes(tbOf(o.a))), 'PSBT: every output address Core put in is shown (as tb1)' + (outs.every((o) => out.includes(tbOf(o.a))) ? '' : ' [' + out.slice(0, 300) + ']'));
    const sats = (v) => '(' + Math.round(v * 1e8) + ' sats)';
    R.ok(outs.every((o) => out.includes(sats(o.v))), 'PSBT: every output amount is shown, to the satoshi');
    R.ok(out.includes(sats(dec.fee)) || st.includes(sats(dec.fee)), 'PSBT: the fee is the one Core worked out ' + sats(dec.fee));
    // PSBT version 2 (BIP370), Core 32's default: the same outputs, fee and counts as Core gives
    const p2 = await rpc('walletcreatefundedpsbt', [[], [{ [to]: 0.1 }], 0, { includeWatching: true }], 'watch-wpkh-0'), d2 = await rpc('decodepsbt', [p2.psbt]);
    R.ok(d2.psbt_version === 2, 'PSBT version 2: Core made a version 2 PSBT');
    $('psbtInput').value = p2.psbt; await w.runPsbt(); const o2 = $('psbtOut').textContent;
    R.ok(/^PSBT version 2\./.test(o2) && d2.outputs.every((o, i) => o2.includes(tbOf(o.script.address)) && o2.includes(sats(o.amount))) && o2.includes(sats(d2.fee)), 'PSBT version 2: the page reads it, with every output and the fee Core gives' + (/^PSBT version 2\./.test(o2) ? '' : ' [' + $('psbtStatus').textContent + ']'));
    const v2res = await w.inspectPsbt(w.psbtFromText(p2.psbt), 'test');
    R.ok(v2res.ins.length === d2.input_count && v2res.outs.length === d2.output_count && v2res.version === d2.tx_version, 'PSBT version 2: inputs, outputs and transaction version as Core counts them');
    // the transaction ID the page works out for an unsigned version 2 PSBT is the ID of the transaction once Core signs it (SegWit inputs)
    const sw = (await rpc('listunspent', [1], 'miner')).find((u) => /^bcrt1q/.test(u.address) && u.amount > 0.5);   // a SegWit coin: signing it leaves the transaction ID unchanged
    const pm = await rpc('walletcreatefundedpsbt', [[{ txid: sw.txid, vout: sw.vout }], [{ [to]: 0.2 }], 0, { add_inputs: false, change_type: 'bech32' }], 'miner'), signed = await rpc('walletprocesspsbt', [pm.psbt], 'miner'), fin = await rpc('finalizepsbt', [signed.psbt]);
    const coreTxid = (await rpc('decoderawtransaction', [fin.hex])).txid, pageTxid = (await w.inspectPsbt(w.psbtFromText(pm.psbt), 'test')).txid;
    R.ok(coreTxid === pageTxid, 'PSBT version 2: the page works out the same transaction ID as the transaction Core signs (' + coreTxid.slice(0, 16) + '...)');
    // Core's real change output, checked against the wallet's own key once its words are typed in CHECK A BACKUP
    $('phrase').value = words; $('verifyPass').value = pass; $('psbtInput').value = p.psbt; await w.runPsbt(); const oc = $('psbtOut').textContent;
    R.ok(/CHANGE, CHECKED: paid to this wallet's own key at m\/84'\/1'\/0'\/1\/\d+/.test(oc) && !/Do not sign/.test(oc), 'PSBT: Core\'s change output is checked as this wallet\'s own change once the words are typed');
    $('verifyPass').value = pass + 'x'; await w.runPsbt();
    R.ok(/another wallet's key information/.test($('psbtOut').textContent) && !/CHANGE, CHECKED/.test($('psbtOut').textContent), 'PSBT: with a wrong passphrase the change is not called this wallet\'s');
    $('phrase').value = ''; $('verifyPass').value = ''; }

  // ---- 3. a multisig descriptor (2 of 3, native and nested SegWit) ----
  { const cos = [];
    for (let i = 0; i < 3; i++) { const root = HDKey.fromMasterSeed(mnemonicToSeedSync(entropyToMnemonic(nc.randomBytes(16), wordlist), ''), { private: 0x04358394, public: 0x043587cf });   // testnet versions (tprv/tpub)
      for (const [type, s] of [['ms-wsh', 2], ['ms-sh-wsh', 1], ['ms-tr', 3]]) { const k = root.derive("m/48'/1'/0'/" + s + "'"), fp = root.fingerprint.toString(16).padStart(8, '0');
        (cos[type] = cos[type] || []).push({ fp, path: "48h/1h/0h/" + s + 'h', key: await w.parseExtendedKey(k.publicExtendedKey) }); } }
    for (const type of ['ms-wsh', 'ms-sh-wsh', 'ms-tr']) {
      const d = await w.multisigDescriptor(type, 2, cos[type], 0), info = await rpc('getdescriptorinfo', [d]);
      R.ok(d.endsWith('#' + info.checksum), type + ': Core gives the same descriptor checksum');
      const ca = await rpc('deriveaddresses', [d, [0, 4]]), pa = [];
      for (let i = 0; i < 5; i++) pa.push(await w.multisigAddress(type, 2, cos[type], 0, i, 'test'));
      R.ok(ca.every((a, i) => same(a, pa[i])), type + ': Core derives the same first 5 addresses');
    }
    // v2.11.0: the Taproot multisig wallet (tr(unspendable xpub, sortedmulti_a)): the change descriptor, the page's Import into
    // Bitcoin Core commands run as written, and a payment to its first address shows in the watch-only wallet
    { const dr = await w.multisigDescriptor('ms-tr', 2, cos['ms-tr'], 0), dc = await w.multisigDescriptor('ms-tr', 2, cos['ms-tr'], 1), ic = await rpc('getdescriptorinfo', [dc]);
      const cc = await rpc('deriveaddresses', [dc, [0, 4]]), pc = []; for (let i = 0; i < 5; i++) pc.push(await w.multisigAddress('ms-tr', 2, cos['ms-tr'], 1, i, 'test'));
      R.ok(dc.endsWith('#' + ic.checksum) && cc.every((a, i) => same(a, pc[i])), 'ms-tr: Core gives the same change descriptor checksum and first 5 change addresses');
      const lines = w.coreImportText(dr, dc, 'now').split('\n'), cw = lines[0].match(/^bitcoin-cli createwallet "voidforge-watch" (.*)$/), im = lines[1].match(/^bitcoin-cli -rpcwallet=voidforge-watch importdescriptors '(.*)'$/);
      await rpc('createwallet', ['watch-ms-tr', ...cw[1].split(' ').map((x) => x === 'true' ? true : x === 'false' ? false : x === '""' ? '' : x)]);
      const res = await rpc('importdescriptors', [JSON.parse(im[1])], 'watch-ms-tr');
      R.ok(res.length === 2 && res.every((x) => x.success), 'ms-tr: Core imports the Taproot multisig descriptors from the page\'s command');
      const first = await rpc('getnewaddress', ['', 'bech32m'], 'watch-ms-tr'), pa0 = await w.multisigAddress('ms-tr', 2, cos['ms-tr'], 0, 0, 'test');
      R.ok(same(first, pa0), 'ms-tr: the watch-only wallet\'s first new address is the page\'s first address');
      await rpc('sendtoaddress', [first, 0.5], 'miner'); await mine(1);
      R.ok(Math.abs((await rpc('getbalances', [], 'watch-ms-tr')).mine.trusted - 0.5) < 1e-8, 'ms-tr: a payment to the page\'s first Taproot multisig address shows in the watch-only wallet'); } }

  // ---- 4. a message signed by Core (legacy address, the classic BIP-137 format) ----
  { const a = await rpc('getnewaddress', ['', 'legacy'], 'miner'), msg = 'VOIDFORGE test ' + nc.randomBytes(4).toString('hex') + '\nsecond line', sig = await rpc('signmessage', [a, msg], 'miner');
    const vm = await w.verifyMessage(a, msg, sig);
    const one = 'one line ' + nc.randomBytes(3).toString('hex'), sig1 = await rpc('signmessage', [a, one], 'miner'), vm1 = await w.verifyMessage(a, one, sig1);
    R.ok(vm1.state === 'valid', 'signed message: the page accepts a one-line message Core signed');
    R.ok(vm.state === 'valid', 'signed message: the page accepts a two-line message Core signed');
    R.ok((await w.verifyMessage(a, msg + '.', sig)).state === 'invalid' || (await w.verifyMessage(a, msg + '.', sig)).state !== 'valid', 'signed message: the page rejects it for a changed message');
    R.ok((await rpc('verifymessage', [a, sig, msg])) === true, 'signed message: Core itself agrees it is valid'); }

  // ---- 5. v2.17.0: the practice signer signs real regtest coins; Core verifies the scripts (testmempoolaccept) ----
  { const E = (x) => w.eval(x), P8 = (b) => new (E('Uint8Array'))(b), SC = E('SSSettingsConstants'), H = 0x80000000;
    const REG = { bech32: 'bcrt', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
    const root = HDKey.fromMasterSeed(mnemonicToSeedSync(words, pass)), sd = await E('SSSeed').create({ mnemonic: words, passphrase: pass });
    const B = HDKey.fromMasterSeed(mnemonicToSeedSync(entropyToMnemonic(nc.randomBytes(16), wordlist), '')), C = HDKey.fromMasterSeed(mnemonicToSeedSync(entropyToMnemonic(nc.randomBytes(16), wordlist), ''));
    const der = (r, p) => ({ fingerprint: r.fingerprint, path: p.split('/').slice(1).map((x) => x.endsWith("'") ? parseInt(x) + H : +x) });
    Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => false });
    const devSign = async (b64) => { const ps = E('SSPSBT').parse(P8(Buffer.from(b64, 'base64'))), c = { psbt: ps, psbt_seed: sd, psbt_parser: await E('SSPSBTParser').create(ps, sd, SC.REGTEST) };
      const fv = Object.create(E('SSPSBTFinalizeView').prototype); fv.controller = c; fv.settings = { get_value: () => SC.REGTEST }; fv.run_screen = async () => 0; await fv.run();
      return c.psbt !== ps ? Buffer.from(c.psbt.serialize()).toString('base64') : null; };
    const back = await rpc('getnewaddress', ['', 'bech32'], 'miner');
    const kinds = [
      ['P2PKH', "m/44'/1'/0'/0/7", (k) => btc.p2pkh(k.publicKey, REG)],
      ['P2SH-P2WPKH', "m/49'/1'/0'/0/7", (k) => btc.p2sh(btc.p2wpkh(k.publicKey, REG), REG)],
      ['P2WPKH', "m/84'/1'/0'/0/7", (k) => btc.p2wpkh(k.publicKey, REG)],
      ['P2TR key path', "m/86'/1'/0'/0/7", (k) => btc.p2tr(k.publicKey.slice(1), undefined, REG)],
      ['2-of-3 P2WSH', "m/48'/1'/0'/2'", null],
      ['2-of-3 P2SH-P2WSH', "m/48'/1'/0'/1'", null],
    ];
    for (const [name, path, payOf] of kinds) {
      let pay, inp = {}, more = null;
      if (payOf) { const k = root.derive(path); pay = payOf(k);
        if (/P2TR/.test(name)) { const x = k.publicKey.slice(1); inp = { tapInternalKey: x, tapBip32Derivation: [[x, { hashes: [], der: der(root, path) }]] }; } else inp = { bip32Derivation: [[k.publicKey, der(root, path)]] }; }
      else { const accts = [root, B, C].map((r) => r.derive(path)), keys = accts.map((a) => a.deriveChild(0).deriveChild(0).publicKey), sorted = keys.slice().sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
        const inner = btc.p2wsh(btc.p2ms(2, sorted), REG); pay = /P2SH/.test(name) ? btc.p2sh(inner, REG) : inner;
        inp = { witnessScript: inner.witnessScript, bip32Derivation: keys.map((pk, j) => [pk, der([root, B, C][j], path + '/0/0')]) };
        more = (b64) => { const t2 = btc.Transaction.fromPSBT(Buffer.from(b64, 'base64')); t2.signIdx(B.derive(path + '/0/0').privateKey, 0); return Buffer.from(t2.toPSBT(0)).toString('base64'); }; }
      if (pay.redeemScript) inp.redeemScript = pay.redeemScript;
      const txid = await rpc('sendtoaddress', [pay.address, 1.0], 'miner'); await mine(1);
      const raw = (await rpc('gettransaction', [txid], 'miner')).hex, dec = await rpc('decoderawtransaction', [raw]), vout = dec.vout.findIndex((o) => o.scriptPubKey.address === pay.address);
      const tx = new btc.Transaction();
      tx.addInput({ txid, index: vout, ...(/P2PKH/.test(name) ? { nonWitnessUtxo: Buffer.from(raw, 'hex') } : { witnessUtxo: { script: pay.script, amount: 100000000n } }), ...inp });
      tx.addOutputAddress(back, 99990000n, REG);
      const orig = Buffer.from(tx.toPSBT(0)).toString('base64'), signed = await devSign(orig);
      if (!signed) { R.ok(false, 'practice signer, ' + name + ': the device signed nothing'); continue; }
      const parts = [orig, signed]; if (more) parts.push(more(orig));
      const comb = await rpc('combinepsbt', [parts]), fin = await rpc('finalizepsbt', [comb]);
      const acc = fin.complete ? (await rpc('testmempoolaccept', [[fin.hex]]))[0] : { allowed: false, 'reject-reason': 'not complete' };
      R.ok(fin.complete && acc.allowed === true, 'practice signer, ' + name + ': Core combines the signed PSBT' + (more ? ' (and a second cosigner\'s)' : '') + ', finalizes it, and testmempoolaccept accepts the transaction (' + (acc.allowed ? 'allowed' : acc['reject-reason']) + ')');
    }
    // a message signed by the practice signer's own view: Core's verifymessage agrees (legacy address)
    { const v = Object.create(E('SSSeedSignMessageSignedMessageQRView').prototype), msg = 'VOIDFORGE v2.17.0 ' + nc.randomBytes(3).toString('hex');
      v._ss_seed = sd; v._ss_derivation_path = "m/44h/1h/0h/0/3"; v._ss_message = msg; v.settings = { get_value: () => SC.REGTEST }; v.controller = { resume_main_flow: null, sign_message_data: {} }; v.run_screen = async () => 0; await v.run();
      const a = btc.p2pkh(root.derive("m/44'/1'/0'/0/3").publicKey, REG).address;
      R.ok((await rpc('verifymessage', [a, v.signed_message, msg])) === true, 'practice signer: a message it signs (legacy address ' + a.slice(0, 10) + '...) is valid for Core\'s verifymessage'); }
    delete w.navigator.onLine; }
  // ---- 6. v2.18.0 Extra Life: the page's timelocked heir wallet on regtest. Core accepts its descriptor (the same checksum and
  // addresses); with older(N) the heir's key ALONE spends a coin only once it has waited: a spend made and signed by Core (a wallet
  // holding only the heir's private key) is refused in the mempool (non-BIP68-final) while the tip is the coin's block + N - 2, and
  // accepted at + N - 1 (so it can be in block + N, the page's "earliest block"); a second tool (@scure/btc-signer) signs the same
  // heir spend; version 1 is refused (CSV fails); the owner's key spends at once. The page's inspector reads Core's PSBT.
  { const REG = { bech32: 'bcrt', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef }, N = 10, H = 0x80000000;
    const ownerWords = entropyToMnemonic(nc.randomBytes(16), wordlist), heirWords = entropyToMnemonic(nc.randomBytes(16), wordlist);
    const TV = { private: 0x04358394, public: 0x043587cf }, rO = HDKey.fromMasterSeed(mnemonicToSeedSync(ownerWords, ''), TV), rH = HDKey.fromMasterSeed(mnemonicToSeedSync(heirWords, ''), TV);   // tpub/tprv, as the page writes keys on regtest
    const kO = rO.derive("m/48'/1'/0'/2'"), kH = rH.derive("m/48'/1'/0'/2'");
    w.xlReset(); $('xlNet').value = 'regtest';
    $('phrase').value = ownerWords; await w.xlFromWords('owner'); $('phrase').value = heirWords; await w.xlFromWords('heir');
    $('xlBlocks').value = String(N); await w.xlMake(); const X = w.eval('xl');
    R.ok(!!X && !$('xlErr').textContent && /SHORT WAIT/.test($('xlWarn').textContent), 'Extra Life: the page makes a regtest heir wallet with older(' + N + ') (and warns that the wait is short)');
    const info = await rpc('getdescriptorinfo', [X.desc]);
    R.ok(X.desc.endsWith('#' + info.checksum) && info.isrange && !info.hasprivatekeys, 'Extra Life: Core accepts the descriptor and gives the same checksum (' + info.checksum + ')');
    const one = (b) => X.body.split('/<0;1>/*').join('/' + b + '/*');
    const ck = async (d) => d + '#' + (await rpc('getdescriptorinfo', [d])).checksum;
    const cr = await rpc('deriveaddresses', [await ck(one(0)), [0, 9]]), cc = await rpc('deriveaddresses', [await ck(one(1)), [0, 9]]);
    R.ok(cr.every((a, i) => a === X.recv[i]) && cc.every((a, i) => a === X.chg[i]), 'Extra Life: Core derives the same 10 receive and 10 change addresses as the page');
    // a wallet that holds only the heir's private key (the owner's key public), as the heir's Extra Life sheet says
    const tprvH = rH.derive("m/48'/1'/0'/2'").privateExtendedKey, fpH = rH.fingerprint.toString(16).padStart(8, '0');
    const heirDesc = (b) => one(b).replace('[' + fpH + '/48h/1h/0h/2h]' + kH.publicExtendedKey, '[' + fpH + '/48h/1h/0h/2h]' + tprvH);
    R.ok(heirDesc(0) !== one(0), 'Extra Life: the heir descriptor carries the heir\'s private key in place of the xpub');
    await rpc('createwallet', ['heir', false, true]);
    const imp = await rpc('importdescriptors', [[{ desc: await ck(heirDesc(0)), timestamp: 'now', active: true, internal: false, range: [0, 20] }, { desc: await ck(heirDesc(1)), timestamp: 'now', active: true, internal: true, range: [0, 20] }]], 'heir');
    R.ok(imp.every((x) => x.success), 'Extra Life: Core imports the heir\'s descriptors (heir private key, owner public key) into a descriptor wallet');
    const fund = async (a) => { const txid = await rpc('sendtoaddress', [a, 1.0], 'miner'); await mine(1); const raw = (await rpc('gettransaction', [txid], 'miner')).hex, dec = await rpc('decoderawtransaction', [raw]); return { txid, raw, vout: dec.vout.findIndex((o) => o.scriptPubKey.address === a), height: (await rpc('getblockcount')) }; };
    const c0 = await fund(X.recv[0]), back = await rpc('getnewaddress', ['', 'bech32'], 'miner');
    const coreSpend = async () => { const p = await rpc('walletcreatefundedpsbt', [[{ txid: c0.txid, vout: c0.vout, sequence: N }], [{ [back]: 0.9999 }], 0, { add_inputs: false, fee_rate: 10, changeAddress: X.chg[0] }], 'heir');
      const s = await rpc('walletprocesspsbt', [p.psbt, true, 'ALL'], 'heir'); const f = await rpc('finalizepsbt', [s.psbt]); return { psbt: p.psbt, fin: f }; };
    let sp = await coreSpend();
    R.ok(sp.fin.complete, 'Extra Life: Core signs and finalizes the heir\'s spend (nSequence ' + N + ', version 2) with the heir\'s key alone');
    { const rep = w.psbtReport(await w.inspectPsbt(w.psbtFromText(sp.psbt), 'regtest'), null);
      R.ok(new RegExp('SCRIPT WAIT, input 0: its script has older\\(' + N + '\\) on at least one way to spend; this transaction meets it\\.').test(rep) && /RELATIVE TIMELOCK, input 0: it can be mined only 10 blocks/.test(rep), 'Extra Life: the page\'s inspector reads Core\'s heir PSBT: the relative timelock, and that it meets the script\'s older()'); }
    // a second tool: @scure/btc-signer builds the same script and signs the same heir path from the heir's words
    const owner0 = kO.deriveChild(0).deriveChild(0), heir0 = kH.deriveChild(0).deriveChild(0), heirPriv = rH.derive("m/48'/1'/0'/2'/0/0").privateKey;
    const script = btc.Script.encode([owner0.publicKey, 'CHECKSIG', 'IFDUP', 'NOTIF', 'DUP', 'HASH160', ripemd160(nsha(heir0.publicKey)), 'EQUALVERIFY', 'CHECKSIGVERIFY', N, 'CHECKSEQUENCEVERIFY', 'ENDIF']);
    const pay = btc.p2wsh({ type: 'unknown', script }, REG);
    R.ok(pay.address === X.recv[0], 'Extra Life: @scure/btc-signer builds the same address from the same script');
    const scureSpend = (ver, seq, sign) => { const tx = new btc.Transaction({ version: ver, allowUnknownInputs: true });
      tx.addInput({ txid: c0.txid, index: c0.vout, sequence: seq, witnessUtxo: { script: pay.script, amount: 100000000n }, witnessScript: script });
      tx.addOutputAddress(back, 99990000n, REG); tx.signIdx(sign, 0, [btc.SigHash.ALL]); const sig = tx.getInput(0).partialSig[0][1];
      tx.updateInput(0, { finalScriptWitness: sign === heirPriv ? [sig, heir0.publicKey, new Uint8Array(0), script] : [sig, script] }, true); return Buffer.from(tx.extract()).toString("hex"); };
    const scureHex = scureSpend(2, N, heirPriv), test = async (hex) => (await rpc('testmempoolaccept', [[hex]]))[0];
    await mine(N - 2);   // the tip is now the coin's block + N - 2: the next block, + N - 1, is one block too early
    let acc = await test(sp.fin.hex), acc2 = await test(scureHex);
    R.ok(acc.allowed === false && /non-BIP68-final/.test(acc['reject-reason'] || ''), 'Extra Life: one block before the wait ends, the heir\'s spend signed by Core is refused (' + (acc['reject-reason'] || 'allowed') + ') with the tip at the coin\'s block + ' + (N - 2));
    R.ok(acc2.allowed === false && /non-BIP68-final/.test(acc2['reject-reason'] || ''), 'Extra Life: one block before the wait ends, the heir\'s spend signed by the second tool (@scure/btc-signer) is refused too (' + (acc2['reject-reason'] || 'allowed') + ')');
    await mine(1);       // + N - 1: the next block is + N, the earliest block the page names
    acc = await test(sp.fin.hex); acc2 = await test(scureHex);
    R.ok(acc.allowed === true, 'Extra Life: once the coin has waited, the heir\'s key alone spends it, signed by Core (accepted for block ' + (c0.height + N) + ' = the coin\'s block + ' + N + ') ' + (acc['reject-reason'] || ''));
    R.ok(acc2.allowed === true, 'Extra Life: at the same boundary the second tool\'s heir spend is accepted ' + (acc2['reject-reason'] || ''));
    acc = await test(scureSpend(1, N, heirPriv));
    R.ok(acc.allowed === false, 'Extra Life: the same heir spend as transaction version 1 is refused (' + (acc['reject-reason'] || 'allowed') + ')');
    acc = await test(scureSpend(2, N - 1, heirPriv));
    R.ok(acc.allowed === false, 'Extra Life: a heir spend with nSequence ' + (N - 1) + ' is refused (' + (acc['reject-reason'] || 'allowed') + ')');
    { const id = await rpc('sendrawtransaction', [scureHex]); await mine(1); const blk = await rpc('getblock', [await rpc('getblockhash', [c0.height + N])]);
      R.ok(blk.tx.includes(id), 'Extra Life: the second tool\'s heir spend is mined in block ' + (c0.height + N) + ', the coin\'s block + ' + N + ', the earliest the page says'); }
    // after(H) by height: the page says the first block is H + 1. A heir spend with nLockTime H is refused while the next block is H
    // and accepted when it is H + 1 (Core's IsFinalTx: the locktime must be below the block height); mined in block H + 1.
    { const tip = await rpc('getblockcount'), H = tip + 6; w.xlBack(); $('xlClock').value = 'height'; $('xlAfterH').value = String(H); $('xlNow').value = String(tip); await w.xlMake(); const Y = w.eval('xl');
      R.ok(!!Y && Y.desc.includes('after(' + H + ')') && /from block [\d,]+ on/.test($('xlHead').textContent) && $('xlHead').textContent.includes((H + 1).toLocaleString('en-US')), 'Extra Life after(' + H + '): the page says the heir\'s key opens from block ' + (H + 1));
      R.ok(Y.desc.endsWith('#' + (await rpc('getdescriptorinfo', [Y.desc])).checksum), 'Extra Life after(): Core gives the same checksum');
      const c2 = await fund(Y.recv[0]), o0 = kO.deriveChild(0).deriveChild(0), sc2 = btc.Script.encode([o0.publicKey, 'CHECKSIG', 'IFDUP', 'NOTIF', 'DUP', 'HASH160', ripemd160(nsha(heir0.publicKey)), 'EQUALVERIFY', 'CHECKSIGVERIFY', btc.ScriptNum().encode(BigInt(H)), 'CHECKLOCKTIMEVERIFY', 'ENDIF']);
      const p2 = btc.p2wsh({ type: 'unknown', script: sc2 }, REG); R.ok(p2.address === Y.recv[0], 'Extra Life after(): @scure/btc-signer builds the same address');
      const tx = new btc.Transaction({ version: 2, lockTime: H, allowUnknownInputs: true }); tx.addInput({ txid: c2.txid, index: c2.vout, sequence: 0xfffffffe, witnessUtxo: { script: p2.script, amount: 100000000n }, witnessScript: sc2 });
      tx.addOutputAddress(back, 99990000n, REG); tx.signIdx(heirPriv, 0, [btc.SigHash.ALL]); tx.updateInput(0, { finalScriptWitness: [tx.getInput(0).partialSig[0][1], heir0.publicKey, new Uint8Array(0), sc2] }, true);
      const hx = Buffer.from(tx.extract()).toString('hex');
      await mine(H - 1 - (await rpc('getblockcount')));   // the tip is H - 1: the next block is H
      let a2 = await test(hx); R.ok(a2.allowed === false && /non-final/.test(a2['reject-reason'] || ''), 'Extra Life after(' + H + '): while the next block is ' + H + ' the heir\'s spend is refused (' + (a2['reject-reason'] || 'allowed') + ')');
      await mine(1); a2 = await test(hx); R.ok(a2.allowed === true, 'Extra Life after(' + H + '): when the next block is ' + (H + 1) + ' it is accepted ' + (a2['reject-reason'] || ''));
      const id = await rpc('sendrawtransaction', [hx]); await mine(1); R.ok((await rpc('getblock', [await rpc('getblockhash', [H + 1])])).tx.includes(id), 'Extra Life after(' + H + '): the heir\'s spend is mined in block ' + (H + 1));
      w.xlBack(); $('xlClock').value = 'older'; }
    // the owner's key spends a fresh coin at once
    { const c1 = await fund(X.recv[1]), o1 = kO.deriveChild(0).deriveChild(1), h1 = kH.deriveChild(0).deriveChild(1), oPriv = rO.derive("m/48'/1'/0'/2'/0/1").privateKey;
      const s1 = btc.Script.encode([o1.publicKey, 'CHECKSIG', 'IFDUP', 'NOTIF', 'DUP', 'HASH160', ripemd160(nsha(h1.publicKey)), 'EQUALVERIFY', 'CHECKSIGVERIFY', N, 'CHECKSEQUENCEVERIFY', 'ENDIF']);
      const p1 = btc.p2wsh({ type: 'unknown', script: s1 }, REG), tx = new btc.Transaction({ version: 2, allowUnknownInputs: true });
      tx.addInput({ txid: c1.txid, index: c1.vout, sequence: 0xfffffffd, witnessUtxo: { script: p1.script, amount: 100000000n }, witnessScript: s1 }); tx.addOutputAddress(back, 99990000n, REG);
      tx.signIdx(oPriv, 0, [btc.SigHash.ALL]); tx.updateInput(0, { finalScriptWitness: [tx.getInput(0).partialSig[0][1], s1] }, true);
      acc = (await rpc('testmempoolaccept', [[Buffer.from(tx.extract()).toString("hex")]]))[0];
      R.ok(p1.address === X.recv[1] && acc.allowed === true, 'Extra Life: the owner\'s key spends a coin at once, with no wait ' + (acc['reject-reason'] || '')); }
    w.xlReset(); }
} catch (e) { R.ok(false, 'the test stopped: ' + e.message); }
stop();
R.done('core');
