// VOIDFORGE Coleman test (v2.10.0): the Card method menu against Ian Coleman's own BIP39 tool code.
// tests/vendor/fetch.sh downloads his entropy.js, index.js and jsbip39.js at commit de71c22 (v0.5.6); tests/vendor/coleman.mjs
// checks their SHA-256 and runs only their pure entropy functions (setMnemonicFromEntropy is cut out by its first and last lines),
// in empty vm contexts.
// For random shuffled decks it types the same cards into his code and into the page, as a person would, and compares the words:
// - "Ian Coleman, raw entropy" = his Mnemonic Length "Use Raw Entropy (3 words per 32 bits)": the number of words follows from the
//   cards, and the page must make the same words when that length is chosen, and refuse every other length.
// - "Ian Coleman, hashed (every card counts)" = his Mnemonic Length set to 12, 15, 18, 21 or 24 words.
// Run: sh tests/vendor/fetch.sh && node tests/coleman.test.mjs   (without the fetched files it says SKIPPED)
import nc from 'node:crypto';
import { coleman, COMMIT, FETCHED } from './vendor/coleman.mjs';
import { loadPage, ready, readHtml, makeReporter } from './harness.mjs';
if (!FETCHED) { console.log('COLEMAN: SKIPPED (run sh tests/vendor/fetch.sh first)'); process.exit(0); }

const R = makeReporter();
const w = await ready(loadPage(readHtml()));
const $ = (id) => w.document.getElementById(id);
R.ok($('selfTestBadge').textContent.includes('PASSED'), 'page self-test passes; Ian Coleman\'s code is the pinned copy of commit ' + COMMIT);
const shuffled = () => { const d = []; for (const s of 'CDHS') for (const k of 'A23456789TJQK') d.push(k + s); for (let i = d.length - 1; i > 0; i--) { const j = nc.randomInt(i + 1); [d[i], d[j]] = [d[j], d[i]]; } return d; };
// The words the page makes. FORGE SEED (with its fingerprint and addresses) runs for the first deal of each length and method;
// the others use the same functions FORGE uses (cdRaw and entropyToMnemonic, or rollsToMnemonic), after the button says yes.
const forged = new Set();
const pageWords = async (cards, method, wc) => {
  w.setMethod('cards');
  $('cdMethod').value = method; $('cdMethod').dispatchEvent(new w.Event('change'));
  $('wordSel').value = String(wc); $('wordSel').dispatchEvent(new w.Event('change'));
  $('cdCards').value = cards.map((c) => c[0] === 'T' && nc.randomInt(2) ? '10' + c[1] : c).join(' '); w.cdUpdate();   // the page also takes 10 for T
  if ($('cdBtn').disabled) return null;
  if (forged.has(method + wc)) return method === 'raw' ? w.entropyToMnemonic(w.cdRaw(w.cdParse($('cdCards').value).cards).bytes) : w.rollsToMnemonic(w.cdParse($('cdCards').value).cards.join(' '), wc);
  forged.add(method + wc); await w.cdGenerate(); return w.hasSeed() ? $('genResult').textContent.split('\n')[0] : null;
};

// Sanity: his tool's own numbers (his notes: a full deck with replacement generates 232 bits, 21 words).
{ const c = coleman(shuffled().join(' '), 'raw'); R.ok(c.type === 'card' && c.bits === 232 && c.phrase.split(' ').length === 21, 'his code: a whole deck is detected as cards, 232 bits, 21 words with raw entropy'); }

// Raw entropy: every number of cards from 20 to 62 (a deck and part of a second shuffle), on several random deals.
let rawSame = 0, rawRefused = 0, lens = new Set();
for (let k = 0; k < 6; k++) {
  const deal = shuffled().concat(shuffled());
  for (let n = 20; n <= 62; n += (k % 2 ? 1 : 3)) {
    const cards = deal.slice(0, n), c = coleman(cards.join(' '), 'raw'), cw = c.phrase ? c.phrase.split(' ').length : 0;
    if ([12, 15, 18, 21, 24].includes(cw)) {
      const p = await pageWords(cards, 'raw', cw);
      if (p === c.phrase) { rawSame++; lens.add(cw); } else R.ok(false, n + ' cards, raw: the page shows other words than his code (' + cw + ' words): ' + p);
      const other = cw === 24 ? 21 : cw + 3;
      if ((await pageWords(cards, 'raw', other)) === null) rawRefused++; else R.ok(false, n + ' cards, raw: his code makes ' + cw + ' words, but the page made ' + other);
    } else if ((await pageWords(cards, 'raw', 12)) !== null || (await pageWords(cards, 'raw', 24)) !== null) R.ok(false, n + ' cards, raw: his code makes ' + cw + ' words, but the page made a seed');
  }
}
R.ok([...forged].filter((x) => x.startsWith('raw')).length === 5 && rawSame > 60 && lens.size === 5, 'raw entropy: the page makes the same words as his code for every deal (' + rawSame + ' deals, lengths ' + [...lens].sort((a, b) => a - b).join(', ') + ')');
R.ok(rawRefused === rawSame, 'raw entropy: the page refuses every other length for the same cards (' + rawRefused + ' checks)');

// Hashed: enough cards for each length; his tool with that number of words.
let hashSame = 0;
for (let k = 0; k < 4; k++) for (const wc of [12, 15, 18, 21, 24]) {
  const cards = shuffled().concat(shuffled()).slice(0, w.cdNeedCards(wc) + nc.randomInt(4)), c = coleman(cards.join(' '), String(wc));
  const p = await pageWords(cards, 'hash', wc);
  if (p === c.phrase && c.phrase.split(' ').length === wc) hashSame++; else R.ok(false, cards.length + ' cards, hashed, ' + wc + ' words: the page shows other words than his code');
}
R.ok(hashSame === 20 && forged.size === 10, 'hashed: the page makes the same words as his code with 12, 15, 18, 21 and 24 words (' + hashSame + ' deals)');
// The page's own self-test known answers come from his code too.
for (const [t, want] of [['KS 3D 9H AC TC 5S JD 2H 8C QS 4D 7H 6C AH TS 9D 3C KH 5D JS 2S 8H QC 4H 7S AD 2D 3H 4C 5C', 'velvet beach salute key actual earn charge fix quick stove swing silk']])
  R.ok(coleman(t, 'raw').phrase === want, 'his code gives the raw 12-word answer the page\'s self-test uses');
R.done('coleman');
