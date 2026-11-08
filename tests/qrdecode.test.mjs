// Test for qrdecode.js. Run from the repo folder so its node_modules resolve:
//   cd vf-bundle/next && node ../../qr/qrdecode.test.mjs        (VERBOSE=1 prints every case, SEED=n another random set)
// Codes come from an independent encoder (the qrcode npm package), are rendered to grayscale pictures with rotation,
// perspective, noise, blur, uneven light, inversion, JPEG and codeword damage, and decoded by our code and by jsQR.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const reqCwd = createRequire(path.join(process.cwd(), "noop.js"));
const reqHere = createRequire(path.join(here, "noop.js"));
function load(name) {
  for (const r of [reqCwd, reqHere]) { try { return r(name); } catch (e) { } }
  return null;
}
function loadCore(file) {
  for (const r of [reqCwd, reqHere]) { try { return r("qrcode/lib/core/" + file); } catch (e) { } }
  throw new Error("qrcode package not found: npm install --no-save qrcode in " + here);
}
const QR = load("qrcode");
if (!QR) { console.log("FAIL qrcode package not found (npm install --no-save qrcode into " + here + ")"); process.exit(1); }
const ECC = loadCore("error-correction-code.js"), ECL = loadCore("error-correction-level.js"), UT = loadCore("utils.js");
const MASK = loadCore("mask-pattern.js"), RSE = loadCore("reed-solomon-encoder.js"), VER = loadCore("version.js"), MODE = loadCore("mode.js");
let jsQR = load("jsqr"); if (jsQR && typeof jsQR !== "function") jsQR = jsQR.default;
const jpeg = load("jpeg-js");
const VERBOSE = !!process.env.VERBOSE;

// Load the decoder the way the page would: one plain script, no modules.
// the reader exactly as it is in the page, between its two marker lines
const page = fs.readFileSync(path.join(here, "..", "voidforge.html"), "utf8"), m0 = "// ===== QR code reader (v2.9.0) =====\n", m1 = "\n// ===== end of the QR code reader =====";
const src = page.slice(page.indexOf(m0) + m0.length, page.indexOf(m1));
const ctx = vm.createContext({});
// The script runs inside a function scope in the vm context: top-level names on a vm sandbox's global object go through
// slow interceptors (about 10x slower than a browser's globals), which would make the timings meaningless. The built-ins it
// uses are passed in as the context's own Math, typed arrays and so on, for the same reason.
const QD = vm.runInContext("(function(Math, Uint8Array, Uint16Array, Float32Array, Float64Array, String, Array){\n" + src + "\n;return {qrDecodeGray, qrDecodeRgba};})(Math, Uint8Array, Uint16Array, Float32Array, Float64Array, String, Array)", ctx, { filename: "qrdecode.js", lineOffset: -1 });
for (const name of src.match(/^(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm).map(s => s.split(/\s+/)[1]))
  if (!/^qd/.test(name) && name !== "qrDecodeGray" && name !== "qrDecodeRgba") { console.log("FAIL top-level name without qd prefix: " + name); process.exitCode = 1; }

// Seeded random numbers so runs repeat exactly.
let seed = Number(process.env.SEED) || 12345; // SEED=n runs a different random set
function rnd() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
function rint(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function gauss() { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// ---------- symbols ----------
function makeCode(text, opt) {
  const q = QR.create(text, opt);
  const n = q.modules.size, mods = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) mods[i] = q.modules.data[i] ? 1 : 0;
  return { q, n, mods, version: q.version, level: "LMQH"[q.errorCorrectionLevel.bit === 1 ? 0 : q.errorCorrectionLevel.bit === 0 ? 1 : q.errorCorrectionLevel.bit === 3 ? 2 : 3], mask: q.maskPattern };
}
// Data module positions in reading order, from the encoder's own record of which modules are function patterns.
function dataPositions(code) {
  const n = code.n, res = code.q.modules.reservedBit, list = [];
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const up = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = up ? n - 1 - vert : vert;
      if (!res[y * n + x]) list.push(y * n + x);
    }
  }
  return list;
}
// Block layout from the encoder's tables: which block each interleaved codeword belongs to, and how many errors each block can take.
function blockLayout(version, level) {
  const ecl = ECL.from(level), total = UT.getSymbolTotalCodewords(version), ecTotal = ECC.getTotalCodewordsCount(version, ecl);
  const nb = ECC.getBlocksCount(version, ecl), ecPer = ecTotal / nb, g1 = nb - total % nb, dataShort = Math.floor(total / nb) - ecPer;
  const blockOf = [], lens = [];
  for (let b = 0; b < nb; b++) lens.push(dataShort + (b >= g1 ? 1 : 0) + ecPer);
  for (let i = 0; i <= dataShort; i++) for (let b = 0; b < nb; b++) if (i < dataShort + (b >= g1 ? 1 : 0)) blockOf.push(b);
  for (let i = 0; i < ecPer; i++) for (let b = 0; b < nb; b++) blockOf.push(b);
  const p = version === 1 ? { L: 3, M: 2, Q: 1, H: 1 }[level] : version === 2 && level === "L" ? 2 : version === 3 && level === "L" ? 1 : 0;
  return { total, nb, ecPer, blockOf, lens, cap: Math.floor((ecPer - p) / 2), dataTotal: total - ecTotal, g1, dataShort };
}
// Damages codewords: perBlock(b) codewords of block b get a random non-zero XOR. Returns the damaged fraction.
function damage(code, perBlock) {
  const lay = blockLayout(code.version, code.level), pos = dataPositions(code), byBlock = [];
  for (let b = 0; b < lay.nb; b++) byBlock.push([]);
  lay.blockOf.forEach((b, k) => byBlock[b].push(k));
  let hit = 0;
  for (let b = 0; b < lay.nb; b++) {
    const ks = byBlock[b].slice(), want = Math.min(perBlock(b, lay), ks.length);
    for (let i = 0; i < want; i++) {
      const k = ks.splice(rint(0, ks.length - 1), 1)[0], r = rint(1, 255);
      for (let bit = 0; bit < 8; bit++) if ((r >> (7 - bit)) & 1) code.mods[pos[k * 8 + bit]] ^= 1;
      hit++;
    }
  }
  return hit / lay.total;
}
// Builds a symbol from a raw bit string (for ECI, structured append, FNC1, Latin-1, kanji): function patterns and format
// info come from the encoder; data bits are padded, split, given RS bytes by the encoder's RS, interleaved, masked and placed.
function rawCode(bits, version, level, mask) {
  const base = makeCode("0", { version, errorCorrectionLevel: level, maskPattern: mask });
  const lay = blockLayout(version, level), cap = lay.dataTotal * 8, b = bits.split("").map(Number);
  for (let i = 0; i < 4 && b.length < cap; i++) b.push(0);
  while (b.length % 8) b.push(0);
  const data = [];
  for (let i = 0; i < b.length; i += 8) data.push(parseInt(b.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < lay.dataTotal; pad ^= 0xec ^ 0x11) data.push(pad);
  if (data.length > lay.dataTotal) throw new Error("raw bits too long");
  const blocks = [], rs = new RSE(lay.ecPer); let k = 0;
  for (let bl = 0; bl < lay.nb; bl++) { const dl = lay.dataShort + (bl >= lay.g1 ? 1 : 0), d = Uint8Array.from(data.slice(k, k + dl)); k += dl; blocks.push([d, rs.encode(d)]); }
  const words = [];
  for (let i = 0; i <= lay.dataShort; i++) for (const bl of blocks) if (i < bl[0].length) words.push(bl[0][i]);
  for (let i = 0; i < lay.ecPer; i++) for (const bl of blocks) words.push(bl[1][i]);
  const pos = dataPositions(base);
  const M = base.q.modules;
  pos.forEach((p, i) => { M.data[p] = i < words.length * 8 ? (words[i >> 3] >> (7 - (i & 7))) & 1 : 0; });
  MASK.applyMask(mask, M); // the encoder's own mask code
  for (let i = 0; i < base.n * base.n; i++) base.mods[i] = M.data[i] ? 1 : 0;
  return base;
}
function bitsOf(v, len) { return v.toString(2).padStart(len, "0"); }
function byteBits(bytes) { return Array.from(bytes).map(x => bitsOf(x, 8)).join(""); }

// ---------- rendering ----------
function solve8(A, b) {
  const n = 8, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function homog(srcPts, dstPts) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = srcPts[i], [X, Y] = dstPts[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  const h = solve8(A, b);
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}
function inv3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}
// Renders a module matrix. o: px (pixels per module, may be fractional), quiet (modules), angle (degrees), persp (0..0.4,
// top edge shorter), skew (random corner jitter as a fraction of the side), mirror, dark, light, bg, canvas {w,h,cx,cy}.
function render(mods, n, o) {
  const px = o.px || 4, q = o.quiet ?? 4, side = (n + 2 * q) * px, ang = (o.angle || 0) * Math.PI / 180;
  const half = side / 2, p = (o.persp || 0) * side / 2, jit = (o.skew || 0) * side;
  let corners = [[-half + p, -half], [half - p, -half], [half, half], [-half, half]];
  corners = corners.map(([x, y]) => [x + (rnd() - 0.5) * 2 * jit, y + (rnd() - 0.5) * 2 * jit]);
  corners = corners.map(([x, y]) => [x * Math.cos(ang) - y * Math.sin(ang), x * Math.sin(ang) + y * Math.cos(ang)]);
  let W, Hh, ox, oy;
  if (o.canvas) { W = o.canvas.w; Hh = o.canvas.h; ox = o.canvas.cx; oy = o.canvas.cy; }
  else {
    const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]), m = o.margin ?? Math.round(px * 3 + 8);
    W = Math.ceil(Math.max(...xs) - Math.min(...xs) + 2 * m); Hh = Math.ceil(Math.max(...ys) - Math.min(...ys) + 2 * m);
    ox = m - Math.min(...xs); oy = m - Math.min(...ys);
  }
  const dst = corners.map(([x, y]) => [x + ox, y + oy]);
  const srcC = [[-q, -q], [n + q, -q], [n + q, n + q], [-q, n + q]];
  const Hf = homog(srcC, dst), Hi = inv3(Hf);
  const dark = o.dark ?? 30, light = o.light ?? 225, bg = o.bg ?? 170, gray = new Uint8Array(W * Hh);
  const ss = [0.25, 0.75];
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    let acc = 0;
    for (const sy of ss) for (const sx of ss) {
      const X = x + sx, Y = y + sy, z = Hi[2][0] * X + Hi[2][1] * Y + Hi[2][2];
      let u = (Hi[0][0] * X + Hi[0][1] * Y + Hi[0][2]) / z, v = (Hi[1][0] * X + Hi[1][1] * Y + Hi[1][2]) / z;
      if (o.mirror) u = n - u;
      if (u < -q || v < -q || u >= n + q || v >= n + q) acc += o.bgFn ? o.bgFn(x, y) : bg;
      else if (u < 0 || v < 0 || u >= n || v >= n) acc += light;
      else acc += mods[Math.floor(v) * n + Math.floor(u)] ? dark : light;
    }
    gray[y * W + x] = Math.round(acc / 4);
  }
  return { gray, w: W, h: Hh, map: (u, v) => { const z = Hf[2][0] * u + Hf[2][1] * v + Hf[2][2]; return [(Hf[0][0] * u + Hf[0][1] * v + Hf[0][2]) / z, (Hf[1][0] * u + Hf[1][1] * v + Hf[1][2]) / z]; } };
}
function boxBlur(img, r) {
  const { w, h } = img; let a = Float32Array.from(img.gray); const b = new Float32Array(w * h);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += a[y * w + xx]; c++; } } b[y * w + x] = s / c; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += b[yy * w + x]; c++; } } a[y * w + x] = s / c; }
  }
  img.gray = Uint8Array.from(a, v => Math.round(v)); return img;
}
function addNoise(img, sigma) { img.gray = img.gray.map(v => Math.max(0, Math.min(255, Math.round(v + gauss() * sigma)))); return img; }
function lighting(img, kind) {
  const { w, h } = img;
  img.gray = img.gray.map((v, i) => {
    const x = i % w, y = Math.floor(i / w);
    let f;
    if (kind === "linear") f = 0.25 + 0.75 * x / w;
    else if (kind === "diagonal") f = 0.3 + 0.7 * (x + y) / (w + h);
    else if (kind === "vignette") { const d = Math.hypot(x - w / 2, y - h / 2) / Math.hypot(w / 2, h / 2); f = 1 - 0.75 * d * d; }
    else if (kind === "shadow-hard") f = (x > w * 0.45 && x < w * 0.7) ? 0.45 : 1;
    else if (kind === "shadow") { const e = Math.min(x - w * 0.45, w * 0.7 - x) / (w * 0.03); f = 1 - 0.55 / (1 + Math.exp(-e)); }
    else f = 1;
    return Math.round(v * f);
  });
  return img;
}
function invert(img) { img.gray = img.gray.map(v => 255 - v); return img; }
function contrast(img, lo, hi) { img.gray = img.gray.map(v => Math.round(lo + (hi - lo) * v / 255)); return img; }
function toRgba(img) { const o = new Uint8ClampedArray(img.w * img.h * 4); for (let i = 0; i < img.w * img.h; i++) { o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = img.gray[i]; o[i * 4 + 3] = 255; } return o; }
function jpegify(img, quality) {
  if (!jpeg) return blocky(img);
  const enc = jpeg.encode({ data: Buffer.from(toRgba(img).buffer), width: img.w, height: img.h }, quality);
  const dec = jpeg.decode(enc.data, { useTArray: true });
  const g = new Uint8Array(img.w * img.h); for (let i = 0; i < g.length; i++) g[i] = dec.data[i * 4];
  img.gray = g; return img;
}
function blocky(img) { // stand-in when jpeg-js is missing: 8x8 block mean shifts
  const { w, h } = img; const g = Uint8Array.from(img.gray);
  for (let by = 0; by < h; by += 8) for (let bx = 0; bx < w; bx += 8) { const d = rint(-12, 12); for (let y = by; y < Math.min(by + 8, h); y++) for (let x = bx; x < Math.min(bx + 8, w); x++) g[y * w + x] = Math.max(0, Math.min(255, g[y * w + x] + d)); }
  img.gray = g; return img;
}

// ---------- cases ----------
const enc = new TextEncoder();
const results = {}; // category -> {must, n, ours, js, fails:[], wrong}
let mustFailures = 0;
function cat(name) { return results[name] || (results[name] = { n: 0, ours: 0, js: 0, jsN: 0, must: 0, mustOk: 0, wrong: 0, jsWrong: 0, fails: [], times: [] }); }
function eqBytes(a, b) { if (!a || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
function runJs(img) {
  if (!jsQR) return undefined;
  try { return jsQR(toRgba(img), img.w, img.h, { inversionAttempts: "attemptBoth" }); } catch (e) { return null; }
}
// expect: {text, bytes, version?, level?, mask?} or null (must return null). must: counts toward the exit code.
function check(category, label, img, expect, must) {
  const c = cat(category); c.n++;
  const t0 = process.hrtime.bigint();
  const r = QD.qrDecodeGray(img.gray, img.w, img.h);
  c.times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  let ok, wrong = false;
  if (expect === null) { ok = r === null; }
  else {
    const bytes = expect.bytes || enc.encode(expect.text);
    ok = !!r && eqBytes(r.bytes, bytes) && (expect.text === undefined || r.text === expect.text)
      && (expect.version === undefined || r.version === expect.version) && (expect.level === undefined || r.ecLevel === expect.level)
      && (expect.mask === undefined || r.mask === expect.mask);
    if (r && !ok) wrong = true;
  }
  if (wrong || (expect === null && r)) c.wrong++;
  if (ok) c.ours++;
  const j = runJs(img);
  if (j !== undefined) {
    c.jsN++;
    const jsOk = expect === null ? !j : !!(j && (j.data === expect.text || eqBytes(Uint8Array.from(j.binaryData), expect.bytes || enc.encode(expect.text))));
    if (jsOk) c.js++; else if (j) c.jsWrong++;
  }
  if (must) { c.must++; if (ok) c.mustOk++; else { mustFailures++; c.fails.push(label); } }
  if (VERBOSE || (must && !ok)) console.log((ok ? "PASS " : "FAIL ") + category + " " + label + (r && !ok ? " got: " + JSON.stringify(String(r.text).slice(0, 60)) : ""));
  return ok;
}

// payload generators
const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
function randStr(len, alphabet) { let s = ""; for (let i = 0; i < len; i++) s += alphabet[rint(0, alphabet.length - 1)]; return s; }
function capacity(v, level, mode) { return VER.getCapacity(v, ECL.from(level), mode); }
// A payload of the given kind filling about `fill` of the version's capacity; trimmed until the encoder accepts it
// (its mixed-mode segmenting can need a few more bits than a single-mode estimate).
function payloadFor(kind, v, level, fill) {
  let s = payloadRaw(kind, v, level, fill);
  for (;;) {
    try { QR.create(s, { version: v, errorCorrectionLevel: level }); return s; }
    catch (e) { const cps = Array.from(s); if (cps.length < 2) throw e; s = cps.slice(0, Math.floor(cps.length * 0.95)).join(""); }
  }
}
function payloadRaw(kind, v, level, fill) {
  if (kind === "numeric") return randStr(Math.max(1, Math.floor(capacity(v, level, MODE.NUMERIC) * fill)), "0123456789");
  if (kind === "alnum") return randStr(Math.max(1, Math.floor(capacity(v, level, MODE.ALPHANUMERIC) * fill)), ALNUM);
  if (kind === "utf8") { const pool = ["é", "ü", "ß", "€", "日本", "ключ", "₿", "🙂", "a", "b", " "]; let s = ""; const cap = capacity(v, level, MODE.BYTE) * fill; while (enc.encode(s).length < cap - 4) s += pool[rint(0, pool.length - 1)]; return s || "é"; }
  return randStr(Math.max(1, Math.floor(capacity(v, level, MODE.BYTE) * fill)), "abcdefghijklmnopqrstuvwxyz0123456789=+/?&:");
}
function seedQR(words) { let s = ""; for (let i = 0; i < words; i++) s += String(rint(0, 2047)).padStart(4, "0"); return s; }
function base64(bytes) { return Buffer.from(bytes).toString("base64"); }
const BYTEWORDS = "ABLEACIDALSOAPEXAQUAARCHATOMAUNTAWAYAXISBACKBALDBARNBELTBETABIASBLUEBODYBRAGBREWBULBBUZZCALMCASHCATSCHEFCITYCLAWCODECOLACOOKCOSTCRUXCURLCUSPCYANDARKDATADAYSDELIDICEDIETDOORDOWNDRAWDROPDRUMDULLDUTYEACHEASYECHOEDGEEPICEVENEXAMEXITEYESFACTFAIRFERNFIGSFILMFISHFIZZFLAPFLEWFLUXFOXYFREEFROGFUELFUND";
function urString() { let body = ""; for (let i = 0; i < 120; i++) { const k = rint(0, BYTEWORDS.length / 4 - 1); body += BYTEWORDS[k * 4] + BYTEWORDS[k * 4 + 3]; } return "UR:CRYPTO-PSBT/3-7/LPAXAXCFAXHDCX" + body; }
function bbqrString() { return "B$ZP0503" + randStr(400, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"); }

const t00 = Date.now();

// 1. Every version 1-40, cycling EC level, mask and payload type, rendered straight at 3-8 px per module.
for (let v = 1; v <= 40; v++) {
  const level = "LMQH"[v % 4], mask = (v * 5) % 8, kind = ["byte", "numeric", "alnum", "utf8"][v % 4];
  const text = payloadFor(kind, v, level, 0.6 + 0.4 * rnd());
  const code = makeCode(text, { version: v, errorCorrectionLevel: level, maskPattern: mask });
  const px = v <= 10 ? 3 + (v % 6) : v <= 25 ? 3 + (v % 3) : 3 + (v % 2);
  check("versions", "v" + v + " " + level + " mask" + mask + " " + kind + " " + px + "px", render(code.mods, code.n, { px }), { text, version: v, level, mask }, true);
}
// 2. Every EC level with every mask, random versions and small rotations.
for (const level of "LMQH") for (let mask = 0; mask < 8; mask++) {
  const v = rint(1, 15), kind = ["byte", "numeric", "alnum", "utf8"][rint(0, 3)];
  const text = payloadFor(kind, v, level, 0.5 + 0.5 * rnd());
  const code = makeCode(text, { version: v, errorCorrectionLevel: level, maskPattern: mask });
  check("levels-masks", level + " mask" + mask + " v" + v + " " + kind, render(code.mods, code.n, { px: rint(3, 7), angle: rint(-20, 20) }), { text, level, mask, version: v }, true);
}
// 3. Bitcoin payloads.
{
  const psbt = new Uint8Array(1800); for (let i = 0; i < psbt.length; i++) psbt[i] = rint(0, 255);
  const cases = [
    ["SeedQR 12 words", seedQR(12), "L"], ["SeedQR 24 words", seedQR(24), "L"], ["SeedQR 24 words M", seedQR(24), "M"],
    ["PSBT base64 2400 chars", base64(psbt), "L"], ["PSBT base64 600 chars", base64(psbt.slice(0, 450)), "M"],
    ["UR uppercase", urString(), "L"], ["BBQr uppercase", bbqrString(), "L"],
    ["bitcoin URI", "bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.00150000&label=Caf%C3%A9%20%E2%82%BF", "M"],
    ["uppercase bech32 URI", "BITCOIN:BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ", "M"],
    ["xpub", "xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz", "Q"],
    ["descriptor", "wsh(sortedmulti(2,[d34db33f/48h/0h/0h/2h]xpub6E...,[c0ffee00/48h/0h/0h/2h]xpub6F...))#8a7c2qzv", "M"],
    ["mixed segments", "ABCDEF1234567890123456789012abc", "H"], ["UTF-8 multilingual", "Ключ ₿ 日本語 émoji 🙂 Ωmega", "Q"],
    ["single digit", "7", "H"], ["empty-ish space", " ", "L"],
  ];
  for (const [label, text, level] of cases) {
    const code = makeCode(text, { errorCorrectionLevel: level });
    check("payloads", label + " (v" + code.version + "-" + level + ")", render(code.mods, code.n, { px: code.version > 25 ? 3 : 4, angle: rint(-8, 8) }), { text }, true);
  }
}
// 4. Raw bit streams the qrcode package cannot make: ECI, structured append, FNC1, Latin-1, kanji.
{
  const utf = enc.encode("ECI UTF-8: café ₿");
  const raws = [
    ["ECI 26 then bytes", "0111" + bitsOf(26, 8) + "0100" + bitsOf(utf.length, 8) + byteBits(utf), { bytes: utf, text: "ECI UTF-8: café ₿" }],
    ["ECI 2-byte designator", "0111" + "10" + bitsOf(900, 14) + "0100" + bitsOf(3, 8) + byteBits([65, 66, 67]), { bytes: Uint8Array.from([65, 66, 67]), text: "ABC" }],
    ["structured append + bytes", "0011" + "0001" + "0011" + bitsOf(0x5a, 8) + "0100" + bitsOf(5, 8) + byteBits(enc.encode("part2")), { text: "part2" }],
    ["FNC1 first + alnum", "0101" + "0010" + bitsOf(2, 9) + bitsOf(ALNUM.indexOf("A") * 45 + ALNUM.indexOf("1"), 11), { text: "A1" }],
    ["Latin-1 fallback", "0100" + bitsOf(3, 8) + byteBits([0xe9, 0x41, 0xff]), { bytes: Uint8Array.from([0xe9, 0x41, 0xff]), text: "éAÿ" }],
    ["numeric then byte then alnum", "0001" + bitsOf(5, 10) + bitsOf(123, 10) + bitsOf(45, 7) + "0100" + bitsOf(2, 8) + byteBits([0x68, 0x69]) + "0010" + bitsOf(1, 9) + bitsOf(ALNUM.indexOf("Z"), 6), { text: "12345hiZ" }],
  ];
  for (const [label, bits, expect] of raws) {
    const code = rawCode(bits, 2, "M", 3);
    check("raw-segments", label, render(code.mods, code.n, { px: 4 }), expect, true);
  }
  const kanji = rawCode("1000" + bitsOf(1, 8) + bitsOf(0x0aaa, 13), 1, "M", 0);
  check("raw-segments", "kanji gives null (not supported)", render(kanji.mods, kanji.n, { px: 4 }), null, false);
}
// 5. Rotation.
for (const angle of [0, 7, 33, 45, 90, 145, 180, 212, 270, 311, 359]) for (const [v, level] of [[1, "M"], [4, "Q"], [10, "L"], [25, "M"]]) {
  const text = payloadFor("byte", v, level, 0.9), code = makeCode(text, { version: v, errorCorrectionLevel: level });
  check("rotation", angle + "deg v" + v, render(code.mods, code.n, { px: v >= 25 ? 3 : 5, angle }), { text }, true);
}
// 6. Perspective (mild: one edge 10-20% shorter, plus random corner jitter) at several rotations.
for (const persp of [0.1, 0.2]) for (const [v, level] of [[2, "M"], [5, "L"], [7, "M"], [15, "Q"], [30, "L"]]) for (const angle of [0, 120, 250]) {
  const text = payloadFor("byte", v, level, 0.85), code = makeCode(text, { version: v, errorCorrectionLevel: level });
  check("perspective", "persp" + persp + " v" + v + " " + angle + "deg", render(code.mods, code.n, { px: v >= 15 ? 4 : 5, angle, persp, skew: 0.02 }), { text }, true);
}
for (const [v, level] of [[3, "M"], [10, "M"], [20, "L"]]) for (const angle of [15, 200]) {
  const text = payloadFor("byte", v, level, 0.85), code = makeCode(text, { version: v, errorCorrectionLevel: level });
  check("perspective-strong", "persp0.35 v" + v + " " + angle + "deg", render(code.mods, code.n, { px: 5, angle, persp: 0.35, skew: 0.04 }), { text }, false);
}
// 7. Scale: fractional module sizes.
for (const px of [3, 3.4, 4.6, 5.5, 6.3, 7.8, 8]) for (const v of [3, 12, 22]) {
  const text = payloadFor("alnum", v, "M", 0.9), code = makeCode(text, { version: v, errorCorrectionLevel: "M" });
  check("scale", px + "px v" + v, render(code.mods, code.n, { px, angle: rint(0, 359) }), { text }, true);
}
for (const px of [2, 2.5]) for (const v of [2, 6]) {
  const text = payloadFor("byte", v, "M", 0.9), code = makeCode(text, { version: v, errorCorrectionLevel: "M" });
  check("scale-tiny", px + "px v" + v, render(code.mods, code.n, { px }), { text }, false);
}
// 8. Gaussian noise.
for (const sigma of [10, 20, 30, 45]) for (const v of [2, 8, 16]) for (const px of [3, 5]) {
  const text = payloadFor("byte", v, "M", 0.9), code = makeCode(text, { version: v, errorCorrectionLevel: "M" });
  check(sigma <= 30 ? "noise" : "noise-heavy", "sigma" + sigma + " v" + v + " " + px + "px", addNoise(render(code.mods, code.n, { px, angle: rint(0, 359) }), sigma), { text }, sigma <= 30);
}
// 9. Blur.
for (const r of [1, 2]) for (const v of [2, 8, 16]) for (const px of [3, 4, 6, 8]) {
  const text = payloadFor("byte", v, "M", 0.9), code = makeCode(text, { version: v, errorCorrectionLevel: "M" });
  // two box passes of radius r spread an edge over about 4r+1 pixels; up to about 1.5 modules counts as must-decode
  const mild = 4 * r + 1 <= px * 1.5;
  check(mild ? "blur" : "blur-heavy", "box r" + r + " x2 v" + v + " " + px + "px", boxBlur(render(code.mods, code.n, { px, angle: rint(0, 359) }), r), { text }, mild);
}
for (const v of [2, 8]) {
  const text = payloadFor("byte", v, "M", 0.9), code = makeCode(text, { version: v, errorCorrectionLevel: "M" });
  check("blur-heavy", "box r2 x2 v" + v + " 3px", boxBlur(render(code.mods, code.n, { px: 3 }), 2), { text }, false);
}
// 10. Uneven light.
for (const kind of ["linear", "diagonal", "vignette", "shadow", "shadow-hard"]) for (const v of [3, 9, 18]) for (const angle of [rint(0, 359), rint(0, 359)]) {
  const text = payloadFor("byte", v, "Q", 0.9), code = makeCode(text, { version: v, errorCorrectionLevel: "Q" }), hard = kind === "shadow-hard";
  check(hard ? "shadow-hard-edge" : "lighting", kind + " v" + v + " " + angle + "deg", addNoise(lighting(render(code.mods, code.n, { px: 5, angle }), kind), 6), { text }, !hard);
}
for (const [lo, hi] of [[90, 160], [70, 150], [100, 165], [110, 150]]) for (const v of [3, 9]) {
  const text = payloadFor("byte", v, "M", 0.9), code = makeCode(text, { version: v, errorCorrectionLevel: "M" });
  check(hi - lo >= 60 ? "low-contrast" : "contrast-extreme", lo + "-" + hi + " v" + v, addNoise(contrast(render(code.mods, code.n, { px: 5, angle: rint(0, 359) }), lo, hi), 4), { text }, hi - lo >= 60);
}
// 11. Inverted (light on dark).
for (const v of [1, 4, 11, 27]) for (const angle of [0, 63, 180]) {
  const text = payloadFor("alnum", v, "M", 0.9), code = makeCode(text, { version: v, errorCorrectionLevel: "M" });
  check("inverted", "v" + v + " " + angle + "deg", invert(render(code.mods, code.n, { px: v > 20 ? 3 : 5, angle, bg: 225 })), { text }, true);
}
// 12. JPEG artefacts.
for (const quality of [25, 40, 60]) for (const v of [3, 10, 20]) {
  const text = payloadFor("byte", v, "M", 0.9), code = makeCode(text, { version: v, errorCorrectionLevel: "M" });
  check("jpeg", "q" + quality + " v" + v, jpegify(render(code.mods, code.n, { px: 4, angle: rint(0, 359) }), quality), { text }, quality >= 40);
}
// 13. Mirrored codes (optional feature).
for (const v of [2, 9, 21]) {
  const text = payloadFor("byte", v, "M", 0.9), code = makeCode(text, { version: v, errorCorrectionLevel: "M" });
  check("mirrored", "v" + v, render(code.mods, code.n, { px: 4, angle: rint(0, 359), mirror: true }), { text }, false);
}
// 14. Damaged codewords within the EC limit: must decode. Beyond it: must return null, never wrong text.
for (const level of "LMQH") for (const v of [1, 2, 3, 5, 9, 14, 24, 33, 40]) for (const frac of [0.05, 0.12, 0.2]) {
  const text = payloadFor("byte", v, level, 0.95), code = makeCode(text, { version: v, errorCorrectionLevel: level });
  const hit = damage(code, (b, lay) => Math.min(lay.cap, Math.max(1, Math.round(frac * lay.lens[b]))));
  check("damage-within", level + " v" + v + " target" + Math.round(frac * 100) + "% hit" + (hit * 100).toFixed(1) + "%", render(code.mods, code.n, { px: v > 25 ? 3 : 4, angle: rint(0, 359) }), { text }, true);
}
for (const level of "LMQH") for (const v of [1, 2, 3, 5, 9, 14, 24, 33, 40]) for (const extra of [1, 3]) {
  const text = payloadFor("byte", v, level, 0.95), code = makeCode(text, { version: v, errorCorrectionLevel: level });
  const one = rint(0, 1) === 1;
  const hit = damage(code, (b, lay) => (one && b > 0) ? rint(0, lay.cap) : lay.cap + extra + rint(0, 2));
  check("damage-beyond", level + " v" + v + " cap+" + extra + (one ? " one block" : " all blocks") + " hit" + (hit * 100).toFixed(1) + "%", render(code.mods, code.n, { px: v > 25 ? 3 : 4, angle: rint(0, 359) }), null, true);
}
// 15. Pictures without a code must give null: noise, shapes, a fake code with valid finders but random data.
for (let i = 0; i < 20; i++) {
  const w = rint(100, 640), h = rint(100, 480), g = new Uint8Array(w * h);
  const kind = i % 4;
  for (let k = 0; k < g.length; k++) g[k] = kind === 0 ? rint(0, 255) : kind === 1 ? (rnd() < 0.5 ? 20 : 230) : 128;
  if (kind >= 2) for (let r = 0; r < 60; r++) { const x0 = rint(0, w - 1), y0 = rint(0, h - 1), rw = rint(2, 60), rh = rint(2, 60), c = rint(0, 255); for (let y = y0; y < Math.min(h, y0 + rh); y++) for (let x = x0; x < Math.min(w, x0 + rw); x++) g[y * w + x] = c; }
  if (kind === 3) { const img = boxBlur({ gray: g, w, h }, 1); g.set(img.gray); }
  check("no-code", ["uniform noise", "binary noise", "rectangles", "blurred rectangles"][kind] + " " + w + "x" + h, { gray: g, w, h }, null, true);
}
for (const v of [1, 3, 7, 15]) for (let i = 0; i < 3; i++) {
  const code = makeCode("x", { version: v, errorCorrectionLevel: "L" }), pos = dataPositions(code);
  for (const p of pos) code.mods[p] = rnd() < 0.5 ? 1 : 0;
  check("no-code", "fake code v" + v + " random data #" + i, render(code.mods, code.n, { px: 4, angle: rint(0, 359) }), null, true);
}
// Checkerboards and grids with finder-like squares.
for (let i = 0; i < 4; i++) {
  const w = 400, h = 300, g = new Uint8Array(w * h).fill(220), s = 6 + i * 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((Math.floor(x / s) + Math.floor(y / s)) % 2 === 0) g[y * w + x] = 30;
  for (const [fx, fy] of [[40, 40], [300, 40], [40, 200], [300, 200]]) for (let y = 0; y < 7 * s; y++) for (let x = 0; x < 7 * s; x++) { const d = Math.max(Math.abs(Math.floor(x / s) - 3), Math.abs(Math.floor(y / s) - 3)); g[(fy + y) * w + fx + x] = d === 2 ? 220 : 30; }
  check("no-code", "checkerboard with finders s" + s, { gray: g, w, h }, null, true);
}
// 16. RGBA entry point.
{
  const text = "rgba entry point ₿", code = makeCode(text, { errorCorrectionLevel: "M" }), img = render(code.mods, code.n, { px: 5, angle: 30 });
  const rgba = new Uint8ClampedArray(img.w * img.h * 4);
  for (let i = 0; i < img.w * img.h; i++) { const g = img.gray[i]; rgba[i * 4] = Math.min(255, g + 10); rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = Math.max(0, g - 10); rgba[i * 4 + 3] = 255; }
  const r = QD.qrDecodeRgba(rgba, img.w, img.h), c = cat("rgba"); c.n++; c.must++;
  if (r && r.text === text) { c.ours++; c.mustOk++; if (VERBOSE) console.log("PASS rgba"); } else { mustFailures++; c.fails.push("rgba"); console.log("FAIL rgba"); }
  for (const bad of [[null, 10, 10], [new Uint8Array(5), 100, 100], [new Uint8Array(400), 20, 20], ["junk", 30, 30]]) {
    let threw = false, out; try { out = QD.qrDecodeGray(...bad); } catch (e) { threw = true; }
    c.n++; c.must++; if (!threw && out === null) { c.ours++; c.mustOk++; } else { mustFailures++; c.fails.push("bad input"); console.log("FAIL bad input did not return null"); }
  }
}

// 17. Timing on 640x480 camera-like frames: a desk-like background of soft-edged shapes, light falling off, sensor noise.
function clutter(w, h) {
  const g = new Uint8Array(w * h);
  for (let k = 0; k < g.length; k++) g[k] = 150;
  for (let r = 0; r < 40; r++) { const x0 = rint(-50, w), y0 = rint(-50, h), rw = rint(10, 200), rh = rint(10, 200), c = rint(40, 230); for (let y = Math.max(0, y0); y < Math.min(h, y0 + rh); y++) for (let x = Math.max(0, x0); x < Math.min(w, x0 + rw); x++) g[y * w + x] = c; }
  return boxBlur({ gray: g, w, h }, 2).gray;
}
const frames = [], timing = { ours: [], oursMiss: [], js: [], jsMiss: [] };
for (let i = 0; i < 24; i++) {
  const v = [2, 3, 4, 5, 6, 8, 10, 12][i % 8], level = "M", text = payloadFor("byte", v, level, 0.9), code = makeCode(text, { version: v, errorCorrectionLevel: level });
  // module size 4-6 px but small enough that the rotated code and its quiet zone stay inside the frame
  const px = Math.min(rint(4, 6), Math.floor(4300 / ((code.n + 8) * 1.45)) / 10), half = (code.n + 8) * px * 0.73, bg = clutter(640, 480);
  const img = render(code.mods, code.n, { px, angle: rint(-25, 25), persp: rnd() * 0.12, canvas: { w: 640, h: 480, cx: rint(half, 640 - half), cy: rint(half, 480 - half) }, bgFn: (x, y) => bg[y * 640 + x] });
  frames.push({ img: addNoise(lighting(img, "diagonal"), 6), text });
}
const emptyFrames = [];
for (let i = 0; i < 8; i++) emptyFrames.push(addNoise(lighting({ gray: clutter(640, 480), w: 640, h: 480 }, "diagonal"), 6));
let frameOk = 0, frameJs = 0;
if (process.env.QD_DUMP) fs.writeFileSync(process.env.QD_DUMP, JSON.stringify(frames.map(f => ({ w: f.img.w, h: f.img.h, text: f.text, gray: Buffer.from(f.img.gray).toString("base64") }))));
for (let rep = 0; rep < 2; rep++) for (const f of frames) {
  let t0 = performance.now(); const r = QD.qrDecodeGray(f.img.gray, 640, 480); const dt = performance.now() - t0;
  if (rep === 1) { timing.ours.push(dt); if (r && r.text === f.text) frameOk++; }
  if (jsQR && rep === 1) { const rgba = toRgba(f.img); t0 = performance.now(); const j = jsQR(rgba, 640, 480, { inversionAttempts: "attemptBoth" }); timing.js.push(performance.now() - t0); if (j && j.data === f.text) frameJs++; }
}
for (const f of emptyFrames) {
  let t0 = performance.now(); QD.qrDecodeGray(f.gray, 640, 480); timing.oursMiss.push(performance.now() - t0);
  if (jsQR) { const rgba = toRgba(f); t0 = performance.now(); jsQR(rgba, 640, 480, { inversionAttempts: "attemptBoth" }); timing.jsMiss.push(performance.now() - t0); }
}
const stat = (a) => { if (!a.length) return "n/a"; const s = a.slice().sort((x, y) => x - y); return "mean " + (a.reduce((p, q) => p + q, 0) / a.length).toFixed(1) + " ms, median " + s[Math.floor(s.length / 2)].toFixed(1) + " ms, max " + s[s.length - 1].toFixed(1) + " ms"; };
const fc = cat("frames-640x480"); fc.n = frames.length; fc.ours = frameOk; fc.js = frameJs; fc.jsN = jsQR ? frames.length : 0; fc.must = frames.length; fc.mustOk = frameOk;
if (frameOk < frames.length) { mustFailures += frames.length - frameOk; fc.fails.push((frames.length - frameOk) + " frames"); console.log("FAIL frames-640x480 decoded " + frameOk + "/" + frames.length); }

// ---------- summary ----------
console.log("\ncategory               cases  ours         jsQR         must ok   wrong(ours/jsQR)  mean ms(ours)");
let totN = 0, totOurs = 0, totJs = 0, totJsN = 0;
for (const [name, c] of Object.entries(results)) {
  totN += c.n; totOurs += c.ours; totJs += c.js; totJsN += c.jsN;
  const pct = (a, b) => b ? (100 * a / b).toFixed(0).padStart(3) + "%" : "  - ";
  const mean = c.times.length ? (c.times.reduce((p, q) => p + q, 0) / c.times.length).toFixed(1) : "-";
  console.log((c.must && c.mustOk === c.must ? "PASS " : c.must ? "FAIL " : "info ") + name.padEnd(18) + String(c.n).padStart(5) + "  " + (c.ours + "/" + c.n).padEnd(8) + pct(c.ours, c.n) + "  " + (c.jsN ? (c.js + "/" + c.jsN).padEnd(8) + pct(c.js, c.jsN) : "n/a         ") + "  " + (c.must ? c.mustOk + "/" + c.must : "-").padEnd(9) + " " + (c.wrong + "/" + c.jsWrong).padStart(6) + "            " + mean);
}
console.log("\nall cases: ours " + totOurs + "/" + totN + " (" + (100 * totOurs / totN).toFixed(1) + "%), jsQR " + (totJsN ? totJs + "/" + totJsN + " (" + (100 * totJs / totJsN).toFixed(1) + "%)" : "not available"));
console.log("640x480 frames with a code: ours " + frameOk + "/" + frames.length + ", " + stat(timing.ours) + (jsQR ? "; jsQR " + frameJs + "/" + frames.length + ", " + stat(timing.js) : ""));
console.log("640x480 frames without a code: ours " + stat(timing.oursMiss) + (jsQR ? "; jsQR " + stat(timing.jsMiss) : ""));
const wrongTotal = Object.values(results).reduce((p, c) => p + c.wrong, 0), jsWrongTotal = Object.values(results).reduce((p, c) => p + c.jsWrong, 0);
console.log("wrong results (decoded but not the expected payload, or text where null was expected): ours " + wrongTotal + ", jsQR " + jsWrongTotal);
console.log("QR reader in the page: " + src.length + " characters; test time " + ((Date.now() - t00) / 1000).toFixed(1) + " s");
if (mustFailures || wrongTotal || process.exitCode) { console.log("\nFAIL: " + mustFailures + " must-decode failures, " + wrongTotal + " wrong results"); process.exit(1); }
console.log("\nPASS: every must case passed");
