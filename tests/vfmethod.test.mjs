// The Damascus method (v2.14.0): MAKE A SEED > Damascus, checked against the method's reference code and outside libraries.
// 1. The three worked examples and 2,000 random sheets (1,000 of 12 words, 1,000 of 24): the page's dmForge gives the same grids,
//    hallmarks (M, R, K), hand words, last-word range, bias boxes and phrases as the reference code (tests/fixtures/damascus/vf.js,
//    a copy of the method's ref/vf.js) and as @scure/bip39; fingerprints and first addresses agree with @scure/bip32 and
//    @scure/btc-signer.
// 2. The assay: each sheet's own Seed XOR phrase is valid, and the two XOR to the seed (@scure/bip39); the assay screen shows
//    neither grid F nor the seed.
// 3. Hallmark linearity, on the sheets and on random grids.
// 4. Mismatch finding: a wrong cell is pointed to by its row and column, a wrong word by its number.
// 5. The bias boxes: the reference code's numbers and verdicts, the thresholds at their edges, the printed thresholds.
// 6. FORGE SEED, the stale guard, and the wipes (CLEAR ALL, auto-clear, END SESSION).
// 7. The printed sheets: mirror table, skew letters, the 2,048 words of the binary table, page counts on Letter and A4 (Chromium).
// 8. SeedSigner (the practice signer, a port of SeedSigner 0.8.7, driven with its own keys in Chromium): for the worked
//    examples and 20 random sheets, Tools > Calc 12th/24th word > words > Build Final Word > Coin flip entropy gives the same
//    last word and fingerprint, and Address explorer the same first address; the labels match what the Forge sheet prints.
//    With SEEDSIGNER_SRC set to SeedSigner's src folder, SeedSigner's own Python (tests/vendor/seedsigner_final_word.py) too.
// Run: node tests/vfmethod.test.mjs     (VF_RANDOM=200 for fewer random sheets; VF_DEVICE=0 to skip the Chromium parts)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomInt, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadPage, ready, readHtml, HTML_PATH } from "./harness.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const vf = require("./fixtures/damascus/vf.js");
const bip39 = require("@scure/bip39");
const { wordlist } = require("@scure/bip39/wordlists/english");
const { HDKey } = require("@scure/bip32");
const btc = require("@scure/btc-signer");
let pass = 0, fail = 0;
function check(name, ok, detail){
  if(ok){ pass++; if(!check.quiet) console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (detail ? "  -- " + detail : "")); }
}
const N = +(process.env.VF_RANDOM || 1000);   // random sheets per length
const w = await ready(loadPage(readHtml()));
const $ = (id) => w.document.getElementById(id);
check("the page self-test passes 141/141", /SELF-TEST PASSED \(141\/141\)/.test($("selfTestBadge").textContent), $("selfTestBadge").textContent);

// ---------- helpers
const ex = [1, 2, 3].map((i) => JSON.parse(readFileSync(path.join(here, "fixtures", "damascus", "example-" + i + ".json"), "utf8")));
const pairsOf = (s) => String(s).trim().split(/\s+/).map((t) => [+t[0], +t[1]]);
const refForge = (words, dice, cards) => vf.forge({ words, dice, cards: cards.map((d) => Array.isArray(d) ? d : String(d).trim().split(/\s+/)) });
const pageCards = (cards) => cards.map((d) => Array.isArray(d) ? d.join(" ") : d).join("\n");
async function pageForge(words, dice, cards){
  const decks = w.dmParseCards(pageCards(cards), words).decks;
  return w.dmForge(words, dice, decks);
}
const rootOf = (m) => HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(m));
const fpOf = (m) => rootOf(m).fingerprint.toString(16).padStart(8, "0");
const addrOf = (m) => btc.p2wpkh(rootOf(m).derive("m/84'/0'/0'/0/0").publicKey).address;
const ent = (m) => bip39.mnemonicToEntropy(m, wordlist);
const xorB = (a, b) => a.map((x, i) => x ^ b[i]);
function randomSheet(words){
  const dice = []; let acc = 0, need = Math.ceil(vf.PLAN[words].bits / 5);
  while(acc < need + randomInt(4)){ const a = 1 + randomInt(6), b = 1 + randomInt(6); dice.push([a, b]); if(vf.mirrorCode(a, b) !== null) acc++; }
  const cards = vf.cardPlan(vf.PLAN[words].bits).map(() => { const d = Array.from({ length: 52 }, (_, i) => i); for(let i = 51; i > 0; i--){ const j = randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; } return d.map(vf.cardName); });
  return { words, dice, cards };
}
// Everything the page and the reference code must agree on, as one string
function sameAsRef(p, r){
  const bias = (b) => JSON.stringify([b.throws, b.counts, b.repeats, b.pass]);
  const cb = (l) => JSON.stringify(l.map((b) => [b.deck, b.bits, b.ones, b.neighbors === undefined ? b.neighbours : b.neighbors, b.pass]));
  const out = [];
  if(p.H.bits.join("") !== r.D.bits) out.push("grid H");
  if(p.A.bits.join("") !== r.C.bits) out.push("grid A");
  if(p.F.bits.join("") !== r.E.bits) out.push("grid F");
  for(const [a, b, n] of [[p.H.marks, r.D.marks, "H"], [p.A.marks, r.C.marks, "A"], [p.F.marks, r.E.marks, "F"]]) for(const k of ["M", "R", "K"]) if(a[k] !== b[k]) out.push(k + "(" + n + ")");
  if(p.H.phrase !== r.D.phrase.join(" ") || p.A.phrase !== r.C.phrase.join(" ") || p.F.phrase !== r.E.phrase.join(" ")) out.push("phrases");
  if(JSON.stringify(p.F.handWords) !== JSON.stringify(r.E.handWords)) out.push("hand words");
  if(JSON.stringify(p.F.seal) !== JSON.stringify(r.E.seal) || p.F.finalWordInBlock !== r.E.finalWordInBlock) out.push("seal / range");
  if(bias(p.H.bias) !== bias(r.bias.dice)) out.push("dice bias box");
  if(cb(p.A.bias) !== cb(r.bias.cards)) out.push("card bias boxes");
  return out;
}

// ---------- 1. the worked examples
const WANT = { 1: ["kick confirm home few coin pencil praise burst business fix credit sword", "70b5da37"],
  2: ["legal winner thank year wave sausage worth useful legal winner thank yellow", "b8688df1"], 3: [null, "116ab0ba"] };
const exRes = [];
for(const e of ex){
  const dice = pairsOf(e.dice), r = refForge(e.words, dice, e.cards), p = await pageForge(e.words, dice, e.cards);
  const diff = sameAsRef(p, r);
  check("worked example " + e.id + " (" + e.words + " words): the page equals the reference code in every grid, hallmark, word, range and bias box", diff.length === 0, diff.join(", "));
  check("worked example " + e.id + ": words valid (@scure/bip39) and the documented result" + (WANT[e.id][0] ? " (" + WANT[e.id][0].split(" ").slice(0, 3).join(" ") + " ...)" : ""), bip39.validateMnemonic(p.F.phrase, wordlist) && (!WANT[e.id][0] || p.F.phrase === WANT[e.id][0]));
  const fp = await w.mnemonicFingerprint(p.F.phrase, ""), ad = await w.firstAddressOn("main", p.F.phrase, "");
  check("worked example " + e.id + ": fingerprint " + WANT[e.id][1] + " and first address equal @scure/bip32, @scure/btc-signer and the reference code", fp === WANT[e.id][1] && fp === fpOf(p.F.phrase) && fp === r.wallet.fingerprint && ad === addrOf(p.F.phrase) && ad === r.wallet.firstAddressBIP84, fp + " " + ad);
  exRes.push({ e, p, r, dice, fp, ad });
}

// ---------- 2. random sheets, Seed XOR, linearity
for(const words of [12, 24]){
  let bad = [], xorBad = 0, linBad = 0, fpBad = 0, rangeBad = 0;
  for(let t = 0; t < N; t++){
    const s = randomSheet(words), r = refForge(words, s.dice, s.cards), p = await pageForge(words, s.dice, s.cards);
    const d = sameAsRef(p, r); if(d.length) bad.push(t + ": " + d.join(","));
    if(p.F.phrase !== bip39.entropyToMnemonic(w.dmBytes(p.F.bits), wordlist)) bad.push(t + ": @scure/bip39 words");
    // the assay: each sheet's own phrase is valid, and the two are a Seed XOR pair for the seed
    try { const x = xorB(ent(p.H.phrase), ent(p.A.phrase)); if(bip39.entropyToMnemonic(x, wordlist) !== p.F.phrase) xorBad++; } catch(e) { xorBad++; }
    for(const k of ["M", "R", "K"]) if(w.dmXorStr(p.H.marks[k], p.A.marks[k]) !== p.F.marks[k]) linBad++;
    const fi = wordlist.indexOf(p.F.phrase.split(" ")[words - 1]), last = p.F.handWords[p.F.handWords.length - 1];
    if(!p.F.finalWordInBlock || fi.toString(2).padStart(11, "0").slice(0, vf.PLAN[words].finalBits) !== last.bits) rangeBad++;
    if(t % 50 === 0 && (await w.mnemonicFingerprint(p.F.phrase, "")) !== fpOf(p.F.phrase)) fpBad++;
  }
  check(N + " random " + words + "-word sheets: the page equals the reference code and @scure/bip39 everywhere", bad.length === 0, bad.slice(0, 3).join(" | "));
  check(N + " random " + words + "-word sheets: the Hammer and Anvil phrases are valid and XOR to the seed (Seed XOR, @scure/bip39)", xorBad === 0, xorBad + " bad");
  check(N + " random " + words + "-word sheets: hallmarks are linear, M(H) xor M(A) = M(F), and R and K too", linBad === 0, linBad + " bad");
  check(N + " random " + words + "-word sheets: the last word starts with the sheet's " + vf.PLAN[words].finalBits + " bits, inside the hand range", rangeBad === 0, rangeBad + " bad");
  check("random " + words + "-word sheets: every 50th fingerprint equals @scure/bip32", fpBad === 0, fpBad + " bad");
}
{ // linearity on any grids, and the hallmarks against their definition
  let bad = 0;
  for(let t = 0; t < 500; t++){
    const n = t % 2 ? 256 : 128, x = [...randomBytes(n)].map((b) => b & 1), y = [...randomBytes(n)].map((b) => b & 1), z = xorB(x, y);
    const mx = w.dmMarks(x), my = w.dmMarks(y), mz = w.dmMarks(z), rx = vf.marks(x);
    for(const k of ["M", "R", "K"]) if(w.dmXorStr(mx[k], my[k]) !== mz[k] || mx[k] !== rx[k]) bad++;
    const r0 = Math.floor(randomInt(n) / 11), c0 = randomInt(Math.min(11, n - r0 * 11));
    if(w.dmMarks(x).K[(r0 + c0) % 11] === w.dmMarks(x.map((b, i) => i === r0 * 11 + c0 ? b ^ 1 : b)).K[(r0 + c0) % 11]) bad++;
  }
  check("hallmarks on 500 random grids: linear, equal to the reference code, and the skew hallmark letter of cell (r, c) is (r + c) mod 11", bad === 0, bad + " bad");
}
{ // the mirror table and the knockout from their written rules
  let bad = 0;
  for(let a = 1; a <= 6; a++) for(let b = 1; b <= 6; b++) if(w.dmMirror(a, b) !== vf.mirrorCode(a, b)) bad++;
  const codes = new Set(); for(let a = 1; a <= 6; a++) for(let b = 1; b <= 6; b++){ const c = w.dmMirror(a, b); if(c !== null) codes.add(c); }
  for(let t = 0; t < 2000; t++){ const v = Array.from({ length: 52 }, (_, i) => i).sort(() => 0).map((x) => x); for(let i = 51; i > 0; i--){ const j = randomInt(i + 1); [v[i], v[j]] = [v[j], v[i]]; } if(w.dmKnockout(v.slice(0, 8)).join("") !== vf.knockout(v.slice(0, 8)).join("") || w.dmKnockout(v.slice(0, 4)).join("") !== vf.knockout(v.slice(0, 4)).join("")) bad++; }
  check("mirror table: 36 cells as the reference, 32 different 5-bit codes; 2,000 knockouts as the reference", bad === 0 && codes.size === 32, bad + " bad, " + codes.size + " codes");
  check("deck plans: 3 decks for 12 words, 6 for 24, as the reference", JSON.stringify(w.dmCardPlan(128)) === JSON.stringify(vf.cardPlan(128)) && JSON.stringify(w.dmCardPlan(256)) === JSON.stringify(vf.cardPlan(256)));
}

// ---------- 3. the screen: Check my sheets, the assay, mismatches
const set = (id, v) => { $(id).value = v; $(id).dispatchEvent(new w.Event("input", { bubbles: true })); };
const who = (v) => { $("dmWho").value = v; $("dmWho").dispatchEvent(new w.Event("change", { bubbles: true })); };
const words = (n) => { $("wordSel").value = String(n); $("wordSel").dispatchEvent(new w.Event("change", { bubbles: true })); };
w.setMethod("damascus");
check("the Damascus tab opens its box and says what it needs", w.document.body.classList.contains("m-damascus") && $("mt-damascus").getAttribute("aria-selected") === "true" && $("dmBox").open && /26 good dice pairs and 3 shuffled decks/.test($("lenNote").textContent), $("lenNote").textContent);
const E1 = exRes[0], E3 = exRes[2];
w.confirm = () => true;   // the questions before an assay, a practice sheet and a mismatched forge (each one is tested below)
// a random sheet of our own (not public), for FORGE SEED
const RS = randomSheet(12), RSref = refForge(12, RS.dice, RS.cards), RSdice = RS.dice.map((p) => p.join("")).join(" "), RScards = pageCards(RS.cards.map((d) => d.join(" ").replace(/T/g, "10")));
set("dmDice", RSdice); set("dmCards", RScards);
check("both sheets typed (a sheet of our own): CHECK MY SHEETS and FORGE SEED turn on, no PRACTICE", !$("dmCheckBtn").disabled && !$("dmBtn").disabled && $("dmPracticeBan").style.display === "none", $("dmCount").textContent + " / " + $("dmMsg").textContent);
set("dmDice", E1.e.dice); set("dmCards", pageCards(E1.e.cards));
check("review M2: worked example 1 typed by hand is recognized by its content: PRACTICE shows and FORGE SEED stays off", !$("dmCheckBtn").disabled && $("dmBtn").disabled && /PRACTICE: worked example 1 is public/.test($("dmPracticeBan").textContent), $("dmPracticeBan").textContent);
{ const d = E1.e.dice.replace("26 53", "2 53"); set("dmDice", d);
  check("review M1: a pair typed with one throw stops the check (Pair 3 is missing a throw); nothing is paired up again", $("dmCheckBtn").disabled && $("dmBtn").disabled && /^Pair 3 is missing a throw\. Write each pair as two numbers/.test($("dmMsg").textContent), $("dmMsg").textContent);
  set("dmDice", "14 15 2"); check("review M1: the last pair with one throw: Pair 3 is missing a throw, tap or type the second", $("dmCheckBtn").disabled && $("dmMsg").textContent === "Pair 3 is missing a throw. Tap or type its second throw.", $("dmMsg").textContent);
  set("dmDice", "14 1526"); check("review M1: three or more throws in one pair are refused", $("dmCheckBtn").disabled && /^Pair 2 \(“1526”\) has more than two throws/.test($("dmMsg").textContent), $("dmMsg").textContent);
  set("dmDice", E1.e.dice.replace(/ /g, ", ").replace(/(\d)(\d)/g, "$1-$2")); check("pairs written 1-4, with commas, still work", !$("dmCheckBtn").disabled && !$("dmMsg").textContent, $("dmMsg").textContent);
  set("dmDice", E1.e.dice); }
await w.dmCheck();
let out = $("dmOut").textContent;
check("check: shows grids H, A and F, the seal, the range, the last word, fingerprint and first address", /Hammer sheet \(grid H\)/.test(out) && /Forge sheet/.test(out) && out.includes("M(F) " + E1.p.F.marks.M) && out.includes("Last word sword. Master fingerprint 70b5da37") && out.includes(E1.ad) && /between \w+ \(\d+\) and \w+ \(\d+\)/.test(out), out.slice(-400));
check("check: with nothing typed under What I wrote, it says how to have it checked", /Type your hallmarks and words/.test(out));
// what the person wrote: right, then one cell wrong in grid F
const F = E1.p.F.bits;
set("dmFM", E1.p.F.marks.M); set("dmFR", E1.p.F.marks.R); set("dmHM", E1.p.H.marks.M); set("dmAR", E1.p.A.marks.R); set("dmWords", E1.p.F.phrase);
check("a change under What I wrote clears the old result", $("dmOut").style.display === "none" && !$("dmOut").textContent);
await w.dmCheck(); out = $("dmOut").textContent;
check("check: right hallmarks and words say they match", /What you wrote matches\./.test(out), out.slice(-200));
let cellBad = [];
for(let t = 0; t < 40; t++){
  const i = randomInt(128), r = Math.floor(i / 11), c = i % 11, m = w.dmMarks(F.map((b, k) => k === i ? b ^ 1 : b));
  set("dmFM", m.M); set("dmFR", m.R); await w.dmCheck(); out = $("dmOut").textContent;
  if(!out.includes("One box is most likely wrong: row " + (r + 1) + ", column " + (c + 1) + ": the Forge box should be " + F[i] + " (Hammer " + E1.p.H.bits[i] + ", Anvil " + E1.p.A.bits[i] + ").")) cellBad.push(i);
}
check("one wrong cell in grid F (40 random cells): the mistake finder names the box and what it should be (Hammer and Anvil bits)", cellBad.length === 0, "cells " + cellBad.join(","));
{ // the Hammer and Anvil grids: the run, the pair box or the match
  set("dmFM", E1.p.F.marks.M); set("dmFR", E1.p.F.marks.R);
  const goodIdx = E1.dice.map((p, k) => vf.mirrorCode(p[0], p[1]) !== null ? k : -1).filter((k) => k >= 0);
  let bad = [];
  for(let t = 0; t < 20; t++){
    const i = randomInt(128), r = Math.floor(i / 11) + 1, c = i % 11 + 1;
    const mh = w.dmMarks(E1.p.H.bits.map((b, k) => k === i ? b ^ 1 : b)); set("dmHM", mh.M); set("dmHR", mh.R); await w.dmCheck(); out = $("dmOut").textContent;
    const k = goodIdx[Math.floor(i / 5)], pp = E1.dice[k];
    if(!out.includes("row " + r + ", column " + c + " of the Hammer grid should be " + E1.p.H.bits[i] + ". It is bit " + (i % 5 + 1) + " of run " + (Math.floor(i / 5) + 1) + ": pair box " + (k + 1) + ", " + pp[0] + "-" + pp[1] + ", gives " + vf.bin(vf.mirrorCode(pp[0], pp[1]), 5) + ".")) bad.push("H" + i);
    set("dmHM", ""); set("dmHR", "");
    const ma = w.dmMarks(E1.p.A.bits.map((b, k) => k === i ? b ^ 1 : b)); set("dmAM", ma.M); set("dmAR", ma.R); await w.dmCheck(); out = $("dmOut").textContent;
    let at = 0, run = ""; vf.cardPlan(128).forEach((gs, d) => gs.forEach((n, o) => { if(!run && i < at + n - 1) run = "run " + (d + 1) + (n === 8 ? "." + (o + 1) : "q") + ", match " + (i - at + 1); at += n - 1; }));
    if(!out.includes("row " + r + ", column " + c + " of the Anvil grid should be " + E1.p.A.bits[i] + ". It is " + run + ".")) bad.push("A" + i);
    set("dmAM", ""); set("dmAR", "");
  }
  check("one wrong box in the Hammer or Anvil grid (20 each): the mistake finder names the run and the pair box or the match", bad.length === 0, bad.join(","));
  const m = E1.p.F.marks.R, oneRow = m.slice(0, 5) + (m[5] === "1" ? "0" : "1") + m.slice(6); set("dmFR", oneRow); await w.dmCheck(); out = $("dmOut").textContent;
  check("only one row hallmark off: most likely that row hallmark was miscounted", out.includes("Row 6 of the Forge grid is off but every column checks out: most likely a row hallmark was miscounted."), out.slice(-300));
  set("dmFR", E1.p.F.marks.R); }
set("dmFM", E1.p.F.marks.M); set("dmFR", E1.p.F.marks.R);
{ const ws = E1.p.F.phrase.split(" "); ws[4] = "zoo"; set("dmWords", ws.join(" ")); await w.dmCheck(); out = $("dmOut").textContent;
  const right = E1.p.F.phrase.split(" ");
  check("a wrong word: the mistake finder names it, the right word and where to look it up", out.includes("Word 5: you wrote zoo; row 5 (" + E1.p.F.handWords[4].bits + ") gives " + right[4] + ". Look it up again: block "), out.slice(-300));
  ws[4] = wordlist[wordlist.indexOf(right[4]) + 1]; set("dmWords", ws.join(" ")); await w.dmCheck(); out = $("dmOut").textContent;
  check("a word next to the right one in the table: the mistake finder says so", out.includes("Word 5: you wrote " + ws[4] + ", the word next to " + right[4] + " in the table."), out.slice(-300));
  ws[4] = right[2]; set("dmWords", ws.join(" ")); await w.dmCheck(); out = $("dmOut").textContent;
  check("a word copied from another row: the mistake finder says words may be swapped", out.includes("Word 5: you wrote " + right[2] + ", which is word 3. Words may be swapped or copied twice"), out.slice(-300));
  ws[4] = right[4]; ws[11] = "abandon"; set("dmWords", ws.join(" ")); await w.dmCheck(); out = $("dmOut").textContent;
  check("a wrong last word: the check names it", out.includes("Your word 12 is abandon; the last word is sword."), out.slice(-300)); }
{ const m = E1.p.H.marks.M, bad = m.slice(0, 3) + (m[3] === "1" ? "0" : "1") + m.slice(4); set("dmWords", ""); set("dmHM", bad); await w.dmCheck(); out = $("dmOut").textContent;
  check("a wrong column hallmark on the Hammer sheet: the check names the column", out.includes("Your column hallmark M(H) differs in column 4."), out.slice(-300)); set("dmHM", ""); }
$("dmSkew").checked = true; $("dmSkew").dispatchEvent(new w.Event("change")); set("dmFK", E1.p.F.marks.K.replace(/^./, (x) => x === "1" ? "0" : "1")); await w.dmCheck(); out = $("dmOut").textContent;
check("skew hallmark K: shown when chosen, and a wrong letter is named by its letter (a to k, as on the sheet)", out.includes("Skew hallmark K(F) " + E1.p.F.marks.K) && out.includes("Your skew hallmark K(F) differs in letter a."), out.slice(-300));
$("dmSkew").checked = false; $("dmSkew").dispatchEvent(new w.Event("change")); await w.dmCheck(); out = $("dmOut").textContent;
check("review L3: a K typed without the tick is checked too", out.includes("Your skew hallmark K(F) differs in letter a."), out.slice(-300));
set("dmFK", "");
{ // review L3: the other mistake-finder messages
  const ws = E1.p.F.phrase.split(" "); ws[2] = "hxme"; set("dmWords", ws.join(" ")); await w.dmCheck(); out = $("dmOut").textContent;
  check("review L3: a word that is not a BIP39 word is named, and the words after it are not shifted", out.includes("Your word 3 (hxme) is not a BIP39 word") && !/Word \d+: you wrote/.test(out), out.slice(-300));
  set("dmWords", E1.p.F.phrase.split(" ").slice(0, 5).join(" ")); await w.dmCheck(); out = $("dmOut").textContent;
  check("review L3: only 5 of 12 words typed: it says words 6 to 12 are not checked", out.includes("You typed 5 of the 12 words: words 6 to 12 are not checked.") && !/What you wrote matches/.test(out), out.slice(-300));
  set("dmWords", ""); set("dmHM", "1102"); await w.dmCheck(); out = $("dmOut").textContent;
  check("review L3: a hallmark with another digit is named in plain grammar", out.includes("Your column hallmark M(H) has a digit other than 1 and 0."), out.slice(-300)); set("dmHM", ""); }
// the assay: one sheet only
for(const [k, name, s, other] of [["h", "Hammer", "H", "A"], ["a", "Anvil", "A", "H"]]){
  who("both"); set("dmDice", E1.e.dice); set("dmCards", pageCards(E1.e.cards)); who(k);
  check("review L1: choosing the " + name + " assay clears the other sheet's box", k === "h" ? !$("dmCards").value && !!$("dmDice").value : !$("dmDice").value && !!$("dmCards").value);
  check("assay " + name + ": only that sheet's box shows, FORGE SEED is hidden", ($("dmDiceRow").style.display === "none") === (k === "a") && ($("dmCardsRow").style.display === "none") === (k === "h") && $("dmBtn").style.display === "none" && $("dmMineF").style.display === "none");
  await w.dmCheck(); out = $("dmOut").textContent;
  const mine = E1.p[s], theirs = E1.p[other], fw = E1.p.F.phrase.split(" ");
  check("assay " + name + ": its grid, hallmarks, bias box and its own Seed XOR phrase", out.includes("Assay of the " + name + " sheet") && out.includes("M(" + s + ") " + mine.marks.M) && mine.phrase.split(" ").every((x, i) => out.includes(String(i + 1).padStart(2) + ". " + x)) && /Bias box/.test(out), out.slice(0, 300));
  check("assay " + name + ": shows no grid F, no seed words, no fingerprint and nothing of the other sheet", !/Forge sheet|grid F:|fingerprint/i.test(out.replace("grid F are not shown", "")) && !out.includes(theirs.marks.M) && !out.includes(" " + fw.slice(0, 3).join(" ")) && !out.includes(E1.fp), out.slice(-300));
}
// the phrases on the two assay screens XOR to the seed
{ const read = async (k) => { who("both"); set("dmDice", E1.e.dice); set("dmCards", pageCards(E1.e.cards)); who(k); await w.dmCheck(); return [...$("dmOut").querySelectorAll("pre")].pop().textContent.split("\n").map((l) => l.replace(/^\s*\d+\.\s/, "")).join(" "); };
  const pH = await read("h");
  w.document.getElementById("dmFM").value = "0"; await w.dmCheck();
  check("review L3: in an assay, a Forge box that is not shown does not count as written", /Type your hallmarks and words/.test($("dmOut").textContent) && !/What you wrote matches/.test($("dmOut").textContent));
  w.document.getElementById("dmFM").value = "";
  const pA = await read("a"); who("both"); set("dmDice", E1.e.dice);
  check("the two assay screens' phrases are valid and Seed-XOR to worked example 1's seed (@scure/bip39)", bip39.entropyToMnemonic(xorB(ent(pH), ent(pA)), wordlist) === E1.p.F.phrase, pH + " / " + pA); }
// grid A typed as bits (no card record)
set("dmCards", E1.p.A.bits.join("").replace(/(.{11})/g, "$1 ")); await w.dmCheck(); out = $("dmOut").textContent;
check("grid A typed as 1s and 0s: the same seed; neighbors are not checked", out.includes("Master fingerprint 70b5da37") && /neighbors not checked \(no card record\)/.test(out), out.slice(-300));
set("dmCards", pageCards(E1.e.cards));
// bad input
set("dmDice", "14 15 27"); check("a 7 is not a die face", /“7” is not a die face/.test($("dmMsg").textContent) && $("dmCheckBtn").disabled);
set("dmDice", "14 15 26"); check("too few dice pairs: CHECK stays off and the count says so", $("dmCheckBtn").disabled && /Hammer: 3 pairs, 3 of 26 good pairs/.test($("dmCount").textContent), $("dmCount").textContent);
set("dmDice", E1.e.dice);
{ const c = E1.e.cards.map((d) => d.split(" ")); c[1][5] = c[1][4]; set("dmCards", c.map((d) => d.join(" ")).join("\n")); await w.dmCheck();
  check("a card twice in one deck is refused", /Deck 2 has the .+ twice \(cards 5 and 6\)/.test($("dmMsg").textContent), $("dmMsg").textContent); }
{ const c = E1.e.cards.map((d) => d.split(" ")); c[0] = c[0].slice(1);
  set("dmCards", c.map((d) => d.join(" ")).join("\n"));
  check("review L15: one deck a line, the first card of deck 1 left out: deck 1 has 51 cards, a card is missing", $("dmCheckBtn").disabled && /^Deck 1 \(line 1\) has 51 cards; a deck has 52\. A card is missing from it\./.test($("dmMsg").textContent), $("dmMsg").textContent);
  set("dmCards", c.map((d) => d.join(" ")).join(" ")); await w.dmCheck();
  check("review L15: all on one line, the same mistake: it says a card may be missing (not only a double card)", /^Deck 1 has the .+ twice \(cards \d+ and 52\)\. One shuffled deck has each card once: a card may be missing before card 52/.test($("dmMsg").textContent), $("dmMsg").textContent); }
{ const c = E1.e.cards.map((d) => d.split(" ")); c[2] = c[2].slice(0, 43); set("dmCards", c.map((d) => d.join(" ")).join("\n"));
  check("the last deck short of a card: CHECK stays off", $("dmCheckBtn").disabled && /deck 3 43\/44/.test($("dmCount").textContent), $("dmCount").textContent);
  c[2] = E1.e.cards[2].split(" ").slice(0, 44); set("dmCards", c.map((d) => d.join(" ")).join("\n"));
  check("the last deck with only the 44 cards it uses is enough", !$("dmCheckBtn").disabled, $("dmMsg").textContent); }
set("dmCards", pageCards(E1.e.cards) + " 4D"); check("53 cards in the last deck are refused", $("dmCheckBtn").disabled && /Too many cards: the last deck has 53 cards/.test($("dmMsg").textContent), $("dmMsg").textContent);
set("dmCards", pageCards(E1.e.cards).replace(/9D/, "9X")); check("a card that is not a card is named", /“9X” is not a card/.test($("dmMsg").textContent), $("dmMsg").textContent);
set("dmCards", pageCards(E1.e.cards).replace(/\n/g, "  ").replace(/T/g, "10").replace(/S/g, "♠"));
check("one line, 10 for T and suit symbols work too", !$("dmCheckBtn").disabled, $("dmMsg").textContent);
words(15); check("15 words: the Damascus method says it makes 12 or 24 words, and prints only the word table", /12 or 24 words/.test($("dmMsg").textContent) && $("dmCheckBtn").disabled && $("dmPrintH").disabled && !$("dmPrintT").disabled);
words(24); set("dmDice", E3.e.dice); set("dmCards", pageCards(E3.e.cards)); await w.dmCheck(); out = $("dmOut").textContent;
check("24 words (worked example 3): the check gives its fingerprint and address", out.includes("Master fingerprint 116ab0ba") && out.includes(E3.ad) && /52 good dice pairs and 6 shuffled decks/.test($("lenNote").textContent));
words(12); set("dmDice", E1.e.dice); set("dmCards", pageCards(E1.e.cards));

// ---------- 4. the bias boxes
{ // the reference code's numbers on random and on biased dice and decks
  let bad = 0;
  for(let t = 0; t < 3000; t++){
    const words = t % 2 ? 24 : 12, bias = t % 3, dice = [];
    while(dice.length < 70){ const f = () => bias === 1 && randomInt(3) === 0 ? 6 : bias === 2 && dice.length && randomInt(2) ? dice[dice.length - 1][1] : 1 + randomInt(6); dice.push([f(), f()]); }
    const a = w.dmDiceBias(dice, words), b = vf.diceBias(dice, words);
    if(JSON.stringify([a.throws, a.counts, a.repeats, a.pass, a.fail.length]) !== JSON.stringify([b.throws, b.counts, b.repeats, b.pass, b.fail.length])) bad++;
  }
  for(let t = 0; t < 600; t++){
    const words = t % 2 ? 24 : 12, plan = vf.cardPlan(vf.PLAN[words].bits);
    const decks = plan.map(() => { const d = Array.from({ length: 52 }, (_, i) => i), k = randomInt(4); for(let i = 51; i > 0; i--){ if(k && randomInt(k + 1)) continue; const j = randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; } return d.map(vf.cardName); });
    const rc = vf.cardsToBits(decks, vf.PLAN[words].bits), pr = w.dmCardBits(w.dmParseCards(pageCards(decks), words).decks, vf.PLAN[words].bits);
    const a = w.dmCardBias(pr.log, words), b = vf.cardBias(rc.log, words);
    if(JSON.stringify(a.map((x) => [x.ones, x.neighbors, x.pass, x.fail.length])) !== JSON.stringify(b.map((x) => [x.ones, x.neighbours, x.pass, x.fail.length]))) bad++;
  }
  check("bias boxes on 3,000 dice runs (fair, loaded and lazy) and 600 card sets (shuffled and barely shuffled): the reference code's counts and verdicts", bad === 0, bad + " bad");
}
{ // the thresholds at their edges: dice
  const run = (counts, words) => { const th = []; counts.forEach((n, f) => { for(let i = 0; i < n; i++) th.push(f + 1); }); for(let i = th.length - 1; i > 0; i--){ const j = randomInt(i + 1); [th[i], th[j]] = [th[j], th[i]]; } const p = []; for(let i = 0; i < th.length; i += 2) p.push([th[i], th[i + 1]]); return p; };
  const verdict = (b, re) => b.fail.some((f) => re.test(f));
  let ok = true;
  for(const [words, hi, lo] of [[12, 18, 1], [24, 29, 6]]){
    const n = words === 12 ? 52 : 104, rest = (k, fixed) => { const c = [0, 0, 0, 0, 0, 0]; c[0] = fixed; let left = n - fixed; for(let f = 1; left > 0; f = f % 5 + 1){ c[f]++; left--; } return c; };
    for(let t = 0; t < 30; t++){
      ok = ok && verdict(w.dmDiceBias(run(rest(0, hi), words), words), /came up \d+ times \(fail at/) && !verdict(w.dmDiceBias(run(rest(0, hi - 1), words), words), /came up \d+ times \(fail at/);
      ok = ok && verdict(w.dmDiceBias(run(rest(0, lo), words), words), /only \d+ times? \(fail at/) && !verdict(w.dmDiceBias(run(rest(0, lo + 1), words), words), /only \d+ times? \(fail at/);
    }
  }
  const rep = (words, k) => { const p = []; let last = 0; for(let i = 0; i < (words === 12 ? 26 : 52); i++){ const a = (last % 6) + 1, b = (a % 6) + 1; p.push([a, b]); last = b; } let made = 0; for(let i = 0; i < p.length && made < k; i++){ p[i][1] = p[i][0]; made++; } return p; };
  ok = ok && !w.dmDiceBias(rep(12, 2), 12).pass && w.dmDiceBias(rep(12, 2), 12).repeats === 2 && w.dmDiceBias(rep(12, 3), 12).fail.every((f) => !/repeats/.test(f)) && !w.dmDiceBias(rep(24, 7), 24).pass && w.dmDiceBias(rep(24, 8), 24).fail.every((f) => !/repeats/.test(f));
  check("dice bias box edges: a face 18 times fails and 17 does not (24 words: 29 and 28), 1 time fails and 2 does not (24 words: 6 and 7), 2 repeats fail and 3 do not (24 words: 7 and 8)", ok);
  // cards: a deck in the method's own order gives all 1s; neighbors at 6 fail and 5 do not
  const sorted = Array.from({ length: 52 }, (_, i) => i);
  const b1 = w.dmCardBias([{ deck: 1, groups: [0, 1, 2, 3, 4, 5].map((g) => ({ cards: sorted.slice(g * 8, g * 8 + 8), bits: w.dmKnockout(sorted.slice(g * 8, g * 8 + 8)).join("") })).concat([{ cards: sorted.slice(48, 52), bits: w.dmKnockout(sorted.slice(48, 52)).join("") }]) }], 12);
  const nb = (k) => { const v = [0, 4, 8, 12, 16, 20, 24, 28].slice(0, k + 1).concat([1, 33, 50, 23, 46, 39, 30].slice(0, 7 - k)); return w.dmCardBias([{ deck: 1, groups: [{ cards: v, bits: "0000000" }] }], 12)[0]; };
  check("card bias box edges: a sorted deck fails (45 ones), 6 neighbors fail and 5 do not", !b1[0].pass && b1[0].ones === 45 && nb(6).neighbors === 6 && !nb(6).pass && nb(5).neighbors === 5 && nb(5).pass, JSON.stringify([b1[0], nb(6), nb(5)]));
}

// ---------- 4b. practice, the worked examples, the backup recheck
{ const src = readHtml(); check("the page uses no random-number generator (no Math.random, no getRandomValues): practice sheets come from a published rule", !/Math\.random|getRandomValues/.test(src)); }
{
  // practice sheet N, rebuilt here from the rule written on the page (SHA-256 of "VOIDFORGE Damascus practice N block k", 32-bit draws, rejection)
  const { createHash } = await import("node:crypto");
  const sheetOf = (n, words) => { let block = 0, buf = Buffer.alloc(0), at = 0;
    const draw = (m) => { const lim = Math.floor(4294967296 / m) * m; for(;;){ if(at + 4 > buf.length){ buf = createHash("sha256").update("VOIDFORGE Damascus practice " + n + " block " + block++).digest(); at = 0; } const v = buf.readUInt32BE(at); at += 4; if(v < lim) return v % m; } };
    const pairs = []; let good = 0; while(good < Math.ceil(vf.PLAN[words].bits / 5)){ const a = 1 + draw(6), b = 1 + draw(6); pairs.push(a + "" + b); if(vf.mirrorCode(a, b) !== null) good++; }
    const decks = vf.cardPlan(vf.PLAN[words].bits).map(() => { const d = []; for(const su of "CDHS") for(const r of "A23456789TJQK") d.push(r + su); for(let i = 51; i > 0; i--){ const j = draw(i + 1); [d[i], d[j]] = [d[j], d[i]]; } return d.map((c) => (c[0] === "T" ? "10" : c[0]) + c[1]).join(" "); });
    return { dice: pairs.join(" "), cards: decks.join("\n") }; };
  words(12); await w.dmPracticeFill();
  const want1 = sheetOf(1, 12);
  check("practice: PRACTICE fills in practice sheet 1, exactly as its published rule makes it (rebuilt here with node:crypto)", $("dmDice").value === want1.dice && $("dmCards").value === want1.cards);
  const pairs = w.dmParseDice($("dmDice").value).pairs, decks = w.dmParseCards($("dmCards").value, 12).decks;
  check("practice: 26 good pairs and 3 decks of 52 different cards", w.dmDiceBits(pairs, 128).good === 26 && decks.length === 3 && decks.every((d) => new Set(d).size === d.length && d.length === 52));
  check("practice: a PRACTICE banner shows and FORGE SEED is off", $("dmPracticeBan").style.display !== "none" && /PRACTICE: practice 1 comes from a published rule/.test($("dmPracticeBan").textContent) && $("dmBtn").disabled && !$("dmCheckBtn").disabled, $("dmPracticeBan").textContent);
  await w.dmCheck(); out = $("dmOut").textContent;
  check("practice: every part of the result says PRACTICE", /^PRACTICE: practice 1 comes from/.test(out) && /PRACTICE: Hammer sheet/.test(out) && /PRACTICE: Anvil sheet/.test(out) && /PRACTICE: Forge sheet/.test(out) && /PRACTICE: Last word/.test(out));
  const had = w.hasSeed(); await w.dmGenerate();
  check("practice: FORGE SEED never makes a seed from practice dice and cards", !had && !w.hasSeed());
  // LOAD INTO THE PRACTICE SIGNER: the practice signer's hook (tools/simulator/ss_learn.js) is in the page; its whole path, Scan on
  // the device included, is driven in Chromium by tests/simulator.test.mjs (scenario damascus). Here: what it takes and refuses.
  const hook = w.vfSignerLoadSeed, ph1 = $("dmOut").dataset.practicePhrase;
  check("practice: the practice signer's hook vfSignerLoadSeed is in the page", typeof hook === "function");
  check("practice: vfSignerLoadSeed refuses anything but the practice result on the tab (another phrase, a changed one, no phrase)", ["abandon ".repeat(11) + "about", ph1 + " ", ph1.split(" ").slice(1).join(" "), null, ""].every((m) => hook(m) === false) && !$("ssBox").open);
  w.vfSignerLoadSeed = undefined; $("dmSignerBtn").click();
  check("practice: without the practice signer, LOAD INTO THE PRACTICE SIGNER says how to type the words in", /practice signer, and choose Seeds > Load a seed > Enter 12-word seed/.test($("dmSignerNote").textContent), $("dmSignerNote").textContent);
  let got = null; w.vfSignerLoadSeed = (m) => { got = m; return true; }; $("dmSignerBtn").click();
  check("practice: the practice words go to the hook, and the note says to choose Scan on the device", got && got === ph1 && got.split(" ").length === 12 && /Choose Scan on the device\./.test($("dmSignerNote").textContent), $("dmSignerNote").textContent);
  w.vfSignerLoadSeed = () => false; $("dmSignerBtn").click();
  check("practice: a refusal by the hook is said plainly", /^Not loaded: only a practice seed/.test($("dmSignerNote").textContent));
  w.vfSignerLoadSeed = hook;
  set("dmDice", $("dmDice").value + " 12");
  check("practice: an edit that keeps the same seed (a pair after the grid is full) still says PRACTICE, by content", $("dmBtn").disabled && $("dmPracticeBan").style.display !== "none" && /practice 1 comes from a published rule/.test($("dmPracticeBan").textContent), $("dmPracticeBan").textContent);
  { const keepC = $("dmCards").value, keepD = $("dmDice").value; set("dmDice", RSdice);
    check("review M4: real dice in place of the practice dice: PRACTICE ends at once", $("dmPracticeBan").style.display === "none" && w.eval("dmPractice") === "");
    set("dmCards", RScards); await w.dmCheck();
    check("review M4: then real cards: no PRACTICE anywhere, no practice phrase kept, FORGE SEED on, and the practice signer hook refuses", !/PRACTICE/.test($("dmOut").textContent) && !$("dmOut").dataset.practicePhrase && !$("dmBtn").disabled && w.vfSignerLoadSeed(RSref.E.phrase.join(" ")) === false && !$("dmSignerBtn"));
    set("dmDice", keepD); set("dmCards", keepC);
    check("review M2: the practice sheet's dice and cards typed back: PRACTICE again, by content", $("dmBtn").disabled && /practice 1 comes from a published rule/.test($("dmPracticeBan").textContent)); }
  set("dmDice", ""); set("dmCards", "");
  check("practice: emptying both boxes ends PRACTICE", $("dmPracticeBan").style.display === "none" && w.eval("dmPractice") === "");
  check("practice: after PRACTICE ends, vfSignerLoadSeed refuses the practice words too", w.vfSignerLoadSeed(ph1) === false);
  { let asked = ""; set("dmDice", RSdice); w.confirm = (m) => { asked = m; return false; }; await w.dmPracticeFill(); w.confirm = () => true;
    check("review L14: PRACTICE asks before it replaces dice you typed, and No keeps them", /This replaces what you typed in the Damascus boxes/.test(asked) && $("dmDice").value === RSdice, asked); set("dmDice", ""); set("dmCards", ""); }
  // review M2 and L9: practice sheets 1 to 100 of both lengths, made again here from the published rule and folded with the
  // reference code, are all known public phrases, as are the three worked examples
  { let bad = [];
    for(const n of [12, 24]) for(let k = 1; k <= 100; k++){ const s = sheetOf(k, n), r = vf.diceToBits(pairsOf(s.dice), vf.PLAN[n].bits), c = vf.cardsToBits(s.cards.split("\n").map((d) => d.split(" ").map((x) => x.replace("10", "T"))), vf.PLAN[n].bits);
      const ph = bip39.entropyToMnemonic(Uint8Array.from(vf.bitsToBytes ? vf.bitsToBytes(r.bits.map((x, i) => x ^ c.bits[i])) : Buffer.from(r.bits.map((x, i) => x ^ c.bits[i]).join("").match(/.{8}/g).map((b) => parseInt(b, 2)))), wordlist);
      if(!/^a Damascus practice sheet/.test(w.knownPhrase(ph) || "")) bad.push(n + ":" + k); }
    check("review M2: practice sheets 1 to 100 (12 and 24 words), made from the published rule, are known public phrases", bad.length === 0, bad.slice(0, 5).join(" "));
    check("review M2: worked examples 1 and 3 are known public phrases (example 2 is an official BIP39 vector)", /worked example of the Damascus method/.test(w.knownPhrase(exRes[0].p.F.phrase)) && /worked example of the Damascus method/.test(w.knownPhrase(exRes[2].p.F.phrase)) && /official BIP39/.test(w.knownPhrase(exRes[1].p.F.phrase))); }
  words(24); await w.dmPracticeFill(); const want2 = sheetOf(2, 24);
  check("practice: the next press gives practice sheet 2 (24 words here), again by the rule", $("dmDice").value === want2.dice && $("dmCards").value === want2.cards && /practice 2/.test($("dmPracticeBan").textContent));
  w.dmClear(); words(12);
}
for(const n of [1, 2, 3]){
  $("dmEx" + n).click(); await w.dmCheck(); out = $("dmOut").textContent; const x = exRes[n - 1];
  check("worked example " + n + " on the page: LOAD fills the boxes, sets " + x.e.words + " words, says PRACTICE and public, and gives its words and fingerprint", w.dmWc() === x.e.words && /PRACTICE: worked example \d is public\. Never put money on it\./.test(out) && out.includes("Master fingerprint " + x.fp) && $("dmBtn").disabled && $("dmExBox").textContent.includes(x.p.F.phrase) && $("dmExBox").textContent.includes(x.fp), out.slice(0, 200));
}
check("the worked examples box says they are public and never to put money on them", /public: never put money on these/.test($("dmExBox").querySelector("summary").textContent));
w.dmClear(); words(12);
{ // Recheck a Damascus backup (CHECK A BACKUP)
  const rc = async (ws, M, R, K) => { $("dmrWords").value = ws; $("dmrM").value = M; $("dmrR").value = R; $("dmrK").value = K || ""; await w.dmRecheck(); return $("dmrOut").textContent; };
  const ph = E1.p.F.phrase, mk = E1.p.F.marks;
  check("recheck: the right words and hallmarks match", /The hallmarks match these 12 words, and the BIP39 checksum is right/.test(await rc(ph, mk.M, mk.R, mk.K)));
  check("recheck: four-letter words work too", /The hallmarks match/.test(await rc(ph.split(" ").map((x) => x.slice(0, 4)).join(" "), mk.M, mk.R)));
  let bad = [];
  for(let t = 0; t < 30; t++){
    const i = randomInt(11), ws = ph.split(" "); let nw; do nw = wordlist[randomInt(2048)]; while(nw === ws[i]); const right = ws[i]; ws[i] = nw;
    const o = await rc(ws.join(" "), mk.M, mk.R);
    if(!/most likely wrong/.test(o) || !o.includes("word " + (i + 1) + ": " + right)) bad.push(i + ":" + o.slice(0, 160));
    const o2 = await rc(ws.join(" "), mk.M, mk.R, mk.K);
    if(!o2.includes("Word " + (i + 1) + " is most likely wrong. If it is the only wrong word, the backup should read word " + (i + 1) + ": " + right)) bad.push("K" + i + ":" + o2.slice(0, 160));
  }
  check("recheck: one wrong word (30 tries) is found with the word it should be (with K: exactly that word; without K: among the few the checksum allows)", bad.length === 0, bad.slice(0, 2).join(" | "));
  { const ws = ph.split(" "); let a = 0, b = 0; for(a = 0; a < 11; a++){ for(b = a + 1; b < 11; b++) if(E1.p.F.marks.R[a] !== E1.p.F.marks.R[b]) break; if(b < 11) break; }
    [ws[a], ws[b]] = [ws[b], ws[a]]; const o = await rc(ws.join(" "), mk.M, mk.R, mk.K);
    check("recheck: two words in swapped places are named (the skew hallmark K agrees)", o.includes("Words " + (a + 1) + " and " + (b + 1) + " may be in swapped places (the skew hallmark K agrees)"), o); }
  { const ws = ph.split(" "); let a, b; outer: for(a = 0; a < 11; a++) for(b = a + 1; b < 11; b++) if(E1.p.F.marks.R[a] === E1.p.F.marks.R[b] && ws[a] !== ws[b]) break outer;
    [ws[a], ws[b]] = [ws[b], ws[a]]; const o = await rc(ws.join(" "), mk.M, mk.R, mk.K);
    check("recheck: a swap that the row hallmarks miss is caught by the skew hallmark K", /Only the skew hallmark K differs: two words may be in swapped places/.test(o), o); }
  check("recheck: a wrong hallmark length is named", /The hallmark R has 11 digits, needs 12/.test(await rc(ph, mk.M, mk.R.slice(1))));
  { // review M3: two swapped words on random seeds, with and without K: never put down to the last word alone, never "the words that were forged" without K
    let bad = [], seen = 0;
    for(let t = 0; t < 120; t++){
      const n = t % 2 ? 24 : 12, m = bip39.generateMnemonic(wordlist, n === 12 ? 128 : 256), ws = m.split(" "), P = vf.PLAN[n];
      const bits = ws.flatMap((x, i) => [...wordlist.indexOf(x).toString(2).padStart(11, "0")].slice(0, i < n - 1 ? 11 : P.finalBits).map(Number)), mk2 = vf.marks(bits);
      let a = randomInt(n - 1), b; do b = randomInt(n - 1); while(b === a || ws[a] === ws[b]); [ws[a], ws[b]] = [ws[b], ws[a]];
      for(const K of [null, mk2.K]){
        const o = await rc(ws.join(" "), mk2.M, mk2.R, K || "");
        if(/^The hallmarks match/.test(o)) seen++;
        if(/the last word is wrong\. Work it out again/.test(o) || (!K && /(these are|almost certainly) the words that were forged/i.test(o)) || (/checksum is wrong/.test(o) && /^The hallmarks match/.test(o) && !/two words in swapped places/.test(o))) bad.push(n + (K ? "K" : "") + ": " + o.slice(0, 120));
      }
    }
    check("review M3: 120 random seeds with two words swapped (with and without K): a checksum error lists a swap too, never only the last word, and no 'words that were forged' without K (" + seen + " passed the hallmarks)", bad.length === 0 && seen > 20, bad.slice(0, 2).join(" | "));
    const o = await rc(ph, mk.M, mk.R);
    check("review M3: right words without K: hallmarks and checksum agree, and it says a swap could still pass", /^The hallmarks match these 12 words, and the BIP39 checksum is right\. Without the skew hallmark K, two words in swapped places can still pass/.test(o), o); }
  { // review L4: a recheck still working writes nothing after CLEAR
    $("dmrWords").value = ph; $("dmrM").value = mk.M; $("dmrR").value = mk.R; const pr = w.dmRecheck(); w.dmrClear(); await pr;
    check("review L4: a recheck still working when CLEAR is pressed writes nothing", !$("dmrOut").textContent, $("dmrOut").textContent); }
  check("recheck: 24 words work (worked example 3)", /The hallmarks match these 24 words/.test(await rc(E3.p.F.phrase, E3.p.F.marks.M, E3.p.F.marks.R)));
  check("recheck: the box explains the check by hand with the word table", /By hand:.*binary word table/.test($("dmrBox").textContent));
  for(const id of ["dmrWords", "dmrM", "dmrR", "dmrK"]) check("auto-clear knows the recheck box " + id, w.eval("AUTO_FIELDS").includes(id));
  await rc(ph, mk.M, mk.R); w.wipeSeed();
  check("the wipes empty the recheck boxes and its result", !$("dmrWords").value && !$("dmrM").value && !$("dmrOut").textContent);
}

// ---------- 5. FORGE SEED, the stale guard and the wipes
set("dmDice", E1.e.dice); set("dmCards", pageCards(E1.e.cards)); await w.dmGenerate();
check("review M2: FORGE SEED makes no seed from worked example 1 typed by hand", !w.hasSeed());
set("dmDice", RSdice); set("dmCards", RScards);
{ // review M6: FORGE SEED checks What I wrote first
  const ws = RSref.E.phrase.slice(); ws[3] = ws[3] === "zoo" ? "abandon" : "zoo"; set("dmWords", ws.join(" ")); set("dmFR", RSref.E.marks.R.replace(/^./, (x) => x === "1" ? "0" : "1"));
  let asked = ""; w.confirm = (m) => { asked = m; return false; }; await w.dmGenerate();
  check("review M6: FORGE SEED with a wrong word and hallmark under What I wrote: it shows where, asks first, and No forges nothing", !w.hasSeed() && /What you wrote does not match what your dice and cards give \(\d+ differences/.test(asked) && /Word 4: you wrote/.test($("dmOut").textContent) && /Row 1 of the Forge grid/.test($("dmOut").textContent), asked);
  w.confirm = () => true; set("dmWords", RSref.E.phrase.join(" ")); set("dmFR", RSref.E.marks.R); asked = ""; w.confirm = (m) => { asked = m; return true; }; await w.dmGenerate(); w.confirm = () => true;
  check("review M6: with What I wrote right, FORGE SEED asks nothing about it", w.hasSeed() && !/What you wrote/.test(asked), asked);
  set("dmWords", ""); set("dmFR", ""); }
await w.dmGenerate();
const RSfp = fpOf(RSref.E.phrase.join(" ")), RSad = addrOf(RSref.E.phrase.join(" "));
check("FORGE SEED: the Damascus seed goes into the page's normal result (words, fingerprint, first address)", w.hasSeed() && w.eval("madeMnemonic") === RSref.E.phrase.join(" ") && $("fingerprint").textContent.includes(RSfp) && $("address").textContent.includes(RSad) && w.eval("seedKind") === "dm", $("fingerprint").textContent);
{ const S = w.seedSummary();
  check("review L17: the seed summary gives the strength with its condition (the dice or the shuffle fair)", S && S.lines.some((l) => /^Strength: the words hold 128 bits of randomness \(if the dice or the shuffle was fair: either one is enough\)$/.test(l)), S && S.lines.join(" | ")); }
check("FORGE SEED: the summary says the Damascus method", /the Damascus method/.test($("sumLine").textContent), $("sumLine").textContent);
set("dmDice", RSdice + " 12");
check("changing the dice after FORGE SEED clears the words (stale guard)", !w.hasSeed() && /You changed the dice pairs, the cards, the word count or who checks after FORGE SEED/.test($("genResult").textContent));
set("dmDice", RSdice); await w.dmGenerate();
who("h");
check("review L1: choosing an assay after FORGE SEED clears the seed and the Anvil sheet box", !w.hasSeed() && !$("dmCards").value && /who checks/.test($("genResult").textContent));
who("both"); set("dmCards", RScards); await w.dmGenerate(); await w.dmCheck();
check("before the wipes: a seed and a check are on screen", w.hasSeed() && $("dmOut").textContent.length > 100 && w.eval("autoHasSecrets()"));
for(const id of ["dmDice", "dmCards", "dmHM", "dmHR", "dmAM", "dmAR", "dmFM", "dmFR", "dmFK", "dmWords"]) check("auto-clear knows the box " + id, w.eval("AUTO_FIELDS").includes(id));
w.clearAll();
check("CLEAR ALL wipes the Damascus boxes, its result and the seed", !w.hasSeed() && !$("dmDice").value && !$("dmCards").value && !$("dmOut").textContent && $("dmOut").style.display === "none");
set("dmFM", "0101"); check("one typed hallmark counts as a secret for auto-clear", w.eval("autoHasSecrets()"));
set("dmDice", E1.e.dice); set("dmCards", pageCards(E1.e.cards)); await w.dmCheck();
check("auto-clear wipes the Damascus boxes, the result and the five steps' views", w.autoWipe("test") === true && !$("dmDice").value && !$("dmCards").value && !$("dmFM").value && !$("dmOut").textContent && !$("dmPairBoxes").children.length && !$("dmLiveH").textContent && !$("dmLiveA").textContent && !/Last word:/.test($("dmLiveL").textContent) && !/[0-9JQKA][\u2660-\u2667]/.test($("dmDeal").textContent));
set("dmDice", E1.e.dice); set("dmCards", pageCards(E1.e.cards)); await w.dmCheck(); who("h");
w.endSessionReload = () => {}; await w.endSession();
check("END SESSION wipes the Damascus boxes and result and puts the choices back", !$("dmDice").value && !$("dmCards").value && !$("dmOut").textContent && $("dmWho").value === "both");
{ // the check that is still working writes nothing once the boxes are wiped
  set("dmDice", E1.e.dice); set("dmCards", pageCards(E1.e.cards)); const pr = w.dmCheck(); w.dmClear(); await pr;
  check("a check still working when CLEAR is pressed writes nothing", !$("dmOut").textContent); }

// ---------- 6. the printed sheets (jsdom: their content)
let printed = "";
w.print = () => { printed = w.document.getElementById("printOnly").innerHTML; };
const sheet = (k, n) => { words(n); w.dmPrint(k); const h = printed; w.dispatchEvent(new w.Event("afterprint")); return h; };
for(const n of [12, 24]){
  const H = sheet("h", n), A = sheet("a", n), Fh = sheet("f", n), th = vf.BIAS[n];
  const cells = [...H.matchAll(/data-a="(\d)" data-b="(\d)" data-code="([01]{5}|again)"/g)];
  check(n + " words, Hammer sheet: the 36 mirror cells are the reference code's", cells.length === 36 && cells.every(([, a, b, c]) => (vf.mirrorCode(+a, +b) === null ? "again" : vf.bin(vf.mirrorCode(+a, +b), 5)) === c));
  check(n + " words, Hammer sheet: the bias box thresholds are the ones the page checks", H.includes("<b>FAIL</b> if any count is " + th.diceHigh + " or more, or " + th.diceLow + " or fewer, or repeats are " + th.repeatsLow + " or fewer") && w.eval("DM_BIAS")[n].diceHigh === th.diceHigh && w.eval("DM_BIAS")[n].diceLow === th.diceLow && w.eval("DM_BIAS")[n].repeatsLow === th.repeatsLow);
  check(n + " words, Anvil sheet: card bias thresholds, 12 riffles, steps A1-A4", A.includes("1s are " + th.cardOnesLow + " or fewer, or " + th.cardOnesHigh + " or more") && A.includes("neighbors are " + th.cardNeighboursHigh + " or more") && /riffle shuffle <b>12 times<\/b>/.test(A) && ["A1", "A2", "A3", "A4"].every((s) => A.includes('<span class="dm-tm">' + s)));
  { const plan = vf.cardPlan(vf.PLAN[n].bits), last = plan[plan.length - 1], C = sheet("c", n), bits = vf.PLAN[n].rows + 10;
    check(n + " words, review M5: step A2 names the last deck's plan, as the code deals it (deck " + plan.length + ": " + (last.length - 1) + " groups of 8, then 4 cards)", A.includes("The last deck is shorter: on deck " + plan.length + ", deal " + (last.length - 1) + " groups of 8, then 4 cards, and stop.") && last.slice(0, -1).every((x) => x === 8) && last[last.length - 1] === 4 && JSON.stringify(plan) === JSON.stringify(w.dmCardPlan(vf.PLAN[n].bits)));
    check(n + " words, review L11: the Forge sheet and the backup card say the hallmarks reveal " + bits + " bits", Fh.includes("reveal part of the seed (" + bits + " bits)") && C.includes("reveal part of the seed (" + bits + " bits)"));
    check(n + " words, review L10 and L16: repeats and neighbors are defined, and the last pair's bits are counted right", H.includes("a number the same as the number just before it, reading every number in order") && A.includes("Ace and King are not neighbors") && H.includes(n === 12 ? "uses only 3 bits." : "uses only 1 bit.")); }
  const sk = [...Fh.matchAll(/data-r="(\d+)" data-c="(\d+)" data-k="([a-k])"/g)];
  check(n + " words, Forge sheet: " + sk.length + " skew letters as the reference; steps F1-F6", sk.length === vf.PLAN[n].bits && sk.every(([, r, c, k]) => vf.skewLetter(+r - 1, +c - 1) === k) && ["F1", "F2", "F3", "F4", "F5", "F6"].every((s) => Fh.includes('<span class="dm-tm">' + s)) && ["H1", "H2", "H3", "H4"].every((s) => H.includes('<span class="dm-tm">' + s)));
  check(n + " words: the sheets say Hammer, Anvil, Forge, hallmarks and assayer, never audit", /HAMMER SHEET/.test(H) && /ANVIL SHEET/.test(A) && /FORGE SHEET/.test(Fh) && /[Hh]allmark/.test(H + A + Fh) && /Assayer/.test(H + A) && !/audit/i.test(H + A + Fh));
}
{ // review L6: no sheet prints before the self-test passed; review L2: the results cannot be selected
  let calls = 0; const pr = w.print, al = w.alert; w.print = () => { calls++; }; w.alert = () => {}; w.eval("selfTestState = 'fail'"); w.dmUpdate();
  const off = ["dmPrintK", "dmPrintH", "dmPrintT"].every((id) => $(id).disabled); w.dmPrint("h"); w.dmPrint("t"); w.dmPrint("k");
  w.eval("selfTestState = 'pass'"); w.dmUpdate(); w.print = pr; w.alert = al;
  check("review L6: with the self-test failed, the print buttons are off and dmPrint prints nothing", off && calls === 0 && !$("dmPrintH").disabled);
  const css = [...w.document.querySelectorAll("style")].map((x) => x.textContent).join("\n");
  check("review L2: the Damascus check, the live view and the backup recheck cannot be selected", /#dmOut, #dmrOut, #dmLwOut, \.dm-live, \.dm-boxes, \.dm-deal \{ -webkit-user-select: none; user-select: none; \}/.test(css)); }
{ const T = sheet("t", 12), cells = [...T.matchAll(/data-i="(\d+)"(?: class="l")?>([a-z]+)</g)];
  check("binary word table: 2,048 words in their places (@scure/bip39 English list)", cells.length === 2048 && cells.every(([, i, x]) => wordlist[+i] === x)); }
const SS_LABELS = ["Tools", "Calc 12th/24th word", "12 words", "Build Final Word", "Coin flip entropy", "Heads = 1", "Tails = 0", "Final Word Calc", "Next", "12th Word", "Load seed", "Done", "Address explorer", "Native Segwit", "Receive addresses"];
const textOf = (h) => { const d = w.document.createElement("div"); d.innerHTML = h; return d.textContent.replace(/\s+/g, " "); };
{ const Fh = textOf(sheet("f", 12));
  check("Forge sheet: the SeedSigner steps for the last word, fingerprint and address", Fh.includes("Tools > Calc 12th/24th word > 12 words > type words 1 to 11 > Build Final Word > Coin flip entropy > enter the 7 bits (Heads = 1, Tails = 0). Final Word Calc shows the last word") && Fh.includes("SeedSigner: press Next: the 12th Word screen shows the fingerprint.") && Fh.includes("SeedSigner: Load seed > Done > Address explorer > Native Segwit > Receive addresses, address 0."), Fh.slice(Fh.indexOf("Tool B"), Fh.indexOf("Tool B") + 300));
  const F24 = textOf(sheet("f", 24));
  check("Forge sheet, 24 words: 24 words, 23 words, the 3 bits, the 24th Word screen", F24.includes("Calc 12th/24th word > 24 words > type words 1 to 23 > Build Final Word > Coin flip entropy > enter the 3 bits (Heads = 1, Tails = 0)") && F24.includes("the 24th Word screen shows the fingerprint") && F24.includes("Row 24 gives only 3 bits")); }
{ let asked = ""; const cf = w.confirm; w.confirm = (m) => { asked = m; return true; }; const K = textOf(sheet("k", 12)); w.confirm = cf;
  check("the kit: one print with the guide, Hammer, Anvil, Forge, word table, backup card and trial checklist, in that order; the question says blank pages are not secret", /Blank pages are not secret/.test(asked) && /11 pages/.test(asked) && ["QUICK GUIDE", "HAMMER SHEET", "ANVIL SHEET", "FORGE SHEET", "binary word table", "BACKUP CARD", "TRIAL CHECKLIST"].map((x) => K.indexOf(x)).every((v, i, a) => v >= 0 && (i === 0 || v > a[i - 1])), asked);
  const C = textOf(sheet("c", 12)), C24 = textOf(sheet("c", 24)), R = textOf(sheet("r", 12));
  check("the backup card: 12 or 24 numbered word lines with a row hallmark each, the column hallmark, and the line about keeping hallmarks with the words", /Keep the hallmarks only with the words/.test(C) && (sheet("c", 12).match(/<td class="w"><\/td>/g) || []).length === 12 && (sheet("c", 24).match(/<td class="w"><\/td>/g) || []).length === 24 && /Column hallmark M/.test(C24) && /Recheck a Damascus backup/.test(C));
  check("the trial checklist: practice warning, the 7 parts with times, and the feedback questions", /PRACTICE RUN\. Never put money on these words/.test(R) && /Which step was confusing/.test(R) && ["Hammer (dice)", "Anvil (cards)", "Backup"].every((x) => R.includes(x)));
  const kit = readFileSync(path.join(here, "..", "docs", "damascus-kit.html"), "utf8"), kit24 = readFileSync(path.join(here, "..", "docs", "damascus-kit-24.html"), "utf8");
  check("docs/damascus-kit.html and docs/damascus-kit-24.html are the page's own kit (tools/damascus/build-docs.mjs)", kit === w.dmKitFile(12) && kit24 === w.dmKitFile(24));
  const exmd = readFileSync(path.join(here, "..", "docs", "damascus-examples.md"), "utf8");
  check("docs/damascus-examples.md is the page's own (tools/damascus/build-docs.mjs), says public, and has the three results", exmd === await w.dmExamplesMd() && /never put money/.test(exmd) && exRes.every((x) => exmd.includes(x.p.F.phrase) && exmd.includes(x.fp) && exmd.includes(x.ad))); }
// the questions (docs/damascus-faq.md): the tab shows them word for word
{ const faq = readFileSync(path.join(here, "..", "docs", "damascus-faq.md"), "utf8"), plain = (t) => t.replace(/\*\*/g, "").replace(/`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "docs/$1").replace(/\s+/g, " ").trim();
  const lines = faq.split("\n").filter((l) => l.trim() && !/^#/.test(l)).map((l) => plain(l.replace(/^\s*(\d+\.|-) /, ""))), heads = faq.split("\n").filter((l) => /^## /.test(l)).map((l) => plain(l.slice(3)));
  const box = $("dmFaq").textContent.replace(/\s+/g, " "), miss = lines.concat(heads).filter((x) => !box.includes(x));
  check("the questions and fixes on the tab are docs/damascus-faq.md word for word (" + heads.length + " questions)", miss.length === 0 && heads.length >= 10, miss.slice(0, 2).join(" | ")); }
// the quick guide (docs/damascus-quick-guide.md): the tab shows it word for word, and the sheets use its words
const guide = readFileSync(path.join(here, "..", "docs", "damascus-quick-guide.md"), "utf8");
{ const plain = (t) => t.replace(/\*\*/g, "").replace(/(^|[^\w*])\*([^*]+)\*/g, "$1$2").replace(/`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "docs/$1").replace(/\s+/g, " ").trim();
  const steps = guide.split("\n").filter((l) => /^\s*(\d+\.|-) /.test(l)).map((l) => plain(l.replace(/^\s*(\d+\.|-) /, "")));
  const parts = guide.split("\n").filter((l) => /^## /.test(l)).map((l) => plain(l.slice(3)));
  const box = $("dmBox").textContent.replace(/\s+/g, " "), miss = steps.filter((x) => !box.includes(x)).concat(parts.filter((x) => !box.includes(x)));
  check("the Damascus tab shows the quick guide word for word: " + parts.length + " parts, " + steps.length + " steps", miss.length === 0 && parts.filter((x) => /^Part \d/.test(x)).length === 7 && $("dmGuide").querySelectorAll("details.dm-part").length === parts.length, miss.slice(0, 3).join(" | "));
  const H = textOf(sheet("h", 12)), A = textOf(sheet("a", 12)), Fh = textOf(sheet("f", 12)), all = H + " " + A + " " + Fh, g = plain(guide);
  const same = ["Throw both dice. Read the left die first.", "Write both numbers in the next pair box.", "Rolled 1-1, 2-2, 3-3 or 4-4? Cross the pair box out and throw both dice again.", "the row is the left die, the column is the right die. It gives you 5 bits", "Write the 5 bits into the next shaded run of the grid", "Repeat until the grid is full (26 good pairs). The last pair uses only 3 bits.",
    "in the first 26 pair boxes, including crossed-out boxes: 52 numbers, count how often each face came up, and count the repeats (a number the same as the number just before it, reading every number in order: left, right, then the next box).", "On a FAIL, use other dice and start a new Hammer sheet.",
    "spread the cards face down and swirl them for 30 seconds, riffle shuffle 12 times, then cut.", "Deal 8 cards face up in a row.", "1 against 2, 3 against 4, 5 against 6, 7 against 8, then the two winners on the left, then the two winners on the right, then the final.", "The higher card wins and plays on.",
    "1 if the right card is higher", "0 if the left card is higher", "Ace is lowest, King is highest. For the same rank: clubs < diamonds < hearts < spades", "Deal the next 8 cards and play again: 6 groups of 8 in all.", "Then deal 4 cards: 1 against 2, 3 against 4, then the two winners.",
    "count the neighbors: two cards dealt one after the other in the same group, with the same suit and ranks next to each other (like 7\u2665 8\u2665). Ace and King are not neighbors, and two cards in different groups never count. After each deck, count its 1s.", "FAIL if any count is 18 or more, or 1 or fewer, or repeats are 2 or fewer.", "FAIL a deck if its 1s are 11 or fewer, or 34 or more (full 45-bit decks only), or its neighbors are 6 or more.", "(a pair and its mirror, like 2-5 and 5-2, share the first 4 bits): the row is the left die", "into the next shaded run of the grid (a run is the stretch of boxes for one pair or one group of cards, shaded and white in turn).", "A group of 8 cards (an octet) gives 7 bits for its run of grid A; a group of 4 (a quad) gives 3.", "A hallmark is a check bit: whether a row or a column holds an odd or an even number of 1s (its parity).", "Block: which of the word table's 8 blocks; row and column: where the word sits in that block.", "The last deck is shorter: on deck 3, deal 5 groups of 8, then 4 cards, and stop.", "On a FAIL, shuffle again and redo that deck.",
    "Row hallmark R: count the 1s in the row and write the result in the R box at the end of the row: odd: 1 3 5 7 9 11 → 1 · even: 0 2 4 6 8 10 → 0.", "Column hallmark M: count the 1s in the column and write the result in the M box under it, the same way.",
    "Lay the Hammer and Anvil sheets side by side.", "Work one row at a time: finger on the same row on both sheets.", "For every box (this is XOR): Same \u2192 0. Different \u2192 1. Write it in the same box on the Forge sheet.", "Forge = Hammer XOR Anvil",
    "for each R box and each M box, fold the Hammer hallmark with the Anvil hallmark (Same → 0. Different → 1.). The result must equal the Forge sheet's hallmark.",
    "If one doesn't match: the mistake is where that row and that column cross. Fix it before you go on.",
    "Your Forge sheet's last row gives the last word's 7 bits (3 for 24 words). These are not new coin flips.", "SeedSigner asks for them under 'Coin flip entropy'. That is just its way of typing in 0s and 1s: enter each bit as Heads = 1, Tails = 0.", "The device then calculates the checksum (4 bits for 12 words, 8 for 24) and shows the final word. VOIDFORGE must show the same word.", "Split each", "into 3 + 4 + 4 bits: block, row, column.", "Look up the word in the word table with those three parts and write it next to the row. No math needed.", "Check each word back: find it alphabetically in the table and make sure its bits match the row.",
    "gives only 7 bits, because the last word also holds a checksum that needs a computer", "Tools > Calc 12th/24th word > 12 words > type words 1 to 11 > Build Final Word > Coin flip entropy > enter the 7 bits (Heads = 1, Tails = 0).", "Final Word Calc shows the last word", "the 12th Word screen shows the fingerprint", "Load seed > Done > Address explorer > Native Segwit > Receive addresses, address 0.",
    "MAKE A SEED > Damascus, step 5 (Last word). Type the same 11 words and the 7 bits, then press CALCULATE LAST WORD.", "Copy the 12 words to your backup", "Keep the hallmarks only next to the words, because they reveal part of the seed", "Destroy the sheets you do not keep."];
  const ap = (t) => t.replace(/[’']/g, "'"), bad = same.filter((x) => !ap(all).includes(ap(x)) || !ap(g).includes(ap(x)));
  check("the printed sheets and the quick guide give the same instructions in the same words (" + same.length + " sentences)", bad.length === 0, bad.slice(0, 3).join(" | "));
  // the five steps on the page use the same words as the guide and the sheets (12 words shown)
  const flow = ap($("dmFlow").textContent.replace(/\s+/g, " ")), flowSame = same.filter((x) => !/^(1 if the right|0 if the left|Ace is lowest|The higher card|Then deal 4|Split each|into 3|Final Word Calc|the 12th Word|Load seed|MAKE A SEED|Copy the 12|Keep the hallmarks|Destroy the|gives only 7|Forge = Hammer XOR Anvil)/.test(x));
  const fbad = flowSame.filter((x) => !flow.includes(ap(x)));
  const have = guide.split("\n").filter((l) => /^\*\*What you should have now:\*\*/.test(l)).map((l) => plain(l)), hbad = have.slice(0, 7).filter((x, i) => i !== 2 && i !== 6 && !flow.includes(ap(x)));
  check("brief B/C: the five steps say what to do on paper in the guide's and the sheets' words (" + flowSame.length + " sentences), and each step's 'What you should have now' is the guide's", fbad.length === 0 && hbad.length === 0 && have.length === 7, fbad.concat(hbad).slice(0, 3).join(" | "));
  const hk = "odd: 1 3 5 7 9 11 → 1 · even: 0 2 4 6 8 10 → 0";
  check("beginner test: the Hammer sheet's H4 is marked optional, for the assay, and the guide's assay step names it", H.includes("H4 (optional, for the assay).") && g.includes("Optional, for the assay: each sheet is also a Seed XOR part (step H4 on the Hammer sheet)."));
  check("brief C: the hallmark rule is next to the hallmark boxes on all three grids, and the Forge rows say Same → 0. Different → 1. on every row", H.includes(hk) && A.includes(hk) && Fh.includes(hk) && (sheet("f", 12).match(/Same \u2192 0\. Different \u2192 1\./g) || []).length >= 12 + 2 && /0 0 \u2192 0.*1 1 \u2192 0.*0 1 \u2192 1.*1 0 \u2192 1/.test(sheet("f", 12)) && /role="img"/.test(sheet("f", 12)));
  check("brief C5/C6: the guide says about 30 minutes once you know the steps and the field test; no 37-minute or 40-minute estimate is left", /about 30 minutes once you know the steps; allow longer the first time/.test(g) && /Field-tested: a hand-made Damascus seed checked on a real SeedSigner and in Sparrow \(10 November 2026\)\./.test(g) && !/37 min|about 40 minutes|nobody has timed/i.test(g + $("dmBox").textContent + textOf(sheet("r", 12)) + readFileSync(path.join(here, "..", "docs", "damascus-method.md"), "utf8"))); }
{ // brief B: the five steps, the dice pad, the card picker, the live checks
  w.dmClear(); words(12); who("both");
  const E = exRes[0], pad = [...$("dmDicePad").querySelectorAll("button")];
  for(const t of E.e.dice.replace(/ /g, "")) pad[+t - 1].click();
  check("brief B1: the dice pad (the Dice tab's faces, two taps a pair) writes the pairs exactly as typed, with a pair box each", pad.length === 6 && $("dmDice").value === E.e.dice && $("dmPairBoxes").children.length === 40 && $("dmPairBoxes").querySelectorAll(".again").length === 5, $("dmDice").value.slice(0, 40));
  pad[2].click(); const half = $("dmPairBoxes").lastChild.className, m1 = $("dmMsg").textContent; w.dmUndoThrow();
  check("brief B1: a half pair shows as such and stops the check; UNDO LAST THROW takes it back", /half/.test(half) && /^Pair 41 is missing a throw/.test(m1) && $("dmDice").value === E.e.dice, m1);
  const suit = { C: "♣", D: "♦", H: "♥", S: "♠" }, decks = E.e.cards.map((d) => d.split(" "));
  decks.forEach((d, i) => d.slice(0, i === 2 ? 44 : 52).forEach((c, k) => { if(i === 0 && k === 9) w.dmDealCard(d[3][0] + suit[d[3][1]]); w.dmDealCard(c[0] + suit[c[1]]); }));
  const lines = $("dmCards").value.split("\n");
  check("brief B1: the card picker deals deck after deck, one deck a line, refuses a card already dealt from the deck, and the seed is the same", lines.length === 3 && lines.every((l, i) => l.split(" ").length === (i === 2 ? 44 : 52)) && !$("dmCheckBtn").disabled && /PRACTICE: worked example 1/.test($("dmPracticeBan").textContent), $("dmCards").value.slice(0, 50));
  w.dmDealCard("A♠");
  check("brief B1: after the last deck the picker says the grid is full", /The grid is full/.test($("dmMsg").textContent));
  check("brief B2: the step bar and progress: Hammer and Anvil done, the bar part full", /✓/.test($("dmFBar").querySelector('[data-ds="1"]').textContent) && /✓/.test($("dmFBar").querySelector('[data-ds="2"]').textContent) && parseInt($("dmFFill").style.width) >= 40 && /^Progress: 26 of 26 good pairs/.test($("dmFNow").textContent) && !$("dmSt1").hidden, $("dmFNow").textContent + " " + $("dmFFill").style.width);
  w.dmShowStep(2); const hid = [...w.document.querySelectorAll("#dmFlow .dm-st")].map((s) => s.hidden);
  check("brief B2: one step at a time; NEXT and BACK move between them", JSON.stringify(hid) === "[true,false,true,true,true]" && /^Progress: 148 of 148 cards/.test($("dmFNow").textContent), $("dmFNow").textContent);
  // live checks: a wrong row hallmark in grid H, the Anvil decks, grid F row by row, the words
  const RH = E.p.H.marks.R, badR = RH.slice(0, 3) + (RH[3] === "1" ? "0" : "1"); set("dmHR", badR);
  check("brief B3: a wrong row hallmark in grid H is shown at its row as soon as it is typed", $("dmLiveH").textContent.includes("Row 4 of grid H: you wrote R " + badR[3]) && ($("dmLiveH").textContent.match(/✓/g) || []).length === 3, $("dmLiveH").textContent.slice(-300));
  set("dmHR", "");
  check("brief B3: each finished deck is checked (its card check) as soon as it is dealt", ($("dmLiveA").textContent.match(/Deck \d done: \d+ different cards/g) || []).length === 3);
  { const c = E.e.cards.map((d) => d.split(" ")); c[1][7] = c[1][2]; set("dmCards", c.map((d) => d.join(" ")).join("\n"));
    check("brief B3: a card dealt twice is shown at its deck and place", $("dmLiveA").textContent.includes("Deck 2: card 8 (" + w.dmCardText(c[1][2].replace(/[CDHS]$/, (x) => suit[x])) + ") was already dealt as card 3 of this deck"), $("dmLiveA").textContent.slice(0, 200));
    set("dmCards", pageCards(E.e.cards)); }
  const RF = E.p.F.marks.R; set("dmFR", RF.slice(0, 4) + (RF[4] === "1" ? "0" : "1"));
  check("brief B3: grid F is checked row by row as R(F) is typed; a wrong row says what the row holds and where to look", ($("dmLiveF").textContent.match(/✓/g) || []).length === 4 && $("dmLiveF").textContent.includes("Row 5: you wrote R ") && /Check the folding in row 5/.test($("dmLiveF").textContent) && !$("dmLiveF").textContent.includes("Row 6"), $("dmLiveF").textContent.slice(0, 300));
  { const i = 5 * 11 + 2, Fb = E.p.F.bits.map((b, k) => k === i ? b ^ 1 : b), mm = w.dmMarks(Fb); set("dmFR", mm.R); set("dmFM", mm.M);
    check("brief B3: with R(F) and M(F) typed, one wrong box is named at its row and column", $("dmLiveF").textContent.includes("One box is most likely wrong: row 6, column 3: the Forge box should be " + E.p.F.bits[i]), $("dmLiveF").textContent.slice(-300)); }
  set("dmFR", E.p.F.marks.R); set("dmFM", E.p.F.marks.M);
  check("brief B3: right R(F) and M(F): the seal holds and step 3 is done", /The seal holds/.test($("dmLiveF").textContent) && /✓/.test($("dmFBar").querySelector('[data-ds="3"]').textContent));
  { const ws = E.p.F.phrase.split(" "); ws[6] = ws[6] === "zoo" ? "abandon" : "zoo"; set("dmWords", ws.slice(0, 8).join(" "));
    check("brief B3: each word is checked against its row as it is typed", ($("dmLiveW").textContent.match(/✓/g) || []).length === 7 && $("dmLiveW").textContent.includes("Word 7: you wrote"), $("dmLiveW").textContent.slice(-200));
    set("dmWords", E.p.F.phrase); check("brief B3: all words right: step 4 is done", /✓/.test($("dmFBar").querySelector('[data-ds="4"]').textContent)); }
  w.dmShowStep(5); for(let t = 0; t < 100 && !/Master fingerprint/.test($("dmLiveL").textContent); t++) await new Promise((r) => setTimeout(r, 50));
  check("coordinator: the last-word step shows the last row's bits, the final word, fingerprint and first address, and says they must match the SeedSigner", $("dmLiveL").textContent.includes("Your Forge sheet's last row: " + E.p.F.handWords[11].bits + " (7 bits)") && $("dmLiveL").textContent.includes("Last word: sword (") && $("dmLiveL").textContent.includes("Master fingerprint 70b5da37") && $("dmLiveL").textContent.includes(E.ad) && /must match the SeedSigner/.test($("dmLiveL").textContent), $("dmLiveL").textContent);
  check("the five steps leave no sign for the watch check (their data- attributes are the page's own)", w.watchSigns().length === 0, JSON.stringify(w.watchSigns()).slice(0, 200));
  who("h"); const only = [...w.document.querySelectorAll("#dmFBar li")].map((l) => l.hidden);
  check("brief B: an assay shows its own sheet's step only", JSON.stringify(only) === "[false,true,true,true,true]" && !w.document.getElementById("dmSt1").hidden, JSON.stringify(only));
  who("both"); w.dmClear();
  check("CLEAR empties the steps' views: no pair box, no live text, step 1", !$("dmPairBoxes").children.length && !$("dmLiveH").textContent && !$("dmDeal").textContent.includes("9") && w.eval("dmStep") === 1);
}
{ // coordinator: the last word from paper only (words 1 to 11 or 23 and the bits), as SeedSigner's Calc 12th/24th word
  const lw = async (ws, b) => { $("dmLwWords").value = ws; $("dmLwBits").value = b; $("dmLwWords").dispatchEvent(new w.Event("input")); await w.dmLwCalc(); return $("dmLwOut").textContent; };
  let bad = [];
  for(let t = 0; t < 40; t++){
    const n = t % 2 ? 24 : 12; words(n); const m = bip39.generateMnemonic(wordlist, n === 12 ? 128 : 256).split(" "), fb = vf.PLAN[n].finalBits, bits = wordlist.indexOf(m[n - 1]).toString(2).padStart(11, "0").slice(0, fb);
    const o = await lw(m.slice(0, n - 1).join(" "), bits);
    if(!o.startsWith("Last word: " + m[n - 1] + " (") || !o.includes("Master fingerprint " + fpOf(m.join(" "))) || !o.includes(addrOf(m.join(" ")))) bad.push(n + ": " + o.slice(0, 80));
  }
  check("coordinator: CALCULATE LAST WORD from words and bits alone gives @scure/bip39's last word, fingerprint (@scure/bip32) and first address (40 random 12- and 24-word seeds)", bad.length === 0, bad.slice(0, 2).join(" | "));
  words(12); const ws = exRes[0].p.F.phrase.split(" ").slice(0, 11).join(" ");
  const msgs = [[ws.split(" ").slice(0, 10).join(" "), "1101110", /^Type words 1 to 11 \(the last word is what this works out\): you typed 10\./], [ws.replace(/^kick/, "kxck"), "1101110", /^Word 1 \(kxck\) is not a BIP39 word\./], [ws, "1101120", /^The bits are 1s and 0s only: “2” is not a bit\./], [ws, "110111", /^Type the 7 bits of your Forge sheet's last row: you typed 6\./]];
  const got = []; for(const [a, b, re] of msgs){ const o = await lw(a, b); if(!re.test(o) || !/status bad/.test($("dmLwOut").className)) got.push(o); }
  words(15); const o15 = await lw(ws, "1101110"); words(12);
  check("coordinator: every bad input to CALCULATE LAST WORD gets its own plain message (word count, a word that is not BIP39, a bit that is not 0 or 1, the bit count, 15 words)", got.length === 0 && /makes 12 or 24 words/.test(o15), got.concat(o15).join(" | "));
  const o1 = await lw(ws, exRes[0].p.F.handWords[11].bits);
  check("coordinator: worked example 1 from paper: sword, its fingerprint, and the public-phrase warning", /^Last word: sword \(/.test(o1) && o1.includes("70b5da37") && /PUBLIC EXAMPLE PHRASE/.test(o1), o1);
  await w.dmGenerate(); check("FORGE SEED from paper only refuses a public worked example", !w.hasSeed() && /PRACTICE: these words are a public worked example/.test($("dmLwOut").textContent));
  const m = RSref.E.phrase; await lw(m.slice(0, 11).join(" "), RSref.E.handWords[11].bits);
  check("FORGE SEED is on for words and bits from paper only (no dice or cards on the page)", !$("dmBtn").disabled);
  await w.dmGenerate();
  check("FORGE SEED from paper only: the seed goes into the page's normal result, and the summary says the Damascus method", w.hasSeed() && w.eval("madeMnemonic") === m.join(" ") && w.eval("seedKind") === "dm" && /the Damascus method/.test($("sumLine").textContent));
  $("dmLwBits").value = "0000000"; $("dmLwBits").dispatchEvent(new w.Event("input"));
  check("changing the paper-only boxes after FORGE SEED clears the words (stale guard)", !w.hasSeed());
  check("auto-clear knows the paper-only boxes", ["dmLwWords", "dmLwBits"].every((id) => w.eval("AUTO_FIELDS").includes(id)));
  w.dmClear(); check("CLEAR empties the paper-only boxes and their result", !$("dmLwWords").value && !$("dmLwBits").value && !$("dmLwOut").textContent);
}
// the creator line and picture (v2.14.0): top of the Damascus tab, ABOUT & HELP, and the two docs; the picture is docs/damascus/creator.webp
{ const pic = readFileSync(path.join(here, "..", "docs", "damascus", "creator.webp")), want = "data:image/webp;base64," + pic.toString("base64");
  const LINE = "The Damascus method, created by Random, 10 November 2026", REC = "Dated and signed origin record: tag damascus-origin-2026-11-10 on GitLab, timestamped in Bitcoin block 975,337 (OpenTimestamps)";
  const blocks = ["dmCreator", "aboutCreator"].map((id) => $(id)), dm = $("dmBox");
  check("creator line: at the top of the Damascus tab and in ABOUT & HELP right after the SeedSigner recommendation, with the origin record line", blocks.every((b) => b && b.textContent.includes(LINE) && b.textContent.includes(REC) && !b.querySelector("a")) && blocks[0].parentElement === dm && blocks[0].previousElementSibling.tagName === "SUMMARY" && $("ssRecBox").nextElementSibling === blocks[1]);
  check("creator picture: docs/damascus/creator.webp (" + pic.length + " bytes, 128 x 128 WebP) embedded as a data: URI, shown round at 44 px", blocks.every((b) => { const i = b.querySelector("img"); return i && i.getAttribute("src") === want && i.getAttribute("width") === "44" && i.getAttribute("height") === "44" && /bloodhound/.test(i.alt); }) && /border-radius: 50%/.test(readHtml().match(/\.vf-creator-pic \{[^}]*\}/)[0]));
  const docs = ["damascus-method.md", "damascus-quick-guide.md"].map((f) => readFileSync(path.join(here, "..", "docs", f), "utf8"));
  check("creator line and picture in docs/damascus-method.md and docs/damascus-quick-guide.md", docs.every((d) => d.includes('<img src="damascus/creator.webp"') && d.includes(LINE) && d.includes("timestamped in Bitcoin block 975,337 (OpenTimestamps)")));
  check("creator lines: no first or never-done claim", ![...blocks.map((b) => b.textContent), ...docs.map((d) => d.split("\n").slice(0, 6).join(" "))].some((x) => /\bfirst\b|never (?:been )?done|novel/i.test(x))); }
words(12);
{ const html = readHtml(), vis = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  const box = vis.slice(vis.indexOf('<details id="dmBox"'), vis.indexOf('id="dmOut"'));
  check("the Damascus box: no novelty claim, no “audit”, and it says Damascus, Hammer, Anvil, Forge, hallmark and assay", !/\bfirst (?:method|tool|BIP39)|never (?:been )?done|novel|\baudit/i.test(box) && /Damascus/.test(box) && /Hammer/.test(box) && /Anvil/.test(box) && /Forge sheet/.test(box) && /hallmark/.test(box) && /[Aa]ssay/.test(box)); }

// ---------- 7. Chromium: page counts on Letter and A4, and SeedSigner (the practice signer)
const DEVICE = process.env.VF_DEVICE !== "0";
let browser = null;
if(DEVICE){
  const pw = require("playwright-core");
  for(const launch of [() => pw.chromium.launch(), () => pw.chromium.launch({ channel: "chrome" })]){ try { browser = await launch(); break; } catch(e) { /* next */ } }
  if(!browser) console.log("CHROMIUM: SKIPPED (no Chromium or Chrome found)");
}
const FILE = "file://" + path.resolve(HTML_PATH);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function openPage(){
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } }); await ctx.setOffline(true);
  const page = await ctx.newPage(), problems = [];
  page.on("pageerror", (e) => problems.push(e.message)); page.on("dialog", (d) => d.accept());
  page.on("console", (m) => { if(m.type() === "error" && !/willReadFrequently/.test(m.text())) problems.push(m.text().slice(0, 200)); });
  await page.goto(FILE); await page.waitForFunction(() => window.selfTestDone !== undefined, null, { timeout: 90000 }); await page.evaluate(() => window.selfTestDone);
  const go = await page.$("#sgGo"); if(go && await go.isVisible()) await go.click();
  return { ctx, page, problems };
}
if(browser){
  // page counts: every sheet fits the paper, on Letter and A4
  const { ctx, page, problems } = await openPage();
  await page.evaluate(() => { window.print = () => {}; setMethod("damascus"); });
  const pages = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  const WANT_PAGES = { 12: { h: 1, a: 1, f: 1, c: 1, r: 1, k: 11 }, 24: { h: 2, a: 3, f: 2, c: 1, r: 1, k: 15 } };
  for(const n of [12, 24]) for(const k of ["h", "a", "f", "t", "c", "r", "k"]){
    if(k === "t" && n === 24) continue;
    for(const fmt of ["Letter", "A4"]){
      await page.selectOption("#wordSel", String(n)); await page.selectOption("#dmPaper", fmt === "A4" ? "a4" : "letter");
      await page.evaluate((k) => dmPrint(k), k);
      await page.emulateMedia({ media: "print" });
      const over = await page.evaluate(() => [...document.querySelectorAll("#printOnly .dm-pg, #printOnly .dm-tp, #printOnly .dm-cols")].map((e) => [e.scrollWidth > e.clientWidth + 1, Math.round(e.getBoundingClientRect().height)]));
      await page.emulateMedia({ media: null });
      const got = pages(await page.pdf({ format: fmt, preferCSSPageSize: true }));
      const want = k === "t" ? 4 : WANT_PAGES[n][k];
      check("print " + ({ h: "Hammer sheet", a: "Anvil sheet", f: "Forge sheet", t: "word table", c: "backup card", r: "trial checklist", k: "Damascus kit" })[k] + (k === "t" ? "" : ", " + n + " words") + ", " + fmt + ": " + want + " page" + (want > 1 ? "s" : "") + ", nothing cut off", got === want && over.every((o) => !o[0]), "got " + got + " pages, heights " + over.map((o) => o[1]).join(","));
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    }
  }
  check("printing leaves no sign for the watch check (the print style is the page's own)", await page.evaluate(() => !watchSigns().some((x) => /style sheet/i.test(x))));
  check("after printing, the sheet and its page style are gone", await page.evaluate(() => !document.getElementById("printOnly").textContent && !(document.getElementById("dmPrintCss") || {}).textContent && !document.body.classList.contains("print-seed")));
  // phone width: no sideways scroll on the Damascus tab with a result on screen
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(async (e) => { document.getElementById("wordSel").value = "12"; document.getElementById("wordSel").dispatchEvent(new Event("change")); const s = (id, v) => { const x = document.getElementById(id); x.value = v; x.dispatchEvent(new Event("input")); }; s("dmDice", e.dice); s("dmCards", e.cards.join("\n")); document.getElementById("dmLwBox").open = true; await dmCheck(); }, { dice: E1.e.dice, cards: E1.e.cards });
  const sw = await page.evaluate(() => { const o = []; for(let n = 1; n <= 5; n++){ dmShowStep(n); o.push(document.documentElement.scrollWidth - document.documentElement.clientWidth); } return o; });
  check("phone width (360 px): the Damascus tab with a check on screen has no sideways scroll, in each of the five steps", sw.every((x) => x <= 0), sw.join(", "));
  check("no page error in Chromium", problems.length === 0, problems.join(" | "));
  await ctx.close();
}

// ---------- 8. SeedSigner: the practice signer, driven with its own keys
const KEYID = { UP: "ssKUp", DOWN: "ssKDown", LEFT: "ssKLeft", RIGHT: "ssKRight", PRESS: "ssKPress", K1: "ssK1", K2: "ssK2", K3: "ssK3" };
function device(page){
  const d = {
    async press(k, wait = 260){ await page.click("#" + KEYID[k]); await sleep(wait); },
    state: () => page.evaluate(() => { const c = SSController._instance; if(!c) return null; const x = c.current_destination, v = x && x.view, s = v && v.screen;
      return { view: x && x.View_cls && x.View_cls.name, screen: s && s.constructor.name, title: s && s.title, sel: s && s.selected_button, labels: s && s.button_data ? s.button_data.map((b) => typeof b === "string" ? b : (b && (b.button_label || b.label))) : null }; }),
    async waitView(name, ms = 30000){ const t = Date.now(); let s; while(Date.now() - t < ms){ s = await d.state(); if(s && (s.view === name || s.screen === name)){ await sleep(150); return s; } await sleep(80); } throw new Error("timeout waiting for " + name + ", at " + JSON.stringify(s)); },
    // The keyboard as SeedSigner moves on it: key positions are index_x; there is no wrap up or down, so going down into a
    // column the last row lacks would leave the keyboard for the Back button. So: sideways first, then up or down; from the
    // last row (y, z and DEL), up first. If the Back button got the focus, DOWN brings it back.
    kbState: () => page.evaluate(() => { const sc = SSController._instance.current_destination.view.screen, kb = sc.keyboard;
      return { top: !!sc.is_input_in_top_nav, sel: [kb.selected_key.x, kb.selected_key.y], keys: kb.keys.map((r) => r.map((k) => ({ l: k.letter, c: k.code, x: k.index_x }))) }; }),
    async kbGo(ch, wait = 180){
      for(let n = 0; n < 60; n++){
        const { top, sel, keys } = await d.kbState();
        if(top){ await d.press("DOWN", wait); continue; }
        let ty = -1, tx = -1;
        keys.forEach((r, y) => r.forEach((k) => { if(k.l === ch || k.c === ch){ ty = y; tx = k.x; } }));
        if(ty < 0) throw new Error("no key " + ch);
        if(sel[0] === tx && sel[1] === ty){ await d.press("PRESS", wait); return; }
        const move = sel[1] === keys.length - 1 && sel[1] !== ty && keys.length > 1 ? "UP" : sel[0] < tx ? "RIGHT" : sel[0] > tx ? "LEFT" : sel[1] < ty ? "DOWN" : "UP";
        await d.press(move, 60);
        // wait until the device has moved (it may still be drawing), so the next decision uses where the cursor really is
        for(let t = 0; t < 30; t++){ const s2 = await d.kbState(); if(s2.top || s2.sel[0] !== sel[0] || s2.sel[1] !== sel[1]) break; await sleep(50); }
      }
      throw new Error("keyboard stuck at " + ch);
    },
    async pick(re, wait = 400){
      for(let n = 0; n < 30; n++){
        const s = await d.state(), i = (s.labels || []).findIndex((l) => re.test(l || ""));
        if(i < 0) throw new Error("no button " + re + " in " + JSON.stringify(s));
        if(s.sel === i){ await d.press("PRESS", wait); return s; }
        if(s.screen === "SSMainMenuScreen" || s.screen === "SSLargeButtonScreen"){
          const [cx, cy] = [s.sel % 2, Math.floor(s.sel / 2)], [tx, ty] = [i % 2, Math.floor(i / 2)];
          if(s.sel === 1000 || s.sel === null) await d.press("DOWN", 260); else if(cy < ty) await d.press("DOWN", 260); else if(cy > ty) await d.press("UP", 260); else if(cx < tx) await d.press("RIGHT", 260); else await d.press("LEFT", 260);
        } else await d.press(s.sel > i ? "UP" : "DOWN", 260);
      }
      throw new Error("stuck at " + re);
    },
    scr: (f) => page.evaluate(f),
  };
  return d;
}
// the shortest start of a word that makes it the first word on the device's list
const prefixOf = (x) => { for(let k = 1; k <= x.length; k++){ const p = x.slice(0, k); if(wordlist.find((y) => y.startsWith(p)) === x) return p; } return x; };
async function onDevice(job){
  const { ctx, page, problems } = await openPage(), d = device(page), seen = {};
  try {
    const pageRes = await page.evaluate(async (j) => {
      const decks = dmParseCards(j.cards.join("\n"), j.words).decks, r = await dmForge(j.words, j.dice, decks);
      // the Damascus tab's CALCULATE LAST WORD from paper only: words 1 to 11 (or 23) and the last row's bits
      setMethod("damascus"); const sel = document.getElementById("wordSel"); sel.value = String(j.words); sel.dispatchEvent(new Event("change"));
      document.getElementById("dmLwWords").value = r.F.phrase.split(" ").slice(0, j.words - 1).join(" "); document.getElementById("dmLwBits").value = r.F.handWords[r.F.handWords.length - 1].bits; await dmLwCalc();
      const lw = (document.getElementById("dmLwOut").textContent.match(/^Last word: (\w+)/) || [])[1];
      return { phrase: r.F.phrase, fp: await mnemonicFingerprint(r.F.phrase, ""), ad: await firstAddressOn("main", r.F.phrase, ""), last: r.F.handWords[r.F.handWords.length - 1].bits, lw };
    }, job);
    await page.evaluate(() => { showTab("check"); const b = document.getElementById("ssBox"); b.open = true; b.scrollIntoView(); });
    let s = await d.waitView("SSMainMenuView"); seen.home = s.labels;
    s = await d.pick(/^Tools$/, 800); s = await d.state(); seen.tools = s.labels;
    await d.pick(/^Calc 12th\/24th word$/, 800); s = await d.state(); seen.len = [s.title, ...s.labels];
    await d.pick(new RegExp("^" + job.words + " words$"), 900);
    const ws = pageRes.phrase.split(" ").slice(0, job.words - 1);
    for(let wi = 0; wi < ws.length; wi++){
      const x = ws[wi];
      await d.waitView("SSSeedMnemonicEntryScreen");
      for(let t = 0; t < 40 && (await d.scr(() => SSController._instance.current_destination.view.screen.title)) !== "Seed Word #" + (wi + 1); t++) await sleep(100);
      // one letter at a time: press until the screen holds it (a press the device was too busy for does not count)
      const typed = () => d.scr(() => SSController._instance.current_destination.view.screen.letters.slice(0, -1).join(""));   // the last place is the letter under the cursor, not yet pressed
      const pf = prefixOf(x);
      for(let li = 0; li < pf.length; li++){
        for(let k = 0; k < 3 && (await typed()) !== pf.slice(0, li + 1); k++){
          await d.kbGo(pf[li]);
          for(let t = 0; t < 15 && (await typed()) !== pf.slice(0, li + 1); t++) await sleep(100);
        }
      }
      const first = await d.scr(() => { const sc = SSController._instance.current_destination.view.screen; return sc.possible_words[sc.selected_possible_words_index]; });
      if(first !== x) throw new Error("word " + (wi + 1) + ": typed " + prefixOf(x) + " but the first candidate is " + first);
      // KEY2 takes the first candidate; if the device has not moved on yet (still busy drawing), it is pressed again
      const title = () => d.scr(() => { const v = SSController._instance.current_destination.view; return v.screen ? v.screen.title : ""; });
      for(let k = 0; k < 3; k++){
        await d.press("K2", 400);
        let moved = false; for(let t = 0; t < 25 && !moved; t++){ const tt = await title(); moved = tt !== "Seed Word #" + (wi + 1); if(!moved) await sleep(100); }
        if(moved) break;
      }
    }
    s = await d.waitView("SSToolsCalcFinalWordFinalizePromptView"); seen.build = [s.title, ...s.labels];
    await d.pick(/^Coin flip entropy$/, 900);
    await d.waitView("SSToolsCoinFlipEntryScreen");
    seen.flip = await d.scr(() => { const sc = SSController._instance.current_destination.view.screen; return [sc.title, ...sc.components.map((c) => c.text).filter(Boolean)]; });
    // one flip at a time: press until the device holds the next flip (a press it was too busy for does not count)
    for(let i = 0; i < pageRes.last.length; i++){
      const held = () => d.scr(() => { const v = SSController._instance.current_destination.view; return v.screen && v.screen.constructor.name === "SSToolsCoinFlipEntryScreen" ? v.screen.user_input : null; });
      for(let k = 0; k < 3; k++){
        const before = await held(); if(before === null || before.length > i) break;
        await d.kbGo(pageRes.last[i]);
        let ok = false; for(let t = 0; t < 20 && !ok; t++){ const h = await held(); ok = h === null || h.length > i; if(!ok) await sleep(100); }
        if(ok) break;
      }
    }
    s = await d.waitView("SSToolsCalcFinalWordShowFinalWordView");
    const shown = await d.scr(() => { const sc = SSController._instance.current_destination.view.screen; return { title: sc.title, word: sc.actual_final_word, bits: sc.selected_final_bits, labels: sc.button_data.map((b) => b.button_label || b.label || b) }; });
    seen.calc = [shown.title, ...shown.labels];
    await d.pick(/^Next$/, 1500);
    s = await d.waitView("SSToolsCalcFinalWordDoneView");
    const done = await d.scr(() => { const sc = SSController._instance.current_destination.view.screen; return { title: sc.title, fp: sc.fingerprint, word: sc.final_word }; });
    seen.done = [done.title, ...s.labels];
    await d.pick(/^Load seed$/, 1500);
    s = await d.waitView("SSSeedFinalizeView"); seen.fin = s.labels; await d.pick(/^Done$/, 1500);
    s = await d.waitView("SSSeedOptionsView"); seen.opts = s.labels;
    await d.pick(/^Address explorer$/, 900);
    s = await d.state(); seen.script = s.labels; await d.pick(/^Native Segwit$/, 900);
    s = await d.waitView("SSToolsAddressExplorerAddressTypeView"); seen.recv = s.labels;
    await d.pick(/^Receive addresses$/, 3000); await d.waitView("SSToolsAddressExplorerAddressListView"); await sleep(1200);
    await d.press("PRESS", 1500);
    const addr = await d.scr(() => SSController._instance.current_destination.view.address);
    return { pageRes, shown, done, addr, seen, problems };
  } finally { await ctx.close(); }
}
if(browser){
  const jobs = exRes.map((x) => ({ name: "worked example " + x.e.id, words: x.e.words, dice: x.dice, cards: x.e.cards.map((c) => String(c).trim()) }));
  for(let i = 0; i < +(process.env.VF_SS_RANDOM || 20); i++){ const s = randomSheet(i % 2 ? 24 : 12); jobs.push({ name: "random sheet " + (i + 1), words: s.words, dice: s.dice, cards: s.cards.map((d) => d.join(" ")) }); }
  const results = [], queue = jobs.slice(), t0 = Date.now();
  await Promise.all(Array.from({ length: +(process.env.VF_CONC || 4) }, async () => { while(queue.length){ const j = queue.shift(); try { results.push({ j, r: await onDevice(j) }); } catch(e) { results.push({ j, err: String(e.message || e).slice(0, 300) }); } } }));
  console.log("(SeedSigner runs: " + jobs.length + " in " + Math.round((Date.now() - t0) / 1000) + " s)");
  const py = [];
  for(const { j, r, err } of results){
    if(err){ check("SeedSigner, " + j.name + ": the run finished", false, err); continue; }
    const ref = refForge(j.words, j.dice, j.cards), m = ref.E.phrase.join(" "), last = m.split(" ")[j.words - 1];
    check("SeedSigner, " + j.name + ": the Damascus tab's CALCULATE LAST WORD (paper only) gives the same last word as the device's Calc 12th/24th word", r.pageRes.lw === last && r.shown.word === last, r.pageRes.lw + " / " + r.shown.word);
    check("SeedSigner, " + j.name + " (" + j.words + " words): Final Word Calc gives " + last + ", as the page and the reference code", r.shown.word === last && r.done.word === last && r.pageRes.phrase === m && r.shown.bits === r.pageRes.last, r.shown.word + " / " + r.pageRes.phrase.split(" ").pop());
    check("SeedSigner, " + j.name + ": the fingerprint " + ref.wallet.fingerprint + " equals the page's", r.done.fp === r.pageRes.fp && r.done.fp === ref.wallet.fingerprint, r.done.fp + " / " + r.pageRes.fp);
    check("SeedSigner, " + j.name + ": Address explorer's first native segwit receive address equals the page's", r.addr === r.pageRes.ad && r.addr === ref.wallet.firstAddressBIP84, r.addr + " / " + r.pageRes.ad);
    check("SeedSigner, " + j.name + ": no page error", r.problems.length === 0, r.problems.join(" | "));
    py.push({ words: m.split(" ").slice(0, j.words - 1), flips: r.pageRes.last, want: last });
  }
  const one = results.find((x) => x.r && x.j.words === 12), one24 = results.find((x) => x.r && x.j.words === 24);
  if(one && one24){
    const s = one.r.seen, all = [...s.home, ...s.tools, ...s.len, ...s.build, ...s.flip, ...s.calc, ...s.done, ...s.fin, ...s.opts, ...s.script, ...s.recv];
    check("SeedSigner shows every label the Forge sheet uses (" + SS_LABELS.join(", ") + ")", SS_LABELS.every((l) => all.includes(l)) && s.len[0] === "Mnemonic Length" && s.build[0] === "Build Final Word" && s.flip.includes("Heads = 1") && s.calc[0] === "Final Word Calc" && s.done[0] === "12th Word" && one24.r.seen.done[0] === "24th Word", JSON.stringify(s));
  }
  if(process.env.SEEDSIGNER_SRC){
    const out = execFileSync("python3", ["-I", "-B", path.join(here, "vendor", "seedsigner_final_word.py"), process.env.SEEDSIGNER_SRC], { input: py.map((q) => JSON.stringify(q)).join("\n") + "\n" }).toString().trim().split("\n").map((l) => JSON.parse(l));
    check("SeedSigner's own Python (calculate_checksum, " + py.length + " sheets): the same last words", out.length === py.length && out.every((x, i) => x === py[i].want), JSON.stringify(out.slice(0, 3)));
  } else console.log("SEEDSIGNER PYTHON: SKIPPED (set SEEDSIGNER_SRC to SeedSigner's src folder to run it)");
  await browser.close();
}
console.log("\nDAMASCUS METHOD: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
