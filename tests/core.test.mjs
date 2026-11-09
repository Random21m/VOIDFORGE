// VOIDFORGE against Bitcoin Core (Test upgrade). It starts Bitcoin Core on a private test network (regtest), then hands it
// what the page makes and checks that Core agrees, with real coins on that network:
// - the watch-only descriptors of every address type (checksum, the addresses they give, the page's "Import into Bitcoin
//   Core" commands run as written, and a payment to the page's first address shows up in that watch-only wallet);
// - a multisig descriptor (checksum and addresses), native and nested SegWit and (v2.11.0) Taproot, which is also imported and paid;
// - a transaction (PSBT) made by Core: the page's inspector shows the same outputs and fee;
// - a message signed by Core: the page says the signature is valid, and not valid for a changed message.
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
} catch (e) { R.ok(false, 'the test stopped: ' + e.message); }
stop();
R.done('core');
