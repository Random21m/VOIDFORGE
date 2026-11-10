# Worked example 1: 12 words (dice = digits of pi, cards = public shuffle)

> PUBLIC EXAMPLE. These words are published. Never put money on them.

Dice: the decimal digits of pi after "3.", keeping only 1-6, read in pairs (1415926535 -> 1 4 1 5 2 6 5 3 5 ... -> pairs 14 15 26 53 ...). Cards: decks shuffled by the published rule in ref/make-examples.js (SHA-256 of "VOIDFORGE method example 1 deck N").

## Sheet D (dice, mirror table)

Each line: the two throws, the 5 bits from the mirror table (or "again" for 1-1, 2-2, 3-3, 4-4), and where the bits go in the grid.

```
pair  1: 1 4  ->  00101   symbol  1 -> cells 1-5
pair  2: 1 5  ->  00111   symbol  2 -> cells 6-10
pair  3: 2 6  ->  10001   symbol  3 -> cells 11-15
pair  4: 5 3  ->  10100   symbol  4 -> cells 16-20
pair  5: 5 3  ->  10100   symbol  5 -> cells 21-25
pair  6: 2 3  ->  01011   symbol  6 -> cells 26-30
pair  7: 4 6  ->  11011   symbol  7 -> cells 31-35
pair  8: 2 6  ->  10001   symbol  8 -> cells 36-40
pair  9: 4 3  ->  10010   symbol  9 -> cells 41-45
pair 10: 3 3  ->  again   
pair 11: 2 5  ->  01111   symbol 10 -> cells 46-50
pair 12: 2 4  ->  01101   symbol 11 -> cells 51-55
pair 13: 1 1  ->  again   
pair 14: 6 3  ->  10110   symbol 12 -> cells 56-60
pair 15: 3 5  ->  10101   symbol 13 -> cells 61-65
pair 16: 1 5  ->  00111   symbol 14 -> cells 66-70
pair 17: 2 4  ->  01101   symbol 15 -> cells 71-75
pair 18: 4 4  ->  again   
pair 19: 5 2  ->  01110   symbol 16 -> cells 76-80
pair 20: 3 1  ->  00010   symbol 17 -> cells 81-85
pair 21: 6 4  ->  11010   symbol 18 -> cells 86-90
pair 22: 6 2  ->  10000   symbol 19 -> cells 91-95
pair 23: 6 2  ->  10000   symbol 20 -> cells 96-100
pair 24: 6 2  ->  10000   symbol 21 -> cells 101-105
pair 25: 3 4  ->  10011   symbol 22 -> cells 106-110
pair 26: 2 5  ->  01111   symbol 23 -> cells 111-115
pair 27: 3 4  ->  10011   symbol 24 -> cells 116-120
pair 28: 2 1  ->  00000   symbol 25 -> cells 121-125
pair 29: 1 6  ->  01001   symbol 26 -> cells 126-128 (only 3 bits needed)
pair 30: 2 1  ->  00000   not needed
pair 31: 4 6  ->  11011   not needed
pair 32: 5 1  ->  00110   not needed
pair 33: 3 2  ->  01010   not needed
pair 34: 2 3  ->  01011   not needed
pair 35: 6 6  ->  11111   not needed
pair 36: 4 3  ->  10010   not needed
pair 37: 4 4  ->  again   
pair 38: 6 5  ->  11100   not needed
pair 39: 5 5  ->  11110   not needed
pair 40: 2 2  ->  again   
```

**Grid D**

```
row | 1 2 3 . 4 5 6 7 . 8 9 10 11 | row mark R
  1 | 0 0 1 . 0 1 0 0 . 1  1  1  1  | 0
  2 | 0 0 0 . 1 1 0 1 . 0  0  1  0  | 0
  3 | 1 0 0 . 0 1 0 1 . 1  1  1  0  | 0
  4 | 1 1 1 . 0 0 0 1 . 1  0  0  1  | 0
  5 | 0 0 1 . 1 1 1 0 . 1  1  0  1  | 1
  6 | 1 0 1 . 1 0 1 0 . 1  0  1  0  | 0
  7 | 0 1 1 . 1 0 1 1 . 0  1  0  1  | 1
  8 | 1 1 0 . 0 0 0 1 . 0  1  1  0  | 1
  9 | 1 0 1 . 0 0 0 0 . 1  0  0  0  | 1
 10 | 0 1 0 . 0 0 0 1 . 0  0  1  1  | 0
 11 | 0 1 1 . 1 1 1 0 . 0  1  1  0  | 1
 12 | 0 0 0 . 0 0 1 0 . -  -  -  -  | 1
  M | 1 1 1 . 1 1 1 0 . 0  0  1  1  |  (column mark M)
```

Column mark M = `11111100011`, row mark R = `000010111011`, skew mark K = `00111000111`

## Sheet C (cards, knockout)

Cards are written in dealt order. In every match, write 1 if the RIGHT card is higher (A low ... K high; same rank: clubs < diamonds < hearts < spades). Octet bits: matches 1v2, 3v4, 5v6, 7v8, then the two semi-finals, then the final. Quad: 1v2, 3v4, final.

```
deck 1 octet 1: 9D 3S AC 3D 9S 5D 2D 7C -> 0101 00 1
deck 1 octet 2: 4C TC 2S 8D JD QD JH TS -> 1110 00 1
deck 1 octet 3: 4D QS 8S AH AS 2H 7D 6D -> 1010 01 0
deck 1 octet 4: 3H KD 2C 9C 8H KS JC KC -> 1111 00 1
deck 1 octet 5: 5C KH 7H 4H 6C TD JS QH -> 1011 01 0
deck 1 octet 6: 3C 4S 6S 7S TH AD 5H 5S -> 1101 10 1
deck 1 quad  7: QC 9H 6H 8C             -> 01 0
deck 2 octet 1: JH 3D 5D 4C AS 8S 6S 6H -> 0010 00 0
deck 2 octet 2: 4S TS 8H TD KS KC 5S 5H -> 1100 00 1
deck 2 octet 3: JC TH AH QC AD 2C 4D KH -> 0111 11 1
deck 2 octet 4: 3H 4H 3S QD 9H 6C 2D QH -> 1101 11 1
deck 2 octet 5: 7S 8D QS TC 9S 6D 2H JD -> 1001 11 0
deck 2 octet 6: 7D KD 5C JS 7H 8C 3C 2S -> 1110 00 0
deck 2 quad  7: 9D 7C AC 9C             -> 01 0
deck 3 octet 1: AS 7H 6S 8S 3D 3S AC AH -> 1111 10 0
deck 3 octet 2: JS 9D JD 8C 9H 7S KD 5S -> 0000 01 1
deck 3 octet 3: 7D 2H 4H 9S 5H AD 7C 3C -> 0100 11 0
deck 3 octet 4: TC JC QC TH QD 6C 8D QS -> 1001 11 1
deck 3 octet 5: 4C 5D 6H TS KS 4D 6D TD -> 1101 10 1
deck 3 quad  6: 2D JH 4S 3H             -> 10 0
```

**Grid C**

```
row | 1 2 3 . 4 5 6 7 . 8 9 10 11 | row mark R
  1 | 0 1 0 . 1 0 0 1 . 1  1  1  0  | 0
  2 | 0 0 1 . 1 0 1 0 . 0  1  0  1  | 1
  3 | 1 1 1 . 0 0 1 1 . 0  1  1  0  | 1
  4 | 1 0 1 . 1 0 1 1 . 0  1  0  1  | 1
  5 | 0 0 0 . 1 0 0 0 . 0  1  1  0  | 1
  6 | 0 0 0 . 1 0 1 1 . 1  1  1  1  | 1
  7 | 1 1 0 . 1 1 1 1 . 1  0  0  1  | 0
  8 | 1 1 0 . 1 1 1 0 . 0  0  0  0  | 1
  9 | 1 0 1 . 1 1 1 1 . 0  0  0  0  | 0
 10 | 0 0 0 . 1 1 0 1 . 0  0  1  1  | 1
 11 | 0 1 0 . 0 1 1 1 . 1  1  1  0  | 1
 12 | 1 1 0 . 1 1 0 0 . -  -  -  -  | 0
  M | 0 0 0 . 0 0 0 0 . 0  1  0  1  |  (column mark M)
```

Column mark M = `00000000101`, row mark R = `011111010110`, skew mark K = `10100111001`

## Bias boxes

Dice, first 52 throws: faces 1-6 = 6, 11, 10, 9, 8, 8; repeats = 6. Fail if a face is 18 or more, or 1 or less, or repeats are 2 or less. Result: **PASS**

Deck 1: 25 ones in 45 bits; 3 neighbour pairs (same suit, ranks next to each other, side by side in a group). Result: **PASS**
Deck 2: 24 ones in 45 bits; 1 neighbour pairs (same suit, ranks next to each other, side by side in a group). Result: **PASS**
Deck 3: 21 ones in 38 bits; 2 neighbour pairs (same suit, ranks next to each other, side by side in a group). Result: **PASS** (ones test applies to full 45-bit decks only)

## Sheet E = D xor C

**Grid E**

```
row | 1 2 3 . 4 5 6 7 . 8 9 10 11 | row mark R
  1 | 0 1 1 . 1 1 0 1 . 0  0  0  1  | 0
  2 | 0 0 1 . 0 1 1 1 . 0  1  1  1  | 1
  3 | 0 1 1 . 0 1 1 0 . 1  0  0  0  | 1
  4 | 0 1 0 . 1 0 1 0 . 1  1  0  0  | 1
  5 | 0 0 1 . 0 1 1 0 . 1  0  1  1  | 0
  6 | 1 0 1 . 0 0 0 1 . 0  1  0  1  | 1
  7 | 1 0 1 . 0 1 0 0 . 1  1  0  0  | 1
  8 | 0 0 0 . 1 1 1 1 . 0  1  1  0  | 0
  9 | 0 0 0 . 1 1 1 1 . 1  0  0  0  | 1
 10 | 0 1 0 . 1 1 0 0 . 0  0  0  0  | 1
 11 | 0 0 1 . 1 0 0 1 . 1  0  0  0  | 0
 12 | 1 1 0 . 1 1 1 0 . -  -  -  -  | 1
  M | 1 1 1 . 1 1 1 0 . 0  1  1  0  |  (column mark M)
```

Column mark M = `11111100110`, row mark R = `011101101101`, skew mark K = `10011111110`

**Forge seal** (marks of D xor marks of C must equal marks of E):

```
M: D 11111100011  xor  C 00000000101  =  11111100110   E 11111100110   OK
R: D 000010111011  xor  C 011111010110  =  011101101101   E 011101101101   OK
K: D 00111000111  xor  C 10100111001  =  10011111110   E 10011111110   OK
```

## Words

Lookup in the 3-4-4 binary table: first 3 bits = block, next 4 = row, last 4 = column. "No." is the 1-based number on a standard numbered BIP39 list.

| Word | Bits (3-4-4) | No. | Word |
|---:|---|---:|---|
| 1 | 011 1101 0001 | 978 | kick |
| 2 | 001 0111 0111 | 376 | confirm |
| 3 | 011 0110 1000 | 873 | home |
| 4 | 010 1010 1100 | 685 | few |
| 5 | 001 0110 1011 | 364 | coin |
| 6 | 101 0001 0101 | 1302 | pencil |
| 7 | 101 0100 1100 | 1357 | praise |
| 8 | 000 1111 0110 | 247 | burst |
| 9 | 000 1111 1000 | 249 | business |
| 10 | 010 1100 0000 | 705 | fix |
| 11 | 001 1001 1000 | 409 | credit |
| 12 | 110 1110 + ???? | 1761-1776 | swing ... target (hand range) |

**Last word.** The last 7 grid bits are `1101110`, so word 12 must be between **swing** (No. 1761) and **target** (No. 1776). Enter words 1-11 and the 7 bits `1101110` (as coin flips, 1 = heads) in two tools. Both must show **sword** (No. 1763, bits `110 1110 0010`; the last 4 bits are the checksum). In range: yes.

**Seed (E):** `kick confirm home few coin pencil praise burst business fix credit sword`

**Master fingerprint:** `70b5da37` · **first address (BIP84, m/84'/0'/0'/0/0):** `bc1qk6763xzzpyx3vx6wcgmgeshj4s26wxlfmzns3k`

## Seed XOR parts (split-sheet audit)

Each source sheet is also a standard BIP39 phrase once a tool adds its own checksum word. Importing both into a Coldcard as Seed XOR gives seed E.

- Part D: `clarify bottom mesh tobacco diet relief issue security patient draw lamp afraid`
- Part C: `fatigue cruise traffic repeat awkward blood tennis swing safe bounce exist sunny`
