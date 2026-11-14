// Adds Bitcoin Core's own verdicts to tests/fixtures/miniscript-core.json: for each descriptor below, getdescriptorinfo (the checksum,
// or the error Core gives) and deriveaddresses with range [0,11] on both branches of <0;1>. Core runs offline (mainnet chain
// parameters, -connect=0 -listen=0, a throwaway data folder) and is stopped afterwards. Only public test keys are used: BIP48 keys
// of BIP39 test vectors (abandon ... about, legal winner ...) and the BIP32 test vector keys already in the file.
// Run: BITCOIN_BIN=/path/to/bitcoin-32.1/bin node tests/fixtures/gen_miniscript_core.mjs   (tests/test.js then checks the page
// against every case: the same checksum and addresses, or a refusal where Core refuses.)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nc from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';

const BIN = process.env.BITCOIN_BIN, FX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'miniscript-core.json');
if (!BIN) { console.log('set BITCOIN_BIN'); process.exit(1); }
const key = (m, acct = 0) => { const r = HDKey.fromMasterSeed(mnemonicToSeedSync(m, '')); return '[' + r.fingerprint.toString(16).padStart(8, '0') + '/48h/0h/' + acct + 'h/2h]' + r.derive(`m/48'/0'/${acct}'/2'`).publicExtendedKey; };
const AB = 'abandon '.repeat(11) + 'about', LW = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const O = key(AB), H = key(LW), O1 = key(AB, 1);
const XL = (lock, heir = H + '/<0;1>/*') => `wsh(or_d(pk(${O}/<0;1>/*),and_v(v:pkh(${heir}),${lock})))`;
const fx = JSON.parse(fs.readFileSync(FX, 'utf8')), A = fx.cases.older52560.desc.match(/pk\((\[aaaaaaaa[^)]*)\)/)[1], B = fx.cases.older52560.desc.match(/pkh\((\[bbbbbbbb[^)]*)\)/)[1];
const NEW = {
  // Extra Life, as the page makes it (owner abandon ... about, heir legal winner ..., m/48'/0'/0'/2')
  heir_older1: XL('older(1)'), heir_older52560: XL('older(52560)'), heir_older65535: XL('older(65535)'),
  heir_after1030000: XL('after(1030000)'), heir_after_date: XL('after(1906502400)'), heir_after499999999: XL('after(499999999)'),
  heir_same_seed: XL('older(52560)', O + '/<2;3>/*'), heir_same_seed_acct1: XL('older(52560)', O1 + '/<0;1>/*'),
  // values Core accepts but Bitcoin reads differently (the page explains them with a warning, and never makes them)
  heir_older65536: XL('older(65536)'), heir_older2147483647: XL('older(2147483647)'),
  // the page's other assumptions, checked against Core
  x_heir_older0144: XL('older(0144)'), x_heir_plus: XL('older(+5)'), x_heir_neg: XL('older(-5)'), x_heir_space: XL('older( 5)'),
  x_heir_dup: XL('older(52560)', O + '/<0;1>/*'), x_heir_dup_first: XL('older(52560)', O + '/0/*'), x_heir_mixed: XL('and_v(v:after(1030000),after(1906502400))'),
  x_heir_nokey: `wsh(or_d(pk(${O}/<0;1>/*),older(52560)))`, x_heir_sh: `sh(or_d(pk(${O}/<0;1>/*),and_v(v:pkh(${H}/<0;1>/*),older(52560))))`,
  x_multi_dup: `wsh(multi(1,${A},${A}))`, x_sortedmulti_inner: `wsh(or_d(sortedmulti(1,${A},${B}),and_v(v:pkh(${O}/<0;1>/*),older(10))))`,
  x_tr_one_leaf_braces: `tr(${A},{pk(${B})})`, x_tr_one_leaf: `tr(${A},pk(${B}))`, x_multi_plus: `wsh(multi(+1,${A},${B}))`,
  x_thresh_k0: `wsh(thresh(0,pk(${A}),s:pk(${B})))`, x_andv_extra: `wsh(and_v(v:pk(${A}),v:pk(${B}),older(100)))`,
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vf-coreoracle-')), port = 20000 + nc.randomInt(20000);
console.log(execFileSync(path.join(BIN, 'bitcoind'), ['-version']).toString().split('\n')[0]);
const node = spawn(path.join(BIN, 'bitcoind'), ['-datadir=' + dir, '-connect=0', '-listen=0', '-dnsseed=0', '-server', '-rpcport=' + port, '-rpcuser=vf', '-rpcpassword=vf', '-printtoconsole=0'], { stdio: 'ignore' });
const stop = () => { try { node.kill('SIGTERM'); } catch (e) { /* gone */ } };
process.on('exit', () => { stop(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* leave it */ } });
async function rpc(method, params = []) {
  for (let k = 0; ; k++) {
    try { const r = await fetch('http://127.0.0.1:' + port + '/', { method: 'POST', headers: { authorization: 'Basic ' + Buffer.from('vf:vf').toString('base64') }, body: JSON.stringify({ jsonrpc: '1.0', id: 1, method, params }) });
      const j = await r.json(); if (j.error) { if (j.error.code === -28 && k < 200) { await new Promise((x) => setTimeout(x, 300)); continue; } return { error: j.error.message }; } return j.result; }
    catch (e) { if (k < 200) { await new Promise((x) => setTimeout(x, 300)); continue; } throw e; }
  }
}
for (const [k, desc] of Object.entries(NEW)) {
  const info = await rpc('getdescriptorinfo', [desc]);
  if (info.error) { fx.cases[k] = { desc, error: info.error }; console.log(k, 'ERROR', info.error.slice(0, 100)); continue; }
  const full = desc + '#' + info.checksum, range = /</.test(desc), a = await rpc('deriveaddresses', range ? [full, [0, 11]] : [full]);
  if (a.error) { fx.cases[k] = { desc, error: a.error }; console.log(k, 'ERROR (addresses)', a.error.slice(0, 100)); continue; }
  const [rec, chg] = Array.isArray(a[0]) ? a : [a, a];
  fx.cases[k] = { desc, checksum: info.checksum, receive: rec, change: chg }; console.log(k, info.checksum, rec[0]);
}
fx.source = fx.source.replace(/ Made for the v2\.18\.0 review\./, ' Made for the v2.18.0 review, and (gen_miniscript_core.mjs) for Extra Life and the reader\'s other rules.');
fs.writeFileSync(FX, JSON.stringify(fx, null, 1) + '\n');
stop(); process.exit(0);
