// SLIP39 shares (v2.9.0): the page's own slip39Parse and slip39Combine against every official test vector
// (tests/fixtures/slip39-vectors.json, a copy of vectors.json from trezor/python-shamir-mnemonic), with each xprv checked by @scure/bip32,
// plus checks of the word list, the checksum, every error message, and round trips with shares made here.
// Run: node tests/slip39.test.mjs
import { readFileSync } from "node:fs";
import { webcrypto, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

if(!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = webcrypto;
const subtle = globalThis.crypto.subtle;

const here = path.dirname(fileURLToPath(import.meta.url));
import { loadPage, ready, readHtml } from "./harness.mjs";
const w = await ready(loadPage(readHtml()));
const lib = {SLIP39_WORDS: w.eval("SLIP39_WORDS"), S39_WORD_INDEX: w.eval("S39_WORD_INDEX"), slip39Parse: w.slip39Parse, slip39Combine: w.slip39Combine, s39Polymod: w.s39Polymod, s39Interpolate: w.s39Interpolate, s39Round: w.s39Round, s39Decrypt: w.s39Decrypt};

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
  check("parse: unknown word with a 4-letter match", !p.ok && /Word 3 \("academik"\) is not a SLIP-39 word\. Did you mean "academic"\?/.test(p.error), p.error);
  const typo2 = w.slice(); typo2[5] = "rezult"; typo2[7] = "qqqq";
  p = lib.slip39Parse(typo2.join(" "));
  check("parse: two unknown words, one with close words, one with none", !p.ok && /Word 6 \("rezult"\) is not a SLIP-39 word\. Close words: [a-z, ]*result/.test(p.error) && /Word 8 \("qqqq"\) is not a SLIP-39 word\.$/.test(p.error), p.error);
  const abbr = w.slice(); abbr[3] = "acad";
  p = lib.slip39Parse(abbr.join(" "));
  check("parse: a 4-letter abbreviation is not accepted silently but is suggested", !p.ok && /Word 4 \("acad"\) is not a SLIP-39 word\. Did you mean "academic"\?/.test(p.error), p.error);
  p = lib.slip39Parse(w.slice(0, 19).join(" ") + " acxxxxxx");
  check("parse: start-letter suggestions when nothing is close", !p.ok && /Word 20 \("acxxxxxx"\) is not a SLIP-39 word\. Words that start like it: academic, acid, acne, acquire, acrobat, activity\.$/.test(p.error), p.error);
  p = lib.slip39Parse("");
  check("parse: empty", !p.ok && p.error === "No words were given.", p.error);
  p = lib.slip39Parse(w.slice(0, 19).join(" "));
  check("parse: 19 words is too short", !p.ok && /only 19 words/.test(p.error), p.error);
  p = lib.slip39Parse(w.concat(["acid"]).join(" "));
  check("parse: 21 words is not a possible length", !p.ok && /21 words is not a possible length \(the nearest possible lengths are 20 or 22\)/.test(p.error), p.error);
  p = lib.slip39Parse(vectors[19][1][0].split(" ").concat(["acid"]).join(" "));
  check("parse: 34 words is not a possible length", !p.ok && /34 words is not a possible length \(the nearest possible lengths are 33 or 35\)/.test(p.error), p.error);
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

console.log("\nSummary: " + pass + " passed, " + fail + " failed (official vectors: " + vPass + "/" + vectors.length + ").");
process.exit(fail ? 1 : 0);
