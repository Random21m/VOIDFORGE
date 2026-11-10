// ss_psbt.js: SeedSigner 0.8.7 stage 2 for the practice signer.
//   models/psbt_parser.py (PSBTParser), views/psbt_views.py, gui/screens/psbt_screens.py, the UrPsbtQrEncoder of
//   models/encode_qr.py, and the embit pieces they need (PSBT parse/sign/serialize, Descriptor, urtypes Output/Account).
// Loaded after ss_tools_settings.js PART B, in the same script block (the build script joins them).
// Crypto comes from VOIDFORGE's own functions: secp256k1 (emul, eadd, liftX, SG, SN), BIP32 (masterFromSeed, ckdPriv,
// ckdPub), hashes (sha256bytes, dsha256, hash160, taggedHash), signature hashes (svSighashLegacy, svSighashV0,
// svSighashTr: BIP143 and BIP341), base58check, bech32Encode, UR (urEncode, urDecodeFrames) and the RFC 6979 signer of
// ss_seeds.js (ssSeedsEcdsaSignRecoverable).
"use strict";

/* ---------------------------------------------------------------------------------------------------------------------
   1. Byte and script helpers (embit.script)
   --------------------------------------------------------------------------------------------------------------------- */
const SS_PSBT_HARDENED = 0x80000000;

function ssPsbtEq(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
// Python `needle in haystack` for bytes
function ssPsbtContains(haystack, needle) {
  if (!needle || !haystack || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
function ssPsbtBig32(n) { return fromHex(n.toString(16).padStart(64, "0")); }

class SSPsbtWriter {
  constructor() { this.a = []; }
  raw(b) { for (const x of b) this.a.push(x); return this; }
  varint(n) { return this.raw(varintBytes(n)); }
  u32(n) { return this.raw(le32(n >>> 0)); }
  u64(v) { return this.raw(svLe64(v)); }
  str(b) { this.varint(b.length); return this.raw(b); }
  out() { return Uint8Array.from(this.a); }
}

// Script.script_type()
function ssPsbtScriptType(data) {
  if (!data) return null;
  if (data.length === 25 && data[0] === 0x76 && data[1] === 0xa9 && data[2] === 0x14 && data[23] === 0x88 && data[24] === 0xac) return "p2pkh";
  if (data.length === 23 && data[0] === 0xa9 && data[1] === 0x14 && data[22] === 0x87) return "p2sh";
  if (data.length === 22 && data[0] === 0x00 && data[1] === 0x14) return "p2wpkh";
  if (data.length === 34 && data[0] === 0x00 && data[1] === 0x20) return "p2wsh";
  if (data.length === 34 && data[0] === 0x51 && data[1] === 0x20) return "p2tr";
  return null;
}
async function ssPsbtP2pkh(pub) { return concatBytes(Uint8Array.of(0x76, 0xa9, 0x14), await hash160(pub), Uint8Array.of(0x88, 0xac)); }
async function ssPsbtP2wpkh(pub) { return concatBytes(Uint8Array.of(0x00, 0x14), await hash160(pub)); }
async function ssPsbtP2sh(sc) { return concatBytes(Uint8Array.of(0xa9, 0x14), await hash160(sc), Uint8Array.of(0x87)); }
async function ssPsbtP2wsh(sc) { return concatBytes(Uint8Array.of(0x00, 0x20), await sha256bytes(sc)); }
// PublicKey.taproot_tweak(h): the output key for an internal key (33-byte or x-only) and a merkle root (or nothing)
async function ssPsbtTaprootTweakPub(pub, h) {
  const x = pub.length === 33 ? pub.slice(1) : pub;
  const t = bigOf(await taggedHash("TapTweak", concatBytes(x, h || new Uint8Array(0))));
  if (t >= SN) throw new Error("Tweak is too large");
  const P = liftX(bigOf(x), false);
  if (!P) throw new Error("Invalid public key");
  const Q = eadd(P, emul(t, SG));
  return ssPsbtBig32(Q[0]);
}
async function ssPsbtP2tr(pub, merkle_root) { return concatBytes(Uint8Array.of(0x51, 0x20), await ssPsbtTaprootTweakPub(pub, merkle_root)); }
function ssPsbtP2pkhFromP2wpkh(sc) { return concatBytes(Uint8Array.of(0x76, 0xa9, 0x14), sc.slice(2), Uint8Array.of(0x88, 0xac)); }

// Script.address(network)
async function ssPsbtScriptAddress(data, embit_network) {
  const N = SS_SEEDS_NETS[embit_network || "main"];
  const t = ssPsbtScriptType(data);
  if (t === null) throw new Error("This type of script doesn't have address representation");
  if (t === "p2pkh") return base58check(concatBytes(Uint8Array.of(N.pkh), data.slice(3, 23)));
  if (t === "p2sh") return base58check(concatBytes(Uint8Array.of(N.sh), data.slice(2, 22)));
  let ver = data[0];
  if (ver > 0) ver = ver % 0x50;
  return bech32Encode(N.hrp, ver, data.slice(2));
}

// bip32.path_to_str (embit writes "h")
function ssPsbtPathToStr(der) {
  return ["m"].concat(der.map((i) => i >= SS_PSBT_HARDENED ? (i - SS_PSBT_HARDENED) + "h" : String(i))).join("/");
}


/* ---------------------------------------------------------------------------------------------------------------------
   2. embit HDKey (private) for signing: HDKey.from_seed(seed_bytes).derive(path)
   --------------------------------------------------------------------------------------------------------------------- */
class SSPsbtHDKey {
  constructor(k, chain_code) { this.k = k; this.chain_code = chain_code; this._pub = null; this._cache = null; this.my_fingerprint = null; }
  static async from_seed(seed_bytes) {
    const [k, c] = await masterFromSeed(seed_bytes);
    const root = new SSPsbtHDKey(k, c);
    root._cache = new Map();
    root.my_fingerprint = (await hash160(root.pub)).slice(0, 4);
    return root;
  }
  get pub() { if (!this._pub) this._pub = pubkeyBytes(this.k); return this._pub; }
  get_public_key() { return this.pub; }
  xonly() { return this.pub.slice(1); }
  // derive(path): a list of indexes (or a path string); derivations are cached by prefix
  async derive(path) {
    const der = Array.isArray(path) ? path : ssSeedsParsePath(path);
    let k = this.k, c = this.chain_code, prefix = "";
    for (const i of der) {
      prefix += "/" + i;
      const hit = this._cache ? this._cache.get(prefix) : null;
      if (hit) { [k, c] = hit; continue; }
      const hardened = i >= SS_PSBT_HARDENED;
      [k, c] = await ckdPriv(k, c, hardened ? i - SS_PSBT_HARDENED : i, hardened);
      if (this._cache) this._cache.set(prefix, [k, c]);
    }
    return new SSPsbtHDKey(k, c);
  }
  wipe() {
    this.k = 0n; if (this.chain_code) this.chain_code.fill(0); if (this._pub) this._pub.fill(0);
    if (this._cache) { for (const v of this._cache.values()) { v[0] = 0n; if (v[1]) v[1].fill(0); } this._cache.clear(); }
  }
}

// ec.PrivateKey.taproot_tweak(h): the tweaked private key whose public key has an even y
async function ssPsbtTaprootTweakPrv(k, h) {
  let secret = k;
  const P = emul(k, SG);
  if (P[1] & 1n) secret = SN - k;
  const t = bigOf(await taggedHash("TapTweak", concatBytes(ssPsbtBig32(P[0]), h || new Uint8Array(0))));
  if (t >= SN) throw new Error("Tweak is too large");
  let res = (secret + t) % SN;
  const Q = emul(res, SG);
  if (Q[1] & 1n) res = SN - res;
  return res;
}

// Strict DER of (r, s)
function ssPsbtDer(r, s) {
  const enc = (n) => {
    let b = Array.from(ssPsbtBig32(n));
    while (b.length > 1 && b[0] === 0) b.shift();
    if (b[0] & 0x80) b.unshift(0);
    return [0x02, b.length].concat(b);
  };
  const body = enc(r).concat(enc(s));
  return Uint8Array.from([0x30, body.length].concat(body));
}
// ec.PrivateKey.sign(msg_hash, grind=True): RFC 6979, low S, ground for a low R (DER of at most 70 bytes)
async function ssPsbtEcdsaSign(h32, k) {
  let sig = await ssSeedsEcdsaSignRecoverable(h32, k);
  let der = ssPsbtDer(sig.r, sig.s);
  let counter = 1;
  while (der.length > 70) {
    const extra = new Uint8Array(32);
    extra[0] = counter & 255; extra[1] = (counter >>> 8) & 255;   // counter.to_bytes(32, "little")
    sig = await ssSeedsEcdsaSignRecoverable(h32, k, extra);
    der = ssPsbtDer(sig.r, sig.s);
    counter += 1;
    if (counter > 200) break;   // just in case we get in infinite loop for some reason
  }
  return der;
}
// ec.PrivateKey.schnorr_sign(msg_hash): BIP340 signing with no auxiliary randomness.
// SIM: embit calls libsecp256k1's schnorrsig_sign without aux data, and the libsecp256k1 build that embit ships (the one
// SeedSigner runs) then hashes the secret key itself into the nonce (t = d) instead of d xor TaggedHash("BIP0340/aux",
// 32 zero bytes). Done the same way here, so a practice signature is byte for byte the one embit makes (checked).
// Either rule gives a valid BIP340 signature.
async function ssPsbtSchnorrSign(m32, d0) {
  const P = emul(d0, SG);
  const d = (P[1] & 1n) ? SN - d0 : d0;
  const t = ssPsbtBig32(d);
  const px = ssPsbtBig32(P[0]);
  const k0 = nmod(bigOf(await taggedHash("BIP0340/nonce", concatBytes(t, px, m32))));
  if (k0 === 0n) throw new Error("Failed to sign");
  const R = emul(k0, SG);
  const k = (R[1] & 1n) ? SN - k0 : k0;
  const rx = ssPsbtBig32(R[0]);
  const e = nmod(bigOf(await taggedHash("BIP0340/challenge", concatBytes(rx, px, m32))));
  return concatBytes(rx, ssPsbtBig32((k + e * d) % SN));
}


/* ---------------------------------------------------------------------------------------------------------------------
   3. embit Transaction and PSBT (version 0 and 2), what SeedSigner uses of them
   --------------------------------------------------------------------------------------------------------------------- */
function ssPsbtParseTx(bytes) {
  const r = psbtReader(bytes), tx = {version: r.u32(), vin: [], vout: [], locktime: 0};
  let n = r.varint(), seg = false;
  if (n === 0) {
    if (r.byte() !== 1) throw new Error("Invalid segwit flag");
    seg = true; n = r.varint();
  }
  for (let i = 0; i < n; i++) {
    const txid = r.bytes(32), vout = r.u32(), script_sig = r.bytes(r.varint());
    tx.vin.push({txid, vout, script_sig, sequence: r.u32()});
  }
  n = r.varint();
  for (let i = 0; i < n; i++) { const value = r.i64(); tx.vout.push({value, script_pubkey: r.bytes(r.varint())}); }
  if (seg) for (let i = 0; i < tx.vin.length; i++) { const k = r.varint(); for (let j = 0; j < k; j++) r.bytes(r.varint()); }
  tx.locktime = r.u32();
  if (!r.done) throw new Error("Transaction has extra data");
  return tx;
}
function ssPsbtSerializeTx(tx) {
  const w = new SSPsbtWriter();
  w.u32(tx.version).varint(tx.vin.length);
  for (const x of tx.vin) { w.raw(x.txid).u32(x.vout).str(x.script_sig || new Uint8Array(0)).u32(x.sequence); }
  w.varint(tx.vout.length);
  for (const o of tx.vout) { w.u64(o.value).str(o.script_pubkey); }
  w.u32(tx.locktime);
  return w.out();
}
// DerivationPath: 4-byte fingerprint + uint32 indexes
function ssPsbtParseDer(v) {
  if (v.length < 4 || v.length % 4) throw new Error("Invalid derivation path");
  const r = psbtReader(v), fingerprint = r.bytes(4), derivation = [];
  while (!r.done) derivation.push(r.u32());
  return {fingerprint, derivation};
}
function ssPsbtSerDer(d) { const w = new SSPsbtWriter(); w.raw(d.fingerprint); for (const i of d.derivation) w.u32(i); return w.out(); }
function ssPsbtWitnessParse(v) { const r = psbtReader(v), n = r.varint(), items = []; for (let i = 0; i < n; i++) items.push(r.bytes(r.varint())); return items; }
function ssPsbtWitnessSer(items) { const w = new SSPsbtWriter(); w.varint(items.length); for (const x of items) w.str(x); return w.out(); }
const ssPsbtKeyHex = (b) => hex(b);

class SSPSBTInputScope {
  constructor(vin = null) {
    this.txid = vin ? vin.txid : null;
    this.vout = vin ? vin.vout : null;
    this.sequence = vin ? vin.sequence : null;
    this.non_witness_utxo = null;   // {raw, tx}
    this.witness_utxo = null;       // {value, script_pubkey}
    this.partial_sigs = [];         // [{pub, sig}] (OrderedDict order)
    this.sighash_type = null;
    this.redeem_script = null;
    this.witness_script = null;
    this.bip32_derivations = [];    // [{pub, der: {fingerprint, derivation}}]
    this.final_scriptsig = null;
    this.final_scriptwitness = null;   // [items]
    this.taproot_sigs = [];         // [{key, val}]
    this.taproot_scripts = [];      // [{control, script}]
    this.taproot_bip32_derivations = [];   // [{pub (x-only), leaf_hashes, der}]
    this.taproot_internal_key = null;
    this.taproot_merkle_root = null;
    this.unknown = [];              // [{key, val}]
  }
  get vin() { return {txid: this.txid, vout: this.vout, script_sig: new Uint8Array(0), sequence: this.sequence === null ? 0xffffffff : this.sequence}; }
  get utxo() {
    if (this.witness_utxo) return this.witness_utxo;
    if (this.non_witness_utxo) return this.non_witness_utxo.tx.vout[this.vout] || null;
    return null;
  }
  get script_pubkey() { const u = this.utxo; return u ? u.script_pubkey : null; }
  get is_taproot() { const u = this.utxo; return !!u && ssPsbtScriptType(u.script_pubkey) === "p2tr"; }

  read_value(t, key, v) {
    const k1 = key.length === 0;
    const dup = (what) => { throw new Error("Duplicated " + what); };
    if (t === 0x00) {
      if (!k1) throw new Error("Invalid non-witness utxo key");
      if (this.non_witness_utxo) dup("utxo");
      this.non_witness_utxo = {raw: v, tx: ssPsbtParseTx(v)};
    } else if (t === 0x01) {
      if (!k1) throw new Error("Invalid witness utxo key");
      if (this.witness_utxo) dup("utxo");
      const r = psbtReader(v), value = r.i64(), script_pubkey = r.bytes(r.varint());
      this.witness_utxo = {value, script_pubkey};
    } else if (t === 0x02) {
      pointFromPub(key);
      if (this.partial_sigs.some((x) => ssPsbtEq(x.pub, key))) dup("partial sig");
      this.partial_sigs.push({pub: key, sig: v});
    } else if (t === 0x03) {
      if (!k1) throw new Error("Invalid sighash type key");
      if (this.sighash_type !== null) dup("sighash type");
      if (v.length !== 4) throw new Error("Sighash type should be 4 bytes long");
      this.sighash_type = (v[0] | (v[1] << 8) | (v[2] << 16) | (v[3] << 24)) >>> 0;
    } else if (t === 0x04) {
      if (!k1) throw new Error("Invalid redeem script key");
      if (this.redeem_script) dup("redeem script");
      this.redeem_script = v;
    } else if (t === 0x05) {
      if (!k1) throw new Error("Invalid witness script key");
      if (this.witness_script) dup("witness script");
      this.witness_script = v;
    } else if (t === 0x06) {
      pointFromPub(key);
      if (this.bip32_derivations.some((x) => ssPsbtEq(x.pub, key))) dup("derivation path");
      this.bip32_derivations.push({pub: key, der: ssPsbtParseDer(v)});
    } else if (t === 0x07) {
      if (!k1) throw new Error("Invalid final scriptsig key");
      if (this.final_scriptsig) dup("final scriptsig");
      this.final_scriptsig = v;
    } else if (t === 0x08) {
      if (!k1) throw new Error("Invalid final scriptwitness key");
      if (this.final_scriptwitness) dup("final scriptwitness");
      this.final_scriptwitness = ssPsbtWitnessParse(v);
    } else if (t === 0x0e && k1) {
      this.txid = Uint8Array.from(v);   // (stored here in serialized byte order, as the unsigned transaction has it)
    } else if (t === 0x0f && k1) {
      this.vout = (v[0] | (v[1] << 8) | (v[2] << 16) | (v[3] << 24)) >>> 0;
    } else if (t === 0x10 && k1) {
      this.sequence = (v[0] | (v[1] << 8) | (v[2] << 16) | (v[3] << 24)) >>> 0;
    } else if (t === 0x14) {
      if (key.length !== 64) throw new Error("Invalid key length");
      this.taproot_sigs.push({key, val: v});
    } else if (t === 0x15) {
      this.taproot_scripts.push({control: key, script: v});
    } else if (t === 0x16) {
      if (key.length !== 32) throw new Error("Invalid key length");
      if (!this.taproot_bip32_derivations.some((x) => ssPsbtEq(x.pub, key))) {
        const r = psbtReader(v), num = r.varint(), leaf_hashes = [];
        for (let i = 0; i < num; i++) leaf_hashes.push(r.bytes(32));
        this.taproot_bip32_derivations.push({pub: key, leaf_hashes, der: ssPsbtParseDer(r.bytes(v.length - r.pos))});
      }
    } else if (t === 0x17) {
      this.taproot_internal_key = v;
    } else if (t === 0x18) {
      this.taproot_merkle_root = v;
    } else {
      this.unknown.push({key: concatBytes(Uint8Array.of(t), key), val: v});
    }
  }

  write_to(w, version = null) {
    const rec = (k, v) => { w.str(k); w.str(v); };
    if (this.non_witness_utxo) rec(Uint8Array.of(0x00), this.non_witness_utxo.raw);
    if (this.witness_utxo) rec(Uint8Array.of(0x01), new SSPsbtWriter().u64(this.witness_utxo.value).str(this.witness_utxo.script_pubkey).out());
    for (const p of this.partial_sigs) rec(concatBytes(Uint8Array.of(0x02), p.pub), p.sig);
    if (this.sighash_type !== null) rec(Uint8Array.of(0x03), le32(this.sighash_type));
    if (this.redeem_script) rec(Uint8Array.of(0x04), this.redeem_script);
    if (this.witness_script) rec(Uint8Array.of(0x05), this.witness_script);
    for (const d of this.bip32_derivations) rec(concatBytes(Uint8Array.of(0x06), d.pub), ssPsbtSerDer(d.der));
    if (this.final_scriptsig) rec(Uint8Array.of(0x07), this.final_scriptsig);
    if (this.final_scriptwitness) rec(Uint8Array.of(0x08), ssPsbtWitnessSer(this.final_scriptwitness));
    if (version === 2) {
      if (this.txid !== null) rec(Uint8Array.of(0x0e), this.txid);
      if (this.vout !== null) rec(Uint8Array.of(0x0f), le32(this.vout));
      if (this.sequence !== null) rec(Uint8Array.of(0x10), le32(this.sequence));
    }
    for (const x of this.taproot_sigs) rec(concatBytes(Uint8Array.of(0x14), x.key), x.val);
    for (const x of this.taproot_scripts) rec(concatBytes(Uint8Array.of(0x15), x.control), x.script);
    for (const d of this.taproot_bip32_derivations) {
      const v = new SSPsbtWriter().varint(d.leaf_hashes.length);
      for (const h of d.leaf_hashes) v.raw(h);
      v.raw(ssPsbtSerDer(d.der));
      rec(concatBytes(Uint8Array.of(0x16), d.pub), v.out());
    }
    if (this.taproot_internal_key) rec(Uint8Array.of(0x17), this.taproot_internal_key);
    if (this.taproot_merkle_root) rec(Uint8Array.of(0x18), this.taproot_merkle_root);
    for (const x of this.unknown) rec(x.key, x.val);
    w.raw([0]);
  }
}

class SSPSBTOutputScope {
  constructor(vout = null) {
    this.value = vout ? vout.value : null;
    this.script_pubkey = vout ? vout.script_pubkey : null;
    this.redeem_script = null;
    this.witness_script = null;
    this.bip32_derivations = [];
    this.taproot_internal_key = null;
    this.taproot_bip32_derivations = [];
    this.unknown = [];
  }
  get vout() { return {value: this.value, script_pubkey: this.script_pubkey}; }
  read_value(t, key, v) {
    const k1 = key.length === 0;
    if (t === 0x00 && k1) { if (this.redeem_script) throw new Error("Duplicated redeem script"); this.redeem_script = v; }
    else if (t === 0x01 && k1) { if (this.witness_script) throw new Error("Duplicated witness script"); this.witness_script = v; }
    else if (t === 0x02) {
      pointFromPub(key);
      if (this.bip32_derivations.some((x) => ssPsbtEq(x.pub, key))) throw new Error("Duplicated derivation path");
      this.bip32_derivations.push({pub: key, der: ssPsbtParseDer(v)});
    }
    else if (t === 0x03 && k1) { this.value = psbtReader(v).i64(); }
    else if (t === 0x04 && k1) { this.script_pubkey = v; }
    else if (t === 0x05) { this.taproot_internal_key = v; }
    else if (t === 0x07) {
      if (key.length !== 32) throw new Error("Invalid key length");
      if (!this.taproot_bip32_derivations.some((x) => ssPsbtEq(x.pub, key))) {
        const r = psbtReader(v), num = r.varint(), leaf_hashes = [];
        for (let i = 0; i < num; i++) leaf_hashes.push(r.bytes(32));
        this.taproot_bip32_derivations.push({pub: key, leaf_hashes, der: ssPsbtParseDer(r.bytes(v.length - r.pos))});
      }
    }
    else this.unknown.push({key: concatBytes(Uint8Array.of(t), key), val: v});
  }
  write_to(w, version = null) {
    const rec = (k, v) => { w.str(k); w.str(v); };
    if (this.redeem_script) rec(Uint8Array.of(0x00), this.redeem_script);
    if (this.witness_script) rec(Uint8Array.of(0x01), this.witness_script);
    for (const d of this.bip32_derivations) rec(concatBytes(Uint8Array.of(0x02), d.pub), ssPsbtSerDer(d.der));
    if (version === 2) {
      rec(Uint8Array.of(0x03), svLe64(this.value));
      rec(Uint8Array.of(0x04), this.script_pubkey);
    }
    if (this.taproot_internal_key) rec(Uint8Array.of(0x05), this.taproot_internal_key);
    for (const d of this.taproot_bip32_derivations) {
      const v = new SSPsbtWriter().varint(d.leaf_hashes.length);
      for (const h of d.leaf_hashes) v.raw(h);
      v.raw(ssPsbtSerDer(d.der));
      rec(concatBytes(Uint8Array.of(0x07), d.pub), v.out());
    }
    for (const x of this.unknown) rec(x.key, x.val);
    w.raw([0]);
  }
}

// embit psbt.PSBT
class SSPSBT {
  constructor(tx = null, version = null) {
    this.version = version;
    this.tx_version = tx ? tx.version : null;
    this.locktime = tx ? tx.locktime : null;
    this.inputs = tx ? tx.vin.map((v) => new SSPSBTInputScope(v)) : [];
    this.outputs = tx ? tx.vout.map((v) => new SSPSBTOutputScope(v)) : [];
    this.xpubs = [];     // [{key: 78-byte serialized xpub, der: {fingerprint, derivation}}]
    this.unknown = [];
  }

  // psbt.PSBT.parse(bytes)
  static parse(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    const r = psbtReader(bytes);
    if (!ssPsbtEq(r.bytes(5), [0x70, 0x73, 0x62, 0x74, 0xff])) throw new Error("Invalid PSBT magic");
    let tx = null, version = null;
    const unknown = [];
    for (;;) {
      const kl = r.varint();
      if (kl === 0) break;
      const key = r.bytes(kl), value = r.bytes(r.varint());
      if (key.length === 1 && key[0] === 0x00) {
        if (tx) throw new Error("Failed to parse PSBT - duplicated transaction field");
        tx = ssPsbtParseTx(value);
      } else if (key.length === 1 && key[0] === 0xfb) {
        version = (value[0] | (value[1] << 8) | (value[2] << 16) | (value[3] << 24)) >>> 0;
      } else {
        if (unknown.some((x) => ssPsbtEq(x.key, key))) throw new Error("Duplicated key");
        unknown.push({key, val: value});
      }
    }
    if (tx && version === 2) throw new Error("Global TX field is not allowed in PSBTv2");
    if (!tx && version !== 2) throw new Error("No transaction in the PSBT");
    const psbt = new SSPSBT(tx, version);
    let nin = psbt.inputs.length, nout = psbt.outputs.length;
    // parse_unknowns
    for (const u of unknown) {
      const t = u.key[0], k1 = u.key.length === 1;
      if (t === 0x01 && u.key.length === 79) psbt.xpubs.push({key: u.key.slice(1), der: ssPsbtParseDer(u.val)});
      else if (t === 0x02 && k1) psbt.tx_version = (u.val[0] | (u.val[1] << 8) | (u.val[2] << 16) | (u.val[3] << 24)) >>> 0;
      else if (t === 0x03 && k1) psbt.locktime = (u.val[0] | (u.val[1] << 8) | (u.val[2] << 16) | (u.val[3] << 24)) >>> 0;
      else if (t === 0x04 && k1) { if (nin > 0) throw new Error("Inputs already initialized"); nin = psbtReader(u.val).varint(); }
      else if (t === 0x05 && k1) { if (nout > 0) throw new Error("Outputs already initialized"); nout = psbtReader(u.val).varint(); }
      else psbt.unknown.push(u);
    }
    if (version === 2) {
      psbt.inputs = Array.from({length: nin}, () => new SSPSBTInputScope());
      psbt.outputs = Array.from({length: nout}, () => new SSPSBTOutputScope());
    }
    const readScope = (scope) => {
      for (;;) {
        const kl = r.varint();
        if (kl === 0) return;
        const key = r.bytes(kl), value = r.bytes(r.varint());
        scope.read_value(key[0], key.slice(1), value);
      }
    };
    for (const inp of psbt.inputs) readScope(inp);
    for (const out of psbt.outputs) readScope(out);
    if (version === 2) {
      for (const inp of psbt.inputs) if (!inp.txid || inp.vout === null) throw new Error("Invalid PSBTv2 input");
      for (const out of psbt.outputs) if (out.value === null || !out.script_pubkey) throw new Error("Invalid PSBTv2 output");
    }
    return psbt;
  }

  // PSBT(tx): a new version 0 PSBT for this unsigned transaction
  static from_tx(tx) { return new SSPSBT(tx, null); }

  get tx() {
    return {
      version: this.tx_version || 2,
      locktime: this.locktime || 0,
      vin: this.inputs.map((x) => x.vin),
      vout: this.outputs.map((x) => x.vout),
    };
  }

  utxo(i) {
    const u = this.inputs[i].utxo;
    if (!u) throw new Error(`Missing previous utxo on input ${i}`);
    return u;
  }

  fee() {
    let fee = 0n;
    for (let i = 0; i < this.inputs.length; i++) fee += BigInt(this.utxo(i).value);
    for (const out of this.tx.vout) fee -= BigInt(out.value);
    return fee;
  }

  serialize() {
    const w = new SSPsbtWriter();
    w.raw([0x70, 0x73, 0x62, 0x74, 0xff]);
    if (this.version !== 2) { w.raw([0x01, 0x00]); w.str(ssPsbtSerializeTx(this.tx)); }
    for (const x of this.xpubs) { w.str(concatBytes(Uint8Array.of(0x01), x.key)); w.str(ssPsbtSerDer(x.der)); }
    if (this.version === 2) {
      if (this.tx_version !== null) { w.str([0x02]); w.str(le32(this.tx_version)); }
      if (this.locktime !== null) { w.str([0x03]); w.str(le32(this.locktime)); }
      w.str([0x04]); w.str(varintBytes(this.inputs.length));
      w.str([0x05]); w.str(varintBytes(this.outputs.length));
      w.str([0xfb]); w.str(le32(this.version));
    }
    for (const u of this.unknown) { w.str(u.key); w.str(u.val); }
    w.raw([0]);
    for (const inp of this.inputs) inp.write_to(w, this.version);
    for (const out of this.outputs) out.write_to(w, this.version);
    return w.out();
  }

  // The context VOIDFORGE's signature-hash functions take (no work limit: these are our own signatures)
  _sighash_ctx() {
    const tx = this.tx;
    const stx = {
      version: tx.version, locktime: tx.locktime,
      ins: tx.vin.map((x) => ({prev: x.txid, vout: x.vout, seq: x.sequence})),
      outs: tx.vout.map((o) => ({amount: o.value, script: o.script_pubkey})),
    };
    const coins = this.inputs.map((inp) => { const u = inp.utxo; return u ? {amount: u.value, script: u.script_pubkey} : null; });
    return {tx: stx, coins, why: [], all: coins.every(Boolean), left: Infinity, bytes: -Infinity, cache: {}};
  }

  // PSBT.sighash(i, sighash, ...)
  async sighash(ctx, i, sighash, ext = null) {
    const inp = this.inputs[i];
    if (inp.is_taproot) {
      for (const c of ctx.coins) if (!c) throw new Error("Missing previous utxo");
      return svSighashTr(ctx, i, sighash, ext);
    }
    const u = this.utxo(i);
    let sc = inp.witness_script || inp.redeem_script || u.script_pubkey;
    // detect if it is a segwit input
    const st = (x) => ssPsbtScriptType(x);
    const is_segwit = inp.witness_script || inp.witness_utxo || ["p2wpkh", "p2wsh"].includes(st(u.script_pubkey)) ||
      (inp.redeem_script && ["p2wpkh", "p2wsh"].includes(st(inp.redeem_script)));
    // convert to p2pkh according to bip143
    if (st(sc) === "p2wpkh") sc = ssPsbtP2pkhFromP2wpkh(sc);
    if (is_segwit) return svSighashV0(ctx, i, sc, u.value, sighash);
    return svSighashLegacy(ctx, i, sc, sighash);
  }

  // PSBT.sign_input_with_tapkey(key, input_index, inp, sighash). key: the private key (BigInt)
  async sign_input_with_tapkey(ctx, k, input_index, inp, sighash = 0) {
    inp = inp || this.inputs[input_index];
    if (!inp.is_taproot) return 0;
    // check if key is internal key
    const tweaked = await ssPsbtTaprootTweakPrv(k, inp.taproot_merkle_root || new Uint8Array(0));
    const pk_x = ssPsbtBig32(emul(tweaked, SG)[0]);
    if (ssPsbtContains(inp.utxo.script_pubkey, pk_x)) {
      const h = await this.sighash(ctx, input_index, sighash);
      if (!h) return 0;
      let wit = await ssPsbtSchnorrSign(h, tweaked);
      if (sighash !== 0) wit = concatBytes(wit, Uint8Array.of(sighash));
      inp.final_scriptwitness = [wit];
      // no need to sign anything else
      return 1;
    }
    // SIM: signing inside a taptree leaf (taproot_scripts, embit's taproot_sigs) is not ported. In SeedSigner such a
    // signature is dropped right away by PSBTParser.trim (it keeps only final witnesses and partial sigs), so the flow
    // ends on "Signing Failed" either way.
    return 0;
  }

  // PSBT.sign_with(root, sighash=SIGHASH.DEFAULT): returns the number of signatures added
  async sign_with(root, sighash = 0) {
    const SIGHASH_ALL = 1, SIGHASH_DEFAULT = 0;
    const fingerprint = root.my_fingerprint;
    const rootpub = root.get_public_key();
    const sec = rootpub, pkh = await hash160(sec);
    const ctx = this._sighash_ctx();
    let counter = 0;
    for (let i = 0; i < this.inputs.length; i++) {
      const inp = this.inputs[i];
      // SIGHASH.DEFAULT is only for taproot, fallback to SIGHASH.ALL for other inputs
      let required_sighash = sighash;
      if (!inp.is_taproot && required_sighash === SIGHASH_DEFAULT) required_sighash = SIGHASH_ALL;
      let inp_sighash = inp.sighash_type;
      if (inp_sighash === null) inp_sighash = required_sighash || SIGHASH_DEFAULT;
      if (!inp.is_taproot && inp_sighash === SIGHASH_DEFAULT) inp_sighash = SIGHASH_ALL;
      if (required_sighash !== null && inp_sighash !== required_sighash) {
        if (![SIGHASH_DEFAULT, SIGHASH_ALL].includes(inp_sighash) || ![SIGHASH_DEFAULT, SIGHASH_ALL].includes(required_sighash)) continue;
      }

      // get all possible derivations with matching fingerprint
      const bip32_derivations = [];
      if (fingerprint) {
        for (const d of inp.taproot_bip32_derivations) if (ssPsbtEq(d.der.fingerprint, fingerprint)) bip32_derivations.push({pub: d.pub, der: d.der});
        for (const d of inp.bip32_derivations) if (ssPsbtEq(d.der.fingerprint, fingerprint)) bip32_derivations.push({pub: d.pub, der: d.der});
      }
      // get derived keys for signing
      const derived_keypairs = [];
      for (const d of bip32_derivations) {
        const hdkey = await root.derive(d.der.derivation);
        const xonly = (p) => p.length === 33 ? p.slice(1) : p;
        if (!ssPsbtEq(hdkey.xonly(), xonly(d.pub))) throw new Error("Derivation path doesn't look right");
        if (!derived_keypairs.some((x) => ssPsbtEq(x.pub, d.pub))) derived_keypairs.push({prv: hdkey.k, pub: d.pub});
      }

      // sign with taproot key
      if (inp.is_taproot) {
        // try to sign with individual private key (WIF) or with root without derivations
        counter += await this.sign_input_with_tapkey(ctx, root.k, i, inp, inp_sighash);
        // sign with all derived keys
        for (const kp of derived_keypairs) counter += await this.sign_input_with_tapkey(ctx, kp.prv, i, inp, inp_sighash);
        continue;
      }

      // hash can be reused
      const h = await this.sighash(ctx, i, inp_sighash);
      const sc = inp.witness_script || inp.redeem_script || inp.utxo.script_pubkey;
      const put = (pub, sig) => {
        const j = inp.partial_sigs.findIndex((x) => ssPsbtEq(x.pub, pub));
        if (j >= 0) inp.partial_sigs[j].sig = sig; else inp.partial_sigs.push({pub, sig});
      };
      // check if root itself is included in the script
      if (ssPsbtContains(sc, sec) || ssPsbtContains(sc, pkh)) {
        put(rootpub, concatBytes(await ssPsbtEcdsaSign(h, root.k), Uint8Array.of(inp_sighash)));
        counter += 1;
      }
      for (const kp of derived_keypairs) {
        // sig plus sighash flag
        put(kp.pub, concatBytes(await ssPsbtEcdsaSign(h, kp.prv), Uint8Array.of(inp_sighash)));
        counter += 1;
      }
    }
    return counter;
  }
}

// urtypes crypto.PSBT.from_cbor(cbor).data and bytes.Bytes.from_cbor(cbor).data: a CBOR byte string
function ssPsbtUrPsbtFromCbor(cbor) {
  const r = ssPsbtCborRead(cbor, 0);
  if (!(r.v instanceof Uint8Array)) throw new Error("Not a crypto-psbt");
  return r.v;
}
function ssPsbtUrBytesFromCbor(cbor) {
  const r = ssPsbtCborRead(cbor, 0);
  if (!(r.v instanceof Uint8Array)) throw new Error("Not a bytes UR");
  return r.v;
}


/* ---------------------------------------------------------------------------------------------------------------------
   4. CBOR reader and urtypes Output / Account -> descriptor string
   --------------------------------------------------------------------------------------------------------------------- */
class SSPsbtCborTag { constructor(tag, value) { this.tag = tag; this.value = value; } }
function ssPsbtCborRead(b, pos) {
  if (pos >= b.length) throw new Error("CBOR data ends early");
  const ib = b[pos++], major = ib >> 5, ai = ib & 31;
  let n;
  if (ai < 24) n = ai;
  else if (ai === 24) { n = b[pos]; pos += 1; }
  else if (ai === 25) { n = (b[pos] << 8) | b[pos + 1]; pos += 2; }
  else if (ai === 26) { n = ((b[pos] << 24) >>> 0) + ((b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3]); pos += 4; }
  else if (ai === 27) { let v = 0; for (let i = 0; i < 8; i++) v = v * 256 + b[pos + i]; n = v; pos += 8; }
  else throw new Error("Unsupported CBOR item");
  if (n === undefined || Number.isNaN(n) || pos > b.length) throw new Error("CBOR data ends early");
  if (major === 0) return {v: n, pos};
  if (major === 1) return {v: -1 - n, pos};
  if (major === 2) { if (pos + n > b.length) throw new Error("CBOR data ends early"); return {v: Uint8Array.from(b.slice(pos, pos + n)), pos: pos + n}; }
  if (major === 3) { if (pos + n > b.length) throw new Error("CBOR data ends early"); return {v: new TextDecoder().decode(Uint8Array.from(b.slice(pos, pos + n))), pos: pos + n}; }
  if (major === 4) { const a = []; for (let i = 0; i < n; i++) { const r = ssPsbtCborRead(b, pos); a.push(r.v); pos = r.pos; } return {v: a, pos}; }
  if (major === 5) {
    const m = new Map();
    for (let i = 0; i < n; i++) { const k = ssPsbtCborRead(b, pos); const v = ssPsbtCborRead(b, k.pos); m.set(k.v, v.v); pos = v.pos; }
    return {v: m, pos};
  }
  if (major === 6) { const r = ssPsbtCborRead(b, pos); return {v: new SSPsbtCborTag(n, r.v), pos: r.pos}; }
  if (major === 7) {
    if (ai === 20) return {v: false, pos};
    if (ai === 21) return {v: true, pos};
    if (ai === 22 || ai === 23) return {v: null, pos};
  }
  throw new Error("Unsupported CBOR item");
}
// urtypes Keypath.path() (urtypes 1.0.1, crypto/keypath.py): "48'/0'/0'/2'" style parts. A component that is not a
// number (a wildcard [] or a pair) is read as a wildcard and written "*", as urtypes' from_data_item does.
function ssPsbtUrKeypath(m) {
  const comps = m.get(1) || [], out = [];
  for (let i = 0; i < comps.length; i += 2) {
    const c = comps[i], h = comps[i + 1] === true;
    out.push((typeof c === "number" ? String(c) : "*") + (h ? "'" : ""));
  }
  return out;
}
// urtypes crypto.HDKey.descriptor_key() / ECKey
async function ssPsbtUrKey(item) {
  if (!(item instanceof SSPsbtCborTag)) throw new Error("Unsupported key in the UR");
  const m = item.value;
  if (item.tag === 306) return hex(m.get(3));   // crypto-eckey
  if (item.tag !== 303) throw new Error("Unsupported key in the UR");
  const key_data = m.get(3), chain_code = m.get(4);
  if (!key_data || !chain_code) throw new Error("A master key or a key without chain code is not supported");
  // urtypes bip32_key(): main-network version bytes only when there is no use-info or its network is 0
  // (a use-info without a network field gives test-network bytes there too).
  let network = 0;
  const use = m.get(5);
  const useMap = use instanceof SSPsbtCborTag ? use.value : use;
  if (useMap instanceof Map && useMap.get(2) !== 0) network = 1;
  let origin = m.get(6), children = m.get(7);
  origin = origin instanceof SSPsbtCborTag ? origin.value : origin;
  children = children instanceof SSPsbtCborTag ? children.value : children;
  const comps = origin ? (origin.get(1) || []) : [];
  const depth = origin && origin.get(3) !== undefined ? origin.get(3) : comps.length / 2;
  let child_number = 0;
  if (comps.length >= 2) child_number = (comps[comps.length - 2] + (comps[comps.length - 1] === true ? SS_PSBT_HARDENED : 0)) >>> 0;
  let parent_fp = m.get(8) || 0;
  // urtypes quirk, kept: with no parent fingerprint, a one-step origin with a source fingerprint gives that
  // fingerprint as the parent, and then the [fingerprint/path] origin is left out of the descriptor.
  let source_is_parent = false;
  if (m.get(8) === undefined && origin && origin.get(2) !== undefined && comps.length === 2) { parent_fp = origin.get(2); source_is_parent = true; }
  const raw = new SSPsbtWriter();
  raw.raw(network === 1 ? [0x04, 0x35, 0x87, 0xcf] : [0x04, 0x88, 0xb2, 0x1e]);
  raw.raw([depth]);
  raw.raw([(parent_fp >>> 24) & 255, (parent_fp >>> 16) & 255, (parent_fp >>> 8) & 255, parent_fp & 255]);
  raw.raw([(child_number >>> 24) & 255, (child_number >>> 16) & 255, (child_number >>> 8) & 255, child_number & 255]);
  raw.raw(chain_code); raw.raw(key_data);
  let s = "";
  if (origin && !source_is_parent) {
    const fp = origin.get(2);
    const path = ssPsbtUrKeypath(origin);
    if (fp !== undefined && path.length) s += "[" + [(fp >>> 0).toString(16).padStart(8, "0")].concat(path).join("/") + "]";
  }
  s += await base58check(raw.out());
  if (children && ssPsbtUrKeypath(children).length) s += "/" + ssPsbtUrKeypath(children).join("/");
  return s;
}
const SS_PSBT_UR_SCRIPTS = {400: "sh", 401: "wsh", 402: "pk", 403: "pkh", 404: "wpkh", 405: "combo", 409: "tr", 410: "cosigner"};
async function ssPsbtUrOutputItem(item) {
  if (!(item instanceof SSPsbtCborTag)) throw new Error("Not a crypto-output");
  if (SS_PSBT_UR_SCRIPTS[item.tag]) return SS_PSBT_UR_SCRIPTS[item.tag] + "(" + await ssPsbtUrOutputItem(item.value) + ")";
  if (item.tag === 406 || item.tag === 407) {
    const m = item.value, keys = [];
    for (const k of m.get(2) || []) keys.push(await ssPsbtUrKey(k));
    return (item.tag === 406 ? "multi" : "sortedmulti") + "(" + m.get(1) + "," + keys.join(",") + ")";
  }
  return ssPsbtUrKey(item);
}
// urtypes Output.descriptor() adds "#" and the descriptor checksum (embit ignores what follows "#" when parsing).
async function ssPsbtUrWithChecksum(d) { return descriptorChecksum(d); }   // the page function returns d + "#" + checksum
async function ssPsbtUrOutputDescriptor(cbor) {
  let item = ssPsbtCborRead(cbor, 0).v;
  if (item instanceof SSPsbtCborTag && item.tag === 308) item = item.value;   // tagged crypto-output
  return ssPsbtUrWithChecksum(await ssPsbtUrOutputItem(item));
}
async function ssPsbtUrAccountDescriptor(cbor) {
  let m = ssPsbtCborRead(cbor, 0).v;
  if (m instanceof SSPsbtCborTag) m = m.value;
  const outs = m.get(2) || [];
  if (!outs.length) throw new Error("No output descriptors in the crypto-account");
  let item = outs[0];
  if (item instanceof SSPsbtCborTag && item.tag === 308) item = item.value;
  return ssPsbtUrWithChecksum(await ssPsbtUrOutputItem(item));
}


/* ---------------------------------------------------------------------------------------------------------------------
   5. embit.descriptor.Descriptor (sh / wsh / sh-wsh multi and sortedmulti; single-key wpkh, sh-wpkh, pkh, tr)
   --------------------------------------------------------------------------------------------------------------------- */
class SSDescriptorKey {
  constructor() {
    this.origin = null;              // {fingerprint, derivation}
    this.key = null;                 // {pub, chain, str} for an extended key, {pub} for a plain one
    this.is_extended = false;
    this.allowed_derivation = null;  // indexes: numbers, null (wildcard) or [a, b] (branch set)
    this.my_fingerprint = null;
    this.text = "";
  }
  get fingerprint() {
    if (this.origin) return this.origin.fingerprint;
    if (this.is_extended) return this.my_fingerprint;
    return null;
  }
  get derivation() { return this.origin ? this.origin.derivation : []; }
  get is_wildcard() { return !!this.allowed_derivation && this.allowed_derivation.includes(null); }
  get branches() { if (!this.allowed_derivation) return null; for (const el of this.allowed_derivation) if (Array.isArray(el)) return el; return null; }
  get num_branches() { const b = this.branches; return b ? b.length : 1; }

  static async parse(text) {
    const k = new SSDescriptorKey();
    k.text = text;
    let s = text;
    if (s[0] === "[") {
      const z = s.indexOf("]");
      if (z < 0) throw new Error("Missing closing bracket in key origin");
      const arr = s.slice(1, z).split("/");
      if (!/^[0-9a-fA-F]{8}$/.test(arr[0])) throw new Error("Invalid fingerprint in key origin");
      k.origin = {fingerprint: fromHex(arr[0].toLowerCase()), derivation: ssSeedsParsePath(["m"].concat(arr.slice(1)).join("/"))};
      s = s.slice(z + 1);
    }
    const slash = s.indexOf("/");
    const body = slash < 0 ? s : s.slice(0, slash), der = slash < 0 ? "" : s.slice(slash + 1);
    if (/^0[23][0-9a-fA-F]{64}$/.test(body)) {
      k.key = {pub: fromHex(body.toLowerCase())};
      pointFromPub(k.key.pub);
      if (der) throw new Error("Derivation is not allowed for a plain public key");
    } else {
      // SIM: VOIDFORGE reads extended PUBLIC keys only (any version: xpub, tpub, Zpub, ...); a private key is refused.
      const p = await parseExtendedKey(body);
      k.key = {pub: p.pub, chain: p.chain, str: body};
      k.is_extended = true;
      k.my_fingerprint = (await hash160(p.pub)).slice(0, 4);
      if (der) {
        k.allowed_derivation = der.split("/").map((d) => SSDescriptorKey.parse_element(d, true));
        if (k.allowed_derivation.filter((i) => i === null).length > 1) throw new Error("Only one wildcard is allowed");
        if (k.allowed_derivation.filter((i) => Array.isArray(i)).length > 1) throw new Error("Only one set of branches is allowed");
      }
    }
    return k;
  }
  // AllowedDerivation.parse_element
  static parse_element(d, allow_set) {
    if (d === "*") return null;
    if ((d[0] === "{" && d[d.length - 1] === "}") || (d[0] === "<" && d[d.length - 1] === ">")) {
      if (!allow_set) throw new Error("Set is not allowed in derivation " + d);
      return d.slice(1, -1).split(d[0] === "{" ? "," : ";").map((x) => SSDescriptorKey.parse_element(x, false));
    }
    if (/[hH']$/.test(d)) throw new Error("Hardened derivation is not allowed in " + d);
    if (!/^[0-9]+$/.test(d)) throw new Error("invalid literal for int() with base 10: '" + d + "'");
    const i = parseInt(d, 10);
    if (i >= SS_PSBT_HARDENED) throw new Error("Derivation index can be in a range [0, 2147483648)");
    return i;
  }
  // DescriptorKey.check_derivation(DerivationPath) -> [idx, branch_idx] or null
  check_derivation(dp) {
    let rest = null;
    // full derivation path
    if (this.origin && ssPsbtEq(this.origin.fingerprint, dp.fingerprint)) {
      const origin = this.origin.derivation;
      if (origin.every((x, i) => dp.derivation[i] === x) && dp.derivation.length >= origin.length) rest = dp.derivation.slice(origin.length);
    } else if (!this.origin && ssPsbtEq(this.my_fingerprint, dp.fingerprint)) {
      rest = dp.derivation;   // (a key without origin: its own fingerprint, the "fingerprint" property)
    }
    // short derivation path
    if (ssPsbtEq(this.my_fingerprint, dp.fingerprint)) rest = dp.derivation;
    if (this.allowed_derivation === null || rest === null) return null;
    // AllowedDerivation.check_derivation
    if (rest.length !== this.allowed_derivation.length) return null;
    let branch_idx = 0, idx = null;
    for (let i = 0; i < this.allowed_derivation.length; i++) {
      const el = this.allowed_derivation[i], der = rest[i];
      if (typeof el === "number") { if (el !== der) return null; }
      else if (Array.isArray(el)) { const j = el.indexOf(der); if (j < 0) return null; branch_idx = j; }
      else if (el === null) idx = der;
    }
    if (branch_idx !== null && idx !== null) return [idx, branch_idx];
    return null;
  }
  // The public key at (idx, branch_index): AllowedDerivation.fill + HDKey.derive
  async derive_pub(idx, branch_index = null) {
    if (!this.is_extended) return this.key.pub;
    if (!this.allowed_derivation) return this.key.pub;
    if (idx !== null && (idx < 0 || idx >= SS_PSBT_HARDENED)) throw new Error("Hardened indexes are not allowed in wildcard");
    let pub = this.key.pub, chain = this.key.chain;
    for (const el of this.allowed_derivation) {
      let i = el;
      if (el === null) i = idx;
      else if (Array.isArray(el)) {
        if (branch_index === null || branch_index === undefined) throw new Error("Branch index is required");
        if (branch_index < 0 || branch_index >= el.length) throw new Error("Invalid branch index");
        i = el[branch_index];
      }
      [pub, chain] = await ckdPub(pub, chain, i);
    }
    return pub;
  }
}

class SSDescriptor {
  constructor({miniscript = null, sh = false, wsh = true, key = null, wpkh = true, taproot = false} = {}) {
    this.miniscript = miniscript;   // {name: "multi"|"sortedmulti", threshold, keys} or {name: <other>, keys: []} (opaque)
    this.sh = sh; this.wsh = wsh; this.key = key; this.wpkh = wpkh; this.taproot = taproot;
    this.text = "";
  }

  // Descriptor.from_string(desc). Async (extended keys are checked with VOIDFORGE's async base58).
  static async from_string(desc) {
    let s = String(desc).trim();
    const hash = s.indexOf("#");
    if (hash >= 0) s = s.slice(0, hash);   // embit ignores what follows "#" (the checksum)
    let sh = false, wsh = false, wpkh = false, taproot = false, inner, close;
    if (s.startsWith("tr(")) { taproot = true; inner = s.slice(3); close = 1; }
    else if (s.startsWith("sh(wsh(")) { sh = true; wsh = true; inner = s.slice(7); close = 2; }
    else if (s.startsWith("wsh(")) { wsh = true; inner = s.slice(4); close = 1; }
    else if (s.startsWith("sh(wpkh(")) { sh = true; wpkh = true; inner = s.slice(8); close = 2; }
    else if (s.startsWith("wpkh(")) { wpkh = true; inner = s.slice(5); close = 1; }
    else if (s.startsWith("pkh(")) { inner = s.slice(4); close = 1; }
    else if (s.startsWith("sh(")) { sh = true; inner = s.slice(3); close = 1; }
    else throw new Error("Invalid descriptor (should start with sh, wsh, wpkh, pkh or tr)");
    if (!inner.endsWith(")".repeat(close))) throw new Error("Missing closing parenthesis");
    inner = inner.slice(0, inner.length - close);
    let depth = 0;
    for (const c of inner) { if (c === "(") depth++; else if (c === ")") { depth--; if (depth < 0) throw new Error("Unexpected ')'"); } }
    if (depth !== 0) throw new Error("Unbalanced parentheses");
    const is_miniscript = !(wpkh || taproot || (s.startsWith("pkh(")));
    let d;
    if (!is_miniscript) {
      if (taproot && inner.includes(",")) throw new Error("SIM: taproot script trees are not supported by this practice signer");
      d = new SSDescriptor({key: await SSDescriptorKey.parse(inner), sh, wsh: false, wpkh, taproot});
    } else {
      const m = /^(multi|sortedmulti)\((.*)\)$/.exec(inner);
      if (m) {
        const args = SSDescriptor._split_args(m[2]);
        if (!/^[0-9]+$/.test(args[0] || "")) throw new Error("Invalid multisig threshold");
        const keys = [];
        for (const a of args.slice(1)) keys.push(await SSDescriptorKey.parse(a));
        const threshold = parseInt(args[0], 10);
        if (keys.length < 1 || keys.length > 20 || threshold < 1 || threshold > keys.length) throw new Error("Invalid multisig");
        const branches = new Set(keys.filter((k) => k.branches).map((k) => k.branches.length));
        if (branches.size > 1) throw new Error("All branches should have the same length");
        d = new SSDescriptor({miniscript: {name: m[1], threshold, keys}, sh, wsh, wpkh: false});
      } else {
        // SIM: other miniscript is kept as text only (not basic multisig: SeedSigner routes it to NotYetImplementedView)
        const fm = /^([a-z_:]+)\(/.exec(inner);
        if (!fm) throw new Error("Invalid miniscript");
        d = new SSDescriptor({miniscript: {name: fm[1], threshold: null, keys: []}, sh, wsh, wpkh: false});
      }
    }
    d.text = String(desc).trim();
    return d;
  }
  static _split_args(s) {
    const out = []; let depth = 0, cur = "";
    for (const c of s) {
      if (c === "(" || c === "{" || c === "[" || c === "<") depth++;
      else if (c === ")" || c === "}" || c === "]" || c === ">") depth--;
      if (c === "," && depth === 0) { out.push(cur); cur = ""; } else cur += c;
    }
    out.push(cur);
    return out;
  }

  get keys() { if (this.key) return [this.key]; return this.miniscript.keys; }
  get is_basic_multisig() { return !!(this.miniscript && ["multi", "sortedmulti"].includes(this.miniscript.name)); }
  get is_sorted() { return !!(this.is_basic_multisig && this.miniscript.name === "sortedmulti"); }
  get is_wildcard() { return this.keys.some((k) => k.is_wildcard); }
  get is_segwit() { return !!((this.wsh && this.miniscript) || (this.wpkh && this.key) || this.taproot); }
  get is_taproot() { return this.taproot; }
  get is_legacy() { return !(this.is_segwit || this.is_taproot); }
  get is_wrapped() { return this.sh && this.is_segwit; }
  get is_pkh() { return this.key !== null && !this.taproot; }
  get threshold() { return this.miniscript ? this.miniscript.threshold : null; }
  get m() { return this.threshold; }
  get brief_policy() {
    if (this.key) return "single key";
    if (this.is_basic_multisig) return this.miniscript.threshold + " of " + this.keys.length + " multisig" + (this.is_sorted ? " (sorted)" : "");
    return "miniscript";
  }
  scriptpubkey_type() {
    if (this.is_taproot) return "p2tr";
    if (this.sh) return "p2sh";
    if (this.is_pkh) { if (this.is_legacy) return "p2pkh"; if (this.is_segwit) return "p2wpkh"; }
    return "p2wsh";
  }
  // embit_utils.get_multisig_policy
  get_multisig_policy() {
    if (!this.is_basic_multisig) throw new Error("Expected a basic multisig descriptor, got: " + this.brief_policy);
    return [String(this.miniscript.threshold), String(this.keys.length)];
  }
  // derive(idx, branch_index).script_pubkey()
  async script_pubkey(idx, branch_index = null) {
    if (this.key) {
      const pub = await this.key.derive_pub(idx, branch_index);
      if (this.taproot) return ssPsbtP2tr(pub);
      if (this.sh) return ssPsbtP2sh(await ssPsbtP2wpkh(pub));
      if (this.wpkh) return ssPsbtP2wpkh(pub);
      return ssPsbtP2pkh(pub);
    }
    if (!this.is_basic_multisig) throw new Error("SIM: this miniscript is not supported by this practice signer");
    const pubs = [];
    for (const k of this.keys) pubs.push(await k.derive_pub(idx, branch_index));
    if (this.is_sorted) pubs.sort(cmpBytes);
    const n = pubs.length, m = this.miniscript.threshold;
    if (n > 16) throw new Error("Too many keys for CHECKMULTISIG");
    const w = new SSPsbtWriter().raw([0x50 + m]);
    for (const p of pubs) w.raw([p.length]).raw(p);
    w.raw([0x50 + n, 0xae]);
    const sc = w.out();
    if (this.sh && this.wsh) return ssPsbtP2sh(await ssPsbtP2wsh(sc));
    if (this.wsh) return ssPsbtP2wsh(sc);
    if (this.sh) return ssPsbtP2sh(sc);
    return sc;
  }
  // embit_utils.get_multisig_address(descriptor, index, is_change, embit_network)
  async derive_address(index = 0, is_change = false, embit_network = "main") {
    const branch_index = is_change ? 1 : 0;
    // Can derive p2wsh, p2sh-p2wsh, and legacy (non-segwit) p2sh
    if (this.is_segwit || (this.is_legacy && this.is_basic_multisig)) {
      if (this.is_taproot) throw new Error("Taproot verification not yet implemented!");
      return ssPsbtScriptAddress(await this.script_pubkey(index, branch_index), embit_network);
    }
    if (this.is_taproot) throw new Error("Taproot verification not yet implemented!");
    throw new Error(`${this.scriptpubkey_type()} address verification not yet implemented!`);
  }
  // Descriptor.owns(psbt_scope)
  async owns(scope) {
    const spk = scope.script_pubkey;
    if (!spk) return false;
    if (ssPsbtScriptType(spk) !== this.scriptpubkey_type()) return false;
    for (const list of [scope.bip32_derivations, scope.taproot_bip32_derivations]) {
      for (const d of list) {
        for (const k of this.keys) {
          if (!k.is_extended) continue;
          const res = k.check_derivation(d.der);
          if (res) {
            const sc = await this.script_pubkey(res[0], res[1]);
            // if derivation is found but scriptpubkey doesn't match - fail
            return ssPsbtEq(sc, spk);
          }
        }
      }
    }
    return false;
  }
  toString() { return this.text; }
}


/* ---------------------------------------------------------------------------------------------------------------------
   6. models/psbt_parser.py
   --------------------------------------------------------------------------------------------------------------------- */
const SS_PSBT_OPCODES = {OP_RETURN: 106, OP_PUSHDATA1: 76};

function ssPsbtPolicyEq(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (ka.join() !== kb.join()) return false;
  for (const k of ka) {
    if (Array.isArray(a[k]) || Array.isArray(b[k])) {
      if (!Array.isArray(a[k]) || !Array.isArray(b[k]) || a[k].length !== b[k].length || a[k].some((x, i) => x !== b[k][i])) return false;
    } else if (a[k] !== b[k]) return false;
  }
  return true;
}

class SSPSBTParser {
  // SIM: Python parses inside __init__; the crypto here is async, so views call `await SSPSBTParser.create(...)`.
  constructor(p, seed, network = SSSettingsConstants.MAINNET) {
    this.psbt = p;
    this.seed = seed;
    this.network = network;
    this.policy = null;
    this.spend_amount = 0;
    this.change_amount = 0;
    this.change_data = [];
    this.fee_amount = 0;
    this.input_amount = 0;
    this.num_inputs = 0;
    this.destination_addresses = [];
    this.destination_amounts = [];
    this.op_return_data = null;
    this.root = null;
  }
  static async create(p, seed, network = SSSettingsConstants.MAINNET) {
    const parser = new SSPSBTParser(p, seed, network);
    if (parser.seed !== null && parser.seed !== undefined) await parser.parse();
    return parser;
  }

  get_change_data(change_num) {
    if (change_num < this.change_data.length) return this.change_data[change_num];
    return undefined;
  }
  get num_change_outputs() { return this.change_data.length; }
  // Multisig psbts will have "m" and "n" defined in policy
  get is_multisig() { return "m" in this.policy; }
  get num_destinations() { return this.destination_addresses.length; }

  async _set_root() {
    await this.seed._ready;
    this.root = await SSPsbtHDKey.from_seed(this.seed.seed_bytes);
  }

  async parse() {
    if (this.psbt === null || this.psbt === undefined) return false;
    if (!this.seed) return false;
    await this._set_root();
    // Try to fix missing fingerprints before parsing
    await this._fill_missing_fingerprints();
    let rt = await this._parse_inputs();
    if (rt === false) return false;
    rt = await this._parse_outputs();
    if (rt === false) return false;
    return true;
  }

  async _parse_inputs() {
    this.input_amount = 0;
    this.num_inputs = this.psbt.inputs.length;
    for (const inp of this.psbt.inputs) {
      let script_pubkey;
      if (inp.witness_utxo) {
        this.input_amount += Number(inp.witness_utxo.value);
        script_pubkey = inp.witness_utxo.script_pubkey;
      } else if (inp.non_witness_utxo) {
        this.input_amount += Number(inp.utxo.value);
        script_pubkey = inp.script_pubkey;
      } else {
        throw new Error("local variable 'script_pubkey' referenced before assignment");
      }
      const inp_policy = await SSPSBTParser._get_policy(inp, script_pubkey, this.psbt.xpubs);
      if (this.policy === null) this.policy = inp_policy;
      else if (!ssPsbtPolicyEq(this.policy, inp_policy)) throw new Error("Mixed inputs in the transaction");
    }
  }

  async _parse_outputs() {
    this.spend_amount = 0;
    this.change_amount = 0;
    this.change_data = [];
    this.fee_amount = 0;
    this.destination_addresses = [];
    this.destination_amounts = [];
    const embit_network = SSSettingsConstants.map_network_to_embit(this.network);
    const vout = this.psbt.tx.vout;
    for (let i = 0; i < this.psbt.outputs.length; i++) {
      const out = this.psbt.outputs[i], spk = vout[i].script_pubkey;
      const out_policy = await SSPSBTParser._get_policy(out, spk, this.psbt.xpubs);
      let is_change = false;

      // if policy is the same - probably change
      if (ssPsbtPolicyEq(out_policy, this.policy)) {
        // double-check that it's change: we already checked in get_cosigners and parse_multisig that pubkeys are
        // generated from cosigners, and witness script is corresponding multisig, so we only need to check that
        // scriptpubkey is generated from witness script

        // empty script by default
        let sc = new Uint8Array(0);
        const type = this.policy["type"];
        // if older multisig, just use existing script
        if (type === "p2sh") sc = out.redeem_script ? await ssPsbtP2sh(out.redeem_script) : new Uint8Array(0);

        if (type === "p2wsh") {
          // multisig, we know witness script
          sc = out.witness_script ? await ssPsbtP2wsh(out.witness_script) : new Uint8Array(0);
        } else if (type === "p2sh-p2wsh") {
          sc = out.witness_script ? await ssPsbtP2sh(await ssPsbtP2wsh(out.witness_script)) : new Uint8Array(0);
        } else if (type === "p2sh") {
          // Arbitrary p2sh; includes pre-segwit multisig (m/45')
          sc = out.redeem_script ? await ssPsbtP2sh(out.redeem_script) : new Uint8Array(0);
        } else if (type && type.includes("pkh")) {
          // single-sig
          let my_pubkey = null;
          // should be one or zero for single-key addresses
          if (out.bip32_derivations.length > 0) {
            const der = out.bip32_derivations[0].der.derivation;
            my_pubkey = (await this.root.derive(der)).pub;
          }
          if (type === "p2pkh" && my_pubkey !== null) sc = await ssPsbtP2pkh(my_pubkey);
          else if (type === "p2sh-p2wpkh" && my_pubkey !== null) sc = await ssPsbtP2sh(await ssPsbtP2wpkh(my_pubkey));
          else if (type === "p2wpkh" && my_pubkey !== null) sc = await ssPsbtP2wpkh(my_pubkey);
          if (ssPsbtEq(sc, spk)) is_change = true;
        } else if (type && type.includes("p2tr")) {
          let my_pubkey = null;
          // should have one or zero derivations for single-key addresses
          if (out.taproot_bip32_derivations.length > 0) {
            // TODO (SeedSigner): Support keys in taptree leaves
            const der = out.taproot_bip32_derivations[0].der.derivation;
            my_pubkey = (await this.root.derive(der)).pub;
            sc = await ssPsbtP2tr(my_pubkey);
          }
          if (ssPsbtEq(sc, spk)) is_change = true;
        }
        if (ssPsbtEq(sc, spk)) is_change = true;
      }

      if (spk[0] === SS_PSBT_OPCODES.OP_RETURN) {
        // The data is written as: OP_RETURN + OP_PUSHDATA1 + len(payload) + payload
        this.op_return_data = spk.slice(3);
      } else if (is_change) {
        const addr = await ssPsbtScriptAddress(spk, embit_network);
        const fingerprints = [], derivation_paths = [];
        // extract info from non-taproot outputs
        for (const d of out.bip32_derivations) {
          fingerprints.push(hex(d.der.fingerprint));
          derivation_paths.push(ssPsbtPathToStr(d.der.derivation));
        }
        // extract info from taproot outputs
        for (const d of out.taproot_bip32_derivations) {
          fingerprints.push(hex(d.der.fingerprint));
          derivation_paths.push(ssPsbtPathToStr(d.der.derivation));
        }
        this.change_data.push({
          output_index: i,
          address: addr,
          amount: Number(vout[i].value),
          fingerprint: fingerprints,
          derivation_path: derivation_paths,
        });
        this.change_amount += Number(vout[i].value);
      } else {
        const addr = await ssPsbtScriptAddress(spk, embit_network);
        this.destination_addresses.push(addr);
        this.destination_amounts.push(Number(vout[i].value));
        this.spend_amount += Number(vout[i].value);
      }
    }
    this.fee_amount = Number(this.psbt.fee());
    return true;
  }

  static trim(tx) {
    const trimmed_psbt = SSPSBT.from_tx(tx.tx);
    tx.inputs.forEach((inp, i) => {
      if (inp.final_scriptwitness) {
        // Taproot sign; trim to only final_scriptwitness. From BIP-371 and BIP-174, once final script witness is
        // populated it contains all necessary signatures
        trimmed_psbt.inputs[i].final_scriptwitness = inp.final_scriptwitness;
      } else {
        trimmed_psbt.inputs[i].partial_sigs = inp.partial_sigs;
      }
    });
    return trimmed_psbt;
  }

  static sig_count(tx) {
    let cnt = 0;
    for (const inp of tx.inputs) {
      if (inp.final_scriptwitness !== null) cnt += 1;   // Taproot sign
      else cnt += inp.partial_sigs.length;
    }
    return cnt;
  }

  // Parse scope and get policy
  static async _get_policy(scope, scriptpubkey, xpubs) {
    // we don't know the policy yet, let's parse it
    let script_type = ssPsbtScriptType(scriptpubkey);
    // p2sh can be either legacy multisig, or nested segwit multisig or nested segwit singlesig
    if (script_type === "p2sh") {
      if (scope.witness_script) script_type = "p2sh-p2wsh";
      else if (scope.redeem_script && ssPsbtScriptType(scope.redeem_script) === "p2wpkh") script_type = "p2sh-p2wpkh";
    }
    const policy = {type: script_type};

    // expected multisig
    let script = null;
    if (script_type) {
      if (script_type.includes("p2wsh") && scope.witness_script) script = scope.witness_script;
      else if (script_type === "p2sh" && scope.redeem_script) script = scope.redeem_script;

      if (script !== null) {
        const [m, n, pubkeys] = SSPSBTParser._parse_multisig(script);
        // check pubkeys are derived from cosigners
        try {
          const cosigners = await SSPSBTParser._get_cosigners(pubkeys, scope.bip32_derivations, xpubs);
          Object.assign(policy, {m, n, cosigners});
        } catch (e) {
          Object.assign(policy, {m, n});
        }
      }
    }
    return policy;
  }

  // Takes a script and extracts m, n and pubkeys from it: OP_m <len:pubkey> ... <len:pubkey> OP_n OP_CHECKMULTISIG
  static _parse_multisig(sc) {
    if (sc.length < 37 || sc[sc.length - 1] !== 0xae) throw new Error("Not a multisig script");
    const m = sc[0] - 0x50;
    if (m < 1 || m > 16) throw new Error("Invalid multisig script");
    const n = sc[sc.length - 2] - 0x50;
    if (n < m || n > 16) throw new Error("Invalid multisig script");
    let pos = 1;
    const pubkeys = [];
    for (let i = 0; i < n; i++) {
      if (sc[pos] !== 0x21) throw new Error("Invlid pubkey");
      const pub = sc.slice(pos + 1, pos + 34);
      if (pub.length !== 33) throw new Error("Invlid pubkey");
      pointFromPub(pub);
      pubkeys.push(pub);
      pos += 34;
    }
    // check that nothing left
    if (sc.length - pos !== 2) throw new Error("Invalid multisig script");
    return [m, n, pubkeys];
  }

  // Returns xpubs used to derive pubkeys using global xpub field from psbt
  static async _get_cosigners(pubkeys, derivations, xpubs) {
    const cosigners = [];
    for (const pubkey of pubkeys) {
      const d = derivations.find((x) => ssPsbtEq(x.pub, pubkey));
      if (!d) throw new Error("Missing derivation");
      const der = d.der;
      for (const x of xpubs) {
        const origin_der = x.der;
        // check fingerprint
        if (ssPsbtEq(origin_der.fingerprint, der.fingerprint)) {
          // check derivation - last two indexes give pub from xpub
          const base = der.derivation.slice(0, -2);
          if (origin_der.derivation.length === base.length && origin_der.derivation.every((v, j) => v === base[j])) {
            // check that it derives to pubkey actually
            let pub = x.key.slice(45, 78), chain = x.key.slice(13, 45);
            let ok = true;
            for (const i of der.derivation.slice(-2)) {
              if (i >= SS_PSBT_HARDENED) { ok = false; break; }
              [pub, chain] = await ckdPub(pub, chain, i);
            }
            if (ok && ssPsbtEq(pub, pubkey)) {
              // append strings so they can be sorted and compared
              cosigners.push(await base58check(x.key));
              break;
            }
          }
        }
      }
    }
    if (cosigners.length !== pubkeys.length) throw new Error("Can't get all cosigners");
    return cosigners.sort();
  }

  // Extracts the fingerprint from each input's derivation path.
  static get_input_fingerprints(psbt) {
    const fingerprints = new Set();
    for (const input of psbt.inputs) {
      for (const d of input.bip32_derivations) fingerprints.add(hex(d.der.fingerprint));
      for (const d of input.taproot_bip32_derivations) {
        // TODO (SeedSigner): Support spends from leaves; depends on support in embit
        if (d.leaf_hashes.length > 0) throw new Error("Signing keyspends from within a taptree not yet implemented");
        fingerprints.add(hex(d.der.fingerprint));
      }
    }
    return Array.from(fingerprints);
  }

  // Extracts the fingerprint from each psbt input utxo. Returns True if any match the current seed.
  static async has_matching_input_fingerprint(psbt, seed, network = SSSettingsConstants.MAINNET) {
    const seed_fingerprint = await seed.get_fingerprint(network);
    let root = null;
    // Check fingerprint match with missing fingerprint fallback
    const check_fingerprint_match = async (public_key, derivation_path_obj) => {
      // If exact fingerprint match
      if (hex(derivation_path_obj.fingerprint) === seed_fingerprint) return true;
      // Missing fingerprint fallback
      if (ssPsbtEq(derivation_path_obj.fingerprint, [0, 0, 0, 0])) {
        try {
          if (!root) { await seed._ready; root = await SSPsbtHDKey.from_seed(seed.seed_bytes); }
          const derived_key = await root.derive(derivation_path_obj.derivation);
          const pk = public_key.length === 32 ? derived_key.xonly() : derived_key.pub;
          return ssPsbtEq(pk, public_key);   // Public keys match
        } catch (e) {
          console.debug("Fingerprint fallback derive failed:", e);
        }
      }
      return false;
    };
    try {
      // Check all derivations in all inputs
      for (const input of psbt.inputs) {
        // Check regular BIP32 derivations
        for (const d of input.bip32_derivations) if (await check_fingerprint_match(d.pub, d.der)) return true;
        // Check Taproot derivations
        for (const d of input.taproot_bip32_derivations) if (await check_fingerprint_match(d.pub, d.der)) return true;
      }
      return false;
    } finally {
      if (root) root.wipe();
    }
  }

  async verify_multisig_output(descriptor, change_num) {
    const change_data = this.get_change_data(change_num);
    const i = change_data["output_index"];
    const output = this.psbt.outputs[i];
    return descriptor.owns(output);
  }

  // Fix for when fingerprint is missing (defaults to all zeros): fill the signing seed's fingerprint in for every
  // derivation whose public key this seed really derives (see SeedSigner issue 359).
  async _fill_missing_fingerprints() {
    if (!this.root) return 0;
    const signing_seed_fingerprint = this.root.my_fingerprint;   // root.child(0).fingerprint
    const updated = async (public_key, d) => {
      if (!ssPsbtEq(d.fingerprint, [0, 0, 0, 0])) return null;
      const derived_key = await this.root.derive(d.derivation);
      const pk = public_key.length === 32 ? derived_key.xonly() : derived_key.pub;
      if (ssPsbtEq(pk, public_key)) return {fingerprint: Uint8Array.from(signing_seed_fingerprint), derivation: d.derivation};
      return null;
    };
    const fill_scope = async (scope) => {
      for (const d of scope.bip32_derivations) { const n = await updated(d.pub, d.der); if (n) d.der = n; }
      for (const d of scope.taproot_bip32_derivations) { const n = await updated(d.pub, d.der); if (n) d.der = n; }
    };
    for (const inp of this.psbt.inputs) await fill_scope(inp);
    for (const out of this.psbt.outputs) await fill_scope(out);
  }
}


/* ---------------------------------------------------------------------------------------------------------------------
   7. models/encode_qr.py: UrPsbtQrEncoder
   --------------------------------------------------------------------------------------------------------------------- */
class SSUrPsbtQrEncoder extends SSSeedsBaseFountainQrEncoder {
  constructor(fields = {}) {
    super(ssSeedsFields({psbt: null}, fields));
    // UR("crypto-psbt", UR_PSBT(psbt.serialize()).to_cbor())
    this._ss_set_message("crypto-psbt", CB.bytes(this.psbt.serialize()));
  }
}


/* ---------------------------------------------------------------------------------------------------------------------
   8. gui/screens/psbt_screens.py
   --------------------------------------------------------------------------------------------------------------------- */
// SIM: the Python renders the flow chart (4x) and the transaction math (2x) supersampled, then shrinks them with LANCZOS
// and sharpens. Here the drawing keeps the same supersampled coordinates and font sizes, but its canvas already has the
// screen's device resolution (as the engine's TextArea does), so no shrinking or sharpening is needed.
function ssPsbtSupersampledImage(mode, size, color, ssf) {
  const keep = SS_SCALE;
  SS_SCALE = keep / ssf;
  try { return SSImage.new(mode, size, color); } finally { SS_SCALE = keep; }
}
const ssPsbtInt = (x) => Math.trunc(x);

class SSPSBTOverviewScreen extends SSButtonListScreen {
  static get _fields() {
    return {
      spend_amount: 0, change_amount: 0, fee_amount: 0, num_inputs: 0, num_self_transfer_outputs: 0,
      num_change_outputs: 0, destination_addresses: null, has_op_return: false,
    };
  }

  __post_init__() {
    const G = SSGUIConstants;
    // Customize defaults
    this.title = "Review Transaction";
    this.is_bottom_list = true;
    this.button_data = [new SSButtonOption("Review details")];
    super.__post_init__();

    // Prep the headline amount being spent in large callout
    const icon_text_lines_y = this.top_nav.height + G.COMPONENT_PADDING;
    // This is a self-transfer when there are no destination addresses
    const spend_amount = (!this.destination_addresses || this.destination_addresses.length === 0) ? this.change_amount : this.spend_amount;
    this.components.push(new SSBtcAmount({total_sats: spend_amount, screen_y: icon_text_lines_y}));

    // Prep the transaction flow chart
    const last = this.components[this.components.length - 1];
    this.chart_x = 0;
    this.chart_y = last.screen_y + last.height + ssPsbtInt(G.COMPONENT_PADDING / 2);
    const chart_height = this.buttons[0].screen_y - this.chart_y - G.COMPONENT_PADDING;

    // We need to supersample the whole panel so that small/thin elements render clearly.
    const ssf = 4;   // super-sampling factor
    const image = ssPsbtSupersampledImage("RGB", [this.canvas_width * ssf, chart_height * ssf], G.BACKGROUND_COLOR, ssf);
    const draw = SSImageDraw.Draw(image);

    const font_size = G.BODY_FONT_MIN_SIZE * ssf;
    const font = SSFonts.get_font(G.get_body_font_name(), font_size);
    const bb = (t, a) => font.getbbox(t, a ? {anchor: a} : undefined);

    const chart_text_height = bb("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890[]", "lt")[3];
    let vertical_center = ssPsbtInt(image.height / 2);
    // Supersampling renders thin elements poorly if they land on an even line before scaling down
    if (vertical_center % 2 === 1) vertical_center += 1;

    const association_line_color = "#666";
    const association_line_width = 3 * ssf;
    const curve_steps = 4;
    const chart_font_color = "#ddd";

    // First calculate how wide the inputs col will be
    const inputs_column = [];
    if (this.num_inputs === 1) {
      inputs_column.push("1 input");
    } else if (this.num_inputs > 5) {
      inputs_column.push("input 1");
      inputs_column.push("input 2");
      inputs_column.push("[ ... ]");
      inputs_column.push(`input ${this.num_inputs - 1}`);
      inputs_column.push(`input ${this.num_inputs}`);
    } else {
      for (let i = 0; i < this.num_inputs; i++) inputs_column.push(`input ${i + 1}`);
    }

    let max_inputs_text_width = 0;
    for (const input of inputs_column) {
      const [left, top, right, bottom] = bb(input);
      max_inputs_text_width = Math.max(right - left, max_inputs_text_width);
    }

    // Given how wide we want our curves on each side to be...
    const curve_width = 4 * G.COMPONENT_PADDING * ssf;
    // ...and the minimum center divider width...
    let center_bar_width = 2 * G.COMPONENT_PADDING * ssf;
    // We can calculate how wide the destination col can be
    const max_destination_col_width = image.width - (G.EDGE_PADDING * ssf + max_inputs_text_width +
      ssPsbtInt(G.COMPONENT_PADDING * ssf / 4) + curve_width + center_bar_width + curve_width +
      ssPsbtInt(G.COMPONENT_PADDING * ssf / 4) + G.EDGE_PADDING * ssf);

    const dests = this.destination_addresses || [];
    // Now let's maximize the actual destination col by adjusting our addr truncation
    const calculate_destination_col_width = (truncate_at = 0) => {
      const truncate_destination_addr = (addr) => {
        if (addr.length <= truncate_at + "...".length) return addr;   // No point in truncating
        return addr.slice(0, truncate_at) + "...";
      };
      const destination_column = [];
      if (dests.length + this.num_self_transfer_outputs <= 3) {
        for (const addr of dests) destination_column.push(truncate_destination_addr(addr));
        for (let i = 0; i < this.num_self_transfer_outputs; i++) destination_column.push(truncate_destination_addr("self-transfer"));
      } else {
        destination_column.push("recipient 1");
        destination_column.push("[ ... ]");
        destination_column.push(`recipient ${dests.length + this.num_self_transfer_outputs}`);
      }
      destination_column.push("fee");
      if (this.has_op_return) destination_column.push("OP_RETURN");
      for (let i = 0; i < this.num_change_outputs; i++) destination_column.push("change");

      let max_destination_text_width = 0;
      for (const destination of destination_column) {
        const [left, top, right, bottom] = bb(destination);
        max_destination_text_width = Math.max(right - left, max_destination_text_width);
      }
      return [max_destination_text_width, destination_column];
    };

    let destination_text_width, destination_column;
    if (dests.length + this.num_self_transfer_outputs > 3) {
      // We're not going to display any destination addrs so truncation doesn't matter
      [destination_text_width, destination_column] = calculate_destination_col_width();
    } else {
      destination_text_width = null;
      destination_column = null;
      // Steadliy widen out the destination column until we run out of space
      for (let i = 6; i < 14; i++) {
        const [new_width, new_col_text] = calculate_destination_col_width(i);
        if (new_width > max_destination_col_width) {
          if (!destination_text_width) destination_text_width = new_width;
          if (!destination_column) destination_column = new_col_text;
          break;
        }
        destination_text_width = new_width;
        destination_column = new_col_text;
      }
    }

    const destination_col_x = image.width - (destination_text_width + G.EDGE_PADDING * ssf);

    // Now we can finalize our center bar values
    const center_bar_x = G.EDGE_PADDING * ssf + max_inputs_text_width + ssPsbtInt(G.COMPONENT_PADDING * ssf / 4) + curve_width;
    // Center bar stretches to fill any excess width
    center_bar_width = destination_col_x - ssPsbtInt(G.COMPONENT_PADDING * ssf / 4) - curve_width - center_bar_x;

    // Position each input row
    const num_rendered_inputs = inputs_column.length;
    let inputs_y, inputs_y_spacing;
    if (this.num_inputs === 1) {
      inputs_y = vertical_center - ssPsbtInt(chart_text_height / 2);
      inputs_y_spacing = 0;   // Not used
    } else {
      inputs_y = ssPsbtInt((image.height - num_rendered_inputs * chart_text_height) / (num_rendered_inputs + 1));
      inputs_y_spacing = inputs_y + chart_text_height;
    }
    // Don't render lines from an odd number
    if (inputs_y % 2 === 1) inputs_y += 1;
    if (inputs_y_spacing % 2 === 1) inputs_y_spacing += 1;

    const inputs_conjunction_x = center_bar_x;
    const inputs_x = G.EDGE_PADDING * ssf;

    const input_curves = [];
    for (const input of inputs_column) {
      // Calculate right-justified input display
      const [left, top, right, bottom] = bb(input);
      const cur_x = inputs_x + max_inputs_text_width - (right - left);
      draw.text([cur_x, inputs_y], input, {font, fill: chart_font_color, anchor: "lt"});

      // Render the association line to the conjunction point. First calculate a bezier curve to an inflection point
      const start_pt = [inputs_x + max_inputs_text_width + ssPsbtInt(G.COMPONENT_PADDING * ssf / 4), inputs_y + ssPsbtInt(chart_text_height / 2)];
      const conjunction_pt = [inputs_conjunction_x, vertical_center];
      const mid_pt = [ssPsbtInt(start_pt[0] * 0.5 + conjunction_pt[0] * 0.5), ssPsbtInt(start_pt[1] * 0.5 + conjunction_pt[1] * 0.5)];

      let bezier_points;
      if (inputs_column.length === 1) {
        // Use fewer segments for single input straight line
        bezier_points = [start_pt, ssLinearInterp(start_pt, conjunction_pt, 0.33), ssLinearInterp(start_pt, conjunction_pt, 0.66), conjunction_pt];
      } else {
        bezier_points = ssCalcBezierCurve(start_pt, [mid_pt[0], start_pt[1]], mid_pt, curve_steps);
        // We don't need the "final" point as it's repeated below
        bezier_points.pop();
        // Now render the second half after the inflection point
        bezier_points = bezier_points.concat(ssCalcBezierCurve(mid_pt, [mid_pt[0], conjunction_pt[1]], conjunction_pt, curve_steps));
      }
      input_curves.push(bezier_points);

      let prev_pt = bezier_points[0];
      for (const pt of bezier_points.slice(1)) {
        draw.line([prev_pt[0], prev_pt[1], pt[0], pt[1]], {fill: association_line_color, width: association_line_width + 1, joint: "curve"});
        prev_pt = pt;
      }
      inputs_y += inputs_y_spacing;
    }

    // Render center bar
    draw.line([center_bar_x, vertical_center, center_bar_x + center_bar_width, vertical_center], {fill: association_line_color, width: association_line_width});

    // Position each destination
    const num_rendered_destinations = destination_column.length;
    let destination_y, destination_y_spacing;
    if (num_rendered_destinations === 1) {
      destination_y = vertical_center - ssPsbtInt(chart_text_height / 2);
      destination_y_spacing = 0;
    } else {
      destination_y = ssPsbtInt((image.height - num_rendered_destinations * chart_text_height) / (num_rendered_destinations + 1));
      destination_y_spacing = destination_y + chart_text_height;
    }
    // Don't render lines from an odd number
    if (destination_y % 2 === 1) destination_y += 1;
    if (destination_y_spacing % 2 === 1) destination_y_spacing += 1;

    const destination_conjunction_x = center_bar_x + center_bar_width;
    const recipients_text_x = destination_col_x;

    const output_curves = [];
    for (const destination of destination_column) {
      draw.text([recipients_text_x, destination_y], destination, {font, fill: chart_font_color, anchor: "lt"});

      // Render the association line from the conjunction point
      const conjunction_pt = [destination_conjunction_x, vertical_center];
      const end_pt = [conjunction_pt[0] + curve_width, destination_y + ssPsbtInt(chart_text_height / 2)];
      const mid_pt = [ssPsbtInt(conjunction_pt[0] * 0.5 + end_pt[0] * 0.5), ssPsbtInt(conjunction_pt[1] * 0.5 + end_pt[1] * 0.5)];

      let bezier_points = ssCalcBezierCurve(conjunction_pt, [mid_pt[0], conjunction_pt[1]], mid_pt, curve_steps);
      // We don't need the "final" point as it's repeated below
      bezier_points.pop();
      // Now render the second half after the inflection point
      const curve_bias = 1.0;
      bezier_points = bezier_points.concat(ssCalcBezierCurve(mid_pt, [ssPsbtInt(mid_pt[0] * curve_bias + end_pt[0] * (1.0 - curve_bias)), end_pt[1]], end_pt, curve_steps));
      output_curves.push(bezier_points);

      let prev_pt = bezier_points[0];
      for (const pt of bezier_points.slice(1)) {
        draw.line([prev_pt[0], prev_pt[1], pt[0], pt[1]], {fill: association_line_color, width: association_line_width + 1, joint: "curve"});
        prev_pt = pt;
      }
      destination_y += destination_y_spacing;
    }

    // Resize to target and sharpen final image
    const final_image = image.resize([this.canvas_width, chart_height], SSImage.Resampling.LANCZOS);
    this.paste_images.push([final_image.filter(SSImageFilter.SHARPEN), [this.chart_x, this.chart_y]]);

    // Pass input and output curves to the animation thread
    this.threads.push(new SSPSBTOverviewScreen.TxExplorerAnimationThread({
      inputs: input_curves,
      outputs: output_curves,
      supersampling_factor: ssf,
      offset_y: this.chart_y,
      renderer: this.renderer,
    }));
  }
}

SSPSBTOverviewScreen.TxExplorerAnimationThread = class TxExplorerAnimationThread extends SSBaseThread {
  constructor({inputs, outputs, supersampling_factor, offset_y, renderer}) {
    super();
    // Translate the point coords into renderer space
    const ssf = supersampling_factor;
    this.inputs = inputs.map((curve) => curve.map((i) => [ssPsbtInt(i[0] / ssf), ssPsbtInt(i[1] / ssf + offset_y)]));
    this.outputs = outputs.map((curve) => curve.map((i) => [ssPsbtInt(i[0] / ssf), ssPsbtInt(i[1] / ssf + offset_y)]));
    this.renderer = renderer;
  }

  async run() {
    const pulse_color = SSGUIConstants.ACCENT_COLOR;
    const reset_color = "#666";
    const line_width = 3;
    const pulses = [];

    // The center bar needs to be segmented to support animation across it
    const start_pt = this.inputs[0][this.inputs[0].length - 1];
    const end_pt = this.outputs[0][0];
    let center_bar_pts;
    if (start_pt[0] === end_pt[0] && start_pt[1] === end_pt[1]) {
      // In single input the center bar width can be zeroed out. Ugly hack: Insert this line segment that will be skipped otherwise.
      center_bar_pts = [end_pt, this.outputs[0][1]];
    } else {
      center_bar_pts = [start_pt, ssLinearInterp(start_pt, end_pt, 0.25), ssLinearInterp(start_pt, end_pt, 0.50), ssLinearInterp(start_pt, end_pt, 0.75), end_pt];
    }

    const draw_line_segment = (curves, i, j, color) => {
      for (const points of curves) {
        const pt1 = points[i], pt2 = points[j];
        this.renderer.draw.line([pt1[0], pt1[1], pt2[0], pt2[1]], {fill: color, width: line_width});
      }
    };

    let prev_color = reset_color;
    while (this.keep_running) {
      await ssWithLock(this.renderer.lock, () => {
        if (!this.keep_running) return;
        // Only generate one new pulse at a time; trailing "reset_color" pulse erases the most recent pulse.
        if (pulses.length === 0 || (prev_color === pulse_color && pulses[pulses.length - 1][0] === 10)) {
          // Create a new pulse
          if (prev_color === pulse_color) pulses.push([0, reset_color]);
          else pulses.push([0, pulse_color]);
          prev_color = pulses[pulses.length - 1][1];
        }

        // (Python deletes from the list while enumerating it, which skips the pulse after a finished one; same here.)
        for (let pulse_num = 0; pulse_num < pulses.length; pulse_num++) {
          const pulse = pulses[pulse_num];
          const i = pulse[0], color = pulse[1];
          const n_in = this.inputs[0].length, n_c = center_bar_pts.length, n_out = this.outputs[0].length;
          if (i < n_in - 1) {
            // We're in the input curves
            draw_line_segment(this.inputs, i, i + 1, color);
          } else if (i < n_in + n_c - 2) {
            // We're in the center bar
            const index = i - n_in + 1;
            draw_line_segment([center_bar_pts], index, index + 1, color);
          } else if (i < n_in + n_c - 2 + n_out - 1) {
            const index = i - (n_in + n_c - 2);
            draw_line_segment(this.outputs, index, index + 1, color);
          } else {
            // This pulse is done
            pulses.splice(pulse_num, 1);
            continue;
          }
          pulse[0] += 1;
        }
        this.renderer.show_image();
      });
      await ssSleep(0.02);
    }
  }
};


// Python f"{x:,}" / f"{x:,.8f}" for whole sats
function ssPsbtFmtSats(sats) { return _ssCommas(String(Math.trunc(sats))); }
function ssPsbtFmtBtc8(sats) {
  const s = String(Math.trunc(sats)).padStart(9, "0");
  return _ssCommas(s.slice(0, s.length - 8)) + "." + s.slice(s.length - 8);
}

class SSPSBTMathScreen extends SSButtonListScreen {
  static get _fields() {
    return { input_amount: 0, num_inputs: 0, spend_amount: 0, num_recipients: 0, fee_amount: 0, change_amount: 0 };
  }

  __post_init__() {
    const G = SSGUIConstants;
    // Customize defaults
    this.title = "Transaction Math";
    this.button_data = [new SSButtonOption("Review recipients")];
    this.is_bottom_list = true;
    super.__post_init__();

    let denomination;
    if (this.input_amount > 1e6) {
      denomination = "btc";
      this.input_amount = ssPsbtFmtBtc8(this.input_amount);
      this.spend_amount = ssPsbtFmtBtc8(this.spend_amount);
      this.change_amount = ssPsbtFmtBtc8(this.change_amount);
      // Note: We keep the fee denominated in sats; just left pad it so it still lines up properly.
      this.fee_amount = String(Math.trunc(this.fee_amount)).padStart(10, " ");
    } else {
      denomination = "sats";
      this.input_amount = ssPsbtFmtSats(this.input_amount);
      this.spend_amount = ssPsbtFmtSats(this.spend_amount);
      this.fee_amount = ssPsbtFmtSats(this.fee_amount);
      this.change_amount = ssPsbtFmtSats(this.change_amount);
    }

    const longest_amount = Math.max(this.input_amount.length, this.spend_amount.length, this.fee_amount.length, this.change_amount.length);
    this.input_amount = this.input_amount.padStart(longest_amount, " ");
    this.spend_amount = this.spend_amount.padStart(longest_amount, " ");
    this.fee_amount = this.fee_amount.padStart(longest_amount, " ");
    this.change_amount = this.change_amount.padStart(longest_amount, " ");

    // Render the info to temp Image
    const body_width = this.canvas_width - 2 * G.EDGE_PADDING;
    const body_height = this.buttons[0].screen_y - this.top_nav.height - 2 * G.COMPONENT_PADDING;
    const ssf = 2;   // Super-sampling factor
    const image = ssPsbtSupersampledImage("RGB", [body_width * ssf, body_height * ssf], undefined, ssf);
    const draw = SSImageDraw.Draw(image);

    const body_font = SSFonts.get_font(G.get_body_font_name(), G.get_body_font_size() * ssf);
    const fixed_width_font = SSFonts.get_font(G.FIXED_WIDTH_FONT_NAME, (G.get_body_font_size() + 6) * ssf);
    const [l0, t0, r0, b0] = fixed_width_font.getbbox(this.input_amount + "+");
    const digits_width = r0 - l0, digits_height = b0 - t0;

    // Draw each line of the equation
    let cur_y = 0;
    const render_amount = (cur_y, amount_str, info_text, info_text_color = G.BODY_FONT_COLOR) => {
      const secondary_digit_color = "#888";
      const tertiary_digit_color = "#666";
      const digit_group_spacing = 2 * ssf;
      if (denomination === "btc") {
        const display_str = amount_str;
        const main_zone = display_str.slice(0, -6);
        const mid_zone = display_str.slice(-6, -3);
        const end_zone = display_str.slice(-3);
        let [left, top, right, bottom] = fixed_width_font.getbbox(main_zone);
        const main_zone_width = right - left;
        [left, top, right, bottom] = fixed_width_font.getbbox(end_zone);
        const mid_zone_width = right - left;
        draw.text([0, cur_y], main_zone, {font: fixed_width_font, fill: G.BODY_FONT_COLOR});
        draw.text([main_zone_width + digit_group_spacing, cur_y], mid_zone, {font: fixed_width_font, fill: secondary_digit_color});
        draw.text([main_zone_width + digit_group_spacing + mid_zone_width + digit_group_spacing, cur_y], end_zone, {font: fixed_width_font, fill: tertiary_digit_color});
      } else {
        draw.text([0, cur_y], amount_str, {font: fixed_width_font, fill: G.BODY_FONT_COLOR});
      }
      draw.text([digits_width + 3 * digit_group_spacing, cur_y], info_text, {font: body_font, fill: info_text_color});
    };

    render_amount(cur_y, ` ${this.input_amount}`, this.num_inputs === 1 ? "input" : "inputs");

    // spend_amount will be zero on self-transfers; only display when there's an external recipient.
    if (this.num_recipients > 0) {
      cur_y += digits_height + G.BODY_LINE_SPACING * ssf;
      render_amount(cur_y, `-${this.spend_amount}`, this.num_recipients === 1 ? "recipient" : "recipients");
    }

    cur_y += digits_height + G.BODY_LINE_SPACING * ssf;
    render_amount(cur_y, `-${this.fee_amount}`, "fee");

    cur_y += digits_height + G.BODY_LINE_SPACING * ssf;
    draw.line([0, cur_y, image.width, cur_y], {fill: G.BODY_FONT_COLOR, width: 1});
    cur_y += G.BODY_LINE_SPACING * ssf;

    render_amount(cur_y, ` ${this.change_amount}`, `${denomination} change`, "darkorange");   // super-sampling alters the perceived color

    // Resize to target and sharpen final image
    const final_image = image.resize([body_width, body_height], SSImage.Resampling.LANCZOS);
    this.paste_images.push([final_image.filter(SSImageFilter.SHARPEN), [G.EDGE_PADDING, this.top_nav.height + G.COMPONENT_PADDING]]);
  }
}


class SSPSBTAddressDetailsScreen extends SSButtonListScreen {
  static get _fields() { return { address: null, amount: 0 }; }

  __post_init__() {
    const G = SSGUIConstants;
    // Customize defaults
    this.is_bottom_list = true;
    super.__post_init__();

    const center_img_height = this.buttons[0].screen_y - this.top_nav.height;
    // Figuring out how to vertically center the sats and the address is difficult so we just render to a temp image
    // and paste it in place.
    const center_img = SSImage.new("RGB", [this.canvas_width, center_img_height], G.BACKGROUND_COLOR);
    const draw = SSImageDraw.Draw(center_img);

    const btc_amount = new SSBtcAmount({
      image_draw: draw,
      canvas: center_img,
      total_sats: this.amount,
      screen_y: ssPsbtInt(G.COMPONENT_PADDING / 2),
    });
    const formatted_address = new SSFormattedAddress({
      image_draw: draw,
      canvas: center_img,
      width: this.canvas_width - 2 * G.EDGE_PADDING,
      screen_x: G.EDGE_PADDING,
      screen_y: btc_amount.height + G.COMPONENT_PADDING,
      font_size: 24,
      address: this.address,
    });

    // Render each to the temp img we passed in
    btc_amount.render();
    formatted_address.render();

    this.body_img = center_img.crop([0, 0, this.canvas_width, formatted_address.screen_y + formatted_address.height]);
    const body_img_y = this.top_nav.height + ssPsbtInt((center_img_height - this.body_img.height - G.COMPONENT_PADDING) / 2);
    this.paste_images.push([this.body_img, [0, body_img_y]]);
  }
}


class SSPSBTChangeDetailsScreen extends SSButtonListScreen {
  static get _fields() {
    return {
      amount: 0, address: null, is_multisig: false, fingerprint: null, derivation_path: null,
      is_change_derivation_path: true, derivation_path_addr_index: 0, is_change_addr_verified: false,
    };
  }

  __post_init__() {
    const G = SSGUIConstants;
    // Customize defaults
    this.is_bottom_list = true;
    super.__post_init__();

    this.components.push(new SSBtcAmount({total_sats: this.amount, screen_y: this.top_nav.height + G.COMPONENT_PADDING}));
    let last = this.components[this.components.length - 1];
    const screen_y = last.screen_y + last.height + G.COMPONENT_PADDING;

    // Describes the address type (change or receive)
    const addr_type = this.is_change_derivation_path ? "change address" : "receive address";
    // Symbol for index number, e.g. "address #3"
    const index_num_symbol = "#";
    const value_text = `${addr_type} ${index_num_symbol}${this.derivation_path_addr_index}`;
    this.components.push(new SSTextArea({
      text: value_text,
      font_color: G.LABEL_FONT_COLOR,
      font_size: G.LABEL_FONT_SIZE,
      is_text_centered: true,
      screen_x: G.EDGE_PADDING,
      screen_y: screen_y,
    }));

    last = this.components[this.components.length - 1];
    this.components.push(new SSFormattedAddress({
      screen_y: last.screen_y + last.height,
      address: this.address,
      max_lines: 1,
    }));

    if (this.is_change_addr_verified) {
      last = this.components[this.components.length - 1];
      // How much empty space is left between the bottom of the addr and the first button?
      const available_y = this.buttons[0].screen_y - (last.screen_y + last.height);
      this.components.push(new SSIconTextLine({
        icon_name: SSSeedSignerIconConstants.SUCCESS,
        icon_color: G.SUCCESS_COLOR,
        value_text: "Address verified!",
        is_text_centered: true,
        screen_x: G.EDGE_PADDING,
        screen_y: last.screen_y + last.height,
        height: available_y,   // Let the component auto-center vertically
      }));
    }
  }
}


class SSPSBTOpReturnScreen extends SSButtonListScreen {
  static get _fields() { return { op_return_data: null }; }

  __post_init__() {
    const G = SSGUIConstants;
    // Customize defaults
    this.is_bottom_list = true;
    super.__post_init__();

    let text = null;
    try {
      // "strict" is a good enough heuristic to decide if it's human readable
      text = new TextDecoder("utf-8", {fatal: true}).decode(this.op_return_data);
    } catch (e) {
      text = null;
    }
    if (text !== null) {
      // Simple case: display human-readable text
      this.components.push(new SSTextArea({
        text: text,
        font_size: G.get_top_nav_title_font_size(),
        is_text_centered: true,
        screen_y: this.top_nav.height + G.COMPONENT_PADDING,
        height: this.buttons[0].screen_y - this.top_nav.height - 2 * G.COMPONENT_PADDING,
      }));
      return;
    }

    // Contains data that can't be converted to UTF-8; probably encoded and not meant to be human readable.
    const font = SSFonts.get_font(G.FIXED_WIDTH_FONT_NAME, G.get_body_font_size());
    const [left, top, right, bottom] = font.getbbox("X", {anchor: "ls"});
    const chars_per_line = ssPsbtInt((this.canvas_width - 2 * G.EDGE_PADDING) / (right - left));
    const decoded_str = hex(this.op_return_data);
    const num_lines = Math.ceil(decoded_str.length / chars_per_line);
    let t = "";
    for (let i = 0; i < num_lines; i++) t += decoded_str.slice(i * chars_per_line, (i + 1) * chars_per_line) + "\n";
    t = t.slice(0, -1);

    // Shown when displaying OP_RETURN as non-human-readable hexadecimal data
    const label = new SSTextArea({
      text: "raw hex data",
      font_color: G.LABEL_FONT_COLOR,
      font_size: G.LABEL_FONT_SIZE,
      screen_y: this.top_nav.height,
    });
    this.components.push(label);
    this.components.push(new SSTextArea({
      text: t,
      font_name: G.FIXED_WIDTH_FONT_NAME,
      font_size: G.get_body_font_size(),
      screen_y: label.screen_y + label.height + G.COMPONENT_PADDING,
    }));
  }
}


class SSPSBTFinalizeScreen extends SSButtonListScreen {
  __post_init__() {
    const G = SSGUIConstants;
    // Customize defaults
    this.title = "Sign Transaction";
    this.is_bottom_list = true;
    super.__post_init__();

    const icon = new SSIcon({
      icon_name: SSSeedSignerIconConstants.SIGN,
      icon_color: G.INFO_COLOR,
      icon_size: G.ICON_LARGE_BUTTON_SIZE,
      screen_y: this.top_nav.height + G.COMPONENT_PADDING,
    });
    icon.screen_x = ssPsbtInt((this.canvas_width - icon.width) / 2);
    this.components.push(icon);

    this.components.push(new SSTextArea({
      text: "Click to approve this transaction",
      screen_y: icon.screen_y + icon.height + 2 * G.COMPONENT_PADDING,
    }));
  }
}


/* ---------------------------------------------------------------------------------------------------------------------
   9. views/psbt_views.py
   --------------------------------------------------------------------------------------------------------------------- */
// Class-level ButtonOptions (Python class attributes), one object per class and name
const SS_PSBT_OPTS = new Map();
function ssPsbtOpt(key, make) {
  if (!SS_PSBT_OPTS.has(key)) SS_PSBT_OPTS.set(key, make());
  return SS_PSBT_OPTS.get(key);
}

class SSPSBTSelectSeedView extends SSView {
  static get SCAN_SEED() { return ssPsbtOpt("PSBTSelectSeedView.SCAN_SEED", () => new SSButtonOption("Scan a seed", SSSeedSignerIconConstants.QRCODE)); }
  static get TYPE_12WORD() { return ssPsbtOpt("PSBTSelectSeedView.TYPE_12WORD", () => new SSButtonOption("Enter 12-word seed", SSFontAwesomeIconConstants.KEYBOARD)); }
  static get TYPE_24WORD() { return ssPsbtOpt("PSBTSelectSeedView.TYPE_24WORD", () => new SSButtonOption("Enter 24-word seed", SSFontAwesomeIconConstants.KEYBOARD)); }
  static get TYPE_ELECTRUM() { return ssPsbtOpt("PSBTSelectSeedView.TYPE_ELECTRUM", () => new SSButtonOption("Enter Electrum seed", SSFontAwesomeIconConstants.KEYBOARD)); }

  async run() {
    const C = SSPSBTSelectSeedView, SC = SSSettingsConstants;
    const network = this.settings.get_value(SC.SETTING__NETWORK);
    // Note: we can't just autoroute to the PSBT Overview because we might have a multisig where we want to sign with
    // more than one key on this device.
    if (!this.controller.psbt) {
      // Shouldn't be able to get here
      throw new Error("No transaction currently loaded");
    }

    if (this.controller.psbt_seed) {
      if (await SSPSBTParser.has_matching_input_fingerprint(this.controller.psbt, this.controller.psbt_seed, network)) {
        // skip the seed prompt if a seed was previously selected and has matching input fingerprint
        return new SSDestination(SSPSBTOverviewView);
      }
    }

    const seeds = this.controller.storage.seeds;
    const button_data = [];
    for (const seed of seeds) {
      let button_str = await seed.get_fingerprint(network);
      if (!(await SSPSBTParser.has_matching_input_fingerprint(this.controller.psbt, seed, network))) {
        // Doesn't look like this seed can sign the current PSBT
        button_str = `${button_str} (?)`;
      }
      button_data.push(new SSButtonOption(button_str, SSSeedSignerIconConstants.FINGERPRINT));
    }

    button_data.push(C.SCAN_SEED);
    button_data.push(C.TYPE_12WORD);
    button_data.push(C.TYPE_24WORD);
    if (this.settings.get_value(SC.SETTING__ELECTRUM_SEEDS) === SC.OPTION__ENABLED) button_data.push(C.TYPE_ELECTRUM);

    const selected_menu_num = await this.run_screen(SSButtonListScreen, {
      title: "Select Signer",
      is_button_text_centered: false,
      button_data: button_data,
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);

    if (seeds.length > 0 && selected_menu_num < seeds.length) {
      // User selected one of the n seeds
      this.controller.psbt_seed = this.controller.get_seed(selected_menu_num);
      return new SSDestination(SSPSBTOverviewView);
    }

    // The remaining flows are a sub-flow; resume PSBT flow once the seed is loaded.
    this.controller.resume_main_flow = SSController.FLOW__PSBT;

    const sel = button_data[selected_menu_num];
    if (ssEq(sel, C.SCAN_SEED)) {
      return new SSDestination(SSScanSeedQRView);
    } else if (ssEq(sel, C.TYPE_12WORD) || ssEq(sel, C.TYPE_24WORD)) {
      if (ssEq(sel, C.TYPE_12WORD)) this.controller.storage.init_pending_mnemonic(12);
      else this.controller.storage.init_pending_mnemonic(24);
      return new SSDestination(SSSeedMnemonicEntryView);
    } else if (ssEq(sel, C.TYPE_ELECTRUM)) {
      return new SSDestination(SSSeedElectrumMnemonicStartView);
    }
  }
}


class SSPSBTOverviewView extends SSView {
  __post_init__() {
    super.__post_init__();
    this.loading_screen = null;
  }

  // Python __init__ builds the PSBTParser (behind the loading screen); async here, so at the start of run().
  async _ss_init() {
    const c = this.controller;
    if (!c.psbt_parser || c.psbt_parser.seed !== c.psbt_seed) {
      // The PSBTParser takes a while to read the PSBT. Run the loading screen while we wait.
      this.loading_screen = new SSLoadingScreenThread({text: "Parsing PSBT..."});
      this.loading_screen.start();
      try {
        if (c.psbt_parser && c.psbt_parser.root) c.psbt_parser.root.wipe();
        c.psbt_parser = await SSPSBTParser.create(c.psbt, c.psbt_seed, this.settings.get_value(SSSettingsConstants.SETTING__NETWORK));
      } catch (e) {
        this.loading_screen.stop();
        throw e;
      }
    }
  }

  async run() {
    await this._ss_init();
    const psbt_parser = this.controller.psbt_parser;

    // change_data = [{address, amount, fingerprint: [...], derivation_path: [...]}, ...]
    const change_data = psbt_parser.change_data;
    let num_change_outputs = 0, num_self_transfer_outputs = 0;
    for (const change_output of change_data) {
      const parts = change_output["derivation_path"][0].split("/");
      if (parts[parts.length - 2] === "1") num_change_outputs += 1;
      else num_self_transfer_outputs += 1;
    }

    // Everything is set. Stop the loading screen
    if (this.loading_screen) this.loading_screen.stop();

    // Run the overview screen
    const selected_menu_num = await this.run_screen(SSPSBTOverviewScreen, {
      spend_amount: psbt_parser.spend_amount,
      change_amount: psbt_parser.change_amount,
      fee_amount: psbt_parser.fee_amount,
      num_inputs: psbt_parser.num_inputs,
      num_self_transfer_outputs: num_self_transfer_outputs,
      num_change_outputs: num_change_outputs,
      destination_addresses: psbt_parser.destination_addresses,
      has_op_return: psbt_parser.op_return_data !== null,
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) {
      this.controller.psbt_seed = null;
      return new SSDestination(SSBackStackView);
    }

    // expecting p2sh (legacy multisig) and p2pkh to have no policy set; skip change warning and psbt math view
    if (psbt_parser.policy === null) return new SSDestination(SSPSBTUnsupportedScriptTypeWarningView);
    else if (psbt_parser.change_amount === 0) return new SSDestination(SSPSBTNoChangeWarningView);
    return new SSDestination(SSPSBTMathView);
  }
}


class SSPSBTUnsupportedScriptTypeWarningView extends SSView {
  async run() {
    const selected_menu_num = await this.run_screen(SSWarningScreen, {
      status_headline: "Unsupported Script Type!",
      text: "Transaction has unsupported input script type, please verify your change addresses.",
      button_data: [new SSButtonOption("Continue")],
    });
    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);
    // Only one exit point; skip PSBTMathView
    return new SSDestination(SSPSBTAddressDetailsView, {
      view_args: {address_num: 0},
      skip_current_view: true,   // Prevent going BACK to WarningViews
    });
  }
}


class SSPSBTNoChangeWarningView extends SSView {
  async run() {
    const selected_menu_num = await this.run_screen(SSWarningScreen, {
      // User will receive no change back; the inputs to this transaction are fully spent
      status_headline: "Full Spend!",
      text: "This transaction spends its entire input value. No change is coming back to your wallet.",
      button_data: [new SSButtonOption("Continue")],
    });
    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);
    // Only one exit point
    return new SSDestination(SSPSBTMathView, {skip_current_view: true});   // Prevent going BACK to WarningViews
  }
}


class SSPSBTMathView extends SSView {
  // Follows the Overview pictogram. Shows: + total input value, - recipients' value, - fees, = change value
  async run() {
    const psbt_parser = this.controller.psbt_parser;
    if (!psbt_parser) return new SSDestination(SSMainMenuView);   // Should not be able to get here

    const selected_menu_num = await this.run_screen(SSPSBTMathScreen, {
      input_amount: psbt_parser.input_amount,
      num_inputs: psbt_parser.num_inputs,
      spend_amount: psbt_parser.spend_amount,
      num_recipients: psbt_parser.num_destinations,
      fee_amount: psbt_parser.fee_amount,
      change_amount: psbt_parser.change_amount,
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);

    if (psbt_parser.destination_addresses.length > 0) return new SSDestination(SSPSBTAddressDetailsView, {view_args: {address_num: 0}});
    // This is a self-transfer
    return new SSDestination(SSPSBTChangeDetailsView, {view_args: {change_address_num: 0}});
  }
}


class SSPSBTAddressDetailsView extends SSView {
  // Shows the recipient's address and amount they will receive
  static get _fields() { return { address_num: 0 }; }

  async run() {
    const psbt_parser = this.controller.psbt_parser;
    if (!psbt_parser) throw new Error("Routing error");   // Should not be able to get here

    // Future-tense used to indicate that this transaction will send this amount
    let title = "Will Send";
    if (psbt_parser.num_destinations > 1) title += ` (#${this.address_num + 1})`;

    const button_data = [];
    if (this.address_num < psbt_parser.num_destinations - 1) button_data.push(new SSButtonOption("Next recipient"));
    else button_data.push(new SSButtonOption("Next"));   // Short for "Next step"

    const selected_menu_num = await this.run_screen(SSPSBTAddressDetailsScreen, {
      title: title,
      button_data: button_data,
      address: psbt_parser.destination_addresses[this.address_num],
      amount: psbt_parser.destination_amounts[this.address_num],
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);

    if (this.address_num < psbt_parser.destination_addresses.length - 1) {
      // Show the next receive addr
      return new SSDestination(SSPSBTAddressDetailsView, {view_args: {address_num: this.address_num + 1}});
    } else if (psbt_parser.change_amount > 0) {
      // Move on to display change
      return new SSDestination(SSPSBTChangeDetailsView, {view_args: {change_address_num: 0}});
    } else if (psbt_parser.op_return_data) {
      return new SSDestination(SSPSBTOpReturnView);
    }
    // There's no change output to verify. Move on to sign the PSBT.
    return new SSDestination(SSPSBTFinalizeView);
  }
}


class SSPSBTChangeDetailsView extends SSView {
  static get NEXT() { return ssPsbtOpt("PSBTChangeDetailsView.NEXT", () => new SSButtonOption("Next")); }
  static get SKIP_VERIFICATION() { return ssPsbtOpt("PSBTChangeDetailsView.SKIP_VERIFICATION", () => new SSButtonOption("Skip verification")); }
  // (a class attribute that run() relabels for a self-transfer; like the Python, the new label then stays)
  static get VERIFY_MULTISIG() { return ssPsbtOpt("PSBTChangeDetailsView.VERIFY_MULTISIG", () => new SSButtonOption("Verify multisig change")); }
  static get _fields() { return { change_address_num: 0 }; }

  async run() {
    const C = SSPSBTChangeDetailsView, SC = SSSettingsConstants;
    const psbt_parser = this.controller.psbt_parser;
    if (!psbt_parser) return new SSDestination(SSMainMenuView);   // Should not be able to get here

    // Can we verify this change addr?
    const change_data = psbt_parser.get_change_data(this.change_address_num);
    const network = this.settings.get_value(SC.SETTING__NETWORK);

    // Single-sig verification is easy. We expect to find a single fingerprint and derivation path.
    const seed_fingerprint = await this.controller.psbt_seed.get_fingerprint(network);

    if (!change_data["fingerprint"].includes(seed_fingerprint)) {
      // TODO (SeedSigner): Something is wrong with this psbt(?). Reroute to warning?
      return new SSDestination(SSNotYetImplementedView);
    }

    const i = change_data["fingerprint"].indexOf(seed_fingerprint);
    const derivation_path = change_data["derivation_path"][i];
    const parts = derivation_path.split("/");

    // 'm/84h/1h/0h/1/0' would be a change addr while 'm/84h/1h/0h/0/0' is a self-receive
    const is_change_derivation_path = parseInt(parts[parts.length - 2], 10) === 1;
    const derivation_path_addr_index = parseInt(parts[parts.length - 1], 10);

    let title;
    if (is_change_derivation_path) {
      // The amount you're receiving back from the transaction
      title = "Your Change";
    } else {
      title = "Self-Transfer";
      C.VERIFY_MULTISIG.button_label = "Verify multisig addr";
    }

    let is_change_addr_verified = false;
    let button_data;
    if (psbt_parser.is_multisig) {
      // if the known-good multisig descriptor is already onboard:
      if (this.controller.multisig_wallet_descriptor) {
        is_change_addr_verified = await psbt_parser.verify_multisig_output(this.controller.multisig_wallet_descriptor, this.change_address_num);
        button_data = [C.NEXT];
      } else {
        // Have the Screen offer to load in the multisig descriptor.
        button_data = [C.VERIFY_MULTISIG, C.SKIP_VERIFICATION];
      }
    } else {
      // Single sig
      let loading_screen = null;
      try {
        const loading_screen_text = is_change_derivation_path ? "Verifying Change..." : "Verifying Self-Transfer...";
        loading_screen = new SSLoadingScreenThread({text: loading_screen_text});
        loading_screen.start();

        // convert change address to script pubkey to get script type
        const pubkey = psbt_parser.psbt.tx.vout[change_data["output_index"]].script_pubkey;   // (the output's own script)
        const script_type = ssPsbtScriptType(pubkey);

        // extract derivation path to get wallet and change derivation
        const change_path = parts.slice(-2).join("/");
        const wallet_path = parts.slice(0, -2).join("/");

        const xpub = await this.controller.psbt_seed.get_xpub(wallet_path, network);

        // take script type and call script method to generate address from seed / derivation
        const xpub_key = (await xpub.derive(change_path)).key;
        const embit_network = SC.map_network_to_embit(network);
        let calc_address;
        if (script_type === "p2sh") {
          // single sig only so p2sh is always p2sh-p2wpkh
          calc_address = await ssPsbtScriptAddress(await ssPsbtP2sh(await ssPsbtP2wpkh(xpub_key)), embit_network);
        } else {
          // single sig so this handles p2wpkh and p2wpkh (and p2tr in the future)
          const scriptcall = {p2pkh: ssPsbtP2pkh, p2wpkh: ssPsbtP2wpkh, p2tr: ssPsbtP2tr, p2wsh: ssPsbtP2wsh}[script_type];
          if (!scriptcall) throw new Error(`module 'embit.script' has no attribute '${script_type}'`);
          calc_address = await ssPsbtScriptAddress(await scriptcall(xpub_key), embit_network);
        }

        if (change_data["address"] === calc_address) {
          is_change_addr_verified = true;
          button_data = [C.NEXT];
        }
      } finally {
        if (loading_screen) loading_screen.stop();
      }
    }

    if (is_change_addr_verified === false && (!psbt_parser.is_multisig || this.controller.multisig_wallet_descriptor !== null)) {
      return new SSDestination(SSPSBTAddressVerificationFailedView, {
        view_args: {is_change: is_change_derivation_path, is_multisig: psbt_parser.is_multisig},
        clear_history: true,
      });
    }

    const selected_menu_num = await this.run_screen(SSPSBTChangeDetailsScreen, {
      title: title,
      button_data: button_data,
      address: change_data["address"],
      amount: change_data["amount"],
      is_multisig: psbt_parser.is_multisig,
      fingerprint: seed_fingerprint,
      derivation_path: derivation_path,
      is_change_derivation_path: is_change_derivation_path,
      derivation_path_addr_index: derivation_path_addr_index,
      is_change_addr_verified: is_change_addr_verified,
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);

    const sel = button_data[selected_menu_num];
    if (sel === C.NEXT || sel === C.SKIP_VERIFICATION) {
      if (this.change_address_num < psbt_parser.num_change_outputs - 1) {
        return new SSDestination(SSPSBTChangeDetailsView, {view_args: {change_address_num: this.change_address_num + 1}});
      } else if (psbt_parser.op_return_data) {
        return new SSDestination(SSPSBTOpReturnView);
      }
      // There's no more change to verify. Move on to sign the PSBT.
      return new SSDestination(SSPSBTFinalizeView);
    } else if (sel === C.VERIFY_MULTISIG) {
      this.controller.resume_main_flow = SSController.FLOW__PSBT;
      return new SSDestination(SSLoadMultisigWalletDescriptorView);
    }
  }
}


class SSPSBTAddressVerificationFailedView extends SSView {
  static get _fields() { return { is_change: true, is_multisig: false }; }

  async run() {
    const kind = this.is_change ? "change" : "self-transfer";
    let text;
    if (this.is_multisig) text = `Transaction's ${kind} address could not be verified from wallet descriptor.`;
    else text = `Transaction's ${kind} address could not be generated from your seed.`;

    await this.run_screen(SSDireWarningScreen, {
      title: "Suspicious Transaction",
      status_headline: "Address Verification Failed",
      text: text,
      button_data: [new SSButtonOption("Discard transaction")],
      show_back_button: false,
    });

    // We're done with this PSBT. Route back to MainMenuView which always clears all ephemeral data (except in-memory seeds).
    return new SSDestination(SSMainMenuView, {clear_history: true});
  }
}


class SSPSBTOpReturnView extends SSView {
  // Shows the OP_RETURN data
  async run() {
    const psbt_parser = this.controller.psbt_parser;
    if (!psbt_parser) throw new Error("Routing error");   // Should not be able to get here

    const selected_menu_num = await this.run_screen(SSPSBTOpReturnScreen, {
      title: "OP_RETURN",
      button_data: [new SSButtonOption("Next")],
      op_return_data: psbt_parser.op_return_data,
    });

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);
    return new SSDestination(SSPSBTFinalizeView);
  }
}


class SSPSBTFinalizeView extends SSView {
  static get APPROVE_PSBT() { return ssPsbtOpt("PSBTFinalizeView.APPROVE_PSBT", () => new SSButtonOption("Approve transaction")); }

  async run() {
    const C = SSPSBTFinalizeView;
    const psbt_parser = this.controller.psbt_parser;
    const psbt = this.controller.psbt;
    if (!psbt_parser) return new SSDestination(SSMainMenuView);   // Should not be able to get here

    const selected_menu_num = await this.run_screen(SSPSBTFinalizeScreen, {button_data: [C.APPROVE_PSBT]});

    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);

    // Sign PSBT
    const sig_cnt = SSPSBTParser.sig_count(psbt);
    await psbt.sign_with(psbt_parser.root);
    const trimmed_psbt = SSPSBTParser.trim(psbt);

    if (sig_cnt === SSPSBTParser.sig_count(trimmed_psbt)) {
      // Signing failed / didn't do anything
      return new SSDestination(SSPSBTSigningErrorView);
    }
    this.controller.psbt = trimmed_psbt;
    return new SSDestination(SSPSBTSignedQRDisplayView);
  }
}


class SSPSBTSignedQRDisplayView extends SSView {
  async run() {
    const qr_encoder = new SSUrPsbtQrEncoder({
      psbt: this.controller.psbt,
      qr_density: this.settings.get_value(SSSettingsConstants.SETTING__QR_DENSITY),
    });
    await this.run_screen(SSQRDisplayScreen, {qr_encoder: qr_encoder});

    // We're done with this PSBT. Route back to MainMenuView which always clears all ephemeral data (except in-memory seeds).
    return new SSDestination(SSMainMenuView, {clear_history: true});
  }
}


class SSPSBTSigningErrorView extends SSView {
  static get SELECT_DIFF_SEED() { return ssPsbtOpt("PSBTSigningErrorView.SELECT_DIFF_SEED", () => new SSButtonOption("Select different seed")); }

  async run() {
    const C = SSPSBTSigningErrorView;
    const psbt_parser = this.controller.psbt_parser;
    if (!psbt_parser) return new SSDestination(SSMainMenuView);   // Should not be able to get here

    // Just a WarningScreen here; only use DireWarningScreen for true security risks.
    const selected_menu_num = await this.run_screen(SSWarningScreen, {
      title: "Transaction Error",
      status_icon_name: SSSeedSignerIconConstants.WARNING,
      status_headline: "Signing Failed",
      text: "Signing with this seed did not add a valid signature.",
      button_data: [C.SELECT_DIFF_SEED],
    });

    if (selected_menu_num === 0) {
      // clear seed selected for psbt signing since it did not add a valid signature
      this.controller.psbt_seed = null;
      return new SSDestination(SSPSBTSelectSeedView, {clear_history: true});
    }
    if (selected_menu_num === SS_RET_CODE__BACK_BUTTON) return new SSDestination(SSBackStackView);
  }
}


/* ---------------------------------------------------------------------------------------------------------------------
   10. Wiping (CLEAR ALL, auto-clear, END SESSION and closing the box: see ssPageStop in ss_page.js)
   --------------------------------------------------------------------------------------------------------------------- */
const SS_PSBT_SCRUB_CLASSES = () => [SSPSBT, SSPSBTInputScope, SSPSBTOutputScope, SSPSBTParser, SSDescriptor, SSDescriptorKey,
  SSDecodeQR, SSBaseQrDecoder, SSURDecoder, SSSeedsBaseQrEncoder];
// Overwrites the byte arrays of the scanned and signed data (PSBTs, signatures, descriptors, decoder state) and the
// private keys held for signing, then the caller drops the references. Seeds are wiped by ssPageScrubSeed.
function ssPsbtScrub(x, seen = new Set()) {
  if (!x || typeof x !== "object" || seen.has(x)) return;
  seen.add(x);
  if (x instanceof Uint8Array) { x.fill(0); return; }
  if (x instanceof SSPsbtHDKey) { x.wipe(); return; }
  if (typeof SSSeed !== "undefined" && x instanceof SSSeed) return;   // (seeds: ssPageScrubSeed)
  if (Array.isArray(x)) { for (const v of x) ssPsbtScrub(v, seen); return; }
  if (x instanceof Map) { for (const [k, v] of x) { ssPsbtScrub(k, seen); ssPsbtScrub(v, seen); } x.clear(); return; }
  const proto = Object.getPrototypeOf(x);
  const ok = proto === Object.prototype || proto === null || SS_PSBT_SCRUB_CLASSES().some((C) => typeof C === "function" && x instanceof C);
  if (!ok) return;
  for (const k of Object.keys(x)) ssPsbtScrub(x[k], seen);
}
function ssPsbtWipeController(ctl) {
  if (!ctl) return;
  const seen = new Set();
  for (const f of ["psbt", "psbt_parser", "multisig_wallet_descriptor", "sign_message_data", "unverified_address"]) {
    try { ssPsbtScrub(ctl[f], seen); } catch (e) { /* best effort */ }
  }
  // The views still in memory: their scan decoders and QR encoders
  const views = [];
  if (ctl.current_destination && ctl.current_destination.view) views.push(ctl.current_destination.view);
  for (const d of ctl.back_stack || []) if (d && d.view) views.push(d.view);
  for (const v of views) {
    for (const f of ["decoder", "psbt_parser", "signed_message", "addr_verification_thread"]) {
      try { ssPsbtScrub(v[f], seen); } catch (e) { /* best effort */ }
    }
    try { if (v.screen && v.screen.qr_encoder) ssPsbtScrub(v.screen.qr_encoder, seen); } catch (e) { /* best effort */ }
  }
}
