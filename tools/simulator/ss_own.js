// ss_own.js: "Use it for real" (v2.17.0), next to the practice signer in #ssBox. The practice signer is a real signer: this part
// lets a person show it their own PSBT, address, multisig wallet descriptor or message request, and takes back what the device
// makes. Nothing is put into the device's memory from here: the practice wallet (ss_learn.js) holds the QR code up to the device's
// camera, the person chooses Scan, and the device does the rest exactly as SeedSigner 0.8.7 does (the review screens, change
// verification by derivation path or wallet descriptor, its own warnings, signing). This part adds:
//   - ssOwnRead: what was pasted, chosen (a .psbt file) or scanned (the page's camera: CAM_TARGETS.ssOwnIn), and refuses seeds and
//     private keys;
//   - ssOwnReview: warnings next to the device before the scan (wrong network, no seed on the device can sign it, inputs of other
//     signers, sighash types SeedSigner does not sign, a fee above the payment or a very high fee rate, outputs that name the seed
//     but are not provably its own, so the device shows them as payments), worked out with the device's own parser;
//   - ssOwnSignGate: the signing rules, called by the device when Approve transaction or Sign message is chosen (SIM: VOIDFORGE
//     rule): the PSBT's network must be the device's, and a seed that is not public signs a PSBT only after a yes to a plain
//     question (checked outputs; this computer offline, or a stronger warning while it is online), a message while online too;
//   - the outputs: the signed PSBT exactly as the device made it (SeedSigner's trimmed PSBT, the bytes its animated QR holds), as
//     base64 to copy and a .psbt file to save, with every signature checked by the page's own code (inspectPsbt, psbtSigCheck);
//     the message signature (base64, and a signed-message block). A seed that is public signs as PRACTICE.
// Wiped by ssPageStop (box closed, CLEAR ALL, auto-clear, END SESSION) and wipeSeed (ssOwnWipe).
"use strict";
const SS_OWN_FRAG = 120;          // UR fragment length of a PSBT held up (as a wallet app's animated QR)
const SS_OWN_HIGH_RATE = 1000;    // sat/vB: a fee rate at or above this is called very high
const SS_OWN_MAX_FILE = 4000000;  // bytes: a larger file is not read
const ssOwn = { gen: 0, timer: null, psbt: null, txKey: "", kind: "", out: null, msgAddr: "", seenSig: null, seenMsg: null, seenAddr: null, seenDesc: null, busy: false };
const ssOwnEl = (id) => document.getElementById(id);

function ssOwnSay(text, cls) {
  const e = ssOwnEl("ssOwnStatus"); if (!e) return;
  if (e.textContent !== text) e.textContent = text;
  e.className = "status" + (cls && text ? " ss-banner " + cls : "");
  if (cls && text) try { e.scrollIntoView({ block: "nearest" }); } catch (err) { /* not laid out */ }
}
function ssOwnWarns(list) {   // [{t, bad}] next to the device
  const u = ssOwnEl("ssOwnWarns"); if (!u) return;
  u.textContent = "";
  for (const x of list || []) { const li = document.createElement("li"); li.textContent = x.t; if (x.bad) li.className = "bad"; u.appendChild(li); }
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

// ---------------------------------------------------------------- what was pasted, chosen or scanned
function ssOwnRead(text) {
  const raw = String(text || ""), t = raw.trim();
  if (!t) return { error: "Paste a PSBT, an address, a wallet descriptor or a signmessage request first, or choose a .psbt file." };
  const words = t.toLowerCase().split(/\s+/);
  if (/^(\d{48}|\d{96})$/.test(t) || (words.length >= 12 && words.length <= 24 && words.every((w) => WORDLIST.includes(w))))
    return { error: "This looks like the words or SeedQR of a seed. Never paste a seed here: load it with LOAD INTO THE PRACTICE SIGNER (under YOUR SEED) or on the device itself." };
  if (/[xyztuvYZUV]prv[1-9A-HJ-NP-Za-km-z]{100}/.test(t)) return { error: "This holds a private key (xprv). The device reads public keys only: paste the wallet descriptor with xpubs." };
  if (/^signmessage\s/.test(t)) {
    const m = /^signmessage\s+(m(?:\/\d+[h']?)+)\s+ascii:([\s\S]*)$/.exec(raw.replace(/^\s+/, "").replace(/\r?\n$/, ""));
    if (!m) return { error: "A message request reads: signmessage <path> ascii:<message>, such as signmessage m/84h/0h/0h/0/0 ascii:Hello." };
    const e = ssOwnMsgError(m[2]); if (e) return { error: e };
    return { kind: "msg", frames: [raw.replace(/^\s+/, "").replace(/\r?\n$/, "")], what: "your request to sign a message with the key at " + m[1] };
  }
  let type = ""; try { type = SSDecodeQR.detect_segment_type(t.split(/\r?\n/)[0].trim()); } catch (e) { type = ""; }
  if (type === SSQRType.BITCOIN_ADDRESS && !/\s/.test(t) && !/^cHNidP8/.test(t)) return { kind: "address", frames: [t], what: "the address " + t.slice(/^bitcoin:/i.test(t) ? 8 : 0).split("?")[0] };
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

// ---------------------------------------------------------------- warnings before the scan, with the device's own parser
async function ssOwnReview(bytes) {
  const W = [], S = SSSettingsConstants, n = ssLearnNet(), network = n === "M" ? S.MAINNET : n === "T" ? S.TESTNET : S.REGTEST;
  const psbt = SSPSBT.parse(bytes), fresh = () => SSPSBT.parse(bytes);
  const nw = ssOwnNetWrong(psbt, network);
  if (nw) W.push({ bad: true, t: nw + " The device will not sign it (VOIDFORGE’s rule): set the device’s network in Settings > Advanced > Bitcoin network, or use the PSBT for this network." });
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
    const sh = inp.sighash_type, okSh = sh === null || sh === 1 || (inp.is_taproot && sh === 0);
    if (!okSh) W.push({ bad: true, t: "Input " + i + " asks for sighash " + (typeof sighashName === "function" ? sighashName(inp.is_taproot ? "Schnorr" : "ECDSA", sh) : sh) + ". SeedSigner signs only with SIGHASH_ALL (and SIGHASH_DEFAULT for Taproot), so the device will not sign this input." });
    if (inp.taproot_bip32_derivations.some((d) => d.leaf_hashes.length)) W.push({ bad: true, t: "Input " + i + " spends from a Taproot script tree. SeedSigner signs Taproot key spends only, so the device stops with an error." });
    if (!inp.witness_utxo && !inp.non_witness_utxo) W.push({ bad: true, t: "Input " + i + " does not carry the coin it spends, so its amount and the fee are unknown and the device cannot read this PSBT. Ask your wallet for a PSBT with the coins being spent." });
    else if (inp.witness_utxo && !inp.non_witness_utxo && ssPsbtScriptType(inp.witness_utxo.script_pubkey) === "p2pkh") W.push({ bad: true, t: "Input " + i + " is a legacy (P2PKH) coin without its full previous transaction. A signature made from this PSBT would be invalid. Ask your wallet for a PSBT with the full previous transaction." });
  });
  if (!signer) return { W, signer: null };
  const mineIn = psbt.inputs.filter((inp) => [...inp.bip32_derivations, ...inp.taproot_bip32_derivations].some((d) => hex(d.der.fingerprint) === sfp)).length;
  if (mineIn < psbt.inputs.length) W.push({ bad: false, t: mineIn + " of " + psbt.inputs.length + " inputs belong to seed " + sfp + ": the device signs only those. The others need their own signers before the transaction can be sent." });
  let parser = null;
  try { parser = await SSPSBTParser.create(fresh(), signer, network); }
  catch (e) { W.push({ bad: true, t: "The device cannot read this PSBT with seed " + sfp + ": " + (e && e.message ? e.message : e) + "." }); return { W, signer }; }
  finally { try { if (parser && parser.root) parser.root.wipe(); } catch (e) { /* nothing to wipe */ } }
  const fee = parser.fee_amount, pay = parser.spend_amount, vb = ssOwnVsize(psbt), rate = vb > 0 ? fee / vb : 0;
  if (pay > 0 && fee > pay) W.push({ bad: true, t: "The fee (" + ssOwnSats(fee) + ") is higher than the payment (" + ssOwnSats(pay) + "). Check the fee in your wallet before you sign." });
  if (rate >= SS_OWN_HIGH_RATE) W.push({ bad: true, t: "The fee rate is about " + Math.round(rate).toLocaleString("en-US") + " sat/vB (" + ssOwnSats(fee) + " for about " + vb + " vB). That is very high: check the fee in your wallet before you sign." });
  const changeIdx = new Set(parser.change_data.map((c) => c.output_index));
  psbt.outputs.forEach((o, i) => {
    if (changeIdx.has(i)) return;
    if ([...o.bip32_derivations, ...o.taproot_bip32_derivations].some((d) => hex(d.der.fingerprint) === sfp))
      W.push({ bad: true, t: "Output " + i + " names seed " + sfp + " but the device cannot prove it is yours (its key or script does not match), so the device shows it as a payment (Will Send), as SeedSigner does. Check that address before you sign." });
  });
  W.push({ bad: false, t: "Seed " + sfp + " can sign. The device will show " + ssOwnSats(parser.input_amount) + " in from " + parser.num_inputs + " input" + (parser.num_inputs === 1 ? "" : "s") + ", " + ssOwnSats(pay) + " to " + parser.num_destinations + " address" + (parser.num_destinations === 1 ? "" : "es") + ", " + ssOwnSats(parser.change_amount) + " back as change, and a fee of " + ssOwnSats(fee) + " (about " + (Math.round(rate * 10) / 10).toLocaleString("en-US") + " sat/vB). Anything it cannot prove is yours is shown as a payment." });
  return { W, signer };
}

// ---------------------------------------------------------------- HOLD UP TO THE DEVICE
async function ssOwnGo() {
  if (ssOwn.busy) return;
  if (!ssPageOn) { ssOwnSay("Open the practice signer first: its box, above.", "bad"); return; }
  const r = ssOwnRead((ssOwnEl("ssOwnIn") || {}).value);
  if (r.error) { ssOwnWarns([]); ssOwnSay("Not held up: " + r.error, "bad"); return; }
  ssOwn.busy = true; const gen = ++ssOwn.gen;
  try {
    let frames = r.frames, what = r.what, W = [];
    if (r.kind === "psbt") {
      const p = SSPSBT.parse(r.bytes);
      ssOwn.psbt = r.bytes.slice(); ssOwn.txKey = hex(ssPsbtSerializeTx(p.tx));
      frames = urEncode("crypto-psbt", CB.bytes(Array.from(r.bytes)), SS_OWN_FRAG).map((x) => x.toUpperCase());
      what = "your PSBT (" + frames.length + " QR part" + (frames.length === 1 ? "" : "s") + ")";
      try { W = (await ssOwnReview(r.bytes)).W; } catch (e) { W = [{ bad: true, t: "Could not review this PSBT: " + (e && e.message ? e.message : e) + "." }]; }
      if (gen !== ssOwn.gen || !ssPageOn) return;
    }
    ssOwn.kind = r.kind;
    ssLearnShow(frames, what, "own");
    ssOwnWarns(W);
    const next = { psbt: "On the device, choose Scan (Home > Scan), then the seed that signs. Check every address and amount on its screens.",
      address: "On the device, choose Scan (Home > Scan). It searches the seed’s receive and change addresses, as SeedSigner does; a multisig address needs the wallet descriptor first.",
      descriptor: "On the device, choose Scan (Home > Scan). It loads the wallet descriptor and then checks multisig change and addresses against it.",
      msg: "On the device, turn on Settings > Advanced > Message signing (off at first, as on SeedSigner), then choose Scan on Home." }[r.kind];
    ssOwnSay("Held up to the device’s camera: " + what + ". " + next, W.some((x) => x.bad) ? "" : "ok");
    ssOwnTimerOn();
  } finally { ssOwn.busy = false; }
}
// HOLD UP THE MESSAGE: the signmessage request SeedSigner reads, for the address type and number chosen
function ssOwnMsgGo() {
  const msg = (ssOwnEl("ssMsgIn") || {}).value || "", purpose = (ssOwnEl("ssMsgType") || {}).value || "84", idx = Number((ssOwnEl("ssMsgIdx") || {}).value || 0);
  if (!ssPageOn) { ssOwnSay("Open the practice signer first: its box, above.", "bad"); return; }
  const e = ssOwnMsgError(msg); if (e) { ssOwnSay("Not held up: " + e, "bad"); return; }
  if (!Number.isInteger(idx) || idx < 0 || idx > 999999) { ssOwnSay("Not held up: the address number is 0 to 999,999.", "bad"); return; }
  if (!["84", "49", "44"].includes(purpose)) return;
  const path = "m/" + purpose + "h/" + ssLearnCoin(ssLearnNet()) + "h/0h/0/" + idx;
  ssOwn.gen++; ssOwn.kind = "msg"; ssOwnWarns([]);
  ssLearnShow(["signmessage " + path + " ascii:" + msg], "your request to sign a message with the key of receive address #" + idx + " (" + path + ")", "own");
  ssOwnSay("Held up to the device’s camera: a request to sign your message with the key at " + path + ". On the device, turn on Settings > Advanced > Message signing (off at first, as on SeedSigner), then choose Scan on Home.", "ok");
  ssOwnTimerOn();
}
async function ssOwnFile(ev) {
  const f = ev.target.files && ev.target.files[0]; ev.target.value = "";
  if (!f) return;
  if (f.size > SS_OWN_MAX_FILE) { ssOwnSay("Not read: this file is larger than a PSBT should be.", "bad"); return; }
  let b; try { b = new Uint8Array(await f.arrayBuffer()); } catch (e) { ssOwnSay("Not read: the file could not be opened.", "bad"); return; }
  const box = ssOwnEl("ssOwnIn"); if (!box) return;
  box.value = b.length > 4 && b[0] === 0x70 && b[1] === 0x73 && b[2] === 0x62 && b[3] === 0x74 && b[4] === 0xff ? base64Encode(b) : new TextDecoder().decode(b).trim();
  b.fill(0);
  await ssOwnGo();
}

// ---------------------------------------------------------------- the signing rules (called by the device: SIM: VOIDFORGE rule)
const SS_OWN_ASK_PSBT = (fp, online) => "Sign this transaction with your real seed " + fp + "?\n\n" +
  "- Check every address and amount on the device’s screen against what you meant to send. Change that the device cannot prove is yours is shown as a payment.\n" +
  (online ? "- THIS COMPUTER IS ONLINE. A browser is not a hardware signer: anything watching this computer could copy your seed. Take it offline before you sign for real coins.\n"
    : "- This computer looks offline. Keep it offline until you have wiped the seed (CLEAR ALL).\n") +
  "\nSign it?";
const SS_OWN_ASK_MSG = (fp) => "This computer is online. Sign this message with your real seed " + fp + "?\n\n" +
  "A browser is not a hardware signer: anything watching this computer could copy your seed. Take it offline first if you can.\n\nSign it?";
function ssOwnBlock(head, text, page, home) {
  ssOwnSay(page, "bad");
  return new SSDestination(SSErrorView, { view_args: {
    title: "Error", status_headline: head, text, button_text: "Back",
    next_destination: home ? new SSDestination(SSMainMenuView, { clear_history: true }) : new SSDestination(SSBackStackView),   // back to Sign Transaction
  } });
}
async function ssOwnSignGate(kind, seed, psbt, network) {
  if (kind === "psbt") {
    const nw = ssOwnNetWrong(psbt, network);
    if (nw) return ssOwnBlock("Wrong network", "This transaction is for another network than the device’s.", "Not signed: " + nw + " Set the device’s network in Settings > Advanced > Bitcoin network, or use the PSBT for this network.");
  }
  if (ssOwnSeedPublic(seed)) return null;          // a public seed: PRACTICE, nothing to lose
  if (kind === "psbt" && ssOwnIsPracticeTx(psbt)) return null;   // the practice transaction spends made-up coins
  const online = navigator.onLine === true;
  if (kind === "msg" && !online) return null;
  let fp = "this seed"; try { fp = await seed.get_fingerprint(network); } catch (e) { /* named without it */ }
  if (confirm(kind === "psbt" ? SS_OWN_ASK_PSBT(fp, online) : SS_OWN_ASK_MSG(fp))) return null;
  if (kind === "msg") { try { const c = SSController._instance; c.sign_message_data = null; c.resume_main_flow = null; } catch (e) { /* no device */ } }
  return ssOwnBlock("Not signed", "You chose not to sign. Nothing was signed.", "Not signed: you chose not to sign with seed " + fp + ". Nothing was signed.", kind === "msg");
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
    ssOwnSay("The device verified the address " + s.scr.address + ": it is " + (s.scr.verified_index_is_change ? "change" : "receive") + " address #" + s.scr.verified_index + " of this wallet.", "ok");
  } else if (s.view === "SSMultisigWalletDescriptorView" && s.scr && s.scr !== ssOwn.seenDesc && s.scr.policy) {
    ssOwn.seenDesc = s.scr;
    ssOwnSay("The device loaded the wallet descriptor: policy " + s.scr.policy + ", cosigners " + (s.scr.fingerprints || []).join(", ") + ". It now checks multisig change and addresses against it (until the device is switched off).", "ok");
  }
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
  let chk = null; try { chk = full ? await ssOwnCheck(full, n) : null; } catch (e) { chk = null; }
  if (full) full.fill(0);
  if (gen !== ssOwn.gen || !ssPageOn) { bytes.fill(0); return; }
  const sigs = SSPSBTParser.sig_count(signed);
  let say = (pub ? "PRACTICE: signed with a public seed (" + fp + "). Anyone can sign with it: never put money on it. " : "Signed by seed " + fp + ": ") +
    sigs + " signature" + (sigs === 1 ? "" : "s") + ", as the device shows it in its animated QR. ";
  let cls = pub ? "bad" : "ok";
  if (!chk) say += "This page could not check the signatures itself.";
  else if (chk.bad.length) { say += "INVALID SIGNATURE on input " + chk.bad.join(", ") + " (checked by this page’s own code). Do not broadcast this transaction."; cls = "bad"; }
  else say += "Each signature checked by this page’s own code: " + (chk.valid ? "valid" : "none could be checked") + (chk.unchecked.length ? "; input " + chk.unchecked.join(", ") + " not checked" : "") + ".";
  say += " Give it back to your wallet (the QR on the device, the text below, or the file), which adds the other signatures it needs and sends it.";
  ssOwnShow({ kind: "psbt", bytes, fp, pub, text: base64Encode(bytes), say, cls });
}
async function ssOwnTakeMsg(v) {
  const sig = v.signed_message, msg = v._ss_message, path = v._ss_derivation_path, seed = v._ss_seed, addr = ssOwn.msgAddr, gen = ssOwn.gen;
  const pub = ssOwnSeedPublic(seed);
  let ok = null; try { ok = addr ? (await verifyMessage(addr, msg, sig)).state === "valid" : null; } catch (e) { ok = null; }
  if (gen !== ssOwn.gen || !ssPageOn) return;
  const block = "-----BEGIN BITCOIN SIGNED MESSAGE-----\n" + msg + "\n-----BEGIN SIGNATURE-----\n" + (addr || "") + "\n" + sig + "\n-----END BITCOIN SIGNED MESSAGE-----";
  const say = (pub ? "PRACTICE: signed with a public seed. Anyone can sign with it: never use it to prove anything. " : "Signed: ") +
    "the message, signed with the key of " + (addr || path) + " (" + path + "), in the Bitcoin Signed Message format SeedSigner uses. " +
    (ok === true ? "The signature checks out (checked by this page’s own code)." : ok === false ? "The signature does NOT check out against this address (checked by this page’s own code)." : "") +
    " The device shows the signature as a QR code.";
  ssOwnShow({ kind: "msg", sig, fp: "", pub, text: block, say, cls: pub || ok === false ? "bad" : "ok" });
}
function ssOwnShow(o) {
  if (ssOwn.out && ssOwn.out.bytes) ssOwn.out.bytes.fill(0);
  ssOwn.out = o;
  const box = ssOwnEl("ssOwnOut"); if (!box) return;
  box.hidden = false;
  const s = ssOwnEl("ssOwnOutSay"); s.textContent = o.say; s.className = "status ss-banner " + o.cls;
  ssOwnEl("ssOwnOutText").value = o.text;
  ssOwnEl("ssOwnSave").hidden = o.kind !== "psbt";
  ssOwnEl("ssOwnCopySig").hidden = o.kind !== "msg";
  try { box.scrollIntoView({ block: "nearest" }); } catch (e) { /* not laid out */ }
}
function ssOwnCopy(btn, sigOnly) {
  const o = ssOwn.out; if (!o) return;
  const t = sigOnly ? o.sig : o.text;
  (typeof safeCopy === "function" ? safeCopy(t) : Promise.reject(new Error("no clipboard"))).then(() => { if (typeof showCopied === "function") showCopied(btn); }).catch(() => alert("Copy failed. Select the text and copy it manually."));
}
function ssOwnSave() {
  const o = ssOwn.out; if (!o || o.kind !== "psbt") return;
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
  ssOwn.psbt = null; ssOwn.out = null; ssOwn.txKey = ""; ssOwn.kind = ""; ssOwn.msgAddr = ""; ssOwn.seenSig = null; ssOwn.seenMsg = null; ssOwn.seenAddr = null; ssOwn.seenDesc = null;
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
