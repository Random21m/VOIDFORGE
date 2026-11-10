# Worked example 3: 24 words (dice = digits of the square root of 2, cards = public shuffle)

> PUBLIC EXAMPLE. These words are published. Never put money on them.

Dice: the decimal digits of sqrt(2) after "1.", keeping only 1-6, in pairs. Cards: six decks shuffled by the published rule (SHA-256 of "VOIDFORGE method example 3 deck N").

## Sheet D (dice, mirror table)

Each line: the two throws, the 5 bits from the mirror table (or "again" for 1-1, 2-2, 3-3, 4-4), and where the bits go in the grid.

```
pair  1: 4 1  ->  00100   symbol  1 -> cells 1-5
pair  2: 4 2  ->  01100   symbol  2 -> cells 6-10
pair  3: 1 3  ->  00011   symbol  3 -> cells 11-15
pair  4: 5 6  ->  11101   symbol  4 -> cells 16-20
pair  5: 2 3  ->  01011   symbol  5 -> cells 21-25
pair  6: 3 5  ->  10101   symbol  6 -> cells 26-30
pair  7: 4 1  ->  00100   symbol  7 -> cells 31-35
pair  8: 6 2  ->  10000   symbol  8 -> cells 36-40
pair  9: 4 2  ->  01100   symbol  9 -> cells 41-45
pair 10: 6 5  ->  11100   symbol 10 -> cells 46-50
pair 11: 6 6  ->  11111   symbol 11 -> cells 51-55
pair 12: 1 5  ->  00111   symbol 12 -> cells 56-60
pair 13: 3 6  ->  10111   symbol 13 -> cells 61-65
pair 14: 4 3  ->  10010   symbol 14 -> cells 66-70
pair 15: 1 6  ->  01001   symbol 15 -> cells 71-75
pair 16: 6 3  ->  10110   symbol 16 -> cells 76-80
pair 17: 3 2  ->  01010   symbol 17 -> cells 81-85
pair 18: 4 4  ->  again   
pair 19: 6 2  ->  10000   symbol 18 -> cells 86-90
pair 20: 1 3  ->  00011   symbol 19 -> cells 91-95
pair 21: 5 3  ->  10100   symbol 20 -> cells 96-100
pair 22: 5 3  ->  10100   symbol 21 -> cells 101-105
pair 23: 4 3  ->  10010   symbol 22 -> cells 106-110
pair 24: 2 6  ->  10001   symbol 23 -> cells 111-115
pair 25: 4 1  ->  00100   symbol 24 -> cells 116-120
pair 26: 5 2  ->  01110   symbol 25 -> cells 121-125
pair 27: 3 5  ->  10101   symbol 26 -> cells 126-130
pair 28: 1 3  ->  00011   symbol 27 -> cells 131-135
pair 29: 4 6  ->  11011   symbol 28 -> cells 136-140
pair 30: 2 3  ->  01011   symbol 29 -> cells 141-145
pair 31: 1 2  ->  00001   symbol 30 -> cells 146-150
pair 32: 2 2  ->  again   
pair 33: 4 2  ->  01100   symbol 31 -> cells 151-155
pair 34: 4 3  ->  10010   symbol 32 -> cells 156-160
pair 35: 6 5  ->  11100   symbol 33 -> cells 161-165
pair 36: 5 5  ->  11110   symbol 34 -> cells 166-170
pair 37: 3 2  ->  01010   symbol 35 -> cells 171-175
pair 38: 1 2  ->  00001   symbol 36 -> cells 176-180
pair 39: 6 4  ->  11010   symbol 37 -> cells 181-185
pair 40: 4 1  ->  00100   symbol 38 -> cells 186-190
pair 41: 2 1  ->  00000   symbol 39 -> cells 191-195
pair 42: 4 3  ->  10010   symbol 40 -> cells 196-200
pair 43: 5 3  ->  10100   symbol 41 -> cells 201-205
pair 44: 1 4  ->  00101   symbol 42 -> cells 206-210
pair 45: 1 3  ->  00011   symbol 43 -> cells 211-215
pair 46: 2 2  ->  again   
pair 47: 2 6  ->  10001   symbol 44 -> cells 216-220
pair 48: 6 5  ->  11100   symbol 45 -> cells 221-225
pair 49: 2 5  ->  01111   symbol 46 -> cells 226-230
pair 50: 5 5  ->  11110   symbol 47 -> cells 231-235
pair 51: 2 5  ->  01111   symbol 48 -> cells 236-240
pair 52: 5 5  ->  11110   symbol 49 -> cells 241-245
pair 53: 5 1  ->  00110   symbol 50 -> cells 246-250
pair 54: 1 5  ->  00111   symbol 51 -> cells 251-255
pair 55: 2 2  ->  again   
pair 56: 6 5  ->  11100   symbol 52 -> cells 256-256 (only 1 bits needed)
pair 57: 1 4  ->  00101   not needed
pair 58: 1 5  ->  00111   not needed
pair 59: 5 1  ->  00110   not needed
pair 60: 6 5  ->  11100   not needed
pair 61: 2 4  ->  01101   not needed
pair 62: 5 3  ->  10100   not needed
pair 63: 4 5  ->  11001   not needed
pair 64: 6 6  ->  11111   not needed
pair 65: 2 1  ->  00000   not needed
pair 66: 4 2  ->  01100   not needed
pair 67: 5 1  ->  00110   not needed
pair 68: 4 1  ->  00100   not needed
pair 69: 6 4  ->  11010   not needed
pair 70: 1 6  ->  01001   not needed
pair 71: 5 5  ->  11110   not needed
pair 72: 2 3  ->  01011   not needed
pair 73: 2 2  ->  again   
pair 74: 3 4  ->  10011   not needed
pair 75: 4 3  ->  10010   not needed
```

**Grid D**

```
row | 1 2 3 . 4 5 6 7 . 8 9 10 11 | row mark R
  1 | 0 0 1 . 0 0 0 1 . 1  0  0  0  | 1
  2 | 0 0 1 . 1 1 1 1 . 0  1  0  1  | 1
  3 | 0 1 1 . 1 0 1 0 . 1  0  0  1  | 0
  4 | 0 0 1 . 0 0 0 0 . 0  1  1  0  | 1
  5 | 0 1 1 . 1 0 0 1 . 1  1  1  1  | 0
  6 | 0 0 1 . 1 1 1 0 . 1  1  1  1  | 0
  7 | 0 0 1 . 0 0 1 0 . 0  1  1  0  | 0
  8 | 1 1 0 . 0 1 0 1 . 0  1  0  0  | 1
  9 | 0 0 0 . 0 0 1 1 . 1  0  1  0  | 0
 10 | 0 1 0 . 1 0 0 1 . 0  0  1  0  | 0
 11 | 1 0 0 . 0 1 0 0 . 1  0  0  0  | 1
 12 | 1 1 1 . 0 1 0 1 . 0  1  0  0  | 0
 13 | 0 1 1 . 1 1 0 1 . 1  0  1  0  | 1
 14 | 1 1 0 . 0 0 0 1 . 0  1  1  0  | 1
 15 | 0 1 0 . 0 1 0 1 . 1  1  0  0  | 1
 16 | 1 1 1 . 1 0 0 1 . 0  1  0  0  | 0
 17 | 0 0 0 . 1 1 1 0 . 1  0  0  0  | 0
 18 | 1 0 0 . 0 0 0 0 . 0  1  0  0  | 0
 19 | 1 0 1 . 0 1 0 0 . 0  0  1  0  | 0
 20 | 1 0 0 . 0 1 1 1 . 0  0  0  1  | 1
 21 | 1 1 1 . 0 0 0 1 . 1  1  1  1  | 0
 22 | 1 1 1 . 0 0 1 1 . 1  1  1  1  | 1
 23 | 1 1 0 . 0 0 1 1 . 0  0  0  1  | 1
 24 | 1 1 1 . - - - - . -  -  -  -  | 1
  M | 0 1 0 . 0 0 1 1 . 1  1  1  0  |  (column mark M)
```

Column mark M = `01000111110`, row mark R = `110100010010111000010111`, skew mark K = `00001010000`

## Sheet C (cards, knockout)

Cards are written in dealt order. In every match, write 1 if the RIGHT card is higher (A low ... K high; same rank: clubs < diamonds < hearts < spades). Octet bits: matches 1v2, 3v4, 5v6, 7v8, then the two semi-finals, then the final. Quad: 1v2, 3v4, final.

```
deck 1 octet 1: 8C 4D 3S AH KH 3D KC JH -> 0000 00 1
deck 1 octet 2: 5H 2S KS AC 5C TD 5S AS -> 0010 10 0
deck 1 octet 3: JS QD 3C 6H 7D 7C QH 6D -> 1100 01 1
deck 1 octet 4: 4C 6C TC 2C TS 4S 9S 4H -> 1000 10 1
deck 1 octet 5: 2H 6S AD 3H 8H 7H JC 9C -> 1100 01 1
deck 1 octet 6: 9D 7S 8S 8D JD KD 5D QC -> 0011 00 1
deck 1 quad  7: 9H 2D QS TH             -> 00 1
deck 2 octet 1: 9D 7D AC KS JD QH 2S TD -> 0111 10 0
deck 2 octet 2: AS KH 6H QD 7C 4S 8C KD -> 1101 01 0
deck 2 octet 3: 8S JC TC QS 3S 4H QC 3H -> 1110 11 0
deck 2 octet 4: 9H 9S 6S 5C 3D 5H 2H 8H -> 1011 01 0
deck 2 octet 5: 2D KC 6C 3C 7H 6D AH 2C -> 1001 00 0
deck 2 octet 6: 5S TH 4D 8D JH JS 5D 9C -> 1111 00 1
deck 2 quad  7: AD TS 4C 7S             -> 11 0
deck 3 octet 1: 9S 5H 6D 8D QC TH QH AC -> 0100 01 1
deck 3 octet 2: 8H 3D 4D 2S 5S AH 4S 7H -> 0001 01 0
deck 3 octet 3: 9C 2H JS 9H 5D 2D KC 6H -> 0000 11 1
deck 3 octet 4: KS QD 6S JH 6C 3S JD AD -> 0100 01 0
deck 3 octet 5: 7C KH 3H 8S 4H TC 8C 7D -> 1110 00 0
deck 3 octet 6: 9D 3C 5C JC QS 7S TS TD -> 0100 10 1
deck 3 quad  7: 2C 4C AS KD             -> 11 1
deck 4 octet 1: 7H JD 4H 6H 9C AD KS KD -> 1100 01 1
deck 4 octet 2: 8C 7D 9H KC 8S 2H 2S TS -> 0101 11 0
deck 4 octet 3: 5H 4S 3H AH 3D 6D 3C JC -> 0011 01 1
deck 4 octet 4: 6C AC 5D 4C 3S QD 8H 9S -> 0011 00 1
deck 4 octet 5: 8D 5C TC TD 7S 5S AS 9D -> 0101 11 0
deck 4 octet 6: QH JH QC QS KH 7C 2D JS -> 0101 10 1
deck 4 quad  7: 2C 6S 4D TH             -> 11 1
deck 5 octet 1: JC 2C AC 3D 7S 5S 9D 4S -> 0100 01 0
deck 5 octet 2: 4D 9S 6S 5H TC 2D KH 8H -> 1000 01 1
deck 5 octet 3: 8D TS KD AH 3C TH 4C JH -> 1011 11 0
deck 5 octet 4: TD 4H 3H KS QH QC JS 5D -> 0100 10 0
deck 5 octet 5: KC 2S QS 6C JD 8C QD 6D -> 0000 01 0
deck 5 octet 6: 7C 9H 9C 3S 5C 6H 7H 2H -> 1010 01 0
deck 5 quad  7: AS 8S AD 7D             -> 11 0
deck 6 octet 1: 8C 3C KH 6H 4S QC KC TH -> 0010 11 0
deck 6 octet 2: 6C KS 9S 8S AC JS QH 7C -> 1010 01 0
deck 6 octet 3: 8D 2C 6S QS 7S JD TC 6D -> 0110 10 0
deck 6 octet 4: JH 9H 7H 9D 2H 4D 5H 2D -> 0110 01 0
deck 6 quad  5: 5D 7D 5C JC             -> 11 1
```

**Grid C**

```
row | 1 2 3 . 4 5 6 7 . 8 9 10 11 | row mark R
  1 | 0 0 0 . 0 0 0 1 . 0  0  1  0  | 0
  2 | 1 0 0 . 1 1 0 0 . 0  1  1  1  | 0
  3 | 0 0 0 . 1 0 1 1 . 1  0  0  0  | 0
  4 | 1 1 0 . 0 1 1 0 . 0  1  0  0  | 1
  5 | 1 0 1 . 1 1 1 0 . 0  1  1  0  | 1
  6 | 1 0 1 . 0 1 1 1 . 0  1  1  0  | 1
  7 | 1 0 1 . 1 0 1 0 . 1  0  0  1  | 0
  8 | 0 0 0 . 1 1 1 1 . 0  0  1  1  | 0
  9 | 1 0 0 . 1 0 0 0 . 1  1  0  0  | 0
 10 | 0 1 0 . 1 0 0 0 . 0  0  1  1  | 0
 11 | 1 0 1 . 0 0 0 1 . 0  1  1  1  | 0
 12 | 0 0 0 . 0 0 1 0 . 0  1  0  1  | 1
 13 | 1 1 1 . 1 1 0 0 . 0  1  1  0  | 1
 14 | 1 0 1 . 1 1 0 0 . 0  1  1  0  | 0
 15 | 1 1 0 . 0 1 1 0 . 0  1  0  1  | 0
 16 | 0 1 1 . 1 0 0 1 . 0  1  1  0  | 0
 17 | 1 1 1 . 1 0 1 0 . 0  0  1  0  | 0
 18 | 1 0 0 . 0 0 1 1 . 1  0  1  1  | 0
 19 | 1 1 0 . 0 1 0 0 . 1  0  0  0  | 0
 20 | 0 0 0 . 0 1 0 1 . 0  1  0  0  | 1
 21 | 1 0 1 . 1 0 0 0 . 1  0  1  1  | 0
 22 | 0 1 0 . 1 0 0 1 . 0  0  1  1  | 1
 23 | 0 1 0 . 0 0 1 1 . 0  0  1  0  | 0
 24 | 1 1 1 . - - - - . -  -  -  -  | 1
  M | 1 0 0 . 1 0 1 0 . 0  0  1  0  |  (column mark M)
```

Column mark M = `10010100010`, row mark R = `000111000001100000010101`, skew mark K = `00100111110`

## Bias boxes

Dice, first 104 throws: faces 1-6 = 14, 21, 19, 16, 19, 15; repeats = 17. Fail if a face is 29 or more, or 6 or less, or repeats are 7 or less. Result: **PASS**

Deck 1: 18 ones in 45 bits; 2 neighbour pairs (same suit, ranks next to each other, side by side in a group). Result: **PASS**
Deck 2: 26 ones in 45 bits; 1 neighbour pairs (same suit, ranks next to each other, side by side in a group). Result: **PASS**
Deck 3: 19 ones in 45 bits; 1 neighbour pairs (same suit, ranks next to each other, side by side in a group). Result: **PASS**
Deck 4: 26 ones in 45 bits; 1 neighbour pairs (same suit, ranks next to each other, side by side in a group). Result: **PASS**
Deck 5: 18 ones in 45 bits; 3 neighbour pairs (same suit, ranks next to each other, side by side in a group). Result: **PASS**
Deck 6: 15 ones in 31 bits; 2 neighbour pairs (same suit, ranks next to each other, side by side in a group). Result: **PASS** (ones test applies to full 45-bit decks only)

## Sheet E = D xor C

**Grid E**

```
row | 1 2 3 . 4 5 6 7 . 8 9 10 11 | row mark R
  1 | 0 0 1 . 0 0 0 0 . 1  0  1  0  | 1
  2 | 1 0 1 . 0 0 1 1 . 0  0  1  0  | 1
  3 | 0 1 1 . 0 0 0 1 . 0  0  0  1  | 0
  4 | 1 1 1 . 0 1 1 0 . 0  0  1  0  | 0
  5 | 1 1 0 . 0 1 1 1 . 1  0  0  1  | 1
  6 | 1 0 0 . 1 0 0 1 . 1  0  0  1  | 1
  7 | 1 0 0 . 1 0 0 0 . 1  1  1  1  | 0
  8 | 1 1 0 . 1 0 1 0 . 0  1  1  1  | 1
  9 | 1 0 0 . 1 0 1 1 . 0  1  1  0  | 0
 10 | 0 0 0 . 0 0 0 1 . 0  0  0  1  | 0
 11 | 0 0 1 . 0 1 0 1 . 1  1  1  1  | 1
 12 | 1 1 1 . 0 1 1 1 . 0  0  0  1  | 1
 13 | 1 0 0 . 0 0 0 1 . 1  1  0  0  | 0
 14 | 0 1 1 . 1 1 0 1 . 0  0  0  0  | 1
 15 | 1 0 0 . 0 0 1 1 . 1  0  0  1  | 1
 16 | 1 0 0 . 0 0 0 0 . 0  0  1  0  | 0
 17 | 1 1 1 . 0 1 0 0 . 1  0  1  0  | 0
 18 | 0 0 0 . 0 0 1 1 . 1  1  1  1  | 0
 19 | 0 1 1 . 0 0 0 0 . 1  0  1  0  | 0
 20 | 1 0 0 . 0 0 1 0 . 0  1  0  1  | 0
 21 | 0 1 0 . 1 0 0 1 . 0  1  0  0  | 0
 22 | 1 0 1 . 1 0 1 0 . 1  1  0  0  | 0
 23 | 1 0 0 . 0 0 0 0 . 0  0  1  1  | 1
 24 | 0 0 0 . - - - - . -  -  -  -  | 0
  M | 1 1 0 . 1 0 0 1 . 1  1  0  0  |  (column mark M)
```

Column mark M = `11010011100`, row mark R = `110011010011011000000010`, skew mark K = `00101101110`

**Forge seal** (marks of D xor marks of C must equal marks of E):

```
M: D 01000111110  xor  C 10010100010  =  11010011100   E 11010011100   OK
R: D 110100010010111000010111  xor  C 000111000001100000010101  =  110011010011011000000010   E 110011010011011000000010   OK
K: D 00001010000  xor  C 00100111110  =  00101101110   E 00101101110   OK
```

## Words

Lookup in the 3-4-4 binary table: first 3 bits = block, next 4 = row, last 4 = column. "No." is the 1-based number on a standard numbered BIP39 list.

| Word | Bits (3-4-4) | No. | Word |
|---:|---|---:|---|
| 1 | 001 0000 1010 | 267 | candy |
| 2 | 101 0011 0010 | 1331 | play |
| 3 | 011 0001 0001 | 786 | giraffe |
| 4 | 111 0110 0010 | 1891 | unable |
| 5 | 110 0111 1001 | 1658 | song |
| 6 | 100 1001 1001 | 1178 | nasty |
| 7 | 100 1000 1111 | 1168 | music |
| 8 | 110 1010 0111 | 1704 | stay |
| 9 | 100 1011 0110 | 1207 | nothing |
| 10 | 000 0001 0001 | 18 | acquire |
| 11 | 001 0101 1111 | 352 | cloud |
| 12 | 111 0111 0001 | 1906 | until |
| 13 | 100 0001 1100 | 1053 | logic |
| 14 | 011 1101 0000 | 977 | key |
| 15 | 100 0011 1001 | 1082 | mango |
| 16 | 100 0000 0010 | 1027 | leopard |
| 17 | 111 0100 1010 | 1867 | true |
| 18 | 000 0011 1111 | 64 | among |
| 19 | 011 0000 1010 | 779 | genuine |
| 20 | 100 0010 0101 | 1062 | lucky |
| 21 | 010 1001 0100 | 661 | family |
| 22 | 101 1010 1100 | 1453 | remain |
| 23 | 100 0000 0011 | 1028 | lesson |
| 24 | 000 + ???????? | 1-256 | abandon ... cable (hand range) |

**Last word.** The last 3 grid bits are `000`, so word 24 must be between **abandon** (No. 1) and **cable** (No. 256). Enter words 1-23 and the 3 bits `000` (as coin flips, 1 = heads) in two tools. Both must show **artist** (No. 105, bits `000 0110 1000`; the last 8 bits are the checksum). In range: yes.

**Seed (E):** `candy play giraffe unable song nasty music stay nothing acquire cloud until logic key mango leopard true among genuine lucky family remain lesson artist`

**Master fingerprint:** `116ab0ba` · **first address (BIP84, m/84'/0'/0'/0/0):** `bc1qflh2d4a2mud6x6rvkk63dzu55kz0h2uklskzy2`

## Seed XOR parts (split-sheet audit)

Each source sheet is also a standard BIP39 phrase once a tool adds its own checksum word. Importing both into a Coldcard as Seed XOR gives seed E.

- Part D: `cart dirt inside camp initial digital cave skin also false math tunnel kitten security entire verb brown letter portion mixed token tree shiver walk`
- Part C: `across ocean blade smart rubber put release bunker muscle expire pepper again web rhythm smile index violin manual simple appear ramp fame edge venue`
