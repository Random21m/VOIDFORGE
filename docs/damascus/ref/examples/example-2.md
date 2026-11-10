# Worked example 2: 12 words, a cheating card sheet (lands on the official BIP39 test vector)

> PUBLIC EXAMPLE. These words are published. Never put money on them.

Dice: the decimal digits of e after "2.", keeping only 1-6, in pairs. Cards: here the card person SAW the dice sheet first and arranged each group of a published deck so that C = D xor 7f7f...7f. The result is the official BIP39 test vector "legal winner thank year wave sausage worth useful legal winner thank yellow". Lesson: the sheet that is filled in second must not see the first one. Fold and hand over (commit) each sheet before the other is revealed. Every check in this example still passes, because the forge marks catch mistakes, not cheating.

## Sheet D (dice, mirror table)

Each line: the two throws, the 5 bits from the mirror table (or "again" for 1-1, 2-2, 3-3, 4-4), and where the bits go in the grid.

```
pair  1: 1 2  ->  00001   symbol  1 -> cells 1-5
pair  2: 1 2  ->  00001   symbol  2 -> cells 6-10
pair  3: 4 5  ->  11001   symbol  3 -> cells 11-15
pair  4: 4 5  ->  11001   symbol  4 -> cells 16-20
pair  5: 2 3  ->  01011   symbol  5 -> cells 21-25
pair  6: 5 3  ->  10100   symbol  6 -> cells 26-30
pair  7: 6 2  ->  10000   symbol  7 -> cells 31-35
pair  8: 4 1  ->  00100   symbol  8 -> cells 36-40
pair  9: 3 5  ->  10101   symbol  9 -> cells 41-45
pair 10: 2 6  ->  10001   symbol 10 -> cells 46-50
pair 11: 6 2  ->  10000   symbol 11 -> cells 51-55
pair 12: 4 5  ->  11001   symbol 12 -> cells 56-60
pair 13: 2 4  ->  01101   symbol 13 -> cells 61-65
pair 14: 3 6  ->  10111   symbol 14 -> cells 66-70
pair 15: 5 5  ->  11110   symbol 15 -> cells 71-75
pair 16: 4 6  ->  11011   symbol 16 -> cells 76-80
pair 17: 6 6  ->  11111   symbol 17 -> cells 81-85
pair 18: 6 2  ->  10000   symbol 18 -> cells 86-90
pair 19: 2 4  ->  01101   symbol 19 -> cells 91-95
pair 20: 6 6  ->  11111   symbol 20 -> cells 96-100
pair 21: 3 3  ->  again   
pair 22: 5 3  ->  10100   symbol 21 -> cells 101-105
pair 23: 5 4  ->  11000   symbol 22 -> cells 106-110
pair 24: 5 4  ->  11000   symbol 23 -> cells 111-115
pair 25: 5 1  ->  00110   symbol 24 -> cells 116-120
pair 26: 3 2  ->  01010   symbol 25 -> cells 121-125
pair 27: 1 5  ->  00111   symbol 26 -> cells 126-128 (only 3 bits needed)
pair 28: 2 5  ->  01111   not needed
pair 29: 1 6  ->  01001   not needed
pair 30: 6 4  ->  11010   not needed
pair 31: 2 4  ->  01101   not needed
pair 32: 2 4  ->  01101   not needed
pair 33: 6 6  ->  11111   not needed
pair 34: 3 1  ->  00010   not needed
pair 35: 3 2  ->  01010   not needed
pair 36: 3 5  ->  10101   not needed
pair 37: 2 1  ->  00000   not needed
pair 38: 1 4  ->  00101   not needed
pair 39: 1 3  ->  00011   not needed
pair 40: 5 6  ->  11101   not needed
```

**Grid D**

```
row | 1 2 3 . 4 5 6 7 . 8 9 10 11 | row mark R
  1 | 0 0 0 . 0 1 0 0 . 0  0  1  1  | 1
  2 | 1 0 0 . 1 1 1 0 . 0  1  0  1  | 0
  3 | 0 1 1 . 1 0 1 0 . 0  1  0  0  | 1
  4 | 0 0 0 . 0 1 0 0 . 1  0  1  0  | 1
  5 | 1 1 0 . 0 0 1 1 . 0  0  0  0  | 0
  6 | 1 1 0 . 0 1 0 1 . 1  0  1  1  | 1
  7 | 0 1 1 . 1 1 1 1 . 1  0  1  1  | 1
  8 | 0 1 1 . 1 1 1 1 . 1  1  0  0  | 0
  9 | 0 0 0 . 1 1 0 1 . 1  1  1  1  | 1
 10 | 1 1 0 . 1 0 0 1 . 1  0  0  0  | 1
 11 | 1 1 0 . 0 0 0 0 . 1  1  0  0  | 0
 12 | 1 0 1 . 0 0 0 1 . -  -  -  -  | 1
  M | 0 1 0 . 0 1 1 1 . 1  1  1  1  |  (column mark M)
```

Column mark M = `01001111111`, row mark R = `101101101101`, skew mark K = `11101111010`

## Sheet C (cards, knockout)

Cards are written in dealt order. In every match, write 1 if the RIGHT card is higher (A low ... K high; same rank: clubs < diamonds < hearts < spades). Octet bits: matches 1v2, 3v4, 5v6, 7v8, then the two semi-finals, then the final. Quad: 1v2, 3v4, final.

```
deck 1 octet 1: 5D 3D 2S 3H 8D TH 7C KC -> 0111 01 1
deck 1 octet 2: 8H TD 4S 4C 7H 6H JD AC -> 1000 01 1
deck 1 octet 3: 5C 4D TC 6S JH KH QH QS -> 0011 10 1
deck 1 octet 4: KS 9H 7D 9C 6D 2C 3S 7S -> 0101 01 0
deck 1 octet 5: 2D 3C AS 2H QC 8S 9D KD -> 1101 01 1
deck 1 octet 6: 9S TS 8C JS 4H AH 6C QD -> 1101 11 1
deck 1 quad  7: JC 5S AD 5H             -> 01 0
deck 2 octet 1: 9D 4C 6H 7C TC KS QC 9H -> 0110 00 1
deck 2 octet 2: 3H 5C 6S 7H 3D TD JD 7S -> 1110 11 1
deck 2 octet 3: 2H AS 4S QH 8H 6C JH 5S -> 0100 11 0
deck 2 octet 4: 8S QD 3C AC KC QS 6D 5D -> 1000 00 1
deck 2 octet 5: 9C 3S TS JC TH 4H 9S AD -> 0100 10 0
deck 2 octet 6: 5H 8D 8C 4D KH KD 2S 2D -> 1000 00 1
deck 2 quad  7: 2C 7D JS AH             -> 10 1
deck 3 octet 1: JD JH 4C 2D KC 8H 7C 8D -> 1001 00 1
deck 3 octet 2: 9D 8C 9H 6D QH 6S AD AC -> 0000 10 1
deck 3 octet 3: 5C 4D QS 7S 6H 2H 3D 9C -> 0001 11 0
deck 3 octet 4: TS TC KH 2C 2S TH QC KD -> 0011 11 0
deck 3 octet 5: 5S 4H 7H 9S KS 3H 5H 4S -> 0100 10 1
deck 3 quad  6: 5D JS 8S TD             -> 11 0
```

**Grid C**

```
row | 1 2 3 . 4 5 6 7 . 8 9 10 11 | row mark R
  1 | 0 1 1 . 1 0 1 1 . 1  0  0  0  | 0
  2 | 0 1 1 . 0 0 1 1 . 1  0  1  0  | 0
  3 | 1 0 1 . 0 1 0 1 . 1  0  1  0  | 0
  4 | 1 1 1 . 1 0 1 1 . 1  1  0  1  | 1
  5 | 0 0 1 . 1 0 0 0 . 1  1  1  1  | 0
  6 | 0 1 1 . 1 0 1 0 . 0  1  1  0  | 0
  7 | 1 0 0 . 0 0 0 1 . 0  1  0  0  | 1
  8 | 1 0 0 . 1 0 0 0 . 0  0  1  1  | 0
  9 | 0 1 1 . 0 0 1 0 . 0  1  0  0  | 0
 10 | 0 0 1 . 0 1 0 0 . 0  1  1  1  | 1
 11 | 0 0 0 . 1 1 1 1 . 0  0  1  0  | 1
 12 | 0 1 0 . 1 1 1 0 . -  -  -  -  | 0
  M | 0 0 0 . 1 0 1 0 . 1  0  1  0  |  (column mark M)
```

Column mark M = `00010101010`, row mark R = `000100100110`, skew mark K = `00100010011`

## Bias boxes

Dice, first 52 throws: faces 1-6 = 4, 10, 8, 9, 11, 10; repeats = 8. Fail if a face is 18 or more, or 1 or less, or repeats are 2 or less. Result: **PASS**

Deck 1: 27 ones in 45 bits; 3 neighbour pairs (same suit, ranks next to each other, side by side in a group). Result: **PASS**
Deck 2: 20 ones in 45 bits; 2 neighbour pairs (same suit, ranks next to each other, side by side in a group). Result: **PASS**
Deck 3: 17 ones in 38 bits; 0 neighbour pairs (same suit, ranks next to each other, side by side in a group). Result: **PASS** (ones test applies to full 45-bit decks only)

## Sheet E = D xor C

**Grid E**

```
row | 1 2 3 . 4 5 6 7 . 8 9 10 11 | row mark R
  1 | 0 1 1 . 1 1 1 1 . 1  0  1  1  | 1
  2 | 1 1 1 . 1 1 0 1 . 1  1  1  1  | 0
  3 | 1 1 0 . 1 1 1 1 . 1  1  1  0  | 1
  4 | 1 1 1 . 1 1 1 1 . 0  1  1  1  | 0
  5 | 1 1 1 . 1 0 1 1 . 1  1  1  1  | 0
  6 | 1 0 1 . 1 1 1 1 . 1  1  0  1  | 1
  7 | 1 1 1 . 1 1 1 0 . 1  1  1  1  | 0
  8 | 1 1 1 . 0 1 1 1 . 1  1  1  1  | 0
  9 | 0 1 1 . 1 1 1 1 . 1  0  1  1  | 1
 10 | 1 1 1 . 1 1 0 1 . 1  1  1  1  | 0
 11 | 1 1 0 . 1 1 1 1 . 1  1  1  0  | 1
 12 | 1 1 1 . 1 1 1 1 . -  -  -  -  | 1
  M | 0 1 0 . 1 1 0 1 . 0  1  0  1  |  (column mark M)
```

Column mark M = `01011010101`, row mark R = `101001001011`, skew mark K = `11001101001`

**Forge seal** (marks of D xor marks of C must equal marks of E):

```
M: D 01001111111  xor  C 00010101010  =  01011010101   E 01011010101   OK
R: D 101101101101  xor  C 000100100110  =  101001001011   E 101001001011   OK
K: D 11101111010  xor  C 00100010011  =  11001101001   E 11001101001   OK
```

## Words

Lookup in the 3-4-4 binary table: first 3 bits = block, next 4 = row, last 4 = column. "No." is the 1-based number on a standard numbered BIP39 list.

| Word | Bits (3-4-4) | No. | Word |
|---:|---|---:|---|
| 1 | 011 1111 1011 | 1020 | legal |
| 2 | 111 1101 1111 | 2016 | winner |
| 3 | 110 1111 1110 | 1791 | thank |
| 4 | 111 1111 0111 | 2040 | year |
| 5 | 111 1011 1111 | 1984 | wave |
| 6 | 101 1111 1101 | 1534 | sausage |
| 7 | 111 1110 1111 | 2032 | worth |
| 8 | 111 0111 1111 | 1920 | useful |
| 9 | 011 1111 1011 | 1020 | legal |
| 10 | 111 1101 1111 | 2016 | winner |
| 11 | 110 1111 1110 | 1791 | thank |
| 12 | 111 1111 + ???? | 2033-2048 | wrap ... zoo (hand range) |

**Last word.** The last 7 grid bits are `1111111`, so word 12 must be between **wrap** (No. 2033) and **zoo** (No. 2048). Enter words 1-11 and the 7 bits `1111111` (as coin flips, 1 = heads) in two tools. Both must show **yellow** (No. 2041, bits `111 1111 1000`; the last 4 bits are the checksum). In range: yes.

**Seed (E):** `legal winner thank year wave sausage worth useful legal winner thank yellow`

**Master fingerprint:** `b8688df1` · **first address (BIP84, m/84'/0'/0'/0/0):** `bc1qgkju4yvvtuz0s8vqn837q396jezu2h8ex7gk98`

## Seed XOR parts (split-sheet audit)

Each source sheet is also a standard BIP39 phrase once a tool adds its own checksum word. Importing both into a Coldcard as Seed XOR gives seed E.

- Part D: `anchor original innocent announce ship slice legal legend brief spread screen pelican`
- Part C: `jacket guard prize waste cradle inquiry little motor goose cigar bundle front`
