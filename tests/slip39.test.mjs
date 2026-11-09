// SLIP39 shares (v2.9.0): the page's own slip39Parse and slip39Combine against every official test vector
// (tests/fixtures/slip39-vectors.json, a copy of vectors.json from trezor/python-shamir-mnemonic), with each xprv checked by @scure/bip32,
// plus checks of the word list, the checksum, every error message, and round trips with shares made here.
// v2.10.0: shares the page makes from dice (slip39Make), against fixed words from the reference implementation, an independent
// port of python-shamir-mnemonic written here (section 7), and, when tests/vendor/fetch.sh has fetched it, the reference itself.
// Run: node tests/slip39.test.mjs
import { readFileSync } from "node:fs";
import { webcrypto, createHash, createHmac, pbkdf2Sync, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

if(!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = webcrypto;
const subtle = globalThis.crypto.subtle;

const here = path.dirname(fileURLToPath(import.meta.url));
import { loadPage, ready, readHtml } from "./harness.mjs";
const w = await ready(loadPage(readHtml()));
const lib = {SLIP39_WORDS: w.eval("SLIP39_WORDS"), S39_WORD_INDEX: w.eval("S39_WORD_INDEX"), slip39Parse: w.slip39Parse, slip39Combine: w.slip39Combine, s39Polymod: w.s39Polymod, s39Interpolate: w.s39Interpolate, s39Round: w.s39Round, s39Decrypt: w.s39Decrypt, slip39Make: w.slip39Make};

const { HDKey } = await import("@scure/bip32");

const hex = (b) => Buffer.from(b).toString("hex");
let pass = 0, fail = 0;
function check(name, ok, detail){
  if(ok){ pass++; console.log("PASS " + name + (detail ? "  -- " + detail : "")); }
  else { fail++; console.log("FAIL " + name + (detail ? "  -- " + detail : "")); }
}

// ---------- 1. Word list ----------
{
  const fileText = lib.SLIP39_WORDS.join("\n") + "\n";
  const h = createHash("sha256").update(fileText).digest("hex");
  check("word list: 1024 words", lib.SLIP39_WORDS.length === 1024);
  check("word list: SHA-256 of the list as a file matches slip-0039/wordlist.txt", h === "bcc4555340332d169718aed8bf31dd9d5248cb7da6e5d355140ef4f1e601eec3", h);
  check("word list: sorted, unique 4-letter starts, 4-8 lower-case letters",
    lib.SLIP39_WORDS.every((w, i, a) => (i === 0 || a[i - 1] < w) && /^[a-z]{4,8}$/.test(w)) &&
    new Set(lib.SLIP39_WORDS.map(w => w.slice(0, 4))).size === 1024);
}

// ---------- 2. Official vectors ----------
const vecText = readFileSync(path.join(here, "fixtures", "slip39-vectors.json"), "utf8");
console.log("vectors.json SHA-256: " + createHash("sha256").update(vecText).digest("hex"));
const vectors = JSON.parse(vecText);
let vPass = 0, vFail = 0;
for(const [desc, mnemonics, secretHex, xprv] of vectors){
  const r = await lib.slip39Combine(mnemonics, "TREZOR");
  if(secretHex){
    let ok = r.ok && hex(r.masterSecret) === secretHex, detail = r.ok ? hex(r.masterSecret) : r.error;
    if(ok && xprv){
      const got = HDKey.fromMasterSeed(r.masterSecret).privateExtendedKey;
      ok = got === xprv;
      detail += ok ? " / xprv matches" : " / xprv " + got + " != " + xprv;
    }
    check("vector " + desc, ok, detail);
    ok ? vPass++ : vFail++;
  } else {
    check("vector " + desc + " (must fail)", !r.ok, r.ok ? "unexpectedly gave " + hex(r.masterSecret) : r.error.replace(/\n/g, " | "));
    !r.ok ? vPass++ : vFail++;
  }
}
console.log("Official vectors: " + vPass + " of " + vectors.length + " as expected.");

// ---------- 3. A test-only share maker (uses Node randomness; slip39.js itself cannot make shares) ----------
function encodeShare(f, value){
  // f: identifier, extendable, iterationExponent, groupIndex, groupThreshold, groupCount, memberIndex, memberThreshold
  const valueWords = Math.ceil(value.length * 8 / 10), padBits = valueWords * 10 - value.length * 8;
  let bits = "0".repeat(padBits) + Array.from(value, b => b.toString(2).padStart(8, "0")).join("");
  if(f.padding) bits = "1" + bits.slice(1); // force a non-zero padding bit for a negative test
  const idExp = (f.identifier << 5) | ((f.extendable ? 1 : 0) << 4) | f.iterationExponent;
  const p = (f.groupIndex << 16) | ((f.groupThreshold - 1) << 12) | ((f.groupCount - 1) << 8) | (f.memberIndex << 4) | (f.memberThreshold - 1);
  const data = [idExp >> 10, idExp & 1023, p >> 10, p & 1023];
  for(let i = 0; i < bits.length; i += 10) data.push(parseInt(bits.slice(i, i + 10), 2));
  const cs = f.extendable ? "shamir_extendable" : "shamir";
  const pm = lib.s39Polymod([...cs].map(c => c.charCodeAt(0)).concat(data, [0, 0, 0])) ^ 1;
  data.push((pm >> 20) & 1023, (pm >> 10) & 1023, pm & 1023);
  return data.map(i => lib.SLIP39_WORDS[i]).join(" ");
}
const rnd = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
async function hmac256(k, m){
  const key = await subtle.importKey("raw", k, {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", key, m));
}
async function splitSecret(t, n, s){
  if(t === 1) return Array.from({length:n}, (_, i) => ({x:i, y:s}));
  const shares = [];
  for(let i = 0; i < t - 2; i++) shares.push({x:i, y:rnd(s.length)});
  const r = rnd(s.length - 4), d = new Uint8Array(s.length);
  d.set((await hmac256(r, s)).slice(0, 4)); d.set(r, 4);
  const base = shares.concat([{x:254, y:d}, {x:255, y:s}]);
  for(let i = t - 2; i < n; i++) shares.push({x:i, y:lib.s39Interpolate(base, i)});
  return shares;
}
async function encrypt(ms, passphrase, e, id, ext){
  const salt = ext ? new Uint8Array(0) : new Uint8Array([..."shamir"].map(c => c.charCodeAt(0)).concat([id >> 8, id & 255]));
  const pb = new TextEncoder().encode(passphrase), h = ms.length / 2;
  let l = ms.slice(0, h), r = ms.slice(h);
  for(let i = 0; i < 4; i++){
    const f = await lib.s39Round(i, pb, e, salt, r), nx = l.map((b, k) => b ^ f[k]);
    l = r; r = nx;
  }
  const o = new Uint8Array(ms.length); o.set(r); o.set(l, h); return o;
}
// groups: [[T, N], ...]. Returns mnemonics as groups[i][j].
async function makeShares(gt, groups, ms, passphrase, {ext = true, e = 0, id = 1234} = {}){
  const ems = await encrypt(ms, passphrase, e, id, ext);
  const gs = await splitSecret(gt, groups.length, ems), out = [];
  for(let i = 0; i < groups.length; i++){
    const [t, n] = groups[i], ms2 = await splitSecret(t, n, gs[i].y);
    out.push(ms2.map(m => encodeShare({identifier:id, extendable:ext, iterationExponent:e, groupIndex:i, groupThreshold:gt,
      groupCount:groups.length, memberIndex:m.x, memberThreshold:t}, m.y)));
  }
  return out;
}

// ---------- 4. slip39Parse unit checks ----------
{
  const v1 = vectors[0][1][0];
  const r = lib.slip39Parse(v1);
  check("parse: vector 1 share is valid", r.ok && r.share.value.length === 16 && r.share.groupThreshold === 1 && r.share.groupCount === 1 &&
    r.share.memberThreshold === 1 && r.share.memberIndex === 0 && r.share.groupIndex === 0 && r.share.extendable === false,
    r.ok ? JSON.stringify({...r.share, value:hex(r.share.value)}) : r.error);
  const r2 = lib.slip39Parse("  " + v1.toUpperCase().replace(/ /g, " \n\t ") + " ");
  check("parse: upper case and extra spaces/new lines are accepted", r2.ok && hex(r2.share.value) === hex(r.share.value));

  const w = v1.split(" ");
  const typo = w.slice(); typo[2] = "academik";
  let p = lib.slip39Parse(typo.join(" "));
  check("parse: unknown word with a 4-letter match", !p.ok && /Word 3 \("academik"\) is not a SLIP39 word\. Did you mean "academic"\?/.test(p.error), p.error);
  const typo2 = w.slice(); typo2[5] = "rezult"; typo2[7] = "qqqq";
  p = lib.slip39Parse(typo2.join(" "));
  check("parse: two unknown words, one with close words, one with none", !p.ok && /Word 6 \("rezult"\) is not a SLIP39 word\. Close words: [a-z, ]*result/.test(p.error) && /Word 8 \("qqqq"\) is not a SLIP39 word\.$/.test(p.error), p.error);
  const abbr = w.slice(); abbr[3] = "acad";
  p = lib.slip39Parse(abbr.join(" "));
  check("parse: a 4-letter abbreviation is not accepted silently but is suggested", !p.ok && /Word 4 \("acad"\) is not a SLIP39 word\. Did you mean "academic"\?/.test(p.error), p.error);
  p = lib.slip39Parse(w.slice(0, 19).join(" ") + " acxxxxxx");
  check("parse: start-letter suggestions when nothing is close", !p.ok && /Word 20 \("acxxxxxx"\) is not a SLIP39 word\. Words that start like it: academic, acid, acne, acquire, acrobat, activity\.$/.test(p.error), p.error);
  p = lib.slip39Parse("");
  check("parse: empty", !p.ok && p.error === "No words were given.", p.error);
  p = lib.slip39Parse(w.slice(0, 19).join(" "));
  check("parse: 19 words is too short", !p.ok && /only 19 words/.test(p.error), p.error);
  p = lib.slip39Parse(w.concat(["acid"]).join(" "));
  check("parse: 21 words is not a possible length", !p.ok && /21 words is not a possible length\. Check for a missing or extra word/ .test(p.error), p.error);
  p = lib.slip39Parse(vectors[19][1][0].split(" ").concat(["acid"]).join(" "));
  check("parse: 34 words is not a possible length", !p.ok && /34 words is not a possible length\. Check for a missing or extra word/ .test(p.error), p.error);
  const swapped = w.slice(); [swapped[6], swapped[7]] = [swapped[7], swapped[6]];
  p = lib.slip39Parse(swapped.join(" "));
  check("parse: two swapped words fail the checksum", !p.ok && /checksum failed/.test(p.error), p.error);
  p = lib.slip39Parse(vectors[1][1][0]);
  check("parse: vector 2 fails the checksum", !p.ok && /checksum failed/.test(p.error), p.error);
  p = lib.slip39Parse(vectors[2][1][0]);
  check("parse: vector 3 has non-zero padding", !p.ok && /padding bits/.test(p.error), p.error);
  p = lib.slip39Parse(vectors[21][1][0]);
  check("parse: vector 22 (256-bit) has non-zero padding", !p.ok && /padding bits/.test(p.error), p.error);

  const base = {identifier:7, extendable:true, iterationExponent:0, groupIndex:0, groupThreshold:3, groupCount:2, memberIndex:0, memberThreshold:1};
  p = lib.slip39Parse(encodeShare(base, rnd(16)));
  check("parse: group threshold above group count", !p.ok && /3 groups are needed but only 2 exist/.test(p.error), p.error);
  p = lib.slip39Parse(encodeShare({...base, groupThreshold:1, padding:true}, rnd(16)));
  check("parse: made-up share with valid checksum but padding bit set", !p.ok && /padding bits/.test(p.error), p.error);
  p = lib.slip39Parse(encodeShare({...base, groupThreshold:1, extendable:false}, rnd(16)));
  check("parse: non-extendable share made here parses (checksum string \"shamir\")", p.ok && p.share.extendable === false);
  // Flip the extendable bit in word 2: the checksum string changes, so the checksum must fail.
  const good = encodeShare({...base, groupThreshold:1}, rnd(16)).split(" ");
  good[1] = lib.SLIP39_WORDS[lib.S39_WORD_INDEX.get(good[1]) ^ 16];
  p = lib.slip39Parse(good.join(" "));
  check("parse: flipping the extendable flag breaks the checksum", !p.ok && /checksum failed/.test(p.error), p.error);
  for(const n of [16, 18, 20, 32, 64]){
    const s = encodeShare({...base, groupThreshold:1}, rnd(n)), q = lib.slip39Parse(s);
    check("parse: " + (n * 8) + "-bit share of " + s.split(" ").length + " words", q.ok && q.share.value.length === n);
  }
}

// ---------- 5. Passphrase rules ----------
{
  const v = vectors[0];
  let r = await lib.slip39Combine(v[1], "café");
  check("passphrase: non-ASCII is refused", !r.ok && /printable ASCII.*Character 4 is "é"/.test(r.error), r.error);
  r = await lib.slip39Combine(v[1], "TREZOR\n");
  check("passphrase: a new line is refused", !r.ok && /Character 7 is an invisible control character \(U\+000A\)/.test(r.error), r.error);
  r = await lib.slip39Combine(v[1], "TREZOR ");
  check("passphrase: kept as typed (a trailing space gives a different secret)", r.ok && hex(r.masterSecret) !== v[2]);
  r = await lib.slip39Combine(v[1], "trezor");
  check("passphrase: a wrong passphrase still gives a (different) secret, as the spec intends", r.ok && hex(r.masterSecret) !== v[2]);
  r = await lib.slip39Combine(v[1]);
  const r0 = await lib.slip39Combine(v[1], "");
  check("passphrase: missing means empty", r.ok && r0.ok && hex(r.masterSecret) === hex(r0.masterSecret));
  // From python-shamir-mnemonic test_shamir.py: shares made by its version 0.3.0 with passphrase "café".
  // The reference implementation can still decrypt these; slip39Combine refuses the passphrase, as the spec says.
  // Check that the Feistel decryption itself agrees with the reference for such bytes.
  const cafe = "acid fawn academic academic company fridge picture cage pecan glance privacy carpet should public pharmacy eclipse percent python together flavor";
  const ps = lib.slip39Parse(cafe).share;
  const ms = await lib.s39Decrypt(ps.value, new TextEncoder().encode("café"), ps.iterationExponent, ps.identifier, ps.extendable);
  check("passphrase: decryption core matches the reference's \"café\" share (ABCDEFGHIJKLMNOP)", new TextDecoder().decode(ms) === "ABCDEFGHIJKLMNOP");
  r = await lib.slip39Combine([cafe], "café");
  check("passphrase: slip39Combine refuses that \"café\" share's passphrase", !r.ok, r.error);
}

// ---------- 6. Round trips and combine messages (shares made by the test-only maker above) ----------
{
  const cases = [
    [16, 1, [[1, 1]], "", {ext:true, e:0}],
    [16, 1, [[3, 5]], "TREZOR", {ext:false, e:0, id:32767}],
    [18, 1, [[2, 3]], "TREZOR", {ext:true, e:1}],
    [20, 2, [[2, 3], [1, 1], [3, 5]], " !~", {ext:false, e:0, id:0}],
    [32, 1, [[16, 16]], "TREZOR", {ext:true, e:0}],
    [32, 3, [[2, 2], [1, 1], [2, 4], [3, 3]], "correct horse battery staple", {ext:true, e:2}],
    [64, 2, [[2, 3], [1, 1], [3, 5]], "TREZOR", {ext:true, e:0}],
    [24, 16, Array(16).fill([1, 1]), "TREZOR", {ext:false, e:0}],
  ];
  for(const [n, gt, groups, pp, opt] of cases){
    const ms = rnd(n), all = await makeShares(gt, groups, ms, pp, opt);
    // Pick the last gt groups and the last T shares of each, then shuffle.
    const picks = [];
    for(let g = groups.length - gt; g < groups.length; g++) picks.push(...all[g].slice(-groups[g][0]));
    picks.sort(() => Math.random() - 0.5);
    const r = await lib.slip39Combine(picks, pp);
    check("round trip: " + (n * 8) + " bits, " + gt + " of " + groups.length + " groups " + JSON.stringify(groups) + ", ext=" + (opt.ext ? 1 : 0) + ", e=" + opt.e + ", " + picks[0].split(" ").length + " words",
      r.ok && hex(r.masterSecret) === hex(ms) && r.groups.needed === gt && r.groups.have === gt, r.ok ? "" : r.error);
  }

  const ms = rnd(16), sh = await makeShares(2, [[3, 5], [2, 3], [1, 1]], ms, "TREZOR");
  let r = await lib.slip39Combine([sh[0][0], sh[2][0]], "TREZOR");
  check("combine: \"2 more shares from group 1 are needed\"", !r.ok && /^Not enough shares yet: 2 more shares from group 1 are needed\. This backup needs 2 of its 3 groups to be complete; 1 group is complete now\./.test(r.error) &&
    r.groups.needed === 2 && r.groups.have === 1, r.error + " " + JSON.stringify(r.groups));
  r = await lib.slip39Combine([sh[0][0], sh[0][1], sh[0][2]], "TREZOR");
  check("combine: shares from 1 more group are needed", !r.ok && /shares from 1 more group are needed/.test(r.error), r.error);
  r = await lib.slip39Combine([sh[0][0], sh[1][0]], "TREZOR");
  check("combine: two groups short", !r.ok && /2 more shares from group 1 are needed, and 1 more share from group 2 is needed/.test(r.error) && r.groups.have === 0, r.error);
  r = await lib.slip39Combine([sh[0][0], sh[0][1], sh[0][2], sh[0][3], sh[2][0]], "TREZOR");
  check("combine: too many shares in a group is refused (the spec says exactly T)", !r.ok && /Group 1 needs exactly 3 shares, but 4 were given/.test(r.error), r.error);
  r = await lib.slip39Combine([sh[0][0], sh[0][1], sh[0][2], sh[1][0], sh[1][1], sh[2][0]], "TREZOR");
  check("combine: too many groups is refused (the spec says exactly GT)", !r.ok && /exactly 2 of its 3 groups, but shares from 3 groups/.test(r.error), r.error);
  r = await lib.slip39Combine([sh[0][0], sh[0][1], sh[0][1], sh[2][0]], "TREZOR");
  check("combine: the same share twice counts once", !r.ok && /1 more share from group 1 is needed.*share 3 is the same as share 2, so it was counted once/.test(r.error), r.error);
  r = await lib.slip39Combine(["", sh[0][0], "  ", sh[0][1], sh[0][2], sh[2][0], ""], "TREZOR");
  check("combine: blank entries are skipped", r.ok && hex(r.masterSecret) === hex(ms) && r.identifier === 1234 && r.extendable === true && r.iterationExponent === 0);

  const single = await makeShares(1, [[3, 5]], ms, "");
  r = await lib.slip39Combine([single[0][4]], "");
  check("combine: single group says \"2 more shares are needed\"", !r.ok && /^Not enough shares yet: 2 more shares are needed\. This backup needs 3 shares\./.test(r.error), r.error);

  const other = await makeShares(1, [[3, 5]], ms, "", {id:999});
  r = await lib.slip39Combine([single[0][0], single[0][1], other[0][2]], "");
  check("combine: shares from two backups", !r.ok && /Share 3 is from a different backup than share 1 \(identifier 999, not 1234\)/.test(r.error), r.error);
  const sameId = await makeShares(1, [[3, 5]], rnd(16), "");
  r = await lib.slip39Combine([single[0][0], single[0][1], sameId[0][2]], "");
  check("combine: same identifier, different secret: digest fails", !r.ok && /do not fit together: the built-in check \(digest\) failed/.test(r.error), r.error);
  const ext0 = await makeShares(1, [[3, 5]], ms, "", {ext:false});
  r = await lib.slip39Combine([single[0][0], single[0][1], ext0[0][2]], "");
  check("combine: extendable flag differs", !r.ok && /differ in the extendable flag/.test(r.error), r.error);
  const e1 = await makeShares(1, [[3, 5]], ms, "", {e:1});
  r = await lib.slip39Combine([single[0][0], single[0][1], e1[0][2]], "");
  check("combine: iteration exponent differs", !r.ok && /differ in the iteration exponent \(1 and 0\)/.test(r.error), r.error);
  const long = await makeShares(1, [[3, 5]], rnd(32), "");
  r = await lib.slip39Combine([single[0][0], single[0][1], long[0][2]], "");
  check("combine: different lengths", !r.ok && /Share 3 has 33 words but share 1 has 20/.test(r.error), r.error);
  r = await lib.slip39Combine([single[0][0], "academic acid", single[0][2]], "");
  check("combine: a bad share is named by its position", !r.ok && /^Share 2: This share has only 2 words/.test(r.error), r.error);
  r = await lib.slip39Combine(vectors[10][1], "TREZOR");
  check("combine: vector 11 is refused for its duplicate member index, before any interpolation", !r.ok && /Shares 1 and 2 are both share number 3/.test(r.error), r.error);
  r = await lib.slip39Combine([], "");
  check("combine: no shares", !r.ok && r.error === "No shares were given.", r.error);
}

// ---------- 7. v2.10.0: shares made from dice (slip39Make) ----------
// REF below is a port of python-shamir-mnemonic (read at commit 9fcb9c807c185e06d6269b65f3d795d3c724da3b: shamir.py,
// share.py, cipher.py, rs1024.py) written for this test. It uses none of the page's functions (only its word list, whose
// SHA-256 section 1 checks against the spec's file): its own GF(256) tables, interpolation, RS1024 checksum, and Node's own
// HMAC and PBKDF2. refGenerate is generate_mnemonics with its random source replaced by a function; refCombine is
// combine_mnemonics with its checks.
const REF = (() => {
  const WL = lib.SLIP39_WORDS, IDX = new Map(WL.map((x, i) => [x, i]));
  const EXP = new Array(255).fill(0), LOG = new Array(256).fill(0);
  { let poly = 1; for(let i = 0; i < 255; i++){ EXP[i] = poly; LOG[poly] = i; poly = (poly << 1) ^ poly; if(poly & 0x100) poly ^= 0x11b; } }
  const interpolate = (shares, x) => {
    const xs = new Set(shares.map(s => s.x)); if(xs.size !== shares.length) throw new Error("Share indices must be unique.");
    const hit = shares.find(s => s.x === x); if(hit) return Buffer.from(hit.data);
    const logProd = shares.reduce((a, s) => a + LOG[s.x ^ x], 0), out = Buffer.alloc(shares[0].data.length);
    for(const s of shares){
      const lb = (((logProd - LOG[s.x ^ x] - shares.reduce((a, o) => a + LOG[s.x ^ o.x], 0)) % 255) + 255) % 255;
      for(let k = 0; k < out.length; k++) out[k] ^= s.data[k] ? EXP[(LOG[s.data[k]] + lb) % 255] : 0;
    }
    return out;
  };
  const digest = (r, s) => createHmac("sha256", r).update(s).digest().subarray(0, 4);
  const split = (t, n, secret, rb) => {
    if(t < 1 || t > n || n > 16) throw new Error("bad threshold");
    if(t === 1) return Array.from({length:n}, (_, i) => ({x:i, data:Buffer.from(secret)}));
    const shares = []; for(let i = 0; i < t - 2; i++) shares.push({x:i, data:Buffer.from(rb(secret.length))});
    const r = Buffer.from(rb(secret.length - 4)), base = [...shares, {x:254, data:Buffer.concat([digest(r, secret), r])}, {x:255, data:Buffer.from(secret)}];
    for(let i = t - 2; i < n; i++) shares.push({x:i, data:interpolate(base, i)});
    return shares;
  };
  const recover = (t, shares) => {
    if(t === 1) return shares[0].data;
    const s = interpolate(shares, 255), d = interpolate(shares, 254);
    if(!d.subarray(0, 4).equals(digest(d.subarray(4), s))) throw new Error("Invalid digest of the shared secret.");
    return s;
  };
  const salt = (id, ext) => ext ? Buffer.alloc(0) : Buffer.concat([Buffer.from("shamir"), Buffer.from([id >> 8, id & 255])]);
  const round = (i, pass, e, sl, r) => pbkdf2Sync(Buffer.concat([Buffer.from([i]), pass]), Buffer.concat([sl, r]), (10000 << e) / 4, r.length, "sha256");
  const feistel = (data, pass, e, id, ext, order) => {
    let l = data.subarray(0, data.length / 2), r = data.subarray(data.length / 2);
    for(const i of order){ const f = round(i, pass, e, salt(id, ext), r); const nx = Buffer.from(l.map((b, k) => b ^ f[k])); l = r; r = nx; }
    return Buffer.concat([r, l]);
  };
  const GEN = [0xe0e040, 0x1c1c080, 0x3838100, 0x7070200, 0xe0e0009, 0x1c0c2412, 0x38086c24, 0x3090fc48, 0x21b1f890, 0x3f3f120];
  const polymod = (values) => { let chk = 1; for(const v of values){ const b = chk >> 20; chk = ((chk & 0xfffff) << 10) ^ v; for(let i = 0; i < 10; i++) if((b >> i) & 1) chk ^= GEN[i]; } return chk; };
  const csOf = (ext) => [...(ext ? "shamir_extendable" : "shamir")].map(c => c.charCodeAt(0));
  const toWords = (big, n) => Array.from({length:n}, (_, i) => Number((big >> BigInt(10 * (n - 1 - i))) & 1023n));
  const mnemonic = (sh) => {
    const id = toWords((BigInt(sh.id) << 5n) | (BigInt(sh.ext ? 1 : 0) << 4n) | BigInt(sh.e), 2);
    const p = toWords(BigInt((((((sh.gi << 4) + sh.gt - 1) << 4) + sh.g - 1) << 8) + (sh.mi << 4) + sh.mt - 1), 2);
    const nw = Math.ceil(sh.value.length * 8 / 10), data = [...id, ...p, ...toWords(BigInt("0x" + (Buffer.from(sh.value).toString("hex") || "0")), nw)];
    const pm = polymod([...csOf(sh.ext), ...data, 0, 0, 0]) ^ 1;
    return [...data, (pm >> 20) & 1023, (pm >> 10) & 1023, pm & 1023].map(i => WL[i]).join(" ");
  };
  const parse = (m) => {
    const d = m.trim().split(/\s+/).map(x => { const i = IDX.get(x); if(i === undefined) throw new Error("Invalid mnemonic word " + x); return i; });
    if(d.length < 20) throw new Error("Invalid mnemonic length.");
    const pad = (10 * (d.length - 7)) % 16; if(pad > 8) throw new Error("Invalid mnemonic length.");
    const ie = d[0] * 1024 + d[1], ext = !!((ie >> 4) & 1);
    if(polymod([...csOf(ext), ...d]) !== 1) throw new Error("Invalid mnemonic checksum");
    const p = d[2] * 1024 + d[3], vd = d.slice(4, -3);
    let v = 0n; for(const x of vd) v = v * 1024n + BigInt(x);
    const nb = Math.ceil((10 * vd.length - pad) / 8); if(v >> BigInt(nb * 8)) throw new Error("Invalid mnemonic padding");
    const value = Buffer.from(v.toString(16).padStart(nb * 2, "0"), "hex");
    const sh = {id:ie >> 5, ext, e:ie & 15, gi:p >> 16, gt:((p >> 12) & 15) + 1, g:((p >> 8) & 15) + 1, mi:(p >> 4) & 15, mt:(p & 15) + 1, value};
    if(sh.g < sh.gt) throw new Error("Group threshold cannot be greater than group count.");
    return sh;
  };
  const refGenerate = (gt, groups, ms, pass, ext, e, rb) => {
    if(ms.length * 8 < 128) throw new Error("short");
    if(gt > groups.length) throw new Error("The requested group threshold must not exceed the number of groups.");
    if(groups.some(([t, n]) => t === 1 && n > 1)) throw new Error("Creating multiple member shares with member threshold 1 is not allowed.");
    const idb = rb(2), id = ((idb[0] << 8) | idb[1]) & 0x7fff;
    const ems = feistel(Buffer.from(ms), Buffer.from(pass), e, id, ext, [0, 1, 2, 3]);
    const gs = split(gt, groups.length, ems, rb);
    return groups.map(([t, n], gi) => split(t, n, gs[gi].data, rb).map(m => mnemonic({id, ext, e, gi, gt, g:groups.length, mi:m.x, mt:t, value:m.data})));
  };
  const refCombine = (mnemonics, pass) => {
    const shares = mnemonics.map(parse), f = shares[0];
    if(shares.some(s => s.id !== f.id || s.ext !== f.ext || s.e !== f.e || s.gt !== f.gt || s.g !== f.g)) throw new Error("Invalid set of mnemonics.");
    const groups = new Map();
    for(const s of shares){ if(!groups.has(s.gi)) groups.set(s.gi, []); const g = groups.get(s.gi); if(g.length && g[0].mt !== s.mt) throw new Error("member threshold mismatch"); if(!g.some(o => o.mi === s.mi)) g.push(s); }
    if(groups.size !== f.gt) throw new Error("Wrong number of mnemonic groups.");
    for(const g of groups.values()) if(g.length !== g[0].mt) throw new Error("Wrong number of mnemonics.");
    const ems = recover(f.gt, [...groups].map(([gi, g]) => ({x:gi, data:recover(g[0].mt, g.map(s => ({x:s.mi, data:s.value})))})));
    return feistel(ems, Buffer.from(pass), f.e, f.id, f.ext, [3, 2, 1, 0]);
  };
  // VOIDFORGE's stream, from its description in the page's comment (written again here, not taken from the page).
  const stream = (key, settings) => {
    const msg = Buffer.from("VOIDFORGE SLIP39 shares v1 " + settings); let buf = Buffer.alloc(0), c = 0;
    return (n) => { while(buf.length < n){ const ctr = Buffer.alloc(4); ctr.writeUInt32BE(c++); buf = Buffer.concat([buf, createHmac("sha256", key).update(Buffer.concat([msg, Buffer.from([0]), ctr])).digest()]); } const o = buf.subarray(0, n); buf = buf.subarray(n); return o; };
  };
  return {refGenerate, refCombine, stream, parse};
})();
const settingsOf = (c) => c.bits + " " + c.gt + " " + c.groups.map(g => g[0] + "of" + g[1]).join(",") + " ext" + (c.ext ? 1 : 0) + " e" + c.e +
  (c.passphrase ? " p" + createHash("sha256").update(c.passphrase, "utf8").digest("hex") : "");   // a passphrase is in the label too (v2.10.0 review fix)
const expectFromRef = (c) => { const h = createHash("sha256").update(c.rolls).digest(); return {ms:h.subarray(0, c.bits / 8), groups:REF.refGenerate(c.gt, c.groups, h.subarray(0, c.bits / 8), c.passphrase, c.ext, c.e, REF.stream(h, settingsOf(c)))}; };
const makePage = (c) => lib.slip39Make(c.rolls, {bits:c.bits, groupThreshold:c.gt, groups:c.groups, passphrase:c.passphrase, extendable:c.ext, iterationExponent:c.e});
// A random set that should open the wallet: gt random groups, t random shares of each, shuffled.
const pickSome = (groups, gt, sh) => {
  const gs = [...groups.keys()].sort(() => randomInt(3) - 1).slice(0, gt), out = [];
  for(const g of gs) out.push(...sh[g].map((m, i) => [m, randomInt(1e9)]).sort((a, b) => a[1] - b[1]).slice(0, groups[g][0]).map(x => x[0]));
  return out.sort(() => randomInt(3) - 1);
};
const diceRolls = (n) => Array.from({length:n}, () => 1 + randomInt(6)).join("");
const MAKE_CASES = [];
{
  // Fixed rolls: the words the reference implementation (python-shamir-mnemonic at 9fcb9c8, run through tests/vendor/slip39_ref.py)
  // made from the same rolls and stream, written down here so this check also runs where Python is not installed.
  const KA = {rolls:"123456".repeat(9), bits:128, gt:1, groups:[[2, 3]], passphrase:"", ext:true, e:1};
  const KB = {rolls:"654321".repeat(16) + "654", bits:256, gt:2, groups:[[1, 1], [2, 2]], passphrase:"TREZOR", ext:false, e:0};
  const wantA = [["clogs premium academic acid depend penalty graduate echo pancake echo remind chew lend epidemic unusual jury museum story crystal deal",
    "clogs premium academic agency alien lips guilt evoke demand axle nervous coastal climate cinema tadpole lawsuit floral miracle rival credit",
    "clogs premium academic always carbon thumb axis equation emperor teammate nail cover machine ordinary meaning impact amuse scroll snapshot spew"]];
  const wantB = [["install lunch acrobat easy adult lizard phantom sweater biology peanut afraid true ordinary umbrella syndrome corner leader marathon snake jerky twice airport similar elite simple liquid legend deliver taxi amount overall epidemic genius"],
    ["install lunch beard echo adult response fishing exotic unfair plastic pupal jacket bishop pink industry sugar carpet shame should guard texture finance average ambition prize society alarm tofu sack amazing funding tofu criminal",
     "install lunch beard email august paper gather hybrid inherit triumph weapon firm editor blessing object include duration salt academic painting discuss change lunch forward juice screw dismiss graduate either amount reward language amount"]];
  for(const [c, want, label] of [[KA, wantA, "54 rolls, 2 of 3, no passphrase, defaults (extendable, e=1)"], [KB, wantB, "99 rolls, 256 bits, 2 of 2 groups [1 of 1, 2 of 2], TREZOR, not extendable, e=0"]]){
    const r = await makePage(c), r2 = await makePage(c);
    check("make: known answer, " + label + ": the same words as the reference", r.ok && JSON.stringify(r.groups) === JSON.stringify(want), r.ok ? JSON.stringify(r.groups) : r.error);
    check("make: known answer, " + label + ": made again, the same words (deterministic)", r2.ok && JSON.stringify(r2.groups) === JSON.stringify(r.groups));
    check("make: known answer, " + label + ": the port of the reference makes the same words", JSON.stringify(expectFromRef(c).groups) === JSON.stringify(want));
    check("make: known answer, " + label + ": master secret is SHA-256 of the rolls", r.ok && hex(r.masterSecret) === createHash("sha256").update(c.rolls).digest("hex").slice(0, c.bits / 4));
  }
  check("make: known answer: identifier and settings", (await makePage(KA)).identifier === lib.slip39Parse(wantA[0][0]).share.identifier && (await makePage(KA)).settings === "128 1 2of3 ext1 e1");
  MAKE_CASES.push(KA, KB);
}
{
  // Random rolls and settings: the page's words equal the port's, the port's combine (the reference's rules) and the page's combine
  // both give SHA-256 of the rolls back from a random sufficient set, @scure/bip32 agrees on the wallet, and too few shares fail.
  const shapes = [
    [1, [[1, 1]]], [1, [[2, 2]]], [1, [[2, 3]]], [1, [[3, 5]]], [1, [[5, 5]]], [1, [[16, 16]]], [1, [[7, 16]]],
    [2, [[1, 1], [3, 5], [2, 6]]], [1, [[2, 3], [1, 1]]], [3, [[2, 3], [1, 1], [2, 2], [3, 4]]], [16, Array(16).fill([1, 1])], [2, [[2, 2], [16, 16]]],
  ];
  let k = 0;
  for(const [gt, groups] of shapes){
    for(const bits of [128, 256]){
      const c = {rolls:diceRolls(bits === 128 ? 50 + randomInt(30) : 99 + randomInt(30)), bits, gt, groups,
        passphrase:["", "TREZOR", " !~ correct horse", "x"][k % 4], ext:k % 3 !== 1, e:[0, 1, 0, 2][k % 4]}; k++;
      const r = await makePage(c), x = expectFromRef(c), label = bits + " bits, " + gt + " of " + JSON.stringify(groups) + ", ext=" + (c.ext ? 1 : 0) + ", e=" + c.e + ", passphrase " + JSON.stringify(c.passphrase);
      check("make vs reference port: " + label, r.ok && JSON.stringify(r.groups) === JSON.stringify(x.groups), r.ok ? "" : r.error);
      if(!r.ok) continue;
      const pick = pickSome(groups, gt, r.groups);
      let refOk = false; try { refOk = REF.refCombine(pick, c.passphrase).equals(x.ms); } catch(e) { refOk = false; }
      const pc = await lib.slip39Combine(pick, c.passphrase);
      check("make, combine: " + label + ": " + pick.length + " shares give the secret back (reference port and page)", refOk && pc.ok && hex(pc.masterSecret) === hex(x.ms), pc.error);
      check("make, wallet: " + label + ": the master secret is the BIP32 seed (@scure fingerprint)", hex(r.masterSecret) === hex(x.ms) &&
        HDKey.fromMasterSeed(pc.masterSecret).fingerprint === HDKey.fromMasterSeed(x.ms).fingerprint);
      const less = pick.slice(1);
      if(less.length){
        let refFail = false; try { REF.refCombine(less, c.passphrase); } catch(e) { refFail = true; }
        check("make: " + label + ": one share fewer does not open it (reference port and page)", refFail && !(await lib.slip39Combine(less, c.passphrase)).ok);
      }
      MAKE_CASES.push(c);
    }
  }
}
{
  const base = {rolls:"123456".repeat(9), bits:128, gt:1, groups:[[2, 3]], passphrase:"", ext:true, e:1};
  const err = async (o, re, label) => { const r = await makePage({...base, ...o}); check("make refuses: " + label, !r.ok && re.test(r.error) && r.groups.length === 0 && !r.masterSecret, r.error); };
  await err({rolls:"1".repeat(49)}, /^Roll a die at least 50 times for 20-word shares and type the results \(1 to 6\); 49 so far\./, "49 rolls for 128 bits");
  await err({rolls:"123456".repeat(16) + "12", bits:256}, /^Roll a die at least 99 times for 33-word shares .*98 so far/, "98 rolls for 256 bits");
  await err({rolls:""}, /none typed yet/, "no rolls");
  await err({rolls:"123456".repeat(9) + "7"}, /only be the numbers 1 to 6 \("7" was typed\)/, "a 7");
  await err({rolls:"123456".repeat(9) + "0"}, /\("0" was typed\)/, "a 0");
  await err({groups:[[1, 3]]}, /with 1 share needed, make just 1 share \(1 of 1\)/, "1 of 3 (the spec forbids it)");
  await err({groups:[[4, 3]]}, /from 1 to the number of shares \(3\)/, "4 of 3");
  await err({groups:[[0, 3]]}, /from 1 to the number of shares/, "0 of 3");
  await err({groups:[[2, 17]]}, /1 to 16 shares/, "17 shares");
  await err({groups:Array(17).fill([1, 1])}, /1 to 16 groups/, "17 groups");
  await err({groups:[]}, /1 to 16 groups/, "no groups");
  await err({gt:3, groups:[[1, 1], [2, 2]]}, /groups needed must be from 1 to the number of groups \(2\)/, "3 of 2 groups");
  await err({gt:0}, /groups needed must be from 1/, "0 groups needed");
  await err({bits:192}, /20 words \(128 bits\) or 33 words/, "192 bits");
  await err({e:16}, /iteration exponent must be from 0 to 15/, "exponent 16");
  await err({passphrase:"café"}, /printable ASCII.*Character 4 is "é"/, "a non-ASCII passphrase");
  const spaced = await makePage({...base, rolls:" 123 456\n\t".repeat(9)});
  check("make: spaces and new lines in the rolls are ignored", spaced.ok && JSON.stringify(spaced.groups) === JSON.stringify((await makePage(base)).groups));
  const other = await makePage({...base, groups:[[2, 4]]}), p2 = await makePage({...base, passphrase:"TREZOR"}), a = await makePage(base);
  check("make: other settings give another identifier (so sets are not mixed by mistake)", other.ok && other.identifier !== a.identifier, a.identifier + " / " + other.identifier);
  check("make: same rolls with ext=1 and other settings open the same wallet (an extended set)", hex((await lib.slip39Combine(other.groups[0].slice(1, 3), "")).masterSecret) === hex(a.masterSecret));
  check("make: another passphrase: another identifier and no share in common (no value reused between the two sets), same wallet only with that passphrase", p2.identifier !== a.identifier && p2.groups[0].every(s => !a.groups[0].includes(s)) &&
    hex((await lib.slip39Combine(p2.groups[0].slice(0, 2), "TREZOR")).masterSecret) === hex(a.masterSecret) && hex((await lib.slip39Combine(p2.groups[0].slice(0, 2), "")).masterSecret) !== hex(a.masterSecret));
  const ne = await makePage({...base, ext:false}), ne2 = await makePage({...base, ext:false, groups:[[3, 5]]});
  check("make: not extendable: another identifier and another encrypted secret for other groups", ne.ok && ne2.ok && ne.identifier !== ne2.identifier && lib.slip39Parse(ne.groups[0][0]).share.extendable === false);
  // The self-check: if combining again gives anything else, no shares come out.
  const real = w.slip39Combine;
  w.slip39Combine = async (m, p) => { const r = await real(m, p); if(r.masterSecret) r.masterSecret[0] ^= 1; return r; };
  let r = await lib.slip39Make(base.rolls, {bits:128, groupThreshold:1, groups:[[2, 3]]});
  check("make: a self-check that gives another secret stops it, with no shares", !r.ok && /^The self-check failed, so no shares are shown: combining 2 shares did not give back the secret \(another secret\)\./.test(r.error) && r.groups.length === 0 && !r.masterSecret, r.error);
  w.slip39Combine = async () => ({ok:false, error:"broken", masterSecret:null});
  r = await lib.slip39Make(base.rolls, {bits:128, groupThreshold:1, groups:[[1, 1]]});
  check("make: a self-check that cannot combine stops it (even 1 of 1)", !r.ok && /self-check failed.*\(broken\)/.test(r.error) && r.groups.length === 0, r.error);
  w.slip39Combine = real;
  const realParse = w.slip39Parse;
  w.slip39Parse = (m) => { const p = realParse(m); if(p.ok) p.share.memberThreshold++; return p; };
  r = await lib.slip39Make(base.rolls, {bits:128, groupThreshold:1, groups:[[2, 3]]});
  check("make: a share that does not hold its settings stops it", !r.ok && /share 1 does not hold the settings it was made with/.test(r.error), r.error);
  w.slip39Parse = realParse;
  r = await lib.slip39Make(base.rolls, {bits:128, groupThreshold:1, groups:[[2, 3]]});
  check("make: defaults are extendable and iteration exponent 1 (as the reference)", r.ok && r.settings === "128 1 2of3 ext1 e1" && lib.slip39Parse(r.groups[0][0]).share.iterationExponent === 1 && lib.slip39Parse(r.groups[0][0]).share.extendable === true);
}
// ---------- 8. v2.10.0: the reference implementation itself (python-shamir-mnemonic, pinned and checked by SHA-256) ----------
{
  const src = path.join(here, "vendor", "src", "shamir", "shamir_mnemonic", "shamir.py");
  let py = false; try { execFileSync("python3", ["-c", "1"], {stdio:"ignore"}); py = true; } catch(e) { py = false; }
  if(!existsSync(src) || !py) console.log("REFERENCE: SKIPPED (" + (py ? "run sh tests/vendor/fetch.sh first" : "needs python3") + "; the port in section 7 and the fixed words still ran)");
  else {
    const picks = [];
    for(const c of MAKE_CASES){ const r = await makePage(c); picks.push({c, r, pick:pickSome(c.groups, c.gt, r.groups)}); }
    const job = {make: MAKE_CASES.map(c => ({rolls:c.rolls, bits:c.bits, gt:c.gt, groups:c.groups, passphrase:c.passphrase, ext:c.ext, e:c.e})),
      combine: picks.map(p => ({mnemonics:p.pick, passphrase:p.c.passphrase})).concat(picks.filter(p => p.pick.length > 1).map(p => ({mnemonics:p.pick.slice(1), passphrase:p.c.passphrase})))};
    const out = JSON.parse(execFileSync("python3", ["-I", "-B", path.join(here, "vendor", "slip39_ref.py")], {input:JSON.stringify(job)}).toString());
    let same = 0, comb = 0, short = 0;
    out.make.forEach((m, i) => { if(JSON.stringify(m.groups) === JSON.stringify(picks[i].r.groups)) same++; else console.log("  differs: " + JSON.stringify(MAKE_CASES[i]) + " " + JSON.stringify(m)); });
    picks.forEach((p, i) => { if(out.combine[i].secret === hex(p.r.masterSecret)) comb++; });
    out.combine.slice(picks.length).forEach(x => { if(x.error) short++; });
    const nShort = picks.filter(p => p.pick.length > 1).length;
    check("reference: python-shamir-mnemonic's generate_mnemonics, given the same stream, makes the same words in all " + MAKE_CASES.length + " cases", same === MAKE_CASES.length, same + " of " + MAKE_CASES.length);
    check("reference: python-shamir-mnemonic's combine_mnemonics opens the page's shares in all " + picks.length + " cases", comb === picks.length, comb + " of " + picks.length);
    check("reference: and refuses one share fewer in all " + nShort + " cases", short === nShort, short + " of " + nShort);
  }
}

console.log("\nSummary: " + pass + " passed, " + fail + " failed (official vectors: " + vPass + "/" + vectors.length + ").");
process.exit(fail ? 1 : 0);
