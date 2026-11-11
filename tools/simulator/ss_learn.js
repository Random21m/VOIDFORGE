// ss_learn.js: "Learn on the practice signer" (v2.14.0). Lessons and a practice transaction NEXT TO the device, in #ssBox.
// Nothing here draws on the device's screen or adds to its menus: the device stays SeedSigner 0.8.7. The lessons only watch
// which View and Screen the device shows (SSController's current destination) and move on when it reaches the expected one.
// The practice wallet: a stand-in for a phone held up to the device's camera. While it shows something, a scan on the device
// sees that QR code instead of the computer's camera (the camera is never opened then), and the scanner gets the text of the
// QR in view through the same hook the scan path reads QR codes with (SSDecodeQR.extract_qr_data). Every lesson uses public
// test seeds only. The practice transaction spends made-up coins: a made-up previous transaction, marked as practice, that
// can never be on the blockchain. Everything is dropped by ssPageStop (box closed, CLEAR ALL, auto-clear, END SESSION).
// LOAD INTO THE PRACTICE SIGNER (MAKE A SEED > Damascus, practice only): vfSignerLoadSeed at the end of this file.
// FORGE SEED (a page button below the device): the seed loaded on the device goes into VOIDFORGE's result, marked PRACTICE.
"use strict";
const SS_LEARN_ABANDON = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SS_LEARN_TEST = {   // public BIP-39 test vectors (Trezor's vectors.json): the cosigners and the payee of the practice transactions
  B: "legal winner thank year wave sausage worth useful legal winner thank yellow",
  C: "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
  PAY: "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
};
const SS_LEARN_FP = "73c5da0a";   // fingerprint of abandon ... about
const SS_LEARN_MARK = "VOIDFORGE practice coins: made up, not real, never on the blockchain";
const SS_LEARN_FRAME_MS = 300;    // one QR part every 0.3 s, as a wallet app's animated QR

const ssLearn = { arming: false, lesson: null, step: 0, hold: null, done: false, timer: null, tx: null, building: false, reading: false, scanDec: null, msg: "", gen: 0 };
const ssLearnCam = { byLesson: false, frames: null, what: "", say: "", key: "", on: false, shown: null, read: false, t0: 0, cache: new Map() };

// ---------------------------------------------------------------- the device, as the lessons see it
function ssLearnState() {
  try {
    const c = SSController._instance; if (!c) return null;
    const x = c.current_destination, v = x && x.view, s = v && v.screen;
    const labels = s && Array.isArray(s.button_data) ? s.button_data.map((b) => typeof b === "string" ? b : (b && (b.button_label || b.label)) || "") : [];
    return { view: x && x.View_cls ? x.View_cls.name : "", screen: s ? s.constructor.name : "", title: (s && s.title) || "", labels, scr: s || null, ctl: c };
  } catch (e) { return null; }
}
const ssLearnKey = (s) => s ? s.view + "|" + s.screen + "|" + s.title : "";
function ssLearnSeeds() { try { const st = SSController._instance && SSController._instance._storage; return (st && st.seeds) || []; } catch (e) { return []; } }
function ssLearnHasTestSeed() { return ssLearnSeeds().some((s) => s && s.mnemonic_str === SS_LEARN_ABANDON && !s.passphrase); }
// The device's settings, read without making them: with the device off there are none (v2.15.0: reading them here used to load
// them again from the microSD while the device stopped, so a wipe did not bring the defaults back).
const ssLearnSettings = () => { try { return ssPageOn ? SSSettings.get_instance() : null; } catch (e) { return null; } };
function ssLearnNet() {   // the device's network setting: Mainnet, Testnet or Regtest
  try { const s = ssLearnSettings(); if (!s) return "M"; const v = s.get_value(SSSettingsConstants.SETTING__NETWORK); return v === SSSettingsConstants.TESTNET ? "T" : v === SSSettingsConstants.REGTEST ? "R" : "M"; } catch (e) { return "M"; }
}
const ssLearnCoin = (n) => n === "M" ? 0 : 1;
const ssLearnHrp = (n) => n === "M" ? "bc" : n === "T" ? "tb" : "bcrt";
const ssLearnKeyNet = (n) => n === "M" ? "main" : "test";
function ssLearnSetting(attr) { try { const s = ssLearnSettings(); return s ? s.get_value(attr) : null; } catch (e) { return null; } }

// ---------------------------------------------------------------- the practice wallet (a stand-in camera)
// Shows QR codes on a 640 x 480 "camera picture": a phone screen held in front of the device.
function ssLearnPaint(g, text) {
  g.fillStyle = "#2b2e33"; g.fillRect(0, 0, 640, 480);
  if (text === null) return;
  g.fillStyle = "#fff"; g.fillRect(110, 30, 420, 420);
  let m = ssLearnCam.cache.get(text);
  if (!m) { m = qrMatrix(text).rows; ssLearnCam.cache.set(text, m); }
  const n = m.length, px = Math.floor(380 / n), x0 = 320 - Math.floor(n * px / 2), y0 = 240 - Math.floor(n * px / 2);
  g.fillStyle = "#000";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) g.fillRect(x0 + x * px, y0 + y * px, px, px);
}
function ssLearnCamHandle() {
  const c = document.createElement("canvas"); c.width = 640; c.height = 480;
  const g = c.getContext("2d", { willReadFrequently: true }); let last = null;
  const frame = () => {
    const F = ssLearnCam.frames, t = F && F.length ? F[Math.floor((Date.now() - ssLearnCam.t0) / SS_LEARN_FRAME_MS) % F.length] : null;
    if (t !== last) { last = t; ssLearnPaint(g, t); }
    ssLearnCam.shown = t;
  };
  Object.defineProperty(c, "videoWidth", { get() { frame(); return 640; } });
  Object.defineProperty(c, "videoHeight", { get() { return 480; } });
  c.pause = () => { };
  ssLearnCam.on = true; ssLearnCam.t0 = Date.now(); frame();
  return { stream: { getTracks: () => [] }, video: c, ssLearn: true };
}
(function ssLearnPatch() {
  if (typeof SSCamera !== "function" || typeof SSDecodeQR !== "function") return;
  const open0 = SSCamera.prototype._open, close0 = SSCamera.prototype._close, start0 = SSCamera.prototype.start_video_stream_mode;
  let scanning = false;
  // only a scan (480 x 480 stream) looks at the practice wallet; the camera tools still use the computer's camera
  SSCamera.prototype.start_video_stream_mode = async function (o = {}) {
    const r = o.resolution || [512, 384]; scanning = r[0] === 480 && r[1] === 480;
    try { return await start0.call(this, o); } finally { scanning = false; }
  };
  SSCamera.prototype._open = async function () { if (scanning && ssLearnCam.frames) return ssLearnCamHandle(); return open0.call(this); };
  SSCamera.prototype._close = function (h) {
    if (h && h.ssLearn) {
      ssLearnCam.on = false; ssLearnCam.shown = null; try { h.video.width = h.video.height = 0; } catch (e) { /* gone */ }
      // a practice seed's SeedQR, once the scan has read it: put away (and wiped) as soon as the scan ends
      if (ssLearnCam.key === "dmseed" && ssLearnCam.read) setTimeout(() => { if (ssLearnCam.key === "dmseed" && ssLearnCam.read) ssLearnHide(); }, 0);
      return;
    }
    return close0.call(this, h);
  };
  const x0 = SSDecodeQR.extract_qr_data;
  SSDecodeQR.extract_qr_data = function (image, is_binary = false) {
    if (ssLearnCam.on) { const t = ssLearnCam.shown; if (t === null || t === undefined) return null; ssLearnCam.read = true; return is_binary ? new TextEncoder().encode(t) : t; }
    return x0.call(this, image, is_binary);
  };
})();
function ssLearnShow(frames, what, key) {
  if (ssLearnCam.key === "dmseed") ssLearnForget();   // a practice seed's SeedQR is wiped as soon as it is put away
  ssLearnCam.say = ""; ssLearnCam.read = false;
  // a scan seen earlier says nothing about these QR codes: without this, a decoder kept from an earlier scan (the timer stops when
  // the QR is put away, before ssLearnTick sees the scan end) put the next QR away on the first tick (a second Damascus seed)
  ssLearn.scanDec = null;
  ssLearnCam.byLesson = false; ssLearnCam.frames = frames && frames.length ? frames.slice() : null; ssLearnCam.what = ssLearnCam.frames ? what : ""; ssLearnCam.key = ssLearnCam.frames ? key || "" : "";
  ssLearnCam.t0 = Date.now(); ssLearnTimer(); ssLearnRender();
}
function ssLearnHide() { ssLearnShow(null); }
// Overwrites the QR texts held up and the QR pictures made of them (strings cannot be overwritten: they are dropped).
function ssLearnForget() {
  if (ssLearnCam.frames) ssLearnCam.frames.fill("");
  for (const m of ssLearnCam.cache.values()) for (const r of m) if (r && typeof r.fill === "function") r.fill(false);
  ssLearnCam.cache.clear(); ssLearnCam.shown = null; ssLearnCam.say = "";
}

// ---------------------------------------------------------------- what the practice wallet can show
async function ssLearnAcct(seed, type, n) {   // account key of a seed: [fp/purpose'/coin'/0'(/2')] xpub (public key only)
  const w = await watchOnlyFromSeed(seed, type, 0, ssLearnKeyNet(n)), k = await parseExtendedKey(w.xpub);
  return { fp: w.fp, xpub: w.xpub, key: k, raw: await base58decode(w.xpub) };
}
async function ssLearnChild(a, branch, index) { const [p, c] = await ckdPub(a.key.pub, a.key.chain, branch); return (await ckdPub(p, c, index))[0]; }
const ssLearnP2wpkh = async (pub) => Uint8Array.of(0x00, 20, ...(await hash160(pub)));
async function ssLearnAddress(n, branch, index) {   // native SegWit address of the test seed (abandon ... about)
  const a = await ssLearnAcct(await mnemonicToSeed(SS_LEARN_ABANDON, ""), "wpkh", n);
  return bech32Encode(ssLearnHrp(n), 0, await hash160(await ssLearnChild(a, branch, index)));
}
async function ssLearnFeed(kind) {   // [frames, what the panel says the practice wallet shows]
  const n = ssLearnNet();
  if (kind === "seedqr") return [[SS_LEARN_ABANDON.split(" ").map((w) => String(WORDLIST.indexOf(w)).padStart(4, "0")).join("")], "the SeedQR of the public test seed abandon ... about"];
  if (kind === "address") { const a = await ssLearnAddress(n, 0, 3); return [["bitcoin:" + a], "receive address #3 of the public test seed: " + a]; }
  if (kind === "signmsg") return [["signmessage m/84h/" + ssLearnCoin(n) + "h/0h/0/0 ascii:Practice message from VOIDFORGE"], "a request to sign the message \"Practice message from VOIDFORGE\""];
  if (kind === "descriptor") { const t = ssLearn.tx && ssLearn.tx.descriptor; return t ? [[t], "the 2-of-3 wallet descriptor"] : [null, ""]; }
  if (kind === "tx") { const t = ssLearn.tx; return t && !t.result ? [t.frames, "the practice transaction (" + t.frames.length + " QR parts)"] : [null, ""]; }
  return [null, ""];
}
async function ssLearnArm(kind, byLesson) {
  if (ssLearn.arming) return;
  ssLearn.arming = true;
  try { const [f, what] = await ssLearnFeed(kind); if (f && ssPageOn) { ssLearnShow(f.map((x) => /^ur:/i.test(x) ? x.toUpperCase() : x), what, kind); ssLearnCam.byLesson = !!byLesson; } }
  catch (e) { console.error("Practice wallet:", e); }
  finally { ssLearn.arming = false; }
}

// ---------------------------------------------------------------- the practice transaction (a PSBT, BIP-174 version 0)
const ssLearnKV = (key, val) => concatBytes(varintBytes(key.length), key, varintBytes(val.length), val);
const ssLearnPath = (fp, path) => concatBytes(fromHex(fp), ...path.map((i) => le32(i >>> 0)));
const SS_LEARN_H = 0x80000000;
function ssLearnTxBytes(t) {
  const p = [le32(t.version), varintBytes(t.ins.length)];
  for (const x of t.ins) p.push(x.prev, le32(x.vout >>> 0), varintBytes(x.script.length), x.script, le32(x.seq >>> 0));
  p.push(varintBytes(t.outs.length));
  for (const o of t.outs) p.push(svLe64(o.amount), varintBytes(o.script.length), o.script);
  p.push(le32(t.locktime));
  return concatBytes(...p);
}
function ssLearnPsbt(tx) {
  const p = [Uint8Array.of(0x70, 0x73, 0x62, 0x74, 0xff)];
  for (const m of [tx.global, ...tx.inMaps, ...tx.outMaps]) { for (const [k, v] of m) p.push(ssLearnKV(k, v)); p.push(Uint8Array.of(0)); }
  return concatBytes(...p);
}
// The seed the practice transaction spends from: in a lesson, the test seed the lesson names (review L7: the last seed loaded
// may be another one, and the lesson says to sign with the test seed); otherwise the last one loaded on the device, or the test seed.
async function ssLearnSpender() {
  const seeds = ssLearnSeeds().filter((s) => s && s.seed_bytes instanceof Uint8Array);
  if (ssLearn.lesson && ssLearn.lesson.txKind) {
    const t = seeds.find((s) => s.mnemonic_str === SS_LEARN_ABANDON && !s.passphrase);
    return t ? { seed: t.seed_bytes, own: true } : { seed: await mnemonicToSeed(SS_LEARN_ABANDON, ""), own: false };
  }
  if (seeds.length) { const s = seeds[seeds.length - 1]; return { seed: s.seed_bytes, own: true }; }
  return { seed: await mnemonicToSeed(SS_LEARN_ABANDON, ""), own: false };
}
async function ssLearnBuild(kind) {
  const n = ssLearnNet(), coin = ssLearnCoin(n), sp = await ssLearnSpender(), multi = kind === "multi";
  const pay = await ssLearnAcct(await mnemonicToSeed(SS_LEARN_TEST.PAY, ""), "wpkh", n);
  const payScript = await ssLearnP2wpkh(await ssLearnChild(pay, 0, 0));
  const coins = [], inMaps = [], change = { map: [] };
  let A, cos = null, descriptor = null;
  if (!multi) {
    A = await ssLearnAcct(sp.seed, "wpkh", n);
    const acct = [84 + SS_LEARN_H, coin + SS_LEARN_H, SS_LEARN_H];
    for (const [i, amount] of [[0, 150000n], [1, 70000n]]) {
      const pub = await ssLearnChild(A, 0, i);
      coins.push({ amount, script: await ssLearnP2wpkh(pub), derivs: [[pub, ssLearnPath(A.fp, [...acct, 0, i])]], ws: null });
    }
    const cpub = await ssLearnChild(A, 1, 0);
    change.script = await ssLearnP2wpkh(cpub); change.map.push([Uint8Array.of(0x02, ...cpub), ssLearnPath(A.fp, [...acct, 1, 0])]);
  } else {
    A = await ssLearnAcct(sp.seed, "ms-wsh", n);
    const B = await ssLearnAcct(await mnemonicToSeed(SS_LEARN_TEST.B, ""), "ms-wsh", n), C = await ssLearnAcct(await mnemonicToSeed(SS_LEARN_TEST.C, ""), "ms-wsh", n);
    cos = [A, B, C]; const acct = [48 + SS_LEARN_H, coin + SS_LEARN_H, SS_LEARN_H, 2 + SS_LEARN_H];
    const msAt = async (branch, index) => {
      const ws = (await multisigScript(2, cos.map((c) => ({ key: c.key })), branch, index)).script, derivs = [];
      for (const c of cos) derivs.push([await ssLearnChild(c, branch, index), ssLearnPath(c.fp, [...acct, branch, index])]);
      return { ws, script: Uint8Array.of(0x00, 32, ...(await sha256bytes(ws))), derivs };
    };
    const i0 = await msAt(0, 0); coins.push({ amount: 500000n, script: i0.script, derivs: i0.derivs, ws: i0.ws });
    const c0 = await msAt(1, 0); change.script = c0.script; change.map.push([Uint8Array.of(0x01), c0.ws]);
    for (const [pub, d] of c0.derivs) change.map.push([Uint8Array.of(0x02, ...pub), d]);
    descriptor = await multisigDescriptor("ms-wsh", 2, cos.map((c) => ({ fp: c.fp, path: "48h/" + coin + "h/0h/2h", key: c.key })), 0);
  }
  // the made-up previous transaction: its one input says what it is, and it pays the practice coins
  const markScript = concatBytes(Uint8Array.of(SS_LEARN_MARK.length), new TextEncoder().encode(SS_LEARN_MARK));
  const prev = ssLearnTxBytes({ version: 2, locktime: 0, ins: [{ prev: new Uint8Array(32), vout: 0xffffffff, script: markScript, seq: 0xffffffff }], outs: coins.map((c) => ({ amount: c.amount, script: c.script })) });
  const prevHash = await dsha256(prev);
  const inSum = coins.reduce((a, c) => a + c.amount, 0n), payAmt = multi ? 200000n : 120000n, fee = multi ? 1500n : 1000n, chg = inSum - payAmt - fee;
  const utx = ssLearnTxBytes({ version: 2, locktime: 0, ins: coins.map((c, i) => ({ prev: prevHash, vout: i, script: new Uint8Array(0), seq: 0xfffffffd })),
    outs: [{ amount: payAmt, script: payScript }, { amount: chg, script: change.script }] });
  const global = [[Uint8Array.of(0x00), utx]];
  if (multi) for (const c of cos) global.push([Uint8Array.of(0x01, ...c.raw), ssLearnPath(c.fp, [48 + SS_LEARN_H, coin + SS_LEARN_H, SS_LEARN_H, 2 + SS_LEARN_H])]);
  for (const c of coins) {
    const m = [[Uint8Array.of(0x00), prev], [Uint8Array.of(0x01), concatBytes(svLe64(c.amount), varintBytes(c.script.length), c.script)]];
    if (c.ws) m.push([Uint8Array.of(0x05), c.ws]);
    for (const [pub, d] of c.derivs) m.push([Uint8Array.of(0x06, ...pub), d]);
    inMaps.push(m);
  }
  const tx = { kind, net: n, own: sp.own, fp: A.fp, global, inMaps, outMaps: [[], change.map], utx, descriptor,
    prevTxid: hex(prevHash.slice().reverse()), inSum, payAmt, fee, chg, payAddr: bech32Encode(ssLearnHrp(n), 0, payScript.slice(2)), nIn: coins.length, result: null };
  tx.psbt = ssLearnPsbt(tx);
  tx.frames = urEncode("crypto-psbt", CB.bytes(Array.from(tx.psbt)), 100);
  return tx;
}

// ---------------------------------------------------------------- reading the signed PSBT back from the device's screen
async function ssLearnReadScreen() {
  const T = ssLearn.tx; if (!T || ssLearn.reading) return;
  ssLearn.reading = true; T.status = "Reading the signed PSBT from the device's screen..."; ssLearnRender();
  const dec = new SSURDecoder(), seen = new Set(), until = Date.now() + 60000;
  const c = document.getElementById("ssScreen"), w = Math.min(c.width, 640), h = Math.round(w * c.height / c.width);
  const k = document.createElement("canvas"); k.width = w; k.height = h; const g = k.getContext("2d", { willReadFrequently: true }); g.imageSmoothingEnabled = false;
  try {
    while (Date.now() < until && ssLearn.tx === T && !dec.result) {
      const s = ssLearnState(); if (!s || s.view !== "SSPSBTSignedQRDisplayView") break;
      g.drawImage(c, 0, 0, w, h);
      const r = qrDecodeRgba(g.getImageData(0, 0, w, h).data, w, h);
      if (r && r.text && /^ur:/i.test(r.text) && !seen.has(r.text.toLowerCase())) { seen.add(r.text.toLowerCase()); dec.receive_part(r.text); }
      await new Promise((ok) => setTimeout(ok, 90));
    }
    if (ssLearn.tx !== T) return;
    if (!dec.result || dec.result instanceof Error || dec.result.type !== "crypto-psbt") { T.status = seen.size ? "Could not read the whole signed PSBT from the screen. Keep the signed QR on the device's screen to try again." : ""; return; }
    const res = await ssLearnCheck(T, cborRead(dec.result.cbor, 0).v);
    if (!res) { T.status = "The signed PSBT on the device's screen is another transaction, not the practice transaction."; return; }
    T.result = res; T.status = "";
    if (ssLearnCam.key === "tx") ssLearnHide();
  } catch (e) { T.status = "Could not read the signed PSBT: " + (e && e.message ? e.message : e); }
  finally { ssLearn.reading = false; g.clearRect(0, 0, w, h); k.width = k.height = 0; ssLearnRender(); ssLearnTimer(); }
}
// Every signature, checked with the page's own code (inspectPsbt and psbtSigCheck, the same as INSPECT A PSBT), after the
// signatures are put into the practice PSBT (SeedSigner sends back a trimmed PSBT: the transaction and the signatures only).
async function ssLearnCheck(T, signed) {
  const r = psbtReader(signed); r.bytes(5);
  const g = psbtReadMap(r), u = g.find((x) => x.type === 0 && !x.key.length);
  if (!u || hex(u.val) !== hex(T.utx)) return null;
  const ins = T.inMaps.map(() => psbtReadMap(r)), merged = { global: T.global, outMaps: T.outMaps, inMaps: [] };
  let sigs = 0;
  T.inMaps.forEach((m, i) => {
    const add = ins[i].filter((x) => x.type === 2 && x.key.length === 33);
    sigs += add.length;
    merged.inMaps.push([...m, ...add.map((x) => [Uint8Array.of(0x02, ...x.key), x.val])]);
  });
  const res = await inspectPsbt(ssLearnPsbt(merged), ssLearnKeyNet(T.net));
  await psbtSigCheck(res);
  const good = res.ins.filter((x) => x.sv && x.sv.state === "valid" && x.sv.n >= 1).length;
  const ok = good === T.nIn && sigs === T.nIn;
  const tail = T.kind === "multi" ? " This 2-of-3 wallet needs one more signature from a second cosigner." : "";
  return { ok, sigs, text: ok ? "Signed correctly: " + (sigs === 1 ? "the signature checks out" : "all " + sigs + " signatures check out") + " (checked by this page's own code, not the device's)." + tail
    : "NOT signed correctly: " + good + " of " + T.nIn + " input(s) have a valid signature." };
}

// ---------------------------------------------------------------- lessons
// Every label below is SeedSigner 0.8.7's own (views/*.py, gui/screens/*.py), as the practice signer shows it.
// at(s): the device has reached what this step asks for. feed: what the practice wallet shows during this step.
// skip(): this step is not needed (the test seed is loaded already).
const ssLearnIs = (v) => (s) => s.view === v;
const ssLearnTitle = (v, re) => (s) => s.view === v && re.test(s.title);
const ssLearnTxIs = (kind) => () => !!(ssLearn.tx && ssLearn.tx.kind === kind && !ssLearn.tx.result);
const ssLearnTxOk = () => !!(ssLearn.tx && ssLearn.tx.result && ssLearn.tx.result.ok);
const SS_LEARN_HOME = { do: "Go to the Home screen. If you are somewhere else, press the joystick left to select the back arrow at the top left, then press it in. Repeat until you see Home.", see: "Home, with Scan, Seeds, Tools and Settings.", at: ssLearnIs("SSMainMenuView") };
const SS_LEARN_LOAD = [   // load the test seed abandon ... about by its SeedQR (passed over when it is loaded already)
  Object.assign({}, SS_LEARN_HOME, { skip: ssLearnHasTestSeed, do: "First, load the public test seed. " + SS_LEARN_HOME.do }),
  { skip: ssLearnHasTestSeed, feed: "seedqr", do: "Scan is selected: press the joystick in. The practice wallet holds the SeedQR of the public test seed abandon ... about up to the device's camera.",
    see: "The camera picture, then Finalize Seed with the fingerprint " + SS_LEARN_FP + ". (This page reads a SeedQR only while the computer is offline. If the device says Offline only, turn off the network and scan again.)", at: ssLearnIs("SSSeedFinalizeView") },
  { skip: ssLearnHasTestSeed, do: "Check that the fingerprint is " + SS_LEARN_FP + ". Done is selected: press the joystick in.", see: "A menu titled " + SS_LEARN_FP + ": Scan transaction, Export xpub, Address explorer, Backup seed, Discard seed.", at: ssLearnIs("SSSeedOptionsView") },
];
const SS_LEARN_PSBT = [   // review and sign the practice PSBT, after it was scanned
  { do: SS_LEARN_FP + " is selected: press the joystick in.", see: "Review Transaction: what this transaction sends, and the fee.", at: ssLearnIs("SSPSBTOverviewView") },
  { do: "Press the joystick in (Review details).", see: "Transaction Math: what comes in, minus what you send, minus the fee, is your change.", at: ssLearnIs("SSPSBTMathView") },
  { do: "Check the math. Press the joystick in (Review recipients).", see: "Will Send: the amount and the address it goes to.", at: ssLearnIs("SSPSBTAddressDetailsView") },
];
const SS_LEARN_SIGN = [
  { do: "Press the joystick in (Next).", see: "Sign Transaction, with Approve transaction.", at: ssLearnIs("SSPSBTFinalizeView") },
  { do: "Press the joystick in (Approve transaction). The device signs.", see: "An animated QR code: the signed PSBT.", at: ssLearnIs("SSPSBTSignedQRDisplayView") },
  { do: "Leave the QR code on the screen. The practice wallet reads it, as your wallet app would, and checks every signature.", see: "Under Practice transaction: Signed correctly.", at: ssLearnTxOk },
];
const SS_LEARN_SEEDNOTE = "This lesson uses the public test seed abandon ... about (fingerprint " + SS_LEARN_FP + "). Anyone can load it, so never put coins on it.";
const SS_LEARN_LESSONS = [
  { id: "dice", name: "Make a seed from dice (12 words)",
    note: "This lesson makes a public test seed: you enter fifty 1s instead of real dice rolls. Anyone can enter the same rolls, so never put coins on this seed.",
    end: "You made a 12-word seed, wrote it down and checked your copy. For real coins you would do this on a real SeedSigner, not here: roll a real die 50 times and keep the paper safe. This is a public test seed: never use it.",
    steps: [
      SS_LEARN_HOME,
      { do: "Press the joystick down once to select Tools, then press it in.", see: "Tools: New seed, New seed, Calc 12th/24th word, Address explorer, Verify address.", at: ssLearnIs("SSToolsMenuView") },
      { do: "Press down once, to the second New seed (the one with the die), and press in.", see: "Mnemonic Length: 12 words (50 rolls) and 24 words (99 rolls).", at: ssLearnIs("SSToolsDiceEntropyMnemonicLengthView") },
      { do: "12 words (50 rolls) is selected: press the joystick in.", see: "Dice Roll 1/50, with the six die faces.", at: ssLearnIs("SSToolsDiceEntropyEntryView") },
      { do: "The 1 is selected. Press the joystick in 50 times, one press at a time, and watch the title count up to Dice Roll 50/50. (With real dice, you would enter each roll you see.)", see: "Caution: Classified Info!", at: ssLearnIs("SSSeedWordsWarningView") },
      { do: "Read the warning. Press the joystick in (I understand).", see: "Seed Words: 1/3, with words 1 to 4.", at: ssLearnTitle("SSSeedWordsView", /1\/3/) },
      { do: "Write words 1 to 4 on paper, in order. Press the joystick in (Next).", see: "Seed Words: 2/3.", at: ssLearnTitle("SSSeedWordsView", /2\/3/) },
      { do: "Write words 5 to 8. Press the joystick in.", see: "Seed Words: 3/3.", at: ssLearnTitle("SSSeedWordsView", /3\/3/) },
      { do: "Write words 9 to 12. Press the joystick in.", see: "Verify Backup?, with Verify and Skip.", at: ssLearnIs("SSSeedWordsBackupTestPromptView") },
      { do: "Verify is selected: press the joystick in.", see: "Verify Word #..., with four words to choose from.", at: ssLearnIs("SSSeedWordsBackupTestView") },
      { do: "Look up that word on your paper, move to it and press in. The device asks for all 12 words, in a random order.", see: "Backup Verified: Success!", at: ssLearnIs("SSSeedWordsBackupTestSuccessView") },
      { do: "Press the joystick in (OK).", see: "Finalize Seed, with the seed's fingerprint, Done and BIP-39 Passphrase.", at: ssLearnIs("SSSeedFinalizeView") },
      { do: "Done is selected: press the joystick in. The seed is now in the device's memory.", see: "A menu titled with the fingerprint: Scan transaction, Export xpub, Address explorer, Backup seed, Discard seed.", at: ssLearnIs("SSSeedOptionsView") },
    ] },
  { id: "xpub", name: "Load a seed and export the xpub",
    note: SS_LEARN_SEEDNOTE + " You load it from a SeedQR, then show its xpub to a wallet app as a QR code.",
    end: "Your wallet app scans this QR code to make a watch-only wallet: it sees the addresses and the balance, but it cannot spend. Press the joystick in to go back to Home.",
    steps: [...SS_LEARN_LOAD,
      { do: "Open the seed: on Home, choose Seeds, then " + SS_LEARN_FP + ". (If you just loaded it, you are there already.)", see: "A menu titled " + SS_LEARN_FP + ": Scan transaction, Export xpub, Address explorer, Backup seed, Discard seed.", at: ssLearnIs("SSSeedOptionsView") },
      { do: "Press down once to Export xpub and press in.", see: "Export Xpub: Single Sig and Multisig.", at: ssLearnIs("SSSeedExportXpubSigTypeView") },
      { do: "Single Sig is selected: press the joystick in.", see: "Export Xpub: Native Segwit, Nested Segwit and Taproot.", at: ssLearnIs("SSSeedExportXpubScriptTypeView") },
      { do: "Native Segwit is selected: press the joystick in.", see: "Xpub QR Format: Animated (default) and Static.", at: ssLearnIs("SSSeedExportXpubQRFormatView") },
      { do: "Choose the format your wallet app reads. Most apps read Animated (default): press the joystick in.", see: "Caution: Privacy Leak! Xpub can be used to view all future transactions.", at: ssLearnIs("SSSeedExportXpubWarningView") },
      { do: "Press the joystick in (I understand).", see: "Xpub Details: the fingerprint, the derivation path and the xpub.", at: ssLearnIs("SSSeedExportXpubDetailsView") },
      { do: "Press the joystick in (Export xpub).", see: "A QR code that holds the xpub.", at: ssLearnIs("SSSeedExportXpubQRDisplayView") },
    ] },
  { id: "address", name: "Check a receive address before you use it",
    note: SS_LEARN_SEEDNOTE + " The practice wallet shows an address it says is yours: the device checks that the address really comes from your seed.",
    end: "The address is receive address #3 of your seed. Check every address this way before you use it: malware on a computer can swap the address on its screen.",
    steps: [...SS_LEARN_LOAD, SS_LEARN_HOME,
      { feed: "address", do: "Scan is selected: press the joystick in. The practice wallet holds a receive address up to the device's camera.", see: "Verify Address: Select seed to verify, with " + SS_LEARN_FP + " first.", at: ssLearnIs("SSSeedSelectSeedView") },
      { do: SS_LEARN_FP + " is selected: press the joystick in.", see: "Verify Address while it searches, then Success! Address Verified.", at: ssLearnIs("SSSeedAddressVerificationSuccessView") },
    ] },
  { id: "sign", name: "Sign your first transaction", txKind: "single",
    note: SS_LEARN_SEEDNOTE + " The transaction is the practice transaction below: its coins are made up, so it can never be broadcast.",
    end: "You reviewed and signed a transaction. With real coins, your wallet app would now broadcast it. This one spends made-up coins, so it never can.",
    steps: [...SS_LEARN_LOAD, SS_LEARN_HOME,
      { do: "Below, under Practice transaction, choose Single key: 2 inputs and press PRACTICE TRANSACTION.", see: "Under the button: what the transaction spends and pays.", at: ssLearnTxIs("single") },
      { feed: "tx", do: "On the device, Scan is selected: press the joystick in. The practice wallet holds the transaction (a PSBT, as an animated QR code) up to the camera.", see: "The camera picture with a progress bar, then Select Signer with " + SS_LEARN_FP + ".", at: ssLearnIs("SSPSBTSelectSeedView") },
      ...SS_LEARN_PSBT,
      { do: "Check the address and the amount. Press the joystick in (Next).", see: "Your Change: the change and its address, checked by the device as yours.", at: ssLearnIs("SSPSBTChangeDetailsView") },
      ...SS_LEARN_SIGN,
    ] },
  { id: "multisig", name: "Set up and check a 2-of-3 multisig", txKind: "multi",
    note: "This lesson uses three public test seeds: abandon ... about on the device (fingerprint " + SS_LEARN_FP + ") and two more for the other cosigners. Anyone can load them, so never put coins on them. The coins are made up.",
    end: "You loaded the wallet descriptor, the device checked the change against it, and you signed. With real coins, a second cosigner would sign too before a 2-of-3 transaction could be broadcast. This one spends made-up coins, so it never can.",
    steps: [...SS_LEARN_LOAD, SS_LEARN_HOME,
      { do: "Below, under Practice transaction, choose 2-of-3 multisig: 1 input and press PRACTICE TRANSACTION.", see: "Under the button: what the transaction spends and pays.", at: ssLearnTxIs("multi") },
      { feed: "tx", do: "On the device, Scan is selected: press the joystick in. The practice wallet holds the transaction (a PSBT) up to the camera.", see: "Select Signer, with " + SS_LEARN_FP + ".", at: ssLearnIs("SSPSBTSelectSeedView") },
      ...SS_LEARN_PSBT,
      { do: "Press the joystick in (Next).", see: "Your Change, with Verify multisig change and Skip verification: the device cannot yet tell that the change comes back to this wallet.", at: (s) => s.view === "SSPSBTChangeDetailsView" && s.labels[0] === "Verify multisig change" },
      { do: "Verify multisig change is selected: press the joystick in.", see: "Multisig Verification, with Scan descriptor and Cancel.", at: ssLearnIs("SSLoadMultisigWalletDescriptorView") },
      { feed: "descriptor", do: "Scan descriptor is selected: press the joystick in. The practice wallet holds up the wallet descriptor: the three cosigners' keys and the 2-of-3 rule.", see: "Descriptor Loaded: the policy 2 of 3 and the three fingerprints.", at: ssLearnIs("SSMultisigWalletDescriptorView") },
      { do: "Check the policy and the fingerprints. Press the joystick in (Return to transaction).", see: "Your Change again, now with Next: the device checked the change against the descriptor.", at: (s) => s.view === "SSPSBTChangeDetailsView" && s.labels[0] === "Next" },
      ...SS_LEARN_SIGN,
    ] },
  { id: "message", name: "Sign a message",
    note: SS_LEARN_SEEDNOTE + " Message signing is off on the device at first, as on SeedSigner: you turn it on in Settings.",
    end: "The QR code holds the signature. Anyone can check with it that the owner of that address signed this message.",
    steps: [...SS_LEARN_LOAD, SS_LEARN_HOME,
      { do: "Press the joystick down, then right, to select Settings, and press it in.", see: "Settings: Language, Persistent settings, Denomination display, Advanced...", at: ssLearnTitle("SSSettingsMenuView", /^Settings$/) },
      { do: "Move down to Advanced and press in.", see: "Advanced: Bitcoin network, QR code density, Sig types...", at: ssLearnTitle("SSSettingsMenuView", /^Advanced$/) },
      { do: "Move down to Message signing (near the end of the list) and press in.", see: "Enabled and Disabled.", at: (s) => s.view === "SSSettingsEntryUpdateSelectionView" && s.labels.join("|") === "Enabled|Disabled" },
      { do: "Move up to Enabled and press in.", see: "Advanced again. Message signing is on.", at: () => ssLearnSetting(SSSettingsConstants.SETTING__MESSAGE_SIGNING) === SSSettingsConstants.OPTION__ENABLED },
      SS_LEARN_HOME,
      { feed: "signmsg", do: "Scan is selected: press the joystick in. The practice wallet holds up a request to sign a message.", see: "Sign Message: Select seed to sign with, with " + SS_LEARN_FP + " first.", at: ssLearnTitle("SSSeedSelectSeedView", /Sign Message/) },
      { do: SS_LEARN_FP + " is selected: press the joystick in.", see: "Review Message: Practice message from VOIDFORGE.", at: ssLearnIs("SSSeedSignMessageConfirmMessageView") },
      { do: "Read the message. Press the joystick in (Next).", see: "Confirm Address: the address whose key signs, and Sign message.", at: ssLearnIs("SSSeedSignMessageConfirmAddressView") },
      { do: "Press the joystick in (Sign message).", see: "A QR code that holds the signature.", at: ssLearnIs("SSSeedSignMessageSignedMessageQRView") },
    ] },
];

// ---------------------------------------------------------------- the panel
const ssLearnEl = (id) => document.getElementById(id);
function ssLearnSetText(id, t) { const e = ssLearnEl(id); if (e && e.textContent !== t) e.textContent = t; }
function ssLearnRender() {
  const L = ssLearn, run = ssLearnEl("ssLearnRun"); if (!run) return;
  const les = L.lesson;
  run.hidden = !les;
  if (les) {
    const st = les.steps[Math.min(L.step, les.steps.length - 1)];
    ssLearnSetText("ssLearnName", les.name);
    ssLearnSetText("ssLearnNote", les.note);
    ssLearnSetText("ssLearnCount", L.done ? "Done" : "Step " + (L.step + 1) + " of " + les.steps.length);
    ssLearnSetText("ssLearnDo", L.done ? les.end : st.do);
    ssLearnSetText("ssLearnSee", L.done ? "" : "What you should see: " + st.see);
    ssLearnSetText("ssLearnState", L.done ? "Lesson done." : L.msg);
    ssLearnEl("ssLearnBack").disabled = !L.done && !L.lesson.steps.slice(0, L.step).some((s) => !(s.skip && s.skip()));
    ssLearnEl("ssLearnNext").disabled = L.done;
  }
  const cam = ssLearnEl("ssLearnCam");
  cam.hidden = !ssLearnCam.frames;
  ssLearnSetText("ssLearnCamWhat", ssLearnCam.what);
  ssLearnSetText("ssLearnCamSay", ssLearnCam.frames ? ssLearnCam.say : "");
  const T = L.tx, net = T ? T.net : ssLearnNet();
  ssLearnEl("ssTxNet").hidden = !(T && net === "M");
  let s = "";
  if (L.building) s = "Making the practice transaction...";
  else if (T) {
    const sats = (v) => v.toLocaleString("en-US") + " sats";
    s = (T.result ? T.result.text : T.status || ((T.own ? "Spends " : "No seed is loaded on the device, so this spends ") + T.nIn + " made-up coin" + (T.nIn > 1 ? "s" : "") + " of seed " + T.fp + (T.kind === "multi" ? " (2-of-3 multisig with two public test seeds)" : "") +
      ": " + sats(T.inSum) + " in, " + sats(T.payAmt) + " to a test address, " + sats(T.chg) + " change, " + sats(T.fee) + " fee. On the device, choose Scan" + (T.own ? "" : " after you load the public test seed abandon ... about") + "."));
  }
  ssLearnSetText("ssTxStatus", s);
  ssLearnSetText("ssTxCoins", T ? "The coins come from made-up transaction " + T.prevTxid.slice(0, 16) + "..., marked \"" + SS_LEARN_MARK + "\"." : "");
  const ok = ssLearnEl("ssTxStatus"); if (ok) ok.className = "status" + (T && T.result ? (T.result.ok ? " ok" : " bad") : "");
}
function ssLearnTimer() {
  const need = ssPageOn && ((ssLearn.lesson && !ssLearn.done) || (ssLearn.tx && !ssLearn.tx.result) || ssLearnCam.frames);
  if (need && !ssLearn.timer) ssLearn.timer = setInterval(ssLearnTick, 200);
  else if (!need && ssLearn.timer) { clearInterval(ssLearn.timer); ssLearn.timer = null; }
}
function ssLearnGoto(i, hold) {
  const L = ssLearn, les = L.lesson; if (!les) return;
  L.step = Math.max(0, Math.min(i, les.steps.length - 1)); L.done = false; L.msg = "";
  L.hold = hold ? ssLearnKey(ssLearnState()) : null;
  // steps that are not needed now (the test seed is already loaded) are passed over
  while (L.step < les.steps.length - 1 && les.steps[L.step].skip && les.steps[L.step].skip()) L.step++;
  const f = les.steps[L.step].feed;
  if (f && ssLearnCam.key !== f) { if (f !== "tx") ssLearnArm(f, true); } else if (!f && ssLearnCam.byLesson) ssLearnHide();
  ssLearnRender(); ssLearnTimer();
}
function ssLearnTick() {
  if (!ssPageOn) { ssLearnTimer(); return; }
  const L = ssLearn, s = ssLearnState(); if (!s) return;
  // a scan that read the practice wallet's QR completely: the practice wallet is put away
  if (s.screen === "SSScanScreen" && s.scr && s.scr.decoder) L.scanDec = s.scr.decoder;
  else if (L.scanDec) { const d = L.scanDec; L.scanDec = null; try { if (d.is_complete && ssLearnCam.frames) ssLearnHide(); } catch (e) { /* not a decoder */ } }
  // the device shows the signed practice PSBT: the practice wallet reads it back
  if (L.tx && !L.tx.result && s.view === "SSPSBTSignedQRDisplayView" && !L.reading) ssLearnReadScreen();
  const les = L.lesson;
  if (les && !L.done) {
    const k = ssLearnKey(s);
    if (L.hold !== null && L.hold === k) return;
    L.hold = null;
    for (let j = L.step; j < Math.min(les.steps.length, L.step + 3); j++) {
      if (les.steps[j].at(s)) {
        if (j === les.steps.length - 1) { L.step = j; L.done = true; if (ssLearnCam.byLesson) ssLearnHide(); ssLearnRender(); ssLearnTimer(); }
        else ssLearnGoto(j + 1);
        return;
      }
      if (les.steps[j].feed) break;   // never jump past a step that holds something up to the camera
    }
    const st = les.steps[L.step];   // still on this step: the practice wallet keeps holding up its QR code (after a scan, for the next try)
    if (st.feed && !ssLearnCam.frames && !(st.feed === "tx" && (!L.tx || L.tx.result))) ssLearnArm(st.feed, true);
  }
}
function ssLearnStart() {
  const sel = ssLearnEl("ssLearnPick"), les = SS_LEARN_LESSONS.find((x) => x.id === (sel && sel.value)) || SS_LEARN_LESSONS[0];
  ssLearn.lesson = les; ssLearnHide(); ssLearnGoto(0, false);
  if (les.txKind) { const k = ssLearnEl("ssTxKind"); if (k) k.value = les.txKind; }
}
async function ssLearnTxGo() {
  if (!ssPageOn || ssLearn.building) return;
  const kind = (ssLearnEl("ssTxKind") || {}).value === "multi" ? "multi" : "single";
  ssLearn.building = true; ssLearn.tx = null; ssLearnHide(); ssLearnRender();
  const gen = ssLearn.gen;   // review L18: closing the box (ssLearnWipe) while it is built drops it
  try { const tx = await ssLearnBuild(kind); if (ssPageOn && gen === ssLearn.gen) { ssLearn.tx = tx; await ssLearnArm("tx"); } }
  catch (e) { ssLearn.tx = null; console.error("Practice transaction:", e); }
  finally { ssLearn.building = false; ssLearnRender(); ssLearnTimer(); }
}
// Called by ssPageStop: drops the lesson, the practice wallet's QR codes and the practice transaction.
function ssLearnWipe() {
  const L = ssLearn;
  if (L.timer) { clearInterval(L.timer); L.timer = null; }
  if (L.tx) {   // the PSBT, the made-up previous transaction, the keys and paths in its records
    const T = L.tx;
    for (const x of [T.psbt, T.utx]) if (x instanceof Uint8Array) x.fill(0);
    for (const m of [T.global, ...T.inMaps, ...T.outMaps]) for (const kv of m) for (const x of kv) if (x instanceof Uint8Array) x.fill(0);
  }
  L.lesson = null; L.step = 0; L.done = false; L.hold = null; L.tx = null; L.building = false; L.scanDec = null; L.msg = ""; L.gen++;
  ssLearnForget(); ssForgeReset();
  ssLearnCam.frames = null; ssLearnCam.byLesson = false; ssLearnCam.what = ""; ssLearnCam.key = ""; ssLearnCam.shown = null; ssLearnCam.cache.clear();
  ssLearnRender();
}
function ssLearnInit() {
  const pick = ssLearnEl("ssLearnPick"); if (!pick) return;
  for (const l of SS_LEARN_LESSONS) { const o = document.createElement("option"); o.value = l.id; o.textContent = l.name; pick.appendChild(o); }
  ssLearnEl("ssLearnGo").addEventListener("click", () => { if (ssPageOn) ssLearnStart(); });
  // review L18: BACK goes to the last step before this one that is not passed over; with none, it stays (ssLearnGoto would skip forward again)
  ssLearnEl("ssLearnBack").addEventListener("click", () => { const L = ssLearn; if (!L.lesson) return; let i = L.done ? L.step : L.step - 1; while (i >= 0 && L.lesson.steps[i].skip && L.lesson.steps[i].skip()) i--; if (i >= 0) ssLearnGoto(i, true); });
  ssLearnEl("ssLearnNext").addEventListener("click", () => { const L = ssLearn; if (!L.lesson || L.done) return; if (L.step === L.lesson.steps.length - 1) { L.done = true; ssLearnRender(); ssLearnTimer(); } else ssLearnGoto(L.step + 1, true); });
  ssLearnEl("ssLearnRestart").addEventListener("click", () => { if (ssLearn.lesson) { ssLearnHide(); ssLearnGoto(0, false); } });
  ssLearnEl("ssLearnCamOff").addEventListener("click", ssLearnHide);
  ssLearnEl("ssTxGo").addEventListener("click", ssLearnTxGo);
  const fb = ssLearnEl("ssForgeBtn"); if (fb) fb.addEventListener("click", ssForgeGo);
  ssLearnRender();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ssLearnInit); else ssLearnInit();

// ---------------------------------------------------------------- LOAD INTO THE PRACTICE SIGNER (Damascus practice seeds)
// Called by dmToSigner (MAKE A SEED > Damascus). The device stays SeedSigner: nothing is put into its memory from here. As a
// person would, this opens the practice signer and holds the seed's Standard SeedQR up to its camera with the practice wallet;
// the page (never the device's screen) says to choose Scan. Only the phrase of the practice result on the Damascus tab is
// taken (a practice sheet or a worked example: public, never a seed to keep); anything else is refused. The SeedQR is wiped
// when the practice wallet puts it away (after the scan, PUT IT AWAY, another QR) and by every wipe (ssLearnWipe).
function ssLearnDamascusPractice(phrase) {
  try {
    const o = document.getElementById("dmOut");
    return typeof phrase === "string" && phrase !== "" && typeof dmPractice === "string" && dmPractice !== "" && !!o && o.dataset.practicePhrase === phrase;
  } catch (e) { return false; }
}
function vfSignerLoadSeed(phrase) {
  if (!ssLearnDamascusPractice(phrase)) return false;
  const words = phrase.split(" "), idx = words.map((w) => WORDLIST.indexOf(w));
  if ((words.length !== 12 && words.length !== 24) || idx.some((i) => i < 0)) return false;
  const name = dmPractice;
  ssPageOpen();
  if (!ssPageOn) ssPageStart();
  if (!ssPageOn) return false;
  ssLearn.lesson = null; ssLearn.done = false; ssLearn.hold = null; ssLearn.msg = "";   // a lesson would hold up its own QR codes
  const qr = idx.map((i) => String(i).padStart(4, "0")).join("");   // Standard SeedQR: 4 digits per word
  ssLearnShow([qr], "the Standard SeedQR of Damascus " + name + " (" + words.length + " words)", "dmseed");
  try { ssLearnCam.cache.set(qr, seedQrMatrix(words, "standard").rows); } catch (e) { /* drawn as a plain QR */ }
  const say = (fp) => "On the device, choose Scan on Home." + (fp ? " It should show the fingerprint " + fp + "." : "") +
    (navigator.onLine === true ? " This computer looks online: the device reads a SeedQR only while it is offline." : "");
  ssLearnCam.say = say(""); ssLearnRender();
  mnemonicFingerprint(phrase, "").then((fp) => { if (ssLearnCam.key === "dmseed" && ssLearnCam.frames && ssLearnCam.frames[0] === qr) { ssLearnCam.say = say(fp); ssLearnRender(); } }).catch(() => { /* the text without it */ });
  return true;
}

// ---------------------------------------------------------------- FORGE SEED: the seed on the device, into VOIDFORGE
// A page button below the device (never on its screen or in its menus). It takes a seed loaded on the device (Seeds), with the
// passphrase applied to it there, and hands it to the page's result path (forgeFromSigner in the main script: words, fingerprint,
// addresses, SeedQR, xpub, watch-only), marked PRACTICE, with the fingerprint the device shows for it. With more than one seed:
// the one the device shows now or showed last (its newest screen about one seed), else the person picks one by its fingerprint.
const ssForge = { key: "", busy: false };
function ssForgeReset() {
  ssForge.key = ""; ssForge.busy = false;
  const p = ssLearnEl("ssForgePick"); if (p) { p.textContent = ""; p.hidden = true; }
  ssLearnSetText("ssForgeStatus", "");
}
function ssForgeShownSeed(seeds) {
  try {
    const c = SSController._instance, list = [c.current_destination, ...Array.from(c.back_stack || []).reverse()];
    for (const d of list) {
      const a = d && d.view_args, n = a && a.seed_num, v = d && d.view;
      if (Number.isInteger(n) && seeds[n]) return seeds[n];
      if (v && v.seed && seeds.includes(v.seed)) return v.seed;
    }
  } catch (e) { /* no device */ }
  return null;
}
async function ssForgeGo() {
  const say = (t, cls) => { ssLearnSetText("ssForgeStatus", t); const e = ssLearnEl("ssForgeStatus"); if (e) e.className = "status" + (cls ? " " + cls : ""); };
  if (ssForge.busy) return;
  const seeds = ssPageOn ? ssLearnSeeds().filter((x) => x && x.mnemonic_str) : [], pick = ssLearnEl("ssForgePick");
  if (!seeds.length) { pick.hidden = true; ssForge.key = ""; say("Load or make a seed on the device first.", "bad"); return; }
  ssForge.busy = true;
  try {
    const fps = await Promise.all(seeds.map((x) => x.get_fingerprint())), key = fps.map((f, i) => f + (seeds[i].passphrase ? "+" : "")).join(",");
    let i = -1;
    if (seeds.length === 1) i = 0;
    else if (!pick.hidden && ssForge.key === key) i = +pick.value;
    else { const sh = ssForgeShownSeed(seeds); if (sh) i = seeds.indexOf(sh); }
    if (i < 0 || !seeds[i]) {
      pick.textContent = "";
      seeds.forEach((x, j) => { const o = document.createElement("option"); o.value = String(j); o.textContent = fps[j] + (x.passphrase ? " (with passphrase)" : ""); pick.appendChild(o); });
      pick.value = String(seeds.length - 1); pick.hidden = false; ssForge.key = key;
      say(seeds.length + " seeds are loaded on the device. Pick one by its fingerprint, then press FORGE SEED again.");
      return;
    }
    const seed = seeds[i];
    say("");
    const ok = await forgeFromSigner(seed.mnemonic_str, seed.passphrase || "", fps[i]);
    if (ok) say("Seed " + fps[i] + " is shown in MAKE A SEED, marked PRACTICE.", "ok");
  } catch (e) { say("Could not take the seed: " + (e && e.message ? e.message : e), "bad"); }
  finally { ssForge.busy = false; }
}
