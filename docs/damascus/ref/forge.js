#!/usr/bin/env node
// VOIDFORGE method — command-line reference.
// Usage: node ref/forge.js input.json [--md out.md] [--json out.json]
// input.json: { "words": 12, "dice": "16 25 33 ...", "cards": ["AS 7H ...", "...", "..."] }
//   dice  = throw pairs in the order thrown, INCLUDING "roll again" pairs, as two-digit tokens or [[a,b],...]
//   cards = one string (or array) per deck, cards in dealt order, e.g. "7H KC TS 2D"
'use strict';
const fs = require('fs');
const vf = require('./vf.js');
const { transcript } = require('./transcript.js');

function parseInput(obj) {
  const dice = Array.isArray(obj.dice) ? obj.dice : String(obj.dice).trim().split(/[\s,]+/).map(t => {
    if (!/^[1-6][1-6]$/.test(t)) throw new Error('bad dice pair token: ' + t);
    return [+t[0], +t[1]];
  });
  const cards = obj.cards.map(d => (Array.isArray(d) ? d : String(d).trim().split(/[\s,]+/)));
  return { words: obj.words || 12, dice, cards };
}
if (require.main === module) {
  const [file, ...rest] = process.argv.slice(2);
  if (!file) { console.error('usage: node ref/forge.js input.json [--md out.md] [--json out.json]'); process.exit(2); }
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = vf.forge(parseInput(input));
  const md = transcript(res, input, input.title || 'VOIDFORGE method transcript');
  const i = rest.indexOf('--md'), j = rest.indexOf('--json');
  if (i >= 0) fs.writeFileSync(rest[i + 1], md); else console.log(md);
  if (j >= 0) fs.writeFileSync(rest[j + 1], JSON.stringify(res, null, 1));
}
module.exports = { parseInput };
