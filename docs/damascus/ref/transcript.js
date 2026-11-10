// Renders a forge result as a paper-style Markdown transcript (what the sheets should show).
'use strict';
const vf = require('./vf.js');

const g344 = s => (s.length === 11 ? `${s.slice(0, 3)} ${s.slice(3, 7)} ${s.slice(7)}` : s.length === 7 ? `${s.slice(0, 3)} ${s.slice(3)}` : s);
function grid(title, bits, mk) {
  const rows = vf.toRows([...bits].map(Number));
  const L = [`**${title}**`, '', '```', 'row | 1 2 3 . 4 5 6 7 . 8 9 10 11 | row mark R'];
  rows.forEach((r, i) => {
    const cells = r.map(String); while (cells.length < 11) cells.push('-');
    L.push(`${String(i + 1).padStart(3)} | ${cells.slice(0, 3).join(' ')} . ${cells.slice(3, 7).join(' ')} . ${cells.slice(7).join('  ')}  | ${mk.R[i]}`);
  });
  const m = [...mk.M];
  L.push(`  M | ${m.slice(0, 3).join(' ')} . ${m.slice(3, 7).join(' ')} . ${m.slice(7).join('  ')}  |  (column mark M)`);
  L.push('```', '', `Column mark M = \`${mk.M}\`, row mark R = \`${mk.R}\`, skew mark K = \`${mk.K}\``, '');
  return L.join('\n');
}

function transcript(res, input, title) {
  const W = res.words, P = vf.PLAN[W], L = [];
  L.push(`# ${title}`, '');
  L.push('> PUBLIC EXAMPLE. These words are published. Never put money on them.', '');
  if (input.note) L.push(input.note, '');
  // ---- dice
  L.push('## Sheet D (dice, mirror table)', '');
  L.push('Each line: the two throws, the 5 bits from the mirror table (or "again" for 1-1, 2-2, 3-3, 4-4), and where the bits go in the grid.', '');
  L.push('```');
  let pos = 0, sym = 0;
  res.D.log.forEach((e, i) => {
    let where = '';
    if (e.code !== null && pos < P.bits) { sym++; const a = pos; pos = Math.min(P.bits, pos + 5); where = `symbol ${String(sym).padStart(2)} -> cells ${a + 1}-${pos}` + (pos - a < 5 ? ` (only ${pos - a} bits needed)` : ''); }
    else if (e.code !== null) where = 'not needed';
    L.push(`pair ${String(i + 1).padStart(2)}: ${e.a} ${e.b}  ->  ${e.code === null ? 'again' : e.bits}   ${where}`);
  });
  L.push('```', '');
  L.push(grid('Grid D', res.D.bits, res.D.marks));
  // ---- cards
  L.push('## Sheet C (cards, knockout)', '');
  L.push('Cards are written in dealt order. In every match, write 1 if the RIGHT card is higher (A low ... K high; same rank: clubs < diamonds < hearts < spades). Octet bits: matches 1v2, 3v4, 5v6, 7v8, then the two semi-finals, then the final. Quad: 1v2, 3v4, final.', '');
  L.push('```');
  for (const d of res.C.log) {
    d.groups.forEach((g, i) => L.push(`deck ${d.deck} ${g.cards.length === 8 ? 'octet' : 'quad '} ${i + 1}: ${g.cards.join(' ').padEnd(23)} -> ${g.bits.length === 7 ? `${g.bits.slice(0, 4)} ${g.bits.slice(4, 6)} ${g.bits[6]}` : `${g.bits.slice(0, 2)} ${g.bits[2]}`}`));
  }
  L.push('```', '');
  L.push(grid('Grid C', res.C.bits, res.C.marks));
  // ---- bias
  const bd = res.bias.dice, th = vf.BIAS[W];
  L.push('## Bias boxes', '');
  L.push(`Dice, first ${bd.throws} throws: faces 1-6 = ${bd.counts.join(', ')}; repeats = ${bd.repeats}. Fail if a face is ${th.diceHigh} or more, or ${th.diceLow} or less, or repeats are ${th.repeatsLow} or less. Result: **${bd.pass ? 'PASS' : 'FAIL: ' + bd.fail.join('; ')}**`, '');
  for (const c of res.bias.cards) L.push(`Deck ${c.deck}: ${c.ones} ones in ${c.bits} bits; ${c.neighbours} neighbour pairs (same suit, ranks next to each other, side by side in a group). Result: **${c.pass ? 'PASS' : 'FAIL: ' + c.fail.join('; ')}**${c.bits !== 45 ? ' (ones test applies to full 45-bit decks only)' : ''}`);
  L.push('');
  // ---- XOR + seal
  L.push('## Sheet E = D xor C', '');
  L.push(grid('Grid E', res.E.bits, res.E.marks));
  L.push('**Forge seal** (marks of D xor marks of C must equal marks of E):', '', '```');
  for (const k of ['M', 'R', 'K']) {
    const x = vf.xorStr(res.D.marks[k], res.C.marks[k]);
    L.push(`${k}: D ${res.D.marks[k]}  xor  C ${res.C.marks[k]}  =  ${x}   E ${res.E.marks[k]}   ${x === res.E.marks[k] ? 'OK' : 'MISMATCH'}`);
  }
  L.push('```', '');
  // ---- words
  L.push('## Words', '');
  L.push('Lookup in the 3-4-4 binary table: first 3 bits = block, next 4 = row, last 4 = column. "No." is the 1-based number on a standard numbered BIP39 list.', '');
  L.push('| Word | Bits (3-4-4) | No. | Word |', '|---:|---|---:|---|');
  for (const h of res.E.handWords) {
    if (h.partial) L.push(`| ${h.row} | ${g344(h.bits)} + ${P.checksumBits === 4 ? '????' : '????????'} | ${h.firstNumber}-${h.lastNumber} | ${h.firstWord} ... ${h.lastWord} (hand range) |`);
    else L.push(`| ${h.row} | ${g344(h.bits)} | ${h.number} | ${h.word} |`);
  }
  L.push('');
  const last = res.E.handWords[res.E.handWords.length - 1];
  const fw = res.E.phrase[res.E.phrase.length - 1], fi = vf.WORDS.indexOf(fw);
  L.push(`**Last word.** The last ${P.finalBits} grid bits are \`${last.bits}\`, so word ${W} must be between **${last.firstWord}** (No. ${last.firstNumber}) and **${last.lastWord}** (No. ${last.lastNumber}). Enter words 1-${W - 1} and the ${P.finalBits} bits \`${last.bits}\` (as coin flips, 1 = heads) in two tools. Both must show **${fw}** (No. ${fi + 1}, bits \`${g344(vf.bin(fi, 11))}\`; the last ${P.checksumBits} bits are the checksum). In range: ${res.E.finalWordInBlock ? 'yes' : 'NO'}.`, '');
  L.push('**Seed (E):** `' + res.E.phrase.join(' ') + '`', '');
  L.push(`**Master fingerprint:** \`${res.wallet.fingerprint}\` · **first address (BIP84, m/84'/0'/0'/0/0):** \`${res.wallet.firstAddressBIP84}\``, '');
  L.push('## Seed XOR parts (split-sheet audit)', '');
  L.push('Each source sheet is also a standard BIP39 phrase once a tool adds its own checksum word. Importing both into a Coldcard as Seed XOR gives seed E.', '');
  L.push('- Part D: `' + res.D.phrase.join(' ') + '`');
  L.push('- Part C: `' + res.C.phrase.join(' ') + '`', '');
  return L.join('\n');
}
module.exports = { transcript };
