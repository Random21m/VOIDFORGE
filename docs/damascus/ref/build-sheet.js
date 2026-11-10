// Builds forge-sheet.html (12 words), forge-sheet-24.html (24 words) and bip39-binary-table.html
// from the same tables the reference implementation uses.
'use strict';
const fs = require('fs'), path = require('path');
const vf = require('./vf.js');
const ROOT = path.join(__dirname, '..');

const CSS = `
:root{--ink:#000;--mid:#555;--light:#bbb;--shade:#e6e6e6;--paper:#fff}
*{box-sizing:border-box}
html,body{margin:0;background:var(--paper);color:var(--ink);font:8.7pt/1.25 "Helvetica Neue",Helvetica,Arial,"Liberation Sans",sans-serif}
@page{margin:0.35in}
.page{width:7.5in;margin:0 auto;padding:0;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
@media screen{body{background:#eee}.page{background:#fff;padding:0.35in;width:8.2in;margin:12px auto;box-shadow:0 1px 4px rgba(0,0,0,.25)}}
.hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #000;padding-bottom:3px;margin-bottom:6px}
.hdr .t{font-weight:800;font-size:12pt;letter-spacing:.03em;white-space:nowrap}
.hdr .t small{font-weight:600;font-size:9pt;letter-spacing:0}
.hdr .f{font-size:8pt;text-align:right;line-height:1.5}
.line{display:inline-block;border-bottom:1px solid #000;min-width:1.1in}
.note{font-size:7.8pt;color:var(--mid)}
h3{font-size:9pt;margin:5px 0 2px;text-transform:uppercase;letter-spacing:.05em}
ol.steps{margin:0 0 4px;padding-left:1.25em}
ol.steps li{margin:1px 0}
.tm{font-weight:700;white-space:nowrap}
.row{display:flex;gap:10px;align-items:flex-start}
.box{border:1.2px solid #000;padding:4px 6px}
.warn{border:1.5px solid #000;padding:3px 6px;font-weight:600;font-size:8.2pt}
table{border-collapse:collapse}
.mirror td,.mirror th{border:1px solid #000;width:0.56in;height:0.235in;text-align:center;font:8.6pt/1 "DejaVu Sans Mono",Menlo,Consolas,monospace}
.mirror th{background:var(--shade);font:700 8.5pt/1 Helvetica,Arial,sans-serif;width:auto;padding:0 3px}
.mirror td.again{background:repeating-linear-gradient(135deg,#fff 0 3px,#ddd 3px 5px);font:italic 7.5pt Helvetica,Arial,sans-serif}
.mirror td b{font-weight:800}
.grid td{border:1px solid #000;width:0.3in;height:0.232in;text-align:center;position:relative;font:8pt monospace;padding:0}
.grid td.sh{background:var(--shade)}
.grid td.off{background:repeating-linear-gradient(135deg,#fff 0 3px,#999 3px 4px)}
.grid td.gap{border:none;width:0.07in}
.grid th{font:700 7pt Helvetica,Arial,sans-serif;padding:0 3px;text-align:center}
.grid th.w{font-weight:400;color:var(--mid);font-size:6pt}
.grid td .n{position:absolute;left:1px;top:0;font:6pt Helvetica,Arial,sans-serif;color:var(--mid)}
.grid td .k{position:absolute;right:1px;bottom:0;font:italic 6.5pt Helvetica,Arial,sans-serif;color:var(--mid)}
.grid td.mk{border-width:1.8px;background:#fff}
.grid td.word{width:1.9in;text-align:left;border:1px solid #000;border-left-width:1.8px}
.grid td.chk{width:0.24in}
.grid td.rn{border:none;font:700 7.5pt Helvetica,Arial,sans-serif;width:0.25in}
.grid tr.deck td.rn{color:#000}
.pairs{display:grid;grid-template-columns:repeat(10,1fr);gap:3px}
.pairs div{border:1px solid #000;height:0.27in;position:relative;display:flex}
.pairs div span{flex:1;border-right:1px dotted #888}
.pairs div span:last-child{border-right:none}
.pairs div i{position:absolute;left:1px;top:-1px;font:normal 5.8pt Helvetica,Arial,sans-serif;color:var(--mid)}
.tally td,.tally th{border:1px solid #000;padding:2px 4px;text-align:center;font-size:8pt}
.tally td.big{width:0.9in;height:0.2in}
.tally td.num{width:0.38in}
.small td,.small th{border:1px solid #000;padding:2px 3px;font-size:8pt;text-align:center}
.small td.wide{width:1.35in}
.seal td,.seal th{border:1px solid #000;height:0.2in;font:8pt monospace;text-align:center;padding:0 2px}
.seal td.c{width:0.2in}
.seal th{font:700 7.5pt Helvetica,Arial,sans-serif;text-align:left;padding:0 4px}
.rec{display:grid;grid-template-columns:1fr 1fr;column-gap:12px;row-gap:2px}
.rec div{display:flex;align-items:center;gap:2px;font:7pt Helvetica,Arial,sans-serif}
.rec div b{width:0.62in;font-weight:700}
.rec div span{width:0.3in;height:0.2in;border:1px solid #000}
.rec div span.q{border-style:dashed;border-color:#999}
.cols2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.final td,.final th{border:1px solid #000;padding:1px 5px;height:0.24in;font-size:8pt;text-align:left}
.final{width:100%}.final th{background:var(--shade);width:1.55in;font-size:7.4pt;line-height:1.1}
.kt td,.kt th{border:1px solid #000;width:0.27in;height:0.2in;text-align:center;font-size:7.5pt}
.foot{margin-top:4px;font-size:7pt;color:var(--mid);border-top:1px solid #999;padding-top:2px}
svg text{font:7pt Helvetica,Arial,sans-serif}
`;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function header(kind, words, sub) {
  return `<div class="hdr"><div class="t">VOIDFORGE METHOD · ${kind} &nbsp;<small>${words}-word seed</small></div>
  <div class="f">Seed label <span class="line"></span> &nbsp; Date <span class="line" style="min-width:.8in"></span><br>${sub}</div></div>`;
}

function mirrorTable() {
  let h = '<table class="mirror" aria-label="Mirror table"><tr><th>1st \\ 2nd</th>' + [1, 2, 3, 4, 5, 6].map(x => `<th>${x}</th>`).join('') + '</tr>';
  for (let a = 1; a <= 6; a++) {
    h += `<tr><th>${a}</th>`;
    for (let b = 1; b <= 6; b++) {
      const c = vf.mirrorCode(a, b);
      if (c === null) h += `<td class="again" data-a="${a}" data-b="${b}" data-code="again">again</td>`;
      else { const s = vf.bin(c, 5); h += `<td data-a="${a}" data-b="${b}" data-code="${s}">${s.slice(0, 4)}<b>${s[4]}</b></td>`; }
    }
    h += '</tr>';
  }
  return h + '</table>';
}

// runs: array of {len, label} filling cells in reading order; returns per-cell {shade, label}
function runCells(bits, runs) {
  const cells = []; let shade = false;
  for (const r of runs) { for (let i = 0; i < r.len && cells.length < bits; i++) cells.push({ sh: shade, n: i === 0 ? r.label : '' }); shade = !shade; }
  while (cells.length < bits) cells.push({ sh: false, n: '' });
  return cells;
}
function gridTable({ bits, rows, cells, skew = false, words = false, weights = false, deckRows = {} }) {
  const W = [1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1];
  let h = '<table class="grid">';
  if (weights) h += '<tr><th></th>' + W.map((w, i) => (i === 3 || i === 7 ? '<td class="gap"></td>' : '') + `<th class="w">${w}</th>`).join('') + '<td class="gap"></td><th></th>' + (words ? '<th></th><th></th>' : '') + '</tr>';
  h += '<tr><th></th>' + [...Array(11)].map((_, i) => (i === 3 || i === 7 ? '<td class="gap"></td>' : '') + `<th>${i + 1}</th>`).join('') + '<td class="gap"></td><th>R</th>' + (words ? '<th style="text-align:left">word</th><th>✓</th>' : '') + '</tr>';
  for (let r = 0; r < rows; r++) {
    h += `<tr${deckRows[r] ? ' class="deck"' : ''}><td class="rn">${r + 1}</td>`;
    for (let c = 0; c < 11; c++) {
      if (c === 3 || c === 7) h += '<td class="gap"></td>';
      const i = r * 11 + c;
      if (i >= bits) { h += '<td class="off"></td>'; continue; }
      const cell = cells ? cells[i] : { sh: false, n: '' };
      const k = skew ? `<span class="k">${vf.skewLetter(r, c)}</span>` : '';
      h += `<td class="${cell.sh ? 'sh' : ''}"${skew ? ` data-r="${r + 1}" data-c="${c + 1}" data-k="${vf.skewLetter(r, c)}"` : ''}>${cell.n !== '' ? `<span class="n">${cell.n}</span>` : ''}${k}</td>`;
    }
    h += '<td class="gap"></td><td class="mk"></td>';
    if (words) h += (r === rows - 1 ? `<td class="word" style="font-size:6.5pt;color:#555">last word: see box ⑤</td>` : '<td class="word"></td>') + '<td class="chk"></td>';
    h += '</tr>';
  }
  h += '<tr><td class="rn">M</td>' + [...Array(11)].map((_, i) => (i === 3 || i === 7 ? '<td class="gap"></td>' : '') + '<td class="mk"></td>').join('') + '</tr>';
  return h + '</table>';
}

function bracketSvg() {
  // octet bracket: 8 slots, matches numbered in bit order
  const W = 330, H = 92, x = i => 14 + i * 40, mid = (a, b) => (a + b) / 2;
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Knockout order for 8 cards">`;
  for (let i = 0; i < 8; i++) s += `<rect x="${x(i) - 12}" y="62" width="24" height="26" fill="#fff" stroke="#000"/><text x="${x(i)}" y="79" text-anchor="middle">${i + 1}</text>`;
  const lvl = (pairs, y0, y1, nums) => pairs.forEach(([a, b], k) => {
    s += `<path d="M${a} ${y0} V${y1} H${b} V${y0}" fill="none" stroke="#000"/>`;
    s += `<circle cx="${mid(a, b)}" cy="${y1}" r="7" fill="#fff" stroke="#000"/><text x="${mid(a, b)}" y="${y1 + 2.5}" text-anchor="middle" font-weight="700">${nums[k]}</text>`;
  });
  const r1 = [[x(0), x(1)], [x(2), x(3)], [x(4), x(5)], [x(6), x(7)]];
  lvl(r1, 62, 50, [1, 2, 3, 4]);
  const r2 = [[mid(x(0), x(1)), mid(x(2), x(3))], [mid(x(4), x(5)), mid(x(6), x(7))]];
  lvl(r2, 43, 30, [5, 6]);
  lvl([[mid(r2[0][0], r2[0][1]), mid(r2[1][0], r2[1][1])]], 23, 10, [7]);
  s += `</svg>`;
  return s;
}

function sheetD(words) {
  const P = vf.PLAN[words], th = vf.BIAS[words];
  const runs = Array.from({ length: P.symbols }, (_, i) => ({ len: 5, label: i + 1 }));
  const cells = runCells(P.bits, runs);
  const nPairs = words === 12 ? 40 : 80;
  const pairs = Array.from({ length: nPairs }, (_, i) => `<div><i>${i + 1}</i><span></span><span></span></div>`).join('');
  return `<section class="page">
${header('SHEET D · DICE', words, 'Source D. An auditor for D may see this sheet, never sheet C or E.')}
<ol class="steps">
<li><span class="tm">D1 · ≈${words === 12 ? 7 : 14} min.</span> Throw two dice from the same set in a cup (or one die twice). Read the <b>left</b> die first. Write both numbers in the next pair box. If they are 1-1, 2-2, 3-3 or 4-4, cross the box out (“again”). Otherwise find the cell in the mirror table (row = first number, column = second) and write its 5 bits into the next shaded run of grid D (runs are numbered). Stop when cell ${P.bits} is full (the last run uses only ${P.bits - 5 * (P.symbols - 1)} bits).</li>
<li><span class="tm">D2 · ≈1 min.</span> Bias box: tally the faces of the <b>first ${P.dicePairsTally} pair boxes</b> (${2 * P.dicePairsTally} throws, crossed-out boxes included) and count repeats (a throw equal to the throw just before it, across box edges too).</li>
<li><span class="tm">D3 · ≈1.5 min.</span> Marks. Row mark R: write 1 at the end of a row if the row has an odd number of 1s, else 0. Column mark M: the same for each column, written in row M.</li>
<li><span class="tm">D4 · optional.</span> Seed XOR part: words 1-${words - 1} of D are read like sheet E; a tool adds D's own last word. Never type D into the device that will hold E unless you accept that it learns D.</li>
</ol>
<div class="row">
 <div>${mirrorTable()}
 <div class="note" style="margin-top:2px;width:3.6in">Mirror rule: cells (a,b) and (b,a) share the first 4 bits; the bold 5th bit is 1 when the second throw is higher. 5-5 ends in 0, 6-6 in 1. For one die thrown twice this bit is exactly fair even if the die is biased (classes 5-5/6-6 excepted). The other 4 bits are fair only for a fair die.</div></div>
 <div class="box" style="flex:1"><b>Bias box (D2)</b> — detects gross defects only
  <table class="tally" style="margin-top:3px"><tr><th>face</th><th>tally</th><th>count</th></tr>
  ${[1, 2, 3, 4, 5, 6].map(f => `<tr><td>${f}</td><td class="big"></td><td class="num"></td></tr>`).join('')}
  <tr><td>repeats</td><td class="big"></td><td class="num"></td></tr></table>
  <div style="font-size:7.8pt;margin-top:3px"><b>FAIL</b> if any count ≥ ${th.diceHigh} or ≤ ${th.diceLow}, or repeats ≤ ${th.repeatsLow}.<br>Fair dice fail about 2% of the time. On FAIL: new dice, new sheet D. Never edit bits.</div>
  <div style="margin-top:4px;font-size:8pt">Result: PASS ☐ &nbsp; FAIL ☐</div></div>
</div>
<h3>Pair boxes (first throw | second throw)</h3>
<div class="pairs">${pairs}</div>
${words === 24 ? `</section><section class="page">${header('SHEET D · GRID', words, 'Part of sheet D.')}` : ''}
<h3>Grid D</h3>
<div class="row"><div>${gridTable({ bits: P.bits, rows: P.rows, cells })}</div>
<div class="note" style="flex:1">Shaded and white runs alternate: each run is one accepted pair (5 bits). Small numbers = run number. Hatched cells are not used.<br><br><b>Auditor D</b> re-reads every pair box in the mirror table and compares each run, re-tallies the bias box and recomputes R and M. Then signs:<br><br>M(D) and R(D) checked by <span class="line"></span></div></div>
<div class="foot">VOIDFORGE method sheet D · bits are a one-time pad for sheet C: this sheet alone says nothing about the seed only if sheet C is a good, independent source.</div>
</section>`;
}

function sheetC(words) {
  const P = vf.PLAN[words], th = vf.BIAS[words], plan = vf.cardPlan(P.bits);
  const runs = []; plan.forEach((g, d) => g.forEach((n, i) => runs.push({ len: n - 1, label: `${d + 1}${n === 8 ? '.' + (i + 1) : 'q'}` })));
  const cells = runCells(P.bits, runs);
  const rec = plan.flatMap((g, d) => g.map((n, i) => `<div><b>deck ${d + 1} ${n === 8 ? 'oct ' + (i + 1) : 'quad'}</b>${Array.from({ length: 8 }, (_, k) => `<span${k >= n ? ' class="q" style="visibility:hidden"' : ''}></span>`).join('')}</div>`)).join('');
  return `<section class="page">
${header('SHEET C · CARDS', words, 'Source C. An auditor for C may see this sheet, never sheet D or E.')}
<ol class="steps">
<li><span class="tm">C1 · ≈1.4 min per deck.</span> Shuffle one full 52-card deck: spread it face down and wash (stir) it for 30 seconds, gather, then <b>12 riffle shuffles</b> and one cut. ${plan.length} decks in all (you may reuse the same deck).</li>
<li><span class="tm">C2 · ≈2.5 min per deck.</span> Deal 8 cards face up in a row, left to right. Play the 7 matches in the numbered order below. In every match write <b>1 if the RIGHT card is higher</b>, 0 if the left card is higher, into the next run of grid C (labels: deck.octet). After a match, slide the lower card down; the higher card plays on. After 6 octets, deal 4 cards (quad, label <i>q</i>: matches 1v2, 3v4, then the two winners).</li>
<li><span class="tm">C3 · while dealing.</span> Count <b>neighbours</b>: two cards side by side in a group, same suit, ranks next to each other (7♥ 8♥, 8♥ 7♥, A♣ 2♣, Q♠ K♠). After each deck count the 1s it gave.</li>
<li><span class="tm">C4 · ≈1.5 min.</span> Marks R and M, as on sheet D. <i>Audit mode</i> (+≈4.5 min): also write every card (e.g. 7H, TS, KC) in the record below so auditor C can redo the matches.</li>
</ol>
<div class="row">
<div class="box" style="width:3.75in"><b>Card order:</b> A 2 3 4 5 6 7 8 9 10 J Q K (A low, K high). Same rank: ♣ &lt; ♦ &lt; ♥ &lt; ♠ (alphabetical: clubs, diamonds, hearts, spades). There are no ties.<br>${bracketSvg()}<br><span class="note">Matches ①–④: 1v2, 3v4, 5v6, 7v8. ⑤: winner of 1v2 against winner of 3v4. ⑥: winners of 5v6 and 7v8. ⑦: the final, left half against right half. Write the bits in this order.</span></div>
<div class="box" style="flex:1"><b>Bias box (C3)</b> — detects gross defects only
<table class="small" style="margin-top:3px"><tr><th>deck</th><th>1s</th><th>neighbours</th><th>pass?</th></tr>
${plan.map((g, d) => `<tr><td>${d + 1}</td><td style="width:.45in">${g.length === 7 ? '' : '<span class="note">—</span>'}</td><td style="width:.6in"></td><td style="width:.4in"></td></tr>`).join('')}</table>
<div style="font-size:7.8pt;margin-top:3px"><b>FAIL</b> a deck if its 1s are ≤ ${th.cardOnesLow} or ≥ ${th.cardOnesHigh} (full 45-bit decks only), or neighbours ≥ ${th.cardNeighboursHigh}. A good shuffle fails about 0.6% of decks. On FAIL: reshuffle and redo that deck's runs.</div></div>
</div>
${words === 24 ? `</section><section class="page">${header('SHEET C · GRID', words, 'Part of sheet C.')}` : ''}
<h3>Grid C</h3>
<div class="row"><div>${gridTable({ bits: P.bits, rows: P.rows, cells })}</div>
<div class="note" style="flex:1">Runs alternate shaded and white: an octet gives 7 bits, a quad 3. Label 2.3 = deck 2, octet 3; 1q = deck 1 quad.<br><br>Deck plan: ${plan.map((g, d) => `deck ${d + 1}: ${g.filter(n => n === 8).length} octets + ${g.filter(n => n === 4).length} quad`).join('; ')}.<br><br><b>Auditor C</b> redoes the matches from the record (audit mode), re-counts the bias box and recomputes R and M. Then signs:<br><br>M(C) and R(C) checked by <span class="line"></span></div></div>
${words === 12 ? `<h3>Card record (audit mode)</h3><div class="rec">${rec}</div>` : ''}
<div class="foot">VOIDFORGE method sheet C · the matches only use the order of the cards, so any 52 distinct cards work; what matters is a thorough shuffle.</div>
</section>${words === 24 ? `<section class="page">${header('SHEET C · RECORD', words, 'Part of sheet C.')}<div class="rec">${rec}</div></section>` : ''}`;
}

function sheetE(words) {
  const P = vf.PLAN[words];
  const last = P.bits - 11 * (P.rows - 1);
  const seal = k => {
    const n = k === 'M' ? 11 : P.rows;
    return ['D', 'C', 'D ⊕ C', 'E'].map(r => `<tr><th>${k}(${r})</th>${Array.from({ length: n }, () => '<td class="c"></td>').join('')}</tr>`).join('');
  };
  const block = `<table class="final">
<tr><th>Last ${last} bits of grid E</th><td></td></tr>
<tr><th>Word ${words} must be between</th><td><span class="line" style="min-width:.85in"></span> and <span class="line" style="min-width:.85in"></span><br><span class="note">${words === 12 ? 'bits 1-3 = block, 4-7 = row: one of that row’s 16 words' : 'the 3 bits = block: one of its 256 words'}</span></td></tr>
<tr><th>Tool A (VOIDFORGE Word draw)</th><td></td></tr>
<tr><th>Tool B (SeedSigner Calc final word)</th><td></td></tr>
<tr><th>A = B, and inside the range?</th><td>yes ☐ &nbsp; no ☐ → stop and find the mistake</td></tr>
<tr><th>Fingerprint A / B / wallet</th><td><span class="line" style="min-width:.62in"></span> / <span class="line" style="min-width:.62in"></span> / <span class="line" style="min-width:.62in"></span></td></tr>
<tr><th>First address A / wallet (first 6 + last 6)</th><td><span class="line" style="min-width:.95in"></span> / <span class="line" style="min-width:.95in"></span></td></tr>
</table>`;
  const ktable = `<table class="kt"><tr><th></th>${'abcdefghijk'.split('').map(x => `<th><i>${x}</i></th>`).join('')}</tr><tr><th>1s</th>${'abcdefghijk'.split('').map(() => '<td></td>').join('')}</tr><tr><th>K</th>${'abcdefghijk'.split('').map(() => '<td></td>').join('')}</tr></table>`;
  const grid = gridTable({ bits: P.bits, rows: P.rows, cells: null, skew: true, words: true, weights: true });
  const steps = `<ol class="steps">
<li><span class="tm">E1 · ≈${words === 12 ? 2.5 : 5} min.</span> XOR. Put sheets D and C side by side. For each cell: same bits → <b>0</b>, different → <b>1</b>. Write it in grid E.</li>
<li><span class="tm">E2 · ≈${words === 12 ? 2 : 3.5} min.</span> Forge seal. Write R and M for grid E. Copy the marks of D and C into the seal table, XOR them and compare with E’s marks. All must agree; a mismatch points to the row and column of the mistake.</li>
<li><span class="tm">E3 · ≈${words === 12 ? 3 : 6} min.</span> Words. Read each full row as 3-4-4: <b>block</b> (bits 1-3), <b>row</b> (4-7), <b>column</b> (8-11) in the VOIDFORGE binary word table; no arithmetic. (Numbered 1-2048 list instead: add the weights above the 1-cells, plus 1.)</li>
<li><span class="tm">E4 · ≈${words === 12 ? 2 : 4} min.</span> Check the words. Find each word alphabetically in the table, read its bits from the headings and tick ✓ if they equal the grid row.</li>
<li><span class="tm">E5 · ≈4 min.</span> Last word (box ⑤). It needs SHA-256: two independent tools must agree and the word must lie in the range you found by hand. Then compare fingerprint and first address.</li>
<li><span class="tm">E6 · ≈${words === 12 ? 2 : 3.5} min.</span> Backup. Copy the ${words} words <b>and</b> marks M and R (optional: skew mark K) to the backup. Keep marks only next to the words: on their own they reveal ${11 + P.rows} bits.</li>
</ol>`;
  return `<section class="page">
${header('SHEET E · FORGE', words, '<b>SECRET: grid E is your seed.</b> Only the owner sees this sheet. Destroy it after the backup.')}
${steps}
<h3>Grid E = D ⊕ C</h3>
${grid}
<div class="note" style="margin-top:2px">Small italic letters are for the optional skew mark K (count the 1s under each letter; odd → 1). K lets an heir also catch two words written in swapped places.</div>
${words === 12 ? `<div class="row" style="margin-top:4px"><div><b>② Forge seal</b> (E2)<table class="seal">${seal('M')}</table><table class="seal" style="margin-top:3px">${seal('R')}</table></div>
<div style="flex:1"><b>Skew mark K (optional)</b>${ktable}<div style="margin-top:4px"><b>⑤ Last word and identity</b> (E5)</div>${block}</div></div>` : ''}
<div class="foot">VOIDFORGE method sheet E · marks catch mistakes, not cheating · the sheets prove what was written, not that the dice and cards were really used.</div>
</section>${words === 24 ? `<section class="page">${header('SHEET E · PART 2', words, '<b>SECRET.</b> Part of sheet E.')}
<div><b>② Forge seal</b><table class="seal">${seal('M')}</table><table class="seal" style="margin-top:3px">${seal('R')}</table></div>
<div style="margin-top:6px"><b>Skew mark K (optional)</b>${ktable}</div>
<div style="margin-top:6px"><b>⑤ Last word and identity</b>${block}</div></section>` : ''}`;
}

function sheet(words) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VOIDFORGE Forge Sheet</title><style>${CSS}</style></head><body>
${sheetD(words)}${sheetC(words)}${sheetE(words)}
</body></html>`;
}

function binaryTable() {
  const blocks = [];
  for (let b = 0; b < 8; b++) {
    let h = `<div class="blk"><div class="bh">Block <b>${vf.bin(b, 3)}</b> <span>(words ${b * 256 + 1}-${b * 256 + 256}: ${vf.WORDS[b * 256]} … ${vf.WORDS[b * 256 + 255]})</span></div><table><tr><th class="c">row \\ col</th>`;
    for (let c = 0; c < 16; c++) h += `<th>${vf.bin(c, 4)}</th>`;
    h += '</tr>';
    for (let r = 0; r < 16; r++) {
      h += `<tr><th class="c">${vf.bin(r, 4)}</th>`;
      for (let c = 0; c < 16; c++) { const i = b * 256 + r * 16 + c; h += `<td data-i="${i}"${vf.WORDS[i].length >= 8 ? ' class="l"' : ''}>${vf.WORDS[i]}<sub>${i + 1}</sub></td>`; }
      h += '</tr>';
    }
    blocks.push(h + '</table></div>');
  }
  const css = `
:root{--ink:#000;--paper:#fff}*{box-sizing:border-box}
html,body{margin:0;background:var(--paper);color:var(--ink);font:7pt/1.1 "Helvetica Neue",Helvetica,Arial,"Liberation Sans",sans-serif}
@page{margin:0.3in}
.pg{width:7.6in;margin:0 auto;break-after:page;page-break-after:always}.pg:last-child{break-after:auto}
@media screen{body{background:#eee}.pg{background:#fff;padding:.3in;width:8.2in;margin:12px auto}}
h1{font-size:11pt;margin:0 0 2px}p{margin:0 0 4px;font-size:7.5pt}
.blk{margin-bottom:14px}.bh{font-size:8.5pt;margin-bottom:1px}.bh span{font-size:7pt;color:#444}
table{border-collapse:collapse;width:100%;table-layout:fixed}
td,th{border:0.6px solid #000;padding:0 1px;height:0.25in;font-size:6.4pt;letter-spacing:-0.15px;overflow:hidden;white-space:nowrap}
th{background:#e6e6e6;font:700 6pt "DejaVu Sans Mono",Menlo,monospace;text-align:center}
th.c{width:0.34in}td.l{font-size:5.9pt}
tr:nth-child(4n+1) td{border-bottom-width:1.2px}
td sub{display:block;font-size:5pt;color:#555;text-align:right;line-height:1}td{line-height:1.05;vertical-align:top}`;
  const intro = `<h1>VOIDFORGE binary word table (BIP39 English, 2048 words)</h1><p>Find a word from 11 bits without arithmetic: bits 1-3 pick the <b>block</b>, bits 4-7 the <b>row</b>, bits 8-11 the <b>column</b>. Words run in alphabetical order, so you can also find a word and read its bits back from the headings (the check in step E4). Small numbers = position on a standard numbered list (1-2048). For a 12-word seed, bits 1-7 of the last word give one row: the last word is one of its 16 words.</p>`;
  const pages = [];
  for (let p = 0; p < 8; p += 2) pages.push(`<section class="pg">${p === 0 ? intro : ''}${blocks.slice(p, p + 2).join('')}</section>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VOIDFORGE Binary Word Table</title><style>${css}</style></head><body>${pages.join('')}</body></html>`;
}

fs.writeFileSync(path.join(ROOT, 'forge-sheet.html'), sheet(12));
fs.writeFileSync(path.join(ROOT, 'forge-sheet-24.html'), sheet(24));
fs.writeFileSync(path.join(ROOT, 'bip39-binary-table.html'), binaryTable());
console.log('wrote forge-sheet.html, forge-sheet-24.html, bip39-binary-table.html');
