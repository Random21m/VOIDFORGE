// Small fast PRNG for Monte Carlo (xoshiro128**), seeded from crypto unless a seed is given.
'use strict';
const crypto = require('crypto');
function make(seedHex) {
  const b = seedHex ? Buffer.from(seedHex.padStart(32, '0').slice(0, 32), 'hex') : crypto.randomBytes(16);
  let s0 = b.readUInt32LE(0) | 1, s1 = b.readUInt32LE(4), s2 = b.readUInt32LE(8), s3 = b.readUInt32LE(12);
  function next() {
    const r = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11);
    return r;
  }
  function rotl(x, k) { return (x << k) | (x >>> (32 - k)); }
  // unbiased integer in [0,n) by rejection
  function int(n) {
    const lim = Math.floor(4294967296 / n) * n;
    let x; do x = next(); while (x >= lim); return x % n;
  }
  function float() { return next() / 4294967296; }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = int(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function weighted(w) { const tot = w.reduce((x, y) => x + y, 0); let u = float() * tot; for (let i = 0; i < w.length; i++) { u -= w[i]; if (u < 0) return i; } return w.length - 1; }
  return { next, int, float, shuffle, weighted };
}
module.exports = { make };
