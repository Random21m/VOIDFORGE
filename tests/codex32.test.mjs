// codex32 (BIP93), v2.11.0: the page's c32Parse, c32Combine, c32Interpolate and c32Make against
// 1. every test vector of BIP93 (tests/fixtures/bip93-vectors.json, taken from bip-0093.mediawiki of bitcoin/bips at the pinned
//    commit below; when tests/vendor/fetch.sh has fetched that file, the fixture must equal what is read from it here), with each
//    master xprv checked by @scure/bip32;
// 2. a port of the BIP's own Python written here from the BIP text (section 3; it uses none of the page's code), on random
//    seeds, sets and damaged strings;
// 3. strings made from dice, rebuilt here from the stream's description with that port;
// 4. when tests/vendor/fetch.sh has fetched them: the BIP's Python itself, python-codex32 (the reference implementation in the
//    codex32 project's repository) and Coldcard's codex32 code, through tests/vendor/codex32_ref.py.
// Run: node tests/codex32.test.mjs   (C32_WRITE_FIXTURE=1 writes the fixture again from the fetched BIP text)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadPage, ready, readHtml } from "./harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const w = await ready(loadPage(readHtml()));
const { HDKey } = await import("@scure/bip32");
const hex = (b) => Buffer.from(b).toString("hex");
const sha = (s) => createHash("sha256").update(s).digest();
let pass = 0, fail = 0;
function check(name, ok, detail){
  if(ok){ pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (detail ? "  -- " + detail : "")); }
}

// ---------- 0. The BIP93 test vectors: the fixture, and the pinned BIP text it was taken from ----------
const BIP = {repo: "https://github.com/bitcoin/bips", commit: "a34f044bb8d5cd684d7a742d2f6483c14b719046", file: "bip-0093.mediawiki", sha256: "c847c6e513b64ee6ab10975690757d64a875f77c0e75866a86b733f3985784ec"};
function extract(text){
  const body = text.slice(text.indexOf("==Test Vectors=="), text.indexOf("==Appendix=="));
  const parts = body.split(/^===([^=].*?)===\s*$/m), secs = {};
  for(let i = 1; i < parts.length; i += 2) secs[parts[i].trim()] = parts[i + 1];
  const codes = (s) => [...s.matchAll(/<code>([^<]*)<\/code>/g)].map((m) => m[1]);
  const out = {};
  for(const name of ["Test vector 1", "Test vector 2", "Test vector 3", "Test vector 4", "Test vector 5", "Test vectors 6, 7, and 8"]){
    const s = secs[name];
    out[name] = {strings: codes(s).filter((x) => /^ms1/i.test(x)), seeds: [...s.matchAll(/aster seed \(hex\): <code>([0-9a-f]+)<\/code>/g)].map((m) => m[1]), xprv: codes(s).filter((x) => /^xprv/.test(x))};
  }
  out.invalid = codes(secs["Invalid test vectors"]);
  return out;
}
const FIX = path.join(here, "fixtures", "bip93-vectors.json"), SRC = path.join(here, "vendor", "src", "bips", "bip-0093.mediawiki");
if(process.env.C32_WRITE_FIXTURE){
  const t = readFileSync(SRC); if(hex(sha(t)) !== BIP.sha256) throw new Error("the fetched BIP text is not the pinned one");
  writeFileSync(FIX, JSON.stringify({source: BIP, vectors: extract(t.toString())}, null, 1) + "\n"); console.log("fixture written");
}
const fx = JSON.parse(readFileSync(FIX, "utf8")), V = fx.vectors;
check("fixture: taken from the pinned commit of bitcoin/bips", JSON.stringify(fx.source) === JSON.stringify(BIP));
if(existsSync(SRC)){
  const t = readFileSync(SRC);
  check("fixture: the fetched bip-0093.mediawiki is the pinned file (SHA-256)", hex(sha(t)) === BIP.sha256, hex(sha(t)));
  check("fixture: equals the test vectors read from the BIP text itself", JSON.stringify(extract(t.toString())) === JSON.stringify(V));
} else console.log("BIP TEXT: SKIPPED (run sh tests/vendor/fetch.sh to compare the fixture with the BIP text itself)");
check("fixture: 8 valid vectors, " + V.invalid.length + " invalid strings", V["Test vector 2"].strings.length === 4 && V["Test vector 3"].strings.length === 10 && V["Test vector 4"].strings.length === 17 &&
  V["Test vectors 6, 7, and 8"].strings.length === 3 && V["Test vectors 6, 7, and 8"].seeds.length === 3 && V.invalid.length === 55);

// ---------- 1. The official vectors on the page ----------
const seedOf = (l) => { const r = w.c32Combine(l); return r.ok ? hex(r.seed) : "error: " + r.error; };
const xprvOf = (h) => HDKey.fromMasterSeed(Buffer.from(h, "hex")).privateExtendedKey;
{
  const v1 = V["Test vector 1"];
  check("vector 1: the secret gives its master seed, and the seed gives the BIP's master xprv", seedOf([v1.strings[0]]) === v1.seeds[0] && xprvOf(v1.seeds[0]) === v1.xprv[0]);
  const [A, C, D, S] = V["Test vector 2"].strings, s2 = V["Test vector 2"].seeds[0];
  check("vector 2: any 2 of shares A, C and D (capitals) give the seed; S alone too; the master xprv", [[A, C], [C, A], [A, D], [D, C]].every((l) => seedOf(l) === s2) && seedOf([S]) === s2 && xprvOf(s2) === V["Test vector 2"].xprv[0]);
  const P = (x) => w.c32Parse(x).data, I = (l, ch) => w.c32Text(w.c32Interpolate(l.map(P), w.eval("C32_CHARSET").indexOf(ch)));
  check("vector 2: A and C give the derived share D and the secret S", I([A, C], "d") === D.toLowerCase() && I([A, C], "s") === S.toLowerCase());
  const t3 = V["Test vector 3"].strings, [s, a, c, d, e, f] = t3, s3 = V["Test vector 3"].seeds[0];
  check("vector 3: the secret and shares a and c give the derived shares d, e and f", I([s, a, c], "d") === d && I([s, a, c], "e") === e && I([a, c, s], "f") === f);
  const five = [a, c, d, e, f]; let n3 = 0, all3 = 0;
  for(let i = 0; i < 5; i++) for(let j = i + 1; j < 5; j++) for(let k = j + 1; k < 5; k++){ all3++; if(seedOf([five[k], five[i], five[j]]) === s3) n3++; }
  check("vector 3: every 3 of the 5 shares a, c, d, e, f give the seed (" + n3 + " of " + all3 + "), and the master xprv", n3 === 10 && xprvOf(s3) === V["Test vector 3"].xprv[0]);
  check("vector 3: the four secrets with other padding all give the same seed", t3.slice(6).length === 4 && t3.slice(6).every((x) => seedOf([x]) === s3));
  const t4 = V["Test vector 4"];
  check("vector 4: the 256-bit secret and its 16 variants give the seed; the master xprv", t4.strings.every((x) => seedOf([x]) === t4.seeds[0]) && xprvOf(t4.seeds[0]) === t4.xprv[0]);
  const t5 = V["Test vector 5"];
  check("vector 5: the 127-character secret with the long checksum gives the 512-bit seed; the master xprv", seedOf(t5.strings) === t5.seeds[0] && t5.seeds[0].length === 128 && xprvOf(t5.seeds[0]) === t5.xprv[0]);
  const t6 = V["Test vectors 6, 7, and 8"];
  check("vectors 6, 7 and 8: 160, 192 and 224-bit secrets (54, 61, 67 characters; nonzero padding) give their seeds", t6.strings.every((x, i) => seedOf([x]) === t6.seeds[i]) && t6.strings.map((x) => x.length).join() === "54,61,67");
  const bad = V.invalid.filter((x) => w.c32Parse(x).ok);
  check("invalid vectors: all " + V.invalid.length + " strings are refused", bad.length === 0, bad.join(" "));
  // the page's message for each kind of invalid vector
  const msg = (x) => w.c32Parse(x).error;
  check("messages: a wrong checksum", /^The checksum does not match/.test(msg("ms10fauxsxxxxxxxxxxxxxxxxxxxxxxxxxxve740yyge2ghq")) && /^The checksum does not match/.test(msg("ms10fauxsxxxxxxxxxxxxxxxxxxxxxxxxurfvwmdcmymdufv")));
  check("messages: a length that holds no master seed", /^It has 46 characters/.test(msg("ms10fauxsxxxxxxxxxxxxxxxxxxxxxxxxw0a4c70rfefn4")));
  check("messages: threshold 0 with a share index that is not S", /^Its threshold is 0/.test(msg("ms10fauxxxxxxxxxxxxxxxxxxxxxxxxxxxx0z26tfn0ulw3p")));
  check("messages: a threshold that is not a digit", /^The 4th character, the threshold .* here it is "f"/.test(msg("ms1fauxxxxxxxxxxxxxxxxxxxxxxxxxxxxxda3kr3s0s2swg")));
  check("messages: no MS1 at the start", /^A codex32 seed string starts with MS1 \(this one starts with "0fa"\)/.test(msg("0fauxsxxxxxxxxxxxxxxxxxxxxxxxxxxuqxkk05lyf3x2")) && /starts with MS1/.test(msg("m10fauxsxxxxxxxxxxxxxxxxxxxxxxxxxx8t28z74x8hs4l")));
  check("messages: mixed capitals and small letters", ["Ms10fauxsxxxxxxxxxxxxxxxxxxxxxxxxxxuqxkk05lyf3x2", "ms10fauxsxxxxxxxxxxxxxxxxxxxxxxxxxxUQXKK05LYF3X2"].every((x) => /^It mixes capital and small letters/.test(msg(x))));
  check("messages: a character that is not in the codex32 set, with its place", /^Character 12 \("b"\) is not a codex32 character/.test(msg("ms10testsxxbxxxxxxxxxxxxxxxxxxxxxxx4nzvca9cmczlw")));
  check("messages: Coldcard's CW1 and CX1 strings are named", /Coldcard extension of codex32 .* reads only MS1/.test(msg("CW12W0RDAQQQSYQCYQ5RQWZQFPG9SCRGWPUZVSX8UXYXF6SF")));
  check("spaces are ignored: a string written in groups of 4 reads", seedOf([v1.strings[0].toUpperCase().match(/.{1,4}/g).join(" ")]) === v1.seeds[0]);
  // combining: the sets must match
  const comb = (l) => w.c32Combine(l).error;
  check("combine: shares of two sets are refused", /has the identifier CASH and string 1 has NAME/.test(comb([A, "MS13CASHA320ZYXWVUTSRQPNMLKJHGFEDCA2A8D0ZEHN8A0T"])));
  check("combine: one share twice is refused", /Strings 1 and 2 are both share A/.test(comb([A, A.toLowerCase()])));
  check("combine: too few shares", /^This set needs 3 shares .* 2 are typed\. Type 1 more\./.test(comb([a, c])));
  check("combine: a secret typed with shares", /^String 2 is a secret \(share index S\)/.test(comb([a, s, c])));
  check("combine: a fourth share that fits the first 3 is accepted", w.c32Combine([a, c, d, f]).ok && w.c32Combine([a, c, d, f]).extra === 1);
}

// ---------- 3. A port of BIP93's Python, written here from the BIP text (it uses none of the page's code) ----------
const CS = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x19dc500ce73fde210n, 0x1bfae00def77fe529n, 0x1fbd920fffe7bee52n, 0x1739640bdeee3fdadn, 0x07729a039cfc75f5an];
const GENL = [0x3d59d273535ea62d897n, 0x7a9becb6361c6c51507n, 0x543f9b7e6c38d8a2a0en, 0x0c577eaeccf1990d13cn, 0x1887f74f8dc71b10651n];
const MS32_CONST = 0x10ce0795c2fd1e62an, MS32_LONG_CONST = 0x43381e570bf4798ab26n;
function pm(values, long){ let r = 0x23181b3n; const sh = long ? 70n : 60n, g = long ? GENL : GEN; for(const v of values){ const b = r >> sh; r = ((r & ((1n << sh) - 1n)) << 5n) ^ BigInt(v); for(let i = 0; i < 5; i++) if((b >> BigInt(i)) & 1n) r ^= g[i]; } return r; }
function verifyCs(d){ const n = 5 + d.length; if(n >= 96) return n <= 1023 && pm(d, true) === MS32_LONG_CONST; return n <= 93 && pm(d, false) === MS32_CONST; }
function createCs(d){ const long = 5 + d.length + 13 > 93, n = long ? 15 : 13, p = pm(d.concat(Array(n).fill(0)), long) ^ (long ? MS32_LONG_CONST : MS32_CONST); return Array.from({length: n}, (_, i) => Number((p >> BigInt(5 * (n - 1 - i))) & 31n)); }
const INV = [0, 1, 20, 24, 10, 8, 12, 29, 5, 11, 4, 9, 6, 28, 26, 31, 22, 18, 17, 23, 2, 25, 16, 19, 3, 21, 14, 30, 13, 7, 27, 15];
function mul(a, b){ let r = 0; for(let i = 0; i < 5; i++){ r ^= ((b >> i) & 1) ? a : 0; a *= 2; a ^= a >= 32 ? 41 : 0; } return r; }
function lagrange(l, x){ let n = 1; const c = []; for(const i of l){ n = mul(n, i ^ x); let m = 1; for(const j of l) m = mul(m, (i === j ? x : i) ^ j); c.push(m); } return c.map((i) => mul(n, INV[i])); }
function interp(l, x){ const wt = lagrange(l.map((s) => s[5]), x); return l[0].map((_, i) => l.reduce((n, s, j) => n ^ mul(wt[j], s[i]), 0)); }
function decode(codex){   // ms32_decode
  if([...codex].some((x) => x.charCodeAt(0) < 33 || x.charCodeAt(0) > 126) || (codex.toLowerCase() !== codex && codex.toUpperCase() !== codex)) return null;
  codex = codex.toLowerCase(); const pos = codex.lastIndexOf("1");
  if(pos < 2 || ![48, 54, 61, 67, 74, 127].includes(codex.length)) return null;
  if(![...codex.slice(pos + 1)].every((x) => CS.includes(x))) return null;
  if(codex.slice(0, pos) !== "ms" || /[a-z]/.test(codex[pos + 1]) || (codex[pos + 1] === "0" && codex[pos + 6] !== "s")) return null;
  const data = [...codex.slice(pos + 1)].map((x) => CS.indexOf(x));
  if(!verifyCs(data)) return null;
  return data.slice(0, 5 + data.length < 94 ? -13 : -15);
}
const enc = (d) => "ms1" + d.map((v) => CS[v]).join("");
const toBytes = (vals) => { let acc = 0n, bits = 0; const o = []; for(const v of vals){ acc = (acc << 5n) | BigInt(v); bits += 5; if(bits >= 8){ bits -= 8; o.push(Number((acc >> BigInt(bits)) & 255n)); } } return Buffer.from(o); };
const payload = (seed, pad) => { const bits = [...seed].map((b) => b.toString(2).padStart(8, "0")).join(""), L = Math.ceil(bits.length / 5), all = (bits + pad.toString(2).padStart(L * 5 - bits.length, "0")).slice(0, L * 5); return Array.from({length: L}, (_, i) => parseInt(all.slice(i * 5, i * 5 + 5), 2)); };
{
  // sets that do not belong together (shares made here with the port)
  const [A] = V["Test vector 2"].strings, [, a, c, d] = V["Test vector 3"].strings, mk = (head, L) => { const x = [...head].map((ch) => CS.indexOf(ch)).concat(Array.from({length: L}, () => randomInt(32))); return enc(x.concat(createCs(x))); };
  const comb = (l) => w.c32Combine(l).error;
  check("combine: a fourth share that does not fit the first 3 is refused", /^String 4 \(share F\) is not the share the first 3 give at its index/.test(comb([a, c, d, mk("3cashf", 26)])));
  check("combine: shares of different lengths are refused", /^String 2 has 74 characters and string 1 has 48/.test(comb([A, mk("2namec", 52)])));
  check("combine: shares of another set with the same identifier give a seed, not an error (no checksum can tell; the fingerprint is the check)", w.c32Combine([A, mk("2namec", 26)]).ok);
  // the port itself reproduces the BIP's vectors (so it is a fair judge)
  const v = V["Test vector 3"].strings, P = (x) => decode(x).concat(createCs(decode(x)));
  check("port: reproduces vector 3 (derived d, e, f) and reads vector 5", enc(interp(v.slice(0, 3).map(P), CS.indexOf("d"))) === v[3] && enc(interp(v.slice(0, 3).map(P), CS.indexOf("f"))) === v[5] &&
    toBytes(decode(V["Test vector 5"].strings[0]).slice(6)).toString("hex") === V["Test vector 5"].seeds[0]);
  check("port: refuses every invalid vector", V.invalid.every((x) => decode(x) === null));
  const LENS = [16, 20, 24, 28, 32, 64]; let sets = 0, okSets = 0, cs = 0, interpSame = 0, extraOk = 0;
  for(let t = 0; t < 240; t++){
    const nb = LENS[t % 6], seed = randomBytes(nb), k = 2 + randomInt(8), id = Array.from({length: 4}, () => CS[randomInt(32)]).join(""), L = Math.ceil(nb * 8 / 5), padBits = L * 5 - nb * 8;
    const idx = [...CS].filter((x) => x !== "s").sort(() => randomInt(3) - 1).slice(0, Math.min(31, k + 3 + randomInt(4)));
    const head = (ix) => [CS.indexOf(String(k))].concat([...id].map((x) => CS.indexOf(x)), [CS.indexOf(ix)]);
    const sd = head("s").concat(payload(seed, randomInt(1 << padBits))), S = sd.concat(createCs(sd));
    const rnd = idx.slice(0, k - 1).map((ix) => { const d = head(ix).concat(Array.from({length: L}, () => randomInt(32))); return d.concat(createCs(d)); });
    const all = rnd.concat(idx.slice(k - 1).map((ix) => interp([S].concat(rnd), CS.indexOf(ix))));
    const strs = all.map((d) => (randomInt(2) ? enc(d) : enc(d).toUpperCase()));
    if(w.c32Checksum(sd).join() === createCs(sd).join()) cs++;
    const pick = all.map((_, i) => i).sort(() => randomInt(3) - 1).slice(0, k);
    if(w.c32Interpolate(pick.map((i) => all[i]), CS.indexOf("s")).join() === S.join()) interpSame++;
    sets++; if(seedOf(pick.map((i) => strs[i])) === seed.toString("hex")) okSets++;
    const more = all.map((_, i) => i).filter((i) => !pick.includes(i)); if(more.length && seedOf(pick.map((i) => strs[i]).concat([strs[more[0]]])) === seed.toString("hex")) extraOk++;
  }
  check("random sets (all six seed sizes, k = 2 to 9, up to 13 shares, random padding, capitals or not): the page's checksum equals the port's (" + cs + " of 240)", cs === 240);
  check("random sets: the page's interpolation of k random shares equals the port's secret (" + interpSame + " of 240)", interpSame === 240);
  check("random sets: CHECK AND COMBINE gives the seed from any k shares (" + okSets + " of " + sets + "), and with one share more (" + extraOk + ")", okSets === sets && extraOk === sets);
  // damaged strings: 1 to 8 changed characters are always noticed (the BIP's guarantee), and the page agrees with ms32_decode on any string
  let caught = 0, tries = 0, agree = 0, total = 0;
  const valid = [].concat(...Object.values(V).filter((x) => x.strings).map((x) => x.strings));
  for(let t = 0; t < 1200; t++){
    const base = valid[t % valid.length].toLowerCase(), ch = [...base], n = 1 + (t % 8), places = new Set();
    while(places.size < n) places.add(3 + randomInt(ch.length - 3));
    for(const p of places){ let c; do { c = CS[randomInt(32)]; } while(c === ch[p]); ch[p] = c; }
    const bad = ch.join(""); tries++; if(!w.c32Parse(bad).ok) caught++;
  }
  check("damaged strings: every string with 1 to 8 changed characters is refused (" + caught + " of " + tries + ")", caught === tries);
  const odd = ["ms1", "ms12namea", "MS1" + "Q".repeat(45), "ms10testsxxxxxxxxxxxxxxxxxxxxxxxxxx4nzvca9cmczl", "ms10testsxxxxxxxxxxxxxxxxxxxxxxxxxx4nzvca9cmczlww"];
  for(let t = 0; t < 600; t++){
    const L = [48, 54, 61, 67, 74, 127, 47, 49, 75, 126][t % 10], k = "0234567892"[t % 10], ix = t % 3 ? CS[randomInt(32)] : "s";
    const d = [CS.indexOf(k)].concat(Array.from({length: 4}, () => randomInt(32)), [CS.indexOf(ix)], Array.from({length: Math.max(0, L - 3 - 6 - (L > 100 ? 15 : 13))}, () => randomInt(32)));
    odd.push(t % 2 ? enc(d.concat(createCs(d))) : enc(d.concat(Array(L > 100 ? 15 : 13).fill(0).map(() => randomInt(32)))));
  }
  for(const x of odd.concat(V.invalid, valid)){ total++; if(w.c32Parse(x).ok === (decode(x) !== null)) agree++; }
  check("any string: the page accepts exactly the strings ms32_decode accepts (" + agree + " of " + total + ", valid, invalid and random)", agree === total);
}

// ---------- 4. Strings made from dice (c32Make), rebuilt here from the stream's description with the port ----------
const LABEL = "VOIDFORGE codex32 shares v1 ", ORDER = "acdefghjklmnpqrtuvwxyz023456789";
function rebuild(rolls, bits, k, n){
  const h = sha(rolls), settings = bits + " " + (k ? k + "of" + n : "secret"); let buf = Buffer.alloc(0), c = 0;
  const take = (m) => { while(buf.length < m){ const ctr = Buffer.alloc(4); ctr.writeUInt32BE(c++); buf = Buffer.concat([buf, createHmac("sha256", h).update(Buffer.concat([Buffer.from(LABEL + settings), Buffer.from([0]), ctr])).digest()]); } const o = buf.subarray(0, m); buf = buf.subarray(m); return o; };
  const id = [...take(4)].map((b) => b & 31), head = (ix) => [CS.indexOf(String(k))].concat(id, [ix]);
  const sd = head(16).concat(payload(h.subarray(0, bits / 8), 0)), S = sd.concat(createCs(sd));
  if(!k) return [enc(S)];
  const L = Math.ceil(bits / 5), r = [];
  for(let j = 0; j < k - 1; j++){ const d = head(CS.indexOf(ORDER[j])).concat([...take(L)].map((b) => b & 31)); r.push(d.concat(createCs(d))); }
  const base = [S].concat(r); for(let j = k - 1; j < n; j++) r.push(interp(base, CS.indexOf(ORDER[j])));
  return r.map(enc);
}
const R50 = "123456".repeat(9), R99 = "654321".repeat(16) + "654";
const MAKE = [[R50, 128, 2, 3], [R50, 128, 0, 1], [R99, 256, 0, 1], [R99, 256, 2, 2], [R50, 128, 3, 5], [R99, 256, 9, 9], [R50, 128, 9, 31], [R99, 256, 5, 31], ["3".repeat(50), 128, 4, 7], ["16".repeat(60), 256, 2, 31], [R50 + "1", 128, 2, 3], ["5".repeat(99), 256, 0, 1]];
const made = [];
{
  let same = 0, combos = 0, combosOk = 0;
  for(const [rolls, bits, k, n] of MAKE){
    const r = await w.c32Make(rolls, {bits, k, n}); made.push(r);
    const want = rebuild(rolls, bits, k, n), ms = sha(rolls).subarray(0, bits / 8);
    if(r.ok && JSON.stringify(r.shares) === JSON.stringify(want) && hex(r.masterSeed) === hex(ms) && r.identifier === want[0].slice(4, 8)) same++;
    else console.log("  differs: " + JSON.stringify([rolls.length, bits, k, n]) + " " + (r.error || r.shares[0] + " / " + want[0]));
    // every k of the strings (all of them for small sets, 60 random picks for big ones) give the master seed with the port
    const kk = k || 1, P = want.map((x) => decode(x).concat(createCs(decode(x))));
    const picks = []; if(n <= 7){ const rec = (st, acc) => { if(acc.length === kk){ picks.push(acc); return; } for(let i = st; i < n; i++) rec(i + 1, acc.concat(i)); }; rec(0, []); }
    else for(let t = 0; t < 60; t++) picks.push([...Array(n).keys()].sort(() => randomInt(3) - 1).slice(0, kk));
    for(const p of picks){ combos++; const s = k ? interp(p.map((i) => P[i]), 16) : P[0]; if(s[5] === 16 && verifyCs(s) && toBytes(s.slice(6, s.length - 13)).toString("hex") === hex(ms)) combosOk++; }
  }
  check("make: the page's strings are exactly the ones the port builds from the stream's description, in all " + MAKE.length + " cases (k = 0 to 9, up to 31 shares, 128 and 256 bits)", same === MAKE.length, same + " of " + MAKE.length);
  check("make: every k of the strings give back SHA-256 of the rolls with the port (" + combosOk + " of " + combos + ")", combosOk === combos && combos > 250);
  check("make: a 256-bit secret from 99 fives (the mutation test's known answer)", made[11].shares[0] === "ms107qtvs8am8wv7cyurceavtsz5nn5etn4ejt3wjd4yeyw3tzmahnz28264q7ex38e7gnuxjy");
  check("make: 2-of-3 from 54 fixed rolls (the self-test's known answer)", made[0].shares.join(" ") === "ms12mkznaszh8xu3qpv9ejqsh7wx790takx9j23c8z42fsg9 ms12mkznc42x4k884t89zu64h6gsyjn7fevkwg28w57m4xtg ms12mkzndq34jfhelgg9jxxqhrfwcqw5000ans6we23ggclx");
  check("make: share indexes run a, c, d, ... as BIP93 numbers them, then the digits (31 shares)", made[6].shares.map((x) => x[8]).join("") === ORDER && made[1].shares.length === 1 && made[1].shares[0][8] === "s" && made[1].shares[0][3] === "0");
  check("make: other settings with the same rolls share no random value (identifier, first share)", made[0].identifier !== made[4].identifier && made[0].identifier !== made[1].identifier && made[0].shares[0].slice(9, 30) !== made[4].shares[0].slice(9, 30) && made[0].identifier !== made[10].identifier);
  for(const [rolls, o, re, label] of [["1".repeat(49), {bits: 128, k: 2, n: 3}, /^Roll a die at least 50 times for a 128-bit seed/, "49 rolls"], ["1".repeat(98), {bits: 256, k: 2, n: 3}, /^Roll a die at least 99 times/, "98 rolls for 256 bits"],
    ["0".repeat(60), {bits: 128, k: 2, n: 3}, /\("0" was typed\)/, "a 0 in the rolls"], [R50, {bits: 128, k: 1, n: 3}, /2 to 9 shares needed/, "k = 1"], [R50, {bits: 128, k: 10, n: 12}, /2 to 9 shares needed/, "k = 10"],
    [R50, {bits: 128, k: 3, n: 2}, /from the number needed \(3\) to 31/, "3 of 2"], [R50, {bits: 128, k: 2, n: 32}, /to 31/, "32 shares"], [R50, {bits: 160, k: 2, n: 3}, /^Choose 48 characters/, "160 bits"]]){
    const r = await w.c32Make(rolls, o); check("make: refuses " + label, !r.ok && re.test(r.error) && !r.shares.length && !r.masterSeed, r.error);
  }
  const realC = w.c32Combine, realP = w.c32Parse;
  w.c32Combine = (l) => { const r = realC(l); if(r.seed) r.seed[0] ^= 1; return r; };
  let r = await w.c32Make(R50, {bits: 128, k: 2, n: 3}); check("make: strings that combine to another seed are not shown (self-check)", !r.ok && /^The self-check failed/.test(r.error) && !r.shares.length);
  w.c32Combine = (l) => (l.includes(made[0].shares[2]) ? {ok: false, error: "last share", seed: null} : realC(l));
  r = await w.c32Make(R50, {bits: 128, k: 2, n: 3}); check("make: every share is combined again in the self-check", !r.ok && /\(last share\)/.test(r.error));
  w.c32Combine = realC;
  w.c32Parse = (x) => { const p = realP(x); if(p.ok && p.index === "d") p.index = "e"; return p; };
  r = await w.c32Make(R50, {bits: 128, k: 2, n: 3}); check("make: a share that reads back with another index is not shown", !r.ok && /string 3 does not hold the settings/.test(r.error));
  w.c32Parse = realP;
}

// ---------- 5. The outside implementations (BIP93's own Python, python-codex32, Coldcard), when fetched ----------
{
  let py = false; try { execFileSync("python3", ["-c", "1"], {stdio: "ignore"}); py = true; } catch(e) { py = false; }
  const need = ["bips/bip-0093.mediawiki", "codex32/reference/python-codex32/src/codex32/bip93.py", "coldcard-codex32/shared/codex32.py"].map((f) => path.join(here, "vendor", "src", f));
  if(!py || !need.every(existsSync)) console.log("REFERENCE: SKIPPED (" + (py ? "run sh tests/vendor/fetch.sh first" : "needs python3") + "; the vectors and the port above still ran)");
  else {
    const valid = [].concat(...Object.values(V).filter((x) => x.strings).map((x) => x.strings));
    const madeStr = [].concat(...made.map((m) => m.shares));
    const sets = []; for(const m of made){ const k = +m.shares[0][3]; if(!k) continue; sets.push(m.shares.slice(0, k)); sets.push(m.shares.slice(-k)); }
    const rollCases = MAKE.filter((c) => c[2] === 0).map((c, i) => ({rolls: c[0], bits: c[1], id: made[MAKE.indexOf(c)].identifier}));
    const job = {decode: valid.concat(V.invalid, madeStr), recover: sets, make: MAKE.map(([rolls, bits, k, n]) => ({rolls, bits, k, n})), rolls: rollCases};
    const out = JSON.parse(execFileSync("python3", ["-I", "-B", path.join(here, "vendor", "codex32_ref.py")], {input: JSON.stringify(job), maxBuffer: 1 << 26}).toString());
    let agree = 0, ccAgree = 0, ccN = 0;
    job.decode.forEach((x, i) => { const p = w.c32Parse(x), o = out.decode[i], mine = p.ok ? {ok: true, k: String(p.k), id: p.id, idx: p.index} : {ok: false};
      if(p.ok && p.index === "s") mine.seed = hex(w.c32Combine([x]).seed);
      if(JSON.stringify(mine) === JSON.stringify(o.ref) && JSON.stringify(mine) === JSON.stringify(o.bip)) agree++; else console.log("  differs: " + x + " " + JSON.stringify([mine, o]));
      if([48, 74, 127].includes(x.length) && /^ms1/i.test(x)){ ccN++; if(JSON.stringify(mine) === JSON.stringify(o.cc)) ccAgree++; } });
    check("reference: the BIP's own Python (ms32_decode) and python-codex32 read every string as the page does (" + agree + " of " + job.decode.length + ": vectors, invalid vectors, strings made here)", agree === job.decode.length);
    check("reference: Coldcard's Share.parse agrees on every 48, 74 and 127-character string (" + ccAgree + " of " + ccN + ")", ccAgree === ccN && ccN > 50);
    let rec = 0; sets.forEach((l, i) => { const s = hex(w.c32Combine(l).seed), o = out.recover[i]; if(o.ref === s && o.bip === s && o.cc === s) rec++; else console.log("  differs: " + JSON.stringify([l, s, o])); });
    check("reference: python-codex32, ms32_recover and Coldcard's generate_share combine the page's shares to the same seed (" + rec + " of " + sets.length + " sets)", rec === sets.length);
    let mk = 0; out.make.forEach((m, i) => { if(JSON.stringify(m.strings) === JSON.stringify(made[i].shares)) mk++; else console.log("  differs: " + JSON.stringify([MAKE[i].slice(1), m, made[i].shares])); });
    check("reference: python-codex32, given the same stream (from_seed, then interpolate_at), makes the same strings in all " + MAKE.length + " cases", mk === MAKE.length);
    check("reference: a secret made here (k = 0) is exactly Coldcard's dice-only codex32 secret (rolls_codex32.py) for the same rolls and identifier", out.rolls.length === 3 && out.rolls.every((x, i) => x === made[MAKE.indexOf(MAKE.filter((c) => c[2] === 0)[i])].shares[0].toUpperCase()));
  }
}

console.log("\nSummary: " + pass + " passed, " + fail + " failed.");
process.exit(fail ? 1 : 0);
