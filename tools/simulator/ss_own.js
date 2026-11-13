// ss_own.js: "Use it for real" (v2.17.0), next to the practice signer in #ssBox. The practice signer is a real signer: this part
// lets a person show it their own PSBT, address, multisig wallet descriptor or message request, and takes back what the device
// makes. Nothing is put into the device's memory from here: the practice wallet (ss_learn.js) holds the QR code up to the device's
// camera, the person chooses Scan, and the device does the rest exactly as SeedSigner 0.8.7 does (the review screens, change
// verification by derivation path or wallet descriptor, its own warnings, signing). This part adds:
//   - ssOwnRead: what was pasted, chosen (a file) or scanned (the page's camera: CAM_TARGETS.ssOwnIn). Seeds and private keys in
//     their common forms (words, numbered, in a sentence, run together or with a typo; SLIP-39 words, SeedQR digits, hex, WIF,
//     BIP38, codex32, xprv; a safety net, not a guarantee) are refused and the box is cleared (the message box too); a file is
//     checked before it goes into the box; an address is checked with the page's own address checker. Cheap format checks come
//     first and long text never reaches the device's QR type detection (its base43 decoding is quadratic);
//   - ssOwnReview: warnings next to the device before the scan, worked out with the device's own parser: wrong network, no seed on
//     the device can sign it, inputs of other signers, a previous transaction that is not the coin it spends (a forged amount),
//     sighash types, the fee (red: above the payment or 1,000 sat/vB; amber: 10% of the amount sent or 250 sat/vB), multisig change
//     that is only claimed (no wallet descriptor of this seed that also makes the inputs), single-key change at an odd path, outputs
//     that name the seed but are not provably its own, inputs the seed will leave unsigned. A PSBT the device cannot read is not
//     held up;
//   - ssOwnSignGate: the signing rules, called by the device when Approve transaction or Sign message is chosen (SIM: VOIDFORGE
//     rule): the PSBT's network must be the device's, and every full previous transaction must be the coin it spends (both refused
//     on the device's screen); with nothing new to sign (worked out without signing) it asks nothing; a seed that is not public signs a PSBT or a message only after
//     a yes to a plain question (this computer offline, or a stronger warning while it is online), and multisig change the device
//     did not verify needs a second yes that names the amount;
//   - the outputs: the signed PSBT exactly as the device made it (SeedSigner's trimmed PSBT, the bytes its animated QR holds), as
//     base64 to copy and a .psbt file to save, only after the page's own code checked every signature (inspectPsbt, psbtSigCheck)
//     and found its transaction the same as the one pasted; which inputs were signed and which were left; the message signature.
//     A seed that is public signs as PRACTICE; a real seed's output says so.
// Wiped by ssPageStop (box closed, CLEAR ALL, auto-clear, END SESSION) and wipeSeed (ssOwnWipe).
"use strict";
const SS_OWN_FRAG = 120;          // UR fragment length of a PSBT held up (as a wallet app's animated QR)
const SS_OWN_HIGH_RATE = 1000;    // sat/vB: a fee rate at or above this is called very high (red)
const SS_OWN_RATE_WARN = 250;     // sat/vB: a fee rate at or above this is called high (amber)
const SS_OWN_FEE_SHARE = 0.1;     // a fee at or above this share of the amount sent is called high (amber)
const SS_OWN_FAR_INDEX = 10000;   // a change address number at or above this is far past where wallet apps look
const SS_OWN_MAX_FILE = 4000000;  // bytes: a larger file is not read
const SS_OWN_MAX_TEXT = 6000000;  // characters: a longer paste is not read (a 4 MB PSBT is about 5.3 million in base64)
const SS_OWN_TYPE_MAX = 4000;     // characters: a longer first line is not given to the device's QR type detection
const ssOwn = { gen: 0, timer: null, psbt: null, txid: "", kind: "", out: null, msgAddr: "", seenSig: null, seenMsg: null, seenAddr: null, seenDesc: null, busy: false };
const ssOwnEl = (id) => document.getElementById(id);

function ssOwnSay(text, cls) {
  const e = ssOwnEl("ssOwnStatus"); if (!e) return;
  if (e.textContent !== text) e.textContent = text;
  e.className = "status" + (cls && text ? " ss-banner " + cls : "");
  if (cls && text) try { e.scrollIntoView({ block: "center" }); } catch (err) { /* not laid out */ }
}
function ssOwnWarns(list) {   // [{t, bad, warn}] next to the device: bad is red, warn amber
  const u = ssOwnEl("ssOwnWarns"); if (!u) return;
  u.textContent = "";
  for (const x of list || []) { const li = document.createElement("li"); li.textContent = x.t; if (x.bad) li.className = "bad"; else if (x.warn) li.className = "warn"; u.appendChild(li); }
  u.hidden = !(list && list.length);
}
const ssOwnSats = (v) => Number(v).toLocaleString("en-US") + " sats";
function ssOwnNetName(n) { return n === "M" ? "Mainnet" : n === "T" ? "Testnet" : "Regtest"; }
function ssOwnSeedPublic(seed) {   // a public or practice seed with no passphrase (pubKind: its words are published or predictable)
  try { return !!seed && !seed.passphrase && typeof pubKind === "function" && !!pubKind(seed.mnemonic_str); } catch (e) { return false; }
}
function ssOwnIsPracticeTx(psbt) {   // the practice transaction of ss_learn.js (made-up coins): its unsigned transaction
  try { return !!(ssLearn.tx && psbt && hex(ssPsbtSerializeTx(psbt.tx)) === hex(ssLearn.tx.utx)); } catch (e) { return false; }
}
function ssOwnDevNet() { const n = ssLearnNet(), S = SSSettingsConstants; return n === "M" ? S.MAINNET : n === "T" ? S.TESTNET : S.REGTEST; }

// ---------------------------------------------------------------- seeds and private keys in their common forms (a safety net, not a guarantee)
let ssOwnP4 = null, ssOwnS39 = null;   // the first 4 letters of every BIP-39 word (each picks one word); the SLIP-39 words
const SS_OWN_FILLER = new Set(["and", "or", "then"]);   // words between seed words that do not end a run ("abandon and ability and ...")
const SS_OWN_MAX_KEYS = 64;   // WIF- and BIP38-shaped strings checked at most (each is a base58 decoding)
// The BIP-39 word of a token, or -1: the whole word, or its unique first 4 letters
function ssOwnWordIdx(x) {
  if (!ssOwnP4) { ssOwnP4 = new Map(); WORDLIST.forEach((w, i) => ssOwnP4.set(w.slice(0, 4), i)); }
  if (x.length < 3 || x.length > 8) return -1;
  if (Object.prototype.hasOwnProperty.call(WORD_MAP, x)) return WORD_MAP[x];
  return x.length === 4 && ssOwnP4.has(x) ? ssOwnP4.get(x) : -1;
}
// A run of letters with no spaces that is wholly made of 12 or more BIP-39 words (abandonabilityable...): their indexes, or null
function ssOwnJoined(x) {
  if (x.length < 36 || x.length > 216) return null;
  const best = new Array(x.length + 1).fill(null); best[0] = [];
  for (let i = 0; i < x.length; i++) {
    if (!best[i]) continue;
    for (let l = 3; l <= 8 && i + l <= x.length; l++) { const w = x.slice(i, i + l); if (Object.prototype.hasOwnProperty.call(WORD_MAP, w) && !best[i + l]) best[i + l] = [...best[i], WORD_MAP[w]]; }
  }
  return best[x.length] && best[x.length].length >= 12 ? best[x.length] : null;
}
// The runs of seed words in a text: [{idx: [word numbers], miss}] (punctuation, numbering, case and "and" ignored; miss: tokens in
// the run that are not words, at most 2 in any 13, so a seed with a typo or two still counts)
function ssOwnWordRuns(t) {
  const toks = t.toLowerCase().split(/[^a-z]+/).filter((x) => x && !SS_OWN_FILLER.has(x)), runs = [];
  let cur = null;
  for (const x of toks) {
    const j = ssOwnWordIdx(x), jn = j < 0 ? ssOwnJoined(x) : null;
    if (jn) { if (cur) runs.push(cur); runs.push({ idx: jn, miss: 0, at: [], n: jn.length }); cur = null; continue; }
    if (j >= 0) { if (!cur) cur = { idx: [], miss: 0, at: [], n: 0 }; cur.idx.push(j); cur.n++; continue; }
    if (cur && x.length >= 3 && x.length <= 9 && cur.at.filter((p) => p > cur.n - 13).length < 2) { cur.at.push(cur.n); cur.n++; cur.miss++; continue; }
    if (cur) runs.push(cur);
    cur = null;
  }
  if (cur) runs.push(cur);
  return runs;
}
const ssOwnWordRun = (t) => ssOwnWordRuns(t).reduce((a, r) => Math.max(a, r.idx.length), 0);   // the most seed words in one run
// A run that is a real seed: exactly 12, 15, 18, 21 or 24 words in a row, no typo, with a right BIP-39 checksum (for a message,
// where plain English can be all seed words)
async function ssOwnHasSeed(runs) {
  for (const r of runs) {
    if (r.miss || ![12, 15, 18, 21, 24].includes(r.idx.length)) continue;
    try { if (await reforgeChecksumOk(r.idx)) return true; } catch (e) { /* not a seed */ }
  }
  return false;
}
function ssOwnS39Run(t) {   // the longest run of SLIP-39 share words
  if (!ssOwnS39) ssOwnS39 = new Set(SLIP39_WORDS);
  let run = 0, best = 0;
  for (const x of t.toLowerCase().split(/[^a-z]+/)) { if (!x) continue; run = ssOwnS39.has(x) ? run + 1 : 0; if (run > best) best = run; }
  return best;
}
// What makes this text a secret, or "", for the checks that need no hashing. msg: the text of a message to sign, where 12 English
// words in a row can be an ordinary sentence (seed words count there only with a right checksum: ssOwnSecret)
function ssOwnSecretQuick(t, msg = false) {
  if (!msg && ssOwnWordRuns(t).some((r) => r.idx.length >= 12 || (r.idx.length >= 11 && r.miss >= 1))) return "This holds 12 or more seed words in a row: a seed.";
  const s39 = ssOwnS39Run(t);
  if (s39 >= (msg ? 20 : 15)) return "This holds the words of a SLIP-39 share: part of a seed.";
  const dg = t.replace(/[\s.,;:_-]+/g, "");
  if (/^\d+$/.test(dg) && [48, 60, 72, 84, 96].includes(dg.length) && dg.match(/\d{4}/g).every((x) => +x < 2048)) return "This looks like the digits of a SeedQR: a seed.";
  const hx = t.replace(/[\s:]+/g, "").replace(/^0x/i, "");
  if (/^[0-9a-f]+$/i.test(hx) && ([32, 40, 48, 56, 64, 128].includes(hx.length) || (/^(80|ef)/i.test(hx) && (hx.length === 66 || (hx.length === 68 && /01$/.test(hx)))))) return "This is " + hx.length + " hex digits, which could be a private key or a seed written as hex: a secret.";
  if (/[xyztuvYZUV]prv[1-9A-HJ-NP-Za-km-z]{100}/.test(t)) return "This holds an extended private key (xprv), which can spend.";
  if (/ur:crypto-(seed|bip39)\//i.test(t)) return "This is a seed in a UR code.";
  if (/(?<![0-9a-z])ms1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{45,}/i.test(t)) return "This holds a codex32 share (ms1...): part of a seed.";
  return "";
}
// What makes this text a secret, or "". Nothing of the text is ever repeated.
async function ssOwnSecret(t, msg = false) {
  const q = ssOwnSecretQuick(t, msg); if (q) return q;
  if (msg && await ssOwnHasSeed(ssOwnWordRuns(t))) return "This holds 12 or more seed words in a row: a seed.";
  let n = 0;
  for (const m of t.matchAll(/(?<![1-9A-HJ-NP-Za-km-z])(?:[5KLc9][1-9A-HJ-NP-Za-km-z]{50,51}|6P[1-9A-HJ-NP-Za-km-z]{56})(?![1-9A-HJ-NP-Za-km-z])/g)) {
    if (++n > SS_OWN_MAX_KEYS) break;
    let raw = null; try { raw = await base58decode(m[0]); } catch (e) { continue; }
    if ((raw.length === 33 || (raw.length === 34 && raw[33] === 1)) && (raw[0] === 0x80 || raw[0] === 0xef)) return "This holds a private key (WIF), which can spend.";
    if (raw.length === 39 && raw[0] === 1 && (raw[1] === 0x42 || raw[1] === 0x43)) return "This holds a password-protected private key (BIP38).";
  }
  return "";
}
// A quick look for the page's camera (camValue): a SeedQR, seed words, an xprv or a WIF- or BIP38-shaped key never go into the box.
function ssOwnLooksSecret(text) {
  const t = String(text || "").trim(), m = /^signmessage\s+\S+\s+ascii:([\s\S]*)$/.exec(t);
  return !!(m ? ssOwnSecretQuick(m[1], true) : ssOwnSecretQuick(t)) || /^(?:[5KLc9][1-9A-HJ-NP-Za-km-z]{50,51}|6P[1-9A-HJ-NP-Za-km-z]{56})$/.test(t.slice(/^bitcoin:/i.test(t) ? 8 : 0));
}

// ---------------------------------------------------------------- the network of an address ("main", "test", "regtest") against the device's
function ssOwnAddrNetWrong(addr, n) {
  const an = typeof addressNetOf === "function" ? addressNetOf(addr) : "", dn = n === "M" ? "main" : n === "T" ? "test" : "regtest";
  if (!an || an === dn) return "";
  if (an === "test" && dn === "regtest" && !/^tb1/i.test(addr)) return "";   // m, n and 2 addresses are the same on Testnet and Regtest
  const name = an === "main" ? "Mainnet" : an === "test" ? (/^tb1/i.test(addr) ? "Testnet" : "Testnet or Regtest") : "Regtest";
  return "This is a " + name + " address, but the device is set to " + ssOwnNetName(n) + ". The device checks it on the address’s own network, as SeedSigner does, so a match means your seed makes it on " + name + ", not in your " + ssOwnNetName(n) + " wallet.";
}

// ---------------------------------------------------------------- what was pasted, chosen or scanned
async function ssOwnRead(text) {
  const raw = String(text || ""), t = raw.trim();
  if (!t) return { error: "Paste a PSBT, an address, a wallet descriptor or a signmessage request first, or choose a .psbt file." };
  if (t.length > SS_OWN_MAX_TEXT) return { error: "This is longer than any PSBT the device reads." };
  const sm = /^signmessage\s/.test(t), sec = sm ? await ssOwnSecret(t.replace(/^signmessage\s+\S+\s+ascii:/, ""), true) || await ssOwnSecret(t.replace(/ascii:[\s\S]*$/, "")) : await ssOwnSecret(t);
  if (sec) return { error: sec, secret: true };
  if (sm) {
    const m = /^signmessage\s+(m(?:\/\d+[h']?)+)\s+ascii:([\s\S]*)$/.exec(raw.replace(/^\s+/, "").replace(/\r?\n$/, ""));
    if (!m) return { error: "A message request reads: signmessage <path> ascii:<message>, such as signmessage m/84h/0h/0h/0/0 ascii:Hello." };
    const e = ssOwnMsgError(m[2]); if (e) return { error: e };
    return { kind: "msg", frames: [raw.replace(/^\s+/, "").replace(/\r?\n$/, "")], what: "your request to sign a message with the key at " + m[1] };
  }
  const first = t.split(/\r?\n/)[0].trim();
  // cheap format checks first: a PSBT (base64, hex, UR or BBQr) goes straight to the PSBT reader
  const psbtLike = /^(cHNidP8|70736274ff|ur:(crypto-psbt|psbt|bytes)\/|B\$)/i.test(first);
  let type = "";
  if (!psbtLike && first.length <= SS_OWN_TYPE_MAX) { try { type = SSDecodeQR.detect_segment_type(first); } catch (e) { type = ""; } }
  if (type === SSQRType.BITCOIN_ADDRESS && !/\s/.test(t)) {
    const addr = t.slice(/^bitcoin:/i.test(t) ? 8 : 0).split("?")[0];
    let ex = null; try { ex = await explainAddress(t); } catch (e) { ex = null; }   // the page's own address checker
    if (!ex || ex.level !== "ok") return { error: ex ? ex.text : "This is not a Bitcoin address VOIDFORGE recognizes.", secret: !!ex && /PRIVATE|SEED WORDS|SeedQR|SECRET/.test(ex.text) };
    const nw = ssOwnAddrNetWrong(addr, ssLearnNet());
    return { kind: "address", frames: [t], what: "the address " + addr, warns: nw ? [{ bad: true, t: nw }] : [] };
  }
  let bytes = null, perr = "";
  try { bytes = psbtFromText(t); } catch (e) { perr = e && e.message ? e.message : String(e); }
  if (bytes) {
    try { SSPSBT.parse(bytes); return { kind: "psbt", bytes, frames: null, what: "" }; }
    catch (e) { if (bytes.length > 4 && bytes[0] === 0x70 && bytes[1] === 0x73) return { error: "The device cannot read this PSBT: " + (e && e.message ? e.message : e) + "." }; }
  }
  const lines = t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length > 1 && lines.every((x) => /^ur:crypto-(output|account)\//i.test(x))) return { kind: "descriptor", frames: lines.map((x) => x.toUpperCase()), what: "your wallet descriptor (" + lines.length + " QR parts)" };
  if (/^(wallet__|output__ur|account__ur)/.test(type)) return { kind: "descriptor", frames: [t], what: "your wallet descriptor" };
  if (/\bmulti\(/.test(t)) return { error: "SeedSigner reads multisig wallet descriptors with sortedmulti only (wsh(sortedmulti(...)) or sh(wsh(sortedmulti(...)))). This one uses multi." };
  if (/^(wpkh|sh|pkh|tr)\(/.test(t)) return { error: "SeedSigner loads multisig wallet descriptors only. For a single-key wallet, the device checks change and addresses from the seed itself." };
  return { error: perr && /^(cHNidP8|70736274)/i.test(t) ? perr : "The device does not read this. Paste a PSBT (base64, hex, or the parts of an animated UR or BBQr QR, one per line), an address, a multisig wallet descriptor or a signmessage request." };
}
function ssOwnMsgError(msg) {
  if (!msg) return "The message is empty.";
  if (msg.length > 1000) return "The message is too long for one QR code (at most 1,000 characters).";
  if (!/^[\x20-\x7e\n]+$/.test(msg)) return "SeedSigner signs ascii: messages only: use plain letters, digits, punctuation and line breaks.";
  if (msg.includes("ascii:")) return "The message holds the text ascii:, where SeedSigner would cut it off. Leave that out.";
  return "";
}

// ---------------------------------------------------------------- the network a PSBT's key paths name ("main", "test", "mixed" or "")
function ssOwnPsbtNet(psbt) {
  const seen = new Set(), H = 0x80000000;
  const look = (der) => { const d = der && der.derivation; if (d && d.length >= 2 && d[0] >= H && [44, 49, 84, 86, 48].includes(d[0] - H) && d[1] >= H) { const c = d[1] - H; if (c === 0) seen.add("main"); else if (c === 1) seen.add("test"); } };
  for (const sc of [...psbt.inputs, ...psbt.outputs]) { for (const x of sc.bip32_derivations || []) look(x.der); for (const x of sc.taproot_bip32_derivations || []) look(x.der); }
  for (const x of psbt.xpubs || []) { const v = hex(x.key.slice(0, 4)); if (v === "0488b21e") seen.add("main"); else if (v === "043587cf") seen.add("test"); }
  return seen.size === 1 ? [...seen][0] : seen.size > 1 ? "mixed" : "";
}
function ssOwnNetWrong(psbt, network) {   // "" when the PSBT may be signed on the device's network, else why not
  const pn = ssOwnPsbtNet(psbt), dn = network === SSSettingsConstants.MAINNET ? "main" : "test", dName = network === SSSettingsConstants.MAINNET ? "Mainnet" : network === SSSettingsConstants.TESTNET ? "Testnet" : "Regtest";
  if (pn === "mixed") return "This PSBT mixes Mainnet and Testnet key paths.";
  if (pn && pn !== dn) return "This PSBT is for " + (pn === "main" ? "Mainnet" : "Testnet or Regtest") + ", but the device is set to " + dName + ".";
  return "";
}

// ---------------------------------------------------------------- the size of the signed transaction, roughly (for the fee rate)
function ssOwnVsize(psbt) {
  const tx = psbt.tx, vl = (n) => varintBytes(n).length;
  let w = 4 * (8 + vl(tx.vin.length) + vl(tx.vout.length)), seg = false, bare = 0;
  for (const o of tx.vout) w += 4 * (8 + vl(o.script_pubkey.length) + o.script_pubkey.length);
  const msM = (sc) => { try { return SSPSBTParser._parse_multisig(sc)[0]; } catch (e) { return 1; } };
  const msWit = (sc) => 1 + 1 + msM(sc) * 73 + vl(sc.length) + sc.length;
  for (const inp of psbt.inputs) {
    let spk = null; try { spk = inp.utxo.script_pubkey; } catch (e) { spk = null; }
    const t = spk ? ssPsbtScriptType(spk) : null;
    let ss = 0, wit = 0;
    if (t === "p2wpkh") wit = 1 + 1 + 72 + 1 + 33;
    else if (t === "p2tr") wit = 1 + 1 + 65;
    else if (t === "p2wsh") wit = inp.witness_script ? msWit(inp.witness_script) : 1 + 1 + 72 + 1 + 33;
    else if (t === "p2sh" && inp.witness_script) { ss = 1 + 34; wit = msWit(inp.witness_script); }
    else if (t === "p2sh" && inp.redeem_script && ssPsbtScriptType(inp.redeem_script) === "p2wpkh") { ss = 1 + 22; wit = 1 + 1 + 72 + 1 + 33; }
    else if (t === "p2sh" && inp.redeem_script) ss = 1 + msM(inp.redeem_script) * 73 + 3 + inp.redeem_script.length;
    else ss = 1 + 72 + 1 + 33;   // P2PKH (anything else is counted as one)
    w += 4 * (32 + 4 + 4 + vl(ss) + ss) + wit;
    if (wit) seg = true; else bare++;
  }
  if (seg) w += 2 + bare;   // the segwit marker and flag, and an empty witness for each input without one
  return Math.ceil(w / 4);
}

// ---------------------------------------------------------------- checks shared by the review and the signing rules
// Inputs whose full previous transaction (non_witness_utxo) is not the coin they spend: its txid (worked out with the page's own
// code) is not the input's, it has no such output, or it disagrees with the input's witness_utxo. Such a PSBT can claim any amount
// for the coin, and so hide any fee: SeedSigner reads the amount from it without checking. [{i, why}]
async function ssOwnPrevBad(psbt) {
  const out = [];
  for (let i = 0; i < psbt.inputs.length; i++) {
    const inp = psbt.inputs[i], nw = inp.non_witness_utxo; if (!nw) continue;
    let id = null; try { id = await dsha256(psbtStripWitness(nw.raw)); } catch (e) { id = null; }
    const o = nw.tx && nw.tx.vout ? nw.tx.vout[inp.vout] : null, wu = inp.witness_utxo;
    if (!id || !inp.txid || hex(id) !== hex(inp.txid)) out.push({ i, why: "its full previous transaction is not the one it spends (the txid does not match)" });
    else if (!o) out.push({ i, why: "its previous transaction has no output " + inp.vout });
    else if (wu && (BigInt(wu.value) !== BigInt(o.value) || hex(wu.script_pubkey) !== hex(o.script_pubkey))) out.push({ i, why: "its witness UTXO and its full previous transaction give different coins" });
  }
  return out;
}
// The device's descriptor (SIM: VOIDFORGE rule: it stays loaded until the device is switched off), if it is one the page can read
function ssOwnDesc(ctl) { try { const c = ctl || SSController._instance, d = c && c.multisig_wallet_descriptor; return d && Array.isArray(d.keys) ? d : null; } catch (e) { return null; } }
// Which seeds have their own key in a descriptor, at the origin it names (the xpub the seed makes there, compared). claims: the
// fingerprints of loaded seeds that a key of the descriptor names, whether or not the key is that seed's.
async function ssOwnDescSeeds(desc, seeds, network) {
  const inIt = [], claims = [];
  for (const sd of seeds) {
    if (!sd || !(sd.seed_bytes instanceof Uint8Array)) continue;
    let fp = ""; try { fp = await sd.get_fingerprint(network); } catch (e) { continue; }
    for (const k of desc.keys) {
      if (!k || !k.is_extended || !k.origin || hex(k.origin.fingerprint) !== fp) continue;
      if (!claims.includes(fp)) claims.push(fp);
      let x = null; try { x = await ssSeedsGetXpub(sd.seed_bytes, k.origin.derivation); } catch (e) { x = null; }
      if (x && hex(x.key) === hex(k.key.pub) && hex(x.chain_code) === hex(k.key.chain)) { inIt.push(fp); break; }
    }
  }
  return { inIt, claims };
}
// Multisig change: verified only by a wallet descriptor on the device that holds this seed's own key and makes every input too
// (else a descriptor of anyone's would "verify" anyone's output). {trusted, why}
async function ssOwnMsigTrust(psbt, seed, network, desc = ssOwnDesc()) {
  if (!desc) return { trusted: false, desc: null, why: "" };
  const ds = await ssOwnDescSeeds(desc, [seed], network);
  if (!ds.inIt.length) return { trusted: false, desc, why: ds.claims.length ? "the wallet descriptor on the device names this seed’s fingerprint, but the key there is not this seed’s" : "this seed is not in the wallet descriptor on the device" };
  for (const inp of psbt.inputs) { let ok = false; try { ok = await desc.owns(inp); } catch (e) { ok = false; } if (!ok) return { trusted: false, desc, why: "the wallet descriptor on the device does not make the coins this PSBT spends" }; }
  return { trusted: true, desc, why: "" };
}
// Which inputs the device would sign, worked out without signing anything (the key signs only after a yes): the rule of embit's
// sign_with (SIGHASH_ALL, or DEFAULT for Taproot; a key for each derivation of this seed, which must match it; a Taproot key only
// when its tweaked key is the coin's), and whether that signature would be new (SeedSigner calls it Signing Failed when nothing
// new is added). {fresh: [i], again: [i] (signed by this seed already), left: [i] (the seed's inputs it skips), err}
async function ssOwnWillSign(psbt, root) {
  const fp = hex(root.my_fingerprint), out = { fresh: [], again: [], left: [], err: "" }, rootpub = root.get_public_key(), pkh = await hash160(rootpub);
  for (let i = 0; i < psbt.inputs.length; i++) {
    const inp = psbt.inputs[i], ders = [...inp.taproot_bip32_derivations.map((d) => ({ pub: ssPsbtSec(d.pub), der: d.der })), ...inp.bip32_derivations].filter((d) => hex(d.der.fingerprint) === fp);
    let tap = false; try { tap = inp.is_taproot; } catch (e) { tap = false; }
    let sh = inp.sighash_type; if (sh === null) sh = tap ? 0 : 1; if (!tap && sh === 0) sh = 1;
    const keys = [];
    try { for (const d of ders) { const hk = await root.derive(d.der.derivation); if (hex(hk.xonly()) !== hex(d.pub.length === 33 ? d.pub.slice(1) : d.pub)) throw new Error("Derivation path doesn't look right"); keys.push(d.pub); } }
    catch (e) { out.err = e && e.message ? e.message : String(e); return out; }
    let will = [];
    if (sh === 0 || sh === 1) {
      if (tap) {
        let spk = null; try { spk = inp.utxo.script_pubkey; } catch (e) { spk = null; }
        for (const k of [rootpub, ...keys]) { try { if (spk && ssPsbtContains(spk, await ssPsbtTaprootTweakPub(k, inp.taproot_merkle_root || new Uint8Array(0)))) will.push(k); } catch (e) { /* not this key */ } }
      } else {
        let sc = null; try { sc = inp.witness_script || inp.redeem_script || inp.utxo.script_pubkey; } catch (e) { sc = null; }
        will = keys.slice(); if (sc && (ssPsbtContains(sc, rootpub) || ssPsbtContains(sc, pkh))) will.push(rootpub);
      }
    }
    if (!will.length) { if (ders.length) out.left.push(i); continue; }
    const isNew = tap ? !inp.final_scriptwitness : will.some((k) => !inp.partial_sigs.some((x) => hex(x.pub) === hex(k)));
    (isNew ? out.fresh : out.again).push(i);
  }
  return out;
}
const ssOwnList = (a) => !a.length ? "no input" : a.length === 1 ? "input " + a[0] : "inputs " + a.slice(0, -1).join(", ") + " and " + a[a.length - 1];

// ---------------------------------------------------------------- warnings before the scan, with the device's own parser
async function ssOwnReview(bytes) {
  const W = [], network = ssOwnDevNet();
  const psbt = SSPSBT.parse(bytes), fresh = () => SSPSBT.parse(bytes);
  let unreadable = "";
  const nw = ssOwnNetWrong(psbt, network);
  if (nw) W.push({ bad: true, t: nw + " The device will not sign it (VOIDFORGE’s rule): set the device’s network in Settings > Advanced > Bitcoin network, or use the PSBT for this network." });
  for (const x of await ssOwnPrevBad(psbt)) W.push({ bad: true, t: "Input " + x.i + ": " + x.why + ". Its amount, and so the fee, cannot be trusted: a PSBT like this can hide a huge fee. The device will not sign it (VOIDFORGE’s rule). Ask your wallet for a new PSBT." });
  const inFps = new Set();
  for (const inp of psbt.inputs) { for (const d of inp.bip32_derivations) inFps.add(hex(d.der.fingerprint)); for (const d of inp.taproot_bip32_derivations) inFps.add(hex(d.der.fingerprint)); }
  const seeds = ssLearnSeeds().filter((s) => s && s.seed_bytes instanceof Uint8Array);
  let signer = null, sfp = ""; const fps = [];
  for (const s of seeds) {
    const fp = await s.get_fingerprint(network); fps.push(fp + (s.passphrase ? " (with passphrase)" : ""));
    if (!signer && await SSPSBTParser.has_matching_input_fingerprint(fresh(), s, network)) { signer = s; sfp = fp; }
  }
  const named = inFps.size ? " Its inputs name " + [...inFps].join(", ") + "." : " Its inputs name no key (no derivation paths), so no seed can be matched to them.";
  if (!seeds.length) W.push({ bad: false, t: "No seed is loaded on the device yet. Load the seed that owns these coins first (on the device, or LOAD INTO THE PRACTICE SIGNER under YOUR SEED)." + named });
  else if (!signer) W.push({ bad: true, t: "This PSBT spends from a seed that is not loaded: none of its inputs belong to the seed" + (fps.length > 1 ? "s" : "") + " on the device (" + fps.join(", ") + ")." + named + " The device cannot sign it with " + (fps.length > 1 ? "these seeds" : "this seed") + ": load the right seed, with its passphrase if it has one." });
  psbt.inputs.forEach((inp, i) => {
    const sh = inp.sighash_type, okSh = sh === null || sh === 1 || sh === 0;
    if (!okSh) W.push({ bad: true, t: "Input " + i + " asks for sighash " + (typeof sighashName === "function" ? sighashName(inp.is_taproot ? "Schnorr" : "ECDSA", sh) : sh) + ". SeedSigner signs only with SIGHASH_ALL (and SIGHASH_DEFAULT for Taproot), so the device will not sign this input." });
    // SeedSigner signs a non-Taproot input that asks for SIGHASH_DEFAULT (0) with SIGHASH_ALL (embit: sign_with)
    if (sh === 0 && !inp.is_taproot && (inp.witness_utxo || inp.non_witness_utxo)) W.push({ warn: true, t: "Input " + i + " asks for sighash 0 (SIGHASH_DEFAULT), which is for Taproot only. The device signs it with SIGHASH_ALL, as SeedSigner does; a wallet that checks the type it asked for may refuse that signature." });
    if (inp.taproot_bip32_derivations.some((d) => d.leaf_hashes.length)) W.push({ bad: true, t: "Input " + i + " spends from a Taproot script tree. SeedSigner signs Taproot key spends only, so the device stops with an error." });
    if (!inp.witness_utxo && !inp.non_witness_utxo) { unreadable = unreadable || "input " + i + " does not include the coin it spends, so its amount and the fee are unknown"; W.push({ bad: true, t: "Input " + i + " does not carry the coin it spends, so its amount and the fee are unknown and the device cannot read this PSBT. Ask your wallet for a PSBT with the coins being spent." }); }
    else if (inp.witness_utxo && !inp.non_witness_utxo) {
      const st = ssPsbtScriptType(inp.witness_utxo.script_pubkey), rs = inp.redeem_script ? ssPsbtScriptType(inp.redeem_script) : null;
      // legacy coins: P2PKH, and P2SH that is not wrapped SegWit (embit then signs it as SegWit, so the signature is invalid)
      if (st === "p2pkh" || (st === "p2sh" && !inp.witness_script && rs !== "p2wpkh" && rs !== "p2wsh")) W.push({ bad: true, t: "Input " + i + " is a legacy (" + (st === "p2pkh" ? "P2PKH" : "P2SH") + ") coin without its full previous transaction. A signature made from this PSBT would be invalid. Ask your wallet for a PSBT with the full previous transaction." });
      // SegWit v0: the amount is the PSBT's word only, and with more than one input a wallet can lower it across two signings
      else if (psbt.inputs.length > 1 && st !== "p2tr") W.push({ warn: true, t: "Input " + i + " (SegWit v0) comes without its full previous transaction, so its amount is the PSBT’s word only. A dishonest wallet that asks you to sign the same transaction twice can hide a larger fee this way. Prefer a PSBT that includes the full previous transactions; the page then checks them." });
    }
  });
  if (!signer || unreadable) return { W, signer, unreadable };
  const mineIn = psbt.inputs.filter((inp) => [...inp.bip32_derivations, ...inp.taproot_bip32_derivations].some((d) => hex(d.der.fingerprint) === sfp)).length;
  if (mineIn < psbt.inputs.length) W.push({ bad: false, t: mineIn + " of " + psbt.inputs.length + " inputs belong to seed " + sfp + ": the device signs only those. The others need their own signers before the transaction can be sent." });
  let parser = null, dry = null;
  try { parser = await SSPSBTParser.create(fresh(), signer, network); dry = await ssOwnWillSign(parser.psbt, parser.root); }
  catch (e) { const m = e && e.message ? e.message : String(e); W.push({ bad: true, t: "The device cannot read this PSBT with seed " + sfp + ": " + m + "." }); return { W, signer, unreadable: "with seed " + sfp + ", " + m }; }
  finally { try { if (parser && parser.root) parser.root.wipe(); } catch (e) { /* nothing to wipe */ } }
  if (dry.err) W.push({ bad: true, t: "When it signs, the device will stop with an error: " + dry.err + ". Nothing will be signed." });
  else if (!dry.fresh.length && dry.again.length) W.push({ bad: true, t: "Seed " + sfp + " has signed this PSBT already (" + ssOwnList(dry.again) + "): there is nothing new to sign, so the device ends on Signing Failed. Give the signed PSBT to your wallet instead." });
  else if (!dry.fresh.length) W.push({ bad: true, t: "Seed " + sfp + " cannot add a signature to any input of this PSBT, so nothing will be signed (the device ends on Signing Failed)." });
  else if (dry.left.length) W.push({ warn: true, t: "The device will leave " + ssOwnList(dry.left) + " of seed " + sfp + " unsigned (see above), and sign " + ssOwnList(dry.fresh.concat(dry.again).sort((x, y) => x - y)) + " only. The transaction is not complete until " + (dry.left.length === 1 ? "that input is" : "those inputs are") + " signed too." });
  const fee = parser.fee_amount, pay = parser.spend_amount, vb = ssOwnVsize(psbt), rate = vb > 0 ? fee / vb : 0, sent = pay > 0 ? pay : parser.change_amount;
  const rateText = "about " + Math.round(rate).toLocaleString("en-US") + " sat/vB (" + ssOwnSats(fee) + " for about " + vb + " vB)";
  if (pay > 0 && fee > pay) W.push({ bad: true, t: "The fee (" + ssOwnSats(fee) + ") is higher than the payment (" + ssOwnSats(pay) + "). Check the fee in your wallet before you sign." });
  else if (sent > 0 && fee >= sent * SS_OWN_FEE_SHARE) W.push({ warn: true, t: "The fee (" + ssOwnSats(fee) + ") is " + Math.round(fee * 100 / sent) + "% of the amount sent (" + ssOwnSats(sent) + "). Check the fee in your wallet before you sign." });
  if (rate >= SS_OWN_HIGH_RATE) W.push({ bad: true, t: "The fee rate is " + rateText + ". That is very high: check the fee in your wallet before you sign." });
  else if (rate >= SS_OWN_RATE_WARN) W.push({ warn: true, t: "The fee rate is " + rateText + ". That is high: check the fee in your wallet before you sign." });
  const changeIdx = new Set(parser.change_data.map((c) => c.output_index));
  if (parser.is_multisig && parser.change_data.length) {
    const tr = await ssOwnMsigTrust(psbt, signer, network), xp = "cosigners" in parser.policy;
    if (tr.trusted) for (const c of parser.change_data) {
      let ok = false; try { ok = await tr.desc.owns(psbt.outputs[c.output_index]); } catch (e) { ok = false; }
      if (!ok) W.push({ bad: true, t: "Output " + c.output_index + " (" + ssOwnSats(c.amount) + ") is called change, but your wallet descriptor on the device does not make it: it is not your wallet’s. The device will say Address Verification Failed and discard the transaction." });
    }
    if (!tr.trusted) for (const c of parser.change_data)
      W.push({ bad: !xp || !!tr.desc, warn: xp && !tr.desc, t: "Output " + c.output_index + " (" + ssOwnSats(c.amount) + ") is claimed change, NOT verified: " + (tr.desc ? tr.why + ", so the device’s check of it against that descriptor proves nothing" : xp ? "no wallet descriptor is loaded on the device; only the PSBT’s own cosigner keys (xpubs) say it is this wallet’s" : "no wallet descriptor is loaded on the device and the PSBT has no cosigner keys (xpubs), so this is only what the PSBT claims") + ". On the device, choose Verify multisig change and scan your own wallet’s descriptor; Skip verification trusts the PSBT." });
  } else if (!parser.is_multisig) {   // single-key change at a path the device verifies, but a wallet app would not look at
    const acct = new Set();
    for (const inp of psbt.inputs) for (const d of [...inp.bip32_derivations, ...inp.taproot_bip32_derivations]) if (hex(d.der.fingerprint) === sfp && d.der.derivation.length > 2) acct.add(ssPsbtPathToStr(d.der.derivation.slice(0, -2)));
    for (const c of parser.change_data) {
      const o = psbt.outputs[c.output_index], d = [...o.bip32_derivations, ...o.taproot_bip32_derivations].find((x) => hex(x.der.fingerprint) === sfp); if (!d) continue;
      const p = d.der.derivation, odd = [], idx = p[p.length - 1];
      if (p.length !== 5) odd.push("its path has " + p.length + " levels, where wallets use 5 (purpose, coin, account, change, number)");
      else if (acct.size && !acct.has(ssPsbtPathToStr(p.slice(0, -2)))) odd.push("its account is not the one the inputs come from (" + [...acct].join(", ") + ")");
      if (idx >= SS_OWN_FAR_INDEX) odd.push("its address number (" + (idx >= SS_PSBT_HARDENED ? (idx - SS_PSBT_HARDENED) + "h" : idx.toLocaleString("en-US")) + ") is far past where wallet apps look for coins");
      if (odd.length) W.push({ bad: true, t: "Output " + c.output_index + " (" + ssOwnSats(c.amount) + ") is change at " + ssPsbtPathToStr(p) + ". The device will say Address Verified (your seed makes it), but " + odd.join(", and ") + ". Your wallet app may never show these coins: check the change in your wallet before you sign." });
    }
  }
  psbt.outputs.forEach((o, i) => {
    if (changeIdx.has(i)) return;
    if ([...o.bip32_derivations, ...o.taproot_bip32_derivations].some((d) => hex(d.der.fingerprint) === sfp))
      W.push({ bad: true, t: "Output " + i + " names seed " + sfp + " but the device cannot prove it is yours (its key or script does not match), so the device shows it as a payment (Will Send), as SeedSigner does. Check that address before you sign." });
  });
  W.push({ bad: false, t: "Seed " + sfp + " can sign. The device will show " + ssOwnSats(parser.input_amount) + " in from " + parser.num_inputs + " input" + (parser.num_inputs === 1 ? "" : "s") + ", " + ssOwnSats(pay) + " to " + parser.num_destinations + " address" + (parser.num_destinations === 1 ? "" : "es") + ", " + ssOwnSats(parser.change_amount) + " back as change, and a fee of " + ssOwnSats(fee) + " (about " + (Math.round(rate * 10) / 10).toLocaleString("en-US") + " sat/vB). Anything it cannot prove is yours is shown as a payment, except multisig change, which needs your wallet descriptor." });
  return { W, signer, unreadable: "" };
}

// ---------------------------------------------------------------- HOLD UP TO THE DEVICE
// What was held up before stops being held up (a refused paste never leaves the last item in front of the camera)
function ssOwnDrop() {
  try { if (ssLearnCam.key === "own") ssLearnHide(); } catch (e) { /* lessons part missing */ }
  if (ssOwn.psbt) ssOwn.psbt.fill(0);
  ssOwn.psbt = null; ssOwn.txid = ""; ssOwn.kind = "";
}
// The last output (a signed PSBT or message) is put away: it belongs to the item before
function ssOwnOutClear() {
  if (ssOwn.out && ssOwn.out.bytes) ssOwn.out.bytes.fill(0);
  ssOwn.out = null;
  const box = ssOwnEl("ssOwnOut"); if (box) box.hidden = true;
  const t = ssOwnEl("ssOwnOutText"); if (t) t.value = "";
  const s = ssOwnEl("ssOwnOutSay"); if (s) { s.textContent = ""; s.className = "status"; }
}
// v2.17.0 (phone review): the device is far above this box on a phone, so once something is held up it is scrolled into view
function ssOwnShowDevice() { const d = ssOwnEl("ssDevice"); if (d) try { d.scrollIntoView({ block: "nearest" }); } catch (e) { /* not laid out */ } }
async function ssOwnGo() { await ssOwnHold((ssOwnEl("ssOwnIn") || {}).value, false); }
// text: what to hold up; file: it came from a file, so it goes into the box only once it is read (never a seed's file)
async function ssOwnHold(text, file) {
  if (ssOwn.busy) return;
  if (!ssPageOn) { ssOwnSay("Open the practice signer first: its box, above.", "bad"); return; }
  ssOwn.busy = true; const gen = ++ssOwn.gen, box = ssOwnEl("ssOwnIn");
  try {
    const r = await ssOwnRead(text);
    if (gen !== ssOwn.gen || !ssPageOn) return;
    const no = file ? "Not read: " : "Not held up: ";
    if (r.error) {
      ssOwnDrop(); ssOwnWarns([]);
      if (r.secret) {
        if (!file && box) box.value = "";
        ssOwnSay(no + r.error + (file ? " The file was not put in the box." : " The box was cleared.") + " Never paste a seed or a private key here: to use a seed, load it with LOAD INTO THE PRACTICE SIGNER (under YOUR SEED) or on the device itself.", "bad");
      } else ssOwnSay(no + r.error, "bad");
      return;
    }
    let frames = r.frames, what = r.what, W = r.warns || [], txid = "";
    if (r.kind === "psbt") {
      frames = urEncode("crypto-psbt", CB.bytes(Array.from(r.bytes)), SS_OWN_FRAG).map((x) => x.toUpperCase());
      what = "your PSBT (" + frames.length + " QR part" + (frames.length === 1 ? "" : "s") + ")";
      let rv = null;
      try { rv = await ssOwnReview(r.bytes); W = rv.W; } catch (e) { W = [{ bad: true, t: "Could not review this PSBT: " + (e && e.message ? e.message : e) + "." }]; }
      try { txid = (await inspectPsbt(r.bytes, ssLearnKeyNet(ssLearnNet()))).txid; } catch (e) { txid = ""; }   // the page's own code
      if (gen !== ssOwn.gen || !ssPageOn) return;
      if (rv && rv.unreadable) { ssOwnDrop(); ssOwnWarns(W); ssOwnSay(no + "the device cannot read this PSBT: " + rv.unreadable + ". See the notes below.", "bad"); return; }
      ssOwnDrop(); ssOwn.psbt = r.bytes.slice(); ssOwn.txid = txid;
    } else ssOwnDrop();
    if (file && box) box.value = text;
    ssOwnOutClear();
    ssOwn.kind = r.kind;
    ssLearnShow(frames, what, "own");
    ssOwnWarns(W);
    const next = { psbt: "On the device, choose Scan (Home > Scan), then the seed that signs. Check every address and amount on its screens.",
      address: "On the device, choose Scan (Home > Scan). It searches the seed’s receive and change addresses, as SeedSigner does; a multisig address needs the wallet descriptor first.",
      descriptor: "On the device, choose Scan (Home > Scan). It loads the wallet descriptor and then checks multisig change and addresses against it.",
      msg: "On the device, turn on Settings > Advanced > Message signing (off at first, as on SeedSigner), then choose Scan on Home." }[r.kind];
    const bad = W.some((x) => x.bad);
    ssOwnSay("Held up to the device’s camera: " + what + ". " + (bad ? "Read the red notes below first. " : "") + next, bad ? "" : "ok");
    if (!bad) ssOwnShowDevice();
    ssOwnTimerOn();
  } finally { ssOwn.busy = false; }
}
// HOLD UP THE MESSAGE: the signmessage request SeedSigner reads, for the address type and number chosen
async function ssOwnMsgGo() {
  const msg = (ssOwnEl("ssMsgIn") || {}).value || "", purpose = (ssOwnEl("ssMsgType") || {}).value || "84", idxText = String((ssOwnEl("ssMsgIdx") || {}).value || "").trim(), idx = Number(idxText);
  if (!ssPageOn) { ssOwnSay("Open the practice signer first: its box, above.", "bad"); return; }
  const gen0 = ++ssOwn.gen, sec = await ssOwnSecret(msg, true);   // v2.17.0 review: the message box never holds up a seed or a key
  if (gen0 !== ssOwn.gen || !ssPageOn) return;
  if (sec) { const b = ssOwnEl("ssMsgIn"); if (b) b.value = ""; ssOwnDrop(); ssOwnSay("Not held up: " + sec + " The message box was cleared. Never type a seed or a private key here.", "bad"); return; }
  const e = ssOwnMsgError(msg); if (e) { ssOwnSay("Not held up: " + e, "bad"); return; }
  if (!idxText) { ssOwnSay("Not held up: type the number of the receive address whose key signs (0 for the first one, up to 999,999).", "bad"); return; }
  if (!/^\d+$/.test(idxText) || !Number.isInteger(idx) || idx < 0 || idx > 999999) { ssOwnSay("Not held up: the address number is 0 to 999,999.", "bad"); return; }
  if (!["84", "49", "44"].includes(purpose)) return;
  const path = "m/" + purpose + "h/" + ssLearnCoin(ssLearnNet()) + "h/0h/0/" + idx;
  ssOwn.gen++; ssOwnDrop(); ssOwnOutClear(); ssOwn.kind = "msg"; ssOwnWarns([]);
  ssLearnShow(["signmessage " + path + " ascii:" + msg], "your request to sign a message with the key of receive address #" + idx + " (" + path + ")", "own");
  ssOwnSay("Held up to the device’s camera: a request to sign your message with the key at " + path + ". On the device, turn on Settings > Advanced > Message signing (off at first, as on SeedSigner), then choose Scan on Home.", "ok");
  ssOwnShowDevice();
  ssOwnTimerOn();
}
async function ssOwnFile(ev) {
  const f = ev.target.files && ev.target.files[0]; ev.target.value = "";
  if (!f) return;
  if (f.size > SS_OWN_MAX_FILE) { ssOwnSay("Not read: this file is larger than a PSBT should be.", "bad"); return; }
  let b; try { b = new Uint8Array(await f.arrayBuffer()); } catch (e) { ssOwnSay("Not read: the file could not be opened.", "bad"); return; }
  const text = b.length > 4 && b[0] === 0x70 && b[1] === 0x73 && b[2] === 0x62 && b[3] === 0x74 && b[4] === 0xff ? base64Encode(b) : new TextDecoder().decode(b).trim();
  b.fill(0);
  await ssOwnHold(text, true);   // checked first: a file of seed words never reaches the box
}

// ---------------------------------------------------------------- the signing rules (called by the device: SIM: VOIDFORGE rule)
const SS_OWN_ASK_PSBT = (fp, online) => "Sign this transaction with your real seed " + fp + "?\n\n" +
  "- Check every address and amount on the device’s screen against what you meant to send. Single-key change is checked against your seed; multisig change only against a wallet descriptor of yours scanned on the device, else the device shows what the PSBT claims.\n" +
  (online ? "- THIS COMPUTER IS ONLINE. A browser is not a hardware signer: anything watching this computer could copy your seed. Take it offline before you sign for real coins.\n"
    : "- This computer looks offline. Keep it offline until you have wiped the seed (CLEAR ALL).\n") +
  "\nSign it?";
const SS_OWN_ASK_MSG = (fp, online) => (online ? "This computer is online. " : "") + "Sign this message with your real seed " + fp + "?\n\n" +
  "- Read the message on the device’s screen: a signature proves to anyone that you, the owner of this address, wrote it.\n" +
  (online ? "- A browser is not a hardware signer: anything watching this computer could copy your seed. Take it offline first if you can.\n"
    : "- This computer looks offline. Keep it offline until you have wiped the seed (CLEAR ALL).\n") +
  "\nSign it?";
const SS_OWN_ASK_CHANGE = (list) => "The device did NOT verify that this change comes back to your multisig wallet:\n\n" +
  list.map((c) => "- output " + c.output_index + ": " + ssOwnSats(c.amount) + " to " + c.address).join("\n") +
  "\n\nOnly the PSBT says it is yours. If it is not, these " + ssOwnSats(list.reduce((a, c) => a + c.amount, 0)) + " go to someone else. To check it, choose Cancel, then on the device Verify multisig change and scan your own wallet descriptor.\n\nSign anyway?";
function ssOwnBlock(head, text, page, home) {
  ssOwnOutClear();   // a signed PSBT shown from before is not this answer
  ssOwnSay(page, "bad");
  return new SSDestination(SSErrorView, { view_args: {
    title: "Error", status_headline: head, text, button_text: "Back",
    next_destination: home ? new SSDestination(SSMainMenuView, { clear_history: true }) : new SSDestination(SSBackStackView),   // back to Sign Transaction
  } });
}
// kind "psbt": ctx = {parser, desc} (the device's PSBT parser and wallet descriptor); kind "msg": ctx = {message}
async function ssOwnSignGate(kind, seed, psbt, network, ctx = {}) {
  let fp = "this seed"; try { fp = await seed.get_fingerprint(network); } catch (e) { /* named without it */ }
  if (kind === "psbt") {
    const nw = ssOwnNetWrong(psbt, network);
    if (nw) return ssOwnBlock("Wrong network", "This transaction is for another network than the device’s.", "Not signed: " + nw + " Set the device’s network in Settings > Advanced > Bitcoin network, or use the PSBT for this network.");
    const prev = await ssOwnPrevBad(psbt);
    if (prev.length) return ssOwnBlock("Forged coin?", "Input " + prev[0].i + " carries a previous transaction that is not the coin it spends. Its amount and the fee cannot be trusted.",
      "Not signed: input " + prev[0].i + ": " + prev[0].why + ". The amounts and the fee the device showed cannot be trusted: a PSBT like this can hide a huge fee. Ask your wallet for a new PSBT.");
    // nothing to sign: no question (the device ends on Signing Failed, or stops with its own error)
    const parser = ctx.parser;
    let dry = null; try { dry = parser && parser.root ? await ssOwnWillSign(psbt, parser.root) : null; } catch (e) { dry = null; }
    if (dry && !dry.err && !dry.fresh.length && dry.again.length) { ssOwnOutClear(); ssOwnSay("Nothing new to sign: seed " + fp + " has signed this PSBT already (" + ssOwnList(dry.again) + "). Give the signed PSBT to your wallet.", "bad"); return null; }
    if (dry && (dry.err || !dry.fresh.length)) { ssOwnOutClear(); ssOwnSay("Nothing signed: seed " + fp + (dry.err ? " stops with an error on this PSBT (" + dry.err + ")." : " cannot add a signature to any input of this PSBT (not its coins, or sighash types SeedSigner does not sign).") + " Check that the right seed is loaded, with its passphrase.", "bad"); return null; }
  }
  if (ssOwnSeedPublic(seed)) return null;          // a public seed: PRACTICE, nothing to lose
  if (kind === "psbt" && ssOwnIsPracticeTx(psbt)) return null;   // the practice transaction spends made-up coins
  if (kind === "msg" && ctx.message === SS_LEARN_MSG) return null;   // the message lesson's practice message
  const online = navigator.onLine === true;
  if (!confirm(kind === "psbt" ? SS_OWN_ASK_PSBT(fp, online) : SS_OWN_ASK_MSG(fp, online))) {
    if (kind === "msg") { try { const c = SSController._instance; c.sign_message_data = null; c.resume_main_flow = null; } catch (e) { /* no device */ } }
    return ssOwnBlock("Not signed", "You chose not to sign. Nothing was signed.", "Not signed: you chose not to sign with seed " + fp + ". Nothing was signed.", kind === "msg");
  }
  if (kind === "psbt") {   // multisig change the device did not verify against a wallet descriptor of this seed: a second question
    const parser = ctx.parser;
    let left = [];
    try {
      if (parser && parser.is_multisig && parser.change_data.length) {
        const tr = await ssOwnMsigTrust(psbt, seed, network, ctx.desc && Array.isArray(ctx.desc.keys) ? ctx.desc : null);
        if (!tr.trusted) left = parser.change_data;
        else for (const c of parser.change_data) { let ok = false; try { ok = await tr.desc.owns(psbt.outputs[c.output_index]); } catch (e) { ok = false; } if (!ok) left.push(c); }   // (the device has refused such change before this point)
      }
    } catch (e) { left = parser ? parser.change_data : []; }
    if (left.length && !confirm(SS_OWN_ASK_CHANGE(left)))
      return ssOwnBlock("Not signed", "You chose not to sign: the change was not verified. Nothing was signed.", "Not signed: you chose not to sign while the device had not verified the multisig change (" + ssOwnSats(left.reduce((a, x) => a + x.amount, 0)) + "). Nothing was signed.");
  }
  return null;
}

// ---------------------------------------------------------------- what the device made, taken back
function ssOwnTimerOn() { if (!ssOwn.timer && ssPageOn) ssOwn.timer = setInterval(ssOwnTick, 250); }
function ssOwnTick() {
  if (!ssPageOn) { if (ssOwn.timer) { clearInterval(ssOwn.timer); ssOwn.timer = null; } return; }
  const s = ssLearnState(); if (!s || !s.ctl) return;
  const c = s.ctl, v = c.current_destination && c.current_destination.view;
  if (s.view === "SSPSBTSignedQRDisplayView" && c.psbt && c.psbt !== ssOwn.seenSig) { ssOwn.seenSig = c.psbt; ssOwnTakePsbt(c); }
  else if (s.view === "SSSeedSignMessageConfirmAddressView" && v && v.address) ssOwn.msgAddr = v.address;
  else if (s.view === "SSSeedSignMessageSignedMessageQRView" && v && v.signed_message && v !== ssOwn.seenMsg) { ssOwn.seenMsg = v; ssOwnTakeMsg(v); }
  else if (s.view === "SSSeedAddressVerificationSuccessView" && s.scr && s.scr !== ssOwn.seenAddr && s.scr.address) {
    ssOwn.seenAddr = s.scr;
    ssOwnAddrDone(s.scr, c, v);
  } else if (s.view === "SSMultisigWalletDescriptorView" && s.scr && s.scr !== ssOwn.seenDesc && s.scr.policy) {
    ssOwn.seenDesc = s.scr;
    ssOwnDescLoaded(s.scr, c.multisig_wallet_descriptor);
  }
}
// An address the device verified. A multisig address is matched against the wallet descriptor on the device: it says something
// about your wallet only when a seed on the device is in that descriptor (its own key, at the path it names).
async function ssOwnAddrDone(scr, ctl, view) {
  const gen = ssOwn.gen, nw = ssOwnAddrNetWrong(scr.address, ssLearnNet()), kind = (scr.verified_index_is_change ? "change" : "receive") + " address #" + scr.verified_index;
  const desc = view && view.seed ? null : ssOwnDesc(ctl);
  let ds = null;
  if (desc) { try { ds = await ssOwnDescSeeds(desc, ssLearnSeeds().filter((x) => x && x.seed_bytes instanceof Uint8Array), ssOwnDevNet()); } catch (e) { ds = { inIt: [] }; } }
  if (gen !== ssOwn.gen || !ssPageOn) return;
  if (desc && !ds.inIt.length) return ssOwnSay("The address " + scr.address + " is " + kind + " of the wallet descriptor on the device, which does not hold your seed’s key: this proves nothing about your wallet." + (nw ? " " + nw : ""), "bad");
  ssOwnSay("The device verified the address " + scr.address + ": it is " + kind + " of " + (desc ? "the multisig wallet of seed " + ds.inIt.join(", ") : "this wallet") + (nw ? ", on the address’s own network. " + nw : "."), nw ? "bad" : "ok");
}
// A wallet descriptor loaded on the device: is a seed on the device in it, with its own key at the origin the descriptor names?
// If not, the device's checks against it prove nothing about this seed's wallet (it may be anyone's), and the page says so.
async function ssOwnDescLoaded(scr, desc) {
  const gen = ssOwn.gen, head = "The device loaded the wallet descriptor: policy " + scr.policy + ", cosigners " + (scr.fingerprints || []).join(", ") + ". ";
  const seeds = ssLearnSeeds().filter((x) => x && x.seed_bytes instanceof Uint8Array);
  let ds = null; try { ds = desc && Array.isArray(desc.keys) ? await ssOwnDescSeeds(desc, seeds, ssOwnDevNet()) : null; } catch (e) { ds = null; }
  if (gen !== ssOwn.gen || !ssPageOn) return;
  if (!ds) return ssOwnSay(head + "This page could not check which seeds are in it.", "bad");
  if (!seeds.length) return ssOwnSay(head + "No seed is loaded on the device, so this page cannot check that this wallet is yours. Load your seed, then scan the descriptor again.", "warn");
  if (!ds.inIt.length) return ssOwnSay(head + "NONE of the seeds on the device is in it" + (ds.claims.length ? " (it names fingerprint " + ds.claims.join(", ") + ", but the key there is not that seed’s)" : "") + ". It may be someone else’s wallet: the device checks change and addresses against it as SeedSigner does, but that proves nothing about your wallet. Scan your own wallet’s descriptor.", "bad");
  ssOwnSay(head + "Seed " + ds.inIt.join(", ") + " is in it (its own key, at the path the descriptor names). The device now checks multisig change and addresses against it, until it is switched off or another descriptor is scanned; this page counts change as verified only when the descriptor also makes the coins being spent.", "ok");
}
// Every signature in the PSBT the device signed (before SeedSigner trims it), checked with the page's own code
async function ssOwnCheck(full, n) {
  const res = await inspectPsbt(full, ssLearnKeyNet(n));
  await psbtSigCheck(res);
  const S = res.ins.map((x, i) => ({ i, R: x.sv })).filter((o) => o.R && o.R.state !== "none");
  const bad = S.filter((o) => o.R.state === "invalid").map((o) => o.i), ok = S.filter((o) => o.R.state === "valid");
  return { bad, valid: ok.reduce((a, o) => a + o.R.n, 0), unchecked: S.filter((o) => o.R.state === "unchecked").map((o) => o.i) };
}
async function ssOwnTakePsbt(c) {
  const signed = c.psbt, seed = c.psbt_seed, parser = c.psbt_parser, gen = ssOwn.gen, n = ssLearnNet();
  if (ssOwnIsPracticeTx(signed)) return;   // the practice transaction: the practice wallet reads it back itself (ss_learn.js)
  let bytes, full = null;
  try { bytes = signed.serialize(); } catch (e) { return; }
  try { full = parser && parser.psbt ? parser.psbt.serialize() : null; } catch (e) { full = null; }
  const pub = ssOwnSeedPublic(seed);
  let fp = ""; try { fp = await seed.get_fingerprint(); } catch (e) { fp = ""; }
  // the seed's own inputs, and which of them the device signed (the full PSBT it signed, before SeedSigner trims it)
  const mine = [], done = [];
  try {
    parser.psbt.inputs.forEach((inp, i) => {
      const ders = [...inp.bip32_derivations, ...inp.taproot_bip32_derivations].filter((d) => hex(d.der.fingerprint) === fp); if (!ders.length) return;
      mine.push(i);
      if (inp.final_scriptwitness || inp.partial_sigs.some((p) => ders.some((d) => hex(ssPsbtSec(d.pub)) === hex(p.pub)))) done.push(i);
    });
  } catch (e) { /* not known */ }
  let chk = null; try { chk = full ? await ssOwnCheck(full, n) : null; } catch (e) { chk = null; }
  if (full) full.fill(0);
  let txid = ""; try { txid = (await inspectPsbt(bytes, ssLearnKeyNet(n))).txid; } catch (e) { txid = ""; }   // the page's own code
  if (gen !== ssOwn.gen || !ssPageOn) { bytes.fill(0); return; }
  const sigs = SSPSBTParser.sig_count(signed), left = mine.filter((i) => !done.includes(i));
  let say = (pub ? "PRACTICE: signed with a public seed (" + fp + "). Anyone can sign with it: never put money on it. " : "Signed by seed " + fp + " (a real seed): ") +
    sigs + " signature" + (sigs === 1 ? "" : "s") + ", as the device shows it in its animated QR. ";
  let cls = pub ? "bad" : "ok", good = true;
  // L1: the transaction signed must be the one held up, byte for byte (its txid, worked out by the page's own code)
  if (ssOwn.txid && txid !== ssOwn.txid) { say += "This is NOT the transaction you held up: its txid is " + (txid || "unknown") + ", not " + ssOwn.txid + ". Do not use it. "; good = false; }
  if (!chk) { say += "This page could not check the signatures itself."; good = false; }
  else if (chk.bad.length) { say += "INVALID SIGNATURE on input " + chk.bad.join(", ") + " (checked by this page’s own code). Do not broadcast this transaction."; good = false; }
  else if (!chk.valid) { say += "None of the signatures could be checked by this page’s own code."; good = false; }
  else say += "Each signature checked by this page’s own code: valid" + (chk.unchecked.length ? "; input " + chk.unchecked.join(", ") + " not checked" : "") + ".";
  if (left.length) { say += " Signed " + (done.length ? ssOwnList(done) : "none") + " of this seed’s inputs; NOT signed: " + ssOwnList(left) + " (a sighash type SeedSigner does not sign, or a key it could not match). The transaction is not complete."; if (cls === "ok") cls = "warn"; }
  if (good) say += " Give it back to your wallet (the QR on the device, the text below, or the file), which adds the other signatures it needs and sends it.";
  else { say += " So this page does not offer it to copy or save."; cls = "bad"; }
  ssOwnShow({ kind: "psbt", bytes, fp, pub, text: good ? base64Encode(bytes) : "", say, cls, noOut: !good });
}
async function ssOwnTakeMsg(v) {
  const sig = v.signed_message, msg = v._ss_message, path = v._ss_derivation_path, seed = v._ss_seed, addr = ssOwn.msgAddr, gen = ssOwn.gen;
  const pub = ssOwnSeedPublic(seed);
  let fp = ""; try { fp = await seed.get_fingerprint(); } catch (e) { fp = ""; }
  let ok = null; try { ok = addr ? (await verifyMessage(addr, msg, sig)).state === "valid" : null; } catch (e) { ok = null; }
  if (gen !== ssOwn.gen || !ssPageOn) return;
  const block = "-----BEGIN BITCOIN SIGNED MESSAGE-----\n" + msg + "\n-----BEGIN SIGNATURE-----\n" + (addr || "") + "\n" + sig + "\n-----END BITCOIN SIGNED MESSAGE-----";
  const say = (pub ? "PRACTICE: signed with a public seed. Anyone can sign with it: never use it to prove anything. " : "Signed with your real seed " + fp + ": ") +
    "the message, signed with the key of " + (addr || path) + " (" + path + "), in the Bitcoin Signed Message format SeedSigner uses. " +
    (ok === true ? "The signature checks out (checked by this page’s own code)." : ok === false ? "The signature does NOT check out against this address (checked by this page’s own code)." : "") +
    " The device shows the signature as a QR code.";
  ssOwnShow({ kind: "msg", sig, fp, pub, text: block, say, cls: pub || ok === false ? "bad" : "ok" });
}
function ssOwnShow(o) {
  if (ssOwn.out && ssOwn.out.bytes && ssOwn.out.bytes !== o.bytes) ssOwn.out.bytes.fill(0);
  ssOwn.out = o;
  const box = ssOwnEl("ssOwnOut"); if (!box) return;
  box.hidden = false;
  const s = ssOwnEl("ssOwnOutSay"); s.textContent = o.say; s.className = "status ss-banner " + o.cls;
  const ta = ssOwnEl("ssOwnOutText"); ta.value = o.text; ta.hidden = !!o.noOut;   // L4: nothing to copy or save that is not checked good
  ssOwnEl("ssOwnCopy").hidden = !!o.noOut;
  ssOwnEl("ssOwnSave").hidden = o.kind !== "psbt" || !!o.noOut;
  ssOwnEl("ssOwnCopySig").hidden = o.kind !== "msg" || !!o.noOut;
  try { box.scrollIntoView({ block: "nearest" }); } catch (e) { /* not laid out */ }
}
function ssOwnCopy(btn, sigOnly) {
  const o = ssOwn.out; if (!o || o.noOut) return;
  const t = sigOnly ? o.sig : o.text;
  (typeof safeCopy === "function" ? safeCopy(t) : Promise.reject(new Error("no clipboard"))).then(() => { if (typeof showCopied === "function") showCopied(btn); }).catch(() => alert("Copy failed. Select the text and copy it manually."));
}
function ssOwnSave() {
  const o = ssOwn.out; if (!o || o.kind !== "psbt" || o.noOut) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([o.bytes], { type: "application/octet-stream" }));
  a.download = "voidforge-signed-" + (o.fp || "psbt") + (o.pub ? "-PRACTICE" : "") + ".psbt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Re-hide (RH_HOLD in the main script): the output is a reason to cover while it holds a message signature, or while the device
// holds a seed that is not public
function ssOwnHoldsSecret() {
  if (!ssOwn.out) return false;
  try { return ssOwn.out.kind === "msg" || vfSignerHoldsSecret(); } catch (e) { return true; }
}
// Called by ssPageStop and wipeSeed: the PSBT held up, the outputs, the typed message and request, the warnings
function ssOwnWipe() {
  ssOwn.gen++;
  if (ssOwn.timer) { clearInterval(ssOwn.timer); ssOwn.timer = null; }
  if (ssOwn.out && ssOwn.out.bytes) ssOwn.out.bytes.fill(0);
  if (ssOwn.psbt) ssOwn.psbt.fill(0);
  ssOwn.psbt = null; ssOwn.out = null; ssOwn.txid = ""; ssOwn.kind = ""; ssOwn.msgAddr = ""; ssOwn.seenSig = null; ssOwn.seenMsg = null; ssOwn.seenAddr = null; ssOwn.seenDesc = null;
  try { if (ssLearnCam.key === "own") ssLearnHide(); } catch (e) { /* lessons part missing */ }
  for (const id of ["ssOwnIn", "ssMsgIn", "ssOwnOutText"]) { const e = ssOwnEl(id); if (e) e.value = ""; }
  const box = ssOwnEl("ssOwnOut"); if (box) box.hidden = true;
  const s = ssOwnEl("ssOwnOutSay"); if (s) { s.textContent = ""; s.className = "status"; }
  ssOwnWarns([]); ssOwnSay("");
}
function ssOwnInit() {
  const go = ssOwnEl("ssOwnGo"); if (!go) return;
  go.addEventListener("click", ssOwnGo);
  ssOwnEl("ssMsgGo").addEventListener("click", ssOwnMsgGo);
  ssOwnEl("ssOwnFileBtn").addEventListener("click", () => ssOwnEl("ssOwnFile").click());
  ssOwnEl("ssOwnFile").addEventListener("change", ssOwnFile);
  ssOwnEl("ssOwnClear").addEventListener("click", ssOwnWipe);
  ssOwnEl("ssOwnCopy").addEventListener("click", (e) => ssOwnCopy(e.currentTarget, false));
  ssOwnEl("ssOwnCopySig").addEventListener("click", (e) => ssOwnCopy(e.currentTarget, true));
  ssOwnEl("ssOwnSave").addEventListener("click", ssOwnSave);
  const box = ssOwnEl("ssBox"); if (box) box.addEventListener("toggle", () => { if (box.open) setTimeout(ssOwnTimerOn, 0); });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ssOwnInit); else ssOwnInit();
