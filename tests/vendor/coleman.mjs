// Ian Coleman's own entropy code (https://github.com/iancoleman/bip39), as a function for tests/coleman.test.mjs.
// tests/vendor/fetch.sh downloads three files of that repository at the pinned commit below into tests/vendor/src/iancoleman
// (not committed; MIT License), and their SHA-256 is checked here before anything is read. Only the pure parts are run, each in its own empty vm context:
// - src/js/entropy.js: Entropy.fromString, how typed cards become bits (5, 4 or 2 bits a card).
// - src/js/index.js: only the function setMnemonicFromEntropy, cut out by its first and last lines: raw entropy (keep whole
//   32-bit blocks, drop the first bits) or a number of words (SHA-256 of the card text, its first bits).
// - src/js/jsbip39.js: Mnemonic.toMnemonic, the bytes to the words with the checksum.
// The page (jQuery DOM) and the libraries are replaced by small stand-ins: SHA-256 from Node for sjcl, BigInt for BigInteger,
// and the word list from @scure/bip39. Nothing else from the repository is run.
import fs from 'node:fs';
import nc from 'node:crypto';
import vm from 'node:vm';
import { wordlist } from '@scure/bip39/wordlists/english';

export const COMMIT = 'de71c22328b24e0848bbe1bd12ac8974ca83b5b8';   // v0.5.6, 2023-08-01, the release iancoleman.io/bip39 serves
export const PINNED = {
  'entropy.js': '10277942f7ce12507bf102e947fa8157602be88c9eab0f7a0b2c8d3610e38163',
  'index.js': '3dd950f5d2f32cfe32963c1b3d4adea06e787ec7adb66daaaf19812e55a6f370',
  'jsbip39.js': '239cf9fd4bdebb5c29e396dda98883205cc9b1843a94df3ffb28d8a48bfc66ab',
};
const here = new URL('./src/iancoleman/src/js/', import.meta.url);
export const FETCHED = Object.keys(PINNED).every((f) => fs.existsSync(new URL(f, here)));
const read = (f) => {
  const b = fs.readFileSync(new URL(f, here)), h = nc.createHash('sha256').update(b).digest('hex');
  if (h !== PINNED[f]) throw new Error(f + ': SHA-256 ' + h + ' is not the pinned copy from commit ' + COMMIT);
  return b.toString('utf8');
};
const cut = (src, first, last) => {
  const a = src.indexOf(first), b = src.indexOf(last, a);
  if (a < 0 || b < 0 || src.indexOf(first, a + 1) >= 0) throw new Error('the pinned index.js no longer has ' + JSON.stringify(first));
  return src.slice(a, b);
};

// sjcl stand-in: sha256.hash takes a string (sjcl hashes it as UTF-8) or an array of 32-bit words (byteArrayToWordArray).
const sjcl = {
  hash: { sha256: { hash: (x) => {
    const b = typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.concat(x.map((v) => { const o = Buffer.alloc(4); o.writeInt32BE(v | 0); return o; }));
    return nc.createHash('sha256').update(b).digest('hex');
  } } },
  codec: { hex: { fromBits: (h) => h } },
};
const libs = { BigInteger: { BigInteger: { parse: (hex, radix) => { if (radix !== 16) throw new Error('radix'); return { toString: (r) => BigInt('0x' + hex).toString(r) }; } } } };

let ent = null, mnCtx = null, fnSrc = null;
function init() {
  if (ent) return;
  ent = {}; vm.runInNewContext(read('entropy.js'), { window: ent });
  mnCtx = { $: () => ({ find: () => ({ val: () => '2048' }) }), WORDLISTS: { english: wordlist }, sjcl };
  vm.runInNewContext(read('jsbip39.js') + '\nthis.mnemonic = new Mnemonic("english");', mnCtx);
  fnSrc = cut(read('index.js'), '    function setMnemonicFromEntropy() {', '\n    function clearEntropyFeedback() {');
}

// What his tool shows in the BIP39 Mnemonic box for this entropy text and Mnemonic Length ("raw", "12", ... "24"),
// with the entropy type found by his auto-detect (as it is when the page opens). Returns {phrase, bits} or {phrase: ""}.
export function coleman(entropyText, length) {
  init(); let phrase = '';
  const node = (v) => ({ val: () => v, removeClass() {}, addClass() {} });
  const DOM = { entropy: node(entropyText), entropyMnemonicLength: node(String(length)), entropyWeakEntropyOverrideWarning: node(),
    entropyTypeInputs: { filter: () => node('card') }, phrase: { val: (p) => { phrase = p; } } };
  let shown = null;
  const ctx = { Entropy: ent.Entropy, DOM, sjcl, libs, mnemonic: mnCtx.mnemonic, entropyTypeAutoDetect: true,
    clearEntropyFeedback() {}, showEntropyFeedback(e) { shown = e; }, writeSplitPhrase() {}, showWordIndexes() {}, showChecksum() {} };
  vm.runInNewContext(fnSrc + '\nsetMnemonicFromEntropy();', ctx);
  return { phrase, bits: shown ? shown.binaryStr.length : 0, type: shown ? shown.base.str : '' };
}
