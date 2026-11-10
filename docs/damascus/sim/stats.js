'use strict';
// chi-square survival function via regularized incomplete gamma (Numerical Recipes style)
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015; for (const k of c) ser += k / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function gammq(a, x) { // upper regularized Q(a,x)
  if (x < a + 1) { // series for P
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 1000; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
const chi2p = (stat, df) => gammq(df / 2, stat / 2);
function chi2(counts, expectedEach) {
  let s = 0; for (const c of counts) s += (c - expectedEach) ** 2 / expectedEach; return s;
}
function binomTail(n, p, kLo, kHi) { // P(X<=kLo) + P(X>=kHi)
  let tot = 0; const lp = Math.log(p), lq = Math.log(1 - p);
  const lf = [0]; for (let i = 1; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
  for (let k = 0; k <= n; k++) if (k <= kLo || k >= kHi) tot += Math.exp(lf[n] - lf[k] - lf[n - k] + k * lp + (n - k) * lq);
  return tot;
}
module.exports = { chi2p, chi2, binomTail };
